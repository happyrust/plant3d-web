import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref } from 'vue';

import ReviewAttachmentPreviewPanelDock from './ReviewAttachmentPreviewPanelDock.vue';

import type { ReviewAttachment, ReviewTask } from '@/types/auth';

import {
  activeReviewAttachmentPreview,
  clearReviewAttachmentPreview,
  openReviewAttachmentPreview,
  reviewAttachmentPreviewStatus,
} from '@/composables/useReviewAttachmentPreview';

const currentTask = ref<ReviewTask | null>(null);

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: vi.fn(),
}));

vi.mock('@/composables/useReviewStore', () => ({
  useReviewStore: () => ({ currentTask }),
}));

function createTask(id: string): ReviewTask {
  return {
    id,
    title: id,
    description: '',
    modelName: 'model',
    status: 'in_review',
    priority: 'medium',
    requesterId: 'designer-1',
    requesterName: 'Designer',
    checkerId: 'checker-1',
    checkerName: 'Checker',
    approverId: 'approver-1',
    approverName: 'Approver',
    reviewerId: 'checker-1',
    reviewerName: 'Checker',
    components: [],
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
  };
}

function attachment(overrides: Partial<ReviewAttachment> = {}): ReviewAttachment {
  return {
    id: 'attachment-1',
    name: 'drawing.pdf',
    url: '/files/review_attachments/drawing.pdf',
    mimeType: 'application/pdf',
    uploadedAt: 1710000000000,
    ...overrides,
  };
}

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ReviewAttachmentPreviewPanelDock);
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe('ReviewAttachmentPreviewPanelDock', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearReviewAttachmentPreview();
    currentTask.value = createTask('task-1');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const isJpeg = String(input).includes('.jpg');
      return new Response(
        new Uint8Array(isJpeg
          ? [0xff, 0xd8, 0xff, 0xe0]
          : [0x25, 0x50, 0x44, 0x46, 0x2d]),
        {
          status: 206,
          headers: {
            'Content-Type': isJpeg ? 'image/jpeg' : 'application/pdf',
          },
        },
      );
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders PDF and switches the same panel to an image', async () => {
    openReviewAttachmentPreview('task-1', attachment());
    const mounted = mountPanel();

    expect(mounted.host.querySelector('[data-testid="review-attachment-preview-validating"]')).not.toBeNull();
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('ready'));
    await nextTick();
    const frame = mounted.host.querySelector('[data-testid="review-attachment-pdf"]') as HTMLObjectElement | null;
    expect(frame?.data).toBe(new URL('/files/review_attachments/drawing.pdf', window.location.href).href);
    expect(mounted.host.textContent).toContain('drawing.pdf');

    openReviewAttachmentPreview('task-1', attachment({
      id: 'attachment-2',
      name: 'snapshot.jpg',
      url: '/files/review_attachments/snapshot.jpg',
      mimeType: 'image/jpeg',
    }));
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('ready'));
    await nextTick();

    expect(mounted.host.querySelector('[data-testid="review-attachment-pdf"]')).toBeNull();
    const image = mounted.host.querySelector('[data-testid="review-attachment-image"]') as HTMLImageElement | null;
    expect(image?.src).toBe(new URL('/files/review_attachments/snapshot.jpg', window.location.href).href);

    mounted.unmount();
  });

  it('clears the preview when the current review task changes', async () => {
    openReviewAttachmentPreview('task-1', attachment());
    const mounted = mountPanel();

    currentTask.value = createTask('task-2');
    await nextTick();

    expect(activeReviewAttachmentPreview.value).toBeNull();
    expect(mounted.host.textContent).toContain('请从校审附件列表中选择文档');

    mounted.unmount();
  });
});
