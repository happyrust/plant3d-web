/**
 * `HISTORY_BUSY` 有界重试（spec `model-version-timeline-scrub` design §2.10）。
 * 游标请求（Requirement 3.16）与子树请求（Requirement 9.10）共用；预取遇忙不在这里处理（Requirement 4.11）。
 */
import { HistoryQueryError } from '@/model-source/modelVersionErrors';

export type BusyRetryOptions = {
  /** 首次之后最多再调几次 `run`，缺省 3（合计 ≤ 4 次）。 */
  maxRetries?: number;
  /** 等待；signal 触发时 reject AbortError。缺省为可被 signal 中断的 setTimeout，测试注入假时钟。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  /** 每次准备重发前询问；返回 false 时以最后一次 HISTORY_BUSY 结束。 */
  shouldRetry?: () => boolean;
  /** 进入等待前回调（attempt 从 1 起，表示第几次重发），角标保持「正在加载」用。 */
  onWait?: (attempt: number, delayMs: number) => void;
};

const MIN_RETRY_AFTER_SECS = 1;
const MAX_RETRY_AFTER_SECS = 5;

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

function isBusy(err: unknown): err is HistoryQueryError {
  return err instanceof HistoryQueryError && err.code === 'HISTORY_BUSY';
}

/** `Retry-After` 秒钳到 [1, 5] 后 ×1000；缺头（或非有限数）按 1 s。 */
export function retryAfterMs(err: HistoryQueryError): number {
  const raw = err.retryAfterMs;
  if (raw === undefined || !Number.isFinite(raw)) return MIN_RETRY_AFTER_SECS * 1000;
  const secs = Math.min(MAX_RETRY_AFTER_SECS, Math.max(MIN_RETRY_AFTER_SECS, raw / 1000));
  return secs * 1000;
}

/** 缺省 sleep：setTimeout，signal 触发时清掉定时器并 reject AbortError。 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 让 `p` 与 signal 赛跑：signal 先触发则立即以 AbortError 结束。 */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? abortError() : e);
      },
    );
  });
}

/**
 * 首次调用 `run`；遇 `HistoryQueryError(code = 'HISTORY_BUSY')` 按 `retryAfterMs` 等待后重发，最多再调 `maxRetries` 次。
 * 用尽或 `shouldRetry()` 返回 false 时抛出最后一次 `HISTORY_BUSY`；其他错误与成功原样返回；
 * `signal` 在请求或等待中触发时以 `AbortError` 结束，之后不再调用 `run`。
 */
export async function retryOnBusy<T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts: BusyRetryOptions,
): Promise<T> {
  const { signal, shouldRetry, onWait } = opts;
  const maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? 3));
  const sleep = opts.sleep ?? abortableSleep;

  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) throw abortError();
    try {
      return await raceAbort(run(signal), signal);
    } catch (err) {
      if (!isBusy(err)) throw err;
      if (attempt >= maxRetries) throw err;
      if (shouldRetry && !shouldRetry()) throw err;
      const delayMs = retryAfterMs(err);
      onWait?.(attempt + 1, delayMs);
      await raceAbort(sleep(delayMs, signal), signal);
    }
  }
}
