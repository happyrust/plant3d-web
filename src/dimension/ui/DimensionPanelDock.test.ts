import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument, linearRecord } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

import { useMbdDiagnosticsStore } from '@/composables/useMbdDiagnosticsStore';

const mocks = vi.hoisted(() => ({
  currentUser: {
    value: { id: 'designer-1', role: 'designer' } as {
      id: string;
      role: string;
    } | null,
  },
  dimensionSystem: { value: null as any },
  emitToast: vi.fn(),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ dimensionSystem: mocks.dimensionSystem }),
}));
vi.mock('@/ribbon/toastBus', () => ({
  emitToast: mocks.emitToast,
}));

const apps: ReturnType<typeof createApp>[] = [];

function mountPanel(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(DimensionPanelDock);
  apps.push(app);
  app.mount(host);
  return host;
}

function createSystem() {
  const state = emptyDimensionDocument([
    linearRecord({ authorId: 'designer-1' }),
  ]);
  const external: ExternalDimensionRecord = {
    id: 'mbd-1',
    source: 'mbd',
    sourceLabel: 'MBD',
    role: 'external-reference',
    layout: {
      id: 'mbd-1',
      kind: 'linear',
      role: 'external-reference',
      labelPinned: false,
      a: [0, 1, 0],
      b: [1, 1, 0],
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    },
  };
  const externalRegistry = new ExternalDimensionRegistry();
  externalRegistry.replaceSource('mbd', [external]);
  const setSelection = vi.fn();
  const layoutListeners = new Set<(layouts: readonly unknown[]) => void>();
  return {
    externalRegistry,
    document: {
      state,
      canUndo: false,
      canRedo: false,
      subscribe(listener: (next: typeof state) => void) {
        listener(state);
        return vi.fn();
      },
    },
    viewport: {
      getSelection: () => null,
      setSelection,
      subscribeSelection: () => vi.fn(),
      getLayouts: () => [] as readonly unknown[],
      subscribeLayouts(listener: (layouts: readonly unknown[]) => void) {
        layoutListeners.add(listener);
        return () => layoutListeners.delete(listener);
      },
    },
    /** Test seam: push a layout batch as the real viewport would after a re-layout. */
    emitLayouts(layouts: readonly unknown[]) {
      layoutListeners.forEach(listener => listener(layouts));
    },
    pointer: { start: vi.fn() },
    snapPort: null,
    getRecoveryPreview: () => null,
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
    setSelection,
  };
}

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
  mocks.emitToast.mockReset();
  useMbdDiagnosticsStore().clear();
});

describe('DimensionPanelDock', () => {
  it('merges external records with the document and keeps hide state visible', async () => {
    const system = createSystem();
    mocks.dimensionSystem.value = system;
    const host = mountPanel();

    expect(host.querySelector('[data-dimension-id="linear-1"]')).not.toBeNull();
    const externalRow = host.querySelector<HTMLElement>(
      '[data-dimension-id="mbd-1"]',
    );
    expect(externalRow?.textContent).toContain('只读');
    externalRow?.click();
    expect(system.viewport.setSelection).toHaveBeenCalledWith('mbd-1');

    const hide = externalRow?.querySelector<HTMLButtonElement>(
      '[data-action="hide-external"]',
    );
    hide?.click();
    await nextTick();

    expect(system.externalRegistry.isHidden('mbd-1')).toBe(true);
    expect(hide?.textContent).toContain('临时显示');
  });

  it('orders annotation records behind dimensions and shows MBD diagnostics', async () => {
    const system = createSystem();
    system.externalRegistry.replaceSource('mbd', [
      {
        id: 'weld-1',
        source: 'mbd',
        sourceLabel: 'MBD: weld-1',
        role: 'external',
        category: 'annotation',
        layout: {
          id: 'weld-1',
          role: 'external',
          labelPinned: true,
          formattedLabel: '',
          lines: [],
          labelAnchor: [0, 0, 0],
          arrowLines: [],
          markers: [{ at: [0, 0, 0], shape: 'circle', radiusPx: 5 }],
        },
      },
      {
        id: 'mbd-1',
        source: 'mbd',
        sourceLabel: 'MBD',
        role: 'external-reference',
        layout: {
          id: 'mbd-1',
          kind: 'linear',
          role: 'external-reference',
          labelPinned: false,
          a: [0, 1, 0],
          b: [1, 1, 0],
          placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
        },
      },
    ]);
    mocks.dimensionSystem.value = system;

    const diagnostics = useMbdDiagnosticsStore();
    diagnostics.set({
      channel: 'api',
      sourceId: '24381/145712',
      issues: [{
        id: 'issue-1',
        severity: 'error',
        category: 'data',
        message: 'missing tubi geometry',
        refno: '24381/145712',
      }],
      skipped: [{ id: 'dup-1', reason: 'Duplicate primitive id within MBD payload' }],
    });

    const host = mountPanel();
    await nextTick();

    const rowIds = [...host.querySelectorAll('[data-dimension-id]')]
      .map(node => node.getAttribute('data-dimension-id'));
    expect(rowIds).toEqual(['linear-1', 'mbd-1', 'weld-1']);

    const panel = host.querySelector('[data-testid="mbd-diagnostics"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('MBD 诊断（2）');
    expect(panel?.textContent).toContain('missing tubi geometry');
    expect(panel?.textContent).toContain('dup-1：Duplicate primitive id within MBD payload');

    const locateEvents: string[][] = [];
    const onLocate = (event: Event) => {
      locateEvents.push(((event as CustomEvent).detail?.refnos ?? []) as string[]);
    };
    window.addEventListener('showModelByRefnos', onLocate);
    try {
      host.querySelector<HTMLButtonElement>(
        '[data-locate-refno="24381/145712"]',
      )?.click();
    } finally {
      window.removeEventListener('showModelByRefnos', onLocate);
    }
    expect(locateEvents).toEqual([['24381/145712']]);
  });

  it('surfaces channel-level load failures instead of hiding them', async () => {
    mocks.dimensionSystem.value = createSystem();
    useMbdDiagnosticsStore().set({
      channel: 'api',
      sourceId: '24381/145712',
      issues: [],
      skipped: [],
      loadError: 'MBD V2 API responded with status 404',
    });

    const host = mountPanel();
    await nextTick();

    const errorLine = host.querySelector('[data-testid="mbd-load-error"]');
    expect(errorLine?.textContent).toContain('装载失败');
    expect(errorLine?.textContent).toContain('404');
  });

  it('warns that a partial solver mode did not deliver every category', async () => {
    mocks.dimensionSystem.value = createSystem();
    useMbdDiagnosticsStore().set({
      channel: 'api',
      sourceId: '24381/145712',
      issues: [],
      skipped: [],
      layoutMode: 'linear_mvp',
      notes: ['isolines=1 ldirs=1 linear_mvp=true'],
    });

    const host = mountPanel();
    await nextTick();

    const banner = host.querySelector('[data-testid="mbd-incomplete-annotation"]');
    expect(banner?.textContent).toContain('本分支标注不完整');
    expect(banner?.textContent).toContain('linear_mvp');
    expect(
      host.querySelector('[data-testid="mbd-layout-mode"]')?.textContent,
    ).toContain('linear_mvp');
  });

  it('turns the mbd_kinds URL filter into checkboxes and writes changes back through popstate', async () => {
    mocks.dimensionSystem.value = createSystem();
    window.history.replaceState({}, '', '/?mbd_refno=A&mbd_kinds=linear_dim');
    useMbdDiagnosticsStore().set({
      channel: 'api',
      sourceId: 'A',
      issues: [],
      skipped: [],
    });
    const popstates: (string | null)[] = [];
    const onPopstate = () => {
      popstates.push(new URLSearchParams(window.location.search).get('mbd_kinds'));
    };
    window.addEventListener('popstate', onPopstate);
    try {
      const host = mountPanel();
      await nextTick();

      const filter = host.querySelector('[data-testid="mbd-kind-filter"]');
      expect(filter).not.toBeNull();
      expect(filter?.textContent).toContain('显示 1 条');
      const linear = host.querySelector<HTMLInputElement>('[data-mbd-kind="linear_dim"]');
      const label = host.querySelector<HTMLInputElement>('[data-mbd-kind="label"]');
      expect(linear?.checked).toBe(true);
      expect(label?.checked).toBe(false);
      // 只剩一个类别时不允许再取消，避免写出空过滤。
      expect(linear?.disabled).toBe(true);

      label!.checked = true;
      label!.dispatchEvent(new Event('change'));
      await nextTick();
      expect(popstates).toEqual(['linear_dim,label']);
      expect(host.querySelector<HTMLInputElement>('[data-mbd-kind="label"]')?.checked).toBe(true);
      expect(host.querySelector<HTMLInputElement>('[data-mbd-kind="linear_dim"]')?.disabled).toBe(false);

      host.querySelector<HTMLButtonElement>('[data-testid="mbd-kind-all"]')!.click();
      await nextTick();
      expect(popstates).toEqual(['linear_dim,label', null]);
      expect(host.querySelector<HTMLInputElement>('[data-mbd-kind="weld_mark"]')?.checked).toBe(true);
      expect(host.querySelector<HTMLButtonElement>('[data-testid="mbd-kind-all"]')?.disabled).toBe(true);

      host.querySelector<HTMLButtonElement>('[data-testid="mbd-kind-only-linear"]')!.click();
      await nextTick();
      expect(popstates.at(-1)).toBe('linear_dim');
      expect(host.querySelector<HTMLInputElement>('[data-mbd-kind="weld_mark"]')?.checked).toBe(false);
    } finally {
      window.removeEventListener('popstate', onPopstate);
      window.history.replaceState({}, '', '/');
    }
  });

  it('reports LOD-hidden MBD dimensions per reason and toggles LOD through the URL', async () => {
    const system = createSystem();
    system.externalRegistry.replaceSource('mbd', ['a', 'b', 'c', 'd'].map(suffix => ({
      id: `mbd-${suffix}`,
      source: 'mbd' as const,
      sourceLabel: 'MBD',
      role: 'external' as const,
      layout: {
        id: `mbd-${suffix}`,
        role: 'external' as const,
        labelPinned: true,
        formattedLabel: '100',
        lines: [],
        labelAnchor: [0, 0, 0] as const,
        arrowLines: [],
      },
    })));
    mocks.dimensionSystem.value = system;
    window.history.replaceState({}, '', '/?mbd_refno=A');
    useMbdDiagnosticsStore().set({
      channel: 'api',
      sourceId: 'A',
      issues: [],
      skipped: [],
    });
    const popstates: (string | null)[] = [];
    const onPopstate = () => {
      popstates.push(new URLSearchParams(window.location.search).get('mbd_lod'));
    };
    window.addEventListener('popstate', onPopstate);
    try {
      const host = mountPanel();
      await nextTick();
      const summary = () => host.querySelector('[data-testid="mbd-lod-hidden"]')?.textContent?.replace(/\s+/g, ' ').trim();
      expect(summary()).toBe('LOD 隐藏 0 条（atta 远景 0 / 短段 0）');

      const layout = (id: string, lodHidden?: string) => ({
        dimensionId: id,
        scenePrimitives: [],
        primitives: [],
        hitRegions: [],
        labelBounds: { x: 0, y: 0, width: 0, height: 0 },
        labelPinned: true,
        derived: { formattedLabel: '100', ...(lodHidden ? { lodHidden } : {}) },
      });
      system.emitLayouts([
        layout('mbd-a', 'secondary-far'),
        layout('mbd-b', 'secondary-far'),
        layout('mbd-c', 'short-line'),
        layout('mbd-d'),
        // A user dimension elided for whatever reason is not an MBD count.
        layout('linear-1', 'short-line'),
      ]);
      await nextTick();
      expect(summary()).toBe('LOD 隐藏 3 条（atta 远景 2 / 短段 1）');

      const toggle = host.querySelector<HTMLInputElement>('[data-testid="mbd-lod-enabled"]')!;
      expect(toggle.checked).toBe(true);
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
      await nextTick();
      expect(popstates).toEqual(['0']);
      expect(summary()).toBe('已关闭，每条尺寸照常出图');
      expect(host.querySelector<HTMLInputElement>('[data-testid="mbd-lod-enabled"]')?.checked).toBe(false);

      const again = host.querySelector<HTMLInputElement>('[data-testid="mbd-lod-enabled"]')!;
      again.checked = true;
      again.dispatchEvent(new Event('change'));
      await nextTick();
      expect(popstates).toEqual(['0', null]);
      expect(summary()).toBe('LOD 隐藏 3 条（atta 远景 2 / 短段 1）');
    } finally {
      window.removeEventListener('popstate', onPopstate);
      window.history.replaceState({}, '', '/');
    }
  });

  it('hides the kind filter until an MBD channel has been synced', async () => {
    mocks.dimensionSystem.value = createSystem();
    const host = mountPanel();
    await nextTick();
    expect(host.querySelector('[data-testid="mbd-kind-filter"]')).toBeNull();
  });

  it('keeps quiet when the solver declares no partial mode', async () => {
    mocks.dimensionSystem.value = createSystem();
    useMbdDiagnosticsStore().set({
      channel: 'api',
      sourceId: '24381/145712',
      issues: [],
      skipped: [],
    });

    const host = mountPanel();
    await nextTick();

    expect(host.querySelector('[data-testid="mbd-incomplete-annotation"]'))
      .toBeNull();
    expect(host.querySelector('[data-testid="mbd-diagnostics"]')).toBeNull();
  });
});
