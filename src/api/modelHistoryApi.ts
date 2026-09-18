/**
 * 模型历史查询只读 API 封装：legacy 后端 `/api/model-history/*`（会话锚点 / 元素属性快照）。
 *
 * 2026-09-18 之前它与 `/api/model-version/*`（发布版本家族）合在 `modelVersionApi.ts` 里；release 线放弃后
 * （ADR 0045 / 0065，`docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` §1.2）
 * 那一半连同类型删除，这里只剩历史家族。当前唯一消费者是 `ModelTreeAttrDiffPanel`（属性历史对比）。
 *
 * 响应包装：成功 `{ ok: true, data }`；失败 `{ ok: false, error: { code, message } }`。
 *
 * 错误分类：
 * - `ExpiredError`：HTTP 410 / code `Expired`（snapshot 历史过期）。
 * - `AnchorMissingError`：HTTP 404 / code `AnchorMissing`（resolve-anchor 未命中）。
 * - 其余为 `ModelHistoryApiError`。
 *
 * 本模块只做只读 GET 封装，不新增任何后端写路径调用。
 */

import { buildBackendUrl } from '@/utils/apiBase';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** rs-core version_query::AnchorHit */
export type ModelHistoryAnchor = {
  dbnum: number;
  sesno: number;
  anchored_at?: string;
  source?: string | null;
  /** resolve-anchor：true=精确命中请求 sesno，false=回退到最近不大于的锚点 */
  exact?: boolean;
  [key: string]: unknown;
};

export type ModelHistoryAnchorList = {
  dbnum: number;
  count: number;
  anchors: ModelHistoryAnchor[];
};

/** 元素级历史快照（snapshot_at 返回值，结构以后端为准）。 */
export type ModelHistorySnapshot = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------

export class ModelHistoryApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ModelHistoryApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** 历史快照过期（HTTP 410 / code `Expired`），调用方走「历史已过期」降级。 */
export class ExpiredError extends ModelHistoryApiError {
  constructor(message: string, status: number, payload?: unknown) {
    super(message, status, payload);
    this.name = 'ExpiredError';
  }
}

/** 锚点缺失（HTTP 404 / code `AnchorMissing`），调用方走「最近锚点」回退。 */
export class AnchorMissingError extends ModelHistoryApiError {
  constructor(message: string, status: number, payload?: unknown) {
    super(message, status, payload);
    this.name = 'AnchorMissingError';
  }
}

// ---------------------------------------------------------------------------
// 请求辅助
// ---------------------------------------------------------------------------

export type RequestOptions = {
  /** 全部请求支持取消 */
  signal?: AbortSignal;
};

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

async function parseJsonPayload(resp: Response): Promise<unknown> {
  try {
    return await resp.json() as unknown;
  } catch (error) {
    // 取消请求时把 AbortError 原样抛出，不吞成"响应不可解析"
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return undefined;
  }
}

async function requestModelHistory<T>(path: string, options?: RequestOptions): Promise<T> {
  const resp = await fetch(buildBackendUrl(path), { signal: options?.signal });
  const payload = await parseJsonPayload(resp);
  const body = payload as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string };
  } | undefined;

  if (resp.ok && body !== undefined && body.ok !== false) {
    return body.data as T;
  }

  const code = body?.error?.code;
  const message = body?.error?.message || `HTTP ${resp.status} ${resp.statusText}`;
  if (resp.status === 410 || code === 'Expired') {
    throw new ExpiredError(message, resp.status, payload);
  }
  if (resp.status === 404 || code === 'AnchorMissing') {
    throw new AnchorMissingError(message, resp.status, payload);
  }
  throw new ModelHistoryApiError(message, resp.status, payload);
}

// ---------------------------------------------------------------------------
// /api/model-history/*
// ---------------------------------------------------------------------------

export async function listAnchors(
  dbnum: number,
  limit?: number,
  options?: RequestOptions,
): Promise<ModelHistoryAnchorList> {
  const data = await requestModelHistory<Partial<ModelHistoryAnchorList>>(
    withQuery('/api/model-history/anchors', { dbnum, limit }),
    options,
  );
  return {
    dbnum: data?.dbnum ?? dbnum,
    count: data?.count ?? (Array.isArray(data?.anchors) ? data.anchors.length : 0),
    anchors: Array.isArray(data?.anchors) ? data.anchors : [],
  };
}

export async function resolveAnchor(
  dbnum: number,
  sesno: number,
  exactOnly?: boolean,
  options?: RequestOptions,
): Promise<ModelHistoryAnchor> {
  return await requestModelHistory<ModelHistoryAnchor>(
    withQuery('/api/model-history/resolve-anchor', {
      dbnum,
      sesno,
      exact_only: exactOnly,
    }),
    options,
  );
}

export async function getSnapshot(
  dbnum: number,
  sesno: number,
  refno: string,
  peKey?: string,
  options?: RequestOptions,
): Promise<ModelHistorySnapshot> {
  return await requestModelHistory<ModelHistorySnapshot>(
    withQuery('/api/model-history/snapshot', {
      dbnum,
      sesno,
      refno,
      pe_key: peKey,
    }),
    options,
  );
}
