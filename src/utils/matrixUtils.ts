/**
 * 矩阵工具函数
 * 用于处理 4x4 变换矩阵（列主序）
 */

export type TransformMatrix = number[]; // 16 个元素的数组，列主序

/**
 * 单位矩阵
 */
export const IDENTITY_MATRIX: TransformMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/**
 * 矩阵乘法 (列主序)
 * result = a * b
 */
export function multiplyMat4(a: TransformMatrix, b: TransformMatrix): TransformMatrix {
  const out: TransformMatrix = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + i] * b[j * 4 + k];
      }
      out[j * 4 + i] = sum;
    }
  }
  return out;
}

/**
 * 矩阵求逆 (列主序)
 * 使用伴随矩阵法
 */
export function inverseMat4(m: TransformMatrix): TransformMatrix | null {
  const out: TransformMatrix = new Array(16);
  
  // 提取矩阵元素（列主序转行主序便于计算）
  const m00 = m[0], m01 = m[4], m02 = m[8], m03 = m[12];
  const m10 = m[1], m11 = m[5], m12 = m[9], m13 = m[13];
  const m20 = m[2], m21 = m[6], m22 = m[10], m23 = m[14];
  const m30 = m[3], m31 = m[7], m32 = m[11], m33 = m[15];

  // 计算 2x2 子矩阵的行列式
  const b00 = m00 * m11 - m01 * m10;
  const b01 = m00 * m12 - m02 * m10;
  const b02 = m00 * m13 - m03 * m10;
  const b03 = m01 * m12 - m02 * m11;
  const b04 = m01 * m13 - m03 * m11;
  const b05 = m02 * m13 - m03 * m12;
  const b06 = m20 * m31 - m21 * m30;
  const b07 = m20 * m32 - m22 * m30;
  const b08 = m20 * m33 - m23 * m30;
  const b09 = m21 * m32 - m22 * m31;
  const b10 = m21 * m33 - m23 * m31;
  const b11 = m22 * m33 - m23 * m32;

  // 计算行列式
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  
  if (Math.abs(det) < 1e-10) {
    return null; // 矩阵不可逆
  }
  
  det = 1.0 / det;

  // 计算逆矩阵（转置伴随矩阵）
  out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * det;
  out[1] = (m12 * b08 - m10 * b11 - m13 * b07) * det;
  out[2] = (m10 * b10 - m11 * b08 + m13 * b06) * det;
  out[3] = (m11 * b07 - m10 * b09 - m12 * b06) * det;
  out[4] = (m02 * b10 - m01 * b11 - m03 * b09) * det;
  out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * det;
  out[6] = (m01 * b08 - m00 * b10 - m03 * b06) * det;
  out[7] = (m00 * b09 - m01 * b07 + m02 * b06) * det;
  out[8] = (m31 * b05 - m32 * b04 + m33 * b03) * det;
  out[9] = (m32 * b02 - m30 * b05 - m33 * b01) * det;
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det;
  out[11] = (m31 * b01 - m30 * b03 - m32 * b00) * det;
  out[12] = (m22 * b04 - m21 * b05 - m23 * b03) * det;
  out[13] = (m20 * b05 - m22 * b02 + m23 * b01) * det;
  out[14] = (m21 * b02 - m20 * b04 - m23 * b00) * det;
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det;

  return out;
}

/**
 * 从变换矩阵提取位置（平移）
 */
export function extractPosition(m: TransformMatrix): [number, number, number] {
  return [m[12], m[13], m[14]];
}

/**
 * 从变换矩阵提取缩放
 */
export function extractScale(m: TransformMatrix): [number, number, number] {
  const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);
  return [sx, sy, sz];
}

/**
 * 从变换矩阵提取旋转（欧拉角，ZYX 顺序，弧度）
 * 返回 [x, y, z] 欧拉角（弧度）
 */
export function extractEulerAngles(m: TransformMatrix): [number, number, number] {
  // 提取缩放
  const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const sy = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]);
  const sz = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]);

  // 归一化旋转部分
  const m00 = m[0] / sx, m01 = m[4] / sy, m02 = m[8] / sz;
  const m10 = m[1] / sx, m11 = m[5] / sy, m12 = m[9] / sz;
  const m20 = m[2] / sx, m21 = m[6] / sy, m22 = m[10] / sz;

  // ZYX 欧拉角提取
  let x, y, z;

  if (Math.abs(m20) < 0.999999) {
    y = -Math.asin(m20);
    const cosY = Math.cos(y);
    x = Math.atan2(m21 / cosY, m22 / cosY);
    z = Math.atan2(m10 / cosY, m00 / cosY);
  } else {
    // 万向锁情况
    z = 0;
    if (m20 > 0) {
      y = -Math.PI / 2;
      x = z + Math.atan2(m01, m02);
    } else {
      y = Math.PI / 2;
      x = -z + Math.atan2(-m01, -m02);
    }
  }

  return [x, y, z];
}

/**
 * 从变换矩阵提取旋转（欧拉角，ZYX 顺序，度数）
 * 返回 [x, y, z] 欧拉角（度数）
 */
export function extractEulerAnglesDegrees(m: TransformMatrix): [number, number, number] {
  const [x, y, z] = extractEulerAngles(m);
  return [x * 180 / Math.PI, y * 180 / Math.PI, z * 180 / Math.PI];
}

/**
 * 计算相对变换矩阵
 * 计算 element 相对于 owner 的变换
 * relative = inverse(owner_world) * element_world
 */
export function computeRelativeTransform(
  elementWorld: TransformMatrix,
  ownerWorld: TransformMatrix
): TransformMatrix | null {
  const ownerInverse = inverseMat4(ownerWorld);
  if (!ownerInverse) {
    return null; // owner 矩阵不可逆
  }
  return multiplyMat4(ownerInverse, elementWorld);
}
