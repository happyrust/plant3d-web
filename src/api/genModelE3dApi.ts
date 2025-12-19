export type TreeNodeDto = {
  refno: string;
  name: string;
  noun: string;
  owner?: string | null;
  children_count?: number | null;
};

export type NodeResponse = {
  success: boolean;
  node: TreeNodeDto | null;
  error_message?: string | null;
};

export type ChildrenResponse = {
  success: boolean;
  parent_refno: string;
  children: TreeNodeDto[];
  truncated: boolean;
  error_message?: string | null;
};

export type AncestorsResponse = {
  success: boolean;
  refnos: string[];
  error_message?: string | null;
};

export type SubtreeRefnosResponse = {
  success: boolean;
  refnos: string[];
  truncated: boolean;
  error_message?: string | null;
};

export type VisibleInstsResponse = {
  success: boolean;
  refno: string;
  refnos: string[];
  error_message?: string | null;
};

export type SearchRequest = {
  keyword: string;
  nouns?: string[];
  limit?: number;
};

export type SearchResponse = {
  success: boolean;
  items: TreeNodeDto[];
  error_message?: string | null;
};

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

export async function e3dGetWorldRoot(): Promise<NodeResponse> {
  return await fetchJson<NodeResponse>('/api/e3d/world-root');
}

export async function e3dGetNode(refno: string): Promise<NodeResponse> {
  return await fetchJson<NodeResponse>(`/api/e3d/node/${encodeURIComponent(refno)}`);
}

export async function e3dGetChildren(refno: string, limit?: number): Promise<ChildrenResponse> {
  const url = new URL('http://localhost');
  url.pathname = `/api/e3d/children/${encodeURIComponent(refno)}`;
  if (limit !== undefined) {
    url.searchParams.set('limit', String(limit));
  }
  return await fetchJson<ChildrenResponse>(`${url.pathname}${url.search}`);
}

export async function e3dGetAncestors(refno: string): Promise<AncestorsResponse> {
  return await fetchJson<AncestorsResponse>(`/api/e3d/ancestors/${encodeURIComponent(refno)}`);
}

export async function e3dGetSubtreeRefnos(
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
  return await fetchJson<SubtreeRefnosResponse>(`${url.pathname}${url.search}`);
}

export async function e3dGetVisibleInsts(refno: string): Promise<VisibleInstsResponse> {
  return await fetchJson<VisibleInstsResponse>(`/api/e3d/visible-insts/${encodeURIComponent(refno)}`);
}

export async function e3dSearch(req: SearchRequest): Promise<SearchResponse> {
  return await fetchJson<SearchResponse>('/api/e3d/search', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
