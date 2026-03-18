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
  MbdFittingDto,
  MbdLayoutHint,
  MbdSlopeDto,
  MbdTagDto,
  MbdWeldDto,
  MbdBendDto,
  MbdPipeSegmentDto,
  MbdPipeViewMode,
  Vec3 as ApiVec3,
} from '@/api/mbdPipeApi';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { computeMbdDimOffset } from '@/composables/mbd/computeMbdDimOffset';
import {
  computePipeAlignedOffsetDirs,
  findSegmentOffsetDir,
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
import { computeDimensionOffsetDirInLocal } from '@/utils/three/annotation/utils/computeDimensionOffsetDirInLocal';
import { formatLengthMeters } from '@/utils/unitFormat';

export type UseMbdPipeAnnotationThreeReturn = {
  /** MBD 面板当前页签（仅 UI 状态） */
  uiTab: Ref<MbdPipeUiTab>;
  /** 语义模式：construction=施工表达；inspection=几何校核 */
  mbdViewMode: Ref<MbdPipeViewMode>;

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
  getBendAnnotations: () => Map<string, AngleDimension3D>;
  /** 获取 tag annotations map（用于调试/测试） */
  getTagAnnotations: () => Map<string, WeldAnnotation3D>;
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
  | 'dims'
  | 'welds'
  | 'slopes'
  | 'bends'
  | 'attrs'
  | 'segments'
  | 'settings';

type PlanarDimAlignmentCandidate = {
  id: string;
  kind: MbdDimKind;
  dim: LinearDimension3D;
  hint?: MbdLayoutHint | null;
  start: Vector3;
  end: Vector3;
  offsetDir: Vector3;
  offset: number;
  hasManualOffset: boolean;
};

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

function resolveLayoutDirection(hint?: MbdLayoutHint | null): Vector3 | null {
  const dir = toVector3(hint?.offset_dir ?? null);
  if (!dir || dir.lengthSq() < 1e-9) return null;
  return dir.normalize();
}

function resolveLayoutOffsetLevel(hint?: MbdLayoutHint | null): number {
  const raw = Number(hint?.offset_level ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function resolveLayeredDimOffset(
  baseOffset: number,
  hint?: MbdLayoutHint | null,
): number {
  const safeBase = clampNumber(baseOffset, 1, 5000, 100);
  const offsetLevel = resolveLayoutOffsetLevel(hint);
  if (offsetLevel <= 0) return safeBase;
  const layerGap = Math.max(safeBase * 0.85, 60);
  return safeBase + offsetLevel * layerGap;
}

function resolveSemanticDimOffset(
  baseOffset: number,
  role: 'segment' | 'chain' | 'overall' | 'port' | 'cut_tubi',
  hint?: MbdLayoutHint | null,
): number {
  const layered = resolveLayeredDimOffset(baseOffset, hint);
  if (role === 'chain') {
    return layered + Math.max(baseOffset * 0.55, 420);
  }
  if (role === 'overall') {
    return layered + Math.max(baseOffset * 0.75, 520);
  }
  if (role === 'cut_tubi') {
    return layered + Math.max(baseOffset * 0.12, 80);
  }
  return layered;
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

function canonicalizeUnitVector(input: Vector3): Vector3 | null {
  const vec = input.clone();
  if (vec.lengthSq() < 1e-9) return null;
  vec.normalize();

  if (
    vec.x < -1e-6 ||
    (Math.abs(vec.x) <= 1e-6 && vec.y < -1e-6) ||
    (Math.abs(vec.x) <= 1e-6 &&
      Math.abs(vec.y) <= 1e-6 &&
      vec.z < -1e-6)
  ) {
    vec.negate();
  }
  return vec;
}

function vectorKey(vec: Vector3): string {
  return [
    roundTo(vec.x, 0.001).toFixed(3),
    roundTo(vec.y, 0.001).toFixed(3),
    roundTo(vec.z, 0.001).toFixed(3),
  ].join(',');
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

function buildPlanarDimAlignmentGroupKey(
  candidate: PlanarDimAlignmentCandidate,
): string | null {
  const segDir = candidate.end.clone().sub(candidate.start);
  if (segDir.lengthSq() < 1e-9) return null;
  const canonicalSeg = canonicalizeUnitVector(segDir);
  const canonicalOffset = canonicalizeUnitVector(candidate.offsetDir);
  if (!canonicalSeg || !canonicalOffset) return null;

  const planeNormalRaw = canonicalSeg.clone().cross(canonicalOffset);
  const canonicalPlaneNormal = canonicalizeUnitVector(planeNormalRaw);
  if (!canonicalPlaneNormal) return null;

  const mid = candidate.start.clone().add(candidate.end).multiplyScalar(0.5);
  const planeDistance = roundTo(mid.dot(canonicalPlaneNormal), 1);
  const offsetLevel = resolveLayoutOffsetLevel(candidate.hint);

  return [
    candidate.kind,
    vectorKey(canonicalSeg),
    vectorKey(canonicalOffset),
    vectorKey(canonicalPlaneNormal),
    planeDistance.toFixed(1),
    String(offsetLevel),
  ].join('|');
}

function applyPlanarDimAlignment(
  candidates: PlanarDimAlignmentCandidate[],
): void {
  const groups = new Map<string, PlanarDimAlignmentCandidate[]>();

  for (const candidate of candidates) {
    if (candidate.kind !== 'chain' && candidate.kind !== 'overall') continue;
    const key = buildPlanarDimAlignmentGroupKey(candidate);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(candidate);
    else groups.set(key, [candidate]);
  }

  for (const bucket of groups.values()) {
    if (bucket.length <= 1) continue;
    const alignedOffset = Math.max(...bucket.map((item) => item.offset));
    for (const item of bucket) {
      if (item.hasManualOffset) continue;
      item.dim.setParams({
        offset: alignedOffset,
        direction: item.offsetDir.clone(),
      });
    }
  }
}

function resolveFloatingLabelOffset(
  hint?: MbdLayoutHint | null,
  baseOffset = 110,
): Vector3 | null {
  const offsetDir = toVector3(hint?.offset_dir ?? null);
  const charDir =
    toVector3(hint?.char_dir ?? null) ?? toVector3(hint?.offset_dir ?? null);
  const primaryAxis = toVector3(hint?.primary_axis ?? null);
  if (
    (!offsetDir || offsetDir.lengthSq() < 1e-9) &&
    (!charDir || charDir.lengthSq() < 1e-9) &&
    (!primaryAxis || primaryAxis.lengthSq() < 1e-9)
  ) {
    return null;
  }

  const resolvedOffset = resolveLayeredDimOffset(baseOffset, hint);
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
    `${hint?.label_role ?? ''}`.includes('tubi')
  ) {
    const axialGap = clampNumber(baseOffset * 0.2, 24, 96, 40);
    offset.addScaledVector(
      primaryAxis.normalize(),
      axialGap * stableAlternatingSign(hint?.owner_segment_id),
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
  const uiTab = ref<MbdPipeUiTab>('dims');
  const mbdViewMode = ref<MbdPipeViewMode>('construction');

  // MBD 尺寸显示配置
  const dimTextMode = ref<'backend' | 'auto'>('backend');
  const dimOffsetScale = ref<number>(1);
  const dimLabelT = ref<number>(0.5);
  const dimMode = ref<MbdDimensionMode>('rebarviz');
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
  const showDimChain = ref(false);
  const showDimOverall = ref(false);
  const showDimPort = ref(false);
  const showPipeClearances = ref(true);
  const showCutTubis = ref(false);
  const showElbows = ref(true);
  const showBranches = ref(true);
  const showFlanges = ref(true);
  const showAnchorDebug = ref(false);
  const showOwnerSegmentDebug = ref(false);
  const suppressedWrongLineCount = ref(0);
  const showWelds = ref(true);
  const showSlopes = ref(true);
  const showBends = ref(false);
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
  const bendAnnotations = new Map<string, AngleDimension3D>();
  const cutTubiAnnotations = new Map<string, LinearDimension3D>();
  const fittingAnnotations = new Map<
    string,
    AngleDimension3D | WeldAnnotation3D
  >();
  const tagAnnotations = new Map<string, WeldAnnotation3D>();
  const pipeClearanceAnnotations = new Map<string, LinearDimension3D>();
  const anchorDebugMarkers = new Map<string, LineSegments>();
  const ownerSegmentDebugLines = new Map<string, Line>();

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
      showDimSegment.value = false;
      showDimChain.value = false;
      showDimOverall.value = false;
      showDimPort.value = true;
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

    dimMode.value = 'rebarviz';
    showDimSegment.value = true;
    showDimChain.value = false;
    showDimOverall.value = false;
    showDimPort.value = false;
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
      asRaw(annotation).visible = isVisible.value && showCutTubis.value;
    }

    // 焊缝标注可见性
    for (const annotation of weldAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showWelds.value;
    }

    // 坡度标注可见性
    for (const annotation of slopeAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showSlopes.value;
    }

    // 管道间距离标注可见性
    for (const annotation of pipeClearanceAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showPipeClearances.value;
    }

    // 弯头标注可见性
    for (const annotation of bendAnnotations.values()) {
      asRaw(annotation).visible = isVisible.value && showBends.value;
    }

    for (const annotation of fittingAnnotations.values()) {
      const kind = ((asRaw(annotation).userData as any)?.mbdFittingKind ??
        'elbow') as MbdFittingKind;
      const visible =
        (kind === 'elbow' && showElbows.value) ||
        (kind === 'branch' && showBranches.value) ||
        (kind === 'flange' && showFlanges.value);
      asRaw(annotation).visible = isVisible.value && visible;
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
      raw.visible = isVisible.value && visible && !declutterHidden;
    }

    for (const marker of anchorDebugMarkers.values()) {
      marker.visible = isVisible.value && showAnchorDebug.value;
    }

    for (const line of ownerSegmentDebugLines.values()) {
      line.visible = isVisible.value && showOwnerSegmentDebug.value;
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
    for (const line of segmentLines.values()) {
      line.material = segmentMaterial;
    }

    // 设置新的高亮
    if (id) {
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

      const seg = segmentLines.get(id);
      if (seg) seg.material = segmentHighlightMaterial;
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
    const planarAlignmentCandidates: PlanarDimAlignmentCandidate[] = [];
    const duplicateOverallIds = collectDuplicateOverallDimIds(dims);
    dimTextById.value.clear();
    for (const d of dims) {
      const start = new Vector3(d.start[0], d.start[1], d.start[2]);
      const end = new Vector3(d.end[0], d.end[1], d.end[2]);
      const kind = (d.kind ?? 'segment') as MbdDimKind;
      if (kind === 'overall' && duplicateOverallIds.has(d.id)) {
        continue;
      }

      // 计算偏移方向：优先 layout_hint，其次管道拓扑，再次相机方向；都失败则抑制该错误线
      const hintedDir = resolveLayoutDirection(d.layout_hint);
      const pipeDir = findSegmentOffsetDir(
        segments,
        d.start,
        d.end,
        pipeOffsetDirs,
      );
      const offsetDir =
        hintedDir ??
        pipeDir ??
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

      const dist = start.distanceTo(end);
      const baseOffset =
        computeMbdDimOffset(dist) *
        clampNumber(dimOffsetScale.value, 0.05, 50, 1);
      const offset = resolveSemanticDimOffset(baseOffset, kind, d.layout_hint);

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
      planarAlignmentCandidates.push({
        id: d.id,
        kind,
        dim: rawDim,
        hint: d.layout_hint,
        start: start.clone(),
        end: end.clone(),
        offsetDir: finalDir.clone(),
        offset: finalOffset,
        hasManualOffset: ov?.offset != null,
      });
    }
    applyPlanarDimAlignment(planarAlignmentCandidates);
    applyPortDimLabelDeclutter();
  }

  function applyPortDimLabelDeclutter(): void {
    const portAnnotations: [string, LinearDimension3D][] = [];
    for (const [dimId, dim] of dimAnnotations.entries()) {
      const kind = ((asRaw(dim).userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (kind === 'port') portAnnotations.push([dimId, asRaw(dim)]);
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
      const hasManualLabel =
        (ov?.labelOffsetWorld != null) || ov?.labelT !== undefined;
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
      const hint = (userData.mbdLayoutHint ?? null) as MbdLayoutHint | null;
      const baseOffset =
        toVector3(userData.mbdBaseLabelOffset ?? null) ??
        params.labelOffsetWorld?.clone() ??
        new Vector3();

      const offsetDir =
        toVector3(hint?.offset_dir ?? null) ?? new Vector3(0, 1, 0);
      if (offsetDir.lengthSq() < 1e-9) offsetDir.set(0, 1, 0);
      offsetDir.normalize();

      const charDir =
        toVector3(hint?.char_dir ?? null) ??
        toVector3(hint?.primary_axis ?? null) ??
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

  function rebuildDimsByCurrentData(): void {
    const data = currentData.value;
    if (!data) return;

    for (const annotation of dimAnnotations.values()) {
      asRaw(annotation).dispose();
    }
    dimAnnotations.clear();

    const pipeOffsetDirs = data.segments?.length
      ? computePipeAlignedOffsetDirs(data.segments)
      : [];
    if (data.dims?.length) {
      renderDims(data.dims, data.segments ?? [], pipeOffsetDirs);
    }
    applyCutTubiLabelDeclutter();

    const viewer = dtxViewerRef.value;
    if (viewer) applyBackgroundColor(viewer);
    applyVisibility();
    applyLabelVisibility();
    // 尺寸重建后回放当前高亮，避免“列表选中但场景未高亮”。
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
      const rawDim = markRaw(dim);
      group.add(rawDim);
      pipeClearanceAnnotations.set(c.id, rawDim);
    }
  }

  function renderCutTubis(cutTubis: MbdCutTubiDto[]): void {
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

      const direction =
        resolveLayoutDirection(cutTubi.layout_hint) ??
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
      const cutBaseOffset = computeMbdDimOffset(start.distanceTo(end));
      const finalCutOffset = resolveSemanticDimOffset(
        cutBaseOffset,
        'cut_tubi',
        cutTubi.layout_hint,
      );
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
      const baseLabelOffset = annotation.getParams().labelOffsetWorld;
      (rawTag.userData as any).mbdBaseLabelOffset = baseLabelOffset
        ? [baseLabelOffset.x, baseLabelOffset.y, baseLabelOffset.z]
        : null;
      group.add(rawTag);
      tagAnnotations.set(tag.id, rawTag);
    }
  }

  function renderBends(bends: MbdBendDto[]): void {
    const { labelRenderStyle } = getRuntimeModeConfig();
    let skippedMissingFaceCenter = 0;
    for (const b of bends) {
      const wp = new Vector3(b.work_point[0], b.work_point[1], b.work_point[2]);

      // face_center 作为角度的两条边端点；若缺失则跳过（无法绘制角度弧线）
      if (!b.face_center_1 || !b.face_center_2) {
        skippedMissingFaceCenter += 1;
        continue;
      }
      const p1 = new Vector3(
        b.face_center_1[0],
        b.face_center_1[1],
        b.face_center_1[2],
      );
      const p2 = new Vector3(
        b.face_center_2[0],
        b.face_center_2[1],
        b.face_center_2[2],
      );

      const angleText = b.angle != null ? `${b.angle.toFixed(1)}°` : '';

      const angleDim = new AngleDimension3D(materials, {
        vertex: wp,
        point1: p1,
        point2: p2,
        text: angleText,
        labelRenderStyle,
      });

      angleDim.userData.pickable = true;
      angleDim.userData.draggable = true;
      (angleDim.userData as any).mbdBendId = b.id;
      angleDim.setLabelRenderStyle(labelRenderStyle);

      angleDim.setMaterialSet(materials.yellow);
      const rawAngleDim = markRaw(angleDim);
      group.add(rawAngleDim);
      bendAnnotations.set(b.id, rawAngleDim);
    }
    if (isDev && bends.length > 0) {
      const rendered = bends.length - skippedMissingFaceCenter;
      // 帮助联调定位“统计里有 bends 但场景没渲染”的来源。
      console.info('[mbd-bends] render stats', {
        total: bends.length,
        rendered,
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

    // 渲染各类标注
    const pipeOffsetDirs = data.segments?.length
      ? computePipeAlignedOffsetDirs(data.segments)
      : [];
    if (data.dims?.length)
      renderDims(data.dims, data.segments ?? [], pipeOffsetDirs);
    if (data.welds?.length) renderWelds(data.welds);
    if (data.slopes?.length) renderSlopes(data.slopes);
    if (data.pipe_clearances?.length) renderPipeClearances(data.pipe_clearances);
    if (data.bends?.length) renderBends(data.bends);
    if (data.cut_tubis?.length) renderCutTubis(data.cut_tubis);
    applyCutTubiLabelDeclutter();
    if (data.fittings?.length) renderFittings(data.fittings);
    if (data.tags?.length) renderTags(data.tags);
    applyTagLabelDeclutter();
    applyCutTubiLabelDeclutter(true);
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
    // 需要重建才能回到后端原始状态（简单方案：如果有 currentData 就重新渲染该 dim）
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
  function getBendAnnotations(): Map<string, AngleDimension3D> {
    return bendAnnotations;
  }

  /** 获取 tag annotations map（用于调试与测试） */
  function getTagAnnotations(): Map<string, WeldAnnotation3D> {
    return tagAnnotations;
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
        applyVisibility();
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
      rebarvizArrowStyle,
      rebarvizArrowSizePx,
      rebarvizArrowAngleDeg,
      rebarvizLineWidthPx,
      () => unitSettings.displayUnit.value,
      () => unitSettings.precision.value,
    ],
    () => {
      if (dimAnnotations.size === 0) return;

      // 仅当 dims 已存在时，按配置刷新文字/布局（不重建全部；保留 session overrides）
      try {
        const gm = getGlobalModelMatrix?.() || identityMatrix;
        const useBackendText = dimTextMode.value === 'backend';
        const offsetScale = clampNumber(dimOffsetScale.value, 0.05, 50, 1);
        const modeConfig = getRuntimeModeConfig();

        for (const [dimId, dim] of dimAnnotations.entries()) {
          const rawDim = asRaw(dim);
          const ov = dimOverrides.get(dimId) ?? {};
          const sourceDim =
            currentData.value?.dims?.find((item) => item.id === dimId) ?? null;
          const kind = (((rawDim.userData as any)?.mbdDimKind ??
            sourceDim?.kind ??
            'segment') as MbdDimKind);

          // 距离与默认 offset 以“局部坐标”计算（与几何保持一致）
          const p = rawDim.getParams();
          const distLocal = p.start.distanceTo(p.end);
          const baseOffset = resolveSemanticDimOffset(
            computeMbdDimOffset(distLocal) * offsetScale,
            kind,
            sourceDim?.layout_hint,
          );
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

          // 若用户拖拽过文字（labelOffsetWorld!=null），避免全局 labelT 影响其基准位置
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
      } catch {
        // ignore
      }

      requestRender?.();
    },
  );

  watch(dimMode, () => {
    try {
      rebuildDimsByCurrentData();
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
    dimTextMode,
    dimOffsetScale,
    dimLabelT,
    dimMode,
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
    getTagAnnotations,
  };
}
