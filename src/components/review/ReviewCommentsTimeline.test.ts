import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import { UserRole, type AnnotationComment } from '@/types/auth';

const backendComments = ref<AnnotationComment[]>([]);
const commentState = ref<Record<string, AnnotationComment[]>>({});
const reviewState = ref<unknown>(undefined);
const currentUser = ref({ id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER });
let commentAddedCallback: ((data: unknown) => void) | null = null;

const reviewCommentGetByAnnotationMock = vi.fn(async () => ({
  success: true,
  comments: backendComments.value,
}));

vi.mock('@/api/reviewApi', () => ({
  reviewCommentGetByAnnotation: reviewCommentGetByAnnotationMock,
  reviewCommentCreate: vi.fn(),
  reviewCommentDelete: vi.fn(),
  reviewCommentUpdate: vi.fn(),
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
    applyAnnotationReviewAction: vi.fn(() => null),
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

vi.mock('@/ribbon/toastBus', () => ({ emitToast: vi.fn() }));

function makeComment(id: string, content: string): AnnotationComment {
  return {
    id,
    annotationId: 'annot-1',
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
  const app = createApp({
    render: () => h(ReviewCommentsTimeline, {
      annotationType: 'text',
      annotationId: 'annot-1',
      annotationLabel: '文字批注 / 主评论线程',
      ...props,
    }),
  });
  app.mount(host);
  return {
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewCommentsTimeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    backendComments.value = [makeComment('c-1', '初始评论')];
    commentState.value = {};
    reviewState.value = undefined;
    currentUser.value = { id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER };
    commentAddedCallback = null;
    reviewCommentGetByAnnotationMock.mockClear();
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
});
