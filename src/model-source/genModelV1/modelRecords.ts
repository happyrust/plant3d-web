/**
 * gen-model-v1：「显式显示一个节点」= `model/ensure(force=false)` → 逐生成根分页 `model/records`（D5-A，plan P3-a）。
 *
 * 这一层只负责**把记录收齐**（`GeomInstQuery[]`），不做 `InstanceEntry` 映射（那是 P3-b 的事）。
 * 树的 `visibleInsts`（P2）与视口的几何加载（P3）共用它。
 *
 * 容器语义（plan P3-c / spec §4.5）：
 * - 读透形态的服务端对 SITE/ZONE 会自己解出全部生成根，`generation_roots` 直接给；
 * - 摄入形态回 `422 container`——**不是失败**，这里按契约展开一层、对子节点逐个 ensure，深度与根数都有上限；
 * - `202 generation_pending` / `504 timeout`：后台还在跑，**不重试同一 refno**，把它记进 `pending` 交给调用方；
 * - `404 not_found` / `422 precondition` / `NoRenderableGeometry`：这根没有几何，跳过。
 *
 * 多根批量（收口计划 2026-09-09 P9-3，spec §4.5.2）：一次 ensure 解出的根先切批再取 `records`——同一 Ref0（同库）才同批、
 * 一批 ≤ `recordsBatchSize`（缺省 = 服务端上限 64）、小根集先摊到 `recordsConcurrency` 路上再切（5 根仍是 5 个单根请求）；
 * `recordsConcurrency` 是**同时在飞的批数**。整批失败（旧服务端不认识 `generation_roots`、409 有根未 ensure、5xx、网络）
 * 一律退回逐根，分型与逐根口径一字不差；旧服务端只会被识别一次，此后同一 api 直接逐根。
 */
import {
  fromV1Refno,
  genModelV1ModelEnsure,
  genModelV1ModelRecords,
  genModelV1TreeChildren,
  isGenModelV1ApiError,
  MAX_MODEL_RECORDS_ROOTS,
  type GeomInstQuery,
  type GenModelV1RequestOptions,
  type ModelEnsureResponse,
  type ModelRecordsResponse,
  type TreeChildrenResponse,
} from '@/api/genModelV1Api';
import {
  GenModelV1ServiceGenerationChangedError,
  getGenModelV1ServiceGeneration,
  toGenModelV1CancelledError,
} from '@/model-source/genModelV1/serviceLifecycle';

export type ModelRecordsApi = {
  ensure: typeof genModelV1ModelEnsure;
  records: typeof genModelV1ModelRecords;
  children: typeof genModelV1TreeChildren;
};

export const defaultModelRecordsApi: ModelRecordsApi = {
  ensure: genModelV1ModelEnsure,
  records: genModelV1ModelRecords,
  children: genModelV1TreeChildren,
};

/** 防止异常服务端游标让一次显式显示无限翻页；达到上限仍 truncated 必须按未完成处理。 */
export const MAX_MODEL_RECORD_PAGES = 10_000;

class ModelRecordsPaginationIncompleteError extends Error {
  constructor(scope: string, detail: string) {
    super(`model/records 分页未完成（${scope}）：${detail}`);
    this.name = 'ModelRecordsPaginationIncompleteError';
  }
}

export type EnsureAndCollectOptions = GenModelV1RequestOptions & {
  /** 只给「人明确要求重生成」用（spec §4.5）：显示补齐**不要**传，否则每显示一次都提交新的重生成工作 */
  force?: boolean;
  /** 同一次 ensure 解出多根时，同时在飞的 `records` **批**数（默认 6）；每批最多 `recordsBatchSize` 根 */
  recordsConcurrency?: number;
  /**
   * 一次 `records` 最多打包几根（默认 = 服务端上限 `MAX_MODEL_RECORDS_ROOTS`）。`1` = 逐根旧口径。
   * 实际批大小 = `min(recordsBatchSize, ceil(根数 / recordsConcurrency))`，小根集也摊满并发路、进度也更细。
   */
  recordsBatchSize?: number;
  /** 容器展开的最大层数（默认 3：SITE → ZONE → 生成根一般够了） */
  maxContainerDepth?: number;
  /** 一次调用最多 ensure 多少个根（默认 128）；超出的记进 `truncatedRoots` */
  maxRoots?: number;
  /**
   * 一次调用最多为多少个生成根取 `records`（默认不限）。摄入形态的 SITE 一次 ensure 就能解出几百个根，每根一次 `records`
   * 要 0.5–10 s——整库入口拿它做「安全概览」预算；超出的根记进 `truncatedRoots`，不取。
   */
  maxRecordsRoots?: number;
  /** `model/records` 的页大小（服务端上限 5000） */
  pageSize?: number;
  /** 每处理完一个根回调一次（进度） */
  onRootDone?: (progress: { done: number; total: number; root: string }) => void;
  /** records 发现精确 `not_generated:` 时，在重试 ensure 之前清掉该根的调用方缓存。 */
  onNotGenerated?: (root: string) => void;
  /** 原始请求错误被折叠进结果前的观察器；用于让服务生命周期看见 network 断线。 */
  onRequestFailure?: (error: unknown) => void;
};

export type EnsureAndCollectResult = {
  /** 请求的 refno（`a_b`） */
  refno: string;
  /** 实际走过 ensure 的生成根（`a_b`），含容器展开出来的 */
  generationRoots: string[];
  /** 全部记录（按根去重后拼接） */
  items: GeomInstQuery[];
  /** ensure 回了 `generation_pending` / `timeout` 的根（`a_b`）——几何暂时没有，稍后再问 */
  pending: string[];
  /** 没有几何或不存在的根（`a_b`）：`NoRenderableGeometry` / `not_found` / `precondition` */
  empty: string[];
  /** 因 `maxRoots` / `maxContainerDepth` 没处理到的容器或根（`a_b`） */
  truncatedRoots: string[];
  /** 其它错误（`a_b` → 错误信息），调用方决定要不要报 */
  errors: Record<string, string>;
  /** 各根的 ensure 状态（`a_b` → status） */
  statuses: Record<string, string>;
};

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function reportRequestFailure(observer: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    observer?.(error);
  } catch {
    // 观察器只记生命周期状态，不能改变逐根容错语义。
  }
}

/**
 * 取消 / 服务换代不是「这根出了问题」：不进 `errors`、不当 pending、不退回逐根，整次读取一起停、原样向上抛。
 * `signal.aborted` 也算——假 api 或别的实现未必把取消包成 `cancelled`。
 */
function isReadAborted(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof GenModelV1ServiceGenerationChangedError) return true;
  return isGenModelV1ApiError(error) && error.isCancelled;
}

/** 已取消就别再开下一发请求（真 fetch 会立刻拒，假 api 不会——两边口径一致）。 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw toGenModelV1CancelledError(signal.reason);
}

/** 有界并发的 map，结果按输入顺序回。 */
export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return out;
}

function rootsOf(ensured: ModelEnsureResponse, fallback: string): string[] {
  const roots = Array.isArray(ensured.generation_roots) && ensured.generation_roots.length > 0
    ? ensured.generation_roots
    : ensured.generation_root
      ? [ensured.generation_root]
      : [fallback];
  return roots.map((root) => fromV1Refno(String(root)));
}

async function collectRootRecords(
  api: ModelRecordsApi,
  root: string,
  pageSize: number,
  requestOptions: GenModelV1RequestOptions,
): Promise<GeomInstQuery[]> {
  const out: GeomInstQuery[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < MAX_MODEL_RECORD_PAGES; page++) {
    const resp: ModelRecordsResponse = await api.records({ generationRoot: root, limit: pageSize, cursor }, requestOptions);
    out.push(...resp.items);
    if (!resp.truncated) return out;
    if (resp.next_cursor === null || resp.next_cursor === undefined) {
      throw new ModelRecordsPaginationIncompleteError(root, 'truncated=true 但缺少 next_cursor');
    }
    cursor = resp.next_cursor;
  }
  throw new ModelRecordsPaginationIncompleteError(
    root,
    `达到 ${MAX_MODEL_RECORD_PAGES} 页护栏后仍有下一页（next_cursor=${cursor ?? 'unknown'}）`,
  );
}

/** `a_b` 的 Ref0（`a`）：一个 Ref0 只属一个 dbnum，同 Ref0 的根一定同库（spec §4.5.2 一批须同库）。 */
function ref0Of(root: string): string {
  const at = root.indexOf('_');
  return at > 0 ? root.slice(0, at) : root;
}

/**
 * 把一次 ensure 解出的根切成 `records` 批（导出给单测）：
 * - 同一 Ref0 才同批（同库约束）；批内、批间都保持首次出现的顺序；
 * - 批大小 = `min(batchSize, ceil(根数 / concurrency))`，至少 1——5 根 / 6 路仍是 5 个单根请求，335 根 / 6 路是 6 批各 ≤56，
 *   上千根才顶到 64 一批。
 */
export function planRecordsBatches(roots: string[], batchSize: number, concurrency: number): string[][] {
  if (roots.length === 0) return [];
  const size = Math.max(1, Math.min(Math.floor(batchSize) || 1, Math.ceil(roots.length / Math.max(1, concurrency))));
  const groups = new Map<string, string[]>();
  for (const root of roots) {
    const key = ref0Of(root);
    const group = groups.get(key);
    if (group) group.push(root);
    else groups.set(key, [root]);
  }
  const batches: string[][] = [];
  for (const group of groups.values()) {
    for (let at = 0; at < group.length; at += size) batches.push(group.slice(at, at + size));
  }
  return batches;
}

type BatchRecordsSupport = 'unknown' | 'yes' | 'no';

/** 按 api 对象记「服务端认不认识 `generation_roots`」：生产只有一个 `defaultModelRecordsApi`，测试各造各的假 api 互不影响。 */
let batchRecordsSupportByApi = new WeakMap<ModelRecordsApi, { generation: number; support: BatchRecordsSupport }>();

/** 诊断 / 单测用：这个 api 的服务端对批量 `records` 的已知态。 */
export function batchRecordsSupport(api: ModelRecordsApi = defaultModelRecordsApi): BatchRecordsSupport {
  const remembered = batchRecordsSupportByApi.get(api);
  return remembered?.generation === getGenModelV1ServiceGeneration() ? remembered.support : 'unknown';
}

export function resetBatchRecordsSupport(): void {
  batchRecordsSupportByApi = new WeakMap();
}

/**
 * 旧服务端（如 0.1.21 出厂包）不认识 `generation_roots`：axum 在 JSON 反序列化就拒掉——422 纯文本
 * 「Failed to deserialize the JSON body …: missing field `generation_root`」（没有信封，客户端按状态兜成 `precondition`）；
 * 别的实现也可能是 400「unknown field」。只有这种「字段都没认出来」才算不支持；新服务端对越界 / 跨库 / 重复根回的
 * 400 信封是这批的问题，不是能力问题（照样退回逐根，但不记「不支持」）。
 */
function isBatchRecordsUnsupportedError(error: unknown): boolean {
  if (!isGenModelV1ApiError(error)) return false;
  if (error.status !== 422 && error.status !== 400) return false;
  return /generation_roots?/.test(error.message) && /missing field|unknown field|deserialize/i.test(error.message);
}

/** 一批根一次分页取完，按 `owner`（= 生成根）归到各根名下；`owner` 不在批里的记录不丢，进 `extra`。 */
async function collectBatchRecords(
  api: ModelRecordsApi,
  roots: string[],
  pageSize: number,
  requestOptions: GenModelV1RequestOptions,
): Promise<{ byRoot: Map<string, GeomInstQuery[]>; extra: GeomInstQuery[] }> {
  const byRoot = new Map<string, GeomInstQuery[]>(roots.map((root) => [root, [] as GeomInstQuery[]]));
  const extra: GeomInstQuery[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < MAX_MODEL_RECORD_PAGES; page++) {
    const resp: ModelRecordsResponse = await api.records({ generationRoots: roots, limit: pageSize, cursor }, requestOptions);
    for (const item of resp.items) {
      const bucket = byRoot.get(fromV1Refno(String(item.owner ?? '')));
      if (bucket) bucket.push(item);
      else extra.push(item);
    }
    if (!resp.truncated) return { byRoot, extra };
    if (resp.next_cursor === null || resp.next_cursor === undefined) {
      throw new ModelRecordsPaginationIncompleteError(
        `${roots.length} roots`,
        'truncated=true 但缺少 next_cursor',
      );
    }
    cursor = resp.next_cursor;
  }
  throw new ModelRecordsPaginationIncompleteError(
    `${roots.length} roots`,
    `达到 ${MAX_MODEL_RECORD_PAGES} 页护栏后仍有下一页（next_cursor=${cursor ?? 'unknown'}）`,
  );
}

type RootRecordsOutcome = { root: string; items: GeomInstQuery[]; error: unknown };

export function isNotGeneratedConflict(error: unknown): boolean {
  return (
    isGenModelV1ApiError(error)
    && error.status === 409
    && error.code === 'conflict'
    && error.message.startsWith('not_generated:')
  );
}

async function collectRootRecordsWithRetry(
  api: ModelRecordsApi,
  root: string,
  pageSize: number,
  requestOptions: GenModelV1RequestOptions,
  onNotGenerated?: (root: string) => void,
): Promise<GeomInstQuery[]> {
  try {
    return await collectRootRecords(api, root, pageSize, requestOptions);
  } catch (error) {
    if (!isNotGeneratedConflict(error)) throw error;
    onNotGenerated?.(root);
    await api.ensure({ refno: root }, requestOptions);
    // Exactly one retry. A second conflict escapes to the normal pending classification.
    return collectRootRecords(api, root, pageSize, requestOptions);
  }
}

/**
 * 取一批根的记录：多于一根且服务端没被认定「不支持」就先试批量；整批失败退回逐根（一根一根串行——这一路就是一条并发道），
 * 每根一出结果就 `report` 一次（进度靠它）。逐根的分型（409 → pending、其它 → errors）由调用方按 outcome.error 定，与旧口径相同。
 */
async function collectBatchOrEachRoot(
  api: ModelRecordsApi,
  batch: string[],
  pageSize: number,
  requestOptions: GenModelV1RequestOptions,
  report: (outcome: RootRecordsOutcome) => void,
  onNotGenerated?: (root: string) => void,
  onRequestFailure?: (error: unknown) => void,
): Promise<void> {
  const supportGeneration = getGenModelV1ServiceGeneration();
  if (batch.length > 1 && batchRecordsSupport(api) !== 'no') {
    try {
      const { byRoot, extra } = await collectBatchRecords(api, batch, pageSize, requestOptions);
      if (supportGeneration === getGenModelV1ServiceGeneration()) {
        batchRecordsSupportByApi.set(api, { generation: supportGeneration, support: 'yes' });
      }
      batch.forEach((root, index) => {
        const items = byRoot.get(root) ?? [];
        report({ root, items: index === 0 ? [...items, ...extra] : items, error: null });
      });
      return;
    } catch (error) {
      reportRequestFailure(onRequestFailure, error);
      // 调用方取消 / 服务换代：不是这批的问题，不退回逐根（退了就是取消后还在逐根打请求）
      if (isReadAborted(error, requestOptions.signal)) throw error;
      if (isBatchRecordsUnsupportedError(error) && supportGeneration === getGenModelV1ServiceGeneration()) {
        batchRecordsSupportByApi.set(api, { generation: supportGeneration, support: 'no' });
      }
      // 整批一起失败（409 有根未 ensure、5xx、网络、旧服务端）：退回逐根，一根的问题不拖垮同批其它根
    }
  }
  for (const root of batch) {
    throwIfAborted(requestOptions.signal);
    try {
      report({
        root,
        items: await collectRootRecordsWithRetry(api, root, pageSize, requestOptions, onNotGenerated),
        error: null,
      });
    } catch (error) {
      reportRequestFailure(onRequestFailure, error);
      if (isReadAborted(error, requestOptions.signal)) throw error;
      report({ root, items: [], error });
    }
  }
}

/**
 * 对一个节点做「显式显示」：ensure → records。容器按契约展开一层递归；一切上限都在 options 里。
 */
export async function ensureAndCollectRecords(
  refno: string,
  options: EnsureAndCollectOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<EnsureAndCollectResult> {
  const {
    force, maxContainerDepth = 3, maxRoots = 128, maxRecordsRoots = Number.POSITIVE_INFINITY, pageSize = 5000,
    recordsConcurrency = 6, recordsBatchSize = MAX_MODEL_RECORDS_ROOTS,
    onRootDone, onNotGenerated, onRequestFailure,
    ...requestOptions
  } = options;
  const start = fromV1Refno(refno);
  const result: EnsureAndCollectResult = {
    refno: start,
    generationRoots: [],
    items: [],
    pending: [],
    empty: [],
    truncatedRoots: [],
    errors: {},
    statuses: {},
  };
  const seenRoots = new Set<string>();
  const collected = new Set<string>();
  let ensureCalls = 0;

  // 队列元素：待 ensure 的节点 + 它是第几层容器展开出来的
  const queue: { refno: string; depth: number }[] = [{ refno: start, depth: 0 }];
  while (queue.length > 0) {
    const { refno: current, depth } = queue.shift()!;
    if (seenRoots.has(current)) continue;
    seenRoots.add(current);
    if (ensureCalls >= maxRoots || collected.size >= maxRecordsRoots) {
      pushUnique(result.truncatedRoots, current);
      continue;
    }
    ensureCalls++;

    let ensured: ModelEnsureResponse;
    try {
      ensured = await api.ensure(force ? { refno: current, force: true } : { refno: current }, requestOptions);
    } catch (error) {
      reportRequestFailure(onRequestFailure, error);
      // 取消 / 换代不能折进 errors 当成「这根出错」——整次读取一起停
      if (!isGenModelV1ApiError(error) || isReadAborted(error, requestOptions.signal)) throw error;
      if (error.isContainer) {
        if (depth >= maxContainerDepth) {
          pushUnique(result.truncatedRoots, current);
          continue;
        }
        let children: TreeChildrenResponse;
        try {
          children = await api.children(current, requestOptions);
        } catch (childError) {
          reportRequestFailure(onRequestFailure, childError);
          if (isReadAborted(childError, requestOptions.signal)) throw childError;
          result.errors[current] = childError instanceof Error ? childError.message : String(childError);
          continue;
        }
        for (const child of children.nodes) queue.push({ refno: fromV1Refno(child.refno), depth: depth + 1 });
        continue;
      }
      if (error.isPending) {
        pushUnique(result.pending, current);
        result.statuses[current] = error.code;
        continue;
      }
      if (error.code === 'not_found' || error.code === 'precondition') {
        pushUnique(result.empty, current);
        result.statuses[current] = error.code;
        continue;
      }
      result.errors[current] = `${error.code}: ${error.message}`;
      continue;
    }

    result.statuses[current] = String(ensured.status ?? '');
    if (ensured.status === 'NoRenderableGeometry' || ensured.model_available === false) {
      pushUnique(result.empty, current);
      continue;
    }
    const roots = rootsOf(ensured, current).filter((root) => {
      if (collected.has(root)) return false;
      if (collected.size >= maxRecordsRoots) {
        pushUnique(result.truncatedRoots, root);
        return false;
      }
      collected.add(root);
      pushUnique(result.generationRoots, root);
      return true;
    });
    // 一次 ensure 解出的多根切批并发取 records（`recordsConcurrency` 路，每路一批）；结果按根的顺序拼回，去重与缓存都不受并发影响
    let done = 0;
    const outcomes = new Map<string, RootRecordsOutcome>();
    const batches = planRecordsBatches(roots, recordsBatchSize, recordsConcurrency);
    await mapWithConcurrency(batches, recordsConcurrency, (batch) =>
      collectBatchOrEachRoot(api, batch, pageSize, requestOptions, (outcome) => {
        outcomes.set(outcome.root, outcome);
        done++;
        onRootDone?.({ done, total: roots.length + queue.length, root: outcome.root });
      }, onNotGenerated, onRequestFailure),
    );
    for (const root of roots) {
      const { items, error } = outcomes.get(root) ?? { items: [], error: null };
      if (error) {
        if (isGenModelV1ApiError(error) && (error.code === 'conflict' || error.isPending)) {
          // 409 not_generated：这根还没进投影（并发被别人的 ensure 抢先又没收口）；当 pending 处理
          pushUnique(result.pending, root);
        } else {
          result.errors[root] = error instanceof Error ? error.message : String(error);
        }
        continue;
      }
      if (items.length === 0) pushUnique(result.empty, root);
      result.items.push(...items);
    }
  }
  return result;
}

export type CollectRootsOptions = GenModelV1RequestOptions & {
  /** 同时在飞的 `records` 批数（默认 6） */
  recordsConcurrency?: number;
  /** 一批最多几根（默认 = 服务端上限 64）；`1` = 逐根 */
  recordsBatchSize?: number;
  /** `model/records` 的页大小（服务端上限 5000） */
  pageSize?: number;
  onRootDone?: (progress: { done: number; total: number; root: string }) => void;
  /** records 发现精确 `not_generated:` 时，在重试 ensure 之前清掉该根的调用方缓存。 */
  onNotGenerated?: (root: string) => void;
  /** 原始请求错误被折叠进结果前的观察器；用于让服务生命周期看见 network 断线。 */
  onRequestFailure?: (error: unknown) => void;
};

export type CollectRootsResult = {
  /** 实际取过记录的生成根（`a_b`，去重、保持传入顺序） */
  generationRoots: string[];
  items: GeomInstQuery[];
  /** 409（这根服务端手里还没有）——几何暂时没有，稍后再问 */
  pending: string[];
  /** 一条记录都没有的根 */
  empty: string[];
  errors: Record<string, string>;
};

/**
 * 根清单**已知**时只取记录：整库入口（spec §4.5.3）先让服务端把该库生成完、再 `…/model/roots` 拿清单，
 * 到这一步已经没有 ensure 可打了。切批 / 退回逐根 / 分型与 `ensureAndCollectRecords` 共用同一套代码，
 * 所以两条入口的结果口径一字不差。
 */
export async function collectRecordsForRoots(
  roots: string[],
  options: CollectRootsOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<CollectRootsResult> {
  const {
    pageSize = 5000, recordsConcurrency = 6, recordsBatchSize = MAX_MODEL_RECORDS_ROOTS,
    onRootDone, onNotGenerated, onRequestFailure, ...requestOptions
  } = options;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of roots) {
    const root = fromV1Refno(String(raw ?? ''));
    if (!root || seen.has(root)) continue;
    seen.add(root);
    unique.push(root);
  }
  const result: CollectRootsResult = { generationRoots: unique, items: [], pending: [], empty: [], errors: {} };
  if (unique.length === 0) return result;

  let done = 0;
  const outcomes = new Map<string, RootRecordsOutcome>();
  const batches = planRecordsBatches(unique, recordsBatchSize, recordsConcurrency);
  await mapWithConcurrency(batches, recordsConcurrency, (batch) =>
    collectBatchOrEachRoot(api, batch, pageSize, requestOptions, (outcome) => {
      outcomes.set(outcome.root, outcome);
      done++;
      onRootDone?.({ done, total: unique.length, root: outcome.root });
    }, onNotGenerated, onRequestFailure),
  );
  for (const root of unique) {
    const { items, error } = outcomes.get(root) ?? { items: [], error: null };
    if (error) {
      if (isGenModelV1ApiError(error) && (error.code === 'conflict' || error.isPending)) {
        pushUnique(result.pending, root);
      } else result.errors[root] = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (items.length === 0) pushUnique(result.empty, root);
    result.items.push(...items);
  }
  return result;
}

/** 记录里全部构件 refno（`a_b`，去重、保持首次出现顺序）。 */
export function refnosOfRecords(items: GeomInstQuery[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = fromV1Refno(item.refno);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
