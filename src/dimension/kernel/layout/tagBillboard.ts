import {
  makeSceneLine,
  projectScenePrimitives,
  projectSceneVertex,
  sceneFill,
  sceneGlyph,
  scenePath,
  sceneVertex,
} from '../geometry/sceneGeometry';
import {
  expandRect,
  makeLineHitRegion,
  rectsOverlap,
} from '../geometry/screenGeometry';
import { resolveDimensionStyleRole } from '../theme';
import { add3, EPSILON, scale3, tryNormalize3 } from '../vec';

import { emptyLayout } from './linear';

import type {
  ExplicitLayoutInput,
  ExplicitLodHiddenReason,
  ExplicitTagInput,
  ExplicitTagStyle,
  HitRegion,
  LayoutResult,
  ScenePrimitive,
  SceneTone,
  SceneVertex,
  ScreenLine,
  ScreenRect,
  Vec2,
} from '../types';
import type { LayoutContext } from './context';

/**
 * A billboard tag laid out up to its placement: the body size and every
 * candidate position are known, the primitives are built on demand for the
 * candidate the viewport picks. `materialize(0)` is the preferred position.
 */
export type TagBillboardPlan = Readonly<{
  /** Body rectangles (screen, with the collision margin) per candidate, preferred first. */
  candidates: readonly ScreenRect[];
  /** Placement order among tags on one view: lower goes first (cards, then frames, then pills). */
  priority: number;
  materialize(candidate: number): LayoutResult;
}>;

/** Rotations (degrees) about the preferred direction, tried in this order. */
const CANDIDATE_ANGLES_DEG: readonly number[] = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180];
/** Standoff multipliers tried after the whole first ring is blocked. */
const CANDIDATE_DISTANCE_SCALES: readonly number[] = [1, 1.6];
/** Design-space probe length (px worth) used to project the `away` direction. */
const AWAY_PROBE_PX = 50;
/** Margin kept between a tag body and whatever it is placed against. */
const BODY_MARGIN_PX = 2;
/** Corner subdivision of the rounded body; a pill's semicircles get more. */
const CORNER_SEGMENTS = 4;
const PILL_CORNER_SEGMENTS = 6;
const DOT_SEGMENTS = 12;

const STYLE_PRIORITY: Readonly<Record<ExplicitTagStyle, number>> = {
  card: 0,
  frame: 1,
  pill: 2,
};

function normalize2(vector: Vec2): Vec2 | null {
  const length = Math.hypot(vector[0], vector[1]);
  return length > EPSILON ? [vector[0] / length, vector[1] / length] : null;
}

function rotate2(vector: Vec2, degrees: number): Vec2 {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    vector[0] * cos - vector[1] * sin,
    vector[0] * sin + vector[1] * cos,
  ];
}

/**
 * Outline of a `width × height` rounded rectangle with its top-left corner at
 * the origin, clockwise on screen (y down), as a convex polygon.
 */
function roundedRectOutline(
  width: number,
  height: number,
  radius: number,
  segmentsPerCorner: number,
): Vec2[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r <= EPSILON) {
    return [[0, 0], [width, 0], [width, height], [0, height]];
  }
  const corners: readonly Readonly<{ center: Vec2; from: number }>[] = [
    { center: [r, r], from: Math.PI },
    { center: [width - r, r], from: 1.5 * Math.PI },
    { center: [width - r, height - r], from: 0 },
    { center: [r, height - r], from: 0.5 * Math.PI },
  ];
  const points: Vec2[] = [];
  for (const corner of corners) {
    for (let step = 0; step <= segmentsPerCorner; step += 1) {
      const angle = corner.from + (step / segmentsPerCorner) * (Math.PI / 2);
      points.push([
        corner.center[0] + r * Math.cos(angle),
        corner.center[1] + r * Math.sin(angle),
      ]);
    }
  }
  return points;
}

/** Point where the segment `from → centre` leaves the rectangle centred on `centre`. */
function rectEdgeTowards(
  from: Vec2,
  centre: Vec2,
  halfWidth: number,
  halfHeight: number,
): Vec2 | null {
  const dx = centre[0] - from[0];
  const dy = centre[1] - from[1];
  const tx = Math.abs(dx) > EPSILON ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > EPSILON ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  // `from` inside the body (or on it): nothing to lead to.
  if (!Number.isFinite(t) || t >= 1) return null;
  return [centre[0] - dx * t, centre[1] - dy * t];
}

function rectInside(rect: ScreenRect, width: number, height: number): boolean {
  return rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

/**
 * Plan a billboard tag (reference drawing style, 2026-09-12; design target
 * `docs/design/mbd-annotation-mockup-2026-09-12/README.md` rule 6).
 *
 * - The body is a screen-sized card / frame / pill sized from its text
 *   lines (`theme.tag`), so it reads the same at every camera distance.
 * - It hangs off the leader target (or the solver's label position when
 *   there is none): the preferred direction is the pipe's `away` direction
 *   when the source knows it, else the solver's own leader direction, both
 *   blended with an upward bias so tags sit above the pipe like drawing
 *   call-outs; further candidates fan out around that direction and then a
 *   longer standoff, and positions inside the viewport are tried first.
 * - A leader runs from the target to the nearest body edge, with a dot on
 *   the target when asked for.
 * - Level of detail: `secondary` / `detail` tiers follow the source text
 *   height like every other explicit input; lines flagged `detail` only
 *   appear on a close-up.
 *
 * Returns the finished (hidden / degenerate) layout when there is nothing to
 * place, otherwise a plan the viewport's placement pass materializes.
 */
export function planTagBillboard(
  input: ExplicitLayoutInput,
  spec: ExplicitTagInput,
  context: LayoutContext,
): TagBillboardPlan | LayoutResult {
  const { theme, projector, font } = context;
  const rules = theme.tag;
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const hidden = (reason: ExplicitLodHiddenReason): LayoutResult =>
    emptyLayout(input.id, input.labelPinned, input.formattedLabel, reason);
  const empty = (): LayoutResult => emptyLayout(input.id, input.labelPinned, input.formattedLabel);

  // Level of detail, keyed on the projected source text height at the
  // solver's label position (same rule as the flat presentation).
  const metresPerPixel = projector.worldPerPixelAt(input.labelAnchor);
  const projectedPx = input.textHeightM !== undefined && input.textHeightM > 0
    && Number.isFinite(metresPerPixel) && metresPerPixel > 0
    ? input.textHeightM / metresPerPixel
    : null;
  if (input.lod && projectedPx !== null) {
    if (input.lod.tier === 'secondary' && projectedPx < theme.sourceTextHeightMinPx) {
      return hidden('secondary-far');
    }
    if (input.lod.tier === 'detail' && projectedPx < theme.sourceTextHeightMaxPx) {
      return hidden('detail-far');
    }
  }
  const closeUp = !input.lod || projectedPx === null || projectedPx >= theme.sourceTextHeightMaxPx;
  const lines = spec.lines
    .filter(line => closeUp || !line.detail)
    .map(line => line.text)
    .filter(text => text.length > 0);
  if (lines.length === 0) return input.lod ? hidden('detail-far') : empty();

  const anchor3 = spec.target ?? input.labelAnchor;
  const anchor = projectSceneVertex(sceneVertex(anchor3), projector);
  const solverLabel = projectSceneVertex(sceneVertex(input.labelAnchor), projector);
  if (![...anchor, ...solverLabel].every(Number.isFinite)) return empty();

  // Body size from the text.
  const pill = spec.style === 'pill';
  const capHeightPx = pill ? rules.pillTextHeightPx : rules.textHeightPx;
  const paddingPx = pill ? rules.pillPaddingPx : rules.paddingPx;
  const advancePx = capHeightPx * rules.lineAdvance;
  const lineWidths = lines.map(text => font.getWidth(capHeightPx, text));
  const width = Math.max(...lineWidths) + 2 * paddingPx;
  const height = lines.length * advancePx + 2 * paddingPx;

  // Preferred direction on screen.
  let base: Vec2 | null = null;
  if (spec.target && spec.away) {
    const away = tryNormalize3(spec.away);
    const probeM = projector.worldPerPixelAt(spec.target) * AWAY_PROBE_PX;
    if (away && Number.isFinite(probeM) && probeM > 0) {
      const probe = projectSceneVertex(
        sceneVertex(add3(spec.target, scale3(away, probeM))),
        projector,
      );
      base = normalize2([probe[0] - anchor[0], probe[1] - anchor[1]]);
    }
  }
  if (!base && spec.target) {
    base = normalize2([solverLabel[0] - anchor[0], solverLabel[1] - anchor[1]]);
  }
  base ??= [0, -1];
  const direction = normalize2([base[0], base[1] - rules.upwardBias[spec.style]]) ?? [0, -1];
  const standoff = rules.standoffPx[spec.style] + rules.standoffSizeRatio * Math.max(width, height);

  const bodyAt = (centre: Vec2): ScreenRect => ({
    x: centre[0] - width / 2,
    y: centre[1] - height / 2,
    width,
    height,
  });
  const centres: Vec2[] = spec.target ? [] : [anchor];
  for (const scale of CANDIDATE_DISTANCE_SCALES) {
    for (const degrees of CANDIDATE_ANGLES_DEG) {
      const turned = rotate2(direction, degrees);
      centres.push([
        anchor[0] + turned[0] * standoff * scale,
        anchor[1] + turned[1] * standoff * scale,
      ]);
    }
  }
  const bodies = centres.map(bodyAt);
  // Stable partition: positions that keep the whole body — margin included,
  // since that is the rectangle the placement pass reasons about — on
  // screen first.
  const onScreen = (body: ScreenRect): boolean => rectInside(
    expandRect(body, BODY_MARGIN_PX),
    projector.widthCssPx,
    projector.heightCssPx,
  );
  const ordered = [
    ...bodies.filter(body => onScreen(body)),
    ...bodies.filter(body => !onScreen(body)),
  ];
  const candidates = ordered.map(body => expandRect(body, BODY_MARGIN_PX));

  const radius = pill ? height / 2 : rules.cornerRadiusPx;
  const outline = roundedRectOutline(
    width,
    height,
    radius,
    pill ? PILL_CORNER_SEGMENTS : CORNER_SEGMENTS,
  );
  const textTone: SceneTone = pill ? 'tag-muted-text' : 'tag-text';
  const borderTone: SceneTone | null = spec.style === 'card'
    ? 'tag-border'
    : spec.style === 'frame' ? 'tag-frame' : null;

  const materialize = (candidate: number): LayoutResult => {
    const index = Math.min(Math.max(0, candidate), ordered.length - 1);
    const body = ordered[index]!;
    // Every vertex hangs off the 3D anchor with a screen offset, so the whole
    // tag follows the anchor rigidly as the camera moves between layouts.
    const at = (screen: Vec2): SceneVertex =>
      sceneVertex(anchor3, [screen[0] - anchor[0], screen[1] - anchor[1]]);
    const bodyPoint = (local: Vec2): Vec2 => [body.x + local[0], body.y + local[1]];
    const primitives: ScenePrimitive[] = [];
    const outlineVertices = outline.map(point => at(bodyPoint(point)));
    primitives.push(sceneFill(outlineVertices, 'tag', styleRole, 'tag-fill'));
    if (borderTone) {
      primitives.push(scenePath(outlineVertices, true, 'tag', styleRole, undefined, borderTone));
    }
    if (spec.target) {
      const centre: Vec2 = [body.x + width / 2, body.y + height / 2];
      const edge = rectEdgeTowards(anchor, centre, width / 2, height / 2);
      if (edge && Math.hypot(edge[0] - anchor[0], edge[1] - anchor[1]) > BODY_MARGIN_PX) {
        if (spec.dot) {
          primitives.push(sceneFill(
            Array.from({ length: DOT_SEGMENTS }, (_, step) => {
              const angle = (step / DOT_SEGMENTS) * Math.PI * 2;
              return sceneVertex(anchor3, [
                Math.cos(angle) * rules.dotRadiusPx,
                Math.sin(angle) * rules.dotRadiusPx,
              ]);
            }),
            'tag',
            styleRole,
            'tag-leader',
          ));
        }
        primitives.push(makeSceneLine(
          sceneVertex(anchor3),
          at(edge),
          'leader',
          styleRole,
          undefined,
          'tag-leader',
        ));
      }
    }
    lines.forEach((text, row) => {
      primitives.push(sceneGlyph(
        text,
        at(bodyPoint([paddingPx + lineWidths[row]! / 2, paddingPx + advancePx * (row + 0.5)])),
        capHeightPx,
        styleRole,
        0,
        textTone,
      ));
    });

    const projected = projectScenePrimitives(primitives, projector, font);
    const leaders = projected.filter(
      (primitive): primitive is ScreenLine => primitive.kind === 'line' && primitive.part === 'leader',
    );
    const hitRegions: HitRegion[] = [
      ...leaders.map(leader => makeLineHitRegion(leader, theme.dimensionStrokeWidthPx)),
      { kind: 'rect', rect: body, part: 'label' },
    ];
    return {
      dimensionId: input.id,
      scenePrimitives: primitives,
      primitives: projected,
      hitRegions,
      labelBounds: candidates[index]!,
      labelPinned: input.labelPinned,
      derived: {
        formattedLabel: lines[0]!,
        tag: { candidate: index, body },
      },
    };
  };

  return { candidates, priority: STYLE_PRIORITY[spec.style], materialize };
}

export function isTagBillboardPlan(
  value: TagBillboardPlan | LayoutResult,
): value is TagBillboardPlan {
  return 'materialize' in value;
}

/** The tag at its preferred position (no other labels considered). */
export function layoutTagBillboard(
  input: ExplicitLayoutInput,
  spec: ExplicitTagInput,
  context: LayoutContext,
): LayoutResult {
  const planned = planTagBillboard(input, spec, context);
  return isTagBillboardPlan(planned) ? planned.materialize(0) : planned;
}

type PlannedTag = Readonly<{
  index: number;
  id: string;
  plan: TagBillboardPlan;
}>;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Placement pass for the tags of one view: every other visible label
 * (dimension values, flat annotations) is an obstacle, and tags are placed
 * one by one — cards, then frames, then pills, ties by id — each taking its
 * first candidate that overlaps neither an obstacle nor an already placed
 * tag; when every candidate is blocked the preferred position stands. The
 * same view always yields the same placement.
 */
export function placeTagBillboards(
  layouts: readonly LayoutResult[],
  planned: readonly PlannedTag[],
): readonly LayoutResult[] {
  if (planned.length === 0) return layouts;
  const plannedIndices = new Set(planned.map(tag => tag.index));
  const obstacles: ScreenRect[] = [];
  for (const [index, layout] of layouts.entries()) {
    if (plannedIndices.has(index)) continue;
    if (layout.primitives.length === 0 || layout.derived.formattedLabel.length === 0) continue;
    obstacles.push(layout.labelBounds);
  }
  const results = [...layouts];
  const order = [...planned].sort((a, b) =>
    a.plan.priority - b.plan.priority
    || compareIds(a.id, b.id)
    || a.index - b.index);
  for (const tag of order) {
    const free = tag.plan.candidates.findIndex(candidate =>
      !obstacles.some(obstacle => rectsOverlap(obstacle, candidate)));
    const result = tag.plan.materialize(free >= 0 ? free : 0);
    results[tag.index] = result;
    obstacles.push(result.labelBounds);
  }
  return results;
}
