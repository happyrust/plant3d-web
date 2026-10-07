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
  reviewAttachmentWordHtml,
  retryReviewAttachmentPreview,
} from './useReviewAttachmentPreview';

import type { ReviewAttachment } from '@/types/auth';

const ensurePanelAndActivateMock = vi.hoisted(() => vi.fn());
const renderWordPreviewMock = vi.hoisted(() => vi.fn());
const getAuthTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/wordPreview', () => ({ renderWordPreview: renderWordPreviewMock }));
vi.mock('@/api/reviewApi', () => ({ getAuthToken: getAuthTokenMock }));

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
    renderWordPreviewMock.mockReset().mockResolvedValue('<html><body>Word content</body></html>');
    getAuthTokenMock.mockReturnValue(null);
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

  it('recognizes PDF, Word and uploaded image formats', () => {
    expect(getReviewAttachmentPreviewKind(attachment())).toBe('pdf');
    expect(getReviewAttachmentPreviewKind(attachment({
      name: 'notes.docx', mimeType: undefined,
    }))).toBe('word');
    expect(getReviewAttachmentPreviewKind(attachment({
      name: 'legacy.doc', mimeType: 'application/msword',
    }))).toBe('word');
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
      name: 'notes.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

  it('loads the full DOCX and renders it before marking the target ready', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    }));
    expect(openReviewAttachmentPreview('task-1', attachment({ name: 'notes.docx', mimeType: undefined }))).toBe(true);
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('ready'));
    expect(renderWordPreviewMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(reviewAttachmentWordHtml.value).toContain('Word content');
    expect(vi.mocked(fetch).mock.lastCall?.[1]?.headers).toEqual({});
  });

  it('uses the authenticated legacy conversion endpoint while preserving the original download URL', async () => {
    getAuthTokenMock.mockReturnValue('test-token');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
    const original = attachment({ id: 'att-legacy', name: 'legacy.doc', mimeType: 'application/msword' });
    openReviewAttachmentPreview('task-1', original);
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('ready'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/review/attachments/att-legacy/word-preview'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }));
    expect(activeReviewAttachmentPreview.value?.url).toBe(new URL(original.url, window.location.href).href);
  });

  it('keeps a Word parse failure retryable and discards a stale Word conversion after switching documents', async () => {
    const response = () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
    renderWordPreviewMock.mockRejectedValueOnce(new Error('corrupt DOCX'));
    openReviewAttachmentPreview('task-1', attachment({ name: 'notes.docx', mimeType: undefined }));
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('error'));
    expect(reviewAttachmentPreviewError.value).toContain('corrupt DOCX');
    let finish!: (html: string) => void;
    renderWordPreviewMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    retryReviewAttachmentPreview();
    await vi.waitFor(() => expect(finish).toBeDefined());
    openReviewAttachmentPreview('task-1', attachment());
    finish('<html>stale</html>');
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('ready'));
    expect(activeReviewAttachmentPreview.value?.kind).toBe('pdf');
    expect(reviewAttachmentWordHtml.value).toBeNull();
  });

  it('rejects partial or oversized Word responses before parsing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
      status: 206, headers: { 'Content-Type': 'application/octet-stream' },
    }));
    openReviewAttachmentPreview('task-1', attachment({ name: 'notes.docx', mimeType: undefined }));
    await vi.waitFor(() => expect(reviewAttachmentPreviewStatus.value).toBe('error'));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(51 * 1024 * 1024) },
    }));
    retryReviewAttachmentPreview();
    await vi.waitFor(() => expect(reviewAttachmentPreviewError.value).toContain('50MB'));
    expect(renderWordPreviewMock).not.toHaveBeenCalled();
  });
});
