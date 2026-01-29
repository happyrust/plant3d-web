export type PdmsSearchRequest = {
  keyword?: string;
  nouns?: string[];
  site?: string;
  offset?: number;
  limit?: number;
  facets?: boolean;
};

export type PdmsSearchItem = {
  refno: string;
  name: string;
  noun: string;
  site?: string | null;
};

export type PdmsSearchResponse = {
  success: boolean;
  items: PdmsSearchItem[];
  total: number;
  offset: number;
  limit: number;
  facet_distribution?: Record<string, Record<string, number>> | null;
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

export async function pdmsSearch(req: PdmsSearchRequest): Promise<PdmsSearchResponse> {
  return await fetchJson<PdmsSearchResponse>('/api/search/pdms', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

