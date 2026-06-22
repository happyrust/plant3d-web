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
  ArrowHelper,
  Box3,
  BufferGeometry,
  Camera,
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  type ColorRepresentation,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene,
  ShaderMaterial,
  TubeGeometry,
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
import type {
  LinearDimension3DLaidOutGeometry,
} from '@/utils/three/annotation/annotations/LinearDimension3D';
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
  MBD_DRAWING_STYLE_PROFILE,
  useMbdDrawingStyleStore,
} from '@/composables/mbd/mbdDrawingStyleProfile';
import {
  useBackgroundStore,
  getPreset,
} from '@/composables/useBackgroundStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { isMbdDrawingPresetUrl } from '@/utils/mbdStandaloneUrl';
import {
  type AnnotationMaterialSet,
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

export type MbdFlowDirectionObject = {
  segmentId: string;
  centerline: Line;
  pulse: Mesh;
  arrows: LineSegments[];
  direction: Vector3;
};

export type MbdBranchFlowEndpointObject = {
  role: 'inlet' | 'outlet';
  segmentId: string;
  marker: WeldAnnotation3D;
  halo: LineSegments;
  arrow: ArrowHelper;
  guide: Line;
  pulse: Mesh;
  position: Vector3;
  direction: Vector3;
  arrowStart: Vector3;
  arrowEnd: Vector3;
};

type MbdPipeVisualEmphasisObject = {
  segmentId: string;
  body: Mesh;
  spine: Line;
  rings: Mesh[];
  bands: Mesh[];
  rails: Mesh[];
  outlines: Mesh[];
};

type MbdFittingVisualEmphasisObject = {
  fittingId: string;
  coreRings: Mesh[];
  portRings: Mesh[];
  arms: Mesh[];
};

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
  /** 显示后端 inline/piece 管段长度尺寸，不等同于 cut-tubi 明细层。 */
  showInlineTubeLengthDims: Ref<boolean>;
  /** 显示 MBD 管道/管件强化几何，仍保持三维场景锚定。 */
  showPipeVisualEmphasis: Ref<boolean>;
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
  /** 显示“管道流向”（按 segment arrive -> leave 绘制） */
  showFlowDirection: Ref<boolean>;
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
  /** 获取管道流向对象 map（用于调试/测试） */
  getFlowDirectionObjects: () => Map<string, MbdFlowDirectionObject>;
  /** 获取 BRAN 整体流向入口/出口对象 map（用于调试/测试） */
  getBranchFlowEndpointObjects: () => Map<'inlet' | 'outlet', MbdBranchFlowEndpointObject>;
  /** 获取当前 MBD 3D 渲染快照（用于端到端验证主视图标注对象，而不是只验证接口数据） */
  getDebugSnapshot: () => MbdPipeDebugSnapshot;
  /** 获取当前有效标高数据（优先后端，缺省时前端回退推导） */
  resolveElevationMarks: (data?: MbdPipeData | null) => MbdElevationMarkDto[];
  /** 获取当前有效包络（优先后端，缺省时前端回退推导） */
  resolveEnvelopeData: (data?: MbdPipeData | null) => MbdPipeEnvelopeDto | null;
};

export type MbdPipeDebugSnapshot = {
  branch_refno: string | null;
  branch_name: string | null;
  render_source: MbdPipeRenderSource;
  visible: boolean;
  data_counts: {
    segments: number;
    dims: number;
    layout_linear_dims: number;
    cut_tubis: number;
    tags: number;
    fittings: number;
    layout_tags: number;
    v2_leader_lines: number;
    elevation_marks: number;
    material_rows: number;
  };
  rendered_counts: {
    group_children: number;
    dims: number;
    cut_tubis: number;
    tags: number;
    v2_leader_lines: number;
    v2_leader_extensions: number;
    pipe_visual_bodies: number;
    pipe_visual_bands: number;
    pipe_visual_rails: number;
    pipe_visual_outlines: number;
    pipe_visual_rings: number;
    pipe_visual_spines: number;
    fitting_visual_cores: number;
    fitting_visual_ports: number;
    fitting_visual_arms: number;
    elevations: number;
    envelope_objects: number;
  };
  dim_texts: string[];
  cut_tubi_texts: string[];
  tag_texts: string[];
  rendered_tag_texts: string[];
  rendered_tag_states: MbdPipeDebugTagState[];
  dimension_arrow_states: MbdPipeDebugDimensionArrowState[];
  v2_leader_line_states: MbdPipeDebugV2LeaderLineState[];
  line_object_states: MbdPipeDebugLineObjectState[];
  viewport: { width: number; height: number } | null;
  screen_items: MbdPipeDebugScreenItem[];
  screen_overlap_pairs: MbdPipeDebugOverlapPair[];
  severe_screen_overlap_count: number;
};

export type MbdPipeDebugDimensionArrowState = {
  id: string;
  kind: string;
  arrow1_visible: boolean;
  arrow2_visible: boolean;
  open1_visible: boolean;
  open2_visible: boolean;
  arrow1_screen_area: number | null;
  arrow2_screen_area: number | null;
  line_resolution: { x: number; y: number } | null;
};

export type MbdPipeDebugV2LeaderLineState = {
  id: string;
  point_count: number;
  screen_span_px: number | null;
  screen_box: MbdPipeDebugScreenBox | null;
};

export type MbdPipeDebugLineObjectState = {
  name: string;
  type: string;
  annotation_id: string | null;
  line_role: string | null;
  dim_kind: string | null;
  leader_id: string | null;
  target_tag_id: string | null;
  tag_kind: string | null;
  aux_kind: string | null;
  visible: boolean;
  screen_span_px: number | null;
  screen_box: MbdPipeDebugScreenBox | null;
  screen_segments?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[];
  opacity: number | null;
  line_width_px: number | null;
  color_hex: string | null;
};

export type MbdPipeDebugScreenBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type MbdPipeDebugScreenItem = {
  id: string;
  kind: 'dim' | 'cut_tubi' | 'tag';
  text: string;
  x: number;
  y: number;
  box: MbdPipeDebugScreenBox;
  in_viewport: boolean;
};

export type MbdPipeDebugOverlapPair = {
  a_id: string;
  b_id: string;
  a_text: string;
  b_text: string;
  overlap_area: number;
  min_area_ratio: number;
};

export type MbdPipeDebugTagState = {
  id: string;
  kind: string;
  text: string;
  visible: boolean;
  layout_hidden: boolean;
  declutter_hidden: boolean;
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
    screenFacingArrows: isMbdDrawingPresetRuntime(),
  };
}

let mbdDrawingPresetRuntimeSearch: string | null = null;
let mbdDrawingPresetRuntimeValue = false;

function isMbdDrawingPresetRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const search = window.location.search;
  if (search !== mbdDrawingPresetRuntimeSearch) {
    mbdDrawingPresetRuntimeSearch = search;
    mbdDrawingPresetRuntimeValue = isMbdDrawingPresetUrl(search);
  }
  return mbdDrawingPresetRuntimeValue;
}

function computeFlyToPositionFromBox(box: Box3, drawingPreset = false): {
  position: Vector3;
  target: Vector3;
} {
  const center = new Vector3();
  box.getCenter(center);
  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (drawingPreset) {
    const distance = Math.max(maxDim * 3.2, 5.2);
    const position = new Vector3(
      center.x + distance * 0.36,
      center.y - distance * 0.95,
      center.z + distance * 0.34,
    );
    return { position, target: center };
  }
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

function resolveDrawingLaidOutLabelOffset(vec?: ApiVec3 | null): Vector3 | null {
  if (isMbdDrawingPresetRuntime()) return null;
  return resolveLaidOutLabelOffset(vec);
}

function isBackendDerivedLinearItem(item: MbdLaidOutLinearDimDto): boolean {
  return item.backend_derived_geometry === true ||
    item.source_kind === 'linear_dim' ||
    !!item.source_primitive_id;
}

function isBackendDerivedAnnotation(annotation: LinearDimension3D): boolean {
  return !!(annotation.userData as any)?.mbdBackendDerivedGeometry;
}

type DrawingLinearPlacement = 'inline-tube-length' | 'external-chain' | 'default';

function normalizeDrawingLinearRole(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getLaidOutLinearLabelRole(item: MbdLaidOutLinearDimDto): string {
  return normalizeDrawingLinearRole(
    item.layout_hint?.label_role ?? item.source_sub_kind ?? item.kind,
  );
}

function isInlineTubeLengthRole(
  id: string,
  kind: string,
  labelRole: string,
): boolean {
  if (labelRole === 'cut_tubi' || labelRole === 'tag_tubi') return true;
  if (labelRole === 'chain-overall' || kind === 'overall') return false;
  if (/:piece:\d+(?::|$)/.test(id)) return true;
  return false;
}

function resolveDrawingLinearPlacement(item: MbdLaidOutLinearDimDto): DrawingLinearPlacement {
  const kind = normalizeDrawingLinearRole(item.kind ?? item.source_sub_kind);
  const labelRole = getLaidOutLinearLabelRole(item);
  if (isInlineTubeLengthRole(item.id, kind, labelRole)) return 'inline-tube-length';
  if (
    labelRole === 'chain-overall' ||
    kind === 'overall' ||
    (kind === 'chain' && !/:piece:\d+(?::|$)/.test(item.id))
  ) return 'external-chain';
  return 'default';
}

function getDrawingLinearPlacement(annotation: LinearDimension3D): DrawingLinearPlacement {
  const raw = normalizeDrawingLinearRole(
    (annotation.userData as any)?.mbdDrawingLinearPlacement,
  );
  if (raw === 'inline-tube-length' || raw === 'external-chain') return raw;
  return 'default';
}

function isDrawingInlineTubeLengthTarget(targetId: string, dim?: LinearDimension3D | null): boolean {
  if (/:piece:\d+(?::|$)/.test(targetId)) return true;
  return dim ? getDrawingLinearPlacement(dim) === 'inline-tube-length' : false;
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

function normalizeDimDuplicateText(text: unknown): string {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function buildLaidOutDimDuplicateKey(item: MbdLaidOutLinearDimDto): string | null {
  const start = toVector3(item.start);
  const end = toVector3(item.end);
  const text = normalizeDimDuplicateText(item.text);
  if (!start || !end || text.length <= 0) return null;
  return `${text}|${buildDimSpanKey(start, end)}`;
}

function isPrimaryLengthDimForDrawingDedupe(item: MbdLaidOutLinearDimDto): boolean {
  const kind = String(item.kind ?? item.source_sub_kind ?? 'segment')
    .trim()
    .toLowerCase();
  return kind === 'segment' || kind === 'chain' || kind === 'overall';
}

function getDrawingLinearDimDedupePriority(item: MbdLaidOutLinearDimDto): number {
  const kind = String(item.kind ?? item.source_sub_kind ?? 'segment')
    .trim()
    .toLowerCase();
  if (kind === 'chain') return 40;
  if (kind === 'segment') return 30;
  if (kind === 'overall') return 20;
  if (kind === 'port') return 10;
  return 0;
}

function filterRedundantDrawingLinearDims(
  linearDims: MbdLaidOutLinearDimDto[],
  cutTubis: MbdLaidOutLinearDimDto[] = [],
): MbdLaidOutLinearDimDto[] {
  if (!isMbdDrawingPresetRuntime()) return linearDims;

  const bestByKey = new Map<string, { index: number; priority: number }>();
  linearDims.forEach((item, index) => {
    if (item.visible === false) return;
    const key = buildLaidOutDimDuplicateKey(item);
    const priority = getDrawingLinearDimDedupePriority(item);
    if (!key || priority <= 0) return;
    const prev = bestByKey.get(key);
    if (!prev || priority > prev.priority) {
      bestByKey.set(key, { index, priority });
    }
  });
  if (bestByKey.size <= 0) return linearDims;

  const cutTubiLengthKeys = new Set<string>();
  for (const cut of cutTubis) {
    if (cut.visible === false) continue;
    const key = buildLaidOutDimDuplicateKey(cut);
    if (key) cutTubiLengthKeys.add(key);
  }

  return linearDims.filter((item, index) => {
    if (item.visible === false) return true;
    const key = buildLaidOutDimDuplicateKey(item);
    const priority = getDrawingLinearDimDedupePriority(item);
    if (!key || priority <= 0) return true;
    if (
      cutTubiLengthKeys.has(key) &&
      isInlineTubeLengthRole(
        item.id,
        normalizeDrawingLinearRole(item.kind ?? item.source_sub_kind),
        getLaidOutLinearLabelRole(item),
      )
    ) {
      return false;
    }
    return bestByKey.get(key)?.index === index;
  });
}

function filterRedundantDrawingCutTubis(
  cutTubis: MbdLaidOutLinearDimDto[],
  linearDims: MbdLaidOutLinearDimDto[],
): MbdLaidOutLinearDimDto[] {
  if (!isMbdDrawingPresetRuntime() || cutTubis.length <= 0 || linearDims.length <= 0) {
    return cutTubis;
  }

  const primaryLengthKeys = new Set<string>();
  for (const item of linearDims) {
    if (item.visible === false || !isPrimaryLengthDimForDrawingDedupe(item)) continue;
    const labelRole = getLaidOutLinearLabelRole(item);
    if (isInlineTubeLengthRole(
      item.id,
      normalizeDrawingLinearRole(item.kind ?? item.source_sub_kind),
      labelRole,
    )) {
      continue;
    }
    const key = buildLaidOutDimDuplicateKey(item);
    if (key) primaryLengthKeys.add(key);
  }
  if (primaryLengthKeys.size <= 0) return cutTubis;

  return cutTubis.filter((item) => {
    if (item.visible === false) return true;
    const key = buildLaidOutDimDuplicateKey(item);
    return !key || !primaryLengthKeys.has(key);
  });
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
type MbdTagKind =
  | MbdFittingKind
  | 'tubi'
  | 'position'
  | 'elevation'
  | 'branch_label'
  | 'material'
  | 'other';

function classifyFitting(fitting: MbdFittingDto): MbdFittingKind {
  const raw = `${fitting.kind ?? ''} ${fitting.noun ?? ''}`.toUpperCase();
  if (
    raw.includes('TEE') ||
    raw.includes('BRANCH') ||
    raw.includes('OLET')
  ) {
    return 'branch';
  }
  if (
    raw.includes('FLAN') ||
    raw.includes('FLNG') ||
    raw.includes('REDU') ||
    raw.includes('VALV') ||
    raw.includes('GATE') ||
    raw.includes('GLOV') ||
    raw.includes('BALL') ||
    raw.includes('CHECK') ||
    raw.includes('CVAV') ||
    raw.includes('GASK')
  ) return 'flange';
  return 'elbow';
}

function classifyTag(tag: MbdTagDto): MbdTagKind {
  const raw = `${tag.id ?? ''} ${tag.role ?? ''} ${tag.noun ?? ''} ${tag.text ?? ''}`.toUpperCase();
  if (raw.includes('MATERIAL_BALLOON') || raw.includes('TAG:MATERIAL')) return 'material';
  if (raw.includes('POSITION_TAG') || raw.includes('TAG:POSITION')) return 'position';
  if (raw.includes('ELEVATION_TAG') || raw.includes('TAG:ELEVATION') || raw.startsWith('PE ')) {
    return 'elevation';
  }
  if (raw.includes('BRANCH_LABEL') || raw.includes('TAG:BRANCH')) return 'branch_label';
  if (raw.includes('TUBI')) return 'tubi';
  if (raw.includes('TEE') || raw.includes('BRANCH') || raw.includes('OLET')) {
    return 'branch';
  }
  if (
    raw.includes('FLAN') ||
    raw.includes('FLNG') ||
    raw.includes('REDU') ||
    raw.includes('VALV') ||
    raw.includes('GATE') ||
    raw.includes('GLOV') ||
    raw.includes('BALL') ||
    raw.includes('CHECK') ||
    raw.includes('CVAV') ||
    raw.includes('GASK')
  ) return 'flange';
  if (raw.includes('ELBO') || raw.includes('BEND')) return 'elbow';
  return 'other';
}

function classifyLaidOutTag(tag: MbdLaidOutTagDto): MbdTagKind {
  return classifyTag({
    id: tag.id,
    refno: tag.id,
    noun: 'MBD_LABEL',
    role: tag.role ?? '',
    text: tag.text,
    position: tag.position,
  });
}

function shouldSuppressDrawingTubiLengthTag(
  tag: Pick<MbdLaidOutTagDto, 'text'>,
  tagKind: MbdTagKind,
): boolean {
  if (!isMbdDrawingPresetRuntime() || tagKind !== 'tubi') return false;
  return /^L\s*=\s*[-+]?\d+(?:\.\d+)?(?:\s*(?:MM|M))?$/i.test(
    String(tag.text ?? '').trim(),
  );
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
  if (kind === 'position') return 0;
  if (kind === 'branch_label') return 1;
  if (kind === 'elevation') return 2;
  if (kind === 'material') return 3;
  if (kind === 'branch') return 0;
  if (kind === 'flange') return 1;
  if (kind === 'elbow') return 2;
  if (kind === 'tubi') return 5;
  return 6;
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
  const requestedLayers = data.debug_info?.requested_layers as
    | { elevation_marks?: unknown }
    | undefined;
  if (requestedLayers?.elevation_marks === false) return [];
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
  const isTestEnv = (import.meta.env as unknown as { MODE?: string }).MODE === 'test';
  const requestRender = options.requestRender ?? null;
  const getGlobalModelMatrix = options.getGlobalModelMatrix ?? null;
  // 方案B：MBD 标注统一为 3D 文本，不再需要 CSS2D 容器；保留参数以维持 API 兼容。
  void labelContainerRef;

  const unitSettings = useUnitSettingsStore();
  const mbdDrawingStyleStore = useMbdDrawingStyleStore();

  // UI 状态（MbdPipePanel 使用）
  const uiTab = ref<MbdPipeUiTab>('overview');
  const mbdViewMode = ref<MbdPipeViewMode>('layout_first');
  const renderSource = ref<MbdPipeRenderSource>('fallback');

  // MBD 尺寸显示配置
  const dimTextMode = ref<'backend' | 'auto'>('backend');
  const dimOffsetScale = ref<number>(1);
  const dimLabelT = ref<number>(0.5);
  const dimMode = ref<MbdDimensionMode>('rebarviz');
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
  const showDimPort = ref(true);
  const showPipeClearances = ref(true);
  const showStructureClearances = ref(true);
  const showElevationMarks = ref(true);
  const showEnvelope = ref(false);
  const showCutTubis = ref(true);
  const showInlineTubeLengthDims = ref(false);
  const showPipeVisualEmphasis = ref(false);
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
  const showFlowDirection = ref(false);
  const showLabels = ref(true);

  const currentData = ref<MbdPipeData | null>(null);
  const activeItemId = ref<string | null>(null);

  // 标注组
  const group = markRaw(new Group());
  group.name = 'dtx-mbd-pipe-v2';
  group.renderOrder = 981;
  group.matrixAutoUpdate = false;

  const identityMatrix = new Matrix4();
  const lastGroupMatrix = new Matrix4();
  let hasLastGroupMatrix = false;

  function syncAnnotationGroupMatrix(matrix: Matrix4): void {
    if (hasLastGroupMatrix && lastGroupMatrix.equals(matrix)) return;
    group.matrix.copy(matrix);
    group.updateMatrixWorld(true);
    lastGroupMatrix.copy(matrix);
    hasLastGroupMatrix = true;
  }

  // 材质管理器
  const materials = markRaw(new AnnotationMaterials());
  const mbdOnTopAnnotationOptions = { depthTest: false } satisfies AnnotationOptions;

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
  const v2LeaderLineTubes = new Map<string, Mesh[]>();
  const v2LeaderExtensions = new Map<string, Line>();
  const v2LeaderExtensionTubes = new Map<string, Mesh>();
  let drawingLeaderExtensionsNeedRebuild = false;
  const pipeVisualEmphasisObjects = new Map<string, MbdPipeVisualEmphasisObject>();
  const fittingVisualEmphasisObjects = new Map<string, MbdFittingVisualEmphasisObject>();
  const flowDirectionObjects = new Map<string, MbdFlowDirectionObject>();
  const branchFlowEndpointObjects = new Map<
    'inlet' | 'outlet',
    MbdBranchFlowEndpointObject
  >();

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
  const drawingPresetRuntime = isMbdDrawingPresetRuntime();
  const v2LeaderOpacity = drawingPresetRuntime
    ? MBD_DRAWING_STYLE_PROFILE.leader.lineOpacity
    : 1;
  const v2LeaderTubeOpacity = drawingPresetRuntime
    ? MBD_DRAWING_STYLE_PROFILE.leader.tubeOpacity
    : 1;
  const pipeEmphasisBodyOpacity = drawingPresetRuntime
    ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyOpacity
    : 0.82;
  const v2LeaderLineMaterial = new LineBasicMaterial({
    color: 0x7f1d1d,
    transparent: true,
    opacity: v2LeaderOpacity,
    depthTest: false,
  });
  const v2LeaderLineTubeMaterial = new MeshBasicMaterial({
    color: 0x7f1d1d,
    transparent: true,
    opacity: v2LeaderTubeOpacity,
    depthTest: false,
    depthWrite: false,
  });
  const pipeEmphasisBodyMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyColor
      : 0x0784ff,
    transparent: !drawingPresetRuntime || pipeEmphasisBodyOpacity < 1,
    opacity: pipeEmphasisBodyOpacity,
    depthTest: true,
    depthWrite: drawingPresetRuntime,
  });
  const pipeEmphasisRingMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringColor
      : 0x004fb8,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringOpacity
      : 1,
    depthTest: true,
    depthWrite: false,
  });
  const pipeEmphasisBandMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandColor
      : 0x003a9f,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandOpacity
      : 1,
    depthTest: true,
    depthWrite: false,
  });
  const pipeEmphasisRailMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railColor
      : 0x002f86,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railOpacity
      : 1,
    depthTest: true,
    depthWrite: false,
  });
  const pipeEmphasisOutlineMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineColor
      : 0x002a9a,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineOpacity
      : 0.88,
    depthTest: true,
    depthWrite: false,
  });
  const fittingEmphasisCoreMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreColor
      : 0x0030a8,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreOpacity
      : 0.88,
    depthTest: true,
    depthWrite: false,
  });
  const fittingEmphasisPortMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portColor
      : 0x002f86,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portOpacity
      : 0.92,
    depthTest: true,
    depthWrite: false,
  });
  const fittingEmphasisArmMaterial = new MeshBasicMaterial({
    color: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armColor
      : 0x0030a8,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armOpacity
      : 0.82,
    depthTest: true,
    depthWrite: false,
  });
  const pipeEmphasisSpineMaterial = new LineBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: drawingPresetRuntime
      ? MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.spineOpacity
      : 0.62,
    depthTest: true,
    depthWrite: false,
  });
  const flowCenterlineMaterial = new LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
  });
  const flowArrowMaterial = new LineBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const flowInletMarkerMaterial = new LineBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const flowOutletMarkerMaterial = new LineBasicMaterial({
    color: 0xff7a18,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
  });
  const flowPulseMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new Color(0x0ea5e9) },
      uPulseColor: { value: new Color(0xff7a18) },
      uAlpha: { value: 0.92 },
      uRepeat: { value: 3.8 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uPulseColor;
      uniform float uAlpha;
      uniform float uRepeat;
      varying vec2 vUv;

      void main() {
        float hoop = 0.82 + 0.18 * sin(vUv.y * 6.2831853);
        float wave = fract(vUv.x * uRepeat - uTime * 1.15);
        float head = smoothstep(0.02, 0.08, wave) * (1.0 - smoothstep(0.08, 0.19, wave));
        float tail = (1.0 - smoothstep(0.19, 0.72, wave)) * 0.34;
        float runner = smoothstep(0.46, 0.55, sin((vUv.x * uRepeat - uTime * 1.15) * 6.2831853) * 0.5 + 0.5);
        float glow = clamp(head + tail + runner * 0.16, 0.0, 1.0);
        vec3 color = mix(uBaseColor, uPulseColor, glow);
        float alpha = (0.26 + glow * 0.74) * hoop * uAlpha;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });

  function applyLineMaterialColor(material: unknown, color: number, opacity = 1): void {
    const mat = material as {
      color?: { setHex?: (value: number) => void }
      opacity?: number
      transparent?: boolean
      needsUpdate?: boolean
    };
    mat.color?.setHex?.(color);
    mat.opacity = opacity;
    mat.transparent = opacity < 1 || !!mat.transparent;
    mat.needsUpdate = true;
  }

  function applyAnnotationMaterialSetColor(
    set: AnnotationMaterialSet,
    color: number,
    hoverColor: number,
    opacity: number,
  ): void {
    applyLineMaterialColor(set.line, color, opacity);
    applyLineMaterialColor(set.mesh, color, opacity);
    applyLineMaterialColor(set.fatLine, color, opacity);
    applyLineMaterialColor(set.textFatLine, color, opacity);
    applyLineMaterialColor(set.lineHover, hoverColor, opacity);
    applyLineMaterialColor(set.meshHover, hoverColor, opacity);
    applyLineMaterialColor(set.fatLineHover, hoverColor, opacity);
    applyLineMaterialColor(set.textFatLineHover, hoverColor, opacity);
  }

  function applyMbdDrawingRuntimeStyle(): void {
    const dimensionStyle = MBD_DRAWING_STYLE_PROFILE.dimension;
    applyAnnotationMaterialSetColor(
      materials.ssDimensionDefault,
      dimensionStyle.lineColor,
      dimensionStyle.lineHoverColor,
      dimensionStyle.lineOpacity,
    );
    applyAnnotationMaterialSetColor(
      materials.ssHovered,
      dimensionStyle.lineHoverColor,
      dimensionStyle.lineHoverColor,
      dimensionStyle.lineOpacity,
    );
    applyAnnotationMaterialSetColor(
      materials.ssSelected,
      dimensionStyle.lineSelectedColor,
      dimensionStyle.lineSelectedColor,
      dimensionStyle.lineOpacity,
    );

    if (!drawingPresetRuntime) return;

    const leaderStyle = MBD_DRAWING_STYLE_PROFILE.leader;
    applyLineMaterialColor(v2LeaderLineMaterial, leaderStyle.lineColor, leaderStyle.lineOpacity);
    applyLineMaterialColor(v2LeaderLineTubeMaterial, leaderStyle.lineColor, leaderStyle.tubeOpacity);

    const pipeStyle = MBD_DRAWING_STYLE_PROFILE.pipeEmphasis;
    applyLineMaterialColor(pipeEmphasisBodyMaterial, pipeStyle.bodyColor, pipeStyle.bodyOpacity);
    applyLineMaterialColor(pipeEmphasisRingMaterial, pipeStyle.ringColor, pipeStyle.ringOpacity);
    applyLineMaterialColor(pipeEmphasisBandMaterial, pipeStyle.bandColor, pipeStyle.bandOpacity);
    applyLineMaterialColor(pipeEmphasisRailMaterial, pipeStyle.railColor, pipeStyle.railOpacity);
    applyLineMaterialColor(pipeEmphasisOutlineMaterial, pipeStyle.outlineColor, pipeStyle.outlineOpacity);
    applyLineMaterialColor(pipeEmphasisSpineMaterial, 0x0ea5e9, pipeStyle.spineOpacity);

    const fittingStyle = MBD_DRAWING_STYLE_PROFILE.fittingEmphasis;
    applyLineMaterialColor(fittingEmphasisCoreMaterial, fittingStyle.coreColor, fittingStyle.coreOpacity);
    applyLineMaterialColor(fittingEmphasisPortMaterial, fittingStyle.portColor, fittingStyle.portOpacity);
    applyLineMaterialColor(fittingEmphasisArmMaterial, fittingStyle.armColor, fittingStyle.armOpacity);
  }

  applyMbdDrawingRuntimeStyle();

  let flowAnimationFrame: number | null = null;
  const layoutScreenDeclutterMinIntervalMs = 180;
  let layoutScreenDeclutterLastRunMs = 0;
  let layoutScreenDeclutterTimer: number | null = null;

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
      showInlineTubeLengthDims.value = false;
      showPipeVisualEmphasis.value = false;
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
      dimMode.value = 'rebarviz';
      if (isMbdDrawingPresetRuntime()) {
        rebarvizArrowStyle.value = 'filled';
        rebarvizArrowSizePx.value = MBD_DRAWING_STYLE_PROFILE.dimension.arrowSizePx;
        rebarvizArrowAngleDeg.value =
          MBD_DRAWING_STYLE_PROFILE.dimension.arrowAngleDeg;
        rebarvizLineWidthPx.value = MBD_DRAWING_STYLE_PROFILE.dimension.lineWidthPx;
      } else {
        rebarvizArrowStyle.value = rebarvizDefaults.arrowStyle === 'filled' ? 'filled' : 'open';
        rebarvizArrowSizePx.value = rebarvizDefaults.arrowSizePx;
        rebarvizArrowAngleDeg.value = rebarvizDefaults.arrowAngleDeg;
        rebarvizLineWidthPx.value = rebarvizDefaults.lineWidthPx;
      }
      bendDisplayMode.value = 'size';
      // 普通三维页先给主长度层，制造/切管细节由面板按需打开；
      // drawing 预设也会在出图规则中按需要去重。
      showDimSegment.value = true;
      showDimChain.value = true;
      showDimOverall.value = true;
      showDimPort.value = true;
      showPipeClearances.value = false;
      showStructureClearances.value = false;
      showElevationMarks.value = false;
      showEnvelope.value = false;
      showCutTubis.value = false;
      showInlineTubeLengthDims.value = false;
      showPipeVisualEmphasis.value = false;
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
    showInlineTubeLengthDims.value = false;
    showPipeVisualEmphasis.value = false;
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

  applyModeDefaults(mbdViewMode.value);

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
      lineWidthPx: clampNumber(rebarvizLineWidthPx.value, 1, 16, base.lineWidthPx),
    };
  }

  function getDrawingDimensionExtensionStyle(): {
    extensionLineWidthRatio?: number;
    extensionLineOpacity?: number;
    } {
    if (!isMbdDrawingPresetRuntime()) return {};
    return {
      extensionLineWidthRatio:
        MBD_DRAWING_STYLE_PROFILE.dimension.extensionLineWidthRatio,
      extensionLineOpacity:
        MBD_DRAWING_STYLE_PROFILE.dimension.extensionLineOpacity,
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
      const raw = asRaw(annotation);
      const forceHide = !!(raw.userData as any)?.mbdDeclutterHidden;
      raw.setLabelVisible(visible && !forceHide);
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

    for (const tubes of v2LeaderLineTubes.values()) {
      for (const tube of tubes) {
        try {
          (tube.geometry as BufferGeometry)?.dispose?.();
        } catch {
          // ignore
        }
        tube.removeFromParent();
      }
    }
    v2LeaderLineTubes.clear();

    for (const tube of v2LeaderExtensionTubes.values()) {
      try {
        (tube.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      tube.removeFromParent();
    }
    v2LeaderExtensionTubes.clear();

    for (const line of v2LeaderExtensions.values()) {
      try {
        (line.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      line.removeFromParent();
    }
    v2LeaderExtensions.clear();
    drawingLeaderExtensionsNeedRebuild = false;

    for (const emphasis of pipeVisualEmphasisObjects.values()) {
      try {
        (emphasis.body.geometry as BufferGeometry)?.dispose?.();
        emphasis.body.removeFromParent();
        (emphasis.spine.geometry as BufferGeometry)?.dispose?.();
        emphasis.spine.removeFromParent();
        for (const ring of emphasis.rings) {
          (ring.geometry as BufferGeometry)?.dispose?.();
          ring.removeFromParent();
        }
        for (const band of emphasis.bands) {
          (band.geometry as BufferGeometry)?.dispose?.();
          band.removeFromParent();
        }
        for (const rail of emphasis.rails) {
          (rail.geometry as BufferGeometry)?.dispose?.();
          rail.removeFromParent();
        }
        for (const outline of emphasis.outlines) {
          (outline.geometry as BufferGeometry)?.dispose?.();
          outline.removeFromParent();
        }
      } catch {
        // ignore
      }
    }
    pipeVisualEmphasisObjects.clear();

    for (const emphasis of fittingVisualEmphasisObjects.values()) {
      try {
        for (const coreRing of emphasis.coreRings) {
          (coreRing.geometry as BufferGeometry)?.dispose?.();
          coreRing.removeFromParent();
        }
        for (const portRing of emphasis.portRings) {
          (portRing.geometry as BufferGeometry)?.dispose?.();
          portRing.removeFromParent();
        }
        for (const arm of emphasis.arms) {
          (arm.geometry as BufferGeometry)?.dispose?.();
          arm.removeFromParent();
        }
      } catch {
        // ignore
      }
    }
    fittingVisualEmphasisObjects.clear();

    for (const flow of flowDirectionObjects.values()) {
      try {
        (flow.centerline.geometry as BufferGeometry)?.dispose?.();
        flow.centerline.removeFromParent();
        (flow.pulse.geometry as BufferGeometry)?.dispose?.();
        flow.pulse.removeFromParent();
        for (const arrow of flow.arrows) {
          (arrow.geometry as BufferGeometry)?.dispose?.();
          arrow.removeFromParent();
        }
      } catch {
        // ignore
      }
    }
    flowDirectionObjects.clear();
    for (const endpoint of branchFlowEndpointObjects.values()) {
      try {
        endpoint.marker.dispose();
        endpoint.marker.removeFromParent();
        (endpoint.halo.geometry as BufferGeometry)?.dispose?.();
        endpoint.halo.removeFromParent();
        endpoint.arrow.removeFromParent();
        (endpoint.guide.geometry as BufferGeometry)?.dispose?.();
        endpoint.guide.removeFromParent();
        (endpoint.pulse.geometry as BufferGeometry)?.dispose?.();
        endpoint.pulse.removeFromParent();
      } catch {
        // ignore
      }
    }
    branchFlowEndpointObjects.clear();
    stopFlowAnimation();

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
      const inlineTubeLengthHidden =
        !isMbdDrawingPresetRuntime() &&
        getDrawingLinearPlacement(ann) === 'inline-tube-length' &&
        !showInlineTubeLengthDims.value &&
        !showCutTubis.value;
      const kindVisible =
        (kind === 'segment' && showDimSegment.value) ||
        (kind === 'chain' && showDimChain.value) ||
        (kind === 'overall' && showDimOverall.value) ||
        (kind === 'port' && showDimPort.value);
      ann.visible =
        isVisible.value &&
        showDims.value &&
        kindVisible &&
        !declutterHidden &&
        !inlineTubeLengthHidden;
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
      const targetTagId = String((line.userData as any)?.mbdTargetTagId ?? '').trim();
      const targetTag = targetTagId ? tagAnnotations.get(targetTagId) : null;
      const targetHidden = targetTag
        ? !asRaw(targetTag).visible ||
          !!(asRaw(targetTag).userData as any)?.mbdDeclutterHidden
        : false;
      line.visible = isVisible.value && showLabels.value && !targetHidden;
    }
    for (const tubes of v2LeaderLineTubes.values()) {
      for (const tube of tubes) {
        const targetTagId = String((tube.userData as any)?.mbdTargetTagId ?? '').trim();
        const targetTag = targetTagId ? tagAnnotations.get(targetTagId) : null;
        const targetHidden = targetTag
          ? !asRaw(targetTag).visible ||
            !!(asRaw(targetTag).userData as any)?.mbdDeclutterHidden
          : false;
        tube.visible = isVisible.value && showLabels.value && !targetHidden;
      }
    }
    for (const line of v2LeaderExtensions.values()) {
      line.visible = isVisible.value && showLabels.value;
    }
    for (const tube of v2LeaderExtensionTubes.values()) {
      tube.visible = isVisible.value && showLabels.value;
    }

    const pipeEmphasisVisible = isVisible.value;
    for (const emphasis of pipeVisualEmphasisObjects.values()) {
      emphasis.body.visible = pipeEmphasisVisible;
      emphasis.spine.visible = pipeEmphasisVisible;
      for (const ring of emphasis.rings) {
        ring.visible = pipeEmphasisVisible;
      }
      for (const band of emphasis.bands) {
        band.visible = pipeEmphasisVisible;
      }
      for (const rail of emphasis.rails) {
        rail.visible = pipeEmphasisVisible;
      }
      for (const outline of emphasis.outlines) {
        outline.visible = pipeEmphasisVisible;
      }
    }
    for (const emphasis of fittingVisualEmphasisObjects.values()) {
      for (const coreRing of emphasis.coreRings) {
        coreRing.visible = pipeEmphasisVisible;
      }
      for (const portRing of emphasis.portRings) {
        portRing.visible = pipeEmphasisVisible;
      }
      for (const arm of emphasis.arms) {
        arm.visible = pipeEmphasisVisible;
      }
    }

    const flowVisible = isVisible.value && showFlowDirection.value;
    for (const flow of flowDirectionObjects.values()) {
      flow.centerline.visible = flowVisible;
      flow.pulse.visible = flowVisible;
      for (const arrow of flow.arrows) {
        arrow.visible = flowVisible;
      }
    }
    for (const endpoint of branchFlowEndpointObjects.values()) {
      endpoint.marker.visible = flowVisible;
      endpoint.marker.setLabelVisible(flowVisible);
      endpoint.halo.visible = flowVisible;
      endpoint.arrow.visible = flowVisible;
      endpoint.guide.visible = flowVisible;
      endpoint.pulse.visible = flowVisible;
    }
    syncFlowAnimation();

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
    for (const endpoint of branchFlowEndpointObjects.values()) {
      asRaw(endpoint.marker).setLabelRenderStyle(labelRenderStyle);
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
          ...getDrawingDimensionExtensionStyle(),
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

    if (renderSource.value === 'layout_result') {
      for (const tag of tagAnnotations.values()) {
        (asRaw(tag).userData as any).mbdDeclutterHidden = false;
      }
      return;
    }

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
    const annotation = new WeldAnnotation3D(
      materials,
      {
        position: anchor,
        label: text,
        subtitle: '',
        isShop: true,
        crossSize: 0,
        labelOffsetWorld: resolveFloatingLabelOffset(fitting.layout_hint, 120),
        labelRenderStyle,
      },
      mbdOnTopAnnotationOptions,
    );
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
          const angleDim = new AngleDimension3D(
            materials,
            {
              vertex: anchor,
              point1,
              point2,
              text:
                `${fitting.noun ?? 'ELBO'} ${Number(fitting.angle).toFixed(1)}°`,
              labelRenderStyle,
            },
            mbdOnTopAnnotationOptions,
          );
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
        labelOffsetWorld: resolveDrawingLaidOutLabelOffset(item.label_offset_world),
        text: String(item.text ?? ''),
        direction: direction ?? undefined,
        arrowStyle: modeConfig.arrowStyle,
        arrowSizePx: modeConfig.arrowSizePx,
        arrowAngleDeg: modeConfig.arrowAngleDeg,
        extensionOvershootPx: modeConfig.extensionOvershootPx,
        ...getDrawingDimensionExtensionStyle(),
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
      (dim.userData as any).mbdLayoutLabelRole =
        item.layout_hint?.label_role ?? item.source_sub_kind ?? item.kind ?? null;
      (dim.userData as any).mbdLayoutOffsetLevel =
        Number(item.layout_hint?.offset_level ?? 0) || 0;
      (dim.userData as any).mbdDrawingLinearPlacement =
        resolveDrawingLinearPlacement(item);
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
  ): MbdPipeDebugScreenBox {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const maxLineLength = Math.max(1, ...lines.map((line) => line.length));
    const width = clampNumber(maxLineLength * 13 + 40, 64, 360, 96);
    const height = clampNumber(Math.max(1, lines.length) * 28 + 16, 38, 170, 44);
    return {
      x: center.x,
      y: center.y,
      width,
      height,
      left: center.x - width * 0.5,
      right: center.x + width * 0.5,
      top: center.y - height * 0.5,
      bottom: center.y + height * 0.5,
    };
  }

  function labelBoxesOverlap(
    a: MbdPipeDebugScreenBox,
    b: MbdPipeDebugScreenBox,
  ): boolean {
    const margin = isMbdDrawingPresetRuntime() ? 24 : 10;
    return !(
      a.right + margin < b.left ||
      a.left - margin > b.right ||
      a.bottom + margin < b.top ||
      a.top - margin > b.bottom
    );
  }

  function screenBoxOverlapArea(
    a: MbdPipeDebugScreenBox,
    b: MbdPipeDebugScreenBox,
  ): number {
    const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return width * height;
  }

  function screenBoxGapPx(
    a: MbdPipeDebugScreenBox,
    b: MbdPipeDebugScreenBox,
  ): number {
    const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
    const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
    return Math.hypot(dx, dy);
  }

  function drawingNearBoxPenalty(
    a: MbdPipeDebugScreenBox,
    b: MbdPipeDebugScreenBox,
    minGapPx: number,
  ): number {
    if (!isMbdDrawingPresetRuntime() || minGapPx <= 0) return 0;
    const gap = screenBoxGapPx(a, b);
    if (gap >= minGapPx) return 0;
    const ratio = (minGapPx - gap) / minGapPx;
    return ratio * ratio;
  }

  function drawingPlacedLabelConflictPenalty(
    box: MbdPipeDebugScreenBox,
    placedBox: MbdPipeDebugScreenBox,
    minGapPx = 52,
  ): number {
    const overlapArea = screenBoxOverlapArea(box, placedBox);
    const nearPenalty = drawingNearBoxPenalty(box, placedBox, minGapPx);
    if (overlapArea <= 0) return nearPenalty * 4_000;
    const minArea = Math.max(1, Math.min(
      box.width * box.height,
      placedBox.width * placedBox.height,
    ));
    const overlapRatio = overlapArea / minArea;
    return 500_000 + overlapRatio * 1_500_000 + Math.min(overlapArea, 20_000) * 40;
  }

  function screenSegmentIntersectsBox(
    start: { x: number; y: number },
    end: { x: number; y: number },
    box: MbdPipeDebugScreenBox,
    paddingPx = 0,
  ): boolean {
    const left = box.left - paddingPx;
    const right = box.right + paddingPx;
    const top = box.top - paddingPx;
    const bottom = box.bottom + paddingPx;
    if (right <= left || bottom <= top) return false;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-9) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };

    return (
      clip(-dx, start.x - left) &&
      clip(dx, right - start.x) &&
      clip(-dy, start.y - top) &&
      clip(dy, bottom - start.y) &&
      t1 >= t0
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
    const placed: MbdPipeDebugScreenBox[] = [];

    for (const dim of dimAnnotations.values()) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible) continue;
      const kind = ((rawDim.userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind;
      if (kind !== 'chain' && kind !== 'overall') continue;

      let chosenOffset: Vector3 | null = null;
      let chosenBox: MbdPipeDebugScreenBox | null = null;
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

  function readScreenDeclutterBaseOffset(
    annotation: LinearDimension3D | WeldAnnotation3D,
  ): Vector3 | null {
    const userData = annotation.userData as any;
    if (!Object.prototype.hasOwnProperty.call(userData, 'mbdScreenBaseLabelOffset')) {
      const baseOffset = annotation.getParams().labelOffsetWorld;
      userData.mbdScreenBaseLabelOffset = baseOffset
        ? [baseOffset.x, baseOffset.y, baseOffset.z]
        : null;
    }
    return toVector3(userData.mbdScreenBaseLabelOffset ?? null);
  }

  function addNullableOffset(base: Vector3 | null, offset: Vector3): Vector3 | null {
    if (base) return base.clone().add(offset);
    return offset.lengthSq() > 1e-12 ? offset.clone() : null;
  }

  function worldOffsetToGroupLocalOffset(offsetWorld: Vector3): Vector3 {
    group.updateMatrixWorld(true);
    const originWorld = group.localToWorld(new Vector3(0, 0, 0));
    const originLocal = group.worldToLocal(originWorld.clone());
    const targetLocal = group.worldToLocal(originWorld.clone().add(offsetWorld));
    return targetLocal.sub(originLocal);
  }

  function screenOffsetToWorldOffset(
    baseWorld: Vector3,
    offsetPx: { dx: number; dy: number },
    camera: Camera,
    viewport: { width: number; height: number },
  ): Vector3 | null {
    const baseScreen = projectLabelToScreen(baseWorld, camera, viewport);
    if (!baseScreen) return null;
    const baseNdc = baseWorld.clone().project(camera);
    if (
      !Number.isFinite(baseNdc.x) ||
      !Number.isFinite(baseNdc.y) ||
      !Number.isFinite(baseNdc.z)
    ) {
      return null;
    }
    const targetScreen = {
      x: baseScreen.x + offsetPx.dx,
      y: baseScreen.y + offsetPx.dy,
    };
    const targetNdc = new Vector3(
      (targetScreen.x / viewport.width) * 2 - 1,
      -(targetScreen.y / viewport.height) * 2 + 1,
      baseNdc.z,
    );
    const targetWorld = targetNdc.unproject(camera);
    return targetWorld.sub(baseWorld);
  }

  function screenPointToWorldAtDepth(
    depthRefWorld: Vector3,
    screen: { x: number; y: number },
    camera: Camera,
    viewport: { width: number; height: number },
  ): Vector3 | null {
    const refNdc = depthRefWorld.clone().project(camera);
    if (
      !Number.isFinite(refNdc.x) ||
      !Number.isFinite(refNdc.y) ||
      !Number.isFinite(refNdc.z)
    ) {
      return null;
    }
    return new Vector3(
      (screen.x / viewport.width) * 2 - 1,
      -(screen.y / viewport.height) * 2 + 1,
      refNdc.z,
    ).unproject(camera);
  }

  function worldDirectionToLocalDirection(
    object: LinearDimension3D,
    directionWorld: Vector3,
  ): Vector3 | null {
    if (directionWorld.lengthSq() < 1e-12) return null;
    object.updateMatrixWorld(true);
    const inverse = new Matrix4().copy(object.matrixWorld).invert();
    const local = directionWorld.clone().normalize().transformDirection(inverse);
    return local.lengthSq() > 1e-12 ? local.normalize() : null;
  }

  function createDrawingProjectedOffsetLinearGeometry(
    dim: LinearDimension3D,
    targetId: string,
    startWorld: Vector3,
    endWorld: Vector3,
    startScreen: { x: number; y: number },
    endScreen: { x: number; y: number },
    labelScreen: { x: number; y: number },
    camera: Camera,
    viewport: { width: number; height: number },
    drawingModelBoxes: MbdPipeDebugScreenBox[],
    drawingKeepoutBoxes: MbdPipeDebugScreenBox[] = [],
  ): LinearDimension3DLaidOutGeometry | null {
    const dx = endScreen.x - startScreen.x;
    const dy = endScreen.y - startScreen.y;
    const spanPx = Math.hypot(dx, dy);
    if (spanPx < 8) return null;

    const ux = dx / spanPx;
    const uy = dy / spanPx;
    const midScreen = {
      x: (startScreen.x + endScreen.x) * 0.5,
      y: (startScreen.y + endScreen.y) * 0.5,
    };
    const text = dim.getDisplayText();
    const normals = [
      { x: -uy, y: ux },
      { x: uy, y: -ux },
    ];
    const diagonalProjectedLine = Math.abs(ux) > 0.35 && Math.abs(uy) > 0.35;
    const firstLayerTubeLength =
      targetId.startsWith('cut_tubi:') || /:piece:\d+(?::|$)/.test(targetId);
    const overallChainLength =
      targetId.startsWith('dim:chain:') &&
      getDrawingLinearPlacement(dim) === 'external-chain';
    const gapCandidates = diagonalProjectedLine
      ? overallChainLength
        ? [142, 178, 226, 288, 360, 440]
        : firstLayerTubeLength
          ? [76, 98, 126, 166, 218, 288]
          : [110, 145, 190, 250, 330]
      : overallChainLength
        ? [116, 148, 188, 240, 304, 382]
        : firstLayerTubeLength
          ? [54, 72, 96, 128, 168, 220]
          : [84, 112, 148, 188, 236, 292];
    const textGapPx = overallChainLength ? 58 : firstLayerTubeLength ? 24 : 30;
    const extensionStubPx = overallChainLength ? 12 : 8;

    let best: {
      lineStart: { x: number; y: number };
      lineEnd: { x: number; y: number };
      extensionStart: { x: number; y: number };
      extensionEnd: { x: number; y: number };
      extension2Start: { x: number; y: number };
      extension2End: { x: number; y: number };
      textAnchor: { x: number; y: number };
      score: number;
    } | null = null;

    for (const normal of normals) {
      const preferredSide =
        (labelScreen.x - midScreen.x) * normal.x +
        (labelScreen.y - midScreen.y) * normal.y;
      for (const gapPx of gapCandidates) {
        let lineStart = {
          x: startScreen.x + normal.x * gapPx,
          y: startScreen.y + normal.y * gapPx,
        };
        let lineEnd = {
          x: endScreen.x + normal.x * gapPx,
          y: endScreen.y + normal.y * gapPx,
        };
        const minSpanPx = 58;
        if (spanPx < minSpanPx) {
          const center = {
            x: (lineStart.x + lineEnd.x) * 0.5,
            y: (lineStart.y + lineEnd.y) * 0.5,
          };
          lineStart = {
            x: center.x - ux * minSpanPx * 0.5,
            y: center.y - uy * minSpanPx * 0.5,
          };
          lineEnd = {
            x: center.x + ux * minSpanPx * 0.5,
            y: center.y + uy * minSpanPx * 0.5,
          };
        }

        const textAnchor = {
          x: midScreen.x + normal.x * (gapPx + textGapPx),
          y: midScreen.y + normal.y * (gapPx + textGapPx),
        };
        const lineBox = expandScreenBox({
          x: (lineStart.x + lineEnd.x) * 0.5,
          y: (lineStart.y + lineEnd.y) * 0.5,
          width: Math.max(1, Math.abs(lineEnd.x - lineStart.x)),
          height: Math.max(1, Math.abs(lineEnd.y - lineStart.y)),
          left: Math.min(lineStart.x, lineEnd.x),
          right: Math.max(lineStart.x, lineEnd.x),
          top: Math.min(lineStart.y, lineEnd.y),
          bottom: Math.max(lineStart.y, lineEnd.y),
        }, 3);
        const textBox = labelScreenBox(textAnchor, text);
        const modelPenalty = drawingModelBoxes.reduce((sum, box) => {
          const lineCrosses = screenSegmentIntersectsBox(lineStart, lineEnd, box, 12);
          const textOverlap = screenBoxOverlapArea(expandScreenBox(textBox, 3), box);
          return sum + (lineCrosses ? 5_000_000 : 0) + textOverlap * 160;
        }, 0);
        const keepoutPenalty = drawingKeepoutBoxes.reduce((sum, box) => {
          const lineCrosses = screenSegmentIntersectsBox(lineStart, lineEnd, box, 16);
          const textOverlap = screenBoxOverlapArea(expandScreenBox(textBox, 8), box);
          const textNear = drawingNearBoxPenalty(textBox, box, 56);
          return sum +
            (lineCrosses ? 180_000 : 0) +
            textOverlap * 120 +
            textNear * 95_000;
        }, 0);
        const outsideBasePenalty =
          screenOutsidePenalty(lineBox, viewport) +
          screenOutsidePenalty(textBox, viewport);
        const outsidePenalty =
          outsideBasePenalty > 0 ? outsideBasePenalty + 10_000_000 : 0;
        const sidePenalty = preferredSide >= -4 ? 0 : 160;
        const distancePenalty = gapPx;
        const score =
          modelPenalty +
          keepoutPenalty +
          outsidePenalty +
          sidePenalty +
          distancePenalty;
        if (!best || score < best.score) {
          best = {
            lineStart,
            lineEnd,
            extensionStart: {
              x: startScreen.x + normal.x * extensionStubPx,
              y: startScreen.y + normal.y * extensionStubPx,
            },
            extensionEnd: {
              x: startScreen.x + normal.x * gapPx,
              y: startScreen.y + normal.y * gapPx,
            },
            extension2Start: {
              x: endScreen.x + normal.x * extensionStubPx,
              y: endScreen.y + normal.y * extensionStubPx,
            },
            extension2End: {
              x: endScreen.x + normal.x * gapPx,
              y: endScreen.y + normal.y * gapPx,
            },
            textAnchor,
            score,
          };
        }
      }
    }
    if (!best) return null;

    const depthRef = startWorld.clone().lerp(endWorld, 0.5);
    const dimStartWorld = screenPointToWorldAtDepth(depthRef, best.lineStart, camera, viewport);
    const dimEndWorld = screenPointToWorldAtDepth(depthRef, best.lineEnd, camera, viewport);
    const extensionStartWorld = screenPointToWorldAtDepth(
      depthRef,
      best.extensionStart,
      camera,
      viewport,
    );
    const extensionEndWorld = screenPointToWorldAtDepth(
      depthRef,
      best.extensionEnd,
      camera,
      viewport,
    );
    const extension2StartWorld = screenPointToWorldAtDepth(
      depthRef,
      best.extension2Start,
      camera,
      viewport,
    );
    const extension2EndWorld = screenPointToWorldAtDepth(
      depthRef,
      best.extension2End,
      camera,
      viewport,
    );
    const textAnchorWorld = screenPointToWorldAtDepth(
      depthRef,
      best.textAnchor,
      camera,
      viewport,
    );
    if (
      !dimStartWorld ||
      !dimEndWorld ||
      !extensionStartWorld ||
      !extensionEndWorld ||
      !extension2StartWorld ||
      !extension2EndWorld ||
      !textAnchorWorld
    ) {
      return null;
    }

    const dimDirWorld = dimEndWorld.clone().sub(dimStartWorld);
    const dimDirLocal = worldDirectionToLocalDirection(dim, dimDirWorld);
    if (!dimDirLocal) return null;
    const toLocal = (point: Vector3) => dim.worldToLocal(point.clone());
    return {
      dimLineStart: toLocal(dimStartWorld),
      dimLineEnd: toLocal(dimEndWorld),
      extensionLine1Start: toLocal(extensionStartWorld),
      extensionLine1End: toLocal(extensionEndWorld),
      extensionLine2Start: toLocal(extension2StartWorld),
      extensionLine2End: toLocal(extension2EndWorld),
      textAnchor: toLocal(textAnchorWorld),
      arrows: [
        {
          position: toLocal(dimStartWorld),
          direction: dimDirLocal.clone(),
        },
        {
          position: toLocal(dimEndWorld),
          direction: dimDirLocal.clone().multiplyScalar(-1),
        },
      ],
      screenFacingArrows: true,
    };
  }

  function createDrawingExternalLinearGeometry(
    dim: LinearDimension3D,
    targetId: string,
    finalLabelWorld: Vector3,
    camera: Camera,
    viewport: { width: number; height: number },
    drawingModelBoxes: MbdPipeDebugScreenBox[] = [],
    drawingKeepoutBoxes: MbdPipeDebugScreenBox[] = [],
  ): LinearDimension3DLaidOutGeometry | null {
    if (!isMbdDrawingPresetRuntime()) return null;
    const params = dim.getParams();
    dim.updateMatrixWorld(true);

    const startWorld = dim.localToWorld(params.start.clone());
    const endWorld = dim.localToWorld(params.end.clone());
    const startScreen = projectLabelToScreen(startWorld, camera, viewport);
    const endScreen = projectLabelToScreen(endWorld, camera, viewport);
    const labelScreen = projectLabelToScreen(finalLabelWorld, camera, viewport);
    if (!startScreen || !endScreen || !labelScreen) return null;

    const drawingPlacement = getDrawingLinearPlacement(dim);
    if (
      isDrawingInlineTubeLengthTarget(targetId, dim) ||
      (drawingPlacement === 'external-chain' && targetId.startsWith('dim:chain:'))
    ) {
      return createDrawingProjectedOffsetLinearGeometry(
        dim,
        targetId,
        startWorld,
        endWorld,
        startScreen,
        endScreen,
        labelScreen,
        camera,
        viewport,
        drawingModelBoxes,
        drawingKeepoutBoxes,
      );
    }

    const dx = endScreen.x - startScreen.x;
    const dy = endScreen.y - startScreen.y;
    const isPortDimension = targetId.startsWith('dim:port:');
    const isCutTubiDimension = targetId.startsWith('cut_tubi:');
    const horizontal = !isPortDimension && Math.abs(dx) >= Math.abs(dy);
    const minSpanPx = 56;
    const endpointLeft = Math.min(startScreen.x, endScreen.x);
    const endpointRight = Math.max(startScreen.x, endScreen.x);
    const cutTubiLabelDetached =
      isCutTubiDimension &&
      (labelScreen.x < endpointLeft - 120 || labelScreen.x > endpointRight + 120);
    let dimStartScreen: { x: number; y: number };
    let dimEndScreen: { x: number; y: number };
    let textAnchorScreen: { x: number; y: number };

    if (horizontal) {
      let x1 = startScreen.x;
      let x2 = endScreen.x;
      if (cutTubiLabelDetached) {
        const detachedSpanPx = clampNumber(
          Math.abs(endpointRight - endpointLeft),
          86,
          132,
          104,
        );
        x1 = labelScreen.x - detachedSpanPx * 0.5;
        x2 = labelScreen.x + detachedSpanPx * 0.5;
      }
      if (Math.abs(x2 - x1) < minSpanPx) {
        const midX = (x1 + x2) * 0.5;
        x1 = midX - minSpanPx * 0.5;
        x2 = midX + minSpanPx * 0.5;
      }
      const lineGapPx = resolveDrawingDimensionLineGapPx({
        targetId,
        axis: 'horizontal',
        sign: labelScreen.y >= viewport.height * 0.5 ? 1 : -1,
        baseGapPx: cutTubiLabelDetached ? 42 : 34,
        labelScreen,
        lineStartScreen: { x: x1, y: labelScreen.y },
        lineEndScreen: { x: x2, y: labelScreen.y },
        viewport,
        drawingModelBoxes,
      });
      const lineY = labelScreen.y + lineGapPx;
      dimStartScreen = { x: x1, y: lineY };
      dimEndScreen = { x: x2, y: lineY };
      const textGapPx = 26;
      textAnchorScreen = {
        x: (dimStartScreen.x + dimEndScreen.x) * 0.5,
        y: lineY - Math.sign(lineGapPx || -1) * textGapPx,
      };
    } else {
      let y1 = startScreen.y;
      let y2 = endScreen.y;
      if (isPortDimension) {
        const portSpanPx = 96;
        y1 = labelScreen.y - portSpanPx * 0.5;
        y2 = labelScreen.y + portSpanPx * 0.5;
      } else if (Math.abs(y2 - y1) < minSpanPx) {
        const midY = (y1 + y2) * 0.5;
        y1 = midY - minSpanPx * 0.5;
        y2 = midY + minSpanPx * 0.5;
      }
      const lineGapPx = resolveDrawingDimensionLineGapPx({
        targetId,
        axis: 'vertical',
        sign: labelScreen.x >= viewport.width * 0.5 ? 1 : -1,
        baseGapPx: 44,
        labelScreen,
        lineStartScreen: { x: labelScreen.x, y: y1 },
        lineEndScreen: { x: labelScreen.x, y: y2 },
        viewport,
        drawingModelBoxes,
      });
      const lineX = labelScreen.x + lineGapPx;
      dimStartScreen = { x: lineX, y: y1 };
      dimEndScreen = { x: lineX, y: y2 };
      const textGapPx = 32;
      textAnchorScreen = {
        x: lineX - Math.sign(lineGapPx || -1) * textGapPx,
        y: (dimStartScreen.y + dimEndScreen.y) * 0.5,
      };
    }

    const clampStubDelta = (delta: number): number => {
      const abs = Math.abs(delta);
      if (abs <= 8) return 0;
      return Math.sign(delta) * Math.min(abs, 32);
    };
    const extensionStartScreen = horizontal
      ? cutTubiLabelDetached
        ? {
          x: dimStartScreen.x,
          y: dimStartScreen.y + (labelScreen.y >= viewport.height * 0.5 ? 18 : -18),
        }
        : {
          x: dimStartScreen.x,
          y: dimStartScreen.y + clampStubDelta(startScreen.y - dimStartScreen.y),
        }
      : {
        x: dimStartScreen.x + clampStubDelta(startScreen.x - dimStartScreen.x),
        y: dimStartScreen.y,
      };
    const extensionEndScreen = horizontal
      ? cutTubiLabelDetached
        ? {
          x: dimEndScreen.x,
          y: dimEndScreen.y + (labelScreen.y >= viewport.height * 0.5 ? 18 : -18),
        }
        : {
          x: dimEndScreen.x,
          y: dimEndScreen.y + clampStubDelta(endScreen.y - dimEndScreen.y),
        }
      : {
        x: dimEndScreen.x + clampStubDelta(endScreen.x - dimEndScreen.x),
        y: dimEndScreen.y,
      };

    const depthRef = startWorld.clone().lerp(endWorld, 0.5);
    const dimStartWorld = screenPointToWorldAtDepth(
      depthRef,
      dimStartScreen,
      camera,
      viewport,
    );
    const dimEndWorld = screenPointToWorldAtDepth(
      depthRef,
      dimEndScreen,
      camera,
      viewport,
    );
    const extensionStartWorld = screenPointToWorldAtDepth(
      depthRef,
      extensionStartScreen,
      camera,
      viewport,
    );
    const extensionEndWorld = screenPointToWorldAtDepth(
      depthRef,
      extensionEndScreen,
      camera,
      viewport,
    );
    const textAnchorWorld = screenPointToWorldAtDepth(
      depthRef,
      textAnchorScreen,
      camera,
      viewport,
    );
    if (
      !dimStartWorld ||
      !dimEndWorld ||
      !extensionStartWorld ||
      !extensionEndWorld ||
      !textAnchorWorld
    ) {
      return null;
    }
    const dimDirWorld = dimEndWorld.clone().sub(dimStartWorld);
    const dimDirLocal = worldDirectionToLocalDirection(dim, dimDirWorld);
    if (!dimDirLocal) return null;

    const toLocal = (point: Vector3) => dim.worldToLocal(point.clone());
    return {
      dimLineStart: toLocal(dimStartWorld),
      dimLineEnd: toLocal(dimEndWorld),
      extensionLine1Start: toLocal(extensionStartWorld),
      extensionLine1End: toLocal(dimStartWorld),
      extensionLine2Start: toLocal(extensionEndWorld),
      extensionLine2End: toLocal(dimEndWorld),
      textAnchor: toLocal(textAnchorWorld),
      arrows: [
        {
          position: toLocal(dimStartWorld),
          direction: dimDirLocal.clone(),
        },
        {
          position: toLocal(dimEndWorld),
          direction: dimDirLocal.clone().multiplyScalar(-1),
        },
      ],
      screenFacingArrows: true,
    };
  }

  function estimatePixelsPerWorldUnit(
    point: Vector3,
    camera: Camera,
    viewport: { width: number; height: number },
    cameraRight: Vector3,
    cameraUp: Vector3,
  ): number {
    const origin = projectLabelToScreen(point, camera, viewport);
    const right = projectLabelToScreen(point.clone().add(cameraRight), camera, viewport);
    const up = projectLabelToScreen(point.clone().add(cameraUp), camera, viewport);
    if (!origin || !right || !up) return 120;
    const rightPx = Math.hypot(right.x - origin.x, right.y - origin.y);
    const upPx = Math.hypot(up.x - origin.x, up.y - origin.y);
    return clampNumber(Math.max(rightPx, upPx), 20, 450, 120);
  }

  function layoutScreenPriority(id: string, kind: MbdPipeDebugScreenItem['kind']): number {
    if ((kind === 'dim' && /:piece:\d+(?::|$)/.test(id)) || kind === 'cut_tubi') return 0;
    if (kind === 'dim' && !id.startsWith('dim:port:')) return 1;
    if (id.startsWith('tag:position:')) return 2;
    if (id.startsWith('tag:branch:')) return 3;
    if (id.startsWith('tag:fitting:')) return 4;
    if (id.startsWith('dim:port:')) return 5;
    if (id.startsWith('tag:elevation:')) return 6;
    if (id.startsWith('tag:tubi:')) return 7;
    if (id.startsWith('tag:material:')) return 8;
    return kind === 'tag' ? 9 : 10;
  }

  function isAutoHideableLayoutScreenTag(id: string): boolean {
    return (
      id.startsWith('tag:material:') ||
      id.startsWith('tag:elevation:') ||
      id.startsWith('tag:tubi:') ||
      id.startsWith('tag:fitting:')
    );
  }

  function setLayoutTagScreenLodHidden(id: string, hidden: boolean): void {
    const tag = tagAnnotations.get(id);
    if (!tag) return;
    const raw = asRaw(tag);
    (raw.userData as any).mbdScreenLodHidden = hidden;
    (raw.userData as any).mbdDeclutterHidden = hidden;
  }

  function collectLayoutScreenLodItems(
    camera: Camera,
    viewport: { width: number; height: number },
    hiddenTagIds: Set<string>,
  ): MbdPipeDebugScreenItem[] {
    const items: MbdPipeDebugScreenItem[] = [];
    const append = (
      id: string,
      kind: MbdPipeDebugScreenItem['kind'],
      text: string,
      labelWorldPos: Vector3 | null,
    ): void => {
      if (!labelWorldPos || String(text).trim().length === 0) return;
      const screen = projectLabelToScreen(labelWorldPos, camera, viewport);
      if (!screen) return;
      const box = labelScreenBox(screen, text);
      const margin = 24;
      items.push({
        id,
        kind,
        text,
        x: screen.x,
        y: screen.y,
        box,
        in_viewport:
          box.right >= -margin &&
          box.bottom >= -margin &&
          box.left <= viewport.width + margin &&
          box.top <= viewport.height + margin,
      });
    };

    for (const [id, dim] of dimAnnotations.entries()) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible || !!(rawDim.userData as any)?.mbdDeclutterHidden) continue;
      append(id, 'dim', dim.getDisplayText(), getAnnotationLabelWorldPos(rawDim));
    }
    for (const [id, dim] of cutTubiAnnotations.entries()) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible || !!(rawDim.userData as any)?.mbdDeclutterHidden) continue;
      append(id, 'cut_tubi', dim.getDisplayText(), getAnnotationLabelWorldPos(rawDim));
    }
    for (const [id, tag] of tagAnnotations.entries()) {
      if (hiddenTagIds.has(id)) continue;
      const rawTag = asRaw(tag);
      if (!rawTag.visible || !!(rawTag.userData as any)?.mbdLayoutHidden) continue;
      const params = rawTag.getParams();
      const label = String(params.label ?? '').trim();
      const subtitle = String(params.subtitle ?? '').trim();
      append(
        id,
        'tag',
        subtitle ? `${label}\n${subtitle}` : label,
        getAnnotationLabelWorldPos(rawTag),
      );
    }
    return items.filter((item) => item.in_viewport);
  }

  function chooseLayoutScreenLodHideTarget(
    a: MbdPipeDebugScreenItem,
    b: MbdPipeDebugScreenItem,
  ): string | null {
    const aHideable = a.kind === 'tag' && isAutoHideableLayoutScreenTag(a.id);
    const bHideable = b.kind === 'tag' && isAutoHideableLayoutScreenTag(b.id);
    if (!aHideable && !bHideable) return null;
    if (aHideable && !bHideable) return a.id;
    if (!aHideable && bHideable) return b.id;
    const aPriority = layoutScreenPriority(a.id, a.kind);
    const bPriority = layoutScreenPriority(b.id, b.kind);
    if (aPriority !== bPriority) return aPriority > bPriority ? a.id : b.id;
    return a.box.width * a.box.height <= b.box.width * b.box.height ? a.id : b.id;
  }

  function applyLayoutResultScreenLod(
    camera: Camera,
    viewport: { width: number; height: number },
  ): void {
    if (renderSource.value !== 'layout_result' || isMbdDrawingPresetRuntime()) return;
    if (tagAnnotations.size <= 0) return;

    for (const [id, tag] of tagAnnotations.entries()) {
      if (!isAutoHideableLayoutScreenTag(id)) continue;
      const rawTag = asRaw(tag);
      if ((rawTag.userData as any).mbdScreenLodHidden) {
        setLayoutTagScreenLodHidden(id, false);
      }
    }

    const hiddenTagIds = new Set<string>();
    const maxIterations = Math.max(1, tagAnnotations.size);
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const items = collectLayoutScreenLodItems(camera, viewport, hiddenTagIds);
      let bestPair:
        | {
          a: MbdPipeDebugScreenItem;
          b: MbdPipeDebugScreenItem;
          ratio: number;
        }
        | null = null;
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i]!;
          const b = items[j]!;
          const overlapArea = screenBoxOverlapArea(a.box, b.box);
          if (overlapArea <= 0) continue;
          const aArea = Math.max(1, a.box.width * a.box.height);
          const bArea = Math.max(1, b.box.width * b.box.height);
          const ratio = overlapArea / Math.min(aArea, bArea);
          if (ratio < 0.35) continue;
          if (!bestPair || ratio > bestPair.ratio) {
            bestPair = { a, b, ratio };
          }
        }
      }
      if (!bestPair) break;
      const hideId = chooseLayoutScreenLodHideTarget(bestPair.a, bestPair.b);
      if (!hideId || hiddenTagIds.has(hideId)) break;
      hiddenTagIds.add(hideId);
      setLayoutTagScreenLodHidden(hideId, true);
    }
  }

  function makeLayoutScreenOffsetCandidates(): { dx: number; dy: number }[] {
    const candidates: { dx: number; dy: number }[] = [{ dx: 0, dy: 0 }];
    const rings = [
      { x: 72, y: 44 },
      { x: 128, y: 80 },
      { x: 210, y: 132 },
      { x: 320, y: 200 },
    ];
    for (const ring of rings) {
      candidates.push(
        { dx: 0, dy: -ring.y },
        { dx: 0, dy: ring.y },
        { dx: ring.x, dy: 0 },
        { dx: -ring.x, dy: 0 },
        { dx: ring.x, dy: -ring.y },
        { dx: -ring.x, dy: -ring.y },
        { dx: ring.x, dy: ring.y },
        { dx: -ring.x, dy: ring.y },
      );
    }
    return candidates;
  }

  function clampNearAnchorScreenCandidate(
    candidate: { dx: number; dy: number },
  ): { dx: number; dy: number } {
    const drawingPreset = isMbdDrawingPresetRuntime();
    const maxX = drawingPreset ? 340 : 420;
    const maxY = drawingPreset ? 260 : 320;
    return {
      dx: clampNumber(candidate.dx, -maxX, maxX, 0),
      dy: clampNumber(candidate.dy, -maxY, maxY, 0),
    };
  }

  function drawingExternalGeometryKey(
    camera: Camera,
    viewport: { width: number; height: number },
  ): string {
    camera.updateMatrixWorld?.(true);
    const e = camera.matrixWorld.elements;
    return [
      Math.round(viewport.width),
      Math.round(viewport.height),
      e[12]?.toFixed(2),
      e[13]?.toFixed(2),
      e[14]?.toFixed(2),
      camera.rotation.x.toFixed(4),
      camera.rotation.y.toFixed(4),
      camera.rotation.z.toFixed(4),
      camera.zoom?.toFixed(4) ?? '1',
    ].join(':');
  }

  function resolveDrawingDimensionLineGapPx(args: {
    targetId: string;
    axis: 'horizontal' | 'vertical';
    sign: 1 | -1;
    baseGapPx: number;
    labelScreen: { x: number; y: number };
    lineStartScreen: { x: number; y: number };
    lineEndScreen: { x: number; y: number };
    viewport: { width: number; height: number };
    drawingModelBoxes: MbdPipeDebugScreenBox[];
  }): number {
    const { axis, sign, labelScreen, viewport, drawingModelBoxes } = args;
    const baseGapPx = args.baseGapPx;
    if (drawingModelBoxes.length <= 0) return sign * baseGapPx;

    const gapCandidates = [
      baseGapPx,
      baseGapPx + 24,
      baseGapPx + 48,
      baseGapPx + 72,
      baseGapPx + 96,
      baseGapPx + 128,
    ];
    let bestGap = sign * baseGapPx;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const gapAbs of gapCandidates) {
      const gap = sign * gapAbs;
      const start = { ...args.lineStartScreen };
      const end = { ...args.lineEndScreen };
      if (axis === 'horizontal') {
        start.y = labelScreen.y + gap;
        end.y = labelScreen.y + gap;
      } else {
        start.x = labelScreen.x + gap;
        end.x = labelScreen.x + gap;
      }
      const lineBox: MbdPipeDebugScreenBox = {
        x: (start.x + end.x) * 0.5,
        y: (start.y + end.y) * 0.5,
        width: Math.max(1, Math.abs(end.x - start.x)),
        height: Math.max(1, Math.abs(end.y - start.y)),
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y),
      };
      const keepoutPenalty = drawingModelBoxes.reduce((sum, box) => {
        if (!screenSegmentIntersectsBox(start, end, box, 10)) return sum;
        return sum + 100_000 + screenBoxOverlapArea(expandScreenBox(lineBox, 3), box);
      }, 0);
      const outsidePenalty = screenOutsidePenalty(expandScreenBox(lineBox, 2), viewport);
      const distancePenalty = Math.abs(gapAbs - baseGapPx) * 3;
      const score = keepoutPenalty + outsidePenalty + distancePenalty;
      if (score < bestScore) {
        bestScore = score;
        bestGap = gap;
      }
      if (keepoutPenalty <= 0 && outsidePenalty <= 0) break;
    }
    return bestGap;
  }

  function trailingAnnotationIndex(id: string): number | null {
    const match = /:(\d+)$/.exec(id);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function tubiTagLayoutIndex(id: string): number | null {
    if (!id.startsWith('tag:tubi:')) return null;
    const data = currentData.value;
    const layoutTagIds = (data?.layout_result?.tags ?? [])
      .filter((tag) => classifyLaidOutTag(tag) === 'tubi')
      .map((tag) => tag.id);
    let index = layoutTagIds.indexOf(id);
    if (index >= 0) return index;

    const rawTagIds = (data?.tags ?? [])
      .filter((tag) => classifyTag(tag) === 'tubi')
      .map((tag) => tag.id);
    index = rawTagIds.indexOf(id);
    if (index >= 0) return index;

    const renderedTubiIds = Array.from(tagAnnotations.entries())
      .filter(([, tag]) => ((asRaw(tag).userData as any)?.mbdTagKind ?? null) === 'tubi')
      .map(([tagId]) => tagId)
      .sort((a, b) => a.localeCompare(b));
    index = renderedTubiIds.indexOf(id);
    return index >= 0 ? index : null;
  }

  function elevationTagLayoutIndex(id: string): number | null {
    if (!id.startsWith('tag:elevation:')) return null;
    const data = currentData.value;
    const layoutTagIds = (data?.layout_result?.tags ?? [])
      .filter((tag) => classifyLaidOutTag(tag) === 'elevation')
      .map((tag) => tag.id);
    let index = layoutTagIds.indexOf(id);
    if (index >= 0) return index;

    const rawTagIds = (data?.tags ?? [])
      .filter((tag) => classifyTag(tag) === 'elevation')
      .map((tag) => tag.id);
    index = rawTagIds.indexOf(id);
    if (index >= 0) return index;

    const renderedElevationIds = Array.from(tagAnnotations.entries())
      .filter(([, tag]) => ((asRaw(tag).userData as any)?.mbdTagKind ?? null) === 'elevation')
      .map(([tagId]) => tagId)
      .sort((a, b) => a.localeCompare(b));
    index = renderedElevationIds.indexOf(id);
    return index >= 0 ? index : null;
  }

  function materialTagItemNo(id: string): number | null {
    const match = /^tag:material:(\d+):/.exec(id);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function preferredLayoutScreenOffsetCandidates(
    id: string,
  ): { dx: number; dy: number }[] {
    const index = trailingAnnotationIndex(id);
    const tubiIndex = tubiTagLayoutIndex(id);
    if (id.startsWith('dim:chain:') && index === 0) {
      return [
        { dx: 0, dy: -40 },
        { dx: 48, dy: -40 },
        { dx: -48, dy: -40 },
        { dx: 0, dy: -52 },
        { dx: 64, dy: -52 },
        { dx: -64, dy: -52 },
      ];
    }
    if (id.startsWith('dim:port:') && index === 0) {
      return [
        { dx: 2600, dy: 1600 },
        { dx: -2600, dy: 1600 },
        { dx: 3200, dy: 0 },
        { dx: -3200, dy: 0 },
      ];
    }
    if (id.startsWith('dim:port:') && index === 1) {
      return [
        { dx: 2600, dy: -1800 },
        { dx: -2600, dy: -1800 },
        { dx: 3200, dy: 0 },
        { dx: -3200, dy: 0 },
        { dx: 0, dy: -2400 },
      ];
    }
    if (id.startsWith('cut_tubi:') && index === 0) {
      return [
        { dx: -4200, dy: 1200 },
        { dx: 4200, dy: 1200 },
        { dx: -4800, dy: 0 },
        { dx: 4800, dy: 0 },
        { dx: -2600, dy: 1800 },
        { dx: 2600, dy: 1800 },
      ];
    }
    if (id.startsWith('cut_tubi:') && index === 1) {
      return [
        { dx: -3600, dy: 2600 },
        { dx: 3600, dy: 2600 },
        { dx: -2600, dy: -1800 },
        { dx: 2600, dy: -1800 },
      ];
    }
    if (id.endsWith(':head')) {
      return [
        { dx: -5200, dy: -3600 },
        { dx: -2600, dy: -1500 },
        { dx: -1900, dy: -1100 },
        { dx: -1300, dy: -780 },
      ];
    }
    if (id.endsWith(':tail')) {
      return [
        { dx: 5200, dy: 3600 },
        { dx: 5200, dy: 1600 },
        { dx: 3600, dy: 3600 },
        { dx: -5200, dy: 3600 },
        { dx: 5200, dy: -3600 },
        { dx: -5200, dy: -3600 },
        { dx: 2600, dy: 1500 },
        { dx: -2600, dy: 1500 },
        { dx: 2600, dy: -1500 },
        { dx: -2600, dy: -1500 },
        { dx: 1900, dy: 1100 },
        { dx: 1300, dy: 780 },
      ];
    }
    if (id.startsWith('tag:fitting:')) {
      return [
        { dx: -260, dy: -120 },
        { dx: 260, dy: -120 },
        { dx: 0, dy: -180 },
        { dx: -260, dy: -220 },
        { dx: 260, dy: -220 },
        { dx: -260, dy: 120 },
        { dx: 260, dy: 120 },
        { dx: 0, dy: 180 },
        { dx: 5200, dy: -800 },
        { dx: 5200, dy: 2200 },
        { dx: -5200, dy: -800 },
        { dx: -5200, dy: 2200 },
        { dx: 3200, dy: -2600 },
        { dx: -3200, dy: -2600 },
        { dx: 3200, dy: 2600 },
        { dx: -3200, dy: 2600 },
        { dx: 1800, dy: 1000 },
        { dx: 1300, dy: 780 },
      ];
    }
    if (id.startsWith('tag:elevation:')) {
      return [
        { dx: 6200, dy: -4200 },
        { dx: -6200, dy: -4200 },
        { dx: 6200, dy: -1600 },
        { dx: -6200, dy: -1600 },
        { dx: 4200, dy: 0 },
        { dx: -4200, dy: 0 },
        { dx: 3600, dy: -2600 },
        { dx: -3600, dy: -2600 },
        { dx: 1800, dy: -1000 },
        { dx: 1300, dy: -780 },
      ];
    }
    if (id.startsWith('tag:tubi:')) {
      return tubiIndex === 0
        ? [
          { dx: 5200, dy: -3600 },
          { dx: 5200, dy: -1200 },
          { dx: 5200, dy: 1200 },
          { dx: -5200, dy: -3600 },
          { dx: -5200, dy: -1200 },
          { dx: 3600, dy: 0 },
          { dx: 1800, dy: 0 },
          { dx: 1300, dy: -780 },
        ]
        : [
          { dx: -3200, dy: -2400 },
          { dx: -3600, dy: -1200 },
          { dx: -4200, dy: 0 },
          { dx: -5200, dy: -3600 },
          { dx: -5200, dy: 1200 },
          { dx: 5200, dy: -3600 },
          { dx: 5200, dy: 1200 },
          { dx: -3600, dy: 0 },
          { dx: -1800, dy: 0 },
          { dx: -1300, dy: 780 },
        ];
    }
    if (id.startsWith('tag:material:')) {
      const itemNo = materialTagItemNo(id) ?? 1;
      const preferDown = itemNo % 2 === 1;
      const primaryDy = preferDown ? 140 : -140;
      const secondaryDy = -primaryDy;
      const preferRight = Math.floor((itemNo - 1) / 2) % 2 === 0;
      const primaryDx = preferRight ? 220 : -220;
      const secondaryDx = -primaryDx;
      return [
        { dx: primaryDx, dy: primaryDy },
        { dx: secondaryDx, dy: primaryDy },
        { dx: primaryDx, dy: secondaryDy },
        { dx: secondaryDx, dy: secondaryDy },
        { dx: primaryDx + Math.sign(primaryDx) * 80, dy: primaryDy + Math.sign(primaryDy) * 50 },
        { dx: secondaryDx - Math.sign(primaryDx) * 80, dy: primaryDy + Math.sign(primaryDy) * 50 },
        { dx: 280, dy: 0 },
        { dx: -280, dy: 0 },
        { dx: 0, dy: 160 },
        { dx: 0, dy: -160 },
        { dx: 340, dy: 240 },
        { dx: -340, dy: 240 },
        { dx: 340, dy: -240 },
        { dx: -340, dy: -240 },
      ];
    }
    if (id.startsWith('tag:branch:')) {
      return [
        { dx: 0, dy: -4200 },
        { dx: -2600, dy: -2600 },
        { dx: 0, dy: -1300 },
        { dx: 1300, dy: -780 },
      ];
    }
    return [];
  }

  function preferredAbsoluteLayoutScreenOffsetCandidates(
    id: string,
    baseScreen: { x: number; y: number } | null,
    viewport: { width: number; height: number },
  ): { dx: number; dy: number }[] {
    if (!baseScreen) return [];
    let target: { x: number; y: number } | null = null;
    const index = trailingAnnotationIndex(id);
    const tubiIndex = tubiTagLayoutIndex(id);
    const elevationIndex = elevationTagLayoutIndex(id);
    const chainOverallAxis =
      /^dim:chain:.*:axis:(\d+)$/.exec(id)?.[1] ??
      /^dim:chain:.*:axis:(\d+):piece:\d+$/.exec(id)?.[1] ??
      null;
    if (id.startsWith('tag:branch:')) {
      target = { x: viewport.width * 0.50, y: viewport.height * 0.90 };
    } else if (id.startsWith('tag:material:')) {
      const itemNo = materialTagItemNo(id) ?? 1;
      const horizontalSign = Math.floor((itemNo - 1) / 2) % 2 === 0 ? 1 : -1;
      const rawVerticalSign = itemNo % 2 === 1 ? 1 : -1;
      const verticalSign =
        baseScreen.y < viewport.height * 0.24
          ? 1
          : baseScreen.y > viewport.height * 0.76
            ? -1
            : rawVerticalSign;
      target = {
        x: clampNumber(baseScreen.x + horizontalSign * 118, 72, viewport.width - 72, baseScreen.x),
        y: clampNumber(baseScreen.y + verticalSign * 92, 72, viewport.height - 72, baseScreen.y),
      };
      const clampTarget = (x: number, y: number): { x: number; y: number } => ({
        x: clampNumber(x, 72, viewport.width - 72, target!.x),
        y: clampNumber(y, 72, viewport.height - 72, target!.y),
      });
      const materialTargets = [
        target,
        clampTarget(target.x + horizontalSign * 118, target.y),
        clampTarget(target.x - horizontalSign * 118, target.y),
        clampTarget(target.x, target.y + verticalSign * 122),
        clampTarget(target.x, target.y - verticalSign * 122),
        clampTarget(target.x + horizontalSign * 118, target.y + verticalSign * 122),
        clampTarget(target.x - horizontalSign * 118, target.y + verticalSign * 122),
        clampTarget(baseScreen.x + horizontalSign * 168, baseScreen.y + verticalSign * 218),
        clampTarget(baseScreen.x - horizontalSign * 168, baseScreen.y + verticalSign * 218),
      ];
      return materialTargets.map((slot) => ({
        dx: slot.x - baseScreen.x,
        dy: slot.y - baseScreen.y,
      }));
    } else if (/^dim:chain:.*:axis:0:piece:\d+$/.test(id)) {
      target = { x: viewport.width * 0.31, y: viewport.height * 0.36 };
    } else if (chainOverallAxis === '0') {
      target = { x: viewport.width * 0.30, y: viewport.height * 0.22 };
    } else if (chainOverallAxis === '1') {
      target = { x: viewport.width * 0.39, y: viewport.height * 0.78 };
    } else if (id.startsWith('dim:port:') && index === 0) {
      target = { x: viewport.width * 0.78, y: viewport.height * 0.58 };
    } else if (id.startsWith('dim:port:') && index === 1) {
      target = { x: viewport.width * 0.23, y: viewport.height * 0.58 };
    } else if (id.startsWith('cut_tubi:') && index === 0) {
      target = { x: viewport.width * 0.425, y: viewport.height * 0.34 };
    } else if (id.startsWith('cut_tubi:') && index === 1) {
      target = { x: viewport.width * 0.22, y: viewport.height * 0.72 };
    } else if (id.endsWith(':head')) {
      target = { x: viewport.width * 0.36, y: viewport.height * 0.58 };
    } else if (id.endsWith(':tail')) {
      target = { x: viewport.width * 0.62, y: viewport.height * 0.50 };
    } else if (id.startsWith('tag:fitting:')) {
      target = { x: viewport.width * 0.20, y: viewport.height * 0.78 };
    } else if (id.startsWith('tag:elevation:')) {
      const slot = Math.max(0, elevationIndex ?? 0);
      const column = Math.floor(slot / 6);
      const row = slot % 6;
      const yRatio = 0.22 + row * 0.12;
      const xRatio = column % 2 === 0 ? 0.86 : 0.74;
      target = { x: viewport.width * xRatio, y: viewport.height * yRatio };
    } else if (id.startsWith('tag:tubi:') && tubiIndex === 0) {
      target = { x: viewport.width * 0.80, y: viewport.height * 0.14 };
    } else if (id.startsWith('tag:tubi:') && tubiIndex === 1) {
      target = { x: viewport.width * 0.16, y: viewport.height * 0.68 };
    }
    if (!target) return [];
    const dx = target.x - baseScreen.x;
    const dy = target.y - baseScreen.y;
    return [
      { dx, dy },
      { dx: dx, dy: dy - 90 },
      { dx: dx, dy: dy + 90 },
    ];
  }

  function screenOutsidePenalty(
    box: MbdPipeDebugScreenBox,
    viewport: { width: number; height: number },
  ): number {
    const margin = isMbdDrawingPresetRuntime() ? 32 : 16;
    const rightReserved = isMbdDrawingPresetRuntime() ? margin : 112;
    const left = Math.max(0, margin - box.left);
    const right = Math.max(0, box.right - (viewport.width - rightReserved));
    const top = Math.max(0, margin - box.top);
    const bottom = Math.max(0, box.bottom - (viewport.height - margin));
    return (left + right + top + bottom) * 5000;
  }

  function collectPipeAxisScreenSegments(
    camera: Camera,
    viewport: { width: number; height: number },
  ): { start: { x: number; y: number }; end: { x: number; y: number } }[] {
    const data = currentData.value;
    if (!data?.segments?.length) return [];
    group.updateMatrixWorld?.(true);
    const segments: { start: { x: number; y: number }; end: { x: number; y: number } }[] = [];
    for (const segment of data.segments) {
      const startLocal = toVector3(segment.arrive);
      const endLocal = toVector3(segment.leave);
      if (!startLocal || !endLocal) continue;
      const start = projectLabelToScreen(
        group.localToWorld(startLocal.clone()),
        camera,
        viewport,
      );
      const end = projectLabelToScreen(
        group.localToWorld(endLocal.clone()),
        camera,
        viewport,
      );
      if (!start || !end) continue;
      segments.push({ start, end });
    }
    return segments;
  }

  function collectLayoutLeaderScreenSegmentsForKeepout(
    excludedTagId: string,
    camera: Camera,
    viewport: { width: number; height: number },
  ): { x1: number; y1: number; x2: number; y2: number }[] {
    const leaders = currentData.value?.v2_leader_lines ?? [];
    const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const [leaderIndex, leader] of leaders.entries()) {
      const tagItem = resolveLeaderLayoutTag(leader, leaderIndex);
      if (tagItem?.id === excludedTagId) continue;
      const tagKind = tagItem ? classifyLaidOutTag(tagItem) : 'other';
      if (tagItem && shouldSuppressDrawingTubiLengthTag(tagItem, tagKind)) continue;
      const points = resolveDrawingLeaderRenderPoints(
        (leader.points ?? [])
          .map((point) => toVector3(point))
          .filter((point): point is Vector3 => !!point),
        tagKind,
      );
      if (points.length < 2) continue;
      const projected = points
        .map((point) => projectLabelToScreen(group.localToWorld(point.clone()), camera, viewport))
        .filter((point): point is { x: number; y: number } => !!point);
      for (let index = 1; index < projected.length; index += 1) {
        const a = projected[index - 1]!;
        const b = projected[index]!;
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return segments;
  }

  type MbdPipeScreenSegment = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };

  function collectLinearDimensionScreenSegmentsForKeepout(
    camera: Camera,
    viewport: { width: number; height: number },
  ): MbdPipeScreenSegment[] {
    const segments: MbdPipeScreenSegment[] = [];
    const appendDimSegments = (annotation: LinearDimension3D): void => {
      const rawDim = asRaw(annotation);
      if (!rawDim.visible || !!(rawDim.userData as any)?.mbdDeclutterHidden) return;
      const params = rawDim.getParams();
      const laidOut = params.laidOutGeometry;
      const pairs: [Vector3 | null | undefined, Vector3 | null | undefined][] = laidOut
        ? [
          [laidOut.dimLineStart, laidOut.dimLineEnd],
          [laidOut.extensionLine1Start, laidOut.extensionLine1End],
          [laidOut.extensionLine2Start, laidOut.extensionLine2End],
        ]
        : [[params.start, params.end]];
      rawDim.updateMatrixWorld?.(true);
      for (const [startLocal, endLocal] of pairs) {
        if (!startLocal || !endLocal) continue;
        if (startLocal.distanceToSquared(endLocal) < 1e-10) continue;
        const start = projectLabelToScreen(
          rawDim.localToWorld(startLocal.clone()),
          camera,
          viewport,
        );
        const end = projectLabelToScreen(
          rawDim.localToWorld(endLocal.clone()),
          camera,
          viewport,
        );
        if (!start || !end) continue;
        segments.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      }
    };

    for (const dim of dimAnnotations.values()) appendDimSegments(dim);
    for (const dim of cutTubiAnnotations.values()) appendDimSegments(dim);
    return segments;
  }

  function drawingModelKeepoutPenalty(
    id: string,
    kind: MbdPipeDebugScreenItem['kind'],
    box: MbdPipeDebugScreenBox,
    viewport: { width: number; height: number },
    camera: Camera,
    drawingModelBoxes: MbdPipeDebugScreenBox[],
    drawingDimensionSegments: MbdPipeScreenSegment[] = [],
  ): number {
    if (!isMbdDrawingPresetRuntime() || (kind !== 'tag' && !id.startsWith('tag:'))) {
      return 0;
    }
    const materialTag = id.startsWith('tag:material:');
    const positionOrBranchTag =
      id.startsWith('tag:position:') || id.startsWith('tag:branch:');
    const paddedBox = expandScreenBox(box, materialTag ? 8 : 5);
    const labelArea = Math.max(1, box.width * box.height);
    const modelOverlapRatio = drawingModelBoxes.reduce((maxRatio, modelBox) => {
      const overlapArea = screenBoxOverlapArea(paddedBox, modelBox);
      if (overlapArea <= 0) return maxRatio;
      return Math.max(maxRatio, overlapArea / labelArea);
    }, 0);
    const overlapThreshold = positionOrBranchTag ? 0.10 : 0.035;
    if (modelOverlapRatio >= overlapThreshold) {
      return (materialTag ? 240_000 : 160_000) + modelOverlapRatio * 90_000;
    }
    const axisCrossing = collectPipeAxisScreenSegments(camera, viewport).some((segment) =>
      screenSegmentIntersectsBox(segment.start, segment.end, box, 12),
    );
    if (axisCrossing) return materialTag ? 100_000 : 70_000;
    const dimensionCrossing = drawingDimensionSegments.some((segment) =>
      screenSegmentIntersectsBox(
        { x: segment.x1, y: segment.y1 },
        { x: segment.x2, y: segment.y2 },
        box,
        materialTag ? 18 : 16,
      ),
    );
    if (dimensionCrossing) return materialTag ? 180_000 : 125_000;
    const leaderCrossing = collectLayoutLeaderScreenSegmentsForKeepout(
      id,
      camera,
      viewport,
    ).some((segment) =>
      screenSegmentIntersectsBox(
        { x: segment.x1, y: segment.y1 },
        { x: segment.x2, y: segment.y2 },
        box,
        2,
      ),
    );
    if (leaderCrossing) return materialTag ? 120_000 : 85_000;
    return 0;
  }

  function drawingLeaderExtensionCandidatePenalty(
    id: string,
    box: MbdPipeDebugScreenBox,
    labelScreen: { x: number; y: number },
    camera: Camera,
    viewport: { width: number; height: number },
    placedBoxes: MbdPipeDebugScreenBox[],
  ): number {
    if (!isMbdDrawingPresetRuntime() || !id.startsWith('tag:material:')) return 0;
    const leaders = currentData.value?.v2_leader_lines ?? [];
    let leaderPoints: Vector3[] | null = null;
    for (const [leaderIndex, leader] of leaders.entries()) {
      const tagItem = resolveLeaderLayoutTag(leader, leaderIndex);
      if (tagItem?.id !== id) continue;
      leaderPoints = resolveDrawingLeaderRenderPoints(
        (leader.points ?? [])
          .map((point) => toVector3(point))
          .filter((point): point is Vector3 => !!point),
        'material',
      );
      break;
    }
    if (!leaderPoints || leaderPoints.length < 2) return 0;
    const anchor =
      resolveLeaderAnchorScreenPoint(leaderPoints, camera, viewport) ??
      resolveNearestLeaderScreenPoint(leaderPoints, labelScreen, camera, viewport);
    if (!anchor) return 0;
    const start = screenRayBoxEdgePoint(box, anchor, 2) ?? labelScreen;
    const anchorDistance = Math.hypot(labelScreen.x - anchor.x, labelScreen.y - anchor.y);
    let penalty = anchorDistance > 320
      ? 450_000 + (anchorDistance - 320) * (anchorDistance - 320) * 150
      : Math.max(0, anchorDistance - 260) * Math.max(0, anchorDistance - 260) * 45;
    for (const placed of placedBoxes) {
      if (!screenSegmentIntersectsBox(start, anchor, placed, 8)) continue;
      penalty += 180_000 + screenBoxOverlapArea(expandScreenBox(placed, 2), {
        x: (start.x + anchor.x) * 0.5,
        y: (start.y + anchor.y) * 0.5,
        width: Math.max(1, Math.abs(start.x - anchor.x)),
        height: Math.max(1, Math.abs(start.y - anchor.y)),
        left: Math.min(start.x, anchor.x),
        right: Math.max(start.x, anchor.x),
        top: Math.min(start.y, anchor.y),
        bottom: Math.max(start.y, anchor.y),
      });
    }
    return penalty;
  }

  function screenBoxInsideViewport(
    box: MbdPipeDebugScreenBox,
    viewport: { width: number; height: number },
  ): boolean {
    const margin = 16;
    const rightReserved = isMbdDrawingPresetRuntime() ? 24 : 112;
    return (
      box.left >= margin &&
      box.right <= viewport.width - rightReserved &&
      box.top >= margin &&
      box.bottom <= viewport.height - margin
    );
  }

  function isLayoutScreenDeclutterEnabled(): boolean {
    return isMbdDrawingPresetRuntime();
  }

  function applyLayoutScreenLabelDeclutter(): void {
    if (renderSource.value !== 'layout_result') return;
    // Layout-first 数据已经带有后端计算的尺寸线、引线和文字锚点。
    // 前端只做受限的屏幕空间避让，避免文字压在一起，同时保持标注贴近模型。
    if (!isLayoutScreenDeclutterEnabled()) return;
    const viewer = dtxViewerRef.value;
    if (!viewer) return;
    layoutScreenDeclutterLastRunMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const camera = viewer.camera;
    camera.updateMatrixWorld?.(true);
    const rect = viewer.canvas.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1),
    };
    const candidates = makeLayoutScreenOffsetCandidates();

    const targets: {
      id: string;
      kind: MbdPipeDebugScreenItem['kind'];
      text: string;
      priority: number;
      labelPos: () => Vector3;
      applyWorldOffset: (offset: Vector3) => void;
      linear?: LinearDimension3D;
    }[] = [];

    const pushLinear = (
      id: string,
      kind: MbdPipeDebugScreenItem['kind'],
      dim: LinearDimension3D,
      text: string,
    ): void => {
      const rawDim = asRaw(dim);
      if (!rawDim.visible || !!(rawDim.userData as any)?.mbdDeclutterHidden) return;
      const base = readScreenDeclutterBaseOffset(rawDim);
      targets.push({
        id,
        kind,
        text,
        priority: layoutScreenPriority(id, kind),
        labelPos: () => getAnnotationLabelWorldPos(rawDim),
        linear: rawDim,
        applyWorldOffset: (offset) => {
          const localOffset = worldOffsetToGroupLocalOffset(offset);
          rawDim.setParams({ labelOffsetWorld: addNullableOffset(base, localOffset) });
        },
      });
    };

    for (const [id, dim] of dimAnnotations.entries()) {
      pushLinear(id, 'dim', dim, dim.getDisplayText());
    }
    for (const [id, dim] of cutTubiAnnotations.entries()) {
      pushLinear(id, 'cut_tubi', dim, dim.getDisplayText());
    }
    for (const [id, tag] of tagAnnotations.entries()) {
      const rawTag = asRaw(tag);
      if (!rawTag.visible || !!(rawTag.userData as any)?.mbdDeclutterHidden) continue;
      const params = rawTag.getParams();
      const label = String(params.label ?? '').trim();
      const subtitle = String(params.subtitle ?? '').trim();
      const text = subtitle ? `${label}\n${subtitle}` : label;
      if (!text.trim()) continue;
      const base = readScreenDeclutterBaseOffset(rawTag);
      targets.push({
        id,
        kind: 'tag',
        text,
        priority: layoutScreenPriority(id, 'tag'),
        labelPos: () => getAnnotationLabelWorldPos(rawTag),
        applyWorldOffset: (offset) => {
          const localOffset = worldOffsetToGroupLocalOffset(offset);
          rawTag.setParams({ labelOffsetWorld: addNullableOffset(base, localOffset) });
        },
      });
    }

    targets.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    for (const target of targets) {
      target.applyWorldOffset(new Vector3());
    }

    const drawingModelScreenBoxes = isMbdDrawingPresetRuntime()
      ? [
        ...collectDrawingModelScreenBoxes(camera, viewport),
        ...collectPipeBodyScreenBoxes(camera, viewport),
      ]
      : [];
    let drawingDimensionScreenSegments: MbdPipeScreenSegment[] | null = null;
    const getDrawingDimensionScreenSegments = (): MbdPipeScreenSegment[] => {
      if (!isMbdDrawingPresetRuntime()) return [];
      if (!drawingDimensionScreenSegments) {
        drawingDimensionScreenSegments = collectLinearDimensionScreenSegmentsForKeepout(
          camera,
          viewport,
        );
      }
      return drawingDimensionScreenSegments;
    };
    const placed: MbdPipeDebugScreenBox[] = [];
    for (const target of targets) {
      const basePos = target.labelPos();
      let bestOffset = new Vector3();
      let bestBox: MbdPipeDebugScreenBox | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      const applyExternalGeometry = (): void => {
        if (!target.linear) return;
        if (
          !target.id.startsWith('dim:chain:') &&
          !target.id.startsWith('dim:overall:') &&
          !target.id.startsWith('dim:port:') &&
          !target.id.startsWith('cut_tubi:')
        ) {
          return;
        }
        const rawDim = asRaw(target.linear);
        const finalLabelWorld = target.labelPos();
        const externalGeometryKey = [
          drawingExternalGeometryKey(camera, viewport),
          finalLabelWorld.x.toFixed(2),
          finalLabelWorld.y.toFixed(2),
          finalLabelWorld.z.toFixed(2),
        ].join(':');
        if ((rawDim.userData as any).mbdDrawingExternalGeometryKey === externalGeometryKey) {
          rawDim.setParams({
            labelOffsetWorld: null,
            labelT: 0.5,
          });
          const screen = projectLabelToScreen(target.labelPos(), camera, viewport);
          if (screen) bestBox = labelScreenBox(screen, target.text);
          return;
        }
        const externalGeometry = createDrawingExternalLinearGeometry(
          rawDim,
          target.id,
          finalLabelWorld,
          camera,
          viewport,
          drawingModelScreenBoxes,
          placed,
        );
        if (!externalGeometry) return;
        rawDim.setParams({
          laidOutGeometry: externalGeometry,
          labelOffsetWorld: null,
          labelT: 0.5,
        });
        (rawDim.userData as any).mbdDrawingExternalGeometryKey = externalGeometryKey;
        const screen = projectLabelToScreen(target.labelPos(), camera, viewport);
        if (screen) bestBox = labelScreenBox(screen, target.text);
      };

      if (
        target.linear &&
        isMbdDrawingPresetRuntime() &&
        isDrawingInlineTubeLengthTarget(target.id, asRaw(target.linear))
      ) {
        target.applyWorldOffset(new Vector3());
        applyExternalGeometry();
        const screen = projectLabelToScreen(target.labelPos(), camera, viewport);
        if (screen) placed.push(labelScreenBox(screen, target.text));
        continue;
      }

      const baseScreen = projectLabelToScreen(basePos, camera, viewport);
      const absoluteSlotCandidates = preferredAbsoluteLayoutScreenOffsetCandidates(
        target.id,
        baseScreen,
        viewport,
      );
      const preferredCandidates = [
        ...absoluteSlotCandidates,
        ...preferredLayoutScreenOffsetCandidates(target.id)
          .map(clampNearAnchorScreenCandidate),
      ];
      const isAbsoluteSlotCandidate = (candidate: { dx: number; dy: number }): boolean =>
        absoluteSlotCandidates.includes(candidate);
      const forceSemanticCandidate =
        target.id.startsWith('dim:chain:') ||
        target.id.startsWith('dim:overall:') ||
        target.id.startsWith('dim:port:') ||
        target.id.startsWith('cut_tubi:') ||
        target.id.startsWith('tag:position:') ||
        target.id.endsWith(':tail') ||
        target.id.startsWith('tag:elevation:') ||
        target.id.startsWith('tag:tubi:') ||
        target.id.startsWith('tag:material:');
      const targetCandidates = [
        ...preferredCandidates,
        ...candidates,
      ];
      if (forceSemanticCandidate && preferredCandidates.length > 0) {
        for (const candidate of preferredCandidates) {
          const offset = screenOffsetToWorldOffset(
            basePos,
            candidate,
            camera,
            viewport,
          );
          if (!offset) continue;
          target.applyWorldOffset(offset);
          const screen = projectLabelToScreen(target.labelPos(), camera, viewport);
          if (!screen) continue;
          const box = labelScreenBox(screen, target.text);
          if (!screenBoxInsideViewport(box, viewport)) continue;
          const labelConflictPenalty = placed.reduce(
            (sum, prev) => sum + drawingPlacedLabelConflictPenalty(box, prev),
            0,
          );
          const distancePenalty = isAbsoluteSlotCandidate(candidate)
            ? -12
            : (Math.abs(candidate.dx) + Math.abs(candidate.dy)) * 0.0002;
          const score =
            labelConflictPenalty +
            screenOutsidePenalty(box, viewport) +
            drawingModelKeepoutPenalty(
              target.id,
              target.kind,
              box,
              viewport,
              camera,
              drawingModelScreenBoxes,
              target.kind === 'tag' ? getDrawingDimensionScreenSegments() : [],
            ) +
            drawingLeaderExtensionCandidatePenalty(
              target.id,
              box,
              screen,
              camera,
              viewport,
              placed,
            ) +
            distancePenalty;
          if (score < bestScore) {
            bestScore = score;
            bestOffset = offset.clone();
            bestBox = box;
          }
        }
        if (bestBox) {
          const semanticSlotScoreLimit = isMbdDrawingPresetRuntime() ? 16 : 50_000;
          const semanticSlotGoodEnough =
            bestScore < semanticSlotScoreLimit ||
            (
              isMbdDrawingPresetRuntime() &&
              (
                target.id.startsWith('tag:position:') ||
                target.id.startsWith('tag:branch:')
              )
            );
          if (semanticSlotGoodEnough) {
            target.applyWorldOffset(bestOffset);
            applyExternalGeometry();
            placed.push(bestBox);
            continue;
          }
        }
      }
      for (const candidate of targetCandidates) {
        const offset = screenOffsetToWorldOffset(
          basePos,
          candidate,
          camera,
          viewport,
        );
        if (!offset) continue;
        target.applyWorldOffset(offset);
        const screen = projectLabelToScreen(target.labelPos(), camera, viewport);
        if (!screen) continue;
        const box = labelScreenBox(screen, target.text);
        const labelConflictPenalty = placed.reduce(
          (sum, prev) => sum + drawingPlacedLabelConflictPenalty(box, prev),
          0,
        );
        const distancePenalty = isAbsoluteSlotCandidate(candidate)
          ? -12
          : (Math.abs(candidate.dx) + Math.abs(candidate.dy)) * 0.0002;
        const keepoutPenalty = drawingModelKeepoutPenalty(
          target.id,
          target.kind,
          box,
          viewport,
          camera,
          drawingModelScreenBoxes,
          target.kind === 'tag' ? getDrawingDimensionScreenSegments() : [],
        );
        const leaderExtensionPenalty = drawingLeaderExtensionCandidatePenalty(
          target.id,
          box,
          screen,
          camera,
          viewport,
          placed,
        );
        const score =
          labelConflictPenalty +
          screenOutsidePenalty(box, viewport) +
          keepoutPenalty +
          leaderExtensionPenalty +
          distancePenalty;
        if (score < bestScore) {
          bestScore = score;
          bestOffset = offset.clone();
          bestBox = box;
          if (
            labelConflictPenalty <= 0 &&
            screenOutsidePenalty(box, viewport) <= 0 &&
            keepoutPenalty <= 0 &&
            leaderExtensionPenalty <= 0
          ) break;
        }
      }

      target.applyWorldOffset(bestOffset);
      applyExternalGeometry();
      if (!bestBox) {
        const screen = projectLabelToScreen(target.labelPos(), camera, viewport);
        if (screen) bestBox = labelScreenBox(screen, target.text);
      }
      if (bestBox) placed.push(bestBox);
    }
    applyLayoutResultScreenLod(camera, viewport);
    applyVisibility();
    drawingLeaderExtensionsNeedRebuild = true;
  }

  function renderLaidOutCutTubis(items: MbdLaidOutLinearDimDto[]): void {
    for (const item of items) {
      const dim = createLaidOutLinearAnnotation(item, materials.ssDimensionDefault);
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
      (dim.userData as any).mbdLayoutLabelRole =
        item.layout_hint?.label_role ?? item.source_sub_kind ?? 'cut_tubi';
      (dim.userData as any).mbdDrawingLinearPlacement = 'inline-tube-length';
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
      const weld = new WeldAnnotation3D(
        materials,
        {
          position,
          label: weldItem.label,
          subtitle: weldItem.subtitle ?? null,
          isShop: weldItem.is_shop,
          crossSize: clampNumber(weldItem.cross_size, 0, 5000, 50),
          labelOffsetWorld: resolveDrawingLaidOutLabelOffset(weldItem.label_offset_world),
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );
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
      const slope = new SlopeAnnotation3D(
        materials,
        {
          start,
          end,
          text: slopeItem.text,
          slope: slopeItem.slope,
          labelOffsetWorld: resolveDrawingLaidOutLabelOffset(slopeItem.label_offset_world),
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );
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
      const tagKind = classifyLaidOutTag(tagItem);
      if (shouldSuppressDrawingTubiLengthTag(tagItem, tagKind)) {
        continue;
      }
      if (!position) {
        recordSuppressedAnnotation(
          suppressedWrongLineCount,
          tagItem.suppressed_reason ?? 'layout_first_invalid_tag',
        );
        continue;
      }
      const tag = new WeldAnnotation3D(
        materials,
        {
          position,
          label: tagItem.text,
          subtitle: '',
          isShop: true,
          crossSize: 0,
          labelOffsetWorld: resolveDrawingLaidOutLabelOffset(tagItem.label_offset_world),
          labelRenderStyle,
          labelBox: tagKind === 'material' && isMbdDrawingPresetRuntime(),
          labelBoxPaddingPx: 4,
          labelBoxMinSidePx: 24,
        },
        mbdOnTopAnnotationOptions,
      );
      tag.setMaterialSet(materials.ssDimensionDefault);
      (tag.userData as any).mbdAuxKind = 'tag';
      (tag.userData as any).mbdTagKind = tagKind;
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
      const fitting = new WeldAnnotation3D(
        materials,
        {
          position,
          label: fittingItem.text,
          subtitle: '',
          isShop: true,
          crossSize: 0,
          labelOffsetWorld: resolveDrawingLaidOutLabelOffset(fittingItem.label_offset_world),
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );
      const fittingKind = fittingItem.kind === 'branch'
        ? 'branch'
        : fittingItem.kind === 'flange'
          ? 'flange'
          : 'elbow';
      fitting.setMaterialSet(materials.ssDimensionDefault);
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
          const angleDim = new AngleDimension3D(
            materials,
            {
              vertex,
              point1,
              point2,
              arcRadius: clampNumber(angle.arc_radius, 1, 5000, 120),
              text: angle.text,
              labelT: clamp01(angle.label_t, 0.5),
              labelOffsetWorld: resolveDrawingLaidOutLabelOffset(angle.label_offset_world),
              labelRenderStyle,
            },
            mbdOnTopAnnotationOptions,
          );
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

    if (shouldUseLayoutFirstResult(mbdViewMode.value, data)) {
      const rawLayoutCutTubis = data.layout_result.cut_tubis ?? [];
      const visibleLayoutCutTubisForDedupe = showCutTubis.value ? rawLayoutCutTubis : [];
      const layoutLinearDims = filterRedundantDrawingLinearDims(
        data.layout_result.linear_dims ?? [],
        visibleLayoutCutTubisForDedupe,
      );
      const layoutCutTubis = filterRedundantDrawingCutTubis(
        rawLayoutCutTubis,
        layoutLinearDims,
      );
      renderLaidOutLinearDims(layoutLinearDims);
      if (layoutCutTubis.length) {
        renderLaidOutCutTubis(layoutCutTubis);
      }
      applyLaidOutDimLabelDeclutter();
      applyLayoutScreenLabelDeclutter();
    } else {
      const pipeOffsetDirs = data.segments?.length
        ? computePipeAlignedOffsetDirs(data.segments)
        : [];
      if (data.dims?.length) renderDims(data.dims, data.segments ?? [], pipeOffsetDirs);
      if (showCutTubis.value && data.cut_tubis?.length) {
        renderCutTubis(data.cut_tubis, data.segments ?? [], pipeOffsetDirs);
      }
      applyPortDimLabelDeclutter();
      applyChainOffsetUnification();
      applyCutTubiLabelDeclutter();
      applyCutTubiLabelDeclutter(true);
    }

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

    if (shouldUseLayoutFirstResult(mbdViewMode.value, data)) {
      if (data.layout_result.bends?.length) {
        renderLaidOutBends(data.layout_result.bends);
      }
    } else if (data.bends?.length) {
      renderBends(data.bends, data.segments ?? []);
    }

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

      const weld = new WeldAnnotation3D(
        materials,
        {
          position,
          label: w.label,
          isShop: w.is_shop,
          crossSize: 50, // 世界单位
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );

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

      const slope = new SlopeAnnotation3D(
        materials,
        {
          start,
          end,
          text: s.text,
          slope: s.slope,
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );

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
          ...getDrawingDimensionExtensionStyle(),
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
          ...getDrawingDimensionExtensionStyle(),
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
      const annotation = new WeldAnnotation3D(
        materials,
        {
          position,
          label: mark.text,
          subtitle: mark.role ?? '',
          isShop: true,
          crossSize: 0,
          labelOffsetWorld:
            resolveFloatingLabelOffset(mark.layout_hint, 96)
            ?? new Vector3(0, 120, 80),
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );
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
          ...getDrawingDimensionExtensionStyle(),
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
      const annotation = new WeldAnnotation3D(
        materials,
        {
          position: anchor,
          label: tag.text,
          subtitle: '',
          isShop: true,
          crossSize: 0,
          labelOffsetWorld: resolveFloatingLabelOffset(tag.layout_hint, 120),
          labelRenderStyle,
        },
        mbdOnTopAnnotationOptions,
      );
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
          ...getDrawingDimensionExtensionStyle(),
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

        const angleDim = new AngleDimension3D(
          materials,
          {
            vertex: wp,
            point1: p1,
            point2: p2,
            arcRadius,
            text: angleText,
            labelRenderStyle,
          },
          mbdOnTopAnnotationOptions,
        );
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

  function resolveFlowSegmentGeometry(segment: MbdPipeSegmentDto): {
    start: Vector3;
    end: Vector3;
    direction: Vector3;
    length: number;
  } | null {
    const start = toVector3(segment.arrive ?? null);
    const end = toVector3(segment.leave ?? null);
    if (!start || !end) return null;

    const delta = end.clone().sub(start);
    const length = delta.length();
    if (length <= 1e-3) return null;

    return {
      start,
      end,
      direction: delta.clone().normalize(),
      length,
    };
  }

  function resolveFlowArrowLength(
    segment: MbdPipeSegmentDto,
    segmentLength: number,
  ): number {
    const diameterHint = Number(segment.outside_diameter ?? segment.bore ?? NaN);
    const baseLength = Number.isFinite(diameterHint)
      ? diameterHint * 0.45
      : segmentLength * 0.12;
    return Math.min(
      clampNumber(baseLength, 24, 90, 48),
      Math.max(8, segmentLength * 0.45),
    );
  }

  function resolveFlowPulseRadius(
    segment: MbdPipeSegmentDto,
    segmentLength: number,
  ): number {
    const diameterHint = Number(segment.outside_diameter ?? segment.bore ?? NaN);
    const baseRadius = Number.isFinite(diameterHint)
      ? diameterHint * 0.22
      : segmentLength * 0.045;
    return clampNumber(baseRadius, 16, 50, 22);
  }

  function hasVisibleFlowDirection(): boolean {
    return isVisible.value && showFlowDirection.value && flowDirectionObjects.size > 0;
  }

  function stopFlowAnimation(): void {
    if (typeof window === 'undefined' || flowAnimationFrame == null) return;
    window.cancelAnimationFrame(flowAnimationFrame);
    flowAnimationFrame = null;
  }

  function startFlowAnimation(): void {
    if (isTestEnv || typeof window === 'undefined' || flowAnimationFrame != null) return;

    const tick = (timeMs: number) => {
      if (!hasVisibleFlowDirection()) {
        flowAnimationFrame = null;
        return;
      }
      flowPulseMaterial.uniforms.uTime.value = timeMs * 0.001;
      requestRender?.();
      flowAnimationFrame = window.requestAnimationFrame(tick);
    };

    flowAnimationFrame = window.requestAnimationFrame(tick);
  }

  function syncFlowAnimation(): void {
    if (hasVisibleFlowDirection()) startFlowAnimation();
    else stopFlowAnimation();
  }

  function createFlowArrow(
    segmentId: string,
    tip: Vector3,
    direction: Vector3,
    arrowLength: number,
  ): LineSegments {
    const up = Math.abs(direction.z) > 0.92
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
    const side = up.cross(direction).normalize();
    const wing = arrowLength * 0.36;
    const base = tip.clone().addScaledVector(direction, -arrowLength);
    const left = base.clone().addScaledVector(side, wing);
    const right = base.clone().addScaledVector(side, -wing);
    const positions = new Float32Array([
      tip.x, tip.y, tip.z,
      left.x, left.y, left.z,
      tip.x, tip.y, tip.z,
      right.x, right.y, right.z,
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const arrow = new LineSegments(geometry, flowArrowMaterial);
    arrow.name = `mbd-flow-arrow:${segmentId}`;
    arrow.renderOrder = 984;
    arrow.visible = false;
    (arrow.userData as any).mbdAuxKind = 'flow-direction-arrow';
    (arrow.userData as any).mbdSegmentId = segmentId;
    (arrow.userData as any).mbdFlowDirection = direction.clone();
    return markRaw(arrow);
  }

  function flowPointKey(point: Vector3): string {
    const scale = 1000;
    return [
      Math.round(point.x * scale),
      Math.round(point.y * scale),
      Math.round(point.z * scale),
    ].join(':');
  }

  function resolveFlowEndpointFrame(direction: Vector3): {
    side: Vector3;
    normal: Vector3;
  } {
    const up = Math.abs(direction.z) > 0.92
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
    const side = up.cross(direction).normalize();
    const normal = direction.clone().cross(side).normalize();
    return { side, normal };
  }

  function createFlowEndpointHalo(
    role: 'inlet' | 'outlet',
    position: Vector3,
    direction: Vector3,
    size: number,
  ): LineSegments {
    const { side, normal } = resolveFlowEndpointFrame(direction);
    const a = position.clone().addScaledVector(side, size);
    const b = position.clone().addScaledVector(normal, size);
    const c = position.clone().addScaledVector(side, -size);
    const d = position.clone().addScaledVector(normal, -size);
    const positions = new Float32Array([
      a.x, a.y, a.z,
      b.x, b.y, b.z,
      b.x, b.y, b.z,
      c.x, c.y, c.z,
      c.x, c.y, c.z,
      d.x, d.y, d.z,
      d.x, d.y, d.z,
      a.x, a.y, a.z,
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const halo = new LineSegments(
      geometry,
      role === 'inlet' ? flowInletMarkerMaterial : flowOutletMarkerMaterial,
    );
    halo.name = `mbd-flow-${role}-halo`;
    halo.renderOrder = 985;
    halo.visible = false;
    (halo.userData as any).mbdAuxKind = `flow-direction-${role}-halo`;
    return markRaw(halo);
  }

  function configureFlowArrowHelper(arrow: ArrowHelper): ArrowHelper {
    arrow.traverse((object) => {
      const material = (object as any).material;
      if (!material) return;
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      material.opacity = 0.98;
      material.needsUpdate = true;
    });
    arrow.renderOrder = 989;
    arrow.visible = false;
    (arrow.userData as any).mbdAuxKind = 'flow-direction-external-arrow';
    return markRaw(arrow);
  }

  function createFlowEndpointGuide(
    role: 'inlet' | 'outlet',
    start: Vector3,
    end: Vector3,
  ): Line {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        new Float32Array([
          start.x, start.y, start.z,
          end.x, end.y, end.z,
        ]),
        3,
      ),
    );
    const guide = new Line(
      geometry,
      role === 'inlet' ? flowInletMarkerMaterial : flowOutletMarkerMaterial,
    );
    guide.name = `mbd-flow-${role}-guide`;
    guide.renderOrder = 986;
    guide.visible = false;
    (guide.userData as any).mbdAuxKind = `flow-direction-${role}-guide`;
    return markRaw(guide);
  }

  function resolveExternalFlowArrowGeometry(
    role: 'inlet' | 'outlet',
    position: Vector3,
    direction: Vector3,
    size: number,
  ): {
    arrowStart: Vector3;
    arrowEnd: Vector3;
    guideStart: Vector3;
    guideEnd: Vector3;
    arrowLength: number;
    externalOffset: Vector3;
  } {
    const arrowLength = size * 4.4;
    const externalOffset = new Vector3();

    if (role === 'inlet') {
      const arrowEnd = position.clone().addScaledVector(direction, arrowLength * 0.35);
      const arrowStart = arrowEnd.clone().addScaledVector(direction, -arrowLength);
      return {
        arrowStart,
        arrowEnd,
        guideStart: position.clone(),
        guideEnd: position.clone(),
        arrowLength,
        externalOffset,
      };
    }

    const arrowStart = position.clone().addScaledVector(direction, -arrowLength * 0.18);
    const arrowEnd = arrowStart.clone().addScaledVector(direction, arrowLength);
    return {
      arrowStart,
      arrowEnd,
      guideStart: position.clone(),
      guideEnd: position.clone(),
      arrowLength,
      externalOffset,
    };
  }

  function createExternalFlowPulse(
    role: 'inlet' | 'outlet',
    arrowStart: Vector3,
    arrowEnd: Vector3,
    size: number,
  ): Mesh {
    const pulseGeometry = new TubeGeometry(
      new CatmullRomCurve3([arrowStart.clone(), arrowEnd.clone()]),
      24,
      size * 0.22,
      12,
      false,
    );
    const pulse = markRaw(new Mesh(pulseGeometry, flowPulseMaterial));
    pulse.name = `mbd-flow-${role}-external-pulse`;
    pulse.renderOrder = 987;
    pulse.visible = false;
    pulse.frustumCulled = false;
    (pulse.userData as any).mbdAuxKind = `flow-direction-${role}-external-pulse`;
    return pulse;
  }

  function createBranchFlowEndpoint(
    role: 'inlet' | 'outlet',
    segmentId: string,
    position: Vector3,
    direction: Vector3,
    size: number,
  ): MbdBranchFlowEndpointObject {
    const { side } = resolveFlowEndpointFrame(direction);
    const externalArrow = resolveExternalFlowArrowGeometry(role, position, direction, size);
    const labelOffset = side
      .clone()
      .multiplyScalar(size * 1.8)
      .addScaledVector(direction, role === 'inlet' ? -size : size);
    const marker = markRaw(new WeldAnnotation3D(
      materials,
      {
        position,
        label: role === 'inlet' ? 'BRAN入口' : 'BRAN出口',
        subtitle: role === 'inlet' ? 'flow start' : 'flow end',
        isShop: true,
        crossSize: size * 0.68,
        labelOffsetWorld: labelOffset,
        labelRenderStyle: getRuntimeModeConfig().labelRenderStyle,
      },
      {
        depthTest: false,
      },
    ));
    marker.name = `mbd-flow-${role}`;
    marker.visible = false;
    marker.setMaterialSet(role === 'inlet' ? materials.blue : materials.orange);
    marker.setLabelVisible(false);
    (marker.userData as any).mbdAuxKind = `flow-direction-${role}`;
    (marker.userData as any).mbdSegmentId = segmentId;

    const halo = createFlowEndpointHalo(role, position, direction, size);
    const arrow = configureFlowArrowHelper(new ArrowHelper(
      direction.clone(),
      externalArrow.arrowStart,
      externalArrow.arrowLength,
      role === 'inlet' ? 0x0ea5e9 : 0xff7a18,
      size * 1.35,
      size * 0.82,
    ));
    arrow.name = `mbd-flow-${role}-external-arrow`;
    (arrow.userData as any).mbdSegmentId = segmentId;
    const guide = createFlowEndpointGuide(
      role,
      externalArrow.guideStart,
      externalArrow.guideEnd,
    );
    const pulse = createExternalFlowPulse(
      role,
      externalArrow.arrowStart,
      externalArrow.arrowEnd,
      size,
    );
    group.add(halo);
    group.add(guide);
    group.add(pulse);
    group.add(arrow);
    group.add(marker);
    return {
      role,
      segmentId,
      marker,
      halo,
      arrow,
      guide,
      pulse,
      position: position.clone(),
      direction: direction.clone(),
      arrowStart: externalArrow.arrowStart.clone(),
      arrowEnd: externalArrow.arrowEnd.clone(),
    };
  }

  function renderBranchFlowEndpoints(
    resolvedFlows: {
      segment: MbdPipeSegmentDto;
      flow: NonNullable<ReturnType<typeof resolveFlowSegmentGeometry>>;
    }[],
  ): void {
    if (resolvedFlows.length <= 0) return;

    const startKeys = new Set(resolvedFlows.map((item) => flowPointKey(item.flow.start)));
    const endKeys = new Set(resolvedFlows.map((item) => flowPointKey(item.flow.end)));

    const inlet =
      resolvedFlows.find((item) => !endKeys.has(flowPointKey(item.flow.start))) ??
      resolvedFlows[0]!;
    const outlet =
      [...resolvedFlows].reverse().find((item) => !startKeys.has(flowPointKey(item.flow.end))) ??
      resolvedFlows[resolvedFlows.length - 1]!;
    const inletSize = resolveFlowPulseRadius(inlet.segment, inlet.flow.length) * 1.55;
    const outletSize = resolveFlowPulseRadius(outlet.segment, outlet.flow.length) * 1.75;

    branchFlowEndpointObjects.set(
      'inlet',
      createBranchFlowEndpoint(
        'inlet',
        inlet.segment.id,
        inlet.flow.start,
        inlet.flow.direction,
        inletSize,
      ),
    );
    branchFlowEndpointObjects.set(
      'outlet',
      createBranchFlowEndpoint(
        'outlet',
        outlet.segment.id,
        outlet.flow.end,
        outlet.flow.direction,
        outletSize,
      ),
    );
  }

  function renderFlowDirections(segments: MbdPipeSegmentDto[]): void {
    const resolvedFlows: {
      segment: MbdPipeSegmentDto;
      flow: NonNullable<ReturnType<typeof resolveFlowSegmentGeometry>>;
    }[] = [];

    for (const segment of segments) {
      const flow = resolveFlowSegmentGeometry(segment);
      if (!flow) continue;
      resolvedFlows.push({ segment, flow });

      const centerlineGeometry = new BufferGeometry();
      centerlineGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          new Float32Array([
            flow.start.x, flow.start.y, flow.start.z,
            flow.end.x, flow.end.y, flow.end.z,
          ]),
          3,
        ),
      );
      const centerline = markRaw(new Line(centerlineGeometry, flowCenterlineMaterial));
      centerline.name = `mbd-flow-centerline:${segment.id}`;
      centerline.renderOrder = 983;
      centerline.visible = false;
      (centerline.userData as any).mbdAuxKind = 'flow-direction-centerline';
      (centerline.userData as any).mbdSegmentId = segment.id;
      group.add(centerline);

      const pulseGeometry = new TubeGeometry(
        new CatmullRomCurve3([flow.start.clone(), flow.end.clone()]),
        24,
        resolveFlowPulseRadius(segment, flow.length),
        16,
        false,
      );
      const pulse = markRaw(new Mesh(pulseGeometry, flowPulseMaterial));
      pulse.name = `mbd-flow-pulse:${segment.id}`;
      pulse.renderOrder = 982;
      pulse.visible = false;
      pulse.frustumCulled = false;
      (pulse.userData as any).mbdAuxKind = 'flow-direction-pulse';
      (pulse.userData as any).mbdSegmentId = segment.id;
      (pulse.userData as any).mbdFlowDirection = flow.direction.clone();
      group.add(pulse);

      const arrowLength = resolveFlowArrowLength(segment, flow.length);
      const spacing = clampNumber(
        Math.max(arrowLength * 3, flow.length / 3),
        180,
        450,
        260,
      );
      const arrowCount = Math.max(1, Math.min(8, Math.floor(flow.length / spacing) || 1));
      const arrows: LineSegments[] = [];
      for (let index = 0; index < arrowCount; index += 1) {
        const t = (index + 1) / (arrowCount + 1);
        const tip = flow.start.clone().lerp(flow.end, t);
        const arrow = createFlowArrow(
          segment.id,
          tip,
          flow.direction,
          arrowLength,
        );
        group.add(arrow);
        arrows.push(arrow);
      }

      flowDirectionObjects.set(segment.id, {
        segmentId: segment.id,
        centerline,
        pulse,
        arrows,
        direction: flow.direction.clone(),
      });
    }

    renderBranchFlowEndpoints(resolvedFlows);
  }

  function resolvePipeVisualRadius(
    segment: MbdPipeSegmentDto,
    segmentLength: number,
  ): number {
    const od = Number(segment.outside_diameter ?? NaN);
    const bore = Number(segment.bore ?? NaN);
    const hinted = Number.isFinite(od) && od > 0
      ? od * 0.5
      : Number.isFinite(bore) && bore > 0
        ? bore * 0.58
        : segmentLength * 0.055;
    const maxRadius = Math.max(18, Math.min(90, segmentLength * 0.42));
    return clampNumber(hinted, 12, maxRadius, Math.min(42, maxRadius));
  }

  function createPipeVisualRing(
    segmentId: string,
    center: Vector3,
    direction: Vector3,
    radius: number,
    suffix: string,
  ): Mesh {
    const up = Math.abs(direction.z) > 0.92
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
    const side = up.clone().cross(direction).normalize();
    const normal = direction.clone().cross(side).normalize();
    const steps = drawingPresetRuntime ? 72 : 48;
    const points: Vector3[] = [];
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      points.push(
        center
          .clone()
          .addScaledVector(side, Math.cos(a) * radius)
          .addScaledVector(normal, Math.sin(a) * radius),
      );
    }
    const ringThickness = drawingPresetRuntime
      ? clampNumber(
        radius * MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringTubeRadiusRatio,
        MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringTubeRadiusMin,
        MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringTubeRadiusMax,
        MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringTubeRadiusFallback,
      )
      : clampNumber(radius * 0.04, 1.2, 4.4, 2.0);
    const geometry = new TubeGeometry(
      new CatmullRomCurve3(points, true, 'catmullrom', 0.5),
      steps,
      ringThickness,
      drawingPresetRuntime ? 8 : 6,
      true,
    );
    const ring = markRaw(new Mesh(geometry, pipeEmphasisRingMaterial));
    ring.name = `mbd-pipe-emphasis-ring:${segmentId}:${suffix}`;
    ring.renderOrder = 884;
    ring.visible = false;
    ring.frustumCulled = false;
    (ring.userData as any).mbdAuxKind = 'pipe-visual-ring';
    (ring.userData as any).mbdSegmentId = segmentId;
    return ring;
  }

  function createPipeVisualBand(
    segmentId: string,
    center: Vector3,
    direction: Vector3,
    radius: number,
    suffix: string,
  ): Mesh {
    const up = Math.abs(direction.z) > 0.92
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
    const side = up.clone().cross(direction).normalize();
    const normal = direction.clone().cross(side).normalize();
    const points: Vector3[] = [];
    const steps = 64;
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      points.push(
        center
          .clone()
          .addScaledVector(side, Math.cos(a) * radius)
          .addScaledVector(normal, Math.sin(a) * radius),
      );
    }
    const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
    const bandThickness = drawingPresetRuntime
      ? clampNumber(
        radius * MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandThicknessRatio,
        MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandThicknessMin,
        MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandThicknessMax,
        MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandThicknessFallback,
      )
      : clampNumber(radius * 0.085, 1.8, 8.0, 2.6);
    const geometry = new TubeGeometry(curve, 64, bandThickness, 8, true);
    const band = markRaw(new Mesh(geometry, pipeEmphasisBandMaterial));
    band.name = `mbd-pipe-emphasis-band:${segmentId}:${suffix}`;
    band.renderOrder = 886;
    band.visible = false;
    band.frustumCulled = false;
    (band.userData as any).mbdAuxKind = 'pipe-visual-band';
    (band.userData as any).mbdSegmentId = segmentId;
    return band;
  }

  function createPipeVisualRail(
    segmentId: string,
    start: Vector3,
    end: Vector3,
    offset: Vector3,
    radius: number,
    suffix: string,
  ): Mesh {
    const railStart = start.clone().add(offset);
    const railEnd = end.clone().add(offset);
    const length = railStart.distanceTo(railEnd);
    const geometry = new TubeGeometry(
      new CatmullRomCurve3([railStart, railEnd]),
      Math.max(8, Math.min(36, Math.floor(length / 24))),
      radius,
      drawingPresetRuntime ? 8 : 6,
      false,
    );
    const rail = markRaw(new Mesh(geometry, pipeEmphasisRailMaterial));
    rail.name = `mbd-pipe-emphasis-rail:${segmentId}:${suffix}`;
    rail.renderOrder = 887;
    rail.visible = false;
    rail.frustumCulled = false;
    (rail.userData as any).mbdAuxKind = 'pipe-visual-rail';
    (rail.userData as any).mbdSegmentId = segmentId;
    return rail;
  }

  function createPipeVisualOutline(
    segmentId: string,
    start: Vector3,
    end: Vector3,
    offset: Vector3,
    radius: number,
    suffix: string,
  ): Mesh {
    const outlineStart = start.clone().add(offset);
    const outlineEnd = end.clone().add(offset);
    const length = outlineStart.distanceTo(outlineEnd);
    const geometry = new TubeGeometry(
      new CatmullRomCurve3([outlineStart, outlineEnd]),
      Math.max(8, Math.min(40, Math.floor(length / 22))),
      radius,
      drawingPresetRuntime ? 10 : 7,
      false,
    );
    const outline = markRaw(new Mesh(geometry, pipeEmphasisOutlineMaterial));
    outline.name = `mbd-pipe-emphasis-outline:${segmentId}:${suffix}`;
    outline.renderOrder = 888;
    outline.visible = false;
    outline.frustumCulled = false;
    (outline.userData as any).mbdAuxKind = 'pipe-visual-outline';
    (outline.userData as any).mbdSegmentId = segmentId;
    return outline;
  }

  function closestPointOnSegment(
    point: Vector3,
    start: Vector3,
    end: Vector3,
  ): { point: Vector3; t: number; distance: number } {
    const span = end.clone().sub(start);
    const spanLengthSq = span.lengthSq();
    if (spanLengthSq <= 1e-9) {
      return { point: start.clone(), t: 0, distance: point.distanceTo(start) };
    }
    const rawT = point.clone().sub(start).dot(span) / spanLengthSq;
    const t = clampNumber(rawT, 0, 1, 0);
    const closest = start.clone().addScaledVector(span, t);
    return { point: closest, t, distance: point.distanceTo(closest) };
  }

  function resolveFittingVisualRadius(
    fitting: MbdFittingDto,
    segments: MbdPipeSegmentDto[],
  ): number {
    const anchor = toVector3(fitting.anchor_point) ??
      toVector3(fitting.layout_hint?.anchor_point ?? null);
    const explicitRadius = Number(fitting.radius ?? NaN);
    if (!anchor && Number.isFinite(explicitRadius) && explicitRadius > 0) {
      return clampNumber(explicitRadius, 18, 100, 42);
    }
    if (!anchor) return 42;

    let best:
      | {
        segment: MbdPipeSegmentDto;
        flow: NonNullable<ReturnType<typeof resolveFlowSegmentGeometry>>;
        distance: number;
      }
      | null = null;
    for (const segment of segments) {
      const flow = resolveFlowSegmentGeometry(segment);
      if (!flow) continue;
      const closest = closestPointOnSegment(anchor, flow.start, flow.end);
      if (!best || closest.distance < best.distance) {
        best = { segment, flow, distance: closest.distance };
      }
    }
    if (best) {
      return resolvePipeVisualRadius(best.segment, best.flow.length);
    }
    return Number.isFinite(explicitRadius) && explicitRadius > 0
      ? clampNumber(explicitRadius, 18, 100, 42)
      : 42;
  }

  function pushDistinctDirection(directions: Vector3[], direction: Vector3): void {
    if (direction.lengthSq() <= 1e-9) return;
    const normalized = direction.clone().normalize();
    if (directions.some((item) => item.dot(normalized) > 0.9)) return;
    directions.push(normalized);
  }

  function resolveFittingVisualDirections(
    fitting: MbdFittingDto,
    segments: MbdPipeSegmentDto[],
    anchor: Vector3,
    radius: number,
  ): Vector3[] {
    const directions: Vector3[] = [];
    const faceCenters = [
      toVector3(fitting.face_center_1 ?? null),
      toVector3(fitting.face_center_2 ?? null),
    ].filter((point): point is Vector3 => !!point);
    for (const faceCenter of faceCenters) {
      pushDistinctDirection(directions, faceCenter.clone().sub(anchor));
    }
    if (directions.length >= 2) return directions.slice(0, 4);

    const candidates: {
      direction: Vector3;
      distance: number;
      fromCenterline: boolean;
    }[] = [];
    for (const segment of segments) {
      const flow = resolveFlowSegmentGeometry(segment);
      if (!flow) continue;
      const closest = closestPointOnSegment(anchor, flow.start, flow.end);
      const maxDistance = Math.max(260, radius * 5.2);
      if (closest.distance > maxDistance) continue;
      const towardClosest = closest.point.clone().sub(anchor);
      if (towardClosest.length() > radius * 0.35) {
        candidates.push({
          direction: towardClosest,
          distance: closest.distance,
          fromCenterline: false,
        });
      } else {
        candidates.push({
          direction: flow.direction.clone(),
          distance: closest.distance,
          fromCenterline: true,
        });
        candidates.push({
          direction: flow.direction.clone().multiplyScalar(-1),
          distance: closest.distance + radius * 0.2,
          fromCenterline: true,
        });
      }
    }
    candidates
      .sort((a, b) =>
        a.distance - b.distance ||
        Number(a.fromCenterline) - Number(b.fromCenterline),
      )
      .forEach((candidate) => pushDistinctDirection(directions, candidate.direction));

    if (directions.length <= 0) {
      pushDistinctDirection(directions, new Vector3(1, 0, 0));
      pushDistinctDirection(directions, new Vector3(0, 1, 0));
    } else if (directions.length === 1) {
      const up = Math.abs(directions[0]!.z) > 0.92
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 0, 1);
      pushDistinctDirection(directions, up.clone().cross(directions[0]!).normalize());
    }
    return directions.slice(0, 4);
  }

  function createFittingVisualRing(
    fittingId: string,
    center: Vector3,
    direction: Vector3,
    radius: number,
    tubeRadius: number,
    auxKind: string,
    suffix: string,
    material: MeshBasicMaterial,
    renderOrder: number,
  ): Mesh {
    const safeDirection = direction.lengthSq() > 1e-9
      ? direction.clone().normalize()
      : new Vector3(0, 0, 1);
    const up = Math.abs(safeDirection.z) > 0.92
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
    const side = up.clone().cross(safeDirection).normalize();
    const normal = safeDirection.clone().cross(side).normalize();
    const steps = drawingPresetRuntime ? 72 : 48;
    const points: Vector3[] = [];
    for (let index = 0; index < steps; index += 1) {
      const a = (index / steps) * Math.PI * 2;
      points.push(
        center
          .clone()
          .addScaledVector(side, Math.cos(a) * radius)
          .addScaledVector(normal, Math.sin(a) * radius),
      );
    }
    const geometry = new TubeGeometry(
      new CatmullRomCurve3(points, true, 'catmullrom', 0.5),
      steps,
      tubeRadius,
      drawingPresetRuntime ? 9 : 6,
      true,
    );
    const ring = markRaw(new Mesh(geometry, material));
    ring.name = `mbd-fitting-emphasis-${suffix}:${fittingId}`;
    ring.renderOrder = renderOrder;
    ring.visible = false;
    ring.frustumCulled = false;
    (ring.userData as any).mbdAuxKind = auxKind;
    (ring.userData as any).mbdFittingId = fittingId;
    return ring;
  }

  function createFittingVisualArm(
    fittingId: string,
    anchor: Vector3,
    direction: Vector3,
    radius: number,
    suffix: string,
  ): Mesh {
    const safeDirection = direction.lengthSq() > 1e-9
      ? direction.clone().normalize()
      : new Vector3(1, 0, 0);
    const start = anchor.clone().addScaledVector(safeDirection, radius * 0.24);
    const end = anchor.clone().addScaledVector(
      safeDirection,
      radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armLengthScale,
    );
    const length = start.distanceTo(end);
    const tubeRadius = drawingPresetRuntime
      ? clampNumber(
        radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armTubeRadiusRatio,
        MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armTubeRadiusMin,
        MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armTubeRadiusMax,
        MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armTubeRadiusFallback,
      )
      : clampNumber(radius * 0.058, 1.8, 5.6, 2.6);
    const geometry = new TubeGeometry(
      new CatmullRomCurve3([start, end]),
      Math.max(8, Math.min(28, Math.floor(length / 14))),
      tubeRadius,
      drawingPresetRuntime ? 8 : 6,
      false,
    );
    const arm = markRaw(new Mesh(geometry, fittingEmphasisArmMaterial));
    arm.name = `mbd-fitting-emphasis-arm:${fittingId}:${suffix}`;
    arm.renderOrder = 891;
    arm.visible = false;
    arm.frustumCulled = false;
    (arm.userData as any).mbdAuxKind = 'fitting-visual-arm';
    (arm.userData as any).mbdFittingId = fittingId;
    return arm;
  }

  function renderFittingVisualEmphasis(
    fittings: MbdFittingDto[],
    segments: MbdPipeSegmentDto[],
  ): void {
    for (const fitting of fittings) {
      const anchor = toVector3(fitting.anchor_point) ??
        toVector3(fitting.layout_hint?.anchor_point ?? null);
      if (!anchor) continue;
      const radius = resolveFittingVisualRadius(fitting, segments);
      const directions = resolveFittingVisualDirections(fitting, segments, anchor, radius);
      const coreTubeRadius = drawingPresetRuntime
        ? clampNumber(
          radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreTubeRadiusRatio,
          MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreTubeRadiusMin,
          MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreTubeRadiusMax,
          MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreTubeRadiusFallback,
        )
        : clampNumber(radius * 0.06, 1.8, 5.8, 2.8);
      const portTubeRadius = drawingPresetRuntime
        ? clampNumber(
          radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portTubeRadiusRatio,
          MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portTubeRadiusMin,
          MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portTubeRadiusMax,
          MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portTubeRadiusFallback,
        )
        : clampNumber(radius * 0.052, 1.6, 5.4, 2.5);

      const coreDirections = directions.length >= 2
        ? directions.slice(0, 2)
        : [new Vector3(1, 0, 0), new Vector3(0, 1, 0)];
      const coreRings = coreDirections.map((direction, index) =>
        createFittingVisualRing(
          fitting.id,
          anchor,
          direction,
          radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreRadiusScale,
          coreTubeRadius,
          'fitting-visual-core',
          `core-${index}`,
          fittingEmphasisCoreMaterial,
          890,
        ),
      );
      const portRings = directions.map((direction, index) =>
        createFittingVisualRing(
          fitting.id,
          anchor.clone().addScaledVector(
            direction,
            radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portOffsetScale,
          ),
          direction,
          radius * MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portRadiusScale,
          portTubeRadius,
          'fitting-visual-port',
          `port-${index}`,
          fittingEmphasisPortMaterial,
          892,
        ),
      );
      const arms = directions.map((direction, index) =>
        createFittingVisualArm(fitting.id, anchor, direction, radius, String(index)),
      );

      for (const coreRing of coreRings) group.add(coreRing);
      for (const portRing of portRings) group.add(portRing);
      for (const arm of arms) group.add(arm);
      fittingVisualEmphasisObjects.set(fitting.id, {
        fittingId: fitting.id,
        coreRings,
        portRings,
        arms,
      });
    }
  }

  function renderPipeVisualEmphasis(segments: MbdPipeSegmentDto[]): void {
    for (const segment of segments) {
      const flow = resolveFlowSegmentGeometry(segment);
      if (!flow) continue;
      const radius = resolvePipeVisualRadius(segment, flow.length);

      const bodyGeometry = new TubeGeometry(
        new CatmullRomCurve3([flow.start.clone(), flow.end.clone()]),
        Math.max(8, Math.min(40, Math.floor(flow.length / 18))),
        radius,
        drawingPresetRuntime ? 32 : 24,
        false,
      );
      const body = markRaw(new Mesh(bodyGeometry, pipeEmphasisBodyMaterial));
      body.name = `mbd-pipe-emphasis-body:${segment.id}`;
      body.renderOrder = 880;
      body.visible = false;
      body.frustumCulled = false;
      (body.userData as any).mbdAuxKind = 'pipe-visual-body';
      (body.userData as any).mbdSegmentId = segment.id;

      const spineGeometry = new BufferGeometry();
      spineGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(
          new Float32Array([
            flow.start.x, flow.start.y, flow.start.z,
            flow.end.x, flow.end.y, flow.end.z,
          ]),
          3,
        ),
      );
      const spine = markRaw(new Line(spineGeometry, pipeEmphasisSpineMaterial));
      spine.name = `mbd-pipe-emphasis-spine:${segment.id}`;
      spine.renderOrder = 885;
      spine.visible = false;
      (spine.userData as any).mbdAuxKind = 'pipe-visual-spine';
      (spine.userData as any).mbdSegmentId = segment.id;

      const ringStations = drawingPresetRuntime
        ? [
          { t: 0, radiusScale: 1.025, suffix: 'start' },
          { t: 1, radiusScale: 1.025, suffix: 'end' },
        ]
        : [
          { t: 0, radiusScale: 1.02, suffix: 'start' },
          { t: 0.34, radiusScale: 1.01, suffix: 'band-a' },
          { t: 0.68, radiusScale: 1.01, suffix: 'band-b' },
          { t: 1, radiusScale: 1.02, suffix: 'end' },
        ];
      const bandStations = drawingPresetRuntime
        ? [
          { t: 0, radiusScale: 1.03, suffix: 'start' },
          { t: 1, radiusScale: 1.03, suffix: 'end' },
        ]
        : [
          { t: 0, radiusScale: 1.025, suffix: 'start' },
          { t: 0.34, radiusScale: 1.015, suffix: 'band-a' },
          { t: 0.68, radiusScale: 1.015, suffix: 'band-b' },
          { t: 1, radiusScale: 1.025, suffix: 'end' },
        ];
      const rings = ringStations.map((station) =>
        createPipeVisualRing(
          segment.id,
          flow.start.clone().lerp(flow.end, station.t),
          flow.direction,
          radius * station.radiusScale,
          station.suffix,
        ),
      );
      const bands = bandStations.map((station) =>
        createPipeVisualBand(
          segment.id,
          flow.start.clone().lerp(flow.end, station.t),
          flow.direction,
          radius * station.radiusScale,
          station.suffix,
        ),
      );
      const frameUp = Math.abs(flow.direction.z) > 0.92
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 0, 1);
      const frameSide = frameUp.clone().cross(flow.direction).normalize();
      const frameNormal = flow.direction.clone().cross(frameSide).normalize();
      const railRadius = drawingPresetRuntime
        ? clampNumber(
          radius * MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railRadiusRatio,
          MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railRadiusMin,
          MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railRadiusMax,
          MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railRadiusFallback,
        )
        : clampNumber(radius * 0.064, 2.0, 6.8, 3.0);
      const railOffset = radius * 1.08;
      const railDefs = [
        { offset: frameSide.clone().multiplyScalar(railOffset), suffix: 'side-pos' },
        { offset: frameSide.clone().multiplyScalar(-railOffset), suffix: 'side-neg' },
        { offset: frameNormal.clone().multiplyScalar(railOffset), suffix: 'normal-pos' },
        { offset: frameNormal.clone().multiplyScalar(-railOffset), suffix: 'normal-neg' },
      ];
      const rails = railDefs.map((rail) =>
        createPipeVisualRail(
          segment.id,
          flow.start,
          flow.end,
          rail.offset,
          railRadius,
          rail.suffix,
        ),
      );
      const outlineRadius = drawingPresetRuntime
        ? clampNumber(
          radius * MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineRadiusRatio,
          MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineRadiusMin,
          MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineRadiusMax,
          MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineRadiusFallback,
        )
        : clampNumber(radius * 0.078, 2.6, 7.6, 3.6);
      const outlineOffset =
        radius * MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineOffsetScale;
      const outlineDefs = [
        { offset: frameSide.clone().multiplyScalar(outlineOffset), suffix: 'side-pos' },
        { offset: frameSide.clone().multiplyScalar(-outlineOffset), suffix: 'side-neg' },
        { offset: frameNormal.clone().multiplyScalar(outlineOffset), suffix: 'normal-pos' },
        { offset: frameNormal.clone().multiplyScalar(-outlineOffset), suffix: 'normal-neg' },
      ];
      const outlines = outlineDefs.map((outline) =>
        createPipeVisualOutline(
          segment.id,
          flow.start,
          flow.end,
          outline.offset,
          outlineRadius,
          outline.suffix,
        ),
      );
      group.add(body);
      group.add(spine);
      for (const ring of rings) group.add(ring);
      for (const band of bands) group.add(band);
      for (const rail of rails) group.add(rail);
      for (const outline of outlines) group.add(outline);
      pipeVisualEmphasisObjects.set(segment.id, {
        segmentId: segment.id,
        body,
        spine,
        rings,
        bands,
        rails,
        outlines,
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

  function resolvePolylineLength(points: Vector3[]): number {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += points[index - 1]!.distanceTo(points[index]!);
    }
    return total;
  }

  function resolveDrawingLeaderRenderPoints(
    points: Vector3[],
    tagKind: MbdTagKind = 'other',
  ): Vector3[] {
    if (!isMbdDrawingPresetRuntime() || points.length < 2) {
      return points.map((point) => point.clone());
    }
    const totalLength = resolvePolylineLength(points);
    if (!Number.isFinite(totalLength) || totalLength <= 1e-6) {
      return points.map((point) => point.clone());
    }

    const keepLength = tagKind === 'material'
      ? Math.min(
        totalLength * 0.58,
        clampNumber(totalLength * 0.32, 42, 118, 68),
      )
      : Math.min(
        totalLength,
        clampNumber(totalLength * 0.38, 90, 205, 130),
      );
    const anchorStart = points[0]!.clone();
    const shortened: Vector3[] = [anchorStart];
    let remaining = keepLength;

    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index]!;
      const next = points[index + 1]!;
      const segmentLength = current.distanceTo(next);
      if (!Number.isFinite(segmentLength) || segmentLength <= 1e-6) continue;

      if (remaining >= segmentLength) {
        shortened.push(next.clone());
        remaining -= segmentLength;
        continue;
      }

      shortened.push(current.clone().lerp(next, remaining / segmentLength));
      break;
    }

    return shortened;
  }

  function collectLocalPolylineScreenBox(
    points: Vector3[],
    camera: Camera,
    viewport: { width: number; height: number },
  ): MbdPipeDebugScreenBox | null {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let projectedCount = 0;
    for (const point of points) {
      const world = group.localToWorld(point.clone());
      const screen = projectLabelToScreen(world, camera, viewport);
      if (!screen) continue;
      left = Math.min(left, screen.x);
      right = Math.max(right, screen.x);
      top = Math.min(top, screen.y);
      bottom = Math.max(bottom, screen.y);
      projectedCount += 1;
    }
    if (
      projectedCount <= 0 ||
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      !Number.isFinite(top) ||
      !Number.isFinite(bottom)
    ) {
      return null;
    }
    return {
      x: (left + right) * 0.5,
      y: (top + bottom) * 0.5,
      width: right - left,
      height: bottom - top,
      left,
      right,
      top,
      bottom,
    };
  }

  function resolveDrawingLeaderClippedFromTagLabelPoints(
    points: Vector3[],
    tagItem: MbdLaidOutTagDto | null,
    tagKind: MbdTagKind,
    camera: Camera,
    viewport: { width: number; height: number },
  ): Vector3[] | null {
    if (
      !isMbdDrawingPresetRuntime() ||
      points.length < 2
    ) {
      return null;
    }
    const screenPoints = points
      .map((point) => {
        const world = group.localToWorld(point.clone());
        const screen = projectLabelToScreen(world, camera, viewport);
        return screen ? { ...screen, local: point } : null;
      });
    if (screenPoints.some((point) => !point)) return null;

    const buildLabelInfo = (tag: any): {
      labelWorld: Vector3;
      labelScreen: { x: number; y: number };
      labelBox: MbdPipeDebugScreenBox;
    } | null => {
      const rawTag = asRaw(tag);
      if (!rawTag || !rawTag.visible) return null;
      rawTag.update(camera);
      const params = rawTag.getParams();
      const label = String(params.label ?? '').trim();
      const subtitle = String(params.subtitle ?? '').trim();
      const text = subtitle ? `${label}\n${subtitle}` : label;
      if (!text.trim()) return null;
      const labelWorld = getAnnotationLabelWorldPos(rawTag);
      const labelScreen = projectLabelToScreen(labelWorld, camera, viewport);
      if (!labelScreen) return null;
      return {
        labelWorld,
        labelScreen,
        labelBox: expandScreenBox(labelScreenBox(labelScreen, text), 2),
      };
    };
    const leaderIntersectsLabel = (box: MbdPipeDebugScreenBox): boolean => {
      for (let index = 0; index < screenPoints.length - 1; index += 1) {
        const start = screenPoints[index]!;
        const end = screenPoints[index + 1]!;
        if (screenSegmentIntersectsBox(start, end, box, 0)) return true;
      }
      return false;
    };
    const canUseLinkedTag =
      tagKind === 'position' ||
      tagKind === 'branch' ||
      tagKind === 'branch_label';
    let labelInfo = tagItem && canUseLinkedTag
      ? buildLabelInfo(tagAnnotations.get(tagItem.id))
      : null;
    if (!labelInfo) {
      for (const [id, tag] of tagAnnotations.entries()) {
        if (!id.startsWith('tag:position:') && !id.startsWith('tag:branch:')) continue;
        const candidate = buildLabelInfo(tag);
        if (!candidate || !leaderIntersectsLabel(candidate.labelBox)) continue;
        labelInfo = candidate;
        break;
      }
    }
    if (!labelInfo) return null;
    const { labelBox } = labelInfo;
    const originalLineBox = collectLocalPolylineScreenBox(points, camera, viewport);
    const originalLineSpan = originalLineBox
      ? Math.hypot(originalLineBox.width, originalLineBox.height)
      : 0;
    const validateClippedPoints = (candidate: Vector3[]): Vector3[] | null => {
      if (candidate.length < 2) return null;
      const box = collectLocalPolylineScreenBox(candidate, camera, viewport);
      if (!box) return null;
      const span = Math.hypot(box.width, box.height);
      if (!Number.isFinite(span)) return null;
      const maxSpan = Math.max(originalLineSpan + 120, originalLineSpan * 1.35, 96);
      if (span > maxSpan) return null;
      const outsideHard =
        box.right < -96 ||
        box.left > viewport.width + 96 ||
        box.bottom < -96 ||
        box.top > viewport.height + 96;
      return outsideHard ? null : candidate;
    };

    const leaderDepthRefWorld = group.localToWorld(points[0]!.clone());
    const toLocalAtLabelDepth = (screen: { x: number; y: number }): Vector3 | null => {
      const world = screenPointToWorldAtDepth(leaderDepthRefWorld, screen, camera, viewport);
      return world ? group.worldToLocal(world) : null;
    };
    const pointInsideLabelBox = (point: { x: number; y: number }): boolean =>
      point.x >= labelBox.left &&
      point.x <= labelBox.right &&
      point.y >= labelBox.top &&
      point.y <= labelBox.bottom;

    for (let index = 0; index < screenPoints.length - 1; index += 1) {
      const start = screenPoints[index]!;
      const end = screenPoints[index + 1]!;
      if (!screenSegmentIntersectsBox(start, end, labelBox, 0)) continue;
      const startInside = pointInsideLabelBox(start);
      const endInside = pointInsideLabelBox(end);
      if (startInside !== endInside) {
        const outside = startInside ? end : start;
        const outsideDx = outside.x - labelBox.x;
        const outsideDy = outside.y - labelBox.y;
        const outsideLen = Math.hypot(outsideDx, outsideDy);
        const farOutside = outsideLen > 1e-6
          ? {
            x: labelBox.x + (outsideDx / outsideLen) * 1000,
            y: labelBox.y + (outsideDy / outsideLen) * 1000,
          }
          : outside;
        const edge = screenRayBoxEdgePoint(labelBox, farOutside, 8);
        const screenSegmentLength = Math.hypot(end.x - start.x, end.y - start.y);
        const edgeT = edge && screenSegmentLength > 1e-6
          ? clampNumber(
            Math.hypot(edge.x - start.x, edge.y - start.y) / screenSegmentLength,
            0,
            1,
            0,
          )
          : null;
        const edgeLocal = edgeT == null
          ? null
          : points[index]!.clone().lerp(points[index + 1]!, edgeT);
        if (!edgeLocal) return null;
        if (startInside) {
          return validateClippedPoints([
            ...points.slice(0, index).map((point) => point.clone()),
            edgeLocal,
            ...points.slice(index + 1).map((point) => point.clone()),
          ]);
        }
        return validateClippedPoints([
          ...points.slice(0, index + 1).map((point) => point.clone()),
          edgeLocal,
          ...points.slice(index + 2).map((point) => point.clone()),
        ]);
      }
      if (!startInside && !endInside) {
        const keepStart = Math.hypot(start.x - labelBox.x, start.y - labelBox.y) >=
          Math.hypot(end.x - labelBox.x, end.y - labelBox.y);
        const outside = keepStart ? start : end;
        const outsideDx = outside.x - labelBox.x;
        const outsideDy = outside.y - labelBox.y;
        const outsideLen = Math.hypot(outsideDx, outsideDy);
        const farOutside = outsideLen > 1e-6
          ? {
            x: labelBox.x + (outsideDx / outsideLen) * 1000,
            y: labelBox.y + (outsideDy / outsideLen) * 1000,
          }
          : outside;
        const edge = screenRayBoxEdgePoint(labelBox, farOutside, 8);
        const screenSegmentLength = Math.hypot(end.x - start.x, end.y - start.y);
        const edgeT = edge && screenSegmentLength > 1e-6
          ? clampNumber(
            Math.hypot(edge.x - start.x, edge.y - start.y) / screenSegmentLength,
            0,
            1,
            0,
          )
          : null;
        const edgeLocal = edgeT == null
          ? null
          : points[index]!.clone().lerp(points[index + 1]!, edgeT);
        if (!edgeLocal) return null;
        return validateClippedPoints(keepStart
          ? [
            ...points.slice(0, index + 1).map((point) => point.clone()),
            edgeLocal,
          ]
          : [
            edgeLocal,
            ...points.slice(index + 1).map((point) => point.clone()),
          ]);
      }
    }

    const lineBox = collectLocalPolylineScreenBox(points, camera, viewport);
    if (!lineBox) return null;
    const lineSpan = Math.hypot(lineBox.width, lineBox.height);
    if (!Number.isFinite(lineSpan) || lineSpan > 96) return null;
    const lineArea = Math.max(1, lineBox.width * lineBox.height);
    const overlapArea = screenBoxOverlapArea(lineBox, labelBox);
    const covered = lineArea <= 1
      ? (
        lineBox.left >= labelBox.left &&
        lineBox.right <= labelBox.right &&
        lineBox.top >= labelBox.top &&
        lineBox.bottom <= labelBox.bottom
      )
      : overlapArea / lineArea >= 0.82;
    if (!covered) return null;

    let dx = lineBox.x - labelBox.x;
    let dy = lineBox.y - labelBox.y;
    let len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 1e-3) {
      dx = 0;
      dy = -1;
      len = 1;
    }
    const dir = { x: dx / len, y: dy / len };
    const farTarget = {
      x: labelBox.x + dir.x * 1000,
      y: labelBox.y + dir.y * 1000,
    };
    const stubStart = screenRayBoxEdgePoint(labelBox, farTarget, 8);
    if (!stubStart) return null;
    const stubLength = clampNumber(lineSpan, 28, 52, 36);
    const stubEnd = {
      x: stubStart.x + dir.x * stubLength,
      y: stubStart.y + dir.y * stubLength,
    };
    const localPoints = [stubStart, stubEnd]
      .map(toLocalAtLabelDepth)
      .filter((point): point is Vector3 => !!point)
      .map((point) => point.clone());
    return validateClippedPoints(localPoints);
  }

  function shouldSuppressDrawingLeaderInsidePriorityLabel(
    points: Vector3[],
    tagKind: MbdTagKind,
    camera: Camera,
    viewport: { width: number; height: number },
  ): boolean {
    if (!isMbdDrawingPresetRuntime() || points.length < 2) return false;
    if (
      tagKind !== 'position' &&
      tagKind !== 'branch' &&
      tagKind !== 'branch_label' &&
      tagKind !== 'elevation'
    ) {
      return false;
    }
    const lineBox = collectLocalPolylineScreenBox(points, camera, viewport);
    if (!lineBox) return false;
    const lineSpan = Math.hypot(lineBox.width, lineBox.height);
    if (!Number.isFinite(lineSpan) || lineSpan > 240) return false;
    const lineArea = Math.max(1, lineBox.width * lineBox.height);
    for (const [id, tag] of tagAnnotations.entries()) {
      if (!id.startsWith('tag:position:') && !id.startsWith('tag:branch:')) continue;
      const rawTag = asRaw(tag);
      if (!rawTag.visible) continue;
      rawTag.update(camera);
      const params = rawTag.getParams();
      const label = String(params.label ?? '').trim();
      const subtitle = String(params.subtitle ?? '').trim();
      const text = subtitle ? `${label}\n${subtitle}` : label;
      if (!text.trim()) continue;
      const labelWorld = getAnnotationLabelWorldPos(rawTag);
      const labelScreen = projectLabelToScreen(labelWorld, camera, viewport);
      if (!labelScreen) continue;
      const labelBox = expandScreenBox(labelScreenBox(labelScreen, text), 2);
      const overlapArea = screenBoxOverlapArea(lineBox, labelBox);
      if (lineArea <= 1) {
        if (
          lineBox.left >= labelBox.left &&
          lineBox.right <= labelBox.right &&
          lineBox.top >= labelBox.top &&
          lineBox.bottom <= labelBox.bottom
        ) {
          return true;
        }
      } else if (overlapArea / lineArea >= 0.82) {
        return true;
      }
    }
    return false;
  }

  function createLeaderLineTube(
    leaderId: string,
    start: Vector3,
    end: Vector3,
    radius: number,
    index: number,
  ): Mesh | null {
    const length = start.distanceTo(end);
    if (!Number.isFinite(length) || length < 1e-6) return null;

    const geometry = new TubeGeometry(
      new CatmullRomCurve3([start.clone(), end.clone()]),
      Math.max(1, Math.min(16, Math.ceil(length / 28))),
      radius,
      6,
      false,
    );
    const tube = markRaw(new Mesh(geometry, v2LeaderLineTubeMaterial));
    tube.name = `mbd-v2-leader-tube:${leaderId}:${index}`;
    tube.renderOrder = 982;
    tube.visible = false;
    tube.frustumCulled = false;
    (tube.userData as any).mbdAuxKind = 'v2_leader_line_tube';
    (tube.userData as any).mbdLeaderId = leaderId;
    return tube;
  }

  function shouldRenderDrawingTagLeaderExtension(tagKind: MbdTagKind): boolean {
    return (
      tagKind === 'material' ||
      tagKind === 'elbow' ||
      tagKind === 'flange' ||
      tagKind === 'branch' ||
      tagKind === 'other'
    );
  }

  function resolveLeaderLayoutTag(
    leader: MbdV2LeaderLinePrimitive,
    index: number,
  ): MbdLaidOutTagDto | null {
    const layoutTags = currentData.value?.layout_result?.tags ?? [];
    if (layoutTags.length <= 0) return null;

    const linkedTagId = String(leader.source_refno ?? '').trim();
    if (linkedTagId.startsWith('tag:')) {
      const linked = layoutTags.find((tag) => tag.id === linkedTagId);
      if (linked) return linked;
    }

    const numericSuffix = /(?:^|-)leader-(\d+)$/i.exec(String(leader.id ?? ''));
    if (numericSuffix) {
      const tagIndex = Number(numericSuffix[1]) - 1;
      const tag = layoutTags[tagIndex];
      if (tag) return tag;
    }

    const byIndex = layoutTags[index];
    return byIndex ?? null;
  }

  function resolveLeaderAnchorScreenPoint(
    points: Vector3[],
    camera: Camera,
    viewport: { width: number; height: number },
  ): { x: number; y: number; world: Vector3 } | null {
    const anchor = points[0];
    if (!anchor) return null;
    const world = group.localToWorld(anchor.clone());
    const screen = projectLabelToScreen(world, camera, viewport);
    return screen ? { ...screen, world } : null;
  }

  function screenRayBoxEdgePoint(
    box: MbdPipeDebugScreenBox,
    target: { x: number; y: number },
    paddingPx = 4,
  ): { x: number; y: number } | null {
    const dx = target.x - box.x;
    const dy = target.y - box.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (Math.hypot(dx, dy) < 1e-3) return null;

    const halfW = Math.max(1, box.width * 0.5 + paddingPx);
    const halfH = Math.max(1, box.height * 0.5 + paddingPx);
    const ratio = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
    if (!Number.isFinite(ratio) || ratio <= 1) return null;
    const scale = 1 / ratio;
    return {
      x: box.x + dx * scale,
      y: box.y + dy * scale,
    };
  }

  function resolveNearestLeaderScreenPoint(
    points: Vector3[],
    labelScreen: { x: number; y: number },
    camera: Camera,
    viewport: { width: number; height: number },
  ): { x: number; y: number; world: Vector3 } | null {
    let best:
      | { x: number; y: number; world: Vector3; distance: number }
      | null = null;
    for (const point of points) {
      const world = group.localToWorld(point.clone());
      const screen = projectLabelToScreen(world, camera, viewport);
      if (!screen) continue;
      const distance = Math.hypot(screen.x - labelScreen.x, screen.y - labelScreen.y);
      if (!Number.isFinite(distance)) continue;
      if (!best || distance < best.distance) {
        best = { ...screen, world, distance };
      }
    }
    return best ? { x: best.x, y: best.y, world: best.world } : null;
  }

  function collectObjectScreenBox(
    object: any,
    camera: Camera,
    viewport: { width: number; height: number },
  ): MbdPipeDebugScreenBox | null {
    const geometry = object?.geometry;
    const startAttr = geometry?.attributes?.instanceStart ?? null;
    const endAttr = geometry?.attributes?.instanceEnd ?? null;
    const positionAttr =
      geometry?.getAttribute?.('position') ??
      geometry?.attributes?.position ??
      null;
    const hasInstancedSegments = !!(
      startAttr &&
      endAttr &&
      Number.isFinite(Number(startAttr.count)) &&
      Number.isFinite(Number(endAttr.count)) &&
      Number(startAttr.count) > 0 &&
      Number(endAttr.count) > 0
    );
    if (
      !hasInstancedSegments &&
      (!positionAttr || !Number.isFinite(Number(positionAttr.count)) || Number(positionAttr.count) <= 0)
    ) {
      return null;
    }
    object.updateMatrixWorld?.(true);
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let projectedCount = 0;

    const projectPoint = (point: Vector3): void => {
      object.localToWorld(point);
      const screen = projectLabelToScreen(point, camera, viewport);
      if (!screen) return;
      projectedCount += 1;
      left = Math.min(left, screen.x);
      right = Math.max(right, screen.x);
      top = Math.min(top, screen.y);
      bottom = Math.max(bottom, screen.y);
    };

    if (hasInstancedSegments) {
      const count = Math.min(Number(startAttr.count), Number(endAttr.count));
      for (let index = 0; index < count; index += 1) {
        projectPoint(new Vector3().fromBufferAttribute(startAttr, index));
        projectPoint(new Vector3().fromBufferAttribute(endAttr, index));
      }
    } else {
      for (let index = 0; index < Number(positionAttr.count); index += 1) {
        projectPoint(new Vector3().fromBufferAttribute(positionAttr as any, index));
      }
    }

    if (
      projectedCount <= 0 ||
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      !Number.isFinite(top) ||
      !Number.isFinite(bottom)
    ) {
      return null;
    }
    return {
      x: Number(((left + right) * 0.5).toFixed(2)),
      y: Number(((top + bottom) * 0.5).toFixed(2)),
      width: Number((right - left).toFixed(2)),
      height: Number((bottom - top).toFixed(2)),
      left: Number(left.toFixed(2)),
      right: Number(right.toFixed(2)),
      top: Number(top.toFixed(2)),
      bottom: Number(bottom.toFixed(2)),
    };
  }

  function isDrawingModelOverlayObject(object: any): boolean {
    if (String(object?.name ?? '').startsWith('sel_edge_')) return true;
    let cursor = object?.parent;
    while (cursor) {
      if (String(cursor.name ?? '') === 'DTXSelectionOverlay') return true;
      cursor = cursor.parent;
    }
    return false;
  }

  function collectDrawingModelScreenBoxes(
    camera: Camera,
    viewport: { width: number; height: number },
  ): MbdPipeDebugScreenBox[] {
    const viewer = dtxViewerRef.value;
    const scene = viewer?.scene;
    if (!scene) return [];

    const boxes: MbdPipeDebugScreenBox[] = [];
    scene.updateMatrixWorld?.(true);
    scene.traverse((object: any) => {
      if (boxes.length >= 500) return;
      if (!isDrawingModelOverlayObject(object)) return;
      if (!/Line/.test(String(object?.type ?? ''))) return;
      const box = collectObjectScreenBox(object, camera, viewport);
      if (!box) return;
      if (box.width < 8 || box.height < 8) return;
      if (box.width * box.height > viewport.width * viewport.height * 0.72) return;
      boxes.push(box);
    });
    return boxes;
  }

  function expandScreenBox(
    box: MbdPipeDebugScreenBox,
    paddingPx: number,
  ): MbdPipeDebugScreenBox {
    const left = box.left - paddingPx;
    const right = box.right + paddingPx;
    const top = box.top - paddingPx;
    const bottom = box.bottom + paddingPx;
    return {
      x: (left + right) * 0.5,
      y: (top + bottom) * 0.5,
      width: right - left,
      height: bottom - top,
      left,
      right,
      top,
      bottom,
    };
  }

  function collectPipeBodyScreenBoxes(
    camera: Camera,
    viewport: { width: number; height: number },
  ): MbdPipeDebugScreenBox[] {
    const boxes: MbdPipeDebugScreenBox[] = [];
    group.updateMatrixWorld?.(true);
    for (const emphasis of pipeVisualEmphasisObjects.values()) {
      const box = collectObjectScreenBox(emphasis.body, camera, viewport);
      if (box) boxes.push(box);
    }
    return boxes;
  }

  function resolveDrawingLeaderExtensionScreenPoints(
    tagKind: MbdTagKind,
    labelBox: MbdPipeDebugScreenBox,
    startScreen: { x: number; y: number },
    endScreen: { x: number; y: number },
    camera: Camera,
    viewport: { width: number; height: number },
  ): { x: number; y: number }[] {
    if (tagKind !== 'material') return [startScreen, endScreen];

    const crossingBody = collectPipeBodyScreenBoxes(camera, viewport).find((box) =>
      screenSegmentIntersectsBox(startScreen, endScreen, box, -8),
    );
    if (!crossingBody) return [startScreen, endScreen];

    const dx = labelBox.x - crossingBody.x;
    const dy = labelBox.y - crossingBody.y;
    const useHorizontal = Math.abs(dx) >= Math.abs(dy);
    const sign = useHorizontal
      ? (dx >= 0 ? 1 : -1)
      : (dy >= 0 ? 1 : -1);
    const farTarget = useHorizontal
      ? { x: labelBox.x + sign * 1000, y: labelBox.y }
      : { x: labelBox.x, y: labelBox.y + sign * 1000 };
    const stubStart = screenRayBoxEdgePoint(labelBox, farTarget, 2) ?? startScreen;
    const directLength = Math.hypot(endScreen.x - startScreen.x, endScreen.y - startScreen.y);
    const stubLength = clampNumber(directLength * 0.75, 54, 72, 58);
    const stubEnd = useHorizontal
      ? { x: stubStart.x + sign * stubLength, y: stubStart.y }
      : { x: stubStart.x, y: stubStart.y + sign * stubLength };

    return [stubStart, stubEnd];
  }

  function createDrawingLeaderExtensionLine(
    leader: MbdV2LeaderLinePrimitive,
    points: Vector3[],
    index: number,
    camera: Camera,
    viewport: { width: number; height: number },
  ): void {
    if (!isMbdDrawingPresetRuntime() || points.length < 2) return;

    const tagItem = resolveLeaderLayoutTag(leader, index);
    if (!tagItem) return;
    const tagKind = classifyLaidOutTag(tagItem);
    if (!shouldRenderDrawingTagLeaderExtension(tagKind)) return;

    const tag = tagAnnotations.get(tagItem.id);
    const rawTag = tag ? asRaw(tag) : null;
    if (!rawTag || !rawTag.visible) return;
    rawTag.update(camera);
    const params = rawTag.getParams();
    const label = String(params.label ?? '').trim();
    const subtitle = String(params.subtitle ?? '').trim();
    const text = subtitle ? `${label}\n${subtitle}` : label;
    if (!text) return;

    const labelWorld = getAnnotationLabelWorldPos(rawTag);
    const labelScreen = projectLabelToScreen(labelWorld, camera, viewport);
    if (!labelScreen) return;

    const labelBox = labelScreenBox(labelScreen, text);
    const target =
      resolveLeaderAnchorScreenPoint(points, camera, viewport) ??
      resolveNearestLeaderScreenPoint(points, labelScreen, camera, viewport);
    if (!target) return;

    const startScreen = screenRayBoxEdgePoint(labelBox, target, tagKind === 'material' ? 2 : 6);
    if (!startScreen) return;

    const gapPx = Math.hypot(target.x - startScreen.x, target.y - startScreen.y);
    if (!Number.isFinite(gapPx) || gapPx < 18) return;

    const direction = {
      x: (target.x - startScreen.x) / gapPx,
      y: (target.y - startScreen.y) / gapPx,
    };
    const extensionPx = gapPx <= 92
      ? gapPx
      : clampNumber(gapPx * 0.28, 42, 72, tagKind === 'material' ? 56 : 64);
    const endScreen = {
      x: startScreen.x + direction.x * extensionPx,
      y: startScreen.y + direction.y * extensionPx,
    };
    const screenPoints = resolveDrawingLeaderExtensionScreenPoints(
      tagKind,
      labelBox,
      startScreen,
      endScreen,
      camera,
      viewport,
    );
    const localPoints = screenPoints
      .map((point) => screenPointToWorldAtDepth(labelWorld, point, camera, viewport))
      .filter((point): point is Vector3 => !!point)
      .map((point) => group.worldToLocal(point.clone()));
    if (localPoints.length < 2) return;

    const extensionLength = resolvePolylineLength(localPoints);
    if (!Number.isFinite(extensionLength) || extensionLength < 1e-6) return;

    const geom = new BufferGeometry();
    const positions = new Float32Array(localPoints.length * 3);
    localPoints.forEach((point, pointIndex) => {
      positions[pointIndex * 3] = point.x;
      positions[pointIndex * 3 + 1] = point.y;
      positions[pointIndex * 3 + 2] = point.z;
    });
    geom.setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3),
    );
    const line = markRaw(new Line(geom, v2LeaderLineMaterial));
    line.name = `mbd-v2-leader-extension:${leader.id}:${tagItem.id}`;
    line.renderOrder = 984;
    line.visible = isVisible.value && showLabels.value;
    line.frustumCulled = false;
    (line.userData as any).mbdAuxKind = 'v2_leader_extension';
    (line.userData as any).mbdLeaderId = leader.id;
    (line.userData as any).mbdTargetTagId = tagItem.id;
    (line.userData as any).mbdTagKind = tagKind;
    group.add(line);
    const extensionKey = `${leader.id}:${tagItem.id}`;
    v2LeaderExtensions.set(extensionKey, line);

    const tubeRadius = clampNumber(
      extensionLength * MBD_DRAWING_STYLE_PROFILE.leader.extensionTubeRadiusRatio,
      MBD_DRAWING_STYLE_PROFILE.leader.extensionTubeRadiusMin,
      MBD_DRAWING_STYLE_PROFILE.leader.extensionTubeRadiusMax,
      MBD_DRAWING_STYLE_PROFILE.leader.extensionTubeRadiusFallback,
    );
    const tube = createLeaderLineTube(
      `${leader.id}:${tagItem.id}:extension`,
      localPoints[0]!,
      localPoints[localPoints.length - 1]!,
      tubeRadius,
      0,
    );
    if (tube) {
      tube.name = `mbd-v2-leader-extension-tube:${leader.id}:${tagItem.id}`;
      tube.renderOrder = 983;
      tube.visible = isVisible.value && showLabels.value;
      (tube.userData as any).mbdAuxKind = 'v2_leader_extension_tube';
      (tube.userData as any).mbdLeaderId = leader.id;
      (tube.userData as any).mbdTargetTagId = tagItem.id;
      (tube.userData as any).mbdTagKind = tagKind;
      group.add(tube);
      v2LeaderExtensionTubes.set(extensionKey, tube);
    }
  }

  function clearDrawingLeaderExtensionLines(): void {
    for (const tube of v2LeaderExtensionTubes.values()) {
      try {
        (tube.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      tube.removeFromParent();
    }
    v2LeaderExtensionTubes.clear();

    for (const line of v2LeaderExtensions.values()) {
      try {
        (line.geometry as BufferGeometry)?.dispose?.();
      } catch {
        // ignore
      }
      line.removeFromParent();
    }
    v2LeaderExtensions.clear();
  }

  function rebuildDrawingLeaderExtensions(
    camera: Camera,
    viewport: { width: number; height: number },
  ): void {
    clearDrawingLeaderExtensionLines();
    if (!isMbdDrawingPresetRuntime()) return;
    const leaders = currentData.value?.v2_leader_lines ?? [];
    for (const [leaderIndex, leader] of leaders.entries()) {
      const rawPoints = (leader.points ?? [])
        .map((point) => toVector3(point))
        .filter((point): point is Vector3 => !!point);
      createDrawingLeaderExtensionLine(
        leader,
        rawPoints,
        leaderIndex,
        camera,
        viewport,
      );
    }
  }

  function renderV2LeaderLines(leaders: MbdV2LeaderLinePrimitive[]): void {
    const viewer = dtxViewerRef.value;
    const camera = viewer?.camera ?? null;
    const viewport = viewer
      ? {
        width: Math.max(1, Number(viewer.canvas.getBoundingClientRect().width) || 1),
        height: Math.max(1, Number(viewer.canvas.getBoundingClientRect().height) || 1),
      }
      : null;
    camera?.updateMatrixWorld?.(true);
    for (const [leaderIndex, leader] of leaders.entries()) {
      const rawPoints = (leader.points ?? [])
        .map((point) => toVector3(point))
        .filter((point): point is Vector3 => !!point);
      const tagItem = resolveLeaderLayoutTag(leader, leaderIndex);
      const tagKind = tagItem ? classifyLaidOutTag(tagItem) : 'other';
      if (tagItem && shouldSuppressDrawingTubiLengthTag(tagItem, tagKind)) {
        continue;
      }
      const renderedPoints = resolveDrawingLeaderRenderPoints(rawPoints, tagKind);
      const clippedLabelLeaderPoints = camera && viewport
        ? resolveDrawingLeaderClippedFromTagLabelPoints(
          renderedPoints,
          tagItem,
          tagKind,
          camera,
          viewport,
        )
        : null;
      const points = clippedLabelLeaderPoints ?? renderedPoints;
      if (points.length < 2) continue;
      const totalLength = resolvePolylineLength(points);
      if (!Number.isFinite(totalLength) || totalLength < 1e-6) continue;
      if (isMbdDrawingPresetRuntime() && camera && viewport) {
        const screenBox = collectLocalPolylineScreenBox(points, camera, viewport);
        const screenSpan = screenBox ? Math.hypot(screenBox.width, screenBox.height) : 0;
        if (!Number.isFinite(screenSpan) || screenSpan < 8) continue;
      }
      if (
        !clippedLabelLeaderPoints &&
        camera &&
        viewport &&
        shouldSuppressDrawingLeaderInsidePriorityLabel(points, tagKind, camera, viewport)
      ) {
        continue;
      }

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
      (line.userData as any).mbdTargetTagId = tagItem?.id ?? null;
      (line.userData as any).mbdTagKind = tagKind;
      const rawLine = markRaw(line);
      group.add(rawLine);
      v2LeaderLines.set(leader.id, rawLine);

      const tubeRadius = isMbdDrawingPresetRuntime()
        ? clampNumber(
          totalLength * MBD_DRAWING_STYLE_PROFILE.leader.lineTubeRadiusRatio,
          MBD_DRAWING_STYLE_PROFILE.leader.lineTubeRadiusMin,
          MBD_DRAWING_STYLE_PROFILE.leader.lineTubeRadiusMax,
          MBD_DRAWING_STYLE_PROFILE.leader.lineTubeRadiusFallback,
        )
        : clampNumber(totalLength * 0.0032, 1.1, 3.2, 1.8);
      const tubes: Mesh[] = [];
      for (let index = 1; index < points.length; index += 1) {
        const tube = createLeaderLineTube(
          leader.id,
          points[index - 1]!,
          points[index]!,
          tubeRadius,
          index - 1,
        );
        if (!tube) continue;
        (tube.userData as any).mbdTargetTagId = tagItem?.id ?? null;
        (tube.userData as any).mbdTagKind = tagKind;
        group.add(tube);
        tubes.push(tube);
      }
      if (tubes.length > 0) {
        v2LeaderLineTubes.set(leader.id, tubes);
      }
    }
    drawingLeaderExtensionsNeedRebuild = isMbdDrawingPresetRuntime();
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
    syncAnnotationGroupMatrix(gm);

    // 更新材质分辨率
    const rect = viewer.canvas.getBoundingClientRect();
    setResolution(rect.width, rect.height);

    const effectiveElevationMarks = resolveEffectiveElevationMarks(data);
    const effectiveEnvelope = resolveEffectiveEnvelope(data);
    const useLayoutResult = shouldUseLayoutFirstResult(mbdViewMode.value, data);
    renderSource.value = useLayoutResult ? 'layout_result' : 'fallback';

    // 渲染各类标注
    if (useLayoutResult) {
      const rawLayoutCutTubis = data.layout_result.cut_tubis ?? [];
      const visibleLayoutCutTubisForDedupe = showCutTubis.value ? rawLayoutCutTubis : [];
      const layoutLinearDims = filterRedundantDrawingLinearDims(
        data.layout_result.linear_dims ?? [],
        visibleLayoutCutTubisForDedupe,
      );
      const layoutCutTubis = filterRedundantDrawingCutTubis(
        rawLayoutCutTubis,
        layoutLinearDims,
      );
      renderLaidOutLinearDims(layoutLinearDims);
      if (data.layout_result.welds?.length) renderLaidOutWelds(data.layout_result.welds);
      if (data.layout_result.slopes?.length) renderLaidOutSlopes(data.layout_result.slopes);
      if (data.pipe_clearances?.length) renderPipeClearances(data.pipe_clearances);
      if (data.structure_clearances?.length) {
        renderStructureClearances(data.structure_clearances);
      }
      if (data.layout_result.bends?.length) renderLaidOutBends(data.layout_result.bends);
      if (layoutCutTubis.length) {
        renderLaidOutCutTubis(layoutCutTubis);
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
      if (data.dims?.length) renderDims(data.dims, data.segments ?? [], pipeOffsetDirs);
      if (showCutTubis.value && data.cut_tubis?.length) {
        renderCutTubis(data.cut_tubis, data.segments ?? [], pipeOffsetDirs);
      }
      if (data.welds?.length) renderWelds(data.welds);
      if (data.slopes?.length) renderSlopes(data.slopes);
      if (data.bends?.length) renderBends(data.bends, data.segments ?? []);
      if (data.pipe_clearances?.length) renderPipeClearances(data.pipe_clearances);
      if (data.structure_clearances?.length) {
        renderStructureClearances(data.structure_clearances);
      }
      if (data.fittings?.length) renderFittings(data.fittings);
      if (data.tags?.length) renderTags(data.tags);
      applyPortDimLabelDeclutter();
      applyChainOffsetUnification();
      applyCutTubiLabelDeclutter();
      applyTagLabelDeclutter();
      applyCutTubiLabelDeclutter(true);
      if (effectiveElevationMarks.length > 0) renderElevationMarks(effectiveElevationMarks);
      renderEnvelope(effectiveEnvelope);
    }
    if (data.v2_leader_lines?.length) renderV2LeaderLines(data.v2_leader_lines);
    if ((isMbdDrawingPresetRuntime() || showPipeVisualEmphasis.value) && data.segments?.length) {
      renderPipeVisualEmphasis(data.segments);
    }
    if ((isMbdDrawingPresetRuntime() || showPipeVisualEmphasis.value) && data.fittings?.length) {
      renderFittingVisualEmphasis(data.fittings, data.segments ?? []);
    }
    if (data.segments?.length) renderSegments(data.segments);
    if (data.segments?.length) renderFlowDirections(data.segments);
    renderDebugOverlays(data);
    if (renderSource.value === 'layout_result') {
      applyLayoutScreenLabelDeclutter();
    }

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
    const drawingPreset = isMbdDrawingPresetRuntime();

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
    const expandLaidOutLinear = (d: MbdLaidOutLinearDimDto) => {
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
    };

    if (data.layout_result) {
      const rawLayoutCutTubis = data.layout_result.cut_tubis || [];
      const visibleLayoutCutTubisForDedupe = showCutTubis.value ? rawLayoutCutTubis : [];
      const layoutLinearDims = filterRedundantDrawingLinearDims(
        data.layout_result.linear_dims || [],
        visibleLayoutCutTubisForDedupe,
      );
      const layoutCutTubis = filterRedundantDrawingCutTubis(
        rawLayoutCutTubis,
        layoutLinearDims,
      );
      for (const d of layoutLinearDims) expandLaidOutLinear(d);
      for (const d of layoutCutTubis) expandLaidOutLinear(d);
      for (const tag of data.layout_result.tags || []) {
        expand(tag.position);
        if (!drawingPreset && tag.label_offset_world) {
          tmp
            .set(
              tag.position[0] + tag.label_offset_world[0],
              tag.position[1] + tag.label_offset_world[1],
              tag.position[2] + tag.label_offset_world[2],
            )
            .applyMatrix4(gm);
          box.expandByPoint(tmp);
          hasAny = true;
        }
      }
      for (const fitting of data.layout_result.fittings || []) {
        expand(fitting.position);
        if (!drawingPreset && fitting.label_offset_world) {
          tmp
            .set(
              fitting.position[0] + fitting.label_offset_world[0],
              fitting.position[1] + fitting.label_offset_world[1],
              fitting.position[2] + fitting.label_offset_world[2],
            )
            .applyMatrix4(gm);
          box.expandByPoint(tmp);
          hasAny = true;
        }
      }
      for (const bend of data.layout_result.bends || []) {
        for (const dim of bend.size_dims || []) expandLaidOutLinear(dim);
        if (bend.angle) {
          expand(bend.angle.vertex);
          expand(bend.angle.point1);
          expand(bend.angle.point2);
        }
      }
      for (const weld of data.layout_result.welds || []) expand(weld.position);
      for (const slope of data.layout_result.slopes || []) {
        expand(slope.start);
        expand(slope.end);
      }
    } else {
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
      for (const leader of data.v2_leader_lines || []) {
        const leaderPoints = (leader.points || [])
          .map((point) => toVector3(point))
          .filter((point): point is Vector3 => !!point);
        const renderPoints = drawingPreset
          ? resolveDrawingLeaderRenderPoints(leaderPoints)
          : leaderPoints;
        for (const point of renderPoints) {
          expand([point.x, point.y, point.z]);
        }
      }
      for (const seg of data.segments || []) {
        if (seg.arrive) expand(seg.arrive);
        if (seg.leave) expand(seg.leave);
      }
    }
    if (!hasAny || box.isEmpty()) return;

    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const pad = drawingPreset
      ? clampNumber(maxDim * 0.5, 0.12, 2.5, 0.34)
      : clampNumber(maxDim * 0.25, 0.06, 1.25, 0.18);
    box.expandByScalar(pad);

    const { position, target } = computeFlyToPositionFromBox(
      box,
      drawingPreset,
    );
    const flyToDuration = drawingPreset ? 0 : 800;
    const relayoutDelay = drawingPreset ? 80 : 900;
    viewer.flyTo(position, target, { duration: flyToDuration });
    const relayoutForCurrentCamera = () => {
      applyLaidOutDimLabelDeclutter();
      applyLayoutScreenLabelDeclutter();
      updateLabelPositions();
      requestRender?.();
    };
    window.setTimeout(relayoutForCurrentCamera, relayoutDelay);
    if (drawingPreset) {
      window.setTimeout(relayoutForCurrentCamera, 240);
    }
  }

  function applyLayoutScreenLabelDeclutterThrottled(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const wait = layoutScreenDeclutterMinIntervalMs - (now - layoutScreenDeclutterLastRunMs);
    if (wait <= 0) {
      applyLayoutScreenLabelDeclutter();
      return;
    }
    if (layoutScreenDeclutterTimer !== null || typeof window === 'undefined') return;
    layoutScreenDeclutterTimer = window.setTimeout(() => {
      layoutScreenDeclutterTimer = null;
      applyLayoutScreenLabelDeclutter();
      requestRender?.();
    }, wait);
  }

  function updateLabelPositions(): void {
    const viewer = dtxViewerRef.value;
    if (!viewer || !isVisible.value) return;

    // 若全局模型矩阵在运行期变化（例如单位/重心配置），需要保持标注组与之同步。
    const gm = getGlobalModelMatrix?.() || identityMatrix;
    syncAnnotationGroupMatrix(gm);

    applyLayoutScreenLabelDeclutterThrottled();

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
    for (const endpoint of branchFlowEndpointObjects.values()) {
      asRaw(endpoint.marker).update(camera);
    }
    if (drawingLeaderExtensionsNeedRebuild) {
      rebuildDrawingLeaderExtensions(camera, {
        width: Math.max(1, Number(rect.width) || 1),
        height: Math.max(1, Number(rect.height) || 1),
      });
      drawingLeaderExtensionsNeedRebuild = false;
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

  function getFlowDirectionObjects(): Map<string, MbdFlowDirectionObject> {
    return flowDirectionObjects;
  }

  function getBranchFlowEndpointObjects(): Map<'inlet' | 'outlet', MbdBranchFlowEndpointObject> {
    return branchFlowEndpointObjects;
  }

  function collectDebugScreenItems(): {
    viewport: { width: number; height: number } | null;
    items: MbdPipeDebugScreenItem[];
    overlapPairs: MbdPipeDebugOverlapPair[];
    severeOverlapCount: number;
    } {
    const viewer = dtxViewerRef.value;
    if (!viewer) {
      return {
        viewport: null,
        items: [],
        overlapPairs: [],
        severeOverlapCount: 0,
      };
    }

    const camera = viewer.camera;
    camera.updateMatrixWorld?.(true);
    const rect = viewer.canvas.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1),
    };
    const items: MbdPipeDebugScreenItem[] = [];

    const append = (
      id: string,
      kind: MbdPipeDebugScreenItem['kind'],
      text: string,
      labelWorldPos: Vector3 | null,
    ): void => {
      if (!labelWorldPos || String(text).trim().length === 0) return;
      const screen = projectLabelToScreen(labelWorldPos, camera, viewport);
      if (!screen) return;
      const box = labelScreenBox(screen, text);
      const margin = 24;
      items.push({
        id,
        kind,
        text,
        x: screen.x,
        y: screen.y,
        box,
        in_viewport:
          box.right >= -margin &&
          box.bottom >= -margin &&
          box.left <= viewport.width + margin &&
          box.top <= viewport.height + margin,
      });
    };

    for (const [id, dim] of dimAnnotations) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible || !!(rawDim.userData as any)?.mbdDeclutterHidden) continue;
      append(id, 'dim', dim.getDisplayText(), getAnnotationLabelWorldPos(dim));
    }
    for (const [id, dim] of cutTubiAnnotations) {
      const rawDim = asRaw(dim);
      if (!rawDim.visible || !!(rawDim.userData as any)?.mbdDeclutterHidden) continue;
      append(id, 'cut_tubi', dim.getDisplayText(), getAnnotationLabelWorldPos(dim));
    }
    for (const [id, tag] of tagAnnotations) {
      const rawTag = asRaw(tag);
      if (!rawTag.visible || !!(rawTag.userData as any)?.mbdDeclutterHidden) continue;
      const params = tag.getParams();
      const label = String(params.label ?? '').trim();
      const subtitle = String(params.subtitle ?? '').trim();
      append(
        id,
        'tag',
        subtitle ? `${label}\n${subtitle}` : label,
        getAnnotationLabelWorldPos(tag),
      );
    }

    const overlapPairs: MbdPipeDebugOverlapPair[] = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        const overlapArea = screenBoxOverlapArea(a.box, b.box);
        if (overlapArea <= 0) continue;
        const aArea = Math.max(1, a.box.width * a.box.height);
        const bArea = Math.max(1, b.box.width * b.box.height);
        overlapPairs.push({
          a_id: a.id,
          b_id: b.id,
          a_text: a.text,
          b_text: b.text,
          overlap_area: Number(overlapArea.toFixed(2)),
          min_area_ratio: Number((overlapArea / Math.min(aArea, bArea)).toFixed(3)),
        });
      }
    }
    const severeOverlapCount = overlapPairs.filter((pair) => pair.min_area_ratio >= 0.35).length;

    return {
      viewport,
      items,
      overlapPairs,
      severeOverlapCount,
    };
  }

  function collectDebugDimensionArrowStates(): MbdPipeDebugDimensionArrowState[] {
    const viewer = dtxViewerRef.value;
    if (!viewer) return [];
    const camera = viewer.camera;
    camera.updateMatrixWorld?.(true);
    const rect = viewer.canvas.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1),
    };
    const areaForGeometry = (
      dim: LinearDimension3D,
      geometry: BufferGeometry | null | undefined,
    ): number | null => {
      const attr = geometry?.getAttribute('position');
      if (!attr || attr.count < 3) return null;
      const points = [0, 1, 2]
        .map((index) => {
          const point = new Vector3().fromBufferAttribute(attr as any, index);
          dim.localToWorld(point);
          return projectLabelToScreen(point, camera, viewport);
        });
      if (points.some((point) => !point)) return null;
      const [a, b, c] = points as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ];
      return Number((
        Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5
      ).toFixed(2));
    };

    return Array.from(dimAnnotations.entries()).map(([id, dim]) => {
      const raw = asRaw(dim);
      const lineMaterial = ((raw as any).dimensionLineA as any)?.material as any;
      const resolution = lineMaterial?.resolution;
      return {
        id,
        kind: String((raw.userData as any)?.mbdDimKind ?? 'segment'),
        arrow1_visible: !!((raw as any).arrow1 as any)?.visible,
        arrow2_visible: !!((raw as any).arrow2 as any)?.visible,
        open1_visible: !!((raw as any).arrowOpen1 as any)?.visible,
        open2_visible: !!((raw as any).arrowOpen2 as any)?.visible,
        arrow1_screen_area: areaForGeometry(
          raw,
          ((raw as any).arrowGeometry1 as BufferGeometry | null | undefined),
        ),
        arrow2_screen_area: areaForGeometry(
          raw,
          ((raw as any).arrowGeometry2 as BufferGeometry | null | undefined),
        ),
        line_resolution: resolution
          ? {
            x: Number(resolution.x) || 0,
            y: Number(resolution.y) || 0,
          }
          : null,
      };
    });
  }

  function collectDebugV2LeaderLineStates(): MbdPipeDebugV2LeaderLineState[] {
    const viewer = dtxViewerRef.value;
    if (!viewer) return [];

    const camera = viewer.camera;
    camera.updateMatrixWorld?.(true);
    const rect = viewer.canvas.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1),
    };

    return Array.from(v2LeaderLines.entries()).map(([id, line]) => {
      const rawLine = asRaw(line);
      const attr = rawLine.geometry?.getAttribute('position');
      if (!attr || attr.count <= 0) {
        return {
          id,
          point_count: 0,
          screen_span_px: null,
          screen_box: null,
        };
      }

      const points: { x: number; y: number }[] = [];
      for (let index = 0; index < attr.count; index += 1) {
        const point = new Vector3().fromBufferAttribute(attr as any, index);
        rawLine.localToWorld(point);
        const screen = projectLabelToScreen(point, camera, viewport);
        if (screen) points.push(screen);
      }
      if (points.length === 0) {
        return {
          id,
          point_count: attr.count,
          screen_span_px: null,
          screen_box: null,
        };
      }

      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      let span = 0;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i]!;
        left = Math.min(left, a.x);
        right = Math.max(right, a.x);
        top = Math.min(top, a.y);
        bottom = Math.max(bottom, a.y);
        for (let j = i + 1; j < points.length; j += 1) {
          const b = points[j]!;
          span = Math.max(span, Math.hypot(b.x - a.x, b.y - a.y));
        }
      }

      return {
        id,
        point_count: attr.count,
        screen_span_px: Number(span.toFixed(2)),
        screen_box: {
          x: Number(left.toFixed(2)),
          y: Number(top.toFixed(2)),
          width: Number((right - left).toFixed(2)),
          height: Number((bottom - top).toFixed(2)),
          left: Number(left.toFixed(2)),
          right: Number(right.toFixed(2)),
          top: Number(top.toFixed(2)),
          bottom: Number(bottom.toFixed(2)),
        },
      };
    });
  }

  function collectDebugLineObjectStates(): MbdPipeDebugLineObjectState[] {
    const viewer = dtxViewerRef.value;
    if (!viewer) return [];

    const camera = viewer.camera;
    camera.updateMatrixWorld?.(true);
    const rect = viewer.canvas.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, Number(rect.width) || 1),
      height: Math.max(1, Number(rect.height) || 1),
    };
    const states: MbdPipeDebugLineObjectState[] = [];

    const collectPositions = (object: any): Vector3[] => {
      const geometry = object?.geometry;
      const startAttr = geometry?.attributes?.instanceStart ?? null;
      const endAttr = geometry?.attributes?.instanceEnd ?? null;
      if (
        startAttr &&
        endAttr &&
        Number.isFinite(Number(startAttr.count)) &&
        Number.isFinite(Number(endAttr.count))
      ) {
        const points: Vector3[] = [];
        const count = Math.min(Number(startAttr.count), Number(endAttr.count));
        for (let index = 0; index < count; index += 1) {
          const start = new Vector3().fromBufferAttribute(startAttr, index);
          object.localToWorld(start);
          points.push(start);
          const end = new Vector3().fromBufferAttribute(endAttr, index);
          object.localToWorld(end);
          points.push(end);
        }
        return points;
      }
      const attr =
        geometry?.getAttribute?.('position') ??
        geometry?.attributes?.position ??
        null;
      if (!attr || !Number.isFinite(Number(attr.count)) || Number(attr.count) <= 0) {
        return [];
      }
      const points: Vector3[] = [];
      const count = Number(attr.count);
      for (let index = 0; index < count; index += 1) {
        const point = new Vector3().fromBufferAttribute(attr, index);
        object.localToWorld(point);
        points.push(point);
      }
      return points;
    };
    const readNearestUserData = (object: any, key: string): string | null => {
      let cursor: any = object;
      while (cursor) {
        const value = cursor.userData?.[key];
        if (value != null && String(value).length > 0) return String(value);
        cursor = cursor.parent;
      }
      return null;
    };
    const readNearestAnnotationId = (object: any): string | null =>
      readNearestUserData(object, 'mbdDimId') ??
      readNearestUserData(object, 'mbdCutTubiId') ??
      readNearestUserData(object, 'mbdPipeClearanceId') ??
      readNearestUserData(object, 'mbdStructureClearanceId') ??
      readNearestUserData(object, 'mbdSourcePrimitiveId');
    const readMaterialLineWidth = (material: any): number | null => {
      const raw = Number(material?.linewidth);
      return Number.isFinite(raw) ? Number(raw.toFixed(3)) : null;
    };
    const readMaterialColor = (material: any): string | null => {
      const color = material?.color;
      if (!color || typeof color.getHexString !== 'function') return null;
      return `#${String(color.getHexString()).toLowerCase()}`;
    };
    const shouldCollectDebugObjectState = (
      type: string,
      auxKind: string | null,
    ): boolean => {
      if (/Line/.test(type)) return true;
      return (
        auxKind === 'v2_leader_line_tube' ||
        auxKind === 'v2_leader_extension_tube' ||
        auxKind === 'pipe-visual-body' ||
        auxKind === 'pipe-visual-ring' ||
        auxKind === 'pipe-visual-band' ||
        auxKind === 'pipe-visual-rail' ||
        auxKind === 'pipe-visual-outline' ||
        auxKind === 'fitting-visual-core' ||
        auxKind === 'fitting-visual-port' ||
        auxKind === 'fitting-visual-arm'
      );
    };

    group.traverse((object: any) => {
      const type = String(object?.type ?? '');
      const auxKind = readNearestUserData(object, 'mbdAuxKind');
      if (!shouldCollectDebugObjectState(type, auxKind)) return;
      const points = collectPositions(object);
      if (points.length <= 0) return;

      const screenPoints = points
        .map((point) => projectLabelToScreen(point, camera, viewport))
        .filter((point): point is { x: number; y: number } => !!point);
      if (screenPoints.length <= 0) return;

      const hasInstancedLineSegments = !!(
        object?.geometry?.attributes?.instanceStart &&
        object?.geometry?.attributes?.instanceEnd
      );
      const screenSegments: MbdPipeDebugLineObjectState['screen_segments'] = [];
      if (hasInstancedLineSegments || type === 'LineSegments' || type === 'LineSegments2') {
        for (let index = 1; index < screenPoints.length; index += 2) {
          const a = screenPoints[index - 1]!;
          const b = screenPoints[index]!;
          screenSegments.push({
            x1: Number(a.x.toFixed(2)),
            y1: Number(a.y.toFixed(2)),
            x2: Number(b.x.toFixed(2)),
            y2: Number(b.y.toFixed(2)),
          });
        }
      } else if (type === 'Line' || type === 'Line2') {
        for (let index = 1; index < screenPoints.length; index += 1) {
          const a = screenPoints[index - 1]!;
          const b = screenPoints[index]!;
          screenSegments.push({
            x1: Number(a.x.toFixed(2)),
            y1: Number(a.y.toFixed(2)),
            x2: Number(b.x.toFixed(2)),
            y2: Number(b.y.toFixed(2)),
          });
        }
      }

      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      let span = 0;
      for (let i = 0; i < screenPoints.length; i += 1) {
        const a = screenPoints[i]!;
        left = Math.min(left, a.x);
        right = Math.max(right, a.x);
        top = Math.min(top, a.y);
        bottom = Math.max(bottom, a.y);
        for (let j = i + 1; j < screenPoints.length; j += 1) {
          const b = screenPoints[j]!;
          span = Math.max(span, Math.hypot(b.x - a.x, b.y - a.y));
        }
      }
      const mat = Array.isArray(object.material) ? object.material[0] : object.material;
      states.push({
        name: String(object.name ?? ''),
        type,
        annotation_id: readNearestAnnotationId(object),
        line_role: readNearestUserData(object, 'mbdLineRole'),
        dim_kind: readNearestUserData(object, 'mbdDimKind'),
        leader_id: readNearestUserData(object, 'mbdLeaderId'),
        target_tag_id: readNearestUserData(object, 'mbdTargetTagId'),
        tag_kind: readNearestUserData(object, 'mbdTagKind'),
        aux_kind: auxKind,
        visible: object.visible !== false,
        screen_span_px: Number(span.toFixed(2)),
        screen_box: {
          x: Number(left.toFixed(2)),
          y: Number(top.toFixed(2)),
          width: Number((right - left).toFixed(2)),
          height: Number((bottom - top).toFixed(2)),
          left: Number(left.toFixed(2)),
          right: Number(right.toFixed(2)),
          top: Number(top.toFixed(2)),
          bottom: Number(bottom.toFixed(2)),
        },
        screen_segments: screenSegments.length > 0 ? screenSegments : undefined,
        opacity: Number.isFinite(Number(mat?.opacity))
          ? Number(Number(mat.opacity).toFixed(3))
          : null,
        line_width_px: readMaterialLineWidth(mat),
        color_hex: readMaterialColor(mat),
      });
    });

    return states.sort((a, b) => (b.screen_span_px ?? 0) - (a.screen_span_px ?? 0));
  }

  function getDebugSnapshot(): MbdPipeDebugSnapshot {
    const data = currentData.value;
    const layout = data?.layout_result ?? null;
    const materialRows = data?.material_rows ?? data?.material_table?.rows ?? [];
    const screenSnapshot = collectDebugScreenItems();
    const dimensionArrowStates = collectDebugDimensionArrowStates();
    const v2LeaderLineStates = collectDebugV2LeaderLineStates();
    const lineObjectStates = collectDebugLineObjectStates();
    const pipeVisualCounts = Array.from(pipeVisualEmphasisObjects.values()).reduce(
      (acc, emphasis) => {
        acc.bodies += 1;
        acc.spines += 1;
        acc.rings += emphasis.rings.length;
        acc.bands += emphasis.bands.length;
        acc.rails += emphasis.rails.length;
        acc.outlines += emphasis.outlines.length;
        return acc;
      },
      {
        bodies: 0,
        bands: 0,
        outlines: 0,
        rails: 0,
        rings: 0,
        spines: 0,
      },
    );
    const fittingVisualCounts = Array.from(fittingVisualEmphasisObjects.values()).reduce(
      (acc, emphasis) => {
        acc.cores += emphasis.coreRings.length;
        acc.ports += emphasis.portRings.length;
        acc.arms += emphasis.arms.length;
        return acc;
      },
      {
        arms: 0,
        cores: 0,
        ports: 0,
      },
    );
    const renderedTagTexts = Array.from(tagAnnotations.values())
      .map((tag) => {
        try {
          const params = tag.getParams();
          const label = String(params.label ?? '').trim();
          const subtitle = String(params.subtitle ?? '').trim();
          return subtitle ? `${label}\n${subtitle}` : label;
        } catch {
          return '';
        }
      })
      .filter((text) => text.length > 0);
    const renderedTagStates = Array.from(tagAnnotations.entries()).map(([id, tag]) => {
      const raw = asRaw(tag);
      let text = '';
      try {
        const params = raw.getParams();
        const label = String(params.label ?? '').trim();
        const subtitle = String(params.subtitle ?? '').trim();
        text = subtitle ? `${label}\n${subtitle}` : label;
      } catch {
        text = '';
      }
      return {
        id,
        kind: String((raw.userData as any)?.mbdTagKind ?? 'other'),
        text,
        visible: raw.visible,
        layout_hidden: !!(raw.userData as any)?.mbdLayoutHidden,
        declutter_hidden: !!(raw.userData as any)?.mbdDeclutterHidden,
      };
    });
    const isVisibleAnnotation = (annotation: { visible?: boolean; userData?: unknown }): boolean => {
      const raw = asRaw(annotation) as any;
      return raw.visible !== false &&
        !(raw.userData as any)?.mbdLayoutHidden &&
        !(raw.userData as any)?.mbdDeclutterHidden;
    };
    const visibleDimCount = Array.from(dimAnnotations.values())
      .filter(isVisibleAnnotation).length;
    const visibleCutTubiCount = Array.from(cutTubiAnnotations.values())
      .filter(isVisibleAnnotation).length;
    const visibleTagCount = Array.from(tagAnnotations.values())
      .filter(isVisibleAnnotation).length;

    return {
      branch_refno: data?.branch_refno ?? null,
      branch_name: data?.branch_name ?? null,
      render_source: renderSource.value,
      visible: isVisible.value,
      data_counts: {
        segments: data?.segments?.length ?? 0,
        dims: data?.dims?.length ?? 0,
        layout_linear_dims: layout?.linear_dims?.length ?? 0,
        cut_tubis: data?.cut_tubis?.length ?? 0,
        tags: data?.tags?.length ?? 0,
        fittings: data?.fittings?.length ?? 0,
        layout_tags: layout?.tags?.length ?? 0,
        v2_leader_lines: data?.v2_leader_lines?.length ?? 0,
        elevation_marks: resolveEffectiveElevationMarks(data).length,
        material_rows: materialRows.length,
      },
      rendered_counts: {
        group_children: group.children.length,
        dims: visibleDimCount,
        cut_tubis: visibleCutTubiCount,
        tags: visibleTagCount,
        v2_leader_lines: v2LeaderLines.size,
        v2_leader_extensions: v2LeaderExtensions.size,
        pipe_visual_bodies: pipeVisualCounts.bodies,
        pipe_visual_bands: pipeVisualCounts.bands,
        pipe_visual_rails: pipeVisualCounts.rails,
        pipe_visual_outlines: pipeVisualCounts.outlines,
        pipe_visual_rings: pipeVisualCounts.rings,
        pipe_visual_spines: pipeVisualCounts.spines,
        fitting_visual_cores: fittingVisualCounts.cores,
        fitting_visual_ports: fittingVisualCounts.ports,
        fitting_visual_arms: fittingVisualCounts.arms,
        elevations: elevationAnnotations.size,
        envelope_objects: envelopeObjects.size,
      },
      dim_texts: Array.from(dimAnnotations.values())
        .map((dim) => dim.getDisplayText())
        .filter((text) => String(text).trim().length > 0),
      cut_tubi_texts: Array.from(cutTubiAnnotations.values())
        .map((dim) => dim.getDisplayText())
        .filter((text) => String(text).trim().length > 0),
      tag_texts: [
        ...(layout?.tags ?? []).map((tag) => String(tag.text ?? '')),
        ...(data?.tags ?? []).map((tag) => String(tag.text ?? '')),
      ].filter((text) => text.trim().length > 0),
      rendered_tag_texts: renderedTagTexts,
      rendered_tag_states: renderedTagStates,
      dimension_arrow_states: dimensionArrowStates,
      v2_leader_line_states: v2LeaderLineStates,
      line_object_states: lineObjectStates,
      viewport: screenSnapshot.viewport,
      screen_items: screenSnapshot.items,
      screen_overlap_pairs: screenSnapshot.overlapPairs,
      severe_screen_overlap_count: screenSnapshot.severeOverlapCount,
    };
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
    v2LeaderLineTubeMaterial.dispose();
    pipeEmphasisBodyMaterial.dispose();
    pipeEmphasisRingMaterial.dispose();
    pipeEmphasisBandMaterial.dispose();
    pipeEmphasisRailMaterial.dispose();
    pipeEmphasisOutlineMaterial.dispose();
    fittingEmphasisCoreMaterial.dispose();
    fittingEmphasisPortMaterial.dispose();
    fittingEmphasisArmMaterial.dispose();
    pipeEmphasisSpineMaterial.dispose();
    flowCenterlineMaterial.dispose();
    flowArrowMaterial.dispose();
    flowInletMarkerMaterial.dispose();
    flowOutletMarkerMaterial.dispose();
    flowPulseMaterial.dispose();
    stopFlowAnimation();
    if (layoutScreenDeclutterTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(layoutScreenDeclutterTimer);
      layoutScreenDeclutterTimer = null;
    }
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
      showFlowDirection,
      showLabels,
    ],
    () => {
      try {
        applyPortDimLabelDeclutter();
        applyVisibility();
        applyCutTubiLabelDeclutter();
        applyTagLabelDeclutter();
        applyCutTubiLabelDeclutter(true);
        applyLayoutScreenLabelDeclutter();
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
          applyLayoutScreenLabelDeclutter();
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

  watch(
    () => mbdDrawingStyleStore.version.value,
    () => {
      try {
        if (isMbdDrawingPresetRuntime()) {
          rebarvizArrowSizePx.value = MBD_DRAWING_STYLE_PROFILE.dimension.arrowSizePx;
          rebarvizArrowAngleDeg.value = MBD_DRAWING_STYLE_PROFILE.dimension.arrowAngleDeg;
          rebarvizLineWidthPx.value = MBD_DRAWING_STYLE_PROFILE.dimension.lineWidthPx;
        }
        applyMbdDrawingRuntimeStyle();

        const data = currentData.value;
        if (data) {
          renderBranch(data);
        } else {
          applyLabelRenderStyleByMode();
          requestRender?.();
        }
      } catch {
        // keep settings changes non-fatal during tests and partial viewer teardown
      }
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
    showInlineTubeLengthDims,
    showPipeVisualEmphasis,
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
    showFlowDirection,
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
    getFlowDirectionObjects,
    getBranchFlowEndpointObjects,
    getDebugSnapshot,
    resolveElevationMarks,
    resolveEnvelopeData,
  };
}
