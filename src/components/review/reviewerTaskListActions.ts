type RefreshReviewerTasksOptions = {
  loadReviewTasks: () => Promise<void>;
  setLoading: (loading: boolean) => void;
};

import { reviewTaskStartReview } from '@/api/reviewApi';
import type { ReviewTask } from '@/types/auth';

export type StartReviewerTaskOptions = {
  task: ReviewTask;
  setCurrentTask: (task: ReviewTask) => Promise<void>;
  emitCommand: (command: string) => void;
  loadReviewTasks?: () => Promise<void>;
  scheduleOpenReviewPanel?: (callback: () => void) => void;
  onTaskSelected?: (task: ReviewTask) => void;
};

export async function refreshReviewerTasksSafely(
  options: RefreshReviewerTasksOptions
): Promise<void> {
  options.setLoading(true);
  try {
    await options.loadReviewTasks();
  } finally {
    options.setLoading(false);
  }
}

export async function startReviewerTask(options: StartReviewerTaskOptions): Promise<void> {
  let taskToOpen = options.task;

  if (options.task.status === 'submitted') {
    const response = await reviewTaskStartReview(options.task.id);
    if (!response.success) {
      throw new Error(response.error_message || response.message || '开始审核失败');
    }

    taskToOpen = {
      ...options.task,
      status: 'in_review',
      updatedAt: Date.now(),
    };
  }

  await options.loadReviewTasks?.();
  await options.setCurrentTask(taskToOpen);
  options.onTaskSelected?.(taskToOpen);
  options.emitCommand('panel.reviewerTasks');

  const scheduleOpenReviewPanel = options.scheduleOpenReviewPanel ?? ((callback) => {
    setTimeout(callback, 100);
  });

  scheduleOpenReviewPanel(() => {
    options.emitCommand('panel.review');
  });
}
