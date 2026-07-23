import { describe, expect, it } from 'vitest';

import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';

import {
  engineeringTextRotation,
  makeFilledSceneArrow,
  makeSceneLine,
  projectScenePrimitives,
  sceneGlyph,
  sceneVertex,
  sceneVertexAtScreen,
} from './sceneGeometry';

describe('sceneGeometry', () => {
  it('keeps design anchors authoritative while projecting view-plane offsets', () => {
    const projector = createTestProjector();
    const from = sceneVertex([1, 2, 3], [4, -2]);
    const to = sceneVertexAtScreen([2, 2, 3], [410, 20], projector);
    const primitives = projectScenePrimitives([
      makeSceneLine(from, to, 'dimension', 'normal'),
    ], projector, createTestFont());

    expect(from).toEqual({ anchor: [1, 2, 3], offsetPx: [4, -2] });
    expect(roundNumbers(to)).toEqual({
      anchor: [2, 2, 3],
      offsetPx: [10, 20],
    });
    expect(primitives).toEqual([{
      kind: 'line',
      from: [304, -2],
      to: [410, 20],
      part: 'dimension',
      styleRole: 'normal',
    }]);
  });

  it('builds real triangle arrows and auto-flips engineering text', () => {
    const arrow = makeFilledSceneArrow(
      sceneVertex([0, 0, 0], [0, 0]),
      [1, 0],
      8,
      15,
      'normal',
    );

    expect(arrow.kind).toBe('scene-triangle');
    expect(arrow.points).toHaveLength(3);
    expect(roundNumbers(arrow.points[1]?.offsetPx)).toEqual([
      8,
      2.143594,
    ]);
    expect(engineeringTextRotation([10, 0], [0, 0])).toBe(0);
    expect(engineeringTextRotation([0, 10], [0, 0])).toBe(Math.PI / 2);
  });

  it('projects a rotated LFF run with a bounded collision snapshot', () => {
    const projector = createTestProjector();
    const rotationRad = Math.PI / 4;
    const projected = projectScenePrimitives([
      sceneGlyph(
        'A',
        sceneVertex([0, 0, 0]),
        10,
        'normal',
        rotationRad,
      ),
    ], projector, createTestFont());
    const glyph = projected[0];

    expect(glyph?.kind).toBe('glyph-run');
    if (glyph?.kind === 'glyph-run') {
      expect(glyph.rotationRad).toBe(rotationRad);
      expect(glyph.rotationCenter).toEqual([200, 200]);
      expect(glyph.bounds.width).toBeGreaterThan(2);
      expect(glyph.bounds.height).toBeGreaterThan(10);
    }
  });
});
