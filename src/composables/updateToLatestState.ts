/**
 * 「更新到最新」的状态（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C3；CONTEXT「更新到最新」）：
 * 每个库一格，记这个页面发起的那一次更新走到哪了。模型树的行读它来画「更新 / 更新中」按钮。
 *
 * 这里只有状态、回执的解读和画法，不发请求——发请求、跟任务在 `useUpdateToLatest.ts`（它要引用整套「模型生成」面板的
 * 任务跟踪，行组件不该为了画一个按钮把那些都带进来）。
 */
import { reactive } from 'vue';

import type { UpdateExecuteReceipt } from '@/api/genModelV1AdminApi';

/**
 * - `requesting`：请求刚发出去；
 * - `queued`：后端排上了（或这个库本来就在队列里）；
 * - `running`：批次在跑；
 * - `done`：跑完了（库的水位会前进；场景里要点「重载」才换）；
 * - `up_to_date`：后端说没什么可更新的；
 * - `rejected`：后端没有受理（库被阻断、不在更新范围里……），原因在 `message`；
 * - `failed`：请求失败，或批次失败。
 */
export type UpdateToLatestPhase = 'requesting' | 'queued' | 'running' | 'done' | 'up_to_date' | 'rejected' | 'failed';

export type UpdateToLatestState = {
  dbnum: number;
  phase: UpdateToLatestPhase;
  /** 给人看的一句话：进度，或没成的原因 */
  message: string;
  /** 跟着看的任务号；没有任务号（库本来就在队列里、读透形态）时为空 */
  taskIds: string[];
  startedAt: number;
  finishedAt: number | null;
};

const states = reactive(new Map<number, UpdateToLatestState>());

export function isUpdateToLatestBusy(state: UpdateToLatestState | null | undefined): boolean {
  return !!state && (state.phase === 'requesting' || state.phase === 'queued' || state.phase === 'running');
}

export function getUpdateToLatestState(dbnum: number): UpdateToLatestState | null {
  return states.get(dbnum) ?? null;
}

export function setUpdateToLatestState(
  dbnum: number,
  next: { phase: UpdateToLatestPhase; message: string; taskIds?: string[] },
  now = Date.now(),
): UpdateToLatestState {
  const previous = states.get(dbnum);
  const continuing = isUpdateToLatestBusy(previous);
  const state: UpdateToLatestState = {
    dbnum,
    phase: next.phase,
    message: next.message,
    taskIds: next.taskIds ?? previous?.taskIds ?? [],
    startedAt: continuing ? previous!.startedAt : now,
    finishedAt: next.phase === 'requesting' || next.phase === 'queued' || next.phase === 'running' ? null : now,
  };
  states.set(dbnum, state);
  return states.get(dbnum)!;
}

export function clearUpdateToLatestState(dbnum: number): void {
  states.delete(dbnum);
}

/** 行上的按钮：`busy` 时写「更新中」并禁用；提示里是进度或上一次的结果。没发起过回 `null`。 */
export function updateToLatestView(dbnum: number): { busy: boolean; label: string; title: string } | null {
  const state = states.get(dbnum);
  if (!state) return null;
  const busy = isUpdateToLatestBusy(state);
  return {
    busy,
    label: busy ? '更新中' : '更新',
    title: busy ? `库 ${dbnum} 更新到最新：${state.message}` : `库 ${dbnum} 上一次更新到最新：${state.message}`,
  };
}

/**
 * `POST /api/v1/update/execute { dbnums: [库] }` 的回执对这一个库意味着什么（纯函数）。
 * 排上了回任务号；没受理把后端给的原因带出来，不假装排上了。
 */
export function interpretUpdateReceipt(
  dbnum: number,
  receipt: UpdateExecuteReceipt,
): { phase: 'queued' | 'up_to_date' | 'rejected'; taskIds: string[]; message: string } {
  const batches = [...(receipt.enqueued ?? []), ...(receipt.merged ?? [])].filter((batch) => batch.dbnum === dbnum);
  if (batches.length > 0) {
    const [first] = batches;
    const span = typeof first?.start_sesno === 'number' && typeof first?.end_sesno === 'number'
      ? `：会话 ${first.start_sesno}→${first.end_sesno}`
      : '';
    return { phase: 'queued', taskIds: batches.map((batch) => batch.task_id).filter(Boolean), message: `已排队${span}` };
  }
  const blocked = (receipt.blocked ?? []).find((item) => item.dbnum === dbnum);
  if (blocked) return { phase: 'rejected', taskIds: [], message: `后端拒绝：${blocked.reason}` };
  if ((receipt.already_covered ?? []).includes(dbnum)) {
    return { phase: 'queued', taskIds: [], message: '这个库已经在后端的队列里，做完会提示' };
  }
  if (typeof receipt.status === 'string' && receipt.status !== '') {
    if (receipt.status === 'up_to_date') return { phase: 'up_to_date', taskIds: [], message: '后端说这个库已经是最新' };
    return {
      phase: 'queued',
      taskIds: [],
      message: receipt.status === 'model_refresh_queued' ? '已排队模型刷新，做完会提示' : `后端回执：${receipt.status}`,
    };
  }
  const named = new RegExp(`dbnum\\s*=\\s*${dbnum}(?!\\d)`);
  const warning = (receipt.warnings ?? []).find((text) => named.test(String(text)));
  if (warning) return { phase: 'rejected', taskIds: [], message: `后端没有受理：${warning}` };
  if ((receipt.up_to_date ?? 0) > 0) return { phase: 'up_to_date', taskIds: [], message: '后端说这个库已经是最新' };
  return { phase: 'rejected', taskIds: [], message: '后端没有为这个库排任何批次' };
}

/** 测试用。 */
export function __resetUpdateToLatestStateForTests(): void {
  states.clear();
}
