import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutAngular } from './angular';

import type {
  NormalizedDimensionInput,
  SceneLine,
  ScreenGlyphRun,
  ScreenLine,
  Vec2,
} from '../types';
import type { LayoutContext } from './context';

import { present } from '@/testing/present';

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

    const firstArrow = present(arrows[0], 'first arrow line');
    expect(
      Math.hypot(
        present(firstArrow.from[0], 'arrow from x') - 200,
        present(firstArrow.from[1], 'arrow from y') - 200,
      ),
    ).toBeCloseTo(15, 6);
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
    const glyph = present(
      result.primitives.find(
        (primitive): primitive is ScreenGlyphRun =>
          primitive.kind === 'glyph-run',
      ),
      'label glyph run',
    );
    const isStrictlyInside = (point: Vec2) => {
      const center = present(glyph.rotationCenter, 'glyph rotation center');
      const rotation = -(glyph.rotationRad ?? 0);
      const dx = point[0] - center[0];
      const dy = point[1] - center[1];
      const local: Vec2 = [
        center[0] + dx * Math.cos(rotation) - dy * Math.sin(rotation),
        center[1] + dx * Math.sin(rotation) + dy * Math.cos(rotation),
      ];
      const bounds = glyph.unrotatedBounds ?? glyph.bounds;
      return local[0] > bounds.x
        && local[0] < bounds.x + bounds.width
        && local[1] > bounds.y
        && local[1] < bounds.y + bounds.height;
    };

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

    const firstArrow = present(arrows[0], 'first arrow line');
    expect(present(firstArrow.to[1], 'arrow to y')).toBeGreaterThan(
      present(firstArrow.from[1], 'arrow from y'),
    );
    expect(Math.min(...arcs.flatMap((line) => [line.from[0], line.to[0]]))).toBeLessThan(200);
  });

  it('produces no trusted numeric layout for degenerate rays', () => {
    const zero = layoutAngular(input('minor', { rayA: [0, 0, 0] }), context);
    expect(zero.primitives).toEqual([]);
    expect(zero.derived.formattedLabel).toBe('');
    expect(zero.derived.validationErrors).toEqual(['DEGENERATE_ANGULAR_RAY']);

    const collinear = layoutAngular(input('minor', { rayB: [2, 0, 0] }), context);
    expect(collinear.primitives).toEqual([]);
    expect(collinear.derived.validationErrors).toEqual(['COLLINEAR_ANGULAR_RAYS']);
  });

  it('#71 持久化的角度平面让弧留在设计平面里，换相机不改角度值', () => {
    const planar = input('minor', { planeNormal: [0, 0, 1] });
    const angle = Math.PI / 6;
    const right: [number, number, number] = [Math.cos(angle), 0, -Math.sin(angle)];
    const rotated: LayoutContext = {
      ...context,
      projector: {
        ...createTestProjector(),
        right,
        forward: [-Math.sin(angle), 0, -Math.cos(angle)],
        project: point => ({
          x: 200 + (point[0] * right[0] + point[2] * right[2]) * 100,
          y: 200 - point[1] * 100,
          depth: 0,
        }),
      },
    };
    const front = layoutAngular(planar, context);
    const side = layoutAngular(planar, rotated);
    expect(front.derived.valueRad).toBeCloseTo(Math.PI / 2);
    expect(side.derived.valueRad).toBeCloseTo(present(front.derived.valueRad, 'front angle'));
    for (const result of [front, side]) {
      const arcs = result.scenePrimitives.filter(
        (primitive): primitive is SceneLine =>
          primitive.kind === 'scene-line' && primitive.part === 'arc',
      );
      expect(arcs.length).toBeGreaterThan(0);
      for (const line of arcs) {
        expect(line.from.anchor[2]).toBeCloseTo(0, 6);
        expect(line.to.anchor[2]).toBeCloseTo(0, 6);
      }
    }
  });
});
