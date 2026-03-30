import type {
  DeploymentSite,
  DeploymentSiteActionResponse,
  DeploymentSiteCreateRequest,
  DeploymentSiteIdentity,
  DeploymentSiteImportRequest,
  DeploymentSiteListResponse,
  DeploymentSiteQueryParams,
  DeploymentSiteUpdateRequest,
} from '@/types/site';

import { getBackendApiBaseUrl } from '@/utils/apiBase';

export class SiteRegistryApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'SiteRegistryApiError';
    this.status = status;
    this.payload = payload;
  }
}

function getBaseUrl(): string {
  return getBackendApiBaseUrl();
}

function buildUrl(path: string): string {
  const base = getBaseUrl().replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function appendQuery(path: string, query?: DeploymentSiteQueryParams): string {
  if (!query) return path;

  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null || rawValue === '') continue;
    params.set(key, String(rawValue));
  }

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function parseErrorPayload(resp: Response): Promise<unknown> {
  const text = await resp.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['error', 'message', 'error_message']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
  }
  return fallback;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!resp.ok) {
    const payload = await parseErrorPayload(resp);
    throw new SiteRegistryApiError(
      getErrorMessage(payload, `HTTP ${resp.status} ${resp.statusText}`),
      resp.status,
      payload,
    );
  }

  return await resp.json() as T;
}

export async function getDeploymentSites(
  query?: DeploymentSiteQueryParams,
): Promise<DeploymentSiteListResponse> {
  return await requestJson<DeploymentSiteListResponse>(appendQuery('/api/deployment-sites', query));
}

export async function getDeploymentSite(siteId: string): Promise<DeploymentSite> {
  return await requestJson<DeploymentSite>(`/api/deployment-sites/${encodeURIComponent(siteId)}`);
}

export async function createDeploymentSite(
  payload: DeploymentSiteCreateRequest,
): Promise<DeploymentSiteActionResponse> {
  return await requestJson<DeploymentSiteActionResponse>('/api/deployment-sites', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateDeploymentSite(
  siteId: string,
  payload: DeploymentSiteUpdateRequest,
): Promise<DeploymentSiteActionResponse> {
  return await requestJson<DeploymentSiteActionResponse>(`/api/deployment-sites/${encodeURIComponent(siteId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteDeploymentSite(siteId: string): Promise<DeploymentSiteActionResponse> {
  return await requestJson<DeploymentSiteActionResponse>(`/api/deployment-sites/${encodeURIComponent(siteId)}`, {
    method: 'DELETE',
  });
}

export async function healthcheckDeploymentSite(siteId: string): Promise<DeploymentSiteActionResponse> {
  return await requestJson<DeploymentSiteActionResponse>(`/api/deployment-sites/${encodeURIComponent(siteId)}/healthcheck`, {
    method: 'POST',
  });
}

export async function importDeploymentSiteFromDbOption(
  payload: DeploymentSiteImportRequest,
): Promise<DeploymentSiteActionResponse> {
  return await requestJson<DeploymentSiteActionResponse>('/api/deployment-sites/import-dboption', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getCurrentSiteIdentity(): Promise<DeploymentSiteIdentity> {
  return await requestJson<DeploymentSiteIdentity>('/api/site/identity');
}
