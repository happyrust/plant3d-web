export type PdmsUiAttrResponse = {
  success: boolean;
  refno: string;
  attrs: Record<string, unknown>;
  /** 构件完整路径名称（层级路径） */
  full_name?: string | null;
  error_message?: string | null;
};

/**
 * 点集(ptset)中单个点的信息
 */
export type PtsetPoint = {
  /** 点编号 */
  number: number;
  /** 3D 坐标 [x, y, z] */
  pt: [number, number, number];
  /** 方向向量 [x, y, z]（可选） */
  dir: [number, number, number] | null;
  /** 方向标志 */
  dir_flag: number;
  /** 参考方向 [x, y, z]（可选） */
  ref_dir: [number, number, number] | null;
  /** 管道外径 */
  pbore: number;
  /** 宽度 */
  pwidth: number;
  /** 高度 */
  pheight: number;
  /** 连接信息 */
  pconnect: string;
}

/**
 * ptset 查询响应
 */
export type PtsetResponse = {
  success: boolean;
  refno: string;
  /** 点集数据列表 */
  ptset: PtsetPoint[];
  /** 世界坐标变换矩阵（4x4） */
  world_transform: number[][] | null;
  /** 单位转换信息 */
  unit_info?: {
    source_unit: string;
    target_unit: string;
    conversion_factor: number;
  } | null;
  error_message?: string | null;
}

function getBaseUrl(): string {
  const envBase = (import.meta.env as unknown as { VITE_GEN_MODEL_API_BASE_URL?: string }).VITE_GEN_MODEL_API_BASE_URL;
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

export async function pdmsGetUiAttr(refno: string): Promise<PdmsUiAttrResponse> {
  return await fetchJson<PdmsUiAttrResponse>(`/api/pdms/ui-attr/${encodeURIComponent(refno)}`);
}

/**
 * 获取指定元件的 ptset（点集）数据
 * @param refno 元件参考号，格式为 "24383_84631"
 * @returns 包含点集信息的响应
 */
export async function pdmsGetPtset(refno: string): Promise<PtsetResponse> {
  return await fetchJson<PtsetResponse>(`/api/pdms/ptset/${encodeURIComponent(refno)}`);
}

/**
 * 获取 ptset（带上下文）
 *
 * 说明：当前后端 ptset 接口不依赖 dbno/batch_id；这里保留签名以便与 ViewerPanel 的“快照一致性”逻辑对齐。
 */
export async function pdmsGetPtsetWithContext(
  refno: string,
  _ctx?: { dbno?: number; batchId?: string | null },
): Promise<PtsetResponse> {
  return await pdmsGetPtset(refno);
}

/**
 * 变换矩阵查询响应
 */
export type TransformResponse = {
  success: boolean;
  refno: string;
  /** 世界变换矩阵 (4x4 列主序) */
  world_transform: number[] | null;
  /** Owner refno */
  owner: string | null;
  error_message?: string | null;
}

/**
 * 获取指定元件的变换矩阵和 owner
 * @param refno 元件参考号，格式为 "24383_84631"
 * @returns 包含变换矩阵和 owner 的响应
 */
export async function pdmsGetTransform(refno: string): Promise<TransformResponse> {
  return await fetchJson<TransformResponse>(`/api/pdms/transform/${encodeURIComponent(refno)}`);
}

// ========================
// PDMS 模型查询辅助（后端 SurrealDB）
// ========================

export type PdmsTypeInfoResponse = {
  success: boolean;
  refno: string;
  noun?: string | null;
  owner_refno?: string | null;
  owner_noun?: string | null;
  error_message?: string | null;
}

export type PdmsChildrenResponse = {
  success: boolean;
  refno: string;
  children: string[];
  error_message?: string | null;
}

/**
 * 获取 noun / owner_noun（用于 BRAN/HANG 规则；后端查询 SurrealDB）
 */
export async function pdmsGetTypeInfo(refno: string): Promise<PdmsTypeInfoResponse> {
  const qs = new URLSearchParams({ refno: String(refno || '') }).toString();
  return await fetchJson<PdmsTypeInfoResponse>(`/api/pdms/type-info?${qs}`);
}

/**
 * 获取 pe->owns 子节点（用于 BRAN/HANG children；后端查询 SurrealDB）
 */
export async function pdmsGetOwnsChildren(refno: string): Promise<PdmsChildrenResponse> {
  const qs = new URLSearchParams({ refno: String(refno || '') }).toString();
  return await fetchJson<PdmsChildrenResponse>(`/api/pdms/children?${qs}`);
}
