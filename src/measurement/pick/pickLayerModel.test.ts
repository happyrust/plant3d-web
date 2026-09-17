import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEASUREMENT_PICK_LAYER,
  MEASUREMENT_PICK_FILTER_AVAILABILITY,
  MEASUREMENT_PICK_FILTER_IDS,
  MEASUREMENT_PICK_TYPE_IDS,
  anySignificantSnapPointEnabled,
  formatMeasurementPrompt,
  measurementPickFilterAdmits,
  measurementPickTypePromptToken,
  normalizeMeasurementPickLayer,
  normalizeMeasurementSignificantSnapPoints,
  type MeasurementPickFeature,
} from './pickLayerModel';

const FEATURES: readonly MeasurementPickFeature[] = [
  'ppoint', 'dpoint', 'pline', 'element', 'tubing', 'surface', 'graphics-line', 'graphics-plane', 'aid', 'external',
];

function admitted(filter: (typeof MEASUREMENT_PICK_FILTER_IDS)[number], pickType: (typeof MEASUREMENT_PICK_TYPE_IDS)[number]) {
  return FEATURES.filter((feature) => measurementPickFilterAdmits(filter, pickType, feature));
}

describe('measurementPickFilterAdmits · E3D EDGPICK filters', () => {
  it('Any = E3D stdAny "Element, Ppoint or Pline" (+ design points with the P-points, + TUBING from the element pick); the Web surface point only with Cursor; never detail graphics / aids / external', () => {
    expect(admitted('any', 'snap')).toEqual(['ppoint', 'dpoint', 'pline', 'element', 'tubing']);
    expect(admitted('any', 'exact')).toEqual(['ppoint', 'dpoint', 'pline', 'element', 'tubing', 'surface']);
    expect(admitted('any', 'midpoint')).toEqual(['ppoint', 'dpoint', 'pline', 'element', 'tubing']);
  });

  it('Any × 非 Cursor 不放行表面点（golden MD §35 补采 2026-09-16）：E3D stdAny 落在直管 / 元素上回的是 TUBING / ELEMENT，不是表面位置——否则 0 px 的表面点盖过只顶在 18 px 孔径边上的轴线', () => {
    for (const pickType of MEASUREMENT_PICK_TYPE_IDS) {
      const surfaceAdmitted = measurementPickFilterAdmits('any', pickType, 'surface');
      expect(surfaceAdmitted, `any × ${pickType}`).toBe(pickType === 'exact');
      // 与 Element 同一口径；Screen 过滤器本来就是「屏幕位置 → 表面点」，任何类型都放行。
      expect(measurementPickFilterAdmits('element', pickType, 'surface')).toBe(surfaceAdmitted);
      expect(measurementPickFilterAdmits('screen', pickType, 'surface')).toBe(true);
      // 轴线 / 元素 / P-Point / PLINE / 设计点在 Any 下不因拾取类型而变。
      for (const feature of ['tubing', 'element', 'ppoint', 'pline', 'dpoint'] as const) {
        expect(measurementPickFilterAdmits('any', pickType, feature), `any × ${pickType} × ${feature}`).toBe(true);
      }
    }
  });

  it('Graphics = E3D stdGraphics (pickdetail): facet edges and facets only', () => {
    for (const pickType of MEASUREMENT_PICK_TYPE_IDS) {
      expect(admitted('graphics', pickType)).toEqual(['graphics-line', 'graphics-plane']);
    }
  });

  it('Element admits element significant points and the implied tube (EDGPICKDATA data[1] = TUBING); the surface point only with Cursor (edgTypes.exact())', () => {
    expect(admitted('element', 'snap')).toEqual(['element', 'tubing']);
    expect(admitted('element', 'exact')).toEqual(['element', 'tubing', 'surface']);
    // Pline / Ppoint / Graphics never see the tube axis.
    expect(admitted('pline', 'snap')).not.toContain('tubing');
    expect(admitted('ppoint', 'snap')).not.toContain('tubing');
    expect(admitted('graphics', 'snap')).not.toContain('tubing');
  });

  it('Ppoint / Pline / Screen / Aid / External each admit their own feature class (Ppoint also the DPOINT design points, E3D stdPpoint)', () => {
    expect(admitted('ppoint', 'snap')).toEqual(['ppoint', 'dpoint']);
    expect(admitted('element', 'snap')).not.toContain('dpoint');
    expect(admitted('pline', 'snap')).toEqual(['pline']);
    expect(admitted('screen', 'snap')).toEqual(['surface']);
    expect(admitted('aid', 'snap')).toEqual(['aid']);
    expect(admitted('external', 'snap')).toEqual(['external']);
  });

  it('Graphics and Aid are available (Aid since the session aid store, §7 Q3); External stays parked', () => {
    expect(MEASUREMENT_PICK_FILTER_AVAILABILITY.graphics).toEqual({ available: true });
    expect(MEASUREMENT_PICK_FILTER_AVAILABILITY.aid).toEqual({ available: true });
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

  it('Fraction[<v>]：输入即按 E3D pad 输入框的 dp 0 四舍五入（提示矩阵 D2 (a)，2026-09-17 实机）——提示 / 落库 / 内核同一个整数', () => {
    // E3D 3.1 live (golden MD §40): the pad's `text .input is REAL format !!edgFormat` runs with `!!integerFmt`
    // (dp 0) while Fraction is selected, so `gadget.val` is already rounded when `setInput` stores it.
    const typed = (fraction: unknown) => normalizeMeasurementPickLayer({ pickType: 'fraction', values: { fraction } }).values.fraction;
    expect(typed('2.5')).toBe(3);
    expect(typed(2.5)).toBe(3);
    expect(measurementPickTypePromptToken('fraction', { distanceMm: 0, fraction: typed('2.5'), proportion: 0.5 })).toBe('Fraction[3]');
    // The 00:13 / 06:44 scan on the running E3D: nearest integer, halves away from zero, no clamp (0 is legal).
    const scan: readonly [number, number][] = [[2.4, 2], [2.5, 3], [2.6, 3], [1.5, 2], [3.5, 4], [0.4, 0], [0.6, 1], [1.9, 2]];
    for (const [input, expected] of scan) {
      expect(typed(input), `typed ${input}`).toBe(expected);
    }
    expect(measurementPickTypePromptToken('fraction', { distanceMm: 0, fraction: typed(0.4), proportion: 0.5 })).toBe('Fraction[0]');
    // PML `REAL.string()`-like: integers stay bare, no trailing zeros; non-numeric → E3D default 2.
    expect(measurementPickTypePromptToken('fraction', { distanceMm: 0, fraction: 3, proportion: 0.5 })).toBe('Fraction[3]');
    expect(typed('abc')).toBe(2);
    // Distance / Proportion are still kept as typed (their gadget formats carry decimals).
    expect(normalizeMeasurementPickLayer({ values: { distanceMm: '12.5', proportion: 0.25 } }).values).toEqual({
      distanceMm: 12.5,
      fraction: 2,
      proportion: 0.25,
    });
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

  it('non-positioning (stdGraphics) picks drop the `(token)` segment and the Snap tail — E3D `Measure angle between lines first line :` (prompt matrix D1)', () => {
    // Significant Snaps on and a Cursor token set: neither may leak into the Angle 2 Lines prompt.
    expect(formatMeasurementPrompt({
      command: '两线夹角',
      stepIndex: 1,
      stepTotal: 2,
      stepHint: '选择第一条线',
      pickTypeToken: 'Cursor',
      significantSnaps: true,
      positioning: false,
      target: '等待捕捉（网格边 / 面（Graphics））',
    })).toBe('两线夹角 · 第 1/2 步 选择第一条线 : 等待捕捉（网格边 / 面（Graphics））');
    // The Web-only segments (step counter, first-line echo, target, trailer) stay.
    expect(formatMeasurementPrompt({
      command: '两线夹角',
      stepIndex: 2,
      stepTotal: 2,
      stepHint: '选择第二条线或面（第一条：BOX 边）',
      pickTypeToken: 'Distance[100]',
      significantSnaps: true,
      positioning: false,
      target: 'BOX 面',
      trailer: '；点空白取消当前点选',
    })).toBe('两线夹角 · 第 2/2 步 选择第二条线或面（第一条：BOX 边） : BOX 面；点空白取消当前点选');
    // `positioning` defaults to true: positioning picks are unchanged.
    expect(formatMeasurementPrompt({
      command: '距离测量',
      stepIndex: 1,
      stepTotal: 2,
      stepHint: '选择起点',
      pickTypeToken: 'Cursor',
      significantSnaps: true,
      positioning: true,
    })).toBe('距离测量 · 第 1/2 步 选择起点 (Cursor) Snap :');
  });
});

describe('normalizeMeasurementPickLayer', () => {
  it('defaults to E3D Any × Snap × Significant Snaps and rejects unavailable / unknown ids', () => {
    expect(normalizeMeasurementPickLayer(undefined)).toEqual(DEFAULT_MEASUREMENT_PICK_LAYER);
    expect(normalizeMeasurementPickLayer({ filter: 'graphics', pickType: 'exact' })).toMatchObject({
      filter: 'graphics',
      pickType: 'exact',
    });
    expect(normalizeMeasurementPickLayer({ filter: 'external', pickType: 'bogus', significantSnaps: 'no' })).toEqual(
      DEFAULT_MEASUREMENT_PICK_LAYER,
    );
    expect(normalizeMeasurementPickLayer({ filter: 'aid' }).filter).toBe('aid');
    expect(normalizeMeasurementPickLayer({ pickType: 'intersect' }).pickType).toBe('intersect');
    // Empty / non-numeric → E3D defaults; a numeric Fraction is rounded like the dp-0 gadget (prompt matrix D2 (a)),
    // not clamped to ≥ 1 — 0.2 → 0 is what E3D stores too.
    expect(normalizeMeasurementPickLayer({ values: { fraction: 0.2, distanceMm: '', proportion: 'x' } }).values).toEqual({
      distanceMm: 0,
      fraction: 0,
      proportion: 0.5,
    });
  });

  it('Pick Settings（Sections & Walls）：EDGPLINE 构造缺省 cut / fitting / joint / node 全 false；三档按字段合并，非布尔回缺省', () => {
    expect(DEFAULT_MEASUREMENT_PICK_LAYER.plineCut).toBe(false);
    expect(DEFAULT_MEASUREMENT_PICK_LAYER.significantSnapPoints).toEqual({ fitting: false, joint: false, node: false });
    // V9 及更早持久化的没有这两格 → 缺省。
    expect(normalizeMeasurementPickLayer({ filter: 'pline' })).toMatchObject({
      plineCut: false,
      significantSnapPoints: { fitting: false, joint: false, node: false },
    });
    expect(normalizeMeasurementPickLayer({ plineCut: true, significantSnapPoints: { node: true, joint: 'yes' } })).toMatchObject({
      plineCut: true,
      significantSnapPoints: { fitting: false, joint: false, node: true },
    });
    expect(normalizeMeasurementPickLayer({ plineCut: 'cut', significantSnapPoints: null }).plineCut).toBe(false);
    expect(anySignificantSnapPointEnabled({ fitting: false, joint: false, node: false })).toBe(false);
    expect(anySignificantSnapPointEnabled({ fitting: false, joint: true, node: false })).toBe(true);
    expect(normalizeMeasurementSignificantSnapPoints('junk')).toEqual({ fitting: false, joint: false, node: false });
  });
});
