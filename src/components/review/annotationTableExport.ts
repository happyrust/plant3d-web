/**
 * annotationTableExport · 批注表格数据的 CSV 序列化与浏览器下载
 *
 * 约定
 *   - 纯函数部分（escape / toCsv）无副作用，可在 SSR / 测试环境跑
 *   - downloadCsv 才涉及 DOM，调用方需保证在浏览器环境
 *   - UTF-8 with BOM，保证 Excel 中文不乱码
 */

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';
import { getAnnotationSeverityDisplay } from '@/types/auth';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export type AnnotationTableCsvColumn = {
  header: string;
  accessor: (item: AnnotationWorkspaceItem, index: number) => string | number | undefined | null;
};

// ------------------------------------------------------------
// CSV primitives
// ------------------------------------------------------------

/**
 * RFC 4180 CSV 字段转义。
 *
 * - 若含 `,` `"` `\n` `\r` 任一字符，需包裹双引号
 * - 原有双引号需转义为两个双引号 `"` → `""`
 * - null / undefined 统一输出为空串
 * - 数字转字符串，不保留千分位
 */
export function escapeCsvField(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return '';
  const stringValue = typeof value === 'number' ? String(value) : value;
  const needsQuote = /[",\n\r]/.test(stringValue);
  if (!needsQuote) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

/** 由多列拼接一行，默认用 `,` 分隔，行尾用 `\r\n`（Windows Excel 兼容） */
export function toCsvLine(fields: (string | number | undefined | null)[]): string {
  return fields.map(escapeCsvField).join(',');
}

// ------------------------------------------------------------
// Default columns · 与设计稿一致
// ------------------------------------------------------------

/** 格式化时间戳为 ISO 8601（Excel 识别） */
function formatTimestamp(ts?: number | null): string {
  if (!ts) return '';
  try {
    return new Date(ts).toISOString();
  } catch {
    return '';
  }
}

/** 默认列集合 · 对应校审记录卡「序号 / 错误标记 / 校核发现问题 / 处理情况 / refno / 活动时间」*/
export const DEFAULT_ANNOTATION_TABLE_COLUMNS: AnnotationTableCsvColumn[] = [
  { header: '序号', accessor: (_, index) => index + 1 },
  {
    header: '错误标记',
    accessor: (item) => getAnnotationSeverityDisplay(item.severity).label,
  },
  { header: '校核发现问题', accessor: (item) => item.title },
  { header: '问题描述', accessor: (item) => item.description },
  { header: 'RefNo', accessor: (item) => item.refnos.join(' ; ') },
  { header: '处理情况', accessor: (item) => item.statusLabel },
  { header: '最近活动时间', accessor: (item) => formatTimestamp(item.activityAt) },
  { header: '回复数', accessor: (item) => item.commentCount },
];

// ------------------------------------------------------------
// Main API
// ------------------------------------------------------------

/**
 * 将 items 序列化为 CSV 字符串。
 *
 * - 空数组也返回仅含表头的 CSV
 * - 默认列见 DEFAULT_ANNOTATION_TABLE_COLUMNS
 * - 输出末尾不带换行（便于直接拼接或传给 Blob）
 */
export function toAnnotationTableCsv(
  items: AnnotationWorkspaceItem[],
  columns: AnnotationTableCsvColumn[] = DEFAULT_ANNOTATION_TABLE_COLUMNS,
): string {
  const lines: string[] = [];
  lines.push(toCsvLine(columns.map((c) => c.header)));
  items.forEach((item, index) => {
    lines.push(toCsvLine(columns.map((c) => c.accessor(item, index))));
  });
  return lines.join('\r\n');
}

// ------------------------------------------------------------
// Browser download · 只能在 DOM 环境调用
// ------------------------------------------------------------

const UTF8_BOM = '\uFEFF';

/**
 * 触发浏览器下载。UTF-8 with BOM，确保 Excel 打开中文不乱码。
 *
 * 返回 true 表示下载流程已启动；false 表示不在浏览器环境（SSR / 单测）。
 */
export function downloadCsv(filename: string, content: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const blob = new Blob([UTF8_BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // 留一小段时间让浏览器开始下载再释放 blob
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

/**
 * 基于任务上下文生成推荐文件名，例：
 *   `plant3d-annotations-SJ-2026-0418-20260422.csv`
 */
export function buildCsvFilename(options: {
  taskKey?: string | null;
  at?: Date;
} = {}): string {
  const parts = ['plant3d-annotations'];
  const taskKey = options.taskKey?.trim();
  if (taskKey) {
    parts.push(taskKey.replace(/[^A-Za-z0-9_-]/g, ''));
  }
  const at = options.at ?? new Date();
  const yyyy = at.getFullYear();
  const mm = String(at.getMonth() + 1).padStart(2, '0');
  const dd = String(at.getDate()).padStart(2, '0');
  parts.push(`${yyyy}${mm}${dd}`);
  return `${parts.filter(Boolean).join('-')}.csv`;
}
