export type WorldDistanceAxis = 'x' | 'y' | 'z';
export type WorldDistancePoint = readonly [number, number, number];

export type WorldDistanceAidPart =
  | Readonly<{
      id: string;
      parentId: string;
      kind: 'direct';
      from: WorldDistancePoint;
      to: WorldDistancePoint;
      valueM: number;
    }>
  | Readonly<{
      id: string;
      parentId: string;
      kind: 'axis';
      axis: WorldDistanceAxis;
      axisIndex: 0 | 1 | 2;
      from: WorldDistancePoint;
      to: WorldDistancePoint;
      valueM: number;
    }>;

export type WorldDistanceAidPlan = Readonly<{
  parentId: string;
  parts: readonly WorldDistanceAidPart[];
}>;

const AXES = [
  { axis: 'x', axisIndex: 0 },
  { axis: 'y', axisIndex: 1 },
  { axis: 'z', axisIndex: 2 },
] as const;

/**
 * E3D's GPHDIMENSION aid rule suppresses components within 0.1 mm
 * (`offset.between(-0.1mm, 0.1mm)`). Runtime golden G2-03 (E3D 3.1, 2026-09-12):
 * 0.09 mm is suppressed and 0.11 mm is drawn; a nominal 0.1 mm lands on either
 * side depending on floating-point noise, so callers must not rely on the exact
 * boundary.
 */
export const WORLD_DISTANCE_AID_ZERO_TOLERANCE_M = 0.0001;

/** E3D stores design distances in millimetres; the breakdown gate truncates in that unit. */
const METRES_TO_MILLIMETRES = 1000;

export function worldDistanceAidChildId(
  parentId: string,
  axis: WorldDistanceAxis,
): string {
  return `${parentId}::world-axis-${axis}`;
}

function isFinitePoint(point: WorldDistancePoint): boolean {
  return point.every(Number.isFinite);
}

/**
 * PML `REAL.int()` truncates toward zero. The value is first snapped to 1e-6 mm
 * so metre→millimetre conversion noise (1999.9999999998) does not flip the
 * truncation that E3D, computing natively in millimetres, would not see.
 */
function truncateMillimetres(valueMm: number): number {
  return Math.trunc(Math.round(valueMm * 1e6) / 1e6);
}

/**
 * E3D 3.1 `GPHDIMENSION.draw()` only draws the World breakdown when
 * `orthogonalOnly OR (detail AND int(offsetX + offsetY + offsetZ) ne int(length))`.
 *
 * Runtime golden G2-03 (docs/verification/e3d-measurement-runtime-golden):
 * - Show linear off (`showDirect=false`): the breakdown is always drawn.
 * - Show linear on: a single positive axis-aligned leg (N +2000 → sum 2000,
 *   length 2000) draws only the direct line, because the breakdown would coincide
 *   with it; the negative counterpart (N −2000 → sum −2000 ≠ 2000) and every
 *   multi-axis measurement draw the breakdown.
 *
 * The rule is replicated as observed (signed sum, millimetre truncation) so the
 * Web aids match E3D row for row, including the asymmetric negative case.
 */
export function shouldDrawWorldAxisBreakdown(input: Readonly<{
  delta: WorldDistancePoint;
  showDirect: boolean;
}>): boolean {
  if (!input.showDirect) return true;
  const [dx, dy, dz] = input.delta;
  const sumMm = truncateMillimetres((dx + dy + dz) * METRES_TO_MILLIMETRES);
  const lengthMm = truncateMillimetres(Math.hypot(dx, dy, dz) * METRES_TO_MILLIMETRES);
  return sumMm !== lengthMm;
}

/**
 * Plans E3D-style World aids without renderer or viewport dependencies.
 *
 * The orthogonal route is deterministic: origin → target X → target Y →
 * target Z. A suppressed zero-length leg still advances the staged point, so
 * later legs retain the same geometry and IDs. `showDirect` mirrors E3D's
 * "Show linear dimension": besides emitting the direct part it feeds the
 * breakdown gate (`shouldDrawWorldAxisBreakdown`), so a caller that renders the
 * direct dimension elsewhere must still pass the real flag.
 */
export function buildWorldDistanceAidPlan(input: Readonly<{
  parentId: string;
  origin: WorldDistancePoint;
  target: WorldDistancePoint;
  showDirect: boolean;
  showOrthogonal: boolean;
  zeroToleranceM?: number;
}>): WorldDistanceAidPlan {
  const parts: WorldDistanceAidPart[] = [];
  if (!isFinitePoint(input.origin) || !isFinitePoint(input.target)) {
    return { parentId: input.parentId, parts };
  }

  const delta: WorldDistancePoint = [
    input.target[0] - input.origin[0],
    input.target[1] - input.origin[1],
    input.target[2] - input.origin[2],
  ];
  const directDistance = Math.hypot(...delta);
  if (input.showDirect && directDistance > 0) {
    parts.push({
      id: input.parentId,
      parentId: input.parentId,
      kind: 'direct',
      from: [...input.origin],
      to: [...input.target],
      valueM: directDistance,
    });
  }

  if (
    !input.showOrthogonal
    || !shouldDrawWorldAxisBreakdown({ delta, showDirect: input.showDirect })
  ) {
    return { parentId: input.parentId, parts };
  }

  const zeroToleranceM = Math.max(
    0,
    input.zeroToleranceM ?? WORLD_DISTANCE_AID_ZERO_TOLERANCE_M,
  );
  let staged: WorldDistancePoint = [...input.origin];
  for (const { axis, axisIndex } of AXES) {
    const next: [number, number, number] = [...staged];
    next[axisIndex] = input.target[axisIndex];
    const valueM = delta[axisIndex];
    if (Math.abs(valueM) > zeroToleranceM) {
      parts.push({
        id: worldDistanceAidChildId(input.parentId, axis),
        parentId: input.parentId,
        kind: 'axis',
        axis,
        axisIndex,
        from: staged,
        to: next,
        valueM,
      });
    }
    staged = next;
  }

  return { parentId: input.parentId, parts };
}
