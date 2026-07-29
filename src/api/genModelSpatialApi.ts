import { type TreeNodeDto } from './genModelE3dApi';

import { getBackendApiBaseUrl } from '@/utils/apiBase';

function getBaseUrl(): string {
  return getBackendApiBaseUrl();
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

// ============================================================================
// Types
// ============================================================================

export type SpatialQueryResultItem = {
  /** "dbnum_refno" 格式的字符串 */
  refno: string;
  noun: string;
  spec_value: number;
  aabb?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  distance?: number;
};

export type SpatialNearbyCenter = {
  x: number;
  y: number;
  z: number;
  source: string;
  refno?: string;
};

export type SpatialQueryFilterOptions = {
  nouns: {
    value: string;
    count: number;
    is_negative?: boolean;
  }[];
  spec_values: {
    value: number;
    count: number;
  }[];
  include_negative?: boolean;
};

export type SpatialNearbyParams = {
  refno?: string;
  x?: number;
  y?: number;
  z?: number;
  radius: number;
  /** 查询形状：sphere（默认）| cube */
  shape?: 'cube' | 'sphere';
  /** noun 过滤（逗号分隔，如 "EQUI,PIPE,TUBI"） */
  nouns?: string;
  /** 专业过滤（逗号分隔，如 "1,3"） */
  spec_values?: string;
  /** 是否包含自身（refno 模式有效） */
  include_self?: boolean;
  /** 是否包含负实体 */
  include_negative?: boolean;
  /** 分页页码，从 1 开始 */
  page?: number;
  /** 每页数量 */
  per_page?: number;
  /** 兼容旧参数：未传 per_page 时作为每页数量 */
  max_results?: number;
};

export type SpatialNearbyOptions = Omit<SpatialNearbyParams, 'refno' | 'x' | 'y' | 'z' | 'radius'>;

export type SpatialQueryResult = {
  success: boolean;
  results?: SpatialQueryResultItem[];
  /** nearby 响应的服务端权威中心；legacy /query 可能没有该字段 */
  center?: SpatialNearbyCenter;
  /** nearby 响应使用的半径 */
  radius?: number;
  /** nearby 响应使用的形状 */
  shape?: 'cube' | 'sphere' | string;
  /** 是否还有更多结果；兼容旧字段名 */
  truncated?: boolean;
  /** nearby 候选集是否被截断 */
  truncated_candidates?: boolean;
  /** nearby 结果集是否被截断 */
  truncated_results?: boolean;
  /** nearby 候选数量/上限与结果上限元数据 */
  candidate_count?: number;
  candidate_cap?: number;
  result_cap?: number;
  /** 本次查询完整命中数量 */
  total_count?: number;
  /** 当前页返回数量 */
  returned_count?: number;
  /** 当前页码 */
  page?: number;
  /** 当前每页数量 */
  per_page?: number;
  /** 是否还有下一页 */
  has_more?: boolean;
  /** 实际查询使用的 AABB */
  query_bbox?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  /** 本次查询结果可用的过滤选项 */
  filter_options?: SpatialQueryFilterOptions;
  error?: string;
};

export type SpatialNearbyResult = SpatialQueryResult;

export type SpatialQueryParams = {
  mode?: 'bbox' | 'refno' | 'position';
  refno?: string;
  x?: number;
  y?: number;
  z?: number;
  radius?: number;
  /** 外扩距离（毫米） */
  distance?: number;
  minx?: number;
  miny?: number;
  minz?: number;
  maxx?: number;
  maxy?: number;
  maxz?: number;
  /** 兼容旧参数：未传 per_page 时作为每页数量 */
  max_results?: number;
  /** 分页页码，从 1 开始 */
  page?: number;
  /** 每页数量 */
  per_page?: number;
  /** noun 过滤（逗号分隔，如 "EQUI,PIPE,TUBI"） */
  nouns?: string;
  /** 专业过滤（逗号分隔，如 "1,3"） */
  spec_values?: string;
  /** 是否包含自身（mode=refno 时有效，默认 true） */
  include_self?: boolean;
  /** 是否包含负实体 */
  include_negative?: boolean;
  /** 查询形状：cube（立方体，默认）| sphere（球体） */
  shape?: 'cube' | 'sphere';
};

export type SpatialStatsResult = {
  success: boolean;
  total_elements: number;
  index_type: string;
  index_path: string;
  error?: string;
};

export type SpaceEnvelope<T> = {
  status: 'success' | 'error';
  message?: string;
  data?: T | null;
};

export type SpaceComputeRefnoRequest = {
  suppo_refno: string;
};

export type SpaceComputePoint = {
  x: number;
  y: number;
  z: number;
};

export type SpaceComputeVector = {
  dx: number;
  dy: number;
  dz: number;
};

export type BranNearestClearanceTargetGroup = 'wall' | 'column' | string;

export type BranNearestClearanceRequest = {
  source_refno: string;
  target_groups?: BranNearestClearanceTargetGroup[] | string;
  /** mm */
  radius?: number;
  scope?: 'same_dbnum' | 'all_loaded' | string;
  max_per_group?: number;
  debug?: boolean;
};

export type BranNearestClearanceAabb = {
  min: SpaceComputePoint;
  max: SpaceComputePoint;
};

export type BranNearestClearanceNearest = {
  source_segment_refno?: string | null;
  source_segment_order?: number | null;
  source_point: SpaceComputePoint;
  target_point: SpaceComputePoint;
  vector: SpaceComputeVector;
};

export type BranNearestClearanceAnnotation = {
  start_point: SpaceComputePoint;
  end_point: SpaceComputePoint;
  label_mm: number;
};

export type BranNearestClearanceCandidate = {
  refno: string;
  noun: string;
  spec_value?: number | null;
  distance_mm: number;
  intersects?: boolean;
  aabb?: BranNearestClearanceAabb;
  nearest?: BranNearestClearanceNearest | null;
  annotation?: BranNearestClearanceAnnotation | null;
};

export type BranNearestClearanceGroupResult = {
  group: string;
  nouns?: string[];
  candidates: BranNearestClearanceCandidate[];
};

export type BranNearestClearanceSource = {
  kind?: string;
  refno?: string;
  dbnum?: number | string;
  segment_count?: number;
  centerline_bbox?: BranNearestClearanceAabb;
};

export type BranNearestClearanceResponse = {
  success: boolean;
  nearest_by_group?: Record<string, BranNearestClearanceCandidate[]> | BranNearestClearanceGroupResult[];
  warnings?: string[];
  error?: string;
  message?: string;
  unit?: string;
  distance_method?: string;
  source?: BranNearestClearanceSource;
  resolved_filters?: unknown;
};

export type SpaceComputeSuppoRequest = SpaceComputeRefnoRequest & {
  tolerance?: number;
};

export type SpaceComputeWallDistanceRequest = SpaceComputeRefnoRequest & {
  suppo_type?: string;
  search_radius?: number;
  target_nouns?: string[];
};

export type SpaceComputeSteelRelativeRequest = SpaceComputeRefnoRequest & {
  suppo_type?: string;
  search_radius?: number;
};

export type SpaceComputeTraySpanRequest = SpaceComputeRefnoRequest & {
  neighbor_window?: number;
};

export type SpaceComputeFittingData = {
  fitting: string;
  panel_refno: string;
  panel_center: SpaceComputePoint;
  match_method: string;
  covered: boolean;
  coverage_ratio: number;
};

export type SpaceComputeFittingOffsetData = {
  anchor_kind: string;
  anchor_point: SpaceComputePoint;
  panel_refno: string;
  panel_center: SpaceComputePoint;
  vector: SpaceComputeVector;
  length: number;
  within: boolean;
};

export type SpaceComputeWallDistanceCandidate = {
  refno: string;
  noun: string;
  spec_value?: number | null;
  distance_mm: number;
  closest_point: SpaceComputePoint;
};

export type SpaceComputeWallDistanceData = {
  anchor_kind: string;
  anchor_point: SpaceComputePoint;
  target: {
    refno: string;
    noun: string;
    distance_mm: number;
    closest_point: SpaceComputePoint;
  };
  candidates: SpaceComputeWallDistanceCandidate[];
};

export type SpaceComputeSuppoTrayData = {
  anchor_kind: string;
  trays: {
    bran_refno: string;
    tray_section_refno: string;
    support_type: string;
    contact_point: SpaceComputePoint;
  }[];
};

export type SpaceComputeSteelRelativeData = {
  anchor_kind: string;
  anchor_point: SpaceComputePoint;
  steel_refno: string;
  steel_noun: string;
  closest_point: SpaceComputePoint;
  vector: SpaceComputeVector;
  length: number;
  within: boolean;
};

export type SpaceComputeTraySpanData = {
  bran_refno: string;
  left_suppo_refno?: string | null;
  right_suppo_refno?: string | null;
  left_distance?: number | null;
  right_distance?: number | null;
  neighbor_window: number;
};

export type PipeWallDistanceRequest = {
  dbnum: number;
  source_refno: string;
  target_nouns?: string[];
  /** mm */
  search_radius?: number;
  max_candidates?: number;
};

export type PipeWallDistancePoint = {
  x: number;
  y: number;
  z: number;
};

export type PipeWallDistanceAabb = {
  min: PipeWallDistancePoint;
  max: PipeWallDistancePoint;
};

export type PipeWallDistanceCandidate = {
  refno: string;
  noun: string;
  spec_value?: number | null;
  distance_mm: number;
  aabb: PipeWallDistanceAabb;
};

export type PipeWallDistanceResponse = {
  status: 'success' | 'error';
  message?: string;
  data?: {
    source_refno: string;
    source_aabb: PipeWallDistanceAabb;
    candidates: PipeWallDistanceCandidate[];
  };
};

function normalizeSuppoRefno(refno: string): string {
  return String(refno || '').trim().replace(/,/g, '/').replace(/_/g, '/');
}

export function normalizeBranRefno(refno: string): string {
  const value = String(refno || '').trim();
  if (!value) return '';
  const wrapped = value.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? value;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '').trim();
  return core.replace(/,/g, '_').replace(/\//g, '_');
}

// ============================================================================
// API functions
// ============================================================================

/**
 * 查询空间索引：按 refno 或 bbox 查找周边构件
 *
 * 用于"范围显示周边模型"：先从服务端获取周边 refno 列表，再按需加载模型。
 */
export async function querySpatialIndex(params: SpatialQueryParams): Promise<SpatialQueryResult> {
  const sp = new URLSearchParams();

  if (params.mode) sp.set('mode', params.mode);
  if (params.refno) sp.set('refno', params.refno);
  if (params.x !== undefined) sp.set('x', String(params.x));
  if (params.y !== undefined) sp.set('y', String(params.y));
  if (params.z !== undefined) sp.set('z', String(params.z));
  if (params.radius !== undefined) sp.set('radius', String(params.radius));
  if (params.distance !== undefined) sp.set('distance', String(params.distance));

  if (params.minx !== undefined) sp.set('minx', String(params.minx));
  if (params.miny !== undefined) sp.set('miny', String(params.miny));
  if (params.minz !== undefined) sp.set('minz', String(params.minz));
  if (params.maxx !== undefined) sp.set('maxx', String(params.maxx));
  if (params.maxy !== undefined) sp.set('maxy', String(params.maxy));
  if (params.maxz !== undefined) sp.set('maxz', String(params.maxz));

  if (params.max_results !== undefined) sp.set('max_results', String(params.max_results));
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.per_page !== undefined) sp.set('per_page', String(params.per_page));
  if (params.nouns) sp.set('nouns', params.nouns);
  if (params.spec_values) sp.set('spec_values', params.spec_values);
  if (params.include_self !== undefined) sp.set('include_self', String(params.include_self));
  if (params.include_negative !== undefined) sp.set('include_negative', String(params.include_negative));
  if (params.shape) sp.set('shape', params.shape);

  const query = sp.toString();
  return await fetchJson<SpatialQueryResult>(`/api/sqlite-spatial/query${query ? '?' + query : ''}`);
}

function appendNearbySearchParams(sp: URLSearchParams, params: SpatialNearbyParams): void {
  if (params.refno) sp.set('refno', params.refno);
  if (params.x !== undefined) sp.set('x', String(params.x));
  if (params.y !== undefined) sp.set('y', String(params.y));
  if (params.z !== undefined) sp.set('z', String(params.z));
  sp.set('radius', String(params.radius));

  if (params.shape) sp.set('shape', params.shape);
  if (params.nouns) sp.set('nouns', params.nouns);
  if (params.spec_values) sp.set('spec_values', params.spec_values);
  if (params.include_self !== undefined) sp.set('include_self', String(params.include_self));
  if (params.include_negative !== undefined) sp.set('include_negative', String(params.include_negative));
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.per_page !== undefined) sp.set('per_page', String(params.per_page));
  if (params.max_results !== undefined) sp.set('max_results', String(params.max_results));
}

/**
 * nearby 空间查询：按 refno 或中心坐标 + 半径查找周边构件。
 *
 * 与 legacy querySpatialIndex() 分离，确保旧调用继续走 /query。
 */
export async function queryNearbySpatial(params: SpatialNearbyParams): Promise<SpatialNearbyResult> {
  const sp = new URLSearchParams();
  appendNearbySearchParams(sp, params);
  const query = sp.toString();
  return await fetchJson<SpatialNearbyResult>(`/api/sqlite-spatial/nearby${query ? '?' + query : ''}`);
}

/**
 * 便捷方法：按 Refno + 半径查询周边构件（refno 模式）
 */
export async function queryNearbyByRefno(
  refno: string,
  radius: number,
  options?: SpatialNearbyOptions,
): Promise<SpatialNearbyResult> {
  return queryNearbySpatial({
    refno,
    radius,
    ...options,
  });
}

/**
 * 查询空间索引统计信息（健康检查）
 */
export async function querySpatialStats(): Promise<SpatialStatsResult> {
  return await fetchJson<SpatialStatsResult>('/api/sqlite-spatial/stats');
}

/**
 * 管道到墙/柱候选粗筛（后端仅做 AABB 级排序，不做网格精算）
 */
export async function queryPipeWallDistanceCandidates(
  request: PipeWallDistanceRequest,
): Promise<PipeWallDistanceResponse> {
  return await fetchJson<PipeWallDistanceResponse>('/api/space/wall-distance', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function queryBranCenterlineNearestClearance(
  request: BranNearestClearanceRequest,
): Promise<BranNearestClearanceResponse> {
  const sp = new URLSearchParams();
  sp.set('source_mode', 'bran_centerline');
  sp.set('source_refno', normalizeBranRefno(request.source_refno));
  sp.set(
    'target_groups',
    Array.isArray(request.target_groups)
      ? request.target_groups.join(',')
      : request.target_groups || 'wall,column',
  );
  sp.set('radius', String(request.radius ?? 5000));
  sp.set('scope', request.scope || 'all_loaded');
  if (request.max_per_group !== undefined) sp.set('max_per_group', String(request.max_per_group));
  if (request.debug !== undefined) sp.set('debug', String(request.debug));

  return await fetchJson<BranNearestClearanceResponse>(
    `/api/sqlite-spatial/nearest-clearance?${sp.toString()}`,
  );
}

export async function postSpaceFitting(
  request: SpaceComputeSuppoRequest,
): Promise<SpaceEnvelope<SpaceComputeFittingData>> {
  return await fetchJson<SpaceEnvelope<SpaceComputeFittingData>>('/api/space/fitting', {
    method: 'POST',
    body: JSON.stringify({
      ...request,
      suppo_refno: normalizeSuppoRefno(request.suppo_refno),
    }),
  });
}

export async function postSpaceFittingOffset(
  request: SpaceComputeSuppoRequest,
): Promise<SpaceEnvelope<SpaceComputeFittingOffsetData>> {
  return await fetchJson<SpaceEnvelope<SpaceComputeFittingOffsetData>>('/api/space/fitting-offset', {
    method: 'POST',
    body: JSON.stringify({
      ...request,
      suppo_refno: normalizeSuppoRefno(request.suppo_refno),
    }),
  });
}

export async function postSpaceWallDistance(
  request: SpaceComputeWallDistanceRequest,
): Promise<SpaceEnvelope<SpaceComputeWallDistanceData>> {
  return await fetchJson<SpaceEnvelope<SpaceComputeWallDistanceData>>('/api/space/wall-distance', {
    method: 'POST',
    body: JSON.stringify({
      ...request,
      suppo_refno: normalizeSuppoRefno(request.suppo_refno),
    }),
  });
}

export async function postSpaceSuppoTrays(
  request: SpaceComputeSuppoRequest,
): Promise<SpaceEnvelope<SpaceComputeSuppoTrayData>> {
  return await fetchJson<SpaceEnvelope<SpaceComputeSuppoTrayData>>('/api/space/suppo-trays', {
    method: 'POST',
    body: JSON.stringify({
      ...request,
      suppo_refno: normalizeSuppoRefno(request.suppo_refno),
    }),
  });
}

export async function postSpaceSteelRelative(
  request: SpaceComputeSteelRelativeRequest,
): Promise<SpaceEnvelope<SpaceComputeSteelRelativeData>> {
  return await fetchJson<SpaceEnvelope<SpaceComputeSteelRelativeData>>('/api/space/steel-relative', {
    method: 'POST',
    body: JSON.stringify({
      ...request,
      suppo_refno: normalizeSuppoRefno(request.suppo_refno),
    }),
  });
}

export async function postSpaceTraySpan(
  request: SpaceComputeTraySpanRequest,
): Promise<SpaceEnvelope<SpaceComputeTraySpanData>> {
  return await fetchJson<SpaceEnvelope<SpaceComputeTraySpanData>>('/api/space/tray-span', {
    method: 'POST',
    body: JSON.stringify({
      ...request,
      suppo_refno: normalizeSuppoRefno(request.suppo_refno),
    }),
  });
}

/**
 * 便捷方法：按中心点 + 半径查询周边构件
 *
 * @param cx 中心 X（毫米）
 * @param cy 中心 Y（毫米）
 * @param cz 中心 Z（毫米）
 * @param radius 半径（毫米）
 * @param options 可选过滤参数
 */
export async function queryNearbyByCenter(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  options?: SpatialNearbyOptions,
): Promise<SpatialNearbyResult> {
  return queryNearbyByPosition(cx, cy, cz, radius, options);
}

/**
 * 便捷方法：按坐标点 + 半径查询周边构件（position 模式）
 */
export async function queryNearbyByPosition(
  x: number,
  y: number,
  z: number,
  radius: number,
  options?: SpatialNearbyOptions,
): Promise<SpatialNearbyResult> {
  return queryNearbySpatial({
    x,
    y,
    z,
    radius,
    ...options,
  });
}
