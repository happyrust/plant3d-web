import { describe, expect, it } from 'vitest';

import {
  mbdDtosToV2PipeData,
  mbdToExternalDimensions,
} from './mbdExternalDimensions';

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

describe('mbdDtosToV2PipeData', () => {
  it('converts parquet DTOs into design-space contract primitives', () => {
    const scaleByTwo = [
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      0, 0, 0, 1,
    ] as const;
    const result = mbdDtosToV2PipeData([
      {
        id: 'mbd-1',
        reference: true,
        formattedLabel: '1000 REF',
        dimensionLine: { from: [0, 1, 0], to: [1, 1, 0] },
        extensionLines: [{ from: [0, 0, 0], to: [0, 1.1, 0] }],
        arrowLines: [{ from: [0, 1, 0], to: [0.1, 1.05, 0] }],
        labelAnchor: [0.5, 1, 0],
        sourceToDesign: scaleByTwo,
      },
      {
        id: 'bad',
        formattedLabel: 'bad',
        dimensionLine: { from: [0, 0, 0], to: [Number.NaN, 0, 0] },
        labelAnchor: [0, 0, 0],
        sourceToDesign: [1, 2],
      },
    ], { inputRefno: 'dbno:250160' });

    expect(result.skipped).toEqual([
      { id: 'bad', reason: 'Invalid sourceToDesign matrix or explicit geometry' },
    ]);
    expect(result.data.version).toBe('v2');
    expect(result.data.input_refno).toBe('dbno:250160');
    expect(result.data.primitives).toEqual([{
      kind: 'linear_dim',
      id: 'mbd-1',
      start: [0, 2, 0],
      end: [2, 2, 0],
      text: '1000 REF',
      extension_lines: [{ from: [0, 0, 0], to: [0, 2.2, 0] }],
      arrow_lines: [{ from: [0, 2, 0], to: [0.2, 2.1, 0] }],
      label_anchor: [1, 2, 0],
      reference: true,
    }]);
  });
});
