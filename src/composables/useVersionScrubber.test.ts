import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useNodeVersionTimeline } from './useNodeVersionTimeline';
import { useVersionScrubber } from './useVersionScrubber';

import type {
  ModelAttributeHistory,
  ModelElementVersionTimeline,
  ModelNodeDiffScope,
  ModelNodeVersionTimeline,
  ModelVersionImpactKind,
  ModelVersionSource,
} from '@/model-source';

import { HistoryQueryError, ModelVersionRouteUnavailableError } from '@/model-source/modelVersionErrors';

/**
 * `useVersionScrubber`（tasks.md 14.4）：刻度口径、切范围保留游标与钉、灰标、钉的写回、时间点解析的后端调用与回落。
 *
 * 游标吸附 / 方向键 / 点击簇 / 缩放 / 时间点解析本身都是纯函数，已在 `utils/versionScrub/*.property.test.ts`
 * 与 `timeResolve.test.ts` 覆盖；这里只测组合式函数接上 Vue 之后那几件纯函数管不到的事。
 */

function elementTimeline(
  rows: [sesno: number, self: ModelVersionImpactKind | null, unit: ModelVersionImpactKind | null][],
): ModelElementVersionTimeline {
  return {
    dbnum: 8000,
    refno: '24384_23257',
    noun: 'BRAN',
    unitRefno: '24384_23257',
    unitNoun: 'BRAN',
    versions: rows.map(([sesno, elementImpact, unitImpact]) => ({
      sesno,
      sessionTime: `2026-09-${String(sesno).padStart(2, '0')}T00:00:00Z`,
      elementImpact,
      unitImpact,
    })),
    unitColumnOnly: false,
  };
}

function nodeVersions(
  rows: [sesno: number, impact: ModelVersionImpactKind, unitsChanged: number][],
  scope: ModelNodeDiffScope = 'subtree',
): ModelNodeVersionTimeline {
  return {
    dbnum: 8000,
    refno: '24384_23257',
    noun: 'BRAN',
    scope,
    unitRefno: '24384_23257',
    unitNoun: 'BRAN',
    versions: rows.map(([sesno, impact, unitsChanged]) => ({
      sesno,
      sessionTime: `2026-09-${String(sesno).padStart(2, '0')}T00:00:00Z`,
      impact,
      selfImpact: impact,
      unitsChanged,
      unitsTouched: unitsChanged,
    })),
  };
}

function historyWith(sesnos: number[]): ModelAttributeHistory {
  return {
    dbnum: 8000,
    refno: '24384_23257',
    noun: 'BRAN',
    unitRefno: '24384_23257',
    unitNoun: 'BRAN',
    entries: sesnos.map((sesno) => ({
      sesno,
      sessionTime: `2026-09-${String(sesno).padStart(2, '0')}T00:00:00Z`,
      user: '张三',
      comment: `备注 ${sesno}`,
      kind: 'modified',
      impact: 'noop',
      changedCount: 1,
      changes: [],
      members: null,
      owner: null,
      attributesUnavailable: null,
    })),
  };
}

function sourceWith(overrides: Partial<ModelVersionSource> = {}): ModelVersionSource {
  return {
    listVersions: vi.fn(),
    listElementVersions: vi.fn(),
    loadVersion: vi.fn(),
    attributesAt: vi.fn(),
    attributeHistory: vi.fn(),
    attributeDiff: vi.fn(),
    listNodeVersions: vi.fn(),
    diffSummary: vi.fn(),
    ...overrides,
  } as unknown as ModelVersionSource;
}

function setup(options: {
  rows: [sesno: number, self: ModelVersionImpactKind | null, unit: ModelVersionImpactKind | null][];
  nodeRows?: [sesno: number, impact: ModelVersionImpactKind, unitsChanged: number][];
  history?: number[];
  source?: ModelVersionSource;
  width?: number;
}) {
  const timeline = useNodeVersionTimeline();
  timeline.setNode({
    timeline: elementTimeline(options.rows),
    history: options.history ? historyWith(options.history) : null,
    nodeVersions: options.nodeRows ? nodeVersions(options.nodeRows) : null,
    hasMembers: true,
  });
  const width = ref(options.width ?? 800);
  const scrubber = useVersionScrubber(timeline, { source: options.source ?? sourceWith(), width });
  return { timeline, scrubber, width };
}

describe('useVersionScrubber：刻度口径', () => {
  it('轴上的版本 = 列表表头「本范围 n 版」同一个数（排除「仅属性」与「本范围无变化」）', () => {
    const { timeline, scrubber } = setup({
      // 10 / 12 / 15 都是子树变过的会话；20 只有属性时间线列出（UDA 改动）→ 不算一版
      rows: [[10, 'mesh', 'mesh'], [12, null, 'placement'], [15, 'noop', 'noop']],
      nodeRows: [[10, 'mesh', 2], [12, 'placement', 1], [15, 'noop', 1]],
      history: [10, 12, 15, 20],
    });

    expect(timeline.counts.value.versions).toBe(scrubber.versions.value.length);
    expect(scrubber.versions.value.map((v) => v.sesno)).toEqual([10, 12, 15]);
    // 20 在 rows 里但 inScope 为 false（`self` 范围下自身没变），不进轴
    expect(scrubber.versions.value.some((v) => v.sesno === 20)).toBe(false);
  });

  it('字段映射：user → 保存人、comment → 备注、timelineRowImpact → 影响类型、unitsChanged → 单元数', () => {
    const { scrubber } = setup({
      rows: [[10, 'mesh', 'mesh']],
      nodeRows: [[10, 'mesh', 3]],
      history: [10],
    });

    expect(scrubber.versions.value[0]).toMatchObject({
      sesno: 10,
      impactKind: 'mesh',
      author: '张三',
      note: '备注 10',
      changedUnits: 3,
    });
  });

  it('首次显示游标放在最新一版；视口是全量', () => {
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh'], [15, 'mesh', 'mesh']] });

    expect(scrubber.cursor.value).toBe(15);
    expect(scrubber.viewport.value).toEqual({ start: -0.5, end: 2.5 });
  });
});

describe('useVersionScrubber：切范围（Requirement 1.9、1.10）', () => {
  it('切范围游标与两钉的 sesno 原样不动，视口回新表全量', () => {
    const { timeline, scrubber } = setup({
      rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh'], [15, 'mesh', 'mesh']],
    });
    scrubber.cursor.value = 12;
    scrubber.pin('a');
    scrubber.cursor.value = 15;
    scrubber.pin('b');
    expect(scrubber.pins.value).toEqual({ a: 12, b: 15 });

    scrubber.viewport.value = { start: 0, end: 1 };
    timeline.setScope('self');

    expect(scrubber.cursor.value).toBe(15);
    expect(scrubber.pins.value).toEqual({ a: 12, b: 15 });
    expect(scrubber.viewport.value).toEqual({ start: -0.5, end: 2.5 });
  });

  it('不在新表里的游标 / 钉出灰标；在表里的不出', () => {
    const { timeline, scrubber } = setup({
      rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh'], [15, 'mesh', 'mesh']],
    });

    // 换一张表：只有 10 是「自身变过」，12 / 15 只在单元列里
    timeline.setNode({
      timeline: elementTimeline([[10, 'mesh', 'mesh'], [12, null, 'mesh'], [15, null, 'mesh']]),
      history: null,
      nodeVersions: null,
      hasMembers: false,
    });
    // setNode 会把 A / B 重置成缺省两版；这里直接落钉，测的是「钉不在新表里」那一档
    timeline.setPins({ a: 10, b: 12 });
    scrubber.cursor.value = 12;

    // 12 / 15 在「仅自身」下不算一版 → 游标 12 与 B 钉 12 都在表外，A 钉 10 在表内
    expect(scrubber.versions.value.map((v) => v.sesno)).toEqual([10]);
    expect(scrubber.outOfScope.value).toEqual({ cursor: true, a: false, b: true });
    expect(scrubber.ghosts.value.map((g) => [g.role, g.sesno])).toEqual([['cursor', 12], ['b', 12]]);
    // 12 比全表唯一刻度（序号 0）大 → 落在 n − 0.5
    expect(scrubber.ghosts.value[0]!.ordinal).toBe(0.5);
  });
});

describe('useVersionScrubber：钉', () => {
  it('pin 把游标钉到该侧；同版被拒并给提示；withPrevious / withLatest 按链序取邻', () => {
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh'], [15, 'mesh', 'mesh']] });
    // `setNode` 已经给了缺省 A / B（范围内最近两版）；从空钉开始才测得到单侧
    scrubber.clearPins();
    scrubber.cursor.value = 12;

    scrubber.pin('a');
    expect(scrubber.pins.value).toEqual({ a: 12, b: null });

    scrubber.pin('b');
    expect(scrubber.pins.value).toEqual({ a: 12, b: null });
    expect(scrubber.notice.value).toContain('同一版不能同时做 A 和 B');

    scrubber.withLatest();
    expect(scrubber.pins.value).toEqual({ a: 12, b: 15 });

    scrubber.cursor.value = 15;
    scrubber.withLatest();
    expect(scrubber.notice.value).toContain('已经是范围内最新版');

    scrubber.withPrevious();
    expect(scrubber.pins.value).toEqual({ a: 12, b: 15 });

    scrubber.clearPins();
    expect(scrubber.pins.value).toEqual({ a: null, b: null });
  });

  it('钉写回走 timeline.setPins：A > B 时按 sesno 摆正', () => {
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh'], [15, 'mesh', 'mesh']] });

    scrubber.dragPin('a', 15);
    scrubber.dragPin('b', 10);

    expect(scrubber.pins.value).toEqual({ a: 10, b: 15 });
  });
});

describe('useVersionScrubber：时间点解析（Requirement 8.8、8.9、10.2）', () => {
  it('格式无效先在前端拦掉，不打后端', async () => {
    const resolveNodeTime = vi.fn();
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh']], source: sourceWith({ resolveNodeTime }) });

    await scrubber.resolveDate('2026/09/22 02:00');

    expect(resolveNodeTime).not.toHaveBeenCalled();
    expect(scrubber.dateError.value).toContain('时间格式无效');
    expect(scrubber.cursor.value).toBe(10);
  });

  it('后端解析成功 → 游标移到该 sesno，onCursorChange 的触发方式是 resolve', async () => {
    const resolveNodeTime = vi.fn(async () => ({ sesno: 12, sessionTime: '2026-09-22T02:00:00+00:00' }));
    const { scrubber } = setup({
      rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh']],
      source: sourceWith({ resolveNodeTime }),
    });
    const seen: [number, string][] = [];
    scrubber.onCursorChange((sesno, trigger) => seen.push([sesno, trigger]));

    await scrubber.resolveDate('2026-09-22T02:00:00Z');

    expect(resolveNodeTime).toHaveBeenCalledWith({
      dbnum: 8000,
      refno: '24384_23257',
      scope: 'subtree',
      at: '2026-09-22T02:00:00Z',
    });
    expect(scrubber.cursor.value).toBe(12);
    expect(scrubber.dateError.value).toBeNull();
    expect(seen.at(-1)).toEqual([12, 'resolve']);
  });

  it('旧服务端（路由缺失）→ 本面板会话改用前端 resolveAt，游标照样移动，之后不再打这条路由', async () => {
    const resolveNodeTime = vi.fn(async () => { throw new ModelVersionRouteUnavailableError('node/versions/resolve'); });
    const { scrubber } = setup({
      rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh'], [15, 'mesh', 'mesh']],
      source: sourceWith({ resolveNodeTime }),
    });

    await scrubber.resolveDate('2026-09-14T00:00:00Z');

    expect(scrubber.legacyResolve.value).toBe(true);
    expect(scrubber.dateError.value).toBeNull();
    // 前端 resolveAt：≤ 该时刻的最后一个会话 = 12（10 → 09-10，12 → 09-12，15 → 09-15）
    expect(scrubber.cursor.value).toBe(12);

    await scrubber.resolveDate('2026-09-16T00:00:00Z');
    expect(resolveNodeTime).toHaveBeenCalledTimes(1);
    expect(scrubber.cursor.value).toBe(15);
  });

  it('早于最早版本 → 显示原因，游标不动', async () => {
    const resolveNodeTime = vi.fn(async () => {
      throw new HistoryQueryError('TIME_BEFORE_OLDEST_SESSION', { status: 422 });
    });
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh'], [15, 'mesh', 'mesh']], source: sourceWith({ resolveNodeTime }) });

    await scrubber.resolveDate('2000-01-01T00:00:00Z');

    expect(scrubber.dateError.value).toContain('早于全部有时间的版本');
    expect(scrubber.cursor.value).toBe(15);
  });

  it('网络失败 → 显示服务端码，游标不动', async () => {
    const resolveNodeTime = vi.fn(async () => { throw new HistoryQueryError('NETWORK'); });
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh']], source: sourceWith({ resolveNodeTime }) });

    await scrubber.resolveDate('2026-09-10T00:00:00Z');

    expect(scrubber.dateError.value).toBe('NETWORK');
    expect(scrubber.cursor.value).toBe(10);
  });
});

describe('useVersionScrubber：直达链接与几何筛选', () => {
  it('restoreFromUrl 照 URL 落游标与两钉（触发方式 url），越界也照落', () => {
    const { scrubber } = setup({ rows: [[10, 'mesh', 'mesh'], [15, 'mesh', 'mesh']] });
    const seen: [number, string][] = [];
    scrubber.onCursorChange((sesno, trigger) => seen.push([sesno, trigger]));

    scrubber.restoreFromUrl({ cursor: 99, a: 10, b: 15 });

    expect(scrubber.cursor.value).toBe(99);
    expect(scrubber.pins.value).toEqual({ a: 10, b: 15 });
    expect(scrubber.outOfScope.value.cursor).toBe(true);
    expect(seen.at(-1)).toEqual([99, 'url']);
  });

  it('勾选「只看几何变的」后游标迁到 ≤ 当前值的最后一个几何变化版本', () => {
    const { timeline, scrubber } = setup({
      rows: [[10, 'mesh', 'mesh'], [12, 'noop', 'noop'], [15, 'mesh', 'mesh']],
      nodeRows: [[10, 'mesh', 1], [12, 'noop', 1], [15, 'mesh', 1]],
    });
    scrubber.cursor.value = 12;

    timeline.geometryOnly.value = true;

    expect(scrubber.cursor.value).toBe(10);
  });
});
