import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelUnitVersionComparePanel from './ModelUnitVersionComparePanel.vue';

import { listModelUnitCommits } from '@/api/modelUnitVersionApi';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';

vi.mock('@/api/modelUnitVersionApi', () => ({ listModelUnitCommits: vi.fn() }));
vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: vi.fn().mockResolvedValue(undefined),
  getDbnumByRefno: vi.fn().mockReturnValue(7997),
}));
vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: vi.fn(),
}));

const versions = [
  {
    manifest_url: '/791/manifest.json',
    commit: { dbnum: 7997, unit_refno: '24381_145018', unit_noun: 'BRAN', sesno: 791, impact_kind: 'mesh', artifact_sesno: 791 },
  },
  {
    manifest_url: '/897/manifest.json',
    commit: { dbnum: 7997, unit_refno: '24381_145018', unit_noun: 'BRAN', sesno: 897, impact_kind: 'mesh', artifact_sesno: 897 },
  },
];

async function flushUi(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('ModelUnitVersionComparePanel', () => {
  beforeEach(() => {
    vi.mocked(listModelUnitCommits).mockResolvedValue(versions as never);
    vi.mocked(useDbnoInstancesParquetLoader).mockReturnValue({
      queryAllRefnosByDbno: vi.fn()
        .mockResolvedValueOnce(['1_1', '1_2'])
        .mockResolvedValueOnce(['1_1', '1_3']),
      queryInstanceEntriesByRefnos: vi.fn()
        .mockResolvedValueOnce(new Map([
          ['1_1', [{ geo_hash: 'same', geo_index: 0, matrix: [1], uniforms: { noun: 'PIPE' } }]],
          ['1_2', [{ geo_hash: 'gone', geo_index: 0, matrix: [1], uniforms: { noun: 'VALV' } }]],
        ]))
        .mockResolvedValueOnce(new Map([
          ['1_1', [{ geo_hash: 'same', geo_index: 0, matrix: [1], uniforms: { noun: 'PIPE' } }]],
          ['1_3', [{ geo_hash: 'added', geo_index: 0, matrix: [1], uniforms: { noun: 'ELBO' } }]],
        ])),
    } as never);
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

    (host.querySelector('[data-testid="model-unit-compare-run"]') as HTMLButtonElement).click();
    await flushUi();

    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('新增 1');
    expect(host.querySelector('[data-testid="model-unit-compare-summary"]')?.textContent).toContain('删除 1');
    expect(events.at(-1)?.detail).toEqual(expect.objectContaining({
      action: 'open',
      dbnum: 7997,
      unitRefno: '24381_145018',
      before: expect.objectContaining({ sesno: 791 }),
      after: expect.objectContaining({ sesno: 897 }),
      refnos: ['1_3', '1_2', '1_1'],
    }));

    window.removeEventListener('plant3d:model-unit-version-compare', listener);
    app.unmount();
  });

  it('两个提交复用同一 artifact 时只读取一次并显示无几何差异', async () => {
    vi.mocked(listModelUnitCommits).mockResolvedValue([
      versions[0],
      { ...versions[1], manifest_url: '/791/manifest.json', commit: { ...versions[1].commit, impact_kind: 'noop', artifact_sesno: 791 } },
    ] as never);
    const queryAllRefnosByDbno = vi.fn().mockResolvedValue(['1_1']);
    const queryInstanceEntriesByRefnos = vi.fn().mockResolvedValue(new Map([
      ['1_1', [{ geo_hash: 'same', geo_index: 0, matrix: [1], uniforms: { noun: 'PIPE' } }]],
    ]));
    vi.mocked(useDbnoInstancesParquetLoader).mockReturnValue({
      queryAllRefnosByDbno,
      queryInstanceEntriesByRefnos,
    } as never);

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

    expect(host.querySelector('[data-testid="model-unit-compare-noop"]')?.textContent).toContain('artifact_sesno 791');
    expect(queryAllRefnosByDbno).toHaveBeenCalledTimes(1);
    expect(queryInstanceEntriesByRefnos).toHaveBeenCalledTimes(1);

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

  it('空 artifact 完成比较后仍显示无几何差异', async () => {
    vi.mocked(useDbnoInstancesParquetLoader).mockReturnValue({
      queryAllRefnosByDbno: vi.fn().mockResolvedValue([]),
      queryInstanceEntriesByRefnos: vi.fn().mockResolvedValue(new Map()),
    } as never);
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
    let resolveRefnos!: (value: string[]) => void;
    const pendingRefnos = new Promise<string[]>((resolve) => {
      resolveRefnos = resolve;
    });
    vi.mocked(useDbnoInstancesParquetLoader).mockReturnValue({
      queryAllRefnosByDbno: vi.fn().mockReturnValue(pendingRefnos),
      queryInstanceEntriesByRefnos: vi.fn().mockResolvedValue(new Map()),
    } as never);
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
    resolveRefnos([]);
    await flushUi();

    expect(events.some((event) => event.detail?.action === 'open')).toBe(false);
    window.removeEventListener('plant3d:model-unit-version-compare', listener);
  });
});
