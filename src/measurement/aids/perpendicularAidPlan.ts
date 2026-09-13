export type PerpendicularAidPoint = readonly [number, number, number];

export type PerpendicularAidLeg = Readonly<{
  id: string;
  parentId: string;
  kind: 'vertical' | 'horizontal';
  from: PerpendicularAidPoint;
  to: PerpendicularAidPoint;
  valueM: number;
}>;

export type PerpendicularAidPlan = Readonly<{
  parentId: string;
  legs: readonly PerpendicularAidLeg[];
}>;

/**
 * E3D `GPHDIMENSION.draw(REAL, ARC)` drops the decomposition when either leg is
 * shorter than 1 mm (runtime golden G4-02: a vertical target plane leaves only
 * the direct line).
 */
export const PERPENDICULAR_AID_MIN_LEG_M = 0.001;

export function perpendicularAidLegId(parentId: string, kind: PerpendicularAidLeg['kind']): string {
  return `${parentId}::perpendicular-${kind}`;
}

function isFinitePoint(point: PerpendicularAidPoint): boolean {
  return point.every(Number.isFinite);
}

/**
 * Vertical / Horizontal legs of an E3D perpendicular dimension.
 *
 * The datum is the point on the World-vertical line through the source that is
 * nearest to the foot (`POINTVECTOR(to, D).line().near(from)`), i.e. the source
 * projected down to the foot's elevation. The vertical leg runs source → datum
 * and the horizontal leg foot → datum; both are labelled with their plain
 * length in E3D. Legs are omitted entirely when either would be under 1 mm.
 */
export function buildPerpendicularAidPlan(input: Readonly<{
  parentId: string;
  /** E3D `from`: the foot on the target. */
  foot: PerpendicularAidPoint;
  /** E3D `to`: the picked source point. */
  source: PerpendicularAidPoint;
  minLegM?: number;
}>): PerpendicularAidPlan {
  if (!isFinitePoint(input.foot) || !isFinitePoint(input.source)) {
    return { parentId: input.parentId, legs: [] };
  }
  const minLegM = Math.max(0, input.minLegM ?? PERPENDICULAR_AID_MIN_LEG_M);
  const datum: PerpendicularAidPoint = [input.source[0], input.source[1], input.foot[2]];
  const verticalM = Math.abs(input.source[2] - input.foot[2]);
  const horizontalM = Math.hypot(input.foot[0] - datum[0], input.foot[1] - datum[1]);
  if (verticalM < minLegM || horizontalM < minLegM) {
    return { parentId: input.parentId, legs: [] };
  }
  return {
    parentId: input.parentId,
    legs: [
      {
        id: perpendicularAidLegId(input.parentId, 'vertical'),
        parentId: input.parentId,
        kind: 'vertical',
        from: [...input.source],
        to: datum,
        valueM: verticalM,
      },
      {
        id: perpendicularAidLegId(input.parentId, 'horizontal'),
        parentId: input.parentId,
        kind: 'horizontal',
        from: [...input.foot],
        to: datum,
        valueM: horizontalM,
      },
    ],
  };
}
