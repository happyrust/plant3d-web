import type { ReviewAttachment } from '@/types/auth';

export type UploadedAttachmentLike = {
  name: string;
  size: number;
  type?: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  serverAttachmentId?: string;
  serverUrl?: string;
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
