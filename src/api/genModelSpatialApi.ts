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

export type SpatialQueryResultItem = {
  refno: number;
  noun: string;
  aabb?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
};

export type SpatialQueryResult = {
  success: boolean;
  results?: SpatialQueryResultItem[];
  error?: string;
};

export type SpatialQueryParams = {
  mode?: 'bbox' | 'refno';
  refno?: string;
  distance?: number;
  minx?: number;
  miny?: number;
  minz?: number;
  maxx?: number;
  maxy?: number;
  maxz?: number;
};

export async function querySpatialIndex(params: SpatialQueryParams): Promise<SpatialQueryResult> {
  const url = new URL('http://localhost'); // Dummy base, will be replaced by fetchJson path logic
  url.pathname = '/api/sqlite-spatial/query';
  
  if (params.mode) url.searchParams.set('mode', params.mode);
  if (params.refno) url.searchParams.set('refno', params.refno);
  if (params.distance !== undefined) url.searchParams.set('distance', String(params.distance));
  
  if (params.minx !== undefined) url.searchParams.set('minx', String(params.minx));
  if (params.miny !== undefined) url.searchParams.set('miny', String(params.miny));
  if (params.minz !== undefined) url.searchParams.set('minz', String(params.minz));
  if (params.maxx !== undefined) url.searchParams.set('maxx', String(params.maxx));
  if (params.maxy !== undefined) url.searchParams.set('maxy', String(params.maxy));
  if (params.maxz !== undefined) url.searchParams.set('maxz', String(params.maxz));

  return await fetchJson<SpatialQueryResult>(`${url.pathname}${url.search}`);
}
