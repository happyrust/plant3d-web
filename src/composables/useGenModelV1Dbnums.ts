/**
 * `GET /api/v1/dbnums` 的进程内共享缓存。
 *
 * 首屏有两处要同一份数据：`useDbMetaInfo`（`ref0s` → ref0→dbnum，P3-g）与树顶徽标的库三态（`model_verdict`，P5）。
 * 这个请求在服务端要扫全部库文件，实测 1.3–30 s，是 v1 首屏最慢的一段（plan §8.8 观察）——两处各打一次纯属浪费。
 * 这里合成一次：在飞的共用、拉回来的按 base URL 缓存一段新鲜度窗口；要最新就 `force`。
 *
 * 只是缓存，不是 store：不带 Vue 响应式，谁要展示谁自己存。
 */
import { genModelV1Dbnums, type DbnumsResponse, type GenModelV1RequestOptions } from '@/api/genModelV1Api';
import { getGenModelV1BaseUrl } from '@/utils/apiBase';

/** 缓存的缺省新鲜度：库三态 5 分钟看一次就够（d-594：`not_judged` 只是陈述，不需要秒级） */
export const DBNUMS_DEFAULT_MAX_AGE_MS = 5 * 60_000;

export type GetDbnumsOptions = Pick<GenModelV1RequestOptions, 'timeoutMs' | 'signal'> & {
  /** 缓存不超过这个年龄就直接回（缺省 `DBNUMS_DEFAULT_MAX_AGE_MS`）；`0` = 总是重拉（在飞的仍共用） */
  maxAgeMs?: number;
  /** 忽略缓存重拉（在飞的仍共用：它拉回来的就是最新的） */
  force?: boolean;
  /** 测试注入 */
  now?: () => number;
  fetcher?: typeof genModelV1Dbnums;
};

type CacheEntry = { baseUrl: string; fetchedAt: number; response: DbnumsResponse };

let cached: CacheEntry | null = null;
let inflight: { baseUrl: string; promise: Promise<DbnumsResponse> } | null = null;

export async function getGenModelV1Dbnums(options: GetDbnumsOptions = {}): Promise<DbnumsResponse> {
  const baseUrl = getGenModelV1BaseUrl();
  const now = options.now ? options.now() : Date.now();
  const maxAgeMs = options.maxAgeMs ?? DBNUMS_DEFAULT_MAX_AGE_MS;
  if (!options.force && cached && cached.baseUrl === baseUrl && now - cached.fetchedAt < maxAgeMs) {
    return cached.response;
  }
  if (inflight && inflight.baseUrl === baseUrl) return inflight.promise;

  const fetcher = options.fetcher ?? genModelV1Dbnums;
  const promise = fetcher({ timeoutMs: options.timeoutMs ?? 60_000, signal: options.signal })
    .then((response) => {
      cached = { baseUrl, fetchedAt: options.now ? options.now() : Date.now(), response };
      return response;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { baseUrl, promise };
  return promise;
}

/** 缓存里现成的那份（不发请求）；没有或 base URL 换了就 null。 */
export function peekGenModelV1Dbnums(): { fetchedAt: number; response: DbnumsResponse } | null {
  if (!cached || cached.baseUrl !== getGenModelV1BaseUrl()) return null;
  return { fetchedAt: cached.fetchedAt, response: cached.response };
}

/** 测试用。 */
export function __resetGenModelV1DbnumsForTests(): void {
  cached = null;
  inflight = null;
}
