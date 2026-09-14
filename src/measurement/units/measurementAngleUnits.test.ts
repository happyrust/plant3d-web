import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION,
  MEASUREMENT_ANGLE_UNITS,
  convertAngleFromDegrees,
  formatMeasurementAngle,
  formatMeasurementAngleDms,
  formatMeasurementAngleScalar,
  isMeasurementAngleDecimalsValid,
  measurementAngleUnitWord,
  normalizeMeasurementAngleUnitSelection,
} from './measurementAngleUnits';

describe('E3D Measure Angle 的 Units 契约（gphanglemeasure 45–54 / 95–101 / 318–410）', () => {
  it('Unit 下拉四档按 E3D 的 add 顺序；缺省停在 Default、小数位 2', () => {
    expect(MEASUREMENT_ANGLE_UNITS.map((o) => o.label)).toEqual([
      'Default',
      'Degrees',
      'Radians',
      'Gradians',
    ]);
    expect(DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION).toEqual({ unit: 'default', decimalPlaces: 2 });
  });

  it('Default 档的单位词是 Degrees（Web 没有「工程当前角度单位」这一层）', () => {
    expect(measurementAngleUnitWord('default')).toBe('Degrees');
    expect(measurementAngleUnitWord('radians')).toBe('Radians');
    expect(measurementAngleUnitWord('gradians')).toBe('Gradians');
  });

  it('Decimal Places 只收 0–8 的整数，别的一律非法（E3D 打回 2 并报错）', () => {
    for (const ok of [0, 2, 8, '0', '8']) expect(isMeasurementAngleDecimalsValid(ok)).toBe(true);
    for (const bad of [-1, 9, 2.5, 'abc', '', null, undefined, Number.NaN]) {
      expect(isMeasurementAngleDecimalsValid(bad)).toBe(false);
    }
  });

  it('normalize 把未知单位与越界小数位打回缺省', () => {
    expect(normalizeMeasurementAngleUnitSelection(null)).toEqual(DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION);
    expect(normalizeMeasurementAngleUnitSelection({ unit: 'turns', decimalPlaces: 12 }))
      .toEqual({ unit: 'default', decimalPlaces: 2 });
    expect(normalizeMeasurementAngleUnitSelection({ unit: 'radians', decimalPlaces: 0 }))
      .toEqual({ unit: 'radians', decimalPlaces: 0 });
  });

  it('换算：度 / 弧度 / 梯度', () => {
    expect(convertAngleFromDegrees(90, 'degrees')).toBeCloseTo(90, 9);
    expect(convertAngleFromDegrees(90, 'default')).toBeCloseTo(90, 9);
    expect(convertAngleFromDegrees(90, 'radians')).toBeCloseTo(Math.PI / 2, 9);
    expect(convertAngleFromDegrees(90, 'gradians')).toBeCloseTo(100, 9);
    expect(convertAngleFromDegrees(Number.NaN, 'degrees')).toBe(0);
  });
});

describe('角度格式矩阵', () => {
  it('`Decimal Angle` 行是「数值 空格 单位词」，且去尾零（angleFmt 的 trailZeros=false）', () => {
    expect(formatMeasurementAngle(40.538564, { unit: 'default', decimalPlaces: 2 })).toBe('40.54 Degrees');
    expect(formatMeasurementAngle(90, { unit: 'degrees', decimalPlaces: 2 })).toBe('90 Degrees');
    expect(formatMeasurementAngle(90, { unit: 'radians', decimalPlaces: 4 })).toBe('1.5708 Radians');
    expect(formatMeasurementAngle(90, { unit: 'gradians', decimalPlaces: 2 })).toBe('100 Gradians');
    expect(formatMeasurementAngle(40.538564, { unit: 'degrees', decimalPlaces: 0 })).toBe('41 Degrees');
    expect(formatMeasurementAngle(40.538564, { unit: 'degrees', decimalPlaces: 6 })).toBe('40.538564 Degrees');
  });

  it('小数位也管方向那几个数：`realFmt` 留尾零，角度值那一格才去尾零', () => {
    expect(formatMeasurementAngleScalar(-0.38801234, 4)).toBe('-0.3880');
    expect(formatMeasurementAngleScalar(-0.38801234, 2)).toBe('-0.39');
    expect(formatMeasurementAngleScalar(1, 4)).toBe('1.0000');
    expect(formatMeasurementAngleScalar(1, 4, { trailZeros: false })).toBe('1');
    expect(formatMeasurementAngleScalar(-0.0000001, 4)).toBe('0.0000');
  });

  it('`DMS` 行按十进制度截断出度 / 分 / 秒，与 Unit 无关', () => {
    // 40.538564° = 40° 32' 18.8''，E3D 三处都是 int() 截断
    expect(formatMeasurementAngleDms(40.538564)).toBe('40° 32\' 18\'\'');
    expect(formatMeasurementAngleDms(90)).toBe('90° 0\' 0\'\'');
    expect(formatMeasurementAngleDms(0.5)).toBe('0° 30\' 0\'\'');
    // 0.9° 正好是 54'，E3D 那边三处也都是 int()：秒位落在 0 上。
    expect(formatMeasurementAngleDms(179.9)).toBe('179° 54\' 0\'\'');
    expect(formatMeasurementAngleDms(37.4013215953213)).toBe('37° 24\' 4\'\'');
  });
});
