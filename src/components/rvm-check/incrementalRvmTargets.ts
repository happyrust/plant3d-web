/**
 * 增量落地后的 RVM 校验对象：从 `/api/v1/tasks` 推出各轮重算过的生成根，再和各根最新的核对结论比，
 * 判断哪些根「增量待校验」（增量轮重算过、从没核对过）或「增量后过期」（结论覆盖不到之后的某一轮）。纯函数，不发请求。
 *
 * 只认 `data_batch` / `model_rebuild` 进入 `succeeded` / `partial` 后 `status === 'generated'` 的单元；
 * `regen`、`transform`（刚体前移）、`unit`（单元级发布）都算重算。
 *
 * 过期按会话号判：同一个库里，结论核对的是哪个会话（报告的 `sesno`，核对开工时库文件的最新会话），
 * 这一轮把根推到了哪个会话（`end_sesno`）。同一会话的批次重跑（后端重启后重新初始化）不算过期；
 * 核对开工之后才落地的新会话算过期。任一边缺会话号或库号对不上时退回比时刻。
 *
 * 整库从头生成的一轮（初始化 / 重新初始化 / 全量重建）是基线，不是增量：从没核对过的根不因它算待校验，
 * 只有核对过、结论又落后于它的根才算过期。整库核对用 RVM 核对页的「全部 SITE 依次核对」。
 *
 * 祖先节点（SITE / ZONE…）核对通过，说明整棵子树当时都对上了：子树里的根把它当成自己的一次核对，
 * 和自己的结论比谁新，取新的那次判。祖先不一致、种类不一致等不算——差在哪个根上分不出来。
 */

import { nodeVerdictLabel, rvmRefnoKey, rvmStatusTitle, type RvmNodeStatus } from './rvmCheckFormat';

import type { TaskListEntryDto, TaskOutcomeDto } from '@/api/genModelV1Api';

import { unitKindLabel } from '@/components/increment/incrementRecordFormat';

const ROUND_KINDS = new Set(['data_batch', 'model_rebuild']);
const DONE_STATES = new Set(['succeeded', 'partial']);

export type IncrementalRoot = {
  /** `a_b`，与 `statusByRefno` 同一形状 */
  refno: string;
  noun: string;
  taskId: string;
  taskKind: string;
  dbnum: number | null;
  /** 这一轮的结束会话号，界面上叫「第 N 轮」 */
  sesno: number | null;
  /** 这一轮的起始会话号；基线轮从 1 起 */
  startSesno: number | null;
  finishedAt: string;
  /** `regen | transform | unit` */
  unitKind: string;
  /** 整库从头生成的一轮：从没核对过的根不因它算待校验 */
  baseline: boolean;
};

/** 一个根在任务窗口里最近的两轮：所有轮次里最新的，和增量轮里最新的（只出现在基线轮里时为 null）。 */
export type RootRounds = {
  latest: IncrementalRoot;
  latestIncremental: IncrementalRoot | null;
};

/** 拿来和轮次比的那次核对：时刻、会话号、库号。 */
export type CheckedAt = Pick<RvmNodeStatus, 'at' | 'sesno' | 'dbnum'>;

type RoundPosition = Pick<IncrementalRoot, 'finishedAt' | 'sesno' | 'dbnum'>;

function timeMs(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const ms = new Date(stamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function sameDb(left: number | null | undefined, right: number | null | undefined): boolean {
  return left == null || right == null || left === right;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** 这条任务是不是已落地、能产出生成根的增量任务。 */
export function isIncrementalTask(entry: TaskListEntryDto): boolean {
  return ROUND_KINDS.has(entry.kind) && DONE_STATES.has(entry.state) && timeMs(entry.finished_at) !== null;
}

/**
 * 整库从头生成的一轮：人工全量重建、`reinitialize`、模型从会话 0 起补（`model_only` + `model_start_sesno = 0`，
 * 后端重启后的初始化就是这种），或者数据窗口从会话 1 起（这个库第一次摄入）。
 */
export function isBaselineTask(entry: TaskListEntryDto): boolean {
  if (entry.kind === 'model_rebuild') return true;
  const detail = record(entry.detail);
  if (detail.intent === 'reinitialize' || detail.model_start_sesno === 0) return true;
  return typeof entry.start_sesno === 'number' && entry.start_sesno <= 1;
}

/** 一条任务里重算过的生成根（同一任务内按 refno 去重）。不是落地的增量任务时给空。 */
export function rootsOfTask(entry: TaskListEntryDto): IncrementalRoot[] {
  if (!isIncrementalTask(entry)) return [];
  const result = entry.result as TaskOutcomeDto | null | undefined;
  const units = result && typeof result === 'object' && Array.isArray(result.units) ? result.units : [];
  const baseline = isBaselineTask(entry);
  const seen = new Set<string>();
  const roots: IncrementalRoot[] = [];
  for (const unit of units) {
    if (unit.status !== 'generated') continue;
    const refno = rvmRefnoKey(unit.root_refno);
    if (!refno || seen.has(refno)) continue;
    seen.add(refno);
    roots.push({
      refno,
      noun: unit.noun ?? '',
      taskId: entry.task_id,
      taskKind: entry.kind,
      dbnum: unit.dbnum ?? entry.dbnum ?? null,
      sesno: entry.end_sesno ?? null,
      startSesno: entry.start_sesno ?? null,
      finishedAt: entry.finished_at!,
      unitKind: unit.kind || 'regen',
      baseline,
    });
  }
  return roots;
}

/** `a` 是不是比 `b` 更晚的一轮：同库都有会话号时先比会话号，会话号相同或比不了时比落地时刻。 */
function isLaterRound(a: RoundPosition, b: RoundPosition): boolean {
  if (a.sesno != null && b.sesno != null && sameDb(a.dbnum, b.dbnum) && a.sesno !== b.sesno) return a.sesno > b.sesno;
  return (timeMs(a.finishedAt) ?? 0) > (timeMs(b.finishedAt) ?? 0);
}

/** 所有落地轮次按根归拢：每个根最新的一轮和最新的增量轮。 */
export function incrementalRoundsOf(tasks: TaskListEntryDto[]): Map<string, RootRounds> {
  const rounds = new Map<string, RootRounds>();
  for (const entry of tasks) {
    for (const root of rootsOfTask(entry)) {
      const current = rounds.get(root.refno);
      if (!current) {
        rounds.set(root.refno, { latest: root, latestIncremental: root.baseline ? null : root });
        continue;
      }
      if (isLaterRound(root, current.latest)) current.latest = root;
      if (!root.baseline && (!current.latestIncremental || isLaterRound(root, current.latestIncremental))) {
        current.latestIncremental = root;
      }
    }
  }
  return rounds;
}

export function isInFlight(status: Pick<RvmNodeStatus, 'verdict'> | null | undefined): boolean {
  return status?.verdict === 'queued' || status?.verdict === 'running';
}

/** 这次核对覆盖不到这一轮：同库按会话号比（结论的会话早于这一轮），比不了时按时刻比（结论早于落地）。 */
export function isCheckBehind(checked: CheckedAt, round: RoundPosition): boolean {
  if (checked.sesno != null && round.sesno != null && sameDb(checked.dbnum, round.dbnum)) {
    return checked.sesno < round.sesno;
  }
  const at = timeMs(checked.at);
  const finished = timeMs(round.finishedAt);
  return finished !== null && (at === null || at < finished);
}

/** 有结论，但结论覆盖不到这一轮。排队 / 运行中不算。 */
export function isOutdated(status: RvmNodeStatus | null | undefined, round: RoundPosition): boolean {
  if (!status || isInFlight(status)) return false;
  return isCheckBehind(status, round);
}

/** `a` 是不是比 `b` 更新的一次核对：同库都有会话号时比会话号，否则比时刻。 */
function isNewerCheck(a: CheckedAt, b: CheckedAt): boolean {
  if (a.sesno != null && b.sesno != null && sameDb(a.dbnum, b.dbnum)) return a.sesno > b.sesno;
  return (timeMs(a.at) ?? 0) > (timeMs(b.at) ?? 0);
}

/** 拿来判这个根的那次核对：自己的结论和祖先通过的结论里最新的一次；都没有时为 null。 */
function effectiveCheck(status: RvmNodeStatus | null | undefined, ancestorPasses: readonly CheckedAt[]): CheckedAt | null {
  let effective: CheckedAt | null = status ?? null;
  for (const checked of ancestorPasses) {
    if (!effective || isNewerCheck(checked, effective)) effective = checked;
  }
  return effective;
}

/** 祖先链（自己在前，`tree/ancestors` 的形状）上核对通过的那些结论；自己不算。 */
export function passingAncestorChecks(
  refno: string,
  chain: readonly string[] | null | undefined,
  statusByRefno: Record<string, RvmNodeStatus>,
): RvmNodeStatus[] {
  if (!chain) return [];
  const passes: RvmNodeStatus[] = [];
  for (const ancestor of chain) {
    if (ancestor === refno) continue;
    const status = statusByRefno[ancestor];
    if (status?.verdict === 'pass') passes.push(status);
  }
  return passes;
}

/**
 * 按这一轮看要不要（重新）校验：增量轮里没核对过，或者核对覆盖不到这一轮。基线轮里没核对过不算。排队 / 运行中不算。
 * 祖先核对通过也算核对过。
 */
export function isPendingFor(
  status: RvmNodeStatus | null | undefined,
  round: RoundPosition & Pick<IncrementalRoot, 'baseline'>,
  ancestorPasses: readonly CheckedAt[] = [],
): boolean {
  if (isInFlight(status)) return false;
  const checked = effectiveCheck(status, ancestorPasses);
  if (!checked) return !round.baseline;
  return isCheckBehind(checked, round);
}

/** 这次核对之后又重算过这个根的那一轮；覆盖得到时给 null。增量轮优先：同时落后于增量轮和基线轮时报增量轮。 */
export function roundAfterCheck(checked: CheckedAt, rounds: RootRounds): IncrementalRoot | null {
  const incremental = rounds.latestIncremental;
  if (incremental && isCheckBehind(checked, incremental)) return incremental;
  return isCheckBehind(checked, rounds.latest) ? rounds.latest : null;
}

/** 一个根现在因为哪一轮待校验 / 过期；不待校验、排队或运行中时给 null。祖先核对通过也算核对过。 */
export function pendingRoundFor(
  status: RvmNodeStatus | null | undefined,
  rounds: RootRounds,
  ancestorPasses: readonly CheckedAt[] = [],
): IncrementalRoot | null {
  if (isInFlight(status)) return null;
  const checked = effectiveCheck(status, ancestorPasses);
  if (!checked) return rounds.latestIncremental;
  return roundAfterCheck(checked, rounds);
}

/** 给某个根找祖先里核对通过的结论；没有祖先信息时给空。 */
export type AncestorPassesOf = (refno: string) => readonly CheckedAt[];

const NO_ANCESTORS: AncestorPassesOf = () => [];

/** 现在待校验 / 过期的根，每根给出是因为哪一轮；按落地时刻从新到旧。 */
export function pendingRoots(
  rounds: Map<string, RootRounds>,
  statusByRefno: Record<string, RvmNodeStatus>,
  ancestorPassesOf: AncestorPassesOf = NO_ANCESTORS,
): IncrementalRoot[] {
  const pending: IncrementalRoot[] = [];
  for (const [refno, rootRounds] of rounds) {
    const round = pendingRoundFor(statusByRefno[refno], rootRounds, ancestorPassesOf(refno));
    if (round) pending.push(round);
  }
  return pending.sort((left, right) => (timeMs(right.finishedAt) ?? 0) - (timeMs(left.finishedAt) ?? 0));
}

export type BatchCheckSummary = {
  total: number;
  pending: number;
  running: number;
  pass: number;
  /** 不一致 + 种类不一致 */
  mismatch: number;
  /** 工具故障 */
  failed: number;
  /** 无可比内容 + 非几何问题 */
  other: number;
  /** 基线轮里从没核对过的根：不算待校验，单独计数 */
  unchecked: number;
};

/** 一条增量记录里各根的核对汇总，按这条记录自己这一轮判过期；自己没结论、靠祖先通过覆盖的记作通过。 */
export function batchCheckSummary(
  entry: TaskListEntryDto,
  statusByRefno: Record<string, RvmNodeStatus>,
  ancestorPassesOf: AncestorPassesOf = NO_ANCESTORS,
): BatchCheckSummary {
  const summary: BatchCheckSummary = { total: 0, pending: 0, running: 0, pass: 0, mismatch: 0, failed: 0, other: 0, unchecked: 0 };
  for (const root of rootsOfTask(entry)) {
    summary.total += 1;
    const status = statusByRefno[root.refno];
    const passes = ancestorPassesOf(root.refno);
    if (isInFlight(status)) summary.running += 1;
    else if (isPendingFor(status, root, passes)) summary.pending += 1;
    else if (!status) {
      if (passes.length > 0) summary.pass += 1;
      else summary.unchecked += 1;
    }
    else if (status.verdict === 'pass') summary.pass += 1;
    else if (status.verdict === 'fail' || status.verdict === 'kind_differ') summary.mismatch += 1;
    else if (status.verdict === 'tool_error') summary.failed += 1;
    else summary.other += 1;
  }
  return summary;
}

/** 一条记录里还要校验的根（按这条记录这一轮判）。 */
export function taskPendingRoots(
  entry: TaskListEntryDto,
  statusByRefno: Record<string, RvmNodeStatus>,
  ancestorPassesOf: AncestorPassesOf = NO_ANCESTORS,
): IncrementalRoot[] {
  return rootsOfTask(entry).filter((root) => isPendingFor(statusByRefno[root.refno], root, ancestorPassesOf(root.refno)));
}

function shortAt(stamp: string): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 一轮的叫法：增量轮「第 N 轮增量」，基线轮「会话 1→N 整库生成」。 */
export function roundLabel(root: Pick<IncrementalRoot, 'sesno' | 'startSesno' | 'finishedAt' | 'baseline'>): string {
  if (root.baseline) {
    return root.sesno != null ? `会话 ${root.startSesno ?? 1}→${root.sesno} 整库生成` : `${shortAt(root.finishedAt)} 的整库重建`;
  }
  return root.sesno != null ? `第 ${root.sesno} 轮增量` : `${shortAt(root.finishedAt)} 的增量`;
}

/** 刚体前移、单元级发布这两条便宜路的发布结果，核对是看不到的。 */
function publishNote(root: IncrementalRoot): string {
  if (root.unitKind !== 'transform' && root.unitKind !== 'unit') return '';
  return `\n核对按当前会话整根重新生成后与 E3D 导出比对，不直接检查这一轮${unitKindLabel(root.unitKind)}的发布结果`;
}

/**
 * 树和列表上的悬停提示。`root` 只在这个根待校验 / 过期时传；否则退回普通的核对提示。
 * 都没有时给空串。
 */
export function rvmBadgeTitle(status: RvmNodeStatus | null | undefined, root: IncrementalRoot | null | undefined): string {
  if (!root) return status ? rvmStatusTitle(status) : '';
  const how = unitKindLabel(root.unitKind);
  if (!status) return `RVM 核对：增量待校验\n${roundLabel(root)}（${how}）重算过，还没校验过${publishNote(root)}`;
  const head = rvmStatusTitle(status).replace(/\n点击查看结果$/, '');
  const at = status.at ? `（${shortAt(status.at)}）` : '';
  return `${head}\n上次结论 ${nodeVerdictLabel(status.verdict)}${at}，之后${roundLabel(root)}重算过，待重新校验${publishNote(root)}\n点击查看结果`;
}
