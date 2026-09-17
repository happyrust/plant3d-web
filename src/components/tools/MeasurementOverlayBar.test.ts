import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, shallowRef } from 'vue';

describe('MeasurementOverlayBar', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    localStorage.clear();
    vi.resetModules();
  });

  it('应显示紧凑单行工具条，并支持打开设置、测量面板与删除当前测量', async () => {
    const selectAnnotation = vi.fn();
    const ensurePanelAndActivate = vi.fn();
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate,
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation,
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [
      { default: MeasurementOverlayBar },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateMeasurementPickSource('ptset', { show: true, snap: true });
    measurementStyle.updateMeasurementPickSource('position', { show: true, snap: true });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: false, snap: false });
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'o:1', worldPos: [0, 0, 0] },
      target: { entityId: 'o:2', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    store.addXeokitAngleMeasurement({
      id: 'x2',
      kind: 'angle',
      origin: { entityId: 'o:1', worldPos: [0, 0, 0] },
      corner: { entityId: 'o:2', worldPos: [1, 0, 0] },
      target: { entityId: 'o:3', worldPos: [1, 1, 0] },
      visible: false,
      approximate: false,
      createdAt: 2,
    });
    store.activeXeokitMeasurementId.value = 'x1';

    const tools = {
      ready: ref(true),
      statusText: ref('距离测量：第一击创建测量，随后 hover 预览'),
      removeMeasurement: vi.fn((id: string) => {
        store.removeXeokitMeasurement(id);
      }),
      deactivate: vi.fn(() => {
        store.setToolMode('none');
      }),
    };

    const app = createApp(MeasurementOverlayBar, { tools });
    app.mount(host);
    await nextTick();

    const bar = host.querySelector('[data-testid="measurement-overlay-bar"]');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute('class')).toContain('flex-nowrap');
    expect(bar?.getAttribute('class')).toContain('h-12');
    expect(bar?.getAttribute('class')).toContain('max-w-[440px]');
    expect(host.querySelector('[data-testid="measurement-overlay-status"]')?.textContent).toContain('距离');
    expect(host.querySelector('[data-testid="measurement-overlay-fly-current"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-overlay-current-visibility"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-overlay-all-visibility"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-overlay-clear-all"]')).toBeNull();

    const settingsTrigger = host.querySelector(
      '[data-testid="measurement-overlay-settings-trigger"]',
    ) as HTMLButtonElement | null;
    expect(settingsTrigger?.getAttribute('aria-expanded')).toBe('false');
    settingsTrigger?.click();
    await nextTick();
    expect(settingsTrigger?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="measurement-overlay-settings-popover"]')).toBeTruthy();

    const exitButton = host.querySelector('[data-testid="measurement-overlay-exit"]') as HTMLButtonElement | null;
    expect(exitButton?.textContent?.trim()).toBe('');
    expect(exitButton?.title).toBe('退出测量');
    expect(host.querySelector('[data-testid="measurement-overlay-source-picker"]')?.textContent).toContain('P-Point');
    expect(host.querySelector('[data-testid="measurement-overlay-source-picker"]')?.textContent).toContain('Item 原点');
    expect(host.querySelector('[data-testid="measurement-overlay-source-picker"]')?.textContent).toContain('模型表面点');

    const pointSetInput = host.querySelector('[data-testid="measurement-overlay-source-ptset"]') as HTMLInputElement | null;
    const centerPointInput = host.querySelector('[data-testid="measurement-overlay-source-position"]') as HTMLInputElement | null;
    const meshInput = host.querySelector('[data-testid="measurement-overlay-source-mesh"]') as HTMLInputElement | null;
    expect(pointSetInput?.checked).toBe(true);
    expect(centerPointInput?.checked).toBe(true);
    expect(meshInput?.checked).toBe(false);

    if (meshInput) {
      meshInput.checked = true;
      meshInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.show).toBe(false);
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(true);

    if (centerPointInput) {
      centerPointInput.checked = false;
      centerPointInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.position.show).toBe(true);
    expect(measurementStyle.state.measurementPickSources.position.snap).toBe(false);

    if (pointSetInput) {
      pointSetInput.checked = false;
      pointSetInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickSources.ptset.show).toBe(true);
    expect(measurementStyle.state.measurementPickSources.ptset.snap).toBe(false);

    (host.querySelector('[data-testid="measurement-overlay-details-toggle"]') as HTMLButtonElement)?.click();
    await nextTick();
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('measurement');

    (host.querySelector('[data-testid="measurement-overlay-delete-current"]') as HTMLButtonElement)?.click();
    await nextTick();
    expect(store.activeXeokitMeasurementId.value).toBeNull();
    expect(store.allXeokitMeasurements.value.map((item: any) => item.id)).toEqual(['x2']);

    app.unmount();
    host.remove();
    host = null;
  });

  it('点击退出按钮后，应退出测量模式并关闭详情抽屉', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');

    const deactivate = vi.fn(() => {
      store.setToolMode('none');
    });

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        removeMeasurement: vi.fn(),
        deactivate,
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="measurement-overlay-exit"]') as HTMLButtonElement | null)?.click();
    await nextTick();

    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(store.toolMode.value).toBe('none');

    app.unmount();
    host.remove();
    host = null;
  });

  it('设置弹层应支持点击外部和 Escape 收起', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));
    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef(null),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.setToolMode('xeokit_measure_distance');
    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('距离测量：捕捉起点'),
        removeMeasurement: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    const trigger = host.querySelector(
      '[data-testid="measurement-overlay-settings-trigger"]',
    ) as HTMLButtonElement | null;
    trigger?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-settings-popover"]')).toBeTruthy();
    expect(document.activeElement).toBe(
      host.querySelector('[data-testid="measurement-overlay-mode-e3d"]'),
    );

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-settings-popover"]')).toBeNull();

    trigger?.click();
    await nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-settings-popover"]')).toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    app.unmount();
    host.remove();
    host = null;
  });

  it('无当前选中测量时，应禁用删除当前按钮', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');
    store.activeXeokitMeasurementId.value = null;

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        removeMeasurement: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    expect((host.querySelector('[data-testid="measurement-overlay-delete-current"]') as HTMLButtonElement | null)?.disabled).toBe(true);

    app.unmount();
    host.remove();
    host = null;
  });

  it('取点模式切换应写入样式 store 并联动表面点捕捉', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [
      { default: MeasurementOverlayBar },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        removeMeasurement: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="measurement-overlay-settings-trigger"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-pick-mode"]')).toBeTruthy();

    (host.querySelector('[data-testid="measurement-overlay-mode-free"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickMode).toBe('free_surface');
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(true);
    expect((host.querySelector('[data-testid="measurement-overlay-source-mesh"]') as HTMLInputElement | null)?.checked).toBe(true);
    expect(host.querySelector('[data-testid="measurement-overlay-free-surface-hint"]')).toBeNull();
    // 切进自由表面顺手把拾取类型设成 Cursor（Any 只在 Cursor 放行表面点，ADR 0060（1 修订））→ 不放行提示不出现。
    expect(measurementStyle.state.measurementPickLayer.pickType).toBe('exact');
    expect(host.querySelector('[data-testid="measurement-overlay-surface-not-admitted-hint"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-overlay-warning-dot"]')).toBeNull();

    // 表面点捕捉开着却把类型改回 Snap：Any × Snap 不放行表面点 → 提示 + 角标，说明该切 Cursor / Screen。
    (host.querySelector('[data-testid="measurement-overlay-pick-type-snap"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    const notAdmitted = host.querySelector('[data-testid="measurement-overlay-surface-not-admitted-hint"]');
    expect(notAdmitted?.textContent).toContain('Any × 类型 Snap 不放行模型表面点');
    expect(notAdmitted?.textContent).toContain('切 Cursor 类型或 Screen 过滤器');
    expect(host.querySelector('[data-testid="measurement-overlay-warning-dot"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-overlay-settings-trigger"]')?.getAttribute('aria-label')).toContain('不放行表面点');
    // Screen 过滤器任何类型都放行表面点 → 提示消失；换回 Any 再点 Cursor 同样消失。
    (host.querySelector('[data-testid="measurement-overlay-pick-filter-screen"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-surface-not-admitted-hint"]')).toBeNull();
    (host.querySelector('[data-testid="measurement-overlay-pick-filter-any"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-surface-not-admitted-hint"]')).toBeTruthy();
    (host.querySelector('[data-testid="measurement-overlay-pick-type-exact"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-surface-not-admitted-hint"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-overlay-warning-dot"]')).toBeNull();

    // 自由表面下关掉表面点捕捉：不静默回落模式，显示提示角标。
    const meshCheckbox = host.querySelector('[data-testid="measurement-overlay-source-mesh"]') as HTMLInputElement | null;
    if (meshCheckbox) {
      meshCheckbox.checked = false;
      meshCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickMode).toBe('free_surface');
    expect(host.querySelector('[data-testid="measurement-overlay-free-surface-hint"]')).toBeTruthy();
    expect(
      host.querySelector('[data-testid="measurement-overlay-settings-trigger"]')
        ?.getAttribute('aria-label'),
    ).toContain('表面点捕捉已关闭');
    expect(
      host.querySelector('[data-testid="measurement-overlay-warning-dot"]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    (host.querySelector('[data-testid="measurement-overlay-mode-e3d"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickMode).toBe('e3d');
    expect(measurementStyle.state.measurementPickSources.mesh_pick_point.snap).toBe(false);
    expect(measurementStyle.state.measurementPickSources.ptset.snap).toBe(true);
    expect(measurementStyle.state.measurementPickSources.position.snap).toBe(true);
    expect(host.querySelector('[data-testid="measurement-overlay-free-surface-hint"]')).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });

  it('E3D 拾取层控件：过滤器 × 拾取类型写入样式 store，取值输入随类型出现，不可用项禁用，Significant snaps 可切', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [
      { default: MeasurementOverlayBar },
      { useToolStore },
      { useXeokitMeasurementStyleStore },
    ] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore() as any;
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    store.clearXeokitMeasurements();
    store.setToolMode('xeokit_measure_distance');

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText: ref('ready'),
        removeMeasurement: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="measurement-overlay-settings-trigger"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-pick-layer"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-overlay-pick-layer-summary"]')?.textContent?.trim()).toBe('Any · Snap');

    // E3D 缺省 Any × Snap；External 灰掉（Aid 自会话辅助系统起可用），7 种拾取类型全部可用。
    const filterButton = (id: string) => host!.querySelector(`[data-testid="measurement-overlay-pick-filter-${id}"]`) as HTMLButtonElement | null;
    const typeButton = (id: string) => host!.querySelector(`[data-testid="measurement-overlay-pick-type-${id}"]`) as HTMLButtonElement | null;
    expect(filterButton('any')?.getAttribute('aria-checked')).toBe('true');
    expect(filterButton('aid')?.disabled).toBe(false);
    expect(filterButton('external')?.disabled).toBe(true);
    expect(filterButton('graphics')?.disabled).toBe(false);
    expect(typeButton('intersect')?.disabled).toBe(false);
    expect(host.querySelector('[data-testid^="measurement-overlay-pick-type-value-"]')).toBeNull();

    filterButton('graphics')?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.filter).toBe('graphics');
    expect(filterButton('graphics')?.getAttribute('aria-checked')).toBe('true');

    typeButton('fraction')?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.pickType).toBe('fraction');
    const fractionInput = host.querySelector('[data-testid="measurement-overlay-pick-type-value-fraction"]') as HTMLInputElement | null;
    expect(fractionInput).toBeTruthy();
    expect(fractionInput?.value).toBe('2');
    if (fractionInput) {
      fractionInput.value = '4';
      fractionInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.values.fraction).toBe(4);
    expect(host.querySelector('[data-testid="measurement-overlay-pick-layer-summary"]')?.textContent?.trim()).toBe('Graphics · Fraction');

    // 提示矩阵 D2 (a)（2026-09-17 实机，golden MD §40）：输入即按 E3D pad 输入框的 dp 0 四舍五入——填 2.5 落库 3、
    // 输入框重显 '3'（E3D 填 2.5 也是提示 Fraction[3] / 输入框 3 / 落三分点），提示 / 回显 / 内核同一个整数。
    if (fractionInput) {
      fractionInput.value = '2.5';
      fractionInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.values.fraction).toBe(3);
    expect(fractionInput?.value).toBe('3');
    // 归一后的值没变（3.4 → 3）时 `:value` 不会重绘，`setPickTypeValue` 自己把落库值写回输入框。
    if (fractionInput) {
      fractionInput.value = '3.4';
      fractionInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.values.fraction).toBe(3);
    expect(fractionInput?.value).toBe('3');

    // 禁用项点击不生效。
    filterButton('external')?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.filter).toBe('graphics');

    const significant = host.querySelector('[data-testid="measurement-overlay-significant-snaps"]') as HTMLInputElement | null;
    expect(significant?.checked).toBe(true);
    if (significant) {
      significant.checked = false;
      significant.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.significantSnaps).toBe(false);

    // E3D Pick Settings · Sections & Walls：Pline End Position（缺省 Uncut）与 Significant Snap Points 三档（缺省全关）。
    expect(host.querySelector('[data-testid="measurement-overlay-pick-settings-sections"]')).toBeTruthy();
    const plineEnd = (id: 'uncut' | 'cut') => host!.querySelector(`[data-testid="measurement-overlay-pline-end-${id}"]`) as HTMLButtonElement | null;
    expect(plineEnd('uncut')?.getAttribute('aria-checked')).toBe('true');
    expect(plineEnd('cut')?.getAttribute('aria-checked')).toBe('false');
    plineEnd('cut')?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.plineCut).toBe(true);
    expect(plineEnd('cut')?.getAttribute('aria-checked')).toBe('true');
    plineEnd('uncut')?.click();
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.plineCut).toBe(false);

    const snapPoint = (id: 'fitting' | 'joint' | 'node') => host!.querySelector(`[data-testid="measurement-overlay-significant-snap-point-${id}"]`) as HTMLInputElement | null;
    expect(snapPoint('fitting')?.checked).toBe(false);
    expect(snapPoint('joint')?.checked).toBe(false);
    expect(snapPoint('node')?.checked).toBe(false);
    if (snapPoint('node')) {
      snapPoint('node')!.checked = true;
      snapPoint('node')!.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(measurementStyle.state.measurementPickLayer.significantSnapPoints).toEqual({ fitting: false, joint: false, node: true });
    if (snapPoint('joint')) {
      snapPoint('joint')!.checked = true;
      snapPoint('joint')!.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    // 按字段合并：勾 Joints 不会把 Nodes 掉回去。
    expect(measurementStyle.state.measurementPickLayer.significantSnapPoints).toEqual({ fitting: false, joint: true, node: true });

    app.unmount();
    host.remove();
    host = null;
  });

  it('连续测量开关仅在距离模式显示，切换后写入 store 状态', async () => {
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate: vi.fn(),
    }));

    vi.doMock('@/composables/useViewerContext', () => ({
      useViewerContext: () => ({
        viewerRef: shallowRef(null),
        overlayContainerRef: shallowRef(null),
        tools: shallowRef(null),
        xeokitMeasurementTools: shallowRef(null),
        store: shallowRef(null),
        viewerError: shallowRef(null),
        ptsetVis: shallowRef(null),
        annotationSystem: shallowRef({
          selectAnnotation: vi.fn(),
          selectedId: ref<string | null>(null),
        }),
      }),
    }));

    const [{ default: MeasurementOverlayBar }, { useToolStore }] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.clearXeokitMeasurements();
    store.continuousDistanceMeasureEnabled.value = false;
    store.setToolMode('xeokit_measure_distance');
    const statusText = ref('距离测量：捕捉起点（E3D）');

    const app = createApp(MeasurementOverlayBar, {
      tools: {
        ready: ref(true),
        statusText,
        removeMeasurement: vi.fn(),
        deactivate: vi.fn(),
      },
    });
    app.mount(host);
    await nextTick();

    (host.querySelector('[data-testid="measurement-overlay-settings-trigger"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    const checkbox = host.querySelector('[data-testid="measurement-overlay-continuous"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    expect(checkbox?.checked).toBe(false);

    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await nextTick();
    expect(store.continuousDistanceMeasureEnabled.value).toBe(true);

    store.setToolMode('xeokit_measure_angle');
    statusText.value = '角度测量：捕捉第一边点（E3D）；点空白取消当前点选';
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-continuous"]')).toBeNull();
    expect(host.querySelector('[data-testid="measurement-overlay-status"]')?.textContent)
      .toContain('捕捉第一边点');

    store.setToolMode('xeokit_measure_elevation_point');
    statusText.value = '位置/标高：捕捉测量点（E3D），单击完成';
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-bar"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-overlay-status"]')?.textContent)
      .toContain('捕捉测量点');

    store.setToolMode('xeokit_measure_elevation_delta');
    statusText.value = '高差测量：捕捉终点（E3D）；点空白取消当前点选';
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-bar"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="measurement-overlay-status"]')?.textContent)
      .toContain('捕捉终点');

    store.setToolMode('none');
    await nextTick();
    expect(host.querySelector('[data-testid="measurement-overlay-bar"]')).toBeNull();

    app.unmount();
    host.remove();
    host = null;
  });

  it('进入测量模式时自动打开测量面板（E3D 窗体随命令打开）', async () => {
    const ensurePanelAndActivate = vi.fn();
    let host: HTMLDivElement | null = document.createElement('div');
    document.body.appendChild(host);

    vi.doMock('@/composables/useDockApi', () => ({
      ensurePanelAndActivate,
    }));

    const [
      { default: MeasurementOverlayBar },
      { useToolStore },
    ] = await Promise.all([
      import('./MeasurementOverlayBar.vue'),
      import('@/composables/useToolStore'),
    ]);

    const store = useToolStore() as any;
    store.setToolMode('none');
    const tools = {
      ready: ref(true),
      statusText: ref('当前非测量模式'),
      removeMeasurement: vi.fn(),
      deactivate: vi.fn(),
    };

    const app = createApp(MeasurementOverlayBar, { tools });
    app.mount(host);
    await nextTick();
    expect(ensurePanelAndActivate).not.toHaveBeenCalled();

    store.setToolMode('xeokit_measure_distance');
    await nextTick();
    expect(ensurePanelAndActivate).toHaveBeenCalledWith('measurement');

    app.unmount();
    host.remove();
    host = null;
  });
});
