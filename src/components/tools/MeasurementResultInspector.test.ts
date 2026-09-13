import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

describe('MeasurementResultInspector', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    localStorage.clear();
    document.body.innerHTML = '';
    vi.resetModules();
  });

  it('renders the five E3D standard distance rows and keeps display separate from retention', async () => {
    const [
      { default: MeasurementResultInspector },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementResultInspector.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setMeasurementDraftResult({
      id: 'result-1',
      kind: 'distance',
      origin: {
        entityId: 'from',
        worldPos: [0, 0, 0],
        designWorldPos: [0, 0, 0],
      },
      target: {
        entityId: 'to',
        worldPos: [1, 2, 2],
        designWorldPos: [1, 2, 2],
      },
      distance: 3,
      offsets: { frame: 'world', components: [1, 2, 2] },
      direction: { vector: [1 / 3, 2 / 3, 2 / 3] },
      wrt: 'world',
      approximate: false,
      createdAt: 1,
      persistedMeasurementId: null,
    });
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();
    const persistDraftResult = vi.fn();

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(MeasurementResultInspector, { persistDraftResult });
    app.mount(host);
    await nextTick();

    const rows = Array.from(host.querySelectorAll('[data-testid^="measurement-result-row-"]'));
    expect(rows.map(row => [
      row.querySelector('dt')?.textContent?.trim(),
      row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim(),
    ])).toEqual([
      ['Distance', '3000mm'],
      ['Offset X', '+1000mm'],
      ['Offset Y', '+2000mm'],
      ['Offset Z', '+2000mm'],
      ['Direction', 'X +0.3333 · Y +0.6667 · Z +0.6667'],
    ]);

    const showDirect = host.querySelector<HTMLInputElement>(
      '[data-testid="measurement-result-show-direct-toggle"]',
    )!;
    showDirect.checked = false;
    showDirect.dispatchEvent(new Event('change'));
    expect(style.state.showDirectLinearDimension).toBe(false);
    expect(style.state.keepMeasurementAnnotation).toBe(true);

    const keep = host.querySelector<HTMLInputElement>(
      '[data-testid="measurement-result-keep-toggle"]',
    )!;
    keep.checked = false;
    keep.dispatchEvent(new Event('change'));
    expect(style.state.keepMeasurementAnnotation).toBe(false);

    host.querySelector<HTMLButtonElement>('[data-testid="measurement-result-persist-now"]')?.click();
    expect(persistDraftResult).toHaveBeenCalledOnce();

    app.unmount();
    host.remove();
  });

  it('renders the E3D perpendicular rows, pins wrt to World and exposes the Perpendicular to toggle', async () => {
    const [
      { default: MeasurementResultInspector },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementResultInspector.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore();
    store.clearAll();
    // golden G4-02 real pick: source E 8000 N 9000 U 16500 → foot on the plane E 8000 N 10500 U 16500.
    store.setMeasurementDraftResult({
      id: 'perp-1',
      kind: 'distance',
      origin: { entityId: 'src', worldPos: [8, 9, 16.5], designWorldPos: [8, 9, 16.5] },
      target: { entityId: 'foot', worldPos: [8, 10.5, 16.5], designWorldPos: [8, 10.5, 16.5] },
      distance: 1.5,
      offsets: { frame: 'world', components: [0, 1.5, 0] },
      direction: { vector: [0, 1, 0] },
      wrt: 'world',
      approximate: false,
      createdAt: 1,
      persistedMeasurementId: null,
      perpendicular: { targetKind: 'plane', targetLabel: 'P-Point #2 圆面' },
    });
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(MeasurementResultInspector, {});
    app.mount(host);
    await nextTick();

    const rows = Array.from(host.querySelectorAll('[data-testid^="measurement-result-row-"]'));
    expect(rows.map(row => [
      row.querySelector('dt')?.textContent?.trim(),
      row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim(),
    ])).toEqual([
      ['Distance', '1500mm'],
      ['Vertical', '0mm'],
      ['Horizontal', '1500mm'],
      ['Direction', 'X +0.0000 · Y -1.0000 · Z +0.0000'],
    ]);
    expect(host.querySelector('[data-testid="measurement-wrt-active"]')?.textContent)
      .toContain('World（垂距模式固定）');
    expect(host.querySelector('[data-testid="measurement-perpendicular-info"]')?.textContent)
      .toContain('点→无限面');
    expect(host.querySelector('[data-testid="measurement-wrt-controls"]')?.getAttribute('aria-disabled'))
      .toBe('true');

    const toggle = host.querySelector<HTMLInputElement>(
      '[data-testid="measurement-result-perpendicular-toggle"]',
    )!;
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(style.state.perpendicularTo).toBe(true);

    app.unmount();
    host.remove();
  });

  it('recomputes rows for an explicit WRT and keeps the last frame after an error', async () => {
    const pdmsGetTransform = vi.fn(async (refno: string) => {
      if (refno === '7_8') {
        return {
          success: true,
          refno,
          owner: '7_1',
          world_transform: [
            0, 1, 0, 0,
            -1, 0, 0, 0,
            0, 0, 1, 0,
            10000, 20000, 30000, 1,
          ],
        };
      }
      return {
        success: false,
        refno,
        owner: null,
        world_transform: null,
        error_message: 'element not found',
      };
    });
    vi.doMock('@/api/genModelPdmsAttrApi', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/api/genModelPdmsAttrApi')>(),
      pdmsGetTransform,
    }));
    const [
      { default: MeasurementResultInspector },
      { useToolStore },
    ] = await Promise.all([
      import('./MeasurementResultInspector.vue'),
      import('@/composables/useToolStore'),
    ]);
    const store = useToolStore();
    store.clearAll();
    const origin = {
      entityId: 'from',
      worldPos: [0, 0, 0] as [number, number, number],
      designWorldPos: [10, 20, 30] as [number, number, number],
    };
    const target = {
      entityId: 'to',
      worldPos: [0, 0, 0] as [number, number, number],
      designWorldPos: [8, 23, 34] as [number, number, number],
    };
    store.setMeasurementDraftResult({
      id: 'result-wrt',
      kind: 'distance',
      origin,
      target,
      distance: Math.hypot(-2, 3, 4),
      offsets: { frame: 'world', components: [-2, 3, 4] },
      direction: null,
      wrt: 'world',
      approximate: false,
      createdAt: 1,
      persistedMeasurementId: null,
    });

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(MeasurementResultInspector);
    app.mount(host);
    await nextTick();

    const mode = host.querySelector<HTMLSelectElement>('[data-testid="measurement-wrt-mode"]')!;
    mode.value = 'explicit-refno';
    mode.dispatchEvent(new Event('change'));
    await nextTick();
    const refno = host.querySelector<HTMLInputElement>('[data-testid="measurement-wrt-refno"]')!;
    refno.value = 'DBREF =7/8';
    refno.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('[data-testid="measurement-wrt-apply"]')!.click();
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="measurement-wrt-active"]')?.textContent)
        .toContain('DBREF 7/8');
    });

    expect(host.querySelector('[data-testid="measurement-result-row-offset-x"]')?.textContent)
      .toContain('Offset U+3000mm');
    expect(host.querySelector('[data-testid="measurement-result-row-offset-y"]')?.textContent)
      .toContain('Offset V+2000mm');
    expect(host.querySelector('[data-testid="measurement-result-row-offset-z"]')?.textContent)
      .toContain('Offset W+4000mm');
    expect(origin.designWorldPos).toEqual([10, 20, 30]);
    expect(target.designWorldPos).toEqual([8, 23, 34]);

    refno.value = '9/9';
    refno.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('[data-testid="measurement-wrt-apply"]')!.click();
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="measurement-wrt-error"]')?.textContent)
        .toContain('REFERENCE_ELEMENT_NOT_FOUND');
    });
    expect(host.querySelector('[data-testid="measurement-wrt-active"]')?.textContent)
      .toContain('DBREF 7/8');
    expect(host.querySelector('[data-testid="measurement-result-row-offset-x"]')?.textContent)
      .toContain('Offset U+3000mm');

    app.unmount();
    host.remove();
  });
});
