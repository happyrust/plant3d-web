import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelUnitVersionComparePanel from './ModelUnitVersionComparePanel.vue';

import type { ModelVersion, ModelVersionGeometry } from '@/model-source';

// 面板只经模型来源端口的 `versions` 取数；这里给一份可编程的 ModelVersionSource，不建真适配器
const versionSourceMocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
  loadVersion: vi.fn(),
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
    versionSourceMocks.loadVersion.mockImplementation(async (item: ModelVersion) => geometryBySesno[item.sesno]!());
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
    expect((host.querySelector('[data-testid="model-unit-compare-a"]') as HTMLSelectElement).value).toBe('791');
    expect((host.querySelector('[data-testid="model-unit-compare-b"]') as HTMLSelectElement).value).toBe('897');
    expect((host.querySelector('[data-testid="model-unit-compare-a"]') as HTMLSelectElement).textContent).toContain('2026');

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
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(treeDiffEvents).toHaveLength(1);
    expect(treeDiffEvents[0]?.detail).toEqual({
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
    expect((host.querySelector('[data-testid="model-unit-compare-a"]') as HTMLSelectElement).value).toBe('791');
    expect((host.querySelector('[data-testid="model-unit-compare-b"]') as HTMLSelectElement).value).toBe('897');
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

    expect((host.querySelector('[data-testid="model-unit-compare-a"]') as HTMLSelectElement).value).toBe('791');
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
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-noop"]')?.textContent).toContain('只加载了一次');
    expect(versionSourceMocks.loadVersion).toHaveBeenCalledTimes(1);

    app.unmount();
  });

  it('?model_source=legacy：一进面板就是退役提示，查询不碰库元数据也不碰模型来源（plan §7.3 第 4 条）', async () => {
    const originalUrl = window.location.href;
    window.history.replaceState({}, '', '/?model_source=legacy&unit_refno=24381_145018&compare_autorun=1');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(ModelUnitVersionComparePanel);
    app.mount(host);
    await flushUi();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-error"]')?.textContent).toContain('已退役');
    expect(host.querySelector('[data-testid="model-unit-compare-a"]')).toBeNull();
    expect(versionSourceMocks.listVersions).not.toHaveBeenCalled();

    (host.querySelector('[data-testid="model-unit-compare-load"]') as HTMLButtonElement).click();
    await flushUi();
    expect(host.querySelector('[data-testid="model-unit-compare-error"]')?.textContent).toContain('model_source=legacy');
    expect(versionSourceMocks.listVersions).not.toHaveBeenCalled();

    app.unmount();
    window.history.replaceState({}, '', originalUrl);
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
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-noop"]')?.textContent).toContain('无几何差异');
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
    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    app.unmount();
    resolveGeometry(geometry(new Map()));
    await flushUi();

    expect(events.some((event) => event.detail?.action === 'open')).toBe(false);
    window.removeEventListener('plant3d:model-unit-version-compare', listener);
  });
});
