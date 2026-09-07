import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutLinear } from './linear';

import type { ViewportProjector } from '../projector';
import type { NormalizedDimensionInput, Vec3 } from '../types';
import type { LayoutContext } from './context';

function perspectiveProjector(): ViewportProjector {
  const widthCssPx = 400;
  const heightCssPx = 400;
  const scaleAt = (point: Vec3) => 100 / (2 + point[2]);
  return {
    widthCssPx,
    heightCssPx,
    dpr: 2,
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, -1],
    project(point) {
      const scale = scaleAt(point);
      return {
        x: 200 + point[0] * scale,
        y: 200 - point[1] * scale,
        depth: point[2],
      };
    },
    unproject(point) {
      const scale = 100 / (2 + point.depth);
      return [
        (point.x - 200) / scale,
        (200 - point.y) / scale,
        point.depth,
      ];
    },
    worldPerPixelAt(point) {
      return 1 / scaleAt(point);
    },
  };
}

function context(projector: ViewportProjector): LayoutContext {
  return {
    projector,
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    interaction: 'normal',
  };
}

describe('authoritative scene layout golden', () => {
  it('keeps authored geometry and values stable across orthographic and perspective cameras', () => {
    const input: Extract<NormalizedDimensionInput, { kind: 'linear' }> = {
      id: 'camera-invariant-linear',
      kind: 'linear',
      role: 'normal',
      labelPinned: false,
      a: [0, 0, 0],
      b: [1, 0, 0],
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    };
    const orthographic = layoutLinear(input, context(createTestProjector()));
    const perspective = layoutLinear(input, context(perspectiveProjector()));
    const labelOf = (layout: typeof orthographic) => layout.scenePrimitives.find(
      primitive => primitive.kind === 'scene-glyph-run',
    );

    expect(orthographic.derived).toEqual(perspective.derived);
    expect(labelOf(orthographic)).toMatchObject({
      at: { anchor: [0.5, 0, 0] },
    });
    expect(labelOf(perspective)).toMatchObject({
      at: { anchor: [0.5, 0, 0] },
    });
    expect(orthographic.scenePrimitives.map(primitive => primitive.kind))
      .toEqual(perspective.scenePrimitives.map(primitive => primitive.kind));
    expect(labelOf(orthographic)?.at.offsetPx)
      .not.toEqual(labelOf(perspective)?.at.offsetPx);
  });
});
