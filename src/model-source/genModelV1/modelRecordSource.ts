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
  defaultModelRecordsApi,
  generateThenCollect as generateThenCollectRecords,
  type CollectRecordsOptions,
  type CollectRecordsResult,
  type GenerateThenCollectOptions,
  type ModelRecordsApi,
} from './modelRecords';

import type { InstanceEntryQueryOptions, ModelRecordSource } from '../ports';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { fromV1Refno } from '@/api/genModelV1Api';
import { createGenModelV1GenerationGuard, type GenModelV1GenerationGuard } from '@/model-source/genModelV1/serviceLifecycle';

/** 一次取数里每处理完一个祖先 / 生成根发一条（右键重新生成的进度弹窗接它）。 */
export type GenModelV1RecordsProgress = {
  /** 这次请求的节点（`a_b`） */
  refno: string;
  /** 刚处理完的祖先 / 生成根（`a_b`） */
  root: string;
  /** 已处理 / 目前已知总数（容器还在展开时总数会长） */
  done: number;
  total: number;
};

export type GenModelV1ModelRecordSource = ModelRecordSource & {
  /**
   * 显示一个节点：以它为祖先查已生成的记录并把整根记录映射进缓存。同一节点的干净结果备忘一份——树勾一次眼睛会让
   * `visibleInsts(节点)` 被问两遍（加载范围 + 可见性传播），第二遍直接回备忘，不再对同一个 SITE 重打一轮。
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

  function emitProgress(requested: string, progress: { done: number; total: number; root: string }): void {
    if (progressListeners.size === 0) return;
    const event: GenModelV1RecordsProgress = { refno: requested, root: progress.root, done: progress.done, total: progress.total };
    for (const listener of progressListeners) {
      try { listener(event); } catch { /* 监听方的异常不影响取数 */ }
    }
  }

  /** 一次取数的结果进缓存：构件按 refno、生成根按 owner 归档、没几何的根记空数组。 */
  function absorbRecords(result: Pick<CollectRecordsResult, 'items' | 'generationRoots' | 'empty'>): void {
    for (const [key, entries] of groupInstanceEntriesByRefno(result.items)) {
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
    for (const root of result.generationRoots) {
      if (!leavesByRoot.has(root)) leavesByRoot.set(root, new Set<string>());
      leavesByRoot.get(root)!.add(root);
    }
    // 明确知道没有几何的节点也记一笔空数组，下一次同一个 refno 不再查
    for (const key of result.empty) {
      if (!entriesByRefno.has(key)) entriesByRefno.set(key, []);
    }
  }

  function isResolved(result: CollectRecordsResult): boolean {
    return result.pending.length === 0 && result.truncatedRoots.length === 0 && Object.keys(result.errors).length === 0;
  }

  /** 干净的结果：请求的节点自己与它名下的根都记一笔（没有记录的记空数组），下一次把「根 + 构件」一起交来时不再为它们重查。 */
  function rememberResolved(requested: string, result: CollectRecordsResult): void {
    if (!isResolved(result)) return;
    for (const key of [requested, ...result.generationRoots]) {
      if (key && !entriesByRefno.has(key)) entriesByRefno.set(key, []);
    }
    resultsByRequested.set(requested, result);
  }

  function withLifecycleHooks<T extends CollectRecordsOptions>(requested: string, extra: T, guard: GenModelV1GenerationGuard): T {
    const externalRootDone = extra.onRootDone;
    const externalRequestFailure = extra.onRequestFailure;
    return {
      ...extra,
      signal: guard.signal,
      onRootDone: (progress: { done: number; total: number; root: string }) => {
        externalRootDone?.(progress);
        emitProgress(requested, progress);
      },
      onRequestFailure: (error: unknown) => {
        noteRequestFailure(error);
        externalRequestFailure?.(error);
      },
    };
  }

  async function collectByAncestor(refno: string, extra: CollectRecordsOptions = {}): Promise<CollectRecordsResult> {
    await ensureFreshness();
    const requested = fromV1Refno(refno);
    const guard = createGenModelV1GenerationGuard(extra.signal);
    try {
      // 取消要先于缓存命中：已经 abort 的 signal 不能拿着备忘结果「成功」返回
      guard.assertCurrent();
      const remembered = resultsByRequested.get(requested);
      if (remembered) return remembered;
      const result = await collectRecordsByAncestor(requested, withLifecycleHooks(requested, { ...options.recordsOptions, ...extra }, guard), api);
      guard.assertCurrent();
      absorbRecords(result);
      rememberResolved(requested, result);
      return result;
    } catch (error) {
      noteRequestFailure(error);
      // 取消 / 换代盖过途中先抛出来的那个错：调用方拿到的分型只看这次读取的收口原因
      guard.assertCurrent();
      throw error;
    } finally {
      guard.dispose();
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
        withLifecycleHooks(requested, { ...options.recordsOptions, ...options.generateOptions, ...extra }, guard),
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
      const out = new Map<string, InstanceEntry[]>();
      for (const key of keys) {
        if (!entriesByRefno.has(key)) {
          // 以这个构件为祖先查：服务端回它头上那根的整根记录，同根的其它构件一起进缓存，后面的 key 多半就命中了。只查，不生成。
          const collected = await collectByAncestor(key);
          guard.assertCurrent();
          // 只有完整收口后才能把「记录里没有该构件」负缓存为 []。pending（库被整库任务占用）或临时错误
          // 都必须保持未缓存，下一次显示才能重新查。
          if (isResolved(collected) && !entriesByRefno.has(key)) entriesByRefno.set(key, []);
        }
        out.set(key, entriesByRefno.get(key) ?? []);
      }
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
    const key = fromV1Refno(root);
    const leaves = leavesOfRoot(key);
    for (const leaf of leaves) entriesByRefno.delete(leaf);
    entriesByRefno.delete(key);
    leavesByRoot.delete(key);
    return leaves.includes(key) ? leaves : [key, ...leaves];
  }

  return { instanceEntriesByRefnos, collectByAncestor, generateThenCollect, subscribeProgress, peek, invalidate, collectedRoots, leavesOfRoot, invalidateRoot };
}
