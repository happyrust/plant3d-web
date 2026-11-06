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

/** `partial` 只放宽「不认识的图元 kind」一件事（面板「允许部分显示」）。 */
export type MbdV2FetchOptions = Readonly<{ signal?: AbortSignal; partial?: boolean }>;

/**
 * 一次受护栏请求的结局：拿到了契约解析结果（超时、超限、契约错误也在这里，是 `ok: false`），
 * 或者是一个非 2xx 答复——状态码与正文原样交回，由调用方决定怎么报、要不要换端点再试。
 */
type MbdV2GuardedOutcome =
  | Readonly<{ kind: 'result'; result: MbdV2ParseResult }>
  | Readonly<{ kind: 'http_error'; status: number; bodyText: string }>;

function mbdV2Path(route: 'pipe' | 'object', refno: string): string {
  return `/api/mbd/v2/${route}/${encodeURIComponent(refno)}`;
}

/**
 * 管道端点与通用端点共用的单次取数。两道护栏：
 * - 超时：`MBD_FETCH_TIMEOUT_MS` 内整条请求不 settle 就内部 abort，收敛成
 *   `ok: false`（中文原因），不把裸 AbortError 抛给调用方；
 * - 体积：2xx 后先看 `Content-Length`，超 `MBD_RESPONSE_MAX_BYTES` 直接拒收
 *   不读正文；header 缺失（chunked）或不可解析时放行。
 * 调用方 `options.signal` 主动取消不在护栏范围：原样抛出 AbortError。
 */
async function fetchMbdV2Guarded(
  path: string,
  options: MbdV2FetchOptions,
): Promise<MbdV2GuardedOutcome> {
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

  const load = async (): Promise<MbdV2GuardedOutcome> => {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        // 正文读不出来就只剩状态码，照旧兜底
      }
      return { kind: 'http_error', status: response.status, bodyText };
    }
    // 体积护栏：能解析出 Content-Length 且超限就直接拒收，不读正文；
    // header 缺失（chunked 传输）或不可解析时放行，照常走 parseJsonResponse。
    const contentLengthHeader = response.headers.get('content-length');
    const declaredBytes = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > MBD_RESPONSE_MAX_BYTES) {
      return {
        kind: 'result',
        result: {
          ok: false,
          error: `MBD V2 API 响应过大：${declaredBytes} 字节，超过上限 ${MBD_RESPONSE_MAX_BYTES} 字节`,
        },
      };
    }
    const payload = await parseJsonResponse<unknown>(response, url);
    return { kind: 'result', result: parseMbdV2PipeData(payload, { partial: options.partial === true }) };
  };

  try {
    return await Promise.race([load(), guardPromise]);
  } catch (error) {
    if (timedOut) {
      return {
        kind: 'result',
        result: {
          ok: false,
          error: `MBD V2 API 请求超时（${MBD_FETCH_TIMEOUT_MS / 1000} 秒）：${url}`,
        },
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

function toParseResult(outcome: MbdV2GuardedOutcome): MbdV2ParseResult {
  return outcome.kind === 'result'
    ? outcome.result
    : { ok: false, error: describeMbdV2HttpFailure(outcome.status, outcome.bodyText) };
}

/**
 * Live MBD V2 channel: fetch one branch's MbdV2PipeData by refno from
 * plant-web-server. HTTP status and contract-shape problems come back as an
 * `ok: false` parse result; transport failures reject like any fetch.
 * 护栏（超时、体积、调用方取消原样抛出）见 {@link fetchMbdV2Guarded}。
 */
export async function fetchMbdV2PipeData(
  refno: string,
  options: MbdV2FetchOptions = {},
): Promise<MbdV2ParseResult> {
  const normalized = refno.trim();
  if (!normalized) {
    return { ok: false, error: 'MBD V2 refno must not be empty' };
  }
  return toParseResult(await fetchMbdV2Guarded(mbdV2Path('pipe', normalized), options));
}

/**
 * 正文是不是后端的错误信封（`web_service::mbd::api_error` 的 `{ code, message, detail }`）：
 * 能解析成 JSON 对象，且带非空字符串 `code` 或 `message`。这种答复出自 MBD 处理函数本身，
 * 它的 404 是「库里没有这个对象」这样的真结论，不是路由不存在。
 */
function isMbdV2ErrorEnvelope(bodyText: string): boolean {
  const text = bodyText.trim();
  if (!text) return false;
  try {
    const envelope = JSON.parse(text) as unknown;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
    const { code, message } = envelope as { code?: unknown; message?: unknown };
    return (typeof code === 'string' && code.trim() !== '')
      || (typeof message === 'string' && message.trim() !== '');
  } catch {
    return false;
  }
}

export const MBD_OBJECT_ROUTE_FALLBACK_NOTE =
  '后端未部署通用端点 /api/mbd/v2/object（404 且正文不是错误信封），已改走管道端点 /api/mbd/v2/pipe';

/**
 * 按对象取 MBD V2 数据（#103 M7）：`GET /api/mbd/v2/object/{refno}`。服务端按项目配置判定
 * 标注类型（管道 / 支架 / 设备 / 土建 / 建筑），负载形状同管道包，另带 `annotation_type` 与
 * `subject`；标不了的对象回 422 `not_annotatable`，信封里那句话照常透给面板。护栏与
 * {@link fetchMbdV2PipeData} 相同。
 *
 * 灰度回退：通用端点答 404 且正文**不是**错误信封（axum 未知路由的 404 正文为空，前置代理的
 * 404 页同理），说明后端还是只有 `/pipe` 的版本——改用 `/pipe/{refno}` 重试一次，成功时在
 * `meta.notes` 记一句 {@link MBD_OBJECT_ROUTE_FALLBACK_NOTE}，失败时把它接在原因后面（不然
 * 一台设备在老后端上拿到「不是派生隐式管身的路由容器」会被当成数据问题）。正文是信封的 404
 * （`not_found`）与其它状态码都不回退。
 */
export async function fetchMbdV2ObjectData(
  refno: string,
  options: MbdV2FetchOptions = {},
): Promise<MbdV2ParseResult> {
  const normalized = refno.trim();
  if (!normalized) {
    return { ok: false, error: 'MBD V2 refno must not be empty' };
  }
  const outcome = await fetchMbdV2Guarded(mbdV2Path('object', normalized), options);
  if (outcome.kind !== 'http_error'
    || outcome.status !== 404
    || isMbdV2ErrorEnvelope(outcome.bodyText)) {
    return toParseResult(outcome);
  }
  const fallback = toParseResult(await fetchMbdV2Guarded(mbdV2Path('pipe', normalized), options));
  if (!fallback.ok) {
    return { ok: false, error: `${fallback.error}；${MBD_OBJECT_ROUTE_FALLBACK_NOTE}` };
  }
  const { meta } = fallback.data;
  return {
    ...fallback,
    data: {
      ...fallback.data,
      meta: { ...meta, notes: [...meta.notes, MBD_OBJECT_ROUTE_FALLBACK_NOTE] },
    },
  };
}
