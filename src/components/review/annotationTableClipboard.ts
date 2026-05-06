/**
 * annotationTableClipboard · 批注行的复制工具
 *
 * - copyToClipboard · 带 execCommand 兜底
 * - buildRowClipboardLine · 生成"记录卡单行"格式
 */

import {
  DEFAULT_ANNOTATION_TABLE_COLUMNS,
  toCsvLine,
} from './annotationTableExport';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

export type ClipboardResult = 'copied' | 'fallback' | 'failed';

/**
 * 写入文本到剪贴板：
 *   · 优先 navigator.clipboard（需 HTTPS / 安全上下文）
 *   · 降级 document.execCommand('copy')
 *   · 都不可用时返回 'failed'（调用方做 toast 提示）
 */
export async function copyToClipboard(text: string): Promise<ClipboardResult> {
  try {
    if (typeof navigator !== 'undefined'
      && typeof navigator.clipboard !== 'undefined'
      && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // fall through to execCommand
  }

  if (typeof document === 'undefined') return 'failed';

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.left = '-1000px';
    textarea.setAttribute('readonly', 'readonly');
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok ? 'fallback' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * 按默认列生成一行 CSV 字符串（纯行，不带表头），
 * 可直接粘贴到 Excel 当作新行。
 */
export function buildRowClipboardLine(item: AnnotationWorkspaceItem, index = 0): string {
  const fields = DEFAULT_ANNOTATION_TABLE_COLUMNS.map((col) => col.accessor(item, index));
  return toCsvLine(fields);
}

/**
 * 拿到 item 的 refno 短显示（首个 refno，若有多个用 ";" 连接）。
 * 无 refno 时返回空串。
 */
export function pickItemRefno(item: AnnotationWorkspaceItem): string {
  if (!item.refnos.length) return '';
  return item.refnos.join(' ; ');
}
