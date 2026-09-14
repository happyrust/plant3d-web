import type { ReferenceFrameBasis, ReferenceFrameVector3 } from './types';

/**
 * GENSEC 的截面标架（E3D 的 `yDir` / `zDir`）——`gphdimension.pmlobj` 826–856 `offsetType()`：
 * GENSEC 当 wrt 时先拼 `ORIENTATION('Z IS ' + zDir + ' AND Y IS ' + yDir)`，三个 Offset 是 `from` 到
 * `to` 在**这个标架**三根轴线上的垂足距离（非负），不是 ORI 帧（golden G3-04：ORI 帧是 X = N / Y = W，
 * 截面标架是 X = W / Y = S，两者差 90°，E3D 显示的 `1920.14 / 400.28 / 4430.67` 只对得上截面标架）。
 *
 * Web 没有 `yDir` 属性，但 gen-model 的 `element/plines` 把每条 p-line 的**截面内偏移** `(x, y)`
 * （`JUSL` 对齐、`LMIRR` 镜像之后）与**世界起点**一起给了：`start = O + x · X + y · Y`，放置标架恒为
 * 右手（Y = Z × X），Z 就是 p-line 方向。于是任两条 p-line 的起点差 `Δstart = Δx · X + Δy · Y`，
 * 在垂直于 Z 的平面里就是一个平面旋转——用全部 p-line 最小二乘解出旋转角，再逐条验残差。
 * 只需要方向，不需要标架原点。Offset 取绝对值，所以轴的正负不影响结果。
 */
export type SectionPlineSample = Readonly<{
  /** 截面平面里的位置 `(x, y)`（mm，`JUSL` 对齐 / `LMIRR` 镜像之后）。 */
  offset: readonly [number, number];
  /** `PLSTART`：p-line 在起始截面上的世界点（mm）。 */
  start: readonly [number, number, number];
  /** `unit(end − start)`：所有 p-line 共用的轴向。 */
  dir: readonly [number, number, number];
}>;

const EPS_MM = 1e-6;
const EPS_DIR = 1e-9;
/** 各条 p-line 起点差与 `Δx · X + Δy · Y` 的残差容限（相对于该条的偏移差长度）。 */
const RESIDUAL_TOLERANCE = 1e-6;
/** 各条 p-line 的 `dir` 与公共轴向的夹角容限（sin）。 */
const AXIS_PARALLEL_TOLERANCE = 1e-6;

type V = readonly [number, number, number];

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const finite = (a: readonly number[], length: number): boolean => (
  Array.isArray(a) && a.length === length && a.every(Number.isFinite)
);

function unit(a: V): V | null {
  const n = norm(a);
  return n > EPS_DIR ? scale(a, 1 / n) : null;
}

/** 任取一个与 z 不平行的向量，做出垂直于 z 的正交对 (a, b)，b = z × a。 */
function planeBasis(z: V): readonly [V, V] {
  const seed: V = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const a = unit(sub(seed, scale(z, dot(seed, z))))!;
  return [a, cross(z, a)];
}

/**
 * 由 ≥ 2 条 p-line 解出截面标架；解不出（只有一条、偏移全相同、方向缺失或不平行、
 * 几何不自洽——例如不是同一个右手刚体放置）回 null。
 */
export function deriveSectionBasisFromPlines(
  plines: readonly SectionPlineSample[],
): ReferenceFrameBasis | null {
  const usable = plines.filter(p => finite(p.offset, 2) && finite(p.start, 3) && finite(p.dir, 3));
  const z = usable.map(p => unit(p.dir)).find((d): d is V => d !== null);
  if (!z) return null;
  // 所有 p-line 共用一根轴向；有一条不平行就不是同一根直构件。
  for (const p of usable) {
    const d = unit(p.dir);
    if (!d || norm(cross(d, z)) > AXIS_PARALLEL_TOLERANCE) return null;
  }

  // 以第一条为参考，其余每条给一个 (Δoffset, Δstart) 样本。
  const reference = usable[0]!;
  const samples = usable.slice(1).map(p => ({
    dx: p.offset[0] - reference.offset[0],
    dy: p.offset[1] - reference.offset[1],
    delta: sub(p.start, reference.start),
  })).filter(s => Math.hypot(s.dx, s.dy) > EPS_MM);
  if (samples.length === 0) return null;

  // 在垂直于 z 的平面 (a, b) 里，X = cosθ·a + sinθ·b、Y = z × X = −sinθ·a + cosθ·b，
  // 于是 Δstart 的平面分量 (Δ·a) + i(Δ·b) = (dx + i·dy)(cosθ + i·sinθ)。
  // 全部样本最小二乘：e^{iθ} ∝ Σ conj(dx + i·dy) · ((Δ·a) + i(Δ·b))。
  const [a, b] = planeBasis(z);
  let re = 0;
  let im = 0;
  for (const s of samples) {
    const da = dot(s.delta, a);
    const db = dot(s.delta, b);
    re += s.dx * da + s.dy * db;
    im += s.dx * db - s.dy * da;
  }
  const rotation = Math.hypot(re, im);
  if (!(rotation > EPS_DIR)) return null;
  const x = add(scale(a, re / rotation), scale(b, im / rotation));
  const y = cross(z, x);

  // 逐条验：起点差要落在截面平面里，且等于 Δx · X + Δy · Y（镜成左手的放置在这里被拒掉）。
  for (const s of samples) {
    const tolerance = RESIDUAL_TOLERANCE * Math.hypot(s.dx, s.dy) + EPS_MM;
    const rebuilt = add(scale(x, s.dx), scale(y, s.dy));
    if (norm(sub(rebuilt, s.delta)) > tolerance) return null;
  }

  return Object.freeze({
    u: Object.freeze([x[0], x[1], x[2]] as const) as ReferenceFrameVector3,
    v: Object.freeze([y[0], y[1], y[2]] as const) as ReferenceFrameVector3,
    w: Object.freeze([z[0], z[1], z[2]] as const) as ReferenceFrameVector3,
  });
}
