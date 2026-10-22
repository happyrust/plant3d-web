/**
 * 连排相邻测量的纯几何核心（E3D 世界 mm；无 Vue / 相机 / 网络）。
 * plan `docs/plans/2026-10-19-pipe-row-adjacent-measurement-plan.md` §5：
 *
 * 管向分组 → 沿代表管向的「参与集合稳定」区段扫描 → 截面归排（管中心 / 管底对齐）→ 排内相邻配对
 * → 跨相邻区段按相邻关系连续合并（§5.6：同一对在连续区段里一直相邻就是同一条测量，不因别的管进出排而重复）。
 *
 * 确定性要求（§5.3 / R03）：同一批输入换排列顺序必须得到相同分组与身份键——
 * 所以分组前一律按（直段长度 desc, 锚点 refno asc）排序，方向分组用固定代表方向而非链式合并。
 *
 * 外径证据的用法（§4.2）：`catalogue` → 推导间隔正常；`bore-estimate` / `legacy-member` → 算但标估算
 * （管底模式下底点也随之是估算，排须人工确认）；`unverified` / `missing` → 间隔 null，不拿不可证的外径冒充推导依据。
 */
import type { PipeRowAlignMode } from '@/clearance/domain/pipeRowTypes';

import { isEstimatedOdEvidence } from '@/clearance/domain/pipeRowTypes';
import {
  DEFAULT_MIN_OVERLAP_MM,
  DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG,
  type BranStraightRun,
  type OutsideDiameterEvidence,
  type Vec3Mm,
} from '@/composables/branParallelSpacing';

/** 成排位置偏差（mm）：截面内点到候选排线的垂距 ≤ 它才算排内成员。 */
export const DEFAULT_ROW_TOLERANCE_MM = 1;
/** 支承法向在截面内投影短于它（单位向量模）视为退化——主管向近铅直时必须人工指定法向。 */
export const SUPPORT_NORMAL_MIN_PROJECTION = 1e-3;
/** 截面二维里两点重合的判定（mm）。 */
const COINCIDENT_EPS_MM = 1e-6;
/** 轴向事件坐标去重 / 覆盖判断的容差（mm；世界坐标 ~1e6 量级下的浮点噪声 << 1e-6）。 */
const AXIAL_EPS_MM = 1e-6;
/** 排序稳定性检查用的两端余量：端点本身恰在成员边界上，往里收一个覆盖容差再取样。 */
const ORDER_EPS_MM = 1e-6;
/** 剥离主排后剩下两根时，要与至少这么多根成员的排平行，才认作并列的另一排（两点必共线，不能凭此成排）。 */
const LEFTOVER_ROW_REFERENCE_MIN_MEMBERS = 3;
const WORLD_UP: Vec3Mm = { x: 0, y: 0, z: 1 };
const ZERO: Vec3Mm = { x: 0, y: 0, z: 0 };

export type PipeRowRunInput = Readonly<{
  /** 所属 BRAN（`a_b`） */
  branRefno: string;
  run: BranStraightRun;
}>;

export type PipeRowDetectOptions = {
  alignMode: PipeRowAlignMode;
  /** 管向分组角度容差（°），缺省沿用平行直段判定 0.5° */
  angleToleranceDeg?: number;
  /** 成排位置偏差（mm），缺省 1 */
  rowToleranceMm?: number;
  /** 最小共同区段长度（mm），缺省沿用重叠下限 1 */
  minCommonLengthMm?: number;
  /** 管底对齐的支承法向（世界系，任意非零向量）；缺省取世界向上在截面内的投影 */
  supportNormal?: Vec3Mm;
  /**
   * 支承法向在某管向组截面内投影退化（主管向近铅直）时改用的法向，须人工指定（§3.3 / R11）；
   * 只作用于退化的组，其余组照旧用 `supportNormal`。
   */
  fallbackSupportNormal?: Vec3Mm;
  /**
   * 排内相邻中心距上限（mm）：超过就在此断开成两排（两组管廊之间的空档不量）。缺省不限——
   * 这是用户显式给的归排规则，不是结果筛选（§5.6：筛选不改邻接）。
   */
  maxAdjacentCenterDistanceMm?: number | null;
};

/** 直段身份：首段成员 refno（隐式管身 `a_b~c_d`，与 branSpacingRecords 同一约定）。 */
export function runAnchorRefno(run: BranStraightRun): string {
  return String(run.segments[0]?.refno ?? '').trim();
}

// --- 局部向量小工具（mm） ----------------------------------------------------

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
function cross(a: Vec3Mm, b: Vec3Mm): Vec3Mm {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(a: Vec3Mm): Vec3Mm | null {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : null;
}

/** 无向方向归一：把 v / -v 映到同一朝向（第一个非零分量取正），供分组与排序键使用。 */
function canonicalDir(d: Vec3Mm): Vec3Mm {
  const unit = normalize(d) ?? { x: 0, y: 0, z: 0 };
  if (unit.x > COINCIDENT_EPS_MM || (Math.abs(unit.x) <= COINCIDENT_EPS_MM && unit.y > COINCIDENT_EPS_MM)
    || (Math.abs(unit.x) <= COINCIDENT_EPS_MM && Math.abs(unit.y) <= COINCIDENT_EPS_MM && unit.z > 0)) {
    return unit;
  }
  if (unit.x < -COINCIDENT_EPS_MM || (Math.abs(unit.x) <= COINCIDENT_EPS_MM && unit.y < -COINCIDENT_EPS_MM)
    || (Math.abs(unit.x) <= COINCIDENT_EPS_MM && Math.abs(unit.y) <= COINCIDENT_EPS_MM && unit.z < 0)) {
    return scale(unit, -1);
  }
  return unit;
}

// --- 输出类型 ---------------------------------------------------------------

/** 一个共同区段 / 测量截面（mm 口径；进记录时由适配器换米）。 */
export type PipeRowSectionGeom = Readonly<{
  /** 组代表管向（单位、canonical 无向） */
  axisDirection: Vec3Mm;
  /**
   * 截面上靠近被测管的一点：相邻对取两中心中点，排取成员轴线交点的质心——
   * 不用代表方向上的参数点（那一点在过世界原点的轴线上，离管子可能几十米）。
   */
  origin: Vec3Mm;
  /** 截面在代表管向上的参数（共同区段中点） */
  sectionT: number;
  /** 共同区段参数区间 [tStart, tEnd]（沿 axisDirection 的 dot 坐标，mm） */
  axialStartMm: number;
  axialEndMm: number;
}>;

/** 一根直段在某截面上的落点与证据。 */
export type PipeRowMember = Readonly<{
  branRefno: string;
  run: BranStraightRun;
  /** 直段身份 = 首段 refno */
  anchorRefno: string;
  /** 真实轴线与测量截面的交点 C_i */
  centerMm: Vec3Mm;
  /** 归排定位点：中心模式 = C_i；管底模式 = C_i − r_i·n */
  rowPointMm: Vec3Mm;
  /** 沿排向的坐标（截面二维系内，mm） */
  rowCoordMm: number;
  odMm: number | null;
  odEvidence: OutsideDiameterEvidence;
}>;

export type PipeRowPair = Readonly<{
  /** 排内次序在前的成员（排序依据是排向坐标，不是编号） */
  source: PipeRowMember;
  target: PipeRowMember;
  /** 无序对键：两个锚点 refno 排序拼接 */
  pairKey: string;
  /** 截面中心距 D_cc = |C_j − C_i|（mm） */
  centerDistanceMm: number;
  /** 有符号名义间隔 G = D_cc − (OD_i+OD_j)/2（mm）；任一侧外径不可证为 null */
  signedGapMm: number | null;
  /** 是否至少一侧外径为估算来源 */
  gapEstimated: boolean;
  /** 该对所在的排 */
  rowKey: string;
  /** 该对自己的连续相邻区段（排内各对可以起止不同）与其中点截面 */
  section: PipeRowSectionGeom;
}>;

export type PipeRowGroup = Readonly<{
  /** `row:<排序锚点串>@<区段>:<模式>`——同一确认的同一排恒定，供分组开关引用 */
  key: string;
  alignMode: PipeRowAlignMode;
  /** 排向（三维单位向量） */
  direction: Vec3Mm;
  /** 排内成员沿排向排序（错开起止的管也在同一排里，各自只覆盖排的一部分区段） */
  members: readonly PipeRowMember[];
  /** 只含相邻对（i ↔ i+1），每对带自己的区段 */
  pairs: readonly PipeRowPair[];
  /** 整排覆盖的区段 */
  section: PipeRowSectionGeom;
  /** 存在同等合理的其他分组 / 排序沿区段不稳定 / 退化（共轴、仅凭两点成排）→ 需要人工确认 */
  ambiguous: boolean;
  /** 同截面存在未能归排的成员（管底模式缺外径），分组完整性不可证 */
  incomplete: boolean;
  /** 管底模式下有成员外径是估算（孔径估算 / 旧服务端成员外径）——底点随之是估算，分组须人工确认（§4.2） */
  estimatedGrouping: boolean;
  diagnostics: readonly string[];
}>;

/** 能出正式记录的排（§4.2 / §5.5 / §5.7）：多解、分组不完整或按估算外径归的排只进预览，等人工确认。 */
export function isFormalPipeRowGroup(group: PipeRowGroup): boolean {
  return !group.ambiguous && !group.incomplete && !group.estimatedGrouping;
}

/** 单个共同区段（未跨区段合并）的扫描结果，供预览如实展示。 */
export type PipeRowSectionScan = Readonly<{
  section: PipeRowSectionGeom;
  /** 本截面识别出的排（成员锚点，已沿排向排序） */
  rows: readonly Readonly<{ memberAnchors: readonly string[]; ambiguous: boolean }>[];
  /** 进入截面但不在任何排里的成员（孤管 / 管底缺外径 / 被相邻上限断开的单根） */
  unplacedAnchors: readonly string[];
  diagnostics: readonly string[];
}>;

export type PipeRowDetection = Readonly<{
  alignMode: PipeRowAlignMode;
  /** 按管向组 × 共同区段的逐截面扫描明细 */
  sections: readonly PipeRowSectionScan[];
  /** 合并后的排（携带最终相邻对） */
  groups: readonly PipeRowGroup[];
  /** 支承法向退化（管底模式且主管向近铅直）——须人工指定法向，不得按视图猜 */
  supportNormalDegenerate: boolean;
  diagnostics: readonly string[];
}>;

// --- 实现 -------------------------------------------------------------------

type GroupEntry = Readonly<{ input: PipeRowRunInput; dir: Vec3Mm; t0: number; t1: number }>;

/** 按代表管向把直段投影成轴向参数区间。 */
function axialRange(entry: { input: PipeRowRunInput; dir: Vec3Mm }, repDir: Vec3Mm): { t0: number; t1: number } {
  const a = dot(entry.input.run.start, repDir);
  const b = dot(entry.input.run.end, repDir);
  return { t0: Math.min(a, b), t1: Math.max(a, b) };
}

/**
 * 管向分组（§5.3）：先把输入按（长度 desc, 锚点 asc）钉死顺序，再逐条并入「与代表方向夹角 ≤ 容差」的组。
 * 代表方向取组内最长直段的 canonical 方向、建组后不再漂移——不做链式连通合并，
 * A≈B、B≈C 但 A≁C 时 A/C 不会同组（各组判定都回到固定代表方向）。
 */
function groupByDirection(
  inputs: readonly PipeRowRunInput[],
  angleToleranceDeg: number,
): GroupEntry[][] {
  const cosTol = Math.cos((angleToleranceDeg * Math.PI) / 180);
  const entries = inputs
    .map(input => ({ input, dir: canonicalDir(input.run.direction), t0: 0, t1: 0 }))
    .sort((a, b) => {
      const byLength = b.input.run.lengthMm - a.input.run.lengthMm;
      if (byLength !== 0) return byLength;
      return runAnchorRefno(a.input.run).localeCompare(runAnchorRefno(b.input.run));
    });

  const groups: { repDir: Vec3Mm; entries: GroupEntry[] }[] = [];
  for (const entry of entries) {
    const group = groups.find(g => Math.abs(dot(g.repDir, entry.dir)) >= cosTol);
    if (group) {
      group.entries.push({ input: entry.input, dir: entry.dir, t0: 0, t1: 0 });
    } else {
      groups.push({ repDir: entry.dir, entries: [{ input: entry.input, dir: entry.dir, t0: 0, t1: 0 }] });
    }
  }
  // 组内填轴向区间；输出组序按组内最小锚点 refno，与输入顺序无关
  for (const group of groups) {
    group.entries = group.entries.map(entry => ({ ...entry, ...axialRange(entry, group.repDir) }));
  }
  groups.sort((a, b) => {
    const aKey = a.entries.map(e => runAnchorRefno(e.input.run)).sort()[0] ?? '';
    const bKey = b.entries.map(e => runAnchorRefno(e.input.run)).sort()[0] ?? '';
    return aKey.localeCompare(bKey);
  });
  return groups.map(g => g.entries);
}

/**
 * 共同区段扫描（§5.4）：端点事件排序去重 → 相邻事件间的基本区间上参与集合恒定。
 * 重叠没有传递性——「A∩B、B∩C」不推出三者有共同截面，必须按整条区间内的实际覆盖集合算。
 */
function stableIntervals(entries: readonly GroupEntry[], minCommonLengthMm: number): { t0: number; t1: number; members: GroupEntry[] }[] {
  const events = [...new Set(entries.flatMap(e => [e.t0, e.t1]))].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const t of events) {
    if (kept.length === 0 || t - kept[kept.length - 1]! > AXIAL_EPS_MM) kept.push(t);
  }
  const out: { t0: number; t1: number; members: GroupEntry[] }[] = [];
  for (let i = 0; i + 1 < kept.length; i += 1) {
    const t0 = kept[i]!;
    const t1 = kept[i + 1]!;
    if (t1 - t0 < minCommonLengthMm) continue;
    const members = entries.filter(e => e.t0 <= t0 + AXIAL_EPS_MM && e.t1 >= t1 - AXIAL_EPS_MM);
    if (members.length >= 2) out.push({ t0, t1, members });
  }
  return out;
}

/** 截面二维坐标系：e1 取与代表方向最不共线的世界轴叉积，确定性且不依赖相机。 */
function sectionFrame(axis: Vec3Mm): { e1: Vec3Mm; e2: Vec3Mm } {
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  const ref = ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const e1 = normalize(cross(axis, ref)) ?? { x: 1, y: 0, z: 0 };
  return { e1, e2: cross(axis, e1) };
}

/** 支承法向在世界系给定向量在截面内的归一化投影；退化返回 null。 */
function projectSupportNormal(axis: Vec3Mm, supportNormal: Vec3Mm): Vec3Mm | null {
  const n = normalize(supportNormal);
  if (!n) return null;
  const projected = sub(n, scale(axis, dot(n, axis)));
  const len = length(projected);
  if (len < SUPPORT_NORMAL_MIN_PROJECTION) return null;
  return scale(projected, 1 / len);
}

/** 直段真实轴线与「过参数 t、法向为 axis」的截面的交点。 */
function memberAt(input: PipeRowRunInput, axis: Vec3Mm, t: number): Vec3Mm {
  const run = input.run;
  const s = (t - dot(run.start, axis)) / dot(run.direction, axis);
  return add(run.start, scale(run.direction, s));
}

type Point2 = { x: number; y: number };
type CandidateLine = {
  dir: Point2;
  inliers: number[]; // member 下标
  maxResidual: number;
};

/**
 * 截面二维坐标：e1 / e2 都垂直于代表管向，所以与截面在管向上的位置无关——
 * 不同截面上的坐标可以直接比较（合并区段、两端取样都靠这一点）。
 */
function to2D(point: Vec3Mm, frame: { e1: Vec3Mm; e2: Vec3Mm }): Point2 {
  return { x: dot(point, frame.e1), y: dot(point, frame.e2) };
}

function perpendicularDistance(p: Point2, a: Point2, dir: Point2): number {
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  return Math.abs(dx * dir.y - dy * dir.x);
}

function canonicalDir2(dx: number, dy: number): Point2 | null {
  const len = Math.hypot(dx, dy);
  if (len < COINCIDENT_EPS_MM) return null;
  const nx = dx / len;
  const ny = dy / len;
  return nx < -COINCIDENT_EPS_MM || (Math.abs(nx) <= COINCIDENT_EPS_MM && ny < 0)
    ? { x: -nx, y: -ny }
    : { x: nx, y: ny };
}

/** 一个截面里识别出的一排：成员下标、排向（二维单位向量）与逐排的歧义判定。 */
type ClusteredRow = { members: number[]; dir: Point2; ambiguous: boolean; diagnostics: string[] };

/**
 * 中心模式归排：枚举点对连线当候选排向，按（内点数 desc, 最大残差 asc, 方向字典序）取最优，
 * 逐条剥离成排，剩余孤管如实报告。不用逐点链式扩张——内点判定只认固定候选线，容差不会越传越宽（§5.5）。
 *
 * 歧义逐排判定：
 * - 并列最优覆盖不同但相交的成员集合（网格 / 多解，§3.2）→ 这一排及之后剥离的排都标歧义（剩下的怎么分取决于这次选择）；
 * - 剥离后剩下的两根必然共线——只有与同截面已成排（≥3 根）的排向平行（相对高差 ≤ 容差）才认作并列的另一排，否则进确认。
 */
function clusterRowsCenter(points: readonly Point2[], rowTol: number): ClusteredRow[] {
  const remaining = new Set(points.map((_, i) => i));
  const rows: ClusteredRow[] = [];
  let contested = false;

  while (remaining.size >= 2) {
    const idx = [...remaining];
    const candidates: CandidateLine[] = [];
    for (let ii = 0; ii < idx.length; ii += 1) {
      for (let jj = ii + 1; jj < idx.length; jj += 1) {
        const a = points[idx[ii]!]!;
        const b = points[idx[jj]!]!;
        const dir = canonicalDir2(b.x - a.x, b.y - a.y);
        if (!dir) continue; // 两点重合不产生排向
        const inliers: number[] = [];
        let maxResidual = 0;
        for (const k of idx) {
          const d = perpendicularDistance(points[k]!, a, dir);
          if (d <= rowTol) {
            inliers.push(k);
            maxResidual = Math.max(maxResidual, d);
          }
        }
        candidates.push({ dir, inliers, maxResidual });
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((c1, c2) => {
      const byCount = c2.inliers.length - c1.inliers.length;
      if (byCount !== 0) return byCount;
      const byResidual = c1.maxResidual - c2.maxResidual;
      if (Math.abs(byResidual) > 1e-9) return byResidual;
      if (c1.dir.x !== c2.dir.x) return c1.dir.x - c2.dir.x;
      return c1.dir.y - c2.dir.y;
    });
    const best = candidates[0]!;
    const bestSet = new Set(best.inliers);
    for (const rival of candidates.slice(1)) {
      if (rival.inliers.length !== best.inliers.length) break;
      if (Math.abs(rival.maxResidual - best.maxResidual) > 1e-9) break;
      // 集合相交但不相同 = 两排争夺同一批成员（网格 / 多解）→ 歧义；
      // 完全不相交的同分线是另一条不相干的排（R02 两排并列不算歧义）。
      if (rival.inliers.some(m => !bestSet.has(m)) && rival.inliers.some(m => bestSet.has(m))) {
        contested = true;
        break;
      }
    }
    const diagnostics: string[] = [];
    let ambiguous = contested;
    if (best.inliers.length === 2 && rows.length > 0) {
      const p = points[best.inliers[0]!]!;
      const q = points[best.inliers[1]!]!;
      const parallelToRow = rows.some(row => row.members.length >= LEFTOVER_ROW_REFERENCE_MIN_MEMBERS
        && Math.abs(row.dir.x * (q.y - p.y) - row.dir.y * (q.x - p.x)) <= rowTol);
      if (!parallelToRow) {
        ambiguous = true;
        diagnostics.push('剥离主排后剩下的两根管只凭两点连线成排，且与同截面已成排的排向不平行，需确认是否真为一排');
      }
    }
    rows.push({ members: best.inliers, dir: best.dir, ambiguous, diagnostics });
    for (const m of best.inliers) remaining.delete(m);
  }
  return rows;
}

/**
 * 管底模式归排：排向固定 ⊥ 支承法向（同排管底在同一支承高度上），
 * 按底点沿法向的坐标分簇；簇锚定首个成员的坐标、不做链式扩张，
 * 同时落在两簇容差内的成员让这两簇都标歧义。
 */
function clusterRowsBottom(points: readonly Point2[], normal2: Point2, rowTol: number): ClusteredRow[] {
  const withH = points.map((p, i) => ({ i, h: p.x * normal2.x + p.y * normal2.y }));
  withH.sort((a, b) => (a.h - b.h) || (a.i - b.i));

  const rows: { anchorH: number; members: number[]; ambiguous: boolean }[] = [];
  for (const { i, h } of withH) {
    const hits = rows.filter(r => Math.abs(h - r.anchorH) <= rowTol);
    if (hits.length > 1) for (const hit of hits) hit.ambiguous = true;
    const row = hits[0];
    if (row) {
      row.members.push(i);
    } else {
      rows.push({ anchorH: h, members: [i], ambiguous: false });
    }
  }
  const dir = { x: -normal2.y, y: normal2.x };
  return rows.map(r => ({
    members: r.members,
    dir,
    ambiguous: r.ambiguous,
    diagnostics: r.ambiguous ? ['有成员同时落在两条管底高度的容差内，归属不唯一'] : [],
  }));
}

/** 轴向参数进身份键的格式：0.1 mm 粒度——同一输入几何下逐位稳定，不拿显示舍入当身份。 */
export function formatAxialMm(t: number): string {
  return (Math.round(t * 10) / 10).toFixed(1);
}

/** 测量中用的外径：`catalogue` 可用；`bore-estimate` / `legacy-member` 可用但标估算；其余不可证 → null。 */
function usableOd(member: { odMm: number | null; odEvidence: OutsideDiameterEvidence }): number | null {
  return member.odEvidence === 'catalogue' || isEstimatedOdEvidence(member.odEvidence) ? member.odMm : null;
}

function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** 某个共同区段里的一排（尚未跨区段合并）。 */
type RowInstance = {
  interval: { t0: number; t1: number };
  /** 沿排向排序 */
  members: PipeRowMember[];
  dir: Point2;
  ambiguous: boolean;
  incomplete: boolean;
  estimated: boolean;
  diagnostics: string[];
};

function adjacentPairKeys(members: readonly PipeRowMember[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i + 1 < members.length; i += 1) keys.add(pairKeyOf(members[i]!.anchorRefno, members[i + 1]!.anchorRefno));
  return keys;
}

/**
 * 后一区段的排是否是前一区段那排的延续：至少一对相邻关系不变，且两边共有成员的相对次序一致
 * （排向在两区段间翻号时整体反序也算一致）。成员在排端进出不打断延续——错开起止的管仍在同一排。
 */
function continuesRow(prev: RowInstance, next: RowInstance): boolean {
  const prevPairs = adjacentPairKeys(prev.members);
  if (![...adjacentPairKeys(next.members)].some(key => prevPairs.has(key))) return false;
  const prevAnchors = new Set(prev.members.map(m => m.anchorRefno));
  const nextAnchors = new Set(next.members.map(m => m.anchorRefno));
  const before = prev.members.map(m => m.anchorRefno).filter(anchor => nextAnchors.has(anchor));
  const after = next.members.map(m => m.anchorRefno).filter(anchor => prevAnchors.has(anchor));
  return before.every((anchor, i) => anchor === after[i])
    || before.every((anchor, i) => anchor === after[after.length - 1 - i]);
}

/**
 * 主入口：一组直段 → 连排检测结果。`inputs` 跨 BRAN 混排随意传，内部先排序再算。
 */
export function detectPipeRows(
  inputs: readonly PipeRowRunInput[],
  options: PipeRowDetectOptions,
): PipeRowDetection {
  const alignMode = options.alignMode;
  const angleTol = options.angleToleranceDeg ?? DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG;
  const rowTol = options.rowToleranceMm ?? DEFAULT_ROW_TOLERANCE_MM;
  const minCommon = options.minCommonLengthMm ?? DEFAULT_MIN_OVERLAP_MM;
  const maxAdjacent = options.maxAdjacentCenterDistanceMm != null && options.maxAdjacentCenterDistanceMm > 0
    ? options.maxAdjacentCenterDistanceMm
    : null;
  const diagnostics: string[] = [];

  // 同一锚点 refno 重复输入去重（同一 BRAN 重选 / 重复直段不进配对——§5.6）
  const deduped = new Map<string, PipeRowRunInput>();
  for (const input of inputs) {
    if (!input.run || input.run.lengthMm <= 0) continue;
    const anchor = runAnchorRefno(input.run);
    if (!anchor) continue;
    if (!deduped.has(anchor)) deduped.set(anchor, { branRefno: input.branRefno, run: input.run });
  }
  const runs = [...deduped.values()];
  if (runs.length < 2) {
    return { alignMode, sections: [], groups: [], supportNormalDegenerate: false, diagnostics };
  }

  const dirGroups = groupByDirection(runs, angleTol).filter(g => g.length >= 2);
  if (dirGroups.length === 0) {
    diagnostics.push('没有管向一致（≤容差）的直段组，无法成排');
    return { alignMode, sections: [], groups: [], supportNormalDegenerate: false, diagnostics };
  }

  const sections: PipeRowSectionScan[] = [];
  const groups: PipeRowGroup[] = [];
  let supportNormalDegenerate = false;

  for (const group of dirGroups) {
    const repDir = group[0]!.dir; // 建组时钉死的代表方向（最长直段）
    const frame = sectionFrame(repDir);
    const inputsByAnchor = new Map(group.map(e => [runAnchorRefno(e.input.run), e.input]));

    // 支承法向（管底模式）：世界向上在截面内投影；退化时只认人工指定的法向，不按视图猜（§3.3 / R11）
    let normal3: Vec3Mm | null = null;
    let normal2: Point2 | null = null;
    if (alignMode === 'bottom') {
      normal3 = projectSupportNormal(repDir, options.supportNormal ?? WORLD_UP)
        ?? (options.fallbackSupportNormal ? projectSupportNormal(repDir, options.fallbackSupportNormal) : null);
      if (!normal3) {
        supportNormalDegenerate = true;
        diagnostics.push('支承法向在截面内投影退化（主管向近铅直），请指定竖管支承法向');
        continue;
      }
      const n2 = to2D(normal3, frame);
      const nLen = Math.hypot(n2.x, n2.y);
      normal2 = nLen > 0 ? { x: n2.x / nLen, y: n2.y / nLen } : null;
      if (!normal2) {
        supportNormalDegenerate = true;
        diagnostics.push('支承法向在截面内投影退化，请指定竖管支承法向');
        continue;
      }
    }

    /** 成员在参数 t 处的截面落点：中心 C_i、归排定位点（管底模式 C_i − r_i·n）。 */
    const memberAtT = (anchor: string, t: number, dir2: Point2): PipeRowMember => {
      const input = inputsByAnchor.get(anchor)!;
      const odMm = input.run.outsideDiameterMm;
      const odEvidence = input.run.odEvidence;
      const centerMm = memberAt(input, repDir, t);
      const rowPointMm = alignMode === 'bottom' && normal3
        ? sub(centerMm, scale(normal3, (usableOd({ odMm, odEvidence }) ?? 0) / 2))
        : centerMm;
      const point2 = to2D(rowPointMm, frame);
      return {
        branRefno: input.branRefno,
        run: input.run,
        anchorRefno: anchor,
        centerMm,
        rowPointMm,
        rowCoordMm: point2.x * dir2.x + point2.y * dir2.y,
        odMm,
        odEvidence,
      };
    };

    const intervals = stableIntervals(group, minCommon);
    if (intervals.length === 0) {
      diagnostics.push(`管向组 ${group.map(e => runAnchorRefno(e.input.run)).join(',')} 内没有 ≥ 最小共同长度且 ≥2 根参与的共同区段`);
      continue;
    }

    // 每条共同区段 → 一次截面归排
    const instancesByInterval: RowInstance[][] = [];
    for (const interval of intervals) {
      const sectionT = (interval.t0 + interval.t1) / 2;
      const scanDiagnostics: string[] = [];
      const placed: PipeRowMember[] = [];
      const points: Point2[] = [];
      const unplaced: string[] = [];

      // unplaceable：管底模式下缺可靠外径、无法定位底点的成员——它们可能在排内任何位置，
      // 无法证明分组完整（§5.7）；孤管（有定位点但没进任何排）只进 unplaced、不判不完整。
      const unplaceable: string[] = [];

      for (const entry of interval.members) {
        const anchor = runAnchorRefno(entry.input.run);
        if (alignMode === 'bottom'
          && usableOd({ odMm: entry.input.run.outsideDiameterMm, odEvidence: entry.input.run.odEvidence }) === null) {
          unplaced.push(anchor);
          unplaceable.push(anchor);
          continue;
        }
        const member = memberAtT(anchor, sectionT, { x: 0, y: 0 });
        const point = to2D(member.rowPointMm, frame);
        // 同一 BRAN 的两条直段在截面里重合（接口处首尾搭接）是同一根管，不是两根相邻管
        if (placed.some((other, i) => other.branRefno === member.branRefno
          && Math.hypot(points[i]!.x - point.x, points[i]!.y - point.y) <= rowTol)) continue;
        placed.push(member);
        points.push(point);
      }

      let clustered: ClusteredRow[] = [];
      if (alignMode === 'bottom' && normal2) {
        const all = clusterRowsBottom(points, normal2, rowTol);
        clustered = all.filter(row => row.members.length >= 2);
        for (const single of all.filter(row => row.members.length === 1)) unplaced.push(placed[single.members[0]!]!.anchorRefno);
      } else if (placed.length === 2) {
        // 两条成员唯一成排；两点重合时方向退化，下面的相邻重合检查会把它标歧义（R09）
        const dir = canonicalDir2(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y) ?? { x: 1, y: 0 };
        clustered = [{ members: [0, 1], dir, ambiguous: false, diagnostics: [] }];
      } else if (placed.length > 2) {
        clustered = clusterRowsCenter(points, rowTol);
        const inRows = new Set(clustered.flatMap(row => row.members));
        placed.forEach((member, index) => {
          if (!inRows.has(index)) unplaced.push(member.anchorRefno);
        });
      }

      const instances: RowInstance[] = [];
      for (const row of clustered) {
        const dir = row.dir;
        const sorted = row.members
          .map(i => ({ ...placed[i]!, rowCoordMm: points[i]!.x * dir.x + points[i]!.y * dir.y }))
          .sort((a, b) => (a.rowCoordMm - b.rowCoordMm) || a.anchorRefno.localeCompare(b.anchorRefno));
        const rowDiagnostics = [...row.diagnostics];
        let ambiguous = row.ambiguous;
        if (sorted.some((member, i) => i > 0 && member.rowCoordMm - sorted[i - 1]!.rowCoordMm <= rowTol)) {
          ambiguous = true;
          rowDiagnostics.push(`排内有相邻两管沿排向相距不超过 ${rowTol} mm（共轴或重复建模），排序不可证`);
        }
        const estimated = alignMode === 'bottom' && sorted.some(member => isEstimatedOdEvidence(member.odEvidence));
        if (estimated) rowDiagnostics.push('管底归排依据含估算外径（孔径估算 / 旧服务端成员外径），底点位置为估算');
        const parts: PipeRowMember[][] = [[sorted[0]!]];
        for (let i = 1; i < sorted.length; i += 1) {
          const gap = length(sub(sorted[i]!.centerMm, sorted[i - 1]!.centerMm));
          if (maxAdjacent !== null && gap > maxAdjacent) {
            scanDiagnostics.push(`${sorted[i - 1]!.anchorRefno} ↔ ${sorted[i]!.anchorRefno} 中心距 ${Math.round(gap)} mm 超过相邻上限 ${Math.round(maxAdjacent)} mm，在此断开成两排`);
            parts.push([]);
          }
          parts[parts.length - 1]!.push(sorted[i]!);
        }
        for (const part of parts) {
          if (part.length < 2) {
            unplaced.push(...part.map(member => member.anchorRefno));
            continue;
          }
          instances.push({ interval, members: part, dir, ambiguous, incomplete: unplaceable.length > 0, estimated, diagnostics: rowDiagnostics });
        }
      }

      sections.push({
        section: {
          axisDirection: repDir,
          origin: placed.length > 0
            ? scale(placed.reduce((sum, member) => add(sum, member.centerMm), ZERO), 1 / placed.length)
            : scale(repDir, sectionT),
          sectionT,
          axialStartMm: interval.t0,
          axialEndMm: interval.t1,
        },
        rows: instances.map(instance => ({ memberAnchors: instance.members.map(m => m.anchorRefno), ambiguous: instance.ambiguous })),
        unplacedAnchors: unplaced,
        diagnostics: [
          ...scanDiagnostics,
          ...(unplaceable.length > 0
            ? [`截面内 ${unplaceable.length} 根管缺可靠外径证据，无法定位管底点，分组完整性不可证`]
            : []),
        ],
      });
      instancesByInterval.push(instances);
    }

    // 跨区段延续：紧邻的下一区段里、相邻关系延续且判定状态相同的排并成一排（不跨缺口、不把可证与待确认的区段混在一起）。
    type MergedRow = { instances: RowInstance[]; t0: number; t1: number; lastInterval: number; ambiguous: boolean; incomplete: boolean; estimated: boolean };
    const merged: MergedRow[] = [];
    instancesByInterval.forEach((instances, intervalIndex) => {
      const extended = new Set<MergedRow>();
      for (const instance of instances) {
        const target = merged.find(candidate => !extended.has(candidate)
          && candidate.lastInterval === intervalIndex - 1
          && instance.interval.t0 - candidate.t1 < minCommon
          && candidate.ambiguous === instance.ambiguous
          && candidate.incomplete === instance.incomplete
          && candidate.estimated === instance.estimated
          && continuesRow(candidate.instances[candidate.instances.length - 1]!, instance));
        if (target) {
          target.instances.push(instance);
          target.t1 = instance.interval.t1;
          target.lastInterval = intervalIndex;
          extended.add(target);
        } else {
          merged.push({
            instances: [instance],
            t0: instance.interval.t0,
            t1: instance.interval.t1,
            lastInterval: intervalIndex,
            ambiguous: instance.ambiguous,
            incomplete: instance.incomplete,
            estimated: instance.estimated,
          });
        }
      }
    });

    // 定稿：成员取各自在排内出现区段的中点落点；相邻对按「连续区段内保持相邻」合并成一条测量，截面取该对区段中点
    for (const row of merged) {
      const dominant = row.instances.reduce((best, instance) =>
        (instance.interval.t1 - instance.interval.t0 > best.interval.t1 - best.interval.t0 ? instance : best));
      const dir2 = dominant.dir;
      const direction = normalize(add(scale(frame.e1, dir2.x), scale(frame.e2, dir2.y))) ?? repDir;

      const presence = new Map<string, { t0: number; t1: number }>();
      for (const instance of row.instances) {
        for (const member of instance.members) {
          const range = presence.get(member.anchorRefno);
          if (range) range.t1 = instance.interval.t1;
          else presence.set(member.anchorRefno, { t0: instance.interval.t0, t1: instance.interval.t1 });
        }
      }
      const members = [...presence.entries()]
        .map(([anchor, range]) => memberAtT(anchor, (range.t0 + range.t1) / 2, dir2))
        .sort((a, b) => (a.rowCoordMm - b.rowCoordMm) || a.anchorRefno.localeCompare(b.anchorRefno));
      const memberIndex = new Map(members.map((member, index) => [member.anchorRefno, index]));
      const rowKey = `row:${[...presence.keys()].sort().join('|')}@${formatAxialMm(row.t0)}-${formatAxialMm(row.t1)}:${alignMode}`;

      type PairSpan = { a: string; b: string; t0: number; t1: number; last: number };
      const spans: PairSpan[] = [];
      const openSpans = new Map<string, PairSpan>();
      row.instances.forEach((instance, index) => {
        for (let i = 0; i + 1 < instance.members.length; i += 1) {
          const a = instance.members[i]!.anchorRefno;
          const b = instance.members[i + 1]!.anchorRefno;
          const key = pairKeyOf(a, b);
          const span = openSpans.get(key);
          if (span && span.last === index - 1) {
            span.t1 = instance.interval.t1;
            span.last = index;
          } else {
            const opened = { a, b, t0: instance.interval.t0, t1: instance.interval.t1, last: index };
            openSpans.set(key, opened);
            spans.push(opened);
          }
        }
      });

      let orderUnstable = false;
      const pairs: PipeRowPair[] = spans.map((span): PipeRowPair => {
        const sectionT = (span.t0 + span.t1) / 2;
        const atA = memberAtT(span.a, sectionT, dir2);
        const atB = memberAtT(span.b, sectionT, dir2);
        const midDelta = atB.rowCoordMm - atA.rowCoordMm;
        // 排序稳定性：该对区段两端取样，相对次序与中点相反 → 排序沿区段翻转（成员管向有夹角），不按中点结论出正式结果（§5.6）
        for (const t of [span.t0 + ORDER_EPS_MM, span.t1 - ORDER_EPS_MM]) {
          if ((memberAtT(span.b, t, dir2).rowCoordMm - memberAtT(span.a, t, dir2).rowCoordMm) * midDelta < 0) orderUnstable = true;
        }
        const [source, target]: [PipeRowMember, PipeRowMember] = midDelta > 0 || (midDelta === 0 && span.a.localeCompare(span.b) <= 0)
          ? [atA, atB]
          : [atB, atA];
        const centerDistanceMm = length(sub(target.centerMm, source.centerMm));
        const odA = usableOd(source);
        const odB = usableOd(target);
        return {
          source,
          target,
          pairKey: pairKeyOf(source.anchorRefno, target.anchorRefno),
          centerDistanceMm,
          signedGapMm: odA !== null && odB !== null ? centerDistanceMm - (odA + odB) / 2 : null,
          gapEstimated: isEstimatedOdEvidence(source.odEvidence) || isEstimatedOdEvidence(target.odEvidence),
          rowKey,
          section: {
            axisDirection: repDir,
            origin: scale(add(source.centerMm, target.centerMm), 0.5),
            sectionT,
            axialStartMm: span.t0,
            axialEndMm: span.t1,
          },
        };
      }).sort((p, q) => (memberIndex.get(p.source.anchorRefno)! - memberIndex.get(q.source.anchorRefno)!)
        || (p.section.axialStartMm - q.section.axialStartMm));

      const sectionT = (row.t0 + row.t1) / 2;
      const centers = members.map(member => memberAt(inputsByAnchor.get(member.anchorRefno)!, repDir, sectionT));
      groups.push({
        key: rowKey,
        alignMode,
        direction,
        members,
        pairs,
        section: {
          axisDirection: repDir,
          origin: scale(centers.reduce(add, ZERO), 1 / centers.length),
          sectionT,
          axialStartMm: row.t0,
          axialEndMm: row.t1,
        },
        ambiguous: row.ambiguous || orderUnstable,
        incomplete: row.incomplete,
        estimatedGrouping: row.estimated,
        diagnostics: [
          ...new Set(row.instances.flatMap(instance => instance.diagnostics)),
          ...(orderUnstable ? ['相邻排序沿区段不稳定（成员管向有夹角），测量截面已固定在各对区段中点，请确认'] : []),
          ...(row.incomplete ? ['同截面存在未归排成员，分组完整性不可证'] : []),
        ],
      });
    }
  }

  // 输出顺序钉死：按排键排序，结果与输入顺序无关（R03）
  groups.sort((a, b) => a.key.localeCompare(b.key));
  return { alignMode, sections, groups, supportNormalDegenerate, diagnostics };
}
