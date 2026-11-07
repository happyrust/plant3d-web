import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { mbdV2ToExternalRecords } from '../adapters/mbdV2ExternalAnnotations';
import { emptyDimensionDocument } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { MbdV2AnnotationType, MbdV2PipeData } from '../adapters/mbdV2Contract';
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

  /**
   * ADR 0071（CT-9 前端）：管道图元全带上 function 之后，管道包照旧按直段分组——适配层不给管道记录写
   * 类别；同样的图元放进非管道包才按类别成组。两种包同屏时各走各的。
   */
  it('keeps a pipe package in its isoline groups whatever function its primitives declare', async () => {
    const payload = (prefix: string, annotationType?: MbdV2AnnotationType): MbdV2PipeData => ({
      version: 'v2',
      ...(annotationType ? { annotation_type: annotationType } : {}),
      input_refno: prefix,
      branch_refno: prefix,
      primitives: [
        {
          kind: 'linear_dim', id: `${prefix}:isoline:0:main:a`, isoline_idx: 0, function: '尺寸',
          start: [0, 0, 0], end: [1, 0, 0], text: '1000', extension_lines: [], arrow_lines: [], label_anchor: [0.5, 0, 0],
        },
        { kind: 'weld_mark', id: `${prefix}:isoline:0:weld:mark:w`, isoline_idx: 0, function: '焊点', position: [0.5, 0, 0] },
        { kind: 'aid_line', id: `${prefix}:isoline:1:flow:0`, isoline_idx: 1, function: '流向', start: [1, 0, 0], end: [1, 1, 0] },
        {
          kind: 'linear_dim', id: `${prefix}:isoline:1:main:b`, isoline_idx: 1, function: '尺寸',
          start: [1, 0, 0], end: [1, 1, 0], text: '1000', extension_lines: [], arrow_lines: [], label_anchor: [1, 0.5, 0],
        },
      ],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    });
    const recordsOf = (data: MbdV2PipeData) => mbdV2ToExternalRecords(data).records;
    const show = async (records: readonly ExternalDimensionRecord[]) => {
      apps.splice(0).forEach(app => app.unmount());
      document.body.innerHTML = '';
      mocks.dimensionSystem.value = createSystem(records);
      const host = mountPanel();
      await nextTick();
      return {
        headers: [...host.querySelectorAll('[data-group]')].map(node => node.textContent?.trim()),
        rowIds: [...host.querySelectorAll('[data-dimension-id]')].map(node => node.getAttribute('data-dimension-id')),
        toggles: [...host.querySelectorAll('[data-group-visibility]')]
          .map(node => node.getAttribute('data-group-visibility')),
      };
    };

    for (const annotationType of [undefined, 'em4_pipe', 'em9_pipe'] as const) {
      const pipe = await show(recordsOf(payload('P', annotationType)));
      expect(pipe.headers, `${annotationType}`).toEqual(['直段 0', '直段 1']);
      expect(pipe.rowIds).toEqual(['P:isoline:0:main:a', 'P:isoline:0:weld:mark:w', 'P:isoline:1:main:b', 'P:isoline:1:flow:0']);
      expect(pipe.toggles).toEqual([]);
    }

    const support = await show(recordsOf(payload('S', 'em4_supp')));
    expect(support.headers).toEqual(['尺寸', '焊点', '流向']);
    expect(support.toggles).toEqual(['尺寸', '焊点', '流向']);

    const both = await show([...recordsOf(payload('P', 'em4_pipe')), ...recordsOf(payload('S', 'em4_supp'))]);
    expect(both.headers).toEqual(['直段 0', '直段 1', '尺寸', '焊点', '流向']);
    expect(both.rowIds.slice(0, 4)).toEqual(['P:isoline:0:main:a', 'P:isoline:0:weld:mark:w', 'P:isoline:1:main:b', 'P:isoline:1:flow:0']);
    expect(both.toggles).toEqual(['尺寸', '焊点', '流向']);
  });
});
