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

const GLOBAL_MM = { unit: 'mm', precision: 2 } as const;

describe('E3D Units 契约（gphmeasure 719–799 + comformats 1301–1356）', () => {
  it('Unit type 三档与 Display Unit 两组按 E3D 的 dText / rText 排列', () => {
    expect(measurementDisplayUnitOptions('default')).toEqual([]);
    expect(measurementDisplayUnitOptions('metric').map((o) => [o.token, o.label])).toEqual([
      ['MM', 'Millimetres'],
      ['CM', 'Centimetres'],
      ['METRE', 'Metres'],
    ]);
    expect(measurementDisplayUnitOptions('imperial').map((o) => [o.token, o.label])).toEqual([
      ['IN', 'Inch'],
      ['FINC', 'Feet & Inches'],
      ['FT', 'Feet'],
    ]);
  });

  it('缺省停在 Default 档，两套记忆都是各自第一项，Display Unit 无选中项', () => {
    expect(DEFAULT_MEASUREMENT_UNIT_SELECTION).toEqual({
      unitSystem: 'default',
      metricUnit: 'MM',
      imperialUnit: 'IN',
    });
    expect(measurementSelectedDisplayUnit(DEFAULT_MEASUREMENT_UNIT_SELECTION)).toBeNull();
  });

  it('两套 Display Unit 各记各的上次选择，来回切 Unit type 各自回到自己的那一档', () => {
    let selection: MeasurementUnitSelection = DEFAULT_MEASUREMENT_UNIT_SELECTION;
    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'metric' });
    selection = applyMeasurementUnitSelection(selection, { displayUnit: 'METRE' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('METRE');

    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'imperial' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('IN');
    selection = applyMeasurementUnitSelection(selection, { displayUnit: 'FINC' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('FINC');

    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'metric' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('METRE');
    selection = applyMeasurementUnitSelection(selection, { unitSystem: 'imperial' });
    expect(measurementSelectedDisplayUnit(selection)).toBe('FINC');
  });

  it('不属于当前那一套的 Display Unit 不落库（那个下拉此刻没有这一项）', () => {
    const metric = applyMeasurementUnitSelection(DEFAULT_MEASUREMENT_UNIT_SELECTION, {
      unitSystem: 'metric',
    });
    expect(applyMeasurementUnitSelection(metric, { displayUnit: 'FT' })).toEqual(metric);
  });

  it('FORMAT 参数逐格对上 comformats.distanceFormat', () => {
    expect(measurementDistanceFormatForUnit('MM')).toMatchObject({ units: 'MM', dp: 2, trailZeros: false });
    expect(measurementDistanceFormatForUnit('CM')).toMatchObject({ units: 'CM', dp: 3, trailZeros: false });
    expect(measurementDistanceFormatForUnit('METRE')).toMatchObject({ units: 'METRE', dp: 3, trailZeros: false });
    expect(measurementDistanceFormatForUnit('FT')).toMatchObject({ units: 'FT', dp: 3, trailZeros: true });
    expect(measurementDistanceFormatForUnit('IN')).toMatchObject({
      units: 'INCH',
      fraction: true,
      denominator: 32,
      inchSeparator: '.',
      label: 'in',
    });
    expect(measurementDistanceFormatForUnit('FINC')).toMatchObject({
      units: 'FINCH',
      fraction: true,
      denominator: 32,
      inchSeparator: '.',
      ftLabel: '\'-',
      label: '"',
      zeros: false,
    });
  });

  it('Default 档回落到全局单位设置（留尾零、按用户位数）', () => {
    const format = resolveMeasurementDistanceFormat(DEFAULT_MEASUREMENT_UNIT_SELECTION, {
      unit: 'm',
      precision: 3,
    });
    expect(format).toMatchObject({ units: 'METRE', dp: 3, trailZeros: true });
    expect(formatMeasurementLengthMeters(2.5, format)).toBe('2.500m');
  });

  it('normalize 把未知档 / 未知单位打回 E3D 缺省', () => {
    expect(normalizeMeasurementUnitSelection(null)).toEqual(DEFAULT_MEASUREMENT_UNIT_SELECTION);
    expect(normalizeMeasurementUnitSelection({ unitSystem: 'nautical', metricUnit: 'KM', imperialUnit: 'YD' }))
      .toEqual(DEFAULT_MEASUREMENT_UNIT_SELECTION);
    expect(normalizeMeasurementUnitSelection({ unitSystem: 'imperial', imperialUnit: 'FT' }))
      .toEqual({ unitSystem: 'imperial', metricUnit: 'MM', imperialUnit: 'FT' });
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

describe('英制格式矩阵（static_expectation：FORMAT 参数取自 PML，渲染在内核）', () => {
  const inch = measurementDistanceFormatForUnit('IN');
  const finch = measurementDistanceFormatForUnit('FINC');
  const feet = measurementDistanceFormatForUnit('FT');

  it('IN：整英寸 + 1/32 约分，inchSeparator 是点', () => {
    expect(formatMeasurementLengthMeters(0.0254, inch)).toBe('1in');
    // 12.5 in = 0.3175 m
    expect(formatMeasurementLengthMeters(0.3175, inch)).toBe('12.1/2in');
    // 3 + 3/32 in
    expect(formatMeasurementLengthMeters((3 + 3 / 32) * 0.0254, inch)).toBe('3.3/32in');
    expect(formatMeasurementLengthMeters(-0.3175, inch)).toBe('-12.1/2in');
  });

  it('IN：不到 1/64 英寸的余量并到整数上，0 不带号', () => {
    expect(formatMeasurementLengthMeters(0.0254 * 4.001, inch)).toBe('4in');
    expect(formatMeasurementLengthMeters(0, inch)).toBe('0in');
    expect(formatMeasurementLengthMeters(-0.0000001, inch)).toBe('0in');
  });

  it('FINC：按 12 英寸拆英尺段，zeros=false 时零英尺不出段', () => {
    // 4 ft 3 1/2 in
    expect(formatMeasurementLengthMeters((4 * 12 + 3.5) * 0.0254, finch)).toBe('4\'-3.1/2"');
    // 0 ft 7 in → 只剩英寸段
    expect(formatMeasurementLengthMeters(7 * 0.0254, finch)).toBe('7"');
    expect(formatMeasurementLengthMeters(-(4 * 12 + 3.5) * 0.0254, finch)).toBe('-4\'-3.1/2"');
  });

  it('FT：3 位小数且留尾零', () => {
    expect(formatMeasurementLengthMeters(0.3048, feet)).toBe('1.000ft');
    expect(formatMeasurementLengthMeters(0, feet)).toBe('0.000ft');
    expect(formatMeasurementLengthMeters(-1.2192, feet, { signed: true })).toBe('-4.000ft');
  });
});
