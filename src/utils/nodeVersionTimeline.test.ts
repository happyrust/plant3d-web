import { describe, expect, it } from 'vitest';

import {
  buildNodeTimelineRows,
  countNodeTimeline,
  defaultNodeScope,
  defaultNodeVersionPair,
  foldAttributeChanges,
  pairWithLatest,
  pairWithPrevious,
  pickNodeVersionSide,
} from './nodeVersionTimeline';

import type { ModelAttributeHistory, ModelAttributeHistoryEntry, ModelElementVersionTimeline, ModelNodeVersionTimeline } from '@/model-source';

const timeline: ModelElementVersionTimeline = {
  dbnum: 8000,
  refno: '24384_23262',
  noun: 'FTUB',
  unitRefno: '24384_23257',
  unitNoun: 'BRAN',
  unitColumnOnly: false,
  versions: [
    { sesno: 5, sessionTime: 't5', elementImpact: 'delivery', unitImpact: 'delivery' },
    { sesno: 212, sessionTime: 't212', elementImpact: null, unitImpact: 'mesh' },
    { sesno: 573, sessionTime: 't573', elementImpact: 'mesh', unitImpact: 'mesh' },
    { sesno: 626, sessionTime: 't626', elementImpact: 'mesh', unitImpact: 'mesh' },
  ],
};

function entry(sesno: number, changes: ModelAttributeHistoryEntry['changes'], extra: Partial<ModelAttributeHistoryEntry> = {}): ModelAttributeHistoryEntry {
  return {
    sesno,
    sessionTime: `t${sesno}`,
    user: 'dpc',
    comment: `c${sesno}`,
    kind: 'modified',
    impact: 'mesh',
    changedCount: changes.length,
    changes,
    members: null,
    owner: null,
    attributesUnavailable: null,
    ...extra,
  };
}

const history: ModelAttributeHistory = {
  dbnum: 8000,
  refno: '24384_23262',
  noun: 'FTUB',
  unitRefno: '24384_23257',
  unitNoun: 'BRAN',
  entries: [
    entry(5, [], { kind: 'created', impact: 'delivery', comment: '初始交付' }),
    entry(573, [{ name: 'POS', valueType: 'vec3', before: 'U 3400', after: 'U 2900', stamp: false }]),
    entry(626, [
      { name: 'POS', valueType: 'vec3', before: 'U 2900', after: 'U 3400', stamp: false },
      { name: 'CACHID', valueType: 'int', before: '41', after: '42', stamp: true },
    ]),
  ],
};

describe('buildNodeTimelineRows', () => {
  it('并两条时间线，新 → 旧；self 范围只认自身变过的会话，subtree 连单元会话一起算', () => {
    const self = buildNodeTimelineRows({ timeline, history, scope: 'self' });
    expect(self.map((row) => row.sesno)).toEqual([626, 573, 212, 5]);
    expect(self.map((row) => row.inScope)).toEqual([true, true, false, true]);
    expect(self[0]).toMatchObject({ user: 'dpc', comment: 'c626', changedCount: 2, kind: 'modified', selfImpact: 'mesh', unitImpact: 'mesh' });
    // 212 那一版只有单元动了：没有 user / comment，也不在 self 范围
    expect(self[2]).toMatchObject({ user: null, comment: null, changedCount: null, selfImpact: null, unitImpact: 'mesh', inScope: false });

    const subtree = buildNodeTimelineRows({ timeline, history, scope: 'subtree' });
    expect(subtree.map((row) => row.inScope)).toEqual([true, true, true, true]);
  });

  it('容器（没有所属单元）在 subtree 范围下也只列得出自身会话', () => {
    const container: ModelElementVersionTimeline = { ...timeline, refno: '9304_1842', noun: 'ZONE', unitRefno: null, unitNoun: null, versions: [
      { sesno: 2, sessionTime: 't2', elementImpact: 'delivery', unitImpact: null },
      { sesno: 301, sessionTime: 't301', elementImpact: 'noop', unitImpact: null },
    ] };
    const rows = buildNodeTimelineRows({ timeline: container, history: null, scope: 'subtree' });
    expect(rows.map((row) => [row.sesno, row.inScope])).toEqual([[301, true], [2, true]]);
  });

  it('有节点版本表（node/versions?scope=subtree）时容器也列得出子树：每行带 unitsChanged，子树列压过单元列，自身列由它补', () => {
    const container: ModelElementVersionTimeline = { ...timeline, refno: '24384_22399', noun: 'SITE', unitRefno: null, unitNoun: null, versions: [
      { sesno: 444, sessionTime: 't444', elementImpact: 'delivery', unitImpact: null },
    ] };
    const nodeVersions: ModelNodeVersionTimeline = {
      dbnum: 8000, refno: '24384_22399', noun: 'SITE', scope: 'subtree', unitRefno: null, unitNoun: null,
      versions: [
        { sesno: 444, sessionTime: 't444', impact: 'delivery', selfImpact: 'delivery', unitsChanged: 449, unitsTouched: 449 },
        { sesno: 626, sessionTime: 't626', impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 1 },
        { sesno: 628, sessionTime: null, impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 2 },
        { sesno: 635, sessionTime: 't635', impact: 'noop', selfImpact: 'noop', unitsChanged: 0, unitsTouched: 0 },
      ],
    };
    const subtree = buildNodeTimelineRows({ timeline: container, history: null, nodeVersions, scope: 'subtree' });
    expect(subtree.map((row) => [row.sesno, row.inScope, row.unitImpact, row.unitsChanged])).toEqual([
      [635, true, 'noop', 0],
      [628, true, 'mesh', 1],
      [626, true, 'mesh', 1],
      [444, true, 'delivery', 449],
    ]);
    // self 范围：只剩节点自身动过的两版（444 出现、635 改元数据），626 / 628 是子树在动
    const self = buildNodeTimelineRows({ timeline: container, history: null, nodeVersions, scope: 'self' });
    expect(self.map((row) => [row.sesno, row.inScope])).toEqual([[635, true], [628, false], [626, false], [444, true]]);
    expect(defaultNodeVersionPair(subtree)).toEqual({ a: 628, b: 635 });
    expect(defaultNodeVersionPair(self)).toEqual({ a: 444, b: 635 });

    // 单元及以下的节点：节点版本表压过单元那一列（两者本来同一件事），unitColumnOnly 也不再算未知
    const unitOnly: ModelElementVersionTimeline = { ...timeline, unitColumnOnly: true, versions: [
      { sesno: 573, sessionTime: 't573', elementImpact: null, unitImpact: 'mesh' },
      { sesno: 626, sessionTime: 't626', elementImpact: null, unitImpact: 'placement' },
    ] };
    const leafVersions: ModelNodeVersionTimeline = {
      dbnum: 8000, refno: '24384_23262', noun: 'FTUB', scope: 'subtree', unitRefno: '24384_23257', unitNoun: 'BRAN',
      versions: [{ sesno: 626, sessionTime: 't626', impact: 'mesh', selfImpact: 'mesh', unitsChanged: 1, unitsTouched: 1 }],
    };
    const rows = buildNodeTimelineRows({ timeline: unitOnly, history: null, nodeVersions: leafVersions, scope: 'self' });
    expect(rows.map((row) => [row.sesno, row.inScope, row.unitImpact, row.selfImpact])).toEqual([
      [626, true, 'mesh', 'mesh'],
      [573, false, 'mesh', null],
    ]);
  });

  it('只有属性时间线（版本表还没回来）也能成行，且不标「仅属性」（自身列没有来源，判不了）', () => {
    const rows = buildNodeTimelineRows({ timeline: null, history, scope: 'self' });
    expect(rows.map((row) => row.sesno)).toEqual([626, 573, 5]);
    expect(rows[2]).toMatchObject({ selfImpact: 'delivery', kind: 'created', inScope: true, attributeOnly: false });
    expect(countNodeTimeline(rows, 'self')).toEqual({ versions: 3, attributeOnly: 0 });
  });

  it('只在属性时间线里出现的会话（UDA 之类，模型口径不成一版）标「仅属性」，「本范围 n 版」与版本表行数对得上', () => {
    // 2026-09-19 真机 SITE 24384/22399：element/versions 左列 5 delivery / 7 noop，attribute-history 多一行 sesno 10（两个 UDA 被设值）
    const site: ModelElementVersionTimeline = {
      ...timeline, refno: '24384_22399', noun: 'SITE', unitRefno: null, unitNoun: null,
      versions: [
        { sesno: 5, sessionTime: 't5', elementImpact: 'delivery', unitImpact: null },
        { sesno: 7, sessionTime: 't7', elementImpact: 'noop', unitImpact: null },
      ],
    };
    const siteHistory: ModelAttributeHistory = {
      dbnum: 8000, refno: '24384_22399', noun: 'SITE', unitRefno: null, unitNoun: null,
      entries: [
        entry(5, [], { kind: 'created', impact: 'delivery' }),
        entry(7, [{ name: 'NAME', valueType: 'text', before: '', after: '/1RX03-EQUI', stamp: false }], { impact: 'noop' }),
        entry(10, [
          { name: 'UDA:2902d6e2', valueType: 'text', before: '', after: 'JS', stamp: false },
          { name: 'UDA:2902d6e3', valueType: 'text', before: '', after: 'PIPERB', stamp: false },
        ], { impact: 'noop' }),
      ],
    };
    const rows = buildNodeTimelineRows({ timeline: site, history: siteHistory, scope: 'self' });
    expect(rows.map((row) => [row.sesno, row.inScope, row.attributeOnly])).toEqual([[10, true, true], [7, true, false], [5, true, false]]);
    // 版本表说 2 版，仅属性 1：两个数分开报，n 与 element/versions / node/versions 的行数一致
    expect(countNodeTimeline(rows, 'self')).toEqual({ versions: 2, attributeOnly: 1 });

    // 所有子节点下：子树列（节点版本表）没有 10，它仍是「仅属性」；子树列有的会话即便自身只改属性也算一版
    const siteVersions: ModelNodeVersionTimeline = {
      dbnum: 8000, refno: '24384_22399', noun: 'SITE', scope: 'subtree', unitRefno: null, unitNoun: null,
      versions: [
        { sesno: 5, sessionTime: 't5', impact: 'delivery', selfImpact: 'delivery', unitsChanged: 521, unitsTouched: 521 },
        { sesno: 7, sessionTime: 't7', impact: 'noop', selfImpact: 'noop', unitsChanged: 0, unitsTouched: 0 },
        { sesno: 626, sessionTime: 't626', impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 1 },
      ],
    };
    const subtree = buildNodeTimelineRows({ timeline: site, history: siteHistory, nodeVersions: siteVersions, scope: 'subtree' });
    expect(subtree.map((row) => [row.sesno, row.inScope, row.attributeOnly])).toEqual([[626, true, false], [10, true, true], [7, true, false], [5, true, false]]);
    expect(countNodeTimeline(subtree, 'subtree')).toEqual({ versions: 3, attributeOnly: 1 });

    // 旧服务端只给单元那一列（自身列未知）：属性时间线补上的行不标「仅属性」——判不了
    const unitOnly: ModelElementVersionTimeline = { ...timeline, unitColumnOnly: true, versions: [{ sesno: 573, sessionTime: 't573', elementImpact: null, unitImpact: 'mesh' }] };
    const unknown = buildNodeTimelineRows({ timeline: unitOnly, history, scope: 'self' });
    expect(unknown.every((row) => !row.attributeOnly)).toBe(true);
  });

  it('旧服务端只给单元那一列（unitColumnOnly）：self 范围下自身列算未知、不筛，缺省 A / B 照样选得出来', () => {
    // 2026-09-19 真机 :8026（没有 element/versions）：单元 24384_26480 当前会话已无成员 → 范围定成 self →
    // 修前每一行都判「不在本范围」，时间线渲染出 0 行、缺省最近两版选不出来（行上本来就该画「本构件 ?」）。
    const unitOnly: ModelElementVersionTimeline = {
      ...timeline,
      refno: '24384_26480',
      noun: 'EQUI',
      unitRefno: '24384_26480',
      unitColumnOnly: true,
      versions: [
        { sesno: 587, sessionTime: 't587', elementImpact: null, unitImpact: 'mesh' },
        { sesno: 602, sessionTime: 't602', elementImpact: null, unitImpact: 'mesh' },
        { sesno: 604, sessionTime: 't604', elementImpact: null, unitImpact: 'tombstone' },
      ],
    };
    const rows = buildNodeTimelineRows({ timeline: unitOnly, history: null, scope: 'self' });
    expect(rows.map((row) => [row.sesno, row.inScope])).toEqual([[604, true], [602, true], [587, true]]);
    expect(defaultNodeVersionPair(rows)).toEqual({ a: 602, b: 604 });
    // subtree 照旧
    expect(buildNodeTimelineRows({ timeline: unitOnly, history: null, scope: 'subtree' }).every((row) => row.inScope)).toBe(true);
    // 新服务端（自身列给得出来）不受影响：212 那一版仍判在 self 范围外
    expect(buildNodeTimelineRows({ timeline, history, scope: 'self' }).map((row) => row.inScope)).toEqual([true, true, false, true]);
  });
});

describe('选 A / B', () => {
  const rows = buildNodeTimelineRows({ timeline, history, scope: 'self' });

  it('缺省 B = 范围内最新，A = 范围内上一版（跳过范围外的 212）', () => {
    expect(defaultNodeVersionPair(rows)).toEqual({ a: 573, b: 626 });
    const subtree = buildNodeTimelineRows({ timeline, history, scope: 'subtree' });
    expect(defaultNodeVersionPair(subtree)).toEqual({ a: 573, b: 626 });
    expect(defaultNodeVersionPair(rows.filter((row) => row.sesno === 5))).toEqual({ a: null, b: 5 });
  });

  it('把一行设为 A / B 后按新旧摆正；撞到同一版时另一端让开', () => {
    expect(pickNodeVersionSide(rows, { a: 573, b: 626 }, 'a', 5)).toEqual({ a: 5, b: 626 });
    // 把比 B 还新的一版设成 A：两端对调
    expect(pickNodeVersionSide(rows, { a: 5, b: 573 }, 'a', 626)).toEqual({ a: 573, b: 626 });
    // A 设成与 B 同一版：B 顺着往下一版让
    expect(pickNodeVersionSide(rows, { a: 5, b: 573 }, 'a', 573)).toEqual({ a: 573, b: 626 });
    // B 设成与 A 同一版：A 往上一版让
    expect(pickNodeVersionSide(rows, { a: 573, b: 626 }, 'b', 573)).toEqual({ a: 212, b: 573 });
    // 最旧一版设成 B 且 A 也是它：让不开就留 null
    expect(pickNodeVersionSide(rows, { a: 5, b: 626 }, 'b', 5)).toEqual({ a: null, b: 5 });
  });

  it('与上一版比 / 与最新比', () => {
    expect(pairWithPrevious(rows, { a: 5, b: 626 })).toEqual({ a: 573, b: 626 });
    expect(pairWithPrevious(rows, { a: null, b: 573 })).toEqual({ a: 5, b: 573 });
    expect(pairWithLatest(rows, { a: 5, b: 573 })).toEqual({ a: 5, b: 626 });
    // A 已经是最新：退成最新的上一版
    expect(pairWithLatest(rows, { a: 626, b: null })).toEqual({ a: 573, b: 626 });
  });
});

describe('foldAttributeChanges', () => {
  it('(A, B] 里同名属性取最早的 before、最晚的 after，两头一样不算变', () => {
    // 573→626：POS 2900→3400，CACHID 41→42
    const one = foldAttributeChanges(history.entries, 573, 626);
    expect(one.sessions).toBe(1);
    expect(one.changes).toEqual([
      { name: 'POS', valueType: 'vec3', before: 'U 2900', after: 'U 3400', stamp: false, hops: 1 },
      { name: 'CACHID', valueType: 'int', before: '41', after: '42', stamp: true, hops: 1 },
    ]);
    // 212→626：POS 3400→2900→3400 净差为零，只剩戳
    const two = foldAttributeChanges(history.entries, 212, 626);
    expect(two.sessions).toBe(2);
    expect(two.changes.map((change) => [change.name, change.hops])).toEqual([['CACHID', 1]]);
    // 区间含它被建的那一版
    const born = foldAttributeChanges(history.entries, 2, 573);
    expect(born.createdAt).toBe(5);
    expect(born.deletedAt).toBeNull();
    expect(foldAttributeChanges(history.entries, 626, 700).sessions).toBe(0);
  });

  it('成员 / owner 动过只提示，不进属性行', () => {
    const entries = [entry(10, [], { members: { added: ['1_2'], removed: [], reordered: false }, owner: ['1_1', '1_3'] })];
    const folded = foldAttributeChanges(entries, 1, 10);
    expect(folded.changes).toEqual([]);
    expect(folded.membersTouched).toBe(true);
    expect(folded.ownerTouched).toBe(true);
  });
});

describe('defaultNodeScope', () => {
  it('单元及以下 = subtree，容器 = self，叶子 = self', () => {
    expect(defaultNodeScope({ unitRefno: '24384_23257', hasMembers: true })).toBe('subtree');
    expect(defaultNodeScope({ unitRefno: '24384_23257', hasMembers: null })).toBe('subtree');
    expect(defaultNodeScope({ unitRefno: null, hasMembers: true })).toBe('self');
    expect(defaultNodeScope({ unitRefno: '24384_23257', hasMembers: false })).toBe('self');
  });
});
