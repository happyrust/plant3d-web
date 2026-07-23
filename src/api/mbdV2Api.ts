import type { MbdV2ParseResult } from '@/dimension';

import { parseMbdV2PipeData } from '@/dimension';
import { buildBackendUrl } from '@/utils/apiBase';

export type ResolveMbdApiBaseUrlOptions = Readonly<{
  search: string;
  envBase?: string | null;
  browserHostname: string;
  browserProtocol?: string;
}>;

function normalizeHttpBase(value: string | null | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, '') || '';
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? normalized
      : '';
  } catch {
    return '';
  }
}

/**
 * MBD is hosted by the detached plant-web-server while the remaining viewer
 * APIs can still come from the legacy site runtime. Keep that split explicit
 * instead of redirecting every viewer request to the MBD host.
 */
export function resolveMbdApiBaseUrl(
  options: ResolveMbdApiBaseUrlOptions,
): string {
  const params = new URLSearchParams(options.search);
  const queryBase = normalizeHttpBase(params.get('mbdBackend'));
  if (queryBase) return queryBase;

  const port = params.get('mbdBackendPort')?.trim() || '';
  if (/^\d+$/.test(port)) {
    const protocol = options.browserProtocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${options.browserHostname}:${port}`;
  }

  return normalizeHttpBase(options.envBase);
}

function getMbdApiBaseUrl(): string {
  return resolveMbdApiBaseUrl({
    search: typeof window === 'undefined' ? '' : window.location.search,
    envBase: (import.meta.env as unknown as { VITE_MBD_API_BASE_URL?: string })
      .VITE_MBD_API_BASE_URL,
    browserHostname: typeof window === 'undefined' ? 'localhost' : window.location.hostname,
    browserProtocol: typeof window === 'undefined' ? 'http:' : window.location.protocol,
  });
}

/**
 * Live MBD V2 channel: fetch one branch's MbdV2PipeData by refno from
 * plant-web-server. HTTP status and contract-shape problems come back as an
 * `ok: false` parse result; transport failures reject like any fetch.
 */
export async function fetchMbdV2PipeData(
  refno: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<MbdV2ParseResult> {
  const normalized = refno.trim();
  if (!normalized) {
    return { ok: false, error: 'MBD V2 refno must not be empty' };
  }
  const path = `/api/mbd/v2/pipe/${encodeURIComponent(normalized)}`;
  const mbdApiBase = getMbdApiBaseUrl();
  const response = await fetch(
    mbdApiBase ? `${mbdApiBase}${path}` : buildBackendUrl(path),
    { signal: options.signal },
  );
  if (!response.ok) {
    return {
      ok: false,
      error: `MBD V2 API responded with status ${response.status}`,
    };
  }
  return parseMbdV2PipeData(await response.json());
}
