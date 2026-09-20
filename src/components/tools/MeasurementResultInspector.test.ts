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
      ['Direction', 'N 26.5651 E 41.8103 U'],
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
      // golden G4-02 实测 `S`；Perpendicular 那张表 `.before('WRT')`，没有尾巴。
      ['Direction', 'S'],
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
    // The reference-frame port takes the element placement from gen-model-v1 `element/ptset`
    // (`world_transform`, column-major mm) and the owner / noun hint from the tree node; both are
    // answered locally so nothing goes to the network. An unknown refno is a v1 `not_found` error.
    vi.doMock('@/api/genModelV1Api', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/api/genModelV1Api')>();
      return {
        ...actual,
        genModelV1ElementPtset: vi.fn(async ({ refno }: { refno: string }) => {
          if (refno === '7_8') {
            return {
              refno,
              noun: 'EQUI',
              ptset: [],
              world_transform: [
                0, 1, 0, 0,
                -1, 0, 0, 0,
                0, 0, 1, 0,
                10000, 20000, 30000, 1,
              ],
              source: 'e3d-model',
            };
          }
          throw new actual.GenModelV1ApiError({
            code: 'not_found',
            status: 404,
            path: '/api/v1/element/ptset',
            message: 'element not found',
            detail: null,
          });
        }),
      };
    });
    vi.doMock('@/model-source', async (importOriginal) => ({
      ...await importOriginal<typeof import('@/model-source')>(),
      getModelSource: () => ({
        tree: {
          node: async (refno: string) => ({
            success: true,
            node: { refno, name: 'EQUI', noun: 'EQUI', owner: '7_1' },
          }),
        },
      }),
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

  it('angle mode: exposes the Angle 3 Points / Angle 2 Lines switch and renders a two-line record from its lineAngle', async () => {
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
    store.setToolMode('xeokit_measure_angle');
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(MeasurementResultInspector, {});
    app.mount(host);
    await nextTick();

    // E3D 功能区两个按钮 → Web 一个下拉；缺省三点。
    const variant = host.querySelector<HTMLSelectElement>('[data-testid="measurement-angle-variant"]')!;
    expect(variant.value).toBe('three-point');
    expect(Array.from(variant.options).map((option) => option.textContent?.trim())).toEqual(['Angle 3 Points', 'Angle 2 Lines']);
    variant.value = 'two-line';
    variant.dispatchEvent(new Event('change'));
    await nextTick();
    expect(style.state.angleMeasureVariant).toBe('two-line');
    expect(host.textContent).toContain('先拾一条线，再拾一条线或一个面');

    // gmfArc.radius2Lines：弧心 (10,10,15)，E 臂 × 60° 臂，两臂端点在弧半径 1 m 处。
    store.addXeokitAngleMeasurement({
      id: 'la-1',
      kind: 'angle',
      corner: { entityId: 'edge-1', worldPos: [10, 10, 15], designWorldPos: [10, 10, 15] },
      origin: { entityId: 'edge-1', worldPos: [11, 10, 15], designWorldPos: [11, 10, 15] },
      target: { entityId: 'edge-2', worldPos: [10.5, 10 + Math.sqrt(3) / 2, 15], designWorldPos: [10.5, 10 + Math.sqrt(3) / 2, 15] },
      visible: true,
      approximate: false,
      createdAt: 1,
      lineAngle: {
        kind: 'line-line',
        angleDeg: 60,
        direction1: [1, 0, 0],
        direction2: [0.5, Math.sqrt(3) / 2, 0],
        skew: true,
        inPlane: false,
        firstLabel: 'Graphics 边 · BOX 24381/1',
        secondLabel: 'Graphics 边 · BOX 24381/2',
      },
    });
    await nextTick();

    const rows = Array.from(host.querySelectorAll('[data-testid^="measurement-result-row-"]'));
    // 经 store 落库的记录没有 provenance → legacy-unknown → 角度值后面带「近似」角标（既有行为，与本条无关）。
    expect(rows.map(row => [
      row.querySelector('dt')?.textContent?.trim(),
      row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').replace(/\s*近似$/, '').trim(),
    ])).toEqual([
      ['Decimal Angle', '60 Degrees'],
      ['DMS', '60° 0\' 0\'\''],
      ['Direction1', 'E'],
      ['Direction2', 'N 30.00 E'],
    ]);
    const info = host.querySelector('[data-testid="measurement-angle-line-info"]')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(info).toBe('线 × 线 · Graphics 边 · BOX 24381/1 × Graphics 边 · BOX 24381/2 · 异面：弧心取第一条线上离第二条最近的点');
    expect(host.querySelector('[data-testid="measurement-angle-points"]')).toBeNull();

    app.unmount();
    host.remove();
  });

  it('distance mode: exposes the Point to Point / Shortest switch and shows where a shortest record’s two witnesses come from', async () => {
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
    const style = useXeokitMeasurementStyleStore();
    style.resetStyle();
    // LOOP3 那对相距 8 mm 的平行边（golden MD §33 里点点两击是 593 mm）：最短距离的两端是 witness。
    store.setMeasurementDraftResult({
      id: 'shortest-1',
      kind: 'distance',
      origin: { entityId: 'edge-1', worldPos: [10, 10, 15], designWorldPos: [10, 10, 15] },
      target: { entityId: 'edge-2', worldPos: [10, 10, 14.992], designWorldPos: [10, 10, 14.992] },
      distance: 0.008,
      offsets: { frame: 'world', components: [0, 0, -0.008] },
      direction: { vector: [0, 0, -1] },
      wrt: 'world',
      approximate: false,
      createdAt: 1,
      persistedMeasurementId: null,
      shortest: {
        kind: 'line-line',
        firstLabel: 'Graphics 边 · SCTN 24381/177330（线）',
        secondLabel: 'Graphics 边 · PANE 24381/177335（线）',
        parallel: true,
        skew: false,
      },
    });

    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(MeasurementResultInspector, {});
    app.mount(host);
    await nextTick();

    // 结果表照旧是那五行——Shortest 只换两端怎么来的，不换表。
    const rows = Array.from(host.querySelectorAll('[data-testid^="measurement-result-row-"]'));
    expect(rows.map(row => [
      row.querySelector('dt')?.textContent?.trim(),
      row.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim(),
    ])).toEqual([
      ['Distance', '8mm'],
      ['Offset X', '0mm'],
      ['Offset Y', '0mm'],
      ['Offset Z', '-8mm'],
      ['Direction', 'D'],
    ]);
    const info = host.querySelector('[data-testid="measurement-shortest-info"]')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(info).toBe(
      '最短距离 · 线 × 线 · Graphics 边 · SCTN 24381/177330（线） × Graphics 边 · PANE 24381/177335（线） · 平行：起点取第一项上的拾中处',
    );

    const variant = host.querySelector<HTMLSelectElement>('[data-testid="measurement-distance-variant"]')!;
    expect(variant.value).toBe('point-to-point');
    expect(Array.from(variant.options).map((option) => option.textContent?.trim()))
      .toEqual(['Point to Point', 'Shortest（Web 增强）']);
    const perpendicular = host.querySelector<HTMLInputElement>(
      '[data-testid="measurement-result-perpendicular-toggle"]',
    )!;
    expect(perpendicular.disabled).toBe(false);

    variant.value = 'shortest';
    variant.dispatchEvent(new Event('change'));
    await nextTick();
    expect(style.state.distanceMeasureVariant).toBe('shortest');
    // Shortest 下两击拾的是几何项，Perpendicular to 那一档无从谈起。
    expect(perpendicular.disabled).toBe(true);

    app.unmount();
    host.remove();
  });
});
