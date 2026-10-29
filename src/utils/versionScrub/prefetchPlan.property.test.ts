import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { planPrefetch, prefetchCandidates, type PrefetchInput } from './prefetchPlan';

/**
 * 可导航序列：升序、去重；sesno 之间留大间隔，使「按刻度位置 ±2」与「按 sesno 差 ±2」明显不同。
 */
const orderedArb: fc.Arbitrary<number[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 5000 }), { minLength: 0, maxLength: 30 })
  .map((xs) => [...xs].sort((a, b) => a - b));

/** 从 ordered 与少量噪声 sesno 中抽子集，构造 cached / inFlight / failed / excluded */
function subsetArb(ordered: readonly number[]): fc.Arbitrary<Set<number>> {
  const pool = fc.oneof(
    { weight: 4, arbitrary: ordered.length > 0 ? fc.constantFrom(...ordered) : fc.integer({ min: 1, max: 5000 }) },
    { weight: 1, arbitrary: fc.integer({ min: 1, max: 5000 }) },
  );
  return fc.array(pool, { maxLength: 8 }).map((xs) => new Set(xs));
}

/** 游标：多数取 ordered 中的元素，少数取任意整数（可能不在序列中） */
function cursorArb(ordered: readonly number[]): fc.Arbitrary<number> {
  if (ordered.length === 0) return fc.integer({ min: 1, max: 5000 });
  return fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(...ordered) },
    { weight: 1, arbitrary: fc.integer({ min: 1, max: 5000 }) },
  );
}

const inputArb: fc.Arbitrary<PrefetchInput> = orderedArb.chain((ordered) =>
  fc.record({
    ordered: fc.constant(ordered),
    cursor: cursorArb(ordered),
    cached: subsetArb(ordered),
    inFlight: subsetArb(ordered),
    failed: subsetArb(ordered),
    excluded: fc.option(subsetArb(ordered), { nil: undefined }),
    cursorRequestActive: fc.boolean(),
    activePrefetches: fc.nat({ max: 4 }),
  }),
);

/** 独立参考实现：枚举 ordered 全部位置，按 (位置距离, 前侧优先) 排序后过滤 */
function referenceCandidates(input: PrefetchInput): number[] {
  const { ordered, cursor, cached, inFlight, failed, excluded } = input;
  const center = ordered.indexOf(cursor);
  if (center < 0) return [];
  const rows: { sesno: number; dist: number; side: number }[] = [];
  ordered.forEach((sesno, i) => {
    const dist = Math.abs(i - center);
    if (dist === 0 || dist > 2) return;
    rows.push({ sesno, dist, side: i < center ? 0 : 1 });
  });
  rows.sort((a, b) => a.dist - b.dist || a.side - b.side);
  return rows
    .filter(({ sesno }) => !cached.has(sesno) && !inFlight.has(sesno) && !failed.has(sesno) && !(excluded?.has(sesno) ?? false))
    .map(({ sesno }) => sesno);
}

describe('Property 18: 预取计划', () => {
  // Feature: model-version-timeline-scrub, Property 18: 预取计划
  it('prefetchCandidates 只含游标 ±2 格内、不在 cached/inFlight/failed/excluded 中的版本，近到远、先前后后，与参考实现相同', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const got = prefetchCandidates(input);
        expect(got).toEqual(referenceCandidates(input));

        const center = input.ordered.indexOf(input.cursor);
        if (center < 0) {
          expect(got).toEqual([]);
          return;
        }
        let prevDist = 0;
        let prevSide = -1;
        for (const sesno of got) {
          const i = input.ordered.indexOf(sesno);
          const dist = Math.abs(i - center);
          const side = i < center ? 0 : 1;
          expect(dist).toBeGreaterThanOrEqual(1);
          expect(dist).toBeLessThanOrEqual(2);
          expect(input.cached.has(sesno)).toBe(false);
          expect(input.inFlight.has(sesno)).toBe(false);
          expect(input.failed.has(sesno)).toBe(false);
          expect(input.excluded?.has(sesno) ?? false).toBe(false);
          // 距离不减；同距离时前侧在后侧之前
          expect(dist > prevDist || (dist === prevDist && side > prevSide)).toBe(true);
          prevDist = dist;
          prevSide = side;
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 18: 预取计划
  it('planPrefetch 在游标请求进行中时为空，否则为候选的前 max(0, 2 − 进行中预取数) 个', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const planned = planPrefetch(input);
        if (input.cursorRequestActive) {
          expect(planned).toEqual([]);
          return;
        }
        const slots = Math.max(0, 2 - input.activePrefetches);
        expect(planned.length).toBeLessThanOrEqual(slots);
        expect(planned).toEqual(referenceCandidates(input).slice(0, slots));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 18: 预取计划
  it('以 HISTORY_BUSY 结束的预取不进失败集合，下一次计划中重新成为候选；真失败的则不再是候选', () => {
    fc.assert(
      fc.property(inputArb, (raw) => {
        const input: PrefetchInput = { ...raw, cursorRequestActive: false, activePrefetches: 0 };
        const planned = planPrefetch(input);
        fc.pre(planned.length > 0);
        const target = planned[0];
        if (target === undefined) return;

        // 发起后：进入 inFlight，不再是候选
        const inFlightNow = new Set(input.inFlight).add(target);
        const during: PrefetchInput = { ...input, inFlight: inFlightNow, activePrefetches: 1 };
        expect(prefetchCandidates(during)).not.toContain(target);

        // 以 HISTORY_BUSY 结束：移出 inFlight，failed 不变 → 重新成为候选，且排在原来的位置
        const afterInFlight = new Set(inFlightNow);
        afterInFlight.delete(target);
        const afterBusy: PrefetchInput = { ...input, inFlight: afterInFlight, activePrefetches: 0 };
        expect(prefetchCandidates(afterBusy)).toContain(target);
        expect(planPrefetch(afterBusy)[0]).toBe(target);

        // 对照：真失败进 failed → 不再是候选
        const afterFail: PrefetchInput = { ...afterBusy, failed: new Set(input.failed).add(target) };
        expect(prefetchCandidates(afterFail)).not.toContain(target);
      }),
      { numRuns: 100 },
    );
  });
});
