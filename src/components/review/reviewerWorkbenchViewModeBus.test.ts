import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearReviewerWorkbenchViewModeRequest,
  requestReviewerWorkbenchViewMode,
  useReviewerWorkbenchViewModeRequest,
} from './reviewerWorkbenchViewModeBus';

describe('reviewerWorkbenchViewModeBus', () => {
  beforeEach(() => {
    clearReviewerWorkbenchViewModeRequest();
  });

  it('request 之后 ref 返回最新 mode', () => {
    const ref = useReviewerWorkbenchViewModeRequest();
    expect(ref.value).toBeNull();

    requestReviewerWorkbenchViewMode('table');

    expect(ref.value).not.toBeNull();
    expect(ref.value?.mode).toBe('table');
    expect(typeof ref.value?.requestedAt).toBe('number');
  });

  it('clear 之后 ref 回到 null', () => {
    requestReviewerWorkbenchViewMode('split');
    expect(useReviewerWorkbenchViewModeRequest().value?.mode).toBe('split');

    clearReviewerWorkbenchViewModeRequest();
    expect(useReviewerWorkbenchViewModeRequest().value).toBeNull();
  });

  it('连续 request 产生新的 requestedAt', async () => {
    requestReviewerWorkbenchViewMode('split');
    const first = useReviewerWorkbenchViewModeRequest().value?.requestedAt ?? 0;

    await new Promise((resolve) => setTimeout(resolve, 5));

    requestReviewerWorkbenchViewMode('table');
    const second = useReviewerWorkbenchViewModeRequest().value?.requestedAt ?? 0;

    expect(second).toBeGreaterThan(first);
    expect(useReviewerWorkbenchViewModeRequest().value?.mode).toBe('table');
  });
});
