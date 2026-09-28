import { describe, expect, it } from 'vitest';

import angularFixture from '../../fixtures/dimensions/canonical/angular.json';
import linearFixture from '../../fixtures/dimensions/canonical/linear.json';
import projectedFixture from '../../fixtures/dimensions/canonical/projected.json';
import radialFixture from '../../fixtures/dimensions/canonical/radial.json';

import { DEFAULT_DIMENSION_FORMAT } from './format';
import { createTestFont, createTestProjector } from './testUtils';
import { SOLVESPACE_DIMENSION_THEME } from './theme';
import { layoutViewport } from './viewport/layoutViewport';

import type {
  LayoutResult,
  NormalizedDimensionInput,
  ScenePrimitive,
  ScreenLinePart,
  Vec3,
} from './types';

/**
 * Drives the SolveSpace-style renderer from the canonical fixture data and
 * asserts the *visible* scene output (the authoritative `scenePrimitives`
 * per ADR 0048) rather than a snapshot blob: what label text is shown, and
 * which extension / dimension / arc / arrow / leader / glyph primitives make
 * up each dimension kind. This is the human-readable companion to the opaque
 * structural goldens in `goldens.test.ts`.
 */

const baseContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
};

function vec3(value: readonly number[]): Vec3 {
  return [value[0], value[1], value[2]];
}

function layoutOf(input: NormalizedDimensionInput): LayoutResult {
  return layoutViewport([input], baseContext, new Map()).layouts[0];
}

function linePartCount(scene: readonly ScenePrimitive[], part: ScreenLinePart): number {
  return scene.filter(
    (primitive) => primitive.kind === 'scene-line' && primitive.part === part,
  ).length;
}

function arrowCount(scene: readonly ScenePrimitive[]): number {
  return scene.filter((primitive) => primitive.kind === 'scene-triangle').length;
}

function labelRuns(scene: readonly ScenePrimitive[]) {
  return scene.filter((primitive) => primitive.kind === 'scene-glyph-run');
}

/** Length policy is mm with 2 decimals (DEFAULT_DIMENSION_FORMAT). */
function lengthLabel(valueM: number): string {
  return (valueM * 1000).toFixed(2);
}

function angleLabel(valueRad: number): string {
  return `${((valueRad * 180) / Math.PI).toFixed(2)}°`;
}

describe('dimension display effect (SolveSpace-style scene output)', () => {
  it('linear: two extension lines, a trimmed dimension line, two arrowheads and a value label', () => {
    const layout = layoutOf({
      id: linearFixture.id,
      kind: 'linear',
      role: 'normal',
      labelPinned: false,
      a: vec3(linearFixture.anchors.a),
      b: vec3(linearFixture.anchors.b),
      placement: linearFixture.placement as {
        offsetM: number;
        labelT: number;
        side: 1 | -1;
      },
    });
    const scene = layout.scenePrimitives;

    expect(layout.derived.valueM).toBe(linearFixture.expectedValueM);
    expect(layout.derived.formattedLabel).toBe(lengthLabel(linearFixture.expectedValueM));

    const labels = labelRuns(scene);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: layout.derived.formattedLabel });

    expect(linePartCount(scene, 'extension')).toBe(2);
    expect(linePartCount(scene, 'dimension')).toBeGreaterThanOrEqual(1);
    expect(arrowCount(scene)).toBe(2);
  });

  it('projected: adds two projection witness lines to the linear composition', () => {
    const layout = layoutOf({
      id: projectedFixture.id,
      kind: 'projected',
      role: 'normal',
      labelPinned: false,
      a: vec3(projectedFixture.anchors.a),
      b: vec3(projectedFixture.anchors.b),
      axis: [1, 0, 0],
      placement: projectedFixture.placement as {
        offsetM: number;
        labelT: number;
        side: 1 | -1;
      },
    });
    const scene = layout.scenePrimitives;

    expect(layout.derived.valueM).toBe(projectedFixture.expectedValueM);
    expect(layout.derived.formattedLabel).toBe(lengthLabel(projectedFixture.expectedValueM));

    expect(labelRuns(scene)).toHaveLength(1);
    expect(linePartCount(scene, 'projection')).toBe(2);
    expect(linePartCount(scene, 'extension')).toBe(2);
    expect(linePartCount(scene, 'dimension')).toBeGreaterThanOrEqual(1);
    expect(arrowCount(scene)).toBe(2);
  });

  it.each(angularFixture.variants)(
    'angular $id: arc chords, two arrowheads and a degree label',
    (variant) => {
      const layout = layoutOf({
        id: variant.id,
        kind: 'angular',
        role: 'normal',
        labelPinned: false,
        vertex: vec3(angularFixture.anchors.vertex),
        rayA: vec3(angularFixture.anchors.rayA),
        rayB: vec3(angularFixture.anchors.rayB),
        placement: variant.placement as {
          radiusM: number;
          labelT: number;
          arcChoice: 'minor' | 'major';
        },
      });
      const scene = layout.scenePrimitives;

      expect(layout.derived.valueRad).toBeCloseTo(variant.expectedValueRad, 6);
      expect(layout.derived.formattedLabel).toBe(angleLabel(variant.expectedValueRad));

      expect(labelRuns(scene)).toHaveLength(1);
      expect(linePartCount(scene, 'extension')).toBe(2);
      expect(linePartCount(scene, 'arc')).toBeGreaterThanOrEqual(1);
      expect(arrowCount(scene)).toBe(2);
    },
  );

  it.each(radialFixture.variants)(
    'radial $id: a leader line and a $expectedPrefix-prefixed label, without arrowheads',
    (variant) => {
      const layout = layoutOf({
        id: variant.id,
        kind: 'radial',
        role: 'normal',
        labelPinned: false,
        center: vec3(radialFixture.anchors.center),
        rim: vec3(radialFixture.anchors.rim),
        normal: [0, 0, 1],
        display: variant.display as 'radius' | 'diameter',
        placement: {
          leaderDirection: vec3(radialFixture.placement.leaderDirection),
          labelDistanceM: radialFixture.placement.labelDistanceM,
        },
      });
      const scene = layout.scenePrimitives;

      expect(layout.derived.valueM).toBe(variant.expectedValueM);
      expect(layout.derived.formattedLabel).toBe(
        `${variant.expectedPrefix}${lengthLabel(variant.expectedValueM)}`,
      );

      expect(labelRuns(scene)).toHaveLength(1);
      expect(linePartCount(scene, 'leader')).toBeGreaterThanOrEqual(1);
      expect(arrowCount(scene)).toBe(0);
    },
  );
});
