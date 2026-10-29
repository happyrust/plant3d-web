import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import {
  MISSING_TEXT, NO_TIME_TEXT, TIME_ANOMALY_TEXT, clusterTip, cursorLabel, tickTip,
  type ScrubVersionIndex,
} from './scrubFormat';

import type { ScrubVersion, TickCluster } from './tickLayout';

const IMPACT_KINDS = ['mesh', 'placement', 'delivery', 'tombstone', 'noop'] as const;
const OFFSETS = ['Z', '+08:00', '-05:30'] as const;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 合法 RFC3339 时间：字面值与期望的 `YYYY/MM/DD HH:mm` 一起生成，期望值不经 Date 换算。 */
type TimeCase = { text: string; expected: string };
const validTimeArb: fc.Arbitrary<TimeCase> = fc.record({
  y: fc.integer({ min: 2000, max: 2099 }),
  mo: fc.integer({ min: 1, max: 12 }),
  d: fc.integer({ min: 1, max: 28 }),
  h: fc.integer({ min: 0, max: 23 }),
  mi: fc.integer({ min: 0, max: 59 }),
  s: fc.integer({ min: 0, max: 59 }),
  frac: fc.option(fc.integer({ min: 0, max: 999 }), { nil: null }),
  off: fc.constantFrom(...OFFSETS),
}).map(({ y, mo, d, h, mi, s, frac, off }) => ({
  text: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${frac === null ? '' : `.${pad(frac, 3)}`}${off}`,
  expected: `${y}/${pad(mo)}/${pad(d)} ${pad(h)}:${pad(mi)}`,
}));

/** Session_Time：合法、缺失、或解析不了（后两者都按无时间处理）。 */
const timeArb: fc.Arbitrary<TimeCase | null | string> = fc.oneof(
  validTimeArb,
  fc.constant(null),
  fc.constantFrom('', 'not-a-time', '2024/13/45', '   '),
);

/** 可选文本字段：缺省、null、空串、全空白、或含非空白字符的原文。 */
const textFieldArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constantFrom(' ', '\t', '  \n '),
  fc.string({ minLength: 0, maxLength: 12 }).map((s) => `${s}x`),
);

type Case = {
  version: ScrubVersion;
  time: TimeCase | null | string;
  prev: { sesno: number; time: TimeCase } | null;
  scope: 'self' | 'subtree' | undefined;
};

const caseArb: fc.Arbitrary<Case> = fc.record({
  sesno: fc.integer({ min: 2, max: 100000 }),
  time: timeArb,
  impactKind: fc.option(fc.constantFrom(...IMPACT_KINDS), { nil: null }),
  author: textFieldArb,
  note: textFieldArb,
  changedUnits: fc.oneof(fc.constant(undefined), fc.constant(null), fc.integer({ min: 0, max: 5000 })),
  anomalous: fc.boolean(),
  prevGap: fc.integer({ min: 1, max: 1000 }),
  prevTime: validTimeArb,
  scope: fc.constantFrom('self' as const, 'subtree' as const, undefined),
}).map((r) => {
  const sessionTime = r.time === null ? null : typeof r.time === 'string' ? r.time : r.time.text;
  const version: ScrubVersion = {
    sesno: r.sesno,
    sessionTime,
    impactKind: r.impactKind,
    ...(r.author === undefined ? {} : { author: r.author }),
    ...(r.note === undefined ? {} : { note: r.note }),
    ...(r.changedUnits === undefined ? {} : { changedUnits: r.changedUnits }),
  };
  const prev = r.anomalous ? { sesno: Math.max(1, r.sesno - r.prevGap), time: r.prevTime } : null;
  return { version, time: r.time, prev, scope: r.scope };
});

function setup(c: Case) {
  const anomalies = new Map<number, number>();
  const versions = new Map<number, ScrubVersion>([[c.version.sesno, c.version]]);
  if (c.prev) {
    anomalies.set(c.version.sesno, c.prev.sesno);
    versions.set(c.prev.sesno, { sesno: c.prev.sesno, sessionTime: c.prev.time.text, impactKind: null });
  }
  return { anomalies, versions: versions as ScrubVersionIndex };
}

const expectedField = (v: string | null | undefined) => (v == null || v.trim() === '' ? MISSING_TEXT : v);
const expectedHoverTime = (t: TimeCase | null | string) => (t !== null && typeof t !== 'string' ? t.text : MISSING_TEXT);
const expectedUnits = (v: ScrubVersion) => {
  if (v.impactKind === 'noop') return '单元 0';
  return `单元 ${typeof v.changedUnits === 'number' ? v.changedUnits : MISSING_TEXT}`;
};

describe('Property 5: 提示与游标标签格式化', () => {
  // Feature: model-version-timeline-scrub, Property 5: 提示与游标标签格式化
  it('悬停提示含 sesno 与全部存在字段原值，缺失写「—」，异常附前一个带时间版本', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { anomalies, versions } = setup(c);
        const tip = tickTip({ version: c.version, anomalies, versions, scope: c.scope });
        const value = (label: string) => tip.lines.find((l) => l.label === label)?.value;

        expect(tip.title).toBe(`sesno ${c.version.sesno}`);
        expect(value('时间')).toBe(expectedHoverTime(c.time));
        expect(value('保存人')).toBe(expectedField(c.version.author));
        expect(value('备注')).toBe(expectedField(c.version.note));
        expect(value('影响')).toBe(c.version.impactKind ?? MISSING_TEXT);

        const unitLines = tip.lines.filter((l) => l.label === '' && l.value.startsWith('单元 '));
        if (c.scope === 'subtree') expect(unitLines.map((l) => l.value)).toEqual([expectedUnits(c.version)]);
        else expect(unitLines).toEqual([]);

        expect(tip.anomaly).toBe(c.prev !== null);
        const anomalyLine = value(TIME_ANOMALY_TEXT);
        if (c.prev) {
          expect(anomalyLine).toContain(`sesno ${c.prev.sesno}`);
          expect(anomalyLine).toContain(c.prev.time.text);
        } else {
          expect(anomalyLine).toBeUndefined();
        }

        // text 是 title 与各行的拼接，每一行都出现在其中
        expect(tip.text.split('\n')[0]).toBe(tip.title);
        for (const l of tip.lines) expect(tip.text).toContain(l.label ? `${l.label}：${l.value}` : l.value);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 5: 提示与游标标签格式化
  it('游标标签为 sesno · 字面时间（缺失「无时间」），异常加「时间异常」，子树加「单元 n」', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { anomalies } = setup(c);
        const label = cursorLabel({ version: c.version, anomalies, scope: c.scope });
        const parts = [
          `sesno ${c.version.sesno}`,
          c.time !== null && typeof c.time !== 'string' ? c.time.expected : NO_TIME_TEXT,
        ];
        if (c.prev) parts.push(TIME_ANOMALY_TEXT);
        if (c.scope === 'subtree') parts.push(expectedUnits(c.version));
        expect(label).toBe(parts.join(' · '));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: model-version-timeline-scrub, Property 5: 提示与游标标签格式化
  it('簇提示写刻度数与簇内最小、最大 sesno 及其时间', () => {
    const clusterArb = fc.record({
      sesnos: fc.uniqueArray(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 30 }),
      times: fc.array(timeArb, { minLength: 30, maxLength: 30 }),
      swap: fc.boolean(),
      anomaly: fc.boolean(),
    });
    fc.assert(
      fc.property(clusterArb, ({ sesnos, times, swap, anomaly }) => {
        const sorted = [...sesnos].sort((a, b) => a - b);
        const timeOf = new Map(sorted.map((s, i) => [s, times[i]]));
        const versions: ScrubVersionIndex = new Map(sorted.map((s) => {
          const t = timeOf.get(s)!;
          const sessionTime = t === null ? null : typeof t === 'string' ? t : t.text;
          return [s, { sesno: s, sessionTime, impactKind: null }];
        }));
        const min = sorted[0]!;
        const max = sorted[sorted.length - 1]!;
        const cluster: TickCluster = {
          x: 0, sesnos: sorted, first: swap ? max : min, last: swap ? min : max, anomaly,
        };
        const tip = clusterTip(cluster, versions);
        expect(tip.title).toBe(`${sorted.length} 个版本`);
        expect(tip.lines[0]).toEqual({ label: '最早', value: `sesno ${min} · ${expectedHoverTime(timeOf.get(min)!)}` });
        expect(tip.lines[1]).toEqual({ label: '最晚', value: `sesno ${max} · ${expectedHoverTime(timeOf.get(max)!)}` });
        expect(tip.anomaly).toBe(anomaly);
        expect(tip.text.includes(TIME_ANOMALY_TEXT)).toBe(anomaly);
      }),
      { numRuns: 100 },
    );
  });
});
