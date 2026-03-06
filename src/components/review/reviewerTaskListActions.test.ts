import { describe, expect, it, vi } from 'vitest';

import { refreshReviewerTasksSafely } from './reviewerTaskListActions';

describe('reviewerTaskListActions', () => {
  it('refreshReviewerTasksSafely 应调用后端刷新并正确切换 loading', async () => {
    const loadingTrace: boolean[] = [];
    const loadReviewTasks = vi.fn(async () => {});

    await refreshReviewerTasksSafely({
      loadReviewTasks,
      setLoading: (loading) => {
        loadingTrace.push(loading);
      },
    });

    expect(loadReviewTasks).toHaveBeenCalledTimes(1);
    expect(loadingTrace).toEqual([true, false]);
  });

  it('refreshReviewerTasksSafely 刷新失败时也应关闭 loading', async () => {
    const loadingTrace: boolean[] = [];
    const loadReviewTasks = vi.fn(async () => {
      throw new Error('refresh failed');
    });

    await expect(
      refreshReviewerTasksSafely({
        loadReviewTasks,
        setLoading: (loading) => {
          loadingTrace.push(loading);
        },
      })
    ).rejects.toThrow('refresh failed');

    expect(loadingTrace).toEqual([true, false]);
  });
});
