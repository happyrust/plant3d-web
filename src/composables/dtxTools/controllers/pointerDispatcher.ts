/**
 * 画布指针事件的分发（ViewerPanel 接入点）：按工具模式把 pointerdown / move / up / cancel 交给拖框流程、拾取、测量，
 * 自己只管「是单击还是拖了相机」的判定与 none / pick_query_center / annotation_rect / annotation（文字）这几个单击即成的模式。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 9 步），实现未改。
 */
import { ref } from 'vue';

import { Box3, Vector3 } from 'three';

import { computeAabbObbFromBox3, createRectAnnotationRecordFromObb, getDefaultTextAnnotationLabelWorldPos } from '../annotationRecords';
import { nowId, parseRefnoFromDtxObjectId, vec3ToTuple } from '../geometry';

import type { DtxToolsContext } from '../context';
import type { createCloudCreationFlow } from './cloudCreationFlow';
import type { createMeasureController } from './measureController';
import type { createOverlayHost } from './overlayHost';
import type { createPickCandidateController } from './pickCandidateController';
import type { createSurfacePicker } from './surfacePicking';
import type { AnnotationRecord } from '@/composables/useToolStore';

export type PointerDispatcherDeps = {
  picker: ReturnType<typeof createSurfacePicker>;
  cloudFlow: ReturnType<typeof createCloudCreationFlow>;
  pick: ReturnType<typeof createPickCandidateController>;
  measure: ReturnType<typeof createMeasureController>;
  host: ReturnType<typeof createOverlayHost>;
};

export function createPointerDispatcher(ctx: DtxToolsContext, deps: PointerDispatcherDeps) {
  const { picker, cloudFlow, pick, measure, host } = deps;

  // click-based tools
  const clickTracker = ref<{ down: { x: number; y: number } | null; moved: boolean }>({ down: null, moved: false });
  const boxSelectState = ref<{ active: boolean; startX: number; startY: number; endX: number; endY: number } | null>(null);

  function onCanvasPointerDown(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ctx.ready.value) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };

    const mode = ctx.store.toolMode.value;
    if (ctx.suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') return;
    if (mode === 'annotation_obb' || mode === 'pick_refno_box') {
      cloudFlow.beginMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (ctx.pendingCloudAnchor.value) {
        cloudFlow.beginMarquee(canvas, e, mode);
      }
      return;
    }
    if (mode === 'annotation_rect') {
      return;
    }
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    const down = clickTracker.value.down;
    if (down) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (dx * dx + dy * dy > 9) clickTracker.value.moved = true;
    }

    const mode = ctx.store.toolMode.value;
    if (ctx.suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') return;
    if (mode === 'annotation_cloud' || mode === 'annotation_obb' || mode === 'pick_refno_box') {
      cloudFlow.moveMarquee(canvas, e, mode);
      return;
    }

  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ctx.ready.value) return;

    const mode = ctx.store.toolMode.value;
    if (ctx.suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    if (mode === 'annotation_obb' || mode === 'pick_refno_box') {
      cloudFlow.endMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (ctx.marqueeState.value.active) {
        cloudFlow.endMarquee(canvas, e, mode);
        return;
      }
      if (clickTracker.value.moved) {
        clickTracker.value = { down: null, moved: false };
        return;
      }
      clickTracker.value = { down: null, moved: false };
      if (!cloudFlow.canDrawCloudAnnotation()) {
        cloudFlow.notifyCloudGateBlocked('target');
        return;
      }
      const hit = picker.pickSurfacePoint(canvas, e);
      if (!hit) return;
      cloudFlow.setPendingCloudAnchor({
        worldPos: vec3ToTuple(hit.worldPos),
        refno: hit.entityId,
        entityId: hit.entityId,
      });
      return;
    }
    if (mode === 'annotation_rect') {
      const hit = picker.pickSurfacePoint(canvas, e);
      if (!hit) return;
      const compat = ctx.compatViewerRef.value;
      if (!compat) return;
      const pickedRefno = parseRefnoFromDtxObjectId(hit.objectId) || hit.entityId;
      const aabb = compat.scene.getAABB([pickedRefno]);
      if (!aabb) return;
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));
      const obb = computeAabbObbFromBox3(box);
      const n = ctx.store.rectAnnotations.value.length + 1;
      const rec = createRectAnnotationRecordFromObb({
        objectIds: [pickedRefno],
        refnos: [pickedRefno],
        obb,
        title: `矩形批注 ${n}`,
        regionV1: cloudFlow.buildSharedRegionForMembers([pickedRefno]) ?? undefined,
      });
      ctx.store.addRectAnnotation(rec);
      return;
    }

    // 防止相机拖拽结束误触发
    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    clickTracker.value = { down: null, moved: false };

    if (mode === 'none') {
      // 普通模式下的点击选择，支持 Shift 多选
      const hit = picker.pickSurfacePoint(canvas, e);
      if (!hit) {
        // 点击空白处，清除选择（除非按住 Shift）
        if (!e.shiftKey) {
          const viewer = ctx.compatViewerRef.value;
          if (viewer) {
            const prev = viewer.scene.selectedObjectIds;
            if (prev.length > 0) {
              viewer.scene.setObjectsSelected(prev, false);
            }
          }
        }
        return;
      }

      const refno = hit.entityId;
      const viewer = ctx.compatViewerRef.value;
      if (!viewer) return;

      viewer.scene.ensureRefnos([refno]);

      if (e.shiftKey) {
        // Shift 多选：切换选中状态
        const isSelected = viewer.scene.selectedObjectIds.includes(refno);
        viewer.scene.setObjectsSelected([refno], !isSelected);
      } else {
        // 单选：清除之前的选择，选中当前对象
        const prev = viewer.scene.selectedObjectIds;
        if (prev.length > 0) {
          viewer.scene.setObjectsSelected(prev, false);
        }
        viewer.scene.setObjectsSelected([refno], true);
      }
      return;
    }

    if (mode === 'pick_query_center') {
      const hit = picker.pickSurfacePoint(canvas, e);
      if (!hit) return;
      ctx.store.setPickedQueryCenter({ entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) });
      ctx.store.setToolMode('none');
      return;
    }

    if (pick.handlePointerUp(canvas, e, mode)) return;

    if (measure.handlePointerUp(canvas, e, mode)) return;

    // annotation: click to create text annotation
    if (mode === 'annotation') {
      const hit = picker.pickSurfacePoint(canvas, e);
      if (!hit) return;
      const n = ctx.store.annotations.value.length + 1;
      // 优先绑定当前点击命中的构件，避免沿用全局旧选中导致误绑。
      const boundRefno = String(hit.entityId || '').trim() || ctx.selectionStore.selectedRefno.value || undefined;
      const rec: AnnotationRecord = {
        id: nowId('anno'),
        entityId: hit.entityId,
        worldPos: vec3ToTuple(hit.worldPos),
        labelWorldPos: getDefaultTextAnnotationLabelWorldPos(vec3ToTuple(hit.worldPos)),
        collapsed: false,
        visible: true,
        glyph: `A${n}`,
        title: `批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refno: boundRefno,
      };
      ctx.store.addAnnotation(rec);
      return;
    }

    // 点击其它批注模式时，保持不误创建文字批注
  }

  function onCanvasPointerCancel(canvas: HTMLCanvasElement, e: PointerEvent) {
    void e;
    if (ctx.suppressStoreOverlays) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    const viewer = ctx.dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    host.hideMarquee();
    ctx.rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    try {
      ctx.rectPreviewLine.value?.geometry.dispose()
      ; (ctx.rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    ctx.rectPreviewLine.value = null;
    clickTracker.value = { down: null, moved: false };
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  return {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
  };
}
