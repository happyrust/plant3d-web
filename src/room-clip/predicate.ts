/**
 * 房间面板网格预处理与三射线奇偶投票点在体内判定（1:1 移植自 `plant-ui/crates/plant-room/src/predicate.rs`，ADR-0029）。
 *
 * 坐标单位约定：全部为 PDMS 世界系毫米（mm），数值采用 JS `number`（IEEE 754 双精度 f64）。
 */

export type Vec3Mm = [number, number, number];

export type AabbMm = {
  min: Vec3Mm;
  max: Vec3Mm;
}

/** 世界毫米系下的面板三角网（已做 0.01 mm 顶点焊接与退化三角形剔除）。 */
export type PanelTriMesh = {
  vertices: Vec3Mm[];
  indices: [number, number, number][];
  triAabbs: AabbMm[];
  aabb: AabbMm;
}

/** 面板网格顶点焊接步长（0.01 mm）：缝合相邻三角面导出的微小浮点裂缝。 */
export const PANEL_WELD_STEP_MM = 0.01;

/** 退化三角形的正弦阈值：剔除三点共线或零面积的狭长退化面。 */
export const PANEL_DEGENERATE_SIN = 1e-7;

/** 射线–三角形重心坐标容差。 */
const BARYCENTRIC_EPS = 1e-9;

/** 射线起点最小正距离（mm）。 */
const RAY_T_MIN_MM = 1e-5;

function normalize3(v: Vec3Mm): Vec3Mm {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= 0) return [1, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** 三条互不共面、与坐标轴成偏角的单位射线方向（避免与轴对齐墙板/棱边平行）。 */
const SKEWED_RAY_DIRS: readonly Vec3Mm[] = [
  normalize3([0.773, 0.3319, 0.5411]),
  normalize3([-0.2, 0.9, 0.3]),
  normalize3([0.1, -0.4, 0.85]),
];

function quantizeCoord(value: number, invStep: number): number {
  return Math.round(value * invStep);
}

/** 用列主序 4x4 矩阵（Three.js `Matrix4.elements`）变换局部三维点到世界毫米系。 */
export function transformPointMm(matrixElements: ArrayLike<number>, x: number, y: number, z: number): Vec3Mm {
  const m = matrixElements;
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

function triangleIsDegenerate(a: Vec3Mm, b: Vec3Mm, c: Vec3Mm): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];

  const abLenSq = abx * abx + aby * aby + abz * abz;
  const acLenSq = acx * acx + acy * acy + acz * acz;
  const denom = Math.sqrt(abLenSq * acLenSq);
  if (denom <= 1e-12) return true;

  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  const crossLen = Math.hypot(cx, cy, cz);
  return crossLen / denom <= PANEL_DEGENERATE_SIN;
}

function computeTriAabb(a: Vec3Mm, b: Vec3Mm, c: Vec3Mm): AabbMm {
  return {
    min: [
      Math.min(a[0], b[0], c[0]),
      Math.min(a[1], b[1], c[1]),
      Math.min(a[2], b[2], c[2]),
    ],
    max: [
      Math.max(a[0], b[0], c[0]),
      Math.max(a[1], b[1], c[1]),
      Math.max(a[2], b[2], c[2]),
    ],
  };
}

/**
 * 将局部网格顶点/索引与实例世界矩阵（列主序 16 元素，毫米）合成为焊接后的世界三角网。
 */
export function panelTriMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  matrixElements: ArrayLike<number>,
): PanelTriMesh | null {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 3 || indices.length < 3) return null;

  const invStep = 1.0 / PANEL_WELD_STEP_MM;
  const weldedMap = new Map<string, number>();
  const weldedVertices: Vec3Mm[] = [];
  const remap = new Uint32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const lx = positions[i * 3]!;
    const ly = positions[i * 3 + 1]!;
    const lz = positions[i * 3 + 2]!;
    const worldPt = transformPointMm(matrixElements, lx, ly, lz);
    if (!Number.isFinite(worldPt[0]) || !Number.isFinite(worldPt[1]) || !Number.isFinite(worldPt[2])) {
      return null;
    }
    const key = `${quantizeCoord(worldPt[0], invStep)},${quantizeCoord(worldPt[1], invStep)},${quantizeCoord(worldPt[2], invStep)}`;
    let weldedIdx = weldedMap.get(key);
    if (weldedIdx === undefined) {
      weldedIdx = weldedVertices.length;
      weldedVertices.push(worldPt);
      weldedMap.set(key, weldedIdx);
    }
    remap[i] = weldedIdx;
  }

  const weldedTris: [number, number, number][] = [];
  const triAabbs: AabbMm[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const triCount = Math.floor(indices.length / 3);
  for (let t = 0; t < triCount; t++) {
    const rawA = indices[t * 3]!;
    const rawB = indices[t * 3 + 1]!;
    const rawC = indices[t * 3 + 2]!;
    if (rawA >= vertexCount || rawB >= vertexCount || rawC >= vertexCount) continue;

    const ia = remap[rawA]!;
    const ib = remap[rawB]!;
    const ic = remap[rawC]!;
    if (ia === ib || ib === ic || ia === ic) continue;

    const va = weldedVertices[ia]!;
    const vb = weldedVertices[ib]!;
    const vc = weldedVertices[ic]!;
    if (triangleIsDegenerate(va, vb, vc)) continue;

    weldedTris.push([ia, ib, ic]);
    const triBox = computeTriAabb(va, vb, vc);
    triAabbs.push(triBox);

    if (triBox.min[0] < minX) minX = triBox.min[0];
    if (triBox.min[1] < minY) minY = triBox.min[1];
    if (triBox.min[2] < minZ) minZ = triBox.min[2];
    if (triBox.max[0] > maxX) maxX = triBox.max[0];
    if (triBox.max[1] > maxY) maxY = triBox.max[1];
    if (triBox.max[2] > maxZ) maxZ = triBox.max[2];
  }

  if (weldedTris.length === 0) return null;

  return {
    vertices: weldedVertices,
    indices: weldedTris,
    triAabbs,
    aabb: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}

export function pointInsideAabb(point: Vec3Mm, aabb: AabbMm, eps = 1e-4): boolean {
  return (
    point[0] >= aabb.min[0] - eps &&
    point[0] <= aabb.max[0] + eps &&
    point[1] >= aabb.min[1] - eps &&
    point[1] <= aabb.max[1] + eps &&
    point[2] >= aabb.min[2] - eps &&
    point[2] <= aabb.max[2] + eps
  );
}

export function aabbsOverlap(a: AabbMm, b: AabbMm): boolean {
  return (
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] &&
    a.max[2] >= b.min[2]
  );
}

/** 射线 `origin + t * dir`（`t >= 0`）是否与 AABB 相交（避免 `0 * INF = NaN`）。 */
function rayHitsAabb(origin: Vec3Mm, dir: Vec3Mm, aabb: AabbMm): boolean {
  let tMin = 0.0;
  let tMax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis]!;
    const d = dir[axis]!;
    const bMin = aabb.min[axis]! - 1e-6;
    const bMax = aabb.max[axis]! + 1e-6;
    if (Math.abs(d) < 1e-12) {
      if (o < bMin || o > bMax) return false;
    } else {
      const inv = 1.0 / d;
      let t1 = (bMin - o) * inv;
      let t2 = (bMax - o) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return false;
    }
  }
  return tMax >= 0.0;
}

/**
 * 双精度 Möller–Trumbore 射线–三角形求交：返回 `t > tMin` 的交点参数，未命中回 `null`。
 */
export function rayHitTriangle(
  origin: Vec3Mm,
  dir: Vec3Mm,
  a: Vec3Mm,
  b: Vec3Mm,
  c: Vec3Mm,
  tMin = RAY_T_MIN_MM,
): number | null {
  const e1x = b[0] - a[0];
  const e1y = b[1] - a[1];
  const e1z = b[2] - a[2];
  const e2x = c[0] - a[0];
  const e2y = c[1] - a[1];
  const e2z = c[2] - a[2];

  const hx = dir[1] * e2z - dir[2] * e2y;
  const hy = dir[2] * e2x - dir[0] * e2z;
  const hz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1.0 / det;
  const sx = origin[0] - a[0];
  const sy = origin[1] - a[1];
  const sz = origin[2] - a[2];

  const u = (sx * hx + sy * hy + sz * hz) * invDet;
  if (u < -BARYCENTRIC_EPS || u > 1.0 + BARYCENTRIC_EPS) return null;

  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
  if (v < -BARYCENTRIC_EPS || u + v > 1.0 + BARYCENTRIC_EPS) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > tMin ? t : null;
}

/**
 * 三射线奇偶多数票判定点 `point` 是否在闭合面板 `panel` 内（3 票中 >= 2 票奇数次穿面即判内）。
 */
export function pointInsidePanel(panel: PanelTriMesh, point: Vec3Mm): boolean {
  if (!pointInsideAabb(point, panel.aabb)) return false;

  let insideVotes = 0;
  for (let d = 0; d < SKEWED_RAY_DIRS.length; d++) {
    const dir = SKEWED_RAY_DIRS[d]!;
    let hits = 0;
    for (let i = 0; i < panel.indices.length; i++) {
      const triBox = panel.triAabbs[i]!;
      if (!rayHitsAabb(point, dir, triBox)) continue;
      const [ia, ib, ic] = panel.indices[i]!;
      const t = rayHitTriangle(
        point,
        dir,
        panel.vertices[ia]!,
        panel.vertices[ib]!,
        panel.vertices[ic]!,
      );
      if (t !== null) hits++;
    }
    if ((hits & 1) === 1) {
      insideVotes++;
      if (insideVotes >= 2) return true;
    } else if (d === 1 && insideVotes === 0) {
      // 前两条射线都判外，第三条不可能凑满 2 票，提前退出
      return false;
    }
  }
  return insideVotes >= 2;
}