import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutRadial } from './radial';

import type { NormalizedDimensionInput, SceneLine, ScreenLine, Vec2 } from '../types';
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
  it('#72 引线端点在设计空间里，换相机只改投影', () => {
    const angle = Math.PI / 5;
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
    const leaderAnchors = (view: LayoutContext) => {
      const result = layoutRadial(input('diameter'), view);
      expect(result.derived.valueM).toBe(1);
      return result.scenePrimitives
        .filter((primitive): primitive is SceneLine => primitive.kind === 'scene-line')
        .flatMap(line => [line.from.anchor, line.to.anchor]);
    };
    for (const anchor of [...leaderAnchors(context), ...leaderAnchors(rotated)]) {
      expect(anchor[2]).toBeCloseTo(0, 6);
      expect(anchor[0]).toBeCloseTo(anchor[1], 5);
    }
    const front = layoutRadial(input('diameter'), context).primitives.find(item => item.kind === 'line');
    const side = layoutRadial(input('diameter'), rotated).primitives.find(item => item.kind === 'line');
    expect(front?.kind).toBe('line');
    expect(side?.kind).toBe('line');
    if (front?.kind === 'line' && side?.kind === 'line') {
      expect(side.from[0]).not.toBeCloseTo(front.from[0]);
    }
  });

  it('uses identical geometry with radius and diameter formatting', () => {
    const radius = roundNumbers(layoutRadial(input('radius'), context));
    const diameter = roundNumbers(layoutRadial(input('diameter'), context));
    const lines = (result: typeof radius) =>
      result.primitives.filter(
        (primitive): primitive is ScreenLine => primitive.kind === 'line',
      );

    expect(radius.derived).toEqual({ valueM: 0.5, formattedLabel: 'R500.00' });
    expect(diameter.derived).toEqual({ valueM: 1, formattedLabel: '⌀1000.00' });
    const radiusLeader = present(lines(radius)[0], 'radius leader line');
    const diameterLeader = present(lines(diameter)[0], 'diameter leader line');
    expect(radiusLeader.from).toEqual(diameterLeader.from);
    const radiusVector: Vec2 = [
      radiusLeader.to[0] - radiusLeader.from[0],
      radiusLeader.to[1] - radiusLeader.from[1],
    ];
    const diameterVector: Vec2 = [
      diameterLeader.to[0] - diameterLeader.from[0],
      diameterLeader.to[1] - diameterLeader.from[1],
    ];
    expect(
      radiusVector[0] * diameterVector[1] - radiusVector[1] * diameterVector[0],
    ).toBeCloseTo(0, 6);
  });

  it('projects the leader direction into the circle plane and trims the label end', () => {
    const result = layoutRadial(input('radius'), context);
    const leader = present(
      result.primitives.find(
        (primitive): primitive is ScreenLine =>
          primitive.kind === 'line' && primitive.part === 'leader',
      ),
      'leader line',
    );

    expect(present(leader.from[0], 'leader from x') - 200).toBeCloseTo(
      200 - present(leader.from[1], 'leader from y'),
      12,
    );
    expect(present(leader.to[0], 'leader to x')).toBeLessThan(
      result.labelBounds.x + result.labelBounds.width,
    );
    expect(present(leader.to[1], 'leader to y')).toBeGreaterThan(result.labelBounds.y);
  });

  it('honors authoritative labels for external dimensions', () => {
    const result = layoutRadial(
      input('radius', {
        role: 'external',
        authoritativeText: 'SOURCE-R',
      }),
      context,
    );

    expect(layoutRadial(input('radius', { rim: [0, 0, 0] }), context).derived.validationErrors)
      .toEqual(['DEGENERATE_RADIAL_RADIUS']);
    expect(result.derived.formattedLabel).toBe('SOURCE-R');
    expect(result.primitives.at(-1)).toMatchObject({
      kind: 'glyph-run',
      text: 'SOURCE-R',
      styleRole: 'external',
    });
  });
});
