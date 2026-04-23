import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearDesignerCommentViewModeRequest,
  requestDesignerCommentViewMode,
  useDesignerCommentViewModeRequest,
} from './designerCommentViewModeBus';

describe('designerCommentViewModeBus', () => {
  beforeEach(() => {
    clearDesignerCommentViewModeRequest();
  });

  it('request 之后 ref 返回最新 mode', () => {
    const ref = useDesignerCommentViewModeRequest();
    expect(ref.value).toBeNull();

    requestDesignerCommentViewMode('table');

    expect(ref.value).not.toBeNull();
    expect(ref.value?.mode).toBe('table');
    expect(typeof ref.value?.requestedAt).toBe('number');
  });

  it('clear 之后 ref 回到 null', () => {
    requestDesignerCommentViewMode('split');
    expect(useDesignerCommentViewModeRequest().value?.mode).toBe('split');

    clearDesignerCommentViewModeRequest();
    expect(useDesignerCommentViewModeRequest().value).toBeNull();
  });

  it('连续 request 产生新的 requestedAt', async () => {
    requestDesignerCommentViewMode('split');
    const first = useDesignerCommentViewModeRequest().value?.requestedAt ?? 0;

    await new Promise((resolve) => setTimeout(resolve, 5));

    requestDesignerCommentViewMode('table');
    const second = useDesignerCommentViewModeRequest().value?.requestedAt ?? 0;

    expect(second).toBeGreaterThan(first);
    expect(useDesignerCommentViewModeRequest().value?.mode).toBe('table');
  });
});
