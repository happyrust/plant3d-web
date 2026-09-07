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
 */
import {
  fromV1Refno,
  genModelV1ModelEnsure,
  genModelV1ModelRecords,
  genModelV1TreeChildren,
  isGenModelV1ApiError,
  type GeomInstQuery,
  type GenModelV1RequestOptions,
  type ModelEnsureResponse,
  type ModelRecordsResponse,
  type TreeChildrenResponse,
} from '@/api/genModelV1Api';

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

export type EnsureAndCollectOptions = GenModelV1RequestOptions & {
  /** 只给「人明确要求重生成」用（spec §4.5）：显示补齐**不要**传，否则每显示一次都提交新的重生成工作 */
  force?: boolean;
  /** 容器展开的最大层数（默认 3：SITE → ZONE → 生成根一般够了） */
  maxContainerDepth?: number;
  /** 一次调用最多 ensure 多少个根（默认 128）；超出的记进 `truncatedRoots` */
  maxRoots?: number;
  /** `model/records` 的页大小（服务端上限 5000） */
  pageSize?: number;
  /** 每处理完一个根回调一次（进度） */
  onRootDone?: (progress: { done: number; total: number; root: string }) => void;
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
  for (let page = 0; page < 10_000; page++) {
    const resp: ModelRecordsResponse = await api.records({ generationRoot: root, limit: pageSize, cursor }, requestOptions);
    out.push(...resp.items);
    if (!resp.truncated || resp.next_cursor === null || resp.next_cursor === undefined) break;
    cursor = resp.next_cursor;
  }
  return out;
}

/**
 * 对一个节点做「显式显示」：ensure → records。容器按契约展开一层递归；一切上限都在 options 里。
 */
export async function ensureAndCollectRecords(
  refno: string,
  options: EnsureAndCollectOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<EnsureAndCollectResult> {
  const { force, maxContainerDepth = 3, maxRoots = 128, pageSize = 5000, onRootDone, ...requestOptions } = options;
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
    if (ensureCalls >= maxRoots) {
      pushUnique(result.truncatedRoots, current);
      continue;
    }
    ensureCalls++;

    let ensured: ModelEnsureResponse;
    try {
      ensured = await api.ensure(force ? { refno: current, force: true } : { refno: current }, requestOptions);
    } catch (error) {
      if (!isGenModelV1ApiError(error)) throw error;
      if (error.isContainer) {
        if (depth >= maxContainerDepth) {
          pushUnique(result.truncatedRoots, current);
          continue;
        }
        let children: TreeChildrenResponse;
        try {
          children = await api.children(current, requestOptions);
        } catch (childError) {
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
    const roots = rootsOf(ensured, current);
    for (const root of roots) {
      if (collected.has(root)) continue;
      collected.add(root);
      pushUnique(result.generationRoots, root);
      try {
        const items = await collectRootRecords(api, root, pageSize, requestOptions);
        if (items.length === 0) pushUnique(result.empty, root);
        result.items.push(...items);
      } catch (error) {
        if (isGenModelV1ApiError(error) && error.code === 'conflict') {
          // 409 not_generated：这根还没进投影（并发被别人的 ensure 抢先又没收口）；当 pending 处理
          pushUnique(result.pending, root);
        } else {
          result.errors[root] = error instanceof Error ? error.message : String(error);
        }
      }
      onRootDone?.({ done: result.generationRoots.length, total: result.generationRoots.length + queue.length, root });
    }
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
