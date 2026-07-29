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
      skipped: [{ id: 'angle-1', reason: 'contract-incomplete' }],
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
    expect(panel?.textContent).toContain('angle-1：contract-incomplete');

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
});
