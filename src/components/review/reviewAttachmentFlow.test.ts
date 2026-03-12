import { describe, expect, it } from 'vitest';

import {
  buildReviewAttachments,
  hasAttachmentLineage,
  shouldAutoUploadAttachments,
} from './reviewAttachmentFlow';

describe('reviewAttachmentFlow', () => {
  it('detects lineage when taskId exists', () => {
    expect(hasAttachmentLineage('task-1', null)).toBe(true);
  });

  it('detects lineage when formId exists', () => {
    expect(hasAttachmentLineage(null, 'FORM-1')).toBe(true);
  });

  it('returns false when neither taskId nor formId exists', () => {
    expect(hasAttachmentLineage(null, null)).toBe(false);
  });

  it('only auto uploads when autoUpload is enabled and lineage exists', () => {
    expect(shouldAutoUploadAttachments(false, 'task-1', null)).toBe(false);
    expect(shouldAutoUploadAttachments(true, null, null)).toBe(false);
    expect(shouldAutoUploadAttachments(true, null, 'FORM-2')).toBe(true);
  });

  it('builds review attachments from successful uploads only', () => {
    const attachments = buildReviewAttachments([
      {
        name: 'drawing.pdf',
        size: 128,
        type: 'application/pdf',
        status: 'success',
        serverAttachmentId: 'att-1',
        serverUrl: '/files/review_attachments/att-1.pdf',
      },
      {
        name: 'pending.docx',
        size: 256,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        status: 'pending',
      },
    ]);

    expect(attachments).toEqual([
      {
        id: 'att-1',
        name: 'drawing.pdf',
        url: '/files/review_attachments/att-1.pdf',
        size: 128,
        mimeType: 'application/pdf',
      },
    ]);
  });
});
