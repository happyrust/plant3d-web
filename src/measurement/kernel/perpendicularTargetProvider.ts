import type { PerpendicularPoint, PerpendicularTarget } from './perpendicularDistance';

/**
 * Geometry a snap candidate can lend to "Perpendicular to".
 *
 * All values are design-world metres. Only authoritative sources should fill
 * `direction` / `circle` / `arc` (P-point directions from the PDMS ptset,
 * primitive key points from gen-model); a plain surface pick offers nothing
 * beyond its position and therefore falls back to point-to-point, exactly like
 * an E3D position pick (golden G4-03).
 */
export type PerpendicularTargetCandidate = Readonly<{
  point: PerpendicularPoint;
  /** Axis direction through `point` (P-point dir, PLINE / primitive axis, Graphics edge). */
  direction?: PerpendicularPoint | null;
  /** Circular face: its centre and normal define the target plane. */
  circle?: Readonly<{ center: PerpendicularPoint; normal: PerpendicularPoint }> | null;
  arc?: Readonly<{ center: PerpendicularPoint; normal: PerpendicularPoint }> | null;
  /** Facet plane (E3D Graphics `getPlane()`): position and normal of the picked facet. */
  plane?: Readonly<{ position: PerpendicularPoint; normal: PerpendicularPoint }> | null;
}>;

export type PerpendicularTargetProviderKind = 'axis-line' | 'circle-plane' | 'facet-plane' | 'point';

export type ResolvedPerpendicularTarget = Readonly<{
  target: PerpendicularTarget;
  provider: PerpendicularTargetProviderKind;
}>;

const DEGENERATE_LENGTH_SQ = 1e-24;

function isFinitePoint(point: PerpendicularPoint | null | undefined): point is PerpendicularPoint {
  return !!point && point.length === 3 && point.every(Number.isFinite);
}

function lengthSq(vector: PerpendicularPoint): number {
  return vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2];
}

/**
 * Mirrors the branch order of E3D `GMFARC.perpendicularToPoint`:
 * `getLine()` first (an axis-bearing pick becomes an infinite line), then
 * `getPlane()` (a Graphics facet or a circular face becomes an infinite plane),
 * otherwise the pick position itself.
 */
export function resolvePerpendicularTarget(
  candidate: PerpendicularTargetCandidate,
): ResolvedPerpendicularTarget {
  if (isFinitePoint(candidate.direction) && lengthSq(candidate.direction) > DEGENERATE_LENGTH_SQ) {
    const [x, y, z] = candidate.point;
    const [dx, dy, dz] = candidate.direction;
    return {
      provider: 'axis-line',
      target: { kind: 'line', start: candidate.point, end: [x + dx, y + dy, z + dz] },
    };
  }
  const facet = candidate.plane ?? null;
  if (
    facet
    && isFinitePoint(facet.position)
    && isFinitePoint(facet.normal)
    && lengthSq(facet.normal) > DEGENERATE_LENGTH_SQ
  ) {
    return {
      provider: 'facet-plane',
      target: { kind: 'plane', position: facet.position, normal: facet.normal },
    };
  }
  const circular = candidate.circle ?? candidate.arc ?? null;
  if (
    circular
    && isFinitePoint(circular.center)
    && isFinitePoint(circular.normal)
    && lengthSq(circular.normal) > DEGENERATE_LENGTH_SQ
  ) {
    return {
      provider: 'circle-plane',
      target: { kind: 'plane', position: circular.center, normal: circular.normal },
    };
  }
  return {
    provider: 'point',
    target: { kind: 'point', position: candidate.point },
  };
}
