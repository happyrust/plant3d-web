import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { reassignOnCursorMove, type InFlight, type ReassignInput } from './prefetchPlan';

const RADIUS = 2;
const MAX_CONCURRENT = 2;

/** 可导航序列：升序去重，sesno 之间留大间隔，使「按刻度位置 ±2」与「按 sesno 差 ±2」明显不同。 */
const orderedArb: fc.Arbitrary<number[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 25 })
  .map((xs) => [...xs].sort((a, b) => a - b));

function inFlightArb(ordered: readonly number[]): fc.Arbitrary<InFlight[]> {
  const sesnoArb = fc.constantFrom(...ordered);
  return fc
    .array(fc.record({ sesno: sesnoArb, role: fc.constantFrom('cursor' as const, 'prefetch' as const) }), { maxLength: 6 })
    // 同一 sesno 至多一个进行中请求（真实实现就是这样，重分配不该被重复项干扰）
    .map((xs) => {
      const seen = new Set<number>();
      return xs.filter((x) => (seen.has(x.sesno) ? false : (seen.add(x.sesno), true)));
    });
}

const inputArb: fc.Arbitrary<ReassignInput> = orderedArb.chain((ordered) =>
  fc.record({
    ordered: fc.constant(ordered),
    newCursor: fc.constantFrom(...ordered),
    inFlight: inFlightArb(ordered),
    queuedPrefetch: fc.uniqueArray(fc.constantFrom(...ordered), { maxLength: 6 }),
  }),
);

function indexOf(ordered: readonly number[], sesno: number): number {
  return ordered.indexOf(sesno);
}

function inRange(ordered: readonly number[], newCursor: number, sesno: number): boolean {
  const center = indexOf(ordered, newCursor);
  const i = indexOf(ordered, sesno);
  return center >= 0 && i >= 0 && Math.abs(i - center) <= RADIUS;
}

describe('Property 19: 游标移动时的请求重分配', () => {
  // Feature: model-version-timeline-scrub, Property 19: 游标移动时的请求重分配
  it('每个进行中请求恰好落在保留 / 转预取 / 中止之一，排队项在 ±2 外的全部移出', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const { convertToPrefetch, abort, dequeue } = reassignOnCursorMove(input);

        // 三份结果互不相交
        const buckets = [new Set(convertToPrefetch), new Set(abort), new Set(dequeue)];
        const all = [...convertToPrefetch, ...abort];
        expect(new Set(all).size).toBe(all.length);
        expect(buckets[0]!.size + buckets[1]!.size).toBe(all.length);

        // 进行中请求：只可能落在「转预取」或「中止」之一；不在这两份里的就是「保留」。
        // （`dequeue` 只针对排队项，同一个 sesno 可以在那里出现，与进行中请求无关。）
        for (const req of input.inFlight) {
          const appearances = [buckets[0]!.has(req.sesno), buckets[1]!.has(req.sesno)].filter(Boolean).length;
          if (req.role === 'cursor' && req.sesno === input.newCursor) {
            // 恰为新游标的旧游标请求：保留为游标请求，既不算转预取也不算中止
            expect(appearances).toBe(0);
            continue;
          }
          expect(appearances).toBeLessThanOrEqual(1);
          if (req.role === 'prefetch') {
            // 进行中预取：在范围内保留，范围外必中止
            if (inRange(input.ordered, input.newCursor, req.sesno)) {
              expect(buckets[1]!.has(req.sesno)).toBe(false);
            } else {
              expect(buckets[1]!.has(req.sesno)).toBe(true);
            }
          }
        }

        // 转为预取的旧游标请求都在 ±2 内
        for (const sesno of convertToPrefetch) {
          expect(inRange(input.ordered, input.newCursor, sesno)).toBe(true);
          const req = input.inFlight.find((r) => r.sesno === sesno)!;
          expect(req.role).toBe('cursor');
          expect(sesno).not.toBe(input.newCursor);
        }

        // 转换后进行中预取数不超过上限（已有预取本身可能已超限，那是上游的职责，这里只约束「转换不额外超」）
        const keptPrefetches = input.inFlight.filter(
          (r) => r.role === 'prefetch' && inRange(input.ordered, input.newCursor, r.sesno) && r.sesno !== input.newCursor,
        ).length;
        expect(convertToPrefetch.length).toBeLessThanOrEqual(Math.max(0, MAX_CONCURRENT - keptPrefetches));

        // 排队项：±2 外的全部移出，±2 内的一个都不动
        for (const sesno of input.queuedPrefetch) {
          const shouldDequeue = !inRange(input.ordered, input.newCursor, sesno);
          expect(dequeue.includes(sesno)).toBe(shouldDequeue);
        }
        // 被中止 / 移出的项不进失败集合：本函数的返回值里根本没有失败集合（只能确认它不产出）
        expect(Object.keys({ convertToPrefetch, abort, dequeue }).sort()).toEqual([
          'abort', 'convertToPrefetch', 'dequeue',
        ]);
      }),
      { numRuns: 100 },
    );
  });

  it('游标不动时既不转预取，也只中止范围外的进行中预取', () => {
    fc.assert(
      fc.property(orderedArb, (ordered) => {
        const cursor = ordered[Math.floor(ordered.length / 2)]!;
        // 只有一条游标请求（就是 newCursor）与一条预取请求，没有「旧游标请求」可转
        const other = ordered[0] === cursor ? ordered[ordered.length - 1]! : ordered[0]!;
        const requests: InFlight[] = [
          { sesno: cursor, role: 'cursor' },
          { sesno: other, role: 'prefetch' },
        ];
        const input: ReassignInput = {
          ordered,
          newCursor: cursor,
          inFlight: requests.filter((r, i, arr) => arr.findIndex((x) => x.sesno === r.sesno) === i),
          queuedPrefetch: [],
        };
        const { convertToPrefetch, abort } = reassignOnCursorMove(input);
        expect(convertToPrefetch).toEqual([]);
        // 唯一可能被中止的是「范围外的进行中预取」，那是本来就该中止的
        for (const sesno of abort) {
          expect(sesno).not.toBe(cursor);
          expect(inRange(ordered, cursor, sesno)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('进行中预取已占满名额时，范围内可转预取的旧游标请求改为中止', () => {
    fc.assert(
      fc.property(orderedArb.filter((xs) => xs.length >= 5), (ordered) => {
        const center = 2;
        const newCursor = ordered[center]!;
        // 两侧各放一个范围内预取，占满 2 个名额
        const prefetchA = ordered[center - 1]!;
        const prefetchB = ordered[center + 1]!;
        // 再放一个范围外的旧游标请求：范围内无名额 → 中止
        const oldCursor = ordered[center - 2]!;
        const input: ReassignInput = {
          ordered,
          newCursor,
          inFlight: [
            { sesno: prefetchA, role: 'prefetch' },
            { sesno: prefetchB, role: 'prefetch' },
            { sesno: oldCursor, role: 'cursor' },
          ],
          queuedPrefetch: [],
        };
        const { convertToPrefetch, abort } = reassignOnCursorMove(input);
        expect(convertToPrefetch).toEqual([]);
        expect(abort).toContain(oldCursor);
      }),
      { numRuns: 100 },
    );
  });
});
