/**
 * 模型资产补齐的**预检**与**分块执行**（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` B3；
 * ADR 0072 第 3 条）。纯逻辑：不碰场景、不发请求——数子节点、生成、装载都由调用方注入。
 *
 * - 预检（`planModelGeneration`）：没有模型的范围里大约有多少个生成单元，超过阈值就要先让人确认。
 *   **这是「事实从哪来」的唯一入口**：现在是沿树往下数（过渡办法，数出来的是估计），后端的节点模型状态接口
 *   （`GET node/model-status` 的 `units` / `precheck`，gen-model 规范 §4.5.3）部署后只改这个函数。
 * - 执行（`runGenerationFill`）：一块一块来，每块一发不带 `force` 的生成；回了「还在后台算」（504 / 202）、
 *   「库被占着」（409）、「依赖暂时不可用」（503）或回执里有可重试的失败根，就隔几秒用同样的请求再问，不要人再点；
 *   到了的构件随到随装；不可重试的失败根点名记下，其余照常显示。块与块之间、每次再问之前都看一眼「还要不要继续」
 *   （节点被隐藏了 / 被叫停了）——加载中的「停」以后接在这个口子上。
 */
import { refnosOfRecords, type CollectRecordsResult } from '@/model-source/genModelV1/modelRecords';

/** 要生成的单元超过这个数就先确认（用户 2026-11-10 定；与后端 `MODEL_HISTORY_CONFIRM_UNITS` 的缺省同值） */
export const GENERATION_CONFIRM_THRESHOLD_UNITS = 20;

/** `/health.delivery_unit_types` 还没取到时用的交付单元类型（后端的缺省配置） */
export const DEFAULT_DELIVERY_UNIT_TYPES: readonly string[] = ['BRAN', 'HANG', 'SUPPO', 'EQUI'];

/** 只做层级用、自己从不产出模型的粗容器：没有子节点时就是没东西可生成 */
const COARSE_CONTAINER_NOUNS = new Set(['WORL', 'WORLD', 'SITE', 'ZONE']);

/**
 * 「隔几秒再问」的节奏与一块最多等多久。可变对象：单测把它调小。
 * 一发生成请求后端最多挂 120 秒，所以一块的总时长可能明显超过 `budgetMs`（预算只管「还要不要再问下一次」）。
 */
export const generationResumeTiming = {
  delaysMs: [3_000, 5_000, 8_000, 10_000],
  budgetMs: 10 * 60_000,
};

/** 预检时数子节点同时在飞的请求数 */
const PLAN_CHILDREN_CONCURRENCY = 6;

export type GenerationTreeNode = {
  refno: string;
  noun: string;
  name: string;
  /** 子节点数；不知道给 `null` */
  childrenCount: number | null;
};

export type ListGenerationChildren = (refno: string) => Promise<GenerationTreeNode[]>;

/** 分块生成的一块：一个没有模型的范围（SITE 下的一个 ZONE，或节点自己） */
export type GenerationChunk = {
  refno: string;
  noun: string;
  name: string;
  /** 这一块里大约有多少个生成单元 */
  units: number;
};

export type GenerationPlan = {
  root: string;
  chunks: GenerationChunk[];
  /** 要生成的单元数（各块之和） */
  units: number;
  /** `units` 是不是精确的：沿树数出来的是估计（`false`），节点模型状态接口给的才精确 */
  exact: boolean;
  needsConfirm: boolean;
  thresholdUnits: number;
  /** 查过、确认没有东西可生成的范围（没有子节点的容器；接口说没有要生成的单元的成员） */
  skipped: string[];
  /** 后端对节点自己的预检；沿树数的（服务端没有那个接口、或没问到）为 `null` */
  rootFacts: GenerationUnitFacts | null;
};

/**
 * 后端的生成预检（`GET node/model-status` 的 `units` / `precheck`，gen-model 规范 §4.5.3）里这里用得到的几格：
 * 这个范围下有多少个生成单元、不带 force 生成一次至少要生成几个、要不要先确认、阈值多少。
 */
export type GenerationUnitFacts = {
  unitsTotal: number;
  unitsToGenerate: number;
  needsConfirm: boolean;
  /** 阈值（后端给的；0 = 从不要求确认） */
  thresholdUnits: number;
  /** 数字是不是精确的 */
  exact: boolean;
  /**
   * 缺的单元该靠「更新到最新」补，不该按需生成：这个库有模型水位、在后端的更新范围里、库文件比水位新——
   * 没有模型的单元多半是水位之后才建的。这时一块都不排，行上给的是「更新」。
   */
  preferUpdate?: boolean;
};

/** 问一个范围的生成预检。回 `null` = 服务端没有那个接口（旧构建）；别的失败照常抛。 */
export type FetchGenerationFacts = (refno: string) => Promise<GenerationUnitFacts | null>;

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

async function mapBounded<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 按后端的生成预检定分块（2026-11-11 接上节点模型状态接口）。`rootFacts` 是节点自己的预检；`emptyMembers` 是按成员
 * 拆开查时一条记录都没有的成员（顶层 SITE 的 ZONE）。
 *
 * - 节点自己没有要生成的单元：一块都没有（那些没有记录的成员本来就没有几何，或者没有生成单元）。
 * - 缺的单元该靠「更新到最新」补（`preferUpdate`）：也一块都没有。
 * - 没有「没有记录的成员」（节点不拆，或者缺的单元都在有记录的成员里）：节点自己一块。
 * - 否则逐个问这些成员：有要生成的单元的各成一块；问不到的按 1 个单元算、照常去生成。节点要生成的比这些成员加起来多
 *   （有的成员只生成了一部分）时，最后再对节点自己补一块，把其余的一次生成掉。
 */
async function planFromFacts(input: {
  root: string;
  rootNoun: string | null;
  rootFacts: GenerationUnitFacts;
  emptyMembers: string[];
  fetchFacts: FetchGenerationFacts;
  listChildren: ListGenerationChildren;
}): Promise<GenerationPlan> {
  const { root, rootFacts } = input;
  const rootNoun = upper(input.rootNoun);
  const members = Array.from(new Set(input.emptyMembers.filter((scope) => scope && scope !== root)));
  const base = {
    root,
    thresholdUnits: rootFacts.thresholdUnits,
    rootFacts,
  };
  if (rootFacts.unitsToGenerate <= 0) {
    return { ...base, chunks: [], units: 0, exact: rootFacts.exact, needsConfirm: false, skipped: members.length > 0 ? members : [root] };
  }
  // 缺的单元归「更新到最新」管：不按需生成（也不把这些范围记成「没有东西可生成」——更新完它们就有了）
  if (rootFacts.preferUpdate) {
    return { ...base, chunks: [], units: 0, exact: rootFacts.exact, needsConfirm: false, skipped: [] };
  }
  if (members.length === 0) {
    return {
      ...base,
      chunks: [{ refno: root, noun: rootNoun, name: root, units: rootFacts.unitsToGenerate }],
      units: rootFacts.unitsToGenerate,
      exact: rootFacts.exact,
      needsConfirm: rootFacts.needsConfirm,
      skipped: [],
    };
  }
  // 成员的名字、类型只为了进度条和确认框好看：查不到就用编号
  let named = new Map<string, GenerationTreeNode>();
  try {
    named = new Map((await input.listChildren(root)).map((node) => [node.refno, node]));
  } catch {
    // 用编号
  }
  const counted = await mapBounded(members, PLAN_CHILDREN_CONCURRENCY, async (member) => {
    try {
      return { member, facts: await input.fetchFacts(member) };
    } catch {
      return { member, facts: null };
    }
  });
  const chunks: GenerationChunk[] = [];
  const skipped: string[] = [];
  let exact = rootFacts.exact;
  /** 这些成员里要生成的单元数（问不到的成员按 1 个算） */
  let inMembers = 0;
  for (const { member, facts } of counted) {
    const node = named.get(member);
    if (facts && facts.unitsToGenerate <= 0) {
      skipped.push(member);
      continue;
    }
    const units = facts ? facts.unitsToGenerate : 1;
    if (!facts || !facts.exact) exact = false;
    inMembers += units;
    chunks.push({ refno: member, noun: upper(node?.noun) || 'ZONE', name: node?.name || member, units });
  }
  // 节点要生成的比这些成员加起来多：其余的在「有记录、但只生成了一部分」的成员里，对节点自己补一块
  const remainder = rootFacts.unitsToGenerate - inMembers;
  if (remainder > 0) chunks.push({ refno: root, noun: rootNoun, name: root, units: remainder });
  const units = chunks.reduce((sum, chunk) => sum + chunk.units, 0);
  return {
    ...base,
    chunks,
    units,
    exact,
    needsConfirm: units === rootFacts.unitsToGenerate
      ? rootFacts.needsConfirm
      : rootFacts.thresholdUnits > 0 && units > rootFacts.thresholdUnits,
    skipped,
  };
}

/**
 * 生成预检——**「有多少要生成、分几块」的事实从哪来，只有这一个入口**。
 *
 * 有后端的节点模型状态接口时（`facts`）：单元数、要不要确认、阈值都由后端给，数字是精确的，见 `planFromFacts`。
 * 这时不看库是不是「有成套模型」——接口说缺就补、说不缺就不补。
 *
 * 服务端没有那个接口（旧构建）或没问到时退回过渡办法（沿树往下数两层）：`scopes` 是调用方按老规矩挑出来的、
 * 记录查询里一条记录都没有的范围——节点自己，或者它的成员。一个范围的单元数 ≈ 它的每个子节点「是交付单元算 1 个，
 * 否则算它的子节点数（至少 1）」之和。管道 ZONE 下是 PIPE → BRAN，数出来就是 BRAN 的个数；结构件没有交付单元，
 * 数出来只是个量级。没有子节点的容器没有东西可生成，不进 `chunks`。数不出来（请求失败）的范围按 1 个单元算、照常去生成。
 */
export async function planModelGeneration(input: {
  root: string;
  /** 节点自己的类型；不知道给 `null` */
  rootNoun: string | null;
  scopes: string[];
  listChildren: ListGenerationChildren;
  deliveryUnitTypes?: readonly string[];
  thresholdUnits?: number;
  /** 后端的生成预检。`emptyMembers`：按成员拆开查时一条记录都没有的成员（不含节点自己） */
  facts?: { fetch: FetchGenerationFacts; emptyMembers: string[] };
}): Promise<GenerationPlan> {
  if (input.facts) {
    let rootFacts: GenerationUnitFacts | null = null;
    try {
      rootFacts = await input.facts.fetch(input.root);
    } catch {
      rootFacts = null;
    }
    if (rootFacts) {
      return planFromFacts({
        root: input.root,
        rootNoun: input.rootNoun,
        rootFacts,
        emptyMembers: input.facts.emptyMembers,
        fetchFacts: input.facts.fetch,
        listChildren: input.listChildren,
      });
    }
  }
  const thresholdUnits = input.thresholdUnits ?? GENERATION_CONFIRM_THRESHOLD_UNITS;
  const delivery = new Set((input.deliveryUnitTypes?.length ? input.deliveryUnitTypes : DEFAULT_DELIVERY_UNIT_TYPES).map(upper));
  const childrenOf = async (refno: string): Promise<GenerationTreeNode[] | null> => {
    try {
      return await input.listChildren(refno);
    } catch {
      return null;
    }
  };
  const unitsOfChildren = (children: GenerationTreeNode[]): number => children.reduce(
    (sum, child) => sum + (delivery.has(upper(child.noun)) ? 1 : Math.max(1, child.childrenCount ?? 1)),
    0,
  );

  const chunks: GenerationChunk[] = [];
  const skipped: string[] = [];
  const scopes = Array.from(new Set(input.scopes.filter(Boolean)));
  const rootOnly = scopes.length === 1 && scopes[0] === input.root;

  if (rootOnly) {
    const noun = upper(input.rootNoun);
    if (delivery.has(noun)) {
      chunks.push({ refno: input.root, noun, name: input.root, units: 1 });
    } else {
      const children = await childrenOf(input.root);
      if (children && children.length === 0 && COARSE_CONTAINER_NOUNS.has(noun)) skipped.push(input.root);
      else chunks.push({ refno: input.root, noun, name: input.root, units: children && children.length > 0 ? unitsOfChildren(children) : 1 });
    }
  } else if (scopes.length > 0) {
    const members = new Map((await childrenOf(input.root) ?? []).map((node) => [node.refno, node]));
    const counted = await mapBounded(scopes, PLAN_CHILDREN_CONCURRENCY, async (scope) => {
      const node = members.get(scope);
      if (node && node.childrenCount === 0) return { scope, node, units: 0 };
      const children = await childrenOf(scope);
      return { scope, node, units: children === null ? 1 : unitsOfChildren(children) };
    });
    for (const { scope, node, units } of counted) {
      if (units === 0) skipped.push(scope);
      else chunks.push({ refno: scope, noun: upper(node?.noun) || 'ZONE', name: node?.name || scope, units });
    }
  }

  const units = chunks.reduce((sum, chunk) => sum + chunk.units, 0);
  return {
    root: input.root,
    chunks,
    units,
    exact: false,
    needsConfirm: thresholdUnits > 0 && units > thresholdUnits,
    thresholdUnits,
    skipped,
    rootFacts: null,
  };
}

/** 一块是不是「节点自己」（没有拆成成员） */
export function isWholeNodePlan(plan: GenerationPlan): boolean {
  return plan.chunks.length === 1 && plan.chunks[0]!.refno === plan.root;
}

/** 「约 26 个单元」/「 26 个单元」：沿树数出来的写「约」 */
function unitsText(plan: Pick<GenerationPlan, 'units' | 'exact'>): string {
  return `${plan.exact ? ' ' : '约 '}${plan.units} 个单元`;
}

/**
 * 需确认生成的确认框。已有的模型在问之前就已经显示了，所以有已有模型时是「生成并显示 / 只显示已有的」，
 * 一个都没有时是「生成并显示 / 取消」。
 */
export function describeGenerationConfirm(plan: GenerationPlan, existingShown: boolean): {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
} {
  // 多数时候每一块是一个成员（ZONE）；缺的单元有一部分不在「没有记录的成员」里时，最后还有对节点自己的一块
  const memberChunks = plan.chunks.filter((chunk) => chunk.refno !== plan.root);
  const where = isWholeNodePlan(plan)
    ? ''
    : memberChunks.length === plan.chunks.length
      ? `，分在 ${plan.chunks.length} 个 ${plan.chunks[0]?.noun || 'ZONE'} 里`
      : `，分 ${plan.chunks.length} 块（${memberChunks.length} 个 ${memberChunks[0]?.noun || 'ZONE'}，其余的最后一起生成）`;
  const how = isWholeNodePlan(plan)
    ? '生成要占用后端一段时间，状态栏有进度；超时会自动接着问，不用再点。'
    : '生成要占用后端一段时间：一块一块做，做完一块显示一块，状态栏有进度；超时会自动接着问，不用再点。';
  return {
    title: '生成模型',
    message: existingShown
      ? `这个节点下还有${unitsText(plan)}没有模型${where}（已有的模型已经显示）。${how}`
      : `这个节点还没有模型，要生成${unitsText(plan)}${where}。${how}`,
    confirmText: '生成并显示',
    cancelText: existingShown ? '只显示已有的' : '取消',
  };
}

export type FailedGenerationRoot = {
  /** 失败的生成根（`a_b`） */
  root: string;
  error: string;
  /** 等一等、用同样的请求再问一次就可能补上 */
  retryable: boolean;
};

/** 对一块发一次生成之后的结果 */
export type ChunkGenerateResult = {
  /** 这一块名下现在能显示的构件（`a_b`；记录已经进了缓存） */
  refnos: string[];
  /** 这一发处理到的生成根数（已有的 + 新生成的） */
  roots: number;
  /** 后端还在后台算（504 / 202），稍后再问 */
  pending: boolean;
  failedRoots: FailedGenerationRoot[];
  /** 没有可显示的东西时直接给人看的说明（空分组一类）；没有给 `null` */
  hint: string | null;
};

/** 等一等再问就可能过去的错误码：库 / 根被占着、依赖暂时不可用、初始化门没开、网络断了一下 */
const RETRYABLE_ERROR_CODES = new Set([
  'conflict', 'model_dependency_unavailable', 'ref0_affiliation_unavailable', 'initialization_not_ready', 'network',
]);

/** 记录层把错误折成 `码: 说明`；码在可重试名单里就算可重试 */
export function isRetryableGenerationError(message: string): boolean {
  return RETRYABLE_ERROR_CODES.has(String(message).split(':')[0]!.trim());
}

/** 把记录层的结果（`generateThenCollect`）读成这一块的结论。 */
export function chunkResultFromCollect(chunkRefno: string, result: CollectRecordsResult): ChunkGenerateResult {
  const failedRoots: FailedGenerationRoot[] = [];
  const seen = new Set<string>();
  const push = (root: string, error: string, retryable: boolean): void => {
    if (seen.has(root)) return;
    seen.add(root);
    failedRoots.push({ root, error, retryable });
  };
  for (const failed of result.failedRoots ?? []) push(failed.root, failed.error, failed.retryable);
  for (const [root, message] of Object.entries(result.errors ?? {})) push(root, message, isRetryableGenerationError(message));
  for (const root of result.truncatedRoots ?? []) push(root, '容器展开超出上限，这一根没有处理', false);
  return {
    refnos: refnosOfRecords(result.items),
    roots: result.generationRoots.length,
    pending: result.pending.length > 0,
    failedRoots,
    hint: result.hints?.[chunkRefno] ?? null,
  };
}

/**
 * 一块的结局：`done` 全部生成并显示；`partial` 有不可重试的失败根，其余已显示；`pending` 等到预算用完（或被叫停）
 * 后端还没算完 / 还占着；`failed` 一个构件都没出来而且有失败根；`empty` 跑过了、没有可显示的东西；`skipped` 被叫停时还没轮到。
 */
export type GenerationChunkState = 'done' | 'partial' | 'pending' | 'failed' | 'empty' | 'skipped';

export type GenerationChunkOutcome = {
  chunk: GenerationChunk;
  state: GenerationChunkState;
  /** 这一块已经装进场景的构件 */
  refnos: string[];
  /** 问了几次 */
  attempts: number;
  /** 最后一次回执里的失败根（`pending` 时含可重试的） */
  failedRoots: FailedGenerationRoot[];
  hint: string | null;
};

export type GenerationFillProgress = {
  /** 第几块（0 起）/ 共几块 */
  chunkIndex: number;
  chunkCount: number;
  chunk: GenerationChunk;
  phase: 'generating' | 'loading' | 'waiting';
  /** 这一块第几次问（1 起） */
  attempt: number;
  /** 已经处理完的单元数 / 总数（总数随实际回执修正） */
  unitsDone: number;
  unitsTotal: number;
  /** `waiting`：这次等多久、为什么等 */
  waitMs?: number;
  reason?: string;
};

export type GenerationFillSummary = {
  outcomes: GenerationChunkOutcome[];
  /** 中途被叫停（节点被隐藏 / 以后的「停」） */
  stopped: boolean;
  unitsDone: number;
  /** 这次新装进场景的构件数 */
  shownRefnos: number;
};

/**
 * 分块生成。`generateChunk` 对一块发一次不带 `force` 的生成并回结论（取消 / 服务换代照常往外抛，整次一起停）；
 * `loadChunk` 把新到的构件装进场景。顺序执行：后端的生成吃 CPU，一块一块来，进度也才说得清。
 */
export async function runGenerationFill(input: {
  plan: GenerationPlan;
  generateChunk: (chunk: GenerationChunk, attempt: number) => Promise<ChunkGenerateResult>;
  loadChunk: (chunk: GenerationChunk, refnos: string[]) => Promise<void>;
  onProgress?: (progress: GenerationFillProgress) => void;
  /** 还要不要继续：节点被隐藏了、被叫停了就回 `true` */
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<GenerationFillSummary> {
  const { plan } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? (() => Date.now());
  const shouldStop = input.shouldStop ?? (() => false);
  const outcomes: GenerationChunkOutcome[] = [];
  let stopped = false;
  let unitsDone = 0;
  let unitsAhead = plan.units;
  let shownRefnos = 0;

  for (let index = 0; index < plan.chunks.length; index += 1) {
    const chunk = plan.chunks[index]!;
    if (stopped || shouldStop()) {
      stopped = true;
      outcomes.push({ chunk, state: 'skipped', refnos: [], attempts: 0, failedRoots: [], hint: null });
      continue;
    }
    unitsAhead -= chunk.units;
    // 这一块实际处理到多少个单元：回执给了根数就用它（比沿树数的估计准），没给就用估计
    const handled = (result: ChunkGenerateResult): number => (result.roots > 0 ? result.roots : chunk.units);
    const report = (
      phase: GenerationFillProgress['phase'],
      attempt: number,
      extra: Partial<GenerationFillProgress> = {},
      handledInChunk: number | null = null,
    ): void => {
      input.onProgress?.({
        chunkIndex: index,
        chunkCount: plan.chunks.length,
        chunk,
        phase,
        attempt,
        // 这一块还没回来时按估计算进总数；回来了就按实际的根数算（已生成的也加上它）
        unitsDone: unitsDone + (handledInChunk ?? 0),
        unitsTotal: unitsDone + (handledInChunk ?? chunk.units) + unitsAhead,
        ...extra,
      });
    };
    const startedAt = now();
    const loaded = new Set<string>();
    let attempt = 0;
    let state: GenerationChunkState = 'pending';
    let last: ChunkGenerateResult = { refnos: [], roots: 0, pending: false, failedRoots: [], hint: null };
    for (;;) {
      attempt += 1;
      report('generating', attempt);
      last = await input.generateChunk(chunk, attempt);
      const fresh = last.refnos.filter((refno) => !loaded.has(refno));
      if (fresh.length > 0) {
        report('loading', attempt, {}, handled(last));
        await input.loadChunk(chunk, fresh);
        for (const refno of fresh) loaded.add(refno);
      }
      const retryable = last.failedRoots.filter((failed) => failed.retryable);
      if (!last.pending && retryable.length === 0) {
        if (last.failedRoots.length > 0) state = loaded.size > 0 ? 'partial' : 'failed';
        else state = loaded.size > 0 ? 'done' : 'empty';
        break;
      }
      if (shouldStop()) {
        stopped = true;
        break;
      }
      const delays = generationResumeTiming.delaysMs;
      const waitMs = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
      if (now() - startedAt + waitMs > generationResumeTiming.budgetMs) break;
      report('waiting', attempt, {
        waitMs,
        reason: last.pending ? '后端还在后台生成' : retryable[0]!.error,
      });
      await sleep(waitMs);
      if (shouldStop()) {
        stopped = true;
        break;
      }
    }
    // 进度的分子按实际处理到的根数记；还没做完的块只记已经回来的那部分
    unitsDone += state === 'pending' ? last.roots : handled(last);
    shownRefnos += loaded.size;
    outcomes.push({ chunk, state, refnos: [...loaded], attempts: attempt, failedRoots: last.failedRoots, hint: last.hint });
  }
  return { outcomes, stopped, unitsDone, shownRefnos };
}

/** 还没做完、之后可以接着做的块（等到预算用完的、被叫停没轮到的、整块失败但可重试的）。 */
export function remainingGenerationChunks(summary: GenerationFillSummary): GenerationChunk[] {
  return summary.outcomes
    .filter((outcome) => outcome.state === 'pending' || outcome.state === 'skipped')
    .map((outcome) => outcome.chunk);
}

const MAX_FAILED_ROOTS_SHOWN = 5;

/** 结束时给人看的一句话：做成了多少、还剩什么、哪几个生成根失败了（点名，最多列 5 个）。 */
export function describeGenerationFillSummary(summary: GenerationFillSummary): { level: 'success' | 'info' | 'warning'; message: string } {
  const shownChunks = summary.outcomes.filter((outcome) => outcome.refnos.length > 0);
  const pending = summary.outcomes.filter((outcome) => outcome.state === 'pending');
  const skipped = summary.outcomes.filter((outcome) => outcome.state === 'skipped');
  const empty = summary.outcomes.filter((outcome) => outcome.state === 'empty');
  // 可重试的失败只会留在「还没做完」的块里（别的块要么等到它们过去，要么预算用完记成 pending），那些算「稍后接着做」，不算失败
  const failedRoots = summary.outcomes.flatMap((outcome) => outcome.failedRoots.filter((failed) => !failed.retryable));
  const parts: string[] = [];
  const multi = summary.outcomes.length > 1;
  if (shownChunks.length > 0) {
    parts.push(multi
      ? `已生成并显示 ${shownChunks.length} 块（${summary.shownRefnos} 个构件）`
      : `已生成并显示 ${summary.shownRefnos} 个构件`);
  }
  if (pending.length > 0) {
    parts.push(multi
      ? `${pending.length} 块后端还没做完（${pending.map((outcome) => outcome.chunk.name).slice(0, 3).join('、')}${pending.length > 3 ? ' 等' : ''}），稍后接着生成`
      : '后端还没做完，稍后接着生成');
  }
  if (skipped.length > 0) parts.push(`已停止，${skipped.length} 块没有生成`);
  if (failedRoots.length > 0) {
    const named = failedRoots.slice(0, MAX_FAILED_ROOTS_SHOWN).map((failed) => `${failed.root}（${failed.error}）`).join('；');
    parts.push(`${failedRoots.length} 个生成根失败：${named}${failedRoots.length > MAX_FAILED_ROOTS_SHOWN ? `；等 ${failedRoots.length} 个` : ''}`);
  }
  if (empty.length > 0) {
    if (multi) parts.push(`${empty.length} 块没有可显示的模型`);
    else if (parts.length === 0) parts.push(empty[0]!.hint ?? '生成未产出可显示模型');
  }
  const troubled = pending.length > 0 || skipped.length > 0 || failedRoots.length > 0;
  return {
    level: troubled ? (failedRoots.length > 0 ? 'warning' : 'info') : shownChunks.length > 0 ? 'success' : 'info',
    message: parts.join('；') || '生成未产出可显示模型',
  };
}
