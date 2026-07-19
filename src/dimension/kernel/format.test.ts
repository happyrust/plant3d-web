import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIMENSION_FORMAT,
  formatDimensionLabel,
  type DimensionFormatPolicy,
} from './format';
import { deriveDimensionValue } from './value';

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
