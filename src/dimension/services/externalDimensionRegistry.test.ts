import { describe, expect, it, vi } from 'vitest';

import { ExternalDimensionRegistry } from './externalDimensionRegistry';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

function external(
  id: string,
  source: 'bran-clearance' | 'mbd',
): ExternalDimensionRecord {
  return {
    id,
    source,
    sourceLabel: id,
    role: 'external',
    layout: {
      id,
      kind: 'linear',
      role: 'external',
      labelPinned: false,
      a: [0, 0, 0],
      b: [1, 0, 0],
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    },
  };
}

describe('ExternalDimensionRegistry', () => {
  it('replaces one source without overwriting other external dimensions', () => {
    const registry = new ExternalDimensionRegistry();
    registry.replaceSource('bran-clearance', [external('bran-1', 'bran-clearance')]);
    registry.replaceSource('mbd', [external('mbd-1', 'mbd')]);
    registry.replaceSource('bran-clearance', [external('bran-2', 'bran-clearance')]);

    expect(registry.snapshot.records.map(record => record.id))
      .toEqual(['bran-2', 'mbd-1']);
  });

  it('publishes hidden state while preserving rows for unhide actions', () => {
    const registry = new ExternalDimensionRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.replaceSource('mbd', [external('mbd-1', 'mbd')]);
    registry.setHidden('mbd-1', true);

    expect(registry.snapshot.records.map(record => record.id)).toEqual(['mbd-1']);
    expect(registry.snapshot.visibleRecords).toEqual([]);
    expect(registry.isHidden('mbd-1')).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      visibleRecords: [],
    }));
  });
});
