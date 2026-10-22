/**
 * 两条 BRAN 平行直段的间距——纯几何，没有 Vue、没有请求（plan
 * `gen-model-model-cache/docs/plans/2026-09-16-bran-centerline-nearest-clearance-v1-dev-plan.md` §3.3 ④）。
 *
 * 口径来自用户 2026-09-16 的纠正：「两个排管的距离测量是指两条 BRAN 的直段之间，如果有平行的部分就可以标注它们的间距」。
 * 输入是 `GET /api/v1/spatial/centerline` 原样给的中心线线段表（成员到达→离开点，E3D 世界 mm，按成员序）：
 *
 * 1. `buildStraightRuns`：连续共线且同径的段合成一条直段（隐式管身 + 同轴阀/法兰…）；不同外径分别量距。ELBO / BEND 的到达→离开是弦不是轴，
 *    它们把链断开、自己也不成直段。
 * 2. `findParallelRunPairs`：两条 BRAN 的直段两两配对，夹角 ≤ 容差**且**沿轴投影区间有重叠（真正「并排」的那一截）才算一对；
 *    每对给出**中心距**（两条轴线之间的垂距，落在重叠区中点、两端都在轴线上）、重叠长度，以及两侧外径都知道时扣掉两个半径的净距。
 *
 * 中心距不扣外径，与 Dock「BRAN 中心线最近清距」当前口径一致（服务端 `surface` 缺省 false，从中心线起算）；净距只进表、不画。
 */
import type { SpatialCenterlineSegment } from '@/api/genModelV1Api';

export type Vec3Mm = { x: number; y: number; z: number };

/**
 * 直段外径的来源证据（连排归排用，比裸数值多一档「有值但来源无法证明」）：
 * - `catalogue` / `bore-estimate`：逐段 `diameter_evidence.source` 原样；
 * - `legacy-member`：旧服务端的成员外径（只在 `inferLegacyMemberOd` 时出现）——服务端按 CGETOD 取槽位管子目录外径、
 *   取不到用到达通径估算，但不说是哪一档，只能当估算用；
 * - `unverified`：外径有值但来源无法证明（证据声明为 `missing` 的矛盾数据，或只有 BRAN 顶层兼容值），值可展示、不可当推导依据；
 * - `missing`：这一段根本没有外径（连兼容顶层值都没有）。
 */
export type OutsideDiameterEvidence = 'catalogue' | 'bore-estimate' | 'legacy-member' | 'unverified' | 'missing';

/** `buildStraightRuns` 只用到线段表的这几格；`SpatialCenterlineResponse` 直接就是它的实参。 */
export type BranCenterlineInput = {
  /** BRAN 的 refno（`a_b`） */
  refno: string;
  /** 旧服务缺少逐段外径来源时的兼容参考；明确缺失的段不使用此值。 */
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
  /** 这条直段的外径（mm）：同径段才合并；明确缺失时不取顶层值。 */
  outsideDiameterMm: number | null;
  /** `outsideDiameterMm` 的来源证据（取自首段，即外径实际取值处；同径合并的其余段可能有各自证据，v1 以首段为准）。 */
  odEvidence: OutsideDiameterEvidence;
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

/** `buildStraightRuns` 的诊断项：跳过的成员与断链原因，调用方可选收（不设 `onDiagnostic` 时行为与以前完全一致）。 */
export type StraightRunDiagnostic =
  | Readonly<{ kind: 'segment-skipped'; refno: string; order: number; noun: string; reason: 'non-finite-endpoint' | 'too-short' }>
  | Readonly<{ kind: 'chain-break'; refno: string; order: number; noun: string; reason: 'non-straight-member' | 'joint-gap' | 'not-collinear' | 'diameter-change'; gapMm?: number }>;

export type BuildStraightRunsOptions = {
  /** 段要并进直段，它的两个端点到直段轴线的横向偏差都得 ≤ 它（mm） */
  collinearToleranceMm?: number;
  /** 短于它的段不参与（mm） */
  minSegmentLengthMm?: number;
  /** 这些类型的到达→离开是弦不是轴，断链且不成直段 */
  nonStraightNouns?: ReadonlySet<string>;
  /**
   * 端点连接容差（mm）：设置后，成员到达点与上一直段成员离开点的间距超过它就断链——
   * 中心线缺口（缺成员 / 隐式段未生成）不许被静默跨过合并成假直段。不设 = 不做连接检查（旧行为）。
   */
  maxJointGapMm?: number;
  /** 诊断回调：每个被跳过的成员、每次断链都报一条；不依赖调用方顺序。 */
  onDiagnostic?: (diagnostic: StraightRunDiagnostic) => void;
  /**
   * 旧服务端兼容（连排用）：整条中心线一段 `diameter_evidence` 都没有时，按服务端同一规则补外径并记 `legacy-member`——
   * 成员段用自己的外径；隐式管身 `X~m` 缺外径时复用它到达的成员 `m`（两者由同一槽位目录外径、同一到达通径算出），
   * `m` 零长未成段时退到离开的成员 `X`（异径管两侧外径不同，不退）。不设 = 旧行为（顶层值兜底、记 `unverified`）。
   */
  inferLegacyMemberOd?: boolean;
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
  diameters: DiameterResolver,
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
  return {
    branRefno,
    start: add(clonePoint(first.start), scale(direction, minT)),
    end: add(clonePoint(first.start), scale(direction, maxT)),
    direction,
    lengthMm,
    segments,
    outsideDiameterMm: diameters.diameter(first),
    odEvidence: diameters.evidence(first),
  };
}

function segmentDiameter(segment: SpatialCenterlineSegment, fallback: number | null): number | null {
  return positiveDiameter(segment.outside_diameter_mm) ?? (segment.diameter_evidence ? null : fallback);
}

/** 与 `segmentDiameter` 同一判定的证据侧：外径实际取值是哪一档来源（含兼容顶层回退 → `unverified`）。 */
function segmentOdEvidence(segment: SpatialCenterlineSegment, fallback: number | null): OutsideDiameterEvidence {
  if (positiveDiameter(segment.outside_diameter_mm) != null) {
    const source = segment.diameter_evidence?.source;
    return source === 'catalogue' || source === 'bore-estimate' ? source : 'unverified';
  }
  if (segment.diameter_evidence) return 'missing';
  return fallback != null ? 'unverified' : 'missing';
}

type DiameterResolver = Readonly<{
  diameter: (segment: SpatialCenterlineSegment) => number | null;
  evidence: (segment: SpatialCenterlineSegment) => OutsideDiameterEvidence;
}>;

/** 两侧外径不同的成员：隐式管身不能从它的离开侧借外径。 */
const REDUCER_NOUNS: ReadonlySet<string> = new Set(['REDU']);

/** 旧服务端成员外径表（规则见 `BuildStraightRunsOptions.inferLegacyMemberOd`）：段 refno → 外径。 */
function legacyMemberDiameters(segments: readonly SpatialCenterlineSegment[]): Map<string, number> {
  const diameters = new Map<string, number>();
  const members = new Map<string, { od: number; noun: string }>();
  for (const segment of segments) {
    const od = positiveDiameter(segment.outside_diameter_mm);
    if (od === null) continue;
    diameters.set(segment.refno, od);
    if (!segment.implicit) members.set(segment.refno, { od, noun: String(segment.noun || '').trim().toUpperCase() });
  }
  for (const segment of segments) {
    const cut = segment.refno.indexOf('~');
    if (!segment.implicit || cut < 0 || diameters.has(segment.refno)) continue;
    const arrive = members.get(segment.refno.slice(cut + 1));
    const leave = members.get(segment.refno.slice(0, cut));
    const od = arrive?.od ?? (leave && !REDUCER_NOUNS.has(leave.noun) ? leave.od : undefined);
    if (od !== undefined) diameters.set(segment.refno, od);
  }
  return diameters;
}

function diameterResolver(centerline: BranCenterlineInput, inferLegacyMemberOd: boolean): DiameterResolver {
  const fallback = positiveDiameter(centerline.outside_diameter_mm);
  const legacy = inferLegacyMemberOd && centerline.segments.every(segment => segment.diameter_evidence == null)
    ? legacyMemberDiameters(centerline.segments)
    : null;
  return {
    diameter: segment => legacy?.get(segment.refno) ?? segmentDiameter(segment, fallback),
    evidence: segment => (legacy?.has(segment.refno) ? 'legacy-member' : segmentOdEvidence(segment, fallback)),
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
  const maxJointGap = options.maxJointGapMm;
  const report = options.onDiagnostic;
  const diameters = diameterResolver(centerline, options.inferLegacyMemberOd === true);
  const branRefno = String(centerline.refno || '').trim();

  const runs: BranStraightRun[] = [];
  let current: SpatialCenterlineSegment[] = [];
  const flush = () => {
    const run = finishRun(branRefno, current, diameters);
    if (run) runs.push(run);
    current = [];
  };
  const noun = (segment: SpatialCenterlineSegment) => String(segment.noun || '').trim().toUpperCase();

  const ordered = [...centerline.segments].sort((a, b) => a.order - b.order);
  for (const segment of ordered) {
    if (!isFinitePoint(segment.start) || !isFinitePoint(segment.end)) {
      report?.({ kind: 'segment-skipped', refno: segment.refno, order: segment.order, noun: noun(segment), reason: 'non-finite-endpoint' });
      continue;
    }
    if (length(sub(segment.end, segment.start)) < minLength) {
      report?.({ kind: 'segment-skipped', refno: segment.refno, order: segment.order, noun: noun(segment), reason: 'too-short' });
      continue;
    }
    if (nonStraight.has(noun(segment))) {
      report?.({ kind: 'chain-break', refno: segment.refno, order: segment.order, noun: noun(segment), reason: 'non-straight-member' });
      flush();
      continue;
    }
    if (current.length > 0) {
      // 连接检查先于共线判断：缺口两侧的段哪怕共线也不许跨档合并。
      const tail = current[current.length - 1]!;
      if (maxJointGap != null) {
        const jointGap = length(sub(segment.start, tail.end));
        if (jointGap > maxJointGap) {
          report?.({ kind: 'chain-break', refno: segment.refno, order: segment.order, noun: noun(segment), reason: 'joint-gap', gapMm: jointGap });
          flush();
        }
      }
      if (current.length > 0) {
        // 以当前直段首段的轴线为准（首段一定非零长），后来的段两端都得贴在这条线上。
        const head = current[0]!;
        const axis = sub(head.end, head.start);
        const direction = scale(axis, 1 / length(axis));
        const collinear = distanceToLine(segment.start, head.start, direction) <= collinearTol
          && distanceToLine(segment.end, head.start, direction) <= collinearTol;
        const headDiameter = diameters.diameter(head);
        const nextDiameter = diameters.diameter(segment);
        const sameDiameter = headDiameter === null || nextDiameter === null ? headDiameter === nextDiameter
          : Math.abs(headDiameter - nextDiameter) <= 0.001;
        if (!collinear || !sameDiameter) {
          report?.({
            kind: 'chain-break',
            refno: segment.refno,
            order: segment.order,
            noun: noun(segment),
            reason: !collinear ? 'not-collinear' : 'diameter-change',
          });
          flush();
        }
      }
    }
    current.push(segment);
  }
  flush();
  return runs;
}

/**
 * 直段身份（`spatialTree.tubeKey` 的 from / to）对应的中心线隐式管段 refno `<from>~<to>`：服务端在容器头 / 尾那一端给的是
 * BRAN 自己，中心线那一端写 `Head` / `Tail`（gen-model `branch_query` 合成管身的命名）。
 */
export function centerlineTubeSegmentRefno(branRefno: string, tube: Readonly<{ from: string; to: string }>): string {
  return `${tube.from === branRefno ? 'Head' : tube.from}~${tube.to === branRefno ? 'Tail' : tube.to}`;
}

/**
 * 直段收窄到选中的段（连排按直段测量）：成员序连续的选中段并成一条子直段，两端取它们端点沿直段轴向投影的最小 / 最大；
 * 方向、外径与来源证据沿用原直段（同一直段内外径相同）。一段都没选中的直段不出子直段。
 */
export function splitRunBySegments(
  run: BranStraightRun,
  keep: (segment: SpatialCenterlineSegment) => boolean,
): BranStraightRun[] {
  const out: BranStraightRun[] = [];
  let group: SpatialCenterlineSegment[] = [];
  const flush = () => {
    let minT = Number.POSITIVE_INFINITY;
    let maxT = Number.NEGATIVE_INFINITY;
    for (const segment of group) {
      for (const point of [segment.start, segment.end]) {
        const t = dot(sub(point, run.start), run.direction);
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
      }
    }
    if (group.length > 0 && maxT - minT > 0) {
      out.push({
        ...run,
        start: add(clonePoint(run.start), scale(run.direction, minT)),
        end: add(clonePoint(run.start), scale(run.direction, maxT)),
        lengthMm: maxT - minT,
        segments: group,
      });
    }
    group = [];
  };
  for (const segment of run.segments) {
    if (keep(segment)) group.push(segment);
    else flush();
  }
  flush();
  return out;
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
