import type { ReviewAttachment } from '@/types/auth';

export type UploadedAttachmentLike = {
  name: string;
  size: number;
  type?: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  serverAttachmentId?: string;
  serverUrl?: string;
};

export type AssociatedFilesSurfaceSummary = {
  badge: string;
  summary: string;
  detail: string;
};

export function hasAttachmentLineage(taskId?: string | null, formId?: string | null): boolean {
  return !!taskId?.trim() || !!formId?.trim();
}

export function shouldAutoUploadAttachments(
  autoUpload: boolean,
  taskId?: string | null,
  formId?: string | null,
): boolean {
  return autoUpload && hasAttachmentLineage(taskId, formId);
}

export function buildReviewAttachments(files: UploadedAttachmentLike[]): ReviewAttachment[] {
  return files
    .filter((file) => file.status === 'success' && file.serverAttachmentId)
    .map((file) => ({
      id: file.serverAttachmentId!,
      name: file.name,
      url: file.serverUrl || '',
      size: file.size,
      mimeType: file.type || undefined,
    }));
}

export function describeAssociatedFilesSurface(params: {
  selectedComponentCount: number;
  linkedFileCount: number;
}): AssociatedFilesSurfaceSummary {
  if (params.linkedFileCount > 0) {
    return {
      badge: `已关联 ${params.linkedFileCount} 个文件`,
      summary: `已选择 ${params.selectedComponentCount} 个构件；当前可观察 ${params.linkedFileCount} 个关联文件。`,
      detail: '关联文件按类别分组展示，便于在发起校审前快速核对上下文资料。',
    };
  }

  return {
    badge: '待补充',
    summary: `已选择 ${params.selectedComponentCount} 个构件；关联文件将在后续数据接入后展示。`,
    detail: '当前为 M1 设计基线占位区，用于说明将展示力学分析、碰撞检查、规则校验和二三维比对等关联资料。',
  };
}
