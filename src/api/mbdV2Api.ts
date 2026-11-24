import type { MbdV2Issue, MbdV2ParseResult } from '@/dimension';

import {
  lookupMbdRuleWording,
  parseMbdV2Issue,
  parseMbdV2PipeData,
} from '@/dimension';
import { buildBackendUrl } from '@/utils/apiBase';
import { parseJsonText } from '@/utils/fileValidation';

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
const ENGLISH_ROOT_ERROR_PHRASES: readonly Readonly<[string, string]>[] = [
  ['every branch member was skipped for missing geometry', '这条支管下的管件都缺少可用几何，已全部跳过'],
  ['the branch has no members and no tube between its head and tail: there is nothing to dimension', '这条支管下面没有管件，首尾之间也没有隐含直管，没有可标注的内容'],
  ['branch has neither HPOS/HDIR nor a member arrive port to seed Head', '这条支管既没有首端坐标与方向（HPOS / HDIR），也没有带到达端口的管件，定不出起点（Head）'],
  ['branch has no members; nothing to split', '这条支管下面没有任何管件，没有可标注的内容'],
];

function extractEnvelopeIssues(detail: unknown): readonly MbdV2Issue[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const rawIssues = (detail as { issues?: unknown }).issues;
  if (!Array.isArray(rawIssues)) return [];
  return rawIssues
    .map(item => parseMbdV2Issue(item))
    .filter((item): item is MbdV2Issue => item !== null);
}

function localizeMbdEnvelopeMessage(
  code: string | undefined,
  rawMessage: string,
  issues: readonly MbdV2Issue[],
): string {
  const trimmed = rawMessage.trim();
  // 「不可标注」已经是完整中文，原样保留不变（#135）
  if (code === 'not_annotatable') return trimmed;

  let localized = trimmed;
  for (const issue of issues) {
    if (!issue.message.trim()) continue;
    const wording = lookupMbdRuleWording(issue.rule_id);
    if (wording?.text) {
      const cleanCn = wording.text.replace(/[。.]$/, '');
      localized = localized.split(issue.message.trim()).join(cleanCn);
    }
  }
  for (const [en, cn] of ENGLISH_ROOT_ERROR_PHRASES) {
    if (localized.includes(en)) {
      localized = localized.split(en).join(cn);
    }
  }
  return localized;
}

export function describeMbdV2HttpFailure(status: number, bodyText: string): string {
  const text = bodyText.trim();
  if (text) {
    try {
      const envelope = JSON.parse(text) as unknown;
      if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
        const { code, message, detail } = envelope as {
          code?: unknown;
          message?: unknown;
          detail?: unknown;
        };
        if (typeof message === 'string' && message.trim()) {
          const issues = extractEnvelopeIssues(detail);
          return localizeMbdEnvelopeMessage(
            typeof code === 'string' ? code : undefined,
            message,
            issues,
          );
        }
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
export const MBD_BATCH_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
export const MBD_BATCH_MAX_SIZE = 128;
export const MBD_SOURCE_CHANGED_MAX_RETRIES = 2;
const MBD_SOURCE_CHANGED_DEFAULT_RETRY_MS = 1_000;
const MBD_SOURCE_CHANGED_MIN_RETRY_MS = 500;
const MBD_SOURCE_CHANGED_MAX_RETRY_MS = 5_000;
const MBD_BATCH_FALLBACK_CONCURRENCY = 4;

/** `partial` 只放宽「不认识的图元 kind」一件事（面板「允许部分显示」）。 */
export type MbdV2FetchOptions = Readonly<{ signal?: AbortSignal; partial?: boolean }>;

/**
 * 一次受护栏请求的结局：拿到了契约解析结果（超时、超限、契约错误也在这里，是 `ok: false`），
 * 或者是一个非 2xx 答复——状态码与正文原样交回，由调用方决定怎么报、要不要换端点再试。
 */
type MbdV2GuardedOutcome =
  | Readonly<{ kind: 'result'; result: MbdV2ParseResult }>
  | Readonly<{ kind: 'http_error'; status: number; bodyText: string; retryAfterHeader: string | null }>;

type MbdV2RawJsonOutcome =
  | Readonly<{ kind: 'json'; payload: unknown }>
  | Readonly<{ kind: 'too_large'; bytes: number; maxBytes: number }>
  | Readonly<{ kind: 'timeout'; url: string }>
  | Readonly<{ kind: 'http_error'; status: number; bodyText: string; retryAfterHeader: string | null }>;

function mbdV2Path(route: 'pipe' | 'object', refno: string): string {
  return `/api/mbd/v2/${route}/${encodeURIComponent(refno)}`;
}

function mbdV2BatchPath(): string {
  return '/api/mbd/v2/objects';
}

function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return MBD_SOURCE_CHANGED_DEFAULT_RETRY_MS;
  const seconds = Number(headerValue.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return MBD_SOURCE_CHANGED_DEFAULT_RETRY_MS;
  const ms = Math.round(seconds * 1000);
  return Math.min(MBD_SOURCE_CHANGED_MAX_RETRY_MS, Math.max(MBD_SOURCE_CHANGED_MIN_RETRY_MS, ms));
}

function isSourceChangedHttpError(status: number, bodyText: string): boolean {
  if (status !== 503) return false;
  const trimmed = bodyText.trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Boolean(
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && (parsed as { code?: unknown }).code === 'SOURCE_CHANGED',
    );
  } catch {
    return false;
  }
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException('This operation was aborted', 'AbortError');
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError(signal.reason));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<Readonly<{ ok: true; text: string } | { ok: false; bytes: number }>> {
  const contentLengthHeader = response.headers?.get?.('content-length') ?? null;
  const declaredBytes = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    return { ok: false, bytes: declaredBytes };
  }

  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let totalBytes = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => {});
            return { ok: false, bytes: totalBytes };
          }
          text += decoder.decode(value, { stream: true });
        }
      }
      text += decoder.decode();
      return { ok: true, text };
    } finally {
      reader.releaseLock();
    }
  }

  const text = await response.text();
  const actualBytes = new TextEncoder().encode(text).byteLength;
  if (actualBytes > maxBytes) {
    return { ok: false, bytes: actualBytes };
  }
  return { ok: true, text };
}

/**
 * 管道端点、通用端点与批量端点共用的受护栏 HTTP JSON 请求：
 * - 超时：`MBD_FETCH_TIMEOUT_MS` 内未完成则内部 abort 并返回 `timeout`；
 * - 体积：先验 `Content-Length`，再用流式 `getReader()` 累加字节数，chunked 缺头时同样截断；
 * - 调用方 `options.signal` 主动取消时原样抛出 AbortError。
 */
async function fetchMbdV2JsonOnce(
  path: string,
  init: RequestInit,
  maxBytes: number,
  options: MbdV2FetchOptions,
): Promise<MbdV2RawJsonOutcome> {
  const mbdApiBase = getMbdApiBaseUrl();
  const url = mbdApiBase ? `${mbdApiBase}${path}` : buildBackendUrl(path);

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
      reject(createAbortError(callerSignal?.reason));
    };
  });
  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  }

  const load = async (): Promise<MbdV2RawJsonOutcome> => {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        // 正文读不出来就只剩状态码，照旧兜底
      }
      return {
        kind: 'http_error',
        status: response.status,
        bodyText,
        retryAfterHeader: response.headers?.get?.('retry-after') ?? null,
      };
    }
    const bounded = await readBoundedResponseText(response, maxBytes);
    if (!bounded.ok) {
      return { kind: 'too_large', bytes: bounded.bytes, maxBytes };
    }
    const payload = parseJsonText<unknown>(bounded.text, {
      source: url,
      expectedRoot: 'object-or-array',
    });
    return { kind: 'json', payload };
  };

  try {
    return await Promise.race([load(), guardPromise]);
  } catch (error) {
    if (timedOut) {
      return { kind: 'timeout', url };
    }
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * 管道端点与通用端点共用的单次取数（含 `503 SOURCE_CHANGED` 自动退避重拉最多 2 次）。
 */
async function fetchMbdV2Guarded(
  path: string,
  options: MbdV2FetchOptions,
): Promise<MbdV2GuardedOutcome> {
  for (let attempt = 0; attempt <= MBD_SOURCE_CHANGED_MAX_RETRIES; attempt += 1) {
    const raw = await fetchMbdV2JsonOnce(path, {}, MBD_RESPONSE_MAX_BYTES, options);
    if (raw.kind === 'http_error') {
      if (attempt < MBD_SOURCE_CHANGED_MAX_RETRIES
        && isSourceChangedHttpError(raw.status, raw.bodyText)) {
        await waitWithAbort(parseRetryAfterMs(raw.retryAfterHeader), options.signal);
        continue;
      }
      return raw;
    }
    if (raw.kind === 'too_large') {
      return {
        kind: 'result',
        result: {
          ok: false,
          error: `MBD V2 API 响应过大：${raw.bytes} 字节，超过上限 ${raw.maxBytes} 字节`,
        },
      };
    }
    if (raw.kind === 'timeout') {
      return {
        kind: 'result',
        result: {
          ok: false,
          error: `MBD V2 API 请求超时（${MBD_FETCH_TIMEOUT_MS / 1000} 秒）：${raw.url}`,
        },
      };
    }
    return {
      kind: 'result',
      result: parseMbdV2PipeData(raw.payload, { partial: options.partial === true }),
    };
  }
  return {
    kind: 'result',
    result: { ok: false, error: 'MBD V2 API 重试次数已用尽' },
  };
}

function toParseResult(outcome: MbdV2GuardedOutcome): MbdV2ParseResult {
  if (outcome.kind === 'result') return outcome.result;
  let issues: readonly MbdV2Issue[] = [];
  let notFound = false;
  const trimmed = outcome.bodyText.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const env = parsed as { code?: unknown; detail?: unknown };
        issues = extractEnvelopeIssues(env.detail);
        notFound = outcome.status === 404 && env.code === 'not_found';
      }
    } catch {
      // ignore
    }
  }
  const result: MbdV2ParseResult = {
    ok: false,
    error: describeMbdV2HttpFailure(outcome.status, outcome.bodyText),
    ...(issues.length > 0 ? { issues } : {}),
  };
  if (notFound) {
    Object.defineProperty(result, 'notFound', { value: true, enumerable: false });
  }
  return result;
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

export const MBD_BATCH_ROUTE_FALLBACK_NOTE =
  '后端未部署批量端点 /api/mbd/v2/objects（404/405 且正文不是错误信封），已改走逐对象端点 /api/mbd/v2/object';

export type MbdV2BatchFetchResult = Readonly<{
  results: readonly MbdV2ParseResult[];
  fallbackNote?: string;
}>;

const batchUnsupportedBases = new Set<string>();

/** 仅供测试重置批量端点降级记忆。 */
export function resetMbdBatchFallbackCacheForTests(): void {
  batchUnsupportedBases.clear();
}

function batchBaseCacheKey(): string {
  return getMbdApiBaseUrl() || '__default__';
}

async function fetchObjectsFallbackPool(
  refnos: readonly string[],
  options: MbdV2FetchOptions,
): Promise<readonly MbdV2ParseResult[]> {
  const results = new Array<MbdV2ParseResult>(refnos.length);
  let nextIndex = 0;
  const workerCount = Math.min(MBD_BATCH_FALLBACK_CONCURRENCY, refnos.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < refnos.length) {
      if (options.signal?.aborted) {
        throw createAbortError(options.signal.reason);
      }
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fetchMbdV2ObjectData(refnos[index]!, options);
    }
  });
  await Promise.all(workers);
  return results;
}

function batchErrorItemToParseResult(
  status: number,
  code: string | undefined,
  message: string | undefined,
  detail: unknown,
): MbdV2ParseResult {
  const bodyText = JSON.stringify({
    ...(code !== undefined ? { code } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(detail !== undefined ? { detail } : {}),
  });
  return toParseResult({
    kind: 'http_error',
    status,
    bodyText,
    retryAfterHeader: null,
  });
}

/**
 * 批量按对象取 MBD V2 数据：`POST /api/mbd/v2/objects`（按 128 分块），
 * 返回与入参 `refnos` 一一对应且保序的 `MbdV2ParseResult[]`。
 *
 * - 单对象直接走 `fetchMbdV2ObjectData`；
 * - 若服务端回 404/405 且正文不是错误信封，按当前基址记下不支持标记并透明回退并发 `GET /object/{refno}`；
 * - 批量单条遇 `503 SOURCE_CHANGED` 时，单独走 `fetchMbdV2ObjectData` 自动退避重拉。
 */
export async function fetchMbdV2ObjectsData(
  refnos: readonly string[],
  options: MbdV2FetchOptions = {},
): Promise<MbdV2BatchFetchResult> {
  if (refnos.length === 0) return { results: [] };
  if (refnos.length === 1) {
    return { results: [await fetchMbdV2ObjectData(refnos[0]!, options)] };
  }

  const baseKey = batchBaseCacheKey();
  if (batchUnsupportedBases.has(baseKey)) {
    return {
      results: await fetchObjectsFallbackPool(refnos, options),
      fallbackNote: MBD_BATCH_ROUTE_FALLBACK_NOTE,
    };
  }

  const results: MbdV2ParseResult[] = [];
  for (let offset = 0; offset < refnos.length; offset += MBD_BATCH_MAX_SIZE) {
    const chunk = refnos.slice(offset, offset + MBD_BATCH_MAX_SIZE);
    const raw = await fetchMbdV2JsonOnce(
      mbdV2BatchPath(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refnos: chunk }),
      },
      MBD_BATCH_RESPONSE_MAX_BYTES,
      options,
    );

    if (raw.kind === 'http_error') {
      if ((raw.status === 404 || raw.status === 405) && !isMbdV2ErrorEnvelope(raw.bodyText)) {
        batchUnsupportedBases.add(baseKey);
        const remaining = refnos.slice(offset);
        const fallbackResults = await fetchObjectsFallbackPool(remaining, options);
        return {
          results: [...results, ...fallbackResults],
          fallbackNote: MBD_BATCH_ROUTE_FALLBACK_NOTE,
        };
      }
      const chunkError = toParseResult(raw);
      for (let i = 0; i < chunk.length; i += 1) {
        results.push(chunkError);
      }
      continue;
    }

    if (raw.kind === 'too_large') {
      const err: MbdV2ParseResult = {
        ok: false,
        error: `MBD V2 批量响应过大：${raw.bytes} 字节，超过上限 ${raw.maxBytes} 字节`,
      };
      for (let i = 0; i < chunk.length; i += 1) results.push(err);
      continue;
    }

    if (raw.kind === 'timeout') {
      const err: MbdV2ParseResult = {
        ok: false,
        error: `MBD V2 API 请求超时（${MBD_FETCH_TIMEOUT_MS / 1000} 秒）：${raw.url}`,
      };
      for (let i = 0; i < chunk.length; i += 1) results.push(err);
      continue;
    }

    const body = raw.payload as { items?: unknown };
    if (!body || typeof body !== 'object' || !Array.isArray(body.items) || body.items.length !== chunk.length) {
      const err: MbdV2ParseResult = {
        ok: false,
        error: 'MBD V2 批量响应格式无效：缺少与请求等长的 items 数组',
      };
      for (let i = 0; i < chunk.length; i += 1) results.push(err);
      continue;
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const item = body.items[i] as {
        ok?: unknown;
        data?: unknown;
        status?: unknown;
        code?: unknown;
        message?: unknown;
        detail?: unknown;
      } | null;
      if (!item || typeof item !== 'object') {
        results.push({ ok: false, error: 'MBD V2 批量响应条目格式无效' });
        continue;
      }
      if (item.ok === true) {
        results.push(parseMbdV2PipeData(item.data, { partial: options.partial === true }));
        continue;
      }
      const status = typeof item.status === 'number' ? item.status : 500;
      const code = typeof item.code === 'string' ? item.code : undefined;
      if (status === 503 && code === 'SOURCE_CHANGED') {
        await waitWithAbort(MBD_SOURCE_CHANGED_DEFAULT_RETRY_MS, options.signal);
        results.push(await fetchMbdV2ObjectData(chunk[i]!, options));
        continue;
      }
      results.push(batchErrorItemToParseResult(
        status,
        code,
        typeof item.message === 'string' ? item.message : undefined,
        item.detail,
      ));
    }
  }

  return { results };
}
