import { type Ref, computed, ref } from 'vue';

import { Group, Line } from 'three';

import { isDtxInteractionReady } from './dtxTools/annotationRecords';
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
import { createPointerDispatcher } from './dtxTools/controllers/pointerDispatcher';
import { createSurfacePicker } from './dtxTools/controllers/surfacePicking';
import { installDtxToolsWatchers } from './dtxTools/controllers/watchers';
import { type PickRefnoCandidate } from './dtxTools/pickCandidates';

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
import { useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import { createArrayVersionTracker, createValueVersionTracker } from '@/review/domain/annotationProjection/dirty';
import { type CloudLodLevel } from '@/review/domain/annotationProjection/lod';

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
    selectionStore,
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

  const picker = createSurfacePicker(ctx);
  const annotation = createAnnotationInteraction(ctx, { updateOverlayPositions: () => overlay.updateOverlayPositions() });
  const lod = createCloudLodController(ctx, { updateOverlayPositions: () => overlay.updateOverlayPositions(), activateAnnotation: annotation.activateAnnotation });
  const inspection = createCloudInspection(ctx, { updateOverlayPositions: () => overlay.updateOverlayPositions(), resolveCloudTargetBbox: (cloud) => overlay.resolveCloudTargetBbox(cloud) });
  const host = createOverlayHost(ctx, { clearPinClusterDom: lod.clearPinClusterDom });
  const cloudFlow = createCloudCreationFlow(ctx, {
    pickSurfacePoint: picker.pickSurfacePoint,
    hideMarquee: host.hideMarquee,
    updateMarqueeStyle: host.updateMarqueeStyle,
    updateMarqueeRect: host.updateMarqueeRect,
    activateAnnotation: annotation.activateAnnotation,
  });

  const pick = createPickCandidateController(ctx, { pickSurfaceRayHits: picker.pickSurfaceRayHits, ensureToolsGroupAttached: host.ensureToolsGroupAttached });
  pick.installWatchers();

  const measure = createMeasureController(ctx, { pickSurfacePoint: picker.pickSurfacePoint, clearPendingCloudAnchor: cloudFlow.clearPendingCloudAnchor, hideMarquee: host.hideMarquee });

  // overlaySync 依赖上面的控制器，所以最后装配；上面几个对 updateOverlayPositions / resolveCloudTargetBbox 的引用都是延迟调用的转发
  const overlay = createOverlaySync(ctx, { annotation, lod, inspection, host, pick });
  const pointer = createPointerDispatcher(ctx, { picker, cloudFlow, pick, measure, host });
  installDtxToolsWatchers(ctx, { overlay, measure, cloudFlow, host });

  function refreshReadyState() {
    readyRevision.value += 1;
  }

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
    onCanvasPointerDown: pointer.onCanvasPointerDown,
    onCanvasPointerMove: pointer.onCanvasPointerMove,
    onCanvasPointerUp: pointer.onCanvasPointerUp,
    onCanvasPointerCancel: pointer.onCanvasPointerCancel,
    cancelMeasurementInteraction: measure.cancelMeasurementInteraction,

    // 兼容：selectionStore 在 none 模式下由 ViewerPanel 处理
    selectionStore,
  };
}
