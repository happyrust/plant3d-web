import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIMENSION_FORMAT,
  formatDimensionLabel,
  type DimensionFormatPolicy,
} from './format';
import { deriveDimensionValue, type DerivedDimensionValue } from './value';

import type { NormalizedDimensionInput } from './types';

const linear = (
  role: NormalizedDimensionInput['role'] = 'normal',
  authoritativeText?: string,
): NormalizedDimensionInput => ({
  id: `linear-${role}`,
  kind: 'linear',
  role,
  labelPinned: false,
  authoritativeText,
  a: [0, 0, 0],
  b: [1, 0, 0],
  placement: { offsetM: 0.1, labelT: 0.5, side: 1 },
});

describe('formatDimensionLabel', () => {
  it('formats viewport-selected length units and angles', () => {
    const centimetres: DimensionFormatPolicy = {
      ...DEFAULT_DIMENSION_FORMAT,
      lengthUnit: 'cm',
      lengthDecimals: 1,
      angleDecimals: 0,
    };
    const angle: NormalizedDimensionInput = {
      id: 'angle',
      kind: 'angular',
      role: 'normal',
      labelPinned: false,
      vertex: [0, 0, 0],
      rayA: [1, 0, 0],
      rayB: [0, 1, 0],
      placement: { labelT: 0.5, arcChoice: 'minor' },
    };

    expect(formatDimensionLabel(linear(), deriveDimensionValue(linear()), centimetres)).toEqual({
      ok: true,
      text: '100.0',
    });
    expect(formatDimensionLabel(angle, deriveDimensionValue(angle), centimetres)).toEqual({
      ok: true,
      text: '90°',
    });
  });

  it('applies radial, reference, approximate, and stale semantics', () => {
    const radial: NormalizedDimensionInput = {
      id: 'diameter',
      kind: 'radial',
      role: 'normal',
      labelPinned: false,
      center: [0, 0, 0],
      rim: [0.5, 0, 0],
      normal: [0, 0, 1],
      display: 'diameter',
      placement: { leaderDirection: [1, 1, 0], labelDistanceM: 0.25 },
    };

    expect(
      formatDimensionLabel(radial, deriveDimensionValue(radial), DEFAULT_DIMENSION_FORMAT),
    ).toEqual({ ok: true, text: '⌀1000.00' });
    expect(
      formatDimensionLabel(
        linear('external-reference'),
        deriveDimensionValue(linear('external-reference')),
        DEFAULT_DIMENSION_FORMAT,
      ),
    ).toEqual({ ok: true, text: '1000.00 REF' });
    expect(
      formatDimensionLabel(
        linear('approximate'),
        deriveDimensionValue(linear('approximate')),
        DEFAULT_DIMENSION_FORMAT,
      ),
    ).toEqual({ ok: true, text: '~1000.00' });
    expect(
      formatDimensionLabel(
        linear('invalid'),
        deriveDimensionValue(linear('invalid')),
        DEFAULT_DIMENSION_FORMAT,
      ),
    ).toEqual({ ok: true, text: 'STALE 1000.00' });
  });

  it('#73 单位、尾零、角度和 MBD 原文走同一张表，不读区域设置', () => {
    const oneMetre = deriveDimensionValue(linear());
    const angle: NormalizedDimensionInput = {
      id: 'angle',
      kind: 'angular',
      role: 'normal',
      labelPinned: false,
      vertex: [0, 0, 0],
      rayA: [1, 0, 0],
      rayB: [0, 1, 0],
      placement: { labelT: 0.5, arcChoice: 'minor' },
    };
    const rightAngle = deriveDimensionValue(angle);
    const table: readonly (readonly [DimensionFormatPolicy, NormalizedDimensionInput, DerivedDimensionValue, string])[] = [
      [{ ...DEFAULT_DIMENSION_FORMAT, lengthUnit: 'm', lengthDecimals: 3 }, linear(), oneMetre, '1.000'],
      [{ ...DEFAULT_DIMENSION_FORMAT, lengthUnit: 'in', lengthDecimals: 3, trailingZeros: false }, linear(), oneMetre, '39.37'],
      [{ ...DEFAULT_DIMENSION_FORMAT, lengthUnit: 'ft', lengthDecimals: 4, trailingZeros: false }, linear(), oneMetre, '3.2808'],
      [{ ...DEFAULT_DIMENSION_FORMAT, angleUnit: 'rad', angleDecimals: 4, trailingZeros: false }, angle, rightAngle, '1.5708 rad'],
      [{ ...DEFAULT_DIMENSION_FORMAT, lengthDecimals: 2, trailingZeros: false }, linear(), oneMetre, '1000'],
    ];
    for (const [policy, input, value, text] of table) {
      expect(formatDimensionLabel(input, value, policy)).toEqual({ ok: true, text });
    }
    expect(formatDimensionLabel(
      linear('external', 'MBD-TEXT'),
      oneMetre,
      { ...DEFAULT_DIMENSION_FORMAT, lengthUnit: 'in', trailingZeros: false },
    )).toEqual({ ok: true, text: 'MBD-TEXT' });
    expect(formatDimensionLabel(linear(), oneMetre, {
      ...DEFAULT_DIMENSION_FORMAT,
      locale: 'zh-CN',
    })).toEqual({ ok: false, reason: 'unsupported-locale' });
    expect(formatDimensionLabel(linear(), oneMetre, DEFAULT_DIMENSION_FORMAT)).toEqual({
      ok: true,
      text: '1000.00',
    });
  });

  it('accepts authoritative text only for external dimensions', () => {
    expect(
      formatDimensionLabel(
        linear('external', 'SOURCE'),
        deriveDimensionValue(linear('external', 'SOURCE')),
        DEFAULT_DIMENSION_FORMAT,
      ),
    ).toEqual({ ok: true, text: 'SOURCE' });
    expect(
      formatDimensionLabel(
        linear('external-reference', 'SOURCE'),
        deriveDimensionValue(linear('external-reference', 'SOURCE')),
        DEFAULT_DIMENSION_FORMAT,
      ),
    ).toEqual({ ok: true, text: 'SOURCE REF' });
    expect(
      formatDimensionLabel(
        linear('normal', 'OVERRIDE'),
        deriveDimensionValue(linear('normal', 'OVERRIDE')),
        DEFAULT_DIMENSION_FORMAT,
      ),
    ).toEqual({ ok: false, reason: 'authoritative-text-for-user-dimension' });
  });
});
