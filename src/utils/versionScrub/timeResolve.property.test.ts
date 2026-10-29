import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { parseInstantText, parseSessionTime, resolveAt, type ResolveResult } from './timeResolve';

import type { ScrubVersion } from './tickLayout';

/** 一个带时间的版本表：sesno 递增，Session_Time 可缺、可重复、可倒退。 */
const tableArb: fc.Arbitrary<ScrubVersion[]> = fc
  .array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 4_000_000 })), { minLength: 0, maxLength: 12 })
  .map((rows) =>
    rows.map(([timed, secs], i) => ({
      sesno: i + 1,
      sessionTime: timed
        ? new Date(secs * 1000).toISOString().replace('.000Z', 'Z')
        : null,
      impactKind: 'mesh' as const,
    })),
  );

/** 任意时刻（秒），以及带不带偏移两种写法。 */
function instantArb(): fc.Arbitrary<{ secs: number; text: string }> {
  return fc.integer({ min: 0, max: 4_000_000 }).chain((secs) =>
    fc.constantFrom('Z', '+08:00', '-05:30', '').map((offset) => {
      const iso = new Date(secs * 1000).toISOString().replace('.000Z', '');
      return { secs, text: `${iso}${offset}` };
    }),
  );
}

/** 暴力参考实现：带时间且秒级时间 ≤ t 的行里 sesno 最大者。 */
function reference(rows: readonly ScrubVersion[], atSecs: number, floatingOffsetMinutes: number | null): ResolveResult {
  const parsed: { sesno: number; sessionTime: string; secs: number }[] = [];
  for (const v of rows) {
    const t = parseSessionTime(v.sessionTime);
    if (t) parsed.push({ sesno: v.sesno, sessionTime: v.sessionTime!, secs: t.seconds });
  }
  if (parsed.length === 0) return { ok: false, error: 'no-resolvable' };
  // 不带偏移的时间点按链序第一条带时间行的偏移解释
  const offset = floatingOffsetMinutes ?? parseSessionTime(rows.find((v) => parseSessionTime(v.sessionTime))!.sessionTime)!.offsetMinutes;
  const target = atSecs - offset * 60;
  const hits = parsed.filter((p) => p.secs <= target);
  if (hits.length === 0) return { ok: false, error: 'before-oldest' };
  const best = hits.reduce((a, b) => (b.sesno > a.sesno ? b : a));
  return { ok: true, sesno: best.sesno, sessionTime: best.sessionTime };
}

describe('Property 29（前端）: 时间点解析遵循链序规则', () => {
  // Feature: model-version-timeline-scrub, Property 29: 时间点解析遵循链序规则，前端、后端与会话链包装一致
  it('resolveAt 与暴力参考实现一致，覆盖单调 / 乱序 / 会话 1 最晚三种形态', () => {
    fc.assert(
      fc.property(tableArb, instantArb(), fc.constantFrom<'monotonic' | 'shuffled' | 'firstLatest'>('monotonic', 'shuffled', 'firstLatest'), (raw, instant, shape) => {
        let rows = raw;
        if (shape === 'monotonic') {
          rows = raw.map((v, i) => ({ ...v, sessionTime: v.sessionTime ? new Date(i * 60_000).toISOString() : null }));
        } else if (shape === 'firstLatest') {
          rows = raw.map((v, i) => ({
            ...v,
            sessionTime: v.sessionTime ? new Date((raw.length - i) * 60_000 + 10_000_000).toISOString() : null,
          }));
        }
        const got = resolveAt(rows, instant.text);
        const parsed = parseInstantText(instant.text);
        if (!parsed) {
          expect(got).toEqual({ ok: false, error: 'invalid-format' });
          return;
        }
        const localSecs = parsed.localSeconds;
        const want = reference(rows, localSecs, parsed.offsetMinutes);
        expect(got).toEqual(want);
      }),
      { numRuns: 100 },
    );
  });

  it('结果总是「带时间且 ≤ t 的行中 sesno 最大者」，不是时间最接近 t 的行', () => {
    fc.assert(
      fc.property(tableArb, instantArb(), (rows, instant) => {
        const got = resolveAt(rows, instant.text);
        if (!got.ok) return;
        const target = parseSessionTime(got.sessionTime)!;
        const parsed = parseInstantText(instant.text)!;
        const offset = parsed.offsetMinutes ?? parseSessionTime(rows.find((v) => parseSessionTime(v.sessionTime))!.sessionTime)!.offsetMinutes;
        const at = parsed.localSeconds - offset * 60;
        // 命中的行时间 ≤ t
        expect(target.seconds).toBeLessThanOrEqual(at);
        // 没有 sesno 更大的带时间行时间 ≤ t
        for (const v of rows) {
          if (v.sesno <= got.sesno) continue;
          const t = parseSessionTime(v.sessionTime);
          if (t) expect(t.seconds).toBeGreaterThan(at);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 30（前端）: 非法时间点被拒', () => {
  // Feature: model-version-timeline-scrub, Property 30: 非法时间点被拒
  it('语法之外的文本 parseInstantText 返回 null、resolveAt 返回 invalid-format（即使表是空的）', () => {
    const invalid = fc.oneof(
      fc.constant(''),
      fc.stringMatching(/^[a-z ]{0,12}$/),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-02-30T00:00:00Z`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-13-01T00:00:00Z`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T24:00:00Z`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T10:60`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T10:00:60`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T10:00:00.1234`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02t10:00`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}/01/02 10:00`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T10:00+24:00`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T10:00z`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => ` ${y}-01-02T10:00Z`),
      fc.integer({ min: 1970, max: 2099 }).map((y) => `${y}-01-02T10:00Z `),
    );
    fc.assert(
      fc.property(invalid, (text) => {
        expect(parseInstantText(text)).toBeNull();
        expect(resolveAt([], text)).toEqual({ ok: false, error: 'invalid-format' });
      }),
      { numRuns: 100 },
    );
  });

  it('语法检查先于一切：空表 + 非法文本是 invalid-format，不是 no-resolvable', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{0,8}$/), (text) => {
        expect(resolveAt([], text)).toEqual({ ok: false, error: 'invalid-format' });
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 31（前端）: 时间点解析往返', () => {
  // Feature: model-version-timeline-scrub, Property 31: 时间点解析往返
  it('用版本 v 的 Session_Time 解析得到的 w 满足 sesno(w) ≥ sesno(v)；v 之后没有时间不晚于 v 的带时间行时 w = v', () => {
    fc.assert(
      fc.property(
        tableArb.chain((rows) => {
          const timed = rows.filter((v) => parseSessionTime(v.sessionTime) !== null);
          return timed.length === 0
            ? fc.constant({ rows, pick: 0 })
            : fc.integer({ min: 0, max: timed.length - 1 }).map((pick) => ({ rows, pick }));
        }),
        ({ rows, pick }) => {
          const timed = rows.filter((v) => parseSessionTime(v.sessionTime) !== null);
          if (timed.length === 0) {
            expect(resolveAt(rows, '2026-01-01T00:00:00Z')).toEqual({ ok: false, error: 'no-resolvable' });
            return;
          }
          const v = timed[pick]!;
          const got = resolveAt(rows, v.sessionTime!);
          expect(got.ok).toBe(true);
          if (!got.ok) return;
          expect(got.sesno).toBeGreaterThanOrEqual(v.sesno);

          const vSecs = parseSessionTime(v.sessionTime!)!.seconds;
          const anyLaterWithin = rows.some((row) => {
            if (row.sesno <= v.sesno) return false;
            const t = parseSessionTime(row.sessionTime);
            return t !== null && t.seconds <= vSecs;
          });
          if (!anyLaterWithin) expect(got.sesno).toBe(v.sesno);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('往返幂等：对结果 w 再解析一次仍得 w', () => {
    fc.assert(
      fc.property(tableArb, instantArb(), (rows, instant) => {
        const first = resolveAt(rows, instant.text);
        if (!first.ok) return;
        const second = resolveAt(rows, first.sessionTime);
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });
});
