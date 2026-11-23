import { describe, expect, it, vi } from 'vitest';

import { DtxDimensionAnchorResolver, fallbackRefnosForCandidate } from './dtxDimensionAnchorResolver';

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

  it('rebinds a TUBI end through its station refnos when the stored refno has no such candidate', async () => {
    const tubiId = 'TUBI:24381_145019~24381_145031:LEAVE';
    const loadCandidates = vi.fn(async (refno: string) => {
      if (refno === '24381_145031') return [{ id: tubiId, point: [9, 8, 7] as const }];
      if (refno === '24381_145019~24381_145031') throw new Error('not a member refno');
      return [];
    });
    const resolver = new DtxDimensionAnchorResolver({ loadCandidates });

    const [result] = await resolver.resolveMany([
      { source: 'primitive-key-point', refno: '24381_145019~24381_145031', candidateId: tubiId },
    ]);
    expect(result).toMatchObject({ ok: true, anchor: { snapshot: [9, 8, 7] } });
    expect(loadCandidates.mock.calls.map(([refno]) => refno)).toEqual([
      '24381_145019~24381_145031',
      '24381_145019',
      '24381_145031',
    ]);
  });

  it('keeps not-found when no fallback has the candidate, and never treats Head/Tail as refnos', async () => {
    expect(fallbackRefnosForCandidate('TUBI:Head~24381_145019:ARRIVE')).toEqual(['24381_145019']);
    expect(fallbackRefnosForCandidate('ptset:24381_145031#2', 'BRAN')).toEqual(['24381_145031']);
    expect(fallbackRefnosForCandidate('plines:24381_177301:NA:pline_start', '24381_177301')).toEqual([]);
    const resolver = new DtxDimensionAnchorResolver({ loadCandidates: async () => [] });
    await expect(resolver.resolveMany([
      { source: 'p-point', refno: 'BRAN', candidateId: 'ptset:24381_145031#2' },
    ])).resolves.toEqual([{ ok: false, reason: 'not-found' }]);
  });
});
