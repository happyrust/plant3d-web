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

type RawRoomTreeNodeDto = Omit<RoomTreeNodeDto, 'id' | 'owner'> & {
  id: unknown;
  owner?: unknown;
};

type RawRoomTreeNodeResponse = Omit<RoomTreeNodeResponse, 'node'> & {
  node: RawRoomTreeNodeDto | null;
};

type RawRoomTreeChildrenResponse = Omit<RoomTreeChildrenResponse, 'parent_id' | 'children'> & {
  parent_id: unknown;
  children: RawRoomTreeNodeDto[];
};

type RawRoomTreeAncestorsResponse = Omit<RoomTreeAncestorsResponse, 'ids'> & {
  ids: unknown[];
};

type RawRoomTreeSearchResponse = Omit<RoomTreeSearchResponse, 'items'> & {
  items: RawRoomTreeNodeDto[];
};

function getBaseUrl(): string {
  return getBackendApiBaseUrl();
}

export function normalizeRoomTreeId(value: unknown): string {
  if (value == null) return '';

  if (Array.isArray(value) && value.length >= 2) {
    return `${value[0]}_${value[1]}`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const nested = obj.Refno ?? obj.refno ?? obj.id ?? obj.value;
    if (nested !== undefined && nested !== value) {
      return normalizeRoomTreeId(nested);
    }
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const wrapped = raw.match(/(?:^|:)[`⟨<]([^`⟩>]+)[`⟩>]/)?.[1];
  if (wrapped) return normalizeRoomTreeId(wrapped);

  const prefixed = raw.match(/^[A-Za-z_]+:`?(\d+[_/,]\d+)`?$/)?.[1];
  if (prefixed) return normalizeRoomTreeId(prefixed);

  return raw.replace(/\b(\d+)[/,](\d+)\b/g, '$1_$2').replace(/^=/, '');
}

function normalizeNode(dto: RawRoomTreeNodeDto): RoomTreeNodeDto {
  return {
    ...dto,
    id: normalizeRoomTreeId(dto.id),
    owner: dto.owner == null ? null : normalizeRoomTreeId(dto.owner),
  };
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
  const resp = await fetchJson<RawRoomTreeNodeResponse>('/api/room-tree/root');
  return { ...resp, node: resp.node ? normalizeNode(resp.node) : null };
}

export async function roomTreeGetChildren(id: string, limit?: number): Promise<RoomTreeChildrenResponse> {
  const url = new URL('http://localhost');
  url.pathname = `/api/room-tree/children/${encodeURIComponent(id)}`;
  if (limit !== undefined) {
    url.searchParams.set('limit', String(limit));
  }
  const resp = await fetchJson<RawRoomTreeChildrenResponse>(`${url.pathname}${url.search}`);
  return {
    ...resp,
    parent_id: normalizeRoomTreeId(resp.parent_id),
    children: resp.children.map(normalizeNode),
  };
}

export async function roomTreeGetAncestors(id: string): Promise<RoomTreeAncestorsResponse> {
  const resp = await fetchJson<RawRoomTreeAncestorsResponse>(`/api/room-tree/ancestors/${encodeURIComponent(id)}`);
  return { ...resp, ids: resp.ids.map(normalizeRoomTreeId).filter(Boolean) };
}

export async function roomTreeSearch(req: RoomTreeSearchRequest): Promise<RoomTreeSearchResponse> {
  const resp = await fetchJson<RawRoomTreeSearchResponse>('/api/room-tree/search', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  return { ...resp, items: resp.items.map(normalizeNode) };
}
