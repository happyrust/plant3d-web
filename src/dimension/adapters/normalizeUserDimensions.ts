import { projectionAxisVector as axisVector, unitVec3 } from '../domain/directions';
import { validateDimensionRecord } from '../domain/validation';

import type {
  DimensionDirections,
  UserDimensionRecord,
  Vec3,
} from '../domain/types';
import type {
  DimensionSemanticRole,
  NormalizedDimensionDirections,
  NormalizedDimensionInput,
} from '../kernel/types';

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizedDirections(
  directions: DimensionDirections | undefined,
): Readonly<{ directions?: NormalizedDimensionDirections }> {
  if (!directions) return {};
  const out: { -readonly [K in keyof NormalizedDimensionDirections]: NormalizedDimensionDirections[K] } = {};
  if (directions.dimensionDirection) out.dimensionDirection = directions.dimensionDirection;
  if (directions.projectionDirection) out.projectionDirection = directions.projectionDirection;
  // 用户定下的尺寸平面才驱动设计空间偏移；迁移推出来的旧记录仍按屏幕法向偏，画法不变。
  const normal = directions.dimensionPlane?.normal;
  if (directions.source === 'explicit' && normal && directions.dimensionDirection) {
    const offset = unitVec3(cross(normal, directions.dimensionDirection));
    if (offset) out.offsetDirection = offset;
  }
  return Object.keys(out).length > 0 ? { directions: out } : {};
}

function semanticRole(record: UserDimensionRecord): DimensionSemanticRole {
  if (record.validity === 'invalid') return 'invalid';
  const anchors = record.kind === 'linear' || record.kind === 'projected'
    ? [record.a, record.b]
    : record.kind === 'angular'
      ? [record.vertex, record.rayA, record.rayB]
      : record.kind === 'chain'
        ? record.anchors
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
        ...(record.anglePlane ? { planeNormal: record.anglePlane.normal } : {}),
      };
    case 'chain': {
      const points = record.anchors.map(anchor => anchor.snapshot);
      if (points.some(point => point === null)) return null;
      return {
        ...base,
        kind: 'chain',
        anchors: points.filter((point): point is Vec3 => point !== null),
        placement: record.placement,
        showOverall: record.showOverall,
        ...normalizedDirections(record.directions),
      };
    }
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
