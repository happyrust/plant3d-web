import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

const mocks = vi.hoisted(() => ({
  currentUser: { value: { id: 'designer-1', role: 'designer' } },
  dimensionSystem: { value: null as any },
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ dimensionSystem: mocks.dimensionSystem }),
}));
vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
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

function mbdRecord(
  id: string,
  overrides: Partial<ExternalDimensionRecord> = {},
): ExternalDimensionRecord {
  return {
    id,
    source: 'mbd',
    sourceLabel: `MBD: ${id}`,
    role: 'external',
    layoutAuthority: 'solver',
    layout: {
      id,
      role: 'external',
      labelPinned: true,
      formattedLabel: id,
      lines: [],
      labelAnchor: [0, 0, 0],
      arrowLines: [],
    },
    ...overrides,
  };
}

function createSystem(records: readonly ExternalDimensionRecord[]) {
  const state = emptyDimensionDocument();
  const externalRegistry = new ExternalDimensionRegistry();
  externalRegistry.replaceSource('mbd', records);
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
      setSelection: vi.fn(),
      setDisplayMode: vi.fn(),
      subscribeSelection: () => vi.fn(),
      getLayouts: () => [] as readonly unknown[],
      subscribeLayouts: () => vi.fn(),
    },
    pointer: { start: vi.fn() },
    snapPort: null,
    getRecoveryPreview: () => null,
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
  };
}

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
});

/**
 * #103 M1-3：带 `mbdFunction` 的 MBD 记录按类别成组排在最后，组头「临时隐藏本组」走注册表同一套
 * 临时隐藏；没有类别的记录留在原有分组里，组头不出按钮。
 */
describe('DimensionPanelDock MBD category groups', () => {
  it('groups MBD records by function and hides a group through the external registry', async () => {
    const system = createSystem([
      mbdRecord('pipe-dim'),
      mbdRecord('seg-0', { mbdFunction: '一级尺寸', chainId: 'chain:0' }),
      mbdRecord('tag', { mbdFunction: '管道信息', category: 'annotation' }),
      mbdRecord('seg-1', { mbdFunction: '一级尺寸', chainId: 'chain:0' }),
      mbdRecord('angle', { mbdFunction: '二级尺寸' }),
    ]);
    mocks.dimensionSystem.value = system;
    const host = mountPanel();
    await nextTick();

    const headers = () => [...host.querySelectorAll('[data-group]')].map(node => node.textContent?.trim());
    const rowIds = () => [...host.querySelectorAll('[data-dimension-id]')]
      .map(node => node.getAttribute('data-dimension-id'));
    const groupButton = (group: string) =>
      host.querySelector<HTMLButtonElement>(`[data-group-visibility="${group}"]`);

    expect(headers()).toEqual(['外部尺寸', '一级尺寸', '管道信息', '二级尺寸']);
    expect(rowIds()).toEqual(['pipe-dim', 'seg-0', 'seg-1', 'tag', 'angle']);
    expect([...host.querySelectorAll('[data-group-visibility]')]
      .map(node => node.getAttribute('data-group-visibility')))
      .toEqual(['一级尺寸', '管道信息', '二级尺寸']);
    expect(groupButton('一级尺寸')?.textContent?.trim()).toBe('临时隐藏本组');

    groupButton('一级尺寸')!.click();
    await nextTick();
    expect(system.externalRegistry.isHidden('seg-0')).toBe(true);
    expect(system.externalRegistry.isHidden('seg-1')).toBe(true);
    expect(system.externalRegistry.isHidden('tag')).toBe(false);
    expect(groupButton('一级尺寸')?.textContent?.trim()).toBe('临时显示本组');
    // Rows stay listed so each can come back on its own (ADR 0028).
    const rowAction = (id: string) => host.querySelector<HTMLButtonElement>(
      `[data-dimension-id="${id}"] [data-action="hide-external"]`,
    )!;
    expect(rowAction('seg-0').textContent?.trim()).toBe('临时显示');

    rowAction('seg-0').click();
    await nextTick();
    expect(groupButton('一级尺寸')?.getAttribute('data-visibility')).toBe('mixed');
    expect(groupButton('一级尺寸')?.textContent?.trim()).toBe('临时隐藏本组');

    groupButton('一级尺寸')!.click();
    await nextTick();
    expect(groupButton('一级尺寸')?.getAttribute('data-visibility')).toBe('hidden');
    groupButton('一级尺寸')!.click();
    await nextTick();
    expect(system.externalRegistry.snapshot.hiddenIds.size).toBe(0);
    expect(groupButton('一级尺寸')?.getAttribute('data-visibility')).toBe('visible');
  });

  it('keeps a payload without categories in the existing groups with no group toggle', async () => {
    mocks.dimensionSystem.value = createSystem([
      mbdRecord('dim-0'),
      mbdRecord('weld-0', { category: 'annotation' }),
    ]);
    const host = mountPanel();
    await nextTick();

    expect([...host.querySelectorAll('[data-group]')].map(node => node.textContent?.trim()))
      .toEqual(['外部尺寸', '外部标注图元']);
    expect(host.querySelector('[data-group-visibility]')).toBeNull();
  });
});
