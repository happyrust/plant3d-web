/**
 * MBD 管道标注 Composable（重构版）
 *
 * 使用新的三维标注系统，支持：
 * - Line2 粗线条
 * - troika-three-text 3D billboard 文字（非 CSS2D）
 * - 缩放独立（装饰件/文字）
 */

import { ref, type Ref, watch, shallowRef, markRaw, toRaw } from 'vue';

import {
  Box3,
  BufferGeometry,
  Camera,
  Color,
  type ColorRepresentation,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Scene,
  Vector3,
} from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import type {
  MbdPipeData,
  MbdCutTubiDto,
  MbdDimDto,
  MbdDimKind,
  MbdElevationMarkDto,
  MbdLaidOutAngleDto,
  MbdLaidOutBendDto,
  MbdLaidOutFittingDto,
  MbdLaidOutLinearDimDto,
  MbdLaidOutSlopeDto,
  MbdLaidOutTagDto,
  MbdLaidOutWeldDto,
  MbdPipeLayoutResult,
  MbdPipeEnvelopeDto,
  MbdFittingDto,
  MbdLayoutHint,
  MbdPipeClearanceDto,
  MbdSlopeDto,
  MbdStructureClearanceDto,
  MbdTagDto,
  MbdWeldDto,
  MbdBendDto,
  MbdPipeSegmentDto,
  MbdPipeViewMode,
  MbdV2LeaderLinePrimitive,
  Vec3 as ApiVec3,
} from '@/api/mbdPipeApi';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import {
  normalizeMbdLayoutHint,
  resolveBranchLayout,
  resolveLayeredDimOffset,
  resolveSemanticDimOffset,
  type LayoutRole,
  type NormalizedLayoutHint,
} from '@/composables/mbd/branchLayoutEngine';
import { computeMbdDimOffset } from '@/composables/mbd/computeMbdDimOffset';
import {
  computePipeAlignedOffsetDirs,
} from '@/composables/mbd/computePipeAlignedOffsetDirs';
import {
  getMbdDimensionModeConfig,
  resolveMbdDimensionMaterialSet,
  type MbdDimensionMode,
  type MbdDimensionModeConfig,
} from '@/composables/mbd/mbdDimensionMode';
import {
  useBackgroundStore,
  getPreset,
} from '@/composables/useBackgroundStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import {
  AnnotationMaterials,
  LinearDimension3D,
  WeldAnnotation3D,
  SlopeAnnotation3D,
  AngleDimension3D,
} from '@/utils/three/annotation';
import {
  AnnotationBase,
  type AnnotationOptions,
} from '@/utils/three/annotation/core/AnnotationBase';
import { computeDimensionOffsetDirInLocal } from '@/utils/three/annotation/utils/computeDimensionOffsetDirInLocal';
import { formatLengthMeters } from '@/utils/unitFormat';

export type MbdBendDisplayMode = 'size' | 'angle';
export type MbdPipeRenderSource = 'layout_result' | 'fallback';

export type UseMbdPipeAnnotationThreeReturn = {
  /** MBD 面板当前页签（仅 UI 状态） */
  uiTab: Ref<MbdPipeUiTab>;
  /** 语义模式：layout_first=后台排版优先；construction=施工表达；inspection=几何校核 */
  mbdViewMode: Ref<MbdPipeViewMode>;
  /** 当前实际渲染来源：layout_result=后端版面结果；fallback=前端回退渲染 */
  renderSource: Ref<MbdPipeRenderSource>;

  /** 尺寸文字来源：backend=用后端 text；auto=按当前单位/精度自动计算 */
  dimTextMode: Ref<'backend' | 'auto'>;
  /** 尺寸偏移倍率（作用于 computeMbdDimOffset 结果；仅对未手动拖拽覆盖的尺寸生效） */
  dimOffsetScale: Ref<number>;
  /** 尺寸标签位置比例（0..1；仅对未手动拖拽覆盖的尺寸生效） */
  dimLabelT: Ref<number>;
  /** 尺寸标注模式：classic=当前默认；rebarviz=对比样式 */
  dimMode: Ref<MbdDimensionMode>;
  /** RebarViz 模式：箭头长度（px） */
  rebarvizArrowSizePx: Ref<number>;
  /** RebarViz 模式：箭头半角（deg） */
  rebarvizArrowAngleDeg: Ref<number>;
  /** RebarViz 模式：箭头样式（open/filled/tick） */
  rebarvizArrowStyle: Ref<'open' | 'filled' | 'tick'>;
  /** RebarViz 模式：尺寸线宽（px） */
  rebarvizLineWidthPx: Ref<number>;
  /** 弯头显示模式：size=双线性尺寸；angle=角度 */
  bendDisplayMode: Ref<MbdBendDisplayMode>;

  isVisible: Ref<boolean>;
  showDims: Ref<boolean>;
  /** 每段长度（默认 kind=segment） */
  showDimSegment: Ref<boolean>;
  /** 焊口链式（kind=chain，包含两端） */
  showDimChain: Ref<boolean>;
  /** 总长（kind=overall） */
  showDimOverall: Ref<boolean>;
  /** 元件端口间距（kind=port） */
  showDimPort: Ref<boolean>;
  /** 管道间平行距离标注 */
  showPipeClearances: Ref<boolean>;
  /** 管道与结构构件净距标注 */
  showStructureClearances: Ref<boolean>;
  /** 绝对标高标注 */
  showElevationMarks: Ref<boolean>;
  /** 包络盒显示 */
  showEnvelope: Ref<boolean>;
  showCutTubis: Ref<boolean>;
  showElbows: Ref<boolean>;
  showBranches: Ref<boolean>;
  showFlanges: Ref<boolean>;
  showAnchorDebug: Ref<boolean>;
  showOwnerSegmentDebug: Ref<boolean>;
  suppressedWrongLineCount: Ref<number>;
  showWelds: Ref<boolean>;
  showSlopes: Ref<boolean>;
  showBends: Ref<boolean>;
  /** 显示“管段骨架线”（当真实 meshes 缺失时用于定位/对齐标注） */
  showSegments: Ref<boolean>;
  showLabels: Ref<boolean>;

  currentData: Ref<MbdPipeData | null>;
  activeItemId: Ref<string | null>;

  renderBranch: (data: MbdPipeData) => void;
  renderDemoDims: () => void;
  clearAll: () => void;
  flyTo: () => void;
  updateLabelPositions: () => void;
  /** 历史兼容：MBD 已统一 3D 文字，此接口为 no-op */
  renderLabels: (scene: Scene, camera: Camera) => void;
  /** 历史兼容：保留初始化接口，但不再挂载/渲染 CSS2D 文字层 */
  initCSS2DRenderer: (
    container: HTMLElement,
    canvas: HTMLCanvasElement,
  ) => CSS2DRenderer;
  highlightItem: (id: string | null) => void;
  applyModeDefaults: (mode: MbdPipeViewMode) => void;
  resetToCurrentModeDefaults: () => void;
  /** 更新分辨率（resize 时调用：LineMaterial） */
  setResolution: (width: number, height: number) => void;
  /** 释放资源（Viewer 卸载时调用） */
  dispose: () => void;

  /** Session-only：更新 MBD dim 交互调整（offset/label/reference 等） */
  updateDimOverride: (dimId: string, patch: Partial<MbdDimOverride>) => void;
  /** Session-only：重置单个 MBD dim 的交互调整 */
  resetDimOverride: (dimId: string) => void;
  /** 获取 dim annotations map（用于外部交互控制器注册） */
  getDimAnnotations: () => Map<string, LinearDimension3D>;
  /** 获取 weld annotations map（用于外部交互控制器注册） */
  getWeldAnnotations: () => Map<string, WeldAnnotation3D>;
  /** 获取 slope annotations map（用于外部交互控制器注册） */
  getSlopeAnnotations: () => Map<string, SlopeAnnotation3D>;
  /** 获取 bend annotations map（用于外部交互控制器注册） */
  getBendAnnotations: () => Map<string, BendAnnotationGroup>;
  /** 获取 cut tubi annotations map（用于调试/测试） */
  getCutTubiAnnotations: () => Map<string, LinearDimension3D>;
  /** 获取 tag annotations map（用于调试/测试） */
  getTagAnnotations: () => Map<string, WeldAnnotation3D>;
  /** 获取管道间净距标注 map（用于侧栏/交互） */
  getPipeClearanceAnnotations: () => Map<string, LinearDimension3D>;
  /** 获取结构净距标注 map（用于侧栏/交互） */
  getStructureClearanceAnnotations: () => Map<string, LinearDimension3D>;
  /** 获取标高标注 map（用于侧栏/交互） */
  getElevationAnnotations: () => Map<string, WeldAnnotation3D>;
  /** 获取包络对象 map（用于调试/测试） */
  getEnvelopeObjects: () => Map<string, LineSegments>;
  /** 获取当前有效标高数据（优先后端，缺省时前端回退推导） */
  resolveElevationMarks: (data?: MbdPipeData | null) => MbdElevationMarkDto[];
  /** 获取当前有效包络（优先后端，缺省时前端回退推导） */
  resolveEnvelopeData: (data?: MbdPipeData | null) => MbdPipeEnvelopeDto | null;
};

/** MBD dims session-only override（不写回后端，仅当前会话有效） */
export type MbdDimOverride = {
  offset?: number;
  direction?: [number, number, number];
  labelT?: number;
  labelOffsetWorld?: [number, number, number] | null;
  isReference?: boolean;
};

export type MbdPipeUiTab =
  | 'overview'
  | 'clearances'
  | 'materials'
  | 'envelope'
  | 'welds'
  | 'slopes'
  | 'bends'
  | 'attrs'
  | 'segments'
  | 'settings';

type BendAnnotationMember = LinearDimension3D | AngleDimension3D;

export class BendAnnotationGroup extends AnnotationBase {
  private readonly members: BendAnnotationMember[] = [];
  private mode: MbdBendDisplayMode;

  constructor(
    materials: AnnotationMaterials,
    mode: MbdBendDisplayMode,
    members: BendAnnotationMember[],
    options?: AnnotationOptions,
  ) {
    super(materials, options);
    this.mode = mode;
    this.addMembers(members);
  }

  private addMembers(members: BendAnnotationMember[]): void {
    this.members.length = 0;
    for (const member of members) {
      this.members.push(member);
      this.add(member);
    }
  }

  getMode(): MbdBendDisplayMode {
    return this.mode;
  }

  getDisplayText(): string {
    return this.getDisplayTexts().join(' / ');
  }

  getDisplayTexts(): string[] {
    return this.members.map((member) => member.getDisplayText()).filter(Boolean);
  }

  getDistances(): number[] {
    return this.members
      .filter((member): member is LinearDimension3D => member instanceof LinearDimension3D)
      .map((member) => member.getDistance());
  }

  getLabelRenderStyle(): string | null {
    const first = this.members[0] as any;
    return first?.textLabel?.getRenderStyle?.() ?? first?.textLabel?.renderStyle ?? null;
  }

  setLabelVisible(visible: boolean): void {
    for (const member of this.members) {
      member.setLabelVisible(visible);
    }
  }

  override setBackgroundColor(color: ColorRepresentation): void {
    for (const member of this.members) {
      member.setBackgroundColor(color);
    }
  }

  setLabelRenderStyle(
    style: MbdDimensionModeConfig['labelRenderStyle'],
  ): void {
    for (const member of this.members) {
      member.setLabelRenderStyle(style);
    }
  }

  override update(camera: Camera): void {
    super.update(camera);
    for (const member of this.members) {
      member.update(camera);
    }
  }

  protected override onScaleFactorChanged(_factor: number): void {
    // 组合标注不缩放根对象，避免子线性/角度标注发生端点漂移。
  }

  protected override onHighlightChanged(_highlighted: boolean): void {
    for (const member of this.members) {
      member.selected = this.selected;
      member.hovered = !this.selected && this.hovered;
    }
  }

  override dispose(): void {
    for (const member of this.members) {
      member.dispose();
    }
    this.members.length = 0;
    super.dispose();
  }
}

function clamp01(n: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function clampNumber(
  n: number,
  min: number,
  max: number,
  fallback: number,
): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function resolveLaidOutLinearGeometry(item: MbdLaidOutLinearDimDto) {
  const dimLineStart = toVector3(item.dim_line_start ?? null);
  const dimLineEnd = toVector3(item.dim_line_end ?? null);
  if (!dimLineStart || !dimLineEnd) return null;
  const backendArrows = Array.isArray(item.backend_arrows) && item.backend_arrows.length >= 2
    ? [
      {
        position: toVector3(item.backend_arrows[0]?.position ?? null),
        direction: toVector3(item.backend_arrows[0]?.direction ?? null),
      },
      {
        position: toVector3(item.backend_arrows[1]?.position ?? null),
        direction: toVector3(item.backend_arrows[1]?.direction ?? null),
      },
    ]
    : null;
  let arrows: [
    { position: Vector3; direction: Vector3 },
    { position: Vector3; direction: Vector3 },
  ] | null = null;
  if (
    backendArrows?.[0]?.position &&
    backendArrows[0].direction &&
    backendArrows[1]?.position &&
    backendArrows[1].direction
  ) {
    arrows = [
      {
        position: backendArrows[0].position,
        direction: backendArrows[0].direction,
      },
      {
        position: backendArrows[1].position,
        direction: backendArrows[1].direction,
      },
    ];
  }
  return {
    dimLineStart,
    dimLineEnd,
    extensionLine1Start: toVector3(item.extension_line_1_start ?? null),
    extensionLine1End: toVector3(item.extension_line_1_end ?? null),
    extensionLine2Start: toVector3(item.extension_line_2_start ?? null),
    extensionLine2End: toVector3(item.extension_line_2_end ?? null),
    textAnchor: toVector3(item.text_anchor ?? null),
    arrows,
  };
}

function computeFlyToPositionFromBox(box: Box3): {
  position: Vector3;
  target: Vector3;
} {
  const center = new Vector3();
  box.getCenter(center);
  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = Math.max(maxDim * 2.5, 5);
  const position = new Vector3(
    center.x + distance * 0.8,
    center.y + distance * 0.6,
    center.z + distance * 0.8,
  );
  return { position, target: center };
}

function resolveDimDisplayText(
  backendText: unknown,
  useBackendText: boolean,
  startLocal: Vector3,
  endLocal: Vector3,
  globalMatrix: Matrix4,
  unit: string,
  precision: number,
): string {
  const backend = String(backendText ?? '').trim();
  if (useBackendText && backend.length > 0) return backend;

  const a = startLocal.clone().applyMatrix4(globalMatrix);
  const b = endLocal.clone().applyMatrix4(globalMatrix);
  const distWorldM = a.distanceTo(b);
  return formatLengthMeters(distWorldM, unit, precision);
}

function toVector3(vec?: ApiVec3 | null): Vector3 | null {
  if (!vec || vec.length !== 3) return null;
  const [x, y, z] = vec;
  if (![x, y, z].every((v) => Number.isFinite(v))) return null;
  return new Vector3(x, y, z);
}

function resolveLaidOutLabelOffset(vec?: ApiVec3 | null): Vector3 | null {
  return toVector3(vec ?? null);
}

function isBackendDerivedLinearItem(item: MbdLaidOutLinearDimDto): boolean {
  return item.backend_derived_geometry === true ||
    item.source_kind === 'linear_dim' ||
    !!item.source_primitive_id;
}

function isBackendDerivedAnnotation(annotation: LinearDimension3D): boolean {
  return !!(annotation.userData as any)?.mbdBackendDerivedGeometry;
}

function shouldUseLayoutFirstResult(
  mode: MbdPipeViewMode,
  data: MbdPipeData,
): data is MbdPipeData & { layout_result: MbdPipeLayoutResult } {
  return mode === 'layout_first' && !!data.layout_result;
}

function stableAlternatingSign(seed?: string | null): number {
  const raw = String(seed ?? '').trim();
  if (!raw) return 1;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33 + raw.charCodeAt(i)) | 0;
  }
  return (hash & 1) === 0 ? 1 : -1;
}

function roundTo(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function buildDimSpanKey(start: Vector3, end: Vector3): string {
  const a = [
    roundTo(start.x, 0.01).toFixed(2),
    roundTo(start.y, 0.01).toFixed(2),
    roundTo(start.z, 0.01).toFixed(2),
  ].join(',');
  const b = [
    roundTo(end.x, 0.01).toFixed(2),
    roundTo(end.y, 0.01).toFixed(2),
    roundTo(end.z, 0.01).toFixed(2),
  ].join(',');
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function collectDuplicateOverallDimIds(dims: MbdDimDto[]): Set<string> {
  const nonOverallSpans = new Set<string>();
  for (const dim of dims) {
    const kind = (dim.kind ?? 'segment') as MbdDimKind;
    if (kind === 'overall') continue;
    const start = new Vector3(dim.start[0], dim.start[1], dim.start[2]);
    const end = new Vector3(dim.end[0], dim.end[1], dim.end[2]);
    nonOverallSpans.add(buildDimSpanKey(start, end));
  }

  const duplicateOverallIds = new Set<string>();
  for (const dim of dims) {
    const kind = (dim.kind ?? 'segment') as MbdDimKind;
    if (kind !== 'overall') continue;
    const start = new Vector3(dim.start[0], dim.start[1], dim.start[2]);
    const end = new Vector3(dim.end[0], dim.end[1], dim.end[2]);
    if (nonOverallSpans.has(buildDimSpanKey(start, end))) {
      duplicateOverallIds.add(dim.id);
    }
  }
  return duplicateOverallIds;
}

function buildPointKey(point: Vector3): string {
  return [
    roundTo(point.x, 0.01).toFixed(2),
    roundTo(point.y, 0.01).toFixed(2),
    roundTo(point.z, 0.01).toFixed(2),
  ].join(',');
}

type BendEndpointCandidate = {
  point: Vector3;
  dir: Vector3;
  distance: number;
  segmentIndex: number;
};

function collectBendEndpointCandidatesFromSegments(
  workPoint: Vector3,
  segments: MbdPipeSegmentDto[],
): BendEndpointCandidate[] {
  const deduped = new Map<string, BendEndpointCandidate>();

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!;
    const endpoints = [toVector3(segment.arrive), toVector3(segment.leave)].filter(
      (point): point is Vector3 => !!point,
    );
    for (const endpoint of endpoints) {
      const delta = endpoint.clone().sub(workPoint);
      const distance = delta.length();
      if (distance <= 1e-3) continue;
      const dir = delta.clone().normalize();
      const key = buildPointKey(endpoint);
      const prev = deduped.get(key);
      if (!prev || distance < prev.distance) {
        deduped.set(key, {
          point: endpoint.clone(),
          dir,
          distance,
          segmentIndex,
        });
      }
    }
  }

  return Array.from(deduped.values()).sort(
    (a, b) => a.distance - b.distance,
  );
}

function normalizeBendDirection(point: Vector3, workPoint: Vector3): Vector3 | null {
  const dir = point.clone().sub(workPoint);
  if (dir.lengthSq() < 1e-9) return null;
  return dir.normalize();
}

function buildBendPortPoint(
  workPoint: Vector3,
  candidate: BendEndpointCandidate | null,
  radius: number | null,
): Vector3 | null {
  if (!candidate) return null;
  if (radius != null && Number.isFinite(radius) && radius > 1e-3) {
    return workPoint.clone().addScaledVector(candidate.dir, radius);
  }
  return candidate.point.clone();
}

function resolveBendPortPoints(
  bend: MbdBendDto,
  segments: MbdPipeSegmentDto[],
): { point1: Vector3; point2: Vector3; inferred: boolean } | null {
  const workPoint = new Vector3(
    bend.work_point[0],
    bend.work_point[1],
    bend.work_point[2],
  );
  const explicitPoint1 = toVector3(bend.face_center_1 ?? null);
  const explicitPoint2 = toVector3(bend.face_center_2 ?? null);
  const radius =
    typeof bend.radius === 'number' && Number.isFinite(bend.radius) && bend.radius > 1e-3
      ? bend.radius
      : null;
  const candidates = collectBendEndpointCandidatesFromSegments(workPoint, segments);

  const chooseCandidate = (excludedDirs: Vector3[]): BendEndpointCandidate | null => {
    for (const candidate of candidates) {
      const conflict = excludedDirs.some(
        (dir) => Math.abs(dir.dot(candidate.dir)) > 0.98,
      );
      if (!conflict) return candidate;
    }
    return null;
  };

  const explicitDir1 = explicitPoint1 ? normalizeBendDirection(explicitPoint1, workPoint) : null;
  const explicitDir2 = explicitPoint2 ? normalizeBendDirection(explicitPoint2, workPoint) : null;
  const point1 =
    explicitPoint1 ??
    buildBendPortPoint(
      workPoint,
      chooseCandidate(explicitDir2 ? [explicitDir2] : []),
      radius,
    );
  const point1Dir = point1 ? normalizeBendDirection(point1, workPoint) : null;
  const point2 =
    explicitPoint2 ??
    buildBendPortPoint(
      workPoint,
      chooseCandidate(
        [explicitDir1, point1Dir].filter((dir): dir is Vector3 => !!dir),
      ),
      radius,
    );

  if (!point1 || !point2) return null;
  const dir1 = normalizeBendDirection(point1, workPoint);
  const dir2 = normalizeBendDirection(point2, workPoint);
  if (!dir1 || !dir2 || Math.abs(dir1.dot(dir2)) > 0.98) return null;
  return {
    point1,
    point2,
    inferred: !explicitPoint1 || !explicitPoint2,
  };
}

function resolveBendSizeDirection(
  _workPoint: Vector3,
  _target: Vector3,
  candidate: BendEndpointCandidate | null,
  pipeOffsetDirs: Vector3[],
): Vector3 | null {
  if (!candidate) return null;
  const offsetDir = pipeOffsetDirs[candidate.segmentIndex];
  if (!offsetDir || offsetDir.lengthSq() < 1e-9) return null;
  return offsetDir.clone().normalize();
}

function resolveBendEndpointCandidate(
  workPoint: Vector3,
  target: Vector3,
  candidates: BendEndpointCandidate[],
): BendEndpointCandidate | null {
  const targetDir = normalizeBendDirection(target, workPoint);
  if (!targetDir) return null;

  let bestCandidate: BendEndpointCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    // 组合“方向相似度 + 目标点邻近度”，避免 face_center 有偏差时退化到相机兜底方向。
    const alignScore = Math.abs(targetDir.dot(candidate.dir));
    const proximityScore = 1 / (1 + candidate.point.distanceTo(target));
    const score = alignScore * 0.8 + proximityScore * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function resolveBendSizeOffset(
  candidate: BendEndpointCandidate | null,
  segments: MbdPipeSegmentDto[],
  offsetScale: number,
): number | null {
  if (!candidate) return null;
  const ownerSegment = segments[candidate.segmentIndex];
  if (!ownerSegment) return null;
  const start = toVector3(ownerSegment.arrive ?? null);
  const end = toVector3(ownerSegment.leave ?? null);
  const segmentDistance =
    start && end
      ? start.distanceTo(end)
      : ownerSegment.straight_length ?? ownerSegment.length ?? null;
  if (!segmentDistance || !Number.isFinite(segmentDistance) || segmentDistance <= 0) {
    return null;
  }
  const scaledBaseOffset =
    computeMbdDimOffset(segmentDistance) *
    clampNumber(offsetScale, 0.05, 50, 1);
  return resolveSemanticDimOffset(scaledBaseOffset, 'segment');
}

const FALLBACK_BRANCH_BASE_OFFSET = 150;

function resolveSegmentBaselineSpan(
  segment: MbdPipeSegmentDto | null | undefined,
): number | null {
  if (!segment) return null;
  const start = toVector3(segment.arrive ?? null);
  const end = toVector3(segment.leave ?? null);
  const geometricLength =
    start && end ? start.distanceTo(end) : null;
  const straightLength = Number(segment.straight_length);
  if (Number.isFinite(straightLength) && straightLength > 0) {
    return straightLength;
  }
  const length = Number(segment.length);
  if (Number.isFinite(length) && length > 0) {
    return length;
  }
  return geometricLength && Number.isFinite(geometricLength) && geometricLength > 0
    ? geometricLength
    : null;
}

function resolveSegmentBaselineOffset(
  segment: MbdPipeSegmentDto | null | undefined,
): number | null {
  if (!segment) return null;
  const outsideDiameter = Number(segment.outside_diameter);
  if (Number.isFinite(outsideDiameter) && outsideDiameter > 0) {
    return clampNumber(
      outsideDiameter + 60,
      FALLBACK_BRANCH_BASE_OFFSET,
      5000,
      FALLBACK_BRANCH_BASE_OFFSET,
    );
  }
  const span = resolveSegmentBaselineSpan(segment);
  if (!span) return null;
  return computeMbdDimOffset(span);
}

function resolveBranchBaselineSegment(
  segments: MbdPipeSegmentDto[],
  ownerSegmentId?: string | null,
): MbdPipeSegmentDto | null {
  if (ownerSegmentId) {
    const ownerSegment = segments.find((segment) => segment.id === ownerSegmentId) ?? null;
    if (ownerSegment) return ownerSegment;
  }

  let bestSegment: MbdPipeSegmentDto | null = null;
  let bestSpan = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    const span = resolveSegmentBaselineSpan(segment);
    if (span == null || span <= bestSpan) continue;
    bestSpan = span;
    bestSegment = segment;
  }
  return bestSegment;
}

function resolveFallbackBaseOffset(
  role: LayoutRole,
  start: Vector3,
  end: Vector3,
  hint: MbdLayoutHint | null | undefined,
  segments: MbdPipeSegmentDto[],
): number {
  if (role === 'port') {
    return computeMbdDimOffset(start.distanceTo(end));
  }

  const normalizedHint = normalizeMbdLayoutHint(hint);
  const baselineSegment = resolveBranchBaselineSegment(
    segments,
    normalizedHint.ownerSegmentId,
  );
  return resolveSegmentBaselineOffset(baselineSegment) ?? FALLBACK_BRANCH_BASE_OFFSET;
}

function resolveFloatingLabelOffset(
  hint?: MbdLayoutHint | null,
  baseOffset = 110,
): Vector3 | null {
  const normalized = normalizeMbdLayoutHint(hint);
  const offsetDir = normalized.offsetDir ?? null;
  const charDir = normalized.charDir ?? normalized.offsetDir ?? null;
  const primaryAxis = normalized.primaryAxis ?? null;
  if (
    (!offsetDir || offsetDir.lengthSq() < 1e-9) &&
    (!charDir || charDir.lengthSq() < 1e-9) &&
    (!primaryAxis || primaryAxis.lengthSq() < 1e-9)
  ) {
    return null;
  }

  const resolvedOffset = resolveLayeredDimOffset(baseOffset, normalized);
  const textGap = clampNumber(baseOffset * 0.16, 18, 64, 28);
  const offset = new Vector3();
  if (offsetDir && offsetDir.lengthSq() >= 1e-9) {
    offset.addScaledVector(offsetDir.normalize(), resolvedOffset);
  }
  if (charDir && charDir.lengthSq() >= 1e-9) {
    offset.addScaledVector(charDir.normalize(), textGap);
  }
  if (
    primaryAxis &&
    primaryAxis.lengthSq() >= 1e-9 &&
    `${normalized.labelRole ?? ''}`.includes('tubi')
  ) {
    const axialGap = clampNumber(baseOffset * 0.2, 24, 96, 40);
    offset.addScaledVector(
      primaryAxis.normalize(),
      axialGap * stableAlternatingSign(normalized.ownerSegmentId),
    );
  }
  return offset.lengthSq() >= 1e-9 ? offset : null;
}

function recordSuppressedAnnotation(
  counter: Ref<number>,
  _reason: string,
): void {
  counter.value += 1;
}

type MbdFittingKind = 'elbow' | 'branch' | 'flange';
type MbdTagKind = MbdFittingKind | 'tubi' | 'other';

function classifyFitting(fitting: MbdFittingDto): MbdFittingKind {
  const raw = `${fitting.kind ?? ''} ${fitting.noun ?? ''}`.toUpperCase();
  if (
    raw.includes('TEE') ||
    raw.includes('BRANCH') ||
    raw.includes('OLET')
  ) {
    return 'branch';
  }
  if (raw.includes('FLAN')) return 'flange';
  return 'elbow';
}

function classifyTag(tag: MbdTagDto): MbdTagKind {
  const raw = `${tag.role ?? ''} ${tag.noun ?? ''}`.toUpperCase();
  if (raw.includes('TUBI')) return 'tubi';
  if (raw.includes('TEE') || raw.includes('BRANCH') || raw.includes('OLET')) {
    return 'branch';
  }
  if (raw.includes('FLAN')) return 'flange';
  if (raw.includes('ELBO') || raw.includes('BEND')) return 'elbow';
  return 'other';
}

function canRenderFittingGeometry(fitting: MbdFittingDto): boolean {
  const kind = classifyFitting(fitting);
  if (
    kind === 'elbow' &&
    fitting.angle != null &&
    fitting.face_center_1 &&
    fitting.face_center_2
  ) {
    return true;
  }
  return String(fitting.text ?? '').trim().length > 0;
}

function shouldSuppressTag(tag: MbdTagDto, data: MbdPipeData): boolean {
  const tagKind = classifyTag(tag);
  if (tagKind === 'tubi' && (data.cut_tubis?.length ?? 0) > 0) {
    return true;
  }
  if (
    tagKind === 'elbow' &&
    (data.fittings ?? []).some(
      (fitting) =>
        fitting.refno === tag.refno &&
        classifyFitting(fitting) === 'elbow' &&
        canRenderFittingGeometry(fitting),
    )
  ) {
    return true;
  }
  return false;
}

function resolveTagPriority(kind: MbdTagKind): number {
  if (kind === 'branch') return 0;
  if (kind === 'flange') return 1;
  if (kind === 'elbow') return 2;
  if (kind === 'tubi') return 3;
  return 4;
}

function formatElevationText(value: number): string {
  return `EL ${Math.round(value)}`;
}

function deriveElevationMarksFromSegments(data: MbdPipeData): MbdElevationMarkDto[] {
  const segments = data.segments ?? [];
  if (segments.length <= 0) return [];

  const pointEntries: { key: string; point: Vector3 }[] = [];
  const seenKeys = new Set<string>();
  const pushPoint = (point: Vector3 | null) => {
    if (!point) return;
    const key = buildPointKey(point);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    pointEntries.push({ key, point: point.clone() });
  };

  pushPoint(toVector3(segments[0]?.arrive ?? null));
  pushPoint(toVector3(segments[segments.length - 1]?.leave ?? null));
  for (const segment of segments) {
    pushPoint(toVector3(segment.arrive ?? null));
    pushPoint(toVector3(segment.leave ?? null));
  }

  if (pointEntries.length <= 0) return [];

  const highest = pointEntries.reduce((acc, entry) =>
    entry.point.z > acc.point.z ? entry : acc,
  );
  const lowest = pointEntries.reduce((acc, entry) =>
    entry.point.z < acc.point.z ? entry : acc,
  );

  const derived: MbdElevationMarkDto[] = [];
  const emitted = new Set<string>();
  const appendMark = (
    role: MbdElevationMarkDto['role'],
    id: string,
    point: Vector3 | null,
  ) => {
    if (!point) return;
    const key = buildPointKey(point);
    if (emitted.has(key)) return;
    emitted.add(key);
    derived.push({
      id,
      point: [point.x, point.y, point.z],
      elevation_mm: point.z,
      text: formatElevationText(point.z),
      role,
    });
  };

  appendMark('start', 'derived-elevation-start', toVector3(segments[0]?.arrive ?? null));
  appendMark('end', 'derived-elevation-end', toVector3(segments[segments.length - 1]?.leave ?? null));
  appendMark('high', 'derived-elevation-high', highest.point);
  appendMark('low', 'derived-elevation-low', lowest.point);

  return derived;
}

function resolveEffectiveElevationMarks(data: MbdPipeData | null | undefined): MbdElevationMarkDto[] {
  if (!data) return [];
  if ((data.elevation_marks?.length ?? 0) > 0) return data.elevation_marks ?? [];
  return deriveElevationMarksFromSegments(data);
}

function collectEnvelopePoints(data: MbdPipeData): Vector3[] {
  const points: Vector3[] = [];
  const pushPoint = (point?: ApiVec3 | null) => {
    const vec = toVector3(point ?? null);
    if (vec) points.push(vec);
  };

  for (const segment of data.segments ?? []) {
    pushPoint(segment.arrive);
    pushPoint(segment.leave);
  }
  for (const bend of data.bends ?? []) {
    pushPoint(bend.work_point);
    pushPoint(bend.face_center_1);
    pushPoint(bend.face_center_2);
  }
  for (const fitting of data.fittings ?? []) {
    pushPoint(fitting.anchor_point);
    pushPoint(fitting.face_center_1);
    pushPoint(fitting.face_center_2);
  }
  for (const cut of data.cut_tubis ?? []) {
    pushPoint(cut.start);
    pushPoint(cut.end);
  }
  for (const tag of data.tags ?? []) {
    pushPoint(tag.position);
  }

  return points;
}

function resolveEffectiveEnvelope(data: MbdPipeData | null | undefined): MbdPipeEnvelopeDto | null {
  if (!data) return null;
  if (data.envelope) return data.envelope;

  const points = collectEnvelopePoints(data);
  if (points.length <= 0) return null;

  const box = new Box3();
  for (const point of points) {
    box.expandByPoint(point);
  }
  if (box.isEmpty()) return null;

  const min = box.min.clone();
  const max = box.max.clone();
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  return {
    id: 'derived-envelope',
    kind: 'pipe_outer',
    min: [min.x, min.y, min.z],
    max: [max.x, max.y, max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  };
}

function getAnnotationLabelWorldPos<T extends { updateWorldMatrix: (a?: boolean, b?: boolean) => void; getLabelWorldPos: () => Vector3 }>(
  annotation: T,
): Vector3 {
  annotation.updateWorldMatrix(true, true);
  return annotation.getLabelWorldPos();
}

export function useMbdPipeAnnotationThree(
  dtxViewerRef: Ref<DtxViewer | null>,
  labelContainerRef: Ref<HTMLElement | null>,
  options: {
    requestRender?: (() => void) | null;
    getGlobalModelMatrix?: (() => Matrix4 | null) | null;
  } = {},
): UseMbdPipeAnnotationThreeReturn {
  const isDev = !!(import.meta.env as unknown as { DEV?: boolean }).DEV;
  const requestRender = options.requestRender ?? null;
  const getGlobalModelMatrix = options.getGlobalModelMatrix ?? null;
  // 方案B：MBD 标注统一为 3D 文本，不再需要 CSS2D 容器；保留参数以维持 API 兼容。
  void labelContainerRef;

  const unitSettings = useUnitSettingsStore();

  // UI 状态（MbdPipePanel 使用）
  const uiTab = ref<MbdPipeUiTab>('overview');
  const mbdViewMode = ref<MbdPipeViewMode>('layout_first');
  const renderSource = ref<MbdPipeRenderSource>('fallback');

  // MBD 尺寸显示配置
  const dimTextMode = ref<'backend' | 'auto'>('backend');
  const dimOffsetScale = ref<number>(1);
  const dimLabelT = ref<number>(0.5);
  const dimMode = ref<MbdDimensionMode>('classic');
  const bendDisplayMode = ref<MbdBendDisplayMode>('size');
  const rebarvizDefaults = getMbdDimensionModeConfig('rebarviz');
  const rebarvizArrowStyle = ref<'open' | 'filled' | 'tick'>(
    rebarvizDefaults.arrowStyle === 'filled' ? 'filled' : 'open',
  );
  const rebarvizArrowSizePx = ref<number>(rebarvizDefaults.arrowSizePx);
  const rebarvizArrowAngleDeg = ref<number>(rebarvizDefaults.arrowAngleDeg);
  const rebarvizLineWidthPx = ref<number>(rebarvizDefaults.lineWidthPx);

  const isVisible = ref(false);
  const showDims = ref(true);
  const showDimSegment = ref(true);
  const showDimChain = ref(true);
  const showDimOverall = ref(true);
  const showDimPort = ref(false);
  const showPipeClearances = ref(true);
  const showStructureClearances = ref(true);
  const showElevationMarks = ref(true);
  const showEnvelope = ref(false);
  const showCutTubis = ref(false);
  const showElbows = ref(true);
  const showBranches = ref(true);
  const showFlanges = ref(true);
  const showAnchorDebug = ref(false);
  const showOwnerSegmentDebug = ref(false);
  const suppressedWrongLineCount = ref(0);
  const showWelds = ref(true);
  const showSlopes = ref(true);
  const showBends = ref(true);
  const showSegments = ref(false);
  const showLabels = ref(true);

  const currentData = ref<MbdPipeData | null>(null);
  const activeItemId = ref<string | null>(null);

  // 标注组
  const group = markRaw(new Group());
  group.name = 'dtx-mbd-pipe-v2';
  group.renderOrder = 981;
  group.matrixAutoUpdate = false;

  const identityMatrix = new Matrix4();

  // 材质管理器
  const materials = markRaw(new AnnotationMaterials());

  // 标注集合（按类型分组）
  const dimAnnotations = new Map<string, LinearDimension3D>();
  const weldAnnotations = new Map<string, WeldAnnotation3D>();
  const slopeAnnotations = new Map<string, SlopeAnnotation3D>();
  const segmentLines = new Map<string, Line>();
  const bendAnnotations = new Map<string, BendAnnotationGroup>();
  const cutTubiAnnotations = new Map<string, LinearDimension3D>();
  const fittingAnnotations = new Map<
    string,
    AngleDimension3D | WeldAnnotation3D
  >();
  const tagAnnotations = new Map<string, WeldAnnotation3D>();
  const pipeClearanceAnnotations = new Map<string, LinearDimension3D>();
  const structureClearanceAnnotations = new Map<string, LinearDimension3D>();
  const elevationAnnotations = new Map<string, WeldAnnotation3D>();
  const envelopeObjects = new Map<string, LineSegments>();
  const anchorDebugMarkers = new Map<string, LineSegments>();
  const ownerSegmentDebugLines = new Map<string, Line>();
  const v2LeaderLines = new Map<string, Line>();

  const segmentMaterial = new LineBasicMaterial({
    color: 0x9ca3af,
    transparent: true,
    opacity: 0.9,
  });
  const segmentHighlightMaterial = new LineBasicMaterial({ color: 0xf59e0b });
  const anchorDebugMaterial = new LineBasicMaterial({
    color: 0x10b981,
    transparent: true,
    opacity: 0.95,
  });
  const ownerSegmentDebugMaterial = new LineBasicMaterial({
    color: 0x06b6d4,
    transparent: true,
    opacity: 0.9,
  });
  const envelopeMaterial = new LineBasicMaterial({
    color: 0x64748b,
    transparent: true,
    opacity: 0.65,
  });
  const envelopeHighlightMaterial = new LineBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.95,
  });
  const v2LeaderLineMaterial = new LineBasicMaterial({
    color: 0x111827,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });

  // 历史兼容：保留 initCSS2DRenderer API（但不再实际参与渲染）
  let legacyCss2dRenderer: CSS2DRenderer | null = null;

  // Session-only overrides（不写回后端）
  const dimOverrides = new Map<string, MbdDimOverride>();
  const dimTextById = shallowRef<Map<string, string>>(new Map());
  const asRaw = <T,>(value: T): T => toRaw(value) as T;

  function applyModeDefaults(mode: MbdPipeViewMode): void {
    mbdViewMode.value = mode;
    showDims.value = true;
    if (mode === 'inspection') {
      dimMode.value = 'rebarviz';
      bendDisplayMode.value = 'size';
      showDimSegment.value = false;
      showDimChain.value = false;
      showDimOverall.value = false;
      showDimPort.value = true;
      showPipeClearances.value = true;
      showStructureClearances.value = true;
      showElevationMarks.value = true;
      showEnvelope.value = false;
      showCutTubis.value = false;
      showElbows.value = true;
      showBranches.value = true;
      showFlanges.value = true;
      showAnchorDebug.value = false;
      showOwnerSegmentDebug.value = false;
      showWelds.value = false;
      showSlopes.value = false;
      showBends.value = false;
      showSegments.value = false;
      return;
    }

    if (mode === 'layout_first') {
      dimMode.value = 'classic';
      bendDisplayMode.value = 'size';
      // layout_first 只显示后端 V2 实际返回的 primitive；
      // overall 不由前端合成，只有后端明确返回时才可能显示。
      showDimSegment.value = true;
      showDimChain.value = true;
      showDimOverall.value = true;
      showDimPort.value = false;
      showPipeClearances.value = false;
      showStructureClearances.value = false;
      showElevationMarks.value = false;
      showEnvelope.value = false;
      showCutTubis.value = false;
      showElbows.value = true;
      showBranches.value = true;
      showFlanges.value = true;
      showAnchorDebug.value = false;
      showOwnerSegmentDebug.value = false;
      showWelds.value = true;
      showSlopes.value = true;
      showBends.value = true;
      showSegments.value = false;
      return;
    }

    dimMode.value = 'classic';
    bendDisplayMode.value = 'size';
    showDimSegment.value = false;
    showDimChain.value = true;
    showDimOverall.value = true;
    showDimPort.value = false;
    showPipeClearances.value = false;
    showStructureClearances.value = false;
    showElevationMarks.value = false;
    showEnvelope.value = false;
    showCutTubis.value = false;
    showElbows.value = true;
    showBranches.value = true;
    showFlanges.value = true;
    showAnchorDebug.value = false;
    showOwnerSegmentDebug.value = false;
    showWelds.value = true;
    showSlopes.value = true;
    showBends.value = false;
    showSegments.value = false;
  }

  function resetToCurrentModeDefaults(): void {
    applyModeDefaults(mbdViewMode.value);
  }

  function getRuntimeModeConfig(): MbdDimensionModeConfig {
    const base = getMbdDimensionModeConfig(dimMode.value);
    if (dimMode.value !== 'rebarviz') return base;
    const arrowStyle =
      rebarvizArrowStyle.value === 'filled' ||
      rebarvizArrowStyle.value === 'tick'
        ? rebarvizArrowStyle.value
        : 'open';
    return {
      ...base,
      arrowStyle,
      arrowSizePx: clampNumber(
        rebarvizArrowSizePx.value,
        6,
        40,
        base.arrowSizePx,
      ),
      arrowAngleDeg: clampNumber(
        rebarvizArrowAngleDeg.value,
        8,
        40,
        base.arrowAngleDeg,
      ),
      lineWidthPx: clampNumber(rebarvizLineWidthPx.value, 1, 6, base.lineWidthPx),
    };
  }

  function initCSS2DRenderer(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
  ): CSS2DRenderer {
    void container;
    if (!legacyCss2dRenderer) {
      legacyCss2dRenderer = new CSS2DRenderer();
      legacyCss2dRenderer.domElement.style.display = 'none';
    }
    legacyCss2dRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
    return legacyCss2dRenderer;
  }

  function applyLabelVisibility(): void {
    const visible = isVisible.value && showLabels.value;
    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of weldAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of slopeAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of fittingAnnotations.values()) {
      const raw = asRaw(annotation);
      const forceHide = !!(raw.userData as any)?.mbdForceHideLabel;
      raw.setLabelVisible(visible && !forceHide);
    }
    for (const annotation of tagAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of structureClearanceAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
    for (const annotation of elevationAnnotations.values()) {
      asRaw(annotation).setLabelVisible(visible);
    }
  }

  function ensureGroupAttached(): void {
    const viewer = dtxViewerRef.value;
    if (!viewer) return;
    if (group.parent !== viewer.scene) {
      try {
        group.parent?.remove(group);
      } catch {
        /* ignore */
      }
      viewer.scene.add(group);
    }
  }

  function clearAll(): void {
    // 清理尺寸标注
    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    dimAnnotations.clear();
    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    cutTubiAnnotations.clear();

    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    cutTubiAnnotations.clear();

    // 清理焊缝标注
    for (const annotation of weldAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    weldAnnotations.clear();

    // 清理坡度标注
    for (const annotation of slopeAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    slopeAnnotations.clear();

    // 清理管道间距离标注
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    pipeClearanceAnnotations.clear();

    for (const annotation of structureClearanceAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    structureClearanceAnnotations.clear();

    for (const annotation of elevationAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    elevationAnnotations.clear();

    for (const envelope of envelopeObjects.values()) {
      try {
        (envelope.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      envelope.removeFromParent();
    }
    envelopeObjects.clear();

    // 清理弯头标注
    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    bendAnnotations.clear();

    for (const annotation of fittingAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    fittingAnnotations.clear();

    for (const annotation of tagAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    tagAnnotations.clear();

    for (const marker of anchorDebugMarkers.values()) {
      try {
        (marker.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      marker.removeFromParent();
    }
    anchorDebugMarkers.clear();

    for (const line of ownerSegmentDebugLines.values()) {
      try {
        (line.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      line.removeFromParent();
    }
    ownerSegmentDebugLines.clear();

    for (const line of v2LeaderLines.values()) {
      try {
        (line.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      line.removeFromParent();
    }
    v2LeaderLines.clear();

    // 清理管段骨架线
    for (const line of segmentLines.values()) {
      try {
        (line.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
    }
    segmentLines.clear();

    // 清理 group 子对象
    for (const child of [...group.children]) {
      group.remove(child);
    }

    // 清理 session-only overrides
    dimOverrides.clear();
    suppressedWrongLineCount.value = 0;

    currentData.value = null;
    activeItemId.value = null;
    isVisible.value = false;
    renderSource.value = 'fallback';
    applyLabelVisibility();
    requestRender?.();
  }

  function applyBackgroundColor(viewer: DtxViewer): void {
    const bg = viewer.scene.background;
    let color: Color;
    if (bg instanceof Color) {
      color = bg;
    } else {
      const bgStore = useBackgroundStore();
      const preset = getPreset(bgStore.mode.value);
      color = new Color(preset.bottomColor);
    }
    for (const a of dimAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of cutTubiAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of weldAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of slopeAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of bendAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of fittingAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of tagAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of pipeClearanceAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of structureClearanceAnnotations.values())
      asRaw(a).setBackgroundColor(color);
    for (const a of elevationAnnotations.values())
      asRaw(a).setBackgroundColor(color);
  }

  function applyVisibility(): void {
    // 尺寸标注可见性
    for (const annotation of dimAnnotations.values()) {
      const ann = asRaw(annotation);
      const kind = ((ann.userData as any)?.mbdDimKind ??
        'segment') as MbdDimKind;
      const declutterHidden = !!(ann.userData as any)?.mbdDeclutterHidden;
      const kindVisible =
        (kind === 'segment' && showDimSegment.value) ||
        (kind === 'chain' && showDimChain.value) ||
        (kind === 'overall' && showDimOverall.value) ||
        (kind === 'port' && showDimPort.value);
      ann.visible =
        isVisible.value && showDims.value && kindVisible && !declutterHidden;
    }

    for (const annotation of cutTubiAnnotations.values()) {
      const layoutHidden = !!(asRaw(annotation).userData as any)?.mbdLayoutHidden;
      asRaw(annotation).visible =
        isVisible.value && showDims.value && showCutTubis.value && !layoutHidden;
    }

    // 焊缝标注可见性
    for (const annotation of weldAnnotations.values()) {
      const layoutHidden = !!(asRaw(annotation).userData as any)?.mbdLayoutHidden;
      asRaw(annotation).visible = isVisible.value && showWelds.value && !layoutHidden;
    }

    // 坡度标注可见性
    for (const annotation of slopeAnnotations.values()) {
      const layoutHidden = !!(asRaw(annotation).userData as any)?.mbdLayoutHidden;
      asRaw(annotation).visible =
        isVisible.value && showSlopes.value && !layoutHidden;
    }

    // 管道间距离标注可见性
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showPipeClearances.value;
    }

    for (const annotation of structureClearanceAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showStructureClearances.value;
    }

    for (const annotation of elevationAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showElevationMarks.value;
    }

    for (const envelope of envelopeObjects.values()) {
      envelope.visible = isVisible.value && showEnvelope.value;
    }

    // 弯头标注可见性
    for (const annotation of bendAnnotations.values()) {
      const layoutHidden = !!(asRaw(annotation).userData as any)?.mbdLayoutHidden;
      asRaw(annotation).visible = isVisible.value && showBends.value && !layoutHidden;
    }

    for (const annotation of fittingAnnotations.values()) {
      const kind = ((asRaw(annotation).userData as any)?.mbdFittingKind ??
        'elbow') as MbdFittingKind;
      const visible =
        (kind === 'elbow' && showElbows.value) ||
        (kind === 'branch' && showBranches.value) ||
        (kind === 'flange' && showFlanges.value);
      const layoutHidden = !!(asRaw(annotation).userData as any)?.mbdLayoutHidden;
      asRaw(annotation).visible = isVisible.value && visible && !layoutHidden;
    }

    for (const annotation of tagAnnotations.values()) {
      const raw = asRaw(annotation);
      const kind = ((raw.userData as any)?.mbdTagKind ??
        'other') as MbdTagKind;
      const declutterHidden = !!(raw.userData as any)?.mbdDeclutterHidden;
      const visible =
        kind === 'tubi'
          ? showCutTubis.value
          : kind === 'elbow'
            ? showElbows.value
            : kind === 'branch'
              ? showBranches.value
              : kind === 'flange'
                ? showFlanges.value
                : true;
      const layoutHidden = !!(raw.userData as any)?.mbdLayoutHidden;
      raw.visible = isVisible.value && visible && !declutterHidden && !layoutHidden;
    }

    for (const marker of anchorDebugMarkers.values()) {
      marker.visible = isVisible.value && showAnchorDebug.value;
    }

    for (const line of ownerSegmentDebugLines.values()) {
      line.visible = isVisible.value && showOwnerSegmentDebug.value;
    }

    for (const line of v2LeaderLines.values()) {
      line.visible = isVisible.value && showLabels.value;
    }

    // 管段骨架线可见性
    for (const line of segmentLines.values()) {
      line.visible = isVisible.value && showSegments.value;
    }
  }

  function applyLabelRenderStyleByMode(): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of weldAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of slopeAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of fittingAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of tagAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of structureClearanceAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
    for (const annotation of elevationAnnotations.values()) {
      asRaw(annotation).setLabelRenderStyle(labelRenderStyle);
    }
  }

  function highlightItem(id: string | null): void {
    activeItemId.value = id;

    // 取消所有高亮
    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of weldAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of slopeAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of fittingAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of tagAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of structureClearanceAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const annotation of elevationAnnotations.values()) {
      asRaw(annotation).highlighted = false;
    }
    for (const line of segmentLines.values()) {
      line.material = segmentMaterial;
    }
    for (const line of envelopeObjects.values()) {
      line.material = envelopeMaterial;
    }

    // 设置新的高亮
    if (id) {
      if (
        pipeClearanceAnnotations.has(id) ||
        structureClearanceAnnotations.has(id) ||
        elevationAnnotations.has(id)
      ) uiTab.value = 'clearances';
      else if (envelopeObjects.has(id)) uiTab.value = 'envelope';

      const dim = dimAnnotations.get(id);
      if (dim) asRaw(dim).highlighted = true;

      const cutTubi = cutTubiAnnotations.get(id);
      if (cutTubi) asRaw(cutTubi).highlighted = true;

      const weld = weldAnnotations.get(id);
      if (weld) asRaw(weld).highlighted = true;

      const slope = slopeAnnotations.get(id);
      if (slope) asRaw(slope).highlighted = true;

      const bend = bendAnnotations.get(id);
      if (bend) asRaw(bend).highlighted = true;

      const fitting = fittingAnnotations.get(id);
      if (fitting) asRaw(fitting).highlighted = true;

      const tag = tagAnnotations.get(id);
      if (tag) asRaw(tag).highlighted = true;

      const pipeClearance = pipeClearanceAnnotations.get(id);
      if (pipeClearance) asRaw(pipeClearance).highlighted = true;

      const structureClearance = structureClearanceAnnotations.get(id);
      if (structureClearance) asRaw(structureClearance).highlighted = true;

      const elevation = elevationAnnotations.get(id);
      if (elevation) asRaw(elevation).highlighted = true;

      const seg = segmentLines.get(id);
      if (seg) seg.material = segmentHighlightMaterial;

      const envelope = envelopeObjects.get(id);
      if (envelope) envelope.material = envelopeHighlightMaterial;
    }

    requestRender?.();
  }

  function renderDims(
    dims: MbdDimDto[],
    segments: MbdPipeSegmentDto[],
    pipeOffsetDirs: Vector3[],
  ): void {
    const viewer = dtxViewerRef.value;
    const gm = getGlobalModelMatrix?.() || identityMatrix;
    const modeConfig = getRuntimeModeConfig();
    const duplicateOverallIds = collectDuplicateOverallDimIds(dims);
    dimTextById.value.clear();
    for (const d of dims) {
      const start = new Vector3(d.start[0], d.start[1], d.start[2]);
      const end = new Vector3(d.end[0], d.end[1], d.end[2]);
      const kind = (d.kind ?? 'segment') as MbdDimKind;
      const baseOffset = resolveFallbackBaseOffset(
        kind,
        start,
        end,
        d.layout_hint,
        segments,
      );
      const layoutResolution = resolveBranchLayout({
        start,
        end,
        role: kind,
        hint: d.layout_hint,
        segments,
        pipeOffsetDirs,
        baseOffset,
        baseOffsetScale: dimOffsetScale.value,
      });
      if (kind === 'overall' && duplicateOverallIds.has(d.id)) {
        continue;
      }

      // 计算偏移方向：优先规范化 layout_hint，其次分支拓扑，再次相机方向；都失败则抑制该错误线
      const offsetDir =
        layoutResolution.direction ??
        computeDimensionOffsetDirInLocal(
          start,
          end,
          viewer?.camera ?? null,
          gm,
        );
      if (!offsetDir || offsetDir.lengthSq() < 1e-9) {
        suppressedWrongLineCount.value += 1;
        continue;
      }
      offsetDir.normalize();

      const offset = layoutResolution.offset;

      // 合并 session-only overrides
      const ov = dimOverrides.get(d.id);
      const finalOffset = ov?.offset ?? offset;
      const finalDir = ov?.direction
        ? new Vector3(ov.direction[0], ov.direction[1], ov.direction[2])
        : offsetDir;
      const finalLabelT = ov?.labelT ?? 0.5;
      const finalLabelOffsetWorld = ov?.labelOffsetWorld
        ? new Vector3(
          ov.labelOffsetWorld[0],
          ov.labelOffsetWorld[1],
          ov.labelOffsetWorld[2],
        )
        : null;
      const finalIsReference = ov?.isReference ?? false;

      dimTextById.value.set(d.id, String(d.text ?? ''));

      const useBackendText = dimTextMode.value === 'backend';
      const text = resolveDimDisplayText(
        d.text,
        useBackendText,
        start,
        end,
        gm,
        unitSettings.displayUnit.value,
        unitSettings.precision.value,
      );

      const dim = new LinearDimension3D(
        materials,
        {
          start,
          end,
          offset: finalOffset,
          labelT: finalLabelT,
          labelOffsetWorld: finalLabelOffsetWorld,
          isReference: finalIsReference,
          text,
          direction: finalDir,
          arrowStyle: modeConfig.arrowStyle,
          arrowSizePx: modeConfig.arrowSizePx,
          arrowAngleDeg: modeConfig.arrowAngleDeg,
          extensionOvershootPx: modeConfig.extensionOvershootPx,
          labelRenderStyle: modeConfig.labelRenderStyle,
        },
        {
          depthTest: modeConfig.depthTest,
        },
      );

      // 可交互：MBD dims 在当前会话内支持拖拽调整
      dim.userData.pickable = true;
      dim.userData.draggable = true;
      (dim.userData as any).mbdDimId = d.id;
      dim.setLabelRenderStyle(modeConfig.labelRenderStyle);

      dim.setMaterialSet(
        resolveMbdDimensionMaterialSet(materials, kind, dimMode.value),
      );
      dim.setLineWidthPx(modeConfig.lineWidthPx);
      (dim.userData as any).mbdDimKind = kind;
      const rawDim = markRaw(dim);
      group.add(rawDim);
      dimAnnotations.set(d.id, rawDim);
      (rawDim.userData as any).mbdLayoutResolution = {
        lane: layoutResolution.lane,
        source: layoutResolution.source,
        offset: offset,
        normalizedHint: layoutResolution.normalizedHint,
      };
    }
  }

  function applyChainOffsetUnification(): void {
    const chainDims: [string, LinearDimension3D][] = [];
    for (const [dimId, dim] of dimAnnotations.entries()) {
      const kind = ((asRaw(dim).userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (isBackendDerivedAnnotation(asRaw(dim))) continue;
      if (kind === 'chain') chainDims.push([dimId, asRaw(dim)]);
    }
    if (chainDims.length <= 1) return;

    const groups = new Map<string, [string, LinearDimension3D][]>();
    for (const entry of chainDims) {
      const [, dim] = entry;
      const res = (dim.userData as any).mbdLayoutResolution;
      const hint = res?.normalizedHint;
      const dir = hint?.offsetDir;
      const groupKey = dir
        ? `${dir.x.toFixed(4)},${dir.y.toFixed(4)},${dir.z.toFixed(4)}`
        : '_default';
      let arr = groups.get(groupKey);
      if (!arr) {
        arr = [];
        groups.set(groupKey, arr);
      }
      arr.push(entry);
    }

    for (const members of groups.values()) {
      if (members.length <= 1) continue;
      const maxOffset = Math.max(...members.map(([, d]) => d.getParams().offset));
      for (const [, dim] of members) {
        dim.setParams({ offset: maxOffset });
      }
    }
  }

  function applyPortDimLabelDeclutter(): void {
    const portAnnotations: [string, LinearDimension3D][] = [];
    for (const [dimId, dim] of dimAnnotations.entries()) {
      const kind = ((asRaw(dim).userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (kind !== 'port') continue;
      if (isBackendDerivedAnnotation(asRaw(dim))) continue;
      (asRaw(dim).userData as any).mbdDeclutterHidden = false;
      portAnnotations.push([dimId, asRaw(dim)]);
    }
    if (portAnnotations.length <= 1) return;

    // 第一步：近邻端口尺寸稀疏化（只隐藏，保留数据与交互 id）
    // 说明：单位为后端原始坐标（通常 mm），阈值按当前样本调优，目标是降低端口密集区域拥挤。
    const minAnchorGap = 200;
    const keptAnchors: Vector3[] = [];
    const sortedByLengthDesc = portAnnotations
      .slice()
      .sort(([, a], [, b]) => b.getDistance() - a.getDistance());

    for (const [_, dim] of sortedByLengthDesc) {
      const p = dim.getParams();
      const anchor = p.start.clone().add(p.end).multiplyScalar(0.5);
      const hasBackendLabelLayout = !!(dim.userData as any)?.mbdHasExplicitLabelLayout;
      if (hasBackendLabelLayout) {
        (dim.userData as any).mbdDeclutterHidden = false;
        keptAnchors.push(anchor);
        continue;
      }
      const tooClose = keptAnchors.some((k) => k.distanceTo(anchor) < minAnchorGap);
      (dim.userData as any).mbdDeclutterHidden = tooClose;
      if (!tooClose) keptAnchors.push(anchor);
    }

    const baseLabelT = clamp01(dimLabelT.value, 0.5);
    const minGap = 160;
    const placed: Vector3[] = [];
    let rank = 0;

    for (const [dimId, dim] of portAnnotations) {
      if ((dim.userData as any).mbdDeclutterHidden) continue;
      const ov = dimOverrides.get(dimId);
      const hasBackendLabelLayout = !!(dim.userData as any)?.mbdHasExplicitLabelLayout;
      const hasManualLabel =
        hasBackendLabelLayout ||
        (ov?.labelOffsetWorld != null) ||
        ov?.labelT !== undefined;
      if (hasManualLabel) {
        placed.push(dim.getLabelWorldPos());
        rank += 1;
        continue;
      }

      const p = dim.getParams();
      const segDir = p.end.clone().sub(p.start);
      if (segDir.lengthSq() < 1e-9) {
        placed.push(dim.getLabelWorldPos());
        rank += 1;
        continue;
      }
      segDir.normalize();

      const offDir = p.direction?.clone() ?? new Vector3(-segDir.y, segDir.x, 0);
      if (offDir.lengthSq() < 1e-9) offDir.set(1, 0, 0);
      offDir.normalize();

      const tOffset = ((rank % 5) - 2) * 0.12;
      const nextLabelT = Math.max(0.12, Math.min(0.88, baseLabelT + tOffset));
      const segmentLength = p.start.distanceTo(p.end);
      const step = Math.max(50, Math.min(220, segmentLength * 0.4));
      const baseLabelPos = p.start.clone().lerp(p.end, nextLabelT);
      const nextLabelOffset = new Vector3();

      let placedPos = baseLabelPos.clone();
      for (let i = 0; i < 5; i += 1) {
        const candidate = baseLabelPos.clone().add(nextLabelOffset);
        const overlap = placed.some((prev) => prev.distanceTo(candidate) < minGap);
        placedPos = candidate;
        if (!overlap) break;

        const sign = (rank + i) % 2 === 0 ? 1 : -1;
        nextLabelOffset
          .addScaledVector(segDir, sign * step * 0.45)
          .addScaledVector(offDir, sign * step * 0.25);
      }

      dim.setParams({
        labelT: nextLabelT,
        labelOffsetWorld:
          nextLabelOffset.lengthSq() > 1e-9 ? nextLabelOffset : null,
      });
      placed.push(placedPos);
      rank += 1;
    }
  }

  function applyCutTubiLabelDeclutter(includeVisibleTags = false): void {
    if (cutTubiAnnotations.size <= 0) return;

    const minGap = includeVisibleTags ? 0.95 : 0.42;
    const placed: Vector3[] = [];

    for (const dim of dimAnnotations.values()) {
      if (!dim.visible) continue;
      const kind = ((asRaw(dim).userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (kind !== 'chain' && kind !== 'overall') continue;
      placed.push(getAnnotationLabelWorldPos(asRaw(dim)));
    }

    if (includeVisibleTags) {
      for (const tag of tagAnnotations.values()) {
        const rawTag = asRaw(tag);
        if (!rawTag.visible) continue;
        placed.push(getAnnotationLabelWorldPos(rawTag).clone());
      }
    }

    for (const cut of cutTubiAnnotations.values()) {
      const rawCut = asRaw(cut);
      if (isBackendDerivedAnnotation(rawCut)) continue;
      if (!rawCut.visible) continue;

      const p = rawCut.getParams();
      const baseOffset = Number(
        (rawCut.userData as any)?.mbdBaseOffset ?? p.offset ?? 0,
      );
      const offsetSteps = [0, 180, 320, 500, 720, 960, 1280, 1640, 2120];
      const candidateOffsets = offsetSteps.map((step) => baseOffset + step);
      let chosenPos: Vector3 | null = null;
      let chosenOffset = baseOffset;

      for (const candidateOffset of candidateOffsets) {
        rawCut.setParams({
          offset: candidateOffset,
          labelT: 0.5,
          labelOffsetWorld: null,
        });
        const candidatePos = getAnnotationLabelWorldPos(rawCut);
        const overlap = placed.some((prev) => prev.distanceTo(candidatePos) < minGap);
        if (!overlap) {
          chosenPos = candidatePos.clone();
          chosenOffset = candidateOffset;
          break;
        }
      }

      rawCut.setParams({
        offset: chosenOffset,
        labelT: 0.5,
        labelOffsetWorld: null,
      });
      if (!chosenPos) {
        chosenPos = getAnnotationLabelWorldPos(rawCut).clone();
      }
      placed.push(chosenPos);
    }
  }

  function applyTagLabelDeclutter(): void {
    if (tagAnnotations.size <= 0) return;

    const occupied: Vector3[] = [];
    const placedTagMeta: { kind: MbdTagKind; text: string; pos: Vector3 }[] = [];
    const minGap = 0.7;
    const duplicateElbowGap = 1.35;

    for (const dim of dimAnnotations.values()) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible) continue;
      if (isBackendDerivedAnnotation(rawDim)) continue;
      const kind = ((rawDim.userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (kind !== 'chain' && kind !== 'overall') continue;
      occupied.push(getAnnotationLabelWorldPos(rawDim).clone());
    }

    for (const cut of cutTubiAnnotations.values()) {
      const rawCut = asRaw(cut);
      if (!rawCut.visible) continue;
      occupied.push(getAnnotationLabelWorldPos(rawCut).clone());
    }

    const sortedTags = [...tagAnnotations.values()].sort((a, b) => {
      const kindA = (((asRaw(a).userData as any)?.mbdTagKind ?? 'other') as MbdTagKind);
      const kindB = (((asRaw(b).userData as any)?.mbdTagKind ?? 'other') as MbdTagKind);
      return resolveTagPriority(kindA) - resolveTagPriority(kindB);
    });

    for (const tag of sortedTags) {
      const rawTag = asRaw(tag);
      (rawTag.userData as any).mbdDeclutterHidden = false;
      if (!rawTag.visible) continue;

      const params = rawTag.getParams();
      const userData = (rawTag.userData as any) ?? {};
      const tagKind = ((userData.mbdTagKind ?? 'other') as MbdTagKind);
      const hint = normalizeMbdLayoutHint(
        (userData.mbdLayoutHint ?? null) as MbdLayoutHint | null,
      );
      const baseOffset =
        toVector3(userData.mbdBaseLabelOffset ?? null) ??
        params.labelOffsetWorld?.clone() ??
        new Vector3();

      const offsetDir = hint.offsetDir?.clone() ?? new Vector3(0, 1, 0);
      if (offsetDir.lengthSq() < 1e-9) offsetDir.set(0, 1, 0);
      offsetDir.normalize();

      const charDir =
        hint.charDir?.clone() ??
        hint.primaryAxis?.clone() ??
        new Vector3(0, 0, 1);
      if (charDir.lengthSq() < 1e-9) charDir.set(0, 0, 1);
      charDir.normalize();

      const candidateOffsets = [
        baseOffset.clone(),
        baseOffset.clone().addScaledVector(charDir, 260),
        baseOffset.clone().addScaledVector(charDir, -260),
        baseOffset.clone().addScaledVector(offsetDir, 220),
        baseOffset.clone().addScaledVector(offsetDir, -220),
        baseOffset.clone().addScaledVector(charDir, 420).addScaledVector(offsetDir, 180),
        baseOffset.clone().addScaledVector(charDir, -420).addScaledVector(offsetDir, 180),
        baseOffset.clone().addScaledVector(charDir, 620).addScaledVector(offsetDir, 320),
        baseOffset.clone().addScaledVector(charDir, -620).addScaledVector(offsetDir, 320),
      ];

      let chosenOffset = baseOffset.clone();
      let chosenPos = getAnnotationLabelWorldPos(rawTag).clone();
      let foundCandidate = false;

      for (const candidate of candidateOffsets) {
        rawTag.setParams({ labelOffsetWorld: candidate });
        const candidatePos = getAnnotationLabelWorldPos(rawTag);
        const overlap = occupied.some((prev) => prev.distanceTo(candidatePos) < minGap);
        if (!overlap) {
          chosenOffset = candidate.clone();
          chosenPos = candidatePos.clone();
          foundCandidate = true;
          break;
        }
      }

      const duplicateElbow = placedTagMeta.some(
        (item) =>
          tagKind === 'elbow' &&
          item.kind === 'elbow' &&
          item.text === params.label &&
          item.pos.distanceTo(chosenPos) < duplicateElbowGap,
      );
      const duplicateElbowCount = placedTagMeta.filter(
        (item) =>
          tagKind === 'elbow' &&
          item.kind === 'elbow' &&
          item.text === params.label,
      ).length;

      if (!foundCandidate || duplicateElbow || duplicateElbowCount >= 2) {
        if (tagKind === 'elbow' || tagKind === 'other') {
          (rawTag.userData as any).mbdDeclutterHidden = true;
          rawTag.visible = false;
          continue;
        }
      }

      rawTag.setParams({ labelOffsetWorld: chosenOffset });
      occupied.push(chosenPos);
      placedTagMeta.push({
        kind: tagKind,
        text: params.label,
        pos: chosenPos.clone(),
      });
    }
  }

  function buildTextOnlyFittingAnnotation(
    fitting: MbdFittingDto,
    anchor: Vector3,
    labelRenderStyle: MbdDimensionModeConfig['labelRenderStyle'],
  ): WeldAnnotation3D | null {
    const text = String(fitting.text ?? '').trim();
    if (!text) return null;
    const annotation = new WeldAnnotation3D(materials, {
      position: anchor,
      label: text,
      subtitle: '',
      isShop: true,
      crossSize: 0,
      labelOffsetWorld: resolveFloatingLabelOffset(fitting.layout_hint, 120),
      labelRenderStyle,
    });
    return annotation;
  }

  function applyFittingMaterial(
    annotation: WeldAnnotation3D | AngleDimension3D,
    fittingKind: MbdFittingKind,
  ): void {
    if (fittingKind === 'flange') annotation.setMaterialSet(materials.blue);
    else if (fittingKind === 'branch') annotation.setMaterialSet(materials.orange);
    else annotation.setMaterialSet(materials.yellow);
  }

  function storeFittingAnnotation(
    fitting: MbdFittingDto,
    fittingKind: MbdFittingKind,
    annotation: WeldAnnotation3D | AngleDimension3D,
  ): void {
    const rawAnnotation = markRaw(annotation);
    (rawAnnotation.userData as any).mbdAuxKind = 'fitting';
    (rawAnnotation.userData as any).mbdFittingKind = fittingKind;
    group.add(rawAnnotation);
    fittingAnnotations.set(fitting.id, rawAnnotation as any);
  }

  function renderFittings(fittings: MbdFittingDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    for (const fitting of fittings) {
      const fittingKind = classifyFitting(fitting);
      const anchor =
        toVector3(fitting.anchor_point) ??
        toVector3(fitting.layout_hint?.anchor_point ?? null);
      if (!anchor) {
        recordSuppressedAnnotation(suppressedWrongLineCount, 'fitting_missing_anchor');
        continue;
      }

      if (
        fittingKind === 'elbow' &&
        fitting.angle != null &&
        fitting.face_center_1 &&
        fitting.face_center_2
      ) {
        const point1 = toVector3(fitting.face_center_1);
        const point2 = toVector3(fitting.face_center_2);
        if (point1 && point2) {
          const angleDim = new AngleDimension3D(materials, {
            vertex: anchor,
            point1,
            point2,
            text:
              `${fitting.noun ?? 'ELBO'} ${Number(fitting.angle).toFixed(1)}°`,
            labelRenderStyle,
          });
          applyFittingMaterial(angleDim, fittingKind);
          storeFittingAnnotation(fitting, fittingKind, angleDim);
          continue;
        }
      }

      const textOnly = buildTextOnlyFittingAnnotation(
        fitting,
        anchor,
        labelRenderStyle,
      );
      if (!textOnly) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          'fitting_missing_renderable_geometry',
        );
        continue;
      }
      applyFittingMaterial(textOnly, fittingKind);
      storeFittingAnnotation(fitting, fittingKind, textOnly);
    }
  }

  function createLaidOutLinearAnnotation(
    item: MbdLaidOutLinearDimDto,
    materialSet: ReturnType<typeof resolveMbdDimensionMaterialSet>,
  ): LinearDimension3D | null {
    const modeConfig = getRuntimeModeConfig();
    const start = toVector3(item.start);
    const end = toVector3(item.end);
    const direction = toVector3(item.direction);
    const laidOutGeometry = resolveLaidOutLinearGeometry(item);
    if (!start || !end || (!direction && !laidOutGeometry)) return null;
    const dim = new LinearDimension3D(
      materials,
      {
        start,
        end,
        offset: Number(item.offset) || 0,
        labelT: clamp01(item.label_t, 0.5),
        labelOffsetWorld: resolveLaidOutLabelOffset(item.label_offset_world),
        text: String(item.text ?? ''),
        direction: direction ?? undefined,
        arrowStyle: modeConfig.arrowStyle,
        arrowSizePx: modeConfig.arrowSizePx,
        arrowAngleDeg: modeConfig.arrowAngleDeg,
        extensionOvershootPx: modeConfig.extensionOvershootPx,
        labelRenderStyle: modeConfig.labelRenderStyle,
        laidOutGeometry,
      },
      {
        depthTest: modeConfig.depthTest,
      },
    );
    dim.setMaterialSet(materialSet);
    dim.setLineWidthPx(modeConfig.lineWidthPx);
    dim.setLabelRenderStyle(modeConfig.labelRenderStyle);
    dim.userData.pickable = true;
    dim.userData.draggable = true;
    return dim;
  }

  function renderLaidOutLinearDims(items: MbdLaidOutLinearDimDto[]): void {
    for (const item of items) {
      const kind = (
        item.kind === 'chain' ||
        item.kind === 'overall' ||
        item.kind === 'port'
          ? item.kind
          : 'segment'
      ) as MbdDimKind;
      const dim = createLaidOutLinearAnnotation(
        item,
        resolveMbdDimensionMaterialSet(materials, kind, dimMode.value),
      );
      if (!dim) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          item.suppressed_reason ?? 'layout_first_invalid_linear_dim',
        );
        continue;
      }
      (dim.userData as any).mbdDimId = item.id;
      (dim.userData as any).mbdDimKind = kind;
      (dim.userData as any).mbdSourceKind = item.source_kind ?? null;
      (dim.userData as any).mbdSourcePrimitiveId =
        item.source_primitive_id ?? item.id;
      (dim.userData as any).mbdSourceSubKind =
        item.source_sub_kind ?? item.kind;
      (dim.userData as any).mbdBackendDerivedGeometry =
        isBackendDerivedLinearItem(item);
      if (isBackendDerivedLinearItem(item)) {
        dim.userData.draggable = false;
      }
      (dim.userData as any).mbdLayoutHidden = item.visible === false;
      (dim.userData as any).mbdDeclutterHidden = item.visible === false;
      (dim.userData as any).mbdHasExplicitLabelLayout =
        item.label_offset_world != null || item.label_t != null;
      const rawDim = markRaw(dim);
      group.add(rawDim);
      dimAnnotations.set(item.id, rawDim);
      dimTextById.value.set(item.id, String(item.text ?? ''));
    }
  }

  function projectLabelToScreen(
    point: Vector3,
    camera: Camera,
    viewport: { width: number; height: number },
  ): { x: number; y: number } | null {
    const ndc = point.clone().project(camera);
    if (
      !Number.isFinite(ndc.x) ||
      !Number.isFinite(ndc.y) ||
      !Number.isFinite(ndc.z)
    ) {
      return null;
    }
    return {
      x: (ndc.x * 0.5 + 0.5) * viewport.width,
      y: (-ndc.y * 0.5 + 0.5) * viewport.height,
    };
  }

  function labelScreenBox(
    center: { x: number; y: number },
    text: string,
  ): { x: number; y: number; width: number; height: number } {
    return {
      x: center.x,
      y: center.y,
      width: clampNumber(String(text || '').length * 10 + 28, 52, 132, 76),
      height: 28,
    };
  }

  function labelBoxesOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): boolean {
    const margin = 10;
    return !(
      a.x + a.width * 0.5 + margin < b.x - b.width * 0.5 ||
      a.x - a.width * 0.5 - margin > b.x + b.width * 0.5 ||
      a.y + a.height * 0.5 + margin < b.y - b.height * 0.5 ||
      a.y - a.height * 0.5 - margin > b.y + b.height * 0.5
    );
  }

  function applyLaidOutDimLabelDeclutter(): void {
    const viewer = dtxViewerRef.value;
    if (!viewer || dimAnnotations.size <= 1) return;

    const camera = viewer.camera;
    camera.updateMatrixWorld?.(true);
    const rect = viewer.canvas.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1),
    };
    const cameraUp = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    const cameraRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const step = 0.95;
    const candidateOffsets = [
      null,
      cameraUp.clone().multiplyScalar(-step),
      cameraUp.clone().multiplyScalar(step),
      cameraUp.clone().multiplyScalar(-step * 1.7).addScaledVector(cameraRight, step * 0.35),
      cameraUp.clone().multiplyScalar(step * 1.7).addScaledVector(cameraRight, -step * 0.35),
      cameraUp.clone().multiplyScalar(-step * 2.5),
      cameraUp.clone().multiplyScalar(step * 2.5),
      cameraRight.clone().multiplyScalar(step * 1.2),
      cameraRight.clone().multiplyScalar(-step * 1.2),
    ];
    const placed: { x: number; y: number; width: number; height: number }[] = [];

    for (const dim of dimAnnotations.values()) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible) continue;
      const kind = ((rawDim.userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (kind !== 'chain' && kind !== 'overall') continue;

      let chosenOffset: Vector3 | null = null;
      let chosenBox: { x: number; y: number; width: number; height: number } | null = null;
      const text = String(rawDim.getParams().text ?? '');

      for (const offset of candidateOffsets) {
        rawDim.setParams({ labelOffsetWorld: offset });
        const labelPos = getAnnotationLabelWorldPos(rawDim);
        const screen = projectLabelToScreen(labelPos, camera, viewport);
        if (!screen) continue;
        const box = labelScreenBox(screen, text);
        if (!placed.some((prev) => labelBoxesOverlap(box, prev))) {
          chosenOffset = offset?.clone() ?? null;
          chosenBox = box;
          break;
        }
      }

      rawDim.setParams({ labelOffsetWorld: chosenOffset });
      if (!chosenBox) {
        const labelPos = getAnnotationLabelWorldPos(rawDim);
        const screen = projectLabelToScreen(labelPos, camera, viewport);
        if (screen) chosenBox = labelScreenBox(screen, text);
      }
      if (chosenBox) placed.push(chosenBox);
    }
  }

  function renderLaidOutCutTubis(items: MbdLaidOutLinearDimDto[]): void {
    for (const item of items) {
      const dim = createLaidOutLinearAnnotation(item, materials.black);
      if (!dim) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          item.suppressed_reason ?? 'layout_first_invalid_cut_tubi',
        );
        continue;
      }
      (dim.userData as any).mbdAuxKind = 'cut_tubi';
      (dim.userData as any).mbdSourceKind = item.source_kind ?? null;
      (dim.userData as any).mbdSourcePrimitiveId =
        item.source_primitive_id ?? item.id;
      (dim.userData as any).mbdSourceSubKind =
        item.source_sub_kind ?? 'cut_tubi';
      (dim.userData as any).mbdBackendDerivedGeometry =
        isBackendDerivedLinearItem(item);
      if (isBackendDerivedLinearItem(item)) {
        dim.userData.draggable = false;
      }
      (dim.userData as any).mbdLayoutHidden = item.visible === false;
      (dim.userData as any).mbdBaseOffset = Number(item.offset) || 0;
      const rawDim = markRaw(dim);
      group.add(rawDim);
      cutTubiAnnotations.set(item.id, rawDim);
    }
  }

  function renderLaidOutWelds(welds: MbdLaidOutWeldDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    const weldMaterial =
      mbdViewMode.value === 'inspection' ? materials.orange : materials.black;
    for (const weldItem of welds) {
      const position = toVector3(weldItem.position);
      if (!position) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          weldItem.suppressed_reason ?? 'layout_first_invalid_weld',
        );
        continue;
      }
      const weld = new WeldAnnotation3D(materials, {
        position,
        label: weldItem.label,
        subtitle: weldItem.subtitle ?? null,
        isShop: weldItem.is_shop,
        crossSize: clampNumber(weldItem.cross_size, 0, 5000, 50),
        labelOffsetWorld: resolveLaidOutLabelOffset(weldItem.label_offset_world),
        labelRenderStyle,
      });
      weld.userData.pickable = true;
      weld.userData.draggable = true;
      (weld.userData as any).mbdWeldId = weldItem.id;
      (weld.userData as any).mbdLayoutHidden = weldItem.visible === false;
      weld.setMaterialSet(weldMaterial);
      const rawWeld = markRaw(weld);
      group.add(rawWeld);
      weldAnnotations.set(weldItem.id, rawWeld);
    }
  }

  function renderLaidOutSlopes(slopes: MbdLaidOutSlopeDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    const slopeMaterial =
      mbdViewMode.value === 'inspection' ? materials.blue : materials.black;
    for (const slopeItem of slopes) {
      const start = toVector3(slopeItem.start);
      const end = toVector3(slopeItem.end);
      if (!start || !end) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          slopeItem.suppressed_reason ?? 'layout_first_invalid_slope',
        );
        continue;
      }
      const slope = new SlopeAnnotation3D(materials, {
        start,
        end,
        text: slopeItem.text,
        slope: slopeItem.slope,
        labelOffsetWorld: resolveLaidOutLabelOffset(slopeItem.label_offset_world),
        labelRenderStyle,
      });
      slope.userData.pickable = true;
      slope.userData.draggable = true;
      (slope.userData as any).mbdSlopeId = slopeItem.id;
      (slope.userData as any).mbdLayoutHidden = slopeItem.visible === false;
      slope.setMaterialSet(slopeMaterial);
      const rawSlope = markRaw(slope);
      group.add(rawSlope);
      slopeAnnotations.set(slopeItem.id, rawSlope);
    }
  }

  function renderLaidOutTags(tags: MbdLaidOutTagDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    for (const tagItem of tags) {
      const position = toVector3(tagItem.position);
      if (!position) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          tagItem.suppressed_reason ?? 'layout_first_invalid_tag',
        );
        continue;
      }
      const tag = new WeldAnnotation3D(materials, {
        position,
        label: tagItem.text,
        subtitle: '',
        isShop: true,
        crossSize: 0,
        labelOffsetWorld: resolveLaidOutLabelOffset(tagItem.label_offset_world),
        labelRenderStyle,
      });
      tag.setMaterialSet(materials.black);
      (tag.userData as any).mbdAuxKind = 'tag';
      (tag.userData as any).mbdTagKind = 'other';
      (tag.userData as any).mbdLayoutHidden = tagItem.visible === false;
      const rawTag = markRaw(tag);
      group.add(rawTag);
      tagAnnotations.set(tagItem.id, rawTag);
    }
  }

  function renderLaidOutFittings(fittings: MbdLaidOutFittingDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    for (const fittingItem of fittings) {
      const position = toVector3(fittingItem.position);
      if (!position) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          fittingItem.suppressed_reason ?? 'layout_first_invalid_fitting',
        );
        continue;
      }
      const fitting = new WeldAnnotation3D(materials, {
        position,
        label: fittingItem.text,
        subtitle: '',
        isShop: true,
        crossSize: 0,
        labelOffsetWorld: resolveLaidOutLabelOffset(fittingItem.label_offset_world),
        labelRenderStyle,
      });
      const fittingKind = fittingItem.kind === 'branch'
        ? 'branch'
        : fittingItem.kind === 'flange'
          ? 'flange'
          : 'elbow';
      if (fittingKind === 'branch') fitting.setMaterialSet(materials.orange);
      else if (fittingKind === 'flange') fitting.setMaterialSet(materials.blue);
      else fitting.setMaterialSet(materials.yellow);
      (fitting.userData as any).mbdAuxKind = 'fitting';
      (fitting.userData as any).mbdFittingKind = fittingKind;
      (fitting.userData as any).mbdLayoutHidden = fittingItem.visible === false;
      const rawFitting = markRaw(fitting);
      group.add(rawFitting);
      fittingAnnotations.set(fittingItem.id, rawFitting);
    }
  }

  function renderLaidOutBends(bends: MbdLaidOutBendDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    for (const bendItem of bends) {
      if (bendItem.visible === false) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          bendItem.suppressed_reason ?? 'layout_first_hidden_bend',
        );
        continue;
      }
      const members: (LinearDimension3D | AngleDimension3D)[] = [];
      if (bendDisplayMode.value === 'angle' && bendItem.angle) {
        const angle = bendItem.angle;
        const vertex = toVector3(angle.vertex);
        const point1 = toVector3(angle.point1);
        const point2 = toVector3(angle.point2);
        if (vertex && point1 && point2) {
          const angleDim = new AngleDimension3D(materials, {
            vertex,
            point1,
            point2,
            arcRadius: clampNumber(angle.arc_radius, 1, 5000, 120),
            text: angle.text,
            labelT: clamp01(angle.label_t, 0.5),
            labelOffsetWorld: resolveLaidOutLabelOffset(angle.label_offset_world),
            labelRenderStyle,
          });
          angleDim.setMaterialSet(materials.yellow);
          members.push(angleDim);
        }
      } else {
        for (const member of bendItem.size_dims ?? []) {
          const dim = createLaidOutLinearAnnotation(
            member,
            resolveMbdDimensionMaterialSet(materials, 'segment', dimMode.value),
          );
          if (!dim) continue;
          (dim.userData as any).mbdBendId = bendItem.id;
          members.push(dim);
        }
      }
      if (members.length <= 0) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          bendItem.suppressed_reason ?? 'layout_first_empty_bend',
        );
        continue;
      }
      const bendGroup = new BendAnnotationGroup(
        materials,
        bendDisplayMode.value,
        members,
        { depthTest: getRuntimeModeConfig().depthTest },
      );
      bendGroup.userData.pickable = true;
      bendGroup.userData.draggable = true;
      (bendGroup.userData as any).mbdBendId = bendItem.id;
      (bendGroup.userData as any).mbdLayoutHidden = bendItem.visible === false;
      bendGroup.setLabelRenderStyle(labelRenderStyle);
      const rawBendGroup = markRaw(bendGroup);
      group.add(rawBendGroup);
      bendAnnotations.set(bendItem.id, rawBendGroup);
    }
  }

  function rebuildDimsByCurrentData(): void {
    const data = currentData.value;
    if (!data) return;

    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    dimAnnotations.clear();
    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    cutTubiAnnotations.clear();

    applyTagLabelDeclutter();

    const viewer = dtxViewerRef.value;
    if (viewer) applyBackgroundColor(viewer);
    applyVisibility();
    applyLabelVisibility();
    highlightItem(activeItemId.value);
  }

  function rebuildBendsByCurrentData(): void {
    const data = currentData.value;
    if (!data) return;

    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    bendAnnotations.clear();

    const viewer = dtxViewerRef.value;
    if (viewer) applyBackgroundColor(viewer);
    applyVisibility();
    applyLabelVisibility();
    highlightItem(activeItemId.value);
  }

  function renderWelds(welds: MbdWeldDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    const weldMaterial =
      mbdViewMode.value === 'construction' ? materials.black : materials.orange;
    for (const w of welds) {
      const position = new Vector3(w.position[0], w.position[1], w.position[2]);

      const weld = new WeldAnnotation3D(materials, {
        position,
        label: w.label,
        isShop: w.is_shop,
        crossSize: 50, // 世界单位
        labelRenderStyle,
      });

      // 可交互：MBD welds 支持拖拽调整文字位置
      weld.userData.pickable = true;
      weld.userData.draggable = true;
      (weld.userData as any).mbdWeldId = w.id;
      weld.setLabelRenderStyle(labelRenderStyle);

      weld.setMaterialSet(weldMaterial);
      const rawWeld = markRaw(weld);
      group.add(rawWeld);
      weldAnnotations.set(w.id, rawWeld);
    }
  }

  function renderSlopes(slopes: MbdSlopeDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    const slopeMaterial =
      mbdViewMode.value === 'construction' ? materials.black : materials.blue;
    for (const s of slopes) {
      const start = new Vector3(s.start[0], s.start[1], s.start[2]);
      const end = new Vector3(s.end[0], s.end[1], s.end[2]);

      const slope = new SlopeAnnotation3D(materials, {
        start,
        end,
        text: s.text,
        slope: s.slope,
        labelRenderStyle,
      });

      // 可交互：MBD slopes 支持拖拽调整文字位置
      slope.userData.pickable = true;
      slope.userData.draggable = true;
      (slope.userData as any).mbdSlopeId = s.id;
      slope.setLabelRenderStyle(labelRenderStyle);

      slope.setMaterialSet(slopeMaterial);
      const rawSlope = markRaw(slope);
      group.add(rawSlope);
      slopeAnnotations.set(s.id, rawSlope);
    }
  }

  function renderPipeClearances(clearances: MbdPipeClearanceDto[]): void {
    const modeConfig = getRuntimeModeConfig();
    for (const c of clearances) {
      const start = new Vector3(c.start[0], c.start[1], c.start[2]);
      const end = new Vector3(c.end[0], c.end[1], c.end[2]);
      const dist = start.distanceTo(end);
      const offset = computeMbdDimOffset(dist) * 0.5;

      const dim = new LinearDimension3D(
        materials,
        {
          start,
          end,
          offset,
          text: c.text,
          arrowStyle: modeConfig.arrowStyle,
          arrowSizePx: modeConfig.arrowSizePx,
          arrowAngleDeg: modeConfig.arrowAngleDeg,
          extensionOvershootPx: modeConfig.extensionOvershootPx,
          labelRenderStyle: modeConfig.labelRenderStyle,
        },
        { depthTest: modeConfig.depthTest },
      );

      dim.setMaterialSet(materials.orange);
      dim.setLineWidthPx(modeConfig.lineWidthPx);
      dim.userData.pickable = true;
      (dim.userData as any).mbdAuxKind = 'pipe_clearance';
      (dim.userData as any).mbdPipeClearanceId = c.id;
      const rawDim = markRaw(dim);
      group.add(rawDim);
      pipeClearanceAnnotations.set(c.id, rawDim);
    }
  }

  function renderStructureClearances(clearances: MbdStructureClearanceDto[]): void {
    const modeConfig = getRuntimeModeConfig();
    for (const clearance of clearances) {
      const start = toVector3(clearance.anchor_point);
      const end = toVector3(clearance.closest_point);
      if (!start || !end) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          'structure_clearance_invalid_endpoint',
        );
        continue;
      }

      const dist = start.distanceTo(end);
      const dim = new LinearDimension3D(
        materials,
        {
          start,
          end,
          offset: computeMbdDimOffset(dist) * 0.38,
          text: clearance.text,
          arrowStyle: modeConfig.arrowStyle,
          arrowSizePx: modeConfig.arrowSizePx,
          arrowAngleDeg: modeConfig.arrowAngleDeg,
          extensionOvershootPx: modeConfig.extensionOvershootPx,
          labelRenderStyle: modeConfig.labelRenderStyle,
        },
        { depthTest: modeConfig.depthTest },
      );
      dim.setMaterialSet(materials.yellow);
      dim.setLineWidthPx(modeConfig.lineWidthPx);
      dim.userData.pickable = true;
      (dim.userData as any).mbdAuxKind = 'structure_clearance';
      (dim.userData as any).mbdStructureClearanceId = clearance.id;
      const rawDim = markRaw(dim);
      group.add(rawDim);
      structureClearanceAnnotations.set(clearance.id, rawDim);
    }
  }

  function renderElevationMarks(marks: MbdElevationMarkDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    for (const mark of marks) {
      const position = toVector3(mark.point);
      if (!position) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          'elevation_mark_invalid_point',
        );
        continue;
      }
      const annotation = new WeldAnnotation3D(materials, {
        position,
        label: mark.text,
        subtitle: mark.role ?? '',
        isShop: true,
        crossSize: 0,
        labelOffsetWorld:
          resolveFloatingLabelOffset(mark.layout_hint, 96)
          ?? new Vector3(0, 120, 80),
        labelRenderStyle,
      });
      annotation.setMaterialSet(materials.blue);
      annotation.userData.pickable = true;
      (annotation.userData as any).mbdAuxKind = 'elevation';
      (annotation.userData as any).mbdElevationId = mark.id;
      const rawAnnotation = markRaw(annotation);
      group.add(rawAnnotation);
      elevationAnnotations.set(mark.id, rawAnnotation);
    }
  }

  function buildEnvelopeEdgePositions(envelope: MbdPipeEnvelopeDto): Float32Array {
    const [minX, minY, minZ] = envelope.min;
    const [maxX, maxY, maxZ] = envelope.max;
    return new Float32Array([
      minX, minY, minZ, maxX, minY, minZ,
      minX, maxY, minZ, maxX, maxY, minZ,
      minX, minY, maxZ, maxX, minY, maxZ,
      minX, maxY, maxZ, maxX, maxY, maxZ,
      minX, minY, minZ, minX, maxY, minZ,
      maxX, minY, minZ, maxX, maxY, minZ,
      minX, minY, maxZ, minX, maxY, maxZ,
      maxX, minY, maxZ, maxX, maxY, maxZ,
      minX, minY, minZ, minX, minY, maxZ,
      maxX, minY, minZ, maxX, minY, maxZ,
      minX, maxY, minZ, minX, maxY, maxZ,
      maxX, maxY, minZ, maxX, maxY, maxZ,
    ]);
  }

  function renderEnvelope(envelope: MbdPipeEnvelopeDto | null): void {
    if (!envelope) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(buildEnvelopeEdgePositions(envelope), 3),
    );
    const lines = new LineSegments(geometry, envelopeMaterial);
    lines.name = `mbd-envelope:${envelope.id}`;
    lines.userData.pickable = true;
    (lines.userData as any).mbdAuxKind = 'envelope';
    (lines.userData as any).mbdEnvelopeId = envelope.id;
    const rawLines = markRaw(lines);
    group.add(rawLines);
    envelopeObjects.set(envelope.id, rawLines);
  }

  function renderCutTubis(
    cutTubis: MbdCutTubiDto[],
    segments: MbdPipeSegmentDto[],
    pipeOffsetDirs: Vector3[],
  ): void {
    const viewer = dtxViewerRef.value;
    const gm = getGlobalModelMatrix?.() || identityMatrix;
    const modeConfig = getRuntimeModeConfig();
    for (const cutTubi of cutTubis) {
      const start = toVector3(cutTubi.start);
      const end = toVector3(cutTubi.end);
      if (!start || !end) {
        recordSuppressedAnnotation(suppressedWrongLineCount, 'cut_tubi_invalid_endpoint');
        continue;
      }

      const baseOffset = resolveFallbackBaseOffset(
        'cut_tubi',
        start,
        end,
        cutTubi.layout_hint,
        segments,
      );
      const branchLayout = resolveBranchLayout({
        start,
        end,
        role: 'cut_tubi',
        hint: cutTubi.layout_hint,
        segments,
        pipeOffsetDirs,
        baseOffset,
        baseOffsetScale: dimOffsetScale.value,
      });
      const direction =
        branchLayout.direction ??
        computeDimensionOffsetDirInLocal(
          start,
          end,
          viewer?.camera ?? null,
          gm,
        );
      if (!direction || direction.lengthSq() < 1e-9) {
        recordSuppressedAnnotation(suppressedWrongLineCount, 'cut_tubi_invalid_direction');
        continue;
      }

      const label = String(
        cutTubi.text ?? cutTubi.refno ?? 'CUT',
      );
      const finalCutOffset = branchLayout.offset;
      const dim = new LinearDimension3D(
        materials,
        {
          start,
          end,
          offset: finalCutOffset,
          labelT: 0.5,
          labelOffsetWorld: null,
          text: label,
          direction,
          arrowStyle: modeConfig.arrowStyle,
          arrowSizePx: modeConfig.arrowSizePx,
          arrowAngleDeg: modeConfig.arrowAngleDeg,
          extensionOvershootPx: modeConfig.extensionOvershootPx,
          labelRenderStyle: modeConfig.labelRenderStyle,
        },
        {
          depthTest: modeConfig.depthTest,
        },
      );
      dim.setMaterialSet(materials.black);
      dim.setLineWidthPx(modeConfig.lineWidthPx);
      const rawDim = markRaw(dim);
      (rawDim.userData as any).mbdAuxKind = 'cut_tubi';
      (rawDim.userData as any).mbdBaseOffset = finalCutOffset;
      (rawDim.userData as any).mbdLayoutResolution = {
        lane: branchLayout.lane,
        source: branchLayout.source,
        offset: finalCutOffset,
        normalizedHint: branchLayout.normalizedHint,
      };
      group.add(rawDim);
      cutTubiAnnotations.set(cutTubi.id, rawDim);
    }
  }

  function renderTags(tags: MbdTagDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    const data = currentData.value;
    for (const tag of tags) {
      if (data && shouldSuppressTag(tag, data)) {
        continue;
      }
      const anchor =
        toVector3(tag.position) ??
        toVector3(tag.layout_hint?.anchor_point ?? null);
      if (!anchor) {
        recordSuppressedAnnotation(suppressedWrongLineCount, 'tag_missing_anchor');
        continue;
      }
      const annotation = new WeldAnnotation3D(materials, {
        position: anchor,
        label: tag.text,
        subtitle: '',
        isShop: true,
        crossSize: 0,
        labelOffsetWorld: resolveFloatingLabelOffset(tag.layout_hint, 120),
        labelRenderStyle,
      });
      annotation.setMaterialSet(materials.black);
      const rawTag = markRaw(annotation);
      (rawTag.userData as any).mbdAuxKind = 'tag';
      (rawTag.userData as any).mbdTagKind = classifyTag(tag);
      (rawTag.userData as any).mbdLayoutHint = tag.layout_hint ?? null;
      (rawTag.userData as any).mbdLayoutResolution = resolveBranchLayout({
        start: anchor,
        end:
          anchor.clone().add(
            normalizeMbdLayoutHint(tag.layout_hint).primaryAxis?.clone()
            ?? new Vector3(1, 0, 0),
          ),
        role: 'segment',
        hint: tag.layout_hint,
      });
      const baseLabelOffset = annotation.getParams().labelOffsetWorld;
      (rawTag.userData as any).mbdBaseLabelOffset = baseLabelOffset
        ? [baseLabelOffset.x, baseLabelOffset.y, baseLabelOffset.z]
        : null;
      group.add(rawTag);
      tagAnnotations.set(tag.id, rawTag);
    }
  }

  function buildBendSizeDimensions(
    bend: MbdBendDto,
    workPoint: Vector3,
    point1: Vector3,
    point2: Vector3,
    segments: MbdPipeSegmentDto[],
    pipeOffsetDirs: Vector3[],
  ): LinearDimension3D[] {
    const viewer = dtxViewerRef.value;
    const gm = getGlobalModelMatrix?.() || identityMatrix;
    const modeConfig = getRuntimeModeConfig();
    const bendCandidates = collectBendEndpointCandidatesFromSegments(
      workPoint,
      segments,
    );
    const materialSet = resolveMbdDimensionMaterialSet(
      materials,
      'segment',
      dimMode.value,
    );
    const resolveBendText = (start: Vector3, end: Vector3): string => {
      if (dimTextMode.value === 'backend') {
        return String(Math.round(start.distanceTo(end)));
      }
      return resolveDimDisplayText(
        '',
        false,
        start,
        end,
        gm,
        unitSettings.displayUnit.value,
        unitSettings.precision.value,
      );
    };

    const buildDirection = (start: Vector3, end: Vector3): Vector3 => {
      const resolved = computeDimensionOffsetDirInLocal(
        start,
        end,
        viewer?.camera ?? null,
        gm,
      );
      if (resolved && resolved.lengthSq() >= 1e-9) return resolved.normalize();
      const axial = end.clone().sub(start).normalize();
      const fallback = Math.abs(axial.z) < 0.95
        ? new Vector3(0, 0, 1).cross(axial)
        : new Vector3(0, 1, 0).cross(axial);
      if (fallback.lengthSq() < 1e-9) fallback.set(1, 0, 0);
      return fallback.normalize();
    };

    const buildLinearDim = (target: Vector3): LinearDimension3D => {
      const distance = workPoint.distanceTo(target);
      const ownerCandidate = resolveBendEndpointCandidate(
        workPoint,
        target,
        bendCandidates,
      );
      const baseOffset = resolveBendSizeOffset(
        ownerCandidate,
        segments,
        dimOffsetScale.value,
      ) ?? resolveSemanticDimOffset(
        computeMbdDimOffset(distance) *
        clampNumber(dimOffsetScale.value, 0.05, 50, 1),
        'segment',
      );
      const dim = new LinearDimension3D(
        materials,
        {
          start: workPoint,
          end: target,
          // 与直段尺寸保持同一偏移标尺，避免长段弯头被硬上限压扁导致不对齐。
          offset: clampNumber(baseOffset, 1, 5000, 90),
          labelT: 0.72,
          labelOffsetWorld: null,
          text: resolveBendText(workPoint, target),
          direction:
            resolveBendSizeDirection(
              workPoint,
              target,
              ownerCandidate,
              pipeOffsetDirs,
            ) ?? buildDirection(workPoint, target),
          arrowStyle: modeConfig.arrowStyle,
          arrowSizePx: modeConfig.arrowSizePx,
          arrowAngleDeg: modeConfig.arrowAngleDeg,
          extensionOvershootPx: modeConfig.extensionOvershootPx,
          labelRenderStyle: modeConfig.labelRenderStyle,
        },
        {
          depthTest: modeConfig.depthTest,
        },
      );
      dim.setMaterialSet(materialSet);
      dim.setLineWidthPx(modeConfig.lineWidthPx);
      (dim.userData as any).mbdBendId = bend.id;
      return dim;
    };

    return [buildLinearDim(point1), buildLinearDim(point2)];
  }

  function renderBends(
    bends: MbdBendDto[],
    segments: MbdPipeSegmentDto[],
  ): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    const pipeOffsetDirs = segments.length
      ? computePipeAlignedOffsetDirs(segments)
      : [];
    let skippedMissingFaceCenter = 0;
    let inferredFaceCenterCount = 0;
    for (const b of bends) {
      const wp = new Vector3(b.work_point[0], b.work_point[1], b.work_point[2]);
      const resolvedPoints = resolveBendPortPoints(b, segments);
      const p1 = resolvedPoints?.point1 ?? null;
      const p2 = resolvedPoints?.point2 ?? null;

      // face_center 缺失时尝试从相邻管段推导；仍缺失则跳过。
      if (!p1 || !p2) {
        skippedMissingFaceCenter += 1;
        continue;
      }
      if (resolvedPoints?.inferred) {
        inferredFaceCenterCount += 1;
      }

      const members: BendAnnotationMember[] = [];
      if (bendDisplayMode.value === 'angle') {
        const angleText = b.angle != null ? `${b.angle.toFixed(1)}°` : '';
        const inferredRadius = Math.min(wp.distanceTo(p1), wp.distanceTo(p2)) * 0.55;
        const arcRadius = clampNumber(b.radius ?? inferredRadius, 20, 5000, 120);

        const angleDim = new AngleDimension3D(materials, {
          vertex: wp,
          point1: p1,
          point2: p2,
          arcRadius,
          text: angleText,
          labelRenderStyle,
        });
        angleDim.setMaterialSet(materials.yellow);
        angleDim.setLabelRenderStyle(labelRenderStyle);
        members.push(angleDim);
      } else {
        members.push(
          ...buildBendSizeDimensions(
            b,
            wp,
            p1,
            p2,
            segments,
            pipeOffsetDirs,
          ),
        );
      }

      const bendGroup = new BendAnnotationGroup(
        materials,
        bendDisplayMode.value,
        members,
        { depthTest: getRuntimeModeConfig().depthTest },
      );
      bendGroup.userData.pickable = true;
      bendGroup.userData.draggable = true;
      (bendGroup.userData as any).mbdBendId = b.id;
      bendGroup.setLabelRenderStyle(labelRenderStyle);
      const rawBendGroup = markRaw(bendGroup);
      group.add(rawBendGroup);
      bendAnnotations.set(b.id, rawBendGroup);
    }
    if (isDev && bends.length > 0) {
      const rendered = bends.length - skippedMissingFaceCenter;
      // 帮助联调定位“统计里有 bends 但场景没渲染”的来源。
      console.info('[mbd-bends] render stats', {
        total: bends.length,
        rendered,
        inferredFaceCenterCount,
        skippedMissingFaceCenter,
      });
    }
  }

  function renderSegments(segments: MbdPipeSegmentDto[]): void {
    for (const s of segments) {
      if (!s.arrive || !s.leave) continue;
      const geom = new BufferGeometry();
      const pos = new Float32Array([
        s.arrive[0],
        s.arrive[1],
        s.arrive[2],
        s.leave[0],
        s.leave[1],
        s.leave[2],
      ]);
      geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
      const line = new Line(geom, segmentMaterial);
      line.name = `mbd-seg:${s.id}`;
      const rawLine = markRaw(line);
      group.add(rawLine);
      segmentLines.set(s.id, rawLine);
    }
  }

  function renderV2LeaderLines(leaders: MbdV2LeaderLinePrimitive[]): void {
    for (const leader of leaders) {
      const points = (leader.points ?? [])
        .map((point) => toVector3(point))
        .filter((point): point is Vector3 => !!point);
      if (points.length < 2) continue;

      const geom = new BufferGeometry();
      const pos = new Float32Array(points.length * 3);
      points.forEach((point, index) => {
        pos[index * 3] = point.x;
        pos[index * 3 + 1] = point.y;
        pos[index * 3 + 2] = point.z;
      });
      geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
      const line = new Line(geom, v2LeaderLineMaterial);
      line.name = `mbd-v2-leader:${leader.id}`;
      (line.userData as any).mbdAuxKind = 'v2_leader_line';
      (line.userData as any).mbdLeaderId = leader.id;
      const rawLine = markRaw(line);
      group.add(rawLine);
      v2LeaderLines.set(leader.id, rawLine);
    }
  }

  function createDebugAnchorMarker(
    id: string,
    point: Vector3,
    size = 40,
  ): LineSegments {
    const geom = new BufferGeometry();
    const points = new Float32Array([
      point.x - size, point.y, point.z,
      point.x + size, point.y, point.z,
      point.x, point.y - size, point.z,
      point.x, point.y + size, point.z,
      point.x, point.y, point.z - size,
      point.x, point.y, point.z + size,
    ]);
    geom.setAttribute('position', new Float32BufferAttribute(points, 3));
    const marker = new LineSegments(geom, anchorDebugMaterial);
    marker.name = `mbd-debug-anchor:${id}`;
    (marker.userData as any).mbdAuxKind = 'debug-anchor';
    (marker.userData as any).mbdDebugId = id;
    const rawMarker = markRaw(marker);
    group.add(rawMarker);
    anchorDebugMarkers.set(id, rawMarker);
    return rawMarker;
  }

  function createOwnerSegmentDebugLine(segment: MbdPipeSegmentDto): Line | null {
    if (!segment.arrive || !segment.leave) return null;
    const geom = new BufferGeometry();
    const pos = new Float32Array([
      segment.arrive[0],
      segment.arrive[1],
      segment.arrive[2],
      segment.leave[0],
      segment.leave[1],
      segment.leave[2],
    ]);
    geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const line = new Line(geom, ownerSegmentDebugMaterial);
    line.name = `mbd-debug-owner:${segment.id}`;
    (line.userData as any).mbdAuxKind = 'debug-owner-segment';
    (line.userData as any).mbdDebugId = segment.id;
    const rawLine = markRaw(line);
    group.add(rawLine);
    ownerSegmentDebugLines.set(segment.id, rawLine);
    return rawLine;
  }

  function renderDebugOverlays(data: MbdPipeData): void {
    const ownerSegments = new Set<string>();
    const anchorEntries: { id: string; point: ApiVec3 | null | undefined }[] = [];

    const collectOwnerAndAnchor = (
      id: string,
      hint?: MbdLayoutHint | null,
    ) => {
      if (hint?.anchor_point) {
        anchorEntries.push({ id, point: hint.anchor_point });
      }
      if (hint?.owner_segment_id) {
        ownerSegments.add(hint.owner_segment_id);
      }
    };

    for (const dim of data.dims || []) collectOwnerAndAnchor(dim.id, dim.layout_hint);
    for (const weld of data.welds || []) collectOwnerAndAnchor(weld.id, weld.layout_hint);
    for (const cut of data.cut_tubis || []) collectOwnerAndAnchor(cut.id, cut.layout_hint);
    for (const fitting of data.fittings || []) {
      collectOwnerAndAnchor(fitting.id, fitting.layout_hint);
      anchorEntries.push({ id: fitting.id, point: fitting.anchor_point });
    }
    for (const tag of data.tags || []) {
      collectOwnerAndAnchor(tag.id, tag.layout_hint);
      anchorEntries.push({ id: tag.id, point: tag.position });
    }

    const seenAnchorIds = new Set<string>();
    for (const entry of anchorEntries) {
      if (seenAnchorIds.has(entry.id)) continue;
      seenAnchorIds.add(entry.id);
      const point = toVector3(entry.point ?? null);
      if (!point) continue;
      createDebugAnchorMarker(entry.id, point);
    }

    const segmentById = new Map(
      (data.segments || []).map((segment) => [segment.id, segment] as const),
    );
    for (const segmentId of ownerSegments) {
      const segment = segmentById.get(segmentId);
      if (!segment) continue;
      createOwnerSegmentDebugLine(segment);
    }
  }

  function renderBranch(data: MbdPipeData): void {
    const viewer = dtxViewerRef.value;
    if (!viewer) return;

    ensureGroupAttached();
    clearAll();

    currentData.value = data;
    isVisible.value = true;
    suppressedWrongLineCount.value = 0;

    // 应用全局模型矩阵
    const gm = getGlobalModelMatrix?.() || identityMatrix;
    group.matrix.copy(gm);
    group.updateMatrixWorld(true);

    // 更新材质分辨率
    const rect = viewer.canvas.getBoundingClientRect();
    setResolution(rect.width, rect.height);

    const effectiveElevationMarks = resolveEffectiveElevationMarks(data);
    const effectiveEnvelope = resolveEffectiveEnvelope(data);
    const useLayoutResult = shouldUseLayoutFirstResult(mbdViewMode.value, data);
    renderSource.value = useLayoutResult ? 'layout_result' : 'fallback';

    // 渲染各类标注
    if (useLayoutResult) {
      renderLaidOutLinearDims(data.layout_result.linear_dims ?? []);
      if (data.layout_result.welds?.length) renderLaidOutWelds(data.layout_result.welds);
      if (data.layout_result.slopes?.length) renderLaidOutSlopes(data.layout_result.slopes);
      if (data.pipe_clearances?.length) renderPipeClearances(data.pipe_clearances);
      if (data.structure_clearances?.length) {
        renderStructureClearances(data.structure_clearances);
      }
      if (data.layout_result.bends?.length) renderLaidOutBends(data.layout_result.bends);
      if (data.layout_result.cut_tubis?.length) {
        renderLaidOutCutTubis(data.layout_result.cut_tubis);
      }
      if (data.layout_result.fittings?.length) {
        renderLaidOutFittings(data.layout_result.fittings);
      }
      if (data.layout_result.tags?.length) renderLaidOutTags(data.layout_result.tags);
      applyLaidOutDimLabelDeclutter();
    } else {
      if (mbdViewMode.value === 'layout_first') {
        console.info('[mbd-layout-first] 缺少 layout_result，已回退到旧渲染路径', {
          branch_refno: data.branch_refno,
        });
      }
      const pipeOffsetDirs = data.segments?.length
        ? computePipeAlignedOffsetDirs(data.segments)
        : [];
      if (data.welds?.length) renderWelds(data.welds);
      if (data.slopes?.length) renderSlopes(data.slopes);
      if (data.pipe_clearances?.length) renderPipeClearances(data.pipe_clearances);
      if (data.structure_clearances?.length) {
        renderStructureClearances(data.structure_clearances);
      }
      if (data.fittings?.length) renderFittings(data.fittings);
      if (data.tags?.length) renderTags(data.tags);
      applyTagLabelDeclutter();
      if (effectiveElevationMarks.length > 0) renderElevationMarks(effectiveElevationMarks);
      renderEnvelope(effectiveEnvelope);
    }
    if (data.v2_leader_lines?.length) renderV2LeaderLines(data.v2_leader_lines);
    if (data.segments?.length) renderSegments(data.segments);
    renderDebugOverlays(data);

    // Set text background occlusion color to match scene background
    applyBackgroundColor(viewer);

    highlightItem(null);
    applyVisibility();
    applyLabelVisibility();
    requestRender?.();
  }

  function renderDemoDims(): void {
    const data: MbdPipeData = {
      input_refno: 'demo-input',
      branch_refno: 'demo-branch',
      branch_name: 'Demo Branch',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        // 1. 正常长管段
        {
          id: 'dim-normal',
          kind: 'segment',
          start: [0, 0, 0],
          end: [2.0, 0, 0],
          length: 2.0,
          text: '2000',
        },
        // 2. 稍短管段
        {
          id: 'dim-short-1',
          kind: 'segment',
          start: [2.0, 0, 0],
          end: [2.5, 0, 0],
          length: 0.5,
          text: '500',
        },
        // 3. 极短管段 (触发自动箭头外置翻转)
        {
          id: 'dim-short-2',
          kind: 'segment',
          start: [2.5, 0, 0],
          end: [2.6, 0, 0],
          length: 0.1,
          text: '100',
        },
        // 4. 重叠密集极短管段连段
        {
          id: 'dim-short-3',
          kind: 'segment',
          start: [2.6, 0, 0],
          end: [2.65, 0, 0],
          length: 0.05,
          text: '50',
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 4,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };
    renderBranch(data);
  }

  function flyTo(): void {
    const viewer = dtxViewerRef.value;
    if (!viewer) return;
    const data = currentData.value;
    if (!data) return;

    // 与渲染侧保持一致：后端坐标为“原始坐标”，需应用全局模型矩阵（mm->m / recenter 等）
    const gm = getGlobalModelMatrix?.() || identityMatrix;

    const box = new Box3();
    let hasAny = false;
    const tmp = new Vector3();
    const expand = (p: ApiVec3) => {
      tmp.set(p[0], p[1], p[2]).applyMatrix4(gm);
      box.expandByPoint(tmp);
      hasAny = true;
    };

    for (const d of data.dims || []) {
      expand(d.start);
      expand(d.end);
    }
    for (const d of data.layout_result?.linear_dims || []) {
      expand(d.start);
      expand(d.end);
      if (d.dim_line_start) expand(d.dim_line_start);
      if (d.dim_line_end) expand(d.dim_line_end);
      if (d.extension_line_1_start) expand(d.extension_line_1_start);
      if (d.extension_line_1_end) expand(d.extension_line_1_end);
      if (d.extension_line_2_start) expand(d.extension_line_2_start);
      if (d.extension_line_2_end) expand(d.extension_line_2_end);
      if (d.text_anchor) expand(d.text_anchor);
      for (const arrow of d.backend_arrows ?? []) {
        expand(arrow.position);
      }
    }
    for (const d of data.layout_result?.cut_tubis || []) {
      expand(d.start);
      expand(d.end);
      if (d.dim_line_start) expand(d.dim_line_start);
      if (d.dim_line_end) expand(d.dim_line_end);
      if (d.extension_line_1_start) expand(d.extension_line_1_start);
      if (d.extension_line_1_end) expand(d.extension_line_1_end);
      if (d.extension_line_2_start) expand(d.extension_line_2_start);
      if (d.extension_line_2_end) expand(d.extension_line_2_end);
      if (d.text_anchor) expand(d.text_anchor);
      for (const arrow of d.backend_arrows ?? []) {
        expand(arrow.position);
      }
    }
    for (const w of data.welds || []) expand(w.position);
    for (const s of data.slopes || []) {
      expand(s.start);
      expand(s.end);
    }
    for (const b of data.bends || []) {
      expand(b.work_point);
      if (b.face_center_1) expand(b.face_center_1);
      if (b.face_center_2) expand(b.face_center_2);
    }
    for (const cutTubi of data.cut_tubis || []) {
      expand(cutTubi.start);
      expand(cutTubi.end);
      if (cutTubi.layout_hint?.anchor_point) expand(cutTubi.layout_hint.anchor_point);
    }
    for (const fitting of data.fittings || []) {
      expand(fitting.anchor_point);
      if (fitting.face_center_1) expand(fitting.face_center_1);
      if (fitting.face_center_2) expand(fitting.face_center_2);
      if (fitting.layout_hint?.anchor_point) expand(fitting.layout_hint.anchor_point);
    }
    for (const tag of data.tags || []) {
      expand(tag.position);
      if (tag.layout_hint?.anchor_point) expand(tag.layout_hint.anchor_point);
    }
    for (const leader of data.v2_leader_lines || []) {
      for (const point of leader.points || []) {
        expand(point);
      }
    }
    for (const seg of data.segments || []) {
      if (seg.arrive) expand(seg.arrive);
      if (seg.leave) expand(seg.leave);
    }
    if (!hasAny || box.isEmpty()) return;

    const size = new Vector3();
    box.getSize(size);
    const pad = Math.max(2, (size.x + size.y + size.z) * 0.2);
    box.expandByScalar(pad);

    const { position, target } = computeFlyToPositionFromBox(box);
    viewer.flyTo(position, target, { duration: 800 });
    window.setTimeout(() => {
      applyLaidOutDimLabelDeclutter();
      updateLabelPositions();
      requestRender?.();
    }, 900);
  }

  function updateLabelPositions(): void {
    const viewer = dtxViewerRef.value;
    if (!viewer || !isVisible.value) return;

    // 若全局模型矩阵在运行期变化（例如单位/重心配置），需要保持标注组与之同步。
    const gm = getGlobalModelMatrix?.() || identityMatrix;
    group.matrix.copy(gm);
    group.updateMatrixWorld(true);

    // 更新所有标注
    const camera = viewer.camera;
    const rect = viewer.canvas.getBoundingClientRect();
    (camera as any).userData.annotationViewport = {
      width: rect.width,
      height: rect.height,
    };
    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of cutTubiAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of weldAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of slopeAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of fittingAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of tagAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of structureClearanceAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
    for (const annotation of elevationAnnotations.values()) {
      asRaw(annotation).update(camera);
    }
  }

  function renderLabels(scene: Scene, camera: Camera): void {
    void scene;
    void camera;
  }

  function setResolution(width: number, height: number): void {
    materials.setResolution(width, height);
    legacyCss2dRenderer?.setSize(width, height);
  }

  /** Session-only：更新指定 MBD dim 的交互调整并即时刷新 3D 标注 */
  function updateDimOverride(
    dimId: string,
    patch: Partial<MbdDimOverride>,
  ): void {
    const existing = dimOverrides.get(dimId) ?? {};
    const merged = { ...existing, ...patch };
    dimOverrides.set(dimId, merged);

    // 即时更新已渲染的标注（避免重建全部）
    const dim = dimAnnotations.get(dimId);
    if (dim) {
      const rawDim = asRaw(dim);
      const p: any = {};
      if (merged.offset !== undefined) p.offset = merged.offset;
      if (merged.direction)
        p.direction = new Vector3(
          merged.direction[0],
          merged.direction[1],
          merged.direction[2],
        );
      if (merged.labelT !== undefined) p.labelT = merged.labelT;
      if ('labelOffsetWorld' in merged) {
        p.labelOffsetWorld = merged.labelOffsetWorld
          ? new Vector3(
            merged.labelOffsetWorld[0],
            merged.labelOffsetWorld[1],
            merged.labelOffsetWorld[2],
          )
          : null;
      }
      if (merged.isReference !== undefined) p.isReference = merged.isReference;
      rawDim.setParams(p);
    }
    requestRender?.();
  }

  /** Session-only：重置指定 MBD dim 的交互调整 */
  function resetDimOverride(dimId: string): void {
    dimOverrides.delete(dimId);
    if (dimAnnotations.has(dimId)) {
      rebuildDimsByCurrentData();
    }
    requestRender?.();
  }

  /** 获取 dim annotations map（用于外部将 MBD dims 注册到交互控制器） */
  function getDimAnnotations(): Map<string, LinearDimension3D> {
    return dimAnnotations;
  }

  /** 获取 weld annotations map（用于外部将 MBD welds 注册到交互控制器） */
  function getWeldAnnotations(): Map<string, WeldAnnotation3D> {
    return weldAnnotations;
  }

  /** 获取 slope annotations map（用于外部将 MBD slopes 注册到交互控制器） */
  function getSlopeAnnotations(): Map<string, SlopeAnnotation3D> {
    return slopeAnnotations;
  }

  /** 获取 bend annotations map（用于外部将 MBD bends 注册到交互控制器） */
  function getBendAnnotations(): Map<string, BendAnnotationGroup> {
    return bendAnnotations;
  }

  /** 获取 tag annotations map（用于调试与测试） */
  function getTagAnnotations(): Map<string, WeldAnnotation3D> {
    return tagAnnotations;
  }

  /** 获取 cut tubi annotations map（用于调试与测试） */
  function getCutTubiAnnotations(): Map<string, LinearDimension3D> {
    return cutTubiAnnotations;
  }

  function getPipeClearanceAnnotations(): Map<string, LinearDimension3D> {
    return pipeClearanceAnnotations;
  }

  function getStructureClearanceAnnotations(): Map<string, LinearDimension3D> {
    return structureClearanceAnnotations;
  }

  function getElevationAnnotations(): Map<string, WeldAnnotation3D> {
    return elevationAnnotations;
  }

  function getEnvelopeObjects(): Map<string, LineSegments> {
    return envelopeObjects;
  }

  function resolveElevationMarks(data: MbdPipeData | null = currentData.value): MbdElevationMarkDto[] {
    return resolveEffectiveElevationMarks(data);
  }

  function resolveEnvelopeData(data: MbdPipeData | null = currentData.value): MbdPipeEnvelopeDto | null {
    return resolveEffectiveEnvelope(data);
  }

  function dispose(): void {
    clearAll();
    legacyCss2dRenderer?.domElement.remove();
    legacyCss2dRenderer = null;
    materials.dispose();
    segmentMaterial.dispose();
    segmentHighlightMaterial.dispose();
    anchorDebugMaterial.dispose();
    ownerSegmentDebugMaterial.dispose();
    envelopeMaterial.dispose();
    envelopeHighlightMaterial.dispose();
    v2LeaderLineMaterial.dispose();
    group.removeFromParent();
  }

  // 监听可见性变化
  watch(
    [
      isVisible,
      showDims,
      showDimSegment,
      showDimChain,
      showDimOverall,
      showDimPort,
      showPipeClearances,
      showStructureClearances,
      showElevationMarks,
      showEnvelope,
      showCutTubis,
      showElbows,
      showBranches,
      showFlanges,
      showAnchorDebug,
      showOwnerSegmentDebug,
      showWelds,
      showSlopes,
      showBends,
      showSegments,
      showLabels,
    ],
    () => {
      try {
        applyPortDimLabelDeclutter();
        applyVisibility();
        applyCutTubiLabelDeclutter();
        applyTagLabelDeclutter();
        applyCutTubiLabelDeclutter(true);
        applyLabelVisibility();
      } catch {
        // 避免在测试环境中因 Proxy 包装 three 对象导致的可见性回放异常中断主流程
      }
      requestRender?.();
    },
  );

  // 监听尺寸显示配置变化（文字/偏移/标签位置/单位精度）
  watch(
    [
      dimTextMode,
      dimOffsetScale,
      dimLabelT,
      bendDisplayMode,
      rebarvizArrowStyle,
      rebarvizArrowSizePx,
      rebarvizArrowAngleDeg,
      rebarvizLineWidthPx,
      () => unitSettings.displayUnit.value,
      () => unitSettings.precision.value,
    ],
    () => {
      if (dimAnnotations.size === 0 && bendAnnotations.size === 0) return;

      try {
        if (dimAnnotations.size > 0) {
          const data = currentData.value;
          const gm = getGlobalModelMatrix?.() || identityMatrix;
          const useBackendText = dimTextMode.value === 'backend';
          const offsetScale = clampNumber(dimOffsetScale.value, 0.05, 50, 1);
          const modeConfig = getRuntimeModeConfig();

          const layoutDims = data?.layout_result?.linear_dims;
          const layoutCutTubis = data?.layout_result?.cut_tubis;
          const useLayoutResult = shouldUseLayoutFirstResult(
            mbdViewMode.value,
            data!,
          );
          const segments = data?.segments ?? [];
          const pipeOffsetDirs = segments.length
            ? computePipeAlignedOffsetDirs(segments)
            : [];

          for (const [dimId, dim] of dimAnnotations.entries()) {
            const rawDim = asRaw(dim);
            if (isBackendDerivedAnnotation(rawDim)) {
              rawDim.setParams({
                arrowStyle: modeConfig.arrowStyle,
                arrowSizePx: modeConfig.arrowSizePx,
                arrowAngleDeg: modeConfig.arrowAngleDeg,
                extensionOvershootPx: modeConfig.extensionOvershootPx,
              });
              rawDim.setLineWidthPx(modeConfig.lineWidthPx);
              continue;
            }
            const ov = dimOverrides.get(dimId) ?? {};
            const sourceDim = data?.dims?.find((item) => item.id === dimId) ?? null;
            const laidOutDim = useLayoutResult
              ? (layoutDims?.find((item) => item.id === dimId)
                ?? layoutCutTubis?.find((item) => item.id === dimId)
                ?? null)
              : null;
            const kind = (((rawDim.userData as any)?.mbdDimKind ??
              sourceDim?.kind ??
              'segment') as MbdDimKind);

            const p = rawDim.getParams();
            const baseOffset = laidOutDim
              ? laidOutDim.offset * offsetScale
              : resolveBranchLayout({
                start: p.start,
                end: p.end,
                role: kind,
                hint: sourceDim?.layout_hint,
                segments,
                pipeOffsetDirs,
                baseOffset: resolveFallbackBaseOffset(
                  kind,
                  p.start,
                  p.end,
                  sourceDim?.layout_hint,
                  segments,
                ),
                baseOffsetScale: offsetScale,
              }).offset;
            const nextOffset = ov.offset ?? baseOffset;
            const nextLabelOffset =
              'labelOffsetWorld' in ov
                ? ov.labelOffsetWorld
                  ? new Vector3(
                    ov.labelOffsetWorld[0],
                    ov.labelOffsetWorld[1],
                    ov.labelOffsetWorld[2],
                  )
                  : null
                : null;
            const hasManualLabel =
              'labelOffsetWorld' in ov && ov.labelOffsetWorld != null;
            const nextLabelT =
              ov.labelT ??
              (hasManualLabel ? (p.labelT ?? 0.5) : 0.5);

            const nextText = resolveDimDisplayText(
              dimTextById.value.get(dimId),
              useBackendText,
              p.start,
              p.end,
              gm,
              unitSettings.displayUnit.value,
              unitSettings.precision.value,
            );

            rawDim.setParams({
              offset: nextOffset,
              labelT: nextLabelT,
              labelOffsetWorld: nextLabelOffset,
              text: nextText,
              arrowStyle: modeConfig.arrowStyle,
              arrowSizePx: modeConfig.arrowSizePx,
              arrowAngleDeg: modeConfig.arrowAngleDeg,
              extensionOvershootPx: modeConfig.extensionOvershootPx,
            });
            rawDim.setLineWidthPx(modeConfig.lineWidthPx);
          }
          applyPortDimLabelDeclutter();
          applyVisibility();
          applyCutTubiLabelDeclutter();
          applyTagLabelDeclutter();
          applyCutTubiLabelDeclutter(true);
          applyLabelVisibility();
        }
        if (bendAnnotations.size > 0) {
          rebuildBendsByCurrentData();
        }
      } catch {
        // ignore
      }

      requestRender?.();
    },
  );

  watch(dimMode, () => {
    try {
      rebuildDimsByCurrentData();
      rebuildBendsByCurrentData();
      applyLabelRenderStyleByMode();
      applyLabelVisibility();
    } catch {
      // ignore
    }
    requestRender?.();
  });

  // 监听 viewer 变化
  watch(dtxViewerRef, (viewer, prev) => {
    if (prev && !viewer) {
      clearAll();
    }
    // 更新分辨率
    if (viewer) {
      const rect = viewer.canvas.getBoundingClientRect();
      materials.setResolution(rect.width, rect.height);
    }
  });

  return {
    uiTab,
    mbdViewMode,
    renderSource,
    dimTextMode,
    dimOffsetScale,
    dimLabelT,
    dimMode,
    bendDisplayMode,
    rebarvizArrowStyle,
    rebarvizArrowSizePx,
    rebarvizArrowAngleDeg,
    rebarvizLineWidthPx,
    isVisible,
    showDims,
    showDimSegment,
    showDimChain,
    showDimOverall,
    showDimPort,
    showPipeClearances,
    showStructureClearances,
    showElevationMarks,
    showEnvelope,
    showCutTubis,
    showElbows,
    showBranches,
    showFlanges,
    showAnchorDebug,
    showOwnerSegmentDebug,
    suppressedWrongLineCount,
    showWelds,
    showSlopes,
    showBends,
    showSegments,
    showLabels,
    currentData,
    activeItemId,
    renderBranch,
    renderDemoDims,
    clearAll,
    flyTo,
    updateLabelPositions,
    renderLabels,
    initCSS2DRenderer,
    highlightItem,
    applyModeDefaults,
    resetToCurrentModeDefaults,
    setResolution,
    dispose,
    updateDimOverride,
    resetDimOverride,
    getDimAnnotations,
    getWeldAnnotations,
    getSlopeAnnotations,
    getBendAnnotations,
    getCutTubiAnnotations,
    getTagAnnotations,
    getPipeClearanceAnnotations,
    getStructureClearanceAnnotations,
    getElevationAnnotations,
    getEnvelopeObjects,
    resolveElevationMarks,
    resolveEnvelopeData,
  };
}
