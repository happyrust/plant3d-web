import { useConsoleStore } from '@/composables/useConsoleStore';
import { getBackendApiBaseUrl } from '@/utils/apiBase';

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

export async function queryVisibleRefnos(params: VisibleRefnosQuery): Promise<VisibleRefnosResponse> {
  const url = new URL('http://localhost');
  url.pathname = '/api/indextree/query_visible_refnos';
  url.searchParams.set('refno', params.refno);
  if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
  if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
  try {
    const resp = await fetchJson<VisibleRefnosResponse>(`${url.pathname}${url.search}`);
    console.info('[vis][api] /api/indextree/query_visible_refnos', {
      refno: params.refno,
      offset: params.offset,
      limit: params.limit,
      refno_count: Array.isArray(resp.refnos) ? resp.refnos.length : 0,
      total: resp.total,
      success: resp.success,
    });
    const { addLog } = useConsoleStore();
    addLog(
      'info',
      `[vis][api] /api/indextree/query_visible_refnos success=${resp.success ? 1 : 0} refno=${params.refno} refno_count=${Array.isArray(resp.refnos) ? resp.refnos.length : 0} offset=${params.offset ?? 0} limit=${params.limit ?? ''} total=${typeof resp.total === 'number' ? resp.total : ''}`
    );
    return resp;
  } catch (e) {
    console.error('[vis][api] /api/indextree/query_visible_refnos failed', {
      refno: params.refno,
      offset: params.offset,
      limit: params.limit,
      error: e,
    });
    const { addLog } = useConsoleStore();
    addLog(
      'error',
      `[vis][api] /api/indextree/query_visible_refnos failed refno=${params.refno} offset=${params.offset ?? 0} limit=${params.limit ?? ''} err=${e instanceof Error ? e.message : String(e)}`
    );
    throw e;
  }
}
