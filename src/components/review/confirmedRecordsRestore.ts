import { computed, ref } from 'vue';

import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

import type { ConfirmedRecord } from '@/composables/useReviewStore';

import { buildSnapshotFromTaskRecords } from '@/review/adapters/reviewRecordAdapter';
import { runTaskRecordsShadow } from '@/review/services/reviewSnapshotService';
import {
  getReviewCommentEventLog,
  getReviewCommentThreadStore,
  isReviewCommentThreadStoreActive,
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
  confirmedRecords: () => ConfirmedRecordEntry[];
  toolStore: ToolStoreForRestore;
  waitForViewerReady: (options?: { timeoutMs?: number }) => Promise<boolean>;
  getViewerTools: () => ViewerToolsHandle | null;
  /** 设为 true 时，空记录不会 clearAll (避免覆盖外部快照已恢复的数据) */
  skipClearOnEmpty?: boolean;
};

function buildSceneKey(taskId: string | null, records: ConfirmedRecordEntry[]): string {
  if (!taskId) return '__no-task__';
  if (records.length === 0) return `${taskId}:empty`;
  return `${taskId}:${records.map((r) => `${r.id}:${r.confirmedAt}`).join('|')}`;
}

function buildReplayPayload(records: ConfirmedRecordEntry[]): string {
  return buildReviewRecordReplayPayload(records);
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
    if (!taskId) return [];
    return options.confirmedRecords()
      .filter((r) => (r.taskId || '') === taskId)
      .slice()
      .sort((a, b) => a.confirmedAt - b.confirmedAt);
  });

  async function restoreConfirmedRecordsIntoScene(force = false): Promise<void> {
    const taskId = options.currentTaskId();
    const records = currentTaskRecords.value;
    const restoreKey = buildSceneKey(taskId, records);
    if (!force && lastRestoredSceneKey.value === restoreKey) return;

    const viewerReady = await options.waitForViewerReady({ timeoutMs: 4000 });
    const tools = options.getViewerTools();
    if (!viewerReady || !tools) return;
    // 任务可能在等待 viewer 期间变了
    if (options.currentTaskId() !== taskId) return;

    if (!taskId || records.length === 0) {
      const shouldClear =
        !options.skipClearOnEmpty
        || (lastRestoredSceneKey.value !== null && lastRestoredSceneKey.value !== restoreKey);

      if (shouldClear) {
        options.toolStore.clearAll();
        tools.syncFromStore();
        if (isReviewCommentThreadStoreActive()) {
          const cleared = getReviewCommentThreadStore().clear();
          if (cleared.changed) {
            getReviewCommentEventLog().push({
              kind: 'thread_clear',
              key: 'task_records',
              payload: { taskId: taskId ?? null },
            });
          }
        }
      }
      lastRestoredSceneKey.value = restoreKey;
      return;
    }

    const legacyPayload = buildReplayPayload(records);
    const shadowResult = runTaskRecordsShadow({
      legacyPayload,
      records,
      build: { taskId: taskId ?? undefined },
    });

    if (isReviewCommentThreadStoreActive()) {
      try {
        const snapshot = shadowResult?.snapshot
          ?? buildSnapshotFromTaskRecords(records, { taskId: taskId ?? undefined });
        const merge = getReviewCommentThreadStore().mergeFromSnapshot(snapshot);
        if (merge.changed) {
          getReviewCommentEventLog().push({
            kind: 'snapshot_merged',
            key: 'task_records',
            payload: {
              taskId: taskId ?? null,
              comments: snapshot.comments.length,
              annotations: snapshot.annotations.length,
            },
          });
        }
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[review/M3 thread store] task_records merge failed', err);
        }
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
