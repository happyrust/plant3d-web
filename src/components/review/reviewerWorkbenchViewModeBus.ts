/**
 * reviewerWorkbenchViewModeBus · 校核工作台（ReviewPanel）viewMode 请求总线
 *
 * MVP++ PR 9 · 2026-04-23
 *
 * 场景：Ribbon "批注表格" 按钮 → DockLayout 智能分发 → ReviewPanel 切 viewMode。
 * 设计与 designerCommentViewModeBus 同构（latest-value ref 模式），
 * 但保持独立通道，避免两个面板互相污染；参见
 * docs/plans/2026-04-23-ribbon-annotation-table-smart-dispatch-pr9-design.md。
 */

import { readonly, ref } from 'vue';

export type ReviewerWorkbenchViewMode = 'split' | 'table';

export type ReviewerWorkbenchViewModeRequest = {
  mode: ReviewerWorkbenchViewMode;
  requestedAt: number;
};

const requestRef = ref<ReviewerWorkbenchViewModeRequest | null>(null);

/** 只读引用 · 供 ReviewPanel watch · 禁止外部直接写入 */
export function useReviewerWorkbenchViewModeRequest() {
  return readonly(requestRef);
}

/** 发起一次 viewMode 请求（由 Ribbon / DockLayout 触发） */
export function requestReviewerWorkbenchViewMode(mode: ReviewerWorkbenchViewMode): void {
  requestRef.value = { mode, requestedAt: Date.now() };
}

/** 面板消费请求后清空 · 避免重复响应 */
export function clearReviewerWorkbenchViewModeRequest(): void {
  requestRef.value = null;
}
