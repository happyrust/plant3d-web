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

vi.mock('../flags', () => ({
  isDimensionFlagEnabled: () => true,
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
});
