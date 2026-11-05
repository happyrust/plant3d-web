/**
 * 把 RVM 不一致清单落到 3D：载入被核对的节点，按 E3D 名称找回构件 refno，X 光隔离并飞过去。
 * 清单里只有名称；无名构件只能定位到最近的有名属主。
 */

import { reactive } from 'vue';

import { mismatchLocateTarget } from './rvmCheckFormat';

import { fromV1Refno, genModelV1Search } from '@/api/genModelV1Api';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useSceneGraphOps } from '@/composables/useSceneGraph';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { applyLoadedModelHighlight, showModelByRefnosWithAck, useViewerContext } from '@/composables/useViewerContext';

export type LocateResult = { refno: string; viaOwner: boolean } | null;

const SEARCH_LIMIT = 50;
const NAME_CONCURRENCY = 6;

function normalizeName(name: string): string {
  return name.trim().replace(/^\//, '').toUpperCase();
}

export function useRvmMismatchLocate() {
  const viewer = useViewerContext();
  const selection = useSelectionStore();
  const scene = useSceneGraphOps(viewer.viewerRef);
  const byName = new Map<string, Promise<string | null>>();
  /** 每行的定位结果：`undefined` 未查、`null` 查不到 */
  const resolved = reactive<Record<string, LocateResult | 'pending'>>({});

  function lookup(name: string): Promise<string | null> {
    const key = normalizeName(name);
    let request = byName.get(key);
    if (!request) {
      request = genModelV1Search({ query: key, limit: SEARCH_LIMIT })
        .then((response) => {
          const hit = response.items.find((item) => normalizeName(item.name) === key);
          return hit ? fromV1Refno(hit.refno) : null;
        })
        .catch((cause: unknown) => {
          // 请求失败不等于查不到：清掉缓存，让这一行还能再点
          byName.delete(key);
          throw cause;
        });
      byName.set(key, request);
    }
    return request;
  }

  async function resolve(rowName: string): Promise<LocateResult> {
    const target = mismatchLocateTarget(rowName);
    if (!target) {
      resolved[rowName] = null;
      return null;
    }
    resolved[rowName] = 'pending';
    let refno: string | null;
    try {
      refno = await lookup(target.name);
    } catch (cause) {
      delete resolved[rowName];
      throw cause;
    }
    const result = refno ? { refno, viaOwner: target.viaOwner } : null;
    resolved[rowName] = result;
    return result;
  }

  async function resolveAll(names: string[]): Promise<LocateResult[]> {
    const unique = [...new Set(names)];
    const results = new Map<string, LocateResult>();
    for (let start = 0; start < unique.length; start += NAME_CONCURRENCY) {
      const slice = unique.slice(start, start + NAME_CONCURRENCY);
      const found = await Promise.all(slice.map((name) => resolve(name).catch(() => null)));
      slice.forEach((name, index) => results.set(name, found[index] ?? null));
    }
    return names.map((name) => results.get(name) ?? null);
  }

  async function load(refnos: string[], flyTo: boolean): Promise<string | null> {
    ensurePanelAndActivate('viewer');
    const result = await showModelByRefnosWithAck({ refnos, flyTo, highlight: false, timeoutMs: 60_000 });
    return result.error;
  }

  function highlight(refnos: string[]): boolean {
    const current = viewer.viewerRef.value;
    if (!current) return false;
    return applyLoadedModelHighlight({
      viewer: current,
      refnos,
      flyTo: true,
      setSelectedRefnos: (keys) => selection.setSelectedRefnos(keys, keys[0] ?? null),
    });
  }

  /** 单行「定位」：载入被核对节点，选中这件并飞过去。 */
  async function locateRow(rootRefno: string, rowName: string): Promise<string | null> {
    let found: LocateResult;
    try {
      found = await resolve(rowName);
    } catch (cause) {
      return `按名称查找失败：${cause instanceof Error ? cause.message : String(cause)}`;
    }
    if (!found) return '在模型树里找不到这个名称';
    const error = await load([fromV1Refno(rootRefno), found.refno], false);
    if (error && !viewer.viewerRef.value) return error;
    scene.clearIsolation();
    return highlight([found.refno]) ? null : '构件还没有几何对象';
  }

  /** 「在 3D 中查看问题构件」：载入被核对节点，X 光其余，只留问题构件实色。返回定位到的件数。 */
  async function showProblems(rootRefno: string, names: string[]): Promise<{ located: number; missing: number; error: string | null }> {
    const results = await resolveAll(names);
    const refnos = [...new Set(results.filter((item): item is NonNullable<LocateResult> => !!item).map((item) => item.refno))];
    const missing = names.filter((name, index) => !results[index] && resolved[name] === null).length;
    const unresolved = names.filter((name, index) => !results[index] && resolved[name] !== null).length;
    const root = fromV1Refno(rootRefno);
    const error = await load([root], refnos.length === 0);
    if (refnos.length === 0) {
      const lookupError = unresolved > 0 ? `${unresolved} 行按名称查找失败，可以再点一次` : null;
      return { located: 0, missing, error: error ?? lookupError };
    }
    const current = viewer.viewerRef.value;
    if (!current) return { located: 0, missing, error: error ?? '三维视图还没准备好' };
    current.scene.ensureRefnos(refnos);
    scene.isolate(refnos);
    highlight(refnos);
    return { located: refnos.length, missing, error: null };
  }

  function clear(): void {
    scene.clearIsolation();
  }

  return { resolved, resolve, locateRow, showProblems, clear };
}
