type RefreshReviewerTasksOptions = {
  loadReviewTasks: () => Promise<void>;
  setLoading: (loading: boolean) => void;
};

import type { ReviewTask } from '@/types/auth';

export type StartReviewerTaskOptions = {
  task: ReviewTask;
  setCurrentTask: (task: ReviewTask) => Promise<void>;
  emitCommand: (command: string) => void;
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
  await options.setCurrentTask(options.task);
  options.onTaskSelected?.(options.task);
  options.emitCommand('panel.reviewerTasks');

  const scheduleOpenReviewPanel = options.scheduleOpenReviewPanel ?? ((callback) => {
    setTimeout(callback, 100);
  });

  scheduleOpenReviewPanel(() => {
    options.emitCommand('panel.review');
  });
}
