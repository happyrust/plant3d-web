import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelUnitVersionComparePanel from './ModelUnitVersionComparePanel.vue';

import { ModelVersionRouteUnavailableError, type ModelElementVersionTimeline, type ModelNodeVersionTimeline, type ModelVersion, type ModelVersionGeometry } from '@/model-source';

// 面板只经模型来源端口的 `versions` 取数；这里给一份可编程的 ModelVersionSource，不建真适配器
const versionSourceMocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
  listElementVersions: vi.fn(),
  loadVersion: vi.fn(),
  attributesAt: vi.fn(),
  attributeHistory: vi.fn(),
  listNodeVersions: vi.fn(),
  diffSummary: vi.fn(),
}));
vi.mock('@/model-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/model-source')>();
  return { ...actual, getModelSource: () => ({ kind: 'gen-model-v1', versions: versionSourceMocks }) };
});
vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: vi.fn().mockResolvedValue(undefined),
  getDbnumByRefno: vi.fn().mockReturnValue(7997),
}));

function version(sesno: number, sessionTime: string, extra: Partial<ModelVersion> = {}): ModelVersion {
  return { dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno, sessionTime, impactKind: 'mesh', ...extra };
}

const versions: ModelVersion[] = [
  version(791, '2026-07-22T01:00:00Z'),
  version(897, '2026-07-22T02:00:00Z'),
];

/** 查的就是单元根自己：两列说的是同一件事 */
const unitTimeline: ModelElementVersionTimeline = {
  dbnum: 7997,
  refno: '24381_145018',
  noun: 'BRAN',
  unitRefno: '24381_145018',
  unitNoun: 'BRAN',
  unitColumnOnly: false,
  versions: versions.map((item) => ({ sesno: item.sesno, sessionTime: item.sessionTime, elementImpact: 'mesh', unitImpact: 'mesh' })),
};

/** 查的是单元里的一个构件（`1_2`，791 有 897 没有）：791 那一版它自己变过，897 那一版没有 */
const elementTimeline: ModelElementVersionTimeline = {
  dbnum: 7997,
  refno: '1_2',
  noun: 'VALV',
  unitRefno: '24381_145018',
  unitNoun: 'BRAN',
  unitColumnOnly: false,
  versions: [
    { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', elementImpact: 'mesh', unitImpact: 'mesh' },
    { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', elementImpact: null, unitImpact: 'mesh' },
  ],
};

function geometry(entries: Map<string, unknown[]>): ModelVersionGeometry {
  return { refnos: [...entries.keys()], entries: entries as never, release: vi.fn().mockResolvedValue(undefined) };
}

const geometryBySesno: Record<number, () => ModelVersionGeometry> = {
  791: () => geometry(new Map([
    ['1_1', [{ geo_hash: 'same', geo_index: 0, matrix: [1], uniforms: { noun: 'PIPE' } }]],
    ['1_2', [{ geo_hash: 'gone', geo_index: 0, matrix: [1], uniforms: { noun: 'VALV' } }]],
  ])),
  897: () => geometry(new Map([
    ['1_1', [{ geo_hash: 'same', geo_index: 0, matrix: [1], uniforms: { noun: 'PIPE' } }]],
    ['1_3', [{ geo_hash: 'added', geo_index: 0, matrix: [1], uniforms: { noun: 'ELBO' } }]],
  ])),
};

async function flushUi(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('ModelUnitVersionComparePanel', () => {
  beforeEach(() => {
    versionSourceMocks.listVersions.mockResolvedValue(versions);
    versionSourceMocks.listElementVersions.mockResolvedValue(unitTimeline);
    versionSourceMocks.loadVersion.mockImplementation(async (item: ModelVersion) => geometryBySesno[item.sesno]!());
    // 缺省当旧服务端：没有 node/versions（容器退回手填会话号）；要节点版本表的用例自己 resolve
    versionSourceMocks.listNodeVersions.mockRejectedValue(new ModelVersionRouteUnavailableError('node/versions'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('从参考号选择最近两个 sesno 并派发整单元对比', async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);

    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381/145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.textContent).toContain('DB 7997');
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('791');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');
    expect(host.querySelector('[data-testid="model-unit-compare-timeline"]')?.textContent).toContain('2026');

    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('新增 1');
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('删除 1');
    expect(events.at(-1)?.detail).toEqual(expect.objectContaining({
      action: 'open',
      dbnum: 7997,
      unitRefno: '24381_145018',
      before: expect.objectContaining({ sesno: 791, refnos: ['1_1', '1_2'] }),
      after: expect.objectContaining({ sesno: 897, refnos: ['1_1', '1_3'] }),
      refnos: ['1_3', '1_2', '1_1'],
    }));

    expect(versionSourceMocks.listVersions).toHaveBeenCalledWith(7997, '24381_145018');
    expect(versionSourceMocks.loadVersion).toHaveBeenCalledTimes(2);
    expect(versionSourceMocks.loadVersion.mock.calls.map(([item]) => (item as ModelVersion).sesno)).toEqual([791, 897]);

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });

  it('填构件参考号：版本表按所属单元列、每一版标出本构件变没变，对比按单元跑且结果收窄到它', async () => {
    versionSourceMocks.listElementVersions.mockResolvedValue(elementTimeline);
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);

    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '1/2';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    // 构件 → 所属单元：时间线问的是构件，版本表问的是它所属的单元
    expect(versionSourceMocks.listElementVersions).toHaveBeenCalledWith(7997, '1_2');
    expect(versionSourceMocks.listVersions).toHaveBeenCalledWith(7997, '24381_145018');
    expect(host.querySelector('[data-testid="model-unit-compare-scope"]')?.textContent).toContain('所属单元 24381_145018');
    const timelineText = host.querySelector('[data-testid="model-unit-compare-timeline"]')?.textContent ?? '';
    expect(timelineText).toContain('本构件 mesh');
    expect(timelineText).toContain('本构件 未变');

    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    // 对比仍按单元跑（几何只按单元生成）
    expect(events.at(-2)?.detail).toEqual(expect.objectContaining({ action: 'open', unitRefno: '24381_145018' }));
    // 跑完把镜头与列表收窄到查的那个构件：1_2 在 897 里没有，是「删除」行
    expect(events.at(-1)?.detail).toEqual({ action: 'focus', refno: '1_2' });
    const queried = host.querySelector('[data-queried-element="true"]');
    expect(queried?.textContent).toContain('1_2');
    expect(queried?.textContent).toContain('本构件');

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });

  it('构件不在任何最小交付单元下：给明确说明（不是错误），不去查版本表', async () => {
    versionSourceMocks.listElementVersions.mockResolvedValue({
      ...elementTimeline, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, versions: [],
    } satisfies ModelElementVersionTimeline);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);

    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '1_9';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-notice"]')?.textContent).toContain('不在任何最小交付单元下');
    expect(host.querySelector('[data-testid="model-unit-compare-error"]')).toBeNull();
    expect(versionSourceMocks.listVersions).not.toHaveBeenCalled();

    app.unmount();
  });

  it('对比成功后把非 unchanged 行送进模型树差异模式，关闭时派发空上下文退出', async () => {
    const treeDiffEvents: CustomEvent[] = [];
    const listener = (event: Event) => treeDiffEvents.push(event as CustomEvent);
    window.addEventListener('plant3d:model-version-tree-diff', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(treeDiffEvents).toHaveLength(1);
    expect(treeDiffEvents[0]?.detail).toMatchObject({
      dbnum: 7997,
      fromSesno: 791,
      toSesno: 897,
      mode: 'compare',
      refnos: ['1_3', '1_2'],
      models: [
        { refno: '1_3', category: 'ELBO', status: 'added', sourceNouns: 'ELBO' },
        { refno: '1_2', category: 'VALV', status: 'deleted', sourceNouns: 'VALV' },
      ],
    });

    // 属性历史对比的取数口随上下文一起来：按「哪一侧」把本次持有的那份版本几何交回模型来源
    const attributesAt = treeDiffEvents[0]?.detail.attributesAt as ((side: string, refno: string) => Promise<unknown>) | undefined;
    expect(typeof attributesAt).toBe('function');
    versionSourceMocks.attributesAt.mockResolvedValue({ sesno: 791, exists: true, noun: 'VALV', attributes: [] });
    await attributesAt!('before', '1_2');
    expect(versionSourceMocks.attributesAt).toHaveBeenCalledTimes(1);
    const [geometryArg, refnoArg] = versionSourceMocks.attributesAt.mock.calls[0]!;
    expect(refnoArg).toBe('1_2');
    expect((geometryArg as { refnos: string[] }).refnos).toEqual(['1_1', '1_2']);

    // 视口侧关闭 → 树退出差异模式（空上下文）
    window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare', { detail: { action: 'close' } }));
    await flushUi();
    expect(treeDiffEvents).toHaveLength(2);
    expect(treeDiffEvents[1]?.detail).toEqual({ refnos: [], models: [] });

    window.removeEventListener('plant3d:model-version-tree-diff', listener);
    app.unmount();
  });

  it('URL compare_autorun=1 + compare_a/b：挂载后自动查版本、选 A/B、跑对比（Q16）', async () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, '', '/?unit_refno=24381/145018&compare_a=897&compare_b=791&compare_autorun=1');
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    await flushUi();
    await flushUi();

    // 没点任何按钮：版本已查、A/B 已按 URL 选好（791 早于 897 自动摆正）、对比已跑并派发 open
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('791');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('新增 1');
    expect(events.some((event) => event.detail?.action === 'open')).toBe(true);

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
    window.history.replaceState({}, '', originalUrl);
  });

  it('URL 指定的 compare_a 不在版本表里：回落最近两版并提示', async () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, '', '/?unit_refno=24381_145018&compare_a=5&compare_b=897&compare_autorun=1');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    await flushUi();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('791');
    expect(host.querySelector('[data-testid="model-unit-compare-error"]')?.textContent).toContain('compare_a=5');
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')).toBeTruthy();

    app.unmount();
    window.history.replaceState({}, '', originalUrl);
  });

  it('两个版本 geometryKey 相同时只 loadVersion 一次并显示无几何差异', async () => {
    versionSourceMocks.listVersions.mockResolvedValue([
      version(791, '2026-07-22T01:00:00Z', { geometryKey: '7997:24381_145018:791' }),
      version(897, '2026-07-22T02:00:00Z', { impactKind: 'noop', geometryKey: '7997:24381_145018:791' }),
    ]);
    versionSourceMocks.loadVersion.mockImplementation(async () => geometry(new Map([
      ['1_1', [{ geo_hash: 'same', geo_index: 0, matrix: [1], uniforms: { noun: 'PIPE' } }]],
    ])));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-noop"]')?.textContent).toContain('只加载了一次');
    expect(versionSourceMocks.loadVersion).toHaveBeenCalledTimes(1);

    app.unmount();
  });

  it('查询新参考号时立即清空旧版本选择', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')).toBeTruthy();

    input.value = 'invalid';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-a"]')).toBeNull();
    expect(host.textContent).not.toContain('DB 7997');
    app.unmount();
  });

  it('两侧几何都为空时完成比较后仍显示无几何差异', async () => {
    versionSourceMocks.loadVersion.mockImplementation(async () => geometry(new Map()));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-noop"]')?.textContent).toContain('无几何差异');
    app.unmount();
  });

  it('范围开关：单元及以下缺省「所有子节点」，切「仅自身」后 A/B 保留、越界行灰掉并标「本范围无变化」（Q9 a / Q10 c）', async () => {
    versionSourceMocks.listElementVersions.mockResolvedValue(elementTimeline);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '1_2';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    const subtree = host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement;
    expect(subtree.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="model-unit-compare-timeline-head"]')?.textContent).toContain('本范围 2 版');
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('791');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');

    (host.querySelector('[data-testid="model-unit-compare-scope-self"]') as HTMLButtonElement).click();
    await flushUi();
    // 897 那一版构件自己没变：仅自身范围只剩 791 一版，但 897 仍是 B —— 留着、灰掉、标出来
    expect(host.querySelector('[data-testid="model-unit-compare-timeline-head"]')?.textContent).toContain('本范围 1 版');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');
    const dimmed = host.querySelector('[data-testid="model-unit-compare-timeline"] li[data-sesno="897"]');
    expect(dimmed?.getAttribute('data-in-scope')).toBe('false');
    expect(dimmed?.textContent).toContain('本范围无变化');
    app.unmount();
  });

  it('时间线上点 A / B 选版本并自动摆正；「与上一版比」「与最新比」', async () => {
    versionSourceMocks.listVersions.mockResolvedValue([
      version(700, '2026-07-22T00:00:00Z'), version(791, '2026-07-22T01:00:00Z'), version(897, '2026-07-22T02:00:00Z'),
    ]);
    versionSourceMocks.listElementVersions.mockResolvedValue({
      ...unitTimeline,
      versions: [700, 791, 897].map((sesno) => ({ sesno, sessionTime: null, elementImpact: 'mesh' as const, unitImpact: 'mesh' as const })),
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    const pair = () => [
      host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno'),
      host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno'),
    ];
    expect(pair()).toEqual(['791', '897']);

    (host.querySelector('[data-testid="model-unit-compare-pick-a-700"]') as HTMLButtonElement).click();
    await flushUi();
    expect(pair()).toEqual(['700', '897']);
    // 把比 B 还新的一版设成 A：两端对调
    (host.querySelector('[data-testid="model-unit-compare-pick-b-700"]') as HTMLButtonElement).click();
    await flushUi();
    expect(pair()).toEqual(['', '700']);
    (host.querySelector('[data-testid="model-unit-compare-with-latest"]') as HTMLButtonElement).click();
    await flushUi();
    expect(pair()).toEqual(['791', '897']);
    (host.querySelector('[data-testid="model-unit-compare-pick-b-791"]') as HTMLButtonElement).click();
    await flushUi();
    expect(pair()).toEqual(['700', '791']);
    (host.querySelector('[data-testid="model-unit-compare-with-previous"]') as HTMLButtonElement).click();
    await flushUi();
    expect(pair()).toEqual(['700', '791']);
    app.unmount();
  });

  it('属性变化时间线：行带 user / comment / 属性 n，属性对比 tab 把 (A, B] 折成净差；旧服务端缺路由时照实说', async () => {
    versionSourceMocks.attributeHistory.mockResolvedValue({
      dbnum: 7997, refno: '24381_145018', noun: 'BRAN', unitRefno: '24381_145018', unitNoun: 'BRAN',
      entries: [
        { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', user: 'dpc', comment: '初始交付', kind: 'created', impact: 'delivery', changedCount: 0, changes: [], members: null, owner: null, attributesUnavailable: null },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', user: 'happyrust', comment: '抬管 500', kind: 'modified', impact: 'mesh', changedCount: 2,
          changes: [
            { name: 'POS', valueType: 'vec3', before: 'U 2900', after: 'U 3400', stamp: false },
            { name: 'CACHID', valueType: 'int', before: '41', after: '42', stamp: true },
          ], members: null, owner: null, attributesUnavailable: null },
      ],
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    expect(versionSourceMocks.attributeHistory).toHaveBeenCalledWith(7997, '24381_145018');
    const row = host.querySelector('[data-testid="model-unit-compare-timeline"] li[data-sesno="897"]');
    expect(row?.textContent).toContain('happyrust');
    expect(row?.textContent).toContain('抬管 500');
    expect(row?.textContent).toContain('属性 2');
    expect(host.querySelector('[data-testid="model-unit-compare-history-missing"]')).toBeNull();

    // 「仅自身」下属性对比 tab 把 791→897 折成净差：POS 变了；CACHID 是戳，缺省不列
    (host.querySelector('[data-testid="model-unit-compare-scope-self"]') as HTMLButtonElement).click();
    await flushUi();
    const table = host.querySelector('[data-testid="model-unit-compare-attr-table"]');
    expect(table?.textContent).toContain('POS');
    expect(table?.textContent).toContain('U 2900');
    expect(table?.textContent).toContain('U 3400');
    expect(table?.textContent).not.toContain('CACHID');
    expect(host.querySelector('[data-testid="model-unit-compare-attributes"]')?.textContent).toContain('1 项变化');
    app.unmount();

    // 旧服务端：没有这条路由 → 时间线仍在（版本表那一半），并照实说缺什么
    const { ModelVersionRouteUnavailableError } = await import('@/model-source');
    versionSourceMocks.attributeHistory.mockRejectedValue(new ModelVersionRouteUnavailableError('element/attribute-history'));
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const app2 = createApp(ModelUnitVersionComparePanel);
    app2.mount(host2);
    const input2 = host2.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input2.value = '24381_145018';
    input2.dispatchEvent(new Event('input'));
    (host2.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host2.querySelectorAll('[data-testid="model-unit-compare-timeline"] li')).toHaveLength(2);
    expect(host2.querySelector('[data-testid="model-unit-compare-history-missing"]')?.textContent).toContain('element/attribute-history');
    app2.unmount();
  });

  it('差异摘要：所有子节点下按单元分组，每组一个「在三维中对比」装那个单元的 A/B', async () => {
    const zone: ModelElementVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, unitColumnOnly: false,
      versions: [
        { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', elementImpact: 'delivery', unitImpact: null },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', elementImpact: 'noop', unitImpact: null },
      ],
    };
    versionSourceMocks.listElementVersions.mockResolvedValue(zone);
    versionSourceMocks.diffSummary.mockResolvedValue({
      dbnum: 7997, refno: '1_9', noun: 'ZONE', scope: 'subtree', a: 791, b: 897,
      units: { changed: 1, unchanged: 3, total: 4, complete: true },
      elements: { added: 1, deleted: 1, modified: 0, noop: 1 },
      groups: [
        { unitRefno: null, unitNoun: null, unitName: null, counts: { added: 0, deleted: 0, modified: 0, noop: 1 }, geometryChanged: false, rowsTruncated: 0,
          rows: [{ refno: '1_9', noun: 'ZONE', status: 'noop', impact: 'noop', isNode: true }] },
        { unitRefno: '24381_145018', unitNoun: 'BRAN', unitName: '/B1', counts: { added: 1, deleted: 1, modified: 0, noop: 0 }, geometryChanged: true, rowsTruncated: 0,
          rows: [
            { refno: '1_3', noun: 'ELBO', status: 'added', impact: 'delivery', isNode: false },
            { refno: '1_2', noun: 'VALV', status: 'deleted', impact: 'tombstone', isNode: false },
          ] },
      ],
      needsConfirm: false, estimatedProjections: 2, confirmThresholdUnits: 20, warnings: [],
    });
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '1_9';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    // 容器缺省「仅自身」；切到「所有子节点」后差异摘要按 subtree 算
    expect((host.querySelector('[data-testid="model-unit-compare-scope-self"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect(versionSourceMocks.listVersions).not.toHaveBeenCalled();
    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();
    expect(versionSourceMocks.diffSummary).toHaveBeenLastCalledWith(7997, '1_9', 791, 897, 'subtree');

    // 属性对比 tab：有变的构件清单，节点自身置顶
    const changed = host.querySelector('[data-testid="model-unit-compare-changed-elements"]');
    expect(changed?.textContent).toContain('本节点');
    expect(changed?.querySelectorAll('li')).toHaveLength(3);

    // 模型对比 tab：摘要 + 分组；节点自己没有单元 → 顶部按钮禁用，组里那个可点
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-diff-summary"]')?.textContent).toContain('变了的单元 1');
    expect((host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).disabled).toBe(true);
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_145018"]') as HTMLButtonElement).click();
    await flushUi();

    expect(versionSourceMocks.loadVersion.mock.calls.map(([item]) => [(item as ModelVersion).unitRefno, (item as ModelVersion).sesno])).toEqual([
      ['24381_145018', 791], ['24381_145018', 897],
    ]);
    expect(events.at(-1)?.detail).toEqual(expect.objectContaining({ action: 'open', unitRefno: '24381_145018' }));
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('新增 1');

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });

  it('容器 + 新服务端：时间线来自 node/versions（子树每版带「单元 n」），不再露出手填会话号；旧服务端才手填', async () => {
    const zone: ModelElementVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, unitColumnOnly: false,
      versions: [{ sesno: 444, sessionTime: '2026-07-20T00:00:00Z', elementImpact: 'delivery', unitImpact: null }],
    };
    const subtree: ModelNodeVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', scope: 'subtree', unitRefno: null, unitNoun: null,
      versions: [
        { sesno: 444, sessionTime: '2026-07-20T00:00:00Z', impact: 'delivery', selfImpact: 'delivery', unitsChanged: 4, unitsTouched: 4 },
        { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 1 },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', impact: 'mesh', selfImpact: 'noop', unitsChanged: 2, unitsTouched: 3 },
      ],
    };
    versionSourceMocks.listElementVersions.mockResolvedValue(zone);
    versionSourceMocks.listNodeVersions.mockResolvedValue(subtree);
    versionSourceMocks.diffSummary.mockRejectedValue(new ModelVersionRouteUnavailableError('node/diff-summary'));
    // 属性变化时间线多一行 500：只设了 UDA，版本表（模型口径）不算它一版 → 行照列、标「仅属性」、不计入「本范围 n 版」
    versionSourceMocks.attributeHistory.mockResolvedValue({
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null,
      entries: [
        { sesno: 444, sessionTime: '2026-07-20T00:00:00Z', user: 'YW', comment: '建 ZONE', kind: 'created', impact: 'delivery', changedCount: 0, changes: [], members: null, owner: null, attributesUnavailable: null },
        { sesno: 500, sessionTime: '2026-07-21T00:00:00Z', user: '80404', comment: 'UDA', kind: 'modified', impact: 'noop', changedCount: 1,
          changes: [{ name: 'UDA:2902d6e2', valueType: 'text', before: null, after: 'JS', stamp: false }], members: null, owner: null, attributesUnavailable: null },
      ],
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '1_9';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    // 只对容器去取节点版本表（单元及以下的子树 ≈ 所属单元，单元表已经给了）
    expect(versionSourceMocks.listNodeVersions).toHaveBeenCalledWith(7997, '1_9', 'subtree');
    expect(versionSourceMocks.listVersions).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="model-unit-compare-notice"]')?.textContent).toContain('子树时间线 3 版来自 node/versions');
    expect(host.querySelector('[data-testid="model-unit-compare-manual-pair"]')).toBeNull();

    // 容器缺省「仅自身」：444（出现）/ 500（仅属性）/ 897（自身 noop）在范围内，791 是子树在动 → 灰掉不显示；缺省 A/B = 500 → 897
    const rows = () => [...host.querySelectorAll('[data-testid="model-unit-compare-timeline"] li')];
    expect(rows().map((li) => li.getAttribute('data-sesno'))).toEqual(['897', '500', '444']);
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('500');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');
    expect(host.querySelector('[data-testid="model-unit-compare-units-changed"]')).toBeNull();
    // 「本范围 2 版 · 仅属性 1」：2 与 node/versions self 的行数对得上；500 那一行的徽章是「仅属性」而不是 noop
    expect(host.querySelector('[data-testid="model-unit-compare-timeline-head"]')?.textContent).toContain('本范围 2 版 · 仅属性 1');
    const attributeOnlyChips = () => [...host.querySelectorAll('[data-testid="model-unit-compare-attribute-only"]')];
    expect(attributeOnlyChips().map((chip) => chip.closest('li')?.getAttribute('data-sesno'))).toEqual(['500']);

    // 切「所有子节点」：四版全在范围内，动过几何的行带「单元 n」；500 仍是「仅属性」，版数 3 = node/versions subtree 的行数
    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();
    expect(rows().map((li) => [li.getAttribute('data-sesno'), li.getAttribute('data-in-scope')])).toEqual([['897', 'true'], ['791', 'true'], ['500', 'true'], ['444', 'true']]);
    expect([...host.querySelectorAll('[data-testid="model-unit-compare-units-changed"]')].map((chip) => chip.textContent?.trim())).toEqual(['单元 2', '单元 1', '单元 4']);
    expect(host.querySelector('[data-testid="model-unit-compare-timeline-head"]')?.textContent).toContain('本范围 3 版 · 仅属性 1');
    expect(attributeOnlyChips().map((chip) => chip.closest('li')?.getAttribute('data-sesno'))).toEqual(['500']);
    app.unmount();
    versionSourceMocks.attributeHistory.mockReset();

    // 旧服务端（没有 node/versions）：只列得出它自己那一版，手填会话号那一栏露出来、提示照实说
    versionSourceMocks.listNodeVersions.mockRejectedValue(new ModelVersionRouteUnavailableError('node/versions'));
    const old = document.createElement('div');
    document.body.appendChild(old);
    const oldApp = createApp(ModelUnitVersionComparePanel);
    oldApp.mount(old);
    const oldInput = old.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    oldInput.value = '1_9';
    oldInput.dispatchEvent(new Event('input'));
    (old.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    expect(old.querySelector('[data-testid="model-unit-compare-notice"]')?.textContent).toContain('服务端还没有 node/versions');
    expect(old.querySelector('[data-testid="model-unit-compare-manual-pair"]')).not.toBeNull();
    expect([...old.querySelectorAll('[data-testid="model-unit-compare-timeline"] li')].map((li) => li.getAttribute('data-sesno'))).toEqual(['444']);
    oldApp.unmount();
  });

  it('比较请求未完成时卸载面板不会派发幽灵 open 事件', async () => {
    let resolveGeometry!: (value: ModelVersionGeometry) => void;
    const pendingGeometry = new Promise<ModelVersionGeometry>((resolve) => {
      resolveGeometry = resolve;
    });
    versionSourceMocks.loadVersion.mockReturnValue(pendingGeometry);
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    app.unmount();
    resolveGeometry(geometry(new Map()));
    await flushUi();

    expect(events.some((event) => event.detail?.action === 'open')).toBe(false);
    window.removeEventListener('plant3d:model-unit-version-compare', listener);
  });
});
