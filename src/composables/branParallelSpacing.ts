/**
 * 两条 BRAN 平行直段的间距——纯几何，没有 Vue、没有请求（plan
 * `gen-model-model-cache/docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md` §3.3 ④）。
 *
 * 口径来自用户 2026-09-16 的纠正：「两个排管的距离测量是指两条 BRAN 的直段之间，如果有平行的部分就可以标注它们的间距」。
 * 输入是 `GET /api/v1/spatial/centerline` 原样给的中心线线段表（成员到达→离开点，E3D 世界 mm，按成员序）：
 *
 * 1. `buildStraightRuns`：连续**共线**的段合成一条**直段**（隐式管身 + 同轴的阀 / 法兰 / 大小头…）。ELBO / BEND 的到达→离开是弦不是轴，
 *    它们把链断开、自己也不成直段。
 * 2. `findParallelRunPairs`：两条 BRAN 的直段两两配对，夹角 ≤ 容差**且**沿轴投影区间有重叠（真正「并排」的那一截）才算一对；
 *    每对给出**中心距**（两条轴线之间的垂距，落在重叠区中点、两端都在轴线上）、重叠长度，以及两侧外径都知道时扣掉两个半径的净距。
 *
 * 中心距不扣外径，与 Dock「BRAN 中心线最近清距」当前口径一致（服务端 `surface` 缺省 false，从中心线起算）；净距只进表、不画。
 */
import type { SpatialCenterlineSegment } from '@/api/genModelV1Api';

export type Vec3Mm = { x: number; y: number; z: number };

/** `buildStraightRuns` 只用到线段表的这几格；`SpatialCenterlineResponse` 直接就是它的实参。 */
export type BranCenterlineInput = {
  /** BRAN 的 refno（`a_b`） */
  refno: string;
  /** 首个给出外径的成员的外径（mm）；隐式管身按它算半径 */
  outside_diameter_mm: number | null;
  segments: readonly SpatialCenterlineSegment[];
};

/** 一条直段：连续共线的中心线段合并后的一段，`direction` 是 `start → end` 的单位向量。 */
export type BranStraightRun = {
  branRefno: string;
  start: Vec3Mm;
  end: Vec3Mm;
  direction: Vec3Mm;
  lengthMm: number;
  /** 组成它的段（按成员序） */
  segments: SpatialCenterlineSegment[];
  /** 这条直段的外径（mm）：段上首个成员外径，都没有就用 BRAN 顶层外径；都取不到为 null */
  outsideDiameterMm: number | null;
};

/** 两条 BRAN 之间的一对平行直段。 */
export type BranParallelRunPair = {
  source: BranStraightRun;
  target: BranStraightRun;
  /** 两条轴线的夹角（0 ~ 90°；反向平行也算平行，按锐角报） */
  angleDeg: number;
  /** 沿源直段轴线的重叠区间（相对源直段 `start` 的参数，mm） */
  overlapStartMm: number;
  overlapEndMm: number;
  overlapMm: number;
  /** 中心距：源轴线重叠区中点到目标轴线的垂距（mm） */
  axisDistanceMm: number;
  /** 尺寸两端：源轴线重叠区中点、它在目标轴线上的垂足（E3D 世界 mm） */
  sourcePointMm: Vec3Mm;
  targetPointMm: Vec3Mm;
  /** 中心距扣掉两侧半径后的净距（mm，可为负 = 表面相交）；任一侧外径未知为 null */
  clearanceMm: number | null;
};

export type BuildStraightRunsOptions = {
  /** 段要并进直段，它的两个端点到直段轴线的横向偏差都得 ≤ 它（mm） */
  collinearToleranceMm?: number;
  /** 短于它的段不参与（mm） */
  minSegmentLengthMm?: number;
  /** 这些类型的到达→离开是弦不是轴，断链且不成直段 */
  nonStraightNouns?: ReadonlySet<string>;
};

export type FindParallelRunPairsOptions = {
  /** 平行判定的夹角容差（度） */
  angleToleranceDeg?: number;
  /** 沿轴投影重叠至少这么长才算「并排」（mm） */
  minOverlapMm?: number;
};

export const DEFAULT_COLLINEAR_TOLERANCE_MM = 1;
export const DEFAULT_MIN_SEGMENT_LENGTH_MM = 1e-3;
export const DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG = 0.5;
export const DEFAULT_MIN_OVERLAP_MM = 1;
/** 到达→离开是弦不是轴的成员类型。 */
export const NON_STRAIGHT_NOUNS: ReadonlySet<string> = new Set(['ELBO', 'BEND']);

function sub(a: Vec3Mm, b: Vec3Mm): Vec3Mm {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3Mm, b: Vec3Mm): Vec3Mm {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3Mm, s: number): Vec3Mm {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3Mm, b: Vec3Mm): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: Vec3Mm): number {
  return Math.hypot(a.x, a.y, a.z);
}

function isFinitePoint(p: unknown): p is Vec3Mm {
  const candidate = p as Partial<Vec3Mm> | null | undefined;
  return !!candidate
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.z);
}

function clonePoint(p: Vec3Mm): Vec3Mm {
  return { x: p.x, y: p.y, z: p.z };
}

/** 点到「过 `origin`、方向 `direction`（单位）」直线的垂距。 */
function distanceToLine(point: Vec3Mm, origin: Vec3Mm, direction: Vec3Mm): number {
  const offset = sub(point, origin);
  const along = dot(offset, direction);
  return length(sub(offset, scale(direction, along)));
}

function positiveDiameter(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finishRun(
  branRefno: string,
  segments: SpatialCenterlineSegment[],
  fallbackDiameter: number | null,
): BranStraightRun | null {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return null;
  // 轴向取首段起点→末段终点；退化（只有一段且首尾重合不可能——零长段在外面已剔）时退回首段自身方向。
  let axis = sub(last.end, first.start);
  if (!(length(axis) > 0)) axis = sub(first.end, first.start);
  const axisLength = length(axis);
  if (!(axisLength > 0)) return null;
  const direction = scale(axis, 1 / axisLength);
  // 直段的两端取全部端点沿轴投影的最小 / 最大——某一段到达 / 离开点写反了也不会把直段量短。
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    for (const point of [segment.start, segment.end]) {
      const t = dot(sub(point, first.start), direction);
      minT = Math.min(minT, t);
      maxT = Math.max(maxT, t);
    }
  }
  const lengthMm = maxT - minT;
  if (!(lengthMm > 0)) return null;
  const memberDiameter = segments
    .map((segment) => positiveDiameter(segment.outside_diameter_mm))
    .find((value): value is number => value != null) ?? null;
  return {
    branRefno,
    start: add(clonePoint(first.start), scale(direction, minT)),
    end: add(clonePoint(first.start), scale(direction, maxT)),
    direction,
    lengthMm,
    segments,
    outsideDiameterMm: memberDiameter ?? fallbackDiameter,
  };
}

/**
 * 中心线线段表 → 直段表。按成员序扫：一段要并进当前直段，得**两个端点都在直段轴线上**（横向偏差 ≤ `collinearToleranceMm`）；
 * 不共线就另起一条。ELBO / BEND 断链、不成直段；端点不是有限数或短于 `minSegmentLengthMm` 的段跳过（不断链——穿过件在服务端
 * 已经不成段，这里只是兜底）。返回的直段按成员序。
 */
export function buildStraightRuns(
  centerline: BranCenterlineInput,
  options: BuildStraightRunsOptions = {},
): BranStraightRun[] {
  const collinearTol = options.collinearToleranceMm ?? DEFAULT_COLLINEAR_TOLERANCE_MM;
  const minLength = options.minSegmentLengthMm ?? DEFAULT_MIN_SEGMENT_LENGTH_MM;
  const nonStraight = options.nonStraightNouns ?? NON_STRAIGHT_NOUNS;
  const fallbackDiameter = positiveDiameter(centerline.outside_diameter_mm);
  const branRefno = String(centerline.refno || '').trim();

  const runs: BranStraightRun[] = [];
  let current: SpatialCenterlineSegment[] = [];
  const flush = () => {
    const run = finishRun(branRefno, current, fallbackDiameter);
    if (run) runs.push(run);
    current = [];
  };

  const ordered = [...centerline.segments].sort((a, b) => a.order - b.order);
  for (const segment of ordered) {
    if (!isFinitePoint(segment.start) || !isFinitePoint(segment.end)) continue;
    if (length(sub(segment.end, segment.start)) < minLength) continue;
    if (nonStraight.has(String(segment.noun || '').trim().toUpperCase())) {
      flush();
      continue;
    }
    if (current.length > 0) {
      // 以当前直段首段的轴线为准（首段一定非零长），后来的段两端都得贴在这条线上。
      const head = current[0]!;
      const axis = sub(head.end, head.start);
      const direction = scale(axis, 1 / length(axis));
      const collinear = distanceToLine(segment.start, head.start, direction) <= collinearTol
        && distanceToLine(segment.end, head.start, direction) <= collinearTol;
      if (!collinear) flush();
    }
    current.push(segment);
  }
  flush();
  return runs;
}

/**
 * 两条 BRAN 的直段两两配平行对。平行 = 夹角 ≤ `angleToleranceDeg`（反向也算）；并排 = 目标直段沿源直段轴线的投影区间
 * 与源直段自身区间 `[0, length]` 的重叠 ≥ `minOverlapMm`。中心距在重叠区中点量：源轴线上的点与它在目标轴线上的垂足。
 * 结果按源直段序、再目标直段序。
 */
export function findParallelRunPairs(
  sourceRuns: readonly BranStraightRun[],
  targetRuns: readonly BranStraightRun[],
  options: FindParallelRunPairsOptions = {},
): BranParallelRunPair[] {
  const angleTol = options.angleToleranceDeg ?? DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG;
  const minOverlap = options.minOverlapMm ?? DEFAULT_MIN_OVERLAP_MM;
  const cosTol = Math.cos((angleTol * Math.PI) / 180);

  const pairs: BranParallelRunPair[] = [];
  for (const source of sourceRuns) {
    for (const target of targetRuns) {
      const cosine = Math.min(1, Math.abs(dot(source.direction, target.direction)));
      if (cosine < cosTol) continue;

      const t0 = dot(sub(target.start, source.start), source.direction);
      const t1 = dot(sub(target.end, source.start), source.direction);
      const overlapStart = Math.max(0, Math.min(t0, t1));
      const overlapEnd = Math.min(source.lengthMm, Math.max(t0, t1));
      const overlap = overlapEnd - overlapStart;
      if (!(overlap >= minOverlap)) continue;

      const mid = (overlapStart + overlapEnd) / 2;
      const sourcePoint = add(source.start, scale(source.direction, mid));
      const foot = dot(sub(sourcePoint, target.start), target.direction);
      const targetPoint = add(target.start, scale(target.direction, foot));
      const axisDistance = length(sub(targetPoint, sourcePoint));
      const clearance = source.outsideDiameterMm != null && target.outsideDiameterMm != null
        ? axisDistance - (source.outsideDiameterMm + target.outsideDiameterMm) / 2
        : null;

      pairs.push({
        source,
        target,
        angleDeg: (Math.acos(cosine) * 180) / Math.PI,
        overlapStartMm: overlapStart,
        overlapEndMm: overlapEnd,
        overlapMm: overlap,
        axisDistanceMm: axisDistance,
        sourcePointMm: sourcePoint,
        targetPointMm: targetPoint,
        clearanceMm: clearance,
      });
    }
  }
  return pairs;
}

/** 一条直段在表里 / 状态栏里的名字：首段成员 refno（隐式管身就是 `a_b~c_d`），多段时带段数。 */
export function describeStraightRun(run: BranStraightRun): string {
  const first = run.segments[0];
  const head = first ? first.refno : run.branRefno;
  return run.segments.length > 1 ? `${head}（${run.segments.length} 段）` : head;
}
