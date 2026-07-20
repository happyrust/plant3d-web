import { describe, expect, it } from 'vitest';

import { mbdToExternalDimensions } from './mbdExternalDimensions';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

describe('mbdToExternalDimensions', () => {
  it('maps explicit layout and reference semantics without creating user records', () => {
    const result = mbdToExternalDimensions([{
      id: 'mbd-1',
      reference: true,
      formattedLabel: '1000 REF',
      dimensionLine: { from: [0, 1, 0], to: [1, 1, 0] },
      extensionLines: [
        { from: [0, 0, 0], to: [0, 1.1, 0] },
      ],
      arrowLines: [
        { from: [0, 1, 0], to: [0.1, 1.05, 0] },
      ],
      labelAnchor: [0.5, 1, 0],
      sourceToDesign: IDENTITY,
    }]);

    expect(result.skipped).toEqual([]);
    expect(result.records[0]).toEqual(expect.objectContaining({
      id: 'mbd-1',
      source: 'mbd',
      role: 'external-reference',
      layout: expect.objectContaining({
        labelPinned: true,
        formattedLabel: '1000 REF',
        labelAnchor: [0.5, 1, 0],
      }),
    }));
  });

  it('rejects malformed transforms and non-finite points', () => {
    const result = mbdToExternalDimensions([{
      id: 'bad',
      formattedLabel: 'bad',
      dimensionLine: { from: [0, 0, 0], to: [Number.NaN, 0, 0] },
      labelAnchor: [0, 0, 0],
      sourceToDesign: [1, 2],
    }]);
    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'bad', reason: 'Invalid sourceToDesign matrix or explicit geometry' },
    ]);
  });
});
