export type PdmsUiAttrResponse = {
  success: boolean;
  refno: string;
  attrs: Record<string, unknown>;
  error_message?: string | null;
};

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
