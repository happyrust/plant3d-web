/**
 * 增量落地后的 RVM 校验对象：从 `/api/v1/tasks` 推出本轮重算过的生成根，再和各根最新的核对结论比，
 * 判断哪些根「增量待校验」（从没核对过）或「增量后过期」（结论早于重算）。纯函数，不发请求。
 *
 * 只认 `data_batch` / `model_rebuild` 进入 `succeeded` / `partial` 后 `status === 'generated'` 的单元；
 * `regen` 与 `transform`（刚体前移）都算重算。`/tasks` 只留最近 200 条，更早的批次推不出来。
 */

import { nodeVerdictLabel, rvmRefnoKey, rvmStatusTitle, type RvmNodeStatus } from './rvmCheckFormat';

import type { TaskListEntryDto, TaskOutcomeDto } from '@/api/genModelV1Api';

const ROOT_KINDS = new Set(['data_batch', 'model_rebuild']);
const DONE_STATES = new Set(['succeeded', 'partial']);

export type IncrementalRoot = {
  /** `a_b`，与 `statusByRefno` 同一形状 */
  refno: string;
  noun: string;
  taskId: string;
  taskKind: string;
  dbnum: number | null;
  /** 批次的结束会话号，界面上叫「第 N 轮」 */
  sesno: number | null;
  finishedAt: string;
  /** `regen | transform` */
  unitKind: string;
};

function timeMs(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const ms = new Date(stamp).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** 这条任务是不是已落地、能产出生成根的增量任务。 */
export function isIncrementalTask(entry: TaskListEntryDto): boolean {
  return ROOT_KINDS.has(entry.kind) && DONE_STATES.has(entry.state) && timeMs(entry.finished_at) !== null;
}

/** 一条任务里重算过的生成根（同一任务内按 refno 去重）。不是落地的增量任务时给空。 */
export function rootsOfTask(entry: TaskListEntryDto): IncrementalRoot[] {
  if (!isIncrementalTask(entry)) return [];
  const result = entry.result as TaskOutcomeDto | null | undefined;
  const units = result && typeof result === 'object' && Array.isArray(result.units) ? result.units : [];
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
      finishedAt: entry.finished_at!,
      unitKind: unit.kind || 'regen',
    });
  }
  return roots;
}

/** 所有落地批次的生成根，按 refno 去重，同一根取最近一轮；结果按落地时刻从新到旧。 */
export function incrementalRootsOf(tasks: TaskListEntryDto[]): IncrementalRoot[] {
  const latest = new Map<string, IncrementalRoot>();
  for (const entry of tasks) {
    for (const root of rootsOfTask(entry)) {
      const current = latest.get(root.refno);
      if (!current || (timeMs(current.finishedAt) ?? 0) < (timeMs(root.finishedAt) ?? 0)) latest.set(root.refno, root);
    }
  }
  return [...latest.values()].sort((left, right) => (timeMs(right.finishedAt) ?? 0) - (timeMs(left.finishedAt) ?? 0));
}

export function isInFlight(status: RvmNodeStatus | null | undefined): boolean {
  return status?.verdict === 'queued' || status?.verdict === 'running';
}

/** 有结论，但结论时刻早于这一轮重算落地。排队 / 运行中不算。 */
export function isOutdated(status: RvmNodeStatus | null | undefined, root: Pick<IncrementalRoot, 'finishedAt'>): boolean {
  if (!status || isInFlight(status)) return false;
  const at = timeMs(status.at);
  const finished = timeMs(root.finishedAt);
  return finished !== null && (at === null || at < finished);
}

/** 这一轮之后要（重新）校验：没结论，或结论过期。排队 / 运行中不算。 */
export function isPendingFor(status: RvmNodeStatus | null | undefined, root: Pick<IncrementalRoot, 'finishedAt'>): boolean {
  if (!status) return true;
  return isOutdated(status, root);
}

export function pendingRoots(roots: IncrementalRoot[], statusByRefno: Record<string, RvmNodeStatus>): IncrementalRoot[] {
  return roots.filter((root) => isPendingFor(statusByRefno[root.refno], root));
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
};

/** 一条增量记录里各根的核对汇总，按这条记录自己的落地时刻判过期。 */
export function batchCheckSummary(entry: TaskListEntryDto, statusByRefno: Record<string, RvmNodeStatus>): BatchCheckSummary {
  const summary: BatchCheckSummary = { total: 0, pending: 0, running: 0, pass: 0, mismatch: 0, failed: 0, other: 0 };
  for (const root of rootsOfTask(entry)) {
    summary.total += 1;
    const status = statusByRefno[root.refno];
    if (isInFlight(status)) summary.running += 1;
    else if (isPendingFor(status, root)) summary.pending += 1;
    else if (status!.verdict === 'pass') summary.pass += 1;
    else if (status!.verdict === 'fail' || status!.verdict === 'kind_differ') summary.mismatch += 1;
    else if (status!.verdict === 'tool_error') summary.failed += 1;
    else summary.other += 1;
  }
  return summary;
}

/** 一条记录里还要校验的根（按这条记录的落地时刻判）。 */
export function taskPendingRoots(entry: TaskListEntryDto, statusByRefno: Record<string, RvmNodeStatus>): IncrementalRoot[] {
  return rootsOfTask(entry).filter((root) => isPendingFor(statusByRefno[root.refno], root));
}

function shortAt(stamp: string): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roundLabel(root: IncrementalRoot): string {
  return root.sesno != null ? `第 ${root.sesno} 轮增量` : `${shortAt(root.finishedAt)} 的增量`;
}

/**
 * 树和列表上的悬停提示。`root` 只在这个根待校验 / 过期时传；否则退回普通的核对提示。
 * 都没有时给空串。
 */
export function rvmBadgeTitle(status: RvmNodeStatus | null | undefined, root: IncrementalRoot | null | undefined): string {
  if (!root) return status ? rvmStatusTitle(status) : '';
  const how = root.unitKind === 'transform' ? '刚体前移' : '整根重算';
  if (!status) return `RVM 核对：增量待校验\n${roundLabel(root)}（${how}）重算过，还没校验过`;
  const head = rvmStatusTitle(status).replace(/\n点击查看结果$/, '');
  const at = status.at ? `（${shortAt(status.at)}）` : '';
  return `${head}\n上次结论 ${nodeVerdictLabel(status.verdict)}${at}，之后${roundLabel(root)}重算过，待重新校验\n点击查看结果`;
}
