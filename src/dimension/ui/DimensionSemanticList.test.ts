import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import { linearRecord } from '../domain/testFixtures';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';

import { getDimensionBoundActions, isExternalDimensionRecord } from './dimensionBoundActions';
import DimensionSemanticList from './DimensionSemanticList.vue';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';

const external: ExternalDimensionRecord = {
  id: 'external-1',
  source: 'mbd',
  sourceLabel: 'MBD',
  role: 'external-reference',
  layout: {
    id: 'external-1',
    kind: 'linear',
    role: 'external-reference',
    labelPinned: false,
    a: [0, 0, 0],
    b: [2, 0, 0],
    placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
  },
};

let apps: App[] = [];

function mountList(input: {
  items?: readonly (UserDimensionRecord | ExternalDimensionRecord)[];
  selectedId?: string | null;
  user?: { id: string; role: string } | null;
  groupLabel?: (item: UserDimensionRecord | ExternalDimensionRecord) => string | null;
  onSelect?: ReturnType<typeof vi.fn>;
  onAction?: ReturnType<typeof vi.fn>;
} = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(DimensionSemanticList, {
    items: input.items ?? [linearRecord(), external],
    selectedId: input.selectedId ?? null,
    user: input.user ?? { id: 'owner', role: 'designer' },
    formatPolicy: DEFAULT_DIMENSION_FORMAT,
    ...(input.groupLabel ? { groupLabel: input.groupLabel } : {}),
    onSelect: input.onSelect ?? vi.fn(),
    onAction: input.onAction ?? vi.fn(),
  });
  app.mount(host);
  apps.push(app);
  return host;
}

afterEach(() => {
  apps.forEach(app => app.unmount());
  apps = [];
  document.body.innerHTML = '';
});

describe('getDimensionBoundActions', () => {
  it('limits external records to inspect/select and temporary hiding', () => {
    expect(getDimensionBoundActions(external, { id: 'owner', role: 'admin' }))
      .toEqual(['select', 'hide-external']);
  });

  it('only exposes mutation actions to the author or an admin', () => {
    expect(getDimensionBoundActions(linearRecord(), {
      id: 'other',
      role: 'designer',
    })).toEqual(['select']);
    expect(getDimensionBoundActions(linearRecord(), {
      id: 'owner',
      role: 'designer',
    })).toEqual(['select', 'rebind:a', 'rebind:b', 'delete']);
    expect(getDimensionBoundActions(linearRecord({ labelPinned: true }), {
      id: 'owner',
      role: 'designer',
    })).toEqual([
      'select',
      'rebind:a',
      'rebind:b',
      'restore-auto-layout',
      'delete',
    ]);
  });
});

describe('DimensionSemanticList', () => {
  it('renders listbox/option semantics with shared selection state', () => {
    const host = mountList({ selectedId: 'external-1' });
    const list = host.querySelector('[role="listbox"]');
    const options = [...host.querySelectorAll('[role="option"]')];

    expect(list).not.toBeNull();
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('moves the active option with arrows and selects it with Enter', async () => {
    const onSelect = vi.fn();
    const host = mountList({ onSelect });
    const list = host.querySelector('[role="listbox"]') as HTMLElement;

    list.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
    }));
    list.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
    }));
    await nextTick();

    expect(onSelect).toHaveBeenCalledWith(external);
    expect(list.getAttribute('aria-activedescendant'))
      .toBe('dimension-option-external-1');
  });

  it('invokes Delete only when it is a bound action', async () => {
    const onAction = vi.fn();
    const host = mountList({ onAction });
    const list = host.querySelector('[role="listbox"]') as HTMLElement;

    list.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
    }));
    await nextTick();
    expect(onAction).toHaveBeenCalledWith('delete', expect.objectContaining({
      id: 'linear-1',
    }));

    onAction.mockClear();
    list.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
    }));
    list.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
    }));
    await nextTick();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('hides permission-bound controls and keeps external actions read-only', () => {
    const host = mountList({
      user: { id: 'other', role: 'designer' },
    });
    const userRow = host.querySelector('[data-dimension-id="linear-1"]')!;
    const externalRow = host.querySelector('[data-dimension-id="external-1"]')!;

    expect(userRow.querySelector('[data-action="delete"]')).toBeNull();
    expect(userRow.querySelector('[data-action="rebind"]')).toBeNull();
    expect(externalRow.querySelectorAll('[data-action]')).toHaveLength(1);
    expect(externalRow.querySelector('[data-action="hide-external"]')).not.toBeNull();
  });

  it('announces stale and approximate records in row text', () => {
    const host = mountList({
      items: [
        linearRecord({ validity: 'invalid' }),
        linearRecord({
          id: 'approximate-1',
          a: { snapshot: [0, 0, 0], accuracy: 'approximate' },
        }),
      ],
    });

    expect(host.querySelector('[data-dimension-id="linear-1"]')?.textContent)
      .toContain('STALE');
    expect(host.querySelector('[data-dimension-id="approximate-1"]')?.textContent)
      .toContain('近似');
  });

  it('renders one group header per category (ADR 0041 terms)', () => {
    const annotation: ExternalDimensionRecord = {
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
    };
    const host = mountList({
      items: [linearRecord(), external, annotation],
    });

    const headers = [...host.querySelectorAll('[data-group]')]
      .map(node => node.textContent?.trim());
    expect(headers).toEqual(['用户尺寸', '外部尺寸', '外部标注图元']);
    expect(host.querySelector('[data-dimension-id="weld-1"]')?.textContent)
      .toContain('MBD: weld-1');
  });

  it('lets the parent name groups and collapses a group on demand (W3-6)', async () => {
    const tabled = (id: string, isolineIndex?: number): ExternalDimensionRecord => ({
      ...external,
      id,
      layout: { ...external.layout, id },
      ...(isolineIndex === undefined ? {} : { isolineIndex }),
    });
    const onSelect = vi.fn();
    const host = mountList({
      items: [linearRecord(), tabled('seg0-a', 0), tabled('seg0-b', 0), tabled('seg3', 3), tabled('loose')],
      onSelect,
      groupLabel: item => {
        if (!isExternalDimensionRecord(item)) return null;
        return item.isolineIndex === undefined ? '未分段' : `直段 ${item.isolineIndex}`;
      },
    });
    const headers = () => [...host.querySelectorAll('[data-group]')]
      .map(node => node.textContent?.trim());
    const rowIds = () => [...host.querySelectorAll('[data-dimension-id]')]
      .map(node => node.getAttribute('data-dimension-id'));
    const toggle = () => host.querySelector<HTMLButtonElement>('[data-group="直段 0"]')!;

    expect(headers()).toEqual(['用户尺寸', '直段 0', '直段 3', '未分段']);
    expect(host.querySelector('[data-group-count="直段 0"]')?.textContent?.trim()).toBe('2');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    toggle().click();
    await nextTick();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(rowIds()).toEqual(['linear-1', 'seg3', 'loose']);
    expect(headers()).toEqual(['用户尺寸', '直段 0', '直段 3', '未分段']);

    // Keyboard skips the collapsed rows: from linear-1, ArrowDown lands on seg3.
    const list = host.querySelector('[role="listbox"]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(list.getAttribute('aria-activedescendant')).toBe('dimension-option-seg3');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'seg3' }));

    toggle().click();
    await nextTick();
    expect(rowIds()).toEqual(['linear-1', 'seg0-a', 'seg0-b', 'seg3', 'loose']);
  });
});
