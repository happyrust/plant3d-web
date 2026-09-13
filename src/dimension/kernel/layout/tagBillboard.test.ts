import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { rectPolygonOverlapArea, rectsOverlapArea, segmentLengthInsideRect } from '../geometry/obstacleGeometry';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutExplicit } from './explicit';
import {
  collectTagObstacles,
  dimensionStrokes,
  isTagBillboardPlan,
  layoutTagBillboard,
  placeTagBillboards,
  planTagBillboard,
  projectObstacleOutline,
  tagObstacleRegion,
} from './tagBillboard';

import type { ScreenPolygon } from '../geometry/obstacleGeometry';
import type {
  ExplicitLayoutInput,
  ExplicitTagInput,
  LayoutObstacleSource,
  LayoutResult,
  SceneFill,
  SceneGlyphRun,
  SceneLine,
  ScenePath,
  ScreenPath,
  ScreenRect,
  Vec2,
} from '../types';
import type { LayoutContext } from './context';

const rules = SOLVESPACE_DIMENSION_THEME.tag;

// End-point coordinate block: the solver put the text at (−0.1, 0.2) with a
// leader down to the pipe end at the origin; the pipe runs in from +X.
const spec: ExplicitTagInput = {
  style: 'card',
  lines: [{ text: 'A' }, { text: 'hp' }],
  target: [0, 0, 0],
  away: [-1, 0, 0],
  dot: true,
};

const input: ExplicitLayoutInput = {
  id: 'tag',
  role: 'external',
  labelPinned: true,
  formattedLabel: 'A',
  lines: [{ from: [-0.1, 0.2, 0], to: [0, 0, 0], part: 'leader' }],
  labelAnchor: [-0.1, 0.2, 0],
  arrowLines: [],
  texts: [{ text: 'hp', anchor: [-0.1, 0.2, 0], stackIndex: 1 }],
  textHeightM: 0.027,
  tag: spec,
};

function context(pixelsPerMetre = 100): LayoutContext {
  return {
    projector: createTestProjector(pixelsPerMetre),
    font: createTestFont(),
    theme: SOLVESPACE_DIMENSION_THEME,
    format: DEFAULT_DIMENSION_FORMAT,
    interaction: 'normal',
  };
}

function fills(result: ReturnType<typeof layoutTagBillboard>): SceneFill[] {
  return result.scenePrimitives.filter(
    (primitive): primitive is SceneFill => primitive.kind === 'scene-fill',
  );
}

function glyphs(result: ReturnType<typeof layoutTagBillboard>): SceneGlyphRun[] {
  return result.scenePrimitives.filter(
    (primitive): primitive is SceneGlyphRun => primitive.kind === 'scene-glyph-run',
  );
}

describe('layoutTagBillboard', () => {
  it('sizes a card from its lines, hangs it off the target away from the pipe and leads to its edge', () => {
    const font = createTestFont();
    const result = layoutTagBillboard(input, spec, context());
    const cap = rules.textHeightPx;
    const advance = cap * rules.lineAdvance;
    const width = Math.max(font.getWidth(cap, 'A'), font.getWidth(cap, 'hp')) + 2 * rules.paddingPx;
    const height = 2 * advance + 2 * rules.paddingPx;

    // Body: the target projects to (200, 200); `away` (−X) blended with the
    // upward bias gives the direction (−1, −1)/√2, the standoff adds the
    // size-dependent share.
    const body = result.derived.tag!.body;
    expect(body.width).toBeCloseTo(width, 9);
    expect(body.height).toBeCloseTo(height, 9);
    const standoff = rules.standoffPx.card + rules.standoffSizeRatio * Math.max(width, height);
    const centre = [body.x + body.width / 2, body.y + body.height / 2];
    expect(centre[0]).toBeCloseTo(200 - standoff / Math.SQRT2, 6);
    expect(centre[1]).toBeCloseTo(200 - standoff / Math.SQRT2, 6);
    expect(result.derived.tag!.candidate).toBe(0);
    expect(result.derived.formattedLabel).toBe('A');
    expect(result.labelBounds).toEqual({
      x: body.x - 2, y: body.y - 2, width: body.width + 4, height: body.height + 4,
    });

    // Every vertex hangs off the 3D target with a screen offset: the body
    // fill's first outline point sits on the body's left edge.
    const [bodyFill, dot] = fills(result);
    expect(bodyFill!.tone).toBe('tag-fill');
    expect(bodyFill!.points.every(point => point.anchor === spec.target)).toBe(true);
    expect(bodyFill!.points[0]!.offsetPx[0] + 200).toBeCloseTo(body.x, 9);
    expect(bodyFill!.points.length).toBe(4 * 5);
    // Card border in the border tone over the same outline; dot on the target.
    const border = result.scenePrimitives.find(
      (primitive): primitive is ScenePath => primitive.kind === 'scene-path',
    )!;
    expect(border.tone).toBe('tag-border');
    expect(border.closed).toBe(true);
    expect(border.points).toEqual(bodyFill!.points);
    expect(dot!.tone).toBe('tag-leader');
    expect(dot!.points).toHaveLength(12);
    expect(Math.hypot(...dot!.points[0]!.offsetPx)).toBeCloseTo(rules.dotRadiusPx, 9);

    // Leader from the target to the point where the line to the body centre
    // meets the body: here the bottom-right corner region → bottom edge or
    // right edge, whichever comes first.
    const leader = result.scenePrimitives.find(
      (primitive): primitive is SceneLine => primitive.kind === 'scene-line' && primitive.part === 'leader',
    )!;
    expect(leader.tone).toBe('tag-leader');
    expect(leader.from).toEqual({ anchor: [0, 0, 0], offsetPx: [0, 0] });
    const end: readonly [number, number] = [leader.to.offsetPx[0] + 200, leader.to.offsetPx[1] + 200];
    const onRight = Math.abs(end[0] - (body.x + body.width)) < 1e-6;
    const onBottom = Math.abs(end[1] - (body.y + body.height)) < 1e-6;
    expect(onRight || onBottom).toBe(true);

    // Lines are left-aligned inside the padding, one advance apart.
    const runs = glyphs(result);
    expect(runs.map(run => run.text)).toEqual(['A', 'hp']);
    expect(runs.every(run => run.tone === 'tag-text' && run.capHeightPx === cap)).toBe(true);
    for (const [row, run] of runs.entries()) {
      const centreX = run.at.offsetPx[0] + 200;
      const centreY = run.at.offsetPx[1] + 200;
      expect(centreX - font.getWidth(cap, run.text) / 2).toBeCloseTo(body.x + rules.paddingPx, 9);
      expect(centreY).toBeCloseTo(body.y + rules.paddingPx + advance * (row + 0.5), 9);
    }

    // Snapshot: one closed path per fill / border, one line, two glyph runs;
    // hit regions are the body and the leader.
    const paths = result.primitives.filter((primitive): primitive is ScreenPath => primitive.kind === 'path');
    expect(paths).toHaveLength(3);
    expect(paths[0]!.tone).toBe('tag-fill');
    expect(result.hitRegions.map(region => region.part)).toEqual(['leader', 'label']);
    expect(result.labelPinned).toBe(true);
  });

  it('falls back to the solver leader direction and draws frames and pills', () => {
    // No `away`: the solver placed the text up-left of the target.
    const frame = layoutTagBillboard(
      { ...input, tag: { ...spec, style: 'frame', away: undefined, dot: undefined } },
      { ...spec, style: 'frame', away: undefined, dot: undefined },
      context(),
    );
    const body = frame.derived.tag!.body;
    expect(body.x + body.width / 2).toBeLessThan(200);
    expect(body.y + body.height / 2).toBeLessThan(200);
    expect(fills(frame)).toHaveLength(1);
    expect(frame.scenePrimitives.find(primitive => primitive.kind === 'scene-path')!.tone).toBe('tag-frame');

    // A pill has no border, muted text, its own text height and semicircular ends.
    const pillSpec: ExplicitTagInput = { style: 'pill', lines: [{ text: 'A' }], target: [0, 0, 0] };
    const pill = layoutTagBillboard({ ...input, tag: pillSpec }, pillSpec, context());
    expect(pill.scenePrimitives.some(primitive => primitive.kind === 'scene-path')).toBe(false);
    expect(glyphs(pill)[0]).toMatchObject({ tone: 'tag-muted-text', capHeightPx: rules.pillTextHeightPx });
    expect(pill.derived.tag!.body.height).toBeCloseTo(
      rules.pillTextHeightPx * rules.lineAdvance + 2 * rules.pillPaddingPx,
      9,
    );
    expect(fills(pill)[0]!.points).toHaveLength(4 * 7);
    // Closer to its anchor than a card.
    const pillCentre = pill.derived.tag!.body;
    expect(Math.hypot(pillCentre.x + pillCentre.width / 2 - 200, pillCentre.y + pillCentre.height / 2 - 200))
      .toBeLessThan(rules.standoffPx.card);
  });

  it('centres a tag without a leader target on the solver position', () => {
    const bare: ExplicitTagInput = { style: 'card', lines: [{ text: 'A' }] };
    const result = layoutTagBillboard({ ...input, tag: bare }, bare, context());
    const body = result.derived.tag!.body;
    // labelAnchor (−0.1, 0.2) → (190, 180).
    expect(body.x + body.width / 2).toBeCloseTo(190, 9);
    expect(body.y + body.height / 2).toBeCloseTo(180, 9);
    expect(result.scenePrimitives.some(primitive => primitive.kind === 'scene-line')).toBe(false);
    expect(result.hitRegions.map(region => region.part)).toEqual(['label']);
  });

  it('applies the three-tier level of detail to tags and their lines', () => {
    const elbow: ExplicitTagInput = {
      style: 'pill',
      lines: [{ text: 'A', detail: true }, { text: 'hp' }],
      target: [0, 0, 0],
    };
    const secondary: ExplicitLayoutInput = { ...input, tag: elbow, lod: { tier: 'secondary' } };
    // Far (cheight 27 mm → 2.7 px < 11 px): hidden.
    expect(layoutTagBillboard(secondary, elbow, context()).derived)
      .toEqual({ formattedLabel: 'A', lodHidden: 'secondary-far' });
    // Mid range (500 px/m → 13.5 px): shown, primary lines only.
    const mid = layoutTagBillboard(secondary, elbow, context(500));
    expect(glyphs(mid).map(run => run.text)).toEqual(['hp']);
    expect(mid.derived.formattedLabel).toBe('hp');
    // Close-up (1000 px/m → 27 px ≥ 18 px): every line.
    expect(glyphs(layoutTagBillboard(secondary, elbow, context(1000))).map(run => run.text)).toEqual(['A', 'hp']);

    // Detail tier: hidden until the close-up.
    const detail: ExplicitLayoutInput = { ...input, tag: elbow, lod: { tier: 'detail' } };
    expect(layoutTagBillboard(detail, elbow, context(500)).derived.lodHidden).toBe('detail-far');
    expect(layoutTagBillboard(detail, elbow, context(1000)).derived.lodHidden).toBeUndefined();

    // Without a LOD hint (or the `mbd_lod=0` switch) everything shows at any distance.
    const always: ExplicitLayoutInput = { ...input, tag: elbow, lod: undefined };
    expect(glyphs(layoutTagBillboard(always, elbow, context())).map(run => run.text)).toEqual(['A', 'hp']);
  });

  it('plans candidates fanning out around the preferred direction, on-screen ones first', () => {
    const planned = planTagBillboard(input, spec, context());
    if (!isTagBillboardPlan(planned)) throw new Error('expected a plan');
    // 10 angles × 4 rings.
    expect(planned.candidates).toHaveLength(40);
    expect(planned.priority).toBe(0);
    // The leading `onScreen` candidates (margin included) lie whole inside the
    // 400 × 400 viewport, none of the rest does: the near ring fits, the outer
    // rings mostly leave it.
    const inside = (rect: ScreenRect): boolean =>
      rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 400 && rect.y + rect.height <= 400;
    expect(planned.onScreen).toBeGreaterThan(0);
    expect(planned.onScreen).toBeLessThan(planned.candidates.length);
    expect(planned.candidates.slice(0, planned.onScreen).every(inside)).toBe(true);
    expect(planned.candidates.slice(planned.onScreen).some(inside)).toBe(false);
    const preferred = planned.materialize(0);
    const alternative = planned.materialize(1);
    expect(alternative.derived.tag!.candidate).toBe(1);
    expect(alternative.derived.tag!.body).not.toEqual(preferred.derived.tag!.body);
    expect(alternative.labelBounds).toEqual(planned.candidates[1]);
    // Same target, same text: only the offsets move.
    expect(fills(alternative)[0]!.points[0]!.anchor).toEqual([0, 0, 0]);
    expect(glyphs(alternative).map(run => run.text)).toEqual(['A', 'hp']);

    // A target at the top-left corner of the viewport: the preferred
    // direction leaves the screen, so an on-screen candidate is tried first.
    const cornered: ExplicitTagInput = { ...spec, target: [-1.9, 1.9, 0] };
    const corneredPlan = planTagBillboard(
      { ...input, tag: cornered, labelAnchor: [-1.95, 1.95, 0] },
      cornered,
      context(),
    );
    if (!isTagBillboardPlan(corneredPlan)) throw new Error('expected a plan');
    const first = corneredPlan.candidates[0]!;
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.y).toBeGreaterThanOrEqual(0);
  });

  it('is reached through layoutExplicit and honours interaction roles', () => {
    const hovered = layoutExplicit(input, { ...context(), interaction: 'hovered' });
    expect(hovered.scenePrimitives.length).toBeGreaterThan(0);
    expect(hovered.scenePrimitives.every(primitive => primitive.styleRole === 'hovered')).toBe(true);
    // Without the tag the same record takes the flat path: text at the
    // solver position, the leader as drawn.
    const { tag: _tag, ...flat } = input;
    const flatResult = layoutExplicit(flat, context());
    expect(flatResult.scenePrimitives.some(primitive => primitive.kind === 'scene-fill')).toBe(false);
    const flatLeader = flatResult.scenePrimitives.find(
      (primitive): primitive is SceneLine => primitive.kind === 'scene-line' && primitive.part === 'leader',
    )!;
    expect(flatLeader.from.anchor).toEqual([-0.1, 0.2, 0]);
    expect(flatLeader.to.anchor).toEqual([0, 0, 0]);
  });
});

describe('placeTagBillboards', () => {
  it('moves a tag to its first free candidate, clear of labels and of tags placed before it', () => {
    const ctx = context();
    const planA = planTagBillboard({ ...input, id: 'a' }, spec, ctx);
    const planB = planTagBillboard({ ...input, id: 'b' }, spec, ctx);
    if (!isTagBillboardPlan(planA) || !isTagBillboardPlan(planB)) throw new Error('expected plans');
    const placeholder = (id: string) => ({
      dimensionId: id,
      scenePrimitives: [],
      primitives: [],
      hitRegions: [],
      labelBounds: { x: 0, y: 0, width: 0, height: 0 },
      labelPinned: true,
      derived: { formattedLabel: 'A' },
    });
    // A visible dimension value sitting exactly where the preferred body goes.
    const preferred = planA.candidates[0]!;
    const obstacle = {
      ...placeholder('dim'),
      primitives: [{ kind: 'line' as const, from: [0, 0] as const, to: [1, 1] as const, part: 'dimension' as const, styleRole: 'external' }],
      labelBounds: preferred,
    };

    const placed = placeTagBillboards(
      [obstacle, placeholder('a'), placeholder('b')],
      [
        { index: 1, id: 'a', plan: planA },
        { index: 2, id: 'b', plan: planB },
      ],
    );
    expect(placed[0]).toBe(obstacle);
    // `a` skips the blocked preferred position; `b` (same spec) must not land on `a` either.
    expect(placed[1]!.derived.tag!.candidate).toBe(1);
    expect(placed[2]!.derived.tag!.candidate).toBe(2);
    const bodyA = placed[1]!.labelBounds;
    const bodyB = placed[2]!.labelBounds;
    expect(bodyA.x < bodyB.x + bodyB.width && bodyA.x + bodyA.width > bodyB.x
      && bodyA.y < bodyB.y + bodyB.height && bodyA.y + bodyA.height > bodyB.y).toBe(false);

    // Pills yield to cards regardless of input order; ids break ties; the
    // same input yields the same placement. A leaderless pill whose solver
    // position is the centre of the card's preferred body wants the same
    // spot: the card keeps it, the pill moves.
    const cardBody = planA.materialize(0).derived.tag!.body;
    const pillSpec: ExplicitTagInput = { style: 'pill', lines: [{ text: 'A' }] };
    const pillPlan = planTagBillboard(
      {
        ...input,
        id: 'p',
        tag: pillSpec,
        labelAnchor: [
          (cardBody.x + cardBody.width / 2 - 200) / 100,
          (200 - (cardBody.y + cardBody.height / 2)) / 100,
          0,
        ],
      },
      pillSpec,
      ctx,
    );
    if (!isTagBillboardPlan(pillPlan)) throw new Error('expected plan');
    const run = () => placeTagBillboards(
      [placeholder('p'), placeholder('a')],
      [{ index: 0, id: 'p', plan: pillPlan }, { index: 1, id: 'a', plan: planA }],
    );
    const first = run();
    expect(first[1]!.derived.tag!.candidate).toBe(0);
    expect(first[0]!.derived.tag!.candidate).toBeGreaterThan(0);
    expect(run()).toEqual(first);

    // Nothing to place: the batch comes back untouched.
    expect(placeTagBillboards([obstacle], [])).toEqual([obstacle]);
  });

  const placeholder = (id: string): LayoutResult => ({
    dimensionId: id,
    scenePrimitives: [],
    primitives: [],
    hitRegions: [],
    labelBounds: { x: 0, y: 0, width: 0, height: 0 },
    labelPinned: true,
    derived: { formattedLabel: 'A' },
  });
  const rectPolygon = (rect: ScreenRect): ScreenPolygon => [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ];

  it('keeps a tag clear of component boxes and dimension strokes', () => {
    const plan = planTagBillboard(input, spec, context());
    if (!isTagBillboardPlan(plan)) throw new Error('expected plan');
    const preferred = plan.candidates[0]!;

    // A component box (projected outline) exactly under the preferred body.
    const box = rectPolygon(preferred);
    const [overBox] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { polygons: [box] },
    );
    expect(overBox!.derived.tag!.candidate).toBeGreaterThan(0);
    expect(rectPolygonOverlapArea(overBox!.labelBounds, box)).toBe(0);

    // A dimension stroke running through the preferred body.
    const centreY = preferred.y + preferred.height / 2;
    const stroke = {
      from: [preferred.x - 10, centreY] as Vec2,
      to: [preferred.x + preferred.width + 10, centreY] as Vec2,
    };
    const [overStroke] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { segments: [stroke] },
    );
    expect(overStroke!.derived.tag!.candidate).toBeGreaterThan(0);
    expect(segmentLengthInsideRect(stroke, overStroke!.labelBounds)).toBe(0);

    // A stroke that only runs along the body's edge is not an intrusion.
    const alongEdge = {
      from: [preferred.x - 10, preferred.y] as Vec2,
      to: [preferred.x + preferred.width + 10, preferred.y] as Vec2,
    };
    const [touched] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { segments: [alongEdge] },
    );
    expect(touched!.derived.tag!.candidate).toBe(0);

    // A viewport overlay (axis gizmo) over the preferred body.
    const [underOverlay] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { overlays: [preferred] },
    );
    expect(underOverlay!.derived.tag!.candidate).toBeGreaterThan(0);
    expect(rectsOverlapArea(underOverlay!.labelBounds, preferred)).toBe(0);
  });

  it('takes the least intruding candidate when none is clear, values weighing more than boxes', () => {
    const plan = planTagBillboard(input, spec, context());
    if (!isTagBillboardPlan(plan)) throw new Error('expected plan');
    // A box under the whole viewport: every candidate covers the same box area …
    const everywhere = rectPolygon({ x: -1000, y: -1000, width: 3000, height: 3000 });
    const [tied] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { polygons: [everywhere] },
    );
    // … so the preferred position stands.
    expect(tied!.derived.tag!.candidate).toBe(0);

    // A dimension value over half of the preferred body tips the balance to
    // the next candidate, which is no worse on the box.
    const preferred = plan.candidates[0]!;
    const value: LayoutResult = {
      ...placeholder('dim'),
      primitives: [{ kind: 'line', from: [0, 0], to: [1, 1], part: 'dimension', styleRole: 'external' }],
      labelBounds: { ...preferred, width: preferred.width / 2 },
    };
    const [, moved] = placeTagBillboards(
      [value, placeholder('tag')],
      [{ index: 1, id: 'tag', plan }],
      { polygons: [everywhere] },
    );
    expect(moved!.derived.tag!.candidate).toBe(1);

    // An overlay weighs like a value: the same half-body overlay tips it too.
    const [underOverlay] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { polygons: [everywhere], overlays: [{ ...preferred, width: preferred.width / 2 }] },
    );
    expect(underOverlay!.derived.tag!.candidate).toBe(1);
  });

  it('never leaves the screen to dodge an obstacle while it has a candidate on it', () => {
    const plan = planTagBillboard(input, spec, context());
    if (!isTagBillboardPlan(plan)) throw new Error('expected plan');
    // The whole viewport is one component box: every on-screen candidate is
    // covered in full, the off-screen ones only in part …
    const viewport = rectPolygon({ x: 0, y: 0, width: 400, height: 400 });
    const [placed] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { polygons: [viewport] },
    );
    // … yet the tag stays whole on screen, at its preferred position (a tie
    // among the on-screen candidates).
    expect(placed!.derived.tag!.candidate).toBe(0);
    expect(plan.onScreen).toBeGreaterThan(0);

    // An anchor far off screen has no on-screen candidate, so all of them compete.
    const gone: ExplicitTagInput = { ...spec, target: [-9, 0, 0] };
    const offPlan = planTagBillboard({ ...input, tag: gone, labelAnchor: [-9.1, 0.2, 0] }, gone, context());
    if (!isTagBillboardPlan(offPlan)) throw new Error('expected plan');
    expect(offPlan.onScreen).toBe(0);
    const [off] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan: offPlan }],
      { polygons: [rectPolygon(offPlan.candidates[0]!)] },
    );
    expect(off!.derived.tag!.candidate).toBe(1);
  });

  it('leads out of a box that swallows the near rings instead of sitting on the component', () => {
    // A wide viewport keeps the outer rings on screen; the anchor still projects to (200, 200).
    const wide: LayoutContext = {
      ...context(),
      projector: { ...createTestProjector(), widthCssPx: 2000, heightCssPx: 2000 },
    };
    const plan = planTagBillboard(input, spec, wide);
    if (!isTagBillboardPlan(plan)) throw new Error('expected plan');
    const { body } = plan.materialize(0).derived.tag!;
    const standoff = rules.standoffPx.card + rules.standoffSizeRatio * Math.max(body.width, body.height);
    const diagonal = Math.hypot(body.width, body.height);
    // A component box (a valve filling the view) covering everything up to
    // and including the second ring's bodies, right of and below the anchor
    // as well as the whole area left of / above it.
    const box = rectPolygon({
      x: -1000,
      y: -1000,
      width: 1200 + 1.6 * standoff + diagonal,
      height: 1200 + 1.6 * standoff + diagonal,
    });
    const [placed] = placeTagBillboards(
      [placeholder('tag')],
      [{ index: 0, id: 'tag', plan }],
      { polygons: [box] },
    );
    const chosen = placed!.derived.tag!.body;
    expect(rectPolygonOverlapArea(placed!.labelBounds, box)).toBe(0);
    // The first clear position is on the third ring, straight right of the anchor.
    expect(chosen.x + chosen.width / 2 - 200).toBeCloseTo(2.4 * standoff, 6);
    expect(chosen.y + chosen.height / 2 - 200).toBeCloseTo(0, 6);
    expect(placed!.derived.tag!.candidate).toBeLessThan(plan.onScreen);
  });
});

describe('tag obstacles', () => {
  it('asks for component boxes in the region the candidates unproject to, around the anchor depth', () => {
    const projector = createTestProjector();
    const plan = planTagBillboard(input, spec, context());
    if (!isTagBillboardPlan(plan)) throw new Error('expected plan');
    const region = tagObstacleRegion([plan], projector)!;
    expect(region).not.toBeNull();
    const { envelope } = plan;
    // Test projector: x = 200 + X·100, y = 200 − Y·100, depth = Z, forward −Z.
    expect(region.min[0]).toBeCloseTo((envelope.x - 200) / 100, 9);
    expect(region.max[0]).toBeCloseTo((envelope.x + envelope.width - 200) / 100, 9);
    expect(region.min[1]).toBeCloseTo((200 - envelope.y - envelope.height) / 100, 9);
    expect(region.max[1]).toBeCloseTo((200 - envelope.y) / 100, 9);
    const reach = Math.hypot(envelope.width, envelope.height) / 100;
    expect(region.min[2]).toBeCloseTo(-reach, 9);
    expect(region.max[2]).toBeCloseTo(reach, 9);
    // The anchor itself is inside.
    expect(region.min[0]).toBeLessThan(0);
    expect(region.max[0]).toBeGreaterThan(0);

    expect(tagObstacleRegion([], projector)).toBeNull();
  });

  it('projects a box to the convex hull of its corners and drops boxes it cannot place on screen', () => {
    const projector = createTestProjector();
    const corners = (min: readonly number[], max: readonly number[]) =>
      [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k =>
        [i ? max[0]! : min[0]!, j ? max[1]! : min[1]!, k ? max[2]! : min[2]!] as const)));
    const hull = projectObstacleOutline({ corners: corners([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]) }, projector)!;
    expect(hull).toHaveLength(4);
    expect(rectPolygonOverlapArea({ x: 150, y: 150, width: 100, height: 100 }, hull)).toBe(10000);
    // Beyond the far plane (depth > 1) / behind the camera: unusable.
    expect(projectObstacleOutline({ corners: corners([0, 0, 0], [1, 1, 2]) }, projector)).toBeNull();
    // No area on screen.
    expect(projectObstacleOutline({ corners: [[0, 0, 0], [1, 1, 0], [2, 2, 0]] }, projector)).toBeNull();
    expect(projectObstacleOutline({ corners: [] }, projector)).toBeNull();
  });

  it('collects the strokes of the other layouts and the projected boxes the host reports', () => {
    const strokes: LayoutResult = {
      dimensionId: 'dim',
      scenePrimitives: [],
      primitives: [
        { kind: 'line', from: [0, 0], to: [10, 0], part: 'dimension', styleRole: 'external' },
        { kind: 'path', points: [[0, 0], [10, 0], [10, 10]], closed: true, part: 'arrow', styleRole: 'external' },
        { kind: 'path', points: [[0, 0], [10, 0], [10, 10]], closed: false, part: 'arc', styleRole: 'external' },
        { kind: 'marker', at: [5, 5], shape: 'circle', radiusPx: 3, part: 'marker', styleRole: 'external' },
        {
          kind: 'glyph-run', text: '1', origin: [0, 0], capHeightPx: 10,
          bounds: { x: 0, y: 0, width: 5, height: 10 }, styleRole: 'external',
        },
      ],
      hitRegions: [],
      labelBounds: { x: 0, y: 0, width: 5, height: 10 },
      labelPinned: true,
      derived: { formattedLabel: '1' },
    };
    // Line 1 + closed triangle 3 + open path 2; glyphs and markers are not strokes.
    expect(dimensionStrokes([strokes])).toHaveLength(6);

    const projector = createTestProjector();
    const plan = planTagBillboard(input, spec, context());
    if (!isTagBillboardPlan(plan)) throw new Error('expected plan');
    const tagSlot: LayoutResult = {
      ...strokes,
      dimensionId: 'tag',
      primitives: [{ kind: 'line', from: [0, 0], to: [1, 1], part: 'leader', styleRole: 'external' }],
    };
    const gizmo: ScreenRect = { x: 300, y: 0, width: 100, height: 100 };
    const source: LayoutObstacleSource = {
      query: vi.fn(() => [
        { corners: [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0], [-0.5, 0.5, 0]] as const },
        { corners: [[0, 0, 5], [1, 1, 5], [1, 0, 5]] as const }, // beyond the far plane
      ]),
      overlays: vi.fn(() => [gizmo, { x: 0, y: 0, width: 0, height: 40 }]), // the flat one is no obstacle
    };
    const planned = [{ index: 1, id: 'tag', plan }];
    const obstacles = collectTagObstacles([strokes, tagSlot], planned, projector, source);
    // The tag's own slot contributes no strokes.
    expect(obstacles.segments).toHaveLength(6);
    expect(obstacles.polygons).toHaveLength(1);
    expect(obstacles.overlays).toEqual([gizmo]);
    expect(source.query).toHaveBeenCalledTimes(1);
    expect(source.query).toHaveBeenCalledWith(tagObstacleRegion([plan], projector));

    // A host with overlays only is never asked for a region.
    const overlaysOnly: LayoutObstacleSource = { overlays: () => [gizmo] };
    expect(collectTagObstacles([strokes, tagSlot], planned, projector, overlaysOnly)).toEqual({
      polygons: [],
      segments: dimensionStrokes([strokes]),
      overlays: [gizmo],
    });

    // Without a host source: strokes only. Nothing planned: nothing to collect.
    expect(collectTagObstacles([strokes, tagSlot], planned, projector)).toEqual({
      polygons: [],
      segments: dimensionStrokes([strokes]),
      overlays: [],
    });
    expect(collectTagObstacles([strokes], [], projector, source)).toEqual({});
  });
});
