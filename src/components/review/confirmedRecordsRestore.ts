import { computed, ref } from 'vue';

import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

import type { ConfirmedRecord } from '@/composables/useReviewStore';

import { isAnnotationUxFlagEnabled } from '@/composables/useAnnotationUxFlags';
import { buildSnapshotFromTaskRecords } from '@/review/adapters/reviewRecordAdapter';
import { mergeConfirmedReplayWithLocalDrafts } from '@/review/domain/draftLayerMerge';
import {
  getReviewCommentEventLog,
  getReviewCommentThreadStore,
} from '@/review/services/sharedStores';

type ConfirmedRecordEntry = ConfirmedRecord;

type ToolStoreForRestore = {
  clearAll: () => void;
  importJSON: (payload: string) => void;
  /** U0 分层恢复要读当前内存（scope 容器）内容；没有就退回整份替换 */
  exportJSON?: () => string;
  /** U0：当前草稿 scope，null = 不在校审任务上下文（走旧的整份替换） */
  getAnnotationDraftScope?: () => unknown;
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
  /**
   * U0 草稿 / 已确认分层（方案 §3.6，d-565）：true 时恢复不再整份替换——已确认层按 id 覆盖、本机草稿保留，
   * 空记录也不 `clearAll`（容器已按 scope 切好，内存里就是本任务自己的草稿）。
   * 缺省判定：开关 `annotationUx.scopedDraftsV1` 开 + store 有草稿 scope + store 能 `exportJSON`。
   */
  layeredDrafts?: () => boolean;
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
/** U0 分层恢复是否生效：开关开 + store 有草稿 scope + store 能导出当前内存 */
export function isLayeredDraftRestoreActive(store: ToolStoreForRestore): boolean {
  if (typeof store.exportJSON !== 'function' || typeof store.getAnnotationDraftScope !== 'function') return false;
  if (!isAnnotationUxFlagEnabled('scopedDraftsV1')) return false;
  return store.getAnnotationDraftScope() != null;
}

function readLocalPayload(store: ToolStoreForRestore): string | null {
  try {
    return store.exportJSON?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * 给别的确认回放入口（embed 快照刷新等）复用：分层生效就把已确认回放与本机草稿合并，否则原样返回。
 * 返回值直接喂 `importJSON`。
 */
export function layerConfirmedReplayForStore(store: ToolStoreForRestore, confirmedPayload: string): string {
  if (!isLayeredDraftRestoreActive(store)) return confirmedPayload;
  return mergeConfirmedReplayWithLocalDrafts(confirmedPayload, readLocalPayload(store)).payload;
}

export function createConfirmedRecordsRestorer(options: ConfirmedRecordsRestoreOptions) {
  const lastRestoredSceneKey = ref<string | null>(null);

  function isLayeredDraftsActive(): boolean {
    if (options.layeredDrafts) return options.layeredDrafts();
    return isLayeredDraftRestoreActive(options.toolStore);
  }

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

    const layered = isLayeredDraftsActive();

    if (!taskId || records.length === 0) {
      const shouldClear =
        !options.skipClearOnEmpty
        || (lastRestoredSceneKey.value !== null && lastRestoredSceneKey.value !== restoreKey);

      if (shouldClear) {
        // U0 分层：草稿是数据边界——容器已按 scope 切好，内存里就是本任务自己的本机草稿，不再 clearAll 抹掉；
        // 评论线程跟着确认记录走，照旧清。
        if (!layered) options.toolStore.clearAll();
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

    try {
      const snapshot = buildSnapshotFromTaskRecords(records, buildContext);
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

    // U0 分层：已确认层按 id 覆盖，本机草稿（id 不在已确认层）保留；不分层就是旧的整份替换
    options.toolStore.importJSON(
      layered ? mergeConfirmedReplayWithLocalDrafts(legacyPayload, readLocalPayload(options.toolStore)).payload : legacyPayload,
    );
    tools.syncFromStore();
    lastRestoredSceneKey.value = restoreKey;
  }

  return {
    lastRestoredSceneKey,
    currentTaskRecords,
    restoreConfirmedRecordsIntoScene,
  };
}
