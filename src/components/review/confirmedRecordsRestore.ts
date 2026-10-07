import { computed, ref } from 'vue';

import { isReviewModelContext, reviewModelContextKey, type ReviewModelContext } from './reviewModelContext';
import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

import type { ReviewClearanceSnapshot } from './reviewClearanceSnapshot';
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
  ensureModelContext?: (context: ReviewModelContext, shouldApply: () => boolean) => Promise<void>;
  prepareClearanceRestore?: (snapshot: ReviewClearanceSnapshot, context: ReviewModelContext) => () => void;
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
  return `${scope}:${JSON.stringify(records.map(r => [r.id, r.confirmedAt, r.recordRevision,
    r.modelContext ? (isReviewModelContext(r.modelContext) ? reviewModelContextKey(r.modelContext) : r.modelContext) : null,
    r.clearanceSnapshot ?? null]))}`;
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
  const restoreError = ref<string | null>(null);
  const restoring = ref(false);
  let requestSequence = 0;

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
    const request = ++requestSequence;
    const taskId = options.currentTaskId();
    const formId = options.currentFormId?.()?.trim() || null;
    const records = currentTaskRecords.value;
    const restoreKey = buildSceneKey(taskId, formId, records);
    if (!force && lastRestoredSceneKey.value === restoreKey) {
      restoring.value = false;
      restoreError.value = null;
      return;
    }
    const shouldApply = () => request === requestSequence
      && options.currentTaskId() === taskId
      && (options.currentFormId?.()?.trim() || null) === formId
      && buildSceneKey(taskId, formId, currentTaskRecords.value) === restoreKey;
    restoring.value = true;
    restoreError.value = null;
    try {

      const viewerReady = await options.waitForViewerReady({ timeoutMs: 4000 });
      const tools = options.getViewerTools();
      if (!viewerReady || !tools) return;
      // 任务可能在等待 viewer 期间变了
      if (!shouldApply()) return;

      const contexts = records.flatMap(record => record.modelContext ? [record.modelContext] : []);
      if (contexts.some(context => !isReviewModelContext(context) || context.taskId !== taskId
      || (formId !== null && context.formId !== formId))) throw new Error('确认记录的模型版本上下文无效，请核对任务和单据');
      // 不把多个历史模型上的坐标合并导入同一个场景；旧记录没有上下文时也不能猜它属于某一版本。
      if (contexts.length > 0) {
        if (contexts.length !== records.length || new Set(contexts.map(context => reviewModelContextKey({ ...context, node: 'sj' }))).size !== 1)
          throw new Error('确认记录包含不同模型版本或缺少版本信息，请按版本分别查看');
        if (!options.ensureModelContext) throw new Error('模型版本恢复入口尚未就绪，已停止标注回放');
        await options.ensureModelContext(contexts[0]!, shouldApply);
        if (!shouldApply()) return;
      }

      const layered = isLayeredDraftsActive();
      const latestClearance = [...records].reverse().find(record => record.clearanceSnapshot)?.clearanceSnapshot;
      let applyClearance: (() => void) | undefined;
      if (latestClearance) {
        if (!contexts[0] || !options.prepareClearanceRestore) throw new Error('净距恢复入口或模型版本信息缺失，已停止回放');
        applyClearance = options.prepareClearanceRestore(latestClearance, contexts[0]);
      }

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
      applyClearance?.();
      tools.syncFromStore();
      lastRestoredSceneKey.value = restoreKey;
    } catch (error) {
      if (shouldApply()) restoreError.value = error instanceof Error ? error.message : '确认记录恢复失败';
    } finally {
      if (request === requestSequence) restoring.value = false;
    }
  }

  return {
    lastRestoredSceneKey,
    currentTaskRecords,
    restoreError,
    restoring,
    cancelPendingRestore: () => { requestSequence += 1; restoring.value = false; },
    restoreConfirmedRecordsIntoScene,
  };
}
