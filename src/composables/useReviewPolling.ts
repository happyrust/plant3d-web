import { onMounted, onUnmounted, watch } from 'vue';

import type { AnnotationType } from '@/composables/useToolStore';

import { reviewTaskGetById } from '@/api/reviewApi';
import { syncAnnotationReviewStates } from '@/composables/useAnnotationReviewStateSync';
import { refreshCommentThread } from '@/composables/useCommentThread';
import { useReviewStore } from '@/composables/useReviewStore';

/** 校审面板可见时的拉取间隔。后端 annotation-context 到位后改成按修订号驱动。 */
export const REVIEW_POLL_INTERVAL_MS = 15_000;

export type ReviewPollExpandedAnnotation = {
  annotationType: AnnotationType;
  annotationId: string;
  formId?: string | null;
  taskId?: string | null;
};

export type ReviewPollingOptions = {
  /** 当前任务；没有任务就停 */
  taskId: () => string | null | undefined;
  formId: () => string | null | undefined;
  /**
   * 批注状态查询用的 taskId。外部单据按 form 拉时传空。
   * 不传则跟 `taskId` 一样。
   */
  stateTaskId?: () => string | null | undefined;
  expandedAnnotation?: () => ReviewPollExpandedAnnotation | null;
  intervalMs?: number;
};

/**
 * 面板挂着、页面可见、并且有任务时，每 15 秒拉一次任务节点 / 状态 / 退回原因、
 * 批注处理状态，以及当前展开的批注线程。页面隐藏或卸下面板就停。
 */
export function useReviewPolling(options: ReviewPollingOptions): void {
  const reviewStore = useReviewStore();
  const intervalMs = options.intervalMs ?? REVIEW_POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function tick(): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const taskId = options.taskId()?.trim();
    if (!taskId || ticking) return;
    ticking = true;
    try {
      const response = await reviewTaskGetById(taskId);
      if (options.taskId()?.trim() !== taskId) return;
      if (response.success && response.task) {
        reviewStore.applyPolledReviewTask?.({ ...response.task, id: response.task.id || taskId });
      }
      const formId = options.formId()?.trim();
      if (formId) {
        const stateTaskId = options.stateTaskId
          ? options.stateTaskId()?.trim() || undefined
          : taskId;
        await syncAnnotationReviewStates({
          formId,
          taskId: stateTaskId,
          force: true,
          shouldApply: () => options.taskId()?.trim() === taskId,
        });
      }
      const expanded = options.expandedAnnotation?.() ?? null;
      if (expanded?.annotationId?.trim() && expanded.annotationType && options.taskId()?.trim() === taskId) {
        await refreshCommentThread({
          annotationType: expanded.annotationType,
          annotationId: expanded.annotationId,
          formId: expanded.formId,
          taskId: expanded.taskId ?? taskId,
        });
      }
    } catch (error) {
      console.warn('[useReviewPolling] tick failed:', error);
    } finally {
      ticking = false;
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start(): void {
    stop();
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!options.taskId()?.trim()) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') start();
    else stop();
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    start();
  });

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stop();
  });

  watch(() => options.taskId()?.trim() || null, () => {
    start();
  });
}
