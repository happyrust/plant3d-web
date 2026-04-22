/**
 * annotationTableHighlight · 搜索关键字高亮渲染（安全 HTML）
 *
 * 用法：v-html="highlightMatches(text, query)"
 * 实现：先 escapeHtml 转义原文，再把匹配的子串包裹 <mark> 标签
 *
 * 防 XSS：先整段 escape，所有 <> 都变为 &lt;&gt;，之后拼接的 <mark> 标签是
 *        本模块自己产生的、不含用户输入，安全可控。
 */

import { normalizeSearchQuery } from './annotationTableSorting';

/** HTML 转义：< > & " ' */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** RegExp 元字符转义（用于把搜索 query 当字面量匹配） */
function escapeRegExpLiteral(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 text 中匹配 query 的片段包在 <mark> 里返回 HTML 字符串。
 *
 * - 空 query / 空 text 一律直接返回 escapeHtml(text)
 * - 匹配不区分大小写
 * - 多段匹配全部高亮
 * - 返回值可直接塞给 v-html（已转义）
 */
export function highlightMatches(text: string | null | undefined, query: string): string {
  if (text == null) return '';
  const safe = escapeHtml(text);
  const needle = normalizeSearchQuery(query);
  if (!needle) return safe;

  const pattern = new RegExp(`(${escapeRegExpLiteral(needle)})`, 'gi');
  return safe.replace(pattern, '<mark class="bg-amber-200 text-slate-950 rounded-[2px] px-[1px]">$1</mark>');
}

/**
 * 工具函数：判断 text 是否包含 query（大小写不敏感）
 * 便于调用方预判是否需要高亮，节省重渲染。
 */
export function hasMatch(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  const needle = normalizeSearchQuery(query);
  if (!needle) return false;
  return text.toLowerCase().includes(needle);
}
