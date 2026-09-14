/**
 * 云线空间范围体的齐次裁剪内核——2026-09-14 方案 §4.1 / §4.2（B3 / B4）的纯函数部分。
 *
 * - 世界凸单元 `WorldCell` = 有面连接关系的凸多面体（不是无拓扑角点列表）：齐次裁剪每裁一个平面都要补截面封口，
 *   封口继续参与下一平面的裁剪，否则范围体完全包住视锥（相机钻入）时六个原始面都在视锥外会错误得到空结果。
 * - 裁剪发生在**透视除法之前**：保留半空间 `w ≥ ε`、`z + w ≥ 0`、`w − z ≥ 0`（深度），`x ± w`、`y ± w`（侧向，可选）。
 *   不把负 w 取绝对值，也不先除 w 再 clamp ndcZ。
 * - 角点来源：局部盒 × 放置矩阵（`localToWorld` **已含** globalModelMatrix，只乘一次）；含剪切时是平行六面体，
 *   保留 8 角点 + 6 面即可，不用正交化重建一个可能缩小的盒。
 *
 * 矩阵按 three.js `Matrix4.elements` 列主序 16 数；无 DOM / three 依赖，可被 Vitest 直接测。
 */

export type V3 = readonly [number, number, number];
export type V4 = readonly [number, number, number, number];
export type Mat4 = readonly number[];

/** 世界顶点：带稳定来源身份（`src:${cellId}:${index}` / `cut:${plane}(…)`），供波纹相位锚定 */
export type WorldVertex = { p: V3; id: string };
/** 面 = 顶点环；单元 = 面集合（封闭凸多面体） */
export type WorldCell = readonly (readonly WorldVertex[])[];
export type ClipVertex = { h: V4; p: V3; id: string };
export type ClipSolid = ClipVertex[][];
/** 齐次半空间：`dot(n, clip) + k ≥ 0` 保留 */
export type Plane4 = { id: string; n: V4; k: number };

export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export function unit3(a: V3): V3 {
  const n = len3(a);
  if (!(n > 0)) throw new Error('zero vector');
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** 列主序 4×4 × 齐次列向量 */
export function mul4(m: Mat4, p: V4): V4 {
  if (m.length !== 16) throw new Error('Matrix4 needs 16 values');
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let c = 0; c < 4; c++) s += m[c * 4 + r]! * p[c]!;
    out[r] = s;
  }
  if (!out.every(Number.isFinite)) throw new Error('non-finite transform');
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

/** 仿射 / 投影变换一个点并做透视除法 */
export function transformPoint(m: Mat4, p: V3): V3 {
  const h = mul4(m, [p[0], p[1], p[2], 1]);
  if (Math.abs(h[3]) < 1e-15) throw new Error('point at infinity');
  return [h[0] / h[3], h[1] / h[3], h[2] / h[3]];
}

/** 盒 8 角点的固定位序：bit = (x, y, z) 取 max 与否；边 / 面索引都依赖这一顺序 */
export const BOX_CORNER_BITS: readonly (readonly [0 | 1, 0 | 1, 0 | 1])[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
/** 盒 6 面（顶点索引环） */
export const BOX_FACES: readonly (readonly number[])[] = [
  [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
];
/** 盒 12 条边（顶点索引对） */
export const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** 由 8 个（已按 `BOX_CORNER_BITS` 排好的）世界角点组一个封闭盒单元 */
export function boxCellFromCorners(corners: readonly V3[], cellId: string): WorldVertex[][] {
  if (corners.length !== 8) throw new Error('box cell needs 8 corners');
  const vertices = corners.map((p, i) => ({ id: `src:${cellId}:${i}`, p }));
  return BOX_FACES.map((f) => f.map((i) => vertices[i]!));
}

/**
 * 对象局部盒 × 放置矩阵 → 世界盒单元。`localToWorld` **必须**已含 globalModelMatrix 恰好一次。
 * 剪切矩阵下得到平行六面体，照样保留 8 角点 + 6 面（不正交化）。
 */
export function buildObjectBoxCell(min: V3, max: V3, localToWorld: Mat4, cellId: string): WorldVertex[][] {
  if ([...min, ...max].some((x) => !Number.isFinite(x)) || min.some((x, i) => x > max[i]!)) {
    throw new Error('invalid local box');
  }
  const corners = BOX_CORNER_BITS.map((b) => transformPoint(localToWorld, [
    b[0] ? max[0] : min[0],
    b[1] ? max[1] : min[1],
    b[2] ? max[2] : min[2],
  ]));
  return boxCellFromCorners(corners, cellId);
}

/** 把整个单元的每个顶点过一遍仿射矩阵（坐标系重映射 G_new · G_old⁻¹ 用） */
export function transformWorldCell(cell: WorldCell, m: Mat4): WorldVertex[][] {
  const mapped = new Map<string, WorldVertex>();
  return cell.map((face) => face.map((v) => {
    let out = mapped.get(v.id);
    if (!out) {
      out = { id: v.id, p: transformPoint(m, v.p) };
      mapped.set(v.id, out);
    }
    return out;
  }));
}

const eval4 = (plane: Plane4, v: ClipVertex): number =>
  plane.n[0] * v.h[0] + plane.n[1] * v.h[1] + plane.n[2] * v.h[2] + plane.n[3] * v.h[3] + plane.k;

function mixVertex(a: ClipVertex, b: ClipVertex, t: number, planeId: string): ClipVertex {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const mix = (x: readonly number[], y: readonly number[]) => x.map((v, i) => v + (y[i]! - v) * t);
  const h = mix(a.h, b.h);
  const p = mix(a.p, b.p);
  return {
    h: [h[0]!, h[1]!, h[2]!, h[3]!],
    p: [p[0]!, p[1]!, p[2]!],
    id: `cut:${planeId}(${[a.id, b.id].sort().join('|')})`,
  };
}

/** Sutherland–Hodgman 单面裁剪；插值同一 t 作用于 clip / world 坐标，来源 id 记录切割平面 */
export function clipFace4(face: readonly ClipVertex[], plane: Plane4): ClipVertex[] {
  const out: ClipVertex[] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i]!;
    const b = face[(i + 1) % face.length]!;
    const da = eval4(plane, a);
    const db = eval4(plane, b);
    if ((da >= 0) !== (db >= 0)) out.push(mixVertex(a, b, da / (da - db), plane.id));
    if (db >= 0) out.push(b);
  }
  return out;
}

/** 新截面在它自己的世界平面里排序（建二维基 → 去重 → 凸包），这里绝不能用 x/w、y/w */
function orderCap(vertices: readonly ClipVertex[], worldEps: number): ClipVertex[] {
  const unique: ClipVertex[] = [];
  for (const v of [...vertices].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!unique.some((u) => len3(sub3(u.p, v.p)) <= worldEps)) unique.push(v);
  }
  if (unique.length < 3) return [];
  const origin = unique[0]!.p;
  const furthest = unique.reduce((a, b) => (len3(sub3(a.p, origin)) >= len3(sub3(b.p, origin)) ? a : b));
  const u = unit3(sub3(furthest.p, origin));
  const normal = unique
    .map((v) => cross3(u, sub3(v.p, origin)))
    .reduce((a, b) => (len3(a) >= len3(b) ? a : b));
  if (len3(normal) <= worldEps) return [];
  const v = cross3(unit3(normal), u);
  const byId = new Map(unique.map((p) => [p.id, p] as const));
  const planar = unique.map((p) => ({ id: p.id, x: dot3(sub3(p.p, origin), u), y: dot3(sub3(p.p, origin), v) }));
  return convexHullIds(planar).map((id) => byId.get(id)!);
}

/** 截面排序专用的二维凸包（只返回 id 序），与 `hull2d.convexHull2d` 同算法，避免循环依赖 */
function convexHullIds(points: readonly { id: string; x: number; y: number }[]): string[] {
  const sorted = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1]!.x || p.y !== arr[i - 1]!.y);
  if (sorted.length < 3) return sorted.map((p) => p.id);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (items: typeof sorted) => {
    const h: typeof sorted = [];
    for (const q of items) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    return h;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((p) => p.id);
}

/**
 * 封闭凸体的齐次裁剪：逐平面裁每个面，并把本平面产生的全部切割点组成新截面加入；
 * 新截面参与之后每一个平面的裁剪。返回空数组 = 完全在视锥外。
 */
export function clipConvexSolid4(solid: ClipSolid, planes: readonly Plane4[], worldEps = 1e-8): ClipSolid {
  let faces: ClipSolid = solid.map((f) => [...f]);
  for (const plane of planes) {
    const cuts: ClipVertex[] = [];
    const next: ClipSolid = [];
    let sawInside = false;
    let sawOutside = false;
    for (const f of faces) {
      for (let i = 0; i < f.length; i++) {
        const a = f[i]!;
        const b = f[(i + 1) % f.length]!;
        const da = eval4(plane, a);
        const db = eval4(plane, b);
        if (da >= 0) sawInside = true; else sawOutside = true;
        if ((da >= 0) !== (db >= 0)) cuts.push(mixVertex(a, b, da / (da - db), plane.id));
      }
      const clipped = clipFace4(f, plane);
      if (clipped.length >= 3) next.push(clipped);
    }
    if (sawInside && sawOutside) {
      const cap = orderCap(cuts, worldEps);
      if (cap.length >= 3) next.push(cap);
    }
    faces = next;
    if (!faces.length) break;
  }
  return faces;
}

/** 深度三平面：w ≥ ε（数值保护，不是新的可见距离）、近、远 */
export const depthPlanes = (wEps: number): Plane4[] => [
  { id: 'positive-w', n: [0, 0, 0, 1], k: -wEps },
  { id: 'near', n: [0, 0, 1, 1], k: 0 },
  { id: 'far', n: [0, 0, -1, 1], k: 0 },
];

/** 侧向四平面（主路径不用：先裁深度、透视除法后求集合凸包、再与视口求交） */
export const lateralPlanes: readonly Plane4[] = [
  { id: 'left', n: [1, 0, 0, 1], k: 0 },
  { id: 'right', n: [-1, 0, 0, 1], k: 0 },
  { id: 'bottom', n: [0, 1, 0, 1], k: 0 },
  { id: 'top', n: [0, -1, 0, 1], k: 0 },
];

/** 世界单元 → 裁剪空间单元（保留世界坐标供截面排序） */
export function toClipSolid(cell: WorldCell, viewProjection: Mat4): ClipSolid {
  return cell.map((f) => f.map((v) => ({ id: v.id, p: v.p, h: mul4(viewProjection, [v.p[0], v.p[1], v.p[2], 1]) })));
}

/** 顶点是否在某深度平面之外（判定「被深度裁剪过」） */
export function isOutsideAnyPlane(v: ClipVertex, planes: readonly Plane4[]): boolean {
  return planes.some((p) => eval4(p, v) < 0);
}

/** 世界点包含测试（相机是否在范围单元内）——全屏投影不等于相机在体内，只有这个测试算 */
export function containsPointInConvexCell(cell: WorldCell, p: V3, eps = 1e-8): boolean {
  const verts = cell.flat();
  if (!verts.length) return false;
  const inv = 1 / verts.length;
  const center = verts.reduce<V3>((s, v) => [s[0] + v.p[0] * inv, s[1] + v.p[1] * inv, s[2] + v.p[2] * inv], [0, 0, 0]);
  let planes = 0;
  for (const f of cell) {
    if (f.length < 3) continue;
    const n = cross3(sub3(f[1]!.p, f[0]!.p), sub3(f[2]!.p, f[0]!.p));
    const len = len3(n);
    if (len <= eps) continue;
    const dc = dot3(n, sub3(center, f[0]!.p));
    if (Math.abs(dc) <= eps * len) continue;
    planes++;
    if (dot3(n, sub3(p, f[0]!.p)) * Math.sign(dc) < -eps * len) return false;
  }
  return planes >= 4;
}
