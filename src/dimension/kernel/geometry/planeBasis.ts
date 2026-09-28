import { cross3, tryNormalize3 } from '../vec';

import type { Vec3 } from '../types';

/**
 * 唯一的"确定性参考轴"规则：法向/方向足够偏离世界 Z 轴时取 Z，否则取 X。
 * 该规则决定弧参数化的起始角与坡度箭头等符号的展开方向；调整它必须同步
 * goldens 快照，且不允许在别处复制第二份。
 */
function referenceAxis(unit: Vec3): Vec3 {
  return Math.abs(unit[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
}

/**
 * Deterministic in-plane basis for a circle normal, stable across frames and
 * exports. Returns null for degenerate normals.
 */
export function stablePlaneBasis(
  normal: Vec3,
): Readonly<{ u: Vec3; v: Vec3 }> | null {
  const n = tryNormalize3(normal);
  if (!n) return null;
  const u = tryNormalize3(cross3(referenceAxis(n), n));
  if (!u) return null;
  const v = tryNormalize3(cross3(n, u));
  if (!v) return null;
  return { u, v };
}

/**
 * Deterministic unit vector perpendicular to `direction` (the `u` axis of the
 * stable plane basis). Used e.g. to spread slope arrowheads.
 */
export function stablePerpendicular(direction: Vec3): Vec3 | null {
  return stablePlaneBasis(direction)?.u ?? null;
}
