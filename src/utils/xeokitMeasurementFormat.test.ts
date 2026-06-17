import { describe, expect, it } from 'vitest';

import { formatMeasurementSummary } from './xeokitMeasurementFormat';

describe('xeokitMeasurementFormat', () => {
  it('formats legacy entity ids and source metadata together', () => {
    expect(formatMeasurementSummary({
      id: 'x1',
      kind: 'distance',
      origin: {
        entityId: 'o:24381_145018:0',
        worldPos: [0, 0, 0],
        sourceInfo: {
          source: 'ptset',
          candidateId: 'ptset:24381_145018#1',
          refno: '24381_145018',
          label: 'PTSET #1',
        },
      },
      target: {
        entityId: '24381_145019',
        worldPos: [1, 0, 0],
        sourceInfo: {
          source: 'mesh_pick_point',
          candidateId: 'mesh:o:24381_145019:0',
          refno: '24381_145019',
          label: 'Mesh Pick Point',
        },
      },
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'm', 3)).toBe(
      '起点 24381/145018 (PTSET #1) -> 终点 24381/145019 (Mesh Pick Point)',
    );
  });

  it('keeps elevation summaries readable for old records without sourceInfo', () => {
    expect(formatMeasurementSummary({
      id: 'e1',
      kind: 'elevation_point',
      point: { entityId: 'o:24381_145018:0', worldPos: [0, 0, 3] },
      absoluteElevation: 3,
      relativeElevation: 1,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'm', 2)).toContain('点 24381/145018');
  });
});
