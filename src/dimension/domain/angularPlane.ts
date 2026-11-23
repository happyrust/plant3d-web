import { unitVec3 } from './directions';

import type { AngularPlane, UserDimensionRecord, Vec3 } from './types';

/**
 * 近 90° 正交吸附的容差（#71）。
 *
 * E3D `DMANGL` 的 IDA 观测是：`angle / 90°` 距最近整数小于 `0.01`（也就是 0.9°）时吸到那个直角倍数。
 * 见 `docs/plans/2026-09-11-e3d-dimension-pr0-evidence-and-golden-corpus.md`。这是观测值，不是实机金样；
 * #70 回填前吸附默认关闭，打开时才用这张表。
 */
export const ANGULAR_ORTHOGONAL_SNAP = Object.freeze({
  fractionOfRightAngle: 0.01,
});

export function deriveAngularPlane(
  vertex: Vec3,
  rayA: Vec3,
  rayB: Vec3,
  source: AngularPlane['source'],
): AngularPlane | null {
  const alongA = unitVec3([rayA[0] - vertex[0], rayA[1] - vertex[1], rayA[2] - vertex[2]]);
  const alongB = unitVec3([rayB[0] - vertex[0], rayB[1] - vertex[1], rayB[2] - vertex[2]]);
  if (!alongA || !alongB) return null;
  const normal = unitVec3([
    alongA[1] * alongB[2] - alongA[2] * alongB[1],
    alongA[2] * alongB[0] - alongA[0] * alongB[2],
    alongA[0] * alongB[1] - alongA[1] * alongB[0],
  ]);
  if (!normal) return null;
  return { schema: 1, source, normal };
}

/** 重绑后：推出来的平面跟着几何走，创建时定下的平面不动。定不出平面就保持原样。 */
export function refreshAngularPlane(record: UserDimensionRecord): UserDimensionRecord {
  if (record.kind !== 'angular') return record;
  if (record.anglePlane?.source === 'explicit') return record;
  const vertex = record.vertex.snapshot;
  const rayA = record.rayA.snapshot;
  const rayB = record.rayB.snapshot;
  if (!vertex || !rayA || !rayB) return record;
  const plane = deriveAngularPlane(vertex, rayA, rayB, 'legacy-derived');
  return plane ? { ...record, anglePlane: plane } : record;
}

export function isAngularPlane(value: unknown): value is AngularPlane {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plane = value as Record<string, unknown>;
  return (plane.schema === 1)
    && (plane.source === 'explicit' || plane.source === 'legacy-derived')
    && Array.isArray(plane.normal)
    && plane.normal.length === 3
    && plane.normal.every(component => typeof component === 'number' && Number.isFinite(component));
}

/**
 * 把弧度吸到 π/2 的整数倍。`fractionOfRightAngle` 是「距最近倍数 / 1 个直角」的阈值，小于它才吸。
 * 调用方决定开不开；这里不读记录。
 */
export function snapAngleToRightAngle(
  angleRad: number,
  fractionOfRightAngle: number = ANGULAR_ORTHOGONAL_SNAP.fractionOfRightAngle,
): number {
  const rightAngle = Math.PI / 2;
  const quarters = angleRad / rightAngle;
  const nearest = Math.round(quarters);
  if (Math.abs(quarters - nearest) < fractionOfRightAngle) return nearest * rightAngle;
  return angleRad;
}
