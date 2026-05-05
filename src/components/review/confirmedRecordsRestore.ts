import { computed, ref } from 'vue';

import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

import type { ConfirmedRecord } from '@/composables/useReviewStore';

import { buildSnapshotFromTaskRecords } from '@/review/adapters/reviewRecordAdapter';
import { runTaskRecordsShadow } from '@/review/services/reviewSnapshotService';
import {
  getReviewCommentEventLog,
  getReviewCommentThreadStore,
} from '@/review/services/sharedStores';

type ConfirmedRecordEntry = ConfirmedRecord;

type ToolStoreForRestore = {
  clearAll: () => void;
  importJSON: (payload: string) => void;
};

type ViewerToolsHandle = {
  syncFromStore: () => void;
};

export type ConfirmedRecordsRestoreOptions = {
  currentTaskId: () => string | null;
  currentFormId?: () => string | null;
  confirmedRecords: () => ConfirmedRecordEntry[];
  toolStore: ToolStoreForRestore;
  waitForViewerReady: (options?: { timeoutMs?: number }) => Promise<boolean>;
  getViewerTools: () => ViewerToolsHandle | null;
  /** 设为 true 时，空记录不会 clearAll (避免覆盖外部快照已恢复的数据) */
  skipClearOnEmpty?: boolean;
};

function buildSceneKey(
  taskId: string | null,
  formId: string | null,
  records: ConfirmedRecordEntry[],
): string {
  if (!taskId) return '__no-task__';
  const scope = formId ? `${taskId}@${formId}` : taskId;
  if (records.length === 0) return `${scope}:empty`;
  return `${scope}:${records.map((r) => `${r.id}:${r.confirmedAt}`).join('|')}`;
}

function buildReplayPayload(
  records: ConfirmedRecordEntry[],
  context: { taskId?: string; formId?: string },
): string {
  return buildReviewRecordReplayPayload(records, context);
}

/**
 * 创建一个可复用的确认记录场景恢复器。
 *
 * 返回值中包含：
 * - `restoreConfirmedRecordsIntoScene(force?)`: 手动触发一次恢复
 * - `watchSource`: 一个自动 watch，当 taskId / records / viewer 就绪变化时自动恢复
 *
 * 调用方只需把返回的 `stopWatch` 在 onUnmounted 时调用即可。
 */
export function createConfirmedRecordsRestorer(options: ConfirmedRecordsRestoreOptions) {
  const lastRestoredSceneKey = ref<string | null>(null);

  const currentTaskRecords = computed<ConfirmedRecordEntry[]>(() => {
    const taskId = options.currentTaskId();
    const formId = options.currentFormId?.();
    if (!taskId) return [];
    return options.confirmedRecords()
      .filter((r) => {
        if ((r.taskId || '') !== taskId) return false;
        if (!formId) return true;
        const recordFormId = r.formId?.trim();
        return !recordFormId || recordFormId === formId;
      })
      .slice()
      .sort((a, b) => a.confirmedAt - b.confirmedAt);
  });

  async function restoreConfirmedRecordsIntoScene(force = false): Promise<void> {
    const taskId = options.currentTaskId();
    const formId = options.currentFormId?.()?.trim() || null;
    const records = currentTaskRecords.value;
    const restoreKey = buildSceneKey(taskId, formId, records);
    if (!force && lastRestoredSceneKey.value === restoreKey) return;

    const viewerReady = await options.waitForViewerReady({ timeoutMs: 4000 });
    const tools = options.getViewerTools();
    if (!viewerReady || !tools) return;
    // 任务可能在等待 viewer 期间变了
    if (options.currentTaskId() !== taskId) return;
    if ((options.currentFormId?.()?.trim() || null) !== formId) return;

    if (!taskId || records.length === 0) {
      const shouldClear =
        !options.skipClearOnEmpty
        || (lastRestoredSceneKey.value !== null && lastRestoredSceneKey.value !== restoreKey);

      if (shouldClear) {
        options.toolStore.clearAll();
        tools.syncFromStore();
        const cleared = getReviewCommentThreadStore().clear();
        if (cleared.changed) {
          getReviewCommentEventLog().push({
            kind: 'thread_clear',
            key: 'task_records',
            payload: { taskId: taskId ?? null, formId },
          });
        }
      }
      lastRestoredSceneKey.value = restoreKey;
      return;
    }

    const buildContext = {
      taskId: taskId ?? undefined,
      formId: formId ?? undefined,
    };
    const legacyPayload = buildReplayPayload(records, buildContext);
    const shadowResult = runTaskRecordsShadow({
      legacyPayload,
      records,
      build: buildContext,
    });

    try {
      const snapshot = shadowResult?.snapshot
        ?? buildSnapshotFromTaskRecords(records, buildContext);
      if (snapshot.comments.length > 0) {
        const merge = getReviewCommentThreadStore().mergeFromSnapshot(snapshot);
        if (merge.changed) {
          getReviewCommentEventLog().push({
            kind: 'snapshot_merged',
            key: 'task_records',
            payload: {
              taskId: taskId ?? null,
              formId,
              comments: snapshot.comments.length,
              annotations: snapshot.annotations.length,
            },
          });
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[review thread store] task_records merge failed', err);
      }
    }

    options.toolStore.importJSON(legacyPayload);
    tools.syncFromStore();
    lastRestoredSceneKey.value = restoreKey;
  }

  return {
    lastRestoredSceneKey,
    currentTaskRecords,
    restoreConfirmedRecordsIntoScene,
  };
}
