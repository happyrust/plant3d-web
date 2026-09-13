import {
  convexHull,
  polygonBounds,
  rectPolygonOverlapArea,
  rectsOverlapArea,
  segmentLengthInsideRect,
  type ScreenPolygon,
  type ScreenSegment,
} from '../geometry/obstacleGeometry';
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

import type { ViewportProjector } from '../projector';
import type {
  DesignBox,
  ExplicitLayoutInput,
  ExplicitLodHiddenReason,
  ExplicitTagInput,
  ExplicitTagStyle,
  HitRegion,
  LayoutObstacle,
  LayoutObstacleSource,
  LayoutResult,
  ScenePrimitive,
  SceneTone,
  SceneVertex,
  ScreenLine,
  ScreenRect,
  Vec2,
  Vec3,
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
  /** Ring (standoff step, 0 = nearest) each candidate lies on, same order. */
  rings: readonly number[];
  /**
   * How many leading candidates lie whole inside the viewport; 0 when none
   * does (anchor near or beyond the edge). The placement pass never lets a
   * tag leave the screen to dodge an obstacle while it has such a candidate.
   */
  onScreen: number;
  /** Where the tag goes when every candidate intrudes (`theme.tag.blockedFallback`). */
  blockedFallback: 'least-intrusion' | 'first-ring';
  /** Screen rectangle every candidate lies in. */
  envelope: ScreenRect;
  /** Design Space point the body hangs off (leader target or solver position). */
  anchor: Vec3;
  /** Placement order among tags on one view: lower goes first (cards, then frames, then pills). */
  priority: number;
  materialize(candidate: number): LayoutResult;
}>;

/**
 * What a tag body must not cover besides other labels: model components
 * (their projected bounding boxes, as convex screen polygons), dimension
 * strokes (dimension / extension lines, arrowheads) on screen, and the
 * viewport's fixed overlays (an axis gizmo) as screen rectangles. Built by
 * `collectTagObstacles` for a view; empty = labels only.
 */
export type TagObstacles = Readonly<{
  polygons?: readonly ScreenPolygon[];
  segments?: readonly ScreenSegment[];
  overlays?: readonly ScreenRect[];
}>;

/** Rotations (degrees) about the preferred direction, tried in this order. */
const CANDIDATE_ANGLES_DEG: readonly number[] = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180];
/**
 * Standoff multipliers, each ring tried only after the whole previous one is
 * blocked. The outer rings exist for close-ups, where a component's
 * projected box swallows the near rings (a valve filling half the view) and
 * the tag has to lead out of it rather than sit on the body.
 */
const CANDIDATE_DISTANCE_SCALES: readonly number[] = [1, 1.6, 2.4, 3.4];
/** Design-space probe length (px worth) used to project the `away` direction. */
const AWAY_PROBE_PX = 50;
/** Margin kept between a tag body and whatever it is placed against. */
const BODY_MARGIN_PX = 2;
/**
 * Intrusion weights (per px² covered) that rank the candidates when none is
 * clear: hiding a value or another tag is worst — and so is sliding under a
 * viewport overlay, which hides the tag itself — cutting a dimension stroke
 * next, covering a component's bounding box least — the box overstates the
 * body and the tag is meant to sit over the model anyway.
 */
const LABEL_INTRUSION_WEIGHT = 4;
const OVERLAY_INTRUSION_WEIGHT = 4;
const STROKE_INTRUSION_WEIGHT = 2;
const BOX_INTRUSION_WEIGHT = 1;
/** A covered stroke counts as a band this wide (px) so its length becomes an area. */
const STROKE_BAND_PX = 4;
/**
 * Intrusion scores closer than this (px²) are a tie, which the earlier
 * candidate wins: clipped areas carry floating-point noise, and a later
 * candidate must beat the preferred one by a visible amount to displace it.
 */
const INTRUSION_TIE_PX2 = 1e-6;
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

function unionRects(rects: readonly ScreenRect[]): ScreenRect {
  const minX = Math.min(...rects.map(rect => rect.x));
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
 *   call-outs; further candidates fan out around that direction and then
 *   ring by ring at longer standoffs, and positions inside the viewport are
 *   tried first.
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
  // A leaderless tag's own position counts as the nearest ring.
  const centres: { centre: Vec2; ring: number }[] = spec.target ? [] : [{ centre: anchor, ring: 0 }];
  for (const [ring, scale] of CANDIDATE_DISTANCE_SCALES.entries()) {
    for (const degrees of CANDIDATE_ANGLES_DEG) {
      const turned = rotate2(direction, degrees);
      centres.push({
        centre: [
          anchor[0] + turned[0] * standoff * scale,
          anchor[1] + turned[1] * standoff * scale,
        ],
        ring,
      });
    }
  }
  const bodies = centres.map(({ centre, ring }) => ({ body: bodyAt(centre), ring }));
  // Stable partition: positions that keep the whole body — margin included,
  // since that is the rectangle the placement pass reasons about — on
  // screen first.
  const onScreen = (body: ScreenRect): boolean => rectInside(
    expandRect(body, BODY_MARGIN_PX),
    projector.widthCssPx,
    projector.heightCssPx,
  );
  const onScreenBodies = bodies.filter(({ body }) => onScreen(body));
  const ordered = [
    ...onScreenBodies,
    ...bodies.filter(({ body }) => !onScreen(body)),
  ];
  const candidates = ordered.map(({ body }) => expandRect(body, BODY_MARGIN_PX));
  const rings = ordered.map(({ ring }) => ring);
  const envelope = unionRects(candidates);

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
    const { body } = ordered[index]!;
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

  return {
    candidates,
    rings,
    onScreen: onScreenBodies.length,
    blockedFallback: rules.blockedFallback,
    envelope,
    anchor: anchor3,
    priority: STYLE_PRIORITY[spec.style],
    materialize,
  };
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

/** A planned tag and the slot it holds in the view's layout batch. */
export type PlannedTag = Readonly<{
  index: number;
  id: string;
  plan: TagBillboardPlan;
}>;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Design Space box the host should search for component boxes: for every
 * plan, the candidate envelope unprojected onto the anchor's depth plane and
 * pushed towards / away from the camera by the envelope's diagonal, so the
 * components a body could end up over — and those just in front of them —
 * are in. Null when no plan projects to a finite region.
 */
export function tagObstacleRegion(
  plans: readonly TagBillboardPlan[],
  projector: ViewportProjector,
): DesignBox | null {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY,
  ];
  let any = false;
  for (const plan of plans) {
    const anchor = projector.project(plan.anchor);
    const metresPerPixel = projector.worldPerPixelAt(plan.anchor);
    const { envelope } = plan;
    const reachM = Math.hypot(envelope.width, envelope.height) * metresPerPixel;
    if (!Number.isFinite(anchor.depth) || !Number.isFinite(reachM)) continue;
    const corners: Vec2[] = [
      [envelope.x, envelope.y],
      [envelope.x + envelope.width, envelope.y],
      [envelope.x + envelope.width, envelope.y + envelope.height],
      [envelope.x, envelope.y + envelope.height],
    ];
    const points: Vec3[] = [];
    for (const corner of corners) {
      const onPlane = projector.unproject({ x: corner[0], y: corner[1], depth: anchor.depth });
      points.push(
        add3(onPlane, scale3(projector.forward, -reachM)),
        add3(onPlane, scale3(projector.forward, reachM)),
      );
    }
    if (!points.every(point => point.every(Number.isFinite))) continue;
    for (const point of points) {
      for (const axis of [0, 1, 2] as const) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    any = true;
  }
  return any ? { min, max } : null;
}

/**
 * Screen outline (convex hull) of an obstacle's projected corners; null when
 * the box has no area on screen or reaches behind the camera / beyond the far
 * plane, where a projection is meaningless.
 */
export function projectObstacleOutline(
  obstacle: LayoutObstacle,
  projector: ViewportProjector,
): ScreenPolygon | null {
  const points: Vec2[] = [];
  for (const corner of obstacle.corners) {
    const screen = projector.project(corner);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
    if (!Number.isFinite(screen.depth) || screen.depth > 1) return null;
    points.push([screen.x, screen.y]);
  }
  const hull = convexHull(points);
  return hull.length >= 3 ? hull : null;
}

function segmentBounds(segment: ScreenSegment): ScreenRect {
  const minX = Math.min(segment.from[0], segment.to[0]);
  const minY = Math.min(segment.from[1], segment.to[1]);
  return {
    x: minX,
    y: minY,
    width: Math.max(segment.from[0], segment.to[0]) - minX,
    height: Math.max(segment.from[1], segment.to[1]) - minY,
  };
}

/**
 * The strokes of the given layouts on screen — every projected line and
 * path: dimension / extension / projection lines, leaders, arcs, arrowhead
 * edges — as segments a tag body keeps clear of. Glyph runs are not strokes
 * (values are covered by `labelBounds`), nor are markers.
 */
export function dimensionStrokes(layouts: readonly LayoutResult[]): ScreenSegment[] {
  const segments: ScreenSegment[] = [];
  for (const layout of layouts) {
    for (const primitive of layout.primitives) {
      if (primitive.kind === 'line') {
        segments.push({ from: primitive.from, to: primitive.to });
      } else if (primitive.kind === 'path') {
        const { points } = primitive;
        for (let index = 1; index < points.length; index += 1) {
          segments.push({ from: points[index - 1]!, to: points[index]! });
        }
        if (primitive.closed && points.length > 2) {
          segments.push({ from: points[points.length - 1]!, to: points[0]! });
        }
      }
    }
  }
  return segments;
}

/**
 * Everything besides labels the tags of one view keep clear of: the strokes
 * of every other layout in the batch, and — when the host can answer — the
 * component boxes found around the tags (`tagObstacleRegion`), projected to
 * their screen outlines, and the viewport's fixed overlays (those with an
 * area).
 */
export function collectTagObstacles(
  layouts: readonly LayoutResult[],
  planned: readonly PlannedTag[],
  projector: ViewportProjector,
  source?: LayoutObstacleSource,
): TagObstacles {
  if (planned.length === 0) return {};
  const plannedIndices = new Set(planned.map(tag => tag.index));
  const segments = dimensionStrokes(layouts.filter((_, index) => !plannedIndices.has(index)));
  const region = source?.query ? tagObstacleRegion(planned.map(tag => tag.plan), projector) : null;
  const polygons: ScreenPolygon[] = [];
  if (source?.query && region) {
    for (const obstacle of source.query(region)) {
      const outline = projectObstacleOutline(obstacle, projector);
      if (outline) polygons.push(outline);
    }
  }
  const overlays = (source?.overlays?.() ?? []).filter(rect => rect.width > 0 && rect.height > 0);
  return { polygons, segments, overlays };
}

/**
 * Placement pass for the tags of one view. Obstacles are every other visible
 * label (dimension values, flat annotations), the projected component boxes,
 * dimension strokes and viewport overlays the viewport hands in, and the tags
 * already placed. Tags are placed one by one — cards, then frames, then
 * pills, ties by id — each taking its first candidate clear of everything;
 * when no candidate is clear, the one that intrudes least wins (weighted
 * covered area: labels, tags and overlays over strokes over component
 * boxes), earlier candidates on a tie — on any ring, or on the nearest ring
 * only under `theme.tag.blockedFallback = 'first-ring'`. A
 * tag with candidates whole on screen only competes among those: leaving the
 * screen (a clipped body) is never the way round an obstacle. The same view
 * always yields the same placement.
 */
export function placeTagBillboards(
  layouts: readonly LayoutResult[],
  planned: readonly PlannedTag[],
  obstacles: TagObstacles = {},
): readonly LayoutResult[] {
  if (planned.length === 0) return layouts;
  const plannedIndices = new Set(planned.map(tag => tag.index));
  const labels: ScreenRect[] = [];
  for (const [index, layout] of layouts.entries()) {
    if (plannedIndices.has(index)) continue;
    if (layout.primitives.length === 0 || layout.derived.formattedLabel.length === 0) continue;
    labels.push(layout.labelBounds);
  }
  const boxes = (obstacles.polygons ?? []).map(polygon => ({ polygon, bounds: polygonBounds(polygon) }));
  const strokes = (obstacles.segments ?? []).map(segment => ({ segment, bounds: segmentBounds(segment) }));
  const overlays = obstacles.overlays ?? [];
  const results = [...layouts];
  const order = [...planned].sort((a, b) =>
    a.plan.priority - b.plan.priority
    || compareIds(a.id, b.id)
    || a.index - b.index);
  for (const tag of order) {
    const { envelope } = tag.plan;
    const nearBoxes = boxes.filter(box => rectsOverlap(box.bounds, envelope));
    // A stroke's bounds have no area when it is axis-aligned; pad them so the
    // overlap test still sees it.
    const nearStrokes = strokes.filter(stroke => rectsOverlap(expandRect(stroke.bounds, 1), envelope));
    const nearOverlays = overlays.filter(overlay => rectsOverlap(overlay, envelope));
    const intrusion = (candidate: ScreenRect): number => {
      let score = 0;
      for (const label of labels) {
        score += LABEL_INTRUSION_WEIGHT * rectsOverlapArea(candidate, label);
      }
      for (const overlay of nearOverlays) {
        score += OVERLAY_INTRUSION_WEIGHT * rectsOverlapArea(candidate, overlay);
      }
      for (const stroke of nearStrokes) {
        score += STROKE_INTRUSION_WEIGHT * STROKE_BAND_PX
          * segmentLengthInsideRect(stroke.segment, candidate);
      }
      for (const box of nearBoxes) {
        score += BOX_INTRUSION_WEIGHT * rectPolygonOverlapArea(candidate, box.polygon);
      }
      return score;
    };
    const considered = tag.plan.onScreen > 0
      ? tag.plan.candidates.slice(0, tag.plan.onScreen)
      : tag.plan.candidates;
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestNear = -1;
    let bestNearScore = Number.POSITIVE_INFINITY;
    for (const [index, candidate] of considered.entries()) {
      const score = intrusion(candidate);
      if (score === 0) {
        best = index;
        bestScore = 0;
        break;
      }
      if (score < bestScore - INTRUSION_TIE_PX2) {
        bestScore = score;
        best = index;
      }
      if (tag.plan.rings[index] === 0 && score < bestNearScore - INTRUSION_TIE_PX2) {
        bestNearScore = score;
        bestNear = index;
      }
    }
    // Nothing clear: `first-ring` keeps the tag on its nearest ring (short
    // leader, overlap accepted) as long as that ring has a candidate to
    // consider; `least-intrusion` takes the least covered one anywhere.
    if (bestScore !== 0 && tag.plan.blockedFallback === 'first-ring' && bestNear >= 0) {
      best = bestNear;
    }
    const result = tag.plan.materialize(Math.max(0, best));
    results[tag.index] = result;
    labels.push(result.labelBounds);
  }
  return results;
}
