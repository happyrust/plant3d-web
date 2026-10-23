import { markRaw, readonly, ref, shallowReadonly, shallowRef } from 'vue';

import type { ReviewAttachment } from '@/types/auth';

import { getAuthToken } from '@/api/reviewApi';
import { emitCommand } from '@/ribbon/commandBus';
import {
  FileValidationError,
  failFileValidation,
  validateAttachmentBytes,
} from '@/utils/fileValidation';

export type ReviewAttachmentPreviewKind = 'pdf' | 'image' | 'word';

export type ReviewAttachmentPreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ReviewAttachmentPreviewTarget {
  taskId: string;
  attachment: ReviewAttachment;
  kind: ReviewAttachmentPreviewKind;
  url: string;
}

export type ReviewAttachmentWordFile = {
  bytes: ArrayBuffer;
  fileName: string;
};

const previewTarget = shallowRef<ReviewAttachmentPreviewTarget | null>(null);
const previewStatus = ref<ReviewAttachmentPreviewStatus>('idle');
const previewError = ref<string | null>(null);
const previewWordFile = shallowRef<ReviewAttachmentWordFile | null>(null);
let validationController: AbortController | null = null;
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_WORD_BYTES = 50 * 1024 * 1024;

// 校验请求的序号；切换附件后旧请求的结果直接丢弃
let validationSeq = 0;

export const activeReviewAttachmentPreview = readonly(previewTarget);
export const reviewAttachmentPreviewStatus = readonly(previewStatus);
export const reviewAttachmentPreviewError = readonly(previewError);
export const reviewAttachmentWordFile = shallowReadonly(previewWordFile);

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
  if (extension === 'doc' || extension === 'docx' || declaredType === WORD_MIME || declaredType === 'application/msword') return 'word';
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

function dataUrlMime(url: string): string | null {
  if (!/^data:/i.test(url)) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  return url.slice(5, comma).split(';', 1)[0]?.trim().toLowerCase() || null;
}

function inlineMimeMatchesKind(mime: string, kind: ReviewAttachmentPreviewKind): boolean {
  if (kind === 'pdf') return mime === 'application/pdf';
  if (kind === 'image') return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg';
  return mime === 'application/msword' || mime === WORD_MIME;
}

function decodeDataUrlPrefix(url: string, maxBytes: number): Uint8Array | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      const clean = payload.replace(/\s/g, '');
      let slice = clean.slice(0, Math.ceil(maxBytes / 3) * 4);
      if (!slice) return null;
      while (slice.length % 4 !== 0) slice += '=';
      const binary = atob(slice);
      const bytes = new Uint8Array(Math.min(binary.length, maxBytes));
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload).slice(0, maxBytes));
  } catch {
    return null;
  }
}

/** data URL 只接受本预览能核对签名的类型；blob 只接受当前页面自己创建的地址。 */
function acceptInlinePreviewUrl(
  url: string,
  kind: ReviewAttachmentPreviewKind,
  sourceName: string,
): string | null {
  if (/^blob:/i.test(url)) {
    try {
      if (new URL(url.slice(5)).origin !== window.location.origin) return null;
    } catch {
      return null;
    }
    return url;
  }
  const mime = dataUrlMime(url);
  if (!mime || !inlineMimeMatchesKind(mime, kind)) return null;
  const prefix = decodeDataUrlPrefix(url, 1024);
  if (!prefix) return null;
  try {
    if (mime === 'application/msword') validateLegacyWordBytes(prefix, sourceName);
    else if (mime === 'image/png') validateAttachmentBytes(prefix, sourceName, 'png');
    else if (mime === 'image/jpeg' || mime === 'image/jpg') validateAttachmentBytes(prefix, sourceName, 'jpeg');
    else if (mime === WORD_MIME) validateAttachmentBytes(prefix, sourceName, 'docx');
    else validateAttachmentBytes(prefix, sourceName, 'pdf');
  } catch {
    return null;
  }
  return url;
}

function resolveSafeAttachmentUrl(
  url: string,
  kind: ReviewAttachmentPreviewKind,
  sourceName: string,
): string | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return null;
  if (/^(data|blob):/i.test(trimmedUrl)) {
    return acceptInlinePreviewUrl(trimmedUrl, kind, sourceName);
  }
  try {
    const resolved = new URL(trimmedUrl, window.location.href);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

function readPreviewToken(): string | null {
  try {
    return getAuthToken();
  } catch {
    return null;
  }
}

function previewFetchHeaders(target: ReviewAttachmentPreviewTarget): Record<string, string> {
  const headers: Record<string, string> = {};
  if (target.kind !== 'word') headers.Range = 'bytes=0-1023';
  if (/^https?:/i.test(target.url)) {
    const token = readPreviewToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function attachmentValidationFormat(
  target: ReviewAttachmentPreviewTarget,
): 'pdf' | 'png' | 'jpeg' | 'docx' {
  if (target.kind === 'word') return 'docx';
  if (target.kind === 'pdf') return 'pdf';
  const declared = (target.attachment.mimeType || target.attachment.type || '').toLowerCase();
  const extension = target.attachment.name.split('.').pop()?.toLowerCase();
  return declared.includes('png') || extension === 'png' ? 'png' : 'jpeg';
}

async function readWordBuffer(response: Response): Promise<ArrayBuffer> {
  if (Number(response.headers.get('content-length')) > MAX_WORD_BYTES) throw new Error('Word 文件超过 50MB 预览上限，请下载后查看');
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_WORD_BYTES) throw new Error('Word 文件超过 50MB 预览上限，请下载后查看');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WORD_BYTES) throw new Error('Word 文件超过 50MB 预览上限，请下载后查看');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
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
  validationController?.abort();
  const controller = new AbortController();
  validationController = controller;
  const timeout = setTimeout(() => controller.abort(), 60_000);
  previewStatus.value = 'loading';
  previewError.value = null;
  previewWordFile.value = null;

  try {
    const format = attachmentValidationFormat(target);
    const legacyWord = isLegacyWordAttachment(target);
    const response = await fetch(target.url, {
      method: 'GET',
      headers: previewFetchHeaders(target),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (seq !== validationSeq) return;
    if (!response.ok || (target.kind === 'word' && response.status !== 200)) {
      failFileValidation({
        source: target.attachment.name,
        format,
        reason: '附件响应状态无效',
        expected: 'HTTP 200 或 206',
        actual: `HTTP ${response.status}`,
      });
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    const expectedTypes = format === 'docx'
      ? legacyWord
        ? ['application/msword', 'application/octet-stream']
        : [WORD_MIME, 'application/octet-stream']
      : format === 'pdf'
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
    const wordBuffer = target.kind === 'word' ? await readWordBuffer(response) : null;
    const prefix = wordBuffer ? new Uint8Array(wordBuffer).subarray(0, 1024) : await readResponsePrefix(response);
    if (seq !== validationSeq) return;
    if (legacyWord) validateLegacyWordBytes(prefix, target.attachment.name);
    else validateAttachmentBytes(prefix, target.attachment.name, format);
    if (wordBuffer) {
      previewWordFile.value = markRaw({ bytes: wordBuffer, fileName: target.attachment.name });
    }
    previewStatus.value = 'ready';
  } catch (error) {
    if (seq !== validationSeq) return;
    previewStatus.value = 'error';
    previewError.value = error instanceof FileValidationError
      ? error.message
      : `附件加载失败：${error instanceof Error ? error.message : '请检查网络连接'}`;
  } finally {
    clearTimeout(timeout);
    if (validationController === controller) validationController = null;
  }
}

export function openReviewAttachmentPreview(
  taskId: string,
  attachment: ReviewAttachment,
): boolean {
  const normalizedTaskId = taskId.trim();
  const kind = getReviewAttachmentPreviewKind(attachment);
  const url = kind ? resolveSafeAttachmentUrl(attachment.url, kind, attachment.name) : null;
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
  // 面板已经在别的页签里时，也要走分屏命令，不能只 setActive。
  emitCommand('panel.reviewAttachmentPreview');
  return true;
}

/** 正在预览的附件被删掉时关掉预览。别的附件不受影响。 */
export function clearReviewAttachmentPreviewIfShowing(attachmentId: string | null | undefined): void {
  const id = attachmentId?.trim();
  if (!id) return;
  if (previewTarget.value?.attachment.id === id) clearReviewAttachmentPreview();
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
  validationController?.abort();
  validationController = null;
  previewTarget.value = null;
  previewStatus.value = 'idle';
  previewError.value = null;
  previewWordFile.value = null;
}

const LEGACY_WORD_OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isLegacyWordAttachment(target: ReviewAttachmentPreviewTarget): boolean {
  return target.kind === 'word' && (
    target.attachment.name.toLowerCase().endsWith('.doc')
    || (target.attachment.mimeType === 'application/msword' && !target.attachment.name.toLowerCase().endsWith('.docx'))
  );
}

function validateLegacyWordBytes(bytes: Uint8Array, source: string): void {
  const ole = bytes.length >= LEGACY_WORD_OLE.length
    && LEGACY_WORD_OLE.every((byte, index) => bytes[index] === byte);
  if (ole) return;
  failFileValidation({
    source,
    format: 'docx',
    reason: '文件签名与声明类型不一致（仅支持标准 OLE 二进制 .doc）',
    expected: 'd0 cf 11 e0 a1 b1 1a e1',
    actual: Array.from(bytes.subarray(0, 8)).map(byte => byte.toString(16).padStart(2, '0')).join(' ') || '空响应',
  });
}
