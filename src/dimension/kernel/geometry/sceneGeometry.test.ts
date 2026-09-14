import { describe, expect, it } from 'vitest';

import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';

import {
  CLIPPED_SCREEN_POINT,
  engineeringTextRotation,
  isClippedPrimitive,
  isSceneVertexVisible,
  makeFilledSceneArrow,
  makeSceneLine,
  projectScenePrimitives,
  sceneFill,
  sceneGlyph,
  sceneMarker,
  scenePath,
  sceneVertex,
  sceneVertexAtScreen,
} from './sceneGeometry';

import type { Vec3 } from '../types';

describe('sceneGeometry', () => {
  it('keeps design anchors authoritative while projecting view-plane offsets', () => {
    // The test projector reports depth = z; the snapshot clips outside
    // [−1, 1] like the GPU (see below), so the anchors sit at z = 0.3.
    const projector = createTestProjector();
    const from = sceneVertex([1, 2, 0.3], [4, -2]);
    const to = sceneVertexAtScreen([2, 2, 0.3], [410, 20], projector);
    const primitives = projectScenePrimitives([
      makeSceneLine(from, to, 'dimension', 'normal'),
    ], projector, createTestFont());

    expect(from).toEqual({ anchor: [1, 2, 0.3], offsetPx: [4, -2] });
    expect(roundNumbers(to)).toEqual({
      anchor: [2, 2, 0.3],
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

  it('clips the projected snapshot to the frustum the way the GPU clips the scene', () => {
    // Test projector: x = 200 + X·100, y = 200 − Y·100, depth = Z; the GPU
    // draws depths within [−1, 1], so z = 2 is behind the camera (or beyond
    // the far plane — perspective projection still returns a finite,
    // mirrored point for it, which is the phantom this guards against).
    const projector = createTestProjector();
    const font = createTestFont();
    const front: Vec3 = [0, 0, 0];
    const behind: Vec3 = [1, 1, 2];
    expect(isSceneVertexVisible(sceneVertex(front), projector)).toBe(true);
    expect(isSceneVertexVisible(sceneVertex(behind), projector)).toBe(false);

    // A stroke leaving the frustum is cut where its depth reaches 1 (halfway
    // here); one entirely outside keeps its slot as an empty stand-in.
    const [cut, gone] = projectScenePrimitives([
      makeSceneLine(sceneVertex(front), sceneVertex(behind), 'dimension', 'normal'),
      makeSceneLine(sceneVertex(behind), sceneVertex([2, 2, 3]), 'dimension', 'normal'),
    ], projector, font);
    expect(cut!.kind).toBe('line');
    if (cut!.kind === 'line') {
      expect(cut!.from).toEqual([200, 200]);
      expect(cut!.to[0]).toBeCloseTo(250, 5);
      expect(cut!.to[1]).toBeCloseTo(150, 5);
    }
    expect(gone).toMatchObject({ kind: 'line', from: CLIPPED_SCREEN_POINT, to: CLIPPED_SCREEN_POINT });
    expect(isClippedPrimitive(gone!)).toBe(true);
    expect(isClippedPrimitive(cut!)).toBe(false);

    // A closed outline is clipped as a polygon (two cut points replace the
    // two clipped corners); an open polyline keeps its longest visible piece.
    const [square, polyline, lost] = projectScenePrimitives([
      sceneFill(
        [sceneVertex([0, 0, 0]), sceneVertex([1, 0, 0]), sceneVertex([1, 1, 2]), sceneVertex([0, 1, 2])],
        'tag',
        'normal',
        'tag-fill',
      ),
      scenePath(
        [sceneVertex([0, 0, 0]), sceneVertex([1, 1, 2]), sceneVertex([2, 0, 0])],
        false,
        'dimension',
        'normal',
      ),
      sceneFill(
        [sceneVertex([0, 0, 2]), sceneVertex([1, 0, 2]), sceneVertex([1, 1, 3])],
        'tag',
        'normal',
        'tag-fill',
      ),
    ], projector, font);
    expect(square!.kind).toBe('path');
    if (square!.kind === 'path') {
      expect(square!.closed).toBe(true);
      expect(roundNumbers(square!.points, 5)).toEqual([[200, 150], [200, 200], [300, 200], [300, 150]]);
    }
    if (polyline!.kind === 'path') {
      expect(roundNumbers(polyline!.points, 5)).toEqual([[200, 200], [250, 150]]);
    }
    expect(lost).toMatchObject({ kind: 'path', points: [] });
    expect(isClippedPrimitive(lost!)).toBe(true);

    // Point-anchored primitives are drawn whole or not at all: a marker, a
    // glyph run and an arrowhead behind the camera park at the stand-in.
    const parked = projectScenePrimitives([
      sceneMarker(sceneVertex(behind), 'circle', 4, 'normal'),
      sceneGlyph('A', sceneVertex(behind), 10, 'normal'),
      makeFilledSceneArrow(sceneVertex(behind), [1, 0], 8, 15, 'normal'),
      sceneMarker(sceneVertex(front), 'circle', 4, 'normal'),
    ], projector, font);
    expect(parked).toHaveLength(6);
    expect(parked.slice(0, 5).every(isClippedPrimitive)).toBe(true);
    expect(parked[0]).toMatchObject({ kind: 'marker', at: CLIPPED_SCREEN_POINT, radiusPx: 0 });
    expect(parked[1]).toMatchObject({
      kind: 'glyph-run',
      text: 'A',
      bounds: { width: 0, height: 0 },
    });
    expect(parked[5]).toMatchObject({ kind: 'marker', at: [200, 200], radiusPx: 4 });
    expect(isClippedPrimitive(parked[5]!)).toBe(false);
  });
});
