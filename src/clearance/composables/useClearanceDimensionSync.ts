import { watch, type Ref, type WatchStopHandle } from 'vue';

import type { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import type { ExternalDimensionRecord } from '@/dimension';

import {
  CLEARANCE_EXTERNAL_SOURCE,
  clearanceRecordsToExternalDimensions,
} from '@/clearance/adapters/clearanceExternalDimensions';

/** 只用到尺寸系统的这一格，便于测试用假对象。 */
export type ClearanceDimensionSink = Readonly<{
  replaceExternalSource(source: 'clearance', records: readonly ExternalDimensionRecord[]): void;
}>;

/**
 * store 里可见的 Clearance 记录 → 外部尺寸源 `clearance`（09-11 PR1.1 第 4 条：外部尺寸源只负责画）。
 * 与 `usePipeDistanceAnnotationThree` 同一形状：watch 记录 / 开关 / 尺寸系统三者，任一变化整源替换。
 */
export function useClearanceDimensionSync(
  dimensionSystemRef: Ref<ClearanceDimensionSink | null>,
  clearanceStore: Pick<ReturnType<typeof useClearanceStore>, 'visibleRecords' | 'showAnnotations'>,
  requestRender?: () => void,
) {
  let lastSkipped = 0;

  function sync() {
    const system = dimensionSystemRef.value;
    if (!system) return;
    if (!clearanceStore.showAnnotations.value) {
      system.replaceExternalSource(CLEARANCE_EXTERNAL_SOURCE, []);
      requestRender?.();
      return;
    }
    const result = clearanceRecordsToExternalDimensions(clearanceStore.visibleRecords.value);
    system.replaceExternalSource(CLEARANCE_EXTERNAL_SOURCE, result.records);
    if (result.skipped.length !== lastSkipped) {
      lastSkipped = result.skipped.length;
      if (result.skipped.length > 0 && import.meta.env.DEV) {
        console.debug('[clearance] records without a drawable dimension', result.skipped);
      }
    }
    requestRender?.();
  }

  function clear() {
    dimensionSystemRef.value?.replaceExternalSource(CLEARANCE_EXTERNAL_SOURCE, []);
    requestRender?.();
  }

  const stop: WatchStopHandle = watch(
    [dimensionSystemRef, clearanceStore.visibleRecords, clearanceStore.showAnnotations],
    sync,
    { deep: true, immediate: true },
  );

  return { sync, clear, stop };
}
