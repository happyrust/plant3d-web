import { length3, scale3 } from '../vec';

import type { Vec3 } from '../types';

/**
 * 4×4 affine matrix as 16 numbers in **column-major** order — the THREE
 * `Matrix4.fromArray` / `elements` layout the MBD v2 contract fixes for
 * `meta.source_to_design` (`adapters/mbdV2Contract.ts`): column `c` occupies
 * elements `4c..4c+3`, so the translation sits in elements 12–14 and the
 * projective row in 3, 7, 11, 15. Kept as the plain array the payload
 * arrives in, so the contract matrix is used as-is: no copy, no renderer
 * dependency, usable from node tests.
 */
export type Mat4ColumnMajor = readonly number[];

/** Exactly 16 finite numbers; anything else is not a usable matrix. */
export function isMat4ColumnMajor(value: unknown): value is Mat4ColumnMajor {
  return Array.isArray(value)
    && value.length === 16
    && value.every(element => typeof element === 'number' && Number.isFinite(element));
}

/**
 * Apply the whole matrix to a point — translation included — and divide by
 * the resulting `w`, in the same operation order as THREE
 * `Vector3.applyMatrix4`, so an affine payload lands on the same bits the
 * renderer path produced. Like THREE, no guard for `w ≈ 0`: contract matrices
 * are affine (`w = 1`), and a projective matrix is a producer bug that should
 * surface as non-finite output rather than be silently clamped here.
 */
export function transformPoint(m: Mat4ColumnMajor, p: Vec3): Vec3 {
  const [x, y, z] = p;
  const w = 1 / (m[3]! * x + m[7]! * y + m[11]! * z + m[15]!);
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * w,
  ];
}

/**
 * Apply only the upper 3×3 to a direction: rotation and scale reach it,
 * translation does not. Unlike THREE `Vector3.transformDirection` the result
 * is **not** normalised — callers decide through `tryNormalize3`, keeping the
 * kernel's single zero-length policy (`vec.ts`).
 */
export function transformDirection(m: Mat4ColumnMajor, d: Vec3): Vec3 {
  const [x, y, z] = d;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z,
    m[1]! * x + m[5]! * y + m[9]! * z,
    m[2]! * x + m[6]! * y + m[10]! * z,
  ];
}

/**
 * Length of a `length`-long vector along `along` (default +X) after the
 * matrix: a uniform scale reaches it, translation does not. For anisotropic
 * matrices the answer depends on `along`, so pass the axis the source length
 * was measured on.
 */
export function transformLength(
  m: Mat4ColumnMajor,
  length: number,
  along: Vec3 = [1, 0, 0],
): number {
  return length3(transformDirection(m, scale3(along, length)));
}
