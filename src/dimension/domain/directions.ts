import { isFiniteVec3, isNonZeroVec3 } from './invariants';

import type {
  DimensionDirections,
  ProjectionAxisRef,
  UserDimensionRecord,
  Vec3,
} from './types';

type DirectionalRecord = Extract<UserDimensionRecord, { kind: 'linear' | 'projected' }>;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function unitVec3(value: Vec3): Vec3 | null {
  if (!isNonZeroVec3(value)) return null;
  const length = Math.hypot(value[0], value[1], value[2]);
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function projectionAxisVector(axis: ProjectionAxisRef): Vec3 {
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

/**
 * 由端点 / 轴快照推出旧记录的方向（不看相机）。推不出的项省略，不编：线性尺寸两端重合时什么都没有；
 * 线性尺寸没有视向就定不了尺寸平面；投影尺寸两点已在同一条轴线上时没有投影方向，也就没有平面。
 */
export function deriveDimensionDirections(record: DirectionalRecord): DimensionDirections {
  const a = record.a.snapshot;
  const b = record.b.snapshot;
  const span = isFiniteVec3(a) && isFiniteVec3(b) ? sub(b, a) : null;
  if (record.kind === 'linear') {
    const along = span ? unitVec3(span) : null;
    return {
      schema: 1,
      source: 'legacy-derived',
      ...(along ? { measuredAxis: along, dimensionDirection: along } : {}),
    };
  }
  const axis = unitVec3(projectionAxisVector(record.axis));
  if (!axis) return { schema: 1, source: 'legacy-derived' };
  const perpendicular = span
    ? unitVec3(sub(span, [axis[0] * dot(span, axis), axis[1] * dot(span, axis), axis[2] * dot(span, axis)]))
    : null;
  const normal = perpendicular ? unitVec3(cross(axis, perpendicular)) : null;
  return {
    schema: 1,
    source: 'legacy-derived',
    measuredAxis: axis,
    dimensionDirection: axis,
    ...(perpendicular ? { projectionDirection: perpendicular } : {}),
    ...(normal ? { dimensionPlane: { normal } } : {}),
  };
}

/**
 * 迁移 / 恢复入口：线性 / 投影记录没有方向时补上 `legacy-derived`；已有的原样保留。
 * 别的种类原样返回。
 */
export function withDimensionDirections(record: UserDimensionRecord): UserDimensionRecord {
  if (record.kind !== 'linear' && record.kind !== 'projected') return record;
  if (record.directions) return record;
  return { ...record, directions: deriveDimensionDirections(record) };
}

/** 端点 / 轴重绑后：推出来的方向随几何重推，用户定下的不动。 */
export function refreshDerivedDirections(record: UserDimensionRecord): UserDimensionRecord {
  if (record.kind !== 'linear' && record.kind !== 'projected') return record;
  if (record.directions?.source !== 'legacy-derived') return record;
  return { ...record, directions: deriveDimensionDirections(record) };
}

/** 入库只要求有限：零向量照样能存，由 `validation.ts` 报 `DEGENERATE_*`，而不是在恢复时整份拒掉。 */
function optionalVector(value: unknown): boolean {
  return value === undefined || isFiniteVec3(value);
}

export function isDimensionDirections(value: unknown): value is DimensionDirections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const directions = value as Record<string, unknown>;
  if (directions.schema !== 1) return false;
  if (directions.source !== 'explicit' && directions.source !== 'legacy-derived') return false;
  if (Object.prototype.hasOwnProperty.call(directions, 'viewDirection')) return false;
  const plane = directions.dimensionPlane;
  const planeValid = plane === undefined
    || (
      !!plane
      && typeof plane === 'object'
      && isFiniteVec3((plane as Record<string, unknown>).normal)
    );
  return optionalVector(directions.measuredAxis)
    && optionalVector(directions.dimensionDirection)
    && optionalVector(directions.projectionDirection)
    && planeValid;
}
