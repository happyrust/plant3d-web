import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import { UserRole, type AnnotationComment, type AnnotationScreenshot } from '@/types/auth';

const backendComments = ref<AnnotationComment[]>([]);
const commentState = ref<Record<string, AnnotationComment[]>>({});
const screenshotState = ref<Record<string, AnnotationScreenshot | null>>({});
const reviewState = ref<unknown>(undefined);
const currentUser = ref({ id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER });
let commentAddedCallback: ((data: unknown) => void) | null = null;
const captureBusy = ref(false);
const captureProgress = ref(0);
const captureCanvasMock = vi.fn(() => ({ width: 1280, height: 720, clientWidth: 1280, clientHeight: 720 }));
const captureAndUploadMock = vi.fn();
const setAnnotationScreenshotMock = vi.fn((type: string, id: string, screenshot: AnnotationScreenshot) => {
  screenshotState.value = {
    ...screenshotState.value,
    [`${type}:${id}`]: screenshot,
  };
  return true;
});
const clearAnnotationScreenshotMock = vi.fn((type: string, id: string) => {
  screenshotState.value = {
    ...screenshotState.value,
    [`${type}:${id}`]: null,
  };
  return true;
});
const emitToastMock = vi.fn();

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
  getAnnotationRefnos: vi.fn((record: { refnos?: string[]; refno?: string }) => {
    if (Array.isArray(record.refnos) && record.refnos.length > 0) {
      return [...record.refnos];
    }
    if (typeof record.refno === 'string' && record.refno.length > 0) {
      return [record.refno];
    }
    return [];
  }),
  useToolStore: () => ({
    getAnnotationComments: (type: string, id: string) => commentState.value[`${type}:${id}`] ?? [],
    getAnnotationRecordsByType: (type: string) => {
      switch (type) {
        case 'text':
          return [{ id: 'annot-1', refnos: ['BRAN-1'] }];
        case 'cloud':
          return [{ id: 'annot-1', refnos: ['BRAN-1'] }];
        case 'rect':
          return [{ id: 'annot-1', refnos: ['BRAN-1'] }];
        case 'obb':
          return [{ id: 'annot-1', refnos: ['BRAN-1'] }];
        default:
          return [];
      }
    },
    setAnnotationComments: (type: string, id: string, comments: AnnotationComment[]) => {
      commentState.value = {
        ...commentState.value,
        [`${type}:${id}`]: comments,
      };
    },
    getAnnotationScreenshot: (type: string, id: string) => screenshotState.value[`${type}:${id}`] ?? null,
    setAnnotationScreenshot: setAnnotationScreenshotMock,
    clearAnnotationScreenshot: clearAnnotationScreenshotMock,
    getAnnotationReviewState: vi.fn(() => reviewState.value),
    applyAnnotationReviewAction: vi.fn(() => null),
    updateAnnotationComment: vi.fn(),
    removeAnnotationComment: vi.fn(),
    addCommentToAnnotation: vi.fn(),
  }),
}));

vi.mock('@/composables/useScreenshot', () => ({
  useScreenshot: () => ({
    getCanvas: captureCanvasMock,
    captureAndUpload: captureAndUploadMock,
    isCapturing: captureBusy,
    uploadProgress: captureProgress,
  }),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser,
  }),
}));

vi.mock('@/review/services/commentThreadDualRead', () => ({
  syncInlineToStore: vi.fn(),
}));

vi.mock('@/review/services/sharedStores', () => ({
  getReviewCommentEventLog: vi.fn(),
  getReviewCommentThreadStore: vi.fn(),
  isReviewCommentThreadStoreActive: vi.fn(() => false),
}));

vi.mock('@/ribbon/toastBus', () => ({ emitToast: emitToastMock }));

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

function makeScreenshot(id: string): AnnotationScreenshot {
  return {
    attachmentId: id,
    name: `${id}.png`,
    url: `/files/${id}.png`,
    mimeType: 'image/png',
    size: 2048,
    width: 1280,
    height: 720,
    uploadedAt: 1_710_000_000_100,
    capturedAt: 1_710_000_000_000,
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
    screenshotState.value = {};
    reviewState.value = undefined;
    currentUser.value = { id: 'reviewer-1', name: '校对甲', role: UserRole.PROOFREADER };
    commentAddedCallback = null;
    captureBusy.value = false;
    captureProgress.value = 0;
    reviewCommentGetByAnnotationMock.mockClear();
    captureCanvasMock.mockClear();
    captureCanvasMock.mockImplementation(() => ({ width: 1280, height: 720, clientWidth: 1280, clientHeight: 720 }));
    captureAndUploadMock.mockReset();
    setAnnotationScreenshotMock.mockClear();
    clearAnnotationScreenshotMock.mockClear();
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

  it('存在批注截图时会展示预览与元数据', async () => {
    screenshotState.value = {
      'text:annot-1': makeScreenshot('att-preview'),
    };

    const mounted = await mountTimeline();
    await flushUi();

    expect(document.body.textContent).toContain('批注截图');
    expect(document.body.textContent).toContain('att-preview.png');
    expect(document.body.textContent).toContain('1280 × 720');
    expect(document.querySelector('img[alt="文字批注 / 主评论线程 截图"]')).toBeTruthy();

    mounted.unmount();
  });

  it('点击相机按钮后会上传截图并写回当前批注', async () => {
    captureAndUploadMock.mockResolvedValue({
      attachment: {
        id: 'att-uploaded',
        name: 'annotation-text-annot-1.png',
        url: '/files/annotation-text-annot-1.png',
        mimeType: 'image/png',
        size: 4096,
        uploadedAt: 1_710_000_000_200,
      },
      width: 800,
      height: 600,
      capturedAt: 1_710_000_000_000,
    });

    const mounted = await mountTimeline();
    await flushUi();

    const button = document.querySelector('button[title=\"为当前批注截取三维视图\"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button?.click();
    await flushUi();

    expect(captureAndUploadMock).toHaveBeenCalledTimes(1);
    expect(setAnnotationScreenshotMock).toHaveBeenCalledWith(
      'text',
      'annot-1',
      expect.objectContaining({
        attachmentId: 'att-uploaded',
        width: 800,
        height: 600,
      }),
    );
    expect(document.body.textContent).toContain('annotation-text-annot-1.png');
    expect(document.body.textContent).toContain('800 × 600');
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: '批注截图已关联',
      level: 'success',
    }));

    mounted.unmount();
  });

  it('上传中会显示进度并禁用相机按钮', async () => {
    captureBusy.value = true;
    captureProgress.value = 42;

    const mounted = await mountTimeline();
    await flushUi();

    const button = document.querySelector('button[title=\"为当前批注截取三维视图\"]') as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    expect(document.body.textContent).toContain('正在上传截图 42%');

    mounted.unmount();
  });

  it('上传失败时保留旧截图并提示错误', async () => {
    screenshotState.value = {
      'text:annot-1': makeScreenshot('att-old'),
    };
    captureAndUploadMock.mockRejectedValue(new Error('upload failed'));

    const mounted = await mountTimeline();
    await flushUi();

    const button = document.querySelector('button[title=\"重新截屏并覆盖当前批注截图\"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button?.click();
    await flushUi();

    expect(document.body.textContent).toContain('att-old.png');
    expect(setAnnotationScreenshotMock).not.toHaveBeenCalled();
    expect(emitToastMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'upload failed',
      level: 'error',
    }));

    mounted.unmount();
  });
});
