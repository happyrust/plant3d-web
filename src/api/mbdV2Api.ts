import type { MbdV2ParseResult } from '@/dimension';

import { parseMbdV2PipeData } from '@/dimension';
import { buildBackendUrl } from '@/utils/apiBase';

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
  const response = await fetch(
    buildBackendUrl(`/api/mbd/v2/pipe/${encodeURIComponent(normalized)}`),
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
