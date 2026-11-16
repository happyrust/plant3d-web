/**
 * gen-model-v1 的 `ModelRecordSource`（plan P3-a/e；ADR 0069）：`refno[] → Map<refno, InstanceEntry[]>`。
 *
 * 调用方（`useDbnoInstancesDtxLoader`）给的是**构件级** refno（`visibleInsts` 回的那些），而 gen-model 的记录是按**生成根**
 * 投影的、`model/records` 以任何一个节点为祖先回整个子树里已生成的记录（gen-model ADR-086）。所以这里按根收、按构件缓存：
 * 第一个构件的查询把它所在根的整根记录拉回来并写进缓存，同根的其它构件直接命中，一根只查一次。缓存在进程内、按 refno 键；
 * `forceRefresh` 清掉请求到的 refno 再问一次。
 *
 * **查询只查、不生成**：`collectByAncestor` / `instanceEntriesByRefnos` 不会调 `model/generate`（源码钉 `display_never_generates`）。
 * 生成统一走 `generateThenCollect`：先把这条请求名下已缓存的根清掉，generate 完再按祖先查、进缓存。
 * 调用方除了右键「重新生成模型」，还有显示路径的「库无模型 / 节点查空 → 默认重新生成」（useModelGeneration）。
 *
 * `dbno` 只是调用方的分桶键（服务端自己解库归属），这里不用它选数据。
 */
import { groupInstanceEntriesByRefno } from './instanceMapping';
import {
  collectRecordsByAncestor,
  collectRecordsForAncestors,
  defaultModelRecordsApi,
  generateThenCollect as generateThenCollectRecords,
  mapWithConcurrency,
  ownersOfRecords,
  refnosOfRecords,
  type CollectAncestorsResult,
  type CollectRecordsOptions,
  type CollectRecordsResult,
  type GenerateThenCollectOptions,
  type ModelRecordsApi,
  type RecordPageListener,
} from './modelRecords';

import type { InstanceEntryQueryOptions, ModelRecordSource } from '../ports';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { fromV1Refno, type GeomInstQuery } from '@/api/genModelV1Api';
import {
  createGenModelV1GenerationGuard,
  getGenModelV1ServiceGeneration,
  type GenModelV1GenerationGuard,
} from '@/model-source/genModelV1/serviceLifecycle';

/** `instanceEntriesByRefnos` 里缓存没有的构件同时在飞的按祖先查询数（浏览器对同一主机 HTTP/1.1 也只开 6 条连接）。 */
export const MISSING_REFNO_QUERY_CONCURRENCY = 6;

/** 一次取数里每处理完一个祖先 / 生成根发一条（右键重新生成的进度弹窗接它）。 */
export type GenModelV1RecordsProgress = {
  /** 这次请求的节点（`a_b`） */
  refno: string;
  /** 刚处理完 / 正在处理的祖先或生成根（`a_b`） */
  root: string;
  /**
   * 阶段：`generate-start` = 对这一根的 `model/generate` 刚发出（在飞）；`generate` = 一根生成收口；
   * `collect` = 一个祖先的记录查完。缺省（旧 mock / 手写事件）按 `collect` 理解。
   */
  stage?: 'generate-start' | 'generate' | 'collect';
  /** 已处理 / 目前已知总数（容器还在展开时总数会长） */
  done: number;
  total: number;
};

/**
 * 按成员拆开查（`expandAncestor`：顶层 SITE → 它的 ZONE）时，一个成员收完交出来的那一批（边取边画，方案 2026-11-10 A3）。
 * 交出来的时候这一批已经进了缓存。
 */
export type GenModelV1MemberRecords = {
  /** 这次请求的节点（`a_b`） */
  refno: string;
  /** 刚收完的成员（`a_b`） */
  member: string;
  /** 这个成员名下有记录的构件 → 实例。与缓存里是同一份数组，订阅方只读。 */
  entries: Map<string, InstanceEntry[]>;
  /** 已收完的成员数 / 成员总数 */
  done: number;
  total: number;
};

export type GenModelV1ModelRecordSource = ModelRecordSource & {
  /**
   * 显示一个节点：以它为祖先查已生成的记录并把整根记录映射进缓存。同一节点的干净结果备忘一份——树勾一次眼睛会让
   * `visibleInsts(节点)` 被问两遍（加载范围 + 可见性传播），第二遍直接回备忘，不再对同一个 SITE 重打一轮。
   * `options.onRecordPage`：这次查询读到的每一页交一次，别的节点的查询读到的页不会交到这里。同一节点同时被问、共用一发读取时，
   * 各方的回调都收这一发的页（后搭上的只收搭上之后读到的）；命中备忘时没有页可交。
   */
  collectByAncestor(refno: string, options?: CollectRecordsOptions): Promise<CollectRecordsResult>;
  /**
   * 右键「重新生成模型」：先把这条请求名下已缓存的根连同构件清掉，`model/generate(force)` → 容器有界展开 → 按祖先重查、进缓存。
   * 回了 pending / timeout 的根不显示（`items` 里没有它们新算的产物），调用方按 `pending` 提示。
   */
  generateThenCollect(refno: string, options?: GenerateThenCollectOptions): Promise<CollectRecordsResult>;
  /**
   * 订阅所有取数的逐根进度（不论谁发起：树的 visibleInsts、几何加载、整库入口、右键重新生成）。
   * 显示流程拿不到 visibleInsts 内部那次查询的回调，只能从这里听。返回退订函数。
   */
  subscribeProgress(listener: (progress: GenModelV1RecordsProgress) => void): () => void;
  /**
   * 订阅「按成员拆开查」时每个成员收完的那一批（不论谁发起的查询）：显示流程据此边取边画，不等整个节点收齐。
   * 只有拆得开的节点（顶层 SITE）才有批次；一发查完的节点、命中备忘的查询都不发。查空 / 409 / 出错的成员不交，
   * 它们的去向在 `collectByAncestor` 的最终结果里。订阅之前已经交过的批次不补发——那些构件由最终结果兜底。返回退订函数。
   */
  subscribeMemberRecords(listener: (batch: GenModelV1MemberRecords) => void): () => void;
  /**
   * 叫停对这个节点正在进行的那次共用读取（加载中可以停，2026-11-11）：在飞的请求取消、后面的成员不再发，
   * 那次读取以 `cancelled` 收口（在等它的调用方都收到）。叫停之前已经收齐的成员留在缓存里——再读这个节点时只问没收齐的。
   * 没有在读回 `false`。带着自己 `signal` / `onRootDone` / `onRequestFailure` 的读取不是共用的，由它们自己的 `signal` 管
   * （只带 `onRecordPage` 的仍是共用的）。
   */
  cancelCollect(refno: string): boolean;
  /** 缓存里某构件的实例（不发请求）。 */
  peek(refno: string): InstanceEntry[] | undefined;
  /** 清缓存：不传清全部，传了只清这些 refno。 */
  invalidate(refnos?: string[]): void;
  /** 已经收过记录的生成根（`a_b`）。 */
  collectedRoots(): string[];
  /** 某根下缓存过的全部构件 refno（含根自己）。 */
  leavesOfRoot(root: string): string[];
  /** 把一根连同它的构件从缓存里清掉；返回被清掉的构件 refno。 */
  invalidateRoot(root: string): string[];
};

export type GenModelV1ModelRecordSourceOptions = {
  api?: ModelRecordsApi;
  recordsOptions?: Pick<CollectRecordsOptions, 'pageSize' | 'concurrency'>;
  /** 右键重新生成的容器展开上限；缺省见 `generateThenCollect` */
  generateOptions?: Pick<GenerateThenCollectOptions, 'maxContainerDepth' | 'maxRoots'>;
  /** 生产组装点注入合并去重的 health freshness；低层单测缺省不发额外请求。 */
  ensureFreshness?: () => Promise<unknown>;
  noteRequestFailure?: (error: unknown) => void;
  /**
   * 按祖先查之前把节点换成它的成员逐个查（`collectRecordsForAncestors` 有界并发）：回 `null` / 空数组就照常整节点查。
   * 组装点给顶层 SITE 用——整 SITE 一发 `model/records` 在服务端是串行的一条大查询（实测 50 个 ZONE 的 SITE 7.7 s 后 500），
   * 拆成 ZONE 并行查既快又不撞服务端的单次上限。只能拆到生成根之上：BRAN 一类生成根自己就挂着隐式管身记录。
   */
  expandAncestor?: (refno: string, signal: AbortSignal) => Promise<string[] | null>;
  /**
   * 拆成成员查时一发 `model/records` 带几个成员（批量形，`CollectRecordsOptions.batchAncestors`）。不给或回 1：一个成员一发。
   * 每次读取开始时问一次，`members` 是这次还要向服务端问的成员数——组装点按 `/health.capabilities` 和成员多少给
   * （后端声明了批量形、成员够多才打包）。只管拆开查的那一路；不拆的节点、整库显示逐 SITE、生成之后的回查都仍是一个祖先一发。
   */
  memberBatchSize?: (members: number) => number;
};

export function createGenModelV1ModelRecordSource(options: GenModelV1ModelRecordSourceOptions = {}): GenModelV1ModelRecordSource {
  const api = options.api ?? defaultModelRecordsApi;
  const ensureFreshness = options.ensureFreshness ?? (() => Promise.resolve());
  const noteRequestFailure = options.noteRequestFailure ?? ((error: unknown) => { void error; });
  const entriesByRefno = new Map<string, InstanceEntry[]>();
  /** 生成根（a_b）→ 它这次 records 里出现过的构件 refno（含根自己） */
  const leavesByRoot = new Map<string, Set<string>>();
  /**
   * 请求节点（a_b）→ 上一次干净的查询结果（备忘）。任何 invalidate 都把它整个清掉（只是个备忘，最坏多一轮请求）。
   */
  const resultsByRequested = new Map<string, CollectRecordsResult>();
  const progressListeners = new Set<(progress: GenModelV1RecordsProgress) => void>();

  function subscribeProgress(listener: (progress: GenModelV1RecordsProgress) => void): () => void {
    progressListeners.add(listener);
    return () => { progressListeners.delete(listener); };
  }

  function emitProgress(
    requested: string,
    progress: { done: number; total: number; root: string },
    stage: NonNullable<GenModelV1RecordsProgress['stage']>,
  ): void {
    if (progressListeners.size === 0) return;
    const event: GenModelV1RecordsProgress = {
      refno: requested,
      root: progress.root,
      stage,
      done: progress.done,
      total: progress.total,
    };
    for (const listener of progressListeners) {
      try { listener(event); } catch { /* 监听方的异常不影响取数 */ }
    }
  }

  const memberListeners = new Set<(batch: GenModelV1MemberRecords) => void>();

  function subscribeMemberRecords(listener: (batch: GenModelV1MemberRecords) => void): () => void {
    memberListeners.add(listener);
    return () => { memberListeners.delete(listener); };
  }

  function emitMemberRecords(batch: GenModelV1MemberRecords): void {
    for (const listener of memberListeners) {
      try { listener(batch); } catch { /* 订阅方的异常不影响取数 */ }
    }
  }

  /** 一批记录映射成实例并归档：构件按 refno 进缓存、挂到它的生成根名下。回映射结果（`refno → 实例`）。 */
  function archiveRecords(items: GeomInstQuery[]): Map<string, InstanceEntry[]> {
    const grouped = groupInstanceEntriesByRefno(items);
    for (const [key, entries] of grouped) {
      entriesByRefno.set(key, entries);
      // records 的 owner 就是生成根（不是直接属主），按它归档
      const root = entries[0] ? String(entries[0].uniforms?.owner_refno ?? '') : '';
      if (root) {
        let leaves = leavesByRoot.get(root);
        if (!leaves) {
          leaves = new Set<string>();
          leavesByRoot.set(root, leaves);
        }
        leaves.add(key);
      }
    }
    return grouped;
  }

  function noteGenerationRoots(roots: Iterable<string>): void {
    for (const root of roots) {
      if (!leavesByRoot.has(root)) leavesByRoot.set(root, new Set<string>());
      leavesByRoot.get(root)!.add(root);
    }
  }

  /**
   * 一次取数的结果进缓存：构件按 refno、生成根按 owner 归档、没几何的根记空数组。
   * `alreadyArchived`：边取边画时已经按成员归档过的构件——不重新映射（成员是整棵子树，一个构件的记录不会跨成员；
   * 重映射既白算一遍矩阵，又会把已经交给装载器的那份数组换成另一份）。
   */
  function absorbRecords(
    result: Pick<CollectRecordsResult, 'items' | 'generationRoots' | 'empty'>,
    alreadyArchived?: ReadonlySet<string>,
  ): void {
    archiveRecords(
      alreadyArchived && alreadyArchived.size > 0
        ? result.items.filter((record) => !alreadyArchived.has(fromV1Refno(record.refno)))
        : result.items,
    );
    noteGenerationRoots(result.generationRoots);
    // 明确知道没有几何的节点也记一笔空数组，下一次同一个 refno 不再查
    for (const key of result.empty) {
      if (!entriesByRefno.has(key)) entriesByRefno.set(key, []);
    }
  }

  function isResolved(result: CollectRecordsResult): boolean {
    return result.pending.length === 0 && result.truncatedRoots.length === 0 && Object.keys(result.errors).length === 0;
  }

  /** 干净的结果：只把请求的节点记一笔（没有记录的记空数组）。generationRoots 只是「这批 item 属于哪些根」，
   * 不代表那些根被查过——祖先=构件时只回了构件自己，给根记 [] 会让 instanceEntriesByRefnos 把根当成查过、
   * 整条根的 records（含 TUBI）永远不再取。 */
  function rememberResolved(requested: string, result: CollectRecordsResult): void {
    if (!isResolved(result)) return;
    if (!entriesByRefno.has(requested)) entriesByRefno.set(requested, []);
    resultsByRequested.set(requested, result);
  }

  function withLifecycleHooks<T extends CollectRecordsOptions>(
    requested: string,
    extra: T,
    guard: GenModelV1GenerationGuard,
    stage: 'generate' | 'collect',
  ): T {
    const externalRootDone = extra.onRootDone;
    const externalRootStart = (extra as GenerateThenCollectOptions).onRootStart;
    const externalRequestFailure = extra.onRequestFailure;
    return {
      ...extra,
      signal: guard.signal,
      // `collect*` 没有 onRootStart 概念，多给的键无人调用，带上只为让 generate 路径把「正在生成」广播出去
      onRootStart: (progress: { done: number; total: number; root: string }) => {
        externalRootStart?.(progress);
        emitProgress(requested, progress, 'generate-start');
      },
      onRootDone: (progress: { done: number; total: number; root: string }) => {
        externalRootDone?.(progress);
        emitProgress(requested, progress, stage);
      },
      onRequestFailure: (error: unknown) => {
        noteRequestFailure(error);
        externalRequestFailure?.(error);
      },
    } as T;
  }

  /**
   * 同一节点、不带取消信号与回调的并发查询共用一发（树的可见性传播、选中联动与显示流程常同时问同一个节点）。
   * 每一发带着自己的取消开关：`cancelCollect` 用它叫停。分页回调（`onRecordPage`）不妨碍共用：搭上同一发的各方的回调都挂在
   * 这一发上（`pageListeners`），这一发读到的页每个回调交一遍——页跟着读取走，不会交给问别的节点的人。
   */
  const inflightByRequested = new Map<string, {
    task: Promise<CollectRecordsResult>;
    controller: AbortController;
    pageListeners: Set<RecordPageListener>;
  }>();

  async function collectByAncestor(refno: string, extra: CollectRecordsOptions = {}): Promise<CollectRecordsResult> {
    const requested = fromV1Refno(refno);
    const shareable = !extra.signal && !extra.onRootDone && !extra.onRequestFailure;
    if (!shareable) return collectByAncestorOnce(requested, extra);
    const { onRecordPage, ...shared } = extra;
    const inflight = inflightByRequested.get(requested);
    if (inflight) {
      // 搭上已经在读的那一发：之后读到的页也交给它；已经翻过去的不补（那些网格到装载时再取）
      if (onRecordPage) inflight.pageListeners.add(onRecordPage);
      return inflight.task;
    }
    const controller = new AbortController();
    const pageListeners = new Set<RecordPageListener>();
    if (onRecordPage) pageListeners.add(onRecordPage);
    const task = collectByAncestorOnce(requested, {
      ...shared,
      signal: controller.signal,
      onRecordPage: (items) => {
        for (const listener of pageListeners) {
          try { listener(items); } catch { /* 一方的回调出错不影响读取，也不影响别的回调 */ }
        }
      },
    }).finally(() => {
      pageListeners.clear();
      if (inflightByRequested.get(requested)?.task === task) inflightByRequested.delete(requested);
    });
    inflightByRequested.set(requested, { task, controller, pageListeners });
    return task;
  }

  function cancelCollect(refno: string): boolean {
    const requested = fromV1Refno(refno);
    const inflight = inflightByRequested.get(requested);
    if (!inflight) return false;
    // 先摘掉再取消：叫停之后马上再读这个节点，开的是新的一次，不会拿到这一次
    inflightByRequested.delete(requested);
    inflight.controller.abort(new Error('已停止加载'));
    return true;
  }

  /**
   * 一个成员按祖先查到的记录记在它自己名下（与单独问它得到的结果相同）：读到一半被叫停、或之后单独显示这个成员时不用再问服务端。
   * 只记收齐且有记录的成员；任何 invalidate 都会连它一起清掉。
   */
  function rememberMember(member: string, items: GeomInstQuery[]): void {
    rememberResolved(member, {
      refno: member,
      generationRoots: ownersOfRecords(items),
      items,
      pending: [],
      empty: [],
      truncatedRoots: [],
      errors: {},
      statuses: {},
    });
  }

  /** 这些记录在缓存里现成的实例（`refno → 实例`）；有一个构件不在缓存里就回 `null`（重新映射） */
  function archivedEntriesOf(items: GeomInstQuery[]): Map<string, InstanceEntry[]> | null {
    const out = new Map<string, InstanceEntry[]>();
    for (const key of refnosOfRecords(items)) {
      const entries = entriesByRefno.get(key);
      if (!entries) return null;
      out.set(key, entries);
    }
    return out;
  }

  /** 一个成员收完交出来的那一批；`archived` = 它是之前留着的成员，实例已经在缓存里 */
  type MemberBatch = { ancestor: string; items: GeomInstQuery[]; done: number; total: number; archived?: boolean };

  /** 拆成成员查时一发带几个成员（`members` = 这次还要向服务端问的成员数）；组装点没给、给的不是正整数、或它自己抛了错，都按 1。 */
  function memberBatchSizeNow(members: number): number {
    try {
      const size = Math.floor(Number(options.memberBatchSize?.(members) ?? 1));
      return Number.isFinite(size) && size > 1 ? size : 1;
    } catch {
      return 1;
    }
  }

  /**
   * 按祖先查一次；节点能拆（`expandAncestor`）就换成它的成员有界并发查，结果形状不变、`refno` 仍是请求的节点。
   * `onMemberRecords`：拆开查时每个成员收完交一次（边取边画）；不拆的节点不会调它。
   */
  async function collectFresh(
    requested: string,
    extra: CollectRecordsOptions,
    guard: GenModelV1GenerationGuard,
    onMemberRecords?: (batch: MemberBatch) => void,
  ): Promise<CollectRecordsResult> {
    const hooked = withLifecycleHooks(requested, { ...options.recordsOptions, ...extra }, guard, 'collect');
    const members = options.expandAncestor ? await options.expandAncestor(requested, guard.signal) : null;
    guard.assertCurrent();
    if (!members || members.length === 0) return collectRecordsByAncestor(requested, hooked, api);

    // 已经收齐过的成员（上一次读到一半被叫停留下的、或这个成员自己单独显示过）不再问服务端，一上来就算完成
    const total = members.length;
    const known = new Map<string, CollectRecordsResult>();
    for (const member of members) {
      const remembered = resultsByRequested.get(member);
      if (remembered) known.set(member, remembered);
    }
    const callerOnAncestorRecords = hooked.onAncestorRecords;
    const items: GeomInstQuery[] = [];
    const generationRoots: string[] = [];
    const empty: string[] = [];
    let done = 0;
    for (const [member, remembered] of known) {
      done += 1;
      hooked.onRootDone?.({ done, total, root: member });
      if (remembered.items.length === 0) {
        empty.push(member);
        continue;
      }
      items.push(...remembered.items);
      for (const root of remembered.generationRoots) if (!generationRoots.includes(root)) generationRoots.push(root);
      const batch = { ancestor: member, items: remembered.items, done, total };
      try { callerOnAncestorRecords?.(batch); } catch { /* 同 collectRecordsForAncestors：消费方出错不影响读取 */ }
      onMemberRecords?.({ ...batch, archived: true });
    }

    const unknown = known.size === 0 ? members : members.filter((member) => !known.has(member));
    const collected: CollectAncestorsResult = unknown.length === 0
      ? { ancestors: [], generationRoots: [], items: [], pending: [], empty: [], errors: {} }
      : await collectRecordsForAncestors(unknown, {
        ...hooked,
        batchAncestors: memberBatchSizeNow(unknown.length),
        onRootDone: (progress) => hooked.onRootDone?.({ done: known.size + progress.done, total, root: progress.root }),
        onAncestorRecords: (batch) => {
          const merged = { ...batch, done: known.size + batch.done, total };
          callerOnAncestorRecords?.(merged);
          onMemberRecords?.(merged);
        },
      }, api);
    items.push(...collected.items);
    for (const root of collected.generationRoots) if (!generationRoots.includes(root)) generationRoots.push(root);
    empty.push(...collected.empty);
    const settled = collected.pending.length === 0 && Object.keys(collected.errors).length === 0;
    return {
      refno: requested,
      generationRoots,
      items,
      pending: collected.pending,
      empty: settled && items.length === 0 ? [...empty, requested] : empty,
      truncatedRoots: [],
      errors: collected.errors,
      statuses: {},
    };
  }

  async function collectByAncestorOnce(requested: string, extra: CollectRecordsOptions): Promise<CollectRecordsResult> {
    // 备忘是长期正缓存，只能在 health 确认服务代次之后命中；没命中时请求本来就打到当前服务，与 health 并行，
    // 写回缓存前再等它收口。这一轮 health 若查出换代（旧流程里那是请求发出之前），缓存已随换代清掉，重查一次；
    // 请求途中别处查出的换代仍按原样报错。
    const generationAtStart = getGenModelV1ServiceGeneration();
    let generationWhenFresh: number | null = null;
    let freshnessError: unknown = null;
    const freshness = ensureFreshness().then(
      () => { generationWhenFresh = getGenModelV1ServiceGeneration(); },
      (error: unknown) => { freshnessError = error; throw error; },
    );
    freshness.catch(() => undefined);
    if (resultsByRequested.has(requested)) await freshness;
    for (let attempt = 0; ; attempt++) {
      const guard = createGenModelV1GenerationGuard(extra.signal);
      // 边取边画：成员收完就归档并交给订阅方。归档与整次读取守同一条规矩——health 确认过服务代次之后才进缓存，
      // 没确认时先攒着；这次读取已经作废（取消 / 换代）就丢掉。
      const archivedEarly = new Set<string>();
      const heldMembers: MemberBatch[] = [];
      let freshnessConfirmed = false;
      const handOverMember = (batch: MemberBatch): void => {
        if (guard.signal.aborted) return;
        // 留着的成员（`archived`）实例已经在缓存里，不重新映射；缓存里对不上才重来一遍
        const entries = (batch.archived ? archivedEntriesOf(batch.items) : null) ?? archiveRecords(batch.items);
        for (const key of entries.keys()) archivedEarly.add(key);
        if (!batch.archived) rememberMember(batch.ancestor, batch.items);
        emitMemberRecords({ refno: requested, member: batch.ancestor, entries, done: batch.done, total: batch.total });
      };
      void freshness.then(() => {
        freshnessConfirmed = true;
        for (const batch of heldMembers.splice(0)) handOverMember(batch);
      }, () => undefined);
      try {
        // 取消要先于缓存命中：已经 abort 的 signal 不能拿着备忘结果「成功」返回
        guard.assertCurrent();
        const remembered = resultsByRequested.get(requested);
        if (remembered) {
          await freshness;
          guard.assertCurrent();
          return remembered;
        }
        const result = await collectFresh(requested, extra, guard, (batch) => {
          if (freshnessConfirmed) handOverMember(batch);
          else heldMembers.push(batch);
        });
        await freshness;
        guard.assertCurrent();
        absorbRecords(result, archivedEarly);
        rememberResolved(requested, result);
        return result;
      } catch (error) {
        if (error !== freshnessError) noteRequestFailure(error);
        if (attempt === 0 && !extra.signal?.aborted && getGenModelV1ServiceGeneration() !== guard.generation) {
          await freshness.catch(() => undefined);
          if (generationWhenFresh !== null && generationWhenFresh !== generationAtStart) continue;
        }
        // 取消 / 换代盖过途中先抛出来的那个错：调用方拿到的分型只看这次读取的收口原因
        guard.assertCurrent();
        throw error;
      } finally {
        guard.dispose();
      }
    }
  }

  async function generateThenCollect(refno: string, extra: GenerateThenCollectOptions = {}): Promise<CollectRecordsResult> {
    await ensureFreshness();
    const requested = fromV1Refno(refno);
    const guard = createGenModelV1GenerationGuard(extra.signal);
    try {
      guard.assertCurrent();
      // 重算过的产物不能被当成「已经有了」：这条请求名下已知的根连同构件先清掉，备忘也清
      const remembered = resultsByRequested.get(requested);
      for (const root of remembered?.generationRoots ?? []) invalidateRoot(root);
      invalidateRoot(requested);
      const result = await generateThenCollectRecords(
        requested,
        withLifecycleHooks(requested, { ...options.recordsOptions, ...options.generateOptions, ...extra }, guard, 'generate'),
        api,
      );
      guard.assertCurrent();
      // generate 回执点名的根（含旧缓存里没见过的）也清一遍，再吸收这次查回来的新记录
      for (const root of result.generationRoots) invalidateRoot(root);
      absorbRecords(result);
      rememberResolved(requested, result);
      return result;
    } catch (error) {
      noteRequestFailure(error);
      guard.assertCurrent();
      throw error;
    } finally {
      guard.dispose();
    }
  }

  async function instanceEntriesByRefnos(
    _dbno: number,
    refnos: string[],
    queryOptions: InstanceEntryQueryOptions = {},
  ): Promise<Map<string, InstanceEntry[]>> {
    await ensureFreshness();
    const guard = createGenModelV1GenerationGuard();
    const keys = Array.from(new Set(refnos.map((r) => fromV1Refno(String(r ?? ''))).filter(Boolean)));
    try {
      if (queryOptions.forceRefresh) invalidate(keys);
      // 以缺的 refno 为祖先查（ADR-086：generation_root 参数语义=祖先子树），只查，不生成。key 是生成根时整根记录一次进缓存，
      // 同根的其它构件多半就命中了；key 是构件时只回它自己。所以第一个单独查，其余有界并发，轮到时再看一眼缓存。
      const fillMissing = async (key: string): Promise<void> => {
        if (entriesByRefno.has(key)) return;
        const collected = await collectByAncestor(key);
        guard.assertCurrent();
        // 只有完整收口后才能把「记录里没有该构件」负缓存为 []。pending（库被整库任务占用）或临时错误
        // 都必须保持未缓存，下一次显示才能重新查。
        if (isResolved(collected) && !entriesByRefno.has(key)) entriesByRefno.set(key, []);
      };
      const missing = keys.filter((key) => !entriesByRefno.has(key));
      if (missing.length > 0) {
        await fillMissing(missing[0]!);
        await mapWithConcurrency(missing.slice(1), MISSING_REFNO_QUERY_CONCURRENCY, fillMissing);
      }
      const out = new Map<string, InstanceEntry[]>();
      for (const key of keys) out.set(key, entriesByRefno.get(key) ?? []);
      guard.assertCurrent();
      return out;
    } finally {
      guard.dispose();
    }
  }

  function peek(refno: string): InstanceEntry[] | undefined {
    return entriesByRefno.get(fromV1Refno(refno));
  }

  function invalidate(refnos?: string[]): void {
    resultsByRequested.clear();
    inflightByRequested.clear();
    if (!refnos) {
      entriesByRefno.clear();
      leavesByRoot.clear();
      return;
    }
    for (const refno of refnos) entriesByRefno.delete(fromV1Refno(refno));
  }

  function collectedRoots(): string[] {
    return Array.from(leavesByRoot.keys());
  }

  function leavesOfRoot(root: string): string[] {
    return Array.from(leavesByRoot.get(fromV1Refno(root)) ?? []);
  }

  function invalidateRoot(root: string): string[] {
    resultsByRequested.clear();
    inflightByRequested.clear();
    const key = fromV1Refno(root);
    const leaves = leavesOfRoot(key);
    for (const leaf of leaves) entriesByRefno.delete(leaf);
    entriesByRefno.delete(key);
    leavesByRoot.delete(key);
    return leaves.includes(key) ? leaves : [key, ...leaves];
  }

  return {
    instanceEntriesByRefnos, collectByAncestor, generateThenCollect, subscribeProgress, subscribeMemberRecords,
    cancelCollect, peek, invalidate, collectedRoots, leavesOfRoot, invalidateRoot,
  };
}
