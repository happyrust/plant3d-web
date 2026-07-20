import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import { linearRecord } from '../domain/testFixtures';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';

import { getDimensionBoundActions } from './dimensionBoundActions';
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
});
