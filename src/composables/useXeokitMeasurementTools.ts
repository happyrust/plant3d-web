import { computed, ref, watch, type Ref } from 'vue';

import { Box3, Vector2, Vector3 } from 'three';

import { getXeokitOverlayPalette } from './xeokitMeasurementUi';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { XeokitAngleMeasurementParams } from '@/utils/three/annotation/annotations/XeokitAngleMeasurement';
import type { XeokitDistanceMeasurementParams } from '@/utils/three/annotation/annotations/XeokitDistanceMeasurement';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import {
  useToolStore,
  type MeasurementPoint,
  type Vec3,
  type XeokitAngleDraft,
  type XeokitAngleMeasurementRecord,
  type XeokitDistanceDraft,
  type XeokitDistanceMeasurementRecord,
  type XeokitMarkerRole,
  type XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import { XeokitAngleMeasurement } from '@/utils/three/annotation/annotations/XeokitAngleMeasurement';
import { XeokitDistanceMeasurement } from '@/utils/three/annotation/annotations/XeokitDistanceMeasurement';

type AnnotationInstance = XeokitDistanceMeasurement | XeokitAngleMeasurement;

type ClickTracker = {
  down: { x: number; y: number } | null;
  moved: boolean;
};

const XEOKIT_PREFIX = 'xmeas_';
const XEOKIT_DISTANCE_DRAFT_ID = `${XEOKIT_PREFIX}draft_distance`;
const XEOKIT_ANGLE_DRAFT_ID = `${XEOKIT_PREFIX}draft_angle`;
const CLICK_TOLERANCE = 20;

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function vec3ToTuple(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function tupleToVector(v: Vec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(e.clientX - rect.left, e.clientY - rect.top);
}

function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  if (points.length === 0) return null;
  const box = new Box3();
  for (const point of points) {
    box.expandByPoint(tupleToVector(point));
  }
  if (box.isEmpty()) return null;
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

function isAngleDraft(record: XeokitMeasurementRecord): record is XeokitAngleDraft {
  return record.kind === 'angle' && 'stage' in record;
}

export function useXeokitMeasurementTools(options: {
  dtxViewerRef: Ref<DtxViewer | null>;
  dtxLayerRef: Ref<DTXLayer | null>;
  selectionRef: Ref<DTXSelectionController | null>;
  overlayContainerRef: Ref<HTMLElement | null>;
  annotationSystemRef?: Ref<UseAnnotationThreeReturn | null>;
  store: ReturnType<typeof useToolStore>;
  compatViewerRef: Ref<DtxCompatViewer | null>;
  requestRender?: (() => void) | null;
}) {
  const {
    dtxViewerRef,
    dtxLayerRef,
    selectionRef,
    overlayContainerRef,
    compatViewerRef,
    store,
  } = options;
  const requestRender = options.requestRender ?? null;

  const readyRevision = ref(0);
  const clickTracker = ref<ClickTracker>({ down: null, moved: false });
  const annotations = new Map<string, AnnotationInstance>();
  let hoverMarkerEl: HTMLDivElement | null = null;
  let pointerLensEl: HTMLDivElement | null = null;

  const currentMeasurement = computed(() => {
    return store.currentXeokitDistanceDraft.value ?? store.currentXeokitAngleDraft.value ?? null;
  });

  const ready = computed(() => {
    const revision = readyRevision.value;
    void revision;
    if (!dtxViewerRef.value || !dtxLayerRef.value || !selectionRef.value) return false;
    const layer = dtxLayerRef.value as any;
    const totalObjects = Number(layer?._totalObjects ?? layer?.objectCount ?? layer?.getStats?.()?.totalObjects ?? 0);
    return totalObjects > 0;
  });

  const statusText = computed(() => {
    const mode = store.toolMode.value;
    if (mode !== 'xeokit_measure_distance' && mode !== 'xeokit_measure_angle') {
      return '当前非测量模式';
    }
    if (!dtxViewerRef.value) return '三维查看器未初始化';
    if (!dtxLayerRef.value) return 'DTX 图层未初始化';
    if (!selectionRef.value) return '拾取控制器未就绪';
    if (!ready.value) return '等待测量所需模型就绪…';

    if (mode === 'xeokit_measure_distance') {
      return store.currentXeokitDistanceDraft.value
        ? '距离测量：移动鼠标预览，第二击完成；点空白取消'
        : '距离测量：第一击创建测量，随后 hover 预览';
    }

    const draft = store.currentXeokitAngleDraft.value;
    if (!draft) return '角度测量：第一击创建测量';
    if (draft.stage === 'finding_corner') return '角度测量：第二击锁定拐点；点空白取消';
    return '角度测量：第三击完成；点空白取消';
  });

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  function isActiveMode() {
    return store.toolMode.value === 'xeokit_measure_distance' || store.toolMode.value === 'xeokit_measure_angle';
  }

  function buildMeasurementAnnotationId(id: string): string {
    return `${XEOKIT_PREFIX}${id}`;
  }

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const selection = selectionRef.value;
    if (!selection) return null;
    const hit = selection.pickPoint(getCanvasPos(canvas, e));
    if (!hit) return null;
    return {
      entityId: hit.objectId,
      objectId: hit.objectId,
      worldPos: hit.point.clone(),
    };
  }

  function ensureOverlayElements(): void {
    const container = overlayContainerRef.value;
    if (!container) return;

    if (!hoverMarkerEl) {
      hoverMarkerEl = document.createElement('div');
      hoverMarkerEl.style.position = 'absolute';
      hoverMarkerEl.style.width = '12px';
      hoverMarkerEl.style.height = '12px';
      hoverMarkerEl.style.borderRadius = '999px';
      hoverMarkerEl.style.transform = 'translate(-50%, -50%)';
      hoverMarkerEl.style.pointerEvents = 'none';
      hoverMarkerEl.style.zIndex = '26';
      hoverMarkerEl.style.display = 'none';
      container.appendChild(hoverMarkerEl);
    }

    if (!pointerLensEl) {
      pointerLensEl = document.createElement('div');
      pointerLensEl.style.position = 'absolute';
      pointerLensEl.style.transform = 'translate(12px, 12px)';
      pointerLensEl.style.pointerEvents = 'none';
      pointerLensEl.style.zIndex = '27';
      pointerLensEl.style.display = 'none';
      pointerLensEl.style.padding = '6px 8px';
      pointerLensEl.style.borderRadius = '10px';
      pointerLensEl.style.background = 'rgba(15, 23, 42, 0.88)';
      pointerLensEl.style.color = '#f8fafc';
      pointerLensEl.style.fontSize = '11px';
      pointerLensEl.style.lineHeight = '1.35';
      pointerLensEl.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.24)';
      container.appendChild(pointerLensEl);
    }
  }

  function updateOverlayElements(): void {
    ensureOverlayElements();

    if (hoverMarkerEl) {
      const marker = store.xeokitMarkerState.value;
      if (!marker.visible || !marker.canvasPos) {
        hoverMarkerEl.style.display = 'none';
      } else {
        const palette = getXeokitOverlayPalette(marker.role, marker.snapped);
        hoverMarkerEl.style.display = 'block';
        hoverMarkerEl.style.left = `${marker.canvasPos.x}px`;
        hoverMarkerEl.style.top = `${marker.canvasPos.y}px`;
        hoverMarkerEl.style.border = `2px solid ${palette.markerBorder}`;
        hoverMarkerEl.style.background = palette.markerFill;
      }
    }

    if (pointerLensEl) {
      const lens = store.xeokitPointerLensState.value;
      if (!lens.visible || !lens.canvasPos) {
        pointerLensEl.style.display = 'none';
      } else {
        const palette = getXeokitOverlayPalette(store.xeokitMarkerState.value.role, lens.snapped);
        pointerLensEl.style.display = 'block';
        pointerLensEl.style.left = `${lens.canvasPos.x}px`;
        pointerLensEl.style.top = `${lens.canvasPos.y}px`;
        pointerLensEl.style.border = `1px solid ${palette.lensBorder}`;
        pointerLensEl.innerHTML = `
          <div style="font-weight:700;margin-bottom:2px;color:${palette.lensAccent};">${lens.title}</div>
          <div style="opacity:0.82;">${lens.subtitle}</div>
        `;
      }
    }
  }

  function clearHoverFeedback() {
    store.setXeokitHoverState({
      visible: false,
      snapped: false,
      entityId: null,
      objectId: null,
      worldPos: null,
      canvasPos: null,
    });
    store.setXeokitMarkerState({
      visible: false,
      snapped: false,
      role: 'hover',
      worldPos: null,
      canvasPos: null,
    });
    store.setXeokitPointerLensState({
      visible: false,
      snapped: false,
      title: '',
      subtitle: '',
      canvasPos: null,
    });
    updateOverlayElements();
  }

  function getHoverMarkerRole(): XeokitMarkerRole {
    if (store.toolMode.value === 'xeokit_measure_angle' && store.currentXeokitAngleDraft.value?.stage === 'finding_target') {
      return 'target';
    }
    if (store.toolMode.value === 'xeokit_measure_angle' && store.currentXeokitAngleDraft.value?.stage === 'finding_corner') {
      return 'corner';
    }
    if (store.currentXeokitDistanceDraft.value) {
      return 'target';
    }
    return 'hover';
  }

  function updateHoverFeedback(canvas: HTMLCanvasElement, e: PointerEvent, hit: { entityId: string; worldPos: Vector3; objectId: string } | null) {
    const canvasPos = getCanvasPos(canvas, e);
    const markerRole = getHoverMarkerRole();

    if (!hit) {
      store.setXeokitHoverState({
        visible: false,
        snapped: false,
        entityId: null,
        objectId: null,
        worldPos: null,
        canvasPos: { x: canvasPos.x, y: canvasPos.y },
      });
      store.setXeokitMarkerState({
        visible: false,
        snapped: false,
        role: markerRole,
        worldPos: null,
        canvasPos: { x: canvasPos.x, y: canvasPos.y },
      });
      store.setXeokitPointerLensState({
        visible: true,
        snapped: false,
        title: markerRole === 'corner' ? '等待拐点' : markerRole === 'target' ? '等待终点' : '等待可拾取点',
        subtitle: '当前未命中可拾取面',
        canvasPos: { x: canvasPos.x, y: canvasPos.y },
      });
      updateOverlayElements();
      return;
    }

    store.setXeokitHoverState({
      visible: true,
      snapped: true,
      entityId: hit.entityId,
      objectId: hit.objectId,
      worldPos: vec3ToTuple(hit.worldPos),
      canvasPos: { x: canvasPos.x, y: canvasPos.y },
    });
    store.setXeokitMarkerState({
      visible: true,
      snapped: true,
      role: markerRole,
      worldPos: vec3ToTuple(hit.worldPos),
      canvasPos: { x: canvasPos.x, y: canvasPos.y },
    });
    store.setXeokitPointerLensState({
      visible: true,
      snapped: true,
      title: markerRole === 'corner' ? '锁定拐点' : markerRole === 'target' ? '更新终点' : '可拾取点',
      subtitle: hit.entityId,
      canvasPos: { x: canvasPos.x, y: canvasPos.y },
    });
    updateOverlayElements();
  }

  function removeAnnotationById(id: string): void {
    const annotationSystem = options.annotationSystemRef?.value ?? null;
    const ann = annotations.get(id);
    if (annotationSystem) {
      try {
        annotationSystem.unregisterExternalAnnotation(id);
      } catch {
        // ignore
      }
    }
    try {
      ann?.parent?.remove(ann);
    } catch {
      // ignore
    }
    try {
      ann?.dispose();
    } catch {
      // ignore
    }
    annotations.delete(id);
  }

  function syncRecordAnnotation(annotationId: string, record: XeokitMeasurementRecord, isDraft = false): void {
    const annotationSystem = options.annotationSystemRef?.value ?? null;
    if (!annotationSystem) return;

    const existing = annotations.get(annotationId);
    const visible = isDraft || record.visible === undefined ? true : record.visible;
    const common = {
      approximate: isDraft || record.approximate,
      labelPrefix: isDraft ? '预览' : '',
      visible,
    };

    if (record.kind === 'distance') {
      const params: XeokitDistanceMeasurementParams = {
        origin: tupleToVector(record.origin.worldPos),
        target: tupleToVector(record.target.worldPos),
        ...common,
        visible,
        originVisible: true,
        targetVisible: visible,
        wireVisible: visible,
        axisVisible: visible,
        labelVisible: visible,
      };

      if (existing instanceof XeokitDistanceMeasurement) {
        existing.userData.pickable = !isDraft;
        existing.setParams(params);
        if (existing.parent !== annotationSystem.annotationGroup) {
          annotationSystem.annotationGroup.add(existing);
        }
        return;
      }

      if (existing) removeAnnotationById(annotationId);
      const next = new XeokitDistanceMeasurement(annotationSystem.materials, params);
      next.userData.pickable = !isDraft;
      next.userData.draggable = false;
      annotationSystem.annotationGroup.add(next);
      annotations.set(annotationId, next);
      annotationSystem.registerExternalAnnotation(annotationId, next);
      return;
    }

    const params: XeokitAngleMeasurementParams = {
      origin: tupleToVector(record.origin.worldPos),
      corner: tupleToVector(record.corner.worldPos),
      target: tupleToVector(record.target.worldPos),
      ...common,
      visible,
      originVisible: true,
      cornerVisible: isDraft && isAngleDraft(record)
        ? record.stage === 'finding_corner'
          ? visible
          : visible
        : visible,
      targetVisible: isDraft && isAngleDraft(record)
        ? record.stage === 'finding_target'
          ? visible
          : false
        : visible,
      originWireVisible: isDraft && isAngleDraft(record)
        ? record.stage === 'finding_target'
          ? visible
          : true
        : visible,
      targetWireVisible: isDraft && isAngleDraft(record)
        ? record.stage === 'finding_target'
          ? visible
          : false
        : visible,
      angleVisible: isDraft && isAngleDraft(record)
        ? record.stage === 'finding_target'
          ? visible
          : false
        : visible,
    };

    if (existing instanceof XeokitAngleMeasurement) {
      existing.userData.pickable = !isDraft;
      existing.setParams(params);
      if (existing.parent !== annotationSystem.annotationGroup) {
        annotationSystem.annotationGroup.add(existing);
      }
      return;
    }

    if (existing) removeAnnotationById(annotationId);
    const next = new XeokitAngleMeasurement(annotationSystem.materials, params);
    next.userData.pickable = !isDraft;
    next.userData.draggable = false;
    annotationSystem.annotationGroup.add(next);
    annotations.set(annotationId, next);
    annotationSystem.registerExternalAnnotation(annotationId, next);
  }

  function syncFromStore(): void {
    const annotationSystem = options.annotationSystemRef?.value ?? null;
    if (!annotationSystem) return;

    const nextIds = new Set<string>();
    for (const record of store.xeokitDistanceMeasurements.value) {
      const annotationId = buildMeasurementAnnotationId(record.id);
      nextIds.add(annotationId);
      syncRecordAnnotation(annotationId, record, false);
    }
    for (const record of store.xeokitAngleMeasurements.value) {
      const annotationId = buildMeasurementAnnotationId(record.id);
      nextIds.add(annotationId);
      syncRecordAnnotation(annotationId, record, false);
    }

    const draftDistance = store.currentXeokitDistanceDraft.value;
    if (draftDistance) {
      nextIds.add(XEOKIT_DISTANCE_DRAFT_ID);
      syncRecordAnnotation(XEOKIT_DISTANCE_DRAFT_ID, draftDistance, true);
    }

    const draftAngle = store.currentXeokitAngleDraft.value;
    if (draftAngle) {
      nextIds.add(XEOKIT_ANGLE_DRAFT_ID);
      syncRecordAnnotation(XEOKIT_ANGLE_DRAFT_ID, draftAngle, true);
    }

    for (const id of Array.from(annotations.keys())) {
      if (!nextIds.has(id)) {
        removeAnnotationById(id);
      }
    }

    requestRender?.();
  }

  function updateSelectionBinding(id: string | null): void {
    const annotationSystem = options.annotationSystemRef?.value ?? null;
    if (!annotationSystem) return;
    annotationSystem.selectAnnotation(id ? buildMeasurementAnnotationId(id) : null);
  }

  function flyToMeasurement(id: string): void {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const record = store.allXeokitMeasurements.value.find((item) => item.id === id);
    if (!record) return;
    const points =
      record.kind === 'distance'
        ? [record.origin.worldPos, record.target.worldPos]
        : [record.origin.worldPos, record.corner.worldPos, record.target.worldPos];
    const aabb = aabbFromPoints(points);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function removeMeasurement(id: string): void {
    store.removeXeokitMeasurement(id);
    requestRender?.();
  }

  function clearMeasurements(): void {
    store.clearXeokitMeasurements();
    requestRender?.();
  }

  function activate(mode: 'xeokit_measure_distance' | 'xeokit_measure_angle') {
    store.setToolMode(mode);
  }

  function reset() {
    store.clearCurrentXeokitDraft();
    clearHoverFeedback();
    syncFromStore();
    requestRender?.();
  }

  function deactivate() {
    reset();
    if (isActiveMode()) {
      store.setToolMode('none');
    }
  }

  function onCanvasPointerDown(_canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!isActiveMode()) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!isActiveMode()) return;

    const down = clickTracker.value.down;
    if (down) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (dx * dx + dy * dy > CLICK_TOLERANCE * CLICK_TOLERANCE) {
        clickTracker.value.moved = true;
      }
    }

    if (!ready.value) {
      clearHoverFeedback();
      return;
    }

    const hit = pickSurfacePoint(canvas, e);
    updateHoverFeedback(canvas, e, hit);

    if (store.toolMode.value === 'xeokit_measure_distance' && store.currentXeokitDistanceDraft.value) {
      if (!hit) {
        store.setCurrentXeokitDistanceDraft({
          ...store.currentXeokitDistanceDraft.value,
          visible: false,
        });
      } else {
        store.setCurrentXeokitDistanceDraft({
          ...store.currentXeokitDistanceDraft.value,
          target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
          visible: true,
        });
      }
      syncFromStore();
      requestRender?.();
      return;
    }

    const angleDraft = store.currentXeokitAngleDraft.value;
    if (store.toolMode.value === 'xeokit_measure_angle' && angleDraft) {
      if (!hit) {
        store.setCurrentXeokitAngleDraft({
          ...angleDraft,
          visible: false,
        });
      } else if (angleDraft.stage === 'finding_corner') {
        store.setCurrentXeokitAngleDraft({
          ...angleDraft,
          corner: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
          target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
          visible: true,
        });
      } else {
        store.setCurrentXeokitAngleDraft({
          ...angleDraft,
          target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
          visible: true,
        });
      }
      syncFromStore();
      requestRender?.();
    }
  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!isActiveMode()) return;
    if (!ready.value) return;

    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    clickTracker.value = { down: null, moved: false };

    const hit = pickSurfacePoint(canvas, e);
    const toolMode = store.toolMode.value;

    if (toolMode === 'xeokit_measure_distance') {
      const draft = store.currentXeokitDistanceDraft.value;
      if (!draft) {
        if (!hit) return;
        const point: MeasurementPoint = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
        const nextDraft: XeokitDistanceDraft = {
          id: nowId('xdist'),
          kind: 'distance',
          origin: point,
          target: point,
          visible: true,
          approximate: true,
          createdAt: Date.now(),
        };
        store.setCurrentXeokitDistanceDraft(nextDraft);
        syncFromStore();
        requestRender?.();
        return;
      }

      if (!hit) {
        store.clearCurrentXeokitDraft();
        clearHoverFeedback();
        syncFromStore();
        requestRender?.();
        return;
      }

      const rec: XeokitDistanceMeasurementRecord = {
        id: draft.id,
        kind: 'distance',
        origin: draft.origin,
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
        visible: true,
        approximate: false,
        createdAt: draft.createdAt,
      };
      store.addXeokitDistanceMeasurement(rec);
      store.clearCurrentXeokitDraft();
      syncFromStore();
      updateSelectionBinding(rec.id);
      requestRender?.();
      return;
    }

    if (toolMode !== 'xeokit_measure_angle') return;
    const draft = store.currentXeokitAngleDraft.value;
    if (!draft) {
      if (!hit) return;
      const point: MeasurementPoint = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
      const nextDraft: XeokitAngleDraft = {
        id: nowId('xang'),
        kind: 'angle',
        origin: point,
        corner: point,
        target: point,
        stage: 'finding_corner',
        visible: true,
        approximate: true,
        createdAt: Date.now(),
      };
      store.setCurrentXeokitAngleDraft(nextDraft);
      syncFromStore();
      requestRender?.();
      return;
    }

    if (!hit) {
      store.clearCurrentXeokitDraft();
      clearHoverFeedback();
      syncFromStore();
      requestRender?.();
      return;
    }

    if (draft.stage === 'finding_corner') {
      store.setCurrentXeokitAngleDraft({
        ...draft,
        corner: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
        stage: 'finding_target',
        visible: true,
      });
      syncFromStore();
      requestRender?.();
      return;
    }

    const rec: XeokitAngleMeasurementRecord = {
      id: draft.id,
      kind: 'angle',
      origin: draft.origin,
      corner: draft.corner,
      target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
      visible: true,
      approximate: false,
      createdAt: draft.createdAt,
    };
    store.addXeokitAngleMeasurement(rec);
    store.clearCurrentXeokitDraft();
    syncFromStore();
    updateSelectionBinding(rec.id);
    requestRender?.();
  }

  function onCanvasPointerCancel(_canvas: HTMLCanvasElement, _e: PointerEvent) {
    clickTracker.value = { down: null, moved: false };
    clearHoverFeedback();
  }

  function dispose() {
    clearHoverFeedback();
    if (hoverMarkerEl) {
      hoverMarkerEl.remove();
      hoverMarkerEl = null;
    }
    if (pointerLensEl) {
      pointerLensEl.remove();
      pointerLensEl = null;
    }
    for (const id of Array.from(annotations.keys())) {
      removeAnnotationById(id);
    }
  }

  watch(
    () => [
      store.xeokitDistanceMeasurements.value,
      store.xeokitAngleMeasurements.value,
      store.currentXeokitDistanceDraft.value,
      store.currentXeokitAngleDraft.value,
      options.annotationSystemRef?.value ?? null,
    ],
    () => {
      syncFromStore();
    },
    { deep: true, immediate: true },
  );

  watch(
    () => store.activeXeokitMeasurementId.value,
    (id) => {
      updateSelectionBinding(id);
    },
  );

  watch(
    () => options.annotationSystemRef?.value?.selectedId?.value ?? null,
    (selectedId) => {
      if (!selectedId?.startsWith(XEOKIT_PREFIX)) {
        if (store.activeXeokitMeasurementId.value !== null) {
          store.activeXeokitMeasurementId.value = null;
        }
        return;
      }
      const nextId = selectedId.slice(XEOKIT_PREFIX.length);
      if (nextId === 'draft_distance' || nextId === 'draft_angle') return;
      if (store.activeXeokitMeasurementId.value !== nextId) {
        store.activeXeokitMeasurementId.value = nextId;
      }
    },
  );

  watch(
    () => overlayContainerRef.value,
    () => {
      ensureOverlayElements();
      updateOverlayElements();
    },
    { immediate: true },
  );

  watch(
    () => [store.xeokitMarkerState.value, store.xeokitPointerLensState.value],
    () => {
      updateOverlayElements();
    },
    { deep: true },
  );

  return {
    ready,
    statusText,
    currentMeasurement,
    refreshReadyState,
    syncFromStore,
    activate,
    deactivate,
    reset,
    flyToMeasurement,
    removeMeasurement,
    clearMeasurements,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    dispose,
  };
}
