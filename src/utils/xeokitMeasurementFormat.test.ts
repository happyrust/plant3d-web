import { describe, expect, it } from 'vitest';

import {
  buildMeasurementComponentsText,
  buildMeasurementValueText,
  formatMeasurementSummary,
} from './xeokitMeasurementFormat';

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
      '起点 24381/145018 (P-Point PTSET #1) -> 终点 24381/145019 (模型表面点 Mesh Pick Point)',
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

  it('shows World distance and signed E/N/U axis deltas for new measurement points', () => {
    const record = {
      id: 'x2',
      kind: 'distance',
      origin: {
        entityId: 'a',
        worldPos: [2, 4, 6],
        designWorldPos: [12, 24, 36],
      },
      target: {
        entityId: 'b',
        worldPos: [3, 2.5, 6],
        designWorldPos: [13, 22.5, 36],
      },
      visible: true,
      approximate: false,
      createdAt: 1,
    } satisfies Parameters<typeof formatMeasurementSummary>[0];

    expect(formatMeasurementSummary(record, 'cm', 1)).toContain(
      '距离 180.3cm · E +100.0cm · N -150.0cm · U +0.0cm',
    );

    // 关闭轴向分量时只保留总长与端点信息。
    const compact = formatMeasurementSummary(record, 'cm', 1, { showAxisBreakdown: false });
    expect(compact).toContain('距离 180.3cm');
    expect(compact).not.toContain('E +100.0cm');
  });

  it('shows engineering World XYZ for new position measurements', () => {
    expect(formatMeasurementSummary({
      id: 'e2',
      kind: 'elevation_point',
      point: {
        entityId: 'o:24381_145018:0',
        worldPos: [2, 4, 6],
        designWorldPos: [12, 24, 36],
      },
      absoluteElevation: 36,
      datumElevation: 6,
      relativeElevation: 30,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'cm', 1)).toContain(
      'World X 1200.0cm Y 2400.0cm Z 3600.0cm',
    );
  });

  it('builds copyable value text per measurement kind', () => {
    expect(buildMeasurementValueText({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [1.52, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'mm', 0)).toBe('1520mm');

    expect(buildMeasurementValueText({
      id: 'a1',
      kind: 'angle',
      origin: { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [1, 0, 0] },
      corner: { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
      target: { entityId: 'c', worldPos: [0, 0, 0], designWorldPos: [0, 1, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'mm', 0)).toBe('90.0°');

    expect(buildMeasurementValueText({
      id: 'e1',
      kind: 'elevation_point',
      point: { entityId: 'a', worldPos: [0, 0, 3] },
      absoluteElevation: 3.25,
      datumElevation: 0,
      relativeElevation: 3.25,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'm', 2)).toBe('+3.25m');

    // 距离测量缺少工程坐标时返回 null，调用方负责提示。
    expect(buildMeasurementValueText({
      id: 'x2',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'mm', 0)).toBeNull();
  });

  it('builds multi-line axis component text for distance measurements only', () => {
    expect(buildMeasurementComponentsText({
      id: 'x1',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [1.2, -0.3, 0.05] },
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'mm', 0)).toBe('E +1200mm\nN -300mm\nU +50mm');

    expect(buildMeasurementComponentsText({
      id: 'e1',
      kind: 'elevation_point',
      point: { entityId: 'a', worldPos: [0, 0, 3] },
      absoluteElevation: 3,
      datumElevation: 0,
      relativeElevation: 3,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'mm', 0)).toBeNull();
  });
});
