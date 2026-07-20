import { describe, expect, it } from 'vitest';

import { branClearanceToExternalDimensions } from './branExternalDimensions';

describe('branClearanceToExternalDimensions', () => {
  it('maps valid backend points to a read-only authoritative linear dimension', () => {
    const result = branClearanceToExternalDimensions([
      {
        targetGroup: 'wall',
        index: 0,
        candidate: {
          refno: '24381_145018',
          noun: 'WALL',
          distance_mm: 1200,
          annotation: {
            start_point: { x: 1000, y: 2000, z: 3000 },
            end_point: { x: 2200, y: 2000, z: 3000 },
            label_mm: 1200,
          },
        },
      },
    ], point => [point[0] * 0.001, point[1] * 0.001, point[2] * 0.001]);

    expect(result.skipped).toEqual([]);
    expect(result.records).toEqual([
      expect.objectContaining({
        id: 'bran-clearance:wall:24381_145018:0',
        source: 'bran-clearance',
        role: 'external',
        layout: expect.objectContaining({
          kind: 'linear',
          a: [1, 2, 3],
          b: [2.2, 2, 3],
          authoritativeText: '1200mm',
        }),
      }),
    ]);
  });

  it('skips incomplete coordinates without creating a user record', () => {
    const result = branClearanceToExternalDimensions([
      {
        targetGroup: 'column',
        index: 1,
        candidate: {
          refno: 'bad',
          noun: 'COLU',
          distance_mm: 0,
          annotation: {
            start_point: undefined as any,
            end_point: { x: 0, y: 0, z: 0 },
            label_mm: 0,
          },
        },
      },
    ], point => point);

    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: 'bran-clearance:column:bad:1' }),
    ]);
  });
});
