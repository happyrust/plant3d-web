import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutAngular } from './angular';

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
  arcChoice: 'minor' | 'major' = 'minor',
  overrides: Partial<Extract<NormalizedDimensionInput, { kind: 'angular' }>> = {},
): Extract<NormalizedDimensionInput, { kind: 'angular' }> {
  return {
    id: `angular-${arcChoice}`,
    kind: 'angular',
    role: 'normal',
    labelPinned: false,
    vertex: [0, 0, 0],
    rayA: [1, 0, 0],
    rayB: [0, 1, 0],
    placement: { radiusM: 0.3, labelT: 0.5, arcChoice },
    ...overrides,
  };
}

describe('layoutAngular', () => {
  it('lays out deterministic 90 degree minor and 270 degree major arcs', () => {
    const minor = layoutAngular(input('minor'), context);
    const major = layoutAngular(input('major'), context);
    const arcCount = (result: typeof minor) =>
      result.primitives.filter(
        (primitive) => primitive.kind === 'line' && primitive.part === 'arc',
      ).length;

    expect(minor.derived).toEqual({ valueRad: Math.PI / 2, formattedLabel: '90.00°' });
    expect(major.derived).toEqual({
      valueRad: (3 * Math.PI) / 2,
      formattedLabel: '270.00°',
    });
    expect(arcCount(minor)).toBeLessThanOrEqual(23);
    expect(arcCount(major)).toBeGreaterThan(arcCount(minor));
    const majorArcLines = major.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'arc',
    );
    for (const line of majorArcLines) {
      const fromAngle = Math.atan2(-(line.from[1] - 200), line.from[0] - 200);
      const toAngle = Math.atan2(-(line.to[1] - 200), line.to[0] - 200);
      const delta = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
      expect(Math.abs(delta)).toBeLessThanOrEqual((4 * Math.PI) / 180 + 1e-9);
    }
  });

  it('enforces the 15 px minimum radius and extends rays by 5 px', () => {
    const result = roundNumbers(
      layoutAngular(
        input('minor', {
          placement: { radiusM: 0.01, labelT: 0.5, arcChoice: 'minor' },
        }),
        context,
      ),
    );
    const lines = result.primitives.filter(
      (primitive): primitive is ScreenLine => primitive.kind === 'line',
    );
    const extensions = lines.filter((line) => line.part === 'extension');
    const arrows = lines.filter((line) => line.part === 'arrow');

    expect(Math.hypot(arrows[0].from[0] - 200, arrows[0].from[1] - 200)).toBeCloseTo(15, 6);
    expect(extensions).toEqual([
      {
        kind: 'line',
        from: [200, 200],
        to: [220, 200],
        part: 'extension',
        styleRole: 'normal',
      },
      {
        kind: 'line',
        from: [200, 200],
        to: [200, 180],
        part: 'extension',
        styleRole: 'normal',
      },
    ]);
  });

  it('trims the arc through the label bounds', () => {
    const result = layoutAngular(input(), context);
    const arcLines = result.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'arc',
    );
    const isStrictlyInside = (point: readonly [number, number]) =>
      point[0] > result.labelBounds.x &&
      point[0] < result.labelBounds.x + result.labelBounds.width &&
      point[1] > result.labelBounds.y &&
      point[1] < result.labelBounds.y + result.labelBounds.height;

    expect(
      arcLines.every((line) => {
        const midpoint = [
          (line.from[0] + line.to[0]) / 2,
          (line.from[1] + line.to[1]) / 2,
        ] as const;
        return !isStrictlyInside(midpoint);
      }),
    ).toBe(true);
  });

  it('extends the arc and reverses arrows for an outside label', () => {
    const result = layoutAngular(
      input('minor', {
        placement: { radiusM: 0.3, labelT: 1.25, arcChoice: 'minor' },
      }),
      context,
    );
    const arrows = result.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'arrow',
    );
    const arcs = result.primitives.filter(
      (primitive): primitive is ScreenLine =>
        primitive.kind === 'line' && primitive.part === 'arc',
    );

    expect(arrows[0].to[1]).toBeGreaterThan(arrows[0].from[1]);
    expect(Math.min(...arcs.flatMap((line) => [line.from[0], line.to[0]]))).toBeLessThan(200);
  });

  it('produces no trusted numeric layout for degenerate rays', () => {
    const result = layoutAngular(input('minor', { rayA: [0, 0, 0] }), context);

    expect(result.primitives).toEqual([]);
    expect(result.derived.formattedLabel).toBe('');
  });
});
