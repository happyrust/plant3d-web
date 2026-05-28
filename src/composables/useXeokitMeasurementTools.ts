import { computed, ref, watch, type Ref } from 'vue';

import { Box3, Matrix4, Raycaster, Vector2, Vector3 } from 'three';

import { useUnitSettingsStore } from './useUnitSettingsStore';
import { useXeokitMeasurementStyleStore } from './useXeokitMeasurementStyleStore';
import { getXeokitOverlayPalette } from './xeokitMeasurementUi';
import { usePtsetSnap } from './usePtsetSnap';
import { usePtsetVisualizationThree } from './usePtsetVisualizationThree';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { XeokitAngleMeasurementParams } from '@/utils/three/annotation/annotations/XeokitAngleMeasurement';
import type { XeokitDistanceMeasurementParams } from '@/utils/three/annotation/annotations/XeokitDistanceMeasurement';
import type { XeokitElevationDeltaMeasurementParams } from '@/utils/three/annotation/annotations/XeokitElevationDeltaMeasurement';
import type { XeokitElevationPointMeasurementParams } from '@/utils/three/annotation/annotations/XeokitElevationPointMeasurement';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { pdmsGetPtset, type PtsetResponse } from '@/api/genModelPdmsAttrApi';
import {
  useToolStore,
  type MeasurementPoint,
  type Vec3,
  type XeokitAngleDraft,
  type XeokitAngleMeasurementRecord,
  type XeokitDistanceDraft,
  type XeokitDistanceMeasurementRecord,
  type XeokitElevationDeltaDraft,
  type XeokitElevationDeltaMeasurementRecord,
  type XeokitElevationPointMeasurementRecord,
  type XeokitMarkerRole,
  type XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import { XeokitAngleMeasurement } from '@/utils/three/annotation/annotations/XeokitAngleMeasurement';
import { XeokitDistanceMeasurement } from '@/utils/three/annotation/annotations/XeokitDistanceMeasurement';
import { XeokitElevationDeltaMeasurement } from '@/utils/three/annotation/annotations/XeokitElevationDeltaMeasurement';
import { XeokitElevationPointMeasurement } from '@/utils/three/annotation/annotations/XeokitElevationPointMeasurement';
import {
  buildElevationDeltaLabelTexts,
  buildElevationPointLabelLines,
  getMeasurementPointElevation,
} from '@/utils/xeokitMeasurementFormat';

type AnnotationInstance =
  | XeokitDistanceMeasurement
  | XeokitAngleMeasurement
  | XeokitElevationPointMeasurement
  | XeokitElevationDeltaMeasurement;

type ClickTracker = {
  down: { x: number; y: number } | null;
  moved: boolean;
};

const XEOKIT_PREFIX = 'xmeas_';
const XEOKIT_DISTANCE_DRAFT_ID = `${XEOKIT_PREFIX}draft_distance`;
const XEOKIT_ANGLE_DRAFT_ID = `${XEOKIT_PREFIX}draft_angle`;
const XEOKIT_ELEVATION_POINT_DRAFT_ID = `${XEOKIT_PREFIX}draft_elevation_point`;
const XEOKIT_ELEVATION_DELTA_DRAFT_ID = `${XEOKIT_PREFIX}draft_elevation_delta`;
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

function worldToAnnotationLocal(world: Vec3, dtxLayerRef: Ref<DTXLayer | null>): Vector3 {
  const v = tupleToVector(world);
  const globalModelMatrix = dtxLayerRef.value?.getGlobalModelMatrix?.();
  if (!globalModelMatrix) return v;

  const inverse = globalModelMatrix.clone();
  if (Math.abs(inverse.determinant()) <= 1e-12) return v;

  return v.applyMatrix4(inverse.invert());
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
  suppressStoreMeasurements?: boolean;
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
  const suppressStoreMeasurements = options.suppressStoreMeasurements === true;
  const measurementStyle = useXeokitMeasurementStyleStore();
  const unitSettings = useUnitSettingsStore();

  const readyRevision = ref(0);
  const clickTracker = ref<ClickTracker>({ down: null, moved: false });
  const annotations = new Map<string, AnnotationInstance>();
  let hoverMarkerEl: HTMLDivElement | null = null;
  let pointerLensEl: HTMLDivElement | null = null;

  // ── 关键点(ptset) hover 显示 + 吸附 ───────────────────────────────────
  // hover 构件时按 refno 防抖拉取其关键点：候选用于吸附，并以轻量十字显示；
  // 取点时把表面交点吸附到最近关键点。
  const ptsetSnap = usePtsetSnap({
    getGlobalModelMatrix: () => dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null,
  });
  // 复用 ptset 渲染器作为测量态轻量显示层：仅显示十字，关闭标签/箭头。
  const ptsetHoverViz = usePtsetVisualizationThree(dtxViewerRef, overlayContainerRef, {
    requestRender,
    getGlobalModelMatrix: () => dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null,
  });
  ptsetHoverViz.setLabelsVisible(false);
  ptsetHoverViz.setArrowsVisible(false);

  const requestedPtsetRefnos = new Set<string>();
  const ptsetResponseByRefno = new Map<string, PtsetResponse>();
  let hoverFetchTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingHoverRefno: string | null = null;
  let currentHoverRefno: string | null = null;
  let shownPtsetRefno: string | null = null;

  function refnoFromObjectId(objectId: string | null | undefined): string | null {
    if (!objectId || !objectId.startsWith('o:')) return null;
    const parts = objectId.split(':');
    return parts.length >= 3 ? (parts[1] ?? null) : null;
  }

  function showHoverPtset(refno: string | null): void {
    if (refno === shownPtsetRefno) return;
    if (!refno) {
      if (shownPtsetRefno !== null) {
        ptsetHoverViz.clearVisualization();
        shownPtsetRefno = null;
      }
      return;
    }
    const resp = ptsetResponseByRefno.get(refno);
    if (!resp) return; // 未缓存：取数完成后再显示
    ptsetHoverViz.renderPtset(refno, resp);
    ptsetHoverViz.setVisible(true);
    shownPtsetRefno = refno;
  }

  function clearHoverPtset(): void {
    if (hoverFetchTimer !== null) {
      clearTimeout(hoverFetchTimer);
      hoverFetchTimer = null;
    }
    pendingHoverRefno = null;
    currentHoverRefno = null;
    if (shownPtsetRefno !== null) {
      ptsetHoverViz.clearVisualization();
      shownPtsetRefno = null;
    }
  }

  function scheduleHoverPtsetFetch(refno: string | null): void {
    if (!measurementStyle.state.keypointSnapEnabled || !refno) return;
    if (requestedPtsetRefnos.has(refno) || ptsetSnap.hasCandidates(refno)) return;
    pendingHoverRefno = refno;
    if (hoverFetchTimer !== null) clearTimeout(hoverFetchTimer);
    hoverFetchTimer = setTimeout(() => {
      hoverFetchTimer = null;
      const r = pendingHoverRefno;
      pendingHoverRefno = null;
      if (!r || requestedPtsetRefnos.has(r) || ptsetSnap.hasCandidates(r)) return;
      requestedPtsetRefnos.add(r);
      pdmsGetPtset(r)
        .then((resp) => {
          if (resp?.success && resp.ptset.length > 0) {
            ptsetResponseByRefno.set(r, resp);
            ptsetSnap.upsertCandidates(r, resp);
            if (currentHoverRefno === r) showHoverPtset(r);
            requestRender?.();
          }
        })
        .catch(() => {
          // 失败允许后续重试
          requestedPtsetRefnos.delete(r);
        });
    }, 80);
  }

  function trySnapHitToKeypoint(
    canvas: HTMLCanvasElement,
    e: PointerEvent,
    base: { entityId: string; worldPos: Vector3; objectId: string },
  ): { entityId: string; worldPos: Vector3; objectId: string } | null {
    if (!measurementStyle.state.keypointSnapEnabled) return null;
    const camera = dtxViewerRef.value?.camera;
    if (!camera) return null;
    const refno = refnoFromObjectId(base.objectId);
    const cursor = getCanvasPos(canvas, e);
    const rect = canvas.getBoundingClientRect();
    const hit = ptsetSnap.snap(
      { x: cursor.x, y: cursor.y },
      camera,
      { width: rect.width, height: rect.height },
      refno ? [refno] : undefined,
      measurementStyle.state.keypointSnapPx,
    );
    if (!hit) return null;
    return {
      entityId: `ptset:${hit.refno}#${hit.number}`,
      objectId: base.objectId,
      worldPos: new Vector3(hit.worldPos[0], hit.worldPos[1], hit.worldPos[2]),
    };
  }

  const currentMeasurement = computed(() => {
    return store.currentXeokitDistanceDraft.value
      ?? store.currentXeokitAngleDraft.value
      ?? store.currentXeokitElevationPointDraft.value
      ?? store.currentXeokitElevationDeltaDraft.value
      ?? null;
  });
  const selectedMeasurement = computed(() => {
    const id = store.activeXeokitMeasurementId.value;
    if (!id) return null;
    return store.allXeokitMeasurements.value.find((item) => item.id === id) ?? null;
  });
  const hasVisibleMeasurements = computed(() => {
    return store.allXeokitMeasurements.value.some((item) => item.visible);
  });
  const hasHiddenMeasurements = computed(() => {
    return store.allXeokitMeasurements.value.some((item) => !item.visible);
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
    if (
      mode !== 'xeokit_measure_distance' &&
      mode !== 'xeokit_measure_angle' &&
      mode !== 'xeokit_measure_elevation_point' &&
      mode !== 'xeokit_measure_elevation_delta'
    ) {
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

    if (mode === 'xeokit_measure_angle') {
      const draft = store.currentXeokitAngleDraft.value;
      if (!draft) return '角度测量：第一击创建测量';
      if (draft.stage === 'finding_corner') return '角度测量：第二击锁定拐点；点空白取消';
      return '角度测量：第三击完成；点空白取消';
    }

    if (mode === 'xeokit_measure_elevation_point') {
      return '点标高：hover 预览当前点位，单击完成；点空白取消';
    }

    return store.currentXeokitElevationDeltaDraft.value
      ? '高差测量：第二击完成；点空白取消'
      : '高差测量：第一击锁定起点，第二点 hover 预览';
  });

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  function isActiveMode() {
    return store.toolMode.value === 'xeokit_measure_distance'
      || store.toolMode.value === 'xeokit_measure_angle'
      || store.toolMode.value === 'xeokit_measure_elevation_point'
      || store.toolMode.value === 'xeokit_measure_elevation_delta';
  }

  function buildMeasurementAnnotationId(id: string): string {
    return `${XEOKIT_PREFIX}${id}`;
  }

  function pickAnnotationPoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const annotationSystem = options.annotationSystemRef?.value ?? null;
    const viewer = dtxViewerRef.value;
    const annotationsMap = annotationSystem?.annotations?.value;
    if (!viewer?.camera || !(annotationsMap instanceof Map) || annotationsMap.size === 0) return null;

    const canvasPos = getCanvasPos(canvas, e);
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2((canvasPos.x / rect.width) * 2 - 1, -(canvasPos.y / rect.height) * 2 + 1);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, viewer.camera);

    const prevThreshold = raycaster.params.Line?.threshold;
    if (raycaster.params.Line) {
      raycaster.params.Line.threshold = 0.1;
    }

    let closest: { entityId: string; worldPos: Vector3; objectId: string; distance: number } | null = null;

    for (const [id, annotation] of annotationsMap.entries()) {
      if (!annotation?.visible) continue;
      if (id.startsWith(XEOKIT_PREFIX)) continue;

      const annotationUserData = (annotation as any).userData as Record<string, unknown> | undefined;
      if (annotationUserData?.pickable === false || annotationUserData?.noPick === true) continue;

      let intersects: { object: { userData?: Record<string, unknown> }; point: Vector3; distance: number }[] = [];
      try {
        intersects = raycaster.intersectObject(annotation as any, true) as {
          object: { userData?: Record<string, unknown> };
          point: Vector3;
          distance: number;
        }[];
      } catch {
        continue;
      }

      for (const hit of intersects) {
        const hitUserData = hit.object?.userData;
        if (hitUserData?.pickable === false || hitUserData?.noPick === true) continue;

        if (!closest || hit.distance < closest.distance) {
          closest = {
            entityId: `annotation:${id}`,
            objectId: id,
            worldPos: hit.point.clone(),
            distance: hit.distance,
          };
        }
        break;
      }
    }

    if (raycaster.params.Line && prevThreshold !== undefined) {
      raycaster.params.Line.threshold = prevThreshold;
    }

    return closest
      ? {
        entityId: closest.entityId,
        objectId: closest.objectId,
        worldPos: closest.worldPos,
      }
      : null;
  }

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const selection = selectionRef.value;
    let base: { entityId: string; worldPos: Vector3; objectId: string } | null = null;
    if (selection) {
      const hit = selection.pickPoint(getCanvasPos(canvas, e));
      if (hit) {
        base = {
          entityId: hit.objectId,
          objectId: hit.objectId,
          worldPos: hit.point.clone(),
        };
      }
    }

    if (!base) {
      base = pickAnnotationPoint(canvas, e);
    }

    // 关键点吸附：命中构件表面后，若光标在阈值内靠近某关键点，则吸附到该点精确坐标。
    if (base) {
      const snapped = trySnapHitToKeypoint(canvas, e, base);
      if (snapped) return snapped;
    }

    return base;
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

    const hoverEntityId = store.xeokitHoverState.value?.entityId ?? null;
    const isKeypointSnap = typeof hoverEntityId === 'string' && hoverEntityId.startsWith('ptset:');

    if (hoverMarkerEl) {
      const marker = store.xeokitMarkerState.value;
      if (!marker.visible || !marker.canvasPos) {
        hoverMarkerEl.style.display = 'none';
      } else {
        const palette = getXeokitOverlayPalette(marker.role, marker.snapped, isKeypointSnap);
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
        const palette = getXeokitOverlayPalette(store.xeokitMarkerState.value.role, lens.snapped, isKeypointSnap);
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
    if (store.toolMode.value === 'xeokit_measure_elevation_point') {
      return 'target';
    }
    if (store.toolMode.value === 'xeokit_measure_elevation_delta') {
      return store.currentXeokitElevationDeltaDraft.value ? 'target' : 'origin';
    }
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

  function getPointerLensText(snapped: boolean, markerRole: XeokitMarkerRole): { title: string; subtitle: string } {
    const mode = store.toolMode.value;
    if (!snapped) {
      if (mode === 'xeokit_measure_elevation_point') {
        return { title: '等待可拾取点', subtitle: '当前未命中可拾取面' };
      }
      if (mode === 'xeokit_measure_elevation_delta') {
        return {
          title: store.currentXeokitElevationDeltaDraft.value ? '等待终点' : '等待起点',
          subtitle: '当前未命中可拾取面',
        };
      }
      return {
        title: markerRole === 'corner' ? '等待拐点' : markerRole === 'target' ? '等待终点' : '等待可拾取点',
        subtitle: '当前未命中可拾取面',
      };
    }

    if (mode === 'xeokit_measure_elevation_point') {
      return { title: '锁定标高点', subtitle: '' };
    }
    if (mode === 'xeokit_measure_elevation_delta') {
      return {
        title: store.currentXeokitElevationDeltaDraft.value ? '更新终点' : '锁定起点',
        subtitle: '',
      };
    }
    return {
      title: markerRole === 'corner' ? '锁定拐点' : markerRole === 'target' ? '更新终点' : '可拾取点',
      subtitle: '',
    };
  }

  function updateHoverFeedback(canvas: HTMLCanvasElement, e: PointerEvent, hit: { entityId: string; worldPos: Vector3; objectId: string } | null) {
    const canvasPos = getCanvasPos(canvas, e);
    const markerRole = getHoverMarkerRole();
    const lensText = getPointerLensText(Boolean(hit), markerRole);

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
        title: lensText.title,
        subtitle: lensText.subtitle,
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
      title: lensText.title,
      subtitle: lensText.subtitle || hit.entityId,
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
    const displayTransform = dtxLayerRef.value?.getGlobalModelMatrix?.() ?? new Matrix4();
    const displayUnit = unitSettings.displayUnit.value;
    const precision = unitSettings.precision.value;
    const visible = isDraft || record.visible === undefined ? true : record.visible;
    const common = {
      approximate: isDraft || record.approximate,
      labelPrefix: isDraft ? '预览' : '',
      visible,
    };

    if (record.kind === 'distance') {
      const params: XeokitDistanceMeasurementParams = {
        origin: worldToAnnotationLocal(record.origin.worldPos, dtxLayerRef),
        target: worldToAnnotationLocal(record.target.worldPos, dtxLayerRef),
        displayTransform,
        ...common,
        visible,
        originVisible: measurementStyle.state.distanceShowMarkers,
        targetVisible: visible && measurementStyle.state.distanceShowMarkers,
        wireVisible: visible,
        axisVisible: visible && measurementStyle.state.distanceShowAxisBreakdown,
        xAxisVisible: measurementStyle.state.distanceShowAxisBreakdown,
        yAxisVisible: measurementStyle.state.distanceShowAxisBreakdown,
        zAxisVisible: measurementStyle.state.distanceShowAxisBreakdown,
        labelVisible: visible && measurementStyle.state.distanceShowTotalLabel,
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

    if (record.kind === 'elevation_point') {
      const params: XeokitElevationPointMeasurementParams = {
        point: worldToAnnotationLocal(record.point.worldPos, dtxLayerRef),
        labelLines: buildElevationPointLabelLines({
          absoluteElevation: record.absoluteElevation,
          relativeElevation: record.relativeElevation,
          unit: displayUnit,
          precision,
          showAbsolute: measurementStyle.state.elevationPointShowAbsoluteLabel,
          showRelative: measurementStyle.state.elevationPointShowRelativeLabel,
        }),
        visible,
        markerVisible: measurementStyle.state.elevationPointShowMarker,
        leaderVisible: visible && measurementStyle.state.elevationPointShowLeader,
        labelVisible: visible && (
          measurementStyle.state.elevationPointShowAbsoluteLabel
          || measurementStyle.state.elevationPointShowRelativeLabel
        ),
      };

      if (existing instanceof XeokitElevationPointMeasurement) {
        existing.userData.pickable = !isDraft;
        existing.setParams(params);
        if (existing.parent !== annotationSystem.annotationGroup) {
          annotationSystem.annotationGroup.add(existing);
        }
        return;
      }

      if (existing) removeAnnotationById(annotationId);
      const next = new XeokitElevationPointMeasurement(annotationSystem.materials, params);
      next.userData.pickable = !isDraft;
      next.userData.draggable = false;
      annotationSystem.annotationGroup.add(next);
      annotations.set(annotationId, next);
      annotationSystem.registerExternalAnnotation(annotationId, next);
      return;
    }

    if (record.kind === 'elevation_delta') {
      const labels = buildElevationDeltaLabelTexts({
        originElevation: record.originElevation,
        targetElevation: record.targetElevation,
        deltaElevation: record.deltaElevation,
        unit: displayUnit,
        precision,
      });
      const params: XeokitElevationDeltaMeasurementParams = {
        origin: worldToAnnotationLocal(record.origin.worldPos, dtxLayerRef),
        target: worldToAnnotationLocal(record.target.worldPos, dtxLayerRef),
        originLabelText: labels.origin,
        targetLabelText: labels.target,
        deltaLabelText: labels.delta,
        visible,
        markerVisible: measurementStyle.state.elevationDeltaShowMarkers,
        endpointLabelsVisible: visible && measurementStyle.state.elevationDeltaShowEndpointLabels,
        deltaLabelVisible: visible && measurementStyle.state.elevationDeltaShowDeltaLabel,
        verticalGuideVisible: visible && measurementStyle.state.elevationDeltaShowVerticalGuide,
      };

      if (existing instanceof XeokitElevationDeltaMeasurement) {
        existing.userData.pickable = !isDraft;
        existing.setParams(params);
        if (existing.parent !== annotationSystem.annotationGroup) {
          annotationSystem.annotationGroup.add(existing);
        }
        return;
      }

      if (existing) removeAnnotationById(annotationId);
      const next = new XeokitElevationDeltaMeasurement(annotationSystem.materials, params);
      next.userData.pickable = !isDraft;
      next.userData.draggable = false;
      annotationSystem.annotationGroup.add(next);
      annotations.set(annotationId, next);
      annotationSystem.registerExternalAnnotation(annotationId, next);
      return;
    }

    const params: XeokitAngleMeasurementParams = {
      origin: worldToAnnotationLocal(record.origin.worldPos, dtxLayerRef),
      corner: worldToAnnotationLocal(record.corner.worldPos, dtxLayerRef),
      target: worldToAnnotationLocal(record.target.worldPos, dtxLayerRef),
      ...common,
      visible,
      originVisible: measurementStyle.state.angleShowMarkers,
      cornerVisible: measurementStyle.state.angleShowMarkers && (isDraft && isAngleDraft(record)
        ? record.stage === 'finding_corner'
          ? visible
          : visible
        : visible),
      targetVisible: measurementStyle.state.angleShowMarkers && (isDraft && isAngleDraft(record)
        ? record.stage === 'finding_target'
          ? visible
          : false
        : visible),
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
      angleVisible: measurementStyle.state.angleShowLabel && (isDraft && isAngleDraft(record)
        ? record.stage === 'finding_target'
          ? visible
          : false
        : visible),
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

    if (suppressStoreMeasurements) {
      clearHoverFeedback();
      for (const id of Array.from(annotations.keys())) {
        removeAnnotationById(id);
      }
      requestRender?.();
      return;
    }

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
    for (const record of store.xeokitElevationPointMeasurements.value) {
      const annotationId = buildMeasurementAnnotationId(record.id);
      nextIds.add(annotationId);
      syncRecordAnnotation(annotationId, record, false);
    }
    for (const record of store.xeokitElevationDeltaMeasurements.value) {
      const annotationId = buildMeasurementAnnotationId(record.id);
      nextIds.add(annotationId);
      syncRecordAnnotation(annotationId, record, false);
    }

    // 仅在 Xeokit 测量模式激活时渲染草稿；否则列表/工具状态已切走，草稿不应留在场景里。
    if (isActiveMode()) {
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

      const draftElevationPoint = store.currentXeokitElevationPointDraft.value;
      if (draftElevationPoint) {
        nextIds.add(XEOKIT_ELEVATION_POINT_DRAFT_ID);
        syncRecordAnnotation(XEOKIT_ELEVATION_POINT_DRAFT_ID, draftElevationPoint, true);
      }

      const draftElevationDelta = store.currentXeokitElevationDeltaDraft.value;
      if (draftElevationDelta) {
        nextIds.add(XEOKIT_ELEVATION_DELTA_DRAFT_ID);
        syncRecordAnnotation(XEOKIT_ELEVATION_DELTA_DRAFT_ID, draftElevationDelta, true);
      }
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
        : record.kind === 'angle'
          ? [record.origin.worldPos, record.corner.worldPos, record.target.worldPos]
          : record.kind === 'elevation_point'
            ? [record.point.worldPos]
            : [record.origin.worldPos, record.target.worldPos];
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

  function setMeasurementVisible(id: string, visible: boolean): void {
    store.updateXeokitMeasurementVisible(id, visible);
    requestRender?.();
  }

  function setAllMeasurementsVisible(visible: boolean): void {
    for (const item of store.allXeokitMeasurements.value) {
      store.updateXeokitMeasurementVisible(item.id, visible);
    }
    requestRender?.();
  }

  function activate(mode: 'xeokit_measure_distance' | 'xeokit_measure_angle') {
    if (suppressStoreMeasurements) return;
    store.setMeasurementDetailsDrawerOpen(false);
    store.setToolMode(mode);
  }

  function reset() {
    store.clearCurrentXeokitDraft();
    clearHoverFeedback();
    clearHoverPtset();
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
    if (suppressStoreMeasurements) return;
    if (!isActiveMode()) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (suppressStoreMeasurements) return;
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
    const hoverRefno = hit ? refnoFromObjectId(hit.objectId) : null;
    currentHoverRefno = hoverRefno;
    if (measurementStyle.state.keypointSnapEnabled) {
      showHoverPtset(hoverRefno);
      scheduleHoverPtsetFetch(hoverRefno);
    } else {
      showHoverPtset(null);
    }
    updateHoverFeedback(canvas, e, hit);

    if (store.toolMode.value === 'xeokit_measure_elevation_point') {
      if (!hit) {
        store.setCurrentXeokitElevationPointDraft(null);
      } else {
        const absoluteElevation = getMeasurementPointElevation({
          entityId: hit.entityId,
          worldPos: vec3ToTuple(hit.worldPos),
        });
        const datumElevation = measurementStyle.state.elevationDatum;
        const currentDraft = store.currentXeokitElevationPointDraft.value;
        store.setCurrentXeokitElevationPointDraft({
          id: currentDraft?.id ?? nowId('xelevp'),
          kind: 'elevation_point',
          point: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
          absoluteElevation,
          datumElevation,
          relativeElevation: absoluteElevation - datumElevation,
          visible: true,
          approximate: true,
          createdAt: currentDraft?.createdAt ?? Date.now(),
        });
      }
      syncFromStore();
      requestRender?.();
      return;
    }

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

    const elevationDeltaDraft = store.currentXeokitElevationDeltaDraft.value;
    if (store.toolMode.value === 'xeokit_measure_elevation_delta' && elevationDeltaDraft) {
      if (!hit) {
        store.setCurrentXeokitElevationDeltaDraft({
          ...elevationDeltaDraft,
          visible: false,
        });
      } else {
        const targetElevation = getMeasurementPointElevation({
          entityId: hit.entityId,
          worldPos: vec3ToTuple(hit.worldPos),
        });
        store.setCurrentXeokitElevationDeltaDraft({
          ...elevationDeltaDraft,
          target: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
          targetElevation,
          deltaElevation: targetElevation - elevationDeltaDraft.originElevation,
          datumElevation: measurementStyle.state.elevationDatum,
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
    if (suppressStoreMeasurements) return;
    if (!isActiveMode()) return;
    if (!ready.value) return;

    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    clickTracker.value = { down: null, moved: false };

    const hit = pickSurfacePoint(canvas, e);
    const toolMode = store.toolMode.value;
    const datumElevation = measurementStyle.state.elevationDatum;

    if (toolMode === 'xeokit_measure_elevation_point') {
      if (!hit) {
        store.clearCurrentXeokitDraft();
        clearHoverFeedback();
        syncFromStore();
        requestRender?.();
        return;
      }

      const absoluteElevation = getMeasurementPointElevation({
        entityId: hit.entityId,
        worldPos: vec3ToTuple(hit.worldPos),
      });
      const draft = store.currentXeokitElevationPointDraft.value ?? {
        id: nowId('xelevp'),
        kind: 'elevation_point' as const,
        point: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
        absoluteElevation,
        datumElevation,
        relativeElevation: absoluteElevation - datumElevation,
        visible: true,
        approximate: true as const,
        createdAt: Date.now(),
      };
      const rec: XeokitElevationPointMeasurementRecord = {
        id: draft.id,
        kind: 'elevation_point',
        point: { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) },
        absoluteElevation,
        datumElevation,
        relativeElevation: absoluteElevation - datumElevation,
        visible: true,
        approximate: false,
        createdAt: draft.createdAt,
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      store.addXeokitElevationPointMeasurement(rec);
      store.clearCurrentXeokitDraft();
      syncFromStore();
      updateSelectionBinding(rec.id);
      requestRender?.();
      return;
    }

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
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      store.addXeokitDistanceMeasurement(rec);
      store.clearCurrentXeokitDraft();
      syncFromStore();
      updateSelectionBinding(rec.id);
      requestRender?.();
      return;
    }

    if (toolMode === 'xeokit_measure_elevation_delta') {
      const draft = store.currentXeokitElevationDeltaDraft.value;
      if (!draft) {
        if (!hit) return;
        const point: MeasurementPoint = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
        const absoluteElevation = getMeasurementPointElevation(point);
        const nextDraft: XeokitElevationDeltaDraft = {
          id: nowId('xelevd'),
          kind: 'elevation_delta',
          origin: point,
          target: point,
          originElevation: absoluteElevation,
          targetElevation: absoluteElevation,
          deltaElevation: 0,
          datumElevation,
          stage: 'finding_target',
          visible: true,
          approximate: true,
          createdAt: Date.now(),
        };
        store.setCurrentXeokitElevationDeltaDraft(nextDraft);
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

      const targetPoint: MeasurementPoint = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
      const targetElevation = getMeasurementPointElevation(targetPoint);
      const rec: XeokitElevationDeltaMeasurementRecord = {
        id: draft.id,
        kind: 'elevation_delta',
        origin: draft.origin,
        target: targetPoint,
        originElevation: draft.originElevation,
        targetElevation,
        deltaElevation: targetElevation - draft.originElevation,
        datumElevation,
        visible: true,
        approximate: false,
        createdAt: draft.createdAt,
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      store.addXeokitElevationDeltaMeasurement(rec);
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
      sourceAnnotationId: store.activeAnnotationContext.value?.id,
      sourceAnnotationType: store.activeAnnotationContext.value?.type,
    };
    store.addXeokitAngleMeasurement(rec);
    store.clearCurrentXeokitDraft();
    syncFromStore();
    updateSelectionBinding(rec.id);
    requestRender?.();
  }

  function onCanvasPointerCancel(_canvas: HTMLCanvasElement, _e: PointerEvent) {
    clickTracker.value = { down: null, moved: false };
    if (store.toolMode.value === 'xeokit_measure_elevation_point') {
      store.setCurrentXeokitElevationPointDraft(null);
      syncFromStore();
      requestRender?.();
    }
    clearHoverFeedback();
  }

  function dispose() {
    clearHoverFeedback();
    clearHoverPtset();
    requestedPtsetRefnos.clear();
    ptsetResponseByRefno.clear();
    ptsetSnap.clear();
    ptsetHoverViz.clearAll();
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
      store.xeokitElevationPointMeasurements.value,
      store.xeokitElevationDeltaMeasurements.value,
      store.currentXeokitDistanceDraft.value,
      store.currentXeokitAngleDraft.value,
      store.currentXeokitElevationPointDraft.value,
      store.currentXeokitElevationDeltaDraft.value,
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
      if (
        nextId === 'draft_distance' ||
        nextId === 'draft_angle' ||
        nextId === 'draft_elevation_point' ||
        nextId === 'draft_elevation_delta'
      ) return;
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

  watch(
    () => measurementStyle.state.elevationDatum,
    (datumElevation) => {
      store.syncXeokitElevationDatum(datumElevation);
      syncFromStore();
      requestRender?.();
    },
    { immediate: true },
  );

  watch(
    () => ({
      displayUnit: unitSettings.displayUnit.value,
      precision: unitSettings.precision.value,
    }),
    () => {
      syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  watch(
    () => ({ ...measurementStyle.state }),
    () => {
      syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  return {
    ready,
    statusText,
    currentMeasurement,
    selectedMeasurement,
    hasVisibleMeasurements,
    hasHiddenMeasurements,
    refreshReadyState,
    syncFromStore,
    activate,
    deactivate,
    reset,
    flyToMeasurement,
    setMeasurementVisible,
    setAllMeasurementsVisible,
    removeMeasurement,
    clearMeasurements,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    dispose,
  };
}
