/**
 * gen-model-v1 的 `ModelRecordSource`（plan P3-a/e）：`refno[] → Map<refno, InstanceEntry[]>`。
 *
 * 调用方（`useDbnoInstancesDtxLoader`）给的是**构件级** refno（`visibleInsts` 回的那些），而 gen-model 的
 * 记录是按**生成根**投影的：对任何一个构件 ensure，服务端解到它的根、`records` 回整根的记录。所以这里
 * 按根收、按构件缓存：第一个构件的 ensure 把整根记录拉回来并写进缓存，同根的其它构件直接命中，
 * 一根只打一次。缓存在进程内、按 refno 键；`forceRefresh` 清掉请求到的 refno 再问一次。
 *
 * `dbno` 只是调用方的分桶键（服务端自己解库归属），这里不用它选数据。
 */
import { groupInstanceEntriesByRefno } from './instanceMapping';
import { ensureAndCollectRecords, defaultModelRecordsApi, type EnsureAndCollectOptions, type EnsureAndCollectResult, type ModelRecordsApi } from './modelRecords';

import type { InstanceEntryQueryOptions, ModelRecordSource } from '../ports';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { fromV1Refno } from '@/api/genModelV1Api';

export type GenModelV1ModelRecordSource = ModelRecordSource & {
  /** 对一个节点做「显式显示」并把整根记录映射进缓存；给 P3-c 的分批 / 进度用。 */
  ensureAndCollect(refno: string, options?: EnsureAndCollectOptions): Promise<EnsureAndCollectResult>;
  /** 缓存里某构件的实例（不发请求）。 */
  peek(refno: string): InstanceEntry[] | undefined;
  /** 清缓存：不传清全部，传了只清这些 refno。 */
  invalidate(refnos?: string[]): void;
  /** 已经收过记录的生成根（`a_b`）——P5 拿它与 `model_drain` 的根做交集。 */
  collectedRoots(): string[];
  /** 某根下缓存过的全部构件 refno（含根自己），P5 重载时按它 forceReload。 */
  leavesOfRoot(root: string): string[];
  /** 把一根连同它的构件从缓存里清掉；返回被清掉的构件 refno。 */
  invalidateRoot(root: string): string[];
};

export type GenModelV1ModelRecordSourceOptions = {
  api?: ModelRecordsApi;
  ensureOptions?: Pick<EnsureAndCollectOptions, 'maxContainerDepth' | 'maxRoots' | 'pageSize'>;
};

export function createGenModelV1ModelRecordSource(options: GenModelV1ModelRecordSourceOptions = {}): GenModelV1ModelRecordSource {
  const api = options.api ?? defaultModelRecordsApi;
  const entriesByRefno = new Map<string, InstanceEntry[]>();
  /** 生成根（a_b）→ 它这次 records 里出现过的构件 refno（含根自己） */
  const leavesByRoot = new Map<string, Set<string>>();

  async function ensureAndCollect(refno: string, extra: EnsureAndCollectOptions = {}): Promise<EnsureAndCollectResult> {
    const result = await ensureAndCollectRecords(refno, { ...options.ensureOptions, ...extra }, api);
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
    // 明确知道没有几何的根也记一笔空数组，下一次同一个 refno 不再 ensure
    for (const key of result.empty) {
      if (!entriesByRefno.has(key)) entriesByRefno.set(key, []);
    }
    return result;
  }

  async function instanceEntriesByRefnos(
    _dbno: number,
    refnos: string[],
    queryOptions: InstanceEntryQueryOptions = {},
  ): Promise<Map<string, InstanceEntry[]>> {
    const keys = Array.from(new Set(refnos.map((r) => fromV1Refno(String(r ?? ''))).filter(Boolean)));
    if (queryOptions.forceRefresh) invalidate(keys);
    const out = new Map<string, InstanceEntry[]>();
    const force = queryOptions.forceRegenerate === true;
    for (const key of keys) {
      if (!entriesByRefno.has(key)) {
        // 这一次 ensure 会把同根的其它构件一起写进缓存；后面的 key 多半就命中了。
        // 重生成只对第一次 ensure 带 force：同根的其它构件已经在这次结果里，不该再触发一轮生成。
        await ensureAndCollect(key, force ? { force: true } : {});
        // 请求到但整根记录里没有它的构件，记空数组：本次不再为它再 ensure 一遍同一个根
        if (!entriesByRefno.has(key)) entriesByRefno.set(key, []);
      }
      out.set(key, entriesByRefno.get(key) ?? []);
    }
    return out;
  }

  function peek(refno: string): InstanceEntry[] | undefined {
    return entriesByRefno.get(fromV1Refno(refno));
  }

  function invalidate(refnos?: string[]): void {
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
    const key = fromV1Refno(root);
    const leaves = leavesOfRoot(key);
    for (const leaf of leaves) entriesByRefno.delete(leaf);
    entriesByRefno.delete(key);
    leavesByRoot.delete(key);
    return leaves.includes(key) ? leaves : [key, ...leaves];
  }

  return { instanceEntriesByRefnos, ensureAndCollect, peek, invalidate, collectedRoots, leavesOfRoot, invalidateRoot };
}
