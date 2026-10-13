/**
 * gen-model-v1 记录层（ADR 0069；服务端半边 gen-model ADR-086）。
 *
 * - **显示 = 查询**：`collectRecordsByAncestor(refno)` 对节点自己发 `model/records`，服务端以它为**祖先**回答子树里已生成的
 *   全部实例（ADR-086 D1），没生成过是 200 空（D2）。不 generate、不展开容器、不解根。多个节点（整库显示逐 SITE）走
 *   `collectRecordsForAncestors`，一个祖先一次分页读取、有界并发。
 * - **生成只在右键**：`generateThenCollect(refno, { force: true })` = `model/generate` → 摄入形态回 `422 container` 时展开一层子节点
 *   逐个 generate（深度 / 根数有上限）→ 回执不是 pending 的根有了新产物，再按祖先查一次记录。`generation_pending` / `timeout`
 *   的根**不显示**，记进 `pending` 交给调用方提示。
 *
 * 这一层只负责**把记录收齐**（`GeomInstQuery[]`），不做 `InstanceEntry` 映射（那是 `instanceMapping.ts` 的事）。
 */
import {
  fromV1Refno,
  genModelV1ModelGenerate,
  genModelV1ModelRecords,
  genModelV1TreeChildren,
  isGenModelV1ApiError,
  type GeomInstQuery,
  type GenModelV1RequestOptions,
  type ModelGenerateResponse,
  type ModelRecordsResponse,
  type TreeChildrenResponse,
} from '@/api/genModelV1Api';
import {
  GenModelV1ServiceGenerationChangedError,
  toGenModelV1CancelledError,
} from '@/model-source/genModelV1/serviceLifecycle';

export type ModelRecordsApi = {
  /** 只有 `generateThenCollect` 会调它；显示路径不碰（源码钉 `display_never_generates`）。 */
  generate: typeof genModelV1ModelGenerate;
  records: typeof genModelV1ModelRecords;
  children: typeof genModelV1TreeChildren;
};

export const defaultModelRecordsApi: ModelRecordsApi = {
  generate: genModelV1ModelGenerate,
  records: genModelV1ModelRecords,
  children: genModelV1TreeChildren,
};

/** 防止异常服务端游标让一次读取无限翻页；达到上限仍 truncated 必须按未完成处理。 */
export const MAX_MODEL_RECORD_PAGES = 10_000;

class ModelRecordsPaginationIncompleteError extends Error {
  constructor(scope: string, detail: string) {
    super(`model/records 分页未完成（${scope}）：${detail}`);
    this.name = 'ModelRecordsPaginationIncompleteError';
  }
}

/** 显示（按祖先查）的可选项。 */
export type CollectRecordsOptions = GenModelV1RequestOptions & {
  /** `model/records` 的页大小（服务端上限 5000） */
  pageSize?: number;
  /** 多个祖先同时在飞的读取数（默认 6） */
  concurrency?: number;
  /** 每收完一个祖先 / 生成根回调一次（进度） */
  onRootDone?: (progress: { done: number; total: number; root: string }) => void;
  /** 原始请求错误被折叠进结果前的观察器；用于让服务生命周期看见 network 断线。 */
  onRequestFailure?: (error: unknown) => void;
};

/** 右键「重新生成模型」的可选项。 */
export type GenerateThenCollectOptions = CollectRecordsOptions & {
  /** 缺省 `true`：范围内已有的产物重算替换。只有右键会走到这里，所以没有「不带 force」的显示补齐语义。 */
  force?: boolean;
  /** 容器展开的最大层数（默认 3：SITE → ZONE → 生成根一般够了） */
  maxContainerDepth?: number;
  /** 一次右键最多 generate 多少个根（默认 128）；超出的记进 `truncatedRoots` */
  maxRoots?: number;
};

/**
 * 显示与重新生成共用的结果形状。
 * - 显示：`generationRoots` 是记录里出现过的 `owner`（生成根）；`pending` 只有 409 `conflict`（该库正被整库任务占用）；
 *   `empty` 是一条记录都没有的祖先；`truncatedRoots` / `statuses` 恒空。
 * - 重新生成：`generationRoots` 是 generate 回执里的根 ∪ 记录里的 owner；`pending` 是回了 `generation_pending` / `timeout` 的根；
 *   `empty` 是 `NoRenderableGeometry` / `not_found` / `precondition` 的根；`truncatedRoots` 是容器展开上限外没处理的；`statuses` 是各根的 generate 状态。
 */
export type CollectRecordsResult = {
  /** 请求的节点（`a_b`） */
  refno: string;
  generationRoots: string[];
  /** 全部记录（按祖先去重后拼接） */
  items: GeomInstQuery[];
  pending: string[];
  empty: string[];
  truncatedRoots: string[];
  /** 其它错误（`a_b` → 错误信息），调用方决定要不要报 */
  errors: Record<string, string>;
  statuses: Record<string, string>;
};

/** 多个祖先一起查的结果（整库显示逐 SITE 用）。 */
export type CollectAncestorsResult = {
  /** 去重后的请求节点（`a_b`，保持传入顺序） */
  ancestors: string[];
  /** 记录里出现过的生成根（`owner`，`a_b`，去重保序） */
  generationRoots: string[];
  items: GeomInstQuery[];
  /** 409 `conflict`（该库正被整库任务占用）的祖先——稍后再显示，不生成 */
  pending: string[];
  /** 一条记录都没有的祖先 */
  empty: string[];
  errors: Record<string, string>;
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
 * 取消 / 服务换代不是「这根出了问题」：不进 `errors`、不当 pending，整次读取一起停、原样向上抛。
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

/** generate 回执里的根（`a_b`）：读透形态给 `generation_roots`，否则 `generation_root`，都没有就是请求的节点自己。 */
function rootsOf(generated: ModelGenerateResponse, fallback: string): string[] {
  const roots = Array.isArray(generated.generation_roots) && generated.generation_roots.length > 0
    ? generated.generation_roots
    : generated.generation_root
      ? [generated.generation_root]
      : [fallback];
  return roots.map((root) => fromV1Refno(String(root)));
}

/** 以一个节点为祖先分页读完 `model/records`。 */
async function collectAncestorRecords(
  api: ModelRecordsApi,
  ancestor: string,
  pageSize: number,
  requestOptions: GenModelV1RequestOptions,
): Promise<GeomInstQuery[]> {
  const out: GeomInstQuery[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < MAX_MODEL_RECORD_PAGES; page++) {
    throwIfAborted(requestOptions.signal);
    const resp: ModelRecordsResponse = await api.records({ generationRoot: ancestor, limit: pageSize, cursor }, requestOptions);
    out.push(...resp.items);
    if (!resp.truncated) return out;
    if (resp.next_cursor === null || resp.next_cursor === undefined) {
      throw new ModelRecordsPaginationIncompleteError(ancestor, 'truncated=true 但缺少 next_cursor');
    }
    cursor = resp.next_cursor;
  }
  throw new ModelRecordsPaginationIncompleteError(
    ancestor,
    `达到 ${MAX_MODEL_RECORD_PAGES} 页护栏后仍有下一页（next_cursor=${cursor ?? 'unknown'}）`,
  );
}

/**
 * 老服务端（< v0.1.38 的内存投影路由）对没生成过的范围仍回 409 `conflict` + `not_generated:`（gen-model ADR-086 之前的口径）。
 * ADR 0069：客户端当**查空**处理——同一句「右键可生成」的提示，不记 ERROR，更不去生成。
 */
export function isLegacyNotGenerated(error: unknown): boolean {
  return isGenModelV1ApiError(error) && error.status === 409 && error.code === 'conflict' && error.message.startsWith('not_generated:');
}

/**
 * 显示：对一批节点各自以祖先身份查 `model/records`（一个祖先一次分页读取，`concurrency` 路并发）。
 * 没生成过是空；409 `conflict`（库正被整库任务占用）记 `pending`；取消 / 服务换代整次向上抛。
 */
export async function collectRecordsForAncestors(
  ancestors: string[],
  options: CollectRecordsOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<CollectAncestorsResult> {
  const { pageSize = 5000, concurrency = 6, onRootDone, onRequestFailure, ...requestOptions } = options;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ancestors) {
    const key = fromV1Refno(String(raw ?? ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  const result: CollectAncestorsResult = { ancestors: unique, generationRoots: [], items: [], pending: [], empty: [], errors: {} };
  if (unique.length === 0) return result;

  let done = 0;
  const outcomes = await mapWithConcurrency(unique, concurrency, async (ancestor) => {
    throwIfAborted(requestOptions.signal);
    let items: GeomInstQuery[] = [];
    let error: unknown = null;
    try {
      items = await collectAncestorRecords(api, ancestor, pageSize, requestOptions);
    } catch (caught) {
      reportRequestFailure(onRequestFailure, caught);
      if (isReadAborted(caught, requestOptions.signal)) throw caught;
      error = caught;
    }
    done++;
    onRootDone?.({ done, total: unique.length, root: ancestor });
    return { ancestor, items, error };
  });
  for (const { ancestor, items, error } of outcomes) {
    if (error) {
      if (isLegacyNotGenerated(error)) {
        pushUnique(result.empty, ancestor);
      } else if (isGenModelV1ApiError(error) && error.code === 'conflict') {
        pushUnique(result.pending, ancestor);
      } else {
        result.errors[ancestor] = error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    if (items.length === 0) pushUnique(result.empty, ancestor);
    result.items.push(...items);
    for (const owner of ownersOfRecords(items)) pushUnique(result.generationRoots, owner);
  }
  return result;
}

/** 显示一个节点：以它为祖先查一次记录。结果形状与 `generateThenCollect` 相同，`truncatedRoots` / `statuses` 恒空。 */
export async function collectRecordsByAncestor(
  refno: string,
  options: CollectRecordsOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<CollectRecordsResult> {
  const requested = fromV1Refno(refno);
  const collected = await collectRecordsForAncestors([requested], options, api);
  return {
    refno: requested,
    generationRoots: collected.generationRoots,
    items: collected.items,
    pending: collected.pending,
    empty: collected.empty,
    truncatedRoots: [],
    errors: collected.errors,
    statuses: {},
  };
}

/**
 * 右键「重新生成模型」：`model/generate(force)` → 容器按契约展开一层递归（上限在 options 里）→ 对请求的节点按祖先查一次记录。
 * 全部根都回了 pending / 都没产物时不查记录（`items` 为空），由调用方按 `pending` 提示「服务端后台继续生成，完成后再点眼睛」。
 */
export async function generateThenCollect(
  refno: string,
  options: GenerateThenCollectOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<CollectRecordsResult> {
  const {
    force = true, maxContainerDepth = 3, maxRoots = 128, pageSize, concurrency, onRootDone, onRequestFailure,
    ...requestOptions
  } = options;
  const start = fromV1Refno(refno);
  const result: CollectRecordsResult = {
    refno: start,
    generationRoots: [],
    items: [],
    pending: [],
    empty: [],
    truncatedRoots: [],
    errors: {},
    statuses: {},
  };
  const seen = new Set<string>();
  let generateCalls = 0;
  let generatedRoots = 0;

  // 队列元素：待 generate 的节点 + 它是第几层容器展开出来的
  const queue: { refno: string; depth: number }[] = [{ refno: start, depth: 0 }];
  while (queue.length > 0) {
    const { refno: current, depth } = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (generateCalls >= maxRoots) {
      pushUnique(result.truncatedRoots, current);
      continue;
    }
    throwIfAborted(requestOptions.signal);
    generateCalls++;

    let generated: ModelGenerateResponse;
    try {
      generated = await api.generate(force ? { refno: current, force: true } : { refno: current }, requestOptions);
    } catch (error) {
      reportRequestFailure(onRequestFailure, error);
      // 取消 / 换代不能折进 errors 当成「这根出错」——整次一起停
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
        onRootDone?.({ done: result.pending.length + generatedRoots + result.empty.length, total: seen.size + queue.length, root: current });
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

    result.statuses[current] = String(generated.status ?? '');
    if (generated.status === 'NoRenderableGeometry' || generated.model_available === false) {
      pushUnique(result.empty, current);
      continue;
    }
    for (const root of rootsOf(generated, current)) pushUnique(result.generationRoots, root);
    generatedRoots++;
    onRootDone?.({ done: result.pending.length + generatedRoots + result.empty.length, total: seen.size + queue.length, root: current });
  }

  // 生成完成之后，再调用显示接口（ADR 0069 / plant-ui ADR-0030 D2）：一根都没生成出来就不查，调用方按 pending 提示
  if (result.generationRoots.length === 0) return result;
  const collected = await collectRecordsForAncestors([start], { pageSize, concurrency, onRequestFailure, ...requestOptions }, api);
  result.items = collected.items;
  for (const owner of collected.generationRoots) pushUnique(result.generationRoots, owner);
  for (const ancestor of collected.pending) pushUnique(result.pending, ancestor);
  Object.assign(result.errors, collected.errors);
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

/** 记录里全部生成根（`owner`，`a_b`，去重、保持首次出现顺序）。 */
export function ownersOfRecords(items: GeomInstQuery[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = fromV1Refno(String(item.owner ?? ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
