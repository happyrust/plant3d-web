/**
 * PDMS / Aveva E3D 方位（Orientation）字符串格式。
 *
 * E3D 输出形如：
 *   Y is X 5.4589 Y 0.2527 Z and Z is Y 5.4589 -X
 *
 * 语法（PDMS Orientation Language）：
 *   orientation_expr := 'Y is' <axis_expr> 'and Z is' <axis_expr>
 *   axis_expr        := <principal> [<angle_deg> <bend_axis> [<angle_deg> <bend_axis>]]
 *   principal / bend_axis := X | -X | Y | -Y | Z | -Z
 *
 * 几何含义（从实测样本反推）：每段 "θ B" 表示把当前向量朝 B 方向倾斜 θ 度，即
 *   v_new = cos(θ) · v_current + sin(θ) · B_unit  （其中 B 必须与 v_current 正交）
 *
 * 由此 v = cos(θ2)·(cos(θ1)·A + sin(θ1)·B) + sin(θ2)·C
 *         = cos(θ2)cos(θ1)·A + cos(θ2)sin(θ1)·B + sin(θ2)·C
 * 因此：
 *   sin(θ2) = dot(v, C)
 *   cos(θ2) = √(dot(v,A)² + dot(v,B)²)
 *   θ1 = atan2(dot(v,B), dot(v,A))
 */

import type { TransformMatrix } from './matrixUtils';

export type Vec3 = [number, number, number];

type AxisCandidate = {
  label: string;   // 'X' | '-X' | 'Y' | '-Y' | 'Z' | '-Z'
  idx: 0 | 1 | 2;  // 0=X, 1=Y, 2=Z
  sign: 1 | -1;
};

const ALL_AXES: AxisCandidate[] = [
  { label: 'X',  idx: 0, sign:  1 },
  { label: '-X', idx: 0, sign: -1 },
  { label: 'Y',  idx: 1, sign:  1 },
  { label: '-Y', idx: 1, sign: -1 },
  { label: 'Z',  idx: 2, sign:  1 },
  { label: '-Z', idx: 2, sign: -1 },
];

const AXIS_LABELS: Record<0 | 1 | 2, 'X' | 'Y' | 'Z'> = { 0: 'X', 1: 'Y', 2: 'Z' };

function dotAxis(v: Vec3, idx: 0 | 1 | 2, sign: 1 | -1): number {
  return v[idx] * sign;
}

/**
 * 在给定的候选轴集合里（默认全部 6 个），找和向量 v 点积最大的那一个。
 */
function pickPrincipal(v: Vec3, candidates: AxisCandidate[] = ALL_AXES): AxisCandidate {
  let best = candidates[0];
  let bestVal = dotAxis(v, best.idx, best.sign);
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const val = dotAxis(v, c.idx, c.sign);
    if (val > bestVal) {
      best = c;
      bestVal = val;
    }
  }
  return best;
}

/**
 * 格式化角度数值：保留指定小数位，并去掉 "-0.0000" 这种负零。
 */
function formatAngle(deg: number, decimals: number): string {
  const rounded = Math.round(deg * Math.pow(10, decimals)) / Math.pow(10, decimals);
  const fixed = (rounded === 0 ? 0 : rounded).toFixed(decimals);
  return fixed;
}

/**
 * 把一个归一化（或近似归一化）的方向向量转为 PDMS 轴描述字符串。
 *
 * @param dir          方向向量（局部轴在世界系中的表达；会自动归一化）
 * @param angleDigits  角度小数位，默认 4（对齐 E3D 常见精度 "5.4589"）
 * @param epsilon      判定"完全对齐/可忽略"的阈值
 */
export function formatPdmsAxis(
  dir: Vec3,
  angleDigits = 4,
  epsilon = 1e-6,
): string {
  const n = Math.hypot(dir[0], dir[1], dir[2]);
  if (n < 1e-9) return 'X';
  const u: Vec3 = [dir[0] / n, dir[1] / n, dir[2] / n];

  // 1) 主轴 A：6 个候选中与 v 最对齐的
  const A = pickPrincipal(u);
  const a = dotAxis(u, A.idx, A.sign); // ≥ 其它候选，必为正
  if (a >= 1 - epsilon) {
    return A.label;
  }

  // 2) 次轴 B：从另外 4 个（排除 A 所在的轴）中再选最对齐的
  const remainingAxesB = ALL_AXES.filter((c) => c.idx !== A.idx);
  const B = pickPrincipal(u, remainingAxesB);
  const b = dotAxis(u, B.idx, B.sign); // ≥ 0

  // 3) 第三轴 C：最后那个坐标轴，符号按 v 在该轴上的分量
  const thirdIdx = (0 + 1 + 2 - A.idx - B.idx) as 0 | 1 | 2;
  const cSigned = u[thirdIdx];
  const C_sign: 1 | -1 = cSigned >= 0 ? 1 : -1;
  const C_label = `${C_sign > 0 ? '' : '-'}${AXIS_LABELS[thirdIdx]}`;
  const c = cSigned * C_sign; // ≥ 0

  // 4) 解 θ1, θ2：sin(θ2) = c; cos(θ2) = √(a² + b²); θ1 = atan2(b, a)
  // 注：由于 A/B/C 在 ±X/±Y/±Z 中两两正交，cos(θ2) = √(1 - c²) = √(a² + b²)
  const theta1Deg = Math.atan2(b, a) * 180 / Math.PI;
  const theta2Deg = Math.asin(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;

  const tokens: string[] = [A.label];
  // 第一段：如果 b 可忽略，但 c 不可忽略，则跳过 B 段，直接从 A 倾斜到 C（即 B 折叠为 C）
  // 这种情况意味着向量落在 AC 平面内；但按目前选 B 的规则（6 个候选里最佳），
  // 只有当 b 精确为 0 时才会发生；一般由 "a ≥ 1-epsilon" 分支捕获或走正常两段。
  if (b > epsilon) {
    tokens.push(formatAngle(theta1Deg, angleDigits), B.label);
  }
  if (c > epsilon) {
    tokens.push(formatAngle(theta2Deg, angleDigits), C_label);
  }

  // 边界：当 b 可忽略而 c 也可忽略，但 a < 1-epsilon 发生的概率为 0（向量总模为 1）
  return tokens.join(' ');
}

/**
 * 从 4x4 世界变换矩阵（列主序，16 元素数组）生成 PDMS 方位字符串。
 *
 * local Y 在 world 的方向 = 矩阵第 2 列 = m[4..6]
 * local Z 在 world 的方向 = 矩阵第 3 列 = m[8..10]
 */
export function formatPdmsOrientation(
  m: TransformMatrix,
  angleDigits = 4,
): string {
  const localY: Vec3 = [m[4], m[5], m[6]];
  const localZ: Vec3 = [m[8], m[9], m[10]];
  return `Y is ${formatPdmsAxis(localY, angleDigits)} and Z is ${formatPdmsAxis(localZ, angleDigits)}`;
}
