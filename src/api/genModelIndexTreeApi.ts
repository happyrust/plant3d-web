export type VisibleRefnosResponse = {
  success: boolean;
  refno: string;
  refnos: string[];
  total?: number;
  offset?: number;
  limit?: number;
  error_message?: string | null;
};

export type VisibleRefnosQuery = {
  refno: string;
  offset?: number;
  limit?: number;
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

export async function queryVisibleRefnos(params: VisibleRefnosQuery): Promise<VisibleRefnosResponse> {
  const url = new URL('http://localhost');
  url.pathname = '/api/indextree/query_visible_refnos';
  url.searchParams.set('refno', params.refno);
  if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
  if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
  return await fetchJson<VisibleRefnosResponse>(`${url.pathname}${url.search}`);
}
