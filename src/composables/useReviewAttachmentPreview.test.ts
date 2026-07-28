import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeReviewAttachmentPreview,
  clearReviewAttachmentPreview,
  getReviewAttachmentPreviewKind,
  openReviewAttachmentPreview,
} from './useReviewAttachmentPreview';

import type { ReviewAttachment } from '@/types/auth';

const ensurePanelAndActivateMock = vi.hoisted(() => vi.fn());

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: ensurePanelAndActivateMock,
}));

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

describe('useReviewAttachmentPreview', () => {
  beforeEach(() => {
    clearReviewAttachmentPreview();
    ensurePanelAndActivateMock.mockClear();
  });

  it('recognizes only PDF and uploaded image formats', () => {
    expect(getReviewAttachmentPreviewKind(attachment())).toBe('pdf');
    expect(getReviewAttachmentPreviewKind(attachment({
      name: 'snapshot.bin',
      type: 'image/jpeg',
      mimeType: undefined,
    }))).toBe('image');
    expect(getReviewAttachmentPreviewKind(attachment({
      name: 'SNAPSHOT.PNG',
      mimeType: undefined,
    }))).toBe('image');
    expect(getReviewAttachmentPreviewKind(attachment({
      name: 'calculation.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))).toBeNull();
  });

  it('stores a safe target and reuses the single dock panel', () => {
    const first = attachment();
    const second = attachment({
      id: 'attachment-2',
      name: 'snapshot.jpg',
      url: 'https://files.example.test/snapshot.jpg',
      mimeType: 'image/jpeg',
    });

    expect(openReviewAttachmentPreview('task-1', first)).toBe(true);
    expect(activeReviewAttachmentPreview.value).toEqual(expect.objectContaining({
      taskId: 'task-1',
      attachment: first,
      kind: 'pdf',
      url: new URL(first.url, window.location.href).href,
    }));

    expect(openReviewAttachmentPreview('task-1', second)).toBe(true);
    expect(activeReviewAttachmentPreview.value?.attachment.id).toBe('attachment-2');
    expect(ensurePanelAndActivateMock).toHaveBeenCalledTimes(2);
    expect(ensurePanelAndActivateMock).toHaveBeenNthCalledWith(1, 'reviewAttachmentPreview');
    expect(ensurePanelAndActivateMock).toHaveBeenNthCalledWith(2, 'reviewAttachmentPreview');
  });

  it('rejects unsupported files and unsafe URL protocols', () => {
    expect(openReviewAttachmentPreview('task-1', attachment())).toBe(true);
    expect(openReviewAttachmentPreview('task-1', attachment({
      name: 'notes.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }))).toBe(false);
    expect(openReviewAttachmentPreview('task-1', attachment({
      url: 'javascript:alert(1)',
    }))).toBe(false);
    expect(openReviewAttachmentPreview('task-1', attachment({
      url: 'data:application/pdf;base64,AA==',
    }))).toBe(false);
    expect(openReviewAttachmentPreview('task-1', attachment({
      url: '   ',
    }))).toBe(false);
    expect(activeReviewAttachmentPreview.value).toBeNull();
    expect(ensurePanelAndActivateMock).toHaveBeenCalledTimes(1);
  });
});
