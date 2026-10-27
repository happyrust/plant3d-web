/**
 * useDtxTools 的 store / 样式 / 单位 / 视图器 watch，按原顺序集中注册（同一次 flush 里的执行顺序跟注册顺序走，所以不按所有者分散到各控制器）。
 * pick_refno 的 toolMode / pickedRefnos watch 在 pickCandidateController.installWatchers，比这里早注册，与拆分前一致。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 9 步），实现未改。
 */
import { watch } from 'vue';

import { clearGroup } from '../visuals';

import type { DtxToolsContext } from '../context';
import type { createCloudCreationFlow } from './cloudCreationFlow';
import type { createMeasureController } from './measureController';
import type { createOverlayHost } from './overlayHost';
import type { createOverlaySync } from './overlaySync';

export type DtxToolsWatcherDeps = {
  overlay: ReturnType<typeof createOverlaySync>;
  measure: ReturnType<typeof createMeasureController>;
  cloudFlow: ReturnType<typeof createCloudCreationFlow>;
  host: ReturnType<typeof createOverlayHost>;
};

export function installDtxToolsWatchers(ctx: DtxToolsContext, deps: DtxToolsWatcherDeps): void {
  const { overlay, measure, cloudFlow, host } = deps;

  watch(
    () => ({
      measurements: ctx.store.measurements.value,
      annotations: ctx.store.annotations.value,
      cloudAnnotations: ctx.store.cloudAnnotations.value,
      rectAnnotations: ctx.store.rectAnnotations.value,
      obbAnnotations: ctx.store.obbAnnotations.value,
      activeAnnotationId: ctx.store.activeAnnotationId.value,
      activeCloudAnnotationId: ctx.store.activeCloudAnnotationId.value,
      activeRectAnnotationId: ctx.store.activeRectAnnotationId.value,
      activeObbAnnotationId: ctx.store.activeObbAnnotationId.value,
    }),
    () => {
      if (!ctx.dtxViewerRef.value || !ctx.overlayContainerRef.value) return;
      overlay.syncFromStore();
    },
    { deep: true }
  );

  watch(
    () => ctx.annotationStyleStore.cloudDrawMode.value,
    () => {
      if (!ctx.dtxViewerRef.value || !ctx.overlayContainerRef.value) return;
      overlay.syncFromStore();
      ctx.requestRender?.();
    },
  );

  watch(
    () => ctx.annotationStyleStore.style.cloud,
    () => {
      if (!ctx.dtxViewerRef.value || !ctx.overlayContainerRef.value) return;
      overlay.syncFromStore();
      ctx.requestRender?.();
    },
    { deep: true },
  );

  // ADR-0050：解析表整表替换（模型加载 / 定位回执 / 详情卡重算 / 批注后到）→ 就地换降级外观，不重建 overlay
  watch(ctx.bindingResolve.entries, () => {
    if (!ctx.dtxViewerRef.value || !ctx.overlayContainerRef.value) return;
    overlay.applyBindingDegrade();
  });

  // pick_refno：候选变化与取消拾取时同步高亮

  // 显示单位变化：刷新测量标签等 overlay 文本
  watch(
    () => [ctx.unitSettings.displayUnit.value, ctx.unitSettings.precision.value],
    () => {
      if (!ctx.dtxViewerRef.value || !ctx.overlayContainerRef.value) return;
      overlay.syncFromStore();
      ctx.requestRender?.();
    }
  );

  watch(
    () => [ctx.store.toolMode.value, ctx.selectionStore.selectedRefnos.value.join('|')] as const,
    ([mode, selectedRefnos]) => {
      if (mode !== 'measure_object_to_object') return;
      const refnos = selectedRefnos
        .split('|')
        .map((refno) => refno.trim())
        .filter(Boolean);
      measure.handleTreeObjectMeasureSelection(refnos);
    },
    { immediate: true },
  );

  watch(
    () => ctx.store.cloudTargetRefnos.value.join('|'),
    () => {
      cloudFlow.clearPendingCloudAnchor();
      host.hideMarquee();
    },
  );

  watch(
    () => ctx.store.toolMode.value,
    (mode, prev) => {
      if (mode !== prev) {
        measure.resetProgress();
      }
      const pickingCloudTargets = mode === 'pick_refno' || mode === 'pick_refno_box';
      const wasPickingCloudTargets = prev === 'pick_refno' || prev === 'pick_refno_box';
      if (
        !pickingCloudTargets &&
        mode !== 'annotation_cloud' &&
        (prev === 'annotation_cloud' || wasPickingCloudTargets)
      ) {
        // 退到 none 只是「收起工具」，目标集合留着待复用；
        // 切到别的工具才是「换活儿」，按方案 §2.1 清理到底。
        if (mode === 'none') cloudFlow.suspendCloudCreation();
        else cloudFlow.cancelCloudCreation();
      }
      if (mode === 'none' && prev !== 'none') {
        host.hideMarquee();
      }
    }
  );

  watch(
    () => ctx.dtxViewerRef.value,
    (viewer, prev) => {
      if (prev && ctx.toolsGroup.parent === prev.scene) {
        prev.scene.remove(ctx.toolsGroup);
      }
      if (viewer) {
        host.ensureToolsGroupAttached();
        overlay.syncFromStore();
      } else {
        clearGroup(ctx.toolsGroup);
        host.clearOverlayEls();
      }
    },
    { immediate: true }
  );
}
