import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeReviewAttachmentPreview,
  buildReviewAttachmentDownloadUrl,
  buildReviewAttachmentInlineUrl,
  clearReviewAttachmentPreview,
  getReviewAttachmentPreviewKind,
  openReviewAttachmentPreview,
  reviewAttachmentPreviewError,
  reviewAttachmentPreviewStatus,
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\.jpe?g(?:$|\?)/i.test(url)) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
          status: 206,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response(new TextEncoder().encode('%PDF-1.7'), {
        status: 206,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('carries the original file name into the download URL', () => {
    expect(buildReviewAttachmentDownloadUrl({
      name: '碰撞检查报告.pdf',
      url: '/files/review_attachments/att-1.pdf',
    })).toBe('/files/review_attachments/att-1.pdf?download=1&name=%E7%A2%B0%E6%92%9E%E6%A3%80%E6%9F%A5%E6%8A%A5%E5%91%8A.pdf');

    expect(buildReviewAttachmentDownloadUrl({
      name: 'plan.pdf',
      url: '/files/review_attachments/att-2.pdf?v=3#page=2',
    })).toBe('/files/review_attachments/att-2.pdf?v=3&download=1&name=plan.pdf#page=2');

    expect(buildReviewAttachmentDownloadUrl({ name: 'plan.pdf', url: '  ' })).toBe('');
  });

  it('leaves data/blob URLs untouched so their payload is not corrupted', () => {
    const dataUrl = 'data:application/pdf;base64,JVBERi0xLjQK';
    expect(buildReviewAttachmentDownloadUrl({ name: 'plan.pdf', url: dataUrl })).toBe(dataUrl);
    expect(buildReviewAttachmentInlineUrl({ name: 'plan.pdf', url: dataUrl })).toBe(dataUrl);

    const blobUrl = 'blob:http://localhost:3101/8f1d-4c2a';
    expect(buildReviewAttachmentDownloadUrl({ name: 'plan.pdf', url: blobUrl })).toBe(blobUrl);
  });

  it('keeps inline rendering while still declaring the original file name', () => {
    expect(buildReviewAttachmentInlineUrl({
      name: '布置图 A.pdf',
      url: '/files/review_attachments/att-1.pdf',
    })).toBe('/files/review_attachments/att-1.pdf?name=%E5%B8%83%E7%BD%AE%E5%9B%BE%20A.pdf');

    expect(buildReviewAttachmentInlineUrl({
      url: '/files/review_attachments/att-1.pdf',
    })).toBe('/files/review_attachments/att-1.pdf');
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

  it('validates the file signature before marking the preview ready', async () => {
    expect(openReviewAttachmentPreview('task-1', attachment())).toBe(true);

    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('ready'));
    expect(reviewAttachmentPreviewError.value).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/files/review_attachments/drawing.pdf'),
      expect.objectContaining({
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
      }),
    );
  });

  it('rejects an HTML error page returned under a PDF file name', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));

    expect(openReviewAttachmentPreview('task-1', attachment())).toBe(true);
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('error'));
    expect(reviewAttachmentPreviewError.value).toContain('Content-Type');
    expect(reviewAttachmentPreviewError.value).toContain('drawing.pdf');
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
