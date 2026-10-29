import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { normalizePins, pinSide, pinsWithLatest, pinsWithPrevious, type Pins } from './pins';

/** 一次钉操作：钉 A / 钉 B / 拖动钉都归结为 pinSide(side, sesno) */
type PinOp = { side: 'a' | 'b'; sesno: number };

// sesno 取小范围，让同 sesno 撞车（被拒）与交换都高频出现
const sesnoArb = fc.integer({ min: 1, max: 8 });
const opArb: fc.Arbitrary<PinOp> = fc.record({
  side: fc.constantFrom<'a' | 'b'>('a', 'b'),
  sesno: sesnoArb,
});
const pinsArb: fc.Arbitrary<Pins> = fc.record({
  a: fc.option(sesnoArb, { nil: null }),
  b: fc.option(sesnoArb, { nil: null }),
});

function sortedValues(pins: Pins): number[] {
  return [pins.a, pins.b].filter((v): v is number => v !== null).sort((x, y) => x - y);
}

/** **Validates: Requirements 5.1, 5.2, 5.3** */
describe('pins property tests', () => {
  // Feature: model-version-timeline-scrub, Property 21: 钉不变量
  it('Property 21: 任意钉操作序列后 A < B 且不相等；同 sesno 被拒且状态不变；钉集合与模型一致；normalizePins 幂等', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        let pins: Pins = { a: null, b: null };
        for (const op of ops) {
          const before: Pins = { a: pins.a, b: pins.b };
          const other = op.side === 'a' ? before.b : before.a;
          const result = pinSide(before, op.side, op.sesno);

          // 入参不被改写
          expect(before).toEqual(pins);

          if (other !== null && other === op.sesno) {
            // 两钉设成同一 sesno：拒绝，状态不变
            expect(result.rejected).toBe('same-version');
            expect(result.pins).toEqual(before);
            expect(result.pins).not.toBe(before);
          } else {
            expect(result.rejected).toBeNull();
            // 钉集合恰是「本次钉的 sesno + 另一侧原值」，按 sesno 排序后落到 A、B
            const expected = [op.sesno, other]
              .filter((v): v is number => v !== null)
              .sort((x, y) => x - y);
            expect(sortedValues(result.pins)).toEqual(expected);
          }

          pins = result.pins;
          // 每步不变量：两侧都有值时 A 的 sesno 严格小于 B
          if (pins.a !== null && pins.b !== null) {
            expect(pins.a).toBeLessThan(pins.b);
            expect(pins.a).not.toBe(pins.b);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 21: 钉不变量
  it('Property 21: normalizePins 幂等、只按 sesno 交换且不丢值', () => {
    fc.assert(
      fc.property(pinsArb, (pins) => {
        const once = normalizePins(pins);
        expect(normalizePins(once)).toEqual(once);
        expect(sortedValues(once)).toEqual(sortedValues(pins));
        if (once.a !== null && once.b !== null) {
          expect(once.a).toBeLessThanOrEqual(once.b);
        } else {
          expect(once).toEqual(pins);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * 严格升序且不连号的 sesno 表：首项 ≥ 1，相邻差 ≥ 2，
 * 这样表内两项之间总有不在表中的 sesno 可作「游标不在表中」的样本。
 */
const sesnoTableArb: fc.Arbitrary<number[]> = fc
  .tuple(fc.integer({ min: 1, max: 50 }), fc.array(fc.integer({ min: 2, max: 20 }), { maxLength: 15 }))
  .map(([first, gaps]) => {
    const table = [first];
    for (const gap of gaps) table.push(table[table.length - 1]! + gap);
    return table;
  });

/** 表 + 游标：游标要么取表中某项，要么取不在表中的值（缝隙、首项之前、末项之后） */
const tableWithCursorArb: fc.Arbitrary<{ table: number[]; cursor: number; inTable: boolean }> =
  sesnoTableArb.chain((table) => {
    const offTable = new Set<number>([0, table[table.length - 1]! + 1]);
    for (let i = 0; i + 1 < table.length; i += 1) offTable.add(table[i]! + 1);
    return fc.oneof(
      fc.constantFrom(...table).map((cursor) => ({ table, cursor, inTable: true })),
      fc.constantFrom(...offTable).map((cursor) => ({ table, cursor, inTable: false })),
    );
  });

/** **Validates: Requirements 5.10, 5.11, 5.12** */
describe('pins quick-compare property tests', () => {
  // Feature: model-version-timeline-scrub, Property 22: 与上一版比 / 与最新比
  it('Property 22: pinsWithPrevious 返回 {a: 前一项, b: 游标}，首版或不在表中为 null', () => {
    fc.assert(
      fc.property(tableWithCursorArb, ({ table, cursor, inTable }) => {
        const snapshot = [...table];
        const result = pinsWithPrevious(table, cursor);
        expect(table).toEqual(snapshot);

        const i = table.indexOf(cursor);
        expect(i >= 0).toBe(inTable);
        if (i <= 0) {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        const { a, b } = result!;
        expect(a).not.toBeNull();
        expect(b).toBe(cursor);
        expect(a!).toBeLessThan(b!);
        expect(table).toContain(a);
        expect(table).toContain(b);
        // 相邻关系：a 恰是 b 在表中的前一项，二者之间没有其他版本
        expect(table.indexOf(a!)).toBe(i - 1);
        expect(table.filter((s) => s > a! && s < b!)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 22: 与上一版比 / 与最新比
  it('Property 22: pinsWithLatest 返回 {a: 游标, b: 末项}，末版或不在表中为 null', () => {
    fc.assert(
      fc.property(tableWithCursorArb, ({ table, cursor, inTable }) => {
        const snapshot = [...table];
        const result = pinsWithLatest(table, cursor);
        expect(table).toEqual(snapshot);

        const i = table.indexOf(cursor);
        expect(i >= 0).toBe(inTable);
        if (i < 0 || i === table.length - 1) {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        const { a, b } = result!;
        expect(a).toBe(cursor);
        expect(b).toBe(table[table.length - 1]);
        expect(a!).toBeLessThan(b!);
        expect(table).toContain(a);
        expect(table).toContain(b);
        // b 是表中 sesno 最大的一版
        expect(table.every((s) => s <= b!)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 22: 与上一版比 / 与最新比
  it('Property 22: 首版无「与上一版比」，末版无「与最新比」；空表两者皆为 null', () => {
    fc.assert(
      fc.property(sesnoTableArb, fc.integer({ min: 0, max: 400 }), (table, anyCursor) => {
        const first = table[0]!;
        const last = table[table.length - 1]!;
        expect(pinsWithPrevious(table, first)).toBeNull();
        expect(pinsWithLatest(table, last)).toBeNull();
        expect(pinsWithPrevious([], anyCursor)).toBeNull();
        expect(pinsWithLatest([], anyCursor)).toBeNull();
        if (table.length >= 2) {
          // 表内至少两版时，首版可与最新比、末版可与上一版比
          expect(pinsWithLatest(table, first)).toEqual({ a: first, b: last });
          expect(pinsWithPrevious(table, last)).toEqual({ a: table[table.length - 2], b: last });
        }
      }),
      { numRuns: 100 },
    );
  });
});
