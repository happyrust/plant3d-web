/**
 * 屏幕凸包与视口求交——2026-09-14 方案 §4.3 的纯函数部分。
 *
 * - 坐标是 CSS 像素，x 右、y 下；本文件里「正有向面积」的多边形在屏幕上看起来是顺时针。
 * - Andrew monotone chain 直接用于裁剪后的有限屏幕坐标；输入含非有限值**抛错**，不能丢失支撑点后宣称包住。
 * - 排序用 `x, y, id` 三键保证确定性；重复坐标只留一个。
 */

export type P2 = { x: number; y: number; id: string };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const cross2 = (a: P2, b: P2, c: P2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function signedArea(p: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.y - a.y * b.x;
  }
  return s / 2;
}

/** 凸包；少于 3 个不同点时原样返回（点 / 线段退化由调用方处理） */
export function convexHull2d(points: readonly P2[]): P2[] {
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('invalid hull input');
  const sorted = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id))
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1]!.x || p.y !== arr[i - 1]!.y);
  if (sorted.length < 3) return sorted;
  const half = (items: P2[]): P2[] => {
    const h: P2[] = [];
    for (const q of items) {
      while (h.length >= 2 && cross2(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    return h;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}

function clipPolygon2d(p: readonly P2[], distance: (q: P2) => number, id: string): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    const da = distance(a);
    const db = distance(b);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, id: `${id}(${[a.id, b.id].sort().join('|')})` });
    }
    if (db >= 0) out.push(b);
  }
  return out;
}

/** 凸包与视口矩形求交（正面积多边形；点 / 线段退化也保留） */
export function intersectHullWithRect(hull: readonly P2[], r: Rect): P2[] {
  let p = [...hull];
  const planes: readonly (readonly [string, (q: P2) => number])[] = [
    ['left', (q) => q.x - r.left],
    ['right', (q) => r.right - q.x],
    ['top', (q) => q.y - r.top],
    ['bottom', (q) => r.bottom - q.y],
  ];
  for (const [id, f] of planes) p = clipPolygon2d(p, f, id);
  return convexHull2d(p);
}

export type Bounds2 = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(points: readonly { x: number; y: number }[]): Bounds2 | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
