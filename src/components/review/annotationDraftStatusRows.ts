import type { DraftSaveStatus } from '@/composables/useAnnotationDraftSession';

/**
 * 三行状态的文案与语气（交互方案 2026-09-14 §3.6 / 计划 §3 U0「状态三行『本机草稿 / 已确认到修订 N / 处理状态』分开显示」，
 * 决策 d-565 #4「云端 ACK 才叫已保存」）。
 *
 * - **本机**：来自草稿会话（`useToolStore.annotationDraftJournal` → `useAnnotationDraftSession`）：内容变了写进去没有、写失败了没有。
 *   「未落库」只在与最近确认记录不一致时加——本机存的东西已经全部确认过了，就只说「本机已存」。
 * - **云端草稿**：U3 之前 `capability = 'unavailable'`，这一行**不显示**，不假装有云端草稿。
 * - **已确认**：按内容比（面板的 `hasUnsavedChanges` = 当前 payload key ≠ 最近确认 payload key），与「确认当前数据」按钮同一口径；
 *   「修订 N」在 U3 之前 = 本任务确认记录条数（每次确认落一条记录 = 一次修订），U3 后换成服务端 `record_revision`。
 *
 * 逐条批注的处理状态（fixed / agree / reject）仍在各自卡片上，不进这三行。
 */

export type DraftStatusTone = 'neutral' | 'ok' | 'warn' | 'danger';

export type DraftStatusRowId = 'local' | 'remote' | 'confirmed';

export type DraftStatusRow = {
  id: DraftStatusRowId;
  /** 机器可读的状态名（测试 / data-state 用） */
  state: string;
  label: string;
  detail: string | null;
  tone: DraftStatusTone;
};

export type AnnotationDraftStatusRowsInput = {
  status: DraftSaveStatus;
  /** 当前 scope 里四类批注合计 */
  draftCount: number;
  /** 当前数据与最近确认记录按内容比不一致 */
  hasUnconfirmedChanges: boolean;
  /** 本任务的确认记录条数（= U3 之前的「修订 N」） */
  confirmedRecordCount: number;
  lastConfirmedAt: number | null;
  localWriteError?: string | null;
  formatTime?: (timestamp: number) => string;
};

export function defaultFormatStatusTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function buildAnnotationDraftStatusRows(input: AnnotationDraftStatusRowsInput): DraftStatusRow[] {
  const rows: DraftStatusRow[] = [buildLocalRow(input)];
  const remote = buildRemoteRow(input.status);
  if (remote) rows.push(remote);
  rows.push(buildConfirmedRow(input));
  return rows;
}

function buildLocalRow(input: AnnotationDraftStatusRowsInput): DraftStatusRow {
  const { status } = input;
  if (status.local === 'write-failed') {
    return {
      id: 'local',
      state: 'write-failed',
      label: '本机写入失败',
      detail: input.localWriteError?.trim() || '本机存储写不进去，草稿只在内存里，刷新会丢',
      tone: 'danger',
    };
  }
  if (status.local === 'unsaved') {
    return { id: 'local', state: 'unsaved', label: '本机 · 未存', detail: null, tone: 'warn' };
  }
  if (input.draftCount === 0 && !input.hasUnconfirmedChanges) {
    return { id: 'local', state: 'empty', label: '本机 · 无草稿', detail: null, tone: 'neutral' };
  }
  if (input.hasUnconfirmedChanges) {
    return {
      id: 'local',
      state: 'saved-unconfirmed',
      label: '本机已存 · 未落库',
      detail: '只在这台电脑的浏览器里，确认当前数据后才进服务端',
      tone: 'warn',
    };
  }
  return { id: 'local', state: 'saved', label: '本机已存', detail: null, tone: 'ok' };
}

function buildRemoteRow(status: DraftSaveStatus): DraftStatusRow | null {
  if (status.labels.remote === null) return null;
  const tone: DraftStatusTone = status.remote === 'saved'
    ? 'ok'
    : status.remote === 'failed'
      ? 'danger'
      : status.remote === 'saving'
        ? 'neutral'
        : 'warn';
  return { id: 'remote', state: status.remote, label: status.labels.remote, detail: null, tone };
}

function buildConfirmedRow(input: AnnotationDraftStatusRowsInput): DraftStatusRow {
  const format = input.formatTime ?? defaultFormatStatusTime;
  if (input.confirmedRecordCount <= 0) {
    return input.hasUnconfirmedChanges
      ? { id: 'confirmed', state: 'never-pending', label: '未确认 · 有待确认内容', detail: null, tone: 'warn' }
      : { id: 'confirmed', state: 'never', label: '未确认', detail: null, tone: 'neutral' };
  }
  const when = input.lastConfirmedAt !== null ? format(input.lastConfirmedAt) : '';
  const base = `已确认到修订 ${input.confirmedRecordCount}`;
  const detail = when ? `最近 ${when}` : null;
  return input.hasUnconfirmedChanges
    ? { id: 'confirmed', state: 'has-unconfirmed-changes', label: `${base} · 有未确认修改`, detail, tone: 'warn' }
    : { id: 'confirmed', state: 'up-to-date', label: base, detail, tone: 'ok' };
}
