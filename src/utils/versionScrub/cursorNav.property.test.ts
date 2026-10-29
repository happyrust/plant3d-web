import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import {
  clickTick, coerceCursorForGeometryOnly, initialCursor, isGeometryChange, navigableTicks, snapToPointer, stepCursor,
} from './cursorNav';
import { fullViewport, layoutTicks, orderVersions, timeAnomalies, type ScrubVersion } from './tickLayout';

const IMPACT_KINDS = ['mesh', 'placement', 'delivery', 'tombstone', 'noop'] as const;

/** 版本行：sesno 允许重复（交给 orderVersions 去重），impact_kind 含 null（未知）与 noop（仅属性）。 */
const versionArb: fc.Arbitrary<ScrubVersion> = fc.record({
  sesno: fc.integer({ min: 1, max: 300 }),
  sessionTime: fc.constant(null),
  impactKind: fc.option(fc.constantFrom(...IMPACT_KINDS), { nil: null }),
});

/** 非空版本表 */
const versionsArb = fc.array(versionArb, { minLength: 1, maxLength: 80 });

/** 轴宽：窄轴时刻度会合并成簇，点击簇覆盖「簇内取 sesno 最大的可导航版本」路径。 */
const widthArb = fc.double({ min: 20, max: 2000, noNaN: true });

/**
 * 用户操作：
 * - drag：按住后依次移到各指针位置（可超出轴两端），然后松开（含在轴外松开）；
 * - key：方向键；click：点击第 index 个簇（取模）；toggle：切换「只看几何变的」。
 */
type Op =
  | { type: 'drag'; xs: number[] }
  | { type: 'key'; delta: -1 | 1 }
  | { type: 'click'; index: number }
  | { type: 'toggle' };

function opArb(widthPx: number): fc.Arbitrary<Op> {
  return fc.oneof(
    fc.record({
      type: fc.constant('drag' as const),
      xs: fc.array(fc.double({ min: -200, max: widthPx + 200, noNaN: true }), { minLength: 1, maxLength: 6 }),
    }),
    fc.record({ type: fc.constant('key' as const), delta: fc.constantFrom(-1 as const, 1 as const) }),
    fc.record({ type: fc.constant('click' as const), index: fc.nat({ max: 1000 }) }),
    fc.record({ type: fc.constant('toggle' as const) }),
  );
}

describe('Property 8: 游标不变量', () => {
  // Feature: model-version-timeline-scrub, Property 8: 游标不变量
  it('任意吸附 / 松开 / 方向键 / 点击 / 开关序列后，游标恰落在当前可导航刻度上，集合为空时为 null', () => {
    fc.assert(
      fc.property(
        versionsArb.chain((raw) => widthArb.chain((widthPx) => fc.tuple(
          fc.constant(raw),
          fc.constant(widthPx),
          fc.boolean(),
          fc.array(opArb(widthPx), { minLength: 1, maxLength: 30 }),
        ))),
        ([raw, widthPx, geometryOnlyAtStart, ops]) => {
          const ordered = orderVersions(raw);
          const versions = new Map(ordered.map((v) => [v.sesno, v] as const));
          const { ticks, clusters } = layoutTicks({
            ordered, viewport: fullViewport(ordered.length), widthPx, anomalies: timeAnomalies(ordered),
          });
          // 全量视口下每行一个刻度（Requirement 2.1 的「版本表中的版本」）
          expect(ticks.map((t) => t.sesno)).toEqual(ordered.map((v) => v.sesno));

          let geometryOnly = geometryOnlyAtStart;
          const nav = () => navigableTicks(ticks, versions, geometryOnly);

          const checkInvariant = (cursor: number | null) => {
            const candidates = nav();
            // 可导航集合按 sesno 升序，且开关打开时只含几何变化版本
            for (let i = 1; i < candidates.length; i += 1) {
              expect(candidates[i]!.sesno).toBeGreaterThan(candidates[i - 1]!.sesno);
            }
            if (candidates.length === 0) {
              // Requirement 2.11：可导航集合为空时不显示游标
              expect(cursor).toBeNull();
              return;
            }
            // Requirement 2.1：恰好一个游标，指向可导航集合中的一个版本
            expect(cursor).not.toBeNull();
            expect(candidates.filter((t) => t.sesno === cursor)).toHaveLength(1);
            expect(versions.has(cursor!)).toBe(true);
            // Requirement 2.9：开关打开时游标所指版本是几何变化版本
            if (geometryOnly) {
              expect(isGeometryChange(versions.get(cursor!)!.impactKind)).toBe(true);
            }
          };

          let cursor = initialCursor(nav());
          checkInvariant(cursor);

          for (const op of ops) {
            switch (op.type) {
              case 'drag': {
                let lastSnap: number | null = null;
                for (const x of op.xs) {
                  const snapped = snapToPointer(nav(), x);
                  if (snapped !== null) {
                    cursor = snapped;
                    lastSnap = snapped;
                  }
                  checkInvariant(cursor);
                }
                // 松开（含轴外松开）不再吸附：Requirement 2.4，游标等于松开前最后一次吸附结果
                if (nav().length > 0) expect(cursor).toBe(lastSnap);
                else expect(lastSnap).toBeNull();
                break;
              }
              case 'key':
                if (cursor !== null) cursor = stepCursor(nav(), cursor, op.delta);
                break;
              case 'click':
                if (cursor !== null && clusters.length > 0) {
                  cursor = clickTick(nav(), clusters[op.index % clusters.length]!, cursor);
                }
                break;
              case 'toggle':
                geometryOnly = !geometryOnly;
                if (geometryOnly) {
                  cursor = cursor === null ? initialCursor(nav()) : coerceCursorForGeometryOnly(ordered, cursor);
                } else if (cursor === null) {
                  cursor = initialCursor(nav());
                }
                break;
            }
            checkInvariant(cursor);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
