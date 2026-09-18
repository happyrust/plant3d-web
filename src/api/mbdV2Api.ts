import type { MbdV2ParseResult } from '@/dimension';

import { parseMbdV2PipeData } from '@/dimension';
import { buildBackendUrl } from '@/utils/apiBase';
import { parseJsonResponse } from '@/utils/fileValidation';

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
 * 非 2xx 时给尺寸面板看的一句话。
 *
 * 后端（gen-model `web_service::mbd::api_error`）的错误信封是 `{ code, message, detail }`，
 * `message` 已经是写给人看的中文（例：`refno 24381/30278（BRAN）的属主是 HVAC，风管不出管道尺寸标注`、
 * `refno …（ATTA）不是派生隐式管身的路由容器，没有管道尺寸标注`）。以前这里只留状态码，
 * 面板上出现的是 `MBD V2 API responded with status 422`，那句话被丢在响应体里到不了界面
 * （`genModelV1Api.ts` 早就读信封了，这条通道没跟上）。
 *
 * - 正文是带非空 `message` 的信封 → 原样透出 `message`；
 * - 不是（代理页、空正文、别的 JSON 形状）→ 仍按状态码兜底，正文非空就附前 200 字，别把线索吞掉。
 */
export function describeMbdV2HttpFailure(status: number, bodyText: string): string {
  const text = bodyText.trim();
  if (text) {
    try {
      const envelope = JSON.parse(text) as unknown;
      if (envelope && typeof envelope === 'object') {
        const message = (envelope as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message.trim();
      }
    } catch {
      // 不是 JSON：走下面的兜底
    }
  }
  const fallback = `MBD V2 API responded with status ${status}`;
  return text ? `${fallback}: ${text.slice(0, 200)}` : fallback;
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
  const url = mbdApiBase ? `${mbdApiBase}${path}` : buildBackendUrl(path);
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      // 正文读不出来就只剩状态码，照旧兜底
    }
    return { ok: false, error: describeMbdV2HttpFailure(response.status, bodyText) };
  }
  const payload = await parseJsonResponse<unknown>(response, url);
  return parseMbdV2PipeData(payload);
}
