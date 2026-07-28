import { readonly, shallowRef } from 'vue';

import { ensurePanelAndActivate } from './useDockApi';

import type { ReviewAttachment } from '@/types/auth';

export type ReviewAttachmentPreviewKind = 'pdf' | 'image';

export interface ReviewAttachmentPreviewTarget {
  taskId: string;
  attachment: ReviewAttachment;
  kind: ReviewAttachmentPreviewKind;
  url: string;
}

const previewTarget = shallowRef<ReviewAttachmentPreviewTarget | null>(null);

export const activeReviewAttachmentPreview = readonly(previewTarget);

export function getReviewAttachmentPreviewKind(
  attachment: ReviewAttachment,
): ReviewAttachmentPreviewKind | null {
  const declaredType = (attachment.mimeType || attachment.type)
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (declaredType === 'application/pdf' || declaredType === 'pdf') return 'pdf';
  if (
    declaredType === 'image/png'
    || declaredType === 'image/jpeg'
    || declaredType === 'png'
    || declaredType === 'jpg'
    || declaredType === 'jpeg'
  ) return 'image';

  const extension = attachment.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'png' || extension === 'jpg' || extension === 'jpeg') return 'image';
  return null;
}

function resolveSafeAttachmentUrl(url: string): string | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return null;
  try {
    const resolved = new URL(trimmedUrl, window.location.href);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

export function openReviewAttachmentPreview(
  taskId: string,
  attachment: ReviewAttachment,
): boolean {
  const normalizedTaskId = taskId.trim();
  const kind = getReviewAttachmentPreviewKind(attachment);
  const url = resolveSafeAttachmentUrl(attachment.url);
  if (!normalizedTaskId || !kind || !url) {
    previewTarget.value = null;
    return false;
  }

  previewTarget.value = { taskId: normalizedTaskId, attachment, kind, url };
  ensurePanelAndActivate('reviewAttachmentPreview');
  return true;
}

export function clearReviewAttachmentPreview(): void {
  previewTarget.value = null;
}
