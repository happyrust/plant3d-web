import { describe, expect, it } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutExplicit } from './explicit';
import {
  isTagBillboardPlan,
  layoutTagBillboard,
  placeTagBillboards,
  planTagBillboard,
} from './tagBillboard';

import type {
  ExplicitLayoutInput,
  ExplicitTagInput,
  SceneFill,
  SceneGlyphRun,
  SceneLine,
  ScenePath,
  ScreenPath,
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
    // 10 angles × 2 distances.
    expect(planned.candidates).toHaveLength(20);
    expect(planned.priority).toBe(0);
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
});
