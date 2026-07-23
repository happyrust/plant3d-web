import { describe, expect, it } from 'vitest';

import angularFixture from '../../fixtures/dimensions/canonical/angular.json';
import linearFixture from '../../fixtures/dimensions/canonical/linear.json';
import projectedFixture from '../../fixtures/dimensions/canonical/projected.json';
import radialFixture from '../../fixtures/dimensions/canonical/radial.json';

import { DEFAULT_DIMENSION_FORMAT } from './format';
import { createTestFont, createTestProjector, roundNumbers } from './testUtils';
import { SOLVESPACE_DIMENSION_THEME } from './theme';
import { layoutViewport } from './viewport/layoutViewport';

import type {
  ExplicitLayoutInput,
  LayoutPrimitive,
  NormalizedDimensionInput,
  ScenePrimitive,
  Vec3,
} from './types';

const baseContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
};

function vec3(value: readonly number[]): Vec3 {
  return [value[0], value[1], value[2]];
}

const manifest: readonly Readonly<{
  name: string;
  input: NormalizedDimensionInput;
  expectedValue: number;
}>[] = [
  {
    name: 'linear',
    input: {
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
    },
    expectedValue: linearFixture.expectedValueM,
  },
  {
    name: 'projected',
    input: {
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
    },
    expectedValue: projectedFixture.expectedValueM,
  },
  ...angularFixture.variants.map((variant) => ({
    name: variant.id,
    input: {
      id: variant.id,
      kind: 'angular' as const,
      role: 'normal' as const,
      labelPinned: false,
      vertex: vec3(angularFixture.anchors.vertex),
      rayA: vec3(angularFixture.anchors.rayA),
      rayB: vec3(angularFixture.anchors.rayB),
      placement: variant.placement as {
        radiusM: number;
        labelT: number;
        arcChoice: 'minor' | 'major';
      },
    },
    expectedValue: variant.expectedValueRad,
  })),
  ...radialFixture.variants.map((variant) => ({
    name: variant.id,
    input: {
      id: variant.id,
      kind: 'radial' as const,
      role: 'normal' as const,
      labelPinned: false,
      center: vec3(radialFixture.anchors.center),
      rim: vec3(radialFixture.anchors.rim),
      normal: [0, 0, 1] as Vec3,
      display: variant.display as 'radius' | 'diameter',
      placement: {
        leaderDirection: vec3(radialFixture.placement.leaderDirection),
        labelDistanceM: radialFixture.placement.labelDistanceM,
      },
    },
    expectedValue: variant.expectedValueM,
  })),
];

function primitivePart(primitive: LayoutPrimitive): string {
  return primitive.kind === 'glyph-run' ? 'label' : primitive.part;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compactScenePrimitive(primitive: ScenePrimitive) {
  if (primitive.kind !== 'scene-path') {
    return primitive;
  }

  const middleIndex = Math.floor(primitive.points.length / 2);
  return {
    ...primitive,
    points: {
      count: primitive.points.length,
      first: primitive.points[0],
      middle: primitive.points[middleIndex],
      last: primitive.points.at(-1),
    },
  };
}

function normalizeLayout(input: NormalizedDimensionInput | ExplicitLayoutInput) {
  const result = layoutViewport([input], baseContext, new Map()).layouts[0];
  const primitives = result.primitives
    .map((primitive, sourceOrder) => ({ primitive, sourceOrder }))
    .sort(
      (a, b) =>
        compareText(a.primitive.kind, b.primitive.kind) ||
        compareText(primitivePart(a.primitive), primitivePart(b.primitive)) ||
        a.sourceOrder - b.sourceOrder,
    )
    .map(({ primitive }) => primitive);
  const sceneTopology = result.scenePrimitives.map(compactScenePrimitive);
  const { scenePrimitives: _scenePrimitives, ...projectedLayout } = result;
  return roundNumbers({ ...projectedLayout, primitives, sceneTopology }, 6);
}

describe('canonical dimension structural goldens', () => {
  it.each(manifest)('$name', ({ input, expectedValue }) => {
    const normalized = normalizeLayout(input);
    const value = normalized.derived.valueM ?? normalized.derived.valueRad;

    expect(value).toBe(roundNumbers(expectedValue, 6));
    expect(normalized).toMatchSnapshot();
  });
});

const explicitAnnotationInput: ExplicitLayoutInput = {
  id: 'explicit-annotation-golden',
  role: 'external',
  labelPinned: true,
  formattedLabel: 'A',
  lines: [
    { from: [0, 0, 0], to: [1, 0, 0], part: 'leader', style: 'dash-dot' },
    { from: [0, 0, 0], to: [0, 0.4, 0], part: 'extension', style: 'dashed' },
  ],
  labelAnchor: [0.5, 0.3, 0],
  arrowLines: [{ from: [0, 0, 0], to: [0.1, 0.05, 0] }],
  arcs: [
    { center: [0.5, 0, 0], normal: [0, 0, 1], radiusM: 0.25 },
    {
      center: [0.5, 0, 0],
      normal: [0, 0, 1],
      radiusM: 0.45,
      startAngle: 0,
      endAngle: Math.PI / 2,
      style: 'dashed',
    },
  ],
  markers: [
    { at: [0.5, 0, 0], shape: 'circle', radiusPx: 5 },
    { at: [1, 0, 0], shape: 'cross' },
  ],
  texts: [{ text: 'h', anchor: [0.5, -0.35, 0] }],
};

describe('explicit annotation structural goldens', () => {
  it('explicit-annotation', () => {
    const normalized = normalizeLayout(explicitAnnotationInput);

    expect(normalized.derived.formattedLabel).toBe('A');
    expect(normalized).toMatchSnapshot();
  });
});
