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
  LayoutResult,
  NormalizedDimensionInput,
  ScenePrimitive,
  ScreenGlyphRun,
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

/**
 * tag 与 dimension3d 是两条独立呈现路径（`layoutViewport` 先拦 tag 走
 * `planTagBillboard`，`dimension3d` 走 `layoutDimension3d`），上面那组
 * canonical 条目一条都没覆盖它们。没有这两条，后续任何「快照不变」的
 * 承诺对这两条路径都是空话。
 */
const tagBillboardInput: ExplicitLayoutInput = {
  id: 'explicit-tag-golden',
  role: 'external',
  labelPinned: true,
  formattedLabel: '',
  lines: [],
  labelAnchor: [0.4, 0.2, 0.1],
  arrowLines: [],
  tag: {
    style: 'card',
    lines: [{ text: 'N 1 100' }, { text: 'EL. +2500' }],
    target: [0.3, 0.15, 0.05],
    dot: true,
  },
};

const dimension3dInput: ExplicitLayoutInput = {
  id: 'explicit-dimension3d-golden',
  role: 'external',
  labelPinned: true,
  formattedLabel: '1250',
  lines: [],
  labelAnchor: [1.25, 0, 0.35],
  arrowLines: [],
  dimension3d: {
    from: [0, 0, 0],
    to: [2.5, 0, 0],
    direction: [0, 0, 1],
    surfaceM: 0.11,
    row: 0,
  },
};

describe('tag / dimension3d structural goldens', () => {
  it('explicit-tag-billboard', () => {
    const normalized = normalizeLayout(tagBillboardInput);

    // The body is planned by `placeTagBillboards` after the flat pass: it
    // lands as `derived.tag` plus path primitives (rounded-rect SDF edges),
    // not as a flat `fill`.
    expect(normalized.derived.tag?.candidate).toBe(0);
    expect(normalized.derived.tag?.body.width).toBeGreaterThan(0);
    expect(normalized.derived.formattedLabel).toBe('N 1 100');
    expect(normalized).toMatchSnapshot();
  });

  it('explicit-dimension3d', () => {
    const normalized = normalizeLayout(dimension3dInput);

    expect(normalized.derived.formattedLabel).toBe('1250');
    expect(normalized).toMatchSnapshot();
  });
});

/**
 * 角度标注（`plant-mbd/src/angle.rs` + `mbdV2ExternalAnnotations.ts:708-727`
 * 的 `mapAngleDim`）落到 kernel 的形状是：一条 `arcs`（`part: 'dimension'`，
 * `startAngle = 0`、`endAngle = 夹角`）、两条 `leg_lines` 映射成
 * `part: 'extension'` 的 `lines`、主文字在弧中点外侧且基线沿弧中点切线。
 * 上面所有 describe 都没有这条形状：`explicit-annotation` 的弧是整圆 +
 * 一段四分之一弧，腿是 `leader` / `extension` 各一条，`arrowLines` 还有
 * 一条笔画，既没有角度语义也没有「弧中点切线定文字方向」。
 */
const ANGLE_DIM_DEG = 44.5;
const ANGLE_ARC_CENTER: Vec3 = [0.4, 0, 0.2];
const ANGLE_ARC_RADIUS_M = 0.15;
const ANGLE_LEG_RADIUS_M = 0.17;
const ANGLE_LABEL_RADIUS_M = 0.18;
const ANGLE_TEXT_RADIUS_M = 0.2;

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 弧平面内的取点，按 kernel `stablePlaneBasis([0, 0, 1])` 的确定性基展开
 * （`geometry/planeBasis.ts:11-27`：`|n_z| ≥ 0.9` 取参考轴 X，
 * `u = normalize(cross([1,0,0], n)) = [0,-1,0]`、`v = normalize(cross(n, u))
 * = [1,0,0]`），即 `p(θ) = center + u·cosθ·r + v·sinθ·r`。腿、弧、labelAnchor、
 * 小字锚点必须走同一个取点函数，否则快照里腿端点会离开弧端点——那就不像
 * 求解器下发的角度标注了。
 */
function angleArcPoint(degrees: number, radiusM: number): Vec3 {
  const radians = degreesToRadians(degrees);
  return [
    ANGLE_ARC_CENTER[0] + Math.sin(radians) * radiusM,
    ANGLE_ARC_CENTER[1] - Math.cos(radians) * radiusM,
    ANGLE_ARC_CENTER[2],
  ];
}

/** 弧中点的 CCW 切线方向（`d p / dθ`），主文字基线沿它。 */
function angleArcTangent(degrees: number): Vec3 {
  const radians = degreesToRadians(degrees);
  return [Math.cos(radians), Math.sin(radians), 0];
}

const angleDimInput: ExplicitLayoutInput = {
  id: 'explicit-angle-dim-golden',
  role: 'external',
  labelPinned: true,
  formattedLabel: '44.5°',
  lines: [
    {
      from: ANGLE_ARC_CENTER,
      to: angleArcPoint(0, ANGLE_LEG_RADIUS_M),
      part: 'extension',
    },
    {
      from: ANGLE_ARC_CENTER,
      to: angleArcPoint(ANGLE_DIM_DEG, ANGLE_LEG_RADIUS_M),
      part: 'extension',
    },
  ],
  labelAnchor: angleArcPoint(ANGLE_DIM_DEG / 2, ANGLE_LABEL_RADIUS_M),
  labelAlong: angleArcTangent(ANGLE_DIM_DEG / 2),
  // 角度弧不带箭头，与 `mapAngleDim` 一致（`arrowLines` 恒为空）。
  arrowLines: [],
  arcs: [
    {
      center: ANGLE_ARC_CENTER,
      normal: [0, 0, 1],
      radiusM: ANGLE_ARC_RADIUS_M,
      startAngle: 0,
      endAngle: degreesToRadians(ANGLE_DIM_DEG),
      part: 'dimension',
    },
  ],
  // 方向小字（`-X` / `-X 44.5° Y`）。真实求解器把它们作为独立 record 下发、
  // 字高是主文字的一半；这里放进 `texts` 只为覆盖「主文字 + 2 条小字」的
  // 几何形态，字号仍取本 record 的 `textHeightM`
  // （`layout/explicit.ts:360-386`：主文字与 `texts` 共用同一个
  // `textHeightPx`，`ExplicitTextInput` 没有逐条字高字段）。
  texts: [
    { text: '-X', anchor: angleArcPoint(0, ANGLE_TEXT_RADIUS_M), stackIndex: 0 },
    {
      text: '-X 44.5° Y',
      anchor: angleArcPoint(0, ANGLE_TEXT_RADIUS_M),
      stackIndex: 1,
    },
  ],
  textHeightM: 0.004,
};

function primaryGlyphCapHeight(layout: LayoutResult): number {
  const glyph = layout.primitives.find(
    (primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run',
  );
  if (!glyph) throw new Error(`layout ${layout.dimensionId} carries no glyph run`);
  return glyph.capHeightPx;
}

describe('explicit angle dimension structural goldens', () => {
  it('angle-dim', () => {
    const normalized = normalizeLayout(angleDimInput);

    expect(normalized.derived.formattedLabel).toBe('44.5°');
    expect(normalized).toMatchSnapshot();
  });

  it('angle-dim-per-record-text-height', () => {
    // 字号链路：`layout/explicit.ts:86-96` 把 `textHeightM` 按
    // `projector.worldPerPixelAt(labelAnchor)` 投成像素，`explicit.ts:98-107`
    // 再钳到 `theme.ts:261-262` 的 `sourceTextHeightMinPx = 11` /
    // `sourceTextHeightMaxPx = 18`。`createTestProjector()` 的
    // `worldPerPixelAt` 恒返回 `1 / 100`（`testUtils.ts:38-56`），所以
    // 0.12 m → 12 px、0.15 m → 15 px。
    //
    // 选这两个值而不是任务里的 0.004 / 0.008：后者投成 0.4 px / 0.8 px，
    // 双双被下限钳到 11 px，字号无法区分。0.12 / 0.15 都严格落在钳制区间
    // 内部，既没被上下限抹平，又保持各自的投影比例（15 / 12 = 1.25），
    // 才能证明 kernel 是逐条 record 读 `textHeightM`，而不是按组统一字高。
    const smaller = { ...angleDimInput, id: 'explicit-angle-dim-small', textHeightM: 0.12 };
    const larger = { ...angleDimInput, id: 'explicit-angle-dim-large', textHeightM: 0.15 };

    const { layouts } = layoutViewport([smaller, larger], baseContext, new Map());
    const smallerCap = primaryGlyphCapHeight(layouts[0]!);
    const largerCap = primaryGlyphCapHeight(layouts[1]!);

    expect(smallerCap).toBeCloseTo(12, 9);
    expect(largerCap).toBeCloseTo(15, 9);
    expect(largerCap).toBeGreaterThan(smallerCap);
    expect(largerCap / smallerCap).toBeCloseTo(0.15 / 0.12, 9);
  });
});
