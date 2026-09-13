import { readonly, ref, shallowRef } from 'vue';

import { ensurePanelAndActivate } from './useDockApi';

import type { ReviewAttachment } from '@/types/auth';

import {
  FileValidationError,
  failFileValidation,
  validateAttachmentBytes,
} from '@/utils/fileValidation';

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

function attachmentValidationFormat(
  target: ReviewAttachmentPreviewTarget,
): 'pdf' | 'png' | 'jpeg' {
  if (target.kind === 'pdf') return 'pdf';
  const declared = (target.attachment.mimeType || target.attachment.type || '').toLowerCase();
  const extension = target.attachment.name.split('.').pop()?.toLowerCase();
  return declared.includes('png') || extension === 'png' ? 'png' : 'jpeg';
}

async function readResponsePrefix(response: Response, maxBytes = 1024): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer()).subarray(0, maxBytes);
  }
  const reader = response.body.getReader();
  const prefix = new Uint8Array(maxBytes);
  let written = 0;
  try {
    while (written < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.byteLength, maxBytes - written);
      prefix.set(value.subarray(0, take), written);
      written += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return prefix.subarray(0, written);
}

/** Validate status, declared media type and file signature before rendering. */
async function validatePreviewTarget(target: ReviewAttachmentPreviewTarget): Promise<void> {
  const seq = ++validationSeq;
  previewStatus.value = 'loading';
  previewError.value = null;

  try {
    const format = attachmentValidationFormat(target);
    const response = await fetch(target.url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1023' },
      cache: 'no-store',
    });
    if (seq !== validationSeq) return;
    if (!response.ok) {
      failFileValidation({
        source: target.attachment.name,
        format,
        reason: '附件响应状态无效',
        expected: 'HTTP 200 或 206',
        actual: `HTTP ${response.status}`,
      });
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    const expectedTypes = format === 'pdf'
      ? ['application/pdf', 'application/octet-stream']
      : format === 'png'
        ? ['image/png', 'application/octet-stream']
        : ['image/jpeg', 'application/octet-stream'];
    if (contentType && !expectedTypes.includes(contentType)) {
      failFileValidation({
        source: target.attachment.name,
        format,
        reason: '附件 Content-Type 与声明类型不一致',
        expected: expectedTypes.join(' 或 '),
        actual: contentType,
      });
    }
    const prefix = await readResponsePrefix(response);
    if (seq !== validationSeq) return;
    validateAttachmentBytes(prefix, target.attachment.name, format);
    previewStatus.value = 'ready';
  } catch (error) {
    if (seq !== validationSeq) return;
    previewStatus.value = 'error';
    previewError.value = error instanceof FileValidationError
      ? error.message
      : `附件加载失败：${error instanceof Error ? error.message : '请检查网络连接'}`;
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
