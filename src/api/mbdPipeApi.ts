/**
 * MBD 管道标注 API（首期：管道分支 BRAN/HANG）
 *
 * 后端：gen_model-dev（aios-database web_server）
 * 路由：GET /api/mbd/pipe/{refno}
 */

import { getBackendApiBaseUrl } from '@/utils/apiBase';

export type Vec3 = [number, number, number]

export type MbdPipeSource = 'db' | 'cache'
export type MbdPipeViewMode = 'construction' | 'inspection'

export type BranchAttrsDto = {
  duty?: string | null
  pspec?: string | null
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
  anchor_point: Vec3
  primary_axis: Vec3
  offset_dir: Vec3
  char_dir: Vec3
  label_role: string
  avoid_line_of_sight: boolean
  owner_segment_id?: string | null
  offset_level: number
  suppress_reason?: string | null
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
  pipe_clearances?: MbdPipeClearanceDto[]
  stats: MbdPipeStats
  debug_info?: MbdPipeDebugInfo
}

export type MbdPipeResponse = {
  success: boolean
  error_message?: string
  data?: MbdPipeData
}

export type MbdPipeQueryParams = {
  /** 语义模式：construction=施工表达（默认），inspection=几何校核 */
  mode?: MbdPipeViewMode
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
  include_layout_hints?: boolean
  weld_merge_threshold?: number
  include_dims?: boolean
  include_welds?: boolean
  include_slopes?: boolean
  include_bends?: boolean
  bend_mode?: MbdBendMode
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
