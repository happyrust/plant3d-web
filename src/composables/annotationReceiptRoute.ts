/**
 * U0 数据类回执的落点执行（交互方案 2026-09-14 §3.6「A 任务截图上传返回时用户已在 B，只能归属 A」，决策 d-565）。
 *
 * `useAnnotationDraftSession().routeDataReceipt(stamp)` 只判「该落到哪」；这里负责「按落点写」：
 * - `current` / `unscoped` → 走内存 API（调用方给的 `applyInMemory`）；
 * - `other-scope` → 写进出发时那个 scope 的本机容器（`useToolStore.patchPersistedAnnotationInScope`），不碰当前任务的内存。
 *
 * 截图挂载（云线自动截图 / 批注面板重拍 / 详情卡重拍）与保存失败回滚（严重度 / 标题）共用，别各写一份。
 * 没有 Vue、没有 localStorage 访问——存储细节都在 store 里。
 */

import type { DataReceiptRoute } from '@/composables/useAnnotationDraftSession';
import type { AnnotationType } from '@/composables/useToolStore';

import { normalizeAnnotationScreenshot, type AnnotationScreenshot } from '@/types/auth';

export type ScopedPatchStore = {
  /** 见 `useToolStore.patchPersistedAnnotationInScope`；测试替身可以没有，那时 other-scope 一律算没落上 */
  patchPersistedAnnotationInScope?: (
    scope: string,
    type: AnnotationType,
    id: string,
    patch: Record<string, unknown>,
  ) => boolean;
};

/**
 * 按落点写一条批注 patch。返回 true = 已落到该落的地方；false = 目标批注已不在（内存里 / 那个容器里都找不到）。
 * `applyInMemory` 只在 `current` / `unscoped` 时被调用。
 */
export function applyAnnotationReceiptByRoute(
  store: ScopedPatchStore,
  route: DataReceiptRoute,
  annotationType: AnnotationType,
  annotationId: string,
  patch: Record<string, unknown>,
  applyInMemory: () => boolean,
): boolean {
  if (route.kind === 'other-scope') {
    return store.patchPersistedAnnotationInScope?.(route.scopeKey, annotationType, annotationId, patch) ?? false;
  }
  return applyInMemory();
}

export type ScreenshotReceiptStore = ScopedPatchStore & {
  setAnnotationScreenshot: (type: AnnotationType, id: string, screenshot: AnnotationScreenshot) => boolean;
};

/**
 * 截图回执按落点挂到批注上（与 `setAnnotationScreenshot` 同一份归一：url 解析、字段过滤）。
 * 返回 false = 截图无效或目标批注已不在，调用方应删掉刚上传的附件，别留孤儿。
 */
export function attachAnnotationScreenshotByRoute(
  store: ScreenshotReceiptStore,
  route: DataReceiptRoute,
  annotationType: AnnotationType,
  annotationId: string,
  screenshot: AnnotationScreenshot,
): boolean {
  const normalized = normalizeAnnotationScreenshot(screenshot);
  if (!normalized) return false;
  return applyAnnotationReceiptByRoute(
    store,
    route,
    annotationType,
    annotationId,
    { screenshot: normalized },
    () => store.setAnnotationScreenshot(annotationType, annotationId, normalized),
  );
}
