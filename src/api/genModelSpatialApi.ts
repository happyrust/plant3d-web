import { type TreeNodeDto } from './genModelE3dApi';

function getBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string })
    .VITE_GEN_MODEL_API_BASE_URL;
  return (envBase && envBase.trim()) || '';
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

export type SpatialQueryResult = {
  success: boolean;
  results?: SpatialQueryResultItem[];
  /** 是否因 max_results 截断 */
  truncated?: boolean;
  /** 实际查询使用的 AABB */
  query_bbox?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  error?: string;
};

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
  /** 最大返回数量（默认 5000） */
  max_results?: number;
  /** noun 过滤（逗号分隔，如 "EQUI,PIPE,TUBI"） */
  nouns?: string;
  /** 是否包含自身（mode=refno 时有效，默认 true） */
  include_self?: boolean;
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
  if (params.distance !== undefined) sp.set('distance', String(params.distance));

  if (params.minx !== undefined) sp.set('minx', String(params.minx));
  if (params.miny !== undefined) sp.set('miny', String(params.miny));
  if (params.minz !== undefined) sp.set('minz', String(params.minz));
  if (params.maxx !== undefined) sp.set('maxx', String(params.maxx));
  if (params.maxy !== undefined) sp.set('maxy', String(params.maxy));
  if (params.maxz !== undefined) sp.set('maxz', String(params.maxz));

  if (params.max_results !== undefined) sp.set('max_results', String(params.max_results));
  if (params.nouns) sp.set('nouns', params.nouns);
  if (params.include_self !== undefined) sp.set('include_self', String(params.include_self));
  if (params.shape) sp.set('shape', params.shape);

  const query = sp.toString();
  return await fetchJson<SpatialQueryResult>(`/api/sqlite-spatial/query${query ? '?' + query : ''}`);
}

/**
 * 查询空间索引统计信息（健康检查）
 */
export async function querySpatialStats(): Promise<SpatialStatsResult> {
  return await fetchJson<SpatialStatsResult>('/api/sqlite-spatial/stats');
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
  options?: { nouns?: string; max_results?: number; shape?: 'cube' | 'sphere' },
): Promise<SpatialQueryResult> {
  return querySpatialIndex({
    mode: 'bbox',
    minx: cx - radius,
    miny: cy - radius,
    minz: cz - radius,
    maxx: cx + radius,
    maxy: cy + radius,
    maxz: cz + radius,
    max_results: options?.max_results,
    nouns: options?.nouns,
    shape: options?.shape,
  });
}

/**
 * 便捷方法：按坐标点 + 半径查询周边构件（position 模式）
 */
export async function queryNearbyByPosition(
  x: number,
  y: number,
  z: number,
  radius: number,
  options?: { nouns?: string; max_results?: number; shape?: 'cube' | 'sphere' },
): Promise<SpatialQueryResult> {
  return querySpatialIndex({
    mode: 'position',
    x,
    y,
    z,
    radius,
    max_results: options?.max_results,
    nouns: options?.nouns,
    shape: options?.shape,
  });
}
