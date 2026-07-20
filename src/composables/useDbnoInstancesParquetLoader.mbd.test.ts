import { describe, expect, it } from 'vitest';

import { mapMbdDimensionRows } from './useDbnoInstancesParquetLoader';

describe('mapMbdDimensionRows', () => {
  it('maps manifest units and design coordinates into MBD DTOs', () => {
    const result = mapMbdDimensionRows([{
      id: 'mbd-1',
      reference: true,
      formatted_label: '1000 REF',
      dimension_from_x: 0,
      dimension_from_y: 0,
      dimension_from_z: 0,
      dimension_to_x: 1000,
      dimension_to_y: 0,
      dimension_to_z: 0,
      label_x: 500,
      label_y: 100,
      label_z: 0,
      extension_lines_json: JSON.stringify([
        { from: [0, 0, 0], to: [0, 100, 0] },
      ]),
      arrow_lines_json: '[]',
    }], {
      source: 'mm',
      target: 'm',
      conversion_factor: 0.001,
      coordinate_space: 'design',
    });

    expect(result.skipped).toEqual([]);
    expect(result.dimensions[0]).toMatchObject({
      id: 'mbd-1',
      reference: true,
      formattedLabel: '1000 REF',
      dimensionLine: { from: [0, 0, 0], to: [1, 0, 0] },
      labelAnchor: [0.5, 0.1, 0],
      extensionLines: [{ from: [0, 0, 0], to: [0, 0.1, 0] }],
    });
  });

  it('diagnoses invalid rows without dropping valid dimensions', () => {
    const result = mapMbdDimensionRows([
      {
        id: 'bad',
        dimension_from_x: 'not-a-number',
      },
      {
        id: 'good',
        formatted_label: '1 m',
        dimension_from_x: 0,
        dimension_from_y: 0,
        dimension_from_z: 0,
        dimension_to_x: 1,
        dimension_to_y: 0,
        dimension_to_z: 0,
        label_x: 0.5,
        label_y: 0,
        label_z: 0,
      },
    ], {
      coordinate_space: 'design',
      conversion_factor: 1,
    });

    expect(result.dimensions.map(dimension => dimension.id)).toEqual(['good']);
    expect(result.skipped).toEqual([{
      id: 'bad',
      reason: 'Invalid MBD dimension row geometry or coordinate metadata',
    }]);
  });
});
