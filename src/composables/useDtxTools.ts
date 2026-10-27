import { type Ref, computed, ref, watch } from 'vue';

import { Box3, Group, Line, Vector3 } from 'three';

import { computeAabbObbFromBox3, createRectAnnotationRecordFromObb, getDefaultTextAnnotationLabelWorldPos, isDtxInteractionReady } from './dtxTools/annotationRecords';
import { type CloudOverlayEl, type CloudRenderStats } from './dtxTools/cloudRegion';
import { createAnnotationInteraction } from './dtxTools/controllers/annotationInteraction';
import { createCloudCreationFlow } from './dtxTools/controllers/cloudCreationFlow';
import { createCloudInspection } from './dtxTools/controllers/cloudInspection';
import { createCloudLodController } from './dtxTools/controllers/cloudLod';
import { createMeasureController } from './dtxTools/controllers/measureController';
import { createOverlayHost } from './dtxTools/controllers/overlayHost';
import { createOverlaySync } from './dtxTools/controllers/overlaySync';
import { createPanelActions } from './dtxTools/controllers/panelActions';
import { createPickCandidateController } from './dtxTools/controllers/pickCandidateController';
import { getCanvasPos, nowId, parseRefnoFromDtxObjectId, vec3ToTuple } from './dtxTools/geometry';
import { type PickRefnoCandidate, type PickRefnoRayHit } from './dtxTools/pickCandidates';
import { clearGroup } from './dtxTools/visuals';

import type { CloudLodState, DtxToolsContext } from './dtxTools/context';
import type { AnnotationLeaderVisual, DragRect, InlineOverlayAnnotationDragState, LabelEl, ObbOverlayEl, PendingCloudAnchor, RectOverlayEl, RectPlaneDrag, TextAnnotationDragState } from './dtxTools/types';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import { useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { useReviewStore } from '@/composables/useReviewStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { type AnnotationRecord, useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import { createArrayVersionTracker, createValueVersionTracker } from '@/review/domain/annotationProjection/dirty';
import { type CloudLodLevel } from '@/review/domain/annotationProjection/lod';

export { createCloudAnnotationRecordFromAnchorAndMarquee, createRectAnnotationRecordFromObb, getDefaultTextAnnotationLabelWorldPos, isDtxInteractionReady, resolveTextAnnotationMarkerClickAction, resolveTextAnnotationMarkerDoubleClickAction, resolveTextAnnotationMarkerSingleClickAction, shouldRenderTextAnnotationCard, toggleTextAnnotationCollapsed } from './dtxTools/annotationRecords';
export { CLOUD_FIT_PADDING_PX, CLOUD_TARGET_BBOX_TTL_MS, buildCloudBillboardPolyline, cloudWavesPerEdgeForSizePx, computeCloudLayout, computeFittedCloudRectFromCorners } from './dtxTools/cloudGeometry';
export type { FittedCloudRect } from './dtxTools/cloudGeometry';
export { CLOUD_REGION_MAX_BOXES, buildMembersRegionV1, createDefaultCloudLabelLayoutV1 } from './dtxTools/cloudRegion';
export type { CloudClusterDebugSnapshot, CloudInspectionDebugSnapshot, CloudLodDebugSnapshot, CloudRenderStats } from './dtxTools/cloudRegion';
export { buildAnnotationLeaderStyle } from './dtxTools/leaderVisual';
export { buildAnnotationLabelHtml, buildAnnotationLabelStyleText, buildInlineAnnotationCardHtml, buildTextAnnotationCardHtml, buildTextAnnotationMarkerHtml, buildTextAnnotationMarkerStyleText, resolveAnnotationLabelClickAction } from './dtxTools/overlayHtml';
export type { MarkerDegradeOptions } from './dtxTools/overlayHtml';
export { buildPickRefnoCandidates, buildPickTubeCandidates, isSamePickAnchor, isSamePickCandidateSequence, isTubePickFilter, nextPickCandidateIndex, resolveBoxPickRefnos, resolvePickedRefnoForFilter } from './dtxTools/pickCandidates';
export type { BoxPickResolution, PickRefnoCandidate, PickRefnoRayHit } from './dtxTools/pickCandidates';
export { choosePipeMeasureBetterSeed, collectOrderedPipeReferencePointSeeds, computeApproxNearestBetweenObjects } from './dtxTools/pipeMeasureMath';
export type { ApproxNearestBetweenObjectsInput, ApproxNearestBetweenObjectsResult } from './dtxTools/pipeMeasureMath';
export type { AnnotationLabelClickResult, AnnotationLabelClickState, AnnotationLeaderKind, AnnotationOverlayKind, TextAnnotationMarkerClickResult, TextAnnotationMarkerClickState } from './dtxTools/types';

export function useDtxTools(options: {
  dtxViewerRef: Ref<DtxViewer | null>
  dtxLayerRef: Ref<DTXLayer | null>
  selectionRef: Ref<DTXSelectionController | null>
  overlayContainerRef: Ref<HTMLElement | null>
  store: ReturnType<typeof useToolStore>
  compatViewerRef: Ref<DtxCompatViewer | null>
  requestRender?: (() => void) | null
  suppressStoreOverlays?: boolean
}) {
  const { dtxViewerRef, dtxLayerRef, selectionRef, overlayContainerRef, store, compatViewerRef } = options;
  const requestRender = options.requestRender ?? null;
  const suppressStoreOverlays = options.suppressStoreOverlays === true;

  const selectionStore = useSelectionStore();
  const reviewStore = useReviewStore();
  const userStore = useUserStore();
  const unitSettings = useUnitSettingsStore();
  const clearanceStore = useClearanceStore();
  const annotationStyleStore = useAnnotationStyleStore();
  // ADR-0050：批注关联的失效解析表（只读）；missing / stale 的记录在视口降级为灰虚线 + 左上角小徽标
  const bindingResolve = useAnnotationBindingResolve();
  const readyRevision = ref(0);

  // pick_refno：仅在拾取会话内维护，不写入 store
  // pick_refno 候选轮换：一次点击命中的全部重叠构件 + 当前预览下标
  const pickCandidates = ref<PickRefnoCandidate[]>([]);
  const pickCandidateIndex = ref(0);

  const ready = computed(() => {
    void readyRevision.value;
    return isDtxInteractionReady(dtxLayerRef.value);
  });

  const toolsGroup = new Group();
  toolsGroup.name = 'dtx-tools';

  const labels = new Map<string, LabelEl>();
  const markers = new Map<string, LabelEl>();
  const cloudShapes = new Map<string, CloudOverlayEl>();
  const rectShapes = new Map<string, RectOverlayEl>();
  const obbShapes = new Map<string, ObbOverlayEl>();
  const textLeaders = new Map<string, AnnotationLeaderVisual>();
  const textAnnotationDrag = ref<TextAnnotationDragState>({
    annotationId: null,
    pointerId: null,
    anchorWorldPos: null,
    anchorNdcZ: 0,
    moved: false,
  });
  const inlineOverlayAnnotationDrag = ref<InlineOverlayAnnotationDragState>({
    annotationId: null,
    annotationKind: null,
    pointerId: null,
    anchorWorldPos: null,
    anchorNdcZ: 0,
    moved: false,
    labelGrabOffsetPx: null,
  });

  // 云线渲染分阶段脏标记的帧级版本戳（所有云线共用）：相机 / 视口 / overlay / DPR / 全局矩阵 / 样式
  const cloudFrameTrackers = {
    cameraWorld: createArrayVersionTracker(),
    projection: createArrayVersionTracker(),
    viewportCss: createArrayVersionTracker(),
    overlayTransform: createArrayVersionTracker(),
    dpr: createArrayVersionTracker(),
    globalModelMatrix: createArrayVersionTracker(),
    shapeStyle: createValueVersionTracker<string>(),
    paintStyle: createValueVersionTracker<string>(),
  };
  const cloudRenderStats: CloudRenderStats = { frames: 0, contourBuilds: 0, setPoints: 0, labelLayouts: 0, paintUpdates: 0, lodPlans: 0, inspectionRays: 0 };

  // P4 inspection（方案 §10）、P4 LOD（方案 §9.3）与 pin 图钉屏幕聚合的帧间状态，收进一个对象给控制器共享（字段含义见 CloudLodState）：
  // inspection 模式跟尺寸面板同一口径（URL `mbd_mode=inspection`），测试 / 外部可覆盖；射线只在相机停下（帧后 120 ms 没再动）才打，
  // 且只探 full 档、非强调、非失效的云线；LOD 的 levels 跨 syncFromStore 重建保留（滞回才有依据），planKey 是上次规划的输入指纹；
  // 聚合的徽标 DOM 按种子 id 复用，cloudLod.clusterSeedOf 是上一帧的成员 → 种子，被合进徽标的图钉 display:none
  const cloudLod: CloudLodState = {
    inspectionModeOverride: null,
    inspectionSearchCache: { search: '', mode: 'always-on-top' },
    inspectionTimer: null,
    inspectionPending: false,
    levels: new Map<string, CloudLodLevel>(),
    planKey: '',
    planSummary: { overBudget: false, fullCount: 0, pinCount: 0 },
    setVersion: 0,
    hoveredId: null,
    clusterBadges: new Map<string, HTMLDivElement>(),
    clusterSeedOf: new Map<string, string>(),
    clusterCurrent: [],
    clusterHiddenMarkerIds: new Set<string>(),
    clusterPopover: null,
  };

  const marqueeState = ref<DragRect>({ active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null });
  const marqueeDiv = ref<HTMLDivElement | null>(null);
  const pendingCloudAnchor = ref<PendingCloudAnchor | null>(null);

  const rectDrag = ref<RectPlaneDrag>({
    active: false,
    pointerId: null,
    startCanvas: null,
    plane: null,
    basisU: null,
    basisV: null,
    startWorld: null,
    startEntityId: null,
  });
  const rectPreviewLine = ref<Line | null>(null);

  /** 控制器共享的状态（拆分计划 §3）：同一份引用，所有者见 context.ts 的字段注释；不要 reactive(ctx)，里面的 Ref 不许被解包 */
  const ctx: DtxToolsContext = {
    dtxViewerRef,
    dtxLayerRef,
    selectionRef,
    overlayContainerRef,
    compatViewerRef,
    store,
    requestRender,
    suppressStoreOverlays,
    unitSettings,
    clearanceStore,
    reviewStore,
    userStore,
    annotationStyleStore,
    bindingResolve,
    ready,
    pickCandidates,
    pickCandidateIndex,
    textAnnotationDrag,
    inlineOverlayAnnotationDrag,
    pendingCloudAnchor,
    toolsGroup,
    overlays: { labels, markers, cloudShapes, rectShapes, obbShapes, textLeaders },
    cloudFrameTrackers,
    cloudRenderStats,
    cloudLod,
    marqueeState,
    marqueeDiv,
    rectDrag,
    rectPreviewLine,
  };

  const annotation = createAnnotationInteraction(ctx, { updateOverlayPositions: () => overlay.updateOverlayPositions() });
  const lod = createCloudLodController(ctx, { updateOverlayPositions: () => overlay.updateOverlayPositions(), activateAnnotation: annotation.activateAnnotation });
  const inspection = createCloudInspection(ctx, { updateOverlayPositions: () => overlay.updateOverlayPositions(), resolveCloudTargetBbox: (cloud) => overlay.resolveCloudTargetBbox(cloud) });
  const host = createOverlayHost(ctx, { clearPinClusterDom: lod.clearPinClusterDom });
  const cloudFlow = createCloudCreationFlow(ctx, {
    pickSurfacePoint,
    hideMarquee: host.hideMarquee,
    updateMarqueeStyle: host.updateMarqueeStyle,
    updateMarqueeRect: host.updateMarqueeRect,
    activateAnnotation: annotation.activateAnnotation,
  });

  const pick = createPickCandidateController(ctx, { pickSurfaceRayHits, ensureToolsGroupAttached: host.ensureToolsGroupAttached });
  pick.installWatchers();

  const measure = createMeasureController(ctx, { pickSurfacePoint, clearPendingCloudAnchor: cloudFlow.clearPendingCloudAnchor, hideMarquee: host.hideMarquee });

  // overlaySync 依赖上面的控制器，所以最后装配；上面几个对 updateOverlayPositions / resolveCloudTargetBbox 的引用都是延迟调用的转发
  const overlay = createOverlaySync(ctx, { annotation, lod, inspection, host, pick });

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  /** e2e / 单测：每条批注当前在视口里的降级态与外观（ADR-0050） */

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const sel = selectionRef.value;
    if (!sel) return null;
    const pos = getCanvasPos(canvas, e);
    const hit = sel.pickPoint(pos);
    if (!hit) return null;
    const refno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId;
    return { entityId: refno, worldPos: hit.point.clone(), objectId: hit.objectId };
  }

  /** 光标射线上的全部命中（含被遮挡的），由近到远，供候选轮换使用。 */
  function pickSurfaceRayHits(canvas: HTMLCanvasElement, e: PointerEvent): PickRefnoRayHit[] {
    const sel = selectionRef.value;
    if (typeof sel?.pickPoints !== 'function') return [];
    return sel.pickPoints(getCanvasPos(canvas, e)).map((hit) => ({
      entityId: parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId,
      objectId: hit.objectId,
      distance: hit.distance,
    }));
  }

  // click-based tools
  const clickTracker = ref<{ down: { x: number; y: number } | null; moved: boolean }>({ down: null, moved: false });
  const boxSelectState = ref<{ active: boolean; startX: number; startY: number; endX: number; endY: number } | null>(null);

  function onCanvasPointerDown(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };

    const mode = store.toolMode.value;
    if (suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') return;
    if (mode === 'annotation_obb' || mode === 'pick_refno_box') {
      cloudFlow.beginMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (pendingCloudAnchor.value) {
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

    const mode = store.toolMode.value;
    if (suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') return;
    if (mode === 'annotation_cloud' || mode === 'annotation_obb' || mode === 'pick_refno_box') {
      cloudFlow.moveMarquee(canvas, e, mode);
      return;
    }

  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return;

    const mode = store.toolMode.value;
    if (suppressStoreOverlays && mode !== 'none' && mode !== 'pick_refno' && mode !== 'pick_refno_box' && mode !== 'pick_query_center') {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    if (mode === 'annotation_obb' || mode === 'pick_refno_box') {
      cloudFlow.endMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (marqueeState.value.active) {
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
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      cloudFlow.setPendingCloudAnchor({
        worldPos: vec3ToTuple(hit.worldPos),
        refno: hit.entityId,
        entityId: hit.entityId,
      });
      return;
    }
    if (mode === 'annotation_rect') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const compat = compatViewerRef.value;
      if (!compat) return;
      const pickedRefno = parseRefnoFromDtxObjectId(hit.objectId) || hit.entityId;
      const aabb = compat.scene.getAABB([pickedRefno]);
      if (!aabb) return;
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));
      const obb = computeAabbObbFromBox3(box);
      const n = store.rectAnnotations.value.length + 1;
      const rec = createRectAnnotationRecordFromObb({
        objectIds: [pickedRefno],
        refnos: [pickedRefno],
        obb,
        title: `矩形批注 ${n}`,
        regionV1: cloudFlow.buildSharedRegionForMembers([pickedRefno]) ?? undefined,
      });
      store.addRectAnnotation(rec);
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
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) {
        // 点击空白处，清除选择（除非按住 Shift）
        if (!e.shiftKey) {
          const viewer = compatViewerRef.value;
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
      const viewer = compatViewerRef.value;
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
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      store.setPickedQueryCenter({ entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) });
      store.setToolMode('none');
      return;
    }

    if (pick.handlePointerUp(canvas, e, mode)) return;

    if (measure.handlePointerUp(canvas, e, mode)) return;

    // annotation: click to create text annotation
    if (mode === 'annotation') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const n = store.annotations.value.length + 1;
      // 优先绑定当前点击命中的构件，避免沿用全局旧选中导致误绑。
      const boundRefno = String(hit.entityId || '').trim() || selectionStore.selectedRefno.value || undefined;
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
      store.addAnnotation(rec);
      return;
    }

    // 点击其它批注模式时，保持不误创建文字批注
  }

  function onCanvasPointerCancel(canvas: HTMLCanvasElement, e: PointerEvent) {
    void e;
    if (suppressStoreOverlays) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    host.hideMarquee();
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
    clickTracker.value = { down: null, moved: false };
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  watch(
    () => ({
      measurements: store.measurements.value,
      annotations: store.annotations.value,
      cloudAnnotations: store.cloudAnnotations.value,
      rectAnnotations: store.rectAnnotations.value,
      obbAnnotations: store.obbAnnotations.value,
      activeAnnotationId: store.activeAnnotationId.value,
      activeCloudAnnotationId: store.activeCloudAnnotationId.value,
      activeRectAnnotationId: store.activeRectAnnotationId.value,
      activeObbAnnotationId: store.activeObbAnnotationId.value,
    }),
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      overlay.syncFromStore();
    },
    { deep: true }
  );

  watch(
    () => annotationStyleStore.cloudDrawMode.value,
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      overlay.syncFromStore();
      requestRender?.();
    },
  );

  watch(
    () => annotationStyleStore.style.cloud,
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      overlay.syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  // ADR-0050：解析表整表替换（模型加载 / 定位回执 / 详情卡重算 / 批注后到）→ 就地换降级外观，不重建 overlay
  watch(bindingResolve.entries, () => {
    if (!dtxViewerRef.value || !overlayContainerRef.value) return;
    overlay.applyBindingDegrade();
  });

  // pick_refno：候选变化与取消拾取时同步高亮

  // 显示单位变化：刷新测量标签等 overlay 文本
  watch(
    () => [unitSettings.displayUnit.value, unitSettings.precision.value],
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      overlay.syncFromStore();
      requestRender?.();
    }
  );

  watch(
    () => [store.toolMode.value, selectionStore.selectedRefnos.value.join('|')] as const,
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
    () => store.cloudTargetRefnos.value.join('|'),
    () => {
      cloudFlow.clearPendingCloudAnchor();
      host.hideMarquee();
    },
  );

  watch(
    () => store.toolMode.value,
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
    () => dtxViewerRef.value,
    (viewer, prev) => {
      if (prev && toolsGroup.parent === prev.scene) {
        prev.scene.remove(toolsGroup);
      }
      if (viewer) {
        host.ensureToolsGroupAttached();
        overlay.syncFromStore();
      } else {
        clearGroup(toolsGroup);
        host.clearOverlayEls();
      }
    },
    { immediate: true }
  );

  const panelActions = createPanelActions(ctx, {
    resolveCloudTargetBbox: overlay.resolveCloudTargetBbox,
    clearTextAnnotationMarkerClickTimer: annotation.clearTextAnnotationMarkerClickTimer,
    resetPickCandidateSession: pick.resetPickCandidateSession,
    clearOverlayEls: host.clearOverlayEls,
    hideMarquee: host.hideMarquee,
    resetProgress: measure.resetProgress,
    clearPendingCloudAnchor: cloudFlow.clearPendingCloudAnchor,
  });

  return {
    ready,
    statusText: measure.statusText,
    objectToObjectUiState: measure.objectToObjectUiState,
    refreshReadyState,

    syncFromStore: overlay.syncFromStore,
    updateOverlayPositions: overlay.updateOverlayPositions,

    // actions used by panels
    flyToMeasurement: panelActions.flyToMeasurement,
    flyToAnnotation: panelActions.flyToAnnotation,
    flyToCloudAnnotation: panelActions.flyToCloudAnnotation,
    flyToRectAnnotation: panelActions.flyToRectAnnotation,
    flyToObbAnnotation: panelActions.flyToObbAnnotation,

    removeMeasurement: panelActions.removeMeasurement,
    removeAnnotation: panelActions.removeAnnotation,
    removeCloudAnnotation: panelActions.removeCloudAnnotation,
    removeRectAnnotation: panelActions.removeRectAnnotation,
    removeObbAnnotation: panelActions.removeObbAnnotation,

    highlightAnnotationTarget: panelActions.highlightAnnotationTarget,
    highlightAnnotationTargets: panelActions.highlightAnnotationTargets,

    // 云线创建：目标先行
    pendingCloudAnchor,
    canDrawCloudAnnotation: cloudFlow.canDrawCloudAnnotation,
    cancelCloudCreation: cloudFlow.cancelCloudCreation,
    suspendCloudCreation: cloudFlow.suspendCloudCreation,
    rollbackCloudCreationStep: cloudFlow.rollbackCloudCreationStep,
    clearPendingCloudAnchor: cloudFlow.clearPendingCloudAnchor,
    cloudGateBlock: cloudFlow.cloudGateBlock,

    // pick_refno 候选轮换（重叠构件）
    pickCandidates,
    pickCandidateIndex,
    cyclePickCandidate: pick.cyclePickCandidate,

    // e2e/调试：读取云线轮廓当前渲染几何（世界坐标），用于验证「贴合包住」性质
    debugCloudOutlines: panelActions.debugCloudOutlines,
    // e2e/调试：云线渲染计数（静止零重建验收）与 V1 标签布局结果
    debugCloudRenderStats: panelActions.debugCloudRenderStats,
    resetCloudRenderStats: panelActions.resetCloudRenderStats,
    debugCloudLabelLayouts: panelActions.debugCloudLabelLayouts,
    debugCloudRegionRender: panelActions.debugCloudRegionRender,
    // P4 LOD：本帧计划快照；悬停临时升档（图钉的 pointerenter / leave 已绑定，这里给测试与外部调用）
    debugCloudLod: panelActions.debugCloudLod,
    setHoveredCloudAnnotation: lod.setHoveredCloudAnnotation,
    // P4 LOD 聚合：pin 档图钉的屏幕聚合快照；打开 / 关闭某簇的成员列表；相机飞到一组云线
    debugCloudClusters: panelActions.debugCloudClusters,
    openClusterPopover: lod.openClusterPopover,
    closeClusterPopover: lod.closeClusterPopover,
    flyToCloudAnnotations: lod.flyToCloudAnnotations,
    // P4 inspection：遮挡淡化快照；覆盖显示模式（null = 跟随 URL mbd_mode）；不等相机停下立刻探一遍
    debugCloudInspection: inspection.debugCloudInspection,
    setCloudInspectionMode: inspection.setCloudInspectionMode,
    runCloudInspectionNow: inspection.runCloudInspectionNow,
    // ADR-0050 视口降级：解析表变化后就地换外观（watch 已接；这里给测试直接调）与当前外观快照
    applyBindingDegrade: overlay.applyBindingDegrade,
    debugAnnotationDegrades: panelActions.debugAnnotationDegrades,

    // 云线 V1 标签拖动（文字框拖柄的 pointer 事件由 syncFromStore 绑定；这里给测试与外部调用）
    beginInlineOverlayAnnotationDrag: annotation.beginInlineOverlayAnnotationDrag,
    continueInlineOverlayAnnotationDrag: annotation.continueInlineOverlayAnnotationDrag,
    endInlineOverlayAnnotationDrag: annotation.endInlineOverlayAnnotationDrag,

    clearAllInScene: panelActions.clearAllInScene,
    dispose: panelActions.dispose,

    // input hook (ViewerPanel 使用)
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    cancelMeasurementInteraction: measure.cancelMeasurementInteraction,

    // 兼容：selectionStore 在 none 模式下由 ViewerPanel 处理
    selectionStore,
  };
}
