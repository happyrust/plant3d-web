import { describe, expect, it } from 'vitest';

import {
  buildReviewAttachments,
  describeAssociatedFilesSurface,
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

  it('preserves backend metadata needed by downstream reviewer surfaces', () => {
    const attachments = buildReviewAttachments([
      {
        name: 'calc.xlsx',
        size: 2048,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        status: 'success',
        serverAttachmentId: 'att-2',
        serverUrl: '/files/review_attachments/att-2.xlsx',
      },
      {
        name: 'broken.pdf',
        size: 512,
        type: 'application/pdf',
        status: 'error',
        serverAttachmentId: 'att-3',
        serverUrl: '/files/review_attachments/att-3.pdf',
      },
    ]);

    expect(attachments).toEqual([
      {
        id: 'att-2',
        name: 'calc.xlsx',
        url: '/files/review_attachments/att-2.xlsx',
        size: 2048,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ]);
  });
});

describe('describeAssociatedFilesSurface', () => {
  it('returns an explainable placeholder summary when linked files are not available yet', () => {
    expect(
      describeAssociatedFilesSurface({
        selectedComponentCount: 2,
        linkedFileCount: 0,
      })
    ).toEqual({
      badge: '待补充',
      summary: '已选择 2 个构件；关联文件将在后续数据接入后展示。',
      detail: '当前为 M1 设计基线占位区，用于说明将展示力学分析、碰撞检查、规则校验和二三维比对等关联资料。',
    });
  });

  it('returns visible linked-file counts when associated files are available', () => {
    expect(
      describeAssociatedFilesSurface({
        selectedComponentCount: 3,
        linkedFileCount: 5,
      })
    ).toEqual({
      badge: '已关联 5 个文件',
      summary: '已选择 3 个构件；当前可观察 5 个关联文件。',
      detail: '关联文件按类别分组展示，便于在发起校审前快速核对上下文资料。',
    });
  });
});
