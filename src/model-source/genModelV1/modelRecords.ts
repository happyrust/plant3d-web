/**
 * gen-model-v1 记录层（ADR 0069；服务端半边 gen-model ADR-086）。
 *
 * - **显示 = 查询**：`collectRecordsByAncestor(refno)` 对节点自己发 `model/records`，服务端以它为**祖先**回答子树里已生成的
 *   全部实例（ADR-086 D1），没生成过是 200 空（D2）。不 generate、不展开容器、不解根。多个节点（整库显示逐 SITE）走
 *   `collectRecordsForAncestors`，一个祖先一次分页读取、有界并发。
 * - **生成入口仍是 `generateThenCollect`**：`model/generate` → 摄入形态回 `422 container` 时展开一层子节点
 *   逐个 generate（深度 / 根数有上限）→ 回执不是 pending 的根有了新产物，再按祖先查一次记录。`generation_pending` / `timeout`
 *   的根**不显示**，记进 `pending` 交给调用方提示。调用方两类，`force` 必须写明：
 *   - 右键「重新生成模型」/ 模型生成面板的按节点生成：`{ force: true }`（先删后生成）；
 *   - 显示时节点查询成功且一条记录都没有的**模型资产补齐**：`{ force: false }`（只生成缺的 / 落后的根，每 refno 每实例只自动一发）。
 *     gen-model 规范 §4.5：显示补齐不要带 force。
 *
 * 这一层只负责**把记录收齐**（`GeomInstQuery[]`），不做 `InstanceEntry` 映射（那是 `instanceMapping.ts` 的事）。
 */
import {
  fromV1Refno,
  genModelV1ModelGenerate,
  genModelV1ModelRecords,
  genModelV1TreeChildren,
  isGenModelV1ApiError,
  MAX_MODEL_RECORDS_ROOTS,
  type GeomInstQuery,
  type GenModelV1RequestOptions,
  type ModelGenerateResponse,
  type ModelRecordsResponse,
  type ModelUnresolvedSlot,
  type TreeChildrenResponse,
} from '@/api/genModelV1Api';
import {
  GenModelV1ServiceGenerationChangedError,
  toGenModelV1CancelledError,
} from '@/model-source/genModelV1/serviceLifecycle';

export type ModelRecordsApi = {
  /** 只有 `generateThenCollect` 会调它；查询路径不碰（源码钉 `display_never_generates`）。 */
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

/**
 * 分页读记录时每到一页的回调，经查询选项（`CollectRecordsOptions.onRecordPage`）交给这一次读取：只收这次读取自己的页。
 * 不做成全页面共用的监听：几个节点同时查记录时各自的页必须回到各自手里——接的一方拿这一页去拉网格，
 * 拉进的是它自己那个库的缓存、用的是它自己的取消信号（#165）。
 */
export type RecordPageListener = (items: GeomInstQuery[]) => void;

/**
 * 把这一页交给这次读取自己的分页回调。它只是个提速的钩子（下一页回来之前先拉网格）：回调出错不影响读记录。
 * 这次读取已经被叫停（`signal` 中止）就不交了：响应赶在中止之前到、中止之后才轮到处理的那一页，不该再引出新的取网格。
 */
function notifyRecordPage(listener: RecordPageListener | undefined, items: GeomInstQuery[], signal?: AbortSignal): void {
  if (!listener || signal?.aborted) return;
  try {
    listener(items);
  } catch {
    // ignore
  }
}

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
  /**
   * 一发 `model/records` 最多带几个祖先（批量形，spec §4.5.2）。缺省 1：一个祖先一发，和原来一样。
   * 大于 1 时把还没查的祖先按传入顺序几个一组发：头几发仍只带一两个（第一批记录不等一整组），之后才带满（{@link RECORDS_BATCH_RAMP}）；
   * 一组也不超过「剩下的平摊到 `concurrency` 路」，祖先不多时各路都有活干，不会比一个一发慢。
   * 只给**同库、互不包含、都不是分组**的祖先用（顶层 SITE 拆出来的 ZONE）：服务端要求一批同库，分组在批量形里不展开。
   * 结果与不打包时相同——每个祖先的记录按响应里的逐根条数切出来，`onRootDone` / `onAncestorRecords` 仍是一个祖先一次。
   * 批量请求没成（不是取消）或响应对不上时，这一组退回一个祖先一发，这次读取余下的也不再打包：每个祖先的去向
   * （空 / 409 / 出错）仍由它自己那一发决定。
   */
  batchAncestors?: number;
  /** 每收完一个祖先 / 生成根回调一次（进度） */
  onRootDone?: (progress: { done: number; total: number; root: string }) => void;
  /**
   * 每收完一个祖先就把它的记录交出来一次，不等还没回来的祖先（边取边画，方案 2026-11-10 A3）。只交**收齐且有记录**的祖先：
   * 查空、409、出错的不交（它们的去向照旧在最终结果的 `empty` / `pending` / `errors` 里）。回调自己抛错不影响读取。
   * 最终结果不变，仍按传入顺序拼接。
   */
  onAncestorRecords?: (batch: { ancestor: string; items: GeomInstQuery[]; done: number; total: number }) => void;
  /**
   * 这次读取每读到一页记录回调一次，交的是这一页里收下的记录（批量形一页没装下的祖先不算，它们重发时再交）。
   * 显示流程用它在下一页回来之前先拉这一页的网格。只有这次读取自己的页——同时在读的别的查询各有各的回调（见
   * {@link RecordPageListener}）。回调自己抛错不影响读取。
   */
  onRecordPage?: RecordPageListener;
  /** 原始请求错误被折叠进结果前的观察器；用于让服务生命周期看见 network 断线。 */
  onRequestFailure?: (error: unknown) => void;
};

/** 生成入口（右键「重新生成模型」与显示时的模型资产补齐）的可选项。 */
export type GenerateThenCollectOptions = CollectRecordsOptions & {
  /**
   * `true`（缺省，为了不改老调用方）：先把范围内已有的产物连同网格清掉再逐根生成——只给「人明确要求重新生成」用。
   * `false`：模型资产补齐，已有且最新的根服务端直接回 `AlreadyAvailable`。显示路径必须显式传 `false`。
   */
  force?: boolean;
  /** 容器展开的最大层数（默认 3：SITE → ZONE → 生成根一般够了） */
  maxContainerDepth?: number;
  /** 一次右键最多 generate 多少个根（默认 128）；超出的记进 `truncatedRoots` */
  maxRoots?: number;
  /** 每对一个节点发出 `model/generate` 前回调一次（进度：正在生成哪个根） */
  onRootStart?: (progress: { done: number; total: number; root: string }) => void;
};

/**
 * 分组（GPWL / GPSET）为空或成员全都解析不出：generate 回执 `scope_kind: 'group'` 且 `generation_roots: []`。
 *
 * 这是**兜底文案**：拿不到 `unresolved[].reason`（开关关、旧后端、或只有 GPREF 族坏槽）时用它，
 * 逐字保持不变——开关关时用户看到的东西一个字都不能变。
 */
export const EMPTY_GROUP_HINT = '分组为空或成员不可解析';

/** 后端 `group_empty`：分组既没有 GPITEM 成员也没有 SCOSEL 规则。 */
export const GROUP_EMPTY_HINT = '分组为空';
/** 后端 `scosel_no_match`：规则完整解出、一个构件都没命中。 */
export const GROUP_RULE_NO_MATCH_HINT = '规则没有命中任何构件';
/** 后端 `scosel_unsupported` / `scosel_eval_failed`：规则解不出或求值器认不出它的形状。 */
export const GROUP_RULE_UNEVALUABLE_HINT = '规则无法求值（成员不可解析）';

/**
 * 空分组的提示文案按后端原因码分流（M4，VAL-WEB-007）。
 *
 * 只读 `reason`，**不读 `via`**：规则族与 `group_empty` 槽没有经由的 GPITEM，后端把 `via` 填成分组自己的 refno，
 * 拿它做成员级渲染会得到「成员经由分组自己」的误导文案。
 *
 * 优先级按「越具体越先」排：`group_empty` 说明连规则都没有；`scosel_no_match` 说明规则求值成功但零命中；
 * `scosel_unsupported` / `scosel_eval_failed` 说明规则本身不可用。三者之外（含 `gpref_missing` /
 * `db_not_in_mdb` / `target_missing` 这三个 GPREF 族码）一律回落到 {@link EMPTY_GROUP_HINT} 的原文。
 */
export function emptyGroupHintFor(unresolved?: readonly ModelUnresolvedSlot[] | null): string {
  const reasons = new Set((unresolved ?? []).map((slot) => slot.reason));
  if (reasons.has('group_empty')) return GROUP_EMPTY_HINT;
  if (reasons.has('scosel_no_match')) return GROUP_RULE_NO_MATCH_HINT;
  if (reasons.has('scosel_unsupported') || reasons.has('scosel_eval_failed')) return GROUP_RULE_UNEVALUABLE_HINT;
  return EMPTY_GROUP_HINT;
}

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
  /** 没有记录时直接给人看的说明（`a_b` → 文案）；目前只有空分组，文案按 {@link emptyGroupHintFor} 分流 */
  hints?: Record<string, string>;
  /**
   * 只有生成入口填：范围生成的 200 回执里点名的失败根（`failed_roots`，gen-model 规范 §4.5）。一根失败不中止整片，
   * 其余根的产物照样在 `items` 里。`retryable` 的等一等用不带 `force` 的同一请求再发就能补上（分块生成据此自动接着问）。
   */
  failedRoots?: { root: string; error: string; retryable: boolean }[];
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

/**
 * generate 回执里的根（`a_b`）：读透形态给 `generation_roots`，否则 `generation_root`，都没有就是请求的节点自己。
 * 分组（`scope_kind: 'group'`）只认 `generation_roots`：空表就是空组，不回退为分组自己（它的 `generation_root` 回显的就是请求）。
 */
function rootsOf(generated: ModelGenerateResponse, fallback: string): string[] {
  if (generated.scope_kind === 'group') return (generated.generation_roots ?? []).map((root) => fromV1Refno(String(root)));
  const roots = Array.isArray(generated.generation_roots) && generated.generation_roots.length > 0
    ? generated.generation_roots
    : generated.generation_root
      ? [generated.generation_root]
      : [fallback];
  return roots.map((root) => fromV1Refno(String(root)));
}

/** 以一个节点为祖先分页读完 `model/records`；每到一页交给 `onRecordPage`。 */
async function collectAncestorRecords(
  api: ModelRecordsApi,
  ancestor: string,
  pageSize: number,
  requestOptions: GenModelV1RequestOptions,
  onRecordPage?: RecordPageListener,
): Promise<GeomInstQuery[]> {
  const out: GeomInstQuery[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < MAX_MODEL_RECORD_PAGES; page++) {
    throwIfAborted(requestOptions.signal);
    const resp: ModelRecordsResponse = await api.records({ generationRoot: ancestor, limit: pageSize, cursor }, requestOptions);
    out.push(...resp.items);
    notifyRecordPage(onRecordPage, resp.items, requestOptions.signal);
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
 * 批量形（`batchAncestors` 大于 1）头几发各带几个祖先，下标是「这次读取里的第几发」，排不到的带满。
 * 一上来就带满的话，第一批记录要等一整组读完才回来（服务端一组里是一个接一个读的，16 个 ZONE 约 0.25 秒）；
 * 先发两个只带一个的，第一批照旧十几毫秒就到，边取边画的第一帧不变晚。
 */
export const RECORDS_BATCH_RAMP: readonly number[] = [1, 1, 2, 4, 8];

/** 顶层 SITE 拆成 ZONE 查时一发带几个 ZONE（依据：plant3d-web 方案文档 2026-11-10 第 13.8 节的实测；32 个一发不比 16 个快）。 */
export const RECORDS_MEMBER_BATCH = 16;

/**
 * 成员多于这个数才打包。几十个 ZONE 的 SITE 一个一发本来就在一秒以内，打包省不出什么（实测 19 个 ZONE 的 SITE 两种取法持平），
 * 不动它；几百个 ZONE 的才是打包要管的（8 万件的 SITE 531 个）。
 */
export const RECORDS_MEMBER_BATCH_MIN_MEMBERS = 64;

/**
 * 拆成成员查时一发带几个成员。后端在 `/health.capabilities.model_records_batch_max_roots` 里声明了批量形、而且这次要查的成员
 * 多于 {@link RECORDS_MEMBER_BATCH_MIN_MEMBERS} 个才打包；否则回 1，一个成员一发（旧后端、health 还没回来也是 1）。
 * `override` 是页面地址上 `gm_records_batch` 的值：`0` / `1` 关掉打包，别的正整数改每发的个数（不超过后端声明的上限，
 * 也不再看成员数）——量前后对照、出了问题临时关掉用。
 */
export function recordsMemberBatchSize(
  capabilities: { model_records_batch_max_roots?: unknown } | null | undefined,
  override?: string | null,
  members: number = Number.POSITIVE_INFINITY,
): number {
  const declared = capabilities?.model_records_batch_max_roots;
  const max = typeof declared === 'number' && Number.isFinite(declared) ? Math.min(Math.floor(declared), MAX_MODEL_RECORDS_ROOTS) : 0;
  if (max < 2) return 1;
  const raw = (override ?? '').trim();
  if (raw !== '') {
    const wanted = Number(raw);
    if (Number.isInteger(wanted) && wanted >= 0) return Math.max(1, Math.min(wanted, max));
  }
  if (!(members > RECORDS_MEMBER_BATCH_MIN_MEMBERS)) return 1;
  return Math.min(RECORDS_MEMBER_BATCH, max);
}

/**
 * 把批量形的一页按响应里的逐根条数（`roots[]`，请求顺序；`items` 也按请求顺序平铺）切回各个祖先。
 * - 没截断：每个祖先都齐。
 * - 截断（整批超过一页）：这一页里装完的祖先照收，排在后面没装完的连同它们的条数回 `restTotals`，由调用方重新分组再发——
 *   不拿游标接着翻：批量形翻页，服务端每一页都把整批重读一遍。
 * 对不上（没有 `roots`、根数或根名不符、条数和记录数矛盾）回 `null`：调用方退回一个祖先一发，不猜。
 */
function splitBatchPage(
  resp: ModelRecordsResponse,
  ancestors: string[],
): { complete: GeomInstQuery[][]; restTotals: number[] } | null {
  const roots = resp?.roots;
  const items = resp?.items;
  if (!Array.isArray(roots) || !Array.isArray(items) || roots.length !== ancestors.length) return null;
  const totals: number[] = [];
  let sum = 0;
  for (let i = 0; i < roots.length; i++) {
    const total = roots[i]?.total;
    if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null;
    if (fromV1Refno(String(roots[i]?.generation_root ?? '')) !== ancestors[i]) return null;
    totals.push(total);
    sum += total;
  }
  if (resp.truncated ? items.length >= sum : items.length !== sum) return null;
  const complete: GeomInstQuery[][] = [];
  let offset = 0;
  for (const total of totals) {
    if (offset + total > items.length) break;
    complete.push(items.slice(offset, offset + total));
    offset += total;
  }
  return { complete, restTotals: totals.slice(complete.length) };
}

/**
 * 显示：对一批节点各自以祖先身份查 `model/records`（一个祖先一次分页读取，`concurrency` 路并发）。
 * 没生成过是空；409 `conflict`（库正被整库任务占用）记 `pending`；取消 / 服务换代整次向上抛。
 * `batchAncestors` 大于 1 时几个祖先打包成一发（批量形），结果不变，见该选项的说明。
 */
export async function collectRecordsForAncestors(
  ancestors: string[],
  options: CollectRecordsOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<CollectAncestorsResult> {
  const {
    pageSize = 5000, concurrency = 6, batchAncestors = 1, onRootDone, onAncestorRecords, onRecordPage, onRequestFailure, ...requestOptions
  } = options;
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

  const total = unique.length;
  const outcomes: ({ items: GeomInstQuery[]; error: unknown } | undefined)[] = new Array(total);
  let done = 0;
  /** 一个祖先有了去向（收齐 / 出错）：记下来，报进度，收齐且有记录的交给边取边画的消费方。 */
  const settle = (index: number, items: GeomInstQuery[], error: unknown): void => {
    const ancestor = unique[index]!;
    outcomes[index] = { items, error };
    done++;
    onRootDone?.({ done, total, root: ancestor });
    if (!error && items.length > 0 && onAncestorRecords) {
      try {
        onAncestorRecords({ ancestor, items, done, total });
      } catch {
        // 边取边画的消费方出错不能让这次读取失败：最终结果里这个祖先的记录照样在
      }
    }
  };
  /** 一个祖先一发（单根形，分页读完）。 */
  const readSingle = async (index: number): Promise<void> => {
    throwIfAborted(requestOptions.signal);
    let items: GeomInstQuery[] = [];
    let error: unknown = null;
    try {
      items = await collectAncestorRecords(api, unique[index]!, pageSize, requestOptions, onRecordPage);
    } catch (caught) {
      reportRequestFailure(onRequestFailure, caught);
      if (isReadAborted(caught, requestOptions.signal)) throw caught;
      error = caught;
    }
    settle(index, items, error);
  };

  const batchMax = Math.max(1, Math.min(Math.floor(Number(batchAncestors)) || 1, MAX_MODEL_RECORDS_ROOTS));
  const lanes = Math.max(1, Math.min(concurrency, total));
  let batching = batchMax > 1 && total > 1;
  let issued = 0;
  let next = 0;
  /** 批量响应里一页没装下的祖先：按那一回知道的条数重新分好组，排在队头等着再发 */
  const regrouped: number[][] = [];
  const takeGroup = (): number[] | null => {
    const waiting = regrouped.shift();
    if (waiting) return waiting;
    if (next >= total) return null;
    // 一组不超过「剩下的平摊到每一路」：服务端一组里是一个接一个读的，一组拿多了，别的几路没活干、这一路还在排着读——
    // 十几个 ZONE 的 SITE 打成一两个大组反而比一个一发慢。剩得多时（几百个 ZONE）这一条不起作用，照 batchMax 带满。
    const fairShare = Math.ceil((total - next) / lanes);
    const size = batching ? Math.max(1, Math.min(batchMax, RECORDS_BATCH_RAMP[issued] ?? batchMax, fairShare)) : 1;
    issued++;
    const group: number[] = [];
    while (group.length < size && next < total) group.push(next++);
    return group;
  };
  const readGroup = async (group: number[]): Promise<void> => {
    if (group.length === 1 || !batching) {
      for (const index of group) await readSingle(index);
      return;
    }
    throwIfAborted(requestOptions.signal);
    const names = group.map((index) => unique[index]!);
    let resp: ModelRecordsResponse | null = null;
    try {
      resp = await api.records({ generationRoots: names, limit: pageSize }, requestOptions);
    } catch (caught) {
      reportRequestFailure(onRequestFailure, caught);
      if (isReadAborted(caught, requestOptions.signal)) throw caught;
    }
    const split = resp ? splitBatchPage(resp, names) : null;
    if (!resp || !split) {
      // 批量请求没成（旧后端不认这个形状、整批里有一根读失败、409 …）或响应对不上：这一组一个一个重问，
      // 这次读取余下的也不再打包——每个祖先是空、是 409 还是出错，由它自己那一发说了算
      batching = false;
      for (const index of group) await readSingle(index);
      return;
    }
    const pageRows = resp.items.length;
    const completeRows = split.restTotals.length === 0 ? pageRows : split.complete.reduce((rows, items) => rows + items.length, 0);
    // 这一页里收下的记录交给分页回调（下一发回来之前先拉网格）；没装完的祖先重发时再交
    notifyRecordPage(onRecordPage, completeRows === pageRows ? resp.items : resp.items.slice(0, completeRows), requestOptions.signal);
    for (let i = 0; i < split.complete.length; i++) settle(group[i]!, split.complete[i]!, null);
    // 一页没装下的：按条数重新分组，每组不超过这一页的实际大小；单独一个就超过一页的自己一组（走单根形分页）
    let bucket: number[] = [];
    let bucketRows = 0;
    const flush = (): void => {
      if (bucket.length > 0) regrouped.push(bucket);
      bucket = [];
      bucketRows = 0;
    };
    for (let i = 0; i < split.restTotals.length; i++) {
      const index = group[split.complete.length + i]!;
      const rows = split.restTotals[i]!;
      if (rows > pageRows) {
        flush();
        regrouped.push([index]);
        continue;
      }
      if (bucketRows + rows > pageRows) flush();
      bucket.push(index);
      bucketRows += rows;
    }
    flush();
  };
  await Promise.all(Array.from({ length: lanes }, async () => {
    for (;;) {
      const group = takeGroup();
      if (!group) return;
      await readGroup(group);
    }
  }));

  for (let index = 0; index < total; index++) {
    const ancestor = unique[index]!;
    const { items, error } = outcomes[index] ?? { items: [], error: new Error('model/records 没有读到这个祖先（内部错误）') };
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
 * 分组（GPWL / GPSET）：`force` 回 422 `group_scope` 时不带 force 按成员生成一次；空组记 `empty` 并给 `hints`，不回退为分组自己。
 * `onRecordPage` 只管生成之后那次按祖先查：每到一页交一次。
 */
export async function generateThenCollect(
  refno: string,
  options: GenerateThenCollectOptions = {},
  api: ModelRecordsApi = defaultModelRecordsApi,
): Promise<CollectRecordsResult> {
  const {
    force = true, maxContainerDepth = 3, maxRoots = 128, pageSize, concurrency, onRootDone, onRootStart, onRequestFailure,
    // 分页回调只给生成之后那次按祖先查用；摘出来也为了不让它混进发给 generate / children 的请求选项
    onRecordPage,
    // 生成之后那次按祖先查只有一个祖先，没有「分批交」「打包」可言；摘出来只为不让它们混进发给接口的请求选项
    onAncestorRecords: _onAncestorRecords,
    batchAncestors: _batchAncestors,
    ...requestOptions
  } = options;
  void _onAncestorRecords;
  void _batchAncestors;
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
  // 分组不接受 force（先清后生成会清掉别处主链拥有的模型）：改不带 force 按成员生成——显示时「没有模型就默认生成」对分组照样成立
  const generateRoot = async (target: string): Promise<ModelGenerateResponse> => {
    if (!force) return api.generate({ refno: target }, requestOptions);
    try {
      return await api.generate({ refno: target, force: true }, requestOptions);
    } catch (error) {
      if (!isGenModelV1ApiError(error) || !error.isGroupScope) throw error;
      reportRequestFailure(onRequestFailure, error);
      throwIfAborted(requestOptions.signal);
      return api.generate({ refno: target }, requestOptions);
    }
  };

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
    onRootStart?.({ done: result.pending.length + generatedRoots + result.empty.length, total: seen.size + queue.length, root: current });

    let generated: ModelGenerateResponse;
    try {
      generated = await generateRoot(current);
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
    // 逐根记错（规范 §4.5）：回执点名的失败根带出去，调用方决定要不要接着问、怎么告诉人
    for (const failed of generated.failed_roots ?? []) {
      const root = fromV1Refno(String(failed?.generation_root ?? ''));
      if (!root) continue;
      (result.failedRoots ??= []).push({ root, error: String(failed.error ?? ''), retryable: failed.retryable === true });
    }
    if (generated.scope_kind === 'group' && rootsOf(generated, current).length === 0) {
      pushUnique(result.empty, current);
      // 唯一写入点（M4）：原因码只有 generate 回执带，上层拿不到，所以分流必须在这里定稿
      result.hints = { ...result.hints, [current]: emptyGroupHintFor(generated.unresolved) };
      continue;
    }
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
  const collected = await collectRecordsForAncestors([start], { pageSize, concurrency, onRequestFailure, onRecordPage, ...requestOptions }, api);
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
