import { add3, EPSILON } from '../vec';

import { makeCenteredGlyphRun } from './screenGeometry';

import type { LffFont } from '../glyph/lffParser';
import type { ViewportProjector } from '../projector';
import type {
  LayoutPrimitive,
  SceneFill,
  SceneGlyphRun,
  SceneLine,
  SceneMarker,
  ScenePath,
  ScenePrimitive,
  SceneTextFrame,
  SceneTone,
  SceneTriangle,
  SceneVertex,
  ScreenGlyphRun,
  ScreenRect,
  Vec2,
  Vec3,
} from '../types';

function projectedPoint(anchor: Vec3, projector: ViewportProjector): Vec2 {
  const projected = projector.project(anchor);
  return [projected.x, projected.y];
}

export function sceneVertex(
  anchor: Vec3,
  offsetPx: Vec2 = [0, 0],
): SceneVertex {
  return { anchor, offsetPx };
}

export function sceneVertexAtScreen(
  anchor: Vec3,
  screen: Vec2,
  projector: ViewportProjector,
): SceneVertex {
  const projected = projectedPoint(anchor, projector);
  return {
    anchor,
    offsetPx: [screen[0] - projected[0], screen[1] - projected[1]],
  };
}

export function projectSceneVertex(
  vertex: SceneVertex,
  projector: ViewportProjector,
): Vec2 {
  const projected = projectedPoint(vertex.anchor, projector);
  return [
    projected[0] + vertex.offsetPx[0],
    projected[1] + vertex.offsetPx[1],
  ];
}

// --- frustum clipping of the projected snapshot ------------------------------------------------------
//
// The scene painter hands every vertex to the GPU, which clips it against the
// view frustum. The projected snapshot (`LayoutResult.primitives`: hit regions,
// label bounds, tag obstacles, SVG export) used to project every anchor
// plainly: a vertex behind the camera lands at a mirrored point 1e5–1e9 px
// away, so on a close-up a dimension line that runs past the camera got a
// phantom hit region across the screen, a label behind the camera claimed
// space and pushed real labels, and the SVG carried strokes to nowhere
// (all-pipes sweep, 2026-09-14). The snapshot now follows the GPU: a vertex
// whose anchor projects outside the depth range [−1, 1] — behind the camera,
// in front of the near plane, beyond the far plane — is clipped; a stroke is
// cut where it crosses that boundary; a primitive clipped entirely keeps its
// slot (the scene ↔ projected lists stay in step) as an empty primitive far
// outside any viewport.

/** Where a primitive the GPU clips entirely is parked: no extent, far outside any viewport. */
export const CLIPPED_SCREEN_POINT: Vec2 = [-1e6, -1e6];

/** Steps of the bisection that finds where a stroke leaves the frustum (32 → 2^-32 of its length). */
const CLIP_BISECTION_STEPS = 32;

/** One projection of a scene vertex: its screen point and whether the GPU draws it. */
type ProjectedVertex = Readonly<{ screen: Vec2; visible: boolean }>;

/**
 * Project a vertex once for both its position and its visibility. The GPU
 * draws a vertex whose anchor projects to a finite point at a depth within
 * [−1, 1]; perspective projection sends a point behind the camera to a
 * finite mirrored position with a depth above 1 (the sign of the clip-space
 * `w` is lost in the divide), which is why the depth is tested rather than
 * the position.
 */
function projectVertex(vertex: SceneVertex, projector: ViewportProjector): ProjectedVertex {
  const projected = projector.project(vertex.anchor);
  return {
    screen: [projected.x + vertex.offsetPx[0], projected.y + vertex.offsetPx[1]],
    visible: Number.isFinite(projected.x)
      && Number.isFinite(projected.y)
      && projected.depth >= -1
      && projected.depth <= 1,
  };
}

/** Whether the GPU draws this vertex (see `projectVertex`). */
export function isSceneVertexVisible(vertex: SceneVertex, projector: ViewportProjector): boolean {
  return projectVertex(vertex, projector).visible;
}

function lerpSceneVertex(a: SceneVertex, b: SceneVertex, t: number): SceneVertex {
  return {
    anchor: [
      a.anchor[0] + (b.anchor[0] - a.anchor[0]) * t,
      a.anchor[1] + (b.anchor[1] - a.anchor[1]) * t,
      a.anchor[2] + (b.anchor[2] - a.anchor[2]) * t,
    ],
    offsetPx: [
      a.offsetPx[0] + (b.offsetPx[0] - a.offsetPx[0]) * t,
      a.offsetPx[1] + (b.offsetPx[1] - a.offsetPx[1]) * t,
    ],
  };
}

/**
 * The last visible vertex along `visible → clipped`, found by bisection on
 * the visibility predicate (true at 0, false at 1, one crossing in between
 * because the anchor moves linearly through one clipping plane).
 */
function clipPointTowards(visible: SceneVertex, clipped: SceneVertex, projector: ViewportProjector): SceneVertex {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < CLIP_BISECTION_STEPS; step += 1) {
    const mid = (lo + hi) / 2;
    if (isSceneVertexVisible(lerpSceneVertex(visible, clipped, mid), projector)) lo = mid;
    else hi = mid;
  }
  return lerpSceneVertex(visible, clipped, lo);
}

/** Screen point where the stroke `visible → clipped` leaves the frustum. */
function cutScreenPoint(visible: SceneVertex, clipped: SceneVertex, projector: ViewportProjector): Vec2 {
  return projectVertex(clipPointTowards(visible, clipped, projector), projector).screen;
}

/**
 * The visible part of the stroke `a → b` on screen, or null when neither end
 * is drawn (a stroke that enters and leaves the frustum between two clipped
 * ends is dropped too — its ends would be behind the camera and beyond the
 * far plane at once, which no dimension geometry does). The two ends are
 * projected once here; only a cut costs more.
 */
export function clipSceneSegment(
  a: SceneVertex,
  b: SceneVertex,
  projector: ViewportProjector,
): readonly [Vec2, Vec2] | null {
  const from = projectVertex(a, projector);
  const to = projectVertex(b, projector);
  if (from.visible && to.visible) return [from.screen, to.screen];
  if (!from.visible && !to.visible) return null;
  return from.visible
    ? [from.screen, cutScreenPoint(a, b, projector)]
    : [cutScreenPoint(b, a, projector), to.screen];
}

/**
 * The visible pieces of an open polyline on screen, each a run of
 * consecutive visible vertices with the cut points at its ends. `projected`
 * are the vertices' own projections (one per point, already made).
 */
function clipPolyline(
  points: readonly SceneVertex[],
  projected: readonly ProjectedVertex[],
  projector: ViewportProjector,
): Vec2[][] {
  const pieces: Vec2[][] = [];
  let current: Vec2[] = [];
  const flush = (): void => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let index = 1; index < points.length; index += 1) {
    const a = projected[index - 1]!;
    const b = projected[index]!;
    if (a.visible && b.visible) {
      if (current.length === 0) current.push(a.screen);
      current.push(b.screen);
    } else if (a.visible) {
      if (current.length === 0) current.push(a.screen);
      current.push(cutScreenPoint(points[index - 1]!, points[index]!, projector));
      flush();
    } else if (b.visible) {
      flush();
      current.push(cutScreenPoint(points[index]!, points[index - 1]!, projector), b.screen);
    } else {
      flush();
    }
  }
  flush();
  return pieces;
}

/**
 * A closed outline clipped against the frustum boundary on screen
 * (Sutherland–Hodgman with the visibility predicate as the half-space test);
 * empty when fewer than three points survive.
 */
function clipPolygon(
  points: readonly SceneVertex[],
  projected: readonly ProjectedVertex[],
  projector: ViewportProjector,
): Vec2[] {
  if (projected.every(point => point.visible)) return projected.map(point => point.screen);
  const out: Vec2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previousIndex = (index + points.length - 1) % points.length;
    const previous = projected[previousIndex]!;
    const current = projected[index]!;
    if (current.visible) {
      if (!previous.visible) out.push(cutScreenPoint(points[index]!, points[previousIndex]!, projector));
      out.push(current.screen);
    } else if (previous.visible) {
      out.push(cutScreenPoint(points[previousIndex]!, points[index]!, projector));
    }
  }
  return out.length >= 3 ? out : [];
}

/**
 * Whether a projected primitive is the empty stand-in of one the GPU clips
 * entirely (parked at `CLIPPED_SCREEN_POINT`, no extent). Consumers that
 * draw the snapshot (SVG export) skip these; everything that measures it
 * (hit regions, label bounds, obstacles) finds nothing there anyway.
 */
export function isClippedPrimitive(primitive: LayoutPrimitive): boolean {
  const parked = (point: Vec2): boolean =>
    point[0] === CLIPPED_SCREEN_POINT[0] && point[1] === CLIPPED_SCREEN_POINT[1];
  switch (primitive.kind) {
    case 'line':
      return parked(primitive.from) && parked(primitive.to);
    case 'path':
      return primitive.points.length === 0;
    case 'marker':
      return primitive.radiusPx === 0 && parked(primitive.at);
    case 'glyph-run':
      return primitive.bounds.width === 0 && primitive.bounds.height === 0 && parked(primitive.origin);
  }
}

function clippedGlyphRun(primitive: SceneGlyphRun): ScreenGlyphRun {
  return {
    kind: 'glyph-run',
    text: primitive.text,
    origin: CLIPPED_SCREEN_POINT,
    capHeightPx: primitive.capHeightPx,
    bounds: { x: CLIPPED_SCREEN_POINT[0], y: CLIPPED_SCREEN_POINT[1], width: 0, height: 0 },
    styleRole: primitive.styleRole,
    ...(primitive.tone ? { tone: primitive.tone } : {}),
  };
}

export function engineeringTextRotation(from: Vec2, to: Vec2): number {
  let angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  return angle;
}

export function makeSceneLine(
  from: SceneVertex,
  to: SceneVertex,
  part: SceneLine['part'],
  styleRole: string,
  lineStyle?: SceneLine['lineStyle'],
  tone?: SceneTone,
): SceneLine {
  return {
    kind: 'scene-line',
    from,
    to,
    part,
    styleRole,
    ...(lineStyle ? { lineStyle } : {}),
    ...(tone ? { tone } : {}),
  };
}

export function makeFilledSceneArrow(
  tip: SceneVertex,
  inwardDirection: Vec2,
  lengthPx: number,
  halfAngleDeg: number,
  styleRole: string,
): SceneTriangle {
  const magnitude = Math.hypot(inwardDirection[0], inwardDirection[1]);
  if (magnitude <= EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector');
  }
  const unitX = inwardDirection[0] / magnitude;
  const unitY = inwardDirection[1] / magnitude;
  const sideOffset = lengthPx * Math.tan((halfAngleDeg * Math.PI) / 180);
  const baseOffset: Vec2 = [
    tip.offsetPx[0] + unitX * lengthPx,
    tip.offsetPx[1] + unitY * lengthPx,
  ];
  return {
    kind: 'scene-triangle',
    points: [
      tip,
      sceneVertex(tip.anchor, [
        baseOffset[0] - unitY * sideOffset,
        baseOffset[1] + unitX * sideOffset,
      ]),
      sceneVertex(tip.anchor, [
        baseOffset[0] + unitY * sideOffset,
        baseOffset[1] - unitX * sideOffset,
      ]),
    ],
    part: 'arrow',
    styleRole,
  };
}

function rotatedBounds(
  bounds: ScreenRect,
  center: Vec2,
  rotationRad: number,
): ScreenRect {
  if (Math.abs(rotationRad) <= EPSILON) return bounds;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const corners: readonly Vec2[] = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height],
  ];
  const rotated = corners.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [
      center[0] + dx * cos - dy * sin,
      center[1] + dx * sin + dy * cos,
    ] as const;
  });
  const xs = rotated.map(point => point[0]);
  const ys = rotated.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function boundsOf(points: readonly Vec2[]): ScreenRect {
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/**
 * Screen corners of a framed (3D) glyph run's glyph box, in cap-height units
 * around the baseline centre: `[-w/2, descender] → [w/2, ascender]`, mapped
 * through the projected frame axes. The order is a convex quad.
 */
export function projectTextFrameQuad(
  text: string,
  frame: SceneTextFrame,
  projector: ViewportProjector,
  font: LffFont,
): readonly [Vec2, Vec2, Vec2, Vec2] {
  return textFrameQuad(
    text,
    projectedPoint(frame.origin, projector),
    projectedPoint(add3(frame.origin, frame.xAxis), projector),
    projectedPoint(add3(frame.origin, frame.yAxis), projector),
    font,
  );
}

function textFrameQuad(
  text: string,
  origin: Vec2,
  xEnd: Vec2,
  yEnd: Vec2,
  font: LffFont,
): readonly [Vec2, Vec2, Vec2, Vec2] {
  const xAxis: Vec2 = [xEnd[0] - origin[0], xEnd[1] - origin[1]];
  const yAxis: Vec2 = [yEnd[0] - origin[0], yEnd[1] - origin[1]];
  const halfWidth = font.getWidth(1, text) / 2;
  const ascent = font.ascender / font.capHeight;
  const descent = font.descender / font.capHeight;
  const corner = (x: number, y: number): Vec2 => [
    origin[0] + x * xAxis[0] + y * yAxis[0],
    origin[1] + x * xAxis[1] + y * yAxis[1],
  ];
  return [
    corner(-halfWidth, descent),
    corner(halfWidth, descent),
    corner(halfWidth, ascent),
    corner(-halfWidth, ascent),
  ];
}

/**
 * A framed run projects to its exact glyph-box quad for bounds and hit
 * testing, plus a view-plane approximation (flat run of the projected cap
 * height, rotated to the projected baseline about the box centre) that the
 * collision pass can consume unchanged, plus the frame's `perspective` —
 * the four projected frame points the SVG export maps the glyph strokes
 * through so the exported text keeps the viewport's foreshortening.
 */
function projectFramedGlyph(
  primitive: SceneGlyphRun,
  frame: SceneTextFrame,
  projector: ViewportProjector,
  font: LffFont,
): ScreenGlyphRun {
  // The frame's four projected points are the homography the run is drawn
  // through; one of them clipped and the quad is meaningless — the run is
  // out of the frustum (or cut by it) and the painter clips it too.
  const corners = [
    frame.origin,
    add3(frame.origin, frame.xAxis),
    add3(frame.origin, frame.yAxis),
    add3(add3(frame.origin, frame.xAxis), frame.yAxis),
  ].map(point => projectVertex(sceneVertex(point), projector));
  if (!corners.every(corner => corner.visible)) return clippedGlyphRun(primitive);
  const [origin, xEnd, yEnd, xyEnd] = corners.map(corner => corner.screen) as [Vec2, Vec2, Vec2, Vec2];
  const quad = textFrameQuad(primitive.text, origin, xEnd, yEnd, font);
  const capHeightPx = Math.hypot(yEnd[0] - origin[0], yEnd[1] - origin[1]);
  const center: Vec2 = [
    (quad[0][0] + quad[2][0]) / 2,
    (quad[0][1] + quad[2][1]) / 2,
  ];
  const flat = makeCenteredGlyphRun(
    font,
    primitive.text,
    center,
    capHeightPx,
    primitive.styleRole,
  );
  // atan2(0, 0) = 0: a baseline that projects to a point stays unrotated.
  const rotationRad = Math.atan2(xEnd[1] - origin[1], xEnd[0] - origin[0]);
  return {
    ...flat,
    bounds: boundsOf(quad),
    ...(Math.abs(rotationRad) > EPSILON
      ? {
        unrotatedBounds: flat.bounds,
        rotationRad,
        rotationCenter: center,
      }
      : {}),
    perspective: [origin, xEnd, xyEnd, yEnd],
  };
}

function projectGlyph(
  primitive: SceneGlyphRun,
  projector: ViewportProjector,
  font: LffFont,
): ScreenGlyphRun {
  if (primitive.frame) {
    return projectFramedGlyph(primitive, primitive.frame, projector, font);
  }
  const at = projectVertex(primitive.at, projector);
  if (!at.visible) return clippedGlyphRun(primitive);
  const center = at.screen;
  const glyph = makeCenteredGlyphRun(
    font,
    primitive.text,
    center,
    primitive.capHeightPx,
    primitive.styleRole,
  );
  return {
    ...glyph,
    bounds: rotatedBounds(glyph.bounds, center, primitive.rotationRad),
    ...(Math.abs(primitive.rotationRad) > EPSILON
      ? {
        unrotatedBounds: glyph.bounds,
        rotationRad: primitive.rotationRad,
        rotationCenter: center,
      }
      : {}),
    ...(primitive.tone ? { tone: primitive.tone } : {}),
  };
}

export function projectScenePrimitive(
  primitive: ScenePrimitive,
  projector: ViewportProjector,
  font: LffFont,
): readonly LayoutPrimitive[] {
  switch (primitive.kind) {
    case 'scene-line': {
      const clipped = clipSceneSegment(primitive.from, primitive.to, projector);
      return [{
        kind: 'line',
        from: clipped ? clipped[0] : CLIPPED_SCREEN_POINT,
        to: clipped ? clipped[1] : CLIPPED_SCREEN_POINT,
        part: primitive.part,
        styleRole: primitive.styleRole,
        ...(primitive.lineStyle ? { lineStyle: primitive.lineStyle } : {}),
        ...(primitive.tone ? { tone: primitive.tone } : {}),
      }];
    }
    case 'scene-path': {
      // A closed outline is clipped as a polygon; an open polyline keeps its
      // longest visible piece (one path primitive, one dash run — ADR 0042).
      const projected = primitive.points.map(point => projectVertex(point, projector));
      const points = primitive.closed
        ? clipPolygon(primitive.points, projected, projector)
        : clipPolyline(primitive.points, projected, projector)
          .reduce<Vec2[]>((longest, piece) => (piece.length > longest.length ? piece : longest), []);
      return [{
        kind: 'path',
        points,
        closed: primitive.closed,
        part: primitive.part,
        styleRole: primitive.styleRole,
        ...(primitive.lineStyle ? { lineStyle: primitive.lineStyle } : {}),
        ...(primitive.tone ? { tone: primitive.tone } : {}),
      }];
    }
    case 'scene-fill':
      // One closed path per fill keeps the scene ↔ projected primitive
      // correspondence 1:1 (the collision pass walks both lists in step).
      return [{
        kind: 'path',
        points: clipPolygon(
          primitive.points,
          primitive.points.map(point => projectVertex(point, projector)),
          projector,
        ),
        closed: true,
        part: primitive.part,
        styleRole: primitive.styleRole,
        tone: primitive.tone,
      }];
    case 'scene-triangle': {
      // An arrowhead is a few pixels around one anchor: drawn whole or not at all.
      const projected = primitive.points.map(point => projectVertex(point, projector));
      const visible = projected.every(point => point.visible);
      const points = projected.map(point => (visible ? point.screen : CLIPPED_SCREEN_POINT));
      return [0, 1, 2].map((index) => ({
        kind: 'line' as const,
        from: points[index]!,
        to: points[(index + 1) % 3]!,
        part: primitive.part,
        styleRole: primitive.styleRole,
      }));
    }
    case 'scene-marker': {
      const at = projectVertex(primitive.at, projector);
      return [{
        kind: 'marker',
        at: at.visible ? at.screen : CLIPPED_SCREEN_POINT,
        shape: primitive.shape,
        radiusPx: at.visible ? primitive.radiusPx : 0,
        part: primitive.part,
        styleRole: primitive.styleRole,
        ...(primitive.lineStyle ? { lineStyle: primitive.lineStyle } : {}),
      }];
    }
    case 'scene-glyph-run':
      return [projectGlyph(primitive, projector, font)];
  }
}

export function projectScenePrimitives(
  primitives: readonly ScenePrimitive[],
  projector: ViewportProjector,
  font: LffFont,
): LayoutPrimitive[] {
  return primitives.flatMap(primitive =>
    projectScenePrimitive(primitive, projector, font));
}

export function sceneGlyph(
  text: string,
  at: SceneVertex,
  capHeightPx: number,
  styleRole: string,
  rotationRad = 0,
  tone?: SceneTone,
): SceneGlyphRun {
  return {
    kind: 'scene-glyph-run',
    text,
    at,
    capHeightPx,
    rotationRad,
    styleRole,
    ...(tone ? { tone } : {}),
  };
}

/** Filled convex polygon painted under every stroke (tag bodies, leader dots). */
export function sceneFill(
  points: readonly SceneVertex[],
  part: SceneFill['part'],
  styleRole: string,
  tone: SceneTone,
): SceneFill {
  if (points.length < 3) {
    throw new RangeError('A scene fill needs at least three vertices');
  }
  return { kind: 'scene-fill', points, part, styleRole, tone };
}

/**
 * 3D text: a glyph run laid out in a design-space frame. `capHeightPx` and
 * `rotationRad` describe its view-plane approximation (projected cap height
 * and baseline angle) for consumers that cannot draw perspective text.
 */
export function sceneGlyphInFrame(
  text: string,
  frame: SceneTextFrame,
  capHeightPx: number,
  rotationRad: number,
  styleRole: string,
): SceneGlyphRun {
  return {
    kind: 'scene-glyph-run',
    text,
    at: sceneVertex(frame.origin),
    capHeightPx,
    rotationRad,
    styleRole,
    frame,
  };
}

export function scenePath(
  points: readonly SceneVertex[],
  closed: boolean,
  part: ScenePath['part'],
  styleRole: string,
  lineStyle?: ScenePath['lineStyle'],
  tone?: SceneTone,
): ScenePath {
  return {
    kind: 'scene-path',
    points,
    closed,
    part,
    styleRole,
    ...(lineStyle ? { lineStyle } : {}),
    ...(tone ? { tone } : {}),
  };
}

export function sceneMarker(
  at: SceneVertex,
  shape: SceneMarker['shape'],
  radiusPx: number,
  styleRole: string,
  lineStyle?: SceneMarker['lineStyle'],
): SceneMarker {
  return {
    kind: 'scene-marker',
    at,
    shape,
    radiusPx,
    part: 'marker',
    styleRole,
    ...(lineStyle ? { lineStyle } : {}),
  };
}
