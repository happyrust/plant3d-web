/**
 * 「更新到最新」（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C3；ADR 0072 第 5 条）：
 * 节点落后时，让后端把这个库还没入库的会话入库并重新生成受影响的模型。
 *
 * - 走的是「模型生成」面板同一条路：`POST /api/v1/update/execute { dbnums: [库] }`，任务也登记在面板的任务表里
 *   （`useModelGenerationAdmin().executeUpdate`），面板里同样看得到。它更新的是整个库的这一段会话，不只是这个节点；
 * - 不重复触发：这个页面对这个库的上一次还没完、或库状态说后端正在写它，就只跟着看；
 * - 做完**不替用户换场景**（2026-11-10 用户定）：重拉库状态，已加载节点表会把真被改到的节点标成「有更新可重载」，
 *   人点「重载」才换；
 * - 后端没受理（库被阻断、不在更新范围里）时把后端给的原因显示出来。
 *
 * 未初始化的库（模型按需生成）不走这里：它们现在说不出新旧，等节点模型状态接口。
 */
import { nextTick, watch } from 'vue';

import type { DbnumRow } from '@/api/genModelV1Api';

import { judgeDbnumFreshness } from '@/composables/dbnumFreshness';
import {
  getUpdateToLatestState,
  interpretUpdateReceipt,
  isUpdateToLatestBusy,
  setUpdateToLatestState,
  type UpdateToLatestState,
} from '@/composables/updateToLatestState';
import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import {
  PIPELINE_STAGE_LABEL,
  PIPELINE_STAGES,
  pipelineStageIndex,
  useModelGenerationAdmin,
} from '@/composables/useModelGenerationAdmin';
import { emitToast } from '@/ribbon/toastBus';

const TASK_TERMINAL = new Set(['succeeded', 'partial', 'yielded', 'failed']);
/** 没有任务号可跟时（库本来就在队列里 / 后端自己在写）重拉库状态的间隔，和最多等多久 */
const ROW_FOLLOW_INTERVAL_MS = 5_000;
const ROW_FOLLOW_TIMEOUT_MS = 10 * 60_000;

/** 每个库正在跟的那一次：停表 / 停监听用 */
const followers = new Map<number, () => void>();

function rowOf(dbnum: number): DbnumRow | null {
  return (useGenModelV1Health().state.verdict.rows?.[dbnum] as DbnumRow | undefined) ?? null;
}

function refreshRows(): void {
  void useGenModelV1Health().refreshVerdict();
}

function stopFollowing(dbnum: number): void {
  followers.get(dbnum)?.();
  followers.delete(dbnum);
}

function finish(dbnum: number, phase: 'done' | 'failed', message: string): void {
  // 监听回调里不能直接停自己（第一次同步触发时句柄还没拿到）：挪到微任务里
  queueMicrotask(() => stopFollowing(dbnum));
  if (phase === 'failed') {
    setUpdateToLatestState(dbnum, { phase, message });
    refreshRows();
    emitToast({ message: `[警告] 库 ${dbnum} 更新到最新没有完成：${message}`, level: 'warning' });
    return;
  }
  // 做完先重拉库状态：已加载节点表据此重查「这个节点是不是真被改到」。重拉回来之前按钮仍是「更新中」——
  // 这一小段里行上还是「落后 + 更新」，放开了会被再点一次
  setUpdateToLatestState(dbnum, { phase: 'running', message: '后端已更新完，正在核对哪些节点被改到…' });
  void useGenModelV1Health().refreshVerdict().then(() => nextTick()).then(() => {
    setUpdateToLatestState(dbnum, { phase: 'done', message });
    emitToast({ message: `[成功] 库 ${dbnum} ${message}`, level: 'success' });
  });
}

const DONE_TEXT = '更新完成；真被改到的节点会标出「重载」，点了才换到场景里';

/** 有任务号：跟着「模型生成」面板的任务表走（任务流实时 + 2 秒轮询兜底，都在那边）。 */
function followTasks(dbnum: number, taskIds: string[]): void {
  const admin = useModelGenerationAdmin();
  const stop = watch(
    () => taskIds
      .map((id) => {
        const task = admin.tasks.value.get(id);
        return task ? [task.state, task.currentStage, task.unitsDone, task.totalUnits].join('|') : '';
      })
      .join(','),
    () => {
      const tasks = taskIds.map((id) => admin.tasks.value.get(id));
      if (tasks.some((task) => !task)) return;
      const known = tasks.map((task) => task!);
      if (known.every((task) => TASK_TERMINAL.has(task.state))) {
        const failed = known.find((task) => task.state === 'failed');
        if (failed) {
          finish(dbnum, 'failed', `批次失败${failed.lastUnitFailure ? `：${failed.lastUnitFailure}` : ''}（明细在「模型生成」面板）`);
        } else if (known.some((task) => task.state === 'yielded')) {
          finish(dbnum, 'failed', '批次被后端让出，没有跑完；稍后再点「更新」');
        } else if (known.some((task) => task.state === 'partial')) {
          finish(dbnum, 'done', `${DONE_TEXT}。有单元生成失败，明细在「模型生成」面板`);
        } else {
          finish(dbnum, 'done', DONE_TEXT);
        }
        return;
      }
      const running = known.find((task) => task.state === 'running');
      if (!running) return;
      // `current_stage` 是细粒度阶段名（data_parse / model_generate / commit …）：归到面板那五段的叫法上
      const bucket = PIPELINE_STAGES[pipelineStageIndex(running.currentStage)];
      const stage = bucket ? PIPELINE_STAGE_LABEL[bucket] ?? bucket : '运行中';
      const units = running.totalUnits ? ` ${running.unitsDone ?? 0}/${running.totalUnits}` : '';
      setUpdateToLatestState(dbnum, { phase: 'running', message: `${stage}${units}` });
    },
    { immediate: true },
  );
  followers.set(dbnum, stop);
}

/**
 * 没有任务号：跟着库的水位看。`untilSettled` = 等后端写完（库状态不再是更新中）；否则等模型水位比发起时前进。
 * 期间隔几秒重拉一次 `/dbnums`；十分钟没等到就不再等。
 */
function followRows(dbnum: number, mode: 'untilSettled' | 'untilModelAdvances'): void {
  const health = useGenModelV1Health();
  const modelAtStart = rowOf(dbnum)?.model_sesno ?? null;
  const settled = (): boolean => {
    const row = rowOf(dbnum);
    if (!row) return false;
    if (judgeDbnumFreshness(row).kind === 'updating') return false;
    if (mode === 'untilSettled') return true;
    return typeof row.model_sesno === 'number' && (modelAtStart === null || row.model_sesno > modelAtStart);
  };
  const stopWatch = watch(() => health.state.verdict.lastCheckedAt, () => {
    if (settled()) finish(dbnum, 'done', DONE_TEXT);
  });
  const poll = setInterval(refreshRows, ROW_FOLLOW_INTERVAL_MS);
  const giveUp = setTimeout(() => {
    finish(dbnum, 'failed', '十分钟没等到后端做完；到「模型生成」面板看这个库的状态');
  }, ROW_FOLLOW_TIMEOUT_MS);
  followers.set(dbnum, () => {
    stopWatch();
    clearInterval(poll);
    clearTimeout(giveUp);
  });
}

/**
 * 让后端把这个库更新到最新。回发起之后的状态（排上了 / 没受理 / 失败）；之后的进度看 `getUpdateToLatestState(dbnum)`。
 * 从不抛错。
 */
export async function requestUpdateToLatest(dbnum: number): Promise<UpdateToLatestState> {
  const current = getUpdateToLatestState(dbnum);
  if (current && isUpdateToLatestBusy(current)) return current;
  stopFollowing(dbnum);

  const row = rowOf(dbnum);
  if (row && judgeDbnumFreshness(row).kind === 'updating') {
    // 后端已经在写这个库：不再发请求，只跟着看
    const state = setUpdateToLatestState(dbnum, { phase: 'running', message: '后端正在更新这个库，做完会提示', taskIds: [] });
    followRows(dbnum, 'untilSettled');
    return state;
  }

  setUpdateToLatestState(dbnum, { phase: 'requesting', message: '正在请求后端…', taskIds: [] });
  let outcome: ReturnType<typeof interpretUpdateReceipt>;
  try {
    outcome = interpretUpdateReceipt(dbnum, await useModelGenerationAdmin().executeUpdate([dbnum]));
  } catch (error) {
    const message = `更新请求失败：${error instanceof Error ? error.message : String(error)}`;
    emitToast({ message: `[警告] 库 ${dbnum} ${message}`, level: 'warning' });
    return setUpdateToLatestState(dbnum, { phase: 'failed', message });
  }
  const state = setUpdateToLatestState(dbnum, outcome);
  if (outcome.phase === 'queued') {
    if (outcome.taskIds.length > 0) followTasks(dbnum, outcome.taskIds);
    else followRows(dbnum, 'untilModelAdvances');
  } else if (outcome.phase === 'up_to_date') {
    refreshRows();
    emitToast({ message: `[提示] 库 ${dbnum}：${outcome.message}`, level: 'info' });
  } else {
    emitToast({ message: `[警告] 库 ${dbnum} 更新到最新：${outcome.message}`, level: 'warning' });
  }
  // 跟任务的那一路第一次同步触发时可能已经改过状态（任务已在跑 / 已结束）：回最新的
  return getUpdateToLatestState(dbnum) ?? state;
}
