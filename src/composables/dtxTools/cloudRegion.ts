/**
 * 云线渲染缓存、调试快照类型与范围体（region-v1）/ 来源戳工具。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { MeshLine } from '@lume/three-meshline';
import { Box3, LineSegments, Matrix4, Vector3 } from 'three';

import { vec3ToTuple } from './geometry';
import { normalizeRefnoKey, parseDbnumFromRefno } from './pipeMeasureMath';

import type { AnnotationLeaderVisual } from './types';
import type { CloudAnnotationRecord, Vec3 } from '@/composables/useToolStore';
import type { WorldCell } from '@/review/domain/annotationProjection/clip4';
import type { PinCluster } from '@/review/domain/annotationProjection/cluster';
import type { CloudLodLevel } from '@/review/domain/annotationProjection/lod';
import type { PhasePrevious } from '@/review/domain/annotationProjection/wave';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';
import type { CloudLabelLayoutV1, ObbSnapshot, RegionV1, SourceStamp, ViewSnapshotV1 } from '@/review/domain/cloudRegion';
import type { DTXLayer } from '@/utils/three/dtx';

import { getDtxRefnoLoadSourceAcrossAllDbnos, resolveDtxObjectIdsByRefno } from '@/composables/useDbnoInstancesDtxLoader';
import { type CloudFitState, type CloudRegionRenderStyle, DEFAULT_CLOUD_REGION_RENDER_STYLE, type SmallTargetLod, obbSnapshotFromLocalBoxAndMatrix } from '@/review/domain/annotationProjection/annotationProjection';
import { type ArrayVersionTracker, type CloudRenderStamp, type ValueVersionTracker, createArrayVersionTracker, createValueVersionTracker } from '@/review/domain/annotationProjection/dirty';
import { type CloudInspectionMode, type OcclusionProbe, inspectionFactor } from '@/review/domain/annotationProjection/inspection';
import { type CloudFrame, DEFAULT_LABEL_PREFERENCE, type LabelLayoutResult, type LabelPreference } from '@/review/domain/annotationProjection/labelLayout';

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
  /**
   * P4 inspection（方案 §10，开关 `cloudInspectionFade`）：透明度因子（1 = 不淡），随 paint 阶段乘进轮廓 / 盒边 / 小针 / 引线；
   * `inspectionKey` = 上次探测时的「相机 | 模型 epoch | 全局矩阵 | 记录版本」，没变不再打射线；`inspectionProbes` 是上次样本结果
   */
  inspectionFactor: number
  inspectionKey: string
  inspectionProbes: OcclusionProbe[]
}

export function createCloudRenderCache(): CloudRenderCache {
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
    inspectionFactor: 1,
    inspectionKey: '',
    inspectionProbes: [],
  };
}

export type CloudOverlayEl = {
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
  /** P4 inspection 打出的射线（成员表面命中 + 遮挡段探测各算一次）：置顶模式 / 开关关一律为零 */
  inspectionRays: number
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

/** `debugCloudInspection()` 的快照：P4 遮挡淡化 */
export type CloudInspectionDebugSnapshot = {
  mode: CloudInspectionMode
  pending: boolean
  occludedAlpha: number
  items: { id: string; factor: number; probes: OcclusionProbe[]; key: string; outlineOpacity: number; leaderOpacity: number }[]
}

/** `debugCloudClusters()` 的快照：pin 档图钉的屏幕聚合 */
export type CloudClusterDebugSnapshot = {
  clusters: PinCluster[]
  hiddenMarkerIds: string[]
  badgeSeedIds: string[]
  popoverSeedId: string | null
}

/** 新建云线的默认标签布局：参考包围框右上角、向右 18 px */
export function createDefaultCloudLabelLayoutV1(): CloudLabelLayoutV1 {
  return {
    version: 1,
    anchor: { kind: 'contour-bounds', uv: [1, 0], labelPoint: 'top-left' },
    offsetPx: { x: DEFAULT_LABEL_PREFERENCE.offsetPx.x, y: DEFAULT_LABEL_PREFERENCE.offsetPx.y },
  };
}

export function labelPreferenceFromRecord(layout: CloudLabelLayoutV1): LabelPreference {
  return { uv: layout.anchor.uv, offsetPx: layout.offsetPx };
}

/** `region-v1` 呈现参数 → 几何内核样式：padding / λ / A 来自记录（非法值回默认），halo 随描边宽度 */
export function regionRenderStyleFromRecord(record: CloudAnnotationRecord, lineWidthPx: number): CloudRegionRenderStyle {
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
export function isRegionPresentationRecord(record: CloudAnnotationRecord): boolean {
  return record.presentationV1?.algorithm === 'region-v1' && !!record.regionV1;
}

/**
 * 创建视点快照（方案 §6.2 `ViewSnapshotV1`）：保存的是**创建证据**，不是当前相机缓存；
 * 恢复原貌时按创建宽高比等比适配或留边，不能拿新视口比例直接覆盖原投影。
 */
export function captureCreationViewSnapshot(params: {
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
export function buildCloudSourceStamp(memberRefnos: readonly string[], layer: DTXLayer | null): SourceStamp {
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
export function resolveRegionObjectIdsForRefno(layer: DTXLayer, refno: string): string[] {
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
export function collectWorldCellEdgePositions(cells: readonly WorldCell[]): Float32Array {
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
