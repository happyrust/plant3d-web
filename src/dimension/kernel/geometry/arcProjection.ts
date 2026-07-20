import { stablePlaneBasis } from './planeBasis';

import type { ViewportProjector } from '../projector';
import type { Vec2, Vec3 } from '../types';

const DEFAULT_CHORD_TOLERANCE_PX = 0.25;
const MAX_SUBDIVISION_DEPTH = 5;
const MAX_PATH_POINTS = 257;
const INITIAL_SEGMENT_SWEEP = Math.PI / 8;
const FULL_CIRCLE_EPSILON = 1e-9;

export type DesignArc = Readonly<{
  center: Vec3;
  normal: Vec3;
  radiusM: number;
  /** Radians in the arc plane; omit both angles for a full circle. */
  startAngle?: number;
  endAngle?: number;
}>;

export type ProjectedArc = Readonly<{
  points: readonly Vec2[];
  closed: boolean;
}>;

function isFiniteVec2(point: Vec2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/**
 * Project a design-space arc to one connected screen polyline. Subdivision is
 * adaptive: a chord is split while the projected midpoint deviates from the
 * chord midpoint by more than `tolerancePx` (bounded by depth and point
 * count), so perspective distortion is followed without a fixed segment
 * count. Returns null for degenerate arcs or non-finite projections.
 */
export function projectArcToScreenPath(
  arc: DesignArc,
  projector: ViewportProjector,
  tolerancePx = DEFAULT_CHORD_TOLERANCE_PX,
): ProjectedArc | null {
  if (!Number.isFinite(arc.radiusM) || arc.radiusM <= 0) return null;
  const basis = stablePlaneBasis(arc.normal);
  if (!basis) return null;

  const hasExplicitAngles = arc.startAngle !== undefined || arc.endAngle !== undefined;
  const startAngle = arc.startAngle ?? 0;
  const endAngle = arc.endAngle ?? startAngle + Math.PI * 2;
  const sweep = endAngle - startAngle;
  if (!Number.isFinite(sweep) || Math.abs(sweep) < FULL_CIRCLE_EPSILON) return null;
  const closed = !hasExplicitAngles
    || Math.abs(Math.abs(sweep) - Math.PI * 2) < FULL_CIRCLE_EPSILON;

  const pointAt = (angle: number): Vec3 => {
    const cos = Math.cos(angle) * arc.radiusM;
    const sin = Math.sin(angle) * arc.radiusM;
    return [
      arc.center[0] + basis.u[0] * cos + basis.v[0] * sin,
      arc.center[1] + basis.u[1] * cos + basis.v[1] * sin,
      arc.center[2] + basis.u[2] * cos + basis.v[2] * sin,
    ];
  };
  const projectAt = (angle: number): Vec2 => {
    const projected = projector.project(pointAt(angle));
    return [projected.x, projected.y];
  };

  const initialSegments = Math.min(
    64,
    Math.max(4, Math.ceil(Math.abs(sweep) / INITIAL_SEGMENT_SWEEP)),
  );
  const first = projectAt(startAngle);
  if (!isFiniteVec2(first)) return null;
  const points: Vec2[] = [first];
  let nonFinite = false;

  const subdivide = (
    angle0: number,
    point0: Vec2,
    angle1: number,
    point1: Vec2,
    depth: number,
  ): void => {
    if (nonFinite) return;
    if (!isFiniteVec2(point1)) {
      nonFinite = true;
      return;
    }
    if (depth < MAX_SUBDIVISION_DEPTH && points.length < MAX_PATH_POINTS) {
      const angleMid = (angle0 + angle1) / 2;
      const projectedMid = projectAt(angleMid);
      const chordMid: Vec2 = [
        (point0[0] + point1[0]) / 2,
        (point0[1] + point1[1]) / 2,
      ];
      if (
        isFiniteVec2(projectedMid)
        && Math.hypot(
          projectedMid[0] - chordMid[0],
          projectedMid[1] - chordMid[1],
        ) > tolerancePx
      ) {
        subdivide(angle0, point0, angleMid, projectedMid, depth + 1);
        subdivide(
          angleMid,
          projectedMid,
          angle1,
          point1,
          depth + 1,
        );
        return;
      }
    }
    points.push(point1);
  };

  for (let index = 0; index < initialSegments; index += 1) {
    const angle0 = startAngle + (sweep * index) / initialSegments;
    const angle1 = startAngle + (sweep * (index + 1)) / initialSegments;
    subdivide(angle0, points[points.length - 1]!, angle1, projectAt(angle1), 0);
    if (nonFinite) return null;
  }
  if (points.length < 2) return null;
  if (closed) {
    // A closed path re-joins its first point via closePath; drop the
    // duplicated end sample so dashes do not double up on the seam.
    const last = points[points.length - 1]!;
    if (
      Math.hypot(last[0] - first[0], last[1] - first[1]) < tolerancePx
    ) {
      points.pop();
    }
  }
  return { points, closed };
}
