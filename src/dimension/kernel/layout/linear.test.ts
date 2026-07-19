import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutLinear } from './linear';

import type { NormalizedDimensionInput, ScreenLine } from '../types';
import type { LayoutContext } from './context';

const context: LayoutContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
  interaction: 'normal',
};

function input(
  overrides: Partial<Extract<NormalizedDimensionInput, { kind: 'linear' }>> = {},
): Extract<NormalizedDimensionInput, { kind: 'linear' }> {
  return {
    id: 'linear',
    kind: 'linear',
    role: 'normal',
    labelPinned: false,
    a: [0, 0, 0],
    b: [1, 0, 0],
    placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    ...overrides,
  };
}

describe('layoutLinear', () => {
  it('lays out a centered 1 m horizontal dimension structurally', () => {
    const result = roundNumbers(layoutLinear(input(), context));
    const lines = result.primitives.filter(
      (primitive): primitive is ScreenLine => primitive.kind === 'line',
    );

    expect(result.derived).toEqual({ valueM: 1, formattedLabel: '1000.00' });
    expect(result.labelBounds).toEqual({
      x: 238.525,
      y: 167.375,
      width: 22.95,
      height: 25.25,
    });
    expect(lines.filter((line) => line.part === 'dimension')).toEqual([
      {
        kind: 'line',
        from: [200, 180],
        to: [238.525, 180],
        part: 'dimension',
        styleRole: 'normal',
      },
      {
        kind: 'line',
        from: [261.475, 180],
        to: [300, 180],
        part: 'dimension',
        styleRole: 'normal',
      },
    ]);
    expect(lines.filter((line) => line.part === 'extension')).toEqual([
      {
        kind: 'line',
        from: [200, 200],
        to: [200, 170],
        part: 'extension',
        styleRole: 'normal',
      },
      {
        kind: 'line',
        from: [300, 200],
        to: [300, 170],
        part: 'extension',
        styleRole: 'normal',
      },
    ]);
    expect(result.hitRegions).toHaveLength(result.primitives.length);
  });

  it('reverses arrows and adds the outside segment for an outside label', () => {
    const result = roundNumbers(
      layoutLinear(
        input({ placement: { offsetM: 0.2, labelT: 1.5, side: 1 } }),
        context,
      ),
    );
    const lines = result.primitives.filter(
      (primitive): primitive is ScreenLine => primitive.kind === 'line',
    );
    const arrows = lines.filter((line) => line.part === 'arrow');

    expect(lines).toContainEqual({
      kind: 'line',
      from: [300, 180],
      to: [318, 180],
      part: 'dimension',
      styleRole: 'normal',
    });
    expect(arrows[0].to[0]).toBeLessThan(arrows[0].from[0]);
    expect(arrows[2].to[0]).toBeGreaterThan(arrows[2].from[0]);
  });

  it('uses semantic roles unless interaction state overrides them', () => {
    const approximate = layoutLinear(input({ role: 'approximate' }), context);
    const invalid = layoutLinear(input({ role: 'invalid' }), {
      ...context,
      interaction: 'selected',
    });

    expect(approximate.derived.formattedLabel).toBe('~1000.00');
    expect(approximate.primitives.every((primitive) => primitive.styleRole === 'approximate')).toBe(
      true,
    );
    expect(invalid.derived.formattedLabel).toBe('STALE 1000.00');
    expect(invalid.primitives.every((primitive) => primitive.styleRole === 'selected')).toBe(true);
  });
});
