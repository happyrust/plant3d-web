import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEASUREMENT_UNIT_SELECTION,
  applyMeasurementUnitSelection,
  formatMeasurementLengthMeters,
  measurementDisplayUnitOptions,
  measurementDistanceFormatForUnit,
  measurementSelectedDisplayUnit,
  normalizeMeasurementUnitSelection,
  resolveMeasurementDistanceFormat,
  type MeasurementUnitSelection,
} from './measurementUnits';

describe('E3D Units 契约（gphmeasure 719–799 + comformats 1301–1356，英制不做 / Q4）', () => {
  it('Unit type 只留 Default / Metric，Display Unit 按 E3D 的 dText / rText 排列', () => {
    expect(measurementDisplayUnitOptions('default')).toEqual([]);
    expect(measurementDisplayUnitOptions('metric').map((o) => [o.token, o.label])).toEqual([
      ['MM', 'Millimetres'],
      ['CM', 'Centimetres'],
      ['METRE', 'Metres'],
    ]);
  });

  it('缺省停在 Default 档，Display Unit 记忆是第一项且无选中项', () => {
    expect(DEFAULT_MEASUREMENT_UNIT_SELECTION).toEqual({ unitSystem: 'default', metricUnit: 'MM' });
    expect(measurementSelectedDisplayUnit(DEFAULT_MEASUREMENT_UNIT_SELECTION)).toBeNull();
  });

  it('Display Unit 的上次选择记得住，来回切 Unit type 回到同一档', () => {
    let selection: MeasurementUnitSelection = DEFAULT_MEASUREMENT_UNIT_SELECTION;
    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'metric' });
    selection = applyMeasurementUnitSelection(selection, { displayUnit: 'METRE' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('METRE');

    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'default' });
    expect(measurementSelectedDisplayUnit(selection)).toBeNull();
    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'metric' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('METRE');
  });

  it('Default 档下拉是灰的，这时候送进来的 Display Unit 不落库', () => {
    const metre = applyMeasurementUnitSelection(
      applyMeasurementUnitSelection(DEFAULT_MEASUREMENT_UNIT_SELECTION, { unitSystem: 'metric' }),
      { displayUnit: 'METRE' },
    );
    const back = applyMeasurementUnitSelection(metre, { unitSystem: 'default' });
    expect(applyMeasurementUnitSelection(back, { displayUnit: 'CM' })).toEqual(back);
  });

  it('FORMAT 参数逐格对上 comformats.distanceFormat 的公制三档', () => {
    expect(measurementDistanceFormatForUnit('MM')).toEqual({ units: 'MM', label: 'UNITS', dp: 2, trailZeros: false });
    expect(measurementDistanceFormatForUnit('CM')).toEqual({ units: 'CM', label: 'UNITS', dp: 3, trailZeros: false });
    expect(measurementDistanceFormatForUnit('METRE')).toEqual({ units: 'METRE', label: 'UNITS', dp: 3, trailZeros: false });
  });

  it('Default 档回落到全局单位设置（留尾零、按用户位数）', () => {
    const format = resolveMeasurementDistanceFormat(DEFAULT_MEASUREMENT_UNIT_SELECTION, {
      unit: 'm',
      precision: 3,
    });
    expect(format).toEqual({ units: 'METRE', label: 'UNITS', dp: 3, trailZeros: true });
    expect(formatMeasurementLengthMeters(2.5, format)).toBe('2.500m');
  });

  it('normalize 把未知档 / 未知单位打回缺省；旧配置里存过的 imperial 也回 Default', () => {
    expect(normalizeMeasurementUnitSelection(null)).toEqual(DEFAULT_MEASUREMENT_UNIT_SELECTION);
    expect(normalizeMeasurementUnitSelection({ unitSystem: 'nautical', metricUnit: 'KM' }))
      .toEqual(DEFAULT_MEASUREMENT_UNIT_SELECTION);
    expect(normalizeMeasurementUnitSelection({ unitSystem: 'imperial', metricUnit: 'CM', imperialUnit: 'FT' }))
      .toEqual({ unitSystem: 'default', metricUnit: 'CM' });
  });
});

describe('公制格式矩阵', () => {
  const mm = measurementDistanceFormatForUnit('MM');
  const cm = measurementDistanceFormatForUnit('CM');
  const metre = measurementDistanceFormatForUnit('METRE');

  it('MM：2 位小数、去尾零（= !!distanceFmt，golden G1-04）', () => {
    expect(formatMeasurementLengthMeters(2, mm)).toBe('2000mm');
    expect(formatMeasurementLengthMeters(2.23607, mm)).toBe('2236.07mm');
    expect(formatMeasurementLengthMeters(0.00009, mm)).toBe('0.09mm');
  });

  it('MM：0 / 负零一律 `0mm`，不出 `-0mm`', () => {
    expect(formatMeasurementLengthMeters(0, mm)).toBe('0mm');
    expect(formatMeasurementLengthMeters(0.000004, mm)).toBe('0mm');
    expect(formatMeasurementLengthMeters(-0.000004, mm)).toBe('0mm');
    expect(formatMeasurementLengthMeters(-0.00000001, mm, { signed: true })).toBe('0mm');
  });

  it('CM / METRE：3 位小数、去尾零', () => {
    expect(formatMeasurementLengthMeters(2, cm)).toBe('200cm');
    expect(formatMeasurementLengthMeters(0.012346, cm)).toBe('1.235cm');
    expect(formatMeasurementLengthMeters(2, metre)).toBe('2m');
    expect(formatMeasurementLengthMeters(2.23607, metre)).toBe('2.236m');
  });

  it('Offset 行按 signed 出正负号，负值不管 signed 都带号', () => {
    expect(formatMeasurementLengthMeters(1.5, mm, { signed: true })).toBe('+1500mm');
    expect(formatMeasurementLengthMeters(-1.5, mm, { signed: true })).toBe('-1500mm');
    expect(formatMeasurementLengthMeters(-1.5, mm)).toBe('-1500mm');
  });

  it('separator / suffix 开关只影响标签，不影响数值', () => {
    expect(formatMeasurementLengthMeters(2, mm, { separator: ' ' })).toBe('2000 mm');
    expect(formatMeasurementLengthMeters(2, mm, { suffix: false })).toBe('2000');
  });
});
