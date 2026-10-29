import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { planSubtreeFrames, runBounded, SUBTREE_HARD_LIMIT, type SubtreeUnitChange } from './subtreeFramePlan';

const HARD_LIMIT = SUBTREE_HARD_LIMIT;

const unitArb: fc.Arbitrary<SubtreeUnitChange> = fc.record({
  // refno 形如 `a_b`，保证码元序与数字序不同时也能被覆盖
  unitRefno: fc.tuple(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 9999 })).map(([a, b]) => `${a}_${b}`),
  changedElements: fc.integer({ min: 0, max: 500 }),
});

const groupsArb = fc.uniqueArray(unitArb, { minLength: 0, maxLength: 40, selector: (u) => u.unitRefno });

/** 参考实现：按变化构件数降序、同数 refno 升序（码元序） */
function referenceTop(units: readonly SubtreeUnitChange[], limit: number): SubtreeUnitChange[] {
  return [...units]
    .sort((x, y) => {
      if (x.changedElements !== y.changedElements) return y.changedElements - x.changedElements;
      return x.unitRefno < y.unitRefno ? -1 : x.unitRefno > y.unitRefno ? 1 : 0;
    })
    .slice(0, limit);
}

describe('Property 24: 子树装载计划', () => {
  // Feature: model-version-timeline-scrub, Property 24: 子树装载计划
  it('游标等于最新版时 latest；否则单元集合等于摘要全集；超阈值或 20 时 confirm 且 top 取前 20；否则 load', () => {
    fc.assert(
      fc.property(
        groupsArb.chain((groups) => fc.tuple(
          fc.constant(groups),
          fc.integer({ min: 1, max: 5000 }),
          fc.option(fc.integer({ min: 0, max: 60 }), { nil: null }),
          fc.array(fc.integer({ min: 0, max: 60 }), { maxLength: 10 }),
        )),
        ([groups, cursor, costThreshold, cachedIdx]) => {
          const latest = cursor;
          const cachedUnits = new Set(cachedIdx.map((i) => groups[i % Math.max(1, groups.length)]?.unitRefno).filter((x): x is string => !!x));
          const plan = planSubtreeFrames({ cursor, latest, groups, cachedUnits, costThreshold });

          // 游标就是最新版：不装任何帧
          expect(plan).toEqual({ kind: 'latest' });

          // 换一个不是最新版的游标
          const other = planSubtreeFrames({ cursor: cursor + 1, latest, groups, cachedUnits, costThreshold });
          expect(other.kind).not.toBe('latest');
          if (other.kind === 'latest') return;
          if (groups.length === 0) {
            expect(other.kind).toBe('load');
            expect(other.units).toEqual([]);
            return;
          }
          expect(other.units).toEqual(groups.map((g) => ({ unitRefno: g.unitRefno, changedElements: g.changedElements })));

          const uncached = groups.filter((g) => !cachedUnits.has(g.unitRefno)).length;
          const overCost = costThreshold !== null && uncached > costThreshold;
          const shouldConfirm = overCost || uncached > HARD_LIMIT;
          expect(other.kind).toBe(shouldConfirm ? 'confirm' : 'load');
          if (other.kind === 'confirm') {
            expect(other.top).toEqual(referenceTop(other.units, HARD_LIMIT));
            expect(other.top).toHaveLength(Math.min(HARD_LIMIT, other.units.length));
            // top 的每一行都在 units 里
            for (const row of other.top) expect(other.units).toContainEqual(row);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('top 内部严格有序：变化构件数不增，同数时 refno 升序', () => {
    fc.assert(
      fc.property(groupsArb, fc.integer({ min: 1, max: 200 }), (groups, cursor) => {
        const plan = planSubtreeFrames({ cursor, latest: cursor + 1, groups, cachedUnits: new Set(), costThreshold: null });
        if (plan.kind !== 'confirm') return;
        for (let i = 1; i < plan.top.length; i += 1) {
          const prev = plan.top[i - 1]!;
          const cur = plan.top[i]!;
          expect(prev.changedElements).toBeGreaterThanOrEqual(cur.changedElements);
          if (prev.changedElements === cur.changedElements) {
            expect(prev.unitRefno < cur.unitRefno).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('已缓存的单元不计入未缓存数：全部缓存时永远 load', () => {
    fc.assert(
      fc.property(groupsArb, fc.integer({ min: 1, max: 200 }), (groups, cursor) => {
        const cached = new Set(groups.map((g) => g.unitRefno));
        const plan = planSubtreeFrames({ cursor, latest: cursor + 1, groups, cachedUnits: cached, costThreshold: 0 });
        expect(plan.kind).toBe('load');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 25: 子树请求有界并发', () => {
  // Feature: model-version-timeline-scrub, Property 25: 子树请求有界并发
  it('任一时刻进行中的任务数不超过 L，每个任务恰好结束一次，结果与任务一一对应', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 24 }),
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.boolean(), { minLength: 24, maxLength: 24 }),
        async (taskCount, limit, failures) => {
          let inFlight = 0;
          let peak = 0;
          const started: number[] = [];
          const finished: number[] = [];

          const tasks = Array.from({ length: taskCount }, (_, i) => async () => {
            started.push(i);
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            try {
              // 让出若干微任务，制造交错
              await Promise.resolve();
              await Promise.resolve();
              if (failures[i % failures.length]) throw new Error(`task ${i} failed`);
              return i;
            } finally {
              finished.push(i);
              inFlight -= 1;
            }
          });

          const results = await runBounded(tasks, limit);

          expect(peak).toBeLessThanOrEqual(limit);
          expect(results).toHaveLength(taskCount);
          // 每个任务恰好开始一次、结束一次
          expect(started.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: taskCount }, (_, i) => i));
          expect(finished.slice().sort((a, b) => a - b)).toEqual(started.slice().sort((a, b) => a - b));
          expect(new Set(finished).size).toBe(taskCount);
          // 结果与任务一一对应
          results.forEach((r, i) => {
            if (failures[i % failures.length]) {
              expect(r.status).toBe('rejected');
            } else {
              expect(r.status).toBe('fulfilled');
              if (r.status === 'fulfilled') expect(r.value).toBe(i);
            }
          });
          expect(inFlight).toBe(0);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('任务同步抛错按 rejected 记录，不打断其余任务', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 4 }), async (taskCount, limit) => {
        const boomAt = 0;
        const tasks = Array.from({ length: taskCount }, (_, i) => (): Promise<number> => {
          if (i === boomAt) throw new Error('sync boom');
          return Promise.resolve(i);
        });
        const results = await runBounded(tasks, limit);
        expect(results).toHaveLength(taskCount);
        expect(results[boomAt]!.status).toBe('rejected');
        for (let i = 0; i < taskCount; i += 1) {
          if (i === boomAt) continue;
          expect(results[i]!.status).toBe('fulfilled');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('limit 非有限或小于 1 时按 1 串行执行', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.constantFrom(0, -3, Number.NaN, Number.POSITIVE_INFINITY), async (taskCount, limit) => {
        let inFlight = 0;
        let peak = 0;
        const tasks = Array.from({ length: taskCount }, () => async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await Promise.resolve();
          inFlight -= 1;
          return 1;
        });
        await runBounded(tasks, limit);
        // 0 / 负数 / 非有限：按 1；Infinity 被夹到任务数
        const wantPeak = Number.isFinite(limit) && limit >= 1 ? Math.min(limit, taskCount) : 1;
        expect(peak).toBe(wantPeak);
      }),
      { numRuns: 100 },
    );
  });

  it('空任务表直接返回空数组', async () => {
    await expect(runBounded([], 4)).resolves.toEqual([]);
  });
});
