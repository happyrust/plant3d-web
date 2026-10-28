import type { MbdV2ParseResult } from '@/dimension';

import { parseMbdV2PipeData } from '@/dimension';
import { buildBackendUrl } from '@/utils/apiBase';
import { parseJsonResponse } from '@/utils/fileValidation';

export type ResolveMbdApiBaseUrlOptions = Readonly<{
  search: string;
  envBase?: string | null;
  browserHostname: string;
  browserProtocol?: string;
  /**
   * `?mbdBackend=<绝对地址>` 能把整个 MBD 通道指向任意主机（含外网），生产环境等于
   * 一条开放重定向式的取数口子。缺省 **false（收紧）**：只有调用方显式判定为开发
   * 构建、或构建期明确放开（`VITE_MBD_ALLOW_QUERY_BACKEND=1`，离线包自建 MBD 服务
   * 时用）才生效。
   */
  allowQueryBackendOverride?: boolean;
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
  if (queryBase && options.allowQueryBackendOverride === true) return queryBase;

  const port = params.get('mbdBackendPort')?.trim() || '';
  if (/^\d+$/.test(port)) {
    const protocol = options.browserProtocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${options.browserHostname}:${port}`;
  }

  return normalizeHttpBase(options.envBase);
}

/**
 * `?mbdBackend` 的放行条件：开发构建，或构建期显式打开（离线包里前置一个独立的
 * MBD 服务时会用）。两者都不满足时该参数被忽略，只能靠 `VITE_MBD_API_BASE_URL`。
 */
function isQueryBackendOverrideAllowed(): boolean {
  const env = import.meta.env as unknown as {
    DEV?: boolean;
    VITE_MBD_ALLOW_QUERY_BACKEND?: string;
  };
  return env.DEV === true || env.VITE_MBD_ALLOW_QUERY_BACKEND === '1';
}

let warnedIgnoredBackendOverride = false;

function getMbdApiBaseUrl(): string {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const allowQueryBackendOverride = isQueryBackendOverrideAllowed();
  if (!allowQueryBackendOverride
    && !warnedIgnoredBackendOverride
    && new URLSearchParams(search).has('mbdBackend')) {
    warnedIgnoredBackendOverride = true;
    console.warn(
      '[mbd-v2] ?mbdBackend 仅开发构建（或 VITE_MBD_ALLOW_QUERY_BACKEND=1）生效，已忽略；'
        + '请改用 VITE_MBD_API_BASE_URL 配置 MBD 服务地址',
    );
  }
  return resolveMbdApiBaseUrl({
    search,
    envBase: (import.meta.env as unknown as { VITE_MBD_API_BASE_URL?: string })
      .VITE_MBD_API_BASE_URL,
    browserHostname: typeof window === 'undefined' ? 'localhost' : window.location.hostname,
    browserProtocol: typeof window === 'undefined' ? 'http:' : window.location.protocol,
    allowQueryBackendOverride,
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

/** MBD V2 取数通道的资源护栏：单次请求超时、响应体上限（导出便于测试引用）。 */
export const MBD_FETCH_TIMEOUT_MS = 15_000;
export const MBD_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Live MBD V2 channel: fetch one branch's MbdV2PipeData by refno from
 * plant-web-server. HTTP status and contract-shape problems come back as an
 * `ok: false` parse result; transport failures reject like any fetch.
 *
 * 两道护栏：
 * - 超时：`MBD_FETCH_TIMEOUT_MS` 内整条请求不 settle 就内部 abort，收敛成
 *   `ok: false`（中文原因），不把裸 AbortError 抛给调用方；
 * - 体积：2xx 后先看 `Content-Length`，超 `MBD_RESPONSE_MAX_BYTES` 直接拒收
 *   不读正文；header 缺失（chunked）或不可解析时放行。
 * 调用方 `options.signal` 主动取消不在护栏范围：原样抛出 AbortError。
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

  // 内部 AbortController 汇流两路取消：超时定时器与调用方 signal 都能中断 fetch；
  // guardPromise 与 load() 赛跑，保证被 mock 成永不 settle 的 fetch 也会被截断。
  // timedOut 区分 abort 来源：超时是通道自己的失败 → ok:false；
  // 调用方主动取消 → 保留 AbortError 语义原样抛出。
  const controller = new AbortController();
  const callerSignal = options.signal;
  let timedOut = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let onCallerAbort: () => void = () => {};
  const guardPromise = new Promise<never>((_resolve, reject) => {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`MBD V2 API 请求超时（${MBD_FETCH_TIMEOUT_MS / 1000} 秒）`));
    }, MBD_FETCH_TIMEOUT_MS);
    onCallerAbort = () => {
      controller.abort(callerSignal?.reason);
      reject(
        callerSignal?.reason ?? new DOMException('This operation was aborted', 'AbortError'),
      );
    };
  });
  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  }

  const load = async (): Promise<MbdV2ParseResult> => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        // 正文读不出来就只剩状态码，照旧兜底
      }
      return { ok: false, error: describeMbdV2HttpFailure(response.status, bodyText) };
    }
    // 体积护栏：能解析出 Content-Length 且超限就直接拒收，不读正文；
    // header 缺失（chunked 传输）或不可解析时放行，照常走 parseJsonResponse。
    const contentLengthHeader = response.headers.get('content-length');
    const declaredBytes = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > MBD_RESPONSE_MAX_BYTES) {
      return {
        ok: false,
        error: `MBD V2 API 响应过大：${declaredBytes} 字节，超过上限 ${MBD_RESPONSE_MAX_BYTES} 字节`,
      };
    }
    const payload = await parseJsonResponse<unknown>(response, url);
    return parseMbdV2PipeData(payload);
  };

  try {
    return await Promise.race([load(), guardPromise]);
  } catch (error) {
    if (timedOut) {
      return {
        ok: false,
        error: `MBD V2 API 请求超时（${MBD_FETCH_TIMEOUT_MS / 1000} 秒）：${url}`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}
