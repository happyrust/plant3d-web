import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, nextTick, ref } from 'vue';

import { useReviewPolling, type ReviewPollExpandedAnnotation } from './useReviewPolling';

const mocks = vi.hoisted(() => ({
  reviewTaskGetById: vi.fn(),
  syncAnnotationReviewStates: vi.fn(async () => ({ ok: true, appliedCount: 0, totalCount: 0 })),
  refreshCommentThread: vi.fn(async () => undefined),
  applyPolledReviewTask: vi.fn(),
}));

vi.mock('@/api/reviewApi', () => ({
  reviewTaskGetById: mocks.reviewTaskGetById,
}));

vi.mock('@/composables/useAnnotationReviewStateSync', () => ({
  syncAnnotationReviewStates: mocks.syncAnnotationReviewStates,
}));

vi.mock('@/composables/useCommentThread', () => ({
  refreshCommentThread: mocks.refreshCommentThread,
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    applyPolledReviewTask: mocks.applyPolledReviewTask,
  }),
}));

let visibility: DocumentVisibilityState = 'visible';

function mountPolling(expanded: ReviewPollExpandedAnnotation | null = null) {
  const taskId = ref('task-1');
  const expandedRef = ref(expanded);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(defineComponent({
    setup() {
      useReviewPolling({
        taskId: () => taskId.value,
        formId: () => 'FORM-1',
        expandedAnnotation: () => expandedRef.value,
      });
      return { taskId, expandedRef };
    },
    template: '<div />',
  }));
  app.mount(host);
  return { app, taskId, expandedRef };
}

describe('useReviewPolling', () => {
  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    vi.useFakeTimers();
    mocks.reviewTaskGetById.mockReset();
    mocks.reviewTaskGetById.mockResolvedValue({
      success: true,
      task: {
        id: 'task-1',
        currentNode: 'sh',
        status: 'in_review',
        returnReason: '请补充说明',
      },
    });
    mocks.syncAnnotationReviewStates.mockClear();
    mocks.refreshCommentThread.mockClear();
    mocks.applyPolledReviewTask.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('页面可见且有任务时每 15 秒拉任务、批注状态，不刷新未展开的线程', async () => {
    const mounted = mountPolling();
    await nextTick();

    await vi.advanceTimersByTimeAsync(14_999);
    expect(mocks.reviewTaskGetById).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.reviewTaskGetById).toHaveBeenCalledTimes(1);
    expect(mocks.reviewTaskGetById).toHaveBeenCalledWith('task-1');
    expect(mocks.applyPolledReviewTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      currentNode: 'sh',
      status: 'in_review',
      returnReason: '请补充说明',
    }));
    expect(mocks.syncAnnotationReviewStates).toHaveBeenCalledWith(expect.objectContaining({
      formId: 'FORM-1',
      taskId: 'task-1',
      force: true,
    }));
    expect(mocks.refreshCommentThread).not.toHaveBeenCalled();

    mounted.app.unmount();
  });

  it('页面隐藏时停止，重新可见后才继续', async () => {
    visibility = 'hidden';
    const mounted = mountPolling();
    await nextTick();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.reviewTaskGetById).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.reviewTaskGetById).toHaveBeenCalledTimes(1);

    mounted.app.unmount();
  });

  it('展开中的批注顺带刷新评论线程', async () => {
    const mounted = mountPolling({
      annotationType: 'text',
      annotationId: 'anno-1',
      formId: 'FORM-1',
      taskId: 'task-1',
    });
    await nextTick();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.refreshCommentThread).toHaveBeenCalledWith(expect.objectContaining({
      annotationType: 'text',
      annotationId: 'anno-1',
      formId: 'FORM-1',
      taskId: 'task-1',
    }));

    mounted.app.unmount();
  });
});
