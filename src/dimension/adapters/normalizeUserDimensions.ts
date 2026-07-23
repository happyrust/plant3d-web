import type {
  ProjectionAxisRef,
  UserDimensionRecord,
  Vec3,
} from '../domain/types';
import type {
  DimensionSemanticRole,
  NormalizedDimensionInput,
} from '../kernel/types';

function axisVector(axis: ProjectionAxisRef): Vec3 {
  if (axis.kind === 'semantic-direction') return axis.snapshot;
  switch (axis.axis) {
    case 'x':
      return [1, 0, 0];
    case 'y':
      return [0, 1, 0];
    case 'z':
      return [0, 0, 1];
  }
}

function semanticRole(record: UserDimensionRecord): DimensionSemanticRole {
  if (record.validity === 'invalid') return 'invalid';
  const anchors = record.kind === 'linear' || record.kind === 'projected'
    ? [record.a, record.b]
    : record.kind === 'angular'
      ? [record.vertex, record.rayA, record.rayB]
      : [record.center, record.rim];
  return anchors.some(anchor => anchor.accuracy === 'approximate')
    ? 'approximate'
    : 'normal';
}

export function normalizeUserDimension(
  record: UserDimensionRecord,
): NormalizedDimensionInput | null {
  const role = semanticRole(record);
  const base = {
    id: record.id,
    role,
    labelPinned: record.labelPinned,
  } as const;

  switch (record.kind) {
    case 'linear':
      if (!record.a.snapshot || !record.b.snapshot) return null;
      return {
        ...base,
        kind: 'linear',
        a: record.a.snapshot,
        b: record.b.snapshot,
        placement: record.placement,
      };
    case 'projected':
      if (!record.a.snapshot || !record.b.snapshot) return null;
      return {
        ...base,
        kind: 'projected',
        a: record.a.snapshot,
        b: record.b.snapshot,
        axis: axisVector(record.axis),
        placement: record.placement,
      };
    case 'angular':
      if (
        !record.vertex.snapshot
        || !record.rayA.snapshot
        || !record.rayB.snapshot
      ) {
        return null;
      }
      return {
        ...base,
        kind: 'angular',
        vertex: record.vertex.snapshot,
        rayA: record.rayA.snapshot,
        rayB: record.rayB.snapshot,
        placement: record.placement,
      };
    case 'radial':
      if (!record.center.snapshot || !record.rim.snapshot) return null;
      return {
        ...base,
        kind: 'radial',
        center: record.center.snapshot,
        rim: record.rim.snapshot,
        normal: axisVector(record.normal),
        display: record.display,
        placement: record.placement,
      };
  }
}
