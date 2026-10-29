import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { clickTick, coerceCursorForGeometryOnly, initialCursor, isGeometryChange, navigableTicks, snapToPointer, stepCursor } from './cursorNav';
import { fullViewport, layoutTicks, orderVersions, timeAnomalies, type LaidTick, type ScrubVersion, type TickCluster } from './tickLayout';

const IMPACT_KINDS = ['mesh', 'placement', 'delivery', 'tombstone', 'noop'] as const;

/** 版本行：sesno 可重复（交给 orderVersions 去重），impactKind 含 null 与 noop。 */
const versionArb: fc.Arbitrary<ScrubVersion> = fc.record({
  sesno: fc.integer({ min: 1, max: 400 }),
  sessionTime: fc.constant(null),
  impactKind: fc.option(fc.constantFrom(...IMPACT_KINDS), { nil: null }),
});

/** 非空版本表；顺序打乱后交给 orderVersions，避免生成器本身已经有序。 */
const versionsArb = fc.array(versionArb, { minLength: 1, maxLength: 60 });

/** 轴宽：窄轴会把刻度合并成簇，宽轴每刻度一格。 */
const widthArb = fc.double({ min: 20, max: 2000, noNaN: true });

function build(raw: readonly ScrubVersion[], widthPx: number) {
  const ordered = orderVersions(raw);
  const versions = new Map(ordered.map((v) => [v.sesno, v] as const));
  const { ticks, clusters } = layoutTicks({
    ordered,
    viewport: fullViewport(ordered.length),
    widthPx,
    anomalies: timeAnomalies(ordered),
  });
  return { ordered, versions, ticks, clusters };
}

/** 一个刻度的横坐标：按 ordinal 与全量视口直接算出（不依赖 layoutTicks 的内部公式）。 */
function xOf(ordinal: number, n: number, widthPx: number): number {
  const span = Math.max(1, n);
  return ((ordinal + 0.5) / span) * widthPx;
}

describe('Property 9: 指针吸附与初始位置', () => {
  // Feature: model-version-timeline-scrub, Property 9: 指针吸附与初始位置
  it('吸附结果与指针的水平距离不大于任何其他刻度，等距取 sesno 大者，轴外取首末刻度', () => {
    fc.assert(
      fc.property(
        versionsArb.chain((raw) => widthArb.chain((widthPx) => fc.tuple(
          fc.constant(raw),
          fc.constant(widthPx),
          fc.double({ min: -500, max: widthPx + 500, noNaN: true }),
          fc.boolean(),
        ))),
        ([raw, widthPx, pointerX, geometryOnly]) => {
          const { ticks, versions } = build(raw, widthPx);
          const candidates = navigableTicks(ticks, versions, geometryOnly);
          const snapped = snapToPointer(candidates, pointerX);

          if (candidates.length === 0) {
            expect(snapped).toBeNull();
            return;
          }

          // 轴外：左端取 sesno 最小、右端取 sesno 最大
          const xs = candidates.map((t) => t.x);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minSesno = Math.min(...candidates.map((t) => t.sesno));
          const maxSesno = Math.max(...candidates.map((t) => t.sesno));
          if (pointerX < minX) {
            expect(snapped).toBe(minSesno);
            return;
          }
          if (pointerX > maxX) {
            expect(snapped).toBe(maxSesno);
            return;
          }

          // 距离最小：不存在严格更近的刻度；等距时取 sesno 大者
          const chosen = candidates.find((t) => t.sesno === snapped)!;
          const chosenDist = Math.abs(chosen.x - pointerX);
          for (const t of candidates) {
            const d = Math.abs(t.x - pointerX);
            expect(d).toBeGreaterThanOrEqual(chosenDist - 1e-9);
            if (Math.abs(d - chosenDist) <= 1e-9) expect(t.sesno).toBeLessThanOrEqual(snapped!);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('initialCursor 返回 sesno 最大的可导航版本，集合为空时 null', () => {
    fc.assert(
      fc.property(versionsArb, widthArb, fc.boolean(), (raw, widthPx, geometryOnly) => {
        const { ticks, versions } = build(raw, widthPx);
        const candidates = navigableTicks(ticks, versions, geometryOnly);
        const cursor = initialCursor(candidates);
        if (candidates.length === 0) {
          expect(cursor).toBeNull();
          return;
        }
        expect(cursor).toBe(Math.max(...candidates.map((t) => t.sesno)));
        expect(isGeometryChange(versions.get(cursor!)?.impactKind ?? null)).toBe(geometryOnly ? true : isGeometryChange(versions.get(cursor!)!.impactKind));
      }),
      { numRuns: 100 },
    );
  });

  it('刻度横坐标只由序号决定：同一版本表换一套 Session_Time，x 不变', () => {
    fc.assert(
      fc.property(versionsArb, widthArb, fc.func(fc.string()), (raw, widthPx, timeOf) => {
        const ordered = orderVersions(raw);
        const widthOnly = layoutTicks({
          ordered,
          viewport: fullViewport(ordered.length),
          widthPx,
          anomalies: new Map(),
        });
        const withTimes = layoutTicks({
          ordered: ordered.map((v, i) => ({ ...v, sessionTime: timeOf(i) })),
          viewport: fullViewport(ordered.length),
          widthPx,
          anomalies: new Map(),
        });
        expect(widthOnly.ticks).toEqual(withTimes.ticks);
        // 与按 ordinal 直接算出的横坐标一致
        widthOnly.ticks.forEach((t, i) => {
          expect(t.x).toBeCloseTo(xOf(i, ordered.length, widthPx), 6);
        });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 10: 链序离散移动', () => {
  // Feature: model-version-timeline-scrub, Property 10: 链序离散移动
  it('方向键取 sesno 顺序中紧邻的前一个 / 后一个，端点保持不动', () => {
    fc.assert(
      fc.property(versionsArb, widthArb, fc.boolean(), (raw, widthPx, geometryOnly) => {
        const { ticks, versions } = build(raw, widthPx);
        const candidates = navigableTicks(ticks, versions, geometryOnly);
        if (candidates.length === 0) {
          expect(stepCursor(candidates, 1, 1)).toBe(1);
          expect(stepCursor(candidates, 1, -1)).toBe(1);
          return;
        }
        const sesnos = candidates.map((t) => t.sesno);

        for (const current of sesnos) {
          const i = sesnos.indexOf(current);
          const prev = i === 0 ? current : sesnos[i - 1]!;
          const next = i === sesnos.length - 1 ? current : sesnos[i + 1]!;
          expect(stepCursor(candidates, current, -1)).toBe(prev);
          expect(stepCursor(candidates, current, 1)).toBe(next);
          // 结果总是候选之一（端点在候选内）
          expect(sesnos).toContain(stepCursor(candidates, current, 1));
          expect(sesnos).toContain(stepCursor(candidates, current, -1));
        }

        // 当前值不在候选中：取严格小于 / 大于它的最近候选
        const outside = Math.max(...sesnos) + 1;
        expect(stepCursor(candidates, outside, 1)).toBe(outside);
        expect(stepCursor(candidates, outside, -1)).toBe(sesnos[sesnos.length - 1]);
        const below = Math.min(...sesnos) - 1;
        expect(stepCursor(candidates, below, -1)).toBe(below);
        expect(stepCursor(candidates, below, 1)).toBe(sesnos[0]);
      }),
      { numRuns: 100 },
    );
  });

  it('点击单刻度取该刻度，簇取簇内可导航版本中 sesno 最大者，簇内无可导航版本时保持原值', () => {
    fc.assert(
      fc.property(
        versionsArb.chain((raw) => widthArb.chain((widthPx) => fc.tuple(
          fc.constant(raw),
          fc.constant(widthPx),
          fc.boolean(),
          fc.nat({ max: 1000 }),
        ))),
        ([raw, widthPx, geometryOnly, index]) => {
          const { ticks, versions, clusters } = build(raw, widthPx);
          const candidates = navigableTicks(ticks, versions, geometryOnly);
          const current = candidates.length > 0 ? candidates[0]!.sesno : 1;

          // 单刻度簇：每条刻度自成一个簇
          const single: TickCluster = { x: 0, sesnos: [ticks[0]!.sesno], first: 0, last: 0, anomaly: false };
          const inCandidates = candidates.some((t) => t.sesno === ticks[0]!.sesno);
          expect(clickTick(candidates, single, current)).toBe(inCandidates ? ticks[0]!.sesno : current);

          if (clusters.length === 0) return;
          const clicked = clusters[index % clusters.length]!;
          const members = new Set(clicked.sesnos);
          const navigableInCluster = candidates.filter((t) => members.has(t.sesno)).map((t) => t.sesno);
          const got = clickTick(candidates, clicked, current);
          if (navigableInCluster.length === 0) {
            expect(got).toBe(current);
          } else {
            expect(got).toBe(Math.max(...navigableInCluster));
            expect(members.has(got)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 11: 勾选「只看几何变的」时的游标迁移', () => {
  // Feature: model-version-timeline-scrub, Property 11: 勾选「只看几何变的」时的游标迁移
  it('当前是几何变化版本则不动，否则取不大于它的最后一个，再退到最小，没有几何变化版本时为 null', () => {
    fc.assert(
      fc.property(versionsArb, fc.integer({ min: 0, max: 500 }), (raw, current) => {
        const ordered = orderVersions(raw);
        const geometrySesnos = ordered.filter((v) => isGeometryChange(v.impactKind)).map((v) => v.sesno);
        const got = coerceCursorForGeometryOnly(ordered, current);

        if (geometrySesnos.length === 0) {
          expect(got).toBeNull();
          return;
        }
        if (geometrySesnos.includes(current)) {
          expect(got).toBe(current);
          return;
        }
        const atOrBefore = geometrySesnos.filter((s) => s <= current);
        const want = atOrBefore.length > 0 ? Math.max(...atOrBefore) : Math.min(...geometrySesnos);
        expect(got).toBe(want);
        // 结果一定是几何变化版本
        expect(isGeometryChange(ordered.find((v) => v.sesno === got)!.impactKind)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('迁移后的游标在可导航集合里，且开关来回切换不会把游标落到「仅属性」版本上', () => {
    fc.assert(
      fc.property(versionsArb, widthArb, fc.integer({ min: 1, max: 400 }), (raw, widthPx, start) => {
        const { ticks, versions, ordered } = build(raw, widthPx);
        const geometryOnly = navigableTicks(ticks, versions, true);
        const coerced = coerceCursorForGeometryOnly(ordered, start);
        if (geometryOnly.length === 0) {
          expect(coerced).toBeNull();
          return;
        }
        expect(geometryOnly.some((t) => t.sesno === coerced)).toBe(true);
        // 再迁一次是幂等的
        expect(coerceCursorForGeometryOnly(ordered, coerced!)).toBe(coerced);
      }),
      { numRuns: 100 },
    );
  });

  it('可导航刻度的 sesno 严格升序（吸附 / 移动都依赖这个前提）', () => {
    fc.assert(
      fc.property(versionsArb, widthArb, fc.boolean(), (raw, widthPx, geometryOnly) => {
        const { ticks, versions } = build(raw, widthPx);
        const candidates: LaidTick[] = navigableTicks(ticks, versions, geometryOnly);
        for (let i = 1; i < candidates.length; i += 1) {
          expect(candidates[i]!.sesno).toBeGreaterThan(candidates[i - 1]!.sesno);
        }
      }),
      { numRuns: 100 },
    );
  });
});
