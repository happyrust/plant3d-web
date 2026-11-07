import { describe, expect, it, vi } from 'vitest';

import { linearRecord } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import {
  groupMbdRecordsByFunction,
  groupVisibility,
  mbdFunctionGroupRecords,
  mbdFunctionGroupVisibility,
  mbdFunctionOf,
  toggleGroupHidden,
} from './mbdFunctionGroups';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

function record(
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

const ids = (records: readonly ExternalDimensionRecord[]) => records.map(item => item.id);

describe('groupMbdRecordsByFunction', () => {
  it('leaves a payload without categories entirely to the existing grouping', () => {
    const records = [record('dim-0', { isolineIndex: 0 }), record('weld-0', { category: 'annotation' })];
    const grouping = groupMbdRecordsByFunction(records);

    expect(grouping.groups).toEqual([]);
    expect(grouping.rest).toEqual(records);
  });

  it('groups MBD records by category in first-appearance order, dimensions before annotations', () => {
    const grouping = groupMbdRecordsByFunction([
      record('tag-1', { mbdFunction: '管道信息', category: 'annotation' }),
      record('loose-1'),
      record('seg-0', { mbdFunction: '一级尺寸', chainId: 'chain:0' }),
      record('note-1', { mbdFunction: '一级尺寸', category: 'annotation' }),
      record('seg-1', { mbdFunction: '一级尺寸', chainId: 'chain:0' }),
      record('clearance-1', { source: 'clearance', mbdFunction: '一级尺寸' }),
      record('tag-2', { mbdFunction: '管道信息', category: 'annotation' }),
    ]);

    expect(grouping.groups.map(group => [group.mbdFunction, ids(group.records)])).toEqual([
      ['管道信息', ['tag-1', 'tag-2']],
      ['一级尺寸', ['seg-0', 'seg-1', 'note-1']],
    ]);
    // Only MBD records carry a category; everything else keeps its input order.
    expect(ids(grouping.rest)).toEqual(['loose-1', 'clearance-1']);
  });

  it('merges one category across BRANs (multi-BRAN ids keep their refno prefix)', () => {
    const grouping = groupMbdRecordsByFunction([
      record('A:seg-0', { mbdFunction: '定位尺寸' }),
      record('B:seg-0', { mbdFunction: '定位尺寸' }),
    ]);

    expect(grouping.groups.map(group => [group.mbdFunction, ids(group.records)])).toEqual([
      ['定位尺寸', ['A:seg-0', 'B:seg-0']],
    ]);
  });
});

describe('mbdFunctionOf', () => {
  it('reads the category from MBD records only', () => {
    expect(mbdFunctionOf(record('seg-0', { mbdFunction: '一级尺寸' }))).toBe('一级尺寸');
    expect(mbdFunctionOf(record('seg-0'))).toBeUndefined();
    expect(mbdFunctionOf(record('c-1', { source: 'clearance', mbdFunction: '一级尺寸' }))).toBeUndefined();
  });
});

describe('group visibility', () => {
  const group = [record('seg-0'), record('seg-1'), record('seg-2')];

  it('reports visible, hidden or mixed from the temporary-hide set', () => {
    expect(groupVisibility(group, new Set())).toBe('visible');
    expect(groupVisibility(group, new Set(['other']))).toBe('visible');
    expect(groupVisibility(group, new Set(['seg-1']))).toBe('mixed');
    expect(groupVisibility(group, new Set(['seg-0', 'seg-1', 'seg-2']))).toBe('hidden');
  });

  it('hides a visible or partly hidden group and shows a fully hidden one, in one write', () => {
    const port = { setHiddenMany: vi.fn() };

    toggleGroupHidden(port, group, new Set());
    toggleGroupHidden(port, group, new Set(['seg-1']));
    toggleGroupHidden(port, group, new Set(['seg-0', 'seg-1', 'seg-2']));
    toggleGroupHidden(port, [], new Set());

    expect(port.setHiddenMany.mock.calls).toEqual([
      [['seg-0', 'seg-1', 'seg-2'], true],
      [['seg-0', 'seg-1', 'seg-2'], true],
      [['seg-0', 'seg-1', 'seg-2'], false],
    ]);
  });
});

describe('mbdFunctionGroupRecords', () => {
  it('recognises a list group made only of categorised MBD records', () => {
    const seg0 = record('seg-0', { mbdFunction: '一级尺寸' });
    const seg1 = record('seg-1', { mbdFunction: '一级尺寸' });

    expect(mbdFunctionGroupRecords([seg0, seg1])).toEqual([seg0, seg1]);
    expect(mbdFunctionGroupRecords([])).toBeNull();
    expect(mbdFunctionGroupRecords([seg0, record('loose')])).toBeNull();
    expect(mbdFunctionGroupRecords([seg0, linearRecord()])).toBeNull();
    expect(mbdFunctionGroupRecords([record('c-1', { source: 'clearance', mbdFunction: '一级尺寸' })])).toBeNull();
  });
});

describe('mbdFunctionGroupVisibility', () => {
  it('drives the registry temporary hide for category groups only', () => {
    const seg0 = record('seg-0', { mbdFunction: '一级尺寸' });
    const seg1 = record('seg-1', { mbdFunction: '一级尺寸' });
    const loose = record('loose');
    const registry = new ExternalDimensionRegistry();
    registry.replaceSource('mbd', [seg0, seg1, loose]);
    const callbacks = mbdFunctionGroupVisibility(
      () => [...registry.snapshot.hiddenIds],
      () => registry,
    );

    expect(callbacks.visibility([loose])).toBeNull();
    expect(callbacks.visibility([seg0, seg1])).toBe('visible');

    callbacks.toggle([seg0, seg1]);
    expect(ids(registry.snapshot.visibleRecords)).toEqual(['loose']);
    expect(callbacks.visibility([seg0, seg1])).toBe('hidden');

    // One row back via the per-row toggle → mixed; the group button then hides it again.
    registry.setHidden('seg-1', false);
    expect(callbacks.visibility([seg0, seg1])).toBe('mixed');
    callbacks.toggle([seg0, seg1]);
    expect(callbacks.visibility([seg0, seg1])).toBe('hidden');

    callbacks.toggle([seg0, seg1]);
    expect(ids(registry.snapshot.visibleRecords)).toEqual(['seg-0', 'seg-1', 'loose']);

    // A non-category group never writes.
    callbacks.toggle([loose]);
    expect(registry.isHidden('loose')).toBe(false);
  });

  it('does nothing without a dimension system', () => {
    const callbacks = mbdFunctionGroupVisibility(() => [], () => undefined);
    const seg0 = record('seg-0', { mbdFunction: '一级尺寸' });

    expect(() => callbacks.toggle([seg0])).not.toThrow();
    expect(callbacks.visibility([seg0])).toBe('visible');
  });
});
