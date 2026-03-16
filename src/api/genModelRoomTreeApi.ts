import { getBackendApiBaseUrl } from '@/utils/apiBase';

export type RoomTreeNodeDto = {
  id: string;
  name: string;
  noun: string;
  owner?: string | null;
  children_count?: number | null;
};

export type RoomTreeNodeResponse = {
  success: boolean;
  node: RoomTreeNodeDto | null;
  error_message?: string | null;
};

export type RoomTreeChildrenResponse = {
  success: boolean;
  parent_id: string;
  children: RoomTreeNodeDto[];
  truncated: boolean;
  error_message?: string | null;
};

export type RoomTreeAncestorsResponse = {
  success: boolean;
  ids: string[];
  error_message?: string | null;
};

export type RoomTreeSearchRequest = {
  keyword: string;
  limit?: number;
};

export type RoomTreeSearchResponse = {
  success: boolean;
  items: RoomTreeNodeDto[];
  error_message?: string | null;
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

export async function roomTreeGetRoot(): Promise<RoomTreeNodeResponse> {
  return await fetchJson<RoomTreeNodeResponse>('/api/room-tree/root');
}

export async function roomTreeGetChildren(id: string, limit?: number): Promise<RoomTreeChildrenResponse> {
  const url = new URL('http://localhost');
  url.pathname = `/api/room-tree/children/${encodeURIComponent(id)}`;
  if (limit !== undefined) {
    url.searchParams.set('limit', String(limit));
  }
  return await fetchJson<RoomTreeChildrenResponse>(`${url.pathname}${url.search}`);
}

export async function roomTreeGetAncestors(id: string): Promise<RoomTreeAncestorsResponse> {
  return await fetchJson<RoomTreeAncestorsResponse>(`/api/room-tree/ancestors/${encodeURIComponent(id)}`);
}

export async function roomTreeSearch(req: RoomTreeSearchRequest): Promise<RoomTreeSearchResponse> {
  return await fetchJson<RoomTreeSearchResponse>('/api/room-tree/search', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}
