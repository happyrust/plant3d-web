import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument, linearRecord } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

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
  const setDisplayMode = vi.fn();
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
      setDisplayMode,
      subscribeSelection: () => vi.fn(),
      getLayouts: () => [] as readonly unknown[],
      subscribeLayouts(listener: (layouts: readonly unknown[]) => void) {
        layoutListeners.add(listener);
        return () => layoutListeners.delete(listener);
      },
    },
    setDisplayMode,
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

  it('orders annotation records behind dimensions', async () => {
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

    const host = mountPanel();
    await nextTick();

    const rowIds = [...host.querySelectorAll('[data-dimension-id]')]
      .map(node => node.getAttribute('data-dimension-id'));
    expect(rowIds).toEqual(['linear-1', 'mbd-1', 'weld-1']);
  });

  it('switches the display mode on the viewport directly and reports occluded dimensions', async () => {
    const system = createSystem();
    const mbdRecord = (id: string) => ({
      id,
      source: 'mbd' as const,
      sourceLabel: 'MBD',
      role: 'external' as const,
      layout: {
        id,
        role: 'external' as const,
        labelPinned: true,
        formattedLabel: '100',
        lines: [],
        labelAnchor: [0, 0, 0] as const,
        arrowLines: [],
      },
    });
    system.externalRegistry.replaceSource('mbd', [mbdRecord('mbd-a'), mbdRecord('mbd-b'), mbdRecord('mbd-c')]);
    mocks.dimensionSystem.value = system;
    window.history.replaceState({}, '', '/');
    let popstates = 0;
    const onPopstate = () => { popstates += 1; };
    window.addEventListener('popstate', onPopstate);
    try {
      const host = mountPanel();
      await nextTick();
      // A viewport that shows up starts in engineering unless the URL says otherwise.
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('engineering');
      const state = () => host.querySelector('[data-testid="mbd-mode-state"]')?.textContent?.replace(/\s+/g, ' ').trim();
      const radio = (mode: string) => host.querySelector<HTMLInputElement>(`[data-testid="mbd-mode-${mode}"]`)!;
      expect(state()).toBe('每条尺寸照工程图样全画');
      expect(radio('engineering').checked).toBe(true);

      // Inspection: the viewport is told directly, the URL only records it — no
      // popstate, so the sync layer does not refetch the payload.
      radio('inspection').checked = true;
      radio('inspection').dispatchEvent(new Event('change'));
      await nextTick();
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('inspection');
      expect(new URLSearchParams(window.location.search).get('mbd_mode')).toBe('inspection');
      expect(popstates).toBe(0);
      expect(radio('inspection').checked).toBe(true);

      const drawn = (id: string, occluded?: boolean) => ({
        dimensionId: id,
        scenePrimitives: [],
        primitives: [{ kind: 'line', from: [0, 0], to: [1, 1], part: 'dimension', styleRole: 'external' }],
        hitRegions: [],
        labelBounds: { x: 0, y: 0, width: 0, height: 0 },
        labelPinned: true,
        derived: { formattedLabel: id, ...(occluded === undefined ? {} : { occluded }) },
      });
      system.emitLayouts([
        drawn('mbd-a', true),
        drawn('mbd-b', false),
        { ...drawn('mbd-c'), primitives: [], derived: { formattedLabel: 'mbd-c', lodHidden: 'short-line' } },
        drawn('user-1', true),
      ]);
      await nextTick();
      // user-1 counts too: the occlusion summary covers every drawn dimension, not only external ones
      expect(state()).toBe('被遮挡 2 条 / 可见 1 条');

      radio('engineering').checked = true;
      radio('engineering').dispatchEvent(new Event('change'));
      await nextTick();
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('engineering');
      expect(new URLSearchParams(window.location.search).get('mbd_mode')).toBeNull();
      expect(state()).toBe('每条尺寸照工程图样全画');

      // Browser navigation (popstate) brings the mode back in line with the URL.
      window.history.replaceState({}, '', '/?mbd_mode=inspection');
      window.dispatchEvent(new Event('popstate'));
      await nextTick();
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('inspection');
      expect(radio('inspection').checked).toBe(true);
    } finally {
      window.removeEventListener('popstate', onPopstate);
      window.history.replaceState({}, '', '/');
    }
  });

});
