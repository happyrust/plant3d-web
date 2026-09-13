import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEASUREMENT_PICK_LAYER,
  MEASUREMENT_PICK_FILTER_AVAILABILITY,
  MEASUREMENT_PICK_FILTER_IDS,
  MEASUREMENT_PICK_TYPE_IDS,
  formatMeasurementPrompt,
  measurementPickFilterAdmits,
  measurementPickTypePromptToken,
  normalizeMeasurementPickLayer,
  type MeasurementPickFeature,
} from './pickLayerModel';

const FEATURES: readonly MeasurementPickFeature[] = [
  'ppoint', 'pline', 'element', 'surface', 'graphics-line', 'graphics-plane', 'aid', 'external',
];

function admitted(filter: (typeof MEASUREMENT_PICK_FILTER_IDS)[number], pickType: (typeof MEASUREMENT_PICK_TYPE_IDS)[number]) {
  return FEATURES.filter((feature) => measurementPickFilterAdmits(filter, pickType, feature));
}

describe('measurementPickFilterAdmits · E3D EDGPICK filters', () => {
  it('Any = E3D stdAny "Element, Ppoint or Pline" (+ Web surface point); never detail graphics / aids / external', () => {
    expect(admitted('any', 'snap')).toEqual(['ppoint', 'pline', 'element', 'surface']);
    expect(admitted('any', 'exact')).toEqual(['ppoint', 'pline', 'element', 'surface']);
    expect(admitted('any', 'midpoint')).toEqual(['ppoint', 'pline', 'element', 'surface']);
  });

  it('Graphics = E3D stdGraphics (pickdetail): facet edges and facets only', () => {
    for (const pickType of MEASUREMENT_PICK_TYPE_IDS) {
      expect(admitted('graphics', pickType)).toEqual(['graphics-line', 'graphics-plane']);
    }
  });

  it('Element admits element significant points; the surface point only with Cursor (edgTypes.exact())', () => {
    expect(admitted('element', 'snap')).toEqual(['element']);
    expect(admitted('element', 'exact')).toEqual(['element', 'surface']);
  });

  it('Ppoint / Pline / Screen / Aid / External each admit their own feature class', () => {
    expect(admitted('ppoint', 'snap')).toEqual(['ppoint']);
    expect(admitted('pline', 'snap')).toEqual(['pline']);
    expect(admitted('screen', 'snap')).toEqual(['surface']);
    expect(admitted('aid', 'snap')).toEqual(['aid']);
    expect(admitted('external', 'snap')).toEqual(['external']);
  });

  it('Graphics is available; Aid / External stay parked', () => {
    expect(MEASUREMENT_PICK_FILTER_AVAILABILITY.graphics).toEqual({ available: true });
    expect(MEASUREMENT_PICK_FILTER_AVAILABILITY.aid.available).toBe(false);
    expect(MEASUREMENT_PICK_FILTER_AVAILABILITY.external.available).toBe(false);
  });
});

describe('measurementPickTypePromptToken / formatMeasurementPrompt · EDGSTATE.prompt()', () => {
  it('renders the parenthesised pick-type token like EDGPICKTYPE.set*', () => {
    const values = { distanceMm: 100, fraction: 3, proportion: 0.25 };
    expect(measurementPickTypePromptToken('snap', values)).toBe('Snap');
    expect(measurementPickTypePromptToken('exact', values)).toBe('Cursor');
    expect(measurementPickTypePromptToken('midpoint', values)).toBe('Mid-Point');
    expect(measurementPickTypePromptToken('distance', values)).toBe('Distance[100]');
    expect(measurementPickTypePromptToken('fraction', values)).toBe('Fraction[3]');
    expect(measurementPickTypePromptToken('proportion', values)).toBe('Proportion[0.25]');
    expect(measurementPickTypePromptToken('intersect', values, 2)).toBe('Intersection[2]');
  });

  it('composes `<命令> · <步> (<拾取类型>) [Snap] : <目标><trailer>`', () => {
    expect(formatMeasurementPrompt({
      command: '距离测量',
      stepIndex: 2,
      stepTotal: 2,
      stepHint: '选择终点',
      pickTypeToken: 'Mid-Point',
      significantSnaps: true,
      target: 'ELBO P-Point #1',
      trailer: '；点空白取消当前点选',
    })).toBe('距离测量 · 第 2/2 步 选择终点 (Mid-Point) Snap : ELBO P-Point #1；点空白取消当前点选');
    expect(formatMeasurementPrompt({
      command: '角度测量',
      stepIndex: 1,
      stepTotal: 3,
      pickTypeToken: 'Snap',
      significantSnaps: false,
    })).toBe('角度测量 · 第 1/3 步 (Snap) :');
  });
});

describe('normalizeMeasurementPickLayer', () => {
  it('defaults to E3D Any × Snap × Significant Snaps and rejects unavailable / unknown ids', () => {
    expect(normalizeMeasurementPickLayer(undefined)).toEqual(DEFAULT_MEASUREMENT_PICK_LAYER);
    expect(normalizeMeasurementPickLayer({ filter: 'graphics', pickType: 'exact' })).toMatchObject({
      filter: 'graphics',
      pickType: 'exact',
    });
    expect(normalizeMeasurementPickLayer({ filter: 'aid', pickType: 'bogus', significantSnaps: 'no' })).toEqual(
      DEFAULT_MEASUREMENT_PICK_LAYER,
    );
    expect(normalizeMeasurementPickLayer({ pickType: 'intersect' }).pickType).toBe('intersect');
    expect(normalizeMeasurementPickLayer({ values: { fraction: 0.2, distanceMm: '', proportion: 'x' } }).values).toEqual({
      distanceMm: 0,
      fraction: 1,
      proportion: 0.5,
    });
  });
});
