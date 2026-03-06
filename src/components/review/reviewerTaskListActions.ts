type RefreshReviewerTasksOptions = {
  loadReviewTasks: () => Promise<void>;
  setLoading: (loading: boolean) => void;
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
