/**
 * designerCommentViewModeBus · 批注处理 dock 的 viewMode 请求总线
 *
 * MVP PR 4 · 2026-04-23
 *
 * 场景：Ribbon "批注表格" 按钮 → DockLayout → DesignerCommentHandlingPanel 切 viewMode。
 * 采用"latest value" ref 而不是 commandBus 即发即触，原因是面板可能此时才 mount，
 * 需要保证挂载后能读到最近一次请求（与 annotationProcessingEntry 风格一致）。
 */

import { readonly, ref } from 'vue';

export type DesignerCommentViewMode = 'split' | 'table';

export type DesignerCommentViewModeRequest = {
  mode: DesignerCommentViewMode;
  requestedAt: number;
};

const requestRef = ref<DesignerCommentViewModeRequest | null>(null);

/** 只读引用 · 供面板 watch · 禁止外部直接写入 */
export function useDesignerCommentViewModeRequest() {
  return readonly(requestRef);
}

/** 发起一次 viewMode 请求（由 Ribbon / DockLayout 触发） */
export function requestDesignerCommentViewMode(mode: DesignerCommentViewMode): void {
  requestRef.value = { mode, requestedAt: Date.now() };
}

/** 面板消费请求后清空 · 避免重复响应 */
export function clearDesignerCommentViewModeRequest(): void {
  requestRef.value = null;
}
