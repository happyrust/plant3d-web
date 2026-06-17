import type {
  AncestorsResponse,
  ChildrenResponse,
  NodeResponse,
  SearchRequest,
  SearchResponse,
  SubtreeRefnosResponse,
  TreeNodeDto,
  VisibleInstsResponse,
} from '@/api/genModelE3dTypes';

import {
  e3dParquetGetAncestors,
  e3dParquetGetChildren,
  e3dParquetGetNode,
  e3dParquetGetSubtreeRefnos,
  e3dParquetGetVisibleInsts,
  e3dParquetGetWorldRoot,
  e3dParquetSearch,
} from '@/api/genModelE3dParquetApi';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { getBackendApiBaseUrl } from '@/utils/apiBase';

export type {
  AncestorsResponse,
  ChildrenResponse,
  NodeResponse,
  SearchRequest,
  SearchResponse,
  SubtreeRefnosResponse,
  TreeNodeDto,
  VisibleInstsResponse,
} from '@/api/genModelE3dTypes';

type E3dSource = 'backend' | 'parquet';

function getE3dSource(): E3dSource {
  try {
    const v = new URLSearchParams(window.location.search).get('e3d_source') || '';
    const s = v.trim().toLowerCase();
    if (s === 'parquet') return 'parquet';
    if (s === 'backend') return 'backend';
  } catch {
    // ignore
  }
  // 默认只走后端数据库查询；不再在后端失败时回退 DuckDB/Parquet。
  return 'backend';
}

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

export async function e3dGetWorldRoot(): Promise<NodeResponse> {
  const source = getE3dSource();
  if (source === 'parquet') return await e3dParquetGetWorldRoot();
  return await fetchJson<NodeResponse>('/api/e3d/world-root');
}

export async function e3dGetNode(refno: string): Promise<NodeResponse> {
  const source = getE3dSource();
  if (source === 'parquet') return await e3dParquetGetNode(refno);
  return await fetchJson<NodeResponse>(`/api/e3d/node/${encodeURIComponent(refno)}`);
}

export async function e3dGetChildren(refno: string, limit?: number): Promise<ChildrenResponse> {
  const source = getE3dSource();

  const url = new URL('http://localhost');
  url.pathname = `/api/e3d/children/${encodeURIComponent(refno)}`;
  if (limit !== undefined) {
    url.searchParams.set('limit', String(limit));
  }

  if (source === 'parquet') {
    return await e3dParquetGetChildren(refno, limit);
  }
  return await fetchJson<ChildrenResponse>(`${url.pathname}${url.search}`);
}

async function backendE3dGetAncestors(refno: string): Promise<AncestorsResponse> {
  const resp = await fetchJson<AncestorsResponse>(`/api/e3d/ancestors/${encodeURIComponent(refno)}`);
  console.info('[vis][api] /api/e3d/ancestors', {
    refno,
    refno_count: Array.isArray(resp.refnos) ? resp.refnos.length : 0,
    success: resp.success,
  });
  const { addLog } = useConsoleStore();
  addLog(
    'info',
    `[vis][api] /api/e3d/ancestors success=${resp.success ? 1 : 0} refno=${refno} refno_count=${Array.isArray(resp.refnos) ? resp.refnos.length : 0}`
  );
  return resp;
}

export async function e3dGetAncestors(refno: string): Promise<AncestorsResponse> {
  const source = getE3dSource();
  if (source === 'parquet') return await e3dParquetGetAncestors(refno);

  try {
    return await backendE3dGetAncestors(refno);
  } catch (e) {
    console.error('[vis][api] /api/e3d/ancestors failed', { refno, error: e });
    const { addLog } = useConsoleStore();
    addLog('error', `[vis][api] /api/e3d/ancestors failed refno=${refno} err=${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

async function backendE3dGetSubtreeRefnos(
  refno: string,
  params?: { includeSelf?: boolean; maxDepth?: number; limit?: number }
): Promise<SubtreeRefnosResponse> {
  const url = new URL('http://localhost');
  url.pathname = `/api/e3d/subtree-refnos/${encodeURIComponent(refno)}`;
  if (params?.includeSelf !== undefined) {
    url.searchParams.set('include_self', String(params.includeSelf));
  }
  if (params?.maxDepth !== undefined) {
    url.searchParams.set('max_depth', String(params.maxDepth));
  }
  if (params?.limit !== undefined) {
    url.searchParams.set('limit', String(params.limit));
  }

  const resp = await fetchJson<SubtreeRefnosResponse>(`${url.pathname}${url.search}`);
  console.info('[vis][api] /api/e3d/subtree-refnos', {
    refno,
    include_self: params?.includeSelf,
    max_depth: params?.maxDepth,
    limit: params?.limit,
    refno_count: Array.isArray(resp.refnos) ? resp.refnos.length : 0,
    truncated: resp.truncated,
    success: resp.success,
  });
  const { addLog } = useConsoleStore();
  addLog(
    'info',
    `[vis][api] /api/e3d/subtree-refnos success=${resp.success ? 1 : 0} refno=${refno} refno_count=${Array.isArray(resp.refnos) ? resp.refnos.length : 0} truncated=${resp.truncated ? 1 : 0}`
  );
  return resp;
}

export async function e3dGetSubtreeRefnos(
  refno: string,
  params?: { includeSelf?: boolean; maxDepth?: number; limit?: number }
): Promise<SubtreeRefnosResponse> {
  const source = getE3dSource();
  if (source === 'parquet') {
    return await e3dParquetGetSubtreeRefnos(refno, params);
  }

  try {
    return await backendE3dGetSubtreeRefnos(refno, params);
  } catch (e) {
    console.error('[vis][api] /api/e3d/subtree-refnos failed', {
      refno,
      include_self: params?.includeSelf,
      max_depth: params?.maxDepth,
      limit: params?.limit,
      error: e,
    });
    const { addLog } = useConsoleStore();
    addLog(
      'error',
      `[vis][api] /api/e3d/subtree-refnos failed refno=${refno} err=${e instanceof Error ? e.message : String(e)}`
    );
    throw e;
  }
}

async function backendE3dGetVisibleInsts(refno: string): Promise<VisibleInstsResponse> {
  const resp = await fetchJson<VisibleInstsResponse>(`/api/e3d/visible-insts/${encodeURIComponent(refno)}`);
  const debugAny = resp.debug;
  console.info('[vis][api] /api/e3d/visible-insts', {
    refno,
    refno_count: Array.isArray(resp.refnos) ? resp.refnos.length : 0,
    success: resp.success,
    debug: debugAny || null,
  });
  const { addLog } = useConsoleStore();
  const refnoCount = Array.isArray(resp.refnos) ? resp.refnos.length : 0;
  const line =
    `[vis][api] /api/e3d/visible-insts success=${resp.success ? 1 : 0} refno=${refno} refno_count=${refnoCount}` +
    (debugAny
      ? ` candidates=${debugAny.candidates_count ?? ''} filtered=${debugAny.filtered_count ?? ''} visible=${debugAny.visible_count ?? ''} source=${debugAny.source ?? ''}`
      : '');
  if (resp.success && refnoCount === 0) {
    addLog(
      'warning',
      `${line} → 可见实例为空（该节点/分支未命中可加载几何实例；若为 GENSEC/SPINE/POINSP 等结构节点通常属正常，若应显示请检查几何生成/inst_relate）`
    );
  } else {
    addLog('info', line);
  }
  return resp;
}

export async function e3dGetVisibleInsts(refno: string): Promise<VisibleInstsResponse> {
  const source = getE3dSource();
  if (source === 'parquet') return await e3dParquetGetVisibleInsts(refno);

  try {
    return await backendE3dGetVisibleInsts(refno);
  } catch (e) {
    console.error('[vis][api] /api/e3d/visible-insts failed', { refno, error: e });
    const { addLog } = useConsoleStore();
    addLog(
      'error',
      `[vis][api] /api/e3d/visible-insts failed refno=${refno} err=${e instanceof Error ? e.message : String(e)}`
    );
    throw e;
  }
}

export async function e3dSearch(req: SearchRequest): Promise<SearchResponse> {
  const source = getE3dSource();
  if (source === 'parquet') return await e3dParquetSearch(req);
  return await fetchJson<SearchResponse>('/api/e3d/search', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// ========================
// Site Nodes API (xeokit Node 层级)
// ========================

/** AABB 包围盒 */
export type NodeAabb = {
  min: [number, number, number];
  max: [number, number, number];
}

/** Site Node 数据 */
export type SiteNodeData = {
  refno: string;
  parent: string | null;
  noun: string;
  name?: string;
  aabb: NodeAabb | null;
  has_geo: boolean;
}

/** Site Nodes API 响应 */
export type SiteNodesResponse = {
  success: boolean;
  nodes: SiteNodeData[];
  total: number;
  error_message?: string;
}

/**
 * 获取指定 SITE 的 Node 层级数据
 * 用于前端构建 xeokit Node 层级拓扑
 *
 * @param siteRefno SITE 节点的 refno
 */
export async function e3dGetSiteNodes(siteRefno: string): Promise<SiteNodesResponse> {
  return await fetchJson<SiteNodesResponse>(
    `/api/e3d/site-nodes/${encodeURIComponent(siteRefno)}`
  );
}
