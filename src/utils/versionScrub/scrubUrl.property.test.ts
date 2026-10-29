import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { normalizePins } from './pins';
import { readScrubUrl, reconcileScrubState, writeScrubUrl, type ScrubUrlState } from './scrubUrl';

/** 合法面板状态：节点、范围、游标，A / B 钉各可有可无。 */
const stateArb: fc.Arbitrary<ScrubUrlState> = fc
  .record({
    dbno: fc.integer({ min: 1, max: 9999 }),
    ref0: fc.integer({ min: 1, max: 99999 }),
    ref1: fc.integer({ min: 1, max: 99999 }),
    scope: fc.constantFrom<'self' | 'subtree'>('self', 'subtree'),
    cursor: fc.integer({ min: 1, max: 100000 }),
    a: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: null }),
    b: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: null }),
  })
  .map(({ dbno, ref0, ref1, scope, cursor, a, b }) => {
    // 钉按 normalizePins 之后的形态给出（面板写链接时传入的就是它）
    const pins = normalizePins({ a, b });
    return { unitRefno: `${dbno}_${ref0}_${ref1}`, scope, cursor, a: pins.a, b: pins.b };
  });

/** href：可能已含本特性之外的参数（`gm_backend` / `project` / `mdb` 等）。 */
const hrefArb = fc
  .array(
    fc.tuple(
      fc.constantFrom('gm_backend', 'project', 'mdb', 'namespace', 'theme'),
      fc.stringMatching(/^[A-Za-z0-9_.:-]{0,12}$/),
    ),
    { maxLength: 5 },
  )
  .map((pairs) => {
    const params = new URLSearchParams();
    for (const [key, value] of pairs) params.set(key, value);
    return `https://plant.example/app/?${params.toString()}`;
  });

describe('Property 26: 直达链接往返并保留其他参数', () => {
  // Feature: model-version-timeline-scrub, Property 26: 直达链接往返并保留其他参数
  it('readScrubUrl(writeScrubUrl(href, s)) 得到 s，其他参数原值保留，不存在的钉不出现', () => {
    fc.assert(
      fc.property(stateArb, hrefArb, (state, href) => {
        const written = writeScrubUrl(href, state);
        const read = readScrubUrl(new URL(written).search);

        expect(read.kind).toBe('ok');
        if (read.kind !== 'ok') return;
        expect(read.unitRefno).toBe(state.unitRefno.replace(/\//g, '_'));
        expect(read.scope).toBe(state.scope);
        expect(read.cursor).toBe(state.cursor);
        expect(read.rawA === null ? null : Number(read.rawA)).toBe(state.a);
        expect(read.rawB === null ? null : Number(read.rawB)).toBe(state.b);

        // 其他参数原值保留
        const before = new URL(href).searchParams;
        const after = new URL(written).searchParams;
        for (const [key, value] of before) {
          expect(after.get(key)).toBe(value);
        }
        // compare_autorun 被删掉
        expect(after.get('compare_autorun')).toBeNull();
        // 不存在的钉不出现对应参数
        if (state.a === null) expect(after.get('compare_a')).toBeNull();
        if (state.b === null) expect(after.get('compare_b')).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('写两次结果稳定（幂等）', () => {
    fc.assert(
      fc.property(stateArb, hrefArb, (state, href) => {
        const once = writeScrubUrl(href, state);
        expect(writeScrubUrl(once, state)).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('没有 cursor 的链接读成 none', () => {
    fc.assert(
      fc.property(hrefArb, (href) => {
        expect(readScrubUrl(new URL(href).search)).toEqual({ kind: 'none' });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 27: 链接状态校正', () => {
  // Feature: model-version-timeline-scrub, Property 27: 链接状态校正
  it('游标在表中就用它，否则回落到不大于它的最后一版，再退到最小一版并提示', () => {
    const tableArb = fc
      .uniqueArray(fc.integer({ min: 1, max: 5000 }), { minLength: 0, maxLength: 20 })
      .map((xs) => [...xs].sort((a, b) => a - b));
    fc.assert(
      fc.property(tableArb, fc.integer({ min: 1, max: 6000 }), (sesnos, cursor) => {
        const got = reconcileScrubState({ cursor, rawA: null, rawB: null }, sesnos);
        if (sesnos.length === 0) {
          expect(got.cursor).toBe(cursor);
          expect(got.notices).toEqual([]);
          return;
        }
        if (sesnos.includes(cursor)) {
          expect(got.cursor).toBe(cursor);
          expect(got.notices).toEqual([]);
        } else {
          const atOrBefore = sesnos.filter((s) => s <= cursor);
          const want = atOrBefore.length > 0 ? Math.max(...atOrBefore) : sesnos[0]!;
          expect(got.cursor).toBe(want);
          expect(got.notices).toHaveLength(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('不是整数或不在表中的钉不被恢复且各产生一条提示；两钉相同只留 A；A 大于 B 时已交换', () => {
    const tableArb = fc
      .uniqueArray(fc.integer({ min: 1, max: 2000 }), { minLength: 1, maxLength: 15 })
      .map((xs) => [...xs].sort((a, b) => a - b));
    fc.assert(
      fc.property(
        tableArb.chain((sesnos) => fc.tuple(
          fc.constant(sesnos),
          fc.oneof(
            fc.constant(null),
            fc.constant('abc'),
            fc.constant('1.5'),
            fc.integer({ min: 1, max: 2500 }).map(String),
            fc.constantFrom(...sesnos).map(String),
          ),
          fc.oneof(
            fc.constant(null),
            fc.constant('-1'),
            fc.constant(''),
            fc.integer({ min: 1, max: 2500 }).map(String),
            fc.constantFrom(...sesnos).map(String),
          ),
        )),
        ([sesnos, rawA, rawB]) => {
          const got = reconcileScrubState({ cursor: sesnos[0]!, rawA, rawB }, sesnos);

          const valid = (raw: string | null): number | null => {
            if (raw === null || !/^\d+$/.test(raw.trim())) return null;
            const value = Number(raw.trim());
            return sesnos.includes(value) ? value : null;
          };
          const expectedA = valid(rawA);
          let expectedB = valid(rawB);
          const invalidCount =
            (rawA !== null && expectedA === null ? 1 : 0) + (rawB !== null && expectedB === null ? 1 : 0);
          let notices = invalidCount;
          if (expectedA !== null && expectedB !== null && expectedA === expectedB) {
            expectedB = null;
            notices += 1;
          }
          expect(got.notices).toHaveLength(notices);

          const want = normalizePins({ a: expectedA, b: expectedB });
          expect(got.pins).toEqual(want);
          // 属性 21 的不变量：A 的 sesno 不大于 B
          if (got.pins.a !== null && got.pins.b !== null) {
            expect(got.pins.a).toBeLessThanOrEqual(got.pins.b);
          }
          // 恢复出来的钉都在表中
          for (const pin of [got.pins.a, got.pins.b]) {
            if (pin !== null) expect(sesnos).toContain(pin);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 28: 非法链接参数', () => {
  // Feature: model-version-timeline-scrub, Property 28: 非法链接参数
  it('scope 不是 self / subtree 时返回 invalid 并指明 scope', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z]{1,10}$/).filter((s) => s !== 'self' && s !== 'subtree'),
        fc.integer({ min: 1, max: 1000 }),
        (scope, cursor) => {
          const search = `?unit_refno=7997_1_2&scope=${encodeURIComponent(scope)}&cursor=${cursor}`;
          const got = readScrubUrl(search);
          expect(got.kind).toBe('invalid');
          if (got.kind === 'invalid') {
            expect(got.param).toBe('scope');
            expect(got.unitRefno).toBe('7997_1_2');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cursor 不是正整数时返回 invalid 并指明 cursor', () => {
    const badCursor = fc.oneof(
      fc.constant('0'),
      fc.constant('-1'),
      fc.constant('1.5'),
      fc.constant('abc'),
      fc.constant(''),
      fc.constant('1e3'),
      fc.constant('0x10'),
      fc.constant('9999999999999999999999'),
    );
    fc.assert(
      fc.property(badCursor, fc.constantFrom<'self' | 'subtree'>('self', 'subtree'), (cursor, scope) => {
        const search = `?unit_refno=7997_1_2&scope=${scope}&cursor=${encodeURIComponent(cursor)}`;
        const got = readScrubUrl(search);
        expect(got.kind).toBe('invalid');
        if (got.kind === 'invalid') expect(got.param).toBe('cursor');
      }),
      { numRuns: 100 },
    );
  });

  it('cursor 首尾空白被容忍（解析前 trim），非整数串仍被拒', () => {
    expect(readScrubUrl('?unit_refno=7997_1_2&scope=self&cursor=%203%20').kind).toBe('ok');
    expect(readScrubUrl('?unit_refno=7997_1_2&scope=self&cursor=3x').kind).toBe('invalid');
  });

  it('unit_refno 为空时先报 unit_refno（顺序 unit_refno → scope → cursor）', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,6}$/), (scope) => {
        const got = readScrubUrl(`?unit_refno=&scope=${scope}&cursor=abc`);
        expect(got.kind).toBe('invalid');
        if (got.kind === 'invalid') {
          expect(got.param).toBe('unit_refno');
          expect(got.unitRefno).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
