import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import {
  fullViewport, impactPalette, layoutTicks, minSpanOf, orderVersions, timeAnomalies, viewportForCluster, zoomViewport,
  type ScrubVersion, type TickCluster,
} from './tickLayout';

const IMPACT_KINDS = ['mesh', 'placement', 'delivery', 'tombstone', 'noop'] as const;

/** 版本行：sesno 允许重复（交给 orderVersions 去重），时间可缺失或乱序。 */
const versionArb: fc.Arbitrary<ScrubVersion> = fc.record({
  sesno: fc.integer({ min: 1, max: 500 }),
  sessionTime: fc.option(
    fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2027, 0, 1) }).map((ms) => new Date(ms).toISOString()),
    { nil: null },
  ),
  impactKind: fc.option(fc.constantFrom(...IMPACT_KINDS), { nil: null }),
});

const versionsArb = fc.array(versionArb, { minLength: 0, maxLength: 120 });

/** 序号视口：起点落在全量范围外侧若干格内，跨度为正（含极小与超过全量的跨度）。 */
function viewportArb(n: number) {
  return fc.record({
    start: fc.double({ min: -10, max: n + 10, noNaN: true }),
    span: fc.double({ min: 0.01, max: n + 20, noNaN: true }),
  }).map(({ start, span }) => ({ start, end: start + span }));
}

const widthArb = fc.double({ min: 1, max: 3000, noNaN: true });

/** 浮点容差：簇中心由两次 ordinalToX 相减得出，允许末位误差。 */
const EPS = 1e-9;

describe('Property 1: 簇划分是刻度序列的有序切分', () => {
  // Feature: model-version-timeline-scrub, Property 1: 簇划分是刻度序列的有序切分
  it('簇按序拼接等于刻度序列，覆盖视口，间距与首末正确', () => {
    fc.assert(
      fc.property(
        versionsArb.chain((raw) => {
          const ordered = orderVersions(raw);
          return fc.tuple(fc.constant(ordered), viewportArb(ordered.length), widthArb);
        }),
        ([ordered, viewport, widthPx]) => {
          const n = ordered.length;
          const { ticks, clusters, gapPx } = layoutTicks({
            ordered, viewport, widthPx, anomalies: timeAnomalies(ordered),
          });

          const lo = Math.max(0, Math.ceil(viewport.start));
          const hi = Math.min(n - 1, Math.floor(viewport.end));
          if (n === 0 || lo > hi) {
            expect(ticks).toEqual([]);
            expect(clusters).toEqual([]);
            return;
          }

          // 刻度：序号连续，sesno 取自对应序号，因此严格升序
          ticks.forEach((t, i) => {
            expect(t.sesno).toBe(ordered[t.ordinal]!.sesno);
            if (i > 0) expect(t.ordinal).toBe(ticks[i - 1]!.ordinal + 1);
          });

          // 不丢、不重、不乱序：簇 sesnos 按序拼接恰好等于刻度 sesno 序列
          expect(clusters.flatMap((c) => c.sesnos)).toEqual(ticks.map((t) => t.sesno));

          // 视口覆盖的每个序号都有刻度
          const ordinals = new Set(ticks.map((t) => t.ordinal));
          for (let i = lo; i <= hi; i += 1) expect(ordinals.has(i)).toBe(true);

          // 两端簇与视口相交（整桶纳入），中间簇完全在视口内
          const ordOf = new Map(ticks.map((t) => [t.sesno, t.ordinal] as const));
          clusters.forEach((c, ci) => {
            const ords = c.sesnos.map((s) => ordOf.get(s)!);
            const inView = ords.filter((o) => o >= lo && o <= hi);
            expect(inView.length).toBeGreaterThan(0);
            if (ci > 0 && ci < clusters.length - 1) expect(inView.length).toBe(ords.length);
          });

          // 刻度间距不小于 4 px 时每簇只含一个刻度
          if (gapPx >= 4) clusters.forEach((c) => expect(c.sesnos.length).toBe(1));

          // 相邻簇中心间距不小于 4 px
          for (let i = 1; i < clusters.length; i += 1) {
            expect(clusters[i]!.x - clusters[i - 1]!.x).toBeGreaterThanOrEqual(4 - EPS);
          }

          // first / last 是簇内 sesno 最小 / 最大者
          clusters.forEach((c) => {
            expect(c.sesnos.length).toBeGreaterThan(0);
            expect(c.first).toBe(Math.min(...c.sesnos));
            expect(c.last).toBe(Math.max(...c.sesnos));
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 1: 簇划分是刻度序列的有序切分
  it('跨度或轴宽非正时不出刻度与簇', () => {
    fc.assert(
      fc.property(
        versionsArb.map(orderVersions),
        fc.double({ min: -10, max: 200, noNaN: true }),
        fc.double({ min: -50, max: 0, noNaN: true }),
        widthArb,
        fc.double({ min: -3000, max: 0, noNaN: true }),
        (ordered, start, nonPosSpan, widthPx, nonPosWidth) => {
          const anomalies = timeAnomalies(ordered);
          const a = layoutTicks({ ordered, viewport: { start, end: start + nonPosSpan }, widthPx, anomalies });
          expect(a.ticks).toEqual([]);
          expect(a.clusters).toEqual([]);
          const b = layoutTicks({ ordered, viewport: { start, end: start + 5 }, widthPx: nonPosWidth, anomalies });
          expect(b.ticks).toEqual([]);
          expect(b.clusters).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** 另一套 Session_Time：任意时间、缺失，或不可解析的串（按无时间处理）。 */
const altTimeArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: Date.UTC(1990, 0, 1), max: Date.UTC(2040, 0, 1) }).map((ms) => new Date(ms).toISOString()),
  fc.constant('not-a-time'),
);

describe('Property 2: 刻度按序号等距排布', () => {
  // Feature: model-version-timeline-scrub, Property 2: 刻度按序号等距排布
  it('x 只由序号决定：换掉 Session_Time 后刻度与簇不变，且按公式等距', () => {
    fc.assert(
      fc.property(
        versionsArb.chain((raw) => {
          const n = orderVersions(raw).length;
          return fc.tuple(
            fc.constant(raw),
            fc.array(altTimeArb, { minLength: raw.length, maxLength: raw.length }),
            viewportArb(n),
            widthArb,
          );
        }),
        ([raw, altTimes, viewport, widthPx]) => {
          const rawB = raw.map((v, i) => ({ ...v, sessionTime: altTimes[i]! }));
          const orderedA = orderVersions(raw);
          const orderedB = orderVersions(rawB);

          // orderVersions 按 sesno 严格升序，与时间无关
          for (let i = 1; i < orderedA.length; i += 1) {
            expect(orderedA[i]!.sesno).toBeGreaterThan(orderedA[i - 1]!.sesno);
          }
          expect(orderedB.map((v) => v.sesno)).toEqual(orderedA.map((v) => v.sesno));

          const a = layoutTicks({ ordered: orderedA, viewport, widthPx, anomalies: timeAnomalies(orderedA) });
          const b = layoutTicks({ ordered: orderedB, viewport, widthPx, anomalies: timeAnomalies(orderedB) });

          // 刻度与簇（不比 anomaly，它本就依赖时间）不随 Session_Time 变化
          expect(b.ticks).toEqual(a.ticks);
          expect(b.clusters.map((c) => ({ x: c.x, sesnos: c.sesnos })))
            .toEqual(a.clusters.map((c) => ({ x: c.x, sesnos: c.sesnos })));
          expect(b.gapPx).toBe(a.gapPx);

          // x = (ordinal − start) / (end − start) × widthPx；相邻刻度 x 差相等
          const span = viewport.end - viewport.start;
          a.ticks.forEach((t) => {
            expect(t.x).toBeCloseTo(((t.ordinal - viewport.start) / span) * widthPx, 6);
          });
          for (let i = 2; i < a.ticks.length; i += 1) {
            const d1 = a.ticks[i]!.x - a.ticks[i - 1]!.x;
            const d0 = a.ticks[1]!.x - a.ticks[0]!.x;
            expect(Math.abs(d1 - d0)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(d0)));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 3 的时间规格：带标签生成，参考实现直接读标签，不经 Date.parse。
 * 时间集中在约 6 秒的窄窗口内，让同秒不同毫秒、同毫秒、跨秒逆序都频繁出现；另有缺失与不可解析两种。
 */
type TimeSpec = { kind: 'none' } | { kind: 'bad'; text: string } | { kind: 'at'; ms: number };
const BASE_MS = Date.UTC(2026, 4, 1, 8, 0, 0);
const timeSpecArb: fc.Arbitrary<TimeSpec> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<TimeSpec>({ kind: 'none' }) },
  { weight: 1, arbitrary: fc.constantFrom('not-a-time', '2026-13-45T99:99:99Z', 'yesterday').map((text): TimeSpec => ({ kind: 'bad', text })) },
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 6000 }).map((d): TimeSpec => ({ kind: 'at', ms: BASE_MS + d })) },
);
const specRowArb = fc.record({
  sesno: fc.integer({ min: 1, max: 200 }),
  time: timeSpecArb,
  impactKind: fc.option(fc.constantFrom(...IMPACT_KINDS), { nil: null }),
});

function specText(t: TimeSpec): string | null {
  if (t.kind === 'none') return null;
  if (t.kind === 'bad') return t.text;
  return new Date(t.ms).toISOString();
}

/**
 * 暴力参考：对每个带时间的 v，在 sesno 小于它的带时间版本中取 sesno 最大的 u；
 * u 的秒级时间晚于 v 时记 v → u。
 */
function referenceAnomalies(rows: { sesno: number; time: TimeSpec }[]): Map<number, number> {
  const timed = rows.filter((r) => r.time.kind === 'at')
    .map((r) => ({ sesno: r.sesno, sec: Math.floor((r.time as { ms: number }).ms / 1000) }));
  const out = new Map<number, number>();
  for (const v of timed) {
    let u: { sesno: number; sec: number } | null = null;
    for (const w of timed) {
      if (w.sesno < v.sesno && (u === null || w.sesno > u.sesno)) u = w;
    }
    if (u && u.sec > v.sec) out.set(v.sesno, u.sesno);
  }
  return out;
}

describe('Property 3: 时间异常标记', () => {
  // Feature: model-version-timeline-scrub, Property 3: 时间异常标记
  it('timeAnomalies 与暴力参考一致，簇 anomaly 当且仅当簇内有异常 sesno', () => {
    fc.assert(
      fc.property(
        fc.array(specRowArb, { minLength: 0, maxLength: 80 })
          // sesno 去重（保留首行），使参考实现与 orderVersions 看到同一组行
          .map((rows) => rows.filter((r, i) => rows.findIndex((x) => x.sesno === r.sesno) === i))
          .chain((rows) => fc.tuple(fc.constant(rows), viewportArb(rows.length), widthArb)),
        ([rows, viewport, widthPx]) => {
          const raw: ScrubVersion[] = rows.map((r) => ({ sesno: r.sesno, sessionTime: specText(r.time), impactKind: r.impactKind }));
          const ordered = orderVersions(raw);
          const got = timeAnomalies(ordered);
          const want = referenceAnomalies(rows);

          expect([...got.entries()].sort((a, b) => a[0] - b[0]))
            .toEqual([...want.entries()].sort((a, b) => a[0] - b[0]));

          // 无时间（缺失或不可解析）的版本不在集合中
          rows.filter((r) => r.time.kind !== 'at').forEach((r) => expect(got.has(r.sesno)).toBe(false));

          const { clusters } = layoutTicks({ ordered, viewport, widthPx, anomalies: got });
          clusters.forEach((c) => {
            expect(c.anomaly).toBe(c.sesnos.some((s) => want.has(s)));
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: 影响类型配色', () => {
  // Feature: model-version-timeline-scrub, Property 4: 影响类型配色
  it('出现的每种 impact_kind 恰一种颜色，两两不同，noop 空心其余实心，与子集无关', () => {
    const full = impactPalette(IMPACT_KINDS);
    expect(full.size).toBe(IMPACT_KINDS.length);
    expect(new Set([...full.values()].map((p) => p.color)).size).toBe(IMPACT_KINDS.length);

    fc.assert(
      fc.property(
        // 版本表的 impact_kind 列：允许重复、任意顺序、可为空
        fc.array(fc.constantFrom(...IMPACT_KINDS), { minLength: 0, maxLength: 40 }),
        (kinds) => {
          const palette = impactPalette(kinds);

          // 键恰为出现过的取值集合（重复只出现一次）
          expect(new Set(palette.keys())).toEqual(new Set(kinds));
          expect(palette.size).toBe(new Set(kinds).size);

          // 颜色两两不同
          const colors = [...palette.values()].map((p) => p.color);
          expect(new Set(colors).size).toBe(colors.length);

          palette.forEach((p, kind) => {
            expect(typeof p.color).toBe('string');
            expect(p.color.length).toBeGreaterThan(0);
            expect(p.hollow).toBe(kind === 'noop');
            // 同一取值在任何子集下颜色一致
            expect(p).toEqual(full.get(kind));
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** 落在全量范围内、跨度在 [min(5, n), n] 内的视口，让「未触及限制」分支常被命中。 */
function inRangeViewportArb(n: number) {
  const minSpan = minSpanOf(n);
  return fc.record({
    t: fc.double({ min: 0, max: 1, noNaN: true }),
    span: fc.double({ min: minSpan, max: n, noNaN: true }),
  }).map(({ t, span }) => {
    const start = -0.5 + t * (n - span);
    return { start, end: start + span };
  });
}

/** n ≥ 1、视口（全量范围内外皆有）、锚点（视口内外皆有）与有效缩放倍数 */
const zoomCaseArb = fc.integer({ min: 1, max: 200 }).chain((n) => fc.tuple(
  fc.constant(n),
  fc.oneof(viewportArb(n), inRangeViewportArb(n)),
  fc.double({ min: -0.5, max: 1.5, noNaN: true }),
  fc.oneof(fc.double({ min: 0.2, max: 5, noNaN: true }), fc.double({ min: 0.001, max: 100, noNaN: true })),
));

/** 有序 sesno 表与其中一段连续刻度构成的簇 */
const clusterCaseArb = versionsArb
  .map((raw) => orderVersions(raw).map((v) => v.sesno))
  .filter((sesnos) => sesnos.length > 0)
  .chain((sesnos) => fc.tuple(
    fc.constant(sesnos),
    fc.integer({ min: 0, max: sesnos.length - 1 }),
    fc.integer({ min: 0, max: sesnos.length - 1 }),
    widthArb,
  ));

describe('Property 6: 序号缩放约束', () => {
  // Feature: model-version-timeline-scrub, Property 6: 序号缩放约束
  it('zoomViewport 结果在全量范围内、跨度在 [min(5, n), n]，未触及限制时锚点相对位置不变', () => {
    fc.assert(
      fc.property(zoomCaseArb, ([n, viewport, anchorT, factor]) => {
        const oldSpan = viewport.end - viewport.start;
        const anchor = viewport.start + anchorT * oldSpan;
        const r = zoomViewport(viewport, anchor, factor, n);
        const span = r.end - r.start;
        const tol = 1e-9 * Math.max(1, n);

        expect(r.start).toBeGreaterThanOrEqual(-0.5 - tol);
        expect(r.end).toBeLessThanOrEqual(n - 0.5 + tol);
        expect(span).toBeGreaterThanOrEqual(minSpanOf(n) - tol);
        expect(span).toBeLessThanOrEqual(n + tol);

        // 未触及限制：缩放后跨度不需钳，以锚点为中心的候选视口不需平移
        const rawSpan = oldSpan * factor;
        const rel = (anchor - viewport.start) / oldSpan;
        const candStart = anchor - rel * rawSpan;
        const untouched = rawSpan >= minSpanOf(n) && rawSpan <= n
          && candStart >= -0.5 && candStart + rawSpan <= n - 0.5;
        if (untouched) {
          expect(Math.abs(span - rawSpan)).toBeLessThanOrEqual(tol);
          expect(Math.abs((anchor - r.start) / span - rel)).toBeLessThanOrEqual(1e-6);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 6: 序号缩放约束
  it('无效 factor 当 1；n = 0 返回 fullViewport(0)；minSpanOf / fullViewport 符合定义', () => {
    fc.assert(
      fc.property(
        zoomCaseArb,
        fc.constantFrom(0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        fc.integer({ min: 0, max: 300 }),
        ([n, viewport, anchorT, factor], badFactor, m) => {
          const anchor = viewport.start + anchorT * (viewport.end - viewport.start);
          expect(zoomViewport(viewport, anchor, badFactor, n)).toEqual(zoomViewport(viewport, anchor, 1, n));
          expect(zoomViewport(viewport, anchor, factor, 0)).toEqual(fullViewport(0));
          expect(minSpanOf(m)).toBe(Math.min(5, m));
          expect(fullViewport(m)).toEqual({ start: -0.5, end: m - 0.5 });
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 6: 序号缩放约束
  it('viewportForCluster 覆盖簇首末刻度，且间距 ≥ 4 px 或跨度等于 min(5, n)', () => {
    fc.assert(
      fc.property(clusterCaseArb, ([sesnos, a, b, widthPx]) => {
        const n = sesnos.length;
        const firstOrd = Math.min(a, b);
        const lastOrd = Math.max(a, b);
        const members = sesnos.slice(firstOrd, lastOrd + 1);
        const cluster: TickCluster = {
          x: 0, sesnos: members, first: members[0]!, last: members[members.length - 1]!, anomaly: false,
        };
        const r = viewportForCluster(cluster, sesnos, widthPx);
        const span = r.end - r.start;
        const tol = 1e-9 * Math.max(1, n);

        // 覆盖簇首末刻度，且落在全量范围内
        expect(r.start).toBeLessThanOrEqual(firstOrd);
        expect(r.end).toBeGreaterThanOrEqual(lastOrd);
        expect(r.start).toBeGreaterThanOrEqual(-0.5 - tol);
        expect(r.end).toBeLessThanOrEqual(n - 0.5 + tol);

        // 间距那一半排除轴极窄（widthPx < 簇刻度数 × 4）：此时覆盖簇已迫使间距 < 4 px
        if (widthPx >= members.length * 4) {
          const gapOk = widthPx / span >= 4 - EPS;
          const atMin = Math.abs(span - minSpanOf(n)) <= tol;
          expect(gapOk || atMin).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
