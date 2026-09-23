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

/** 一串顺序的 await（多单元一次装载几十份）六个 tick 刷不完：刷到条件成立为止，最多 `rounds` 轮 */
async function flushUntil(predicate: () => boolean, rounds = 80): Promise<void> {
  for (let i = 0; i < rounds && !predicate(); i += 1) await flushUi();
  expect(predicate()).toBe(true);
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

    // open 事件带取数口：ViewerPanel 在三维点到 A / B 构件时用它把属性面板钉到那一版——按侧交回对应那份版本几何
    const attributesAt = events.at(-1)?.detail.attributesAt as ((side: string, refno: string) => Promise<unknown>) | undefined;
    expect(typeof attributesAt).toBe('function');
    versionSourceMocks.attributesAt.mockResolvedValue({ sesno: 897, exists: true, noun: 'ELBO', attributes: [] });
    await attributesAt!('after', '1_3');
    const [geometryArg, refnoArg] = versionSourceMocks.attributesAt.mock.calls.at(-1)!;
    expect(refnoArg).toBe('1_3');
    expect((geometryArg as { refnos: string[] }).refnos).toEqual(['1_1', '1_3']);

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

  it('旧服务端连 model/versions 都没有（ADR-081 之前的构建）：错误框照实说要新版服务端，不是裸「HTTP 404 Not Found」', async () => {
    // 适配器在 element/versions → model/versions 的回落里两条都撞 404，抛的是 ModelVersionRouteUnavailableError('model/versions')
    versionSourceMocks.listElementVersions.mockRejectedValue(new ModelVersionRouteUnavailableError('model/versions'));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);

    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24384_23262';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    const text = host.querySelector('[data-testid="model-unit-compare-error"]')?.textContent ?? '';
    expect(text).toContain('服务端还没有 model/versions');
    expect(text).toContain('新版服务端');
    expect(text).not.toContain('HTTP 404');
    expect(host.querySelector('[data-testid="model-unit-compare-timeline"]')).toBeNull();
    expect(host.querySelector('[data-testid="model-unit-compare-scope"]')).toBeNull();
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

  it('「三维只看差异」：跟着视口运行态显示，勾选派发 set-diff-only；两版没几何差异时置灰', async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    // 「三维查看」那一节只在「模型对比」tab 里：先查版本表、切 tab
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381_145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();

    const side = (sesno: number) => ({ version: version(sesno, '2026-07-22T01:00:00Z'), sesno, refnos: ['1_1'], entries: new Map() });
    const runtime = (rows: { refno: string; noun: string; status: 'modified' | 'unchanged' }[], diffOnly: boolean) => ({
      detail: { action: 'open', dbnum: 7997, unitRefno: '24381_145018', before: side(791), after: side(897), refnos: ['1_1'], rows },
      status: 'ready',
      activeSide: 'after',
      viewMode: 'single',
      diffOnly,
    });
    const publish = async (state: unknown) => {
      window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare-state', { detail: state }));
      await flushUi();
    };

    await publish(runtime([{ refno: '1_1', noun: 'FTUB', status: 'modified' }], false));
    const checkbox = host.querySelector('[data-testid="model-unit-compare-diff-only"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await flushUi();
    expect(events.at(-1)?.detail).toEqual({ action: 'set-diff-only', diffOnly: true });

    // 开关的真值在视口那边：回传 diffOnly=true 才算勾上
    await publish(runtime([{ refno: '1_1', noun: 'FTUB', status: 'modified' }], true));
    expect((host.querySelector('[data-testid="model-unit-compare-diff-only"]') as HTMLInputElement).checked).toBe(true);

    // 全 unchanged：没有可单看的构件，置灰
    await publish(runtime([{ refno: '1_1', noun: 'FTUB', status: 'unchanged' }], false));
    expect((host.querySelector('[data-testid="model-unit-compare-diff-only"]') as HTMLInputElement).disabled).toBe(true);

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
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
        // 整个单元在 B 已删（单元根自己那行 deleted）/ 在 A 还没建（单元根 added）
        { unitRefno: '24381_200', unitNoun: 'BRAN', unitName: '/B2', counts: { added: 0, deleted: 2, modified: 0, noop: 0 }, geometryChanged: true, rowsTruncated: 0,
          rows: [
            { refno: '24381_200', noun: 'BRAN', status: 'deleted', impact: 'tombstone', isNode: false },
            { refno: '24381_201', noun: 'FTUB', status: 'deleted', impact: 'tombstone', isNode: false },
          ] },
        { unitRefno: '24381_300', unitNoun: 'BRAN', unitName: '/B3', counts: { added: 2, deleted: 0, modified: 0, noop: 0 }, geometryChanged: true, rowsTruncated: 0,
          rows: [
            { refno: '24381_301', noun: 'FTUB', status: 'added', impact: 'delivery', isNode: false },
            { refno: '24381_300', noun: 'BRAN', status: 'added', impact: 'delivery', isNode: false },
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
    // 节点自身 + B1 的 2 行 + B2 的 2 行 + B3 的 2 行
    expect(changed?.querySelectorAll('li')).toHaveLength(7);

    // 模型对比 tab：摘要 + 分组；节点自己没有单元 → 顶部按钮禁用，组里那个可点
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-diff-summary"]')?.textContent).toContain('变了的单元 1');
    expect((host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).disabled).toBe(true);
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_145018"]') as HTMLButtonElement).click();
    await flushUi();

    const loadCalls = () => versionSourceMocks.loadVersion.mock.calls.map(([item]) => [(item as ModelVersion).unitRefno, (item as ModelVersion).sesno, (item as ModelVersion).impactKind]);
    expect(loadCalls()).toEqual([
      ['24381_145018', 791, 'mesh'], ['24381_145018', 897, 'mesh'],
    ]);
    expect(events.at(-1)?.detail).toEqual(expect.objectContaining({ action: 'open', unitRefno: '24381_145018' }));
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('新增 1');

    // 单元在 B 已删：B 侧按 tombstone 装（适配器回空集），不去 history/generate 一个它不存在的会话；卡上注「已删除」
    versionSourceMocks.loadVersion.mockClear();
    versionSourceMocks.loadVersion.mockImplementation(async (item: ModelVersion) => (
      item.impactKind === 'tombstone' ? geometry(new Map()) : geometryBySesno[item.sesno]!()
    ));
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_200"]') as HTMLButtonElement).click();
    await flushUi();
    expect(loadCalls()).toEqual([['24381_200', 791, 'mesh'], ['24381_200', 897, 'tombstone']]);
    const openDeleted = events.at(-1)?.detail as { action: string; unitRefno: string; before: { version: ModelVersion }; after: { version: ModelVersion } };
    expect(openDeleted).toEqual(expect.objectContaining({ action: 'open', unitRefno: '24381_200' }));
    expect([openDeleted.before.version.impactKind, openDeleted.after.version.impactKind]).toEqual(['mesh', 'tombstone']);
    window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare-state', { detail: { detail: openDeleted, status: 'ready', activeSide: 'after', viewMode: 'single' } }));
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-show-after"]')?.textContent).toContain('该版本单元已删除');
    expect(host.querySelector('[data-testid="model-unit-compare-show-before"]')?.textContent).not.toContain('该版本');

    // 单元在 A 还没建：A 侧按 tombstone 装，卡上说「没有这个单元」而不是「已删除」
    versionSourceMocks.loadVersion.mockClear();
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_300"]') as HTMLButtonElement).click();
    await flushUi();
    expect(loadCalls()).toEqual([['24381_300', 791, 'tombstone'], ['24381_300', 897, 'mesh']]);
    const openAdded = events.at(-1)?.detail as typeof openDeleted;
    expect([openAdded.before.version.impactKind, openAdded.after.version.impactKind]).toEqual(['tombstone', 'mesh']);
    window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare-state', { detail: { detail: openAdded, status: 'ready', activeSide: 'after', viewMode: 'single' } }));
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-show-before"]')?.textContent).toContain('该版本没有这个单元');
    expect(host.querySelector('[data-testid="model-unit-compare-show-after"]')?.textContent).not.toContain('该版本');

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

  it('「只看自身变的」：只在所有子节点下露出，勾上后子树动了、自身没动的会话不列，被选为 A / B 的行留着（设计稿 S2，P1-a）', async () => {
    const zone: ModelElementVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, unitColumnOnly: false,
      versions: [{ sesno: 444, sessionTime: '2026-07-20T00:00:00Z', elementImpact: 'delivery', unitImpact: null }],
    };
    const subtree: ModelNodeVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', scope: 'subtree', unitRefno: null, unitNoun: null,
      versions: [
        { sesno: 444, sessionTime: '2026-07-20T00:00:00Z', impact: 'delivery', selfImpact: 'delivery', unitsChanged: 4, unitsTouched: 4 },
        { sesno: 700, sessionTime: '2026-07-21T00:00:00Z', impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 1 },
        { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 1 },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', impact: 'mesh', selfImpact: 'noop', unitsChanged: 2, unitsTouched: 3 },
      ],
    };
    versionSourceMocks.listElementVersions.mockResolvedValue(zone);
    versionSourceMocks.listNodeVersions.mockResolvedValue(subtree);
    versionSourceMocks.diffSummary.mockRejectedValue(new ModelVersionRouteUnavailableError('node/diff-summary'));
    versionSourceMocks.attributeHistory.mockRejectedValue(new ModelVersionRouteUnavailableError('element/attribute-history'));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '1_9';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();

    const rows = () => [...host.querySelectorAll('[data-testid="model-unit-compare-timeline"] li')].map((li) => li.getAttribute('data-sesno'));
    const selfOnly = () => host.querySelector('[data-testid="model-unit-compare-self-only"]') as HTMLInputElement | null;
    // 容器缺省「仅自身」：本来就只列自身变过的，勾选不露出
    expect(selfOnly()).toBeNull();
    expect(rows()).toEqual(['897', '444']);

    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();
    expect(rows()).toEqual(['897', '791', '700', '444']);
    expect(selfOnly()).not.toBeNull();
    expect(selfOnly()!.disabled).toBe(false);
    // A / B 仍是切范围前的 444 → 897；点 791 当 A 再勾「只看自身变的」：700 藏掉，791 因被选中留着
    (host.querySelector('[data-testid="model-unit-compare-pick-a-791"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('791');
    selfOnly()!.click();
    await flushUi();
    expect(rows()).toEqual(['897', '791', '444']);
    // 再叠「只看几何变的」：897 自身 noop 但子树 mesh → 留；结果不变
    (host.querySelector('[data-testid="model-unit-compare-geometry-only"]') as HTMLInputElement).click();
    await flushUi();
    expect(rows()).toEqual(['897', '791', '444']);
    // 切回「仅自身」勾选收起、范围外的 791 灰掉留着
    (host.querySelector('[data-testid="model-unit-compare-scope-self"]') as HTMLButtonElement).click();
    await flushUi();
    expect(selfOnly()).toBeNull();
    expect([...host.querySelectorAll('[data-testid="model-unit-compare-timeline"] li')].map((li) => [li.getAttribute('data-sesno'), li.getAttribute('data-in-scope')])).toEqual([['897', 'true'], ['791', 'false'], ['444', 'true']]);
    app.unmount();
    versionSourceMocks.attributeHistory.mockReset();
  });

  it('属性对比 tab 每行「定位」：派版本对比事件 focus；B 侧已删的行在三维没装 A / B 时置灰，装了以后能定位（设计稿 S3，P1-b）', async () => {
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
    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();

    const locate = (refno: string) => host.querySelector(`[data-testid="model-unit-compare-element-locate-${refno}"]`) as HTMLButtonElement;
    // 每行一颗「定位」；三维里还没装 A / B：新增 / 本节点的可点（回落到环境模型），B 侧已删的置灰
    expect(host.querySelectorAll('[data-testid^="model-unit-compare-element-locate-"]')).toHaveLength(3);
    expect(locate('1_3').disabled).toBe(false);
    expect(locate('1_2').disabled).toBe(true);
    expect(locate('1_2').title).toContain('先「在三维中对比」');
    locate('1_3').click();
    expect(events.at(-1)?.detail).toEqual({ action: 'focus', refno: '1_3' });
    // 点「定位」不展开那一行
    expect(host.querySelector('[data-testid="model-unit-compare-element-diff-1_3"]')).toBeNull();

    // 装上 A / B（模型对比 tab 里那组「在三维中对比」）以后，被删的构件在 A 层找得到 → 可点
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_145018"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-attributes"]') as HTMLButtonElement).click();
    await flushUi();
    expect(locate('1_2').disabled).toBe(false);
    locate('1_2').click();
    expect(events.at(-1)?.detail).toEqual({ action: 'focus', refno: '1_2' });

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });

  it('时间线缺省只画最近 20 行 + 「加载更早 n 版…」；点开全列；「本范围 n 版」仍按全表；换节点重载折回去（设计稿 S1，P1-c）', async () => {
    // 25 版的单元根：sesno 10, 20, …, 250
    const many = Array.from({ length: 25 }, (_, i) => version((i + 1) * 10, `2026-07-${String(1 + Math.floor(i / 2)).padStart(2, '0')}T0${i % 2}:00:00Z`));
    versionSourceMocks.listVersions.mockResolvedValue(many);
    versionSourceMocks.listElementVersions.mockResolvedValue({
      ...unitTimeline,
      versions: many.map((item) => ({ sesno: item.sesno, sessionTime: item.sessionTime, elementImpact: 'mesh', unitImpact: 'mesh' })),
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const load = async (refno: string) => {
      const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
      input.value = refno;
      input.dispatchEvent(new Event('input'));
      (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
      await flushUi();
    };
    const rows = () => [...host.querySelectorAll('[data-testid="model-unit-compare-timeline"] > li')].map((li) => Number(li.getAttribute('data-sesno')));
    const more = () => host.querySelector('[data-testid="model-unit-compare-timeline-more"]') as HTMLButtonElement | null;

    await load('24381/145018');
    // 计数按全表；画出来的只有最近 20 行（最新在前），底下一行「加载更早 5 版…」
    expect(host.querySelector('[data-testid="model-unit-compare-timeline-head"]')?.textContent).toContain('本范围 25 版');
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toBe(250);
    expect(rows().at(-1)).toBe(60);
    expect(more()).not.toBeNull();
    expect(more()!.getAttribute('data-hidden')).toBe('5');
    expect(more()!.textContent).toContain('加载更早 5 版');
    // 缺省 A / B = 最近两版，就在画出来的那段里
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('240');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('250');

    // 点开：全列、那一行消失；不再请求服务端（版本表早已取回）
    const listCalls = versionSourceMocks.listVersions.mock.calls.length;
    more()!.click();
    await flushUi();
    expect(rows()).toHaveLength(25);
    expect(rows().at(-1)).toBe(10);
    expect(more()).toBeNull();
    expect(versionSourceMocks.listVersions.mock.calls.length).toBe(listCalls);

    // 换个节点重载：折回缺省 20 行
    await load('24381_145018');
    expect(rows()).toHaveLength(20);
    expect(more()!.getAttribute('data-hidden')).toBe('5');
    app.unmount();
  });

  it('容器 + URL compare_a/b：那对套到时间线上（本范围没有、子树有就切「所有子节点」）、落到模型对比 tab，不跑对比；不在时间线里则提示（P3-a）', async () => {
    const zone: ModelElementVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, unitColumnOnly: false,
      versions: [
        { sesno: 444, sessionTime: '2026-07-20T00:00:00Z', elementImpact: 'delivery', unitImpact: null },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', elementImpact: 'noop', unitImpact: null },
      ],
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
    versionSourceMocks.attributeHistory.mockRejectedValue(new ModelVersionRouteUnavailableError('element/attribute-history'));
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:model-unit-version-compare', listener);
    const originalUrl = window.location.href;

    // 791 只在子树时间线里（自身没动）：缺省「仅自身」套不上 → 自动切「所有子节点」，A=791 B=897，落到模型对比 tab，不去 loadVersion / 派 open
    window.history.replaceState({}, '', '/?unit_refno=1_9&compare_a=897&compare_b=791&compare_autorun=1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    await flushUi();
    await flushUi();
    expect((host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('791');
    expect(host.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');
    expect((host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect(versionSourceMocks.loadVersion).not.toHaveBeenCalled();
    expect(events.some((event) => event.detail?.action === 'open')).toBe(false);
    expect(host.querySelector('[data-testid="model-unit-compare-error"]')).toBeNull();
    app.unmount();

    // 那对哪个范围都没有（5 不在链上）：提示原文含 compare_a=5，范围与缺省 A / B 不动（仅自身 444 → 897）
    window.history.replaceState({}, '', '/?unit_refno=1_9&compare_a=5&compare_b=897&compare_autorun=1');
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const app2 = createApp(ModelUnitVersionComparePanel);
    app2.mount(host2);
    await flushUi();
    await flushUi();
    expect((host2.querySelector('[data-testid="model-unit-compare-scope-self"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect(host2.querySelector('[data-testid="model-unit-compare-a"]')?.getAttribute('data-sesno')).toBe('444');
    expect(host2.querySelector('[data-testid="model-unit-compare-b"]')?.getAttribute('data-sesno')).toBe('897');
    expect(host2.querySelector('[data-testid="model-unit-compare-error"]')?.textContent).toContain('compare_a=5');
    expect(versionSourceMocks.loadVersion).not.toHaveBeenCalled();
    app2.unmount();

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    window.history.replaceState({}, '', originalUrl);
    versionSourceMocks.attributeHistory.mockReset();
  });

  it('换组 / 换版本重开时 open 事件带上一轮的 viewMode（分屏不用每组再点一次）；没有就位的运行态就不带（P3-b）', async () => {
    const zone: ModelElementVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, unitColumnOnly: false,
      versions: [
        { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', elementImpact: 'delivery', unitImpact: null },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', elementImpact: 'noop', unitImpact: null },
      ],
    };
    versionSourceMocks.listElementVersions.mockResolvedValue(zone);
    const group = (unitRefno: string) => ({
      unitRefno, unitNoun: 'BRAN', unitName: `/${unitRefno}`, counts: { added: 1, deleted: 0, modified: 0, noop: 0 }, geometryChanged: true, rowsTruncated: 0,
      rows: [{ refno: `${unitRefno}_1`, noun: 'ELBO', status: 'added', impact: 'delivery', isNode: false }],
    });
    versionSourceMocks.diffSummary.mockResolvedValue({
      dbnum: 7997, refno: '1_9', noun: 'ZONE', scope: 'subtree', a: 791, b: 897,
      units: { changed: 3, unchanged: 0, total: 3, complete: true },
      elements: { added: 3, deleted: 0, modified: 0, noop: 0 },
      groups: [group('24381_145018'), group('24381_200'), group('24381_300')],
      needsConfirm: false, estimatedProjections: 6, confirmThresholdUnits: 20, warnings: [],
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
    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    const lastOpen = () => events.filter((event) => event.detail?.action === 'open').at(-1)?.detail as { unitRefno: string; viewMode?: string };
    const ready = (detail: unknown, viewMode: 'single' | 'split') => {
      window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare-state', { detail: { detail, status: 'ready', activeSide: 'after', viewMode } }));
    };

    // 第一组：之前没有运行态 → open 不带 viewMode（视口按缺省单视口）
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_145018"]') as HTMLButtonElement).click();
    await flushUi();
    expect(lastOpen()).toEqual(expect.objectContaining({ unitRefno: '24381_145018' }));
    expect(lastOpen().viewMode).toBeUndefined();

    // 视口就位并被切成分屏；换到第二组 → open 带 viewMode: 'split'
    ready(lastOpen(), 'split');
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_200"]') as HTMLButtonElement).click();
    await flushUi();
    expect(lastOpen()).toEqual(expect.objectContaining({ unitRefno: '24381_200', viewMode: 'split' }));

    // 视口回到单视口后换第三组 → 带 'single'（ViewerPanel 对缺省值不做事）
    ready(lastOpen(), 'single');
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_300"]') as HTMLButtonElement).click();
    await flushUi();
    expect(lastOpen()).toEqual(expect.objectContaining({ unitRefno: '24381_300', viewMode: 'single' }));

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
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

  /** 容器 1_9 + 三组变了的单元（B1 两侧都在 / B2 在 B 已删 / B3 在 A 还没建）的差异摘要夹具；`extraGroups` 追加更多组（P2-b 超上限用） */
  function containerSummaryFixture(extraGroups = 0, needsConfirm = false) {
    const zone: ModelElementVersionTimeline = {
      dbnum: 7997, refno: '1_9', noun: 'ZONE', unitRefno: null, unitNoun: null, unitColumnOnly: false,
      versions: [
        { sesno: 791, sessionTime: '2026-07-22T01:00:00Z', elementImpact: 'delivery', unitImpact: null },
        { sesno: 897, sessionTime: '2026-07-22T02:00:00Z', elementImpact: 'noop', unitImpact: null },
      ],
    };
    versionSourceMocks.listElementVersions.mockResolvedValue(zone);
    const group = (unitRefno: string, name: string, counts: { added: number; deleted: number; modified: number; noop: number }, rows: { refno: string; noun: string; status: 'added' | 'deleted' | 'modified' | 'noop' }[]) => ({
      unitRefno, unitNoun: 'BRAN', unitName: name, counts, geometryChanged: true, rowsTruncated: 0,
      rows: rows.map((row) => ({ ...row, impact: row.status === 'deleted' ? 'tombstone' : 'delivery', isNode: false })),
    });
    const groups = [
      group('24381_145018', '/B1', { added: 1, deleted: 1, modified: 0, noop: 0 }, [{ refno: '1_3', noun: 'ELBO', status: 'added' }, { refno: '1_2', noun: 'VALV', status: 'deleted' }]),
      group('24381_200', '/B2', { added: 0, deleted: 2, modified: 0, noop: 0 }, [{ refno: '24381_200', noun: 'BRAN', status: 'deleted' }, { refno: '24381_201', noun: 'FTUB', status: 'deleted' }]),
      group('24381_300', '/B3', { added: 2, deleted: 0, modified: 0, noop: 0 }, [{ refno: '24381_301', noun: 'FTUB', status: 'added' }, { refno: '24381_300', noun: 'BRAN', status: 'added' }]),
      // 追加的组：变更数递增（第 i 组 modified = i），排「变化最大」时最后几组最大
      ...Array.from({ length: extraGroups }, (_, i) => group(`24381_${400 + i}`, `/X${i}`, { added: 0, deleted: 0, modified: i + 1, noop: 0 }, [{ refno: `24381_${400 + i}`, noun: 'BRAN', status: 'modified' }])),
    ];
    versionSourceMocks.diffSummary.mockResolvedValue({
      dbnum: 7997, refno: '1_9', noun: 'ZONE', scope: 'subtree', a: 791, b: 897,
      units: { changed: groups.length, unchanged: 3, total: groups.length + 3, complete: true },
      elements: { added: 3, deleted: 3, modified: 0, noop: 0 },
      groups: [
        { unitRefno: null, unitNoun: null, unitName: null, counts: { added: 0, deleted: 0, modified: 0, noop: 1 }, geometryChanged: false, rowsTruncated: 0,
          rows: [{ refno: '1_9', noun: 'ZONE', status: 'noop', impact: 'noop', isNode: true }] },
        ...groups,
      ],
      needsConfirm, estimatedProjections: groups.length * 2, confirmThresholdUnits: 20, warnings: [],
    });
    // 每个单元自己的几何：refno 带单元前缀，791 → 897 各有一处变化；tombstone 侧空集
    versionSourceMocks.loadVersion.mockImplementation(async (item: ModelVersion) => {
      if (item.impactKind === 'tombstone') return geometry(new Map());
      const entry = (hash: string) => [{ geo_hash: hash, geo_index: 0, matrix: [1], uniforms: { noun: 'FTUB' } }];
      return geometry(new Map([
        [`${item.unitRefno}`, entry('root')],
        [`${item.unitRefno}_m1`, entry(item.sesno === 791 ? 'old' : 'new')],
      ]));
    });
    return { groups };
  }

  async function mountContainerModelTab(): Promise<{ host: HTMLDivElement; app: ReturnType<typeof createApp>; events: CustomEvent[]; listener: (event: Event) => void }> {
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
    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    return { host, app, events, listener };
  }

  it('多单元一次装载（P2-a）：总按钮把变了的单元一起进三维——按份并发 ≤ 2 取几何、进度「n / m」、一发 open 带 units、两侧并起来、A / B 卡列出不存在的单元', async () => {
    containerSummaryFixture();
    // 卡住 loadVersion 好看进度：每次调用登记一个待决 promise，测试里逐个放行
    const pending: { item: ModelVersion; resolve: (geometry: ModelVersionGeometry) => void }[] = [];
    const realLoad = versionSourceMocks.loadVersion.getMockImplementation()!;
    versionSourceMocks.loadVersion.mockImplementation((item: ModelVersion) => new Promise<ModelVersionGeometry>((resolve) => { pending.push({ item, resolve }); }));
    const release = async (count: number) => {
      for (let i = 0; i < count; i += 1) {
        const next = pending.shift()!;
        next.resolve(await realLoad(next.item));
      }
      await flushUi();
    };
    const { host, app, events, listener } = await mountContainerModelTab();

    // 三组（> 1）才有总按钮；文案带单元数与份数（B1 两侧 2 份 + B2 A 侧 1 份 + B3 B 侧 1 份 = 4）
    const runAll = host.querySelector('[data-testid="model-unit-compare-run-groups"]') as HTMLButtonElement;
    expect(runAll).not.toBeNull();
    expect(runAll.parentElement?.textContent).toContain('3 个单元 · 约 4 份历史投影');
    expect(host.querySelector('[data-testid="model-unit-compare-confirm"]')).toBeNull();
    runAll.click();
    await flushUi();

    // 并发 ≤ 2：先只飞两份（B1@791、B1@897）；进度卡 0 / 4，正在装的两份都列着；总按钮与逐组按钮都置灰
    expect(pending.map((p) => [p.item.unitRefno, p.item.sesno, p.item.impactKind])).toEqual([['24381_145018', 791, 'mesh'], ['24381_145018', 897, 'mesh']]);
    const progress = () => host.querySelector('[data-testid="model-unit-compare-progress"]');
    expect(progress()?.getAttribute('data-done')).toBe('0');
    expect(progress()?.getAttribute('data-total')).toBe('4');
    expect(progress()?.textContent).toContain('正在生成历史投影 0 / 4');
    expect(progress()?.textContent).toContain('BRAN 24381_145018@791');
    expect(runAll.disabled).toBe(true);
    expect((host.querySelector('[data-testid="model-unit-compare-run-group-24381_200"]') as HTMLButtonElement).disabled).toBe(true);

    // 放行两份 → 2 / 4，接着飞 B2 的两份（B 侧 tombstone 不算份、适配器回空集）
    await release(2);
    expect(progress()?.getAttribute('data-done')).toBe('2');
    expect(pending.map((p) => [p.item.unitRefno, p.item.sesno, p.item.impactKind])).toEqual([['24381_200', 791, 'mesh'], ['24381_200', 897, 'tombstone']]);
    await release(2);
    expect(progress()?.getAttribute('data-done')).toBe('3');
    expect(pending.map((p) => [p.item.unitRefno, p.item.sesno, p.item.impactKind])).toEqual([['24381_300', 791, 'tombstone'], ['24381_300', 897, 'mesh']]);
    await release(2);

    // 全部装完：进度卡收掉，一发 open——unitRefno 是容器、units 三个、两侧并起来（B 侧 B2 没有、A 侧 B3 没有）、rows 是三组拼起来的
    expect(progress()).toBeNull();
    const open = events.filter((event) => event.detail?.action === 'open');
    expect(open).toHaveLength(1);
    const detail = open[0]!.detail as { unitRefno: string; units: { unitRefno: string; before: { version: ModelVersion }; after: { version: ModelVersion; refnos: string[] }; rows: { refno: string; status: string }[] }[]; before: { version: ModelVersion; refnos: string[] }; after: { version: ModelVersion; refnos: string[] }; rows: { refno: string; status: string }[] };
    expect(detail.unitRefno).toBe('1_9');
    expect(detail.units.map((unit) => unit.unitRefno)).toEqual(['24381_145018', '24381_200', '24381_300']);
    expect(detail.before.version).toEqual(expect.objectContaining({ unitRefno: '1_9', unitNoun: 'ZONE', sesno: 791, impactKind: 'mesh' }));
    expect(detail.after.version).toEqual(expect.objectContaining({ unitRefno: '1_9', sesno: 897, impactKind: 'mesh' }));
    expect(detail.before.refnos).toEqual(['24381_145018', '24381_145018_m1', '24381_200', '24381_200_m1']);
    expect(detail.after.refnos).toEqual(['24381_145018', '24381_145018_m1', '24381_300', '24381_300_m1']);
    expect(detail.units[1]!.after.version.impactKind).toBe('tombstone');
    expect(detail.units[2]!.before.version.impactKind).toBe('tombstone');
    // 每单元各比一份：B1 改 1 未变 1、B2 删 2、B3 增 2 → 拼起来
    expect(detail.rows.map((row) => `${row.refno}:${row.status}`)).toEqual([
      '24381_145018_m1:modified', '24381_145018:unchanged',
      '24381_200:deleted', '24381_200_m1:deleted',
      '24381_300:added', '24381_300_m1:added',
    ]);
    expect(detail.units[0]!.rows).toHaveLength(2);
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('新增 2');
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('删除 2');
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('修改 1');
    expect(host.querySelector('[data-testid="model-unit-compare-summary-title"]')?.textContent).toContain('3 个单元 · 几何差异');
    // 三组都标「三维中」，总按钮也是
    expect(host.querySelector('[data-testid="model-unit-compare-run-group-24381_200"]')?.textContent).toContain('三维中');
    expect(runAll.textContent).toContain('三维中');

    // 视口就位：运行态卡说「3 个单元 · 1_9 下」，A 卡列 B3（A 时没建）、B 卡列 B2（B 时已删）
    window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare-state', { detail: { detail, status: 'ready', activeSide: 'after', viewMode: 'single' } }));
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-runtime-title"]')?.textContent).toContain('3 个单元 · 1_9 下');
    expect(host.querySelector('[data-testid="model-unit-compare-absent-before"]')?.textContent).toContain('1 个单元该版本没有这个单元：24381_300');
    expect(host.querySelector('[data-testid="model-unit-compare-absent-after"]')?.textContent).toContain('1 个单元该版本单元已删除：24381_200');

    // 再点某一组 → 只看这组（单单元 detail 不带 units），其余组不再标「三维中」
    (host.querySelector('[data-testid="model-unit-compare-run-group-24381_145018"]') as HTMLButtonElement).click();
    await flushUi();
    await release(2);
    const single = events.filter((event) => event.detail?.action === 'open').at(-1)!.detail as { unitRefno: string; units?: unknown };
    expect(single.unitRefno).toBe('24381_145018');
    expect(single.units).toBeUndefined();
    expect(host.querySelector('[data-testid="model-unit-compare-run-group-24381_200"]')?.textContent).toContain('在三维中对比');

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });

  it('分屏描边合成器（P3-c）：视口说这台是软渲染、分屏走直接 render 时，分屏摘要下照实说；真显卡 / 没说不露', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    const input = host.querySelector('[data-testid="model-unit-compare-refno"]') as HTMLInputElement;
    input.value = '24381/145018';
    input.dispatchEvent(new Event('input'));
    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-tab-model"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();
    const detail = { unitRefno: '24381_145018', dbnum: 7997, before: { sesno: 791, version: version(791, '2026-07-22T01:00:00Z') }, after: { sesno: 897, version: version(897, '2026-07-22T02:00:00Z') }, rows: [] };
    const state = (extra: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('plant3d:model-unit-version-compare-state', { detail: { detail, status: 'ready', activeSide: 'after', viewMode: 'split', ...extra } }));
    const note = () => host.querySelector('[data-testid="model-unit-compare-split-direct-render"]');

    state({ splitOutline: { compositor: false, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' } });
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-split-summary"]')).not.toBeNull();
    expect(note()?.textContent).toContain('软渲染');
    expect(note()?.textContent).toContain('SwiftShader');
    expect(note()?.textContent).toContain('不走描边合成器');

    state({ splitOutline: { compositor: true, renderer: 'ANGLE (AMD, AMD Radeon RX 590 Series Direct3D11 vs_5_0 ps_5_0, D3D11)' } });
    await flushUi();
    expect(note()).toBeNull();
    // 旧视口（没这一格）/ 单视口：不露
    state({});
    await flushUi();
    expect(note()).toBeNull();
    state({ splitOutline: { compositor: false, renderer: null }, viewMode: 'single' });
    await flushUi();
    expect(note()).toBeNull();
    app.unmount();
  });

  it('阈值确认（P2-b）：超过一次装载上限 20 个 / 服务端 needsConfirm 时先问——取消不装；「先装变化最大的 20 个」按变更数挑；「全部生成」照单全装', async () => {
    // 3 + 19 = 22 组 > 20
    const { groups } = containerSummaryFixture(19);
    const { host, app, events, listener } = await mountContainerModelTab();
    const runAll = host.querySelector('[data-testid="model-unit-compare-run-groups"]') as HTMLButtonElement;
    expect(runAll.parentElement?.textContent).toContain('22 个单元');
    expect(runAll.parentElement?.textContent).toContain('超过一次装载上限 20');
    const confirm = () => host.querySelector('[data-testid="model-unit-compare-confirm"]');

    // 问：三个答案都在；没去取任何几何
    runAll.click();
    await flushUi();
    expect(confirm()?.textContent).toContain('一次要装 22 个单元');
    expect(confirm()?.textContent).toContain('超过一次装载上限 20 个');
    expect(versionSourceMocks.loadVersion).not.toHaveBeenCalled();
    expect(runAll.disabled).toBe(true);
    (host.querySelector('[data-testid="model-unit-compare-confirm-cancel"]') as HTMLButtonElement).click();
    await flushUi();
    expect(confirm()).toBeNull();
    expect(versionSourceMocks.loadVersion).not.toHaveBeenCalled();
    expect(runAll.disabled).toBe(false);

    // 先装变化最大的 20 个：变更数 B1 / B2 / B3 = 2、X_i = i + 1（1..19）→ 从大到小取 20，同分按摘要顺序，掉的是 X1（2，排在 B1–B3 之后）与 X0（1）
    runAll.click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-confirm-top"]') as HTMLButtonElement).click();
    await flushUntil(() => events.some((event) => event.detail?.action === 'open'));
    const detail = events.filter((event) => event.detail?.action === 'open').at(-1)!.detail as { units: { unitRefno: string }[] };
    expect(detail.units).toHaveLength(20);
    const loadedUnits = new Set(detail.units.map((unit) => unit.unitRefno));
    expect(loadedUnits.has('24381_400')).toBe(false);
    expect(loadedUnits.has('24381_401')).toBe(false);
    expect(loadedUnits.has('24381_145018')).toBe(true);
    expect(loadedUnits.has('24381_418')).toBe(true);
    expect(groups.length).toBe(22);

    // 服务端 needsConfirm（不超上限）也问，但没有「先装 20 个」那一颗；全部生成 → 3 组都装
    versionSourceMocks.loadVersion.mockClear();
    containerSummaryFixture(0, true);
    (host.querySelector('[data-testid="model-unit-compare-scope-self"]') as HTMLButtonElement).click();
    await flushUi();
    (host.querySelector('[data-testid="model-unit-compare-scope-subtree"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-needs-confirm"]')).not.toBeNull();
    (host.querySelector('[data-testid="model-unit-compare-run-groups"]') as HTMLButtonElement).click();
    await flushUi();
    expect(confirm()?.textContent).toContain('服务端提示超过阈值 20 个');
    expect(host.querySelector('[data-testid="model-unit-compare-confirm-top"]')).toBeNull();
    const opensBefore = events.filter((event) => event.detail?.action === 'open').length;
    (host.querySelector('[data-testid="model-unit-compare-confirm-all"]') as HTMLButtonElement).click();
    await flushUntil(() => events.filter((event) => event.detail?.action === 'open').length > opensBefore);
    expect(confirm()).toBeNull();
    const all = events.filter((event) => event.detail?.action === 'open').at(-1)!.detail as { units: { unitRefno: string }[] };
    expect(all.units.map((unit) => unit.unitRefno)).toEqual(['24381_145018', '24381_200', '24381_300']);
    expect(versionSourceMocks.loadVersion).toHaveBeenCalledTimes(6);

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });
});
