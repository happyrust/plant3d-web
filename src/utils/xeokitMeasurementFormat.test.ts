import { describe, expect, it } from 'vitest';

import {
  buildAngleMeasurementResultRows,
  buildDistanceMeasurementResultRows,
  buildMeasurementComponentsText,
  buildMeasurementValueText,
  buildPerpendicularMeasurementResultRows,
  computeDistanceMeasurementResult,
  computeDistanceMeasurementResultInFrame,
  computeElevationDeltaMeasurementResultInFrame,
  computeElevationPointMeasurementResultInFrame,
  formatMeasurementSummary,
} from './xeokitMeasurementFormat';

import type { ResolvedReferenceFrame } from '@/measurement/reference-frame';

function frame(
  axisLabels: ResolvedReferenceFrame['axisLabels'] = ['U', 'V', 'W'],
): ResolvedReferenceFrame {
  return {
    kind: 'element',
    refno: '7_8',
    origin: [10, 20, 30],
    basis: {
      u: [0, 1, 0],
      v: [-1, 0, 0],
      w: [0, 0, 1],
    },
    axisLabels,
    provenance: {
      resolution: 'explicit-refno',
      selector: { kind: 'refno', refno: '7_8' },
      currentElementRefno: null,
      resolvedRefno: '7_8',
      resolvedOwnerRefno: null,
      element: { source: 'test' },
      basis: {
        policy: 'orthonormalize',
        action: 'accepted',
        rawNorms: [1, 1, 1],
        maxOrthogonalityError: 0,
        rawHandedness: 1,
        tolerance: 1e-6,
      },
    },
  };
}

function worldFrame(): ResolvedReferenceFrame {
  return {
    kind: 'world',
    refno: null,
    origin: [0, 0, 0],
    basis: { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] },
    axisLabels: ['X', 'Y', 'Z'],
    provenance: {
      resolution: 'world',
      selector: { kind: 'world' },
      currentElementRefno: null,
      resolvedRefno: null,
      resolvedOwnerRefno: null,
      element: null,
      basis: {
        policy: 'orthonormalize',
        action: 'identity',
        rawNorms: [1, 1, 1],
        maxOrthogonalityError: 0,
        rawHandedness: 1,
        tolerance: 1e-6,
      },
    },
  };
}

describe('computeDistanceMeasurementResult', () => {
  it('derives distance, world offsets, and a unit direction vector', () => {
    const result = computeDistanceMeasurementResult(
      { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
      { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [1.2, -0.3, 0.05] },
    );
    expect(result).not.toBeNull();
    expect(result!.wrt).toBe('world');
    expect(result!.distance).toBeCloseTo(Math.hypot(1.2, -0.3, 0.05));
    expect(result!.offsets).toEqual({
      frame: 'world',
      components: [1.2, -0.3, 0.05],
    });
    expect(result!.direction!.vector[0]).toBeCloseTo(1.2 / result!.distance);
    expect(Math.hypot(...result!.direction!.vector)).toBeCloseTo(1);

    expect(buildDistanceMeasurementResultRows(result!, 'mm', 1)).toEqual([
      { key: 'distance', label: 'Distance', valueText: '1237.9mm' },
      { key: 'offset-x', label: 'Offset X', valueText: '+1200.0mm' },
      { key: 'offset-y', label: 'Offset Y', valueText: '-300.0mm' },
      { key: 'offset-z', label: 'Offset Z', valueText: '+50.0mm' },
      {
        key: 'direction',
        label: 'Direction',
        // E3D 标准结果表原样显示 `DIRECTION.string()` 的 ` WRT /*` 尾巴（截图 G1-02-result）；
        // 数字是 PML REAL 的 6 位有效数字（2.31478，不是 4 位小数的 2.3148）。
        valueText: 'E 14.0362 S 2.31478 U WRT /*',
      },
    ]);
  });

  it('golden G1 / G2-03：Direction 单元格逐字对上 E3D 标准结果表', () => {
    // G1：from E 9769.75 N 10047.18 U 18664.8 → to E 7849.61 N 10447.46 U 14234.127。
    const g1 = computeDistanceMeasurementResult(
      { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [9.76975, 10.04718, 18.6648] },
      { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [7.84961, 10.44746, 14.234127] },
    );
    expect(buildDistanceMeasurementResultRows(g1!, 'mm', 2).at(-1)!.valueText).toBe('W 11.7755 N 66.1215 D WRT /*');
    // G2-03：ΔE = ΔN = ΔU = 1000 → 水平打平时 E / W 在前。
    const g203 = computeDistanceMeasurementResult(
      { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [10, 10, 15] },
      { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [11, 11, 16] },
    );
    expect(buildDistanceMeasurementResultRows(g203!, 'mm', 2).at(-1)!.valueText).toBe('E 45 N 35.2644 U WRT /*');
  });

  it('returns null direction for zero distance and rejects missing or non-finite design coords', () => {
    const zero = computeDistanceMeasurementResult(
      { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [1, 1, 1] },
      { entityId: 'b', worldPos: [0, 0, 0], designWorldPos: [1, 1, 1] },
    );
    expect(zero!.distance).toBe(0);
    expect(zero!.direction).toBeNull();
    expect(buildDistanceMeasurementResultRows(zero!, 'm', 2).at(-1))
      .toEqual({ key: 'direction', label: 'Direction', valueText: '--' });

    expect(computeDistanceMeasurementResult(
      { entityId: 'a', worldPos: [0, 0, 0] },
      { entityId: 'b', worldPos: [1, 1, 1] },
    )).toBeNull();
    expect(computeDistanceMeasurementResult(
      { entityId: 'a', worldPos: [0, 0, 0], designWorldPos: [0, Number.NaN, 0] },
      { entityId: 'b', worldPos: [1, 1, 1], designWorldPos: [1, 1, 1] },
    )).toBeNull();
  });
});

describe('buildPerpendicularMeasurementResultRows', () => {
  it('reports Distance / Vertical / Horizontal / Direction from the foot to the source (golden G4-02 real pick)', () => {
    // origin = picked source E 8000 N 9000 U 16500, target = foot on the plane E 8000 N 10500 U 16500.
    const rows = buildPerpendicularMeasurementResultRows(
      { entityId: 'src', worldPos: [8, 9, 16.5], designWorldPos: [8, 9, 16.5] },
      { entityId: 'foot', worldPos: [8, 10.5, 16.5], designWorldPos: [8, 10.5, 16.5] },
      'mm',
      2,
    );
    expect(rows).toEqual([
      { key: 'distance', label: 'Distance', valueText: '1500.00mm' },
      { key: 'vertical', label: 'Vertical', valueText: '0.00mm' },
      { key: 'horizontal', label: 'Horizontal', valueText: '1500.00mm' },
      // golden G4-02 实测的 Direction 就是这一个字母。
      { key: 'direction', label: 'Direction', valueText: 'S' },
    ]);
  });

  it('splits an inclined perpendicular into World vertical and horizontal parts (golden G4-01)', () => {
    // foot E 11000 N 9000 U 15000 → source E 11000 N 9500 U 17500: 2549.51 / 2500 / 500.
    const rows = buildPerpendicularMeasurementResultRows(
      { entityId: 'src', worldPos: [11, 9.5, 17.5], designWorldPos: [11, 9.5, 17.5] },
      { entityId: 'foot', worldPos: [11, 9, 15], designWorldPos: [11, 9, 15] },
      'mm',
      2,
    );
    expect(rows.map(row => row.valueText)).toEqual([
      '2549.51mm',
      '2500.00mm',
      '500.00mm',
      // golden G4-01 实测 `N 78.6901 U`。
      'N 78.6901 U',
    ]);
  });

  it('golden G4-03 点退化：Direction 是 6 位有效数字、这张表不带 WRT 尾巴', () => {
    // trace G4-current-perpendicular：from（垂足）E 9897.433 N 8954.701 U 13330.416，
    // to（源点）E 9769.75 N 10047.176 U 18664.801；E3D 单元格 `N 6.66615 W 78.3493 U`。
    // 坐标只印到 3 位小数，第一个角的第 6 位有效数字吃到取整，只锁前缀；倾角逐字。
    const rows = buildPerpendicularMeasurementResultRows(
      { entityId: 'src', worldPos: [0, 0, 0], designWorldPos: [9.76975, 10.047176, 18.664801] },
      { entityId: 'foot', worldPos: [0, 0, 0], designWorldPos: [9.897433, 8.954701, 13.330416] },
      'mm',
      2,
    );
    expect(rows[0]!.valueText).toBe('5446.60mm');
    // vertical_db 5334.38438847279 → E3D `5334.38mm`；这里 U 坐标各带 3 位小数取整，落在 .385 附近。
    expect(rows[1]!.valueText).toMatch(/^5334\.3[89]mm$/);
    expect(rows[2]!.valueText).toBe('1099.91mm');
    expect(rows[3]!.valueText).toMatch(/^N 6\.666\d{1,2} W 78\.3493 U$/);
  });

  it('returns no rows when a design position is missing and "--" for zero distance', () => {
    expect(buildPerpendicularMeasurementResultRows(
      { entityId: 'src', worldPos: [0, 0, 0] },
      { entityId: 'foot', worldPos: [0, 0, 0], designWorldPos: [0, 0, 0] },
      'm',
      2,
    )).toEqual([]);
    expect(buildPerpendicularMeasurementResultRows(
      { entityId: 'src', worldPos: [0, 0, 0], designWorldPos: [1, 1, 1] },
      { entityId: 'foot', worldPos: [0, 0, 0], designWorldPos: [1, 1, 1] },
      'm',
      2,
    ).at(-1)).toEqual({ key: 'direction', label: 'Direction', valueText: '--' });
  });
});

describe('reference-frame measurement interpretation', () => {
  it('projects distance offsets and direction into a rotated U/V/W frame', () => {
    const origin = {
      entityId: 'a',
      worldPos: [0, 0, 0] as [number, number, number],
      designWorldPos: [10, 20, 30] as [number, number, number],
    };
    const target = {
      entityId: 'b',
      worldPos: [0, 0, 0] as [number, number, number],
      designWorldPos: [8, 23, 34] as [number, number, number],
    };
    const result = computeDistanceMeasurementResultInFrame(origin, target, frame());

    expect(result?.distance).toBeCloseTo(Math.hypot(-2, 3, 4));
    expect(result?.offsets.components).toEqual([3, 2, 4]);
    expect(result?.axisLabels).toEqual(['U', 'V', 'W']);
    expect(buildDistanceMeasurementResultRows(result!, 'm', 2)).toEqual([
      { key: 'distance', label: 'Distance', valueText: '5.39m' },
      { key: 'offset-x', label: 'Offset U', valueText: '+3.00m' },
      { key: 'offset-y', label: 'Offset V', valueText: '+2.00m' },
      { key: 'offset-z', label: 'Offset W', valueText: '+4.00m' },
      {
        key: 'direction',
        label: 'Direction',
        // 罗盘字母按帧的三根轴走：轴 1 → E / W、轴 2 → N / S、轴 3 → U / D；
        // 尾巴是这条方向的 wrt，元素帧按 E3D 无名元素的写法 `=<refno>`。
        valueText: 'E 33.6901 N 47.9689 U WRT =7/8',
      },
    ]);
    expect(buildMeasurementComponentsText({
      id: 'distance-frame',
      kind: 'distance',
      origin,
      target,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'm', 2, frame())).toBe('U +3.00m\nV +2.00m\nW +4.00m');
    expect(origin.designWorldPos).toEqual([10, 20, 30]);
    expect(target.designWorldPos).toEqual([8, 23, 34]);
  });

  it('uses frame W for point elevation and high difference', () => {
    const referenceFrame = frame(['E', 'N', 'U']);
    const origin = {
      entityId: 'a',
      worldPos: [0, 0, 0] as [number, number, number],
      designWorldPos: [10, 20, 31] as [number, number, number],
    };
    const target = {
      entityId: 'b',
      worldPos: [0, 0, 0] as [number, number, number],
      designWorldPos: [8, 23, 34] as [number, number, number],
    };

    expect(computeElevationPointMeasurementResultInFrame(
      target,
      1.5,
      referenceFrame,
    )).toMatchObject({
      position: [3, 2, 4],
      absoluteElevation: 4,
      relativeElevation: 2.5,
      axisLabels: ['E', 'N', 'U'],
    });
    expect(computeElevationDeltaMeasurementResultInFrame(
      origin,
      target,
      referenceFrame,
    )).toMatchObject({
      originElevation: 1,
      targetElevation: 4,
      deltaElevation: 3,
      verticalAxisLabel: 'U',
    });
    expect(formatMeasurementSummary({
      id: 'elevation-frame',
      kind: 'elevation_point',
      point: target,
      absoluteElevation: 34,
      datumElevation: 1.5,
      relativeElevation: 32.5,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'm', 2, { referenceFrame })).toContain(
      'WRT 7/8 E 3.00m N 2.00m U 4.00m · 绝对 +4.00m · 相对基准 +2.50m',
    );
    expect(formatMeasurementSummary({
      id: 'delta-frame',
      kind: 'elevation_delta',
      origin,
      target,
      originElevation: 31,
      targetElevation: 34,
      deltaElevation: 3,
      datumElevation: 0,
      visible: true,
      approximate: false,
      createdAt: 1,
    }, 'm', 2, { referenceFrame })).toContain(
      '起点 a +1.00m · 终点 b +4.00m · 高差 +3.00m',
    );
  });
});

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

  it('shows World distance and signed XYZ axis deltas for new measurement points', () => {
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
      '距离 180.3cm · X +100.0cm · Y -150.0cm · Z +0.0cm',
    );

    // 关闭轴向分量时只保留总长与端点信息。
    const compact = formatMeasurementSummary(record, 'cm', 1, { showAxisBreakdown: false });
    expect(compact).toContain('距离 180.3cm');
    expect(compact).not.toContain('X +100.0cm');
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
      // E3D Measure Angle 的结果表单元格：数值 + 空格 + 单位词（Decimal Places 缺省 2、去尾零）。
    }, 'mm', 0)).toBe('90 Degrees');

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
    }, 'mm', 0)).toBe('X +1200mm\nY -300mm\nZ +50mm');

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

describe('buildAngleMeasurementResultRows · E3D Measure Angle 结果表（golden G6-01 / 02 / 03）', () => {
  const point = (designWorldPos: [number, number, number]) => ({
    entityId: 'p',
    worldPos: [0, 0, 0] as [number, number, number],
    designWorldPos,
  });
  // root / first / second：E3D 的三点顺序，Web 草稿里是 corner / origin / target。
  const ROOT = point([10, 10, 15]);
  const FIRST = point([12, 10, 15]);
  const SECOND_NORTH = point([10, 12, 15]);

  it('四行 Decimal Angle / DMS / Direction1 / Direction2，缺省 Default 档 + 两位小数', () => {
    expect(buildAngleMeasurementResultRows(ROOT, FIRST, SECOND_NORTH, worldFrame())).toEqual([
      { key: 'angle', label: 'Decimal Angle', valueText: '90 Degrees' },
      { key: 'dms', label: 'DMS', valueText: '90° 0\' 0\'\'' },
      { key: 'direction1', label: 'Direction1', valueText: 'E' },
      { key: 'direction2', label: 'Direction2', valueText: 'N' },
    ]);
  });

  it('两条臂的方向随 wrt 帧换分量与轴标签，角度本身不变', () => {
    const rows = buildAngleMeasurementResultRows(ROOT, FIRST, SECOND_NORTH, frame());
    expect(rows[0]).toEqual({ key: 'angle', label: 'Decimal Angle', valueText: '90 Degrees' });
    // 帧基 u=[0,1,0] v=[-1,0,0] w=[0,0,1]：root→first 的世界 +X 在帧里是 -V。
    expect(rows[2]!.valueText).toBe('S');
    expect(rows[3]!.valueText).toBe('E');
  });

  it('Units 框：Unit 换算与 Decimal Places 同时管角度值和两条 Direction；DMS 恒按度', () => {
    const rows = buildAngleMeasurementResultRows(
      ROOT,
      FIRST,
      point([11, 11, 15]),
      worldFrame(),
      { unit: 'radians', decimalPlaces: 4 },
    );
    expect(rows[0]!.valueText).toBe('0.7854 Radians');
    expect(rows[1]!.valueText).toBe('45° 0\' 0\'\'');
    expect(rows[2]!.valueText).toBe('E');

    const gradians = buildAngleMeasurementResultRows(
      ROOT,
      FIRST,
      SECOND_NORTH,
      worldFrame(),
      { unit: 'gradians', decimalPlaces: 0 },
    );
    expect(gradians[0]!.valueText).toBe('100 Gradians');
    expect(gradians[2]!.valueText).toBe('E');
  });

  it('0° / 180° / 重合点回空数组（E3D 这几种造不出 ARC，窗体走 alert.error）', () => {
    // 0°：second 与 first 同向；180°：反向；重合：second 落在 root 上。
    expect(buildAngleMeasurementResultRows(ROOT, FIRST, point([13, 10, 15]), worldFrame())).toEqual([]);
    expect(buildAngleMeasurementResultRows(ROOT, FIRST, point([8, 10, 15]), worldFrame())).toEqual([]);
    expect(buildAngleMeasurementResultRows(ROOT, FIRST, ROOT, worldFrame())).toEqual([]);
    expect(buildAngleMeasurementResultRows(
      ROOT,
      { entityId: 'p', worldPos: [0, 0, 0] },
      SECOND_NORTH,
      worldFrame(),
    )).toEqual([]);
  });

  it('列表摘要把三行接在点串前面；退化时只剩点串', () => {
    const record = {
      id: 'a1',
      kind: 'angle' as const,
      origin: FIRST,
      corner: ROOT,
      target: SECOND_NORTH,
      visible: true,
      approximate: false,
      createdAt: 1,
    };
    const summary = formatMeasurementSummary(record, 'mm', 0, { referenceFrame: worldFrame() });
    expect(summary.startsWith('Decimal Angle 90 Degrees · DMS 90° 0\' 0\'\' · Direction1 E · Direction2 N')).toBe(true);
    expect(summary).toContain('起点');
    expect(buildMeasurementValueText(record, 'mm', 0, worldFrame())).toBe('90 Degrees');

    const collinear = { ...record, target: point([13, 10, 15]) };
    expect(formatMeasurementSummary(collinear, 'mm', 0, { referenceFrame: worldFrame() })
      .startsWith('起点')).toBe(true);
    expect(buildMeasurementValueText(collinear, 'mm', 0, worldFrame())).toBeNull();
  });
});
