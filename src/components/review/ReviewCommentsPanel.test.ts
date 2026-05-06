import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import { UserRole, type AnnotationComment } from '@/types/auth';

const backendComments = ref<AnnotationComment[]>([]);
const reviewCommentGetByAnnotationMock = vi.fn(async () => ({
  success: true,
  comments: backendComments.value,
}));
const reviewCommentCreateMock = vi.fn();
const reviewCommentUpdateMock = vi.fn(async () => ({ success: true }));
const setAnnotationCommentsMock = vi.fn();
let commentAddedCallback: ((data: unknown) => void) | null = null;

vi.mock('@/api/reviewApi', () => ({
  reviewCommentGetByAnnotation: (...args: unknown[]) => reviewCommentGetByAnnotationMock(...args),
  reviewCommentCreate: (...args: unknown[]) => reviewCommentCreateMock(...args),
  reviewCommentDelete: vi.fn(async () => ({ success: true })),
  reviewCommentUpdate: (...args: unknown[]) => reviewCommentUpdateMock(...args),
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({
    currentTask: { value: { id: 'task-1', formId: 'FORM-1' } },
    onCommentAdded: (callback: (data: unknown) => void) => {
      commentAddedCallback = callback;
      return () => {
        if (commentAddedCallback === callback) commentAddedCallback = null;
      };
    },
  }),
}));

vi.mock('@/composables/useToolStore', () => ({
  useToolStore: () => ({
    setAnnotationComments: (...args: unknown[]) => setAnnotationCommentsMock(...args),
    addCommentToAnnotation: vi.fn(),
    updateAnnotationComment: vi.fn(),
    removeAnnotationComment: vi.fn(),
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: ref({ id: 'designer-1', name: '设计甲', role: UserRole.DESIGNER }),
  }),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: vi.fn() }));

function makeComment(id: string, content: string): AnnotationComment {
  return {
    id,
    annotationId: 'annot-panel-1',
    annotationType: 'text',
    authorId: 'designer-1',
    authorName: '设计甲',
    authorRole: UserRole.DESIGNER,
    content,
    createdAt: id === 'c-1' ? 1 : 2,
  };
}

async function flushUi() {
  await vi.dynamicImportSettled();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function mountPanel() {
  const { default: ReviewCommentsPanel } = await import('./ReviewCommentsPanel.vue');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(ReviewCommentsPanel, {
      annotationType: 'text',
      annotationId: 'annot-panel-1',
      contextFormId: 'FORM-1',
      contextTaskId: 'task-1',
    }),
  });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewCommentsPanel', () => {
  beforeEach(async () => {
    const [{ __resetReviewSharedStores }, { __resetCommentThreadRefreshForTests }] = await Promise.all([
      import('@/review/services/sharedStores'),
      import('@/composables/useCommentThread'),
    ]);
    __resetReviewSharedStores();
    __resetCommentThreadRefreshForTests();
    document.body.innerHTML = '';
    backendComments.value = [makeComment('c-1', '三栏初始评论')];
    commentAddedCallback = null;
    reviewCommentGetByAnnotationMock.mockClear();
    reviewCommentGetByAnnotationMock.mockImplementation(async () => ({
      success: true,
      comments: backendComments.value,
    }));
    setAnnotationCommentsMock.mockClear();
  });

  it('三栏页通过统一线程入口加载，并在实时新增后替换为最新线程', async () => {
    const mounted = await mountPanel();
    await flushUi();

    expect(mounted.host.textContent).toContain('三栏初始评论');
    expect(reviewCommentGetByAnnotationMock).toHaveBeenCalledTimes(1);

    backendComments.value = [
      makeComment('c-1', '三栏初始评论'),
      makeComment('c-2', '三栏实时评论'),
    ];
    commentAddedCallback?.({
      comment: {
        annotationId: 'annot-panel-1',
        annotationType: 'text',
        formId: 'FORM-1',
      },
    });
    await flushUi();

    expect(reviewCommentGetByAnnotationMock).toHaveBeenCalledTimes(2);
    expect(mounted.host.textContent).toContain('三栏实时评论');
    expect((mounted.host.textContent?.match(/三栏实时评论/g) ?? []).length).toBe(1);

    mounted.unmount();
  });
});
