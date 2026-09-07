import type { ReviewAttachment } from '@/types/auth';

export type UploadedAttachmentLike = {
  name: string;
  size: number;
  type?: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  serverAttachmentId?: string;
  serverUrl?: string;
  uploadedAt?: number;
};

/** 恢复后的附件条目（与 FileUploadSection 的 UploadedFile 结构兼容，file 缺省） */
export type RestoredUploadedFile = {
  id: string;
  file?: File;
  name: string;
  size: number;
  type: string;
  status: 'success';
  progress: 100;
  serverAttachmentId: string;
  serverUrl: string;
  uploadedAt?: number;
};

export type AssociatedFilesSurfaceSummary = {
  badge: string;
  summary: string;
  detail: string;
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
};

/**
 * 附件上传并发上限。单文件上限 50MB，一次选中 10 个全并发会挤占上行带宽，
 * 让每条进度条都长时间停在低百分比，并更容易触发网关超时。
 */
export const ATTACHMENT_UPLOAD_CONCURRENCY = 3;

/** 以固定并发度消费任务列表；worker 自行处理异常，不因单个失败中断其余上传。 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  let cursor = 0;
  const runnerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  });

  await Promise.all(runners);
}

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

/** 按 mimeType → type → 扩展名 的顺序恢复附件 MIME 类型 */
export function resolveAttachmentMimeType(attachment: {
  name?: string;
  type?: string;
  mimeType?: string;
}): string {
  const declaredMime = attachment.mimeType?.trim();
  if (declaredMime && declaredMime.includes('/')) return declaredMime;

  const declaredType = attachment.type?.trim();
  if (declaredType && declaredType.includes('/')) return declaredType;

  const ext = attachment.name?.split('.').pop()?.trim().toLowerCase() ?? '';
  return EXTENSION_MIME_MAP[ext] ?? '';
}

/**
 * 把后端恢复的附件元数据转换为上传列表条目（纯函数，可单测）。
 *
 * 关键约束（防附件丢失回归）：
 * - 恢复条目必须是 `status: 'success'` 且带 `serverAttachmentId`/`serverUrl`，
 *   否则 `buildReviewAttachments` 在下一次保存时会把它们过滤掉，导致提交数据
 *   把附件数组裁剪为空。
 * - `size` 缺失时使用 0（界面显示“未知大小”），不再出现 `NaN undefined`。
 */
export function restoreUploadedFilesFromAttachments(
  attachments?: {
    id: string;
    name: string;
    url: string;
    size?: number;
    type?: string;
    mimeType?: string;
    uploadedAt?: number;
  }[] | null,
): RestoredUploadedFile[] {
  return (attachments ?? [])
    .filter((attachment) => !!attachment && !!attachment.id)
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name || '未命名附件',
      size: typeof attachment.size === 'number' && Number.isFinite(attachment.size)
        ? attachment.size
        : 0,
      type: resolveAttachmentMimeType(attachment),
      status: 'success' as const,
      progress: 100 as const,
      serverAttachmentId: attachment.id,
      serverUrl: attachment.url || '',
      uploadedAt: attachment.uploadedAt,
    }));
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
      uploadedAt: file.uploadedAt,
    } as ReviewAttachment));
}

/**
 * 把附件上传的 HTTP 错误映射为用户可理解的提示（纯函数，可单测）。
 * 其余错误保留服务器摘要，由调用方提供单项重试入口。
 */
export function formatAttachmentUploadError(
  status: number | null | undefined,
  serverMessage?: string | null,
): string {
  switch (status) {
    case 413:
      return '文件超过 50MB 上限，请压缩或拆分后重试';
    case 415:
      return serverMessage?.trim() || '文件格式或内容不匹配，已被服务器拒绝';
    case 504:
      return '校审附件服务暂不可用，请稍后重试';
    default: {
      const summary = serverMessage?.trim();
      if (summary) return summary;
      return status ? `上传失败（HTTP ${status}）` : '上传失败，请检查网络后重试';
    }
  }
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * 附件体积文案。上传区与附件列表原先各有一份实现（一个两位小数、一个一位小数），
 * 同一个文件在两处会显示成不同大小；统一到这里。
 */
export function formatAttachmentSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '未知大小';

  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0
    ? `${Math.round(size)} ${SIZE_UNITS[0]}`
    : `${size.toFixed(1)} ${SIZE_UNITS[unitIndex]}`;
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
