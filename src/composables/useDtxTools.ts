import { computed, nextTick, ref, watch, type Ref } from 'vue';

import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Frustum,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

import type { WorldCell } from '@/review/domain/annotationProjection/clip4';
import type { PhasePrevious } from '@/review/domain/annotationProjection/wave';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';
import type { CloudLabelLayoutV1, ObbSnapshot, RegionV1, SourceStamp, ViewSnapshotV1 } from '@/review/domain/cloudRegion';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { queryPipeWallDistanceCandidates, type PipeWallDistanceCandidate } from '@/api/genModelSpatialApi';
import { reviewAttachmentDelete } from '@/api/reviewApi';
import { setAnnotationProcessingEntryTarget } from '@/components/review/annotationProcessingEntry';
import { isExternalSjFormFocusedMode, readPersistedEmbedModeParams } from '@/components/review/embedRoleLanding';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import {
  applyDashedLineDegrade,
  applyLeaderDegrade,
  applyMeshLineDegrade,
  buildAnnotationDegradeBadgeHtml,
  createCloudDegradeBadgeEl,
  markPinElDegrade,
  pinDashSizeFromDistance,
  pinSvgPaint,
  positionCloudDegradeBadge,
  sameDegrade,
} from '@/composables/annotationDegradeViewport';
import { buildRecordDegradeKey, useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import {
  dtxLoaderRevision,
  findNounByRefnoAcrossAllDbnos,
  findOwnerRefnoByTubi,
  getDtxRefnoLoadSourceAcrossAllDbnos,
  getDtxRefnoTransform,
  resolveDtxObjectIdsByRefno,
} from '@/composables/useDbnoInstancesDtxLoader';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useScreenshot } from '@/composables/useScreenshot';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { buildCloudBindings, getCloudMemberRefnos, useToolStore, type AnnotationRecord, type CloudAnnotationRecord, type CloudElementBinding, type DistanceMeasurementRecord, type MeasurementPoint, type Obb, type ObbAnnotationRecord, type RectAnnotationRecord, type Vec3 } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import {
  DEFAULT_CLOUD_REGION_RENDER_STYLE,
  liftScreenPolylineToBillboard,
  matricesEqual,
  obbSnapshotCorners,
  obbSnapshotFromLocalBoxAndMatrix,
  regionToWorldCells,
  renderCloudRegion,
  type CloudFitState,
  type CloudRegionRenderStyle,
  type SmallTargetLod,
} from '@/review/domain/annotationProjection/annotationProjection';
import {
  ALL_CLOUD_DIRTY,
  computeCloudDirty,
  createArrayVersionTracker,
  createValueVersionTracker,
  type ArrayVersionTracker,
  type CloudRenderStamp,
  type ValueVersionTracker,
} from '@/review/domain/annotationProjection/dirty';
import {
  DEFAULT_LABEL_PREFERENCE,
  labelOffsetFromTopLeft,
  layoutCloudLabel,
  rectToCloudFrame,
  type CloudFrame,
  type LabelLayoutResult,
  type LabelPreference,
} from '@/review/domain/annotationProjection/labelLayout';
import {
  DEFAULT_CLOUD_LOD_OPTIONS,
  cloudLodPriority,
  planCloudLod,
  type CloudLodCandidate,
  type CloudLodLevel,
} from '@/review/domain/annotationProjection/lod';
import { createRegionCloudPresentationV1, regionCoversMembers } from '@/review/domain/cloudRegion';
import { emitToast } from '@/ribbon/toastBus';
import { UserRole } from '@/types/auth';
import { worldPerPixelAt } from '@/utils/three/annotation/utils/solvespaceLike';
import { formatLengthMeters } from '@/utils/unitFormat';

type DragRect = {
  active: boolean
  pointerId: number | null
  startClient: { x: number; y: number } | null
  startCanvas: { x: number; y: number } | null
  currentCanvas: { x: number; y: number } | null
}

type RectPlaneDrag = {
  active: boolean
  pointerId: number | null
  startCanvas: { x: number; y: number } | null
  plane: Plane | null
  basisU: Vector3 | null
  basisV: Vector3 | null
  startWorld: Vector3 | null
  startEntityId: string | null
}

/** DOM 图钉的重绘依据：解析表变化时按这些参数原地重画 SVG（ADR-0050 视口降级），不重建元素、不丢事件监听 */
type MarkerMeta = {
  kind: AnnotationOverlayKind
  annotationId: string
  glyph: string
  collapsed: boolean
  /** 上次画进 SVG 的降级态 */
  degrade: AnnotationDegrade | null
}

type LabelEl = {
  id: string
  worldPos: Vector3
  el: HTMLDivElement
  /**
   * `v1` = 该文字框由云线屏幕布局（`cloudLabelLayoutV1`）直接定位，通用「按 worldPos 投影」循环要跳过它；
   * 缺省 / `legacy` = 旧的世界点布局。
   */
  layoutMode?: 'legacy' | 'v1'
  /** 只有图钉（markers）带 */
  marker?: MarkerMeta
}

type TextAnnotationDragState = {
  annotationId: string | null
  pointerId: number | null
  anchorWorldPos: Vector3 | null
  anchorNdcZ: number
  moved: boolean
};

type InlineTextAnnotationDraft = {
  title: string
  description: string
};

type InlineOverlayAnnotationDragState = {
  annotationId: string | null
  annotationKind: 'cloud' | 'rect' | 'obb' | null
  pointerId: number | null
  anchorWorldPos: Vector3 | null
  anchorNdcZ: number
  moved: boolean
  /**
   * 云线 V1 标签拖动：按住点相对文字框左上角的偏移（overlay 像素）。有值 = 本次拖动走屏幕像素布局，
   * 松手时提交 `labelLayoutV1.offsetPx`；null = 旧的世界点拖动。
   */
  labelGrabOffsetPx: { x: number; y: number } | null
};

/**
 * 云线渲染的分阶段缓存（方案 §9.1，开关 `cloudDirtyCache`）：上一帧的版本戳 + 供 label 阶段复用的轮廓产物。
 * 相机 / 视口 / 目标 / 样式都没变时，轮廓不重建、`setPoints` 不调、文字框不重排。
 */
type CloudRenderCache = {
  stamp: CloudRenderStamp | null
  targetBoundsTracker: ArrayVersionTracker
  recordTracker: ValueVersionTracker<CloudAnnotationRecord>
  labelMetricsTracker: ValueVersionTracker<string>
  /** 上一帧的屏幕参考框（加 padding、未加波浪）；null = 本帧没有可用轮廓（bbox3d 角点越界 / 走旧固定布局时也给） */
  frame: CloudFrame | null
  /** billboard 平面深度，把屏幕布局结果反投影回世界（引线端点）时用 */
  frameNdcZ: number
  labelLayout: LabelLayoutResult | null
  /** 拖动中的临时文字框左上角（overlay 像素），松手后清空 */
  labelDragTopLeft: { x: number; y: number } | null
  /**
   * P2 `region-v1`：校验并（必要时按 G_new · G_old⁻¹）重映射到当前世界系的凸单元。
   * 随「记录引用 | DTX 全局矩阵版本」失效；null = 记录校验不过（`missing-region`，走旧布局）。
   */
  regionCells: WorldCell[] | null
  regionCellsKey: string
  regionInvalidReason: string | null
  regionCellsTracker: ValueVersionTracker<WorldCell[] | null>
  /** 上一帧的圆角路径 + 相位框（特征锚定 / 相位交接） */
  regionPhase: PhasePrevious | null
  regionLod: 'cloud' | 'icon'
  /** 本帧状态（`missing-region` = 记录没有可用范围 / 未走新管线） */
  regionState: CloudFitState | null
  regionLastLod: SmallTargetLod | null
  regionPolylineCount: number
  /** paint 阶段的版本 = 帧级样式版本 × 本条记录的降级态（ADR-0050 视口降级）：只有这一条降级变了，也只重刷它的材质 */
  paintTracker: ValueVersionTracker<string>
  /**
   * P4 LOD（方案 §9.3，开关 `cloudAdaptiveLod`）：本帧计划等级。`pin` = 只留图钉——不算凸包、不 `setPoints`、不挂文字 DOM；
   * 云线总数 ≤ 预算时一律 `full`。
   */
  lodLevel: CloudLodLevel
  /** 已经应用到可视对象上的等级；null = 还没应用过（首帧）。与 `lodLevel` 不等 = 本帧要切档 */
  lodApplied: CloudLodLevel | null
  /** 最近一次规划时的优先级 / 固定高档标记（调试用） */
  lodPriority: number
  lodPinnedHigh: boolean
}

function createCloudRenderCache(): CloudRenderCache {
  return {
    stamp: null,
    targetBoundsTracker: createArrayVersionTracker(),
    recordTracker: createValueVersionTracker<CloudAnnotationRecord>(),
    labelMetricsTracker: createValueVersionTracker<string>(),
    paintTracker: createValueVersionTracker<string>(),
    frame: null,
    frameNdcZ: 0,
    labelLayout: null,
    labelDragTopLeft: null,
    regionCells: null,
    regionCellsKey: '',
    regionInvalidReason: null,
    regionCellsTracker: createValueVersionTracker<WorldCell[] | null>(),
    regionPhase: null,
    regionLod: 'cloud',
    regionState: null,
    regionLastLod: null,
    regionPolylineCount: 0,
    lodLevel: 'full',
    lodApplied: null,
    lodPriority: 0,
    lodPinnedHigh: false,
  };
}

type CloudOverlayEl = {
  id: string
  worldPos: Vector3
  labelWorldPos: Vector3
  leader: AnnotationLeaderVisual
  outline: MeshLine
  /** 视口截断时轮廓可能断成多段；MeshLine 不支持子路径（§15 ②），第 2 段起用这组同材质 MeshLine */
  outlineExtra: MeshLine[]
  bboxEdges: LineSegments
  /** 锚点小针（LineDashedMaterial，正常态 gapSize 0 等价实线） */
  pin: LineSegments
  /** 小针虚线节拍（世界单位），创建时按锚点到文字框距离定 */
  pinDashSize: number
  record: CloudAnnotationRecord
  /** 目标合并 AABB 的解析缓存，见 resolveCloudTargetBbox */
  targetBbox: { min: Vec3; max: Vec3 } | null
  targetBboxAt: number
  render: CloudRenderCache
  /** ADR-0050 视口降级：本条记录的 missing / stale 态；null = 正常 */
  degrade: AnnotationDegrade | null
  /** 降级时挂在轮廓参考框左上角的小徽标（overlay 元素）；正常态 null */
  badgeEl: HTMLDivElement | null
  /** 徽标刚创建、还没按本帧轮廓定位过 */
  badgeDirty: boolean
}

/** 云线渲染计数（e2e / 单测「静止零重建」验收用），`debugCloudRenderStats()` 读取 */
export type CloudRenderStats = {
  frames: number
  contourBuilds: number
  setPoints: number
  labelLayouts: number
  paintUpdates: number
  /** P4 LOD 计划重算次数：相机 / 视口 / 集合 / 激活 / 拖动 / 悬停都没变时为零 */
  lodPlans: number
}

/** `debugCloudLod()` 的快照：P4 LOD 本帧计划 */
export type CloudLodDebugSnapshot = {
  budget: number
  slack: number
  overBudget: boolean
  fullCount: number
  pinCount: number
  hoveredId: string | null
  items: { id: string; level: CloudLodLevel; applied: CloudLodLevel | null; priority: number; pinnedHigh: boolean; labelMounted: boolean }[]
}

/** 新建云线的默认标签布局：参考包围框右上角、向右 18 px */
export function createDefaultCloudLabelLayoutV1(): CloudLabelLayoutV1 {
  return {
    version: 1,
    anchor: { kind: 'contour-bounds', uv: [1, 0], labelPoint: 'top-left' },
    offsetPx: { x: DEFAULT_LABEL_PREFERENCE.offsetPx.x, y: DEFAULT_LABEL_PREFERENCE.offsetPx.y },
  };
}

function labelPreferenceFromRecord(layout: CloudLabelLayoutV1): LabelPreference {
  return { uv: layout.anchor.uv, offsetPx: layout.offsetPx };
}

/** `region-v1` 呈现参数 → 几何内核样式：padding / λ / A 来自记录（非法值回默认），halo 随描边宽度 */
function regionRenderStyleFromRecord(record: CloudAnnotationRecord, lineWidthPx: number): CloudRegionRenderStyle {
  const p = record.presentationV1;
  const pick = (value: number | undefined, fallback: number, min: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
  return {
    paddingPx: pick(p?.paddingPx, DEFAULT_CLOUD_REGION_RENDER_STYLE.paddingPx, 1),
    wavelengthPx: pick(p?.wavelengthPx, DEFAULT_CLOUD_REGION_RENDER_STYLE.wavelengthPx, 4),
    amplitudePx: pick(p?.amplitudePx, DEFAULT_CLOUD_REGION_RENDER_STYLE.amplitudePx, 0),
    stepPx: DEFAULT_CLOUD_REGION_RENDER_STYLE.stepPx,
    haloWidthPx: Math.max(DEFAULT_CLOUD_REGION_RENDER_STYLE.haloWidthPx, (Number.isFinite(lineWidthPx) ? lineWidthPx : 0) * 2),
  };
}

/** 记录是否应走 P2 范围体管线（开关开 + 显式 `region-v1` + 带范围体）；旧记录 `legacy-v0` 一律照旧 */
function isRegionPresentationRecord(record: CloudAnnotationRecord): boolean {
  return record.presentationV1?.algorithm === 'region-v1' && !!record.regionV1;
}

/**
 * 创建视点快照（方案 §6.2 `ViewSnapshotV1`）：保存的是**创建证据**，不是当前相机缓存；
 * 恢复原貌时按创建宽高比等比适配或留边，不能拿新视口比例直接覆盖原投影。
 */
function captureCreationViewSnapshot(params: {
  camera: any
  controlsTarget: Vector3 | null
  anchorWorldPos: Vector3
  viewportCss: { width: number; height: number }
  capturedAt: number
  modelSnapshotId: string | null
}): ViewSnapshotV1 {
  const { camera } = params;
  const position = new Vector3();
  camera.getWorldPosition(position);
  const direction = camera.getWorldDirection(new Vector3());
  const target = params.controlsTarget
    ? params.controlsTarget.clone()
    : position.clone().addScaledVector(direction, Math.max(position.distanceTo(params.anchorWorldPos), 1e-3));
  const zoom = typeof camera.zoom === 'number' && Number.isFinite(camera.zoom) ? camera.zoom : 1;
  const projection: ViewSnapshotV1['projection'] = camera.isOrthographicCamera
    ? {
      kind: 'orthographic',
      worldHeight: (Number(camera.top) - Number(camera.bottom)) / (zoom || 1),
      zoom,
      near: Number(camera.near),
      far: Number(camera.far),
    }
    : {
      kind: 'perspective',
      verticalFovDeg: Number(camera.fov ?? 60),
      zoom,
      near: Number(camera.near),
      far: Number(camera.far),
    };
  const dpr = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : undefined;
  return {
    version: 1,
    capturedAt: params.capturedAt,
    position: vec3ToTuple(position),
    target: vec3ToTuple(target),
    up: vec3ToTuple(camera.up ?? new Vector3(0, 1, 0)),
    projection,
    viewportCss: { width: params.viewportCss.width, height: params.viewportCss.height },
    ...(dpr !== undefined ? { devicePixelRatio: dpr } : {}),
    ...(params.modelSnapshotId ? { modelSnapshotId: params.modelSnapshotId } : {}),
    capturedContext: ['camera'],
  };
}

/**
 * 云线创建时的来源身份（§6.2 `SourceStamp` / §15 ③）：`modelSnapshotId` 取成员所在加载批次记下的身份（多个不同则逗号连接），
 * `globalModelMatrix` 存 DTX 全局矩阵本身；拿不到一律 `null`，不用当前打开模型的信息冒充。
 */
function buildCloudSourceStamp(memberRefnos: readonly string[], layer: DTXLayer | null): SourceStamp {
  const snapshotIds = new Set<string>();
  for (const refno of memberRefnos) {
    const stamp = getDtxRefnoLoadSourceAcrossAllDbnos(refno);
    if (stamp?.modelSnapshotId) snapshotIds.add(stamp.modelSnapshotId);
  }
  return {
    projectKey: null,
    modelSnapshotId: snapshotIds.size > 0 ? [...snapshotIds].sort().join(',') : null,
    globalModelMatrix: layer ? layer.getGlobalModelMatrix().elements.slice() : null,
    coordinateFrameId: null,
  };
}

/** 成员 refno → 已装进 DTX 图层的 objectId（直接同名 / 加载器缓存 / `o:${refno}:n` 兜底扫描） */
function resolveRegionObjectIdsForRefno(layer: DTXLayer, refno: string): string[] {
  const normalized = normalizeRefnoKey(refno);
  if (!normalized) return [];
  const out = new Set<string>();
  if (layer.hasObject(normalized)) out.add(normalized);
  const dbnum = parseDbnumFromRefno(normalized);
  if (dbnum) {
    for (const objectId of resolveDtxObjectIdsByRefno(dbnum, normalized)) {
      if (layer.hasObject(objectId)) out.add(objectId);
    }
  }
  if (out.size === 0) {
    const prefix = `o:${normalized}:`;
    for (const objectId of layer.getAllObjectIds()) {
      if (objectId.startsWith(prefix)) out.add(objectId);
    }
  }
  return [...out];
}

/** `regionV1.boxes` 数量预算；超过先退成每成员一个世界 AABB，仍超过就不写新版记录 */
export const CLOUD_REGION_MAX_BOXES = 256;

/**
 * 由目标元素集合构造 `regionV1(obb-union, origin:'members')`（§4.1 / §6.2）：
 * 每个已加载 objectId 一个「几何局部盒 × (global × instance)」OBB，只乘一次。
 * 任一成员没有已加载对象 = 范围不完整（coverage 不足）→ 返回 null，**不写新版记录**（漏斗会按 selectionBbox 补 legacy）。
 */
export function buildMembersRegionV1(params: {
  memberRefnos: readonly string[]
  layer: DTXLayer
  /** 成员的世界 AABB（盒数超预算时的保守退路） */
  getMemberAabb: (refno: string) => readonly number[] | null
  source: SourceStamp
}): RegionV1 | null {
  const { memberRefnos, layer } = params;
  if (memberRefnos.length === 0) return null;
  const perMember: { refno: string; objectIds: string[] }[] = [];
  let totalObjects = 0;
  for (const refno of memberRefnos) {
    const objectIds = resolveRegionObjectIdsForRefno(layer, refno);
    if (objectIds.length === 0) return null;
    perMember.push({ refno, objectIds });
    totalObjects += objectIds.length;
  }
  const boxes: ObbSnapshot[] = [];
  if (totalObjects <= CLOUD_REGION_MAX_BOXES) {
    const localBox = new Box3();
    const world = new Matrix4();
    for (const { refno, objectIds } of perMember) {
      for (const objectId of objectIds) {
        if (!layer.getObjectLocalBoxAndWorldMatrixInto(objectId, localBox, world)) return null;
        if (localBox.isEmpty()) return null;
        boxes.push(obbSnapshotFromLocalBoxAndMatrix(
          vec3ToTuple(localBox.min),
          vec3ToTuple(localBox.max),
          world.elements,
          objectId,
          normalizeRefnoKey(refno),
        ));
      }
    }
  } else {
    if (perMember.length > CLOUD_REGION_MAX_BOXES) return null;
    for (const { refno } of perMember) {
      const aabb = params.getMemberAabb(refno);
      if (!aabb || aabb.length < 6 || aabb.some((v) => !Number.isFinite(v))) return null;
      boxes.push({
        id: `aabb:${normalizeRefnoKey(refno)}`,
        memberRefno: normalizeRefnoKey(refno),
        center: [(aabb[0]! + aabb[3]!) / 2, (aabb[1]! + aabb[4]!) / 2, (aabb[2]! + aabb[5]!) / 2],
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize: [(aabb[3]! - aabb[0]!) / 2, (aabb[4]! - aabb[1]!) / 2, (aabb[5]! - aabb[2]!) / 2],
      });
    }
  }
  return {
    version: 1,
    space: 'world',
    source: params.source,
    origin: 'members',
    kind: 'obb-union',
    boxes,
  };
}

/** 世界凸单元的全部边（按顶点 id 对去重），bbox3d 模式画「同一范围体的真实盒边」（§4.7） */
function collectWorldCellEdgePositions(cells: readonly WorldCell[]): Float32Array {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const cell of cells) {
    for (const face of cell) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!;
        const b = face[(i + 1) % face.length]!;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a.p[0], a.p[1], a.p[2], b.p[0], b.p[1], b.p[2]);
      }
    }
  }
  return new Float32Array(out);
}

type CloudAnnotationVisual = {
  pin: LineSegments
  pinDashSize: number
  leader: AnnotationLeaderVisual
  outline: MeshLine
  bboxEdges: LineSegments
  labelWorldPos: Vector3
}

type RectAnnotationVisual = {
  /** 线框与小针都是 LineDashedMaterial（正常态 gapSize 0 等价实线），记录降级时改灰虚线 */
  box: LineSegments
  pin: LineSegments
  /** 正常态线色（rect 深灰、obb 青绿），降级恢复时回它 */
  lineColor: number
  /** 虚线节拍（世界单位）：线框按盒对角线、小针按针长 */
  boxDashSize: number
  pinDashSize: number
  leader: AnnotationLeaderVisual
  labelWorldPos: Vector3
}

/** rect / obb 在视口里的一条：与 CloudOverlayEl 一样带降级态，供 applyBindingDegrade 就地换外观 */
type BoxOverlayEl = {
  id: string
  worldPos: Vector3
  labelWorldPos: Vector3
  leader: AnnotationLeaderVisual
  box: LineSegments
  pin: LineSegments
  lineColor: number
  boxDashSize: number
  pinDashSize: number
  degrade: AnnotationDegrade | null
}

type RectOverlayEl = BoxOverlayEl
type ObbOverlayEl = BoxOverlayEl

type ScreenPoint = {
  x: number
  y: number
  visible: boolean
  ndcZ: number
}

type PendingCloudAnchor = {
  worldPos: Vec3
  refno?: string
  entityId?: string
}

type CloudLayout = {
  markerX: number
  markerY: number
  labelX: number
  cloudCenterX: number
  cloudCenterY: number
  labelY: number
  labelAlign: 'left' | 'right'
}

export type AnnotationOverlayKind = 'text' | 'cloud' | 'rect' | 'obb';
export type AnnotationLeaderKind = AnnotationOverlayKind;

export type AnnotationLabelClickState = {
  annotationId: string
  annotationType: AnnotationOverlayKind
  timestamp: number
};

export type AnnotationLabelClickResult = {
  action: 'activate' | 'edit'
  nextState: AnnotationLabelClickState | null
};

export type TextAnnotationMarkerClickState = {
  annotationId: string
  timestamp: number
};

export type TextAnnotationMarkerClickResult = {
  activate: boolean
  nextCollapsed: boolean | null
  nextState: TextAnnotationMarkerClickState | null
};

type AnnotationLeaderStyle = {
  color: number
  haloColor: number
  linewidth: number
  haloLinewidth: number
  opacity: number
  haloOpacity: number
}

type AnnotationLeaderVisual = {
  root: Group
  core: MeshLine
  halo: MeshLine
  coreGeometry: MeshLineGeometry
  haloGeometry: MeshLineGeometry
  coreMaterial: MeshLineMaterial
  haloMaterial: MeshLineMaterial
  /** ADR-0050 视口降级：上次应用到材质的降级态（applyLeaderDegrade 维护） */
  degrade?: AnnotationDegrade | null
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const IDENTITY_MATRIX_ELEMENTS: readonly number[] = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const EMPTY_BOUNDS: readonly number[] = Object.freeze([]);
/** 文字框还没排版（offsetWidth 为 0，如 happy-dom / 首帧）时用的兜底尺寸，只影响布局输入，不写回记录 */
const FALLBACK_LABEL_SIZE_PX = Object.freeze({ width: 240, height: 96 });

function measureLabelSize(el: HTMLElement): { width: number; height: number } {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!(width > 1) || !(height > 1)) return { ...FALLBACK_LABEL_SIZE_PX };
  return { width, height };
}

function escapeAnnotationLabelText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function vec3ToTuple(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const p of points) {
    const x = p[0];
    const y = p[1];
    const z = p[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) return null;
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

function parseRefnoFromDtxObjectId(objectId: string): string | null {
  if (!objectId || !objectId.startsWith('o:')) return null;
  const parts = objectId.split(':');
  return parts.length >= 3 ? (parts[1] ?? null) : null;
}

const PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES = 20;
const PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES = 5;
const PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT = 128;
const PIPE_STRUCTURE_DEFAULT_NOUNS = ['WALL', 'COLUMN'];
const OBJECT_TO_OBJECT_VERTEX_SAMPLE_LIMIT = 64;
const DIMENSION_REBUILD_NOTICE = '尺寸标注正在重构，净距计算结果暂不创建尺寸';

type PipeMeasureResult = {
  sourcePoint: Vector3
  targetPoint: Vector3
  distance: number
  targetObjectId: string
  targetRefno: string
}

type PipeMeasureSeed = {
  distance: number
  sourcePoint: Vec3
  targetPoint: Vec3
}

type PipeReferencePointInput = {
  sourceRefno: string
  segments?: {
    refno?: string | null
    arrive?: Vec3 | null
    leave?: Vec3 | null
  }[]
  refnoPosition?: Vec3 | null
  aabbCenter?: Vec3 | null
}

type ObjectMeasureCandidate = {
  refno: string
  objectId: string
  entityId: string
  hitPoint?: Vec3 | null
}

type PipeToPipeMeasureCandidate = ObjectMeasureCandidate

export type ApproxNearestBetweenObjectsInput = {
  sourceObjectId: string
  targetObjectId: string
  sourceHitPoint?: Vec3 | null
  targetHitPoint?: Vec3 | null
}

export type ApproxNearestBetweenObjectsResult = {
  sourcePoint: Vec3
  targetPoint: Vec3
  distance: number
}

function normalizeRefnoKey(raw: string): string {
  return String(raw || '').trim().replace(/\//g, '_');
}

function toBackendRefno(raw: string): string {
  const normalized = normalizeRefnoKey(raw);
  const matched = normalized.match(/^(\d+)_(\d+)$/);
  if (!matched) return normalized;
  return `${matched[1]}/${matched[2]}`;
}

function parseDbnumFromRefno(raw: string): number | null {
  const normalized = normalizeRefnoKey(raw);
  const head = normalized.split('_')[0] || '';
  const value = Number(head);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function pushVec3Unique(target: Vec3[], candidate: Vec3 | null | undefined): void {
  const next = asVec3(candidate);
  if (!next) return;
  for (const existing of target) {
    const dx = existing[0] - next[0];
    const dy = existing[1] - next[1];
    const dz = existing[2] - next[2];
    if (dx * dx + dy * dy + dz * dz < 1e-12) return;
  }
  target.push(next);
}

function pushVector3Unique(target: Vector3[], candidate: Vector3 | null | undefined): void {
  if (!candidate) return;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.z)) return;
  for (const existing of target) {
    if (existing.distanceToSquared(candidate) < 1e-12) return;
  }
  target.push(candidate.clone());
}

export function collectOrderedPipeReferencePointSeeds(input: PipeReferencePointInput): Vec3[] {
  const out: Vec3[] = [];
  const sourceRefno = normalizeRefnoKey(input.sourceRefno);
  if (sourceRefno && Array.isArray(input.segments)) {
    for (const segment of input.segments) {
      const segmentRefno = normalizeRefnoKey(String(segment?.refno || ''));
      if (!segmentRefno || segmentRefno !== sourceRefno) continue;
      pushVec3Unique(out, segment?.arrive ?? null);
      pushVec3Unique(out, segment?.leave ?? null);
    }
  }
  pushVec3Unique(out, input.refnoPosition ?? null);
  pushVec3Unique(out, input.aabbCenter ?? null);
  return out;
}

export function choosePipeMeasureBetterSeed(
  current: PipeMeasureSeed | null,
  candidate: PipeMeasureSeed | null,
): PipeMeasureSeed | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.distance < current.distance ? candidate : current;
}

function collectApproxNearestSeedPoints(
  layer: DTXLayer,
  objectId: string,
  options?: {
    hitPoint?: Vec3 | null
    vertexLimit?: number
  },
): Vector3[] {
  const out: Vector3[] = [];
  const hitPoint = asVec3(options?.hitPoint ?? null);
  if (hitPoint) {
    pushVector3Unique(out, new Vector3(hitPoint[0], hitPoint[1], hitPoint[2]));
  }

  const bbox = layer.getObjectBoundingBox(objectId);
  if (bbox && !bbox.isEmpty()) {
    const center = bbox.getCenter(new Vector3());
    pushVector3Unique(out, center);
    for (const x of [bbox.min.x, bbox.max.x]) {
      for (const y of [bbox.min.y, bbox.max.y]) {
        for (const z of [bbox.min.z, bbox.max.z]) {
          pushVector3Unique(out, new Vector3(x, y, z));
        }
      }
    }
  }

  const data = layer.getObjectGeometryData(objectId);
  if (!data) return out;

  const posAttr = data.geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!posAttr || posAttr.count <= 0) return out;

  const matrix = data.matrix;
  const maxVertices = Math.max(1, Math.floor(options?.vertexLimit ?? OBJECT_TO_OBJECT_VERTEX_SAMPLE_LIMIT));
  const vertexStep = Math.max(1, Math.floor(posAttr.count / maxVertices));
  const tmp = new Vector3();
  let sampled = 0;

  for (let index = 0; index < posAttr.count && sampled < maxVertices; index += vertexStep) {
    tmp.fromBufferAttribute(posAttr, index).applyMatrix4(matrix);
    pushVector3Unique(out, tmp);
    sampled += 1;
  }

  if (sampled < maxVertices && posAttr.count > 0) {
    tmp.fromBufferAttribute(posAttr, posAttr.count - 1).applyMatrix4(matrix);
    pushVector3Unique(out, tmp);
  }

  return out;
}

function buildObjectMeasurePairKey(sourceRefno: string, targetRefno: string): string {
  return [normalizeRefnoKey(sourceRefno), normalizeRefnoKey(targetRefno)].sort().join('::');
}

function resolveLoadedVisibleObjectCandidateByRefno(
  layer: DTXLayer,
  refno: string,
): ObjectMeasureCandidate | null {
  const normalizedRefno = normalizeRefnoKey(refno);
  if (!normalizedRefno) return null;

  const directObjectIds = layer.hasObject(normalizedRefno) ? [normalizedRefno] : [];
  const dbnum = parseDbnumFromRefno(normalizedRefno);
  const cachedObjectIds = dbnum ? resolveDtxObjectIdsByRefno(dbnum, normalizedRefno) : [];
  const fallbackObjectIds = layer.getAllObjectIds().filter((objectId) => {
    if (!objectId) return false;
    if (objectId === normalizedRefno) return true;
    return objectId.startsWith(`o:${normalizedRefno}:`);
  });
  const objectIds = [...directObjectIds, ...cachedObjectIds, ...fallbackObjectIds]
    .filter((objectId, index, array) => !!objectId && array.indexOf(objectId) === index);
  const visibleObjectId = objectIds.find((objectId) => layer.hasObject(objectId) && layer.isObjectVisible(objectId));
  if (!visibleObjectId) return null;

  return {
    refno: normalizedRefno,
    objectId: visibleObjectId,
    entityId: normalizedRefno,
    hitPoint: null,
  };
}

export function computeApproxNearestBetweenObjects(
  layer: DTXLayer,
  input: ApproxNearestBetweenObjectsInput,
): ApproxNearestBetweenObjectsResult | null {
  if (!layer) return null;
  if (!input.sourceObjectId || !input.targetObjectId) return null;
  if (input.sourceObjectId === input.targetObjectId) return null;

  const sourceSeeds = collectApproxNearestSeedPoints(layer, input.sourceObjectId, {
    hitPoint: input.sourceHitPoint ?? null,
  });
  const targetSeeds = collectApproxNearestSeedPoints(layer, input.targetObjectId, {
    hitPoint: input.targetHitPoint ?? null,
  });
  if (sourceSeeds.length === 0 || targetSeeds.length === 0) return null;

  let best: ApproxNearestBetweenObjectsResult | null = null;

  for (const sourceSeed of sourceSeeds) {
    const closest = layer.closestPointToObject(input.targetObjectId, sourceSeed);
    if (!closest) continue;
    const candidate: ApproxNearestBetweenObjectsResult = {
      sourcePoint: vec3ToTuple(sourceSeed),
      targetPoint: vec3ToTuple(closest.point),
      distance: closest.distance,
    };
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }

  for (const targetSeed of targetSeeds) {
    const closest = layer.closestPointToObject(input.sourceObjectId, targetSeed);
    if (!closest) continue;
    const candidate: ApproxNearestBetweenObjectsResult = {
      sourcePoint: vec3ToTuple(closest.point),
      targetPoint: vec3ToTuple(targetSeed),
      distance: closest.distance,
    };
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }

  return best;
}

function fromSeed(seed: PipeMeasureSeed, targetObjectId: string, targetRefno: string): PipeMeasureResult {
  return {
    distance: seed.distance,
    sourcePoint: new Vector3(...seed.sourcePoint),
    targetPoint: new Vector3(...seed.targetPoint),
    targetObjectId,
    targetRefno,
  };
}

function vec3ByMatrix(vec: Vec3, matrix: any): Vec3 {
  const p = new Vector3(vec[0], vec[1], vec[2]).applyMatrix4(matrix);
  return [p.x, p.y, p.z];
}

export function resolvePickedRefnoForFilter(
  pickedRefno: string,
  filter: string[],
  findNoun: (refno: string) => string | null = findNounByRefnoAcrossAllDbnos,
  findOwner: (refno: string) => string | null = findOwnerRefnoByTubi,
): string | null {
  let targetRefno = pickedRefno;
  let resolvedNoun: string | null = null;

  if (filter.includes('BRAN')) {
    const noun = findNoun(targetRefno);
    if (noun !== 'BRAN') {
      const branRefno = findOwner(targetRefno);
      if (branRefno) {
        targetRefno = branRefno;
        // 关键：owner 由 loader 侧保证为 BRAN，但 BRAN 本体可能未加载导致 findNoun 为空；
        // 在 BRAN 过滤下，这里直接视为满足过滤。
        resolvedNoun = 'BRAN';
      }
    }
  }

  if (filter.length > 0) {
    const noun = resolvedNoun || findNoun(targetRefno);
    if (!noun || !filter.includes(noun.toUpperCase())) {
      return null;
    }
  }

  return targetRefno;
}

export type BoxPickResolution =
  | { kind: 'ok'; refnos: string[] }
  | { kind: 'noun_unavailable' };

/**
 * 框选结果按 noun 过滤。
 *
 * 一个 noun 都解析不出来时返回 `noun_unavailable`：那说明 dbno 类型缓存还没就绪，
 * 不能和「框里确实没有目标类型」混为一谈——后者是空集，前者应该让用户重试。
 */
export function resolveBoxPickRefnos(
  selectedRefnos: string[],
  nounFilterUpper: string[],
  findNoun: (refno: string) => string | null = findNounByRefnoAcrossAllDbnos,
): BoxPickResolution {
  if (nounFilterUpper.length === 0 || selectedRefnos.length === 0) {
    return { kind: 'ok', refnos: selectedRefnos };
  }

  let nounResolved = false;
  const refnos = selectedRefnos.filter((refno) => {
    const noun = findNoun(refno);
    if (noun === null) return false;
    nounResolved = true;
    return nounFilterUpper.includes(noun.toUpperCase());
  });

  return nounResolved ? { kind: 'ok', refnos } : { kind: 'noun_unavailable' };
}

/** 光标射线上的一个可关联候选；`distance` 越小越靠近相机。 */
export type PickRefnoCandidate = {
  /** 过滤/上溯之后的目标 refno，例如 TUBI 上溯得到的 BRAN */
  refno: string
  /** 射线实际命中的元素 refno；目标本身没有几何时用它兜底高亮 */
  hitRefno: string
  distance: number
}

export type PickRefnoRayHit = {
  entityId: string
  objectId: string
  distance: number
}

/**
 * 把一次射线的全部命中压成候选列表：逐个过 noun 过滤解析 refno，
 * 同一 refno（例如同属一根 BRAN 的多段 TUBI）只保留最靠前的那次命中，按距离升序。
 */
export function buildPickRefnoCandidates(
  hits: PickRefnoRayHit[],
  filter: string[],
  resolve: (refno: string, filter: string[]) => string | null = resolvePickedRefnoForFilter,
): PickRefnoCandidate[] {
  const byRefno = new Map<string, PickRefnoCandidate>();

  for (const hit of hits) {
    const refno = resolve(hit.entityId, filter);
    if (!refno) continue;
    const existing = byRefno.get(refno);
    if (existing && existing.distance <= hit.distance) continue;
    byRefno.set(refno, { refno, hitRefno: hit.entityId, distance: hit.distance });
  }

  return Array.from(byRefno.values()).sort((a, b) => a.distance - b.distance);
}

/** 候选轮换下标，`step` 支持负数（Shift+Tab 反向）。 */
export function nextPickCandidateIndex(current: number, total: number, step = 1): number {
  if (total <= 0) return 0;
  return (((current + step) % total) + total) % total;
}

/** 光标是否仍停在上一次拾取的同一处——判定「原地重复点击 = 轮换」而非「新的一次拾取」。 */
export function isSamePickAnchor(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
  tolerancePx = 6,
): boolean {
  if (!previous) return false;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  return dx * dx + dy * dy <= tolerancePx * tolerancePx;
}

/**
 * 候选序列是否与上一次一致。
 *
 * 屏幕坐标相同不代表命中相同——相机在两次点击之间转过一点，同一像素下的构件就换了。
 * 因此轮换的前提是「位置没动」且「候选序列没变」。
 */
export function isSamePickCandidateSequence(
  previous: PickRefnoCandidate[],
  next: PickRefnoCandidate[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((item, index) => item.refno === next[index]?.refno);
}

function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(e.clientX - rect.left, e.clientY - rect.top);
}

function worldToOverlay(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): { x: number; y: number; visible: boolean } {
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  const visible = v.z >= -1 && v.z <= 1;

  const overlayRect = overlay.getBoundingClientRect();
  return { x: x + (rect.left - overlayRect.left), y: y + (rect.top - overlayRect.top), visible };
}

function worldToOverlayPoint(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  const overlayRect = overlay.getBoundingClientRect();
  return {
    x: x + (rect.left - overlayRect.left),
    y: y + (rect.top - overlayRect.top),
    visible: v.z >= -1 && v.z <= 1,
    ndcZ: v.z,
  };
}

function overlayToWorld(camera: any, canvas: HTMLCanvasElement, overlay: HTMLElement, x: number, y: number, ndcZ: number): Vector3 {
  const rect = canvas.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const localX = x - (rect.left - overlayRect.left);
  const localY = y - (rect.top - overlayRect.top);
  const ndc = new Vector3(
    (localX / rect.width) * 2 - 1,
    -((localY / rect.height) * 2 - 1),
    ndcZ,
  );
  return ndc.unproject(camera);
}

export function buildCloudBillboardPolyline(
  anchor: Vector3,
  right: Vector3,
  up: Vector3,
  width: number,
  height: number,
  segments = 16,
  worldPerPixel = 1,
  wavesPerEdge = 4,
): number[] {
  const safeRight = right.clone().normalize();
  const safeUp = up.clone().normalize();
  const safeWorldPerPixel = Math.max(worldPerPixel, Number.EPSILON);
  const minAmplitudeWorld = safeWorldPerPixel * 1;
  const maxAmplitudeWorld = safeWorldPerPixel * 6;
  const points = buildCloudWavyRectanglePoints2D(
    0,
    0,
    width,
    height,
    {
      segmentsPerEdge: segments,
      wavesPerEdge,
      amplitude: {
        ratio: 0.015,
        minPx: minAmplitudeWorld,
        maxPx: maxAmplitudeWorld,
      },
    },
  );
  const pts: number[] = [];
  for (const point of points) {
    const p = anchor.clone()
      .addScaledVector(safeRight, point.x)
      .addScaledVector(safeUp, point.y);
    pts.push(p.x, p.y, p.z);
  }
  return pts;
}

/** 屏幕空间贴合云线的默认内边距（px），保证目标轮廓与波浪线之间有呼吸感。 */
export const CLOUD_FIT_PADDING_PX = 14;

/**
 * 目标合并 AABB 的缓存时长（ms）。每帧现算太贵，只认创建时快照又无法自愈；
 * 折中为低频重解析——按需加载完成、模型版本切换后半秒内云线自动回到目标上。
 */
export const CLOUD_TARGET_BBOX_TTL_MS = 500;

export type FittedCloudRect = {
  centerX: number
  centerY: number
  widthPx: number
  heightPx: number
}

/**
 * 由目标合并 AABB 的屏幕投影角点求云线贴合矩形：2D 外接矩形向外扩 padding，
 * 再与最小尺寸（拖框尺寸兜底）取最大值，使绑定目标在任意相机角度下都被云线包住。
 * 返回 null 表示角点不可用（为空或均为非有限值），调用方应回退固定尺寸布局。
 */
export function computeFittedCloudRectFromCorners(
  corners: readonly { x: number; y: number }[],
  paddingPx: number,
  minSize?: { width?: number; height?: number },
): FittedCloudRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  if (maxX < minX || maxY < minY) return null;
  const safePadding = Math.max(paddingPx, 0);
  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    widthPx: Math.max(maxX - minX + safePadding * 2, minSize?.width ?? 0),
    heightPx: Math.max(maxY - minY + safePadding * 2, minSize?.height ?? 0),
  };
}

/** 贴合矩形的波峰数按边长像素折算，保持波浪间距的恒定像素观感（小尺寸退回旧观感 4 峰）。 */
export function cloudWavesPerEdgeForSizePx(widthPx: number, heightPx: number): number {
  return clamp(Math.round(((widthPx + heightPx) * 0.5) / 52), 4, 40);
}

const CLOUD_BBOX_EDGE_INDEX_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function boxCornersFromMinMaxVec(min: Vector3, max: Vector3): Vector3[] {
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ];
}

function pushWavyEdgeLineSegmentPairs(
  v0: Vector3,
  v1: Vector3,
  cameraWorldPos: Vector3,
  segments: number,
  waves: number,
  out: number[],
): void {
  const edge = new Vector3().subVectors(v1, v0);
  const len = edge.length();
  if (len < 1e-9) return;
  const edgeDir = edge.multiplyScalar(1 / len);
  const mid = new Vector3().addVectors(v0, v1).multiplyScalar(0.5);
  const toCam = new Vector3().subVectors(cameraWorldPos, mid);
  const binormal = new Vector3().crossVectors(edgeDir, toCam);
  if (binormal.lengthSq() < 1e-12) {
    binormal.crossVectors(edgeDir, new Vector3(0, 1, 0));
  }
  if (binormal.lengthSq() < 1e-12) {
    binormal.crossVectors(edgeDir, new Vector3(1, 0, 0));
  }
  binormal.normalize();
  const amp = clamp(len * 0.022, len * 0.004, len * 0.12);

  const base0 = new Vector3();
  const base1 = new Vector3();
  const p0 = new Vector3();
  const p1 = new Vector3();
  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    base0.copy(v0).lerp(v1, t0);
    base1.copy(v0).lerp(v1, t1);
    const w0 = Math.sin(t0 * Math.PI * 2 * waves) * amp;
    const w1 = Math.sin(t1 * Math.PI * 2 * waves) * amp;
    p0.copy(base0).addScaledVector(binormal, w0);
    p1.copy(base1).addScaledVector(binormal, w1);
    out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
  }
}

function buildWavySelectionBboxLinePositions(
  min: Vec3,
  max: Vec3,
  cameraWorldPos: Vector3,
  segmentsPerEdge = 10,
): Float32Array {
  const mn = new Vector3(min[0], min[1], min[2]);
  const mx = new Vector3(max[0], max[1], max[2]);
  const corners = boxCornersFromMinMaxVec(mn, mx);
  const waves = 3;
  const out: number[] = [];
  for (const [ia, ib] of CLOUD_BBOX_EDGE_INDEX_PAIRS) {
    pushWavyEdgeLineSegmentPairs(corners[ia]!, corners[ib]!, cameraWorldPos, segmentsPerEdge, waves, out);
  }
  return new Float32Array(out);
}

function updateCloudBboxLineSegmentsGeometry(line: LineSegments, positions: Float32Array): void {
  const geom = line.geometry as BufferGeometry;
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.computeBoundingSphere();
  // 材质是 LineDashedMaterial（降级时画虚线），lineDistance 属性要随位置一起重算
  line.computeLineDistances();
}

/** 波浪盒 / 盒边的虚线节拍：按几何包围球直径的 1.5%（一条边约 40 段）；还没有几何时回 0（实线灰） */
function dashSizeFromLineSegments(line: LineSegments): number {
  const radius = line.geometry.boundingSphere?.radius ?? 0;
  return Number.isFinite(radius) && radius > 0 ? radius * 2 * 0.015 : 0;
}

type CloudWavyRectangleOptions = {
  segmentsPerEdge: number;
  wavesPerEdge: number;
  amplitude: {
    ratio: number;
    minPx: number;
    maxPx: number;
  };
};

type CloudPoint2D = {
  x: number;
  y: number;
};

function buildCloudWavyRectanglePoints2D(
  cx: number,
  cy: number,
  width: number,
  height: number,
  options: CloudWavyRectangleOptions,
): CloudPoint2D[] {
  const safeWidth = Math.max(width, 12);
  const safeHeight = Math.max(height, 12);
  const halfWidth = safeWidth * 0.5;
  const halfHeight = safeHeight * 0.5;
  const segmentsPerEdge = Math.max(2, Math.floor(options.segmentsPerEdge));
  const wavesPerEdge = Math.max(1, Math.floor(options.wavesPerEdge));
  const corners = [
    { x: -halfWidth, y: -halfHeight }, // 上
    { x: halfWidth, y: -halfHeight }, // 右
    { x: halfWidth, y: halfHeight }, // 下
    { x: -halfWidth, y: halfHeight }, // 左
  ];
  const edgeNormals = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  const points: CloudPoint2D[] = [];

  for (let i = 0; i < corners.length; i += 1) {
    const start = corners[i]!;
    const end = corners[(i + 1) % corners.length]!;
    const normal = edgeNormals[i]!;
    const edgeLength = Math.hypot(end.x - start.x, end.y - start.y);
    const amp = clamp(edgeLength * options.amplitude.ratio, options.amplitude.minPx, options.amplitude.maxPx);
    for (let step = 0; step <= segmentsPerEdge; step += 1) {
      if (i > 0 && step === 0) {
        continue;
      }
      const t = step / segmentsPerEdge;
      const baseX = start.x + (end.x - start.x) * t;
      const baseY = start.y + (end.y - start.y) * t;
      const wave = Math.sin(t * Math.PI * 2 * wavesPerEdge + i * 0.35) * amp;
      points.push({
        x: cx + baseX + normal.x * wave,
        y: cy + baseY + normal.y * wave,
      });
    }
  }

  if (points.length > 0) {
    points.push({ ...points[0] });
  }

  return points;
}

export function computeCloudLayout(anchorScreen: ScreenPoint, screenOffset?: { x: number; y: number }, cloudSize?: { width: number; height: number }): CloudLayout {
  const width = clamp(cloudSize?.width ?? 120, 72, 220);
  const height = clamp(cloudSize?.height ?? 72, 48, 180);
  const offsetX = screenOffset?.x ?? width * 0.5 + 26;
  const offsetY = screenOffset?.y ?? -(height * 0.5 + 18);
  const cloudCenterX = anchorScreen.x + offsetX;
  const cloudCenterY = anchorScreen.y + offsetY;
  const markerX = cloudCenterX;
  const markerY = cloudCenterY;
  const labelAlign = offsetX >= 0 ? 'left' : 'right';
  const labelOffsetX = offsetX >= 0 ? width * 0.5 + 18 : -(width * 0.5 + 18);
  return {
    markerX,
    markerY,
    cloudCenterX,
    cloudCenterY,
    labelX: cloudCenterX + labelOffsetX,
    labelY: cloudCenterY,
    labelAlign,
  };
}

export function createCloudAnnotationRecordFromAnchorAndMarquee(params: {
  id?: string
  objectIds: string[]
  refnos?: string[]
  anchorWorldPos: Vec3
  anchorRefno?: string
  anchorScreen: ScreenPoint
  rect: { x1: number; y1: number; x2: number; y2: number }
  title: string
  description?: string
  createdAt?: number
  projectOverlayToWorld: (x: number, y: number, ndcZ: number) => Vec3
  /** 目标元素合并 AABB，供三维包围盒云线使用 */
  selectionBbox?: { min: Vec3; max: Vec3 }
  /** 带角色的关联结构；缺省时由 refnos / anchorRefno 归一推导 */
  bindings?: CloudElementBinding[]
  /** P1：文字框像素意图布局；给了就写进记录（`leaderEndWorldPos` 仍按旧逻辑双写） */
  labelLayoutV1?: CloudLabelLayoutV1
}): CloudAnnotationRecord {
  const marqueeCenter = {
    x: (params.rect.x1 + params.rect.x2) * 0.5,
    y: (params.rect.y1 + params.rect.y2) * 0.5,
  };
  const cloudSize = {
    width: clamp(params.rect.x2 - params.rect.x1, 72, 220),
    height: clamp(params.rect.y2 - params.rect.y1, 48, 180),
  };
  const screenOffset = {
    x: marqueeCenter.x - params.anchorScreen.x,
    y: marqueeCenter.y - params.anchorScreen.y,
  };
  const cloudLayout = computeCloudLayout(params.anchorScreen, screenOffset, cloudSize);
  const leaderEndWorldPos = params.projectOverlayToWorld(
    cloudLayout.labelX,
    cloudLayout.labelY,
    params.anchorScreen.ndcZ,
  );

  return {
    id: params.id ?? nowId('cloud'),
    objectIds: [...params.objectIds],
    anchorWorldPos: [...params.anchorWorldPos],
    anchorRefno: params.anchorRefno,
    leaderEndWorldPos,
    selectionBbox: params.selectionBbox
      ? { min: [...params.selectionBbox.min] as Vec3, max: [...params.selectionBbox.max] as Vec3 }
      : undefined,
    screenOffset,
    cloudSize,
    visible: true,
    title: params.title,
    description: params.description ?? '',
    createdAt: params.createdAt ?? Date.now(),
    refnos: params.refnos ? [...params.refnos] : [...params.objectIds],
    bindings: params.bindings ? [...params.bindings] : undefined,
    ...(params.labelLayoutV1
      ? {
        labelLayoutV1: {
          version: 1 as const,
          anchor: { ...params.labelLayoutV1.anchor, uv: [...params.labelLayoutV1.anchor.uv] as [number, number] },
          offsetPx: { ...params.labelLayoutV1.offsetPx },
        },
      }
      : {}),
  };
}

export function getDefaultTextAnnotationLabelWorldPos(worldPos: Vec3): Vec3 {
  return [
    worldPos[0] + 0.9,
    worldPos[1] + 0.6,
    worldPos[2] + 0.7,
  ];
}

export function shouldRenderTextAnnotationCard(collapsed?: boolean): boolean {
  return collapsed !== true;
}

export function toggleTextAnnotationCollapsed(collapsed?: boolean): boolean {
  return collapsed !== true;
}

/** @deprecated Use `resolveTextAnnotationMarkerSingleClickAction` instead. Kept for backward compat. */
export function resolveTextAnnotationMarkerClickAction(
  _prevState: TextAnnotationMarkerClickState | null,
  _annotationId: string,
  _timestamp: number,
  collapsed?: boolean,
  _thresholdMs = 400,
): TextAnnotationMarkerClickResult {
  return resolveTextAnnotationMarkerSingleClickAction(collapsed);
}

export function resolveTextAnnotationMarkerSingleClickAction(
  collapsed?: boolean,
): TextAnnotationMarkerClickResult {
  if (collapsed === true) {
    return {
      activate: true,
      nextCollapsed: false,
      nextState: null,
    };
  }

  return {
    activate: true,
    nextCollapsed: null,
    nextState: null,
  };
}

export function resolveTextAnnotationMarkerDoubleClickAction(
  collapsed?: boolean,
): TextAnnotationMarkerClickResult {
  return {
    activate: true,
    nextCollapsed: toggleTextAnnotationCollapsed(collapsed),
    nextState: null,
  };
}

export function isDtxInteractionReady(
  layer: Pick<DTXLayer, 'getStats' | 'getVisibleObjectIds' | 'objectCount'> | null | undefined,
): boolean {
  if (!layer) return false;
  try {
    const stats = layer.getStats();
    if (stats.compiled === true) return true;
    if (stats.totalObjects > 0) return true;
    if (layer.objectCount > 0) return true;
    return layer.getVisibleObjectIds().length > 0;
  } catch {
    return false;
  }
}

export function buildAnnotationLeaderStyle(kind: AnnotationLeaderKind): AnnotationLeaderStyle {
  const { style } = useAnnotationStyleStore();
  const leaderStyle = style[kind];
  return {
    color: leaderStyle.color,
    haloColor: leaderStyle.haloColor,
    linewidth: leaderStyle.lineWidth,
    haloLinewidth: leaderStyle.haloLineWidth,
    opacity: leaderStyle.opacity,
    haloOpacity: leaderStyle.haloOpacity,
  };
}

function buildAnnotationLeaderPositions(anchorWorldPos: Vector3, labelWorldPos: Vector3): number[] {
  return [
    anchorWorldPos.x, anchorWorldPos.y, anchorWorldPos.z,
    labelWorldPos.x, labelWorldPos.y, labelWorldPos.z,
  ];
}

function setAnnotationLeaderResolution(
  leader: AnnotationLeaderVisual,
  width: number,
  height: number,
): void {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  leader.coreMaterial.resolution.set(safeWidth, safeHeight);
  leader.haloMaterial.resolution.set(safeWidth, safeHeight);
}

function createAnnotationLeader(
  kind: AnnotationLeaderKind,
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
  resolution?: { width: number; height: number },
): AnnotationLeaderVisual {
  const style = buildAnnotationLeaderStyle(kind);
  const positions = buildAnnotationLeaderPositions(anchorWorldPos, labelWorldPos);
  const haloGeometry = new MeshLineGeometry();
  haloGeometry.setPoints(positions);
  const coreGeometry = new MeshLineGeometry();
  coreGeometry.setPoints(positions);
  const haloMaterial = new MeshLineMaterial({
    color: style.haloColor,
    lineWidth: style.haloLinewidth,
    transparent: true,
    opacity: style.haloOpacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const coreMaterial = new MeshLineMaterial({
    color: style.color,
    lineWidth: style.linewidth,
    transparent: true,
    opacity: style.opacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const halo = new MeshLine(haloGeometry, haloMaterial);
  const core = new MeshLine(coreGeometry, coreMaterial);
  halo.renderOrder = 900;
  core.renderOrder = 901;
  halo.frustumCulled = false;
  core.frustumCulled = false;
  halo.raycast = () => {};
  core.raycast = () => {};
  const root = new Group();
  root.renderOrder = 901;
  root.add(halo, core);
  const leader = {
    root,
    core,
    halo,
    coreGeometry,
    haloGeometry,
    coreMaterial,
    haloMaterial,
  };
  setAnnotationLeaderResolution(leader, resolution?.width ?? 1, resolution?.height ?? 1);
  return leader;
}

function createTextAnnotationLeader(
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
  resolution?: { width: number; height: number },
): AnnotationLeaderVisual {
  return createAnnotationLeader('text', anchorWorldPos, labelWorldPos, resolution);
}

function updateLeaderGeometry(
  leader: AnnotationLeaderVisual,
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
): void {
  const positions = buildAnnotationLeaderPositions(anchorWorldPos, labelWorldPos);
  leader.haloGeometry.setPoints(positions);
  leader.coreGeometry.setPoints(positions);
}

export function buildAnnotationLabelStyleText(): string {
  return [
    'position:absolute',
    'transform:translate(-50%,-110%)',
    'pointer-events:auto',
    'cursor:pointer',
    'user-select:none',
    'z-index:910',
    'max-width:280px',
    'padding:10px 12px',
    'border-radius:14px',
    'border:1px solid rgba(148,163,184,0.45)',
    'background:rgba(15,23,42,0.92)',
    'color:#e2e8f0',
    'box-shadow:0 14px 32px rgba(15,23,42,0.35)',
    'backdrop-filter:blur(10px)',
    'white-space:pre-wrap',
    'font-family:\'Segoe UI\',\'PingFang SC\',sans-serif',
    'line-height:1.45',
  ].join(';');
}

export function buildAnnotationLabelHtml(title: string, description: string): string {
  const safeTitle = escapeAnnotationLabelText(title);
  const safeDescription = escapeAnnotationLabelText(description || '');
  const descriptionHtml = safeDescription
    ? `<div data-role="annotation-description" style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(226,232,240,0.9);">${safeDescription}</div>`
    : '';
  return [
    `<div data-role="annotation-title" style="font-weight:700;font-size:13px;line-height:1.3;color:#f8fafc;">${safeTitle}</div>`,
    descriptionHtml,
  ].join('');
}

export function buildTextAnnotationMarkerStyleText(collapsed: boolean, color = '#ef4444'): string {
  if (collapsed) {
    return [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'cursor:pointer',
      'z-index:920',
      'width:22px',
      'height:28px',
      'filter:drop-shadow(0 4px 8px rgba(15,23,42,0.28))',
      `color:${color}`,
    ].join(';');
  }
  return [
    'position:absolute',
    'transform:translate(-50%,-100%)',
    'pointer-events:auto',
    'user-select:none',
    'cursor:pointer',
    'z-index:920',
    'width:18px',
    'height:24px',
    'filter:drop-shadow(0 4px 8px rgba(15,23,42,0.24))',
    `color:${color}`,
  ].join(';');
}

/**
 * 图钉的降级外观（ADR-0050 视口降级）：`degrade` 非空 → 灰填充 + 深灰虚线描边；`badge` 为 true 时再在图钉左上角挂一枚小徽标。
 * 云线的图钉不带徽标（云线的徽标挂在轮廓参考框左上角，一条记录只出一枚）。
 */
export type MarkerDegradeOptions = {
  degrade: AnnotationDegrade | null
  badge: boolean
}

export function buildTextAnnotationMarkerHtml(
  glyph: string,
  collapsed: boolean,
  degradeOptions: MarkerDegradeOptions | null = null,
): string {
  const degrade = degradeOptions?.degrade ?? null;
  const paint = pinSvgPaint(degrade);
  // 徽标贴图钉左上角外侧：右缘离图钉左缘 4px，顶部与字泡同高
  const badgeHtml = degrade && degradeOptions?.badge
    ? buildAnnotationDegradeBadgeHtml(degrade, 'position:absolute;left:-4px;top:-6px;transform:translate(-100%,0);pointer-events:none;')
    : '';
  if (collapsed) {
    return [
      '<div data-marker-kind="location-pin" style="position:relative;width:22px;height:28px;">',
      '<svg viewBox="0 0 24 32" width="22" height="28" aria-hidden="true">',
      `<path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 7.6 8.5 16.1 9.6 17.1a1.3 1.3 0 0 0 1.8 0c1.1-1 9.6-9.5 9.6-17.1C22.5 6.2 17.8 1.5 12 1.5Z" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.4"${paint.dashAttr}/>`,
      '<circle cx="12" cy="12" r="4.2" fill="#ffffff"/>',
      '</svg>',
      badgeHtml,
      '</div>',
    ].join('');
  }
  return [
    '<div data-marker-kind="push-pin" style="position:relative;width:18px;height:24px;">',
    '<svg viewBox="0 0 18 24" width="18" height="24" aria-hidden="true">',
    `<path d="M6 2.5h6l-.8 4.2 2.5 2.5v1.5H4.3V9.2l2.5-2.5L6 2.5Z" fill="${paint.fill}" stroke="${paint.stroke}" stroke-width="1.1" stroke-linejoin="round"${paint.dashAttr}/>`,
    `<path d="M9 10.8V21.8" stroke="${degrade ? paint.stroke : '#ffffff'}" stroke-width="1.4" stroke-linecap="round"${paint.dashAttr}/>`,
    `<circle cx="9" cy="22.4" r="1.2" fill="${paint.fill}"/>`,
    '</svg>',
    `<div data-role="annotation-glyph" style="position:absolute;right:-10px;top:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:${paint.bubbleBackground};color:#f8fafc;font:700 10px/16px 'Segoe UI',sans-serif;text-align:center;">${escapeAnnotationLabelText(glyph)}</div>`,
    badgeHtml,
    '</div>',
  ].join('');
}

export function buildInlineAnnotationCardHtml(kindLabel: string, title: string, description: string): string {
  const safeTitle = escapeAnnotationLabelText(title);
  const safeDescription = escapeAnnotationLabelText(description || '');
  const safeKindLabel = escapeAnnotationLabelText(kindLabel);
  return [
    '<div data-role="annotation-card-shell" style="display:flex;flex-direction:column;gap:8px;">',
    '<div data-role="annotation-drag-handle" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:grab;color:rgba(226,232,240,0.8);font-size:11px;letter-spacing:0.04em;text-transform:uppercase;">',
    `<span>${safeKindLabel}</span>`,
    '<span style="display:inline-flex;gap:3px;"><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span></span>',
    '</div>',
    `<input data-role="annotation-title-input" value="${safeTitle}" placeholder="输入批注标题" style="height:28px;border:none;outline:none;background:transparent;color:#f8fafc;font:700 13px/1.3 'Segoe UI','PingFang SC',sans-serif;padding:0;" />`,
    `<textarea data-role="annotation-description-input" placeholder="输入批注描述（可选）" style="min-height:52px;border:none;outline:none;resize:none;background:transparent;color:rgba(226,232,240,0.92);font:400 12px/1.5 'Segoe UI','PingFang SC',sans-serif;padding:0;">${safeDescription}</textarea>`,
    '</div>',
  ].join('');
}

export function buildTextAnnotationCardHtml(title: string, description: string): string {
  return buildInlineAnnotationCardHtml('批注', title, description);
}

export function resolveAnnotationLabelClickAction(
  prevState: AnnotationLabelClickState | null,
  annotationType: AnnotationOverlayKind,
  annotationId: string,
  timestamp: number,
  thresholdMs = 400,
): AnnotationLabelClickResult {
  const isDoubleClick = !!prevState
    && prevState.annotationId === annotationId
    && prevState.annotationType === annotationType
    && timestamp - prevState.timestamp < thresholdMs;

  if (isDoubleClick) {
    return {
      action: 'edit',
      nextState: null,
    };
  }

  return {
    action: 'activate',
    nextState: {
      annotationId,
      annotationType,
      timestamp,
    },
  };
}

function resolveCloudAnchorFromMarqueeCenter(
  viewer: DtxViewer | null,
  canvas: HTMLCanvasElement,
  centerCanvas: { x: number; y: number },
  selectedRefnos: string[],
  selection: DTXSelectionController | null,
  layer: DTXLayer | null,
): Vector3 | null {
  if (!viewer || !selection || !layer || selectedRefnos.length === 0) return null;
  const hit = selection.pickPoint(new Vector2(centerCanvas.x, centerCanvas.y));
  if (!hit) return null;

  const hitRefno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId;
  if (selectedRefnos.includes(hitRefno)) {
    return hit.point.clone();
  }

  const rect = canvas.getBoundingClientRect();
  const ndc = new Vector2((centerCanvas.x / rect.width) * 2 - 1, -(centerCanvas.y / rect.height) * 2 + 1);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, viewer.camera);
  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;

  let closest: { point: Vector3; distance: number } | null = null;
  for (const refno of selectedRefnos) {
    const objectId = refno.startsWith('o:') ? refno : `o:${refno}:0`;
    const picked = layer.raycastObject(objectId, origin, direction);
    if (!picked) continue;
    if (!closest || picked.distance < closest.distance) {
      closest = { point: picked.point.clone(), distance: picked.distance };
    }
  }
  return closest?.point ?? null;
}

function disposeObject3d(obj: any) {
  if (!obj) return;
  obj.traverse?.((node: any) => {
    try {
      node.geometry?.dispose?.();
    } catch {
      // ignore
    }
    try {
      if (node.material) {
        if (Array.isArray(node.material)) {
          for (const m of node.material) m?.dispose?.();
        } else {
          node.material.dispose?.();
        }
      }
    } catch {
      // ignore
    }
  });
}

function clearGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3d(child as any);
  }
}

function buildWireBoxGeometryFromBox3(box: Box3): BufferGeometry {
  const min = box.min;
  const max = box.max;

  const corners = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ];

  const edgePairs = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];

  const positions: number[] = [];
  for (let i = 0; i < edgePairs.length; i += 2) {
    const a = corners[edgePairs[i]!]!;
    const b = corners[edgePairs[i + 1]!]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

function buildWireBoxGeometryFromCorners(corners: Vec3[]): BufferGeometry | null {
  if (corners.length !== 8) return null;
  const vs = corners.map((c) => new Vector3(c[0], c[1], c[2]));
  const edgePairs = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  const positions: number[] = [];
  for (let i = 0; i < edgePairs.length; i += 2) {
    const a = vs[edgePairs[i]!]!;
    const b = vs[edgePairs[i + 1]!]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

/**
 * rect / obb 线框的几何来源（方案 §7，开关 `annotationSharedRegion`）：
 * 记录带 `origin:'members'` 的 `obb-union` 范围体且覆盖全部成员 → 每个成员对象一个真实放置盒（多成员多盒，不合并）；
 * 否则（旧记录 legacy-snapshot / 开关关 / 范围与绑定不一致）→ 照旧画 `obb.corners` 的单个盒。
 */
function buildBoxAnnotationWireGeometry(record: RectAnnotationRecord | ObbAnnotationRecord): BufferGeometry | null {
  const region = record.regionV1;
  const memberRefnos = record.bindings
    ? record.bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno)
    : (record.refnos ?? record.objectIds);
  if (
    isCloudRenderFlagEnabled('annotationSharedRegion')
    && region
    && region.origin === 'members'
    && region.kind === 'obb-union'
    && region.boxes.length > 0
    && regionCoversMembers(region, memberRefnos)
  ) {
    const positions: number[] = [];
    for (const box of region.boxes) {
      const corners = obbSnapshotCorners(box);
      for (const [a, b] of CLOUD_BBOX_EDGE_INDEX_PAIRS) {
        const p = corners[a]!;
        const q = corners[b]!;
        positions.push(p[0], p[1], p[2], q[0], q[1], q[2]);
      }
    }
    if (positions.length >= 6 && positions.every(Number.isFinite)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      return g;
    }
  }
  return buildWireBoxGeometryFromCorners(record.obb.corners as unknown as Vec3[]);
}

function buildPinMarkerGeometry(anchor: Vector3, size: number): BufferGeometry {
  const headZ = anchor.z + Math.max(size * 0.24, 0.02);
  const radius = Math.max(size * 0.12, 0.02);
  const positions = new Float32Array([
    anchor.x, anchor.y, anchor.z,
    anchor.x, anchor.y, headZ,

    anchor.x - radius, anchor.y, headZ,
    anchor.x, anchor.y + radius, headZ,

    anchor.x, anchor.y + radius, headZ,
    anchor.x + radius, anchor.y, headZ,

    anchor.x + radius, anchor.y, headZ,
    anchor.x, anchor.y - radius, headZ,

    anchor.x, anchor.y - radius, headZ,
    anchor.x - radius, anchor.y, headZ,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  return g;
}

function getCanvasResolution(canvas?: HTMLCanvasElement | null): { width: number; height: number } {
  return {
    width: canvas?.clientWidth || canvas?.width || 1,
    height: canvas?.clientHeight || canvas?.height || 1,
  };
}

function createCloudAnnotationVisual(
  record: CloudAnnotationRecord,
  resolution?: { width: number; height: number },
): CloudAnnotationVisual {
  const anchor = new Vector3(...record.anchorWorldPos);
  const labelWorldPos = record.leaderEndWorldPos
    ? new Vector3(...record.leaderEndWorldPos)
    : anchor.clone().add(new Vector3(0.4, 0.4, 0.3));
  const distance = Math.max(anchor.distanceTo(labelWorldPos), 0.12);
  const pinGeometry = buildPinMarkerGeometry(anchor, distance);

  const cloudSt = buildAnnotationLeaderStyle('cloud');
  // 小针与盒边用 LineDashedMaterial：正常态 gapSize 0 等价实线，记录降级（ADR-0050）时只改 dash / gap 就是虚线，不必换材质
  const pinMaterial = new LineDashedMaterial({ color: cloudSt.color, dashSize: 1, gapSize: 0 });
  const outlineGeometry = new MeshLineGeometry();
  const outlineMaterial = new MeshLineMaterial({
    color: cloudSt.color,
    lineWidth: cloudSt.linewidth,
    transparent: true,
    opacity: cloudSt.opacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(resolution?.width ?? 1, resolution?.height ?? 1),
  });
  (pinMaterial as any).depthTest = false;
  const outline = new MeshLine(outlineGeometry, outlineMaterial);
  outline.frustumCulled = false;
  outline.renderOrder = 901;

  const bboxGeom = new BufferGeometry();
  bboxGeom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3));
  // 与 billboard 云线保持同一套遮挡语义：批注必须确定性地指认目标，被前景管道挡住
  // 的云线等于没有批注；空间纵深由 bbox3d 自身的透视形变表达，不依赖深度遮挡。
  const bboxMat = new LineDashedMaterial({
    color: cloudSt.color,
    transparent: true,
    opacity: cloudSt.opacity,
    depthTest: false,
    depthWrite: false,
    dashSize: 1,
    gapSize: 0,
  });
  const bboxEdges = new LineSegments(bboxGeom, bboxMat);
  bboxEdges.renderOrder = 902;
  bboxEdges.frustumCulled = false;
  bboxEdges.computeLineDistances();

  const pin = new LineSegments(pinGeometry, pinMaterial);
  pin.computeLineDistances();
  const leader = createAnnotationLeader('cloud', anchor, labelWorldPos, resolution);
  pin.renderOrder = 901;

  outlineGeometry.setPoints([0, 0, 0, 0, 0, 0]);

  return { pin, pinDashSize: pinDashSizeFromDistance(distance), leader, outline, bboxEdges, labelWorldPos };
}

const RECT_ANNOTATION_LINE_COLOR = 0x111827;
const OBB_ANNOTATION_LINE_COLOR = 0x0f766e;

/**
 * rect / obb 的线框 + 小针：LineDashedMaterial（正常态 gapSize 0 等价实线），记录降级（ADR-0050）时只改 dash / gap 就是虚线，不必换材质。
 * 与云线 / 尺寸系统同一套遮挡语义：批注线不参与深度测试。
 */
function createBoxAnnotationLines(
  boxGeometry: BufferGeometry,
  pinGeometry: BufferGeometry,
  color: number,
): { box: LineSegments; pin: LineSegments } {
  const boxMaterial = new LineDashedMaterial({ color, dashSize: 1, gapSize: 0, depthTest: false });
  const pinMaterial = new LineDashedMaterial({ color, dashSize: 1, gapSize: 0, depthTest: false });
  const box = new LineSegments(boxGeometry, boxMaterial);
  const pin = new LineSegments(pinGeometry, pinMaterial);
  box.computeLineDistances();
  pin.computeLineDistances();
  box.geometry.computeBoundingSphere();
  box.renderOrder = 900;
  pin.renderOrder = 901;
  return { box, pin };
}

/** rect / obb 一条记录的降级外观：线框 / 小针灰虚线 + 引线灰虚线；恢复回各自的正常线色 */
function applyBoxOverlayDegrade(entry: BoxOverlayEl, kind: 'rect' | 'obb', degrade: AnnotationDegrade | null): void {
  entry.degrade = degrade;
  applyDashedLineDegrade(entry.box.material as LineDashedMaterial, entry.lineColor, degrade, entry.boxDashSize);
  applyDashedLineDegrade(entry.pin.material as LineDashedMaterial, entry.lineColor, degrade, entry.pinDashSize);
  applyLeaderDegrade(entry.leader, buildAnnotationLeaderStyle(kind).color, degrade);
}

function createRectAnnotationVisual(
  record: RectAnnotationRecord,
  resolution?: { width: number; height: number },
): RectAnnotationVisual | null {
  const { obb, anchorWorldPos } = record;
  // 线框来源：共享范围体的真实放置盒（P3）或旧 `obb.corners`
  const boxGeometry = buildBoxAnnotationWireGeometry(record);
  if (!boxGeometry) return null;

  const anchor = new Vector3(...anchorWorldPos);
  const halfSize = new Vector3(...obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildPinMarkerGeometry(anchor, boxRadius);

  const labelAnchor = anchor.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));

  const { box, pin } = createBoxAnnotationLines(boxGeometry, pinGeometry, RECT_ANNOTATION_LINE_COLOR);
  const leader = createAnnotationLeader('rect', anchor, labelAnchor, resolution);

  return {
    box,
    pin,
    lineColor: RECT_ANNOTATION_LINE_COLOR,
    boxDashSize: dashSizeFromLineSegments(box),
    pinDashSize: pinDashSizeFromDistance(boxRadius),
    leader,
    labelWorldPos: labelAnchor,
  };
}

function resolveObbAnnotationAnchorWorldPos(record: ObbAnnotationRecord): Vector3 {
  if (record.anchor.kind === 'corner') {
    const corner = record.obb.corners[record.anchor.cornerIndex];
    if (corner) {
      return new Vector3(...corner);
    }
  }
  const box = new Box3();
  for (const corner of record.obb.corners) {
    box.expandByPoint(new Vector3(...corner));
  }
  return topCenterFromBox3(box);
}

function createObbAnnotationVisual(
  record: ObbAnnotationRecord,
  resolution?: { width: number; height: number },
): RectAnnotationVisual | null {
  const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(record);
  // 线框来源：共享范围体的真实放置盒（P3）或旧 `obb.corners`
  const boxGeometry = buildBoxAnnotationWireGeometry(record);
  if (!boxGeometry) return null;
  const halfSize = new Vector3(...record.obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildPinMarkerGeometry(anchorWorldPos, boxRadius);
  const labelWorldPos = new Vector3(...record.labelWorldPos);

  const { box, pin } = createBoxAnnotationLines(boxGeometry, pinGeometry, OBB_ANNOTATION_LINE_COLOR);
  const leader = createAnnotationLeader('obb', anchorWorldPos, labelWorldPos, resolution);

  return {
    box,
    pin,
    lineColor: OBB_ANNOTATION_LINE_COLOR,
    boxDashSize: dashSizeFromLineSegments(box),
    pinDashSize: pinDashSizeFromDistance(boxRadius),
    leader,
    labelWorldPos,
  };
}

export function createRectAnnotationRecordFromObb(params: {
  id?: string
  objectIds: string[]
  refnos?: string[]
  obb: Obb
  title: string
  description?: string
  createdAt?: number
  /** P3 共享范围体（方案 §7）：给了就写进记录；`obb` 仍按旧含义双写 */
  regionV1?: RegionV1
}): RectAnnotationRecord {
  const center = new Vector3(...params.obb.center);
  const halfSize = new Vector3(...params.obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const leaderEnd = center.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));

  return {
    id: params.id ?? nowId('rect'),
    objectIds: [...params.objectIds],
    obb: params.obb,
    anchorWorldPos: [...params.obb.center] as Vec3,
    leaderEndWorldPos: vec3ToTuple(leaderEnd),
    visible: true,
    title: params.title,
    description: params.description ?? '',
    createdAt: params.createdAt ?? Date.now(),
    refnos: params.refnos ? [...params.refnos] : [...params.objectIds],
    ...(params.regionV1 ? { regionV1: params.regionV1 } : {}),
  };
}

function computeAabbObbFromBox3(box: Box3): Obb {
  const center = new Vector3();
  box.getCenter(center);
  const size = new Vector3();
  box.getSize(size);
  const half = size.multiplyScalar(0.5);

  const corners: Vec3[] = [
    [box.min.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.max.z],
    [box.min.x, box.max.y, box.max.z],
  ];

  return {
    center: [center.x, center.y, center.z],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfSize: [half.x, half.y, half.z],
    corners: corners as any,
  };
}

function topCenterFromBox3(box: Box3): Vector3 {
  const center = new Vector3();
  box.getCenter(center);
  return new Vector3(center.x, center.y, box.max.z);
}

function ensureDiv(parent: HTMLElement, className: string, styleText: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.style.cssText = styleText;
  parent.appendChild(el);
  return el;
}

function makeMarkerEl(parent: HTMLElement, text: string, color: string): HTMLDivElement {
  // SolveSpace 风格：透明背景、纯文本+描边、无圆形气泡
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'z-index:920',
      `color:${color}`,
      'font-family:\'Roboto Mono\',\'Consolas\',monospace',
      'font-size:12px',
      'font-weight:700',
      'background:transparent',
      'box-shadow:none',
      'border:none',
      'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000',
    ].join(';')
  );
  el.textContent = text;
  return el;
}

const MARKER_NORMAL_TITLE = '单击选中，双击展开/收起';

function makeTextAnnotationMarkerEl(
  parent: HTMLElement,
  glyph: string,
  collapsed: boolean,
  degradeOptions: MarkerDegradeOptions | null = null,
): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    buildTextAnnotationMarkerStyleText(collapsed),
  );
  el.innerHTML = buildTextAnnotationMarkerHtml(glyph, collapsed, degradeOptions);
  markPinElDegrade(el, degradeOptions?.degrade ?? null, MARKER_NORMAL_TITLE);
  el.setAttribute('aria-label', '文字批注图钉，单击选中，双击展开或收起');
  if (collapsed) {
    el.dataset.markerKind = 'location-pin';
  } else {
    el.dataset.markerKind = 'push-pin';
  }
  return el;
}

/** 图钉降级态变了就原地重画 SVG（元素与事件监听不动）；没变直接返回 false */
function repaintMarkerDegrade(entry: LabelEl, degrade: AnnotationDegrade | null): boolean {
  const meta = entry.marker;
  if (!meta || sameDegrade(meta.degrade, degrade)) return false;
  meta.degrade = degrade;
  entry.el.innerHTML = buildTextAnnotationMarkerHtml(meta.glyph, meta.collapsed, { degrade, badge: meta.kind !== 'cloud' });
  markPinElDegrade(entry.el, degrade, MARKER_NORMAL_TITLE);
  return true;
}

function makeLabelEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    buildAnnotationLabelStyleText()
  );
  el.innerHTML = buildAnnotationLabelHtml(title, description);
  return el;
}

function makeTextAnnotationCardEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  return makeInlineAnnotationCardEl(parent, '批注', title, description);
}

function makeInlineAnnotationCardEl(
  parent: HTMLElement,
  kindLabel: string,
  title: string,
  description: string,
): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    buildAnnotationLabelStyleText(),
  );
  el.innerHTML = buildInlineAnnotationCardHtml(kindLabel, title, description);
  return el;
}

export function useDtxTools(options: {
  dtxViewerRef: Ref<DtxViewer | null>
  dtxLayerRef: Ref<DTXLayer | null>
  selectionRef: Ref<DTXSelectionController | null>
  overlayContainerRef: Ref<HTMLElement | null>
  store: ReturnType<typeof useToolStore>
  compatViewerRef: Ref<DtxCompatViewer | null>
  requestRender?: (() => void) | null
  suppressStoreOverlays?: boolean
}) {
  const { dtxViewerRef, dtxLayerRef, selectionRef, overlayContainerRef, store, compatViewerRef } = options;
  const requestRender = options.requestRender ?? null;
  const suppressStoreOverlays = options.suppressStoreOverlays === true;

  const selectionStore = useSelectionStore();
  const reviewStore = useReviewStore();
  const { captureAndUpload } = useScreenshot();
  const userStore = useUserStore();
  const unitSettings = useUnitSettingsStore();
  const annotationStyleStore = useAnnotationStyleStore();
  // ADR-0050：批注关联的失效解析表（只读）；missing / stale 的记录在视口降级为灰虚线 + 左上角小徽标
  const bindingResolve = useAnnotationBindingResolve();
  const readyRevision = ref(0);

  /** 共享范围体（方案 §7 / §8）：成员 refno → 已加载对象的真实放置盒；拿不到几何回 null（不用子集冒充） */
  function resolveMemberRegionBoxes(refno: string): ObbSnapshot[] | null {
    const layer = dtxLayerRef.value;
    if (!layer) return null;
    const region = buildMembersRegionV1({
      memberRefnos: [refno],
      layer,
      getMemberAabb: (r) => compatViewerRef.value?.scene.getAABB([r]) ?? null,
      source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    });
    return region && region.kind === 'obb-union' ? [...region.boxes] : null;
  }
  // 重绑 member 时 store 用它给 `origin:'members'` 范围体补盒（原子更新绑定 + 范围 + 兼容字段）
  store.setAnnotationRegionMemberBoxResolver(resolveMemberRegionBoxes);

  /** rect / obb 新建（开关 `annotationSharedRegion`）：目标集合 → `regionV1(obb-union, origin:'members')`；范围不完整回 null 不写 */
  function buildSharedRegionForMembers(memberRefnos: readonly string[]): RegionV1 | null {
    if (!isCloudRenderFlagEnabled('annotationSharedRegion')) return null;
    const layer = dtxLayerRef.value;
    if (!layer) return null;
    return buildMembersRegionV1({
      memberRefnos,
      layer,
      getMemberAabb: (refno) => compatViewerRef.value?.scene.getAABB([refno]) ?? null,
      source: buildCloudSourceStamp(memberRefnos, layer),
    });
  }

  let lastAnnotationLabelClick: AnnotationLabelClickState | null = null;
  let textAnnotationMarkerClickTimer: ReturnType<typeof setTimeout> | null = null;

  // pick_refno：仅在拾取会话内维护，不写入 store
  const pickedHighlightByBran = new Map<string, string>();
  const pickedHighlightPinned = new Set<string>(); // 已在外部选中的对象，不应被拾取会话取消选中
  let lastAppliedPickHighlights: string[] = [];

  // pick_refno 候选轮换：一次点击命中的全部重叠构件 + 当前预览下标
  const pickCandidates = ref<PickRefnoCandidate[]>([]);
  const pickCandidateIndex = ref(0);
  let pickCandidateAnchor: { x: number; y: number } | null = null;
  let pickCandidatePreview: LineSegments | null = null;

  const ready = computed(() => {
    void readyRevision.value;
    return isDtxInteractionReady(dtxLayerRef.value);
  });

  const pointToObjectStart = ref<MeasurementPoint | null>(null);
  const objectToObjectSourceCandidate = ref<ObjectMeasureCandidate | null>(null);
  const objectToObjectTargetCandidate = ref<ObjectMeasureCandidate | null>(null);
  const objectToObjectBusy = ref(false);
  const objectToObjectStatus = ref('');
  const lastAppliedObjectMeasurePairKey = ref<string | null>(null);
  const pipeMeasureBusy = ref(false);
  const pipeMeasureStatus = ref<string>('');
  const pipeToPipeSourceCandidate = ref<PipeToPipeMeasureCandidate | null>(null);

  function activateAnnotation(kind: AnnotationOverlayKind, id: string) {
    store.activeAnnotationId.value = kind === 'text' ? id : null;
    store.activeCloudAnnotationId.value = kind === 'cloud' ? id : null;
    store.activeRectAnnotationId.value = kind === 'rect' ? id : null;
    store.activeObbAnnotationId.value = kind === 'obb' ? id : null;
  }

  function getAnnotationRecordByKind(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): AnnotationRecord | CloudAnnotationRecord | RectAnnotationRecord | ObbAnnotationRecord | null {
    if (kind === 'text') {
      return store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function resolveCurrentFormId(): string | undefined {
    return normalizeOptionalString(store.activeAnnotationContext.value?.record.formId)
      ?? normalizeOptionalString(reviewStore.currentTask.value?.formId);
  }

  function openAnnotationProcessingPage(kind: AnnotationOverlayKind, id: string) {
    commitInlineAnnotationDraft(kind, id);
    const currentTask = reviewStore.currentTask.value;
    const currentUser = userStore.currentUser.value;
    // SJ 经 PMS 外部流程打开带 form_id 的单据时，统一在 review 面板里处理批注，
    // 不再路由到设计侧 DCH。详见 .plannotator/plan-sj-reject-ui.md §5。
    const externalSjFormFocused = isExternalSjFormFocusedMode(readPersistedEmbedModeParams());
    const shouldUseDesignerPanel = !externalSjFormFocused && (
      currentUser?.role === UserRole.DESIGNER
      || (currentTask ? isCanonicalReturnedTask(currentTask) : false)
    );
    const formId = normalizeOptionalString(getAnnotationRecordByKind(kind, id)?.formId) ?? resolveCurrentFormId();
    activateAnnotation(kind, id);
    setAnnotationProcessingEntryTarget({
      annotationId: id,
      annotationType: kind,
      formId: formId ?? null,
    });
    ensurePanelAndActivate(shouldUseDesignerPanel ? 'designerCommentHandling' : 'review');
  }

  function openAnnotationEditor(kind: AnnotationOverlayKind, id: string) {
    if (kind === 'text') {
      focusInlineAnnotationEditor('text', id);
      return;
    }
    if (kind === 'cloud') {
      focusInlineAnnotationEditor('cloud', id);
      return;
    }
    if (kind === 'rect') {
      focusInlineAnnotationEditor('rect', id);
      return;
    }
    focusInlineAnnotationEditor('obb', id);
  }

  function getInlineAnnotationLabelKey(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string): string {
    if (kind === 'text') return `anno:${annotationId}`;
    if (kind === 'cloud') return `cloud:${annotationId}`;
    if (kind === 'rect') return `rect:${annotationId}`;
    return `obb:${annotationId}`;
  }

  function getInlineAnnotationDraftKey(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string): string {
    return `${kind}:${annotationId}`;
  }

  function setInlineAnnotationDraft(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    draft: InlineTextAnnotationDraft,
  ) {
    inlineTextAnnotationDrafts.set(getInlineAnnotationDraftKey(kind, annotationId), draft);
  }

  function getInlineTextAnnotationDraft(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    fallback: Pick<AnnotationRecord, 'title' | 'description'>,
  ): InlineTextAnnotationDraft {
    return inlineTextAnnotationDrafts.get(getInlineAnnotationDraftKey(kind, annotationId)) ?? {
      title: fallback.title || '批注',
      description: fallback.description || '',
    };
  }

  function pruneInlineTextAnnotationDrafts() {
    const existingKeys = new Set<string>([
      ...store.annotations.value.map((annotation) => getInlineAnnotationDraftKey('text', annotation.id)),
      ...store.cloudAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('cloud', annotation.id)),
      ...store.rectAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('rect', annotation.id)),
      ...store.obbAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('obb', annotation.id)),
    ]);
    for (const draftKey of inlineTextAnnotationDrafts.keys()) {
      if (!existingKeys.has(draftKey)) {
        inlineTextAnnotationDrafts.delete(draftKey);
      }
    }
  }

  function clearPendingInlineAnnotationEdit(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    if (kind === 'text' && store.pendingTextAnnotationEditId.value === annotationId) {
      store.pendingTextAnnotationEditId.value = null;
    }
    if (kind === 'cloud' && store.pendingCloudAnnotationEditId.value === annotationId) {
      store.pendingCloudAnnotationEditId.value = null;
    }
    if (kind === 'rect' && store.pendingRectAnnotationEditId.value === annotationId) {
      store.pendingRectAnnotationEditId.value = null;
    }
    if (kind === 'obb' && store.pendingObbEditId.value === annotationId) {
      store.pendingObbEditId.value = null;
    }
  }

  function focusInlineAnnotationEditor(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const label = labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    if (!label) {
      if (kind === 'text') store.pendingTextAnnotationEditId.value = annotationId;
      if (kind === 'cloud') store.pendingCloudAnnotationEditId.value = annotationId;
      if (kind === 'rect') store.pendingRectAnnotationEditId.value = annotationId;
      if (kind === 'obb') store.pendingObbEditId.value = annotationId;
      return;
    }
    const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    if (titleInput) {
      titleInput.focus();
      titleInput.select();
    }
    clearPendingInlineAnnotationEdit(kind, annotationId);
  }

  function handleAnnotationOverlayClick(kind: AnnotationOverlayKind, id: string) {
    const result = resolveAnnotationLabelClickAction(lastAnnotationLabelClick, kind, id, Date.now());
    lastAnnotationLabelClick = result.nextState;
    if (result.action === 'edit') {
      openAnnotationEditor(kind, id);
      return;
    }
    activateAnnotation(kind, id);
  }

  function clearTextAnnotationMarkerClickTimer() {
    if (!textAnnotationMarkerClickTimer) return;
    clearTimeout(textAnnotationMarkerClickTimer);
    textAnnotationMarkerClickTimer = null;
  }

  function applyTextAnnotationMarkerAction(id: string, result: TextAnnotationMarkerClickResult) {
    if (result.nextCollapsed !== null) {
      store.updateAnnotation(id, { collapsed: result.nextCollapsed });
    }

    if (result.activate) {
      activateAnnotation('text', id);
    }
  }

  function handleTextAnnotationMarkerSingleClick(id: string) {
    commitInlineAnnotationDraft('text', id);
    const rec = store.annotations.value.find((item) => item.id === id);
    if (!rec) return;
    applyTextAnnotationMarkerAction(id, resolveTextAnnotationMarkerSingleClickAction(rec.collapsed));
  }

  function handleTextAnnotationMarkerDoubleClick(id: string) {
    clearTextAnnotationMarkerClickTimer();
    commitInlineAnnotationDraft('text', id);
    const rec = store.annotations.value.find((item) => item.id === id);
    if (!rec) return;
    applyTextAnnotationMarkerAction(id, resolveTextAnnotationMarkerDoubleClickAction(rec.collapsed));
  }

  function scheduleTextAnnotationMarkerSingleClick(id: string) {
    clearTextAnnotationMarkerClickTimer();
    textAnnotationMarkerClickTimer = setTimeout(() => {
      textAnnotationMarkerClickTimer = null;
      handleTextAnnotationMarkerSingleClick(id);
    }, 220);
  }

  function commitDraggedTextAnnotation(annotationId: string, labelWorldPos: Vector3) {
    store.updateAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function commitDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    labelWorldPos: Vector3,
  ) {
    const patch = { leaderEndWorldPos: vec3ToTuple(labelWorldPos) };
    if (kind === 'cloud') {
      store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      store.updateRectAnnotation(annotationId, patch);
      return;
    }
    store.updateObbAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function getInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): Pick<AnnotationRecord, 'title' | 'description'> | null {
    if (kind === 'text') {
      return store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function updateInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    patch: { title?: string; description?: string },
  ) {
    if (kind === 'text') {
      store.updateAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'cloud') {
      store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      store.updateRectAnnotation(annotationId, patch);
      return;
    }
    store.updateObbAnnotation(annotationId, patch);
  }

  function commitInlineAnnotationDraft(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const rec = getInlineAnnotationRecord(kind, annotationId);
    if (!rec) return;
    const label = labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    const titleInput = label?.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    const descriptionInput = label?.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
    const draft = inlineTextAnnotationDrafts.get(getInlineAnnotationDraftKey(kind, annotationId));
    const nextTitle = titleInput
      ? (titleInput.value.trim() || '批注')
      : (draft ? (draft.title.trim() || '批注') : rec.title);
    const nextDescription = descriptionInput
      ? descriptionInput.value
      : (draft ? draft.description : rec.description);
    const patch: Partial<AnnotationRecord> = {};
    if (nextTitle !== rec.title) {
      patch.title = nextTitle;
    }
    if (nextDescription !== rec.description) {
      patch.description = nextDescription;
    }
    if (Object.keys(patch).length > 0) {
      updateInlineAnnotationRecord(kind, annotationId, patch);
    }
    inlineTextAnnotationDrafts.delete(getInlineAnnotationDraftKey(kind, annotationId));
  }

  function resetTextAnnotationDrag() {
    textAnnotationDrag.value = {
      annotationId: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
    };
  }

  function updateDraggedTextAnnotation(annotationId: string, nextLabelWorldPos: Vector3) {
    const labelEntry = labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    const leader = textLeaders.get(`anno:${annotationId}`);
    const dragAnchor = textAnnotationDrag.value.anchorWorldPos;
    if (leader && dragAnchor) {
      updateLeaderGeometry(leader, dragAnchor, nextLabelWorldPos);
    }
    updateOverlayPositions();
    requestRender?.();
  }

  function beginTextAnnotationDrag(
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    textAnnotationDrag.value = {
      annotationId,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
    };
  }

  function continueTextAnnotationDrag(event: PointerEvent) {
    const dragState = textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    const nextLabelWorldPos = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      event.clientX - overlayRect.left,
      event.clientY - overlayRect.top,
      dragState.anchorNdcZ,
    );
    dragState.moved = true;
    updateDraggedTextAnnotation(dragState.annotationId, nextLabelWorldPos);
  }

  function endTextAnnotationDrag(event: PointerEvent) {
    const dragState = textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId) return;
    const labelEntry = labels.get(`anno:${dragState.annotationId}`);
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const shouldCommit = dragState.moved && finalLabelWorldPos;
    resetTextAnnotationDrag();
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedTextAnnotation(annotationId, finalLabelWorldPos);
    } else {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  function resetInlineOverlayAnnotationDrag() {
    inlineOverlayAnnotationDrag.value = {
      annotationId: null,
      annotationKind: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
      labelGrabOffsetPx: null,
    };
  }

  function updateDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    nextLabelWorldPos: Vector3,
  ) {
    const labelEntry = labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    if (kind === 'cloud') {
      const cloud = cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) {
        cloud.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(cloud.leader, cloud.worldPos, nextLabelWorldPos);
      }
    } else if (kind === 'rect') {
      const rect = rectShapes.get(`rect:${annotationId}`);
      if (rect) {
        rect.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(rect.leader, rect.worldPos, nextLabelWorldPos);
      }
    } else {
      const obb = obbShapes.get(`obb:${annotationId}`);
      if (obb) {
        obb.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(obb.leader, obb.worldPos, nextLabelWorldPos);
      }
    }
    updateOverlayPositions();
    requestRender?.();
  }

  function beginInlineOverlayAnnotationDrag(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    // 云线 + 开关开：按屏幕像素拖（松手提交 labelLayoutV1 意图偏移）；记住按住点相对文字框左上角的偏移，
    // 拖动时文字框跟手而不是跳到指针下。旧记录（无 labelLayoutV1）第一次拖动即升级为 V1 布局（方案 §5）。
    let labelGrabOffsetPx: { x: number; y: number } | null = null;
    const cloud = kind === 'cloud' ? cloudShapes.get(`cloud:${annotationId}`) : undefined;
    if (cloud && labelEntry && isCloudRenderFlagEnabled('cloudLabelLayoutV1')) {
      const overlayRect = overlay.getBoundingClientRect();
      const pointerX = event.clientX - overlayRect.left;
      const pointerY = event.clientY - overlayRect.top;
      const currentRect = cloud.render.labelLayout?.rect ?? (() => {
        const elRect = labelEntry.el.getBoundingClientRect();
        return { x: elRect.left - overlayRect.left, y: elRect.top - overlayRect.top, width: elRect.width, height: elRect.height };
      })();
      labelGrabOffsetPx = { x: pointerX - currentRect.x, y: pointerY - currentRect.y };
    }
    inlineOverlayAnnotationDrag.value = {
      annotationId,
      annotationKind: kind,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
      labelGrabOffsetPx,
    };
  }

  function continueInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    if (dragState.labelGrabOffsetPx && dragState.annotationKind === 'cloud') {
      const cloud = cloudShapes.get(`cloud:${dragState.annotationId}`);
      if (cloud) {
        cloud.render.labelDragTopLeft = {
          x: event.clientX - overlayRect.left - dragState.labelGrabOffsetPx.x,
          y: event.clientY - overlayRect.top - dragState.labelGrabOffsetPx.y,
        };
        dragState.moved = true;
        updateOverlayPositions();
        requestRender?.();
        return;
      }
    }
    const nextLabelWorldPos = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      event.clientX - overlayRect.left,
      event.clientY - overlayRect.top,
      dragState.anchorNdcZ,
    );
    dragState.moved = true;
    updateDraggedOverlayAnnotation(dragState.annotationKind, dragState.annotationId, nextLabelWorldPos);
  }

  /**
   * V1 标签拖动松手：把最终文字框（已夹紧到安全区）反算成相对参考包围框锚点的意图偏移写进 `labelLayoutV1`，
   * 并按旧含义双写一次 `leaderEndWorldPos`（文字框中心在 billboard 深度上的世界点），旧端仍能按世界点布局。
   * 没有可用轮廓（frame 为空）时不提交，保持原记录。
   */
  function commitDraggedCloudLabelLayoutV1(annotationId: string): boolean {
    const cloud = cloudShapes.get(`cloud:${annotationId}`);
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!cloud || !viewer || !overlay || !canvas) return false;
    const frame = cloud.render.frame;
    const layout = cloud.render.labelLayout;
    if (!frame || !layout) return false;
    const uv = cloud.record.labelLayoutV1?.anchor.uv ?? DEFAULT_LABEL_PREFERENCE.uv;
    const offsetPx = labelOffsetFromTopLeft(frame.referenceBounds, uv, { x: layout.rect.x, y: layout.rect.y });
    const labelLayoutV1: CloudLabelLayoutV1 = {
      version: 1,
      anchor: { kind: 'contour-bounds', uv: [uv[0], uv[1]], labelPoint: 'top-left' },
      offsetPx: { x: Math.round(offsetPx.x * 100) / 100, y: Math.round(offsetPx.y * 100) / 100 },
    };
    const centerWorld = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      layout.rect.x + layout.rect.width / 2,
      layout.rect.y + layout.rect.height / 2,
      cloud.render.frameNdcZ,
    );
    store.updateCloudAnnotation(annotationId, { labelLayoutV1, leaderEndWorldPos: vec3ToTuple(centerWorld) });
    return true;
  }

  function endInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId) return;
    const labelEntry = labels.get(getInlineAnnotationLabelKey(dragState.annotationKind, dragState.annotationId));
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const annotationKind = dragState.annotationKind;
    const v1Drag = dragState.labelGrabOffsetPx !== null && annotationKind === 'cloud';
    const shouldCommit = dragState.moved && (v1Drag || finalLabelWorldPos);
    resetInlineOverlayAnnotationDrag();
    if (v1Drag) {
      const committed = shouldCommit && commitDraggedCloudLabelLayoutV1(annotationId);
      const cloud = cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) cloud.render.labelDragTopLeft = null;
      if (!committed) {
        updateOverlayPositions();
        requestRender?.();
      }
      return;
    }
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedOverlayAnnotation(annotationKind, annotationId, finalLabelWorldPos);
    } else {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  function applyPickHighlights(): void {
    const viewer = compatViewerRef.value;
    if (!viewer) return;

    const next = Array.from(new Set(pickedHighlightByBran.values())).filter(Boolean);

    if (lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    if (next.length > 0) {
      // 若对象在进入/拾取前已被外部选中，则“取消拾取/删除候选”不应取消其高亮
      const selectedNow = new Set<string>(viewer.scene.selectedObjectIds);
      for (const id of next) {
        if (selectedNow.has(id) && !lastAppliedPickHighlights.includes(id)) {
          pickedHighlightPinned.add(id);
        }
      }
      viewer.scene.setObjectsSelected(next, true);
    }
    lastAppliedPickHighlights = next;
  }

  function clearPickHighlights(): void {
    const viewer = compatViewerRef.value;
    if (viewer && lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    pickedHighlightByBran.clear();
    pickedHighlightPinned.clear();
    lastAppliedPickHighlights = [];
  }

  function clearPickCandidatePreview(): void {
    if (!pickCandidatePreview) return;
    try { toolsGroup.remove(pickCandidatePreview); } catch { /* ignore */ }
    disposeObject3d(pickCandidatePreview);
    pickCandidatePreview = null;
  }

  function resetPickCandidateSession(): void {
    clearPickCandidatePreview();
    pickCandidates.value = [];
    pickCandidateIndex.value = 0;
    pickCandidateAnchor = null;
  }

  /**
   * 用独立线框标出「当前轮换到的候选」。
   *
   * 不复用 `setObjectsSelected`：那是全局选中通道，候选与普通选中长得一样就分不出
   * 轮换到了哪一个。只有存在重叠候选时才画，单一候选靠选中高亮已经足够。
   */
  function renderPickCandidatePreview(): void {
    clearPickCandidatePreview();
    if (pickCandidates.value.length <= 1) return;

    const candidate = pickCandidates.value[pickCandidateIndex.value];
    const viewer = compatViewerRef.value;
    if (!candidate || !viewer) return;

    const aabb = viewer.scene.getAABB([candidate.refno]);
    if (!aabb) return;

    const geometry = buildWireBoxGeometryFromBox3(
      new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5])),
    );
    const line = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    line.renderOrder = 903;
    line.frustumCulled = false;

    ensureToolsGroupAttached();
    toolsGroup.add(line);
    pickCandidatePreview = line;
  }

  /** 把候选写入拾取结果；`previous` 非空表示这是一次轮换，替换而不是追加。 */
  function applyPickCandidate(candidate: PickRefnoCandidate, previous: PickRefnoCandidate | null): void {
    if (previous && previous.refno !== candidate.refno) {
      store.removePickedRefno(previous.refno);
      pickedHighlightByBran.delete(previous.refno);
    }
    store.addPickedRefno(candidate.refno);

    const viewer = compatViewerRef.value;
    if (viewer) {
      // 优先高亮 refno 本体；BRAN 之类无自身几何的元素回退到命中的子构件。
      const highlightId = viewer.scene.getAABB([candidate.refno]) ? candidate.refno : candidate.hitRefno;
      pickedHighlightByBran.set(candidate.refno, highlightId);
      applyPickHighlights();
    }

    renderPickCandidatePreview();
  }

  /** 在光标处的重叠构件之间轮换；返回是否真的换了一个候选。 */
  function cyclePickCandidate(step = 1): boolean {
    if (store.toolMode.value !== 'pick_refno') return false;
    const total = pickCandidates.value.length;
    if (total <= 1) return false;

    const previous = pickCandidates.value[pickCandidateIndex.value] ?? null;
    pickCandidateIndex.value = nextPickCandidateIndex(pickCandidateIndex.value, total, step);
    const candidate = pickCandidates.value[pickCandidateIndex.value];
    if (!candidate) return false;

    applyPickCandidate(candidate, previous);
    requestRender?.();
    return true;
  }

  function setPipeMeasureStatus(message: string): void {
    pipeMeasureStatus.value = message;
  }

  function setObjectMeasureStatus(message: string): void {
    objectToObjectStatus.value = message;
  }

  function clearPipeToPipeCandidate(options?: { clearStatus?: boolean }): void {
    pipeToPipeSourceCandidate.value = null;
    if (options?.clearStatus) {
      pipeMeasureStatus.value = '';
    }
  }

  function pipeToPipeCandidateLabel(candidate: PipeToPipeMeasureCandidate): string {
    return candidate.refno;
  }

  function applyPipeToPipeSourceCandidate(candidate: PipeToPipeMeasureCandidate): void {
    pipeToPipeSourceCandidate.value = candidate;
    setPipeMeasureStatus(`管-管净距测量：已选第一根管道 ${pipeToPipeCandidateLabel(candidate)}，请选择第二根管道`);
  }

  function clearObjectMeasureCandidates(options?: { clearStatus?: boolean; clearLastPairKey?: boolean }): void {
    objectToObjectSourceCandidate.value = null;
    objectToObjectTargetCandidate.value = null;
    objectToObjectBusy.value = false;
    if (options?.clearStatus) {
      objectToObjectStatus.value = '';
    }
    if (options?.clearLastPairKey) {
      lastAppliedObjectMeasurePairKey.value = null;
    }
  }

  function applyObjectMeasureSourceCandidate(candidate: ObjectMeasureCandidate | null): void {
    objectToObjectSourceCandidate.value = candidate;
    objectToObjectTargetCandidate.value = null;
    if (!candidate) return;
    setObjectMeasureStatus(`构件最近点测量：已选第一个构件 ${candidate.refno}，请选择第二个构件`);
  }

  function createObjectMeasureCandidateFromHit(hit: {
    entityId: string
    worldPos: Vector3
    objectId: string
  }): ObjectMeasureCandidate | null {
    const refno = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '');
    if (!refno || !hit.objectId) return null;
    return {
      refno,
      objectId: hit.objectId,
      entityId: hit.entityId || refno,
      hitPoint: vec3ToTuple(hit.worldPos),
    };
  }

  function commitObjectToObjectMeasurement(
    source: ObjectMeasureCandidate,
    target: ObjectMeasureCandidate,
  ): boolean {
    const layer = dtxLayerRef.value;
    if (!layer) {
      setObjectMeasureStatus('DTX 图层未就绪');
      return false;
    }
    if (source.objectId === target.objectId || source.refno === target.refno) {
      objectToObjectTargetCandidate.value = null;
      setObjectMeasureStatus('请选择另一个构件');
      return false;
    }

    objectToObjectBusy.value = true;
    setObjectMeasureStatus('构件最近点测量：正在计算…');

    try {
      const approx = computeApproxNearestBetweenObjects(layer, {
        sourceObjectId: source.objectId,
        targetObjectId: target.objectId,
        sourceHitPoint: source.hitPoint ?? null,
        targetHitPoint: target.hitPoint ?? null,
      });
      if (!approx) {
        objectToObjectTargetCandidate.value = null;
        setObjectMeasureStatus('未能计算两个构件之间的最近点');
        return false;
      }

      const sourceAnnotation = store.activeAnnotationContext.value;
      const rec: DistanceMeasurementRecord = {
        id: nowId('o2o'),
        kind: 'distance',
        origin: { entityId: source.objectId, worldPos: approx.sourcePoint },
        target: { entityId: target.objectId, worldPos: approx.targetPoint },
        visible: true,
        createdAt: Date.now(),
        sourceAnnotationId: sourceAnnotation?.id,
        sourceAnnotationType: sourceAnnotation?.type,
      };
      store.addMeasurement(rec);
      lastAppliedObjectMeasurePairKey.value = buildObjectMeasurePairKey(source.refno, target.refno);
      clearObjectMeasureCandidates();
      setObjectMeasureStatus(
        `已生成构件最近点测量：${source.refno} ↔ ${target.refno}，距离 ${formatLengthMeters(approx.distance, unitSettings.displayUnit.value, unitSettings.precision.value)}`,
      );
      requestRender?.();
      return true;
    } finally {
      objectToObjectBusy.value = false;
    }
  }

  function handleTreeObjectMeasureSelection(selectedRefnos: string[]): void {
    if (store.toolMode.value !== 'measure_object_to_object') return;

    const normalized = selectedRefnos
      .map((refno) => normalizeRefnoKey(refno))
      .filter(Boolean);
    if (normalized.length === 0) {
      clearObjectMeasureCandidates({ clearStatus: true });
      return;
    }
    if (normalized.length > 2) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('该模式仅支持两个构件');
      return;
    }

    const layer = dtxLayerRef.value;
    if (!layer) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('DTX 图层未就绪');
      return;
    }

    const resolvedCandidates = normalized.map((refno) => resolveLoadedVisibleObjectCandidateByRefno(layer, refno));
    if (normalized.length === 1) {
      const only = resolvedCandidates[0];
      if (!only) {
        clearObjectMeasureCandidates();
        setObjectMeasureStatus('请先显示该构件后再测量');
        return;
      }
      applyObjectMeasureSourceCandidate(only);
      return;
    }

    const [sourceCandidate, targetCandidate] = resolvedCandidates;
    if (!sourceCandidate || !targetCandidate) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('请先显示这两个构件后再测量');
      return;
    }

    const pairKey = buildObjectMeasurePairKey(sourceCandidate.refno, targetCandidate.refno);
    objectToObjectSourceCandidate.value = sourceCandidate;
    objectToObjectTargetCandidate.value = targetCandidate;
    if (lastAppliedObjectMeasurePairKey.value === pairKey) {
      setObjectMeasureStatus(`构件最近点测量：已选 ${sourceCandidate.refno} 与 ${targetCandidate.refno}`);
      return;
    }

    void commitObjectToObjectMeasurement(sourceCandidate, targetCandidate);
  }

  // MBD 管段数据接口已移除：不再解析命中对象所属管段几何（segment 恒为空），
  // 管对管距离计算统一走 AABB/采样点的通用最近距离路径。
  async function resolvePipeSegmentMeasureCandidate(hit: {
    entityId: string
    worldPos: Vector3
    objectId: string
  }): Promise<PipeToPipeMeasureCandidate | null> {
    const layer = dtxLayerRef.value;
    if (!layer) return null;

    const sourceRefno = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '');
    if (!sourceRefno || !hit.objectId) return null;

    return {
      refno: sourceRefno,
      objectId: hit.objectId,
      entityId: hit.entityId || sourceRefno,
      hitPoint: vec3ToTuple(hit.worldPos),
    };
  }

  function collectPipeReferencePointsWorld(params: {
    sourceRefno: string
    sourceObjectId: string
    dbnum: number
    layer: DTXLayer
    globalMatrix: any
  }): Vector3[] {
    const { sourceRefno, sourceObjectId, dbnum, layer, globalMatrix } = params;
    const refnoTransform = getDtxRefnoTransform(dbnum, sourceRefno);
    let refnoPosition: Vec3 | null = null;
    if (Array.isArray(refnoTransform) && refnoTransform.length === 16) {
      const tx = refnoTransform[12];
      const ty = refnoTransform[13];
      const tz = refnoTransform[14];
      if (Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz)) {
        refnoPosition = vec3ByMatrix([tx, ty, tz], globalMatrix);
      }
    }

    let aabbCenter: Vec3 | null = null;
    const sourceAabb = layer.getObjectBoundingBox(sourceObjectId);
    if (sourceAabb) {
      const center = sourceAabb.getCenter(new Vector3());
      aabbCenter = [center.x, center.y, center.z];
    }

    const seeds = collectOrderedPipeReferencePointSeeds({
      sourceRefno,
      segments: [],
      refnoPosition,
      aabbCenter,
    });
    return seeds.map((seed) => new Vector3(seed[0], seed[1], seed[2]));
  }

  function collectSourceSamplePointsWorld(
    layer: DTXLayer,
    sourceObjectId: string,
    limit: number,
  ): Vector3[] {
    const data = layer.getObjectGeometryData(sourceObjectId);
    if (!data) return [];
    const geometry = data.geometry;
    const matrix = data.matrix;
    const posAttr = geometry.getAttribute('position') as BufferAttribute | undefined;
    const indexAttr = geometry.getIndex() as BufferAttribute | null;
    if (!posAttr || posAttr.count <= 0) return [];

    const out: Vector3[] = [];
    const maxCount = Math.max(1, Math.floor(limit));

    const pushPoint = (point: Vector3) => {
      if (out.length >= maxCount) return;
      out.push(point.clone());
    };

    const vertexBudget = Math.max(1, Math.floor(maxCount * 0.7));
    const vertexStep = Math.max(1, Math.floor(posAttr.count / vertexBudget));
    const tempVertex = new Vector3();
    for (let i = 0; i < posAttr.count && out.length < vertexBudget; i += vertexStep) {
      tempVertex.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      pushPoint(tempVertex);
    }

    const remaining = maxCount - out.length;
    if (remaining <= 0) return out;

    const tempA = new Vector3();
    const tempB = new Vector3();
    const tempC = new Vector3();
    const triCount = indexAttr
      ? Math.floor(indexAttr.count / 3)
      : Math.floor(posAttr.count / 3);
    if (triCount <= 0) return out;
    const triStep = Math.max(1, Math.floor(triCount / Math.max(1, remaining)));

    for (let triIndex = 0; triIndex < triCount && out.length < maxCount; triIndex += triStep) {
      const base = triIndex * 3;
      const ia = indexAttr ? indexAttr.getX(base) : base;
      const ib = indexAttr ? indexAttr.getX(base + 1) : base + 1;
      const ic = indexAttr ? indexAttr.getX(base + 2) : base + 2;
      if (ia >= posAttr.count || ib >= posAttr.count || ic >= posAttr.count) continue;

      tempA.fromBufferAttribute(posAttr, ia).applyMatrix4(matrix);
      tempB.fromBufferAttribute(posAttr, ib).applyMatrix4(matrix);
      tempC.fromBufferAttribute(posAttr, ic).applyMatrix4(matrix);

      const midAB = tempA.clone().add(tempB).multiplyScalar(0.5);
      const midBC = tempB.clone().add(tempC).multiplyScalar(0.5);
      const midCA = tempC.clone().add(tempA).multiplyScalar(0.5);
      pushPoint(midAB);
      if (out.length >= maxCount) break;
      pushPoint(midBC);
      if (out.length >= maxCount) break;
      pushPoint(midCA);
    }

    return out;
  }

  function resolveTargetObjectPairs(
    dbnum: number,
    candidates: PipeWallDistanceCandidate[],
  ): { targetRefno: string; targetObjectId: string }[] {
    const out: { targetRefno: string; targetObjectId: string }[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const targetRefno = normalizeRefnoKey(candidate.refno);
      const objectIds = resolveDtxObjectIdsByRefno(dbnum, targetRefno);
      for (const objectId of objectIds) {
        if (!objectId || seen.has(objectId)) continue;
        seen.add(objectId);
        out.push({ targetRefno, targetObjectId: objectId });
      }
    }
    return out;
  }

  function findBestPipeMeasureResult(
    layer: DTXLayer,
    sourcePoints: Vector3[],
    targetPairs: { targetRefno: string; targetObjectId: string }[],
  ): PipeMeasureResult | null {
    let best: { seed: PipeMeasureSeed; targetRefno: string; targetObjectId: string } | null = null;

    for (const sourcePoint of sourcePoints) {
      const sourceTuple = vec3ToTuple(sourcePoint);
      for (const targetPair of targetPairs) {
        const closest = layer.closestPointToObject(targetPair.targetObjectId, sourcePoint);
        if (!closest) continue;
        const nextSeed: PipeMeasureSeed = {
          distance: closest.distance,
          sourcePoint: sourceTuple,
          targetPoint: vec3ToTuple(closest.point),
        };
        const winnerSeed = choosePipeMeasureBetterSeed(best?.seed || null, nextSeed);
        if (winnerSeed === nextSeed) {
          best = {
            seed: nextSeed,
            targetObjectId: targetPair.targetObjectId,
            targetRefno: targetPair.targetRefno,
          };
        }
      }
    }

    if (!best) return null;
    return fromSeed(best.seed, best.targetObjectId, best.targetRefno);
  }

  function completePipeToPipeClearance(
    source: PipeToPipeMeasureCandidate,
    target: PipeToPipeMeasureCandidate,
  ): boolean {
    if (
      source.objectId === target.objectId ||
      source.refno === target.refno
    ) {
      setPipeMeasureStatus('管-管净距测量：请选择另一根管道');
      return false;
    }

    const layer = dtxLayerRef.value;
    const approx = layer
      ? computeApproxNearestBetweenObjects(layer, {
        sourceObjectId: source.objectId,
        targetObjectId: target.objectId,
        sourceHitPoint: source.hitPoint ?? null,
        targetHitPoint: target.hitPoint ?? null,
      })
      : null;
    if (!approx) {
      setPipeMeasureStatus('管-管净距测量：最近点计算失败');
      return false;
    }
    const start = new Vector3(...approx.sourcePoint);
    const end = new Vector3(...approx.targetPoint);

    const distance = start.distanceTo(end);
    const sourceLabel = pipeToPipeCandidateLabel(source);
    const targetLabel = pipeToPipeCandidateLabel(target);
    clearPipeToPipeCandidate();
    setPipeMeasureStatus(
      `${DIMENSION_REBUILD_NOTICE}（${sourceLabel} ↔ ${targetLabel}，净距 ${formatLengthMeters(distance, unitSettings.displayUnit.value, unitSettings.precision.value)}）`,
    );
    emitToast({ message: DIMENSION_REBUILD_NOTICE, level: 'warning' });
    requestRender?.();
    return true;
  }

  async function runPipeToPipeMeasurement(canvas: HTMLCanvasElement, e: PointerEvent): Promise<void> {
    if (pipeMeasureBusy.value) {
      setPipeMeasureStatus('正在计算上一条净距，请稍候…');
      return;
    }

    const hit = pickSurfacePoint(canvas, e);
    if (!hit) {
      setPipeMeasureStatus('管-管净距测量：未拾取到有效管道对象');
      return;
    }

    pipeMeasureBusy.value = true;
    try {
      setPipeMeasureStatus(
        pipeToPipeSourceCandidate.value
          ? '管-管净距测量：正在解析第二根管道…'
          : '管-管净距测量：正在解析第一根管道…',
      );
      const candidate = await resolvePipeSegmentMeasureCandidate(hit);
      if (!candidate) {
        setPipeMeasureStatus('管-管净距测量：未找到可用管道对象');
        return;
      }

      const source = pipeToPipeSourceCandidate.value;
      if (!source) {
        applyPipeToPipeSourceCandidate(candidate);
        return;
      }

      completePipeToPipeClearance(source, candidate);
    } catch (error) {
      setPipeMeasureStatus(`管-管净距测量计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pipeMeasureBusy.value = false;
    }
  }

  async function runPipeToStructureMeasurement(canvas: HTMLCanvasElement, e: PointerEvent): Promise<void> {
    if (pipeMeasureBusy.value) {
      setPipeMeasureStatus('正在计算上一条净距，请稍候…');
      return;
    }

    const hit = pickSurfacePoint(canvas, e);
    if (!hit) {
      setPipeMeasureStatus('未拾取到有效管道对象');
      return;
    }

    const layer = dtxLayerRef.value;
    if (!layer) {
      setPipeMeasureStatus('DTX 图层未就绪');
      return;
    }

    const sourceRefno = normalizeRefnoKey(hit.entityId);
    const dbnum = parseDbnumFromRefno(sourceRefno);
    if (!dbnum) {
      setPipeMeasureStatus(`无法解析 dbnum：${sourceRefno}`);
      return;
    }

    const loadedSourceObjectIds = resolveDtxObjectIdsByRefno(dbnum, sourceRefno);
    const sourceObjectId = hit.objectId || loadedSourceObjectIds[0];
    if (!sourceObjectId) {
      setPipeMeasureStatus(`源管道未加载几何：${sourceRefno}`);
      return;
    }

    pipeMeasureBusy.value = true;
    try {
      setPipeMeasureStatus('正在查询墙/柱候选…');
      const response = await queryPipeWallDistanceCandidates({
        dbnum,
        source_refno: toBackendRefno(sourceRefno),
        target_nouns: PIPE_STRUCTURE_DEFAULT_NOUNS,
        max_candidates: PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES,
      });
      if (response.status !== 'success' || !response.data) {
        setPipeMeasureStatus(response.message || '候选查询失败');
        return;
      }

      const candidates = (response.data.candidates || []).slice(0, PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES);
      if (candidates.length === 0) {
        setPipeMeasureStatus('未找到可用墙/柱候选');
        return;
      }

      const targetPairs = resolveTargetObjectPairs(dbnum, candidates);
      if (targetPairs.length === 0) {
        setPipeMeasureStatus('候选对象未加载到当前场景');
        return;
      }

      setPipeMeasureStatus('正在收集参考点…');
      const globalMatrix = layer.getGlobalModelMatrix();
      const referencePoints = collectPipeReferencePointsWorld({
        sourceRefno,
        sourceObjectId,
        dbnum,
        layer,
        globalMatrix,
      });
      if (referencePoints.length === 0) {
        setPipeMeasureStatus('参考点收集失败');
        return;
      }

      setPipeMeasureStatus('阶段A：参考点最近距离计算…');
      let best = findBestPipeMeasureResult(layer, referencePoints, targetPairs);

      const samplePoints = collectSourceSamplePointsWorld(
        layer,
        sourceObjectId,
        PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT,
      );
      if (samplePoints.length > 0) {
        setPipeMeasureStatus('阶段B：采样点精化…');
        const refined = findBestPipeMeasureResult(layer, samplePoints, targetPairs);
        if (refined && (!best || refined.distance < best.distance)) {
          best = refined;
        }
      }

      if (!best) {
        setPipeMeasureStatus('最近点计算失败');
        return;
      }

      const distance = best.sourcePoint.distanceTo(best.targetPoint);
      setPipeMeasureStatus(
        `${DIMENSION_REBUILD_NOTICE}（${sourceRefno} ↔ ${best.targetRefno}，净距 ${formatLengthMeters(distance, unitSettings.displayUnit.value, unitSettings.precision.value)}）`,
      );
      emitToast({ message: DIMENSION_REBUILD_NOTICE, level: 'warning' });
    } catch (error) {
      setPipeMeasureStatus(`计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pipeMeasureBusy.value = false;
    }
  }

  const statusText = computed(() => {
    const mode = store.toolMode.value;
    if (mode === 'none') return '未启用工具';
    if (!dtxViewerRef.value) return '三维查看器未初始化';
    if (!dtxLayerRef.value) return 'DTX 图层未初始化';
    if (!selectionRef.value) return '拾取控制器未就绪';
    if (!ready.value) return '等待模型加载完成…';

    if (mode === 'measure_point_to_object') {
      return pointToObjectStart.value ? '点到面测量：请点击选择目标对象（自动计算最近距离）' : '点到面测量：请点击选择起始点';
    }
    if (mode === 'measure_object_to_object') {
      if (objectToObjectBusy.value) {
        return objectToObjectStatus.value || '构件最近点测量：正在计算…';
      }
      if (objectToObjectStatus.value) {
        return objectToObjectStatus.value;
      }
      if (objectToObjectSourceCandidate.value) {
        return `构件最近点测量：已选第一个构件 ${objectToObjectSourceCandidate.value.refno}，请选择第二个构件`;
      }
      return '构件最近点测量：请选择第一个构件（可点三维或在模型树选中）';
    }
    if (mode === 'measure_pipe_to_structure') {
      if (pipeMeasureBusy.value) {
        return pipeMeasureStatus.value || '管-墙/柱净距测量：正在计算…';
      }
      return pipeMeasureStatus.value || '管-墙/柱净距测量：点击管道，计算最近距离（尺寸创建暂不可用）';
    }
    if (mode === 'measure_pipe_to_pipe') {
      if (pipeMeasureBusy.value) {
        return pipeMeasureStatus.value || '管-管净距测量：正在计算…';
      }
      if (pipeMeasureStatus.value) {
        return pipeMeasureStatus.value;
      }
      return pipeToPipeSourceCandidate.value
        ? `管-管净距测量：已选第一根管道 ${pipeToPipeCandidateLabel(pipeToPipeSourceCandidate.value)}，请选择第二根管道`
        : '管-管净距测量：请选择第一根管道';
    }
    if (mode === 'pick_query_center') {
      return '请点击模型拾取查询中心点';
    }
    if (mode === 'pick_refno') {
      const filter = store.pickRefnoFilter.value;
      const count = store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      const total = pickCandidates.value.length;
      const cycleText = total > 1
        ? ` — 光标处 ${pickCandidateIndex.value + 1}/${total} 个重叠构件，Tab 切换`
        : '';
      return `拾取模式${filterText}：点击选择构件 [已选 ${count}]${cycleText} — Enter 确认 / ESC 取消`;
    }
    if (mode === 'pick_refno_box') {
      const filter = store.pickRefnoFilter.value;
      const count = store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      return `框选模式${filterText}：拖拽矩形框选构件 [已选 ${count}] — 松开鼠标即确认 / ESC 取消`;
    }
    if (mode === 'annotation_cloud') {
      const targetCount = store.cloudTargetRefnos.value.length;
      if (targetCount === 0) return '云线批注：请先选择目标元素';
      return pendingCloudAnchor.value
        ? `云线批注：已选 ${targetCount} 个目标元素，锚点已就绪，请拖拽绘制云线轮廓`
        : `云线批注：已选 ${targetCount} 个目标元素，请点击模型选择锚点`;
    }
    if (mode === 'annotation_rect') {
      return '矩形批注：点击对象生成 OBB 包围框批注';
    }
    return '批注：点击模型表面创建';
  });

  const objectToObjectUiState = computed(() => {
    return {
      sourceRefno: objectToObjectSourceCandidate.value?.refno ?? null,
      targetRefno: objectToObjectTargetCandidate.value?.refno ?? null,
      busy: objectToObjectBusy.value,
      canReset: !!objectToObjectSourceCandidate.value || !!objectToObjectTargetCandidate.value,
      statusText: statusText.value,
    };
  });

  const toolsGroup = new Group();
  toolsGroup.name = 'dtx-tools';

  const labels = new Map<string, LabelEl>();
  const markers = new Map<string, LabelEl>();
  const cloudShapes = new Map<string, CloudOverlayEl>();
  const rectShapes = new Map<string, RectOverlayEl>();
  const obbShapes = new Map<string, ObbOverlayEl>();
  const textLeaders = new Map<string, AnnotationLeaderVisual>();
  const inlineTextAnnotationDrafts = new Map<string, InlineTextAnnotationDraft>();
  const textAnnotationDrag = ref<TextAnnotationDragState>({
    annotationId: null,
    pointerId: null,
    anchorWorldPos: null,
    anchorNdcZ: 0,
    moved: false,
  });
  const inlineOverlayAnnotationDrag = ref<InlineOverlayAnnotationDragState>({
    annotationId: null,
    annotationKind: null,
    pointerId: null,
    anchorWorldPos: null,
    anchorNdcZ: 0,
    moved: false,
    labelGrabOffsetPx: null,
  });

  // 云线渲染分阶段脏标记的帧级版本戳（所有云线共用）：相机 / 视口 / overlay / DPR / 全局矩阵 / 样式
  const cloudFrameTrackers = {
    cameraWorld: createArrayVersionTracker(),
    projection: createArrayVersionTracker(),
    viewportCss: createArrayVersionTracker(),
    overlayTransform: createArrayVersionTracker(),
    dpr: createArrayVersionTracker(),
    globalModelMatrix: createArrayVersionTracker(),
    shapeStyle: createValueVersionTracker<string>(),
    paintStyle: createValueVersionTracker<string>(),
  };
  const cloudRenderStats: CloudRenderStats = { frames: 0, contourBuilds: 0, setPoints: 0, labelLayouts: 0, paintUpdates: 0, lodPlans: 0 };

  // P4 LOD（方案 §9.3）：上一次计划的等级按 `cloud:${id}` 记在这里——跨 syncFromStore 重建保留，滞回才有依据；
  // planKey 是上次规划时的输入指纹（相机 / 投影 / 视口 / 集合 / 激活 / 拖动 / 悬停 / 待编辑），没变就不重算
  const cloudLodLevels = new Map<string, CloudLodLevel>();
  let cloudLodPlanKey = '';
  let cloudLodPlanSummary = { overBudget: false, fullCount: 0, pinCount: 0 };
  let cloudLodSetVersion = 0;
  /** 悬停在图钉上的云线（交互方案「悬停临时展示」）：LOD 固定高档，移开后按预算回落 */
  let hoveredCloudAnnotationId: string | null = null;
  const lodProjectScratch = new Vector3();

  const marqueeState = ref<DragRect>({ active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null });
  const marqueeDiv = ref<HTMLDivElement | null>(null);
  const pendingCloudAnchor = ref<PendingCloudAnchor | null>(null);

  const rectDrag = ref<RectPlaneDrag>({
    active: false,
    pointerId: null,
    startCanvas: null,
    plane: null,
    basisU: null,
    basisV: null,
    startWorld: null,
    startEntityId: null,
  });
  const rectPreviewLine = ref<Line | null>(null);

  function resetProgress() {
    pointToObjectStart.value = null;
    clearObjectMeasureCandidates({ clearStatus: true, clearLastPairKey: true });
    clearPipeToPipeCandidate({ clearStatus: true });
    pipeMeasureBusy.value = false;
    pipeMeasureStatus.value = '';
  }

  function clearPendingCloudAnchor() {
    pendingCloudAnchor.value = null;
  }

  /**
   * 云线绘制闸门：目标元素集合为空时，既不允许 pick 锚点也不允许拖框。
   *
   * 刻意集中在工具层——进入 `annotation_cloud` 的入口有四处（批注面板、
   * 视口浮动工具条、校审工作台、校审面板），逐个面板校验必然漏网。
   */
  function canDrawCloudAnnotation(): boolean {
    return store.cloudTargetRefnos.value.length > 0;
  }

  /**
   * 闸门拦截的外发信号：浮动工具条据此把对应步骤闪红。
   * 闸门本身只能 return，没有反馈用户就只会反复拖框而不知道缺了哪一步。
   */
  const cloudGateBlock = ref<{ step: 'target' | 'anchor'; at: number } | null>(null);
  let lastCloudGateToastAt = 0;

  const CLOUD_GATE_MESSAGE: Record<'target' | 'anchor', string> = {
    target: '请先关联至少一个目标元素，再绘制云线',
    anchor: '请先在模型上点击一处锚点，再拖拽绘制云线轮廓',
  };

  function notifyCloudGateBlocked(step: 'target' | 'anchor') {
    const now = Date.now();
    cloudGateBlock.value = { step, at: now };
    // 拖框会连续触发 pointerdown，节流避免同一句提示刷屏。
    if (now - lastCloudGateToastAt < 1500) return;
    lastCloudGateToastAt = now;
    emitToast({ message: CLOUD_GATE_MESSAGE[step], level: 'warning' });
  }

  /** 云线创建的统一回退入口：清掉锚点、拖框预览与目标集合。 */
  function cancelCloudCreation() {
    clearPendingCloudAnchor();
    hideMarquee();
    store.clearCloudTargetRefnos();
  }

  /** 退出云线工具但保留目标集合，再次进入可直接复用（方案 §2.1）。 */
  function suspendCloudCreation() {
    clearPendingCloudAnchor();
    hideMarquee();
  }

  /** 拖框被中途打断时归还相机控制与指针捕获，否则退出后视角就转不动了。 */
  function releaseMarqueeCapture() {
    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    const pointerId = marqueeState.value.pointerId;
    const canvas = viewer?.canvas;
    if (canvas && pointerId !== null) {
      try { canvas.releasePointerCapture(pointerId); } catch { /* ignore */ }
    }
  }

  /**
   * 云线创建的分级回退：一次 Esc 只退一步（拖框预览 → 锚点 → 退出工具）。
   *
   * 目标集合是整个流程里最贵的一步——可能逐个点了十几个构件——不能因为
   * 想重拖一次轮廓就被连坐清空；退出工具时也保留，方案 §2.1 要求「再次进入可复用」。
   * 返回 true 表示这次 Esc 已被云线状态机消费，调用方不应再退出工具模式。
   */
  function rollbackCloudCreationStep(): boolean {
    if (store.toolMode.value !== 'annotation_cloud') return false;
    if (marqueeState.value.active) {
      releaseMarqueeCapture();
      hideMarquee();
      return true;
    }
    if (pendingCloudAnchor.value) {
      clearPendingCloudAnchor();
      return true;
    }
    return false;
  }

  async function captureCreatedCloudScreenshot(rec: CloudAnnotationRecord) {
    const taskId = reviewStore.currentTask.value?.id;
    if (!taskId) return null;

    await nextTick();
    const attachment = await captureAndUpload(taskId, {
      kind: 'auto_cloud_finish',
      sourceAnnotationId: rec.id,
      description: rec.title,
    });
    if (!attachment) {
      emitToast({ message: '云线已创建，但自动截图失败，可在批注面板重拍', level: 'warning' });
      return null;
    }

    const attached = store.setAnnotationScreenshot('cloud', rec.id, {
      url: attachment.url,
      attachmentId: attachment.id,
      name: attachment.name,
      capturedAt: attachment.capturedAt,
      mimeType: attachment.mimeType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      uploadedAt: attachment.uploadedAt,
    });
    if (!attached) {
      void reviewAttachmentDelete(attachment.id).catch((error) => {
        console.warn('[annotation] Failed to clean orphan cloud screenshot:', error);
      });
      return null;
    }
    return attachment;
  }

  try {
    if (localStorage.getItem('plant3d_automation_review') === '1') {
      (window as unknown as {
        __plant3dDtxE2E?: {
          addCloudAnnotationWithScreenshot: () => Promise<{
            annotationId: string;
            attachmentId: string;
            url: string;
            mimeType?: string;
            size?: number;
            width?: number;
            height?: number;
          }>;
        };
      }).__plant3dDtxE2E = {
        addCloudAnnotationWithScreenshot: async () => {
          const createdAt = Date.now();
          const rec: CloudAnnotationRecord = {
            id: `cloud-e2e-${createdAt}`,
            objectIds: ['24381_145018'],
            refnos: ['24381_145018'],
            anchorWorldPos: [0, 0, 0],
            visible: true,
            title: '云线批注（仿 PMS 自动化）',
            description: '',
            createdAt,
          };
          store.addCloudAnnotation(rec);
          const attachment = await captureCreatedCloudScreenshot(rec);
          if (!attachment) throw new Error('云线自动截图上传未返回附件');
          const screenshot = store.cloudAnnotations.value.find((item) => item.id === rec.id)?.screenshot;
          if (!screenshot?.attachmentId || !screenshot.url) {
            throw new Error('云线自动截图未写回批注');
          }
          return {
            annotationId: rec.id,
            attachmentId: screenshot.attachmentId,
            url: screenshot.url,
            mimeType: screenshot.mimeType,
            size: screenshot.size,
            width: screenshot.width,
            height: screenshot.height,
          };
        },
      };
    }
  } catch {
    // 自动化钩子不可用时不影响正式云线工具。
  }

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  function setPendingCloudAnchor(anchor: PendingCloudAnchor) {
    pendingCloudAnchor.value = {
      worldPos: [...anchor.worldPos],
      refno: anchor.refno,
      entityId: anchor.entityId,
    };
  }

  function ensureToolsGroupAttached() {
    const viewer = dtxViewerRef.value;
    if (!viewer) return;
    if (toolsGroup.parent !== viewer.scene) {
      try {
        toolsGroup.parent?.remove(toolsGroup);
      } catch {
        // ignore
      }
      viewer.scene.add(toolsGroup);
    }
  }

  function clearOverlayEls() {
    for (const it of labels.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    labels.clear();
    for (const it of markers.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    markers.clear();
    for (const it of cloudShapes.values()) {
      try { it.badgeEl?.remove(); } catch { /* ignore */ }
    }
    cloudShapes.clear();
    rectShapes.clear();
    obbShapes.clear();
  }

  function ensureMarqueeDiv() {
    const overlay = overlayContainerRef.value;
    if (!overlay) return null;
    if (marqueeDiv.value && marqueeDiv.value.parentElement === overlay) return marqueeDiv.value;

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove(); } catch { /* ignore */ }
    }

    marqueeDiv.value = ensureDiv(
      overlay,
      'dtx-marquee',
      [
        'position:absolute',
        'display:none',
        'left:0',
        'top:0',
        'width:0',
        'height:0',
        'pointer-events:none',
        'z-index:930',
      ].join(';')
    );
    return marqueeDiv.value;
  }

  function hideMarquee() {
    marqueeState.value = { active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null };
    const div = marqueeDiv.value;
    if (div) div.style.display = 'none';
  }

  function updateMarqueeStyle(mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    div.style.display = 'block';
    if (mode === 'annotation_cloud') {
      div.style.border = '3px solid #dc2626';
      div.style.borderRadius = '8px';
      div.style.background = 'rgba(220, 38, 38, 0.08)';
      div.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)';
    } else {
      div.style.border = dx >= 0 ? '2px dashed #333' : '2px solid #333';
      div.style.borderRadius = '0';
      div.style.background = 'rgba(0,0,0,0.06)';
      div.style.boxShadow = 'none';
    }
  }

  function updateMarqueeRect(start: { x: number; y: number }, end: { x: number; y: number }) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    div.style.left = `${x1}px`;
    div.style.top = `${y1}px`;
    div.style.width = `${x2 - x1}px`;
    div.style.height = `${y2 - y1}px`;
  }

  /**
   * 云线文字框（行内卡）DOM：从 syncFromStore 抽出来，P4 LOD 下只给 `full` 档挂载、降到 `pin` 档时卸掉——
   * 上千条云线不为每条都建一张带输入框的卡。事件绑定与旧代码一致；重复调用（已挂载）不重建。
   */
  function mountCloudLabel(cloud: CloudOverlayEl): void {
    const overlay = overlayContainerRef.value;
    if (!overlay || labels.has(cloud.id)) return;
    const c = cloud.record;
    const anchor = cloud.worldPos;
    const labelWorldPos = cloud.labelWorldPos;
    const draft = getInlineTextAnnotationDraft('cloud', c.id, c);
    const label = makeInlineAnnotationCardEl(overlay, '云线批注', draft.title, draft.description);
    label.style.transform = 'translate(-50%,-50%)';
    if (c.severity) label.dataset.severity = c.severity;
    labels.set(cloud.id, { id: cloud.id, worldPos: labelWorldPos, el: label });
    const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
    const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activateAnnotation('cloud', c.id);
    });
    label.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      focusInlineAnnotationEditor('cloud', c.id);
    });
    label.addEventListener('focusout', () => {
      queueMicrotask(() => {
        const activeElement = label.ownerDocument?.activeElement;
        if (activeElement && label.contains(activeElement)) return;
        commitInlineAnnotationDraft('cloud', c.id);
      });
    });

    dragHandle?.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      commitInlineAnnotationDraft('cloud', c.id);
      dragHandle.style.cursor = 'grabbing';
      beginInlineOverlayAnnotationDrag('cloud', c.id, ev, labelWorldPos, anchor);
      try {
        dragHandle.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    });
    dragHandle?.addEventListener('pointermove', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      continueInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointerup', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      endInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointercancel', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      endInlineOverlayAnnotationDrag(ev);
    });

    titleInput?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activateAnnotation('cloud', c.id);
    });
    titleInput?.addEventListener('input', () => {
      setInlineAnnotationDraft('cloud', c.id, {
        title: titleInput.value,
        description: descriptionInput?.value ?? draft.description,
      });
    });
    descriptionInput?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activateAnnotation('cloud', c.id);
    });
    descriptionInput?.addEventListener('input', () => {
      setInlineAnnotationDraft('cloud', c.id, {
        title: titleInput?.value ?? draft.title,
        description: descriptionInput.value,
      });
    });

    if (store.pendingCloudAnnotationEditId.value === c.id) {
      queueMicrotask(() => focusInlineAnnotationEditor('cloud', c.id));
    }
  }

  /** 降到 `pin` 档：卸掉文字框 DOM（草稿在 inlineTextAnnotationDrafts 里，不随 DOM 丢） */
  function unmountCloudLabel(cloud: CloudOverlayEl): void {
    const entry = labels.get(cloud.id);
    if (!entry) return;
    try { entry.el.remove(); } catch { /* ignore */ }
    labels.delete(cloud.id);
    cloud.render.labelLayout = null;
  }

  function setHoveredCloudAnnotation(id: string | null): void {
    if (hoveredCloudAnnotationId === id) return;
    hoveredCloudAnnotationId = id;
    // 只有 LOD 真在生效（上次计划超预算）时悬停才改变呈现；否则不为一次 hover 白跑一帧
    if (cloudLodPlanSummary.overBudget) {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  /**
   * P4 LOD 计划（方案 §9.3）：云线 > 预算时，按锚点到视口中心的距离排优先级，激活 / 拖动 / 悬停 / 待编辑固定高档，
   * 交给纯函数 `planCloudLod`（预算 64、滞回 16）。输入指纹没变就不重算；≤ 预算或开关关 → 全部 `full`。
   * 结果写在每条 `cloud.render.lodLevel`，由渲染循环按「计划 ≠ 已应用」切档。
   */
  function planCloudLodForFrame(camera: any, frameKey: string): void {
    const lodOn = isCloudRenderFlagEnabled('cloudAdaptiveLod');
    if (!lodOn || cloudShapes.size <= DEFAULT_CLOUD_LOD_OPTIONS.budget) {
      if (cloudLodPlanKey !== 'all-full') {
        cloudLodPlanKey = 'all-full';
        cloudLodPlanSummary = { overBudget: false, fullCount: cloudShapes.size, pinCount: 0 };
        for (const cloud of cloudShapes.values()) {
          cloud.render.lodLevel = 'full';
          cloud.render.lodPinnedHigh = false;
        }
        cloudLodLevels.clear();
      }
      return;
    }
    const drag = inlineOverlayAnnotationDrag.value;
    const dragId = drag.annotationKind === 'cloud' ? drag.annotationId : null;
    const activeId = store.activeCloudAnnotationId.value;
    const pendingEditId = store.pendingCloudAnnotationEditId.value;
    const key = `${frameKey}|${cloudLodSetVersion}|${activeId ?? ''}|${dragId ?? ''}|${hoveredCloudAnnotationId ?? ''}|${pendingEditId ?? ''}`;
    if (key === cloudLodPlanKey) return;
    cloudLodPlanKey = key;
    cloudRenderStats.lodPlans += 1;

    const candidates: CloudLodCandidate[] = [];
    for (const cloud of cloudShapes.values()) {
      const recordId = cloud.record.id;
      const v = lodProjectScratch.copy(cloud.worldPos).applyMatrix4(camera.matrixWorldInverse);
      // three 相机看向视空间 -z：z ≥ 0 = 锚点在相机背后，投影坐标会翻转，不能拿它当屏内
      const behind = v.z >= 0;
      v.applyMatrix4(camera.projectionMatrix);
      const priority = cloudLodPriority(v.x, v.y, behind);
      const pinnedHigh = recordId === activeId
        || recordId === dragId
        || recordId === hoveredCloudAnnotationId
        || recordId === pendingEditId
        || cloud.render.labelDragTopLeft !== null;
      cloud.render.lodPriority = priority;
      cloud.render.lodPinnedHigh = pinnedHigh;
      candidates.push({ id: cloud.id, priority, pinnedHigh, previous: cloudLodLevels.get(cloud.id) ?? null });
    }
    const plan = planCloudLod(candidates, DEFAULT_CLOUD_LOD_OPTIONS);
    cloudLodPlanSummary = { overBudget: plan.overBudget, fullCount: plan.fullCount, pinCount: plan.pinCount };
    // 记忆只留还在场的条目，删掉的记录不占着旧等级
    for (const id of cloudLodLevels.keys()) if (!cloudShapes.has(id)) cloudLodLevels.delete(id);
    for (const cloud of cloudShapes.values()) {
      const level = plan.levels.get(cloud.id) ?? 'full';
      cloud.render.lodLevel = level;
      cloudLodLevels.set(cloud.id, level);
    }
  }

  function syncFromStore() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    if (!viewer || !overlay) return;
    const resolution = getCanvasResolution(viewer.canvas);

    ensureToolsGroupAttached();
    clearGroup(toolsGroup);
    clearOverlayEls();
    textLeaders.clear();
    pruneInlineTextAnnotationDrafts();

    // clearGroup 连同候选预览一起销毁了，重建以免轮换线框在批注同步时凭空消失。
    pickCandidatePreview = null;
    renderPickCandidatePreview();

    if (suppressStoreOverlays) return;

    // ADR-0050：一趟拿全部记录的降级态（missing / stale），创建时就画成灰虚线；之后解析表变化走 applyBindingDegrade 原地更新
    const degrades = bindingResolve.getRecordDegrades();
    const degradeOf = (kind: AnnotationOverlayKind, id: string): AnnotationDegrade | null =>
      degrades.get(buildRecordDegradeKey(kind, id)) ?? null;

    // ---------------- Text annotations ----------------
    for (const a of store.annotations.value) {
      if (!a.visible) continue;

      const worldPos = asVec3(a.worldPos);
      if (!worldPos) continue;
      const labelPos = asVec3(a.labelWorldPos) ?? getDefaultTextAnnotationLabelWorldPos(worldPos);
      const wp = new Vector3(...worldPos);
      const labelWorldPos = new Vector3(...labelPos);
      const degrade = degradeOf('text', a.id);
      const glyph = a.glyph || 'A';
      const marker = makeTextAnnotationMarkerEl(overlay, glyph, a.collapsed === true, { degrade, badge: true });
      if (a.severity) marker.dataset.severity = a.severity;
      markers.set(`anno:${a.id}`, {
        id: `anno:${a.id}`,
        worldPos: wp,
        el: marker,
        marker: { kind: 'text', annotationId: a.id, glyph, collapsed: a.collapsed === true, degrade },
      });
      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        scheduleTextAnnotationMarkerSingleClick(a.id);
      });
      marker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        handleTextAnnotationMarkerDoubleClick(a.id);
      });

      if (shouldRenderTextAnnotationCard(a.collapsed)) {
        const leader = createTextAnnotationLeader(wp, labelWorldPos, resolution);
        applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
        toolsGroup.add(leader.root);
        textLeaders.set(`anno:${a.id}`, leader);

        const draft = getInlineTextAnnotationDraft('text', a.id, a);
        const label = makeTextAnnotationCardEl(overlay, draft.title, draft.description);
        if (a.severity) label.dataset.severity = a.severity;
        labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: labelWorldPos, el: label });

        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('text', a.id);
          });
        });

        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('text', a.id);
          dragHandle.style.cursor = 'grabbing';
          beginTextAnnotationDrag(a.id, ev, labelWorldPos, wp);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          continueTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          endTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          endTextAnnotationDrag(ev);
        });

        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('text', a.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });

        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('text', a.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingTextAnnotationEditId.value === a.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('text', a.id));
        }
      }
    }

    // ---------------- Cloud annotations (screen-space cloud + world anchor) ----------------
    // P4 LOD（方案 §9.3）：云线超过预算时文字框 DOM 不在这里建——由 updateOverlayPositions 按计划只给 full 档挂载
    // （本函数末尾就会调一次，同一同步调用内完成，不闪）；≤ 预算或开关关时照旧当场建。集合变了，LOD 计划要重算。
    let visibleCloudCount = 0;
    for (const c of store.cloudAnnotations.value) if (c.visible) visibleCloudCount += 1;
    const deferCloudLabels = isCloudRenderFlagEnabled('cloudAdaptiveLod') && visibleCloudCount > DEFAULT_CLOUD_LOD_OPTIONS.budget;
    cloudLodSetVersion += 1;
    cloudLodPlanKey = '';

    for (const c of store.cloudAnnotations.value) {
      if (!c.visible) continue;
      const anchor = new Vector3(...c.anchorWorldPos);
      const visual = createCloudAnnotationVisual(c, resolution);
      const degrade = degradeOf('cloud', c.id);
      // 引线的降级在这里就地应用；轮廓 / 盒边 / 小针的颜色与虚线由 updateOverlayPositions 的 paint 阶段按 cloud.degrade 统一刷
      applyLeaderDegrade(visual.leader, buildAnnotationLeaderStyle('cloud').color, degrade);
      // pin / outline / bboxEdges 始终加入；leader（图钉 → 文字框引线）随 collapsed 控制，
      // 与文字批注的「双击图钉收起文字框 / 引线，保留图钉」行为对齐。
      toolsGroup.add(visual.pin, visual.outline, visual.bboxEdges);
      if (shouldRenderTextAnnotationCard(c.collapsed)) {
        toolsGroup.add(visual.leader.root);
      }
      const cloudEntry: CloudOverlayEl = {
        id: `cloud:${c.id}`,
        worldPos: anchor,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
        outline: visual.outline,
        outlineExtra: [],
        bboxEdges: visual.bboxEdges,
        pin: visual.pin,
        pinDashSize: visual.pinDashSize,
        record: c,
        targetBbox: null,
        targetBboxAt: 0,
        render: createCloudRenderCache(),
        degrade,
        badgeEl: degrade ? createCloudDegradeBadgeEl(overlay, degrade) : null,
        badgeDirty: true,
      };
      cloudShapes.set(cloudEntry.id, cloudEntry);

      // 云线的图钉只换灰虚线、不挂徽标——徽标挂在轮廓参考框左上角，一条记录一枚
      const cloudMarker = makeTextAnnotationMarkerEl(overlay, 'C', c.collapsed === true, { degrade, badge: false });
      markers.set(`cloud:${c.id}`, {
        id: `cloud:${c.id}`,
        worldPos: anchor,
        el: cloudMarker,
        marker: { kind: 'cloud', annotationId: c.id, glyph: 'C', collapsed: c.collapsed === true, degrade },
      });
      cloudMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        activateAnnotation('cloud', c.id);
      });
      // 与文字批注 marker 一致：双击图钉切换 collapsed，
      // 收起时只渲染图钉，展开后再补回文字框 / 引线。
      cloudMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setCloudAnnotationsCollapsed([c.id], toggleTextAnnotationCollapsed(c.collapsed));
        activateAnnotation('cloud', c.id);
      });
      // P4 LOD「悬停临时展示」：图钉上悬停即固定高档（补回轮廓 + 文字框），移开后按预算回落
      cloudMarker.addEventListener('pointerenter', () => setHoveredCloudAnnotation(c.id));
      cloudMarker.addEventListener('pointerleave', () => {
        if (hoveredCloudAnnotationId === c.id) setHoveredCloudAnnotation(null);
      });

      if (shouldRenderTextAnnotationCard(c.collapsed) && !deferCloudLabels) {
        mountCloudLabel(cloudEntry);
      }
    }

    // ---------------- Rect annotations (OBB rectangle) ----------------
    for (const r of store.rectAnnotations.value) {
      if (!r.visible) continue;

      const visual = createRectAnnotationVisual(r, resolution);
      if (!visual) continue;
      // box + pin 始终加入；leader 随 collapsed 控制（与文字 / 云线一致）。
      toolsGroup.add(visual.box, visual.pin);
      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        toolsGroup.add(visual.leader.root);
      }

      const rectAnchor = new Vector3(...r.anchorWorldPos);
      const rectDegrade = degradeOf('rect', r.id);
      const rectEntry: RectOverlayEl = {
        id: `rect:${r.id}`,
        worldPos: rectAnchor,
        labelWorldPos: (r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos).clone(),
        leader: visual.leader,
        box: visual.box,
        pin: visual.pin,
        lineColor: visual.lineColor,
        boxDashSize: visual.boxDashSize,
        pinDashSize: visual.pinDashSize,
        degrade: null,
      };
      // ADR-0050：成员 missing 时线框 / 小针 / 引线灰虚线（与云线同一套）
      applyBoxOverlayDegrade(rectEntry, 'rect', rectDegrade);
      rectShapes.set(rectEntry.id, rectEntry);

      // 新增 DOM marker：与 cloud 一致，提供「双击图钉收起 / 展开」入口。
      const rectMarker = makeTextAnnotationMarkerEl(overlay, 'R', r.collapsed === true, { degrade: rectDegrade, badge: true });
      markers.set(`rect:${r.id}`, {
        id: `rect:${r.id}`,
        worldPos: rectAnchor,
        el: rectMarker,
        marker: { kind: 'rect', annotationId: r.id, glyph: 'R', collapsed: r.collapsed === true, degrade: rectDegrade },
      });
      rectMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        activateAnnotation('rect', r.id);
      });
      rectMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setRectAnnotationsCollapsed([r.id], toggleTextAnnotationCollapsed(r.collapsed));
        activateAnnotation('rect', r.id);
      });

      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        const draft = getInlineTextAnnotationDraft('rect', r.id, r);
        const label = makeInlineAnnotationCardEl(overlay, '矩形批注', draft.title, draft.description);
        if (r.severity) label.dataset.severity = r.severity;
        const labelWorldPos = r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos;
        labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: labelWorldPos, el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('rect', r.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          focusInlineAnnotationEditor('rect', r.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('rect', r.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('rect', r.id);
          dragHandle.style.cursor = 'grabbing';
          beginInlineOverlayAnnotationDrag('rect', r.id, ev, labelWorldPos, rectAnchor);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('rect', r.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('rect', r.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('rect', r.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('rect', r.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingRectAnnotationEditId.value === r.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('rect', r.id));
        }
      }
    }

    // ---------------- OBB annotations ----------------
    for (const o of store.obbAnnotations.value) {
      if (!o.visible) continue;
      const visual = createObbAnnotationVisual(o, resolution);
      if (!visual) continue;
      // box + pin 始终加入；leader 随 collapsed 控制（与文字 / 云线 / 矩形一致）。
      toolsGroup.add(visual.box, visual.pin);
      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        toolsGroup.add(visual.leader.root);
      }

      const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(o);
      const obbDegrade = degradeOf('obb', o.id);
      const obbEntry: ObbOverlayEl = {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
        box: visual.box,
        pin: visual.pin,
        lineColor: visual.lineColor,
        boxDashSize: visual.boxDashSize,
        pinDashSize: visual.pinDashSize,
        degrade: null,
      };
      // ADR-0050：成员 missing 时线框 / 小针 / 引线灰虚线（与云线 / 矩形同一套）
      applyBoxOverlayDegrade(obbEntry, 'obb', obbDegrade);
      obbShapes.set(obbEntry.id, obbEntry);

      // 新增 DOM marker：与 cloud / rect 一致，提供「双击图钉收起 / 展开」入口。
      const obbMarker = makeTextAnnotationMarkerEl(overlay, 'O', o.collapsed === true, { degrade: obbDegrade, badge: true });
      markers.set(`obb:${o.id}`, {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        el: obbMarker,
        marker: { kind: 'obb', annotationId: o.id, glyph: 'O', collapsed: o.collapsed === true, degrade: obbDegrade },
      });
      obbMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        activateAnnotation('obb', o.id);
      });
      obbMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setObbAnnotationsCollapsed([o.id], toggleTextAnnotationCollapsed(o.collapsed));
        activateAnnotation('obb', o.id);
      });

      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        const draft = getInlineTextAnnotationDraft('obb', o.id, o);
        const label = makeInlineAnnotationCardEl(overlay, 'OBB 批注', draft.title, draft.description);
        if (o.severity) label.dataset.severity = o.severity;
        labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: visual.labelWorldPos.clone(), el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('obb', o.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          focusInlineAnnotationEditor('obb', o.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('obb', o.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('obb', o.id);
          dragHandle.style.cursor = 'grabbing';
          beginInlineOverlayAnnotationDrag('obb', o.id, ev, visual.labelWorldPos.clone(), anchorWorldPos);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('obb', o.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('obb', o.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('obb', o.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('obb', o.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingObbEditId.value === o.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('obb', o.id));
        }
      }
    }

    // preview rect line (if exists)
    if (rectPreviewLine.value) {
      toolsGroup.add(rectPreviewLine.value);
    }

    updateOverlayPositions();
    requestRender?.();
  }

  /**
   * 云线贴合/包围盒所依据的目标合并 AABB。
   *
   * 不能只认 `record.selectionBbox`——它是创建那一刻的世界坐标快照，
   * 创建时目标未加载就永远缺失，模型版本切换后又会框住旧位置。
   * 这里按目标 refnos 现算并缓存 `CLOUD_TARGET_BBOX_TTL_MS`，
   * 解析不到（未加载 / refno 失效）时才退回快照，保证既自愈又不倒退。
   */
  function resolveCloudTargetBbox(cloud: CloudOverlayEl): { min: Vec3; max: Vec3 } | null {
    const now = Date.now();
    // 用时间戳而不是「有没有结果」判缓存：解析失败（目标未加载）同样要冷却，
    // 否则一批未加载目标的云线会每帧各查一次 AABB。
    if (cloud.targetBboxAt > 0 && now - cloud.targetBboxAt < CLOUD_TARGET_BBOX_TTL_MS) {
      return cloud.targetBbox;
    }
    const refnos = getCloudMemberRefnos(cloud.record);
    const live = refnos.length > 0
      ? compatViewerRef.value?.scene.getAABB(refnos) ?? null
      : null;
    cloud.targetBbox = live
      ? { min: [live[0], live[1], live[2]], max: [live[3], live[4], live[5]] }
      : cloud.record.selectionBbox ?? null;
    cloud.targetBboxAt = now;
    return cloud.targetBbox;
  }

  function updateOverlayPositions() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const resolution = getCanvasResolution(canvas);

    for (const leader of textLeaders.values()) {
      setAnnotationLeaderResolution(leader, resolution.width, resolution.height);
    }
    for (const cloud of cloudShapes.values()) {
      setAnnotationLeaderResolution(cloud.leader, resolution.width, resolution.height);
    }
    for (const rect of rectShapes.values()) {
      setAnnotationLeaderResolution(rect.leader, resolution.width, resolution.height);
    }
    for (const obb of obbShapes.values()) {
      setAnnotationLeaderResolution(obb.leader, resolution.width, resolution.height);
    }

    // ---- 帧级版本戳（方案 §9.1，开关 cloudDirtyCache）：所有云线共用，一帧算一次 ----
    const dirtyCacheOn = isCloudRenderFlagEnabled('cloudDirtyCache');
    const labelFlagOn = isCloudRenderFlagEnabled('cloudLabelLayoutV1');
    const envelopeOn = isCloudRenderFlagEnabled('cloudProjectedEnvelope');
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const drawMode = annotationStyleStore.cloudDrawMode.value;
    const cloudStyle = annotationStyleStore.style.cloud;
    const frameStamp = {
      cameraWorld: cloudFrameTrackers.cameraWorld.update(viewer.camera.matrixWorld.elements),
      projection: cloudFrameTrackers.projection.update(viewer.camera.projectionMatrix.elements),
      viewportCss: cloudFrameTrackers.viewportCss.update([canvasRect.width, canvasRect.height]),
      overlayTransform: cloudFrameTrackers.overlayTransform.update([
        canvasRect.left - overlayRect.left,
        canvasRect.top - overlayRect.top,
        overlayRect.width,
        overlayRect.height,
      ]),
      dpr: cloudFrameTrackers.dpr.update([resolution.width, resolution.height]),
      globalModelMatrix: cloudFrameTrackers.globalModelMatrix.update(
        dtxLayerRef.value?.getGlobalModelMatrix().elements ?? IDENTITY_MATRIX_ELEMENTS,
      ),
      modelEpoch: dtxLoaderRevision.value,
      shapeStyle: cloudFrameTrackers.shapeStyle.update(`${drawMode}|${CLOUD_FIT_PADDING_PX}|${envelopeOn ? 1 : 0}|${cloudStyle.lineWidth}`),
      paintStyle: cloudFrameTrackers.paintStyle.update(`${cloudStyle.color}|${cloudStyle.opacity}|${cloudStyle.lineWidth}`),
    };
    const viewportRect = { x: 0, y: 0, width: overlayRect.width || canvasRect.width, height: overlayRect.height || canvasRect.height };
    cloudRenderStats.frames += 1;

    // ---- P4 LOD（方案 §9.3）：超预算时先定本帧谁算全轮廓、谁只留图钉；相机 / 视口 / 集合 / 交互态没变就复用上次计划 ----
    planCloudLodForFrame(viewer.camera, `${frameStamp.cameraWorld}|${frameStamp.projection}|${frameStamp.viewportCss}`);

    for (const cloud of cloudShapes.values()) {
      // ---- LOD 切档：pin 档整条跳过（不解析目标 AABB、不算凸包、不 setPoints、不排文字框），只剩 DOM 图钉 ----
      if (cloud.render.lodLevel === 'pin') {
        if (cloud.render.lodApplied !== 'pin') {
          cloud.render.lodApplied = 'pin';
          cloud.outline.visible = false;
          for (const extra of cloud.outlineExtra) extra.visible = false;
          cloud.bboxEdges.visible = false;
          cloud.leader.root.visible = false;
          unmountCloudLabel(cloud);
          cloud.render.frame = null;
          cloud.render.regionPhase = null;
          cloud.render.stamp = null;
        }
        // 降级徽标跟着图钉走（没有参考框）
        if (cloud.badgeEl) {
          positionCloudDegradeBadge(cloud.badgeEl, null, worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos), false);
        }
        continue;
      }
      if (cloud.render.lodApplied !== 'full') {
        // 首帧或从 pin 升回来：全部阶段重建；文字框按 collapsed 补挂；引线先放出来，V1 布局再按需要藏
        const promoted = cloud.render.lodApplied === 'pin';
        cloud.render.lodApplied = 'full';
        if (promoted) {
          cloud.render.stamp = null;
          cloud.leader.root.visible = true;
        }
        if (shouldRenderTextAnnotationCard(cloud.record.collapsed)) mountCloudLabel(cloud);
      }
      const recordVersion = cloud.render.recordTracker.update(cloud.record);
      // ---- P2：range 记录（开关开 + 显式 region-v1）先把范围体校验 / 重映射成当前世界系的凸单元 ----
      // 随「记录引用 | DTX 全局矩阵版本」失效；校验不过 = missing-region → 下面照旧走旧管线（唯一允许回退旧布局的状态）
      const regionRequested = envelopeOn && isRegionPresentationRecord(cloud.record);
      if (regionRequested) {
        const cellsKey = `${recordVersion}|${frameStamp.globalModelMatrix}`;
        if (cloud.render.regionCellsKey !== cellsKey) {
          const recorded = cloud.record.regionV1?.source.globalModelMatrix ?? null;
          const current = dtxLayerRef.value?.getGlobalModelMatrix() ?? null;
          let remap: number[] | null = null;
          if (recorded && current && !matricesEqual(recorded, current.elements)) {
            const old = new Matrix4().fromArray(recorded);
            // 唯一有可信转换的情形：两边矩阵都在 → G_new · G_old⁻¹ 把范围体搬到当前世界系再投影（§8 补充 1）
            remap = Math.abs(old.determinant()) > 1e-18 ? current.clone().multiply(old.invert()).elements.slice() : null;
          }
          // §8：快照与绑定不一致（重绑后新成员还没拿到盒）= 没有可用范围，走旧的实时 AABB 贴合，不用子集缩小范围冒充
          const covers = regionCoversMembers(cloud.record.regionV1, getCloudMemberRefnos(cloud.record));
          const validated = covers
            ? regionToWorldCells(cloud.record.regionV1, remap)
            : { ok: false as const, reason: 'coverage: region does not cover all members' };
          cloud.render.regionCells = validated.ok ? validated.cells : null;
          cloud.render.regionInvalidReason = validated.ok ? null : validated.reason;
          cloud.render.regionCellsKey = cellsKey;
          if (!validated.ok) cloud.render.regionPhase = null;
        }
      } else if (cloud.render.regionCells || cloud.render.regionCellsKey) {
        cloud.render.regionCells = null;
        cloud.render.regionCellsKey = '';
        cloud.render.regionInvalidReason = null;
        cloud.render.regionPhase = null;
      }
      const regionCells = regionRequested ? cloud.render.regionCells : null;
      // 范围体是回放权威：走新管线的记录不再每帧解析目标 AABB
      const sb = regionCells ? null : resolveCloudTargetBbox(cloud);
      const labelEntry = labels.get(cloud.id);
      // 走 V1 屏幕布局的条件：开关开，且记录带 labelLayoutV1——或正在按像素拖动（旧记录第一次拖动即按默认锚点升级，松手写入记录）
      const labelDragging = labelFlagOn && cloud.render.labelDragTopLeft !== null;
      const layoutRecord = labelFlagOn
        ? (cloud.record.labelLayoutV1 ?? (labelDragging ? createDefaultCloudLabelLayoutV1() : null))
        : null;
      const labelV1 = !!labelEntry && !!layoutRecord;
      // 文字框实测尺寸是 label 阶段的依赖（字体加载完、文字改了都会变）；布局干净时读 offsetWidth 不触发回流
      const measured = labelV1 && labelEntry ? measureLabelSize(labelEntry.el) : null;
      const stamp: CloudRenderStamp = {
        ...frameStamp,
        // paint 版本叠上本条记录的降级态：解析表让它 missing / stale（或恢复）时，只有它重刷材质
        paintStyle: cloud.render.paintTracker.update(`${frameStamp.paintStyle}|${cloud.degrade?.state ?? ''}`),
        targetBounds: cloud.render.targetBoundsTracker.update(sb ? [...sb.min, ...sb.max] : EMPTY_BOUNDS),
        bindings: recordVersion,
        effectiveRegion: cloud.render.regionCellsTracker.update(regionCells),
        labelMetrics: measured
          ? cloud.render.labelMetricsTracker.update(`${measured.width}x${measured.height}`)
          : cloud.render.labelMetricsTracker.version,
        labelPreference: recordVersion,
        presentation: recordVersion,
      };
      const dirty = dirtyCacheOn ? computeCloudDirty(cloud.render.stamp, stamp) : { ...ALL_CLOUD_DIRTY };
      cloud.render.stamp = stamp;

      if (dirty.paint) {
        // ADR-0050 视口降级：missing / stale 的记录轮廓 / 盒边 / 小针一律灰 + 虚线（outlineExtra 与 outline 共用材质）
        const outlineMat = cloud.outline.material as MeshLineMaterial;
        applyMeshLineDegrade(outlineMat, cloudStyle.color, cloud.degrade);
        outlineMat.opacity = cloudStyle.opacity;
        outlineMat.lineWidth = cloudStyle.lineWidth;
        outlineMat.resolution.set(resolution.width, resolution.height);
        const bboxMat = cloud.bboxEdges.material as LineDashedMaterial;
        applyDashedLineDegrade(bboxMat, cloudStyle.color, cloud.degrade, dashSizeFromLineSegments(cloud.bboxEdges));
        bboxMat.opacity = cloudStyle.opacity;
        applyDashedLineDegrade(cloud.pin.material as LineDashedMaterial, cloudStyle.color, cloud.degrade, cloud.pinDashSize);
        cloudRenderStats.paintUpdates += 1;
      }

      if (dirty.shape && regionCells) {
        // ---- P2 范围体管线（方案 §3.3）：齐次裁剪 → 屏幕凸包 → 圆角外扩 → 单侧余弦波纹 → billboard ----
        cloudRenderStats.contourBuilds += 1;
        const viewport = {
          width: canvasRect.width || canvas.clientWidth || 1,
          height: canvasRect.height || canvas.clientHeight || 1,
        };
        const viewProjection = new Matrix4().multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse);
        const style = regionRenderStyleFromRecord(cloud.record, cloudStyle.lineWidth);
        const result = renderCloudRegion({
          cells: regionCells,
          viewProjection: viewProjection.elements,
          viewport,
          style,
          previous: cloud.render.regionPhase,
          previousLod: cloud.render.regionLod,
          active: store.activeCloudAnnotationId.value === cloud.record.id,
        });
        cloud.render.regionState = result.state;
        cloud.render.regionLastLod = result.lod;
        cloud.render.regionLod = result.lod === 'icon' ? 'icon' : 'cloud';
        if (result.path && result.phase) cloud.render.regionPhase = { path: result.path, frame: result.phase };
        cloud.render.regionPolylineCount = result.polylines.length;

        // 屏幕坐标是 canvas CSS 像素；文字框布局与 DOM 定位要 overlay 坐标
        const dx = canvasRect.left - overlayRect.left;
        const dy = canvasRect.top - overlayRect.top;
        cloud.render.frame = result.referenceBounds
          ? {
            referenceBounds: {
              x: result.referenceBounds.x + dx,
              y: result.referenceBounds.y + dy,
              width: result.referenceBounds.width,
              height: result.referenceBounds.height,
            },
            enclosure: result.enclosure.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            visibleStrokes: result.polylines.map((piece) => piece.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
          }
          : null;
        // 置顶装饰线统一放在 ndcZ = 0 的 billboard 平面；引线端点同一平面反投影
        cloud.render.frameNdcZ = 0;

        if (drawMode === 'bbox3d') {
          // §4.7：同一范围体的真实盒边（多成员多盒、剪切下按平行六面体），不再画随相机游动的波浪边；可见性由裁剪结果决定
          cloud.outline.visible = false;
          for (const extra of cloud.outlineExtra) extra.visible = false;
          updateCloudBboxLineSegmentsGeometry(cloud.bboxEdges, collectWorldCellEdgePositions(regionCells));
          cloudRenderStats.setPoints += 1;
          cloud.bboxEdges.visible = result.projection.state === 'visible';
        } else {
          cloud.bboxEdges.visible = false;
          const inverseViewProjection = viewProjection.clone().invert().elements;
          const pieces = result.polylines;
          // 第 1 段用主 MeshLine，其余段用同材质的备用 MeshLine（MeshLine 不支持子路径）
          while (cloud.outlineExtra.length < pieces.length - 1) {
            const extra = new MeshLine(new MeshLineGeometry(), cloud.outline.material as MeshLineMaterial);
            extra.frustumCulled = false;
            extra.renderOrder = cloud.outline.renderOrder;
            toolsGroup.add(extra);
            cloud.outlineExtra.push(extra);
          }
          const meshes = [cloud.outline, ...cloud.outlineExtra];
          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i]!;
            const piece = pieces[i];
            if (!piece || piece.length < 2) {
              mesh.visible = false;
              continue;
            }
            const positions = liftScreenPolylineToBillboard(piece, inverseViewProjection, viewport, 0);
            (mesh.geometry as MeshLineGeometry).setPoints(positions);
            mesh.geometry.computeBoundingSphere();
            mesh.visible = true;
            cloudRenderStats.setPoints += 1;
          }
        }
      } else if (dirty.shape) {
        cloudRenderStats.contourBuilds += 1;
        const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos);
        const labelScreen = labelV1 ? null : worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.labelWorldPos);
        cloud.render.frame = null;
        cloud.render.frameNdcZ = anchorScreen.ndcZ;
        cloud.render.regionState = regionRequested ? 'missing-region' : null;
        for (const extra of cloud.outlineExtra) extra.visible = false;

        let renderBbox3d = drawMode === 'bbox3d' && !!sb?.min && !!sb?.max;
        let bboxPositions: Float32Array | null = null;
        if (renderBbox3d && sb) {
          const camPos = new Vector3();
          viewer.camera.getWorldPosition(camPos);
          bboxPositions = buildWavySelectionBboxLinePositions(sb.min, sb.max, camPos, 10);
          if (bboxPositions.length < 6) {
            renderBbox3d = false;
            bboxPositions = null;
          }
        }

        if (renderBbox3d && bboxPositions && sb) {
          cloud.outline.visible = false;
          updateCloudBboxLineSegmentsGeometry(cloud.bboxEdges, bboxPositions);
          cloudRenderStats.setPoints += 1;
          cloud.bboxEdges.visible = anchorScreen.visible;
          // bbox3d 下文字框仍需要一个屏幕参考框：8 个角点全部可见时取其外接矩形 + padding，否则退回旧世界点布局
          const projectedCorners = boxCornersFromMinMaxVec(
            new Vector3(sb.min[0], sb.min[1], sb.min[2]),
            new Vector3(sb.max[0], sb.max[1], sb.max[2]),
          ).map((corner) => worldToOverlayPoint(viewer.camera, canvas, overlay, corner));
          if (projectedCorners.every((p) => p.visible)) {
            const fittedRect = computeFittedCloudRectFromCorners(projectedCorners, CLOUD_FIT_PADDING_PX);
            if (fittedRect) {
              cloud.render.frame = rectToCloudFrame({
                x: fittedRect.centerX - fittedRect.widthPx / 2,
                y: fittedRect.centerY - fittedRect.heightPx / 2,
                width: fittedRect.widthPx,
                height: fittedRect.heightPx,
              });
              cloud.render.frameNdcZ = worldToOverlayPoint(
                viewer.camera,
                canvas,
                overlay,
                new Vector3((sb.min[0] + sb.max[0]) * 0.5, (sb.min[1] + sb.max[1]) * 0.5, (sb.min[2] + sb.max[2]) * 0.5),
              ).ndcZ;
            }
          }
        } else {
          cloud.bboxEdges.visible = false;
          cloud.outline.visible = true;

          // 贴合优先：把目标合并 AABB 的 8 个角投影到屏幕求外接矩形（+padding），保证
          // 绑定目标在任意相机角度下都被云线包住；拖框尺寸只作最小尺寸兜底。
          // AABB 缺失或有角点越过近/远平面（如相机钻进目标内部）时退回锚点+偏移的固定布局。
          const minWidthPx = clamp(cloud.record.cloudSize?.width ?? 120, 72, 220);
          const minHeightPx = clamp(cloud.record.cloudSize?.height ?? 72, 48, 180);
          let widthPx = minWidthPx;
          let heightPx = minHeightPx;
          const off = cloud.record.screenOffset ?? { x: widthPx * 0.5 + 26, y: -(heightPx * 0.5 + 18) };
          let centerX = anchorScreen.x + off.x;
          let centerY = anchorScreen.y + off.y;
          let centerNdcZ = anchorScreen.ndcZ;
          let fitted = false;
          if (sb?.min && sb?.max) {
            const cornerPoints = boxCornersFromMinMaxVec(
              new Vector3(sb.min[0], sb.min[1], sb.min[2]),
              new Vector3(sb.max[0], sb.max[1], sb.max[2]),
            );
            const projectedCorners = cornerPoints.map(
              (corner) => worldToOverlayPoint(viewer.camera, canvas, overlay, corner),
            );
            if (projectedCorners.every((p) => p.visible)) {
              const fittedRect = computeFittedCloudRectFromCorners(projectedCorners, CLOUD_FIT_PADDING_PX, {
                width: minWidthPx,
                height: minHeightPx,
              });
              if (fittedRect) {
                widthPx = fittedRect.widthPx;
                heightPx = fittedRect.heightPx;
                centerX = fittedRect.centerX;
                centerY = fittedRect.centerY;
                // billboard 平面放在 AABB 中心深度，保证像素→世界换算与投影一致
                centerNdcZ = worldToOverlayPoint(
                  viewer.camera,
                  canvas,
                  overlay,
                  new Vector3(
                    (sb.min[0] + sb.max[0]) * 0.5,
                    (sb.min[1] + sb.max[1]) * 0.5,
                    (sb.min[2] + sb.max[2]) * 0.5,
                  ),
                ).ndcZ;
                fitted = true;
              }
            }
          }
          const cloudCenterWorld = overlayToWorld(
            viewer.camera,
            canvas,
            overlay,
            centerX,
            centerY,
            centerNdcZ,
          );
          const worldPerPixel = worldPerPixelAt(
            viewer.camera,
            cloudCenterWorld,
            Math.max(1, canvas.clientWidth),
            Math.max(1, canvas.clientHeight),
          );
          const cameraDir = viewer.camera.getWorldDirection(new Vector3()).normalize();
          let right = new Vector3().crossVectors(cameraDir, viewer.camera.up).normalize();
          if (!Number.isFinite(right.lengthSq()) || right.lengthSq() < 1e-8) {
            right = new Vector3(1, 0, 0);
          }
          const up = new Vector3().crossVectors(right, cameraDir).normalize();
          const wavesPerEdge = cloudWavesPerEdgeForSizePx(widthPx, heightPx);
          const positions = buildCloudBillboardPolyline(
            cloudCenterWorld,
            right,
            up,
            widthPx * worldPerPixel,
            heightPx * worldPerPixel,
            clamp(wavesPerEdge * 4, 16, 200),
            worldPerPixel,
            wavesPerEdge,
          );
          const outlineGeometry = cloud.outline.geometry as MeshLineGeometry;
          outlineGeometry.setPoints(positions);
          cloudRenderStats.setPoints += 1;
          cloud.outline.geometry.computeBoundingSphere();
          // V1 标签总在视口安全区内，可见性只看锚点；旧布局仍要求文字框世界点也在视锥内
          cloud.outline.visible = fitted || (anchorScreen.visible && (labelScreen?.visible ?? true));
          // 文字框的屏幕参考框 = 加 padding、未加波浪的矩形（波浪只向外，参考框不含它）
          cloud.render.frame = rectToCloudFrame({
            x: centerX - widthPx / 2,
            y: centerY - heightPx / 2,
            width: widthPx,
            height: heightPx,
          });
          cloud.render.frameNdcZ = centerNdcZ;
        }
      }

      // ---- ADR-0050 视口降级：盒边几何刚重建时按新尺度补一次虚线节拍；徽标贴到轮廓参考框左上角 ----
      if (cloud.degrade && dirty.shape && cloud.bboxEdges.visible) {
        applyDashedLineDegrade(cloud.bboxEdges.material as LineDashedMaterial, cloudStyle.color, cloud.degrade, dashSizeFromLineSegments(cloud.bboxEdges));
      }
      if (cloud.badgeEl && (dirty.shape || dirty.paint || cloud.badgeDirty)) {
        cloud.badgeDirty = false;
        const frame = cloud.render.frame;
        positionCloudDegradeBadge(
          cloud.badgeEl,
          frame ? { x: frame.referenceBounds.x, y: frame.referenceBounds.y } : null,
          worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos),
          cloud.outline.visible || cloud.bboxEdges.visible,
        );
      }

      // ---- 文字框 + 引线（方案 §5，开关 cloudLabelLayoutV1）----
      if (labelEntry) {
        const frame = cloud.render.frame;
        if (labelV1 && frame && layoutRecord && measured) {
          const dragTopLeft = cloud.render.labelDragTopLeft;
          if (dirty.label || dragTopLeft || labelEntry.layoutMode !== 'v1') {
            const preference: LabelPreference = dragTopLeft
              ? { uv: layoutRecord.anchor.uv, offsetPx: labelOffsetFromTopLeft(frame.referenceBounds, layoutRecord.anchor.uv, dragTopLeft) }
              : labelPreferenceFromRecord(layoutRecord);
            const layout = layoutCloudLabel(frame, preference, measured, viewportRect);
            cloud.render.labelLayout = layout;
            cloudRenderStats.labelLayouts += 1;

            labelEntry.layoutMode = 'v1';
            labelEntry.el.style.transform = 'none';
            labelEntry.el.style.left = `${layout.rect.x}px`;
            labelEntry.el.style.top = `${layout.rect.y}px`;
            labelEntry.el.style.opacity = '1';

            if (layout.leader) {
              const start = overlayToWorld(viewer.camera, canvas, overlay, layout.leader.start.x, layout.leader.start.y, cloud.render.frameNdcZ);
              const end = overlayToWorld(viewer.camera, canvas, overlay, layout.leader.end.x, layout.leader.end.y, cloud.render.frameNdcZ);
              updateLeaderGeometry(cloud.leader, start, end);
              cloud.leader.root.visible = true;
            } else {
              cloud.leader.root.visible = false;
            }
          }
        } else if (labelV1 && regionCells && layoutRecord) {
          // 范围体在（offscreen / depth-empty / 图标态）但本帧没有可用轮廓：藏起文字框与引线，
          // **不**回退旧世界点布局——「有范围但被裁剪 / 出屏」与「没有可用范围」是两种状态
          if (dirty.label || labelEntry.layoutMode !== 'v1') {
            labelEntry.layoutMode = 'v1';
            labelEntry.el.style.transform = 'none';
            labelEntry.el.style.opacity = '0';
            cloud.leader.root.visible = false;
            cloud.render.labelLayout = null;
          }
        } else if (labelEntry.layoutMode === 'v1') {
          // 从 V1 回到旧布局（开关关掉 / 本帧没有可用轮廓）：还原居中变换与图钉 → 文字框引线
          labelEntry.layoutMode = 'legacy';
          labelEntry.el.style.transform = 'translate(-50%,-50%)';
          cloud.leader.root.visible = true;
          updateLeaderGeometry(cloud.leader, cloud.worldPos, cloud.labelWorldPos);
          cloud.render.labelLayout = null;
        }
      }
    }

    for (const it of markers.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
    }

    for (const it of labels.values()) {
      if (it.layoutMode === 'v1') continue;
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
    }
  }

  /**
   * ADR-0050 视口降级：解析表变了（模型加载 / 版本切换、定位回执、详情卡重算、批注后到）就地换外观——
   * 不走 syncFromStore 重建：重建会打断行内编辑（输入框被换掉）并清空云线渲染缓存。
   * 云线：记 `degrade`、换引线、增删徽标，轮廓 / 盒边 / 小针交给下一帧 paint 阶段（paintTracker 含降级态）；
   * 图钉：原地重画 SVG；文字批注引线：直接换材质；rect / obb：线框 / 小针 / 引线直接换材质。
   */
  function applyBindingDegrade(): void {
    const overlay = overlayContainerRef.value;
    const degrades = bindingResolve.getRecordDegrades();
    let changed = false;

    for (const cloud of cloudShapes.values()) {
      const degrade = degrades.get(buildRecordDegradeKey('cloud', cloud.record.id)) ?? null;
      if (sameDegrade(cloud.degrade, degrade)) continue;
      changed = true;
      cloud.degrade = degrade;
      applyLeaderDegrade(cloud.leader, buildAnnotationLeaderStyle('cloud').color, degrade);
      if (cloud.badgeEl) {
        try { cloud.badgeEl.remove(); } catch { /* ignore */ }
        cloud.badgeEl = null;
      }
      if (degrade && overlay) {
        cloud.badgeEl = createCloudDegradeBadgeEl(overlay, degrade);
        cloud.badgeDirty = true;
      }
    }

    for (const entry of markers.values()) {
      const meta = entry.marker;
      if (!meta) continue;
      const degrade = degrades.get(buildRecordDegradeKey(meta.kind, meta.annotationId)) ?? null;
      if (repaintMarkerDegrade(entry, degrade)) changed = true;
    }

    for (const [key, leader] of textLeaders) {
      const degrade = degrades.get(buildRecordDegradeKey('text', key.slice('anno:'.length))) ?? null;
      if (sameDegrade(leader.degrade, degrade)) continue;
      changed = true;
      applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
    }

    for (const [kind, shapes] of [['rect', rectShapes], ['obb', obbShapes]] as const) {
      for (const entry of shapes.values()) {
        const degrade = degrades.get(buildRecordDegradeKey(kind, entry.id.slice(kind.length + 1))) ?? null;
        if (sameDegrade(entry.degrade, degrade)) continue;
        changed = true;
        applyBoxOverlayDegrade(entry, kind, degrade);
      }
    }

    if (!changed) return;
    updateOverlayPositions();
    requestRender?.();
  }

  /** e2e / 单测：每条批注当前在视口里的降级态与外观（ADR-0050） */
  function debugAnnotationDegrades(): {
    id: string
    state: 'missing' | 'stale' | null
    /** 云线：轮廓材质是否虚线 + 颜色；图钉：SVG 填充色 */
    outlineDashed: boolean | null
    lineColor: number | null
    pinFill: string | null
    badgeText: string | null
    badgeLeft: string | null
    badgeTop: string | null
    badgeOpacity: string | null
  }[] {
    const out: ReturnType<typeof debugAnnotationDegrades> = [];
    for (const [id, cloud] of cloudShapes.entries()) {
      const outlineMat = cloud.outline.material as MeshLineMaterial;
      const marker = markers.get(id);
      out.push({
        id,
        state: cloud.degrade?.state ?? null,
        outlineDashed: outlineMat.useDash,
        lineColor: outlineMat.color.getHex(),
        pinFill: marker?.el.querySelector('svg path')?.getAttribute('fill') ?? null,
        badgeText: cloud.badgeEl?.textContent?.trim() ?? null,
        badgeLeft: cloud.badgeEl?.style.left ?? null,
        badgeTop: cloud.badgeEl?.style.top ?? null,
        badgeOpacity: cloud.badgeEl?.style.opacity ?? null,
      });
    }
    for (const [id, entry] of markers.entries()) {
      if (!entry.marker || entry.marker.kind === 'cloud') continue;
      const leader = textLeaders.get(id);
      // rect / obb：外观读线框材质（虚线 = gapSize > 0）；text：读引线
      const boxEntry = rectShapes.get(id) ?? obbShapes.get(id);
      const boxMat = boxEntry ? (boxEntry.box.material as LineDashedMaterial) : null;
      const badge = entry.el.querySelector<HTMLElement>('[data-role="annotation-binding-badge"]');
      out.push({
        id,
        state: entry.marker.degrade?.state ?? null,
        outlineDashed: boxMat ? boxMat.gapSize > 0 : leader ? leader.coreMaterial.useDash : null,
        lineColor: boxMat ? boxMat.color.getHex() : leader ? leader.coreMaterial.color.getHex() : null,
        pinFill: entry.el.querySelector('svg path')?.getAttribute('fill') ?? null,
        badgeText: badge?.textContent?.trim() ?? null,
        badgeLeft: badge?.style.left ?? null,
        badgeTop: badge?.style.top ?? null,
        badgeOpacity: null,
      });
    }
    return out;
  }

  /** 云线渲染计数快照（静止零重建等验收用） */
  function debugCloudRenderStats(): CloudRenderStats {
    return { ...cloudRenderStats };
  }

  function resetCloudRenderStats(): void {
    cloudRenderStats.frames = 0;
    cloudRenderStats.contourBuilds = 0;
    cloudRenderStats.setPoints = 0;
    cloudRenderStats.labelLayouts = 0;
    cloudRenderStats.paintUpdates = 0;
    cloudRenderStats.lodPlans = 0;
  }

  /** e2e / 单测：P4 LOD 本帧计划——预算、是否超预算、每条云线的等级 / 优先级 / 是否固定高档、文字框 DOM 是否挂着 */
  function debugCloudLod(): CloudLodDebugSnapshot {
    const items: CloudLodDebugSnapshot['items'] = [];
    for (const [id, cloud] of cloudShapes.entries()) {
      items.push({
        id,
        level: cloud.render.lodLevel,
        applied: cloud.render.lodApplied,
        priority: cloud.render.lodPriority,
        pinnedHigh: cloud.render.lodPinnedHigh,
        labelMounted: labels.has(id),
      });
    }
    return {
      budget: DEFAULT_CLOUD_LOD_OPTIONS.budget,
      slack: DEFAULT_CLOUD_LOD_OPTIONS.slack,
      overBudget: cloudLodPlanSummary.overBudget,
      fullCount: cloudLodPlanSummary.fullCount,
      pinCount: cloudLodPlanSummary.pinCount,
      hoveredId: hoveredCloudAnnotationId,
      items,
    };
  }

  /** e2e / 单测：每条云线本帧的范围体管线状态（P2）；`regionState === null` = 未走新管线（旧记录 / 开关关） */
  function debugCloudRegionRender(): {
    id: string
    regionState: CloudFitState | null
    lod: SmallTargetLod | null
    polylineCount: number
    invalidReason: string | null
    cellCount: number
    outlineVisible: boolean
    extraVisible: number
    bboxEdgesVisible: boolean
    phaseAnchorId: string | null
  }[] {
    const out: ReturnType<typeof debugCloudRegionRender> = [];
    for (const [id, cloud] of cloudShapes.entries()) {
      out.push({
        id,
        regionState: cloud.render.regionState,
        lod: cloud.render.regionLastLod,
        polylineCount: cloud.render.regionPolylineCount,
        invalidReason: cloud.render.regionInvalidReason,
        cellCount: cloud.render.regionCells?.length ?? 0,
        outlineVisible: cloud.outline.visible,
        extraVisible: cloud.outlineExtra.filter((m) => m.visible).length,
        bboxEdgesVisible: cloud.bboxEdges.visible,
        phaseAnchorId: cloud.render.regionPhase?.frame.anchorId ?? null,
      });
    }
    return out;
  }

  /** e2e / 单测：每条云线当前的屏幕参考框、V1 文字框布局与文字框 DOM 定位 */
  function debugCloudLabelLayouts(): {
    id: string
    frame: CloudFrame | null
    layout: LabelLayoutResult | null
    layoutMode: 'legacy' | 'v1'
    labelLeft: string
    labelTop: string
    leaderVisible: boolean
  }[] {
    const out: ReturnType<typeof debugCloudLabelLayouts> = [];
    for (const [id, cloud] of cloudShapes.entries()) {
      const labelEntry = labels.get(id);
      out.push({
        id,
        frame: cloud.render.frame,
        layout: cloud.render.labelLayout,
        layoutMode: labelEntry?.layoutMode === 'v1' ? 'v1' : 'legacy',
        labelLeft: labelEntry?.el.style.left ?? '',
        labelTop: labelEntry?.el.style.top ?? '',
        leaderVisible: cloud.leader.root.visible,
      });
    }
    return out;
  }

  /**
   * e2e/调试：导出每条云线轮廓当前渲染的世界坐标点与关联目标 AABB（不参与业务逻辑）。
   * `selectionBbox` 报的是本帧真正用于贴合的那份 AABB，而非记录里的创建时快照。
   */
  function debugCloudOutlines(): {
    id: string
    visible: boolean
    worldPositions: number[]
    selectionBbox: { min: Vec3; max: Vec3 } | null
  }[] {
    const out: {
      id: string
      visible: boolean
      worldPositions: number[]
      selectionBbox: { min: Vec3; max: Vec3 } | null
    }[] = [];
    for (const [id, cloud] of cloudShapes.entries()) {
      const worldPositions: number[] = [];
      for (const mesh of [cloud.outline, ...cloud.outlineExtra.filter((m) => m.visible)]) {
        const attr = (mesh.geometry as BufferGeometry).getAttribute('position');
        if (!attr) continue;
        for (let i = 0; i < attr.count; i += 1) {
          worldPositions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
        }
      }
      out.push({
        id,
        visible: cloud.outline.visible || cloud.outlineExtra.some((m) => m.visible),
        worldPositions,
        selectionBbox: resolveCloudTargetBbox(cloud),
      });
    }
    return out;
  }

  function flyToMeasurement(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.measurements.value.find((m) => m.id === id);
    if (!rec) return;
    const pts: Vec3[] = [];
    if (rec.kind === 'distance') {
      pts.push(rec.origin.worldPos, rec.target.worldPos);
    } else {
      pts.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos);
    }
    const aabb = aabbFromPoints(pts);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.annotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints([rec.worldPos]);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToCloudAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.cloudAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const refnos = getCloudMemberRefnos(rec);
    const aabb = viewer.scene.getAABB(refnos);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToRectAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.rectAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints(rec.obb.corners as any);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToObbAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.obbAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints(rec.obb.corners as any);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function removeMeasurement(id: string) {
    store.removeMeasurement(id);
  }

  function removeAnnotation(id: string) {
    store.removeAnnotation(id);
  }

  function removeCloudAnnotation(id: string) {
    store.removeCloudAnnotation(id);
  }

  function removeRectAnnotation(id: string) {
    store.removeRectAnnotation(id);
  }

  function removeObbAnnotation(id: string) {
    store.removeObbAnnotation(id);
  }

  function highlightAnnotationTargets(refnos: string[]) {
    if (refnos.length === 0) return;
    window.dispatchEvent(new CustomEvent('showModelByRefnos', {
      detail: { refnos, regenModel: false, flyTo: true, highlight: true },
    }));
  }

  function highlightAnnotationTarget(refno: string) {
    highlightAnnotationTargets([refno]);
  }

  function clearAllInScene() {
    clearTextAnnotationMarkerClickTimer();
    resetPickCandidateSession();
    clearGroup(toolsGroup);
    clearOverlayEls();
    hideMarquee();
    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    resetProgress();
    clearPendingCloudAnchor();
    store.clearAll();
  }

  function dispose() {
    clearTextAnnotationMarkerClickTimer();
    resetPickCandidateSession();
    const viewer = dtxViewerRef.value;
    if (viewer && toolsGroup.parent === viewer.scene) {
      try { viewer.scene.remove(toolsGroup); } catch { /* ignore */ }
    }
    clearGroup(toolsGroup);
    clearOverlayEls();
    hideMarquee();
    cloudLodLevels.clear();
    cloudLodPlanKey = '';
    hoveredCloudAnnotationId = null;

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove(); } catch { /* ignore */ }
      marqueeDiv.value = null;
    }

    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
  }

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const sel = selectionRef.value;
    if (!sel) return null;
    const pos = getCanvasPos(canvas, e);
    const hit = sel.pickPoint(pos);
    if (!hit) return null;
    const refno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId;
    return { entityId: refno, worldPos: hit.point.clone(), objectId: hit.objectId };
  }

  /** 光标射线上的全部命中（含被遮挡的），由近到远，供候选轮换使用。 */
  function pickSurfaceRayHits(canvas: HTMLCanvasElement, e: PointerEvent): PickRefnoRayHit[] {
    const sel = selectionRef.value;
    if (typeof sel?.pickPoints !== 'function') return [];
    return sel.pickPoints(getCanvasPos(canvas, e)).map((hit) => ({
      entityId: parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId,
      objectId: hit.objectId,
      distance: hit.distance,
    }));
  }

  function computeRectPlaneBasis(camera: any, normal: Vector3): { u: Vector3; v: Vector3 } {
    const camUp = camera.up ? (camera.up as Vector3) : new Vector3(0, 0, 1);
    const u = new Vector3().crossVectors(normal, camUp);
    if (u.lengthSq() < 1e-8) {
      u.set(1, 0, 0);
    } else {
      u.normalize();
    }
    const v = new Vector3().crossVectors(u, normal).normalize();
    return { u, v };
  }

  function intersectPlaneFromPointer(canvas: HTMLCanvasElement, e: PointerEvent, plane: Plane): Vector3 | null {
    const viewer = dtxViewerRef.value;
    if (!viewer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const ndc = new Vector3(x, y, 0.5);
    ndc.unproject(viewer.camera);
    const dir = ndc.sub(viewer.camera.position).normalize();
    const rayOrigin = viewer.camera.position.clone();
    const hit = new Vector3();
    // Plane.intersectLine expects Line3; use analytic ray-plane intersection
    const denom = plane.normal.dot(dir);
    if (Math.abs(denom) < 1e-8) return null;
    const t = -(rayOrigin.dot(plane.normal) + plane.constant) / denom;
    if (!Number.isFinite(t)) return null;
    hit.copy(dir).multiplyScalar(t).add(rayOrigin);
    return hit;
  }

  function updateRectPreview(worldCorners: Vector3[]) {
    if (worldCorners.length !== 4) return;
    const pts = [...worldCorners, worldCorners[0]!];
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      arr.push(p.x, p.y, p.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    const mat = new LineBasicMaterial({ color: 0x111827 })
      ; (mat as any).depthTest = false;
    const line = new Line(g, mat);
    line.renderOrder = 950;

    if (rectPreviewLine.value) {
      try {
        toolsGroup.remove(rectPreviewLine.value);
        rectPreviewLine.value.geometry.dispose()
        ; (rectPreviewLine.value.material as any)?.dispose?.();
      } catch { /* ignore */ }
    }
    rectPreviewLine.value = line;
    toolsGroup.add(line);
  }

  /**
   * 框选命中计算。逐 refno 投影八个角点，规模等于已加载构件数，因此这里对热点很敏感：
   * - 视口矩形只读一次，`worldToOverlay` 每次调用都会 getBoundingClientRect，
   *   放在角点循环里就是每个构件 16 次强制重排；
   * - 先用视锥剔除掉屏幕外的构件，绝大多数 refno 连投影都不用做。
   */
  function collectRefnosInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number): string[] {
    const viewer = compatViewerRef.value;
    const overlay = overlayContainerRef.value;
    const dtxViewer = dtxViewerRef.value;
    if (!viewer || !overlay || !dtxViewer) return [];
    const refnos = viewer.scene.getLoadedRefnos();
    if (!refnos || refnos.length === 0) return [];

    const camera = dtxViewer.camera;
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new Frustum().setFromProjectionMatrix(viewProjection);

    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const offsetX = canvasRect.left - overlayRect.left;
    const offsetY = canvasRect.top - overlayRect.top;

    const box = new Box3();
    const corner = new Vector3();
    const sel: string[] = [];
    const containMode = (mode === 'annotation_obb' || mode === 'pick_refno_box') && dx < 0;

    for (const refno of refnos) {
      const aabb = viewer.scene.getAABB([refno]);
      if (!aabb) continue;
      box.min.set(aabb[0], aabb[1], aabb[2]);
      box.max.set(aabb[3], aabb[4], aabb[5]);
      if (!frustum.intersectsBox(box)) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let anyVisible = false;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(viewProjection);
        if (corner.z < -1 || corner.z > 1) continue;
        anyVisible = true;
        const x = (corner.x * 0.5 + 0.5) * canvasRect.width + offsetX;
        const y = (-corner.y * 0.5 + 0.5) * canvasRect.height + offsetY;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (!anyVisible) continue;

      const intersects = !(maxX < rect.x1 || minX > rect.x2 || maxY < rect.y1 || minY > rect.y2);
      const contained = minX >= rect.x1 && maxX <= rect.x2 && minY >= rect.y1 && maxY <= rect.y2;

      if (containMode ? contained : intersects) {
        sel.push(refno);
      }
    }

    return sel;
  }

  function beginMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!ready.value) return;
    if (e.button !== 0) return;
    if (mode === 'annotation_cloud' && !canDrawCloudAnnotation()) {
      notifyCloudGateBlocked('target');
      return;
    }
    if (mode === 'annotation_cloud' && !pendingCloudAnchor.value) {
      notifyCloudGateBlocked('anchor');
      return;
    }
    const start = getCanvasPos(canvas, e);
    marqueeState.value = {
      active: true,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startCanvas: { x: start.x, y: start.y },
      currentCanvas: { x: start.x, y: start.y },
    };
    updateMarqueeStyle(mode, 0);
    updateMarqueeRect(marqueeState.value.startCanvas!, marqueeState.value.currentCanvas!);

    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function moveMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!marqueeState.value.active) return;
    if (marqueeState.value.pointerId !== e.pointerId) return;
    const cur = getCanvasPos(canvas, e);
    marqueeState.value.currentCanvas = { x: cur.x, y: cur.y };
    const start = marqueeState.value.startCanvas!;
    const dx = (cur.x - start.x);
    updateMarqueeStyle(mode, dx);
    updateMarqueeRect(start, marqueeState.value.currentCanvas);
  }

  function endMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!marqueeState.value.active) return;
    if (marqueeState.value.pointerId !== e.pointerId) return;

    const start = marqueeState.value.startCanvas;
    const end = marqueeState.value.currentCanvas;
    if (!start || !end) {
      hideMarquee();
      return;
    }

    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    const rect = {
      x1: Math.min(start.x, end.x),
      y1: Math.min(start.y, end.y),
      x2: Math.max(start.x, end.x),
      y2: Math.max(start.y, end.y),
    };
    if (rect.x2 - rect.x1 < 6 || rect.y2 - rect.y1 < 6) {
      hideMarquee();
      if (mode === 'annotation_cloud') {
        const hit = pickSurfacePoint(canvas, e);
        if (hit) {
          setPendingCloudAnchor({
            worldPos: vec3ToTuple(hit.worldPos),
            refno: hit.entityId,
            entityId: hit.entityId,
          });
        }
      }
      return;
    }
    const dx = end.x - start.x;

    if (!compatViewerRef.value || !overlayContainerRef.value || !dtxViewerRef.value) {
      hideMarquee();
      emitToast({ message: '三维视图尚未就绪，无法完成框选', level: 'warning' });
      if (mode === 'pick_refno_box') store.cancelPickRefno();
      return;
    }

    // 云线的关联来自目标元素集合，框内构件与它无关；而这个函数要遍历全部已加载构件
    // 逐个取 AABB 再投影 8 个角，大模型上白算一遍就是松手时一次可感的卡顿。
    let selectedRefnos: string[] = [];
    if (mode !== 'annotation_cloud') {
      try {
        selectedRefnos = collectRefnosInScreenRect(canvas, rect, mode, dx);
      } catch (err) {
        // 抛出会跳过下面的 hideMarquee，把选择框永久留在屏幕上，
        // 且拾取会话卡在 pick_refno_box 无法退出。
        console.error('[dtx-tools] 框选构件失败', err);
        hideMarquee();
        emitToast({ message: '框选失败：计算框内构件时出错，请缩小范围后重试', level: 'error' });
        if (mode === 'pick_refno_box') store.cancelPickRefno();
        return;
      }
    }
    hideMarquee();

    if (mode === 'pick_refno_box') {
      const filterUpper = store.pickRefnoFilter.value;
      const resolution = resolveBoxPickRefnos(selectedRefnos, filterUpper, findNounByRefnoAcrossAllDbnos);
      if (resolution.kind === 'noun_unavailable') {
        emitToast({ message: '构件类型信息尚未加载完成，请稍后重试框选', level: 'warning' });
        store.cancelPickRefno();
        return;
      }
      if (resolution.refnos.length === 0) {
        emitToast({
          message: '框选范围内未检测到已加载构件，请扩大框选范围或先加载模型。',
          level: 'warning',
        });
      }
      for (const refno of resolution.refnos) store.addPickedRefno(refno);
      store.confirmPickRefno();
      return;
    }

    const compat = compatViewerRef.value;
    if (!compat) return;

    if (mode === 'annotation_cloud') {
      // 关联来自目标元素集合；拖框只决定屏幕轮廓，bbox3d 亦用目标集合合并 AABB。
      const targetRefnos = [...store.cloudTargetRefnos.value];
      if (targetRefnos.length === 0) return;
      const viewer = dtxViewerRef.value;
      const overlay = overlayContainerRef.value;
      const anchorState = pendingCloudAnchor.value;
      if (!viewer || !overlay || !anchorState) return;
      const targetAabb = compat.scene.getAABB(targetRefnos);
      if (!targetAabb) {
        if (annotationStyleStore.cloudDrawMode.value === 'bbox3d') {
          emitToast({ message: '目标元素尚未加载，无法绘制三维包围盒云线', level: 'warning' });
          return;
        }
        // screen2d 允许先建：贴合所需的 AABB 由 resolveCloudTargetBbox 在目标加载后补上，
        // 但此刻只能按拖框尺寸出图，不说清楚用户会以为云线画歪了。
        emitToast({
          message: '目标元素尚未加载，云线暂按拖框尺寸显示，加载后会自动贴合目标',
          level: 'warning',
        });
      }
      const n = store.cloudAnnotations.value.length + 1;
      const anchor = new Vector3(...anchorState.worldPos);
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchor);
      const createdAt = Date.now();
      const rec = createCloudAnnotationRecordFromAnchorAndMarquee({
        id: nowId('cloud'),
        objectIds: targetRefnos,
        refnos: targetRefnos,
        anchorWorldPos: anchorState.worldPos,
        anchorRefno: anchorState.refno,
        anchorScreen,
        rect,
        title: `云线批注 ${n}`,
        description: '',
        createdAt,
        selectionBbox: targetAabb
          ? {
            min: [targetAabb[0], targetAabb[1], targetAabb[2]],
            max: [targetAabb[3], targetAabb[4], targetAabb[5]],
          }
          : undefined,
        bindings: buildCloudBindings({
          memberRefnos: targetRefnos,
          anchorRefno: anchorState.refno,
          createdAt,
          nounOf: (refno) => findNounByRefnoAcrossAllDbnos(refno) ?? undefined,
        }),
        projectOverlayToWorld: (x, y, ndcZ) => vec3ToTuple(
          overlayToWorld(viewer.camera, canvas, overlay, x, y, ndcZ),
        ),
        // P1：新建即写像素意图布局（右上角 + 18 px）；开关关着就只写旧字段
        labelLayoutV1: isCloudRenderFlagEnabled('cloudLabelLayoutV1') ? createDefaultCloudLabelLayoutV1() : undefined,
      });
      // P2：范围体 + 创建视点（方案 §6.2 / §11 P2）。范围不完整（成员未加载 / 超预算）时**不写**新版记录，
      // 漏斗按 selectionBbox 补 legacy-snapshot + legacy-v0；创建视点是独立证据，只要开关开就记。
      if (isCloudRenderFlagEnabled('cloudProjectedEnvelope')) {
        const layer = dtxLayerRef.value;
        const source = buildCloudSourceStamp(targetRefnos, layer);
        const regionV1 = layer
          ? buildMembersRegionV1({
            memberRefnos: targetRefnos,
            layer,
            getMemberAabb: (refno) => compat.scene.getAABB([refno]) ?? null,
            source,
          })
          : null;
        const canvasRect = canvas.getBoundingClientRect();
        rec.viewpointV1 = {
          creation: captureCreationViewSnapshot({
            camera: viewer.camera,
            controlsTarget: viewer.controls?.target instanceof Vector3 ? viewer.controls.target : null,
            anchorWorldPos: anchor,
            viewportCss: {
              width: canvasRect.width || canvas.clientWidth || 1,
              height: canvasRect.height || canvas.clientHeight || 1,
            },
            capturedAt: createdAt,
            modelSnapshotId: source.modelSnapshotId,
          }),
        };
        if (regionV1) {
          rec.regionV1 = regionV1;
          rec.presentationV1 = createRegionCloudPresentationV1();
        }
      }
      store.addCloudAnnotation(rec);
      clearPendingCloudAnchor();
      store.clearCloudTargetRefnos();
      // 画完自动选中新云线：主工具条「错误类型」立即可用、「打开批注单」能定位到这条、右侧证据卡有明确焦点，
      // 否则用户画完得不到任何“选中”反馈，容易误以为没成功而重复绘制。
      activateAnnotation('cloud', rec.id);
      void captureCreatedCloudScreenshot(rec);
      return;
    }

    if (selectedRefnos.length === 0) return;

    // 计算 combined bbox
    const aabb = compat.scene.getAABB(selectedRefnos);
    if (!aabb) return;
    const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));

    const obb = computeAabbObbFromBox3(box);
    if (mode === 'annotation_obb') {
      const n = store.obbAnnotations.value.length + 1;
      const anchorWorldPos = topCenterFromBox3(box);
      const halfSize = new Vector3(...obb.halfSize);
      const boxRadius = Math.max(halfSize.length(), 0.1);
      const labelWorldPos = anchorWorldPos.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));
      // P3 共享范围体：`obb` 旧字段（合并 AABB）照旧双写；范围完整时另写每成员真实放置盒
      const sharedRegion = buildSharedRegionForMembers(selectedRefnos);
      const rec: ObbAnnotationRecord = {
        id: nowId('obb'),
        objectIds: selectedRefnos,
        obb,
        labelWorldPos: vec3ToTuple(labelWorldPos),
        anchor: { kind: 'top_center' },
        visible: true,
        title: `OBB 批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refnos: selectedRefnos,
        ...(sharedRegion ? { regionV1: sharedRegion } : {}),
      };
      store.addObbAnnotation(rec);
      return;
    }

    const n = store.rectAnnotations.value.length + 1;
    const rec = createRectAnnotationRecordFromObb({
      objectIds: selectedRefnos,
      refnos: selectedRefnos,
      obb,
      title: `矩形批注 ${n}`,
      regionV1: buildSharedRegionForMembers(selectedRefnos) ?? undefined,
    });
    store.addRectAnnotation(rec);
  }

  // click-based tools
  const clickTracker = ref<{ down: { x: number; y: number } | null; moved: boolean }>({ down: null, moved: false });
  const boxSelectState = ref<{ active: boolean; startX: number; startY: number; endX: number; endY: number } | null>(null);

  function onCanvasPointerDown(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };

    const mode = store.toolMode.value;
    if (suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') return;
    if (mode === 'annotation_obb' || mode === 'pick_refno_box') {
      beginMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (pendingCloudAnchor.value) {
        beginMarquee(canvas, e, mode);
      }
      return;
    }
    if (mode === 'annotation_rect') {
      return;
    }
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    const down = clickTracker.value.down;
    if (down) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (dx * dx + dy * dy > 9) clickTracker.value.moved = true;
    }

    const mode = store.toolMode.value;
    if (suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') return;
    if (mode === 'annotation_cloud' || mode === 'annotation_obb' || mode === 'pick_refno_box') {
      moveMarquee(canvas, e, mode);
      return;
    }

  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return;

    const mode = store.toolMode.value;
    if (suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    if (mode === 'annotation_obb' || mode === 'pick_refno_box') {
      endMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (marqueeState.value.active) {
        endMarquee(canvas, e, mode);
        return;
      }
      if (clickTracker.value.moved) {
        clickTracker.value = { down: null, moved: false };
        return;
      }
      clickTracker.value = { down: null, moved: false };
      if (!canDrawCloudAnnotation()) {
        notifyCloudGateBlocked('target');
        return;
      }
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      setPendingCloudAnchor({
        worldPos: vec3ToTuple(hit.worldPos),
        refno: hit.entityId,
        entityId: hit.entityId,
      });
      return;
    }
    if (mode === 'annotation_rect') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const compat = compatViewerRef.value;
      if (!compat) return;
      const pickedRefno = parseRefnoFromDtxObjectId(hit.objectId) || hit.entityId;
      const aabb = compat.scene.getAABB([pickedRefno]);
      if (!aabb) return;
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));
      const obb = computeAabbObbFromBox3(box);
      const n = store.rectAnnotations.value.length + 1;
      const rec = createRectAnnotationRecordFromObb({
        objectIds: [pickedRefno],
        refnos: [pickedRefno],
        obb,
        title: `矩形批注 ${n}`,
        regionV1: buildSharedRegionForMembers([pickedRefno]) ?? undefined,
      });
      store.addRectAnnotation(rec);
      return;
    }

    // 防止相机拖拽结束误触发
    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    clickTracker.value = { down: null, moved: false };

    if (mode === 'none') {
      // 普通模式下的点击选择，支持 Shift 多选
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) {
        // 点击空白处，清除选择（除非按住 Shift）
        if (!e.shiftKey) {
          const viewer = compatViewerRef.value;
          if (viewer) {
            const prev = viewer.scene.selectedObjectIds;
            if (prev.length > 0) {
              viewer.scene.setObjectsSelected(prev, false);
            }
          }
        }
        return;
      }

      const refno = hit.entityId;
      const viewer = compatViewerRef.value;
      if (!viewer) return;

      viewer.scene.ensureRefnos([refno]);

      if (e.shiftKey) {
        // Shift 多选：切换选中状态
        const isSelected = viewer.scene.selectedObjectIds.includes(refno);
        viewer.scene.setObjectsSelected([refno], !isSelected);
      } else {
        // 单选：清除之前的选择，选中当前对象
        const prev = viewer.scene.selectedObjectIds;
        if (prev.length > 0) {
          viewer.scene.setObjectsSelected(prev, false);
        }
        viewer.scene.setObjectsSelected([refno], true);
      }
      return;
    }

    if (mode === 'pick_query_center') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      store.setPickedQueryCenter({ entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) });
      store.setToolMode('none');
      return;
    }

    if (mode === 'pick_refno') {
      const pos = getCanvasPos(canvas, e);
      const filter = store.pickRefnoFilter.value;
      const candidates = buildPickRefnoCandidates(pickSurfaceRayHits(canvas, e), filter);

      // 原地再点一次 = 在光标下的重叠构件之间轮换，而不是重新拾取同一个。
      if (
        isSamePickAnchor(pickCandidateAnchor, pos) &&
        isSamePickCandidateSequence(pickCandidates.value, candidates)
      ) {
        if (cyclePickCandidate(1)) return;
      }

      pickCandidateAnchor = { x: pos.x, y: pos.y };
      pickCandidates.value = candidates;
      pickCandidateIndex.value = 0;

      const nearest = candidates[0];
      if (!nearest) {
        clearPickCandidatePreview();
        return;
      }
      applyPickCandidate(nearest, null);
      return;
    }

    if (mode === 'measure_pipe_to_structure') {
      void runPipeToStructureMeasurement(canvas, e);
      return;
    }

    if (mode === 'measure_pipe_to_pipe') {
      void runPipeToPipeMeasurement(canvas, e);
      return;
    }

    if (mode === 'measure_point_to_object') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;

      if (!pointToObjectStart.value) {
        pointToObjectStart.value = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
        return;
      }

      const layer = dtxLayerRef.value;
      if (!layer) return;
      const start = new Vector3(...pointToObjectStart.value.worldPos);
      const closest = layer.closestPointToObject(hit.objectId, start);
      if (!closest) return;

      const rec: DistanceMeasurementRecord = {
        id: nowId('pto'),
        kind: 'distance',
        origin: pointToObjectStart.value,
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(closest.point) },
        visible: true,
        createdAt: Date.now(),
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      store.addMeasurement(rec);
      pointToObjectStart.value = null;
      return;
    }

    if (mode === 'measure_object_to_object') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) {
        setObjectMeasureStatus('未拾取到有效构件');
        return;
      }

      const candidate = createObjectMeasureCandidateFromHit(hit);
      if (!candidate) {
        setObjectMeasureStatus('未拾取到有效构件');
        return;
      }

      if (!objectToObjectSourceCandidate.value) {
        applyObjectMeasureSourceCandidate(candidate);
        return;
      }

      objectToObjectTargetCandidate.value = candidate;
      void commitObjectToObjectMeasurement(objectToObjectSourceCandidate.value, candidate);
      return;
    }

    // annotation: click to create text annotation
    if (mode === 'annotation') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const n = store.annotations.value.length + 1;
      // 优先绑定当前点击命中的构件，避免沿用全局旧选中导致误绑。
      const boundRefno = String(hit.entityId || '').trim() || selectionStore.selectedRefno.value || undefined;
      const rec: AnnotationRecord = {
        id: nowId('anno'),
        entityId: hit.entityId,
        worldPos: vec3ToTuple(hit.worldPos),
        labelWorldPos: getDefaultTextAnnotationLabelWorldPos(vec3ToTuple(hit.worldPos)),
        collapsed: false,
        visible: true,
        glyph: `A${n}`,
        title: `批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refno: boundRefno,
      };
      store.addAnnotation(rec);
      return;
    }

    // 点击其它批注模式时，保持不误创建文字批注
  }

  function onCanvasPointerCancel(canvas: HTMLCanvasElement, e: PointerEvent) {
    void e;
    if (suppressStoreOverlays) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    hideMarquee();
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
    clickTracker.value = { down: null, moved: false };
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function cancelMeasurementInteraction(): void {
    const mode = store.toolMode.value;
    if (mode === 'pick_query_center' || mode === 'pick_refno') {
      store.setToolMode('none');
      return;
    }
    if (mode === 'measure_object_to_object') {
      clearObjectMeasureCandidates({ clearStatus: true, clearLastPairKey: true });
      return;
    }
    resetProgress();
    clearPendingCloudAnchor();
    hideMarquee();
  }

  watch(
    () => ({
      measurements: store.measurements.value,
      annotations: store.annotations.value,
      cloudAnnotations: store.cloudAnnotations.value,
      rectAnnotations: store.rectAnnotations.value,
      obbAnnotations: store.obbAnnotations.value,
      activeAnnotationId: store.activeAnnotationId.value,
      activeCloudAnnotationId: store.activeCloudAnnotationId.value,
      activeRectAnnotationId: store.activeRectAnnotationId.value,
      activeObbAnnotationId: store.activeObbAnnotationId.value,
    }),
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
    },
    { deep: true }
  );

  watch(
    () => annotationStyleStore.cloudDrawMode.value,
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
      requestRender?.();
    },
  );

  watch(
    () => annotationStyleStore.style.cloud,
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  // ADR-0050：解析表整表替换（模型加载 / 定位回执 / 详情卡重算 / 批注后到）→ 就地换降级外观，不重建 overlay
  watch(bindingResolve.entries, () => {
    if (!dtxViewerRef.value || !overlayContainerRef.value) return;
    applyBindingDegrade();
  });

  // pick_refno：候选变化与取消拾取时同步高亮
  watch(
    () => ({
      mode: store.toolMode.value,
      picked: store.pickedRefnos.value,
    }),
    (next, prev) => {
      const mode = next.mode;
      const picked = next.picked ?? [];

      if (mode === 'pick_refno') {
        // 进入拾取模式：重置会话状态（不清除外部高亮）
        if (prev?.mode !== 'pick_refno') {
          pickedHighlightByBran.clear();
          pickedHighlightPinned.clear();
          lastAppliedPickHighlights = [];
        }

        // pickedRefnos 为空：视为取消/重置，撤销本会话高亮
        if (!picked || picked.length === 0) {
          clearPickHighlights();
          resetPickCandidateSession();
          return;
        }

        // 同步删除的候选
        const pickedSet = new Set<string>(picked);
        for (const k of Array.from(pickedHighlightByBran.keys())) {
          if (!pickedSet.has(k)) {
            pickedHighlightByBran.delete(k);
          }
        }
        applyPickHighlights();
        return;
      }

      // 退出拾取模式：确认场景保持当前高亮；仅清理会话内状态，避免后续误同步
      if (prev?.mode === 'pick_refno') {
        pickedHighlightByBran.clear();
        lastAppliedPickHighlights = [];
        resetPickCandidateSession();
      }
    },
    { deep: true }
  );

  // 显示单位变化：刷新测量标签等 overlay 文本
  watch(
    () => [unitSettings.displayUnit.value, unitSettings.precision.value],
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
      requestRender?.();
    }
  );

  watch(
    () => [store.toolMode.value, selectionStore.selectedRefnos.value.join('|')] as const,
    ([mode, selectedRefnos]) => {
      if (mode !== 'measure_object_to_object') return;
      const refnos = selectedRefnos
        .split('|')
        .map((refno) => refno.trim())
        .filter(Boolean);
      handleTreeObjectMeasureSelection(refnos);
    },
    { immediate: true },
  );

  watch(
    () => store.cloudTargetRefnos.value.join('|'),
    () => {
      clearPendingCloudAnchor();
      hideMarquee();
    },
  );

  watch(
    () => store.toolMode.value,
    (mode, prev) => {
      if (mode !== prev) {
        resetProgress();
      }
      const pickingCloudTargets = mode === 'pick_refno' || mode === 'pick_refno_box';
      const wasPickingCloudTargets = prev === 'pick_refno' || prev === 'pick_refno_box';
      if (
        !pickingCloudTargets &&
        mode !== 'annotation_cloud' &&
        (prev === 'annotation_cloud' || wasPickingCloudTargets)
      ) {
        // 退到 none 只是「收起工具」，目标集合留着待复用；
        // 切到别的工具才是「换活儿」，按方案 §2.1 清理到底。
        if (mode === 'none') suspendCloudCreation();
        else cancelCloudCreation();
      }
      if (mode === 'none' && prev !== 'none') {
        hideMarquee();
      }
    }
  );

  watch(
    () => dtxViewerRef.value,
    (viewer, prev) => {
      if (prev && toolsGroup.parent === prev.scene) {
        prev.scene.remove(toolsGroup);
      }
      if (viewer) {
        ensureToolsGroupAttached();
        syncFromStore();
      } else {
        clearGroup(toolsGroup);
        clearOverlayEls();
      }
    },
    { immediate: true }
  );

  return {
    ready,
    statusText,
    objectToObjectUiState,
    refreshReadyState,

    syncFromStore,
    updateOverlayPositions,

    // actions used by panels
    flyToMeasurement,
    flyToAnnotation,
    flyToCloudAnnotation,
    flyToRectAnnotation,
    flyToObbAnnotation,

    removeMeasurement,
    removeAnnotation,
    removeCloudAnnotation,
    removeRectAnnotation,
    removeObbAnnotation,

    highlightAnnotationTarget,
    highlightAnnotationTargets,

    // 云线创建：目标先行
    pendingCloudAnchor,
    canDrawCloudAnnotation,
    cancelCloudCreation,
    suspendCloudCreation,
    rollbackCloudCreationStep,
    clearPendingCloudAnchor,
    cloudGateBlock,

    // pick_refno 候选轮换（重叠构件）
    pickCandidates,
    pickCandidateIndex,
    cyclePickCandidate,

    // e2e/调试：读取云线轮廓当前渲染几何（世界坐标），用于验证「贴合包住」性质
    debugCloudOutlines,
    // e2e/调试：云线渲染计数（静止零重建验收）与 V1 标签布局结果
    debugCloudRenderStats,
    resetCloudRenderStats,
    debugCloudLabelLayouts,
    debugCloudRegionRender,
    // P4 LOD：本帧计划快照；悬停临时升档（图钉的 pointerenter / leave 已绑定，这里给测试与外部调用）
    debugCloudLod,
    setHoveredCloudAnnotation,
    // ADR-0050 视口降级：解析表变化后就地换外观（watch 已接；这里给测试直接调）与当前外观快照
    applyBindingDegrade,
    debugAnnotationDegrades,

    // 云线 V1 标签拖动（文字框拖柄的 pointer 事件由 syncFromStore 绑定；这里给测试与外部调用）
    beginInlineOverlayAnnotationDrag,
    continueInlineOverlayAnnotationDrag,
    endInlineOverlayAnnotationDrag,

    clearAllInScene,
    dispose,

    // input hook (ViewerPanel 使用)
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    cancelMeasurementInteraction,

    // 兼容：selectionStore 在 none 模式下由 ViewerPanel 处理
    selectionStore,
  };
}
