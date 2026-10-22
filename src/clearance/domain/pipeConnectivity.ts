/**
 * 两根 BRAN 是否相连：首尾相接，或一根的端点接在另一根的三通上、直接焊在另一根的管身上。
 * 相连的管外表面本来就贴着，外表面净距必是 0 或相交——不是碰撞，不计净距。
 *
 * 只看真实中心线（`/api/v1/spatial/centerline`）的几何：样例库复制出来的管道 HREF / TREF 有丢失
 * （24381/144991 与 145018 首尾相接，两头的 TREF / HREF 却都是 0/0），不拿它作依据。
 */

export type PipeConnectivityPoint = Readonly<{ x: number; y: number; z: number }>;

export type PipeConnectivitySegment = Readonly<{
  noun: string;
  start: PipeConnectivityPoint;
  end: PipeConnectivityPoint;
  outsideDiameterMm: number | null;
}>;

export type PipeConnectivityLine = Readonly<{
  refno: string;
  head: PipeConnectivityPoint;
  tail: PipeConnectivityPoint;
  segments: readonly PipeConnectivitySegment[];
}>;

/**
 * - `ends`：两根的首 / 尾点重合，确定相连，不必再算净距。
 * - `branch`：一根的首 / 尾点落在另一根三通够得着的范围里，或落在另一根的管身里——只是疑似：
 *   外表面净距不超过 {@link PIPE_CONNECTED_CLEARANCE_MM} 才按相连算，否则照常出净距。
 */
export type PipeConnectionKind = 'ends' | 'branch';

/** 首尾点相距不超过它算首尾相接（mm）。 */
export const PIPE_END_JOIN_TOLERANCE_MM = 1;
/** 疑似相连的管对，外表面净距不超过它才按相连算（mm）。 */
export const PIPE_CONNECTED_CLEARANCE_MM = 1;

const BRANCH_FITTING_NOUNS: ReadonlySet<string> = new Set(['TEE', 'OLET', 'CROS']);
/**
 * 支管端点到三通中心线段的距离上限取 max(段长, 2 × 外径) + 25 mm：24381/144870 区实测真实支管最远到段长、
 * 约 1.7 倍外径，不相干的管在 7 倍外径以外。管身（直接焊上去的支管）只放外径的一半 + 25 mm。
 */
const BRANCH_MARGIN_MM = 25;

type CenterlineLike = Readonly<{
  segments?: readonly (Readonly<{
    noun?: string;
    start?: Readonly<Partial<PipeConnectivityPoint>>;
    end?: Readonly<Partial<PipeConnectivityPoint>>;
    outside_diameter_mm?: number | null;
  }> | null | undefined)[];
}>;

function isPoint(point: Readonly<Partial<PipeConnectivityPoint>> | undefined): point is PipeConnectivityPoint {
  return !!point && [point.x, point.y, point.z].every(Number.isFinite);
}

function distance(a: PipeConnectivityPoint, b: PipeConnectivityPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pointToSegment(point: PipeConnectivityPoint, start: PipeConnectivityPoint, end: PipeConnectivityPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const t = lengthSq > 0
    ? Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy + (point.z - start.z) * dz) / lengthSq))
    : 0;
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t, z: start.z + dz * t });
}

/** 中心线响应 → 判相连用的首尾点与成员段；没有段或有坐标不全的段给 null（不判相连，照常出净距）。 */
export function pipeConnectivityLine(refno: string, centerline: CenterlineLike | null | undefined): PipeConnectivityLine | null {
  const segments: PipeConnectivitySegment[] = [];
  for (const segment of centerline?.segments ?? []) {
    if (!segment || !isPoint(segment.start) || !isPoint(segment.end)) return null;
    const od = segment.outside_diameter_mm;
    segments.push({
      noun: String(segment.noun ?? '').toUpperCase(),
      start: { x: segment.start.x, y: segment.start.y, z: segment.start.z },
      end: { x: segment.end.x, y: segment.end.y, z: segment.end.z },
      outsideDiameterMm: typeof od === 'number' && Number.isFinite(od) && od > 0 ? od : null,
    });
  }
  if (segments.length === 0) return null;
  return { refno, head: segments[0]!.start, tail: segments[segments.length - 1]!.end, segments };
}

function endReaches(from: PipeConnectivityLine, onto: PipeConnectivityLine): boolean {
  return [from.head, from.tail].some(point => onto.segments.some((segment) => {
    const od = segment.outsideDiameterMm ?? 0;
    const reach = BRANCH_FITTING_NOUNS.has(segment.noun)
      ? Math.max(distance(segment.start, segment.end), 2 * od) + BRANCH_MARGIN_MM
      : od / 2 + BRANCH_MARGIN_MM;
    return pointToSegment(point, segment.start, segment.end) <= reach;
  }));
}

/** 两根 BRAN 的相连关系；不相连给 null。 */
export function pipeConnection(a: PipeConnectivityLine, b: PipeConnectivityLine): PipeConnectionKind | null {
  for (const p of [a.head, a.tail]) {
    for (const q of [b.head, b.tail]) {
      if (distance(p, q) <= PIPE_END_JOIN_TOLERANCE_MM) return 'ends';
    }
  }
  return endReaches(a, b) || endReaches(b, a) ? 'branch' : null;
}
