/**
 * MBD 管道标注 API（首期：管道分支 BRAN/HANG）
 *
 * 后端：gen_model-dev（aios-database web_server）
 * 路由：GET /api/mbd/pipe/{refno}
 */

import { getBackendApiBaseUrl } from '@/utils/apiBase';

export type Vec3 = [number, number, number]

export type MbdPipeSource = 'db' | 'cache'
export type MbdPipeApiMode = 'layout_first' | 'construction' | 'inspection'
export type MbdPipeViewMode = MbdPipeApiMode

export type BranchAttrsDto = {
  duty?: string | null
  pspec?: string | null
  hbor?: number | null
  tbor?: number | null
  rccm?: string | null
  clean?: string | null
  temp?: string | null
  pressure?: number | null
  ispec?: string | null
  insuthick?: number | null
  tspec?: string | null
  swgd?: string | null
  drawnum?: string | null
  rev?: string | null
  status?: string | null
  fluid?: string | null
}

export type MbdPipeStats = {
  segments_count: number
  dims_count: number
  welds_count: number
  slopes_count: number
  bends_count: number
  cut_tubis_count?: number
  fittings_count?: number
  tags_count?: number
  material_rows_count?: number
}

export type MbdPipeDebugInfo = {
  source?: MbdPipeSource
  notes?: string[]
  [k: string]: unknown
}

export type MbdPipeSegmentDto = {
  id: string
  refno: string
  noun: string
  name?: string | null
  arrive?: Vec3 | null
  leave?: Vec3 | null
  length: number
  straight_length: number
  outside_diameter?: number | null
  bore?: number | null
}

export type MbdDimKind = 'segment' | 'chain' | 'overall' | 'port'

export type MbdDimDto = {
  id: string
  /** 尺寸类型：后端可在同一 dims 数组中输出多类尺寸 */
  kind?: MbdDimKind
  /** 链式尺寸分组（仅 kind=chain 时有意义） */
  group_id?: string | null
  /** 尺寸序号（用于前端排序/稳定显示；可选） */
  seq?: number | null
  start: Vec3
  end: Vec3
  length: number
  text: string
  layout_hint?: MbdLayoutHint | null
}

export type MbdWeldType = 'Butt' | 'Fillet' | 'Socket' | 0 | 1 | 2

export type MbdWeldDto = {
  id: string
  position: Vec3
  weld_type: MbdWeldType
  is_shop: boolean
  label: string
  left_refno: string
  right_refno: string
  layout_hint?: MbdLayoutHint | null
}

export type MbdSlopeDto = {
  id: string
  start: Vec3
  end: Vec3
  slope: number
  text: string
}

export type MbdBendMode = 'workpoint' | 'facecenter'

export type MbdBendDto = {
  id: string
  refno: string
  noun: string
  /** 弯曲角度（度） */
  angle?: number | null
  /** 弯曲半径（mm） */
  radius?: number | null
  /** 中心线交点（WorkPoint） */
  work_point: Vec3
  /** 端面中心 P1（ARRI 侧） */
  face_center_1?: Vec3 | null
  /** 端面中心 P2（LEAV 侧） */
  face_center_2?: Vec3 | null
}

export type MbdLayoutHint = {
  anchor_point?: Vec3 | null
  primary_axis?: Vec3 | null
  offset_dir?: Vec3 | null
  char_dir?: Vec3 | null
  label_role?: string | null
  avoid_line_of_sight?: boolean | null
  owner_segment_id?: string | null
  offset_level?: number | null
  suppress_reason?: string | null
  layout_group_id?: string | null
  placement_lane?: number | null
  side_locked?: boolean | null
  declutter_priority?: number | null
  [k: string]: unknown
}

export type MbdCutTubiDto = {
  id: string
  segment_id: string
  refno: string
  start: Vec3
  end: Vec3
  length: number
  text: string
  layout_hint?: MbdLayoutHint | null
}

export type MbdFittingKind = 'elbo' | 'bend' | 'tee' | 'olet' | 'flan' | 'unknown'

export type MbdFittingDto = {
  id: string
  refno: string
  noun: string
  kind: MbdFittingKind
  anchor_point: Vec3
  text?: string | null
  angle?: number | null
  radius?: number | null
  face_center_1?: Vec3 | null
  face_center_2?: Vec3 | null
  layout_hint?: MbdLayoutHint | null
}

export type MbdTagDto = {
  id: string
  refno: string
  noun: string
  role: string
  text: string
  position: Vec3
  layout_hint?: MbdLayoutHint | null
}

export type MbdMaterialRowDto = {
  item_no: number
  ns: string
  item_code: string
  description: string
  quantity: number
  unit: string
  unit_weight?: number | null
  refnos: string[]
}

export type MbdPipeClearanceDto = {
  id: string
  pipe1_refno: string
  pipe2_refno: string
  start: Vec3
  end: Vec3
  distance: number
  text: string
  layout_hint?: MbdLayoutHint | null
}

export type MbdElevationRole = 'start' | 'end' | 'high' | 'low' | 'bend' | 'branch'

export type MbdElevationMarkDto = {
  id: string
  point: Vec3
  elevation_mm: number
  text: string
  role?: MbdElevationRole | null
  layout_hint?: MbdLayoutHint | null
}

export type MbdStructureTargetKind = 'beam' | 'slab' | 'column' | 'wall' | 'other'

export type MbdStructureClearanceDto = {
  id: string
  pipe_refno: string
  target_refno?: string | null
  target_noun?: string | null
  target_kind: MbdStructureTargetKind
  anchor_point: Vec3
  closest_point: Vec3
  distance: number
  text: string
  priority?: number | null
  layout_hint?: MbdLayoutHint | null
}

export type MbdPipeEnvelopeKind = 'pipe_outer' | 'insulation_outer'

export type MbdPipeEnvelopeDto = {
  id: string
  kind: MbdPipeEnvelopeKind
  min: Vec3
  max: Vec3
  size: Vec3
  center: Vec3
}

export type MbdLaidOutLinearDimDto = {
  id: string
  kind: string
  /** V2 provenance for layout-first backend primitive rendering. */
  source_kind?: 'linear_dim' | string
  source_primitive_id?: string
  source_sub_kind?: string
  backend_derived_geometry?: boolean
  start: Vec3
  end: Vec3
  text: string
  offset: number
  direction: Vec3
  label_t: number
  label_offset_world?: Vec3 | null
  dim_line_start?: Vec3 | null
  dim_line_end?: Vec3 | null
  extension_line_1_start?: Vec3 | null
  extension_line_1_end?: Vec3 | null
  extension_line_2_start?: Vec3 | null
  extension_line_2_end?: Vec3 | null
  text_anchor?: Vec3 | null
  backend_arrows?: [MbdV2LinearDimArrow, MbdV2LinearDimArrow] | null
  visible: boolean
  suppressed_reason?: string | null
}

export type MbdLaidOutWeldDto = {
  id: string
  position: Vec3
  label: string
  subtitle?: string | null
  is_shop: boolean
  cross_size: number
  label_offset_world?: Vec3 | null
  visible: boolean
  suppressed_reason?: string | null
}

export type MbdLaidOutSlopeDto = {
  id: string
  start: Vec3
  end: Vec3
  text: string
  slope: number
  label_offset_world?: Vec3 | null
  visible: boolean
  suppressed_reason?: string | null
}

export type MbdLaidOutAngleDto = {
  vertex: Vec3
  point1: Vec3
  point2: Vec3
  arc_radius: number
  text: string
  label_t: number
  label_offset_world?: Vec3 | null
}

export type MbdLaidOutBendDto = {
  id: string
  visible: boolean
  suppressed_reason?: string | null
  size_dims: MbdLaidOutLinearDimDto[]
  angle?: MbdLaidOutAngleDto | null
}

export type MbdLaidOutTagDto = {
  id: string
  role?: string | null
  text: string
  position: Vec3
  label_offset_world?: Vec3 | null
  visible: boolean
  suppressed_reason?: string | null
}

export type MbdLaidOutFittingDto = {
  id: string
  kind: string
  text: string
  position: Vec3
  label_offset_world?: Vec3 | null
  visible: boolean
  suppressed_reason?: string | null
}

export type MbdSuppressedLayoutItemDto = {
  id: string
  kind: string
  reason: string
}

export type MbdPipeLayoutResult = {
  version: number
  mode: MbdPipeViewMode
  stats: {
    linear_dims_count: number
    cut_tubis_count: number
    welds_count: number
    slopes_count: number
    bends_count: number
    tags_count: number
    fittings_count: number
    suppressed_count: number
  }
  linear_dims: MbdLaidOutLinearDimDto[]
  cut_tubis?: MbdLaidOutLinearDimDto[]
  welds: MbdLaidOutWeldDto[]
  slopes: MbdLaidOutSlopeDto[]
  bends: MbdLaidOutBendDto[]
  tags: MbdLaidOutTagDto[]
  fittings?: MbdLaidOutFittingDto[]
  suppressed_items: MbdSuppressedLayoutItemDto[]
  debug_info?: {
    notes?: string[]
    [k: string]: unknown
  } | null
}

export type MbdV2TextBlock = {
  anchor: Vec3
  content: string
  height_mm: number
  orientation: Vec3
  up: Vec3
}

export type MbdV2LinearDimArrow = {
  position: Vec3
  direction: Vec3
}

export type MbdV2Issue = {
  id?: string
  severity?: 'info' | 'warning' | 'error' | string
  category?: string
  message?: string
  primitive_id?: string | null
  [k: string]: unknown
}

export type MbdV2CommonPrimitive = {
  kind: string
  id: string
  node_names?: string[]
  function?: string | null
  source_refno?: string | null
  visible: boolean
  suppressed_reason?: string | null
}

export type MbdV2LinearDimPrimitive = MbdV2CommonPrimitive & {
  kind: 'linear_dim'
  sub_kind: 'segment' | 'chain' | 'overall' | 'port' | 'cut_tubi' | string
  extension_1: { start: Vec3; end: Vec3 }
  extension_2: { start: Vec3; end: Vec3 }
  dim_line: { start: Vec3; end: Vec3 }
  arrows?: [MbdV2LinearDimArrow, MbdV2LinearDimArrow]
  text: MbdV2TextBlock
  level?: number
}

export type MbdV2LabelPrimitive = MbdV2CommonPrimitive & {
  kind: 'label'
  anchor: Vec3
  text_anchor: Vec3
  content: string
  height_mm?: number
  orientation?: Vec3
  up?: Vec3
  box_shape?: 'none' | 'rect' | 'circle' | string
  box_padding_mm?: number
}

export type MbdV2LeaderLinePrimitive = MbdV2CommonPrimitive & {
  kind: 'leader_line'
  points: Vec3[]
  arrow_at?: 'none' | 'start' | 'end' | 'both' | string
}

export type MbdV2WeldMarkPrimitive = MbdV2CommonPrimitive & {
  kind: 'weld_mark'
  position: Vec3
  cross_size_mm?: number
  weld_type?: 'shop' | 'field' | string
  linked_label_id?: string | null
}

export type MbdV2SlopeMarkPrimitive = MbdV2CommonPrimitive & {
  kind: 'slope_mark'
  start: Vec3
  end: Vec3
  slope: number
  text: MbdV2TextBlock
}

export type MbdV2Primitive =
  | MbdV2LinearDimPrimitive
  | MbdV2LabelPrimitive
  | MbdV2LeaderLinePrimitive
  | MbdV2WeldMarkPrimitive
  | MbdV2SlopeMarkPrimitive
  | MbdV2CommonPrimitive

export type MbdV2PipeData = {
  version: string
  input_refno: string
  branch_refno: string
  primitives: MbdV2Primitive[]
  meta?: {
    segments_count?: number
    welds_count?: number
    dims_by_kind?: Record<string, number>
    branch_attrs?: Record<string, string>
    generated_at?: string
    [k: string]: unknown
  }
  issues?: MbdV2Issue[]
}

export type MbdV2Response = {
  success: boolean
  error_message?: string | null
  data?: MbdV2PipeData
}

export type MbdPipeData = {
  input_refno: string
  branch_refno: string
  branch_name: string
  branch_attrs: BranchAttrsDto
  segments: MbdPipeSegmentDto[]
  dims: MbdDimDto[]
  welds: MbdWeldDto[]
  slopes: MbdSlopeDto[]
  bends: MbdBendDto[]
  cut_tubis?: MbdCutTubiDto[]
  fittings?: MbdFittingDto[]
  tags?: MbdTagDto[]
  material_rows?: MbdMaterialRowDto[]
  pipe_clearances?: MbdPipeClearanceDto[]
  elevation_marks?: MbdElevationMarkDto[]
  structure_clearances?: MbdStructureClearanceDto[]
  envelope?: MbdPipeEnvelopeDto | null
  stats: MbdPipeStats
  layout_result?: MbdPipeLayoutResult | null
  /** V2 primitive 引线，供当前 3D 渲染器在过渡期直接消费。 */
  v2_leader_lines?: MbdV2LeaderLinePrimitive[]
  /** V2 primitive 线性尺寸，保留后端 primitive provenance 供渲染/debug/验证使用。 */
  v2_linear_dims?: MbdV2LinearDimPrimitive[]
  debug_info?: MbdPipeDebugInfo
}

export type MbdPipeResponse = {
  success: boolean
  error_message?: string
  data?: MbdPipeData
}

export type MbdPipeV2AnnotationOptions = {
  /**
   * V2 layout-first currently carries backend-laid-out primitives, while flow
   * direction still uses the original segment arrive -> leave contract.
   */
  includeLegacySegments?: boolean
}

export type MbdPipeQueryParams = {
  /** 后端接口接受 layout_first / construction / inspection；省略时按后端默认值处理 */
  mode?: MbdPipeApiMode
  /** 数据源：db=SurrealDB（默认），cache=foyer cache */
  source?: MbdPipeSource
  /** 后端返回 debug_info（用于对比/定位） */
  debug?: boolean
  /** 指定 dbno（用于与当前模型快照一致） */
  dbno?: number
  /** foyer instance_cache 的快照版本（用于与当前模型快照一致） */
  batch_id?: string | null
  /** cache 模式严格校验 dbno/batch_id（db 模式下会被忽略） */
  strict_dbno?: boolean
  min_slope?: number
  max_slope?: number
  dim_min_length?: number
  /** 是否输出焊口链式尺寸（包含两端）到 dims（kind=chain） */
  include_chain_dims?: boolean
  /** 是否输出总长尺寸到 dims（kind=overall） */
  include_overall_dim?: boolean
  /** 是否输出端口间距尺寸到 dims（kind=port） */
  include_port_dims?: boolean
  include_cut_tubis?: boolean
  include_fittings?: boolean
  include_tags?: boolean
  include_position_tags?: boolean
  include_elevation_marks?: boolean
  include_branch_label?: boolean
  include_material_balloons?: boolean
  include_material_table?: boolean
  include_layout_hints?: boolean
  include_layout_result?: boolean
  weld_merge_threshold?: number
  include_dims?: boolean
  include_welds?: boolean
  include_slopes?: boolean
  include_bends?: boolean
  bend_mode?: MbdBendMode
}

const MBD_V2_LAYOUT_FIRST_DEFAULT_QUERY: MbdPipeQueryParams = {
  mode: 'layout_first',
  include_layout_result: true,
  // 首期 BRAN MBD 只默认请求长度类尺寸：chain / port / cut-tubi。
  include_dims: false,
  include_chain_dims: true,
  include_overall_dim: false,
  include_port_dims: true,
  include_cut_tubis: true,
  include_fittings: false,
  include_tags: false,
  include_position_tags: false,
  include_elevation_marks: false,
  include_branch_label: false,
  include_material_balloons: false,
  include_material_table: false,
  include_welds: false,
  include_slopes: false,
  include_bends: false,
};

function withMbdV2LayoutFirstDefaults(
  params: MbdPipeQueryParams,
): MbdPipeQueryParams {
  if (params.mode && params.mode !== 'layout_first') {
    return {
      ...params,
      mode: params.mode,
    };
  }
  return {
    ...MBD_V2_LAYOUT_FIRST_DEFAULT_QUERY,
    ...params,
    mode: params.mode ?? 'layout_first',
  };
}

function getBaseUrl(): string {
  return getBackendApiBaseUrl();
}

function toQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'boolean') sp.set(k, v ? 'true' : 'false');
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;

  const resp = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
  }

  return (await resp.json()) as T;
}

export async function getMbdPipeAnnotations(refno: string, params: MbdPipeQueryParams = {}): Promise<MbdPipeResponse> {
  const q = toQueryString(params as Record<string, unknown>);
  return await fetchJson<MbdPipeResponse>(`/api/mbd/pipe/${encodeURIComponent(refno)}${q}`);
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((v) => Number.isFinite(Number(v)));
}

function cloneVec3(value: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (!isVec3(value)) return [...fallback] as Vec3;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec3(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lenVec3(a: Vec3): number {
  return Math.sqrt(dotVec3(a, a));
}

function distanceVec3(a: Vec3, b: Vec3): number {
  return lenVec3(subVec3(a, b));
}

function normalizeVec3(a: Vec3, fallback: Vec3 = [1, 0, 0]): Vec3 {
  const len = lenVec3(a);
  if (!Number.isFinite(len) || len <= 1e-9) return [...fallback] as Vec3;
  return [a[0] / len, a[1] / len, a[2] / len];
}

function midVec3(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
}

function labelTOnLine(start: Vec3, end: Vec3, anchor: Vec3): number {
  const axis = subVec3(end, start);
  const lenSq = dotVec3(axis, axis);
  if (!Number.isFinite(lenSq) || lenSq <= 1e-9) return 0.5;
  const t = dotVec3(subVec3(anchor, start), axis) / lenSq;
  return Math.max(0, Math.min(1, t));
}

function normalizeLinearDimArrows(
  p: MbdV2LinearDimPrimitive,
  dimLineStart: Vec3,
  dimLineEnd: Vec3,
): [MbdV2LinearDimArrow, MbdV2LinearDimArrow] {
  const fallbackDir = normalizeVec3(subVec3(dimLineEnd, dimLineStart));
  const src = Array.isArray(p.arrows) ? p.arrows : [];
  const first = src[0];
  const second = src[1];
  return [
    {
      position: cloneVec3(first?.position, dimLineStart),
      direction: normalizeVec3(first?.direction, fallbackDir),
    },
    {
      position: cloneVec3(second?.position, dimLineEnd),
      direction: normalizeVec3(second?.direction, scaleVec3(fallbackDir, -1)),
    },
  ];
}

function linearSubKindToDimKind(subKind: string | undefined): MbdDimKind | 'cut_tubi' {
  const raw = String(subKind ?? '').trim().toLowerCase();
  if (raw === 'chain') return 'chain';
  if (raw === 'overall') return 'overall';
  if (raw === 'port') return 'port';
  if (raw === 'cut_tubi') return 'cut_tubi';
  return 'segment';
}

function isV2LinearDim(p: MbdV2Primitive): p is MbdV2LinearDimPrimitive {
  return p.kind === 'linear_dim';
}

function isV2Label(p: MbdV2Primitive): p is MbdV2LabelPrimitive {
  return p.kind === 'label';
}

function isV2LeaderLine(p: MbdV2Primitive): p is MbdV2LeaderLinePrimitive {
  return p.kind === 'leader_line';
}

function isV2WeldMark(p: MbdV2Primitive): p is MbdV2WeldMarkPrimitive {
  return p.kind === 'weld_mark';
}

function isV2SlopeMark(p: MbdV2Primitive): p is MbdV2SlopeMarkPrimitive {
  return p.kind === 'slope_mark';
}

function v2LinearToLaidOutDim(p: MbdV2LinearDimPrimitive): MbdLaidOutLinearDimDto {
  const measuredStart = cloneVec3(p.extension_1?.start);
  const measuredEnd = cloneVec3(p.extension_2?.start);
  const dimLineStart = cloneVec3(p.dim_line?.start, measuredStart);
  const dimLineEnd = cloneVec3(p.dim_line?.end, measuredEnd);
  const textAnchor = cloneVec3(p.text?.anchor, midVec3(dimLineStart, dimLineEnd));
  const kind = linearSubKindToDimKind(p.sub_kind);
  const rawSubKind = String(p.sub_kind ?? 'segment');
  const backendArrows = normalizeLinearDimArrows(p, dimLineStart, dimLineEnd);
  const dimDirection = normalizeVec3(
    subVec3(dimLineEnd, dimLineStart),
    normalizeVec3(subVec3(measuredEnd, measuredStart)),
  );
  const measuredMid = midVec3(measuredStart, measuredEnd);
  const dimLineMid = midVec3(dimLineStart, dimLineEnd);
  return {
    id: p.id,
    kind: kind === 'cut_tubi' ? 'cut_tubi' : kind,
    source_kind: 'linear_dim',
    source_primitive_id: p.id,
    source_sub_kind: rawSubKind,
    backend_derived_geometry: true,
    start: measuredStart,
    end: measuredEnd,
    text: String(p.text?.content ?? ''),
    offset: distanceVec3(measuredMid, dimLineMid),
    direction: dimDirection,
    label_t: labelTOnLine(dimLineStart, dimLineEnd, textAnchor),
    label_offset_world: null,
    dim_line_start: dimLineStart,
    dim_line_end: dimLineEnd,
    extension_line_1_start: cloneVec3(p.extension_1?.start, measuredStart),
    extension_line_1_end: cloneVec3(p.extension_1?.end, dimLineStart),
    extension_line_2_start: cloneVec3(p.extension_2?.start, measuredEnd),
    extension_line_2_end: cloneVec3(p.extension_2?.end, dimLineEnd),
    text_anchor: textAnchor,
    backend_arrows: backendArrows,
    visible: p.visible !== false,
    suppressed_reason: p.suppressed_reason ?? null,
  };
}

function v2LinearToDimDto(p: MbdV2LinearDimPrimitive): MbdDimDto {
  const start = cloneVec3(p.extension_1?.start);
  const end = cloneVec3(p.extension_2?.start);
  const kind = linearSubKindToDimKind(p.sub_kind);
  return {
    id: p.id,
    kind: kind === 'cut_tubi' ? 'segment' : kind,
    start,
    end,
    length: distanceVec3(start, end),
    text: String(p.text?.content ?? ''),
    layout_hint: {
      anchor_point: cloneVec3(p.text?.anchor, midVec3(start, end)),
      primary_axis: normalizeVec3(subVec3(end, start)),
      offset_dir: cloneVec3(p.text?.up, [0, 1, 0]),
      label_role: `v2:${String(p.sub_kind ?? 'segment')}`,
      offset_level: Number(p.level ?? 0),
    },
  };
}

function v2LinearToCutTubiDto(p: MbdV2LinearDimPrimitive): MbdCutTubiDto {
  const start = cloneVec3(p.extension_1?.start);
  const end = cloneVec3(p.extension_2?.start);
  return {
    id: p.id,
    segment_id: p.source_refno ?? p.id,
    refno: p.source_refno ?? p.id,
    start,
    end,
    length: distanceVec3(start, end),
    text: String(p.text?.content ?? ''),
    layout_hint: {
      anchor_point: cloneVec3(p.text?.anchor, midVec3(start, end)),
      primary_axis: normalizeVec3(subVec3(end, start)),
      offset_dir: cloneVec3(p.text?.up, [0, 1, 0]),
      label_role: 'v2:cut_tubi',
      offset_level: Number(p.level ?? 0),
    },
  };
}

function v2LabelOffset(label: MbdV2LabelPrimitive): Vec3 | null {
  const anchor = cloneVec3(label.anchor);
  const textAnchor = cloneVec3(label.text_anchor, anchor);
  const offset = subVec3(textAnchor, anchor);
  return lenVec3(offset) > 1e-9 ? offset : null;
}

function inferV2LabelRole(label: MbdV2LabelPrimitive): string {
  const raw = `${label.id ?? ''} ${label.function ?? ''} ${label.content ?? ''}`.toLowerCase();
  if (raw.includes('tag:material')) return 'material_balloon';
  if (raw.includes('tag:elevation') || raw.includes('pe ')) return 'elevation_tag';
  if (raw.includes('tag:position') || raw.includes('\nx ') || raw.includes('\ny ')) return 'position_tag';
  if (raw.includes('tag:branch')) return 'branch_label';
  if (raw.includes('tag:tubi')) return 'tubi';
  if (raw.includes('tag:fitting')) return 'component_tag';
  return label.function ?? 'v2_label';
}

function buildV2MaterialRows(cutTubiPrims: MbdV2LinearDimPrimitive[]): MbdMaterialRowDto[] {
  return cutTubiPrims.map((cut, idx) => {
    const start = cloneVec3(cut.extension_1?.start);
    const end = cloneVec3(cut.extension_2?.start);
    const lengthMm = distanceVec3(start, end);
    return {
      item_no: idx + 1,
      ns: '-',
      item_code: 'TUBI',
      description: 'Cut pipe length',
      quantity: Number((lengthMm / 1000).toFixed(3)),
      unit: 'm',
      unit_weight: null,
      refnos: [cut.source_refno ?? cut.id],
    };
  });
}

function normalizeV2BranchAttrs(attrs?: Record<string, string>): BranchAttrsDto {
  const src = attrs ?? {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = src[key] ?? src[key.toUpperCase()] ?? src[key.toLowerCase()];
      if (value !== undefined && value !== null) return String(value);
    }
    return null;
  };
  const numberOrNull = (value: string | null) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    duty: pick('DUTY'),
    pspec: pick('PSPEC'),
    hbor: numberOrNull(pick('HBOR')),
    tbor: numberOrNull(pick('TBOR')),
    rccm: pick('RCCM'),
    clean: pick('CLEAN'),
    temp: pick('TEMP'),
    pressure: numberOrNull(pick('PRESSURE')),
    ispec: pick('ISPEC'),
    insuthick: numberOrNull(pick('INSUTHICK')),
    tspec: pick('TSPEC'),
    swgd: pick('SWGD'),
    drawnum: pick('DRAWNUM'),
    rev: pick('REV'),
    status: pick('STATUS'),
    fluid: pick('FLUID'),
  };
}

function normalizeV2BranchName(data: MbdV2PipeData): string {
  const metaBranchName = data.meta?.branch_name;
  if (typeof metaBranchName === 'string' && metaBranchName.trim()) {
    return metaBranchName.trim();
  }
  const attrs = data.meta?.branch_attrs ?? {};
  const attrName =
    attrs.BRANCH_NAME
    ?? attrs.branch_name
    ?? attrs.NAME
    ?? attrs.name;
  if (typeof attrName === 'string' && attrName.trim()) {
    return attrName.trim();
  }
  return data.branch_refno;
}

function adaptMbdV2ResponseToPipeResponse(
  resp: MbdV2Response,
  params: MbdPipeQueryParams,
): MbdPipeResponse {
  if (!resp.success || !resp.data) {
    return {
      success: false,
      error_message: resp.error_message || '生成 V2 管道标注失败',
    };
  }

  const data = resp.data;
  const primitives = Array.isArray(data.primitives) ? data.primitives : [];
  const linearPrims = primitives.filter(isV2LinearDim);
  const nonCutLinearPrims = linearPrims.filter(
    (p) => linearSubKindToDimKind(p.sub_kind) !== 'cut_tubi',
  );
  const cutTubiPrims = linearPrims.filter(
    (p) => linearSubKindToDimKind(p.sub_kind) === 'cut_tubi',
  );
  const labels = primitives.filter(isV2Label);
  const leaders = primitives
    .filter(isV2LeaderLine)
    .filter((leader) => Array.isArray(leader.points) && leader.points.length >= 2);
  const weldMarks = primitives.filter(isV2WeldMark);
  const slopes = primitives.filter(isV2SlopeMark);
  const labelById = new Map(labels.map((label) => [label.id, label] as const));

  const laidOutLinear = linearPrims.map(v2LinearToLaidOutDim);
  const cutTubiDims = laidOutLinear.filter(
    (item) => String(item.kind).toLowerCase() === 'cut_tubi',
  );
  const mainLinearDims = laidOutLinear.filter(
    (item) => String(item.kind).toLowerCase() !== 'cut_tubi',
  );

  const tagDtos: MbdTagDto[] = labels.map((label) => {
    const role = inferV2LabelRole(label);
    return {
      id: label.id,
      refno: label.source_refno ?? label.id,
      noun: 'MBD_LABEL',
      role,
      text: String(label.content ?? ''),
      position: cloneVec3(label.anchor),
      layout_hint: {
        anchor_point: cloneVec3(label.anchor),
        primary_axis: cloneVec3(label.orientation, [1, 0, 0]),
        offset_dir: cloneVec3(label.up, [0, 1, 0]),
        label_role: role,
      },
    };
  });

  const laidOutTags: MbdLaidOutTagDto[] = labels.map((label) => ({
    id: label.id,
    role: inferV2LabelRole(label),
    text: String(label.content ?? ''),
    position: cloneVec3(label.anchor),
    label_offset_world: v2LabelOffset(label),
    visible: label.visible !== false,
    suppressed_reason: label.suppressed_reason ?? null,
  }));

  const slopeDtos: MbdSlopeDto[] = slopes.map((slope) => ({
    id: slope.id,
    start: cloneVec3(slope.start),
    end: cloneVec3(slope.end),
    slope: Number(slope.slope) || 0,
    text: String(slope.text?.content ?? ''),
  }));

  const laidOutSlopes: MbdLaidOutSlopeDto[] = slopes.map((slope) => {
    const start = cloneVec3(slope.start);
    const end = cloneVec3(slope.end);
    const anchor = cloneVec3(slope.text?.anchor, midVec3(start, end));
    return {
      id: slope.id,
      start,
      end,
      text: String(slope.text?.content ?? ''),
      slope: Number(slope.slope) || 0,
      label_offset_world: subVec3(anchor, midVec3(start, end)),
      visible: slope.visible !== false,
      suppressed_reason: slope.suppressed_reason ?? null,
    };
  });

  const weldDtos: MbdWeldDto[] = weldMarks.map((weld) => {
    const linkedLabel = weld.linked_label_id ? labelById.get(weld.linked_label_id) : null;
    return {
      id: weld.id,
      position: cloneVec3(weld.position),
      weld_type: weld.weld_type === 'field' ? 'Fillet' : 'Butt',
      is_shop: weld.weld_type !== 'field',
      label: linkedLabel?.content ?? weld.function ?? 'WELD',
      left_refno: '',
      right_refno: '',
    };
  });

  const laidOutWelds: MbdLaidOutWeldDto[] = weldMarks.map((weld) => {
    const linkedLabel = weld.linked_label_id ? labelById.get(weld.linked_label_id) : null;
    return {
      id: weld.id,
      position: cloneVec3(weld.position),
      label: linkedLabel?.content ?? weld.function ?? 'WELD',
      subtitle: null,
      is_shop: weld.weld_type !== 'field',
      cross_size: Number(weld.cross_size_mm) || 50,
      label_offset_world: linkedLabel
        ? subVec3(cloneVec3(linkedLabel.text_anchor), cloneVec3(weld.position))
        : null,
      visible: weld.visible !== false,
      suppressed_reason: weld.suppressed_reason ?? null,
    };
  });

  const issues = data.issues ?? [];
  const suppressedItems: MbdSuppressedLayoutItemDto[] = [
    ...primitives
      .filter((p) => p.visible === false)
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        reason: p.suppressed_reason ?? 'v2_hidden',
      })),
    ...issues
      .filter((issue) => issue.severity === 'error')
      .map((issue, idx) => ({
        id: String(issue.primitive_id ?? issue.id ?? `v2-issue-${idx}`),
        kind: String(issue.category ?? 'issue'),
        reason: String(issue.message ?? 'V2 issue'),
      })),
  ];

  const dimsByKind = data.meta?.dims_by_kind ?? {};
  const cutTubiCount = cutTubiDims.length;
  const materialRows = buildV2MaterialRows(cutTubiPrims);
  const requestedLayers = {
    elevation_marks: params.include_elevation_marks === true,
    material_table: params.include_material_table === true,
    tags: params.include_tags === true,
  };
  const stats: MbdPipeStats = {
    segments_count: Number(data.meta?.segments_count ?? 0),
    dims_count: nonCutLinearPrims.length,
    welds_count: weldMarks.length,
    slopes_count: slopes.length,
    bends_count: 0,
    cut_tubis_count: cutTubiCount,
    fittings_count: 0,
    tags_count: labels.length,
    material_rows_count: materialRows.length,
  };

  return {
    success: true,
    data: {
      input_refno: data.input_refno,
      branch_refno: data.branch_refno,
      branch_name: normalizeV2BranchName(data),
      branch_attrs: normalizeV2BranchAttrs(data.meta?.branch_attrs),
      segments: [],
      dims: nonCutLinearPrims.map(v2LinearToDimDto),
      welds: weldDtos,
      slopes: slopeDtos,
      bends: [],
      cut_tubis: cutTubiPrims.map(v2LinearToCutTubiDto),
      fittings: [],
      tags: tagDtos,
      material_rows: materialRows,
      stats,
      layout_result: {
        version: 2,
        mode: params.mode ?? 'layout_first',
        stats: {
          linear_dims_count: mainLinearDims.length,
          cut_tubis_count: cutTubiDims.length,
          welds_count: laidOutWelds.length,
          slopes_count: laidOutSlopes.length,
          bends_count: 0,
          tags_count: laidOutTags.length,
          fittings_count: 0,
          suppressed_count: suppressedItems.length,
        },
        linear_dims: mainLinearDims,
        cut_tubis: cutTubiDims,
        welds: laidOutWelds,
        slopes: laidOutSlopes,
        bends: [],
        tags: laidOutTags,
        fittings: [],
        suppressed_items: suppressedItems,
        debug_info: {
          notes: [
            `MBD V2 primitives=${primitives.length}`,
            `MBD V2 issues=${issues.length}`,
          ],
          issues,
          generated_at: data.meta?.generated_at,
          layout_source: data.meta?.layout_source,
          dims_by_kind: dimsByKind,
        },
      },
      v2_leader_lines: leaders,
      v2_linear_dims: linearPrims,
      debug_info: {
        source: params.source ?? 'db',
        notes: [
          'front-end adapted /api/mbd/v2/pipe primitives to current 3D renderer contract',
        ],
        requested_layers: requestedLayers,
        version: data.version,
        layout_source: data.meta?.layout_source,
        primitive_count: primitives.length,
        primitive_kinds: primitives.reduce<Record<string, number>>((acc, p) => {
          acc[p.kind] = (acc[p.kind] ?? 0) + 1;
          return acc;
        }, {}),
        issues,
      },
    },
  };
}

export async function getMbdPipeV2Annotations(
  refno: string,
  params: MbdPipeQueryParams = {},
  options: MbdPipeV2AnnotationOptions = {},
): Promise<MbdPipeResponse> {
  const effectiveParams = withMbdV2LayoutFirstDefaults(params);
  const q = toQueryString(effectiveParams as Record<string, unknown>);
  const resp = await fetchJson<MbdV2Response>(
    `/api/mbd/v2/pipe/${encodeURIComponent(refno)}${q}`,
  );
  const adapted = adaptMbdV2ResponseToPipeResponse(resp, effectiveParams);

  if (
    options.includeLegacySegments &&
    adapted.success &&
    adapted.data &&
    adapted.data.segments.length === 0
  ) {
    try {
      const legacy = await getMbdPipeAnnotations(refno, effectiveParams);
      const legacySegments = legacy.data?.segments ?? [];
      const legacyMaterialRows = legacy.data?.material_rows ?? [];
      const legacyBends = legacy.data?.bends ?? [];
      const legacyFittings = legacy.data?.fittings ?? [];
      if (legacy.success && legacy.data && legacySegments.length > 0) {
        const materialRows =
          legacyMaterialRows.length > 0 ? legacyMaterialRows : adapted.data.material_rows ?? [];
        const bends =
          legacyBends.length > 0 ? legacyBends : adapted.data.bends ?? [];
        const fittings =
          legacyFittings.length > 0 ? legacyFittings : adapted.data.fittings ?? [];
        return {
          ...adapted,
          data: {
            ...adapted.data,
            segments: legacySegments,
            bends,
            fittings,
            material_rows: materialRows,
            stats: {
              ...adapted.data.stats,
              segments_count:
                legacy.data.stats?.segments_count ?? legacySegments.length,
              bends_count:
                legacy.data.stats?.bends_count ?? bends.length,
              fittings_count:
                legacy.data.stats?.fittings_count ?? fittings.length,
              material_rows_count:
                legacy.data.stats?.material_rows_count ?? materialRows.length,
            },
            layout_result: adapted.data.layout_result
              ? {
                ...adapted.data.layout_result,
                stats: {
                  ...adapted.data.layout_result.stats,
                  bends_count:
                    legacy.data.stats?.bends_count ?? bends.length,
                  fittings_count:
                    legacy.data.stats?.fittings_count ?? fittings.length,
                },
              }
              : adapted.data.layout_result,
            debug_info: {
              ...(adapted.data.debug_info ?? {}),
              legacy_segments_source: '/api/mbd/pipe',
              legacy_segments_count: legacySegments.length,
              legacy_bends_count: legacyBends.length,
              legacy_fittings_count: legacyFittings.length,
              legacy_material_rows_count: legacyMaterialRows.length,
            },
          },
        };
      }
    } catch {
      // Keep the V2 annotation result usable even when the legacy segment route
      // is unavailable; callers will simply have no flow-direction overlay.
    }
  }

  return adapted;
}

/**
 * Phase 9: 直接获取 V2 primitive 数据，不经过适配层。
 *
 * 返回的 `MbdV2PipeData` 中所有 primitive 坐标为已排版的最终世界坐标，
 * 前端按 `primitive.kind` 直接渲染，不做二次排版。
 *
 * 支持 `v2_direct=true` 参数走后端直算路径。
 */
export async function getMbdPipeV2Raw(
  refno: string,
  params: MbdPipeQueryParams & { v2_direct?: boolean } = {},
): Promise<MbdV2Response> {
  const q = toQueryString(params as Record<string, unknown>);
  return fetchJson<MbdV2Response>(
    `/api/mbd/v2/pipe/${encodeURIComponent(refno)}${q}`,
  );
}
