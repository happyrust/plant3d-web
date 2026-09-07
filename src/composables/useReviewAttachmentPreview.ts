import { readonly, ref, shallowRef } from 'vue';

import { ensurePanelAndActivate } from './useDockApi';

import type { ReviewAttachment } from '@/types/auth';

export type ReviewAttachmentPreviewKind = 'pdf' | 'image';

export type ReviewAttachmentPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ReviewAttachmentPreviewTarget {
  taskId: string;
  attachment: ReviewAttachment;
  kind: ReviewAttachmentPreviewKind;
  url: string;
}

const previewTarget = shallowRef<ReviewAttachmentPreviewTarget | null>(null);
const previewStatus = ref<ReviewAttachmentPreviewStatus>('idle');
const previewError = ref<string | null>(null);

// 校验请求的序号；切换附件后旧请求的结果直接丢弃
let validationSeq = 0;

export const activeReviewAttachmentPreview = readonly(previewTarget);
export const reviewAttachmentPreviewStatus = readonly(previewStatus);
export const reviewAttachmentPreviewError = readonly(previewError);

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

type ReviewAttachmentLink = { name?: string; url?: string };

/**
 * standalone 后端会把附件内容以 data URL 形式回填到 `url`。
 * 这类 URL 的内容就是负载本身，追加查询串会直接污染 base64 数据。
 */
function carriesInlineContent(url: string): boolean {
  return /^(data|blob):/i.test(url);
}

function buildAttachmentUrl(attachment: ReviewAttachmentLink, forceDownload: boolean): string {
  const url = attachment.url?.trim() ?? '';
  if (!url || carriesInlineContent(url)) return url;

  const name = attachment.name?.trim() ?? '';
  // 手工拼接而非 URLSearchParams：后者会把空格编码成 `+`，
  // 后端按 RFC 3986 解码时会原样保留加号，导致文件名被改写。
  const parts = [
    ...(forceDownload ? ['download=1'] : []),
    ...(name ? [`name=${encodeURIComponent(name)}`] : []),
  ];
  if (parts.length === 0) return url;

  const hashIndex = url.indexOf('#');
  const pathPart = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const separator = pathPart.includes('?') ? '&' : '?';
  return `${pathPart}${separator}${parts.join('&')}${hash}`;
}

/**
 * 附件在磁盘上按 `att-<uuid>.<ext>` 存放，直接下载会拿到 UUID 文件名。
 * 这里把原始名与强制下载意图放进查询串，由后端回填 `Content-Disposition`，
 * 使「另存为」「新窗口打开」「跨源下载」都能得到正确文件名。
 */
export function buildReviewAttachmentDownloadUrl(attachment: ReviewAttachmentLink): string {
  return buildAttachmentUrl(attachment, true);
}

/** 内嵌/新窗口打开：保持 inline 渲染，但让后续「另存为」也能拿到原始文件名。 */
export function buildReviewAttachmentInlineUrl(attachment: ReviewAttachmentLink): string {
  return buildAttachmentUrl(attachment, false);
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

/**
 * 打开预览后先校验文件 URL 与响应状态。
 * 内容（iframe/img）与校验并行加载：校验只负责把失败态显式化，
 * 不阻塞正常场景的首帧渲染。
 */
async function validatePreviewTarget(target: ReviewAttachmentPreviewTarget): Promise<void> {
  const seq = ++validationSeq;
  previewStatus.value = 'loading';
  previewError.value = null;

  try {
    const response = await fetch(target.url, { method: 'HEAD', cache: 'no-store' });
    if (seq !== validationSeq) return;
    if (!response.ok) {
      previewStatus.value = 'error';
      previewError.value = `附件响应异常（HTTP ${response.status}）`;
      return;
    }
    previewStatus.value = 'ready';
  } catch {
    if (seq !== validationSeq) return;
    previewStatus.value = 'error';
    previewError.value = '附件加载失败，请检查网络连接';
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
    clearReviewAttachmentPreview();
    return false;
  }

  const target: ReviewAttachmentPreviewTarget = {
    taskId: normalizedTaskId,
    attachment,
    kind,
    url,
  };
  // 切换附件时清理上一附件的错误状态，避免错误信息残留
  previewTarget.value = target;
  void validatePreviewTarget(target);
  ensurePanelAndActivate('reviewAttachmentPreview');
  return true;
}

/** 失败后的重试入口（重新校验当前附件 URL） */
export function retryReviewAttachmentPreview(): void {
  const target = previewTarget.value;
  if (!target) return;
  void validatePreviewTarget(target);
}

/** 内容元素（img 等）加载失败时显式标记失败态；不关闭预览面板 */
export function markReviewAttachmentPreviewFailed(message: string): void {
  if (!previewTarget.value) return;
  previewStatus.value = 'error';
  previewError.value = message;
}

export function clearReviewAttachmentPreview(): void {
  validationSeq++;
  previewTarget.value = null;
  previewStatus.value = 'idle';
  previewError.value = null;
}
