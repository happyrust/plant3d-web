import { computed, ref, shallowRef, watch } from 'vue';

import {
  fromClassicMeasurement,
  fromXeokitMeasurement,
  isUnifiedMeasurementRecord,
  normalizeUnifiedMeasurementRecord,
  toClassicMeasurement,
  toXeokitMeasurement,
} from './unifiedMeasurement';

import type { UnifiedMeasurementRecord } from './unifiedMeasurement';
import type { MeasurementPickSourceId } from './useMeasurementPickSources';
import type { ComputationProvenance } from '@/measurement/domain/computationProvenance';
import type {
  AnnotationComment,
  AnnotationReviewAction,
  AnnotationReviewState,
  AnnotationScreenshot,
  AnnotationSeverity,
  User,
} from '@/types/auth';

import { isAnnotationUxFlagEnabled } from '@/composables/useAnnotationUxFlags';
import { useUserStore } from '@/composables/useUserStore';
import { getOutputProjectFromUrl } from '@/lib/filesOutput';
import {
  archiveLegacyDimensionBridge,
  archiveLegacyDimensions,
  parseLegacyDimensionBridgeArchive,
  parseLegacyDimensionArchive,
  type StorageLike,
} from '@/migrations/legacyDimensionV5Archive';
import {
  annotationScopeKey,
  describeUnattributedDraft,
  isSameAnnotationScope,
  parseLegacyStorageScope,
  type AnnotationScope,
} from '@/review/domain/annotationScope';
import {
  fillBoxAnnotationRegionDefault,
  fillCloudRegionFieldDefaults,
  reconcileMembersRegion,
  regionAabb,
  type CloudRegionFields,
  type ObbSnapshot,
  type RegionV1,
} from '@/review/domain/cloudRegion';
import { buildCommentThreadKey } from '@/review/domain/commentThread';
import { liftAnnotationComment } from '@/review/domain/reviewSnapshot';
import {
  getCommentsFromStore as _storeGetComments,
  getReviewCommentThreadStore,
} from '@/review/services/sharedStores';
import {
  createDefaultAnnotationReviewState,
  normalizeAnnotationReviewState,
  normalizeAnnotationScreenshot,
  normalizeAnnotationSeverity,
} from '@/types/auth';
import {
  describeValue,
  failFileValidation,
  parseJsonText,
} from '@/utils/fileValidation';

/** 从 userStore 读当前登录用户 id；未登录/SSR 场景返回 undefined，供批注 authorId 回填。 */
function resolveCurrentAuthorId(): string | undefined {
  try {
    return useUserStore().currentUser.value?.id || undefined;
  } catch {
    return undefined;
  }
}

function _getThreadStore() {
  return getReviewCommentThreadStore();
}

export type ToolMode =
  | 'none'
  | 'measure_distance'
  | 'measure_angle'
  | 'xeokit_measure_distance'
  | 'xeokit_measure_angle'
  | 'xeokit_measure_elevation_point'
  | 'xeokit_measure_elevation_delta'
  | 'measure_point_to_object'
  | 'measure_object_to_object'
  | 'measure_pipe_to_structure'
  | 'measure_pipe_to_pipe'
  | 'annotation'
  | 'annotation_cloud'
  | 'annotation_rect'
  | 'annotation_obb'
  | 'pick_query_center'
  | 'pick_refno'
  | 'pick_refno_box';

export type AttributeDisplayMode = 'all' | 'general' | 'component' | 'uda';

/**
 * 云线关联元素的选择层级：
 * - `element`：不上溯，点选/框选拿到的就是命中的元件本身（COUP/BEND/VALV…）。
 * - `branch`：上溯到所属 BRAN，整条分支作为一个目标。
 */
export type CloudTargetLevel = 'element' | 'branch';

export type Vec3 = [number, number, number];

export type MeasurementKind = 'distance' | 'angle' | 'elevation_point' | 'elevation_delta';

export type MeasurementPointSourceInfo = {
  source: MeasurementPickSourceId;
  candidateId?: string;
  refno?: string | null;
  label?: string | null;
};

export type MeasurementPoint = {
  entityId: string;
  worldPos: Vec3;
  /** 工程 World 坐标（米），不包含 Viewer recenter 平移。 */
  designWorldPos?: Vec3;
  sourceInfo?: MeasurementPointSourceInfo;
};

export type MeasurementSourceLink = {
  sourceAnnotationId?: string;
  sourceAnnotationType?: AnnotationType;
  formId?: string;
  taskId?: string;
  provenance?: ComputationProvenance;
};

export type DistanceMeasurementRecord = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  createdAt: number;
} & MeasurementSourceLink;

export type AngleMeasurementRecord = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  createdAt: number;
} & MeasurementSourceLink;

export type ElevationPointMeasurementRecord = {
  id: string;
  kind: 'elevation_point';
  point: MeasurementPoint;
  absoluteElevation: number;
  datumElevation: number;
  relativeElevation: number;
  visible: boolean;
  createdAt: number;
} & MeasurementSourceLink;

export type ElevationDeltaMeasurementRecord = {
  id: string;
  kind: 'elevation_delta';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  originElevation: number;
  targetElevation: number;
  deltaElevation: number;
  datumElevation: number;
  visible: boolean;
  createdAt: number;
} & MeasurementSourceLink;

export type MeasurementRecord =
  | DistanceMeasurementRecord
  | AngleMeasurementRecord
  | ElevationPointMeasurementRecord
  | ElevationDeltaMeasurementRecord;

export type XeokitMeasurementKind = 'distance' | 'angle' | 'elevation_point' | 'elevation_delta';

/**
 * E3D「Perpendicular to」结果标记：`origin` 是拾取的源点，`target` 是落在目标
 * 无限线 / 无限面上的垂足（点源无几何时为第二个拾取点本身）。结果表按
 * Distance / Vertical / Horizontal / Direction 解读，参考系固定 World。
 */
export type PerpendicularMeasurementInfo = {
  targetKind: 'line' | 'plane' | 'point';
  /** 提供目标几何的点源摘要，如「P-Point #3 轴线」。 */
  targetLabel?: string | null;
};

/**
 * Web 增强「最短距离」（结果卡 Distance 下拉 `Shortest`，决策 d-619）：两组几何（点 / 无限线 / 无限面）
 * 的真最短距离，`origin` / `target` 是两个 witness，结果表仍是 Distance / Offset / Direction。
 * **不是 E3D parity**——E3D 产品里的 Measure Shortest 永远是两拾中点距离（golden MD §32 / §33）；
 * 这里落的是 `gmfLine.shortest` 里产品进不去的分支（`src/measurement/kernel/shortestDistance.ts`）。
 */
export type ShortestMeasurementInfo = {
  kind: 'point-point' | 'point-line' | 'point-plane' | 'line-line' | 'line-plane' | 'plane-plane';
  /** 两次拾中项的摘要，如「SCTN 边」「PANE 面」。 */
  firstLabel?: string | null;
  secondLabel?: string | null;
  /** 两项平行（线线 / 线面 / 面面）：最近点对不唯一，起点取第一项上的拾中处。 */
  parallel: boolean;
  /** 线 × 线异面：两个 witness 是公垂线两端。 */
  skew: boolean;
};

export type XeokitDistanceMeasurementRecord = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  approximate: boolean;
  createdAt: number;
  perpendicular?: PerpendicularMeasurementInfo;
  /** 存在即为「最短距离」结果（origin / target 为两个 witness）。 */
  shortest?: ShortestMeasurementInfo;
} & MeasurementSourceLink;

/**
 * E3D「Angle 2 Lines」结果标记（`EDGPICKPACKET.measureLineAngleArc` → `gmfArc.radius2Lines`）：
 * 角度来自两条拾中的线（或线 + 面），不是三个点。记录里 `corner` 是弧心（两线交点；异面时取
 * 第一条线上离第二条最近的点），`origin` / `target` 是两条臂在弧半径处的端点，结果表仍是
 * Decimal Angle / DMS / Direction1 / Direction2。角度值与两条臂的单位方向（设计 World）直接记在
 * 这里——「线在面内」是 E3D 的 0° 弧，三点内核造不出它。
 */
export type LineAngleMeasurementInfo = {
  kind: 'line-line' | 'line-plane';
  angleDeg: number;
  direction1: Vec3;
  direction2: Vec3;
  /** 两线异面：弧心落在第一条线上（E3D `LINE.intersection` 口径）。 */
  skew: boolean;
  /** 线 + 面：线在面内（E3D 半径 100 mm 的 0° 弧）。 */
  inPlane: boolean;
  /** 两次拾取的摘要，如「Graphics 边 · ELBO」。 */
  firstLabel?: string | null;
  secondLabel?: string | null;
};

export type XeokitAngleMeasurementRecord = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  approximate: boolean;
  createdAt: number;
  /** 两线夹角（E3D Angle 2 Lines）时带；三点角没有此字段。 */
  lineAngle?: LineAngleMeasurementInfo;
} & MeasurementSourceLink;

export type XeokitElevationPointMeasurementRecord = {
  id: string;
  kind: 'elevation_point';
  point: MeasurementPoint;
  absoluteElevation: number;
  datumElevation: number;
  relativeElevation: number;
  visible: boolean;
  approximate: boolean;
  createdAt: number;
} & MeasurementSourceLink;

export type XeokitElevationDeltaMeasurementRecord = {
  id: string;
  kind: 'elevation_delta';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  originElevation: number;
  targetElevation: number;
  deltaElevation: number;
  datumElevation: number;
  visible: boolean;
  approximate: boolean;
  createdAt: number;
} & MeasurementSourceLink;

export type XeokitMeasurementRecord =
  | XeokitDistanceMeasurementRecord
  | XeokitAngleMeasurementRecord
  | XeokitElevationPointMeasurementRecord
  | XeokitElevationDeltaMeasurementRecord;

export type XeokitDistanceDraft = {
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  visible: boolean;
  approximate: true;
  createdAt: number;
};

/**
 * 测量临时结果（E3D Measure Session 的 S3 态）：第二击后先产出结果供
 * Result Inspector 解读；是否显示直接斜线、是否保留为 Web 测量标注是
 * 两个独立选项。
 */
export type MeasurementDraftResult = {
  /** 从草稿继承的稳定 id；显式保留时沿用，避免临时/持久图形换身份。 */
  id: string;
  kind: 'distance';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  /** 两点真实三维距离（米，设计坐标）。 */
  distance: number;
  /** Offset：P0 的 wrt=World XYZ 分量（ΔX/ΔY/ΔZ，米）。 */
  offsets: { frame: 'world'; components: Vec3 };
  /** 方向单位向量；显示格式待 E3D 实机验证，内部先存向量。 */
  direction: { vector: Vec3 } | null;
  /** 结果解释参考系；第一阶段只有 world。 */
  wrt: 'world';
  approximate: boolean;
  createdAt: number;
  /** 「生成线性标注」开启时对应的持久测量记录 id；未落地为 null。 */
  persistedMeasurementId: string | null;
  /** 存在即为 Perpendicular to 结果（target 为垂足）。 */
  perpendicular?: PerpendicularMeasurementInfo;
  /** 存在即为「最短距离」结果（origin / target 为两个 witness）。 */
  shortest?: ShortestMeasurementInfo;
};

export type XeokitAngleDraftStage = 'finding_first_arm' | 'finding_second_arm';

export type XeokitAngleDraft = {
  id: string;
  kind: 'angle';
  origin: MeasurementPoint;
  corner: MeasurementPoint;
  target: MeasurementPoint;
  stage: XeokitAngleDraftStage;
  visible: boolean;
  approximate: true;
  createdAt: number;
};

export type XeokitElevationPointDraft = {
  id: string;
  kind: 'elevation_point';
  point: MeasurementPoint;
  absoluteElevation: number;
  datumElevation: number;
  relativeElevation: number;
  visible: boolean;
  approximate: true;
  createdAt: number;
};

export type XeokitElevationDeltaDraftStage = 'finding_target';

export type XeokitElevationDeltaDraft = {
  id: string;
  kind: 'elevation_delta';
  origin: MeasurementPoint;
  target: MeasurementPoint;
  originElevation: number;
  targetElevation: number;
  deltaElevation: number;
  datumElevation: number;
  stage: XeokitElevationDeltaDraftStage;
  visible: boolean;
  approximate: true;
  createdAt: number;
};

export type XeokitHoverState = {
  visible: boolean;
  snapped: boolean;
  entityId: string | null;
  objectId: string | null;
  worldPos: Vec3 | null;
  canvasPos: { x: number; y: number } | null;
};

export type XeokitMarkerRole = 'origin' | 'corner' | 'target' | 'hover';

export type XeokitMarkerState = {
  visible: boolean;
  snapped: boolean;
  role: XeokitMarkerRole;
  worldPos: Vec3 | null;
  canvasPos: { x: number; y: number } | null;
};

export type XeokitPointerLensState = {
  visible: boolean;
  snapped: boolean;
  title: string;
  subtitle: string;
  canvasPos: { x: number; y: number } | null;
};

function rebaseXeokitElevationPointRecord(
  record: XeokitElevationPointMeasurementRecord | XeokitElevationPointDraft,
  datumElevation: number,
): XeokitElevationPointMeasurementRecord | XeokitElevationPointDraft {
  return {
    ...record,
    datumElevation,
    relativeElevation: record.absoluteElevation - datumElevation,
  };
}

function rebaseXeokitElevationDeltaRecord(
  record: XeokitElevationDeltaMeasurementRecord | XeokitElevationDeltaDraft,
  datumElevation: number,
): XeokitElevationDeltaMeasurementRecord | XeokitElevationDeltaDraft {
  return {
    ...record,
    datumElevation,
    deltaElevation: record.targetElevation - record.originElevation,
  };
}

export type AnnotationRecord = {
  id: string;
  entityId: string;
  worldPos: Vec3;
  labelWorldPos?: Vec3;
  collapsed?: boolean;
  visible: boolean;
  glyph: string;
  title: string;
  description: string;
  createdAt: number;
  /**
   * @deprecated 请改用 `refnos`。保留 `refno` 仅用于 V1\u2013V5 持久化的兼容读取。
   * `normalizeAnnotationRecord` 会在 `refnos` 缺失时从 `refno` 推导。
   */
  refno?: string;
  /**
   * 关联的对象参考号列表（与 cloud/rect/obb 的命名保持一致）。
   * 文字批注历史上只有单个 `refno`，此字段在 Phase 1 额外引入，
   * 以便上层可以无差别地读取所有批注的关联对象。
   */
  refnos?: string[];
  /**
   * 带角色的关联结构（ADR-0049：四类批注统一）。缺失时由 `refno` / `refnos` 推导，读取后恒存在：
   * 创建时点击命中的构件（`refno`）默认同时写 anchor 与 member 两条（双角色），其余 `refnos` 为 member。
   * 反查与统计只看 member；锚点不构成关联。
   */
  bindings?: AnnotationElementBinding[];
  comments?: AnnotationComment[]; // 多角色意见列表
  reviewState?: AnnotationReviewState;
  /** 问题严重度（建议/一般/严重/致命），默认未设置 */
  severity?: AnnotationSeverity;
  /** 批注创建者 ID（用于权限判断：作者可编辑严重度） */
  authorId?: string;
  screenshot?: AnnotationScreenshot;
};

export type Obb = {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  halfSize: Vec3;
  corners: [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3];
};

export type ObbAnnotationAnchor =
  | {
    kind: 'top_center';
  }
  | {
    kind: 'corner';
    cornerIndex: number;
  };

export type ObbAnnotationRecord = {
  id: string;
  objectIds: string[];
  obb: Obb;
  labelWorldPos: Vec3;
  anchor: ObbAnnotationAnchor;
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[]; // 关联的对象参考号列表
  /**
   * 带角色的关联结构（ADR-0049）。缺失时由 `refnos`（兜底 `objectIds`）推导为 member；
   * 选择集 OBB 没有单一锚点构件，不推导 anchor。读取后恒存在。
   */
  bindings?: AnnotationElementBinding[];
  /**
   * 与云线共用的世界范围体（2026-09-14 方案 §7，P3）：新建（开关 `annotationSharedRegion` 开）写 `origin:'members'` 的真实放置盒，
   * 旧记录读取时由 `obb` 派生 `legacy-snapshot`（按保存的盒恢复，不自动迁移）。`obb` 字段照旧双写，旧端只看它。
   */
  regionV1?: RegionV1 | null;
  comments?: AnnotationComment[]; // 多角色意见列表
  reviewState?: AnnotationReviewState;
  severity?: AnnotationSeverity;
  authorId?: string;
  screenshot?: AnnotationScreenshot;
  /**
   * 与 `AnnotationRecord.collapsed` / `CloudAnnotationRecord.collapsed` 对齐：
   * true 时只渲染 box + pin（图钉），不渲染文字框 / 引线。双击图钉切换。
   */
  collapsed?: boolean;
};

/** 云线关联元素的角色：`anchor` 为图钉参考中心，`member` 为问题目标元素。 */
export type CloudBindingRole = 'anchor' | 'member';

/**
 * 云线与模型元素的工程语义绑定。
 *
 * 同一 refno 既是锚点又是目标时会产生两条记录（role 各一），
 * 以保证与旧字段 `anchorRefno` / `refnos` 的双向换算无损。
 */
export type CloudElementBinding = {
  refno: string;
  role: CloudBindingRole;
  /** 创建时的 noun 快照，供列表显示与分组过滤使用 */
  noun?: string;
  createdAt: number;
};

/**
 * 四类批注共用的带角色绑定（ADR-0049）。结构与云线完全一致，
 * 起别名只是为了让 text / rect / obb 的字段不再叫「Cloud」。
 */
export type AnnotationElementBinding = CloudElementBinding;

export type {
  CloudLabelLayoutV1,
  CloudPresentationV1,
  CloudRegionFields,
  CloudViewpointV1,
  ConvexCell,
  ObbSnapshot,
  RegionV1,
  SourceStamp,
  ViewSnapshotV1,
} from '@/review/domain/cloudRegion';

export type CloudAnnotationRecord = {
  id: string;
  objectIds: string[];
  anchorWorldPos: Vec3;
  anchorRefno?: string;
  leaderEndWorldPos?: Vec3;
  /** 框选构件合并 AABB，用于「三维包围盒」云线绘制 */
  selectionBbox?: { min: Vec3; max: Vec3 };
  screenOffset?: { x: number; y: number };
  cloudSize?: { width: number; height: number };
  visible: boolean;
  /** 带角色的关联结构；缺失时由 `refnos` / `anchorRefno` 推导，读取后恒存在 */
  bindings?: CloudElementBinding[];
  /**
   * 空间范围体四字段（2026-09-14 方案 §6，`@/review/domain/cloudRegion`）：
   * `regionV1` 指认范围快照 / `presentationV1` 呈现版本 / `viewpointV1` 创建与代表视点 / `labelLayoutV1` 标签像素意图。
   * 只增不改；读取时经 `normalizeCloudAnnotationRecord` 补默认值（旧记录 `presentationV1.algorithm === 'legacy-v0'`，渲染照旧）。
   */
  regionV1?: CloudRegionFields['regionV1'];
  presentationV1?: CloudRegionFields['presentationV1'];
  viewpointV1?: CloudRegionFields['viewpointV1'];
  labelLayoutV1?: CloudRegionFields['labelLayoutV1'];
  /**
   * 与 `AnnotationRecord.collapsed` 对齐：true 时只渲染图钉标记，
   * 不渲染文字框 / 引线。双击图钉切换。
   */
  collapsed?: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[]; // 关联的对象参考号列表
  comments?: AnnotationComment[]; // 多角色意见列表
  reviewState?: AnnotationReviewState;
  severity?: AnnotationSeverity;
  authorId?: string;
  screenshot?: AnnotationScreenshot;
};

export type RectAnnotationRecord = {
  id: string;
  objectIds: string[];
  obb: Obb;
  anchorWorldPos: Vec3;
  leaderEndWorldPos?: Vec3;
  visible: boolean;
  title: string;
  description: string;
  createdAt: number;
  refnos?: string[];
  /**
   * 带角色的关联结构（ADR-0049）。缺失时由 `refnos`（兜底 `objectIds`）推导为 member；
   * 矩形框可由单击一个对象或框选多个对象生成，没有稳定的单一锚点构件，不推导 anchor。读取后恒存在。
   */
  bindings?: AnnotationElementBinding[];
  /** 与云线 / OBB 共用的世界范围体（方案 §7，P3）；语义同 `ObbAnnotationRecord.regionV1` */
  regionV1?: RegionV1 | null;
  comments?: AnnotationComment[]; // 多角色意见列表
  reviewState?: AnnotationReviewState;
  severity?: AnnotationSeverity;
  authorId?: string;
  screenshot?: AnnotationScreenshot;
  /**
   * 与其它批注类型 collapsed 字段对齐：true 时只渲染 box + pin（图钉），
   * 不渲染文字框 / 引线。双击图钉切换。
   */
  collapsed?: boolean;
};

export type PickedQueryCenter = {
  entityId: string;
  worldPos: Vec3;
};

export type AnyAnnotationRecord =
  | AnnotationRecord
  | CloudAnnotationRecord
  | RectAnnotationRecord
  | ObbAnnotationRecord;

export type ActiveAnnotationContext = {
  type: AnnotationType;
  id: string;
  record: AnyAnnotationRecord;
};

// Ptset 可视化请求（用于跨组件通信）
export type PtsetVisualizationRequest = {
  refno: string;
  timestamp: number;
};

type PersistedStateV1 = {
  version: 1;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
};

type PersistedStateV2 = {
  version: 2;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
};

type PersistedStateV3 = {
  version: 3;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
};

type PersistedStateV4 = {
  version: 4;
  measurements: MeasurementRecord[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  dimensions: unknown[];
};

type PersistedStateV5 = {
  version: 5;
  measurements: unknown[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  dimensions: unknown[];
  xeokitDistanceMeasurements: unknown[];
  xeokitAngleMeasurements: unknown[];
  xeokitElevationPointMeasurements: unknown[];
  xeokitElevationDeltaMeasurements: unknown[];
};

type PersistedStateV6 = {
  version: 6;
  measurements: unknown[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
  xeokitDistanceMeasurements: unknown[];
  xeokitAngleMeasurements: unknown[];
  xeokitElevationPointMeasurements: unknown[];
  xeokitElevationDeltaMeasurements: unknown[];
};

type PersistedStateV6Bridge = PersistedStateV6 & {
  dimensions?: unknown[];
};

type PersistedStateV7 = {
  version: 7;
  measurements: UnifiedMeasurementRecord[];
  legacyMeasurements: unknown[];
  annotations: AnnotationRecord[];
  obbAnnotations: ObbAnnotationRecord[];
  cloudAnnotations: CloudAnnotationRecord[];
  rectAnnotations: RectAnnotationRecord[];
};

const STORAGE_KEY_V1 = 'plant3d-web-tools-v1';
const STORAGE_KEY_V2 = 'plant3d-web-tools-v2';
const STORAGE_KEY_V3 = 'plant3d-web-tools-v3';
const STORAGE_KEY_V4 = 'plant3d-web-tools-v4';
const STORAGE_KEY_V5 = 'plant3d-web-tools-v5';
const STORAGE_KEY_V6 = 'plant3d-web-tools-v6';
const STORAGE_KEY_V7 = 'plant3d-web-tools-v7';
const LEGACY_DIMENSION_ARCHIVE_KEY = 'plant3d-web-dimensions-v5-archive';
const LEGACY_DIMENSION_BRIDGE_ARCHIVE_KEY = 'plant3d-web-dimensions-v6-bridge-archive';
const LEGACY_DIMENSION_IMPORT_ARCHIVE_KEY = 'plant3d-web-dimensions-v5-import';
const LEGACY_DIMENSION_BRIDGE_IMPORT_ARCHIVE_KEY = 'plant3d-web-dimensions-v6-bridge-import';
const DEFAULT_STORAGE_SCOPE = '__default__';

function getCurrentStorageScope(): string {
  if (typeof window === 'undefined') return DEFAULT_STORAGE_SCOPE;
  try {
    const params = new URLSearchParams(window.location.search);
    const project = getOutputProjectFromUrl() || params.get('project_id') || DEFAULT_STORAGE_SCOPE;
    const dbnum = params.get('show_dbnum') || '__all__';
    return `project=${project}|db=${dbnum}`;
  } catch {
    return DEFAULT_STORAGE_SCOPE;
  }
}

function withStorageScope(storageKey: string, scope = getCurrentStorageScope()): string {
  return `${storageKey}:${scope}`;
}

// ---------------------------------------------------------------------------
// U0 草稿 scope（方案 2026-09-14 §3.6，决策 d-565 / d-571）
//
// 校审上下文里本机草稿容器按「项目 + canonical taskId / draftSessionId + reviewRound + 用户」隔离：
// `setAnnotationDraftScope(scope)` 之后存储 key 从旧的 `project=…|db=…` 换成 `annotationScopeKey(scope)`；
// 切 scope 时先把内存里的状态刷进旧 key、再从新 key 载入，A 任务的草稿不会写进 B 的容器。
// 旧 `project=…|db=…` 容器在 scope 生效期间**只读**：`getUnattributedDraftSummary()` 只数条数给面板显示「未归属草稿」，
// 不导入、不改写。开关 `annotationUx.scopedDraftsV1` 关掉 = scope 不参与 key 计算，回到旧行为。
// ---------------------------------------------------------------------------

/** 当前批注草稿 scope；null = 不在校审任务上下文里（沿用旧 `project=…|db=…` 作用域） */
const annotationDraftScope = shallowRef<AnnotationScope | null>(null);

function isScopedDraftsEnabled(): boolean {
  return isAnnotationUxFlagEnabled('scopedDraftsV1');
}

/** 实际生效的存储作用域字串：开关开 + 有 scope → `annotationScopeKey`；否则旧 `project=…|db=…` */
function resolveStorageScope(): string {
  const scope = annotationDraftScope.value;
  if (scope && isScopedDraftsEnabled()) return annotationScopeKey(scope);
  return getCurrentStorageScope();
}

export type UnattributedDraftSummary = {
  /** 旧容器的作用域字串（`project=…|db=…` / `__default__`） */
  storageScope: string;
  /** 「未归属草稿」/「未归属草稿（项目 x）」 */
  label: string;
  counts: Record<AnnotationType, number>;
  total: number;
};

/**
 * 只读窥视某个作用域下容器里四类批注的条数：只读 V7 / V6 原文、不 normalize、不触发旧尺寸归档（那是有写副作用的）。
 * 容器不存在 / 坏 JSON → null。
 */
function peekPersistedAnnotationCounts(scope: string): Record<AnnotationType, number> | null {
  if (typeof localStorage === 'undefined') return null;
  for (const key of [STORAGE_KEY_V7, STORAGE_KEY_V6]) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(withStorageScope(key, scope));
    } catch {
      return null;
    }
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') return null;
      const count = (field: string): number => {
        const value = parsed[field];
        return Array.isArray(value) ? value.length : 0;
      };
      return {
        text: count('annotations'),
        cloud: count('cloudAnnotations'),
        rect: count('rectAnnotations'),
        obb: count('obbAnnotations'),
      };
    } catch {
      return null;
    }
  }
  return null;
}

const ANNOTATION_TYPE_TO_V7_FIELD: Record<AnnotationType, 'annotations' | 'cloudAnnotations' | 'rectAnnotations' | 'obbAnnotations'> = {
  text: 'annotations',
  cloud: 'cloudAnnotations',
  rect: 'rectAnnotations',
  obb: 'obbAnnotations',
};

/**
 * U0 迟到回执（方案 §3.6「A 任务截图上传返回时用户已在 B，只能归属 A」）：把一条 patch 写进**别的** scope 的本机 V7 容器里
 * 的某条批注（按 id 浅合并）。只读写原文、不 normalize、不碰内存。
 * 容器不存在 / 不是 V7 / 条目不存在 / 写失败 → false；`scope` 就是当前生效的作用域也 → false——当前作用域内存是权威，
 * 下一次刷盘会把容器盖回去，请走 `setAnnotationScreenshot` 等内存 API。
 */
function patchPersistedAnnotationInScope(
  scope: string,
  type: AnnotationType,
  id: string,
  patch: Record<string, unknown>,
): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (scope === storageScope.value) return false;
  const key = withStorageScope(STORAGE_KEY_V7, scope);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return false;
  }
  if (!raw) return false;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown> | null;
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 7) return false;
  const list = parsed[ANNOTATION_TYPE_TO_V7_FIELD[type]];
  if (!Array.isArray(list)) return false;
  const index = list.findIndex((item) => !!item && typeof item === 'object' && (item as { id?: unknown }).id === id);
  if (index < 0) return false;
  list[index] = { ...(list[index] as Record<string, unknown>), ...patch };
  try {
    localStorage.setItem(key, JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

function archiveLegacyDimensionsForScope(
  storage: StorageLike,
  scope: string,
  now: () => number = Date.now,
): void {
  const archiveKey = withStorageScope(LEGACY_DIMENSION_ARCHIVE_KEY, scope);
  const v5Result = archiveLegacyDimensions(storage, {
    sourceKey: withStorageScope(STORAGE_KEY_V5, scope),
    archiveKey,
    scope,
    now,
  });
  if (v5Result === 'created' || v5Result === 'exists') return;

  archiveLegacyDimensions(storage, {
    sourceKey: withStorageScope(STORAGE_KEY_V4, scope),
    archiveKey,
    scope,
    now,
  });
}

function archiveImportedLegacyDimensions(
  storage: StorageLike,
  raw: string,
  scope: string,
  now: () => number,
): void {
  let archivedAt = now();
  const parsed = parseLegacyDimensionArchive(raw, { scope, archivedAt });
  if (!parsed || parsed.records.length === 0) return;

  const archiveKeyPrefix = withStorageScope(LEGACY_DIMENSION_IMPORT_ARCHIVE_KEY, scope);
  let archiveKey = `${archiveKeyPrefix}:${archivedAt}`;
  while (storage.getItem(archiveKey) !== null) {
    archivedAt += 1;
    archiveKey = `${archiveKeyPrefix}:${archivedAt}`;
  }

  storage.setItem(archiveKey, JSON.stringify({
    ...parsed,
    archivedAt,
  }));
}

function archiveImportedLegacyDimensionBridge(
  storage: StorageLike,
  raw: string,
  scope: string,
  now: () => number,
): void {
  let archivedAt = now();
  const parsed = parseLegacyDimensionBridgeArchive(raw, { scope, archivedAt });
  if (!parsed || parsed.records.length === 0) return;

  const archiveKeyPrefix = withStorageScope(LEGACY_DIMENSION_BRIDGE_IMPORT_ARCHIVE_KEY, scope);
  let archiveKey = `${archiveKeyPrefix}:${archivedAt}`;
  while (storage.getItem(archiveKey) !== null) {
    archivedAt += 1;
    archiveKey = `${archiveKeyPrefix}:${archivedAt}`;
  }

  storage.setItem(archiveKey, JSON.stringify({
    ...parsed,
    archivedAt,
  }));
}

function archiveLegacyDimensionBridgeForScope(
  storage: StorageLike,
  scope: string,
  now: () => number = Date.now,
): void {
  archiveLegacyDimensionBridge(storage, {
    sourceKey: withStorageScope(STORAGE_KEY_V6, scope),
    archiveKey: withStorageScope(LEGACY_DIMENSION_BRIDGE_ARCHIVE_KEY, scope),
    scope,
    now,
  });
}

/**
 * 计算 text 类型批注在 Phase 1 兼容期的 `refno` / `refnos` 对齐值。
 *
 * 规则：
 * - 若两者都未提供，返回都为 undefined。
 * - 若只有 `refno`，`refnos` 镜像为 `[refno]`。
 * - 若只有 `refnos`，`refno` 镜像为 `refnos[0]`（若有）。
 * - 若两者都有，以 `refnos` 为准，`refno` 被重置为 `refnos[0]`，避免不一致。
 * - 空字符串/空数组都视为未设置。
 */
function reconcileAnnotationRefs(
  refno: string | undefined,
  refnos: string[] | undefined,
): { refno?: string; refnos?: string[] } {
  const cleanList = Array.isArray(refnos)
    ? refnos.filter((r): r is string => typeof r === 'string' && r.length > 0)
    : [];
  if (cleanList.length > 0) {
    return { refno: cleanList[0], refnos: cleanList };
  }
  if (typeof refno === 'string' && refno.length > 0) {
    return { refno, refnos: [refno] };
  }
  return { refno: undefined, refnos: undefined };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return normalizeOptionalString(value);
}

function normalizeMeasurementPointSourceInfo(value: unknown): MeasurementPointSourceInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<MeasurementPointSourceInfo>;
  if (
    raw.source !== 'mesh_pick_point' &&
    raw.source !== 'ptset' &&
    raw.source !== 'position' &&
    raw.source !== 'primitive_key_point' &&
    raw.source !== 'mesh_graphics' &&
    raw.source !== 'tubing_axis' &&
    raw.source !== 'design_aid' &&
    raw.source !== 'design_point'
  ) {
    return undefined;
  }
  return {
    source: raw.source,
    candidateId: normalizeOptionalString(raw.candidateId),
    refno: normalizeNullableString(raw.refno),
    label: normalizeNullableString(raw.label),
  };
}

function normalizeMeasurementPoint(point: MeasurementPoint): MeasurementPoint {
  return {
    ...point,
    sourceInfo: normalizeMeasurementPointSourceInfo(point.sourceInfo),
  };
}

function normalizeMeasurementRecord(rec: MeasurementRecord): MeasurementRecord {
  const base = {
    ...rec,
    sourceAnnotationId: normalizeOptionalString(rec.sourceAnnotationId),
    sourceAnnotationType: normalizeOptionalString(rec.sourceAnnotationType) as AnnotationType | undefined,
    formId: normalizeOptionalString(rec.formId),
    taskId: normalizeOptionalString(rec.taskId),
  };
  if (base.kind === 'distance') {
    return {
      ...base,
      origin: normalizeMeasurementPoint(base.origin),
      target: normalizeMeasurementPoint(base.target),
    };
  }
  if (base.kind === 'angle') {
    return {
      ...base,
      origin: normalizeMeasurementPoint(base.origin),
      corner: normalizeMeasurementPoint(base.corner),
      target: normalizeMeasurementPoint(base.target),
    };
  }
  if (base.kind === 'elevation_point') {
    return {
      ...base,
      point: normalizeMeasurementPoint(base.point),
    };
  }
  return {
    ...base,
    origin: normalizeMeasurementPoint(base.origin),
    target: normalizeMeasurementPoint(base.target),
  };
}

function normalizeXeokitMeasurementRecord<T extends XeokitMeasurementRecord>(rec: T): T {
  const base = {
    ...rec,
    sourceAnnotationId: normalizeOptionalString(rec.sourceAnnotationId),
    sourceAnnotationType: normalizeOptionalString(rec.sourceAnnotationType) as AnnotationType | undefined,
    formId: normalizeOptionalString(rec.formId),
    taskId: normalizeOptionalString(rec.taskId),
  };
  if (base.kind === 'distance') {
    return {
      ...base,
      origin: normalizeMeasurementPoint(base.origin),
      target: normalizeMeasurementPoint(base.target),
    } as T;
  }
  if (base.kind === 'angle') {
    return {
      ...base,
      origin: normalizeMeasurementPoint(base.origin),
      corner: normalizeMeasurementPoint(base.corner),
      target: normalizeMeasurementPoint(base.target),
    } as T;
  }
  if (base.kind === 'elevation_point') {
    return {
      ...base,
      point: normalizeMeasurementPoint(base.point),
    } as T;
  }
  return {
    ...base,
    origin: normalizeMeasurementPoint(base.origin),
    target: normalizeMeasurementPoint(base.target),
  } as T;
}

/**
 * 绑定列表的统一清洗：按 `refno + role` 去重、剔除空白 refno、多个 anchor 只留首个、
 * 缺 createdAt 用记录的 createdAt 兜底。四类批注的推导都汇到这里。
 */
function normalizeBindingList(
  source: readonly AnnotationElementBinding[],
  fallbackCreatedAt: number,
): AnnotationElementBinding[] {
  const seen = new Set<string>();
  const bindings: AnnotationElementBinding[] = [];
  let hasAnchor = false;
  for (const binding of source) {
    const refno = typeof binding?.refno === 'string' ? binding.refno.trim() : '';
    if (!refno) continue;
    const role: CloudBindingRole = binding.role === 'anchor' ? 'anchor' : 'member';
    if (role === 'anchor' && hasAnchor) continue;
    const key = `${refno}::${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (role === 'anchor') hasAnchor = true;
    const noun = typeof binding.noun === 'string' ? binding.noun.trim() : '';
    bindings.push({
      refno,
      role,
      ...(noun ? { noun } : {}),
      createdAt: typeof binding.createdAt === 'number' ? binding.createdAt : fallbackCreatedAt,
    });
  }
  return bindings;
}

function legacyMemberBindings(refnos: readonly string[] | undefined, createdAt: number): AnnotationElementBinding[] {
  return Array.isArray(refnos)
    ? refnos.map((refno) => ({ refno, role: 'member' as const, createdAt }))
    : [];
}

/**
 * 推导文字批注的 `bindings`（ADR-0049）。
 *
 * 有 `bindings` 数组就以它为准；缺失才由旧字段推导：`refno`（创建时点击命中的构件）
 * 同时写 anchor 与 member 两条（双角色），`refnos` 里其余的为 member。
 * 与 `deriveCloudBindings` 同一条「判字段在不在、不判数组空不空」的规则——空数组是「关联被删光」。
 */
export function deriveTextAnnotationBindings(rec: AnnotationRecord): AnnotationElementBinding[] {
  const fallbackCreatedAt = typeof rec.createdAt === 'number' ? rec.createdAt : 0;
  if (Array.isArray(rec.bindings)) return normalizeBindingList(rec.bindings, fallbackCreatedAt);
  const refs = reconcileAnnotationRefs(rec.refno, rec.refnos);
  return normalizeBindingList([
    ...(refs.refno ? [{ refno: refs.refno, role: 'anchor' as const, createdAt: fallbackCreatedAt }] : []),
    ...legacyMemberBindings(refs.refnos, fallbackCreatedAt),
  ], fallbackCreatedAt);
}

/**
 * 推导矩形 / OBB 批注的 `bindings`（ADR-0049）：`refnos`（兜底 `objectIds`）→ member。
 * 两者都可能由框选多个对象生成，没有稳定的单一锚点构件，因此不推导 anchor；
 * 显式写入的 anchor 绑定照常保留。
 */
export function deriveBoxAnnotationBindings(
  rec: Pick<RectAnnotationRecord, 'objectIds' | 'refnos' | 'bindings' | 'createdAt'>,
): AnnotationElementBinding[] {
  const fallbackCreatedAt = typeof rec.createdAt === 'number' ? rec.createdAt : 0;
  if (Array.isArray(rec.bindings)) return normalizeBindingList(rec.bindings, fallbackCreatedAt);
  const legacyMembers = Array.isArray(rec.refnos) && rec.refnos.length > 0 ? rec.refnos : rec.objectIds;
  return normalizeBindingList(legacyMemberBindings(legacyMembers, fallbackCreatedAt), fallbackCreatedAt);
}

/** 任意类型批注的 `bindings`（读取后恒存在的那份，含推导）。 */
export function deriveAnnotationBindings(
  type: AnnotationType,
  record: AnyAnnotationRecord,
): AnnotationElementBinding[] {
  switch (type) {
    case 'text':
      return deriveTextAnnotationBindings(record as AnnotationRecord);
    case 'cloud':
      return deriveCloudBindings(record as CloudAnnotationRecord);
    case 'rect':
      return deriveBoxAnnotationBindings(record as RectAnnotationRecord);
    case 'obb':
      return deriveBoxAnnotationBindings(record as ObbAnnotationRecord);
  }
}

/** 任意类型批注的问题目标元素 refno 列表（不含仅作视觉参考中心的锚点）。 */
export function getAnnotationMemberRefnos(type: AnnotationType, record: AnyAnnotationRecord): string[] {
  return deriveAnnotationBindings(type, record)
    .filter((binding) => binding.role === 'member')
    .map((binding) => binding.refno);
}

/** 任意类型批注的锚点构件 refno（没有则 undefined）。 */
export function getAnnotationAnchorRefno(type: AnnotationType, record: AnyAnnotationRecord): string | undefined {
  return deriveAnnotationBindings(type, record).find((binding) => binding.role === 'anchor')?.refno;
}

/**
 * 根据模型元素反查关联批注（任意类型）；锚点不属于问题关联元素（ADR-0049）。
 * 云线专用的 `findCloudAnnotationsByMemberRefnos` 是它的特化。
 */
export function findAnnotationsByMemberRefnos<T extends AnyAnnotationRecord>(
  type: AnnotationType,
  annotations: readonly T[],
  refnos: readonly string[],
): T[] {
  const selected = new Set(refnos.map((refno) => refno.trim()).filter(Boolean));
  if (selected.size === 0) return [];
  return annotations.filter((annotation) =>
    getAnnotationMemberRefnos(type, annotation).some((refno) => selected.has(refno)));
}

function normalizeAnnotationRecord(rec: AnnotationRecord): AnnotationRecord {
  const bindings = deriveTextAnnotationBindings(rec);
  const memberRefnos = bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno);
  const anchorRefno = bindings.find((binding) => binding.role === 'anchor')?.refno;
  // 旧字段双写：`refnos` = member 集合（只看 member，锚点不算关联）；
  // deprecated 的单字段 `refno` 指锚点构件，没有锚点时退到首个 member。
  return {
    ...rec,
    labelWorldPos: Array.isArray(rec.labelWorldPos) && rec.labelWorldPos.length === 3 ? rec.labelWorldPos : undefined,
    collapsed: rec.collapsed === true,
    reviewState: normalizeAnnotationReviewState(rec.reviewState),
    severity: normalizeAnnotationSeverity(rec.severity),
    refno: anchorRefno ?? memberRefnos[0],
    refnos: memberRefnos.length > 0 ? memberRefnos : undefined,
    bindings,
    screenshot: normalizeAnnotationScreenshot(rec.screenshot),
  };
}

/**
 * 统一读取任意批注类型的关联 refnos，供消费代码（面板/交互）无差别使用。
 * - text 批注：优先用 `refnos`，缺失时从 `refno` 单字段推导。
 * - cloud/rect/obb 批注：返回 `refnos`（可能为空）。
 */
export function getAnnotationRefnos(record: {
  refno?: string;
  refnos?: string[];
}): string[] {
  if (Array.isArray(record.refnos) && record.refnos.length > 0) {
    return [...record.refnos];
  }
  if (typeof record.refno === 'string' && record.refno.length > 0) {
    return [record.refno];
  }
  return [];
}

function normalizeObbAnnotationRecord(rec: ObbAnnotationRecord): ObbAnnotationRecord {
  const bindings = deriveBoxAnnotationBindings(rec);
  const memberRefnos = bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno);
  // 共享范围体（P3）：`regionV1` 缺失 → 由 `obb` 派生 legacy-snapshot；显式 null 保留；旧记录不自动迁移
  return fillBoxAnnotationRegionDefault({
    ...rec,
    // 与云线同一口径：`objectIds` / `refnos` 都是 member 集合的旧字段投影（创建时二者本就同为 refno）。
    objectIds: memberRefnos,
    refnos: memberRefnos,
    bindings,
    collapsed: rec.collapsed === true,
    reviewState: normalizeAnnotationReviewState(rec.reviewState),
    severity: normalizeAnnotationSeverity(rec.severity),
    screenshot: normalizeAnnotationScreenshot(rec.screenshot),
  });
}

/**
 * 推导云线的 `bindings`。
 *
 * `bindings` 是数组就一律以它为准（按 `refno + role` 去重）；**字段缺失**才由旧字段推导——
 * `anchorRefno` → `role='anchor'`，`refnos[]` → `role='member'`。
 *
 * 判据是「字段在不在」而不是「数组空不空」：空数组是「关联被删光了」这一真实状态，
 * 若把它也当成旧记录回退，`normalizeCloudAnnotationRecord` 又会把 refnos 投影回来，
 * 删最后一个绑定就会被旧字段复活、永远删不空。
 *
 * 这是全部恢复链路的唯一入口：localStorage 各版本分支、以及
 * task_records / workflow_sync / import_package 三条校审链路
 * 都经 `normalizeCloudAnnotationRecord` 汇入此处，因此无需升级持久化容器版本。
 */
export function deriveCloudBindings(rec: CloudAnnotationRecord): CloudElementBinding[] {
  const fallbackCreatedAt = typeof rec.createdAt === 'number' ? rec.createdAt : 0;
  if (Array.isArray(rec.bindings)) return normalizeBindingList(rec.bindings, fallbackCreatedAt);
  const legacyMembers = Array.isArray(rec.refnos) && rec.refnos.length > 0
    ? rec.refnos
    : rec.objectIds;
  return normalizeBindingList([
    ...(rec.anchorRefno
      ? [{ refno: rec.anchorRefno, role: 'anchor' as const, createdAt: fallbackCreatedAt }]
      : []),
    ...legacyMemberBindings(legacyMembers, fallbackCreatedAt),
  ], fallbackCreatedAt);
}

/**
 * 由目标元素集合与锚点组装 `bindings`（锚点在前，目标按给定顺序）。
 *
 * `nounOf` 由调用方注入，避免 store 依赖模型查询能力。
 */
export function buildCloudBindings(params: {
  memberRefnos: string[];
  anchorRefno?: string;
  createdAt: number;
  nounOf?: (refno: string) => string | undefined;
}): CloudElementBinding[] {
  const { memberRefnos, anchorRefno, createdAt, nounOf } = params;
  const withNoun = (refno: string, role: CloudBindingRole): CloudElementBinding => {
    const noun = nounOf?.(refno);
    return noun ? { refno, role, noun, createdAt } : { refno, role, createdAt };
  };
  return deriveCloudBindings({
    createdAt,
    bindings: [
      ...(anchorRefno ? [withNoun(anchorRefno, 'anchor')] : []),
      ...memberRefnos.map((refno) => withNoun(refno, 'member')),
    ],
  } as CloudAnnotationRecord);
}

/** 云线的目标元素 refno 列表（不含仅作视觉参考中心的锚点）。 */
export function getCloudMemberRefnos(rec: CloudAnnotationRecord): string[] {
  return deriveCloudBindings(rec)
    .filter((binding) => binding.role === 'member')
    .map((binding) => binding.refno);
}

/** 根据模型元素反查关联云线；锚点不属于问题关联元素。 */
export function findCloudAnnotationsByMemberRefnos(
  annotations: CloudAnnotationRecord[],
  refnos: string[],
): CloudAnnotationRecord[] {
  const selected = new Set(refnos.map((refno) => refno.trim()).filter(Boolean));
  if (selected.size === 0) return [];
  return annotations.filter((annotation) =>
    getCloudMemberRefnos(annotation).some((refno) => selected.has(refno)));
}

function normalizeCloudAnnotationRecord(rec: CloudAnnotationRecord): CloudAnnotationRecord {
  const bindings = deriveCloudBindings(rec);
  const memberRefnos = bindings
    .filter((binding) => binding.role === 'member')
    .map((binding) => binding.refno);
  const anchorRefno = bindings.find((binding) => binding.role === 'anchor')?.refno;
  // 空间范围体四字段（regionV1 / presentationV1 / viewpointV1 / labelLayoutV1）在这同一个漏斗里补默认值：
  // 字段缺失才补，显式 null 保留；旧记录一律 `legacy-v0`，渲染照旧。
  return fillCloudRegionFieldDefaults({
    ...rec,
    objectIds: memberRefnos,
    anchorRefno,
    refnos: memberRefnos,
    collapsed: rec.collapsed === true,
    reviewState: normalizeAnnotationReviewState(rec.reviewState),
    severity: normalizeAnnotationSeverity(rec.severity),
    screenshot: normalizeAnnotationScreenshot(rec.screenshot),
    bindings,
  });
}

function normalizeRectAnnotationRecord(rec: RectAnnotationRecord): RectAnnotationRecord {
  const bindings = deriveBoxAnnotationBindings(rec);
  const memberRefnos = bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno);
  // 共享范围体（P3）：`regionV1` 缺失 → 由 `obb` 派生 legacy-snapshot；显式 null 保留；旧记录不自动迁移
  return fillBoxAnnotationRegionDefault({
    ...rec,
    // 与云线同一口径：`objectIds` / `refnos` 都是 member 集合的旧字段投影（创建时二者本就同为 refno）。
    objectIds: memberRefnos,
    refnos: memberRefnos,
    bindings,
    collapsed: rec.collapsed === true,
    reviewState: normalizeAnnotationReviewState(rec.reviewState),
    severity: normalizeAnnotationSeverity(rec.severity),
    screenshot: normalizeAnnotationScreenshot(rec.screenshot),
  });
}

function normalizeV1(parsed: PersistedStateV1): PersistedStateV6 {
  return {
    version: 6,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
    xeokitElevationPointMeasurements: [],
    xeokitElevationDeltaMeasurements: [],
  };
}

function normalizeV2(parsed: PersistedStateV2): PersistedStateV6 {
  return {
    version: 6,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations.map(normalizeObbAnnotationRecord) : [],
    cloudAnnotations: [],
    rectAnnotations: [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
    xeokitElevationPointMeasurements: [],
    xeokitElevationDeltaMeasurements: [],
  };
}

function normalizeV3(parsed: PersistedStateV3): PersistedStateV6 {
  return {
    version: 6,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations.map(normalizeObbAnnotationRecord) : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations.map(normalizeCloudAnnotationRecord) : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations.map(normalizeRectAnnotationRecord) : [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
    xeokitElevationPointMeasurements: [],
    xeokitElevationDeltaMeasurements: [],
  };
}

function normalizeV4(parsed: PersistedStateV4): PersistedStateV6 {
  return {
    version: 6,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations.map(normalizeObbAnnotationRecord) : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations.map(normalizeCloudAnnotationRecord) : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations.map(normalizeRectAnnotationRecord) : [],
    xeokitDistanceMeasurements: [],
    xeokitAngleMeasurements: [],
    xeokitElevationPointMeasurements: [],
    xeokitElevationDeltaMeasurements: [],
  };
}

function normalizeV5(parsed: PersistedStateV5): PersistedStateV6 {
  return {
    version: 6,
    measurements: Array.isArray(parsed.measurements) ? parsed.measurements : [],
    annotations: Array.isArray(parsed.annotations) ? parsed.annotations.map(normalizeAnnotationRecord) : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations) ? parsed.obbAnnotations.map(normalizeObbAnnotationRecord) : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations) ? parsed.cloudAnnotations.map(normalizeCloudAnnotationRecord) : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations) ? parsed.rectAnnotations.map(normalizeRectAnnotationRecord) : [],
    xeokitDistanceMeasurements: Array.isArray(parsed.xeokitDistanceMeasurements)
      ? parsed.xeokitDistanceMeasurements
      : [],
    xeokitAngleMeasurements: Array.isArray(parsed.xeokitAngleMeasurements)
      ? parsed.xeokitAngleMeasurements
      : [],
    xeokitElevationPointMeasurements: Array.isArray(parsed.xeokitElevationPointMeasurements)
      ? parsed.xeokitElevationPointMeasurements
      : [],
    xeokitElevationDeltaMeasurements: Array.isArray(parsed.xeokitElevationDeltaMeasurements)
      ? parsed.xeokitElevationDeltaMeasurements
      : [],
  };
}

function normalizeV6Bridge(parsed: PersistedStateV6Bridge): PersistedStateV6 {
  return normalizeV5({
    ...parsed,
    version: 5,
    dimensions: [],
  });
}

function migrateV6StateToV7(state: PersistedStateV6): PersistedStateV7 {
  const measurements: UnifiedMeasurementRecord[] = [];
  const legacyMeasurements: unknown[] = [];
  const append = (
    items: readonly unknown[],
    convert: (value: unknown) => UnifiedMeasurementRecord,
  ) => {
    for (const raw of items) {
      try {
        const record = convert(raw);
        if (isUnifiedMeasurementRecord(record)) {
          measurements.push(normalizeUnifiedMeasurementRecord(record));
        } else {
          legacyMeasurements.push(raw);
        }
      } catch {
        legacyMeasurements.push(raw);
      }
    }
  };
  append(
    Array.isArray(state.measurements) ? state.measurements : [],
    value => fromClassicMeasurement(
      normalizeMeasurementRecord(value as MeasurementRecord),
    ),
  );
  append(
    [
      ...(Array.isArray(state.xeokitDistanceMeasurements)
        ? state.xeokitDistanceMeasurements
        : []),
      ...(Array.isArray(state.xeokitAngleMeasurements)
        ? state.xeokitAngleMeasurements
        : []),
      ...(Array.isArray(state.xeokitElevationPointMeasurements)
        ? state.xeokitElevationPointMeasurements
        : []),
      ...(Array.isArray(state.xeokitElevationDeltaMeasurements)
        ? state.xeokitElevationDeltaMeasurements
        : []),
    ],
    value => fromXeokitMeasurement(
      normalizeXeokitMeasurementRecord(value as XeokitMeasurementRecord),
    ),
  );
  return {
    version: 7,
    measurements,
    legacyMeasurements,
    annotations: state.annotations,
    obbAnnotations: state.obbAnnotations,
    cloudAnnotations: state.cloudAnnotations,
    rectAnnotations: state.rectAnnotations,
  };
}

function normalizeV7(parsed: PersistedStateV7): PersistedStateV7 {
  const measurements: UnifiedMeasurementRecord[] = [];
  const legacyMeasurements = Array.isArray(parsed.legacyMeasurements)
    ? [...parsed.legacyMeasurements]
    : [];
  for (const raw of Array.isArray(parsed.measurements) ? parsed.measurements : []) {
    if (isUnifiedMeasurementRecord(raw)) {
      measurements.push(normalizeUnifiedMeasurementRecord(raw));
    } else {
      legacyMeasurements.push(raw);
    }
  }
  return {
    version: 7,
    measurements,
    legacyMeasurements,
    annotations: Array.isArray(parsed.annotations)
      ? parsed.annotations.map(normalizeAnnotationRecord)
      : [],
    obbAnnotations: Array.isArray(parsed.obbAnnotations)
      ? parsed.obbAnnotations.map(normalizeObbAnnotationRecord)
      : [],
    cloudAnnotations: Array.isArray(parsed.cloudAnnotations)
      ? parsed.cloudAnnotations.map(normalizeCloudAnnotationRecord)
      : [],
    rectAnnotations: Array.isArray(parsed.rectAnnotations)
      ? parsed.rectAnnotations.map(normalizeRectAnnotationRecord)
      : [],
  };
}

function emptyPersistedStateV7(): PersistedStateV7 {
  return {
    version: 7,
    measurements: [],
    legacyMeasurements: [],
    annotations: [],
    obbAnnotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
  };
}

function loadPersisted(scope = getCurrentStorageScope()): PersistedStateV7 {
  if (typeof localStorage === 'undefined') {
    return emptyPersistedStateV7();
  }

  try {
    archiveLegacyDimensionsForScope(localStorage, scope);
    archiveLegacyDimensionBridgeForScope(localStorage, scope);
  } catch {
    // Keep loading available; the V7 write path retries legacy archiving.
  }

  try {
    const rawV7 = localStorage.getItem(withStorageScope(STORAGE_KEY_V7, scope));
    if (rawV7) {
      const parsed = JSON.parse(rawV7) as PersistedStateV7;
      if (parsed && parsed.version === 7) {
        return normalizeV7(parsed);
      }
    }

    const rawV6 = localStorage.getItem(withStorageScope(STORAGE_KEY_V6, scope));
    if (rawV6) {
      const parsed = JSON.parse(rawV6) as PersistedStateV6Bridge;
      if (parsed && parsed.version === 6) {
        return migrateV6StateToV7(normalizeV6Bridge(parsed));
      }
    }

    const rawV5 = localStorage.getItem(withStorageScope(STORAGE_KEY_V5, scope));
    if (rawV5) {
      const parsed = JSON.parse(rawV5) as PersistedStateV5;
      if (parsed && parsed.version === 5) {
        return migrateV6StateToV7(normalizeV5(parsed));
      }
    }

    const rawV4 = localStorage.getItem(withStorageScope(STORAGE_KEY_V4, scope));
    if (rawV4) {
      const parsed = JSON.parse(rawV4) as PersistedStateV4;
      if (parsed && parsed.version === 4) {
        return migrateV6StateToV7(normalizeV4(parsed));
      }
    }

    const rawV3 = localStorage.getItem(withStorageScope(STORAGE_KEY_V3, scope));
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as PersistedStateV3;
      if (parsed && parsed.version === 3) {
        return migrateV6StateToV7(normalizeV3(parsed));
      }
    }

    const rawV2 = localStorage.getItem(withStorageScope(STORAGE_KEY_V2, scope));
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as PersistedStateV2;
      if (parsed && parsed.version === 2) {
        return migrateV6StateToV7(normalizeV2(parsed));
      }
    }

    const rawV1 = localStorage.getItem(withStorageScope(STORAGE_KEY_V1, scope));
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as PersistedStateV1;
      if (parsed && parsed.version === 1) {
        return migrateV6StateToV7(normalizeV1(parsed));
      }
    }
  } catch {
    // ignore
  }

  return emptyPersistedStateV7();
}

const storageScope = ref(resolveStorageScope());
const persisted = loadPersisted(storageScope.value);

/**
 * 全部测量的唯一真相（统一计划 Phase B2）。
 *
 * classic 与四路 xeokit 曾经是五个各自独立的 ref，每个增删改都要在五处扇出，
 * 高程两路就是这么被漏在 `combineMeasurements` 外面的。现在写入只有这一个数组，
 * 下面五个旧字段降级为只读投影——生产代码里没有任何一处从外部给它们赋值
 * （核查过：唯一的外部赋值都在测试对 store mock 的操作上），所以降级是安全的。
 *
 * V7 直接持久化这个统一数组；下面五个旧字段只服务兼容调用者。
 */
const unifiedMeasurementRecords = ref<UnifiedMeasurementRecord[]>(persisted.measurements);
const legacyMeasurementPayloads = ref<unknown[]>(persisted.legacyMeasurements);

function projectClassic(): MeasurementRecord[] {
  return unifiedMeasurementRecords.value
    .filter((rec) => rec.source === 'classic')
    .map(toClassicMeasurement);
}

/** `replay` 与 `xeokit` 一样走 xeokit 侧投影（回放本来就归一化成 xeokit 形态）。 */
function projectXeokit<K extends UnifiedMeasurementRecord['kind']>(kind: K) {
  return unifiedMeasurementRecords.value
    .filter((rec) => rec.source !== 'classic' && rec.kind === kind)
    .map(toXeokitMeasurement);
}

const measurements = computed<MeasurementRecord[]>(projectClassic);
const annotations = ref<AnnotationRecord[]>(persisted.annotations);
const obbAnnotations = ref<ObbAnnotationRecord[]>(persisted.obbAnnotations);
const cloudAnnotations = ref<CloudAnnotationRecord[]>(persisted.cloudAnnotations);
const rectAnnotations = ref<RectAnnotationRecord[]>(persisted.rectAnnotations);
const xeokitDistanceMeasurements = computed<XeokitDistanceMeasurementRecord[]>(
  () => projectXeokit('distance') as XeokitDistanceMeasurementRecord[],
);
const xeokitAngleMeasurements = computed<XeokitAngleMeasurementRecord[]>(
  () => projectXeokit('angle') as XeokitAngleMeasurementRecord[],
);
const xeokitElevationPointMeasurements = computed<XeokitElevationPointMeasurementRecord[]>(
  () => projectXeokit('elevation_point') as XeokitElevationPointMeasurementRecord[],
);
const xeokitElevationDeltaMeasurements = computed<XeokitElevationDeltaMeasurementRecord[]>(
  () => projectXeokit('elevation_delta') as XeokitElevationDeltaMeasurementRecord[],
);

function setAllMeasurementsFrom(state: PersistedStateV7) {
  unifiedMeasurementRecords.value = state.measurements.map(
    normalizeUnifiedMeasurementRecord,
  );
  legacyMeasurementPayloads.value = [...state.legacyMeasurements];
}

/** 按 id 就地替换一条统一记录；`patch` 已是目标形态的部分字段。 */
function patchUnifiedMeasurement(
  id: string,
  patch: (rec: UnifiedMeasurementRecord) => UnifiedMeasurementRecord,
): boolean {
  let hit = false;
  unifiedMeasurementRecords.value = unifiedMeasurementRecords.value.map((rec) => {
    if (rec.id !== id) return rec;
    hit = true;
    return patch(rec);
  });
  return hit;
}

const activeTab = ref<'tree' | 'measurement' | 'annotation' | 'obb_annotation' | 'manager' | 'properties'>('tree');
const toolMode = ref<ToolMode>('none');

// Attribute display state
const attributeDisplayMode = ref<AttributeDisplayMode>('all');
const compareMode = ref<boolean>(false);

const activeAnnotationId = ref<string | null>(null);
const activeObbAnnotationId = ref<string | null>(null);
const activeCloudAnnotationId = ref<string | null>(null);
const activeRectAnnotationId = ref<string | null>(null);
const activeMeasurementId = ref<string | null>(null);
const activeXeokitMeasurementId = ref<string | null>(null);
const measurementDetailsDrawerOpen = ref(false);

const pickedQueryCenter = ref<PickedQueryCenter | null>(null);

// Ptset 可视化请求
const ptsetVisualizationRequest = ref<PtsetVisualizationRequest | null>(null);

// ── 通用 refno 拾取模式 ──
const pickRefnoFilter = ref<string[]>([]);       // noun 过滤列表（如 ['BRAN']），空=不过滤
const pickedRefnos = ref<string[]>([]);           // 已拾取的 refno 列表
const pickRefnoCallback = ref<((refnos: string[]) => void) | null>(null); // 确认回调
const pickRefnoCancelCallback = ref<(() => void) | null>(null); // 取消回调

/**
 * 云线创建的目标元素集合。绘制前必须非空——闸门在 `useDtxTools.beginMarquee`，
 * 覆盖批注面板 / 浮动工具条 / 校审工作台 / 校审面板四个工具入口。
 * 生命周期由 useDtxTools 的创建状态机负责，setToolMode 不自动清理。
 */
const cloudTargetRefnos = ref<string[]>([]);
/** 云线关联时点选/框选的选择粒度；默认元件级，可切换为分支级。 */
const cloudTargetLevel = ref<CloudTargetLevel>('element');
/** 批注浮层（AnnotationOverlayBar）当前是否可见；ViewerPanel 据此把“待保存证据”停靠进浮层栈，避免多浮层重叠。 */
const annotationOverlayVisible = ref(false);

const pendingObbEditId = ref<string | null>(null);
const pendingTextAnnotationEditId = ref<string | null>(null);
const pendingCloudAnnotationEditId = ref<string | null>(null);
const pendingRectAnnotationEditId = ref<string | null>(null);

const currentXeokitDistanceDraft = ref<XeokitDistanceDraft | null>(null);
const currentXeokitAngleDraft = ref<XeokitAngleDraft | null>(null);
const currentXeokitElevationPointDraft = ref<XeokitElevationPointDraft | null>(null);
const currentXeokitElevationDeltaDraft = ref<XeokitElevationDeltaDraft | null>(null);
/** 最近一次完成的测量临时结果（Result Inspector 数据源）。 */
const measurementDraftResult = ref<MeasurementDraftResult | null>(null);
/** E3D 风格连续距离测量：完成 A-B 后自动以 B 为起点继续下一段。 */
const continuousDistanceMeasureEnabled = ref(false);
const xeokitHoverState = ref<XeokitHoverState>({
  visible: false,
  snapped: false,
  entityId: null,
  objectId: null,
  worldPos: null,
  canvasPos: null,
});
const xeokitMarkerState = ref<XeokitMarkerState>({
  visible: false,
  snapped: false,
  role: 'hover',
  worldPos: null,
  canvasPos: null,
});
const xeokitPointerLensState = ref<XeokitPointerLensState>({
  visible: false,
  snapped: false,
  title: '',
  subtitle: '',
  canvasPos: null,
});

function resetTransientUiState() {
  activeAnnotationId.value = null;
  activeObbAnnotationId.value = null;
  activeCloudAnnotationId.value = null;
  activeRectAnnotationId.value = null;
  activeMeasurementId.value = null;
  activeXeokitMeasurementId.value = null;
  measurementDetailsDrawerOpen.value = false;
  pickedQueryCenter.value = null;
  pickRefnoFilter.value = [];
  pickedRefnos.value = [];
  pickRefnoCallback.value = null;
  pickRefnoCancelCallback.value = null;
  cloudTargetRefnos.value = [];
  cloudTargetLevel.value = 'element';
  pendingObbEditId.value = null;
  pendingTextAnnotationEditId.value = null;
  pendingCloudAnnotationEditId.value = null;
  pendingRectAnnotationEditId.value = null;
  currentXeokitDistanceDraft.value = null;
  currentXeokitAngleDraft.value = null;
  currentXeokitElevationPointDraft.value = null;
  currentXeokitElevationDeltaDraft.value = null;
  measurementDraftResult.value = null;
  xeokitHoverState.value = {
    visible: false,
    snapped: false,
    entityId: null,
    objectId: null,
    worldPos: null,
    canvasPos: null,
  };
  xeokitMarkerState.value = {
    visible: false,
    snapped: false,
    role: 'hover',
    worldPos: null,
    canvasPos: null,
  };
  xeokitPointerLensState.value = {
    visible: false,
    snapped: false,
    title: '',
    subtitle: '',
    canvasPos: null,
  };
  toolMode.value = 'none';
}

function applyPersistedState(state: PersistedStateV7) {
  annotations.value = state.annotations;
  obbAnnotations.value = state.obbAnnotations;
  cloudAnnotations.value = state.cloudAnnotations;
  rectAnnotations.value = state.rectAnnotations;
  setAllMeasurementsFrom(state);
  resetTransientUiState();
}

export type RefreshToolStorePersistedScopeOptions = { force?: boolean };

/**
 * 按当前 URL / setCurrentProjectPath 解析出的作用域，从 localStorage 载入工具状态。
 * - 默认：仅当作用域字符串变化时重载（避免无谓覆盖）。
 * - force：项目切换或 applyProject 后应强制重载，避免仍停留在 __default__ 等错误 key 下的内存状态。
 */
export function refreshToolStorePersistedScope(opts?: RefreshToolStorePersistedScopeOptions) {
  if (typeof window === 'undefined') return;
  const nextScope = resolveStorageScope();
  if (!opts?.force && nextScope === storageScope.value) return;
  if (nextScope !== storageScope.value) {
    // 换容器前先把内存里的状态刷进旧 key：deep watch 是异步刷的，同一 tick 里的最后一笔编辑还没落盘，
    // 不刷的话它会跟着 applyPersistedState 之后的那次 watch 写进新 key——A 的草稿进了 B 的容器。
    recordAnnotationDraftPersistOutcome(storageScope.value, writePersistedSnapshot(storageScope.value));
  }
  storageScope.value = nextScope;
  applyPersistedState(loadPersisted(nextScope));
}

function refreshPersistedScope() {
  refreshToolStorePersistedScope();
}

/**
 * 设定批注草稿 scope（U0）。同一 scope 幂等返回 false；变了就切容器（旧 key 先刷盘、再从新 key 载入）并返回 true。
 * 传 null = 离开校审任务上下文，回到旧 `project=…|db=…` 作用域。
 * 开关 `annotationUx.scopedDraftsV1` 关着时只记不生效（key 不变），开回来那一刻 `refreshToolStorePersistedScope` 会接上。
 */
function setAnnotationDraftScope(scope: AnnotationScope | null): boolean {
  if (isSameAnnotationScope(annotationDraftScope.value, scope)) return false;
  annotationDraftScope.value = scope;
  refreshToolStorePersistedScope();
  return true;
}

function getAnnotationDraftScope(): AnnotationScope | null {
  return annotationDraftScope.value;
}

/**
 * 旧 `project=…|db=…` 容器里还躺着的批注条数（scope 生效期间只读、不导入）。
 * 不在 scope 里 / 开关关 / 旧容器没有批注 → null（面板不出提示）。
 */
function getUnattributedDraftSummary(): UnattributedDraftSummary | null {
  if (!annotationDraftScope.value || !isScopedDraftsEnabled()) return null;
  const legacyScope = getCurrentStorageScope();
  const counts = peekPersistedAnnotationCounts(legacyScope);
  if (!counts) return null;
  const total = counts.text + counts.cloud + counts.rect + counts.obb;
  if (total === 0) return null;
  return {
    storageScope: legacyScope,
    label: describeUnattributedDraft(parseLegacyStorageScope(legacyScope)),
    counts,
    total,
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', refreshPersistedScope);
  window.addEventListener('modelProjectChanged', refreshPersistedScope as EventListener);
}

export type PersistedSnapshotWriteOutcome = { ok: true } | { ok: false; error: string };

/** 把当前内存状态整份写进 `scope` 作用域的 V7 容器（deep watch 与切 scope 前的刷盘共用）；写没写成如实回报，不吞 */
function writePersistedSnapshot(scope: string): PersistedSnapshotWriteOutcome {
  if (typeof localStorage === 'undefined') return { ok: false, error: '本机存储不可用' };
  const payload: PersistedStateV7 = {
    version: 7,
    measurements: unifiedMeasurementRecords.value,
    legacyMeasurements: legacyMeasurementPayloads.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
  };
  try {
    archiveLegacyDimensionsForScope(localStorage, scope);
    archiveLegacyDimensionBridgeForScope(localStorage, scope);
    localStorage.setItem(withStorageScope(STORAGE_KEY_V7, scope), JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// U0 本机草稿流水（方案 2026-09-14 §3.6「本机草稿」那一行的事实来源）
//
// `revision`：四类批注数组每变一次 +1（用户编辑、程序性载入 / 导入 / 清空都算——它记的是「容器内容变了几次」，
// 不判断是谁改的）；`persistedRevision`：最近一次成功写进本机容器时的 revision；`failedRevision / error`：最近一次
// 写失败（配额满、存储被禁用）时的 revision 与原因，成功写入后清掉。接线层（useAnnotationDraftScopeSync）
// 把它派发成草稿会话的 edit / local-persisted / local-persist-failed，面板据此显示「本机已存 / 未存 / 写入失败」，
// 不再把「localStorage 写了」当成「已保存」。
// ---------------------------------------------------------------------------

export type AnnotationDraftJournal = {
  revision: number;
  persistedRevision: number;
  failedRevision: number | null;
  error: string | null;
  /** 最近一次写入（成功或失败）针对的作用域字串 */
  storageScope: string;
  at: number;
};

const annotationDraftJournal = shallowRef<AnnotationDraftJournal>({
  revision: 0,
  persistedRevision: 0,
  failedRevision: null,
  error: null,
  storageScope: '',
  at: 0,
});

function recordAnnotationDraftPersistOutcome(scope: string, outcome: PersistedSnapshotWriteOutcome): void {
  const prev = annotationDraftJournal.value;
  annotationDraftJournal.value = outcome.ok
    ? { ...prev, persistedRevision: prev.revision, failedRevision: null, error: null, storageScope: scope, at: Date.now() }
    : { ...prev, failedRevision: prev.revision, error: outcome.error, storageScope: scope, at: Date.now() };
}

// 先于下面的刷盘 watch 注册：同一次 flush 里先记「内容变了」，再记「写进去了」。
watch(
  () => [annotations.value, obbAnnotations.value, cloudAnnotations.value, rectAnnotations.value],
  () => {
    const prev = annotationDraftJournal.value;
    annotationDraftJournal.value = { ...prev, revision: prev.revision + 1, at: Date.now() };
  },
  { deep: true }
);

watch(
  () => ({
    measurements: unifiedMeasurementRecords.value,
    legacyMeasurements: legacyMeasurementPayloads.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
  }),
  () => {
    recordAnnotationDraftPersistOutcome(storageScope.value, writePersistedSnapshot(storageScope.value));
  },
  { deep: true }
);

function setToolMode(mode: ToolMode) {
  // 离开 Xeokit 测量模式时丢弃未完成的预览草稿，避免场景里残留“幽灵测量线”，
  // 而测量面板（非 Xeokit 模式下列的是 DTX 经典 measurements）显示 0 条。
  if (
    mode !== 'xeokit_measure_distance' &&
    mode !== 'xeokit_measure_angle' &&
    mode !== 'xeokit_measure_elevation_point' &&
    mode !== 'xeokit_measure_elevation_delta'
  ) {
    clearCurrentXeokitDraft();
  }
  toolMode.value = mode;
  // 退出 pick_refno / pick_refno_box 时清理状态
  if (mode !== 'pick_refno' && mode !== 'pick_refno_box') {
    pickRefnoFilter.value = [];
    pickRefnoCallback.value = null;
    pickRefnoCancelCallback.value = null;
    // 注意：pickedRefnos 不在此处清理，由调用方决定
  }
}

/**
 * 启动通用 refno 拾取模式
 * @param nounFilter noun 类型过滤数组（如 ['BRAN']），空数组=不过滤
 * @param onConfirm  用户按 Enter 确认后的回调
 */
function startPickRefno(
  nounFilter: string[],
  onConfirm?: (refnos: string[]) => void,
  onCancel?: () => void,
) {
  pickedRefnos.value = [];
  pickRefnoFilter.value = nounFilter.map(n => n.toUpperCase());
  pickRefnoCallback.value = onConfirm ?? null;
  pickRefnoCancelCallback.value = onCancel ?? null;
  toolMode.value = 'pick_refno';
}

/**
 * 启动框选 refno 拾取模式（marquee box select）
 *
 * 与 `startPickRefno` 共享 pickRefnoFilter / pickedRefnos / pickRefnoCallback
 * 三件状态；用户拖框结束后 useDtxTools 会在 marquee end 时按 nounFilter 过滤
 * box 内 refnos，append 到 pickedRefnos 并自动调用 confirmPickRefno。
 *
 * @param nounFilter noun 类型过滤数组（如 ['BRAN']），空数组=不过滤
 * @param onConfirm  框选完成后的回调
 */
function startBoxPickRefno(
  nounFilter: string[],
  onConfirm?: (refnos: string[]) => void,
  onCancel?: () => void,
) {
  pickedRefnos.value = [];
  pickRefnoFilter.value = nounFilter.map(n => n.toUpperCase());
  pickRefnoCallback.value = onConfirm ?? null;
  pickRefnoCancelCallback.value = onCancel ?? null;
  toolMode.value = 'pick_refno_box';
}

function addPickedRefno(refno: string) {
  if (!pickedRefnos.value.includes(refno)) {
    pickedRefnos.value = [...pickedRefnos.value, refno];
  }
}

function removePickedRefno(refno: string) {
  pickedRefnos.value = pickedRefnos.value.filter(r => r !== refno);
}

function confirmPickRefno() {
  const cb = pickRefnoCallback.value;
  const result = [...pickedRefnos.value];
  setToolMode('none');
  cb?.(result);
}

function cancelPickRefno() {
  const cb = pickRefnoCancelCallback.value;
  pickedRefnos.value = [];
  setToolMode('none');
  cb?.();
}

// ── 云线目标元素集合 ──

function addCloudTargetRefnos(refnos: string[]) {
  const next = [...cloudTargetRefnos.value];
  for (const raw of refnos) {
    const refno = typeof raw === 'string' ? raw.trim() : '';
    if (refno && !next.includes(refno)) next.push(refno);
  }
  cloudTargetRefnos.value = next;
}

function removeCloudTargetRefno(refno: string) {
  cloudTargetRefnos.value = cloudTargetRefnos.value.filter((r) => r !== refno);
}

function setCloudTargetRefnos(refnos: string[]) {
  cloudTargetRefnos.value = [];
  addCloudTargetRefnos(refnos);
}

function clearCloudTargetRefnos() {
  cloudTargetRefnos.value = [];
}

function setCloudTargetLevel(level: CloudTargetLevel) {
  cloudTargetLevel.value = level;
}

function setAnnotationOverlayVisible(visible: boolean) {
  annotationOverlayVisible.value = visible;
}

function setAttributeDisplayMode(mode: AttributeDisplayMode) {
  attributeDisplayMode.value = mode;
}

function setCompareMode(enabled: boolean) {
  compareMode.value = enabled;
}

function addMeasurement(rec: MeasurementRecord) {
  unifiedMeasurementRecords.value = [
    ...unifiedMeasurementRecords.value,
    fromClassicMeasurement(normalizeMeasurementRecord(rec)),
  ];
  activeMeasurementId.value = rec.id;
}

function updateMeasurementVisible(id: string, visible: boolean) {
  patchUnifiedMeasurement(id, (rec) => (rec.source === 'classic' ? { ...rec, visible } : rec));
}

function removeMeasurement(id: string) {
  unifiedMeasurementRecords.value = unifiedMeasurementRecords.value.filter(
    (rec) => !(rec.source === 'classic' && rec.id === id),
  );
  if (activeMeasurementId.value === id) {
    activeMeasurementId.value = null;
  }
}

function clearMeasurements() {
  unifiedMeasurementRecords.value = unifiedMeasurementRecords.value.filter(
    (rec) => rec.source !== 'classic',
  );
  activeMeasurementId.value = null;
}

function addXeokitMeasurement(rec: XeokitMeasurementRecord) {
  unifiedMeasurementRecords.value = [
    ...unifiedMeasurementRecords.value,
    fromXeokitMeasurement(normalizeXeokitMeasurementRecord(rec)),
  ];
  activeXeokitMeasurementId.value = rec.id;
}

/**
 * 用 xeokit 形态的 patch 更新一条记录：先投影回 xeokit、打补丁、再转回统一形态。
 * 绕这一圈是为了让调用方保持原来的 `Partial<XeokitXxxRecord>` 契约不变。
 */
function patchXeokitMeasurement<T extends XeokitMeasurementRecord>(
  id: string,
  kind: T['kind'],
  patch: Partial<T>,
) {
  patchUnifiedMeasurement(id, (rec) => {
    if (rec.source === 'classic' || rec.kind !== kind) return rec;
    const patched = { ...toXeokitMeasurement(rec), ...patch } as XeokitMeasurementRecord;
    return { ...fromXeokitMeasurement(patched), source: rec.source };
  });
}

function addXeokitDistanceMeasurement(rec: XeokitDistanceMeasurementRecord) {
  addXeokitMeasurement(rec);
}

function updateXeokitDistanceMeasurement(id: string, patch: Partial<XeokitDistanceMeasurementRecord>) {
  patchXeokitMeasurement<XeokitDistanceMeasurementRecord>(id, 'distance', patch);
}

function addXeokitAngleMeasurement(rec: XeokitAngleMeasurementRecord) {
  addXeokitMeasurement(rec);
}

function updateXeokitAngleMeasurement(id: string, patch: Partial<XeokitAngleMeasurementRecord>) {
  patchXeokitMeasurement<XeokitAngleMeasurementRecord>(id, 'angle', patch);
}

function addXeokitElevationPointMeasurement(rec: XeokitElevationPointMeasurementRecord) {
  addXeokitMeasurement(rec);
}

function updateXeokitElevationPointMeasurement(id: string, patch: Partial<XeokitElevationPointMeasurementRecord>) {
  patchXeokitMeasurement<XeokitElevationPointMeasurementRecord>(id, 'elevation_point', patch);
}

function addXeokitElevationDeltaMeasurement(rec: XeokitElevationDeltaMeasurementRecord) {
  addXeokitMeasurement(rec);
}

function updateXeokitElevationDeltaMeasurement(id: string, patch: Partial<XeokitElevationDeltaMeasurementRecord>) {
  patchXeokitMeasurement<XeokitElevationDeltaMeasurementRecord>(id, 'elevation_delta', patch);
}

function updateXeokitMeasurementVisible(id: string, visible: boolean) {
  patchUnifiedMeasurement(id, (rec) => (rec.source === 'classic' ? rec : { ...rec, visible }));
}

function removeXeokitMeasurement(id: string) {
  unifiedMeasurementRecords.value = unifiedMeasurementRecords.value.filter(
    (rec) => !(rec.source !== 'classic' && rec.id === id),
  );
  if (activeXeokitMeasurementId.value === id) {
    activeXeokitMeasurementId.value = null;
  }
}

function clearXeokitMeasurements() {
  unifiedMeasurementRecords.value = unifiedMeasurementRecords.value.filter(
    (rec) => rec.source === 'classic',
  );
  activeXeokitMeasurementId.value = null;
  measurementDetailsDrawerOpen.value = false;
}

function setMeasurementDetailsDrawerOpen(open: boolean) {
  measurementDetailsDrawerOpen.value = open;
}

function toggleMeasurementDetailsDrawerOpen() {
  measurementDetailsDrawerOpen.value = !measurementDetailsDrawerOpen.value;
}

function setCurrentXeokitDistanceDraft(draft: XeokitDistanceDraft | null) {
  currentXeokitDistanceDraft.value = draft ? { ...draft } : null;
}

function setCurrentXeokitAngleDraft(draft: XeokitAngleDraft | null) {
  currentXeokitAngleDraft.value = draft ? { ...draft } : null;
}

function setCurrentXeokitElevationPointDraft(draft: XeokitElevationPointDraft | null) {
  currentXeokitElevationPointDraft.value = draft ? { ...draft } : null;
}

function setCurrentXeokitElevationDeltaDraft(draft: XeokitElevationDeltaDraft | null) {
  currentXeokitElevationDeltaDraft.value = draft ? { ...draft } : null;
}

function setMeasurementDraftResult(result: MeasurementDraftResult | null) {
  measurementDraftResult.value = result ? { ...result } : null;
}

function syncXeokitElevationDatum(datumElevation: number) {
  unifiedMeasurementRecords.value = unifiedMeasurementRecords.value.map((rec) => {
    if (rec.source === 'classic') return rec;
    if (rec.kind === 'elevation_point') {
      const rebased = rebaseXeokitElevationPointRecord(
        toXeokitMeasurement(rec) as XeokitElevationPointMeasurementRecord,
        datumElevation,
      );
      return { ...fromXeokitMeasurement(rebased), source: rec.source };
    }
    if (rec.kind === 'elevation_delta') {
      const rebased = rebaseXeokitElevationDeltaRecord(
        toXeokitMeasurement(rec) as XeokitElevationDeltaMeasurementRecord,
        datumElevation,
      );
      return { ...fromXeokitMeasurement(rebased), source: rec.source };
    }
    return rec;
  });
  if (currentXeokitElevationPointDraft.value) {
    currentXeokitElevationPointDraft.value = rebaseXeokitElevationPointRecord(
      currentXeokitElevationPointDraft.value,
      datumElevation,
    ) as XeokitElevationPointDraft;
  }
  if (currentXeokitElevationDeltaDraft.value) {
    currentXeokitElevationDeltaDraft.value = rebaseXeokitElevationDeltaRecord(
      currentXeokitElevationDeltaDraft.value,
      datumElevation,
    ) as XeokitElevationDeltaDraft;
  }
}

function clearCurrentXeokitDraft() {
  currentXeokitDistanceDraft.value = null;
  currentXeokitAngleDraft.value = null;
  currentXeokitElevationPointDraft.value = null;
  currentXeokitElevationDeltaDraft.value = null;
}

function setXeokitHoverState(state: XeokitHoverState) {
  xeokitHoverState.value = { ...state };
}

function setXeokitMarkerState(state: XeokitMarkerState) {
  xeokitMarkerState.value = { ...state };
}

function setXeokitPointerLensState(state: XeokitPointerLensState) {
  xeokitPointerLensState.value = { ...state };
}

function addAnnotation(rec: AnnotationRecord) {
  const withAuthor: AnnotationRecord = rec.authorId ? rec : { ...rec, authorId: resolveCurrentAuthorId() };
  annotations.value = [...annotations.value, normalizeAnnotationRecord(withAuthor)];
  activeAnnotationId.value = rec.id;
  pendingTextAnnotationEditId.value = rec.id;
}

/** patch 碰到关联字段时才走 normalize（重投影 refno / refnos / bindings 三者一致），其余 patch 保持原样直写。 */
function patchTouchesBindings(patch: object): boolean {
  return 'bindings' in patch || 'refnos' in patch || 'refno' in patch || 'objectIds' in patch;
}

function updateAnnotation(id: string, patch: Partial<AnnotationRecord>) {
  const renormalize = patchTouchesBindings(patch);
  annotations.value = annotations.value.map((a) => (
    a.id === id ? (renormalize ? normalizeAnnotationRecord({ ...a, ...patch }) : { ...a, ...patch }) : a
  ));
}

function updateAnnotationVisible(id: string, visible: boolean) {
  updateAnnotation(id, { visible });
}

function setTextAnnotationsCollapsed(ids: string[], collapsed: boolean) {
  const targetIds = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (targetIds.size === 0) return;
  annotations.value = annotations.value.map((annotation) => (
    targetIds.has(annotation.id) ? { ...annotation, collapsed } : annotation
  ));
}

function removeAnnotation(id: string) {
  annotations.value = annotations.value.filter((a) => a.id !== id);
  if (activeAnnotationId.value === id) {
    activeAnnotationId.value = null;
  }
}

function clearAnnotations() {
  annotations.value = [];
  activeAnnotationId.value = null;
  pendingTextAnnotationEditId.value = null;
}

function addObbAnnotation(rec: ObbAnnotationRecord) {
  const withAuthor: ObbAnnotationRecord = rec.authorId ? rec : { ...rec, authorId: resolveCurrentAuthorId() };
  obbAnnotations.value = [...obbAnnotations.value, normalizeObbAnnotationRecord(withAuthor)];
  activeObbAnnotationId.value = rec.id;
  // 不再自动弹出编辑框，用户点击图钉后再编辑
}

function updateObbAnnotation(id: string, patch: Partial<ObbAnnotationRecord>) {
  const renormalize = patchTouchesBindings(patch);
  obbAnnotations.value = obbAnnotations.value.map((a) => (
    a.id === id ? (renormalize ? normalizeObbAnnotationRecord({ ...a, ...patch }) : { ...a, ...patch }) : a
  ));
}

function updateObbAnnotationVisible(id: string, visible: boolean) {
  updateObbAnnotation(id, { visible });
}

function removeObbAnnotation(id: string) {
  obbAnnotations.value = obbAnnotations.value.filter((a) => a.id !== id);
  if (activeObbAnnotationId.value === id) {
    activeObbAnnotationId.value = null;
  }
}

function clearObbAnnotations() {
  obbAnnotations.value = [];
  activeObbAnnotationId.value = null;
  pendingObbEditId.value = null;
}

function addCloudAnnotation(rec: CloudAnnotationRecord) {
  const withAuthor: CloudAnnotationRecord = rec.authorId ? rec : { ...rec, authorId: resolveCurrentAuthorId() };
  cloudAnnotations.value = [...cloudAnnotations.value, normalizeCloudAnnotationRecord(withAuthor)];
  activeCloudAnnotationId.value = rec.id;
  pendingCloudAnnotationEditId.value = rec.id;
}

function updateCloudAnnotation(id: string, patch: Partial<CloudAnnotationRecord>) {
  cloudAnnotations.value = cloudAnnotations.value.map((a) => (
    a.id === id ? normalizeCloudAnnotationRecord({ ...a, ...patch }) : a
  ));
}

function updateCloudAnnotationVisible(id: string, visible: boolean) {
  updateCloudAnnotation(id, { visible });
}

// 与 setTextAnnotationsCollapsed 对齐：批量切换云线批注的 collapsed 状态。
// 双击云线图钉 / 命令面板「云线批注批量收起」等入口都通过这里写入。
function setCloudAnnotationsCollapsed(ids: string[], collapsed: boolean) {
  const targetIds = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (targetIds.size === 0) return;
  cloudAnnotations.value = cloudAnnotations.value.map((annotation) => (
    targetIds.has(annotation.id) ? { ...annotation, collapsed } : annotation
  ));
}

// 与 setTextAnnotationsCollapsed / setCloudAnnotationsCollapsed 对齐：
// 批量切换矩形批注的 collapsed 状态。双击矩形图钉触发。
function setRectAnnotationsCollapsed(ids: string[], collapsed: boolean) {
  const targetIds = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (targetIds.size === 0) return;
  rectAnnotations.value = rectAnnotations.value.map((annotation) => (
    targetIds.has(annotation.id) ? { ...annotation, collapsed } : annotation
  ));
}

// 与上述三类批注的 collapsed action 对齐：批量切换 OBB 批注的 collapsed 状态。
// 双击 OBB 图钉触发。
function setObbAnnotationsCollapsed(ids: string[], collapsed: boolean) {
  const targetIds = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (targetIds.size === 0) return;
  obbAnnotations.value = obbAnnotations.value.map((annotation) => (
    targetIds.has(annotation.id) ? { ...annotation, collapsed } : annotation
  ));
}

function removeCloudAnnotation(id: string) {
  cloudAnnotations.value = cloudAnnotations.value.filter((a) => a.id !== id);
  if (activeCloudAnnotationId.value === id) {
    activeCloudAnnotationId.value = null;
  }
  if (pendingCloudAnnotationEditId.value === id) {
    pendingCloudAnnotationEditId.value = null;
  }
}

function clearCloudAnnotations() {
  cloudAnnotations.value = [];
  activeCloudAnnotationId.value = null;
  pendingCloudAnnotationEditId.value = null;
}

/**
 * 追加云线的问题目标元素（member 绑定），返回实际新增条数。
 *
 * 只动 member：锚点构件不可更换（ADR-0051）——换锚点等于批注搬家，
 * 几何签名变化会改 annotationKey，破坏跨快照的评论归并。
 */
function addCloudAnnotationMembers(
  id: string,
  refnos: string[],
  nounOf?: (refno: string) => string | undefined,
): number {
  return addAnnotationMembers('cloud', id, refnos, nounOf);
}

/** 移除云线的一个问题目标元素；锚点绑定不受影响（ADR-0051）。 */
function removeCloudAnnotationMember(id: string, refno: string): boolean {
  return removeAnnotationMember('cloud', id, refno);
}

/**
 * 重绑 member 时给 `origin:'members'` 范围体补新成员的盒（2026-09-14 方案 §8「原子更新绑定、范围、来源及兼容字段」）。
 * store 不依赖模型查询能力：由 useDtxTools 用 DTX 图层注册；没注册 / 拿不到几何回 `null`，范围体里就没有该成员的盒，
 * 渲染层按 `regionCoversMembers` 判「快照与绑定不一致」走旧的实时 AABB 贴合，不用子集冒充完整范围。
 */
export type AnnotationRegionMemberBoxResolver = (refno: string) => readonly ObbSnapshot[] | null;

let annotationRegionMemberBoxResolver: AnnotationRegionMemberBoxResolver | null = null;

function setAnnotationRegionMemberBoxResolver(resolver: AnnotationRegionMemberBoxResolver | null): void {
  annotationRegionMemberBoxResolver = resolver;
}

/**
 * 绑定变化随手把范围体调和进同一个 patch（原子）：删掉不再是成员的盒、新成员补盒；
 * 云线另同步兼容字段 `selectionBbox`（= 范围体世界 AABB），旧端照旧能画。非 members 来源的范围体不动。
 */
function withReconciledRegion<T extends { regionV1?: RegionV1 | null; selectionBbox?: { min: Vec3; max: Vec3 } }>(
  type: AnnotationType,
  record: T,
  bindings: AnnotationElementBinding[],
): Partial<T> {
  const region = record.regionV1;
  if (!region || region.origin !== 'members') return {};
  const memberRefnos = bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno);
  const resolve = annotationRegionMemberBoxResolver ?? (() => null);
  const reconciled = reconcileMembersRegion(region, memberRefnos, resolve);
  if (!reconciled.changed) return {};
  const patch: Partial<T> = { regionV1: reconciled.region } as Partial<T>;
  if (type === 'cloud') {
    const aabb = regionAabb(reconciled.region);
    if (aabb) (patch as { selectionBbox?: { min: Vec3; max: Vec3 } }).selectionBbox = { min: [...aabb.min] as Vec3, max: [...aabb.max] as Vec3 };
  }
  return patch;
}

/** 按类型把 `bindings` patch 写回对应记录数组；四个 update 都会重投影旧字段。带范围体的记录连范围一起原子更新。 */
function patchAnnotationBindings(type: AnnotationType, id: string, bindings: AnnotationElementBinding[]): void {
  switch (type) {
    case 'text':
      updateAnnotation(id, { bindings });
      return;
    case 'cloud': {
      const record = cloudAnnotations.value.find((a) => a.id === id);
      updateCloudAnnotation(id, { bindings, ...(record ? withReconciledRegion('cloud', record, bindings) : {}) });
      return;
    }
    case 'rect': {
      const record = rectAnnotations.value.find((a) => a.id === id);
      updateRectAnnotation(id, { bindings, ...(record ? withReconciledRegion('rect', record, bindings) : {}) });
      return;
    }
    case 'obb': {
      const record = obbAnnotations.value.find((a) => a.id === id);
      updateObbAnnotation(id, { bindings, ...(record ? withReconciledRegion('obb', record, bindings) : {}) });
      return;
    }
  }
}

/**
 * 追加任意类型批注的问题目标元素（member 绑定），返回实际新增条数（ADR-0049 / 0051）。
 *
 * 只动 member：锚点构件不可更换——换锚点等于批注搬家，
 * 几何签名变化会改 annotationKey，破坏跨快照的评论归并。
 */
function addAnnotationMembers(
  type: AnnotationType,
  id: string,
  refnos: string[],
  nounOf?: (refno: string) => string | undefined,
): number {
  const record = getAnnotationRecordByType(type, id);
  if (!record) return 0;
  const bindings = deriveAnnotationBindings(type, record);
  const existing = new Set(
    bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno),
  );
  const createdAt = Date.now();
  const added: AnnotationElementBinding[] = [];
  for (const raw of refnos) {
    const refno = typeof raw === 'string' ? raw.trim() : '';
    if (!refno || existing.has(refno)) continue;
    existing.add(refno);
    const noun = nounOf?.(refno);
    added.push(noun
      ? { refno, role: 'member', noun, createdAt }
      : { refno, role: 'member', createdAt });
  }
  if (added.length === 0) return 0;
  patchAnnotationBindings(type, id, [...bindings, ...added]);
  return added.length;
}

/** 移除任意类型批注的一个问题目标元素；锚点绑定不受影响（ADR-0051）。 */
function removeAnnotationMember(type: AnnotationType, id: string, refno: string): boolean {
  const record = getAnnotationRecordByType(type, id);
  if (!record) return false;
  const target = typeof refno === 'string' ? refno.trim() : '';
  if (!target) return false;
  const bindings = deriveAnnotationBindings(type, record);
  const next = bindings.filter((binding) => !(binding.role === 'member' && binding.refno === target));
  if (next.length === bindings.length) return false;
  patchAnnotationBindings(type, id, next);
  return true;
}

/**
 * 模型元素 → 关联批注的全类型反查（ADR-0049：覆盖四类批注的 member 绑定，锚点不参与）。
 * 返回顺序：text → cloud → rect → obb，各自按数组原顺序。
 */
function findAnnotationsByMemberRefnosAcrossTypes(
  refnos: readonly string[],
): { type: AnnotationType; record: AnyAnnotationRecord }[] {
  return [
    ...findAnnotationsByMemberRefnos('text', annotations.value, refnos).map((record) => ({ type: 'text' as const, record })),
    ...findAnnotationsByMemberRefnos('cloud', cloudAnnotations.value, refnos).map((record) => ({ type: 'cloud' as const, record })),
    ...findAnnotationsByMemberRefnos('rect', rectAnnotations.value, refnos).map((record) => ({ type: 'rect' as const, record })),
    ...findAnnotationsByMemberRefnos('obb', obbAnnotations.value, refnos).map((record) => ({ type: 'obb' as const, record })),
  ];
}

function addRectAnnotation(rec: RectAnnotationRecord) {
  const withAuthor: RectAnnotationRecord = rec.authorId ? rec : { ...rec, authorId: resolveCurrentAuthorId() };
  rectAnnotations.value = [...rectAnnotations.value, normalizeRectAnnotationRecord(withAuthor)];
  activeRectAnnotationId.value = rec.id;
  pendingRectAnnotationEditId.value = rec.id;
}

function updateRectAnnotation(id: string, patch: Partial<RectAnnotationRecord>) {
  const renormalize = patchTouchesBindings(patch);
  rectAnnotations.value = rectAnnotations.value.map((a) => (
    a.id === id ? (renormalize ? normalizeRectAnnotationRecord({ ...a, ...patch }) : { ...a, ...patch }) : a
  ));
}

function updateRectAnnotationVisible(id: string, visible: boolean) {
  updateRectAnnotation(id, { visible });
}

function removeRectAnnotation(id: string) {
  rectAnnotations.value = rectAnnotations.value.filter((a) => a.id !== id);
  if (activeRectAnnotationId.value === id) {
    activeRectAnnotationId.value = null;
  }
  if (pendingRectAnnotationEditId.value === id) {
    pendingRectAnnotationEditId.value = null;
  }
}

function clearRectAnnotations() {
  rectAnnotations.value = [];
  activeRectAnnotationId.value = null;
  pendingRectAnnotationEditId.value = null;
}

function getAnnotationRecordsByType(type: AnnotationType): AnyAnnotationRecord[] {
  switch (type) {
    case 'text':
      return annotations.value;
    case 'cloud':
      return cloudAnnotations.value;
    case 'rect':
      return rectAnnotations.value;
    case 'obb':
      return obbAnnotations.value;
  }
}

function setAnnotationTypeVisible(type: AnnotationType, visible: boolean) {
  switch (type) {
    case 'text':
      annotations.value.forEach((item) => updateAnnotationVisible(item.id, visible));
      return;
    case 'cloud':
      cloudAnnotations.value.forEach((item) => updateCloudAnnotationVisible(item.id, visible));
      return;
    case 'rect':
      rectAnnotations.value.forEach((item) => updateRectAnnotationVisible(item.id, visible));
      return;
    case 'obb':
      obbAnnotations.value.forEach((item) => updateObbAnnotationVisible(item.id, visible));
  }
}

function clearAnnotationType(type: AnnotationType) {
  switch (type) {
    case 'text':
      clearAnnotations();
      return;
    case 'cloud':
      clearCloudAnnotations();
      return;
    case 'rect':
      clearRectAnnotations();
      return;
    case 'obb':
      clearObbAnnotations();
  }
}

function setAllAnnotationsVisible(visible: boolean) {
  setAnnotationTypeVisible('text', visible);
  setAnnotationTypeVisible('cloud', visible);
  setAnnotationTypeVisible('rect', visible);
  setAnnotationTypeVisible('obb', visible);
}

function clearAllAnnotations() {
  clearAnnotations();
  clearCloudAnnotations();
  clearRectAnnotations();
  clearObbAnnotations();
}

function clearAll() {
  clearMeasurements();
  clearXeokitMeasurements();
  legacyMeasurementPayloads.value = [];
  clearAllAnnotations();
  clearCurrentXeokitDraft();
  setXeokitHoverState({
    visible: false,
    snapped: false,
    entityId: null,
    objectId: null,
    worldPos: null,
    canvasPos: null,
  });
  setXeokitMarkerState({
    visible: false,
    snapped: false,
    role: 'hover',
    worldPos: null,
    canvasPos: null,
  });
  setXeokitPointerLensState({
    visible: false,
    snapped: false,
    title: '',
    subtitle: '',
    canvasPos: null,
  });
  toolMode.value = 'none';
}

// ==================== 评论/意见管理函数 ====================

export type AnnotationType = 'text' | 'cloud' | 'rect' | 'obb';
export type AnnotationCommentInput =
  Omit<AnnotationComment, 'id' | 'annotationId' | 'annotationType' | 'createdAt'>
  & Partial<Pick<AnnotationComment, 'id' | 'annotationId' | 'annotationType' | 'createdAt'>>;
type AnnotationReviewActor = Pick<User, 'id' | 'name' | 'role'>;

function getAnnotationRecordByType(
  annotationType: AnnotationType,
  annotationId: string
): AnyAnnotationRecord | null {
  switch (annotationType) {
    case 'text':
      return annotations.value.find((a) => a.id === annotationId) || null;
    case 'cloud':
      return cloudAnnotations.value.find((a) => a.id === annotationId) || null;
    case 'rect':
      return rectAnnotations.value.find((a) => a.id === annotationId) || null;
    case 'obb':
      return obbAnnotations.value.find((a) => a.id === annotationId) || null;
  }
}

function getAnnotationReviewState(
  annotationType: AnnotationType,
  annotationId: string
): AnnotationReviewState {
  const record = getAnnotationRecordByType(annotationType, annotationId);
  return normalizeAnnotationReviewState(record?.reviewState ?? createDefaultAnnotationReviewState());
}

function setAnnotationReviewState(
  annotationType: AnnotationType,
  annotationId: string,
  reviewState: AnnotationReviewState
): boolean {
  const normalized = normalizeAnnotationReviewState(reviewState);
  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { reviewState: normalized });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { reviewState: normalized });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { reviewState: normalized });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { reviewState: normalized });
      return true;
    }
  }
}

function applyAnnotationReviewAction(
  annotationType: AnnotationType,
  annotationId: string,
  payload: {
    action: AnnotationReviewAction;
    actor: AnnotationReviewActor;
    note?: string;
    createdAt?: number;
  }
): AnnotationReviewState | null {
  const record = getAnnotationRecordByType(annotationType, annotationId);
  if (!record) return null;

  const timestamp = payload.createdAt || Date.now();
  const note = payload.note?.trim() || undefined;
  const current = getAnnotationReviewState(annotationType, annotationId);
  const next: AnnotationReviewState = {
    ...current,
    note,
    updatedAt: timestamp,
    updatedById: payload.actor.id,
    updatedByName: payload.actor.name,
    updatedByRole: payload.actor.role,
    history: [
      ...current.history,
      {
        id: `annotation_review_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
        action: payload.action,
        operatorId: payload.actor.id,
        operatorName: payload.actor.name,
        operatorRole: payload.actor.role,
        note,
        createdAt: timestamp,
      },
    ],
  };

  switch (payload.action) {
    case 'fixed':
      next.resolutionStatus = 'fixed';
      next.decisionStatus = 'pending';
      break;
    case 'wont_fix':
      next.resolutionStatus = 'wont_fix';
      next.decisionStatus = 'pending';
      break;
    case 'agree':
      next.decisionStatus = 'agreed';
      break;
    case 'reject':
      next.decisionStatus = 'rejected';
      break;
  }

  return setAnnotationReviewState(annotationType, annotationId, next) ? next : null;
}

/**
 * 更新批注严重度（问题严重程度）。
 * severity 可传 undefined 表示清空。调用方需先做权限校验。
 */
function updateAnnotationSeverity(
  annotationType: AnnotationType,
  annotationId: string,
  severity: AnnotationSeverity | undefined
): boolean {
  const normalized = normalizeAnnotationSeverity(severity);
  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { severity: normalized });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { severity: normalized });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { severity: normalized });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { severity: normalized });
      return true;
    }
  }
}

function updateAnnotationBasicFields(
  annotationType: AnnotationType,
  annotationId: string,
  patch: Partial<Pick<AnyAnnotationRecord, 'title' | 'description'>>
): boolean {
  const nextPatch: Partial<Pick<AnyAnnotationRecord, 'title' | 'description'>> = {};
  if (typeof patch.title === 'string') nextPatch.title = patch.title;
  if (typeof patch.description === 'string') nextPatch.description = patch.description;

  if (Object.keys(nextPatch).length === 0) return true;

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, nextPatch as Partial<AnnotationRecord>);
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, nextPatch as Partial<CloudAnnotationRecord>);
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, nextPatch as Partial<RectAnnotationRecord>);
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, nextPatch as Partial<ObbAnnotationRecord>);
      return true;
    }
    default: {
      const _exhaustive: never = annotationType;
      return false;
    }
  }
}

function getAnnotationScreenshot(
  annotationType: AnnotationType,
  annotationId: string
): AnnotationScreenshot | null {
  const record = getAnnotationRecordByType(annotationType, annotationId);
  return normalizeAnnotationScreenshot(record?.screenshot) ?? null;
}

function setAnnotationScreenshot(
  annotationType: AnnotationType,
  annotationId: string,
  screenshot: AnnotationScreenshot
): boolean {
  const normalized = normalizeAnnotationScreenshot(screenshot);
  if (!normalized) return false;

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { screenshot: normalized });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { screenshot: normalized });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { screenshot: normalized });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { screenshot: normalized });
      return true;
    }
  }
}

function clearAnnotationScreenshot(
  annotationType: AnnotationType,
  annotationId: string
): boolean {
  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { screenshot: undefined });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { screenshot: undefined });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { screenshot: undefined });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { screenshot: undefined });
      return true;
    }
  }
}

/**
 * 为批注添加评论/意见。
 *
 * 写入时同时更新 commentThreadStore 与 inline annotation.comments（兼容投影）。
 * `formId` 可选；提供时评论按 `${type}:${id}@${formId}` 隔离到正式单据 bucket，
 * 不提供时落到旧 key 的本地草稿 bucket，避免互相覆盖。
 */
function addCommentToAnnotation(
  annotationType: AnnotationType,
  annotationId: string,
  comment: AnnotationCommentInput,
  formId?: string | null,
  taskId?: string | null
): AnnotationComment | null {
  const fallbackCreatedAt = Date.now();
  const newComment: AnnotationComment = {
    ...comment,
    id: comment.id || `comment_${fallbackCreatedAt}_${Math.random().toString(36).slice(2, 8)}`,
    annotationId,
    annotationType,
    createdAt: comment.createdAt || fallbackCreatedAt,
  };

  _getThreadStore().upsertComment(
    liftAnnotationComment(newComment, {
      annotationType,
      formId: formId ?? undefined,
      taskId: taskId ?? undefined,
    }),
  );

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateCloudAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateRectAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return null;
      const comments = annotation.comments || [];
      updateObbAnnotation(annotationId, { comments: [...comments, newComment] });
      break;
    }
  }

  return newComment;
}

/**
 * 覆盖批注评论列表（用于后端同步）。
 *
 * 必须同时更新 commentThreadStore（读路径真源）和 inline annotation.comments
 * （兼容投影）。否则后端返回的最新评论列表会被读路径忽略，导致 UI 显示空或旧数据。
 *
 * `formId` 可选；提供时只覆盖正式单据 bucket，不影响其他 form 的评论。
 */
function setAnnotationComments(
  annotationType: AnnotationType,
  annotationId: string,
  comments: AnnotationComment[],
  formId?: string | null,
  taskId?: string | null
): boolean {
  const exists =
    annotationType === 'text'
      ? annotations.value.some((a) => a.id === annotationId)
      : annotationType === 'cloud'
        ? cloudAnnotations.value.some((a) => a.id === annotationId)
        : annotationType === 'rect'
          ? rectAnnotations.value.some((a) => a.id === annotationId)
          : obbAnnotations.value.some((a) => a.id === annotationId);
  if (!exists) return false;

  const key = buildCommentThreadKey(annotationType, annotationId, formId, taskId);
  const lifted = comments.map((c) =>
    liftAnnotationComment({ ...c, annotationId }, {
      annotationType,
      formId: formId ?? undefined,
      taskId: taskId ?? undefined,
    }),
  );
  _getThreadStore().setThreadComments(key, lifted);

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { comments });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { comments });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { comments });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { comments });
      return true;
    }
  }
  return false;
}

/**
 * 更新批注中的某条评论。
 *
 * `formId` 可选；提供时只更新正式单据 bucket 的对应评论，避免回退到旧 key。
 */
function updateAnnotationComment(
  annotationType: AnnotationType,
  annotationId: string,
  commentId: string,
  patch: Partial<Pick<AnnotationComment, 'content' | 'updatedAt'>>,
  formId?: string | null,
  taskId?: string | null
): boolean {
  const existing = _getCommentsFromInline(annotationType, annotationId)
    .find((c) => c.id === commentId);
  if (existing) {
    const updated = { ...existing, ...patch, updatedAt: Date.now() };
    _getThreadStore().upsertComment(
      liftAnnotationComment(updated, {
        annotationType,
        formId: formId ?? undefined,
        taskId: taskId ?? undefined,
      }),
    );
  }

  const updateComments = (comments: AnnotationComment[] | undefined): AnnotationComment[] | undefined => {
    if (!comments) return undefined;
    return comments.map((c) =>
      c.id === commentId ? { ...c, ...patch, updatedAt: Date.now() } : c
    );
  };

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { comments: updateComments(annotation.comments) });
      return true;
    }
  }
  return false;
}

/**
 * 删除批注中的某条评论。
 *
 * `formId` 可选；提供时只删除正式单据 bucket 的对应评论。
 */
function removeAnnotationComment(
  annotationType: AnnotationType,
  annotationId: string,
  commentId: string,
  formId?: string | null,
  taskId?: string | null
): boolean {
  const key = buildCommentThreadKey(annotationType, annotationId, formId, taskId);
  _getThreadStore().deleteComment(key, commentId);

  const filterComments = (comments: AnnotationComment[] | undefined): AnnotationComment[] | undefined => {
    if (!comments) return undefined;
    return comments.filter((c) => c.id !== commentId);
  };

  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateCloudAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateRectAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      if (!annotation) return false;
      updateObbAnnotation(annotationId, { comments: filterComments(annotation.comments) });
      return true;
    }
  }
  return false;
}

/**
 * 获取批注的所有评论。
 *
 * commentThreadStore 为唯一真源，inline annotation.comments 仅作兼容投影。
 * `formId` 可选；提供时仅返回该单据 bucket 的评论，不会回退到旧 key。
 */
function getAnnotationComments(
  annotationType: AnnotationType,
  annotationId: string,
  formId?: string | null,
  taskId?: string | null
): AnnotationComment[] {
  return _getCommentsFromStore(annotationType, annotationId, formId, taskId);
}

function _getCommentsFromInline(
  annotationType: AnnotationType,
  annotationId: string,
): AnnotationComment[] {
  switch (annotationType) {
    case 'text': {
      const annotation = annotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
    case 'cloud': {
      const annotation = cloudAnnotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
    case 'rect': {
      const annotation = rectAnnotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
    case 'obb': {
      const annotation = obbAnnotations.value.find((a) => a.id === annotationId);
      return annotation?.comments || [];
    }
  }
  return [];
}

function _getCommentsFromStore(
  annotationType: AnnotationType,
  annotationId: string,
  formId?: string | null,
  taskId?: string | null,
): AnnotationComment[] {
  try {
    return _storeGetComments(annotationType, annotationId, formId, taskId);
  } catch {
    return _getCommentsFromInline(annotationType, annotationId);
  }
}

function exportJSON(): string {
  const payload: PersistedStateV7 = {
    version: 7,
    measurements: unifiedMeasurementRecords.value,
    legacyMeasurements: legacyMeasurementPayloads.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
  };
  return JSON.stringify(payload, null, 2);
}

function importJSON(
  raw: string,
  options?: Readonly<{ now?: () => number; source?: string }>,
) {
  const parsed = parseJsonText<
    | PersistedStateV1
    | PersistedStateV2
    | PersistedStateV3
    | PersistedStateV4
    | PersistedStateV5
    | PersistedStateV6Bridge
    | PersistedStateV7
  >(raw, {
    source: options?.source ?? '工具状态 JSON',
    expectedRoot: 'object',
  });
  const source = options?.source ?? '工具状态 JSON';
  if (
    !parsed ||
    (
      parsed.version !== 1 &&
      parsed.version !== 2 &&
      parsed.version !== 3 &&
      parsed.version !== 4 &&
      parsed.version !== 5 &&
      parsed.version !== 6 &&
      parsed.version !== 7
    )
  ) {
    failFileValidation({
      source,
      format: 'json',
      reason: '工具状态版本不受支持',
      expected: 'version 为 1、2、3、4、5、6 或 7',
      actual: describeValue((parsed as { version?: unknown }).version),
    });
  }
  for (const field of [
    'measurements',
    'legacyMeasurements',
    'annotations',
    'obbAnnotations',
    'cloudAnnotations',
    'rectAnnotations',
    'dimensions',
    'xeokitDistanceMeasurements',
    'xeokitAngleMeasurements',
    'xeokitElevationPointMeasurements',
    'xeokitElevationDeltaMeasurements',
  ] as const) {
    const value = (parsed as unknown as Record<string, unknown>)[field];
    if (value !== undefined && !Array.isArray(value)) {
      failFileValidation({
        source,
        format: 'json',
        reason: `${field} 字段类型无效`,
        expected: '数组',
        actual: describeValue(value),
      });
    }
  }

  const importsV4OrV5Dimensions = parsed.version === 4 || parsed.version === 5;
  const importsV6BridgeDimensions =
    parsed.version === 6 &&
    Array.isArray(parsed.dimensions) &&
    parsed.dimensions.length > 0;
  if (importsV4OrV5Dimensions || importsV6BridgeDimensions) {
    if (typeof localStorage === 'undefined') {
      const archivedAt = (options?.now ?? Date.now)();
      const archive = importsV4OrV5Dimensions
        ? parseLegacyDimensionArchive(raw, { scope: storageScope.value, archivedAt })
        : parseLegacyDimensionBridgeArchive(raw, { scope: storageScope.value, archivedAt });
      if (archive && archive.records.length > 0) {
        throw new Error('Cannot import legacy dimensions without archive storage');
      }
    } else if (importsV4OrV5Dimensions) {
      archiveImportedLegacyDimensions(
        localStorage,
        raw,
        storageScope.value,
        options?.now ?? Date.now,
      );
    } else {
      archiveImportedLegacyDimensionBridge(
        localStorage,
        raw,
        storageScope.value,
        options?.now ?? Date.now,
      );
    }
  }

  const v7 =
    parsed.version === 1
      ? migrateV6StateToV7(normalizeV1(parsed))
      : parsed.version === 2
        ? migrateV6StateToV7(normalizeV2(parsed))
        : parsed.version === 3
          ? migrateV6StateToV7(normalizeV3(parsed))
          : parsed.version === 4
            ? migrateV6StateToV7(normalizeV4(parsed))
            : parsed.version === 5
              ? migrateV6StateToV7(normalizeV5(parsed))
              : parsed.version === 6
                ? migrateV6StateToV7(normalizeV6Bridge(parsed))
                : normalizeV7(parsed);

  annotations.value = v7.annotations;
  obbAnnotations.value = v7.obbAnnotations;
  cloudAnnotations.value = v7.cloudAnnotations;
  rectAnnotations.value = v7.rectAnnotations;
  setAllMeasurementsFrom(v7);

  activeAnnotationId.value = null;
  activeObbAnnotationId.value = null;
  activeCloudAnnotationId.value = null;
  activeRectAnnotationId.value = null;
  activeMeasurementId.value = null;
  activeXeokitMeasurementId.value = null;
  measurementDetailsDrawerOpen.value = false;
  pendingTextAnnotationEditId.value = null;
  pendingCloudAnnotationEditId.value = null;
  pendingObbEditId.value = null;
  pendingRectAnnotationEditId.value = null;
  clearCurrentXeokitDraft();
  toolMode.value = 'none';
}

const measurementCount = computed(() => measurements.value.length);
const annotationCount = computed(() => annotations.value.length);
const obbAnnotationCount = computed(() => obbAnnotations.value.length);
const cloudAnnotationCount = computed(() => cloudAnnotations.value.length);
const rectAnnotationCount = computed(() => rectAnnotations.value.length);
const xeokitMeasurementCount = computed(() => (
  xeokitDistanceMeasurements.value.length +
  xeokitAngleMeasurements.value.length +
  xeokitElevationPointMeasurements.value.length +
  xeokitElevationDeltaMeasurements.value.length
));
const activeAnnotationContext = computed<ActiveAnnotationContext | null>(() => {
  const mode = toolMode.value;
  const byMode: { mode: ToolMode; type: AnnotationType; id: string | null; records: AnyAnnotationRecord[] }[] = [
    { mode: 'annotation', type: 'text', id: activeAnnotationId.value, records: annotations.value },
    { mode: 'annotation_cloud', type: 'cloud', id: activeCloudAnnotationId.value, records: cloudAnnotations.value },
    { mode: 'annotation_rect', type: 'rect', id: activeRectAnnotationId.value, records: rectAnnotations.value },
    { mode: 'annotation_obb', type: 'obb', id: activeObbAnnotationId.value, records: obbAnnotations.value },
  ];
  const currentByMode = byMode.find((item) => item.mode === mode);
  if (currentByMode?.id) {
    const record = currentByMode.records.find((item) => item.id === currentByMode.id);
    if (record) {
      return {
        type: currentByMode.type,
        id: currentByMode.id,
        record,
      };
    }
  }

  const fallback: { type: AnnotationType; id: string | null; records: AnyAnnotationRecord[] }[] = [
    { type: 'text', id: activeAnnotationId.value, records: annotations.value },
    { type: 'cloud', id: activeCloudAnnotationId.value, records: cloudAnnotations.value },
    { type: 'rect', id: activeRectAnnotationId.value, records: rectAnnotations.value },
    { type: 'obb', id: activeObbAnnotationId.value, records: obbAnnotations.value },
  ];
  for (const item of fallback) {
    if (!item.id) continue;
    const record = item.records.find((entry) => entry.id === item.id);
    if (record) {
      return {
        type: item.type,
        id: item.id,
        record,
      };
    }
  }
  return null;
});
const allXeokitMeasurements = computed<XeokitMeasurementRecord[]>(() => {
  return [
    ...xeokitDistanceMeasurements.value,
    ...xeokitAngleMeasurements.value,
    ...xeokitElevationPointMeasurements.value,
    ...xeokitElevationDeltaMeasurements.value,
  ];
});
const unifiedMeasurements = computed(() => unifiedMeasurementRecords.value);
const legacyMeasurements = computed(() => legacyMeasurementPayloads.value);

const allItems = computed(() => {
  return {
    measurements: measurements.value,
    annotations: annotations.value,
    obbAnnotations: obbAnnotations.value,
    cloudAnnotations: cloudAnnotations.value,
    rectAnnotations: rectAnnotations.value,
    xeokitDistanceMeasurements: xeokitDistanceMeasurements.value,
    xeokitAngleMeasurements: xeokitAngleMeasurements.value,
    xeokitElevationPointMeasurements: xeokitElevationPointMeasurements.value,
    xeokitElevationDeltaMeasurements: xeokitElevationDeltaMeasurements.value,
  };
});

export function useToolStore() {
  return {
    activeTab,
    toolMode,
    activeAnnotationId,
    activeObbAnnotationId,
    activeCloudAnnotationId,
    activeRectAnnotationId,
    activeMeasurementId,
    activeXeokitMeasurementId,
    measurementDetailsDrawerOpen,
    pendingObbEditId,
    pendingTextAnnotationEditId,
    pendingCloudAnnotationEditId,
    pendingRectAnnotationEditId,

    measurements,
    xeokitDistanceMeasurements,
    xeokitAngleMeasurements,
    xeokitElevationPointMeasurements,
    xeokitElevationDeltaMeasurements,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,

    measurementCount,
    xeokitMeasurementCount,
    annotationCount,
    obbAnnotationCount,
    cloudAnnotationCount,
    rectAnnotationCount,
    allItems,
    allXeokitMeasurements,
    unifiedMeasurements,
    legacyMeasurements,
    activeAnnotationContext,

    setToolMode,

    // Attribute display functions
    attributeDisplayMode,
    compareMode,
    setAttributeDisplayMode,
    setCompareMode,

    addMeasurement,
    updateMeasurementVisible,
    removeMeasurement,
    clearMeasurements,

    addXeokitDistanceMeasurement,
    updateXeokitDistanceMeasurement,
    addXeokitAngleMeasurement,
    updateXeokitAngleMeasurement,
    addXeokitElevationPointMeasurement,
    updateXeokitElevationPointMeasurement,
    addXeokitElevationDeltaMeasurement,
    updateXeokitElevationDeltaMeasurement,
    updateXeokitMeasurementVisible,
    removeXeokitMeasurement,
    clearXeokitMeasurements,
    setMeasurementDetailsDrawerOpen,
    toggleMeasurementDetailsDrawerOpen,
    currentXeokitDistanceDraft,
    currentXeokitAngleDraft,
    currentXeokitElevationPointDraft,
    currentXeokitElevationDeltaDraft,
    measurementDraftResult,
    continuousDistanceMeasureEnabled,
    setCurrentXeokitDistanceDraft,
    setCurrentXeokitAngleDraft,
    setCurrentXeokitElevationPointDraft,
    setCurrentXeokitElevationDeltaDraft,
    setMeasurementDraftResult,
    syncXeokitElevationDatum,
    clearCurrentXeokitDraft,
    xeokitHoverState,
    setXeokitHoverState,
    xeokitMarkerState,
    setXeokitMarkerState,
    xeokitPointerLensState,
    setXeokitPointerLensState,

    addAnnotation,
    updateAnnotation,
    updateAnnotationVisible,
    setTextAnnotationsCollapsed,
    setCloudAnnotationsCollapsed,
    setRectAnnotationsCollapsed,
    setObbAnnotationsCollapsed,
    setAnnotationTypeVisible,
    removeAnnotation,
    clearAnnotations,

    addObbAnnotation,
    updateObbAnnotation,
    updateObbAnnotationVisible,
    removeObbAnnotation,
    clearObbAnnotations,

    addCloudAnnotation,
    updateCloudAnnotation,
    updateCloudAnnotationVisible,
    addCloudAnnotationMembers,
    removeCloudAnnotationMember,
    addAnnotationMembers,
    removeAnnotationMember,
    setAnnotationRegionMemberBoxResolver,
    findAnnotationsByMemberRefnosAcrossTypes,
    removeCloudAnnotation,
    clearCloudAnnotations,

    addRectAnnotation,
    updateRectAnnotation,
    updateRectAnnotationVisible,
    removeRectAnnotation,
    clearRectAnnotations,
    clearAnnotationType,
    clearAllAnnotations,
    setAllAnnotationsVisible,
    getAnnotationRecordsByType,

    clearAll,

    // U0 草稿 scope（方案 2026-09-14 §3.6）
    annotationDraftScope,
    setAnnotationDraftScope,
    getAnnotationDraftScope,
    getUnattributedDraftSummary,
    annotationDraftJournal,
    patchPersistedAnnotationInScope,

    // 评论/意见管理
    addCommentToAnnotation,
    setAnnotationComments,
    updateAnnotationComment,
    removeAnnotationComment,
    getAnnotationComments,
    getAnnotationReviewState,
    setAnnotationReviewState,
    applyAnnotationReviewAction,
    updateAnnotationSeverity,
    updateAnnotationBasicFields,
    getAnnotationScreenshot,
    setAnnotationScreenshot,
    clearAnnotationScreenshot,

    exportJSON,
    importJSON,

    pickedQueryCenter,
    setPickedQueryCenter: (val: PickedQueryCenter | null) => {
      pickedQueryCenter.value = val;
    },

    // Ptset 可视化
    ptsetVisualizationRequest,
    requestPtsetVisualization: (refno: string) => {
      ptsetVisualizationRequest.value = { refno, timestamp: Date.now() };
    },
    clearPtsetVisualizationRequest: () => {
      ptsetVisualizationRequest.value = null;
    },

    // ── 通用 refno 拾取 ──
    pickRefnoFilter,
    pickedRefnos,
    pickRefnoCallback,
    startPickRefno,
    startBoxPickRefno,
    addPickedRefno,
    removePickedRefno,
    confirmPickRefno,
    cancelPickRefno,

    // ── 云线目标元素集合 ──
    cloudTargetRefnos,
    cloudTargetLevel,
    setCloudTargetLevel,
    annotationOverlayVisible,
    setAnnotationOverlayVisible,
    addCloudTargetRefnos,
    removeCloudTargetRefno,
    setCloudTargetRefnos,
    clearCloudTargetRefnos,
  };
}
