import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { ghostOrdinal } from '@/utils/versionScrub/tickLayout';

/**
 * Property 7: 切换范围保留游标与钉，灰标位置正确（tasks.md 14.5）。
 *
 * Feature: model-version-timeline-scrub, Property 7: 切换范围保留游标与钉，灰标位置正确
 *
 * 这里的口径与 `useVersionScrubber` 完全一致：
 * - `versions` = 范围版本表按 sesno 升序（`orderVersions` 之后），是 `ghostOrdinal` 的尺子；
 * - 切范围（`setScope`）只改范围版本表，游标与两钉的 sesno 原样不动；
 * - `outOfScope` 每一项为真 ⟺ 对应 sesno 不在新范围版本表里；
 * - 不在表里的 sesno，`ghostOrdinal` 严格落在「小于它的最后一个刻度」与「大于它的第一个刻度」之间。
 *
 * 纯函数部分（`ghostOrdinal`）与组合式函数的状态保持各测一半：组合式函数只做「切范围不碰游标 / 钉」与
 * `outOfScope` 的判定，两个方向都要有例子钉住，属性测试负责任意表与任意 sesno。
 */

/** 两张范围版本表（sesno 升序、严格递增，交给 `orderVersions` 之前允许重复） */
const tableArb = fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 0, maxLength: 40 });

describe('Property 7: 切换范围保留游标与钉，灰标位置正确', () => {
  // Feature: model-version-timeline-scrub, Property 7
  it('不在表中的 sesno：灰标序号严格大于所有更小刻度的序号、严格小于所有更大刻度的序号', () => {
    fc.assert(
      fc.property(tableArb, fc.integer({ min: 0, max: 401 }), (raw, sesno) => {
        const ordered = [...new Set(raw)].sort((a, b) => a - b);
        const ordinal = ghostOrdinal(ordered, sesno);
        const index = ordered.indexOf(sesno);
        if (index >= 0) {
          // 在表里：就是它自己的序号
          expect(ordinal).toBe(index);
          return;
        }
        ordered.forEach((other, i) => {
          if (other < sesno) expect(ordinal).toBeGreaterThan(i);
          if (other > sesno) expect(ordinal).toBeLessThan(i);
        });
        // 比全表都小 / 都大时正好落在两端外面半格
        if (ordered.length === 0) expect(ordinal).toBe(-0.5);
        else if (sesno > ordered[ordered.length - 1]!) expect(ordinal).toBe(ordered.length - 0.5);
        else if (sesno < ordered[0]!) expect(ordinal).toBe(-0.5);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 7
  it('灰标序号随 sesno 单调不减：s1 < s2 时 ghostOrdinal(s1) ≤ ghostOrdinal(s2)', () => {
    fc.assert(
      fc.property(tableArb, fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 400 }), (raw, x, y) => {
        const ordered = [...new Set(raw)].sort((a, b) => a - b);
        const lo = Math.min(x, y);
        const hi = Math.max(x, y);
        expect(ghostOrdinal(ordered, lo)).toBeLessThanOrEqual(ghostOrdinal(ordered, hi));
      }),
      { numRuns: 100 },
    );
  });
});
