import { sceneVertexAtScreen } from '../../geometry/sceneGeometry';
import { expandRect } from '../../geometry/screenGeometry';
import { EPSILON, lerp3 } from '../../vec';

import type { ViewportProjector } from '../../projector';
import type { DimensionTheme } from '../../theme';
import type {
  SceneVertex,
  ScreenGlyphRun,
  ScreenRect,
  Vec2,
  Vec3,
} from '../../types';

/**
 * Screen-space helpers shared by the layout modules (T1.2). Every function
 * here is a verbatim lift of code that used to be copied per module; the
 * arithmetic — operands and their order — is kept exactly so the layouts stay
 * bit-identical (goldens).
 */

/** Design-space point → CSS-pixel position, depth dropped. */
export function toScreen(point: Vec3, projector: ViewportProjector): Vec2 {
  const projected = projector.project(point);
  return [projected.x, projected.y];
}

/** The label box that claims space in the declutter: glyph bounds padded by half the theme padding. */
export function labelBoundsOf(glyph: ScreenGlyphRun, theme: DimensionTheme): ScreenRect {
  return expandRect(glyph.bounds, theme.labelPaddingPx / 2);
}

/**
 * The box a dimension line is trimmed against: the unrotated glyph bounds when
 * the run is rotated (the trim rotates them itself), padded like `labelBoundsOf`.
 */
export function trimBoundsOf(glyph: ScreenGlyphRun, theme: DimensionTheme): ScreenRect {
  return expandRect(glyph.unrotatedBounds ?? glyph.bounds, theme.labelPaddingPx / 2);
}

/**
 * A design-space segment together with the screen frame its trimmed pieces
 * are measured in: `origin` + `delta` is the projected segment (the caller
 * decides which projected points define it, e.g. the offset dimension line),
 * `lengthSquared` is `delta·delta`.
 */
export type BackProjectedSegment = Readonly<{
  fromWorld: Vec3;
  toWorld: Vec3;
  origin: Vec2;
  delta: Vec2;
  lengthSquared: number;
}>;

export function backProjectedSegment(
  fromWorld: Vec3,
  toWorld: Vec3,
  origin: Vec2,
  delta: Vec2,
): BackProjectedSegment {
  return {
    fromWorld,
    toWorld,
    origin,
    delta,
    lengthSquared: delta[0] * delta[0] + delta[1] * delta[1],
  };
}

/**
 * Scene vertex for a screen point on (or near) the projected segment: the
 * point's parameter `t` along `origin + delta` picks the design-space anchor
 * `lerp3(fromWorld, toWorld, t)`, and the screen offset makes the vertex land
 * exactly on `point`. `degenerateToStart` chooses the policy for a segment
 * shorter than `EPSILON` (squared): `true` parks the vertex at `fromWorld`
 * (angular chords, explicit lines), `false` leaves the raw division to the
 * caller's own upstream guards (linear, radial) — each module keeps the
 * behaviour it had before the extraction.
 */
export function sceneVertexOnSegment(
  segment: BackProjectedSegment,
  point: Vec2,
  projector: ViewportProjector,
  degenerateToStart: boolean,
): SceneVertex {
  const { fromWorld, toWorld, origin, delta, lengthSquared } = segment;
  const t = degenerateToStart && lengthSquared <= EPSILON
    ? 0
    : ((point[0] - origin[0]) * delta[0]
      + (point[1] - origin[1]) * delta[1]) / lengthSquared;
  return sceneVertexAtScreen(lerp3(fromWorld, toWorld, t), point, projector);
}
