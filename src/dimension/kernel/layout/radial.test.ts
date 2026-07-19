import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutRadial } from './radial';

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
  display: 'radius' | 'diameter',
  overrides: Partial<Extract<NormalizedDimensionInput, { kind: 'radial' }>> = {},
): Extract<NormalizedDimensionInput, { kind: 'radial' }> {
  return {
    id: `radial-${display}`,
    kind: 'radial',
    role: 'normal',
    labelPinned: false,
    center: [0, 0, 0],
    rim: [0.5, 0, 0],
    normal: [0, 0, 1],
    display,
    placement: { leaderDirection: [1, 1, 5], labelDistanceM: 0.25 },
    ...overrides,
  };
}

describe('layoutRadial', () => {
  it('uses identical geometry with radius and diameter formatting', () => {
    const radius = roundNumbers(layoutRadial(input('radius'), context));
    const diameter = roundNumbers(layoutRadial(input('diameter'), context));
    const lines = (result: typeof radius) =>
      result.primitives.filter(
        (primitive): primitive is ScreenLine => primitive.kind === 'line',
      );

    expect(radius.derived).toEqual({ valueM: 0.5, formattedLabel: 'R500.00' });
    expect(diameter.derived).toEqual({ valueM: 1, formattedLabel: '⌀1000.00' });
    const radiusLeader = lines(radius)[0];
    const diameterLeader = lines(diameter)[0];
    expect(radiusLeader.from).toEqual(diameterLeader.from);
    const radiusVector = [
      radiusLeader.to[0] - radiusLeader.from[0],
      radiusLeader.to[1] - radiusLeader.from[1],
    ];
    const diameterVector = [
      diameterLeader.to[0] - diameterLeader.from[0],
      diameterLeader.to[1] - diameterLeader.from[1],
    ];
    expect(radiusVector[0] * diameterVector[1] - radiusVector[1] * diameterVector[0]).toBeCloseTo(
      0,
      6,
    );
  });

  it('projects the leader direction into the circle plane and trims the label end', () => {
    const result = layoutRadial(input('radius'), context);
    const leader = result.primitives.find(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'leader',
    );

    expect(leader).toBeDefined();
    expect(leader!.from[0] - 200).toBeCloseTo(200 - leader!.from[1], 12);
    expect(leader!.to[0]).toBeLessThan(result.labelBounds.x + result.labelBounds.width);
    expect(leader!.to[1]).toBeGreaterThan(result.labelBounds.y);
  });

  it('honors authoritative labels for external dimensions', () => {
    const result = layoutRadial(
      input('radius', {
        role: 'external',
        authoritativeText: 'SOURCE-R',
      }),
      context,
    );

    expect(result.derived.formattedLabel).toBe('SOURCE-R');
    expect(result.primitives.at(-1)).toMatchObject({
      kind: 'glyph-run',
      text: 'SOURCE-R',
      styleRole: 'external',
    });
  });
});
