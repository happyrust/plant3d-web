import { afterEach, describe, expect, it } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

import VersionTimelineScrubber from './VersionTimelineScrubber.vue';

import type {
  ModelElementVersionTimeline,
  ModelNodeDiffScope,
  ModelNodeVersionTimeline,
  ModelVersionImpactKind,
  ModelVersionSource,
} from '@/model-source';

import { useNodeVersionTimeline } from '@/composables/useNodeVersionTimeline';
import { useVersionScrubber } from '@/composables/useVersionScrubber';

/**
 * `VersionTimelineScrubber`（tasks.md 15.2）：只测「画什么」与「点下去发什么」。
 * 吸附 / 方向键 / 点击簇 / 缩放 / 钉 / 时间点解析的算法在 `useVersionScrubber` 与 `utils/versionScrub/*`，
 * 这里不重复。
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
    unitColumnOnly: false,
    versions: rows.map(([sesno, elementImpact, unitImpact]) => ({
      sesno,
      sessionTime: `2026-09-${String(sesno).padStart(2, '0')}T00:00:00Z`,
      elementImpact,
      unitImpact,
    })),
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

function stubSource(): ModelVersionSource {
  return {
    listVersions: async () => [],
    listElementVersions: async () => elementTimeline([]),
    loadVersion: async () => ({ refnos: [], entries: new Map(), release: async () => undefined }),
    attributesAt: async () => ({ sesno: 0, exists: false, noun: null, attributes: [] }),
    attributeHistory: async () => ({ dbnum: 8000, refno: '', noun: null, versions: [] }),
    attributeDiff: async () => ({ dbnum: 8000, refno: '', a: 0, b: 0, rows: [] }),
    listNodeVersions: async () => nodeVersions([]),
    diffSummary: async () => {
      throw new Error('未使用');
    },
  } as unknown as ModelVersionSource;
}

function flushUi(): Promise<void> {
  return nextTick().then(() => nextTick()).then(() => new Promise<void>((r) => { setTimeout(r, 0); }));
}

const mounted: { unmount(): void; host: HTMLElement }[] = [];

afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.unmount();
    item.host.remove();
  }
});

function mountScrubber(options: {
  rows?: [sesno: number, self: ModelVersionImpactKind | null, unit: ModelVersionImpactKind | null][];
  nodeRows?: [sesno: number, impact: ModelVersionImpactKind, unitsChanged: number][];
  tableError?: { code: string; message: string } | null;
  tickStatus?: Map<number, 'loading' | 'failed'>;
  geometryOnly?: boolean;
  browsing?: boolean;
  legacyFallback?: boolean;
  counts?: { versions: number; attributeOnly: number };
} = {}) {
  const timeline = useNodeVersionTimeline();
  timeline.setNode({
    timeline: elementTimeline(options.rows ?? [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh'], [15, 'noop', 'noop']]),
    history: null,
    nodeVersions: options.nodeRows ? nodeVersions(options.nodeRows) : null,
    hasMembers: true,
  });
  const width = ref(800);
  const scrubber = useVersionScrubber(timeline, { source: stubSource(), width });
  if (options.geometryOnly) timeline.geometryOnly.value = true;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(VersionTimelineScrubber, {
    scrubber,
    width: width.value,
    counts: options.counts ?? timeline.counts.value,
    scope: timeline.scope.value,
    tableError: options.tableError ?? null,
    tickStatus: options.tickStatus ?? new Map(),
    geometryOnly: options.geometryOnly ?? false,
    browsing: options.browsing ?? false,
    legacyFallback: options.legacyFallback ?? false,
    shareStatus: 'idle' as const,
  });
  const events: string[] = [];
  app.mount(host);
  mounted.push({ unmount: () => app.unmount(), host });
  return { host, scrubber, timeline, events };
}

describe('VersionTimelineScrubber：空态与错误（Requirement 1.11、1.12）', () => {
  it('版本表 0 行：显示「该范围没有版本记录」，不画刻度与游标', async () => {
    const { host } = mountScrubber({ rows: [] });
    await flushUi();

    expect(host.querySelector('[data-testid="version-timeline-scrubber-empty"]')?.textContent).toContain('该范围没有版本记录');
    expect(host.querySelector('[data-testid="version-timeline-scrubber-svg"]')).toBeNull();
  });

  it('勾了「只看几何变的」且没有几何变化版本：显示「当前范围没有可浏览的版本」', async () => {
    const { host } = mountScrubber({
      rows: [[10, 'noop', 'noop'], [12, 'noop', 'noop']],
      geometryOnly: true,
    });
    await flushUi();

    expect(host.querySelector('[data-testid="version-timeline-scrubber-empty"]')?.textContent).toContain('当前范围没有可浏览的版本');
  });

  it('版本表请求失败：显示错误码与消息 + 重试', async () => {
    const { host } = mountScrubber({ tableError: { code: 'HISTORY_QUERY_TIMEOUT', message: '查询超时' } });
    await flushUi();

    const box = host.querySelector('[data-testid="version-timeline-scrubber-error"]');
    expect(box?.textContent).toContain('HISTORY_QUERY_TIMEOUT');
    expect(box?.textContent).toContain('查询超时');
    expect(host.querySelector('[data-testid="version-timeline-scrubber-retry-table"]')).not.toBeNull();
    // 有错误时不画轴
    expect(host.querySelector('[data-testid="version-timeline-scrubber-svg"]')).toBeNull();
  });
});

describe('VersionTimelineScrubber：刻度与图例（Requirement 1.1、1.4）', () => {
  it('每个版本一个刻度，几何变化实心、仅属性空心；图例列出每种影响类型', async () => {
    const { host } = mountScrubber();
    await flushUi();

    expect(host.querySelector('[data-testid="version-timeline-scrubber-tick-10"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="version-timeline-scrubber-tick-12"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="version-timeline-scrubber-tick-15"]')).not.toBeNull();

    const legend = host.querySelector('[data-testid="version-timeline-scrubber-legend"]');
    expect(legend?.textContent).toContain('mesh');
    expect(legend?.textContent).toContain('仅属性（空心）');
    expect(legend?.textContent).toContain('时间异常');
  });

  it('时间异常刻度带标记（Requirement 1.3）', async () => {
    // 12 的时间早于 10：按 Chain_Order 记一次异常
    const { host } = mountScrubber({
      rows: [[10, 'mesh', 'mesh'], [12, 'mesh', 'mesh']],
    });
    await flushUi();
    // 默认时间按 sesno 递增，没有异常；这里只断言「有 anomaly 才画」，用时间倒退的一份
    const timeline = useNodeVersionTimeline();
    timeline.setNode({
      timeline: {
        ...elementTimeline([]),
        versions: [
          { sesno: 10, sessionTime: '2026-09-20T00:00:00Z', elementImpact: 'mesh', unitImpact: 'mesh' },
          { sesno: 12, sessionTime: '2026-09-01T00:00:00Z', elementImpact: 'mesh', unitImpact: 'mesh' },
        ],
      },
      history: null,
      nodeVersions: null,
      hasMembers: true,
    });
    const width = ref(800);
    const scrubber = useVersionScrubber(timeline, { source: stubSource(), width });
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const app = createApp(VersionTimelineScrubber, {
      scrubber, width: width.value, counts: timeline.counts.value, scope: timeline.scope.value,
      tableError: null, tickStatus: new Map(), geometryOnly: false, browsing: false,
      legacyFallback: false, shareStatus: 'idle' as const,
    });
    app.mount(host2);
    mounted.push({ unmount: () => app.unmount(), host: host2 });
    await flushUi();

    expect(host2.querySelector('[data-testid="version-timeline-scrubber-anomaly-12"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="version-timeline-scrubber-anomaly-12"]')).toBeNull();
  });

  it('窗口文案显示可见序号区间 / 总版数', async () => {
    const { host } = mountScrubber();
    await flushUi();
    expect(host.querySelector('[data-testid="version-timeline-scrubber-window"]')?.textContent).toContain('/ 3');
  });
});

describe('VersionTimelineScrubber：游标与操作（Requirement 2.5、2.7、5.5）', () => {
  it('游标标注带 sesno 与时间；首帧在最新一版', async () => {
    const { host, scrubber } = mountScrubber();
    await flushUi();

    expect(scrubber.cursor.value).toBe(15);
    const label = host.querySelector('[data-testid="version-timeline-scrubber-cursor-label"]')?.textContent ?? '';
    expect(label).toContain('sesno 15');
    expect(label).toContain('2026');
  });

  it('方向键移动游标（Requirement 2.5）', async () => {
    const { host, scrubber } = mountScrubber();
    await flushUi();
    expect(scrubber.cursor.value).toBe(15);

    const track = host.querySelector('[data-testid="version-timeline-scrubber-track"]') as HTMLElement;
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await flushUi();
    expect(scrubber.cursor.value).toBe(12);

    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await flushUi();
    expect(scrubber.cursor.value).toBe(15);
  });

  it('「对比 A / B」在两钉未齐时禁用（Requirement 5.5）', async () => {
    const { host, scrubber } = mountScrubber();
    await flushUi();
    // `setNode` 会给一对默认钉（倒数第二版 / 最新）：先清掉才谈得上「未齐」
    scrubber.clearPins();
    await flushUi();

    const compare = host.querySelector('[data-testid="version-timeline-scrubber-compare"]') as HTMLButtonElement;
    expect(compare.disabled).toBe(true);

    scrubber.cursor.value = 12;
    scrubber.pin('a');
    await flushUi();
    expect(scrubber.pins.value).toEqual({ a: 12, b: null });
    expect(compare.disabled).toBe(true);

    scrubber.cursor.value = 15;
    scrubber.pin('b');
    await flushUi();
    expect(scrubber.pins.value).toEqual({ a: 12, b: 15 });
    expect(compare.disabled).toBe(false);
  });

  it('钉同一版本时提示「同一版不能同时做 A 和 B」（Requirement 5.3）', async () => {
    const { host, scrubber } = mountScrubber();
    await flushUi();
    scrubber.clearPins();
    await flushUi();

    scrubber.pin('a');
    await flushUi();
    expect(scrubber.pins.value).toEqual({ a: 15, b: null });

    // 游标仍在 15：再钉 B 会被拒，两钉原样不动
    scrubber.pin('b');
    await flushUi();

    expect(scrubber.pins.value).toEqual({ a: 15, b: null });
    expect(host.querySelector('[data-testid="version-timeline-scrubber-notice"]')?.textContent).toContain('同一版不能同时做 A 和 B');
  });

  it('「浏览 / 退出浏览」按 browsing 切换文案', async () => {
    const browse = mountScrubber({ browsing: false });
    await flushUi();
    expect(browse.host.querySelector('[data-testid="version-timeline-scrubber-browse"]')).not.toBeNull();

    const exiting = mountScrubber({ browsing: true });
    await flushUi();
    expect(exiting.host.querySelector('[data-testid="version-timeline-scrubber-exit-browse"]')).not.toBeNull();
  });

  it('失败刻度给出「重试」，加载中显示「正在加载」（Requirement 3.12、3.13）', async () => {
    const failed = mountScrubber({ tickStatus: new Map([[15, 'failed' as const]]) });
    await flushUi();
    expect(failed.host.querySelector('[data-testid="version-timeline-scrubber-retry-tick"]')).not.toBeNull();

    const loading = mountScrubber({ tickStatus: new Map([[15, 'loading' as const]]) });
    await flushUi();
    expect(loading.host.querySelector('[data-testid="version-timeline-scrubber-loading"]')).not.toBeNull();
  });
});

describe('VersionTimelineScrubber：日期输入与降级提示（Requirement 8.9、10.1）', () => {
  it('时间格式无效时显示原因，游标不动', async () => {
    const { host, scrubber } = mountScrubber();
    await flushUi();
    const before = scrubber.cursor.value;

    const input = host.querySelector('[data-testid="version-timeline-scrubber-date"]') as HTMLInputElement;
    input.value = '不是时间';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flushUi();

    expect(host.querySelector('[data-testid="version-timeline-scrubber-date-error"]')?.textContent).toContain('时间格式无效');
    expect(scrubber.cursor.value).toBe(before);
  });

  it('降级时底部显示「服务端没有实时历史查询，改用逐版生成」', async () => {
    const { host } = mountScrubber({ legacyFallback: true });
    await flushUi();
    expect(host.querySelector('[data-testid="version-timeline-scrubber-legacy"]')?.textContent)
      .toContain('服务端没有实时历史查询，改用逐版生成');
  });
});
