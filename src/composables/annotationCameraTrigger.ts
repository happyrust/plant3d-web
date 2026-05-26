/**
 * annotationCameraTrigger · 校审批注「相机入口」跨组件请求总线
 *
 * 场景：viewer 浮动 AnnotationOverlayBar 的相机按钮在「已选中批注」时，
 * 需要复用 AnnotationPanel 现有的预览-确认弹窗（`openActiveAnnotationShotPreview`），
 * 而 OverlayBar 与 AnnotationPanel 不在同一组件树，直接 emit/props 不可达。
 *
 * 设计与 `reviewerWorkbenchViewModeBus` / `designerCommentViewModeBus` 同构：
 * latest-value ref + readonly 公开 + 消费后 clear，避免跨组件 race。
 *
 * 「未选中批注」时 OverlayBar 直接走 pending 流程，不经此 bus。
 */

import { readonly, ref } from 'vue';

export type ActiveAnnotationCameraRequest = {
  requestedAt: number;
};

const requestRef = ref<ActiveAnnotationCameraRequest | null>(null);

/** 只读引用 · 供 AnnotationPanel watch · 禁止外部直接写入 */
export function useActiveAnnotationCameraRequest() {
  return readonly(requestRef);
}

/** 发起一次「打开当前选中批注的截图预览弹窗」请求 */
export function requestActiveAnnotationCamera(): void {
  requestRef.value = { requestedAt: Date.now() };
}

/** 面板消费请求后清空 · 避免重复响应 */
export function clearActiveAnnotationCameraRequest(): void {
  requestRef.value = null;
}
