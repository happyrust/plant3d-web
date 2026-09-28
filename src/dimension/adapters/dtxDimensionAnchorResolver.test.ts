import { describe, expect, it, vi } from 'vitest';

import { DtxDimensionAnchorResolver } from './dtxDimensionAnchorResolver';

describe('DtxDimensionAnchorResolver', () => {
  it('batches refs by refno and resolves point, direction, circle, and arc parts', async () => {
    const loadCandidates = vi.fn(async () => [{
      id: 'primitive-1',
      point: [1, 2, 3] as const,
      direction: [0, 1, 0] as const,
      circle: {
        center: [4, 5, 6] as const,
        rim: [5, 5, 6] as const,
        normal: [0, 0, 1] as const,
      },
      arc: {
        center: [7, 8, 9] as const,
        rim: [8, 8, 9] as const,
        normal: [0, 1, 0] as const,
      },
    }]);
    const resolver = new DtxDimensionAnchorResolver({ loadCandidates });

    const result = await resolver.resolveMany([
      { source: 'primitive-key-point', refno: 'A', candidateId: 'primitive-1' },
      { source: 'direction', refno: 'A', candidateId: 'primitive-1' },
      { source: 'circle', refno: 'A', candidateId: 'primitive-1:rim' },
      { source: 'arc', refno: 'A', candidateId: 'primitive-1:normal' },
    ]);

    expect(loadCandidates).toHaveBeenCalledTimes(1);
    expect(result.map(item => item.ok ? item.anchor.snapshot : item.reason))
      .toEqual([
        [1, 2, 3],
        [0, 1, 0],
        [5, 5, 6],
        [0, 1, 0],
      ]);
  });

  it('marks mesh hits and missing metadata as unavailable without guessing', async () => {
    const resolver = new DtxDimensionAnchorResolver({
      loadCandidates: async () => [],
    });

    await expect(resolver.resolveMany([
      { source: 'model-surface', refno: 'A', candidateId: 'mesh' },
      { source: 'primitive-key-point', candidateId: 'missing-refno' },
    ])).resolves.toEqual([
      { ok: false, reason: 'source-unavailable' },
      { ok: false, reason: 'source-unavailable' },
    ]);
  });
});
