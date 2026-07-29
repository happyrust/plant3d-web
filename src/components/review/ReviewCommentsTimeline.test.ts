import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import { UserRole, type AnnotationComment } from '@/types/auth';

const backendComments = ref<AnnotationComment[]>([]);
const commentState = ref<Record<string, AnnotationComment[]>>({});
const reviewState = ref<unknown>(undefined);
const currentUser = ref({ id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER });
let commentAddedCallback: ((data: unknown) => void) | null = null;

const annotationReviewStateApplyMock = vi.fn(async () => ({ success: true }));
const reviewCommentGetByAnnotationMock = vi.fn(async () => ({
  success: true,
  comments: backendComments.value,
}));
const reviewCommentUpdateMock = vi.fn(async () => ({ success: true }));
const reviewCommentCreateMock = vi.fn(async () => ({
  success: true,
  comment: undefined as unknown,
}));
const updateAnnotationCommentMock = vi.fn();
const addCommentToAnnotationMock = vi.fn();
const applyAnnotationReviewActionMock = vi.fn(() => ({
  resolutionStatus: 'fixed',
  decisionStatus: 'pending',
  updatedAt: 1710000000000,
  history: [],
}));
const setAnnotationReviewStateMock = vi.fn((type: string, id: string, state: unknown) => {
  reviewState.value = state;
  return true;
});
const emitToastMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  annotationReviewStateApply: (...args: unknown[]) => annotationReviewStateApplyMock(...args),
  annotationReviewStatesQuery: vi.fn(async () => ({ success: true, states: [] })),
  normalizeAnnotationReviewStateView: (view: Record<string, unknown>) => ({
    resolutionStatus: view.resolutionStatus,
    decisionStatus: view.decisionStatus,
    note: view.note,
    updatedAt: view.updatedAt,
    updatedById: view.updatedById,
    updatedByName: view.updatedByName,
    updatedByRole: view.updatedByRole,
    history: Array.isArray(view.history) ? view.history : [],
  }),
  reviewCommentGetByAnnotation: (...args: unknown[]) => reviewCommentGetByAnnotationMock(...args),
  reviewCommentCreate: (...args: unknown[]) => reviewCommentCreateMock(...args),
  reviewCommentDelete: vi.fn(),
  reviewCommentUpdate: (...args: unknown[]) => reviewCommentUpdateMock(...args),
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask: { value: { id: 'task-1', formId: 'FORM-1', currentNode: 'jd' } },
    onCommentAdded: (callback: (data: unknown) => void) => {
      commentAddedCallback = callback;
      return () => {
        if (commentAddedCallback === callback) {
          commentAddedCallback = null;
        }
      };
    },
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    getAnnotationComments: (type: string, id: string) => commentState.value[`${type}:${id}`] ?? [],
    setAnnotationComments: (type: string, id: string, comments: AnnotationComment[]) => {
      commentState.value = {
        ...commentState.value,
        [`${type}:${id}`]: comments,
      };
    },
    getAnnotationReviewState: vi.fn(() => reviewState.value),
    setAnnotationReviewState: (...args: unknown[]) => setAnnotationReviewStateMock(...args),
    applyAnnotationReviewAction: (...args: unknown[]) => applyAnnotationReviewActionMock(...args),
    updateAnnotationComment: vi.fn(),
    removeAnnotationComment: vi.fn(),
    addCommentToAnnotation: vi.fn(),
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser,
  }),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: (...args: unknown[]) => emitToastMock(...args) }));

function makeComment(id: string, content: string, annotationId = 'annot-1'): AnnotationComment {
  return {
    id,
    annotationId,
    annotationType: 'text',
    authorId: 'u-1',
    authorName: '张三',
    authorRole: UserRole.DESIGNER,
    content,
    createdAt: 1,
  };
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountTimeline(props: Record<string, unknown> = {}) {
  const { default: ReviewCommentsTimeline } = await import('./ReviewCommentsTimeline.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const reviewActionCompletedSpy = vi.fn();
  const app = createApp({
    render: () => h(ReviewCommentsTimeline, {
      annotationType: 'text',
      annotationId: 'annot-1',
      annotationLabel: '文字批注 / 主评论线程',
      onReviewActionCompleted: reviewActionCompletedSpy,
      ...props,
    }),
  });
  app.mount(host);
  return {
    reviewActionCompletedSpy,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewCommentsTimeline', () => {
  beforeEach(async () => {
    const [{ __resetReviewSharedStores }, { __resetCommentThreadRefreshForTests }] = await Promise.all([
      import('@/review/services/sharedStores'),
      import('@/composables/useCommentThread'),
    ]);
    __resetReviewSharedStores();
    __resetCommentThreadRefreshForTests();
    document.body.innerHTML = '';
    backendComments.value = [makeComment('c-1', '初始评论')];
    commentState.value = {};
    reviewState.value = undefined;
    currentUser.value = { id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER };
    commentAddedCallback = null;
    reviewCommentGetByAnnotationMock.mockClear();
    reviewCommentGetByAnnotationMock.mockImplementation(async () => ({
      success: true,
      comments: backendComments.value,
    }));
    annotationReviewStateApplyMock.mockClear();
    applyAnnotationReviewActionMock.mockClear();
    setAnnotationReviewStateMock.mockClear();
    emitToastMock.mockClear();
  });

  it('命中当前 annotation 的 comment_added 后会自动刷新评论线程', async () => {
    const mounted = await mountTimeline();
    await flushUi();

    expect(document.body.textContent).toContain('初始评论');
    expect(reviewCommentGetByAnnotationMock).toHaveBeenCalledTimes(1);

    backendComments.value = [
      makeComment('c-1', '初始评论'),
      makeComment('c-2', '实时新增评论'),
    ];

    commentAddedCallback?.({
      comment: {
        annotationId: 'annot-1',
        annotationType: 'text',
      },
    });
    await flushUi();

    expect(reviewCommentGetByAnnotationMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('实时新增评论');

    mounted.unmount();
  });

  it('切换批注后只显示新批注线程，不残留旧评论', async () => {
    const annotationId = ref('annot-1');
    reviewCommentGetByAnnotationMock.mockImplementation(async (id: string) => ({
      success: true,
      comments: id === 'annot-1'
        ? [makeComment('c-1', '批注一评论', 'annot-1')]
        : [makeComment('c-2', '批注二评论', 'annot-2')],
    }));

    const { default: ReviewCommentsTimeline } = await import('./ReviewCommentsTimeline.vue');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(ReviewCommentsTimeline, {
        annotationType: 'text',
        annotationId: annotationId.value,
      }),
    });
    app.mount(host);
    await flushUi();

    expect(document.body.textContent).toContain('批注一评论');
    expect(document.body.textContent).not.toContain('批注二评论');

    annotationId.value = 'annot-2';
    await flushUi();

    expect(document.body.textContent).toContain('批注二评论');
    expect(document.body.textContent).not.toContain('批注一评论');

    app.unmount();
    host.remove();
  });

  it('同一实时新增事件重复到达时不会显示重复评论', async () => {
    const mounted = await mountTimeline();
    await flushUi();

    backendComments.value = [
      makeComment('c-1', '初始评论'),
      makeComment('c-2', '实时新增评论'),
    ];

    commentAddedCallback?.({
      comment: {
        annotationId: 'annot-1',
        annotationType: 'text',
      },
    });
    await flushUi();
    commentAddedCallback?.({
      comment: {
        annotationId: 'annot-1',
        annotationType: 'text',
      },
    });
    await flushUi();

    const occurrences = (document.body.textContent?.match(/实时新增评论/g) ?? []).length;
    expect(occurrences).toBe(1);

    mounted.unmount();
  });

  it('忽略其他批注线程的 comment_added 事件', async () => {
    const mounted = await mountTimeline();
    await flushUi();

    commentAddedCallback?.({
      comment: {
        annotationId: 'annot-other',
        annotationType: 'text',
      },
    });
    await flushUi();

    expect(reviewCommentGetByAnnotationMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('实时新增评论');

    mounted.unmount();
  });

  it('designerOnly 模式下不会暴露同意或驳回动作', async () => {
    reviewState.value = {
      resolutionStatus: 'fixed',
      decisionStatus: 'pending',
      updatedAt: 1700000000000,
      history: [],
    };
    currentUser.value = { id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER };

    const mounted = await mountTimeline({
      designerOnly: true,
      composerSubmitLabel: '发送回复',
    });
    await flushUi();

    expect(document.body.textContent).toContain('已修改');
    expect(document.body.textContent).toContain('不需解决');
    expect(document.body.textContent).not.toContain('同意');
    expect(document.body.textContent).not.toContain('驳回');
    expect(document.body.textContent).toContain('发送回复');

    mounted.unmount();
  });

  it('SJ 在正式单据上下文回复后刷新线程且不因后端未回传 comment 误报失败', async () => {
    currentUser.value = { id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER };
    reviewCommentCreateMock.mockImplementationOnce(async () => {
      backendComments.value = [
        ...backendComments.value,
        {
          id: 'comment-sj-reply',
          annotationId: 'annot-1',
          annotationType: 'text',
          authorId: 'designer-1',
          authorName: '设计甲',
          authorRole: UserRole.DESIGNER,
          content: 'SJ 回复内容',
          createdAt: 2,
        },
      ];
      return { success: true };
    });

    const mounted = await mountTimeline({
      designerOnly: true,
      contextFormId: 'FORM-1',
      contextTaskId: 'task-1',
      composerSubmitLabel: '发送回复',
    });
    await flushUi();

    const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'));
    const commentInput = textareas.at(-1);
    expect(commentInput).toBeTruthy();
    commentInput!.value = 'SJ 回复内容';
    commentInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushUi();

    const sendButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('发送回复'));
    expect(sendButton).toBeTruthy();
    sendButton?.click();
    await flushUi();

    expect(reviewCommentCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      annotationId: 'annot-1',
      annotationType: 'text',
      authorId: 'designer-1',
      authorRole: UserRole.DESIGNER,
      content: 'SJ 回复内容',
      formId: 'FORM-1',
      taskId: 'task-1',
    }));
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      message: '评论创建失败',
    }));
    expect(document.body.textContent).toContain('SJ 回复内容');

    mounted.unmount();
  });

  it('Dock 紧凑模式仍显示评论、处理按钮、输入框和发送按钮', async () => {
    const mounted = await mountTimeline({
      density: 'dock',
      composerSubmitLabel: '发送回复',
    });
    await flushUi();

    expect(document.querySelector('[data-testid="review-comments-timeline"]')?.getAttribute('data-density')).toBe('dock');
    expect(document.body.textContent).toContain('初始评论');
    expect(document.body.textContent).toContain('同意');
    expect(document.body.textContent).toContain('驳回');
    expect(document.querySelector('textarea')).not.toBeNull();
    const sendButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('发送回复'));
    expect(sendButton).toBeTruthy();

    mounted.unmount();
  });

  it('回复区不渲染无动作的附件和截图按钮', async () => {
    const mounted = await mountTimeline();
    await flushUi();

    expect(document.querySelector('svg.lucide-paperclip')).toBeNull();
    expect(document.querySelector('svg.lucide-camera')).toBeNull();

    mounted.unmount();
  });

  it('设计侧空备注点击不需解决时不更新状态', async () => {
    currentUser.value = { id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER };

    const mounted = await mountTimeline({ designerOnly: true });
    await flushUi();

    const wontFixButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('不需解决'));
    wontFixButton?.click();
    await flushUi();
    const submitButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('提交处理结果'));
    expect(submitButton).toBeTruthy();
    submitButton?.click();
    await flushUi();

    expect(annotationReviewStateApplyMock).not.toHaveBeenCalled();
    expect(applyAnnotationReviewActionMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: '请填写不需解决原因',
      level: 'warning',
    }));
    expect(mounted.reviewActionCompletedSpy).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it('审核侧空备注点击驳回时不更新状态，填写说明后正常提交', async () => {
    reviewState.value = {
      resolutionStatus: 'fixed',
      decisionStatus: 'pending',
      updatedAt: 1700000000000,
      history: [],
    };
    currentUser.value = { id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER };

    const mounted = await mountTimeline();
    await flushUi();

    const rejectButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('驳回'));
    rejectButton?.click();
    await flushUi();
    const submitButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('提交确认结果'));
    expect(submitButton).toBeTruthy();
    submitButton?.click();
    await flushUi();

    expect(annotationReviewStateApplyMock).not.toHaveBeenCalled();
    expect(applyAnnotationReviewActionMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: '请填写驳回原因',
      level: 'warning',
    }));
    expect(mounted.reviewActionCompletedSpy).not.toHaveBeenCalled();

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).toBeTruthy();
    textarea!.value = '仍需补充碰撞说明';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushUi();

    rejectButton?.click();
    await flushUi();
    submitButton?.click();
    await flushUi();

    expect(annotationReviewStateApplyMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'reject',
      note: '仍需补充碰撞说明',
    }));

    mounted.unmount();
  });

  it('无正式单据时本地处理成功也会发出处理完成事件', async () => {
    currentUser.value = { id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER };
    const localState = {
      resolutionStatus: 'fixed',
      decisionStatus: 'pending',
      updatedAt: 1710000000000,
      history: [],
    };
    applyAnnotationReviewActionMock.mockReturnValueOnce(localState);

    const mounted = await mountTimeline({
      designerOnly: true,
      contextFormId: null,
      contextTaskId: null,
    });
    await flushUi();

    const fixedButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('已修改'));
    fixedButton?.click();
    await flushUi();
    const submitButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('提交处理结果'));
    submitButton?.click();
    await flushUi();

    expect(annotationReviewStateApplyMock).not.toHaveBeenCalled();
    expect(mounted.reviewActionCompletedSpy).toHaveBeenCalledWith({
      action: 'fixed',
      annotationId: 'annot-1',
      annotationType: 'text',
      state: localState,
    });

    mounted.unmount();
  });

  it('后端返回批注处理状态时直接写入后端状态，不再本地合成状态', async () => {
    currentUser.value = { id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER };
    annotationReviewStateApplyMock.mockResolvedValueOnce({
      success: true,
      state: {
        formId: 'FORM-1',
        taskId: 'task-1',
        annotationId: 'annot-1',
        annotationType: 'text',
        workflowNode: 'sj',
        reviewRound: 2,
        resolutionStatus: 'fixed',
        decisionStatus: 'pending',
        note: '已完成修改',
        updatedById: 'designer-1',
        updatedByName: '设计甲',
        updatedByRole: UserRole.DESIGNER,
        updatedAt: 1710000000000,
        history: [{
          id: 'backend-event-1',
          action: 'fixed',
          operatorId: 'designer-1',
          operatorName: '设计甲',
          operatorRole: UserRole.DESIGNER,
          note: '已完成修改',
          createdAt: 1710000000000,
        }],
      },
    });

    const mounted = await mountTimeline({ designerOnly: true });
    await flushUi();

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).toBeTruthy();
    textarea!.value = '已完成修改';
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushUi();

    const fixedButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('已修改'));
    fixedButton?.click();
    await flushUi();
    const submitButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('提交处理结果'));
    expect(submitButton).toBeTruthy();
    submitButton?.click();
    await flushUi();

    expect(setAnnotationReviewStateMock).toHaveBeenCalledWith(
      'text',
      'annot-1',
      expect.objectContaining({
        resolutionStatus: 'fixed',
        decisionStatus: 'pending',
        note: '已完成修改',
        updatedByName: '设计甲',
        history: [expect.objectContaining({ id: 'backend-event-1' })],
      }),
    );
    expect(applyAnnotationReviewActionMock).not.toHaveBeenCalled();
    expect(mounted.reviewActionCompletedSpy).toHaveBeenCalledWith({
      action: 'fixed',
      annotationId: 'annot-1',
      annotationType: 'text',
      state: expect.objectContaining({
        resolutionStatus: 'fixed',
        decisionStatus: 'pending',
      }),
    });

    mounted.unmount();
  });
});
