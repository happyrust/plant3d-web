import { projectionAxisVector as axisVector } from '../domain/directions';
import { validateDimensionRecord } from '../domain/validation';

import type {
  DimensionDirections,
  UserDimensionRecord,
} from '../domain/types';
import type {
  DimensionSemanticRole,
  NormalizedDimensionDirections,
  NormalizedDimensionInput,
} from '../kernel/types';

function normalizedDirections(
  directions: DimensionDirections | undefined,
): Readonly<{ directions?: NormalizedDimensionDirections }> {
  if (!directions) return {};
  const out: { dimensionDirection?: NormalizedDimensionDirections['dimensionDirection']; projectionDirection?: NormalizedDimensionDirections['projectionDirection'] } = {};
  if (directions.dimensionDirection) out.dimensionDirection = directions.dimensionDirection;
  if (directions.projectionDirection) out.projectionDirection = directions.projectionDirection;
  return Object.keys(out).length > 0 ? { directions: out } : {};
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

/**
 * 记录 → 布局输入。布局前先过与视向无关的校验（`validation.ts`）：点没解析、点类型不对、方向退化的
 * 一律不进布局（返回 null），与视向有关的那几条由布局按当帧视向判。
 */
export function normalizeUserDimension(
  record: UserDimensionRecord,
): NormalizedDimensionInput | null {
  if (!validateDimensionRecord(record).ok) return null;
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
        ...normalizedDirections(record.directions),
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
        ...normalizedDirections(record.directions),
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
