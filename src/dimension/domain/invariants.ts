import type {
  DimensionAnchor,
  ProjectionAxisRef,
  UserDimensionRecord,
  Vec3,
} from './types';

const VECTOR_EPSILON_SQ = 1e-18;

export function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every(
      coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate),
    );
}

export function isNonZeroVec3(value: unknown): value is Vec3 {
  return isFiniteVec3(value)
    && value[0] * value[0] + value[1] * value[1] + value[2] * value[2]
      > VECTOR_EPSILON_SQ;
}

function anchorIsResolved(anchor: DimensionAnchor): boolean {
  return isFiniteVec3(anchor.snapshot);
}

function directionIsResolved(direction: ProjectionAxisRef): boolean {
  return direction.kind === 'design-axis' || isNonZeroVec3(direction.snapshot);
}

export function dimensionRecordHasResolvedGeometry(
  record: UserDimensionRecord,
): boolean {
  switch (record.kind) {
    case 'linear':
      return anchorIsResolved(record.a) && anchorIsResolved(record.b);
    case 'projected':
      return anchorIsResolved(record.a)
        && anchorIsResolved(record.b)
        && directionIsResolved(record.axis);
    case 'angular':
      return anchorIsResolved(record.vertex)
        && anchorIsResolved(record.rayA)
        && anchorIsResolved(record.rayB);
    case 'radial':
      return anchorIsResolved(record.center)
        && anchorIsResolved(record.rim)
        && directionIsResolved(record.normal)
        && isNonZeroVec3(record.placement.leaderDirection);
  }
}
