/**
 * 子树范围的单元装载计划（design.md §2.9，Requirement 9.2、9.3、9.9）。
 * 纯逻辑：无 Vue、无 DOM、无网络。
 *
 * 口径：
 * - 游标就是最新版 → `latest`，不装任何 Version_Frame（9.2）。
 * - 需要查询数 = `groups` 中尚未缓存的单元数；超过 `costThreshold` 或 `hardLimit`（缺省 20）→ `confirm`，
 *   否则 `load`（9.3）。两种计划的 `units` 都是 `groups` 全集（已缓存的单元由调用方直接取缓存）。
 * - `top`：按 `changedElements` 降序、同数按 refno 升序（码元序）取前 `hardLimit` 个。
 * - `runBounded`：同时进行的任务不超过 `limit`（9.9）。名额在任务 Promise 结束时才释放，
 *   任务内部的 `retryOnBusy` 等待期间仍占着名额。
 */

export type SubtreeUnitChange = { unitRefno: string; changedElements: number };

export type SubtreePlan =
  | { kind: 'latest' }
  | { kind: 'load'; units: SubtreeUnitChange[] }
  | { kind: 'confirm'; units: SubtreeUnitChange[]; top: SubtreeUnitChange[] };

/** 子树一次游标移动不经确认即可查询的单元数上限（Requirement 9.3） */
export const SUBTREE_HARD_LIMIT = 20;

/** 变化构件数降序；相同时 refno 升序（码元序，与 locale 无关） */
function compareByChangeDesc(x: SubtreeUnitChange, y: SubtreeUnitChange): number {
  if (x.changedElements !== y.changedElements) return y.changedElements - x.changedElements;
  if (x.unitRefno < y.unitRefno) return -1;
  if (x.unitRefno > y.unitRefno) return 1;
  return 0;
}

export function planSubtreeFrames(input: {
  cursor: number;
  latest: number;
  /** node/diff-summary(cursor, latest) 中几何有变化的单元 */
  groups: readonly SubtreeUnitChange[];
  cachedUnits: ReadonlySet<string>;
  /** diffSummary.confirmThresholdUnits；null 表示服务端未给出 */
  costThreshold: number | null;
  /** 缺省 20 */
  hardLimit?: number;
}): SubtreePlan {
  const { cursor, latest, groups, cachedUnits, costThreshold } = input;
  if (cursor === latest) return { kind: 'latest' };

  const hardLimit = input.hardLimit ?? SUBTREE_HARD_LIMIT;
  const units = groups.map((g) => ({ unitRefno: g.unitRefno, changedElements: g.changedElements }));

  let uncached = 0;
  for (const u of units) {
    if (!cachedUnits.has(u.unitRefno)) uncached += 1;
  }

  const overCost = costThreshold !== null && uncached > costThreshold;
  if (!overCost && uncached <= hardLimit) return { kind: 'load', units };

  const top = [...units].sort(compareByChangeDesc).slice(0, Math.max(0, hardLimit));
  return { kind: 'confirm', units, top };
}

/**
 * 以不超过 `limit` 的并发依次执行 `tasks`，结果与 `tasks` 下标一一对应。
 * 任务同步抛错按 rejected 记录；`limit` 非有限数或小于 1 时按 1。
 */
export function runBounded<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const n = tasks.length;
  const results: PromiseSettledResult<T>[] = new Array(n);
  if (n === 0) return Promise.resolve(results);

  const width = Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), n) : 1;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < n) {
      const i = next;
      next += 1;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]!() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < width; w += 1) workers.push(worker());
  return Promise.all(workers).then(() => results);
}
