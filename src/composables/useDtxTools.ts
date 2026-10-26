import { type Ref, computed, ref, watch } from 'vue';

import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { Box3, Group, Line, LineDashedMaterial, Matrix4, Vector3 } from 'three';

import { computeAabbObbFromBox3, createRectAnnotationRecordFromObb, getDefaultTextAnnotationLabelWorldPos, isDtxInteractionReady, shouldRenderTextAnnotationCard, toggleTextAnnotationCollapsed } from './dtxTools/annotationRecords';
import { CLOUD_FIT_PADDING_PX, CLOUD_TARGET_BBOX_TTL_MS, boxCornersFromMinMaxVec, buildCloudBillboardPolyline, buildWavySelectionBboxLinePositions, cloudWavesPerEdgeForSizePx, computeFittedCloudRectFromCorners, dashSizeFromLineSegments, updateCloudBboxLineSegmentsGeometry } from './dtxTools/cloudGeometry';
import { type CloudOverlayEl, type CloudRenderStats, collectWorldCellEdgePositions, createCloudRenderCache, createDefaultCloudLabelLayoutV1, isRegionPresentationRecord, labelPreferenceFromRecord, regionRenderStyleFromRecord } from './dtxTools/cloudRegion';
import { createAnnotationInteraction } from './dtxTools/controllers/annotationInteraction';
import { createCloudCreationFlow } from './dtxTools/controllers/cloudCreationFlow';
import { createCloudInspection } from './dtxTools/controllers/cloudInspection';
import { createCloudLodController } from './dtxTools/controllers/cloudLod';
import { createMeasureController } from './dtxTools/controllers/measureController';
import { createOverlayHost } from './dtxTools/controllers/overlayHost';
import { createPanelActions } from './dtxTools/controllers/panelActions';
import { createPickCandidateController } from './dtxTools/controllers/pickCandidateController';
import { EMPTY_BOUNDS, IDENTITY_MATRIX_ELEMENTS, clamp, getCanvasPos, measureLabelSize, nowId, overlayToWorld, parseRefnoFromDtxObjectId, vec3ToTuple, worldToOverlay, worldToOverlayPoint } from './dtxTools/geometry';
import { buildAnnotationLeaderStyle, createTextAnnotationLeader, setAnnotationLeaderResolution, updateLeaderGeometry } from './dtxTools/leaderVisual';
import { makeInlineAnnotationCardEl, makeTextAnnotationCardEl, makeTextAnnotationMarkerEl, repaintMarkerDegrade } from './dtxTools/overlayDom';
import { type PickRefnoCandidate, type PickRefnoRayHit } from './dtxTools/pickCandidates';
import { asVec3 } from './dtxTools/pipeMeasureMath';
import { applyBoxOverlayDegrade, clearGroup, createCloudAnnotationVisual, createObbAnnotationVisual, createRectAnnotationVisual, getCanvasResolution, resolveObbAnnotationAnchorWorldPos } from './dtxTools/visuals';

import type { CloudLodState, DtxToolsContext } from './dtxTools/context';
import type { AnnotationLeaderVisual, AnnotationOverlayKind, DragRect, InlineOverlayAnnotationDragState, LabelEl, ObbOverlayEl, PendingCloudAnchor, RectOverlayEl, RectPlaneDrag, TextAnnotationDragState } from './dtxTools/types';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import { applyDashedLineDegrade, applyLeaderDegrade, applyMeshLineDegrade, createCloudDegradeBadgeEl, positionCloudDegradeBadge, sameDegrade } from '@/composables/annotationDegradeViewport';
import { buildRecordDegradeKey, useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { dtxLoaderRevision } from '@/composables/useDbnoInstancesDtxLoader';
import { useReviewStore } from '@/composables/useReviewStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { type AnnotationRecord, type Vec3, getCloudMemberRefnos, useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import { liftScreenPolylineToBillboard, matricesEqual, regionToWorldCells, renderCloudRegion } from '@/review/domain/annotationProjection/annotationProjection';
import { type PinClusterItem } from '@/review/domain/annotationProjection/cluster';
import { ALL_CLOUD_DIRTY, type CloudRenderStamp, computeCloudDirty, createArrayVersionTracker, createValueVersionTracker } from '@/review/domain/annotationProjection/dirty';
import { inspectionFactor } from '@/review/domain/annotationProjection/inspection';
import { type LabelPreference, labelOffsetFromTopLeft, layoutCloudLabel, rectToCloudFrame } from '@/review/domain/annotationProjection/labelLayout';
import { type CloudLodLevel, DEFAULT_CLOUD_LOD_OPTIONS } from '@/review/domain/annotationProjection/lod';
import { regionCoversMembers } from '@/review/domain/cloudRegion';
import { worldPerPixelAt } from '@/utils/three/annotation/utils/solvespaceLike';

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
    unitSettings,
    clearanceStore,
    reviewStore,
    userStore,
    annotationStyleStore,
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

  const annotation = createAnnotationInteraction(ctx, { updateOverlayPositions });
  const lod = createCloudLodController(ctx, { updateOverlayPositions, activateAnnotation: annotation.activateAnnotation });
  const inspection = createCloudInspection(ctx, { updateOverlayPositions, resolveCloudTargetBbox });
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

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  /**
   * 云线文字框（行内卡）DOM：从 syncFromStore 抽出来，P4 LOD 下只给 `full` 档挂载、降到 `pin` 档时卸掉——
   * 上千条云线不为每条都建一张带输入框的卡。事件绑定与旧代码一致；重复调用（已挂载）不重建。
   */
  function mountCloudLabel(cloud: CloudOverlayEl): void {
    const overlay = overlayContainerRef.value;
    if (!overlay || labels.has(cloud.id)) return;
    const c = cloud.record;
    const anchor = cloud.worldPos;
    const labelWorldPos = cloud.labelWorldPos;
    const draft = annotation.getInlineTextAnnotationDraft('cloud', c.id, c);
    const label = makeInlineAnnotationCardEl(overlay, '云线批注', draft.title, draft.description);
    label.style.transform = 'translate(-50%,-50%)';
    if (c.severity) label.dataset.severity = c.severity;
    labels.set(cloud.id, { id: cloud.id, worldPos: labelWorldPos, el: label });
    const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
    const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      annotation.activateAnnotation('cloud', c.id);
    });
    label.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      annotation.focusInlineAnnotationEditor('cloud', c.id);
    });
    label.addEventListener('focusout', () => {
      queueMicrotask(() => {
        const activeElement = label.ownerDocument?.activeElement;
        if (activeElement && label.contains(activeElement)) return;
        annotation.commitInlineAnnotationDraft('cloud', c.id);
      });
    });

    dragHandle?.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      annotation.commitInlineAnnotationDraft('cloud', c.id);
      dragHandle.style.cursor = 'grabbing';
      annotation.beginInlineOverlayAnnotationDrag('cloud', c.id, ev, labelWorldPos, anchor);
      try {
        dragHandle.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    });
    dragHandle?.addEventListener('pointermove', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      annotation.continueInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointerup', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      annotation.endInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointercancel', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      annotation.endInlineOverlayAnnotationDrag(ev);
    });

    titleInput?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      annotation.activateAnnotation('cloud', c.id);
    });
    titleInput?.addEventListener('input', () => {
      annotation.setInlineAnnotationDraft('cloud', c.id, {
        title: titleInput.value,
        description: descriptionInput?.value ?? draft.description,
      });
    });
    descriptionInput?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      annotation.activateAnnotation('cloud', c.id);
    });
    descriptionInput?.addEventListener('input', () => {
      annotation.setInlineAnnotationDraft('cloud', c.id, {
        title: titleInput?.value ?? draft.title,
        description: descriptionInput.value,
      });
    });

    if (store.pendingCloudAnnotationEditId.value === c.id) {
      queueMicrotask(() => annotation.focusInlineAnnotationEditor('cloud', c.id));
    }
  }

  /** 降到 `pin` 档：卸掉文字框 DOM（草稿在 inlineTextAnnotationDrafts 里，不随 DOM 丢） */
  function unmountCloudLabel(cloud: CloudOverlayEl): void {
    const entry = labels.get(cloud.id);
    if (!entry) return;
    try { entry.el.remove(); } catch { /* ignore */ }
    labels.delete(cloud.id);
    cloud.render.labelLayout = null;
  }

  function syncFromStore() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    if (!viewer || !overlay) return;
    const resolution = getCanvasResolution(viewer.canvas);

    host.ensureToolsGroupAttached();
    clearGroup(toolsGroup);
    host.clearOverlayEls();
    textLeaders.clear();
    annotation.pruneInlineTextAnnotationDrafts();

    // clearGroup 连同候选预览一起销毁了，重建以免轮换线框在批注同步时凭空消失。
    pick.rebuildCandidatePreview();

    if (suppressStoreOverlays) return;

    // ADR-0050：一趟拿全部记录的降级态（missing / stale），创建时就画成灰虚线；之后解析表变化走 applyBindingDegrade 原地更新
    const degrades = bindingResolve.getRecordDegrades();
    const degradeOf = (kind: AnnotationOverlayKind, id: string): AnnotationDegrade | null =>
      degrades.get(buildRecordDegradeKey(kind, id)) ?? null;

    // ---------------- Text annotations ----------------
    for (const a of store.annotations.value) {
      if (!a.visible) continue;

      const worldPos = asVec3(a.worldPos);
      if (!worldPos) continue;
      const labelPos = asVec3(a.labelWorldPos) ?? getDefaultTextAnnotationLabelWorldPos(worldPos);
      const wp = new Vector3(...worldPos);
      const labelWorldPos = new Vector3(...labelPos);
      const degrade = degradeOf('text', a.id);
      const glyph = a.glyph || 'A';
      const marker = makeTextAnnotationMarkerEl(overlay, glyph, a.collapsed === true, { degrade, badge: true });
      if (a.severity) marker.dataset.severity = a.severity;
      markers.set(`anno:${a.id}`, {
        id: `anno:${a.id}`,
        worldPos: wp,
        el: marker,
        marker: { kind: 'text', annotationId: a.id, glyph, collapsed: a.collapsed === true, degrade },
      });
      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.scheduleTextAnnotationMarkerSingleClick(a.id);
      });
      marker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        annotation.handleTextAnnotationMarkerDoubleClick(a.id);
      });

      if (shouldRenderTextAnnotationCard(a.collapsed)) {
        const leader = createTextAnnotationLeader(wp, labelWorldPos, resolution);
        applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
        toolsGroup.add(leader.root);
        textLeaders.set(`anno:${a.id}`, leader);

        const draft = annotation.getInlineTextAnnotationDraft('text', a.id, a);
        const label = makeTextAnnotationCardEl(overlay, draft.title, draft.description);
        if (a.severity) label.dataset.severity = a.severity;
        labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: labelWorldPos, el: label });

        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('text', a.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            annotation.commitInlineAnnotationDraft('text', a.id);
          });
        });

        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          annotation.commitInlineAnnotationDraft('text', a.id);
          dragHandle.style.cursor = 'grabbing';
          annotation.beginTextAnnotationDrag(a.id, ev, labelWorldPos, wp);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          annotation.continueTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          annotation.endTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          annotation.endTextAnnotationDrag(ev);
        });

        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('text', a.id);
        });
        titleInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('text', a.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });

        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('text', a.id);
        });
        descriptionInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('text', a.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingTextAnnotationEditId.value === a.id) {
          queueMicrotask(() => annotation.focusInlineAnnotationEditor('text', a.id));
        }
      }
    }

    // ---------------- Cloud annotations (screen-space cloud + world anchor) ----------------
    // P4 LOD（方案 §9.3）：云线超过预算时文字框 DOM 不在这里建——由 updateOverlayPositions 按计划只给 full 档挂载
    // （本函数末尾就会调一次，同一同步调用内完成，不闪）；≤ 预算或开关关时照旧当场建。集合变了，LOD 计划要重算。
    let visibleCloudCount = 0;
    for (const c of store.cloudAnnotations.value) if (c.visible) visibleCloudCount += 1;
    const deferCloudLabels = isCloudRenderFlagEnabled('cloudAdaptiveLod') && visibleCloudCount > DEFAULT_CLOUD_LOD_OPTIONS.budget;
    cloudLod.setVersion += 1;
    cloudLod.planKey = '';

    for (const c of store.cloudAnnotations.value) {
      if (!c.visible) continue;
      const anchor = new Vector3(...c.anchorWorldPos);
      const visual = createCloudAnnotationVisual(c, resolution);
      const degrade = degradeOf('cloud', c.id);
      // 引线的降级在这里就地应用；轮廓 / 盒边 / 小针的颜色与虚线由 updateOverlayPositions 的 paint 阶段按 cloud.degrade 统一刷
      applyLeaderDegrade(visual.leader, buildAnnotationLeaderStyle('cloud').color, degrade);
      // pin / outline / bboxEdges 始终加入；leader（图钉 → 文字框引线）随 collapsed 控制，
      // 与文字批注的「双击图钉收起文字框 / 引线，保留图钉」行为对齐。
      toolsGroup.add(visual.pin, visual.outline, visual.bboxEdges);
      if (shouldRenderTextAnnotationCard(c.collapsed)) {
        toolsGroup.add(visual.leader.root);
      }
      const cloudEntry: CloudOverlayEl = {
        id: `cloud:${c.id}`,
        worldPos: anchor,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
        outline: visual.outline,
        outlineExtra: [],
        bboxEdges: visual.bboxEdges,
        pin: visual.pin,
        pinDashSize: visual.pinDashSize,
        record: c,
        targetBbox: null,
        targetBboxAt: 0,
        render: createCloudRenderCache(),
        degrade,
        badgeEl: degrade ? createCloudDegradeBadgeEl(overlay, degrade) : null,
        badgeDirty: true,
      };
      cloudShapes.set(cloudEntry.id, cloudEntry);

      // 云线的图钉只换灰虚线、不挂徽标——徽标挂在轮廓参考框左上角，一条记录一枚
      const cloudMarker = makeTextAnnotationMarkerEl(overlay, 'C', c.collapsed === true, { degrade, badge: false });
      markers.set(`cloud:${c.id}`, {
        id: `cloud:${c.id}`,
        worldPos: anchor,
        el: cloudMarker,
        marker: { kind: 'cloud', annotationId: c.id, glyph: 'C', collapsed: c.collapsed === true, degrade },
      });
      cloudMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.activateAnnotation('cloud', c.id);
      });
      // 与文字批注 marker 一致：双击图钉切换 collapsed，
      // 收起时只渲染图钉，展开后再补回文字框 / 引线。
      cloudMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setCloudAnnotationsCollapsed([c.id], toggleTextAnnotationCollapsed(c.collapsed));
        annotation.activateAnnotation('cloud', c.id);
      });
      // P4 LOD「悬停临时展示」：图钉上悬停即固定高档（补回轮廓 + 文字框），移开后按预算回落
      cloudMarker.addEventListener('pointerenter', () => lod.setHoveredCloudAnnotation(c.id));
      cloudMarker.addEventListener('pointerleave', () => {
        if (cloudLod.hoveredId === c.id) lod.setHoveredCloudAnnotation(null);
      });

      if (shouldRenderTextAnnotationCard(c.collapsed) && !deferCloudLabels) {
        mountCloudLabel(cloudEntry);
      }
    }

    // ---------------- Rect annotations (OBB rectangle) ----------------
    for (const r of store.rectAnnotations.value) {
      if (!r.visible) continue;

      const visual = createRectAnnotationVisual(r, resolution);
      if (!visual) continue;
      // box + pin 始终加入；leader 随 collapsed 控制（与文字 / 云线一致）。
      toolsGroup.add(visual.box, visual.pin);
      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        toolsGroup.add(visual.leader.root);
      }

      const rectAnchor = new Vector3(...r.anchorWorldPos);
      const rectDegrade = degradeOf('rect', r.id);
      const rectEntry: RectOverlayEl = {
        id: `rect:${r.id}`,
        worldPos: rectAnchor,
        labelWorldPos: (r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos).clone(),
        leader: visual.leader,
        box: visual.box,
        pin: visual.pin,
        lineColor: visual.lineColor,
        boxDashSize: visual.boxDashSize,
        pinDashSize: visual.pinDashSize,
        degrade: null,
      };
      // ADR-0050：成员 missing 时线框 / 小针 / 引线灰虚线（与云线同一套）
      applyBoxOverlayDegrade(rectEntry, 'rect', rectDegrade);
      rectShapes.set(rectEntry.id, rectEntry);

      // 新增 DOM marker：与 cloud 一致，提供「双击图钉收起 / 展开」入口。
      const rectMarker = makeTextAnnotationMarkerEl(overlay, 'R', r.collapsed === true, { degrade: rectDegrade, badge: true });
      markers.set(`rect:${r.id}`, {
        id: `rect:${r.id}`,
        worldPos: rectAnchor,
        el: rectMarker,
        marker: { kind: 'rect', annotationId: r.id, glyph: 'R', collapsed: r.collapsed === true, degrade: rectDegrade },
      });
      rectMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.activateAnnotation('rect', r.id);
      });
      rectMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setRectAnnotationsCollapsed([r.id], toggleTextAnnotationCollapsed(r.collapsed));
        annotation.activateAnnotation('rect', r.id);
      });

      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        const draft = annotation.getInlineTextAnnotationDraft('rect', r.id, r);
        const label = makeInlineAnnotationCardEl(overlay, '矩形批注', draft.title, draft.description);
        if (r.severity) label.dataset.severity = r.severity;
        const labelWorldPos = r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos;
        labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: labelWorldPos, el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('rect', r.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          annotation.focusInlineAnnotationEditor('rect', r.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            annotation.commitInlineAnnotationDraft('rect', r.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          annotation.commitInlineAnnotationDraft('rect', r.id);
          dragHandle.style.cursor = 'grabbing';
          annotation.beginInlineOverlayAnnotationDrag('rect', r.id, ev, labelWorldPos, rectAnchor);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          annotation.continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('rect', r.id);
        });
        titleInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('rect', r.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('rect', r.id);
        });
        descriptionInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('rect', r.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingRectAnnotationEditId.value === r.id) {
          queueMicrotask(() => annotation.focusInlineAnnotationEditor('rect', r.id));
        }
      }
    }

    // ---------------- OBB annotations ----------------
    for (const o of store.obbAnnotations.value) {
      if (!o.visible) continue;
      const visual = createObbAnnotationVisual(o, resolution);
      if (!visual) continue;
      // box + pin 始终加入；leader 随 collapsed 控制（与文字 / 云线 / 矩形一致）。
      toolsGroup.add(visual.box, visual.pin);
      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        toolsGroup.add(visual.leader.root);
      }

      const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(o);
      const obbDegrade = degradeOf('obb', o.id);
      const obbEntry: ObbOverlayEl = {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
        box: visual.box,
        pin: visual.pin,
        lineColor: visual.lineColor,
        boxDashSize: visual.boxDashSize,
        pinDashSize: visual.pinDashSize,
        degrade: null,
      };
      // ADR-0050：成员 missing 时线框 / 小针 / 引线灰虚线（与云线 / 矩形同一套）
      applyBoxOverlayDegrade(obbEntry, 'obb', obbDegrade);
      obbShapes.set(obbEntry.id, obbEntry);

      // 新增 DOM marker：与 cloud / rect 一致，提供「双击图钉收起 / 展开」入口。
      const obbMarker = makeTextAnnotationMarkerEl(overlay, 'O', o.collapsed === true, { degrade: obbDegrade, badge: true });
      markers.set(`obb:${o.id}`, {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        el: obbMarker,
        marker: { kind: 'obb', annotationId: o.id, glyph: 'O', collapsed: o.collapsed === true, degrade: obbDegrade },
      });
      obbMarker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.detail > 1) return;
        annotation.activateAnnotation('obb', o.id);
      });
      obbMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setObbAnnotationsCollapsed([o.id], toggleTextAnnotationCollapsed(o.collapsed));
        annotation.activateAnnotation('obb', o.id);
      });

      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        const draft = annotation.getInlineTextAnnotationDraft('obb', o.id, o);
        const label = makeInlineAnnotationCardEl(overlay, 'OBB 批注', draft.title, draft.description);
        if (o.severity) label.dataset.severity = o.severity;
        labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: visual.labelWorldPos.clone(), el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('obb', o.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          annotation.focusInlineAnnotationEditor('obb', o.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            annotation.commitInlineAnnotationDraft('obb', o.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          annotation.commitInlineAnnotationDraft('obb', o.id);
          dragHandle.style.cursor = 'grabbing';
          annotation.beginInlineOverlayAnnotationDrag('obb', o.id, ev, visual.labelWorldPos.clone(), anchorWorldPos);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          annotation.continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          annotation.endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('obb', o.id);
        });
        titleInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('obb', o.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          annotation.activateAnnotation('obb', o.id);
        });
        descriptionInput?.addEventListener('input', () => {
          annotation.setInlineAnnotationDraft('obb', o.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingObbEditId.value === o.id) {
          queueMicrotask(() => annotation.focusInlineAnnotationEditor('obb', o.id));
        }
      }
    }

    // preview rect line (if exists)
    if (rectPreviewLine.value) {
      toolsGroup.add(rectPreviewLine.value);
    }

    updateOverlayPositions();
    requestRender?.();
  }

  /**
   * 云线贴合/包围盒所依据的目标合并 AABB。
   *
   * 不能只认 `record.selectionBbox`——它是创建那一刻的世界坐标快照，
   * 创建时目标未加载就永远缺失，模型版本切换后又会框住旧位置。
   * 这里按目标 refnos 现算并缓存 `CLOUD_TARGET_BBOX_TTL_MS`，
   * 解析不到（未加载 / refno 失效）时才退回快照，保证既自愈又不倒退。
   */
  function resolveCloudTargetBbox(cloud: CloudOverlayEl): { min: Vec3; max: Vec3 } | null {
    const now = Date.now();
    // 用时间戳而不是「有没有结果」判缓存：解析失败（目标未加载）同样要冷却，
    // 否则一批未加载目标的云线会每帧各查一次 AABB。
    if (cloud.targetBboxAt > 0 && now - cloud.targetBboxAt < CLOUD_TARGET_BBOX_TTL_MS) {
      return cloud.targetBbox;
    }
    const refnos = getCloudMemberRefnos(cloud.record);
    const live = refnos.length > 0
      ? compatViewerRef.value?.scene.getAABB(refnos) ?? null
      : null;
    cloud.targetBbox = live
      ? { min: [live[0], live[1], live[2]], max: [live[3], live[4], live[5]] }
      : cloud.record.selectionBbox ?? null;
    cloud.targetBboxAt = now;
    return cloud.targetBbox;
  }

  function updateOverlayPositions() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const resolution = getCanvasResolution(canvas);

    for (const leader of textLeaders.values()) {
      setAnnotationLeaderResolution(leader, resolution.width, resolution.height);
    }
    for (const cloud of cloudShapes.values()) {
      setAnnotationLeaderResolution(cloud.leader, resolution.width, resolution.height);
    }
    for (const rect of rectShapes.values()) {
      setAnnotationLeaderResolution(rect.leader, resolution.width, resolution.height);
    }
    for (const obb of obbShapes.values()) {
      setAnnotationLeaderResolution(obb.leader, resolution.width, resolution.height);
    }

    // ---- 帧级版本戳（方案 §9.1，开关 cloudDirtyCache）：所有云线共用，一帧算一次 ----
    const dirtyCacheOn = isCloudRenderFlagEnabled('cloudDirtyCache');
    const labelFlagOn = isCloudRenderFlagEnabled('cloudLabelLayoutV1');
    const envelopeOn = isCloudRenderFlagEnabled('cloudProjectedEnvelope');
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const drawMode = annotationStyleStore.cloudDrawMode.value;
    const cloudStyle = annotationStyleStore.style.cloud;
    const frameStamp = {
      cameraWorld: cloudFrameTrackers.cameraWorld.update(viewer.camera.matrixWorld.elements),
      projection: cloudFrameTrackers.projection.update(viewer.camera.projectionMatrix.elements),
      viewportCss: cloudFrameTrackers.viewportCss.update([canvasRect.width, canvasRect.height]),
      overlayTransform: cloudFrameTrackers.overlayTransform.update([
        canvasRect.left - overlayRect.left,
        canvasRect.top - overlayRect.top,
        overlayRect.width,
        overlayRect.height,
      ]),
      dpr: cloudFrameTrackers.dpr.update([resolution.width, resolution.height]),
      globalModelMatrix: cloudFrameTrackers.globalModelMatrix.update(
        dtxLayerRef.value?.getGlobalModelMatrix().elements ?? IDENTITY_MATRIX_ELEMENTS,
      ),
      modelEpoch: dtxLoaderRevision.value,
      shapeStyle: cloudFrameTrackers.shapeStyle.update(`${drawMode}|${CLOUD_FIT_PADDING_PX}|${envelopeOn ? 1 : 0}|${cloudStyle.lineWidth}`),
      paintStyle: cloudFrameTrackers.paintStyle.update(`${cloudStyle.color}|${cloudStyle.opacity}|${cloudStyle.lineWidth}`),
    };
    const viewportRect = { x: 0, y: 0, width: overlayRect.width || canvasRect.width, height: overlayRect.height || canvasRect.height };
    cloudRenderStats.frames += 1;

    // ---- P4 LOD（方案 §9.3）：超预算时先定本帧谁算全轮廓、谁只留图钉；相机 / 视口 / 集合 / 交互态没变就复用上次计划 ----
    const lodReplanned = lod.planCloudLodForFrame(viewer.camera, `${frameStamp.cameraWorld}|${frameStamp.projection}|${frameStamp.viewportCss}`);
    // ---- P4 inspection（方案 §10）：本帧的显示模式，一帧读一次 ----
    const inspectionMode = inspection.currentCloudInspectionMode();
    cloudLod.inspectionPending = false;

    for (const cloud of cloudShapes.values()) {
      // ---- LOD 切档：pin 档整条跳过（不解析目标 AABB、不算凸包、不 setPoints、不排文字框），只剩 DOM 图钉 ----
      if (cloud.render.lodLevel === 'pin') {
        if (cloud.render.lodApplied !== 'pin') {
          cloud.render.lodApplied = 'pin';
          cloud.outline.visible = false;
          for (const extra of cloud.outlineExtra) extra.visible = false;
          cloud.bboxEdges.visible = false;
          cloud.leader.root.visible = false;
          unmountCloudLabel(cloud);
          cloud.render.frame = null;
          cloud.render.regionPhase = null;
          cloud.render.stamp = null;
          cloud.render.inspectionFactor = 1;
          cloud.render.inspectionKey = '';
          cloud.render.inspectionProbes = [];
        }
        // 降级徽标跟着图钉走（没有参考框）
        if (cloud.badgeEl) {
          positionCloudDegradeBadge(cloud.badgeEl, null, worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos), false);
        }
        continue;
      }
      if (cloud.render.lodApplied !== 'full') {
        // 首帧或从 pin 升回来：全部阶段重建；文字框按 collapsed 补挂；引线先放出来，V1 布局再按需要藏
        const promoted = cloud.render.lodApplied === 'pin';
        cloud.render.lodApplied = 'full';
        if (promoted) {
          cloud.render.stamp = null;
          cloud.leader.root.visible = true;
        }
        if (shouldRenderTextAnnotationCard(cloud.record.collapsed)) mountCloudLabel(cloud);
      }
      const recordVersion = cloud.render.recordTracker.update(cloud.record);
      // ---- P2：range 记录（开关开 + 显式 region-v1）先把范围体校验 / 重映射成当前世界系的凸单元 ----
      // 随「记录引用 | DTX 全局矩阵版本」失效；校验不过 = missing-region → 下面照旧走旧管线（唯一允许回退旧布局的状态）
      const regionRequested = envelopeOn && isRegionPresentationRecord(cloud.record);
      if (regionRequested) {
        const cellsKey = `${recordVersion}|${frameStamp.globalModelMatrix}`;
        if (cloud.render.regionCellsKey !== cellsKey) {
          const recorded = cloud.record.regionV1?.source.globalModelMatrix ?? null;
          const current = dtxLayerRef.value?.getGlobalModelMatrix() ?? null;
          let remap: number[] | null = null;
          if (recorded && current && !matricesEqual(recorded, current.elements)) {
            const old = new Matrix4().fromArray(recorded);
            // 唯一有可信转换的情形：两边矩阵都在 → G_new · G_old⁻¹ 把范围体搬到当前世界系再投影（§8 补充 1）
            remap = Math.abs(old.determinant()) > 1e-18 ? current.clone().multiply(old.invert()).elements.slice() : null;
          }
          // §8：快照与绑定不一致（重绑后新成员还没拿到盒）= 没有可用范围，走旧的实时 AABB 贴合，不用子集缩小范围冒充
          const covers = regionCoversMembers(cloud.record.regionV1, getCloudMemberRefnos(cloud.record));
          const validated = covers
            ? regionToWorldCells(cloud.record.regionV1, remap)
            : { ok: false as const, reason: 'coverage: region does not cover all members' };
          cloud.render.regionCells = validated.ok ? validated.cells : null;
          cloud.render.regionInvalidReason = validated.ok ? null : validated.reason;
          cloud.render.regionCellsKey = cellsKey;
          if (!validated.ok) cloud.render.regionPhase = null;
        }
      } else if (cloud.render.regionCells || cloud.render.regionCellsKey) {
        cloud.render.regionCells = null;
        cloud.render.regionCellsKey = '';
        cloud.render.regionInvalidReason = null;
        cloud.render.regionPhase = null;
      }
      const regionCells = regionRequested ? cloud.render.regionCells : null;
      // 范围体是回放权威：走新管线的记录不再每帧解析目标 AABB
      const sb = regionCells ? null : resolveCloudTargetBbox(cloud);
      const labelEntry = labels.get(cloud.id);
      // 走 V1 屏幕布局的条件：开关开，且记录带 labelLayoutV1——或正在按像素拖动（旧记录第一次拖动即按默认锚点升级，松手写入记录）
      const labelDragging = labelFlagOn && cloud.render.labelDragTopLeft !== null;
      const layoutRecord = labelFlagOn
        ? (cloud.record.labelLayoutV1 ?? (labelDragging ? createDefaultCloudLabelLayoutV1() : null))
        : null;
      const labelV1 = !!labelEntry && !!layoutRecord;
      // 文字框实测尺寸是 label 阶段的依赖（字体加载完、文字改了都会变）；布局干净时读 offsetWidth 不触发回流
      const measured = labelV1 && labelEntry ? measureLabelSize(labelEntry.el) : null;

      // ---- P4 inspection（方案 §10）：检视模式下、非强调、非失效的云线，相机 / 模型 / 记录变了就记一笔「待探」，
      // 射线在相机停下（settle）后由 runCloudInspection 打；置顶模式 / 强调 / 失效一律因子 1（STALE 提示要可读）----
      if (inspectionMode === 'inspection' && !cloud.degrade && !inspection.isCloudEmphasized(cloud)) {
        if (cloud.render.inspectionKey !== inspection.cloudInspectionKey(cloud, frameStamp)) cloudLod.inspectionPending = true;
      } else if (cloud.render.inspectionFactor !== 1 || cloud.render.inspectionKey !== '') {
        cloud.render.inspectionFactor = 1;
        cloud.render.inspectionKey = '';
        cloud.render.inspectionProbes = [];
      }
      const inspectionAlpha = cloud.render.inspectionFactor;

      const stamp: CloudRenderStamp = {
        ...frameStamp,
        // paint 版本叠上本条记录的降级态与 inspection 因子：解析表让它 missing / stale（或恢复）、遮挡淡化变了，只有它重刷材质
        paintStyle: cloud.render.paintTracker.update(`${frameStamp.paintStyle}|${cloud.degrade?.state ?? ''}|${inspectionAlpha}`),
        targetBounds: cloud.render.targetBoundsTracker.update(sb ? [...sb.min, ...sb.max] : EMPTY_BOUNDS),
        bindings: recordVersion,
        effectiveRegion: cloud.render.regionCellsTracker.update(regionCells),
        labelMetrics: measured
          ? cloud.render.labelMetricsTracker.update(`${measured.width}x${measured.height}`)
          : cloud.render.labelMetricsTracker.version,
        labelPreference: recordVersion,
        presentation: recordVersion,
      };
      const dirty = dirtyCacheOn ? computeCloudDirty(cloud.render.stamp, stamp) : { ...ALL_CLOUD_DIRTY };
      cloud.render.stamp = stamp;

      if (dirty.paint) {
        // ADR-0050 视口降级：missing / stale 的记录轮廓 / 盒边 / 小针一律灰 + 虚线（outlineExtra 与 outline 共用材质）
        // P4 inspection：透明度再乘遮挡因子（只调 α，depthTest 仍 false）；文字框 DOM / 图钉 / 徽标不淡，保持可读
        const outlineMat = cloud.outline.material as MeshLineMaterial;
        applyMeshLineDegrade(outlineMat, cloudStyle.color, cloud.degrade);
        outlineMat.opacity = cloudStyle.opacity * inspectionAlpha;
        outlineMat.lineWidth = cloudStyle.lineWidth;
        outlineMat.resolution.set(resolution.width, resolution.height);
        const bboxMat = cloud.bboxEdges.material as LineDashedMaterial;
        applyDashedLineDegrade(bboxMat, cloudStyle.color, cloud.degrade, dashSizeFromLineSegments(cloud.bboxEdges));
        bboxMat.opacity = cloudStyle.opacity * inspectionAlpha;
        const pinMat = cloud.pin.material as LineDashedMaterial;
        applyDashedLineDegrade(pinMat, cloudStyle.color, cloud.degrade, cloud.pinDashSize);
        if (inspectionAlpha < 1 || pinMat.transparent) {
          pinMat.transparent = true;
          pinMat.opacity = inspectionAlpha;
        }
        const leaderStyle = buildAnnotationLeaderStyle('cloud');
        cloud.leader.coreMaterial.opacity = leaderStyle.opacity * inspectionAlpha;
        cloud.leader.haloMaterial.opacity = leaderStyle.haloOpacity * inspectionAlpha;
        cloudRenderStats.paintUpdates += 1;
      }

      if (dirty.shape && regionCells) {
        // ---- P2 范围体管线（方案 §3.3）：齐次裁剪 → 屏幕凸包 → 圆角外扩 → 单侧余弦波纹 → billboard ----
        cloudRenderStats.contourBuilds += 1;
        const viewport = {
          width: canvasRect.width || canvas.clientWidth || 1,
          height: canvasRect.height || canvas.clientHeight || 1,
        };
        const viewProjection = new Matrix4().multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse);
        const style = regionRenderStyleFromRecord(cloud.record, cloudStyle.lineWidth);
        const result = renderCloudRegion({
          cells: regionCells,
          viewProjection: viewProjection.elements,
          viewport,
          style,
          previous: cloud.render.regionPhase,
          previousLod: cloud.render.regionLod,
          active: store.activeCloudAnnotationId.value === cloud.record.id,
        });
        cloud.render.regionState = result.state;
        cloud.render.regionLastLod = result.lod;
        cloud.render.regionLod = result.lod === 'icon' ? 'icon' : 'cloud';
        if (result.path && result.phase) cloud.render.regionPhase = { path: result.path, frame: result.phase };
        cloud.render.regionPolylineCount = result.polylines.length;

        // 屏幕坐标是 canvas CSS 像素；文字框布局与 DOM 定位要 overlay 坐标
        const dx = canvasRect.left - overlayRect.left;
        const dy = canvasRect.top - overlayRect.top;
        cloud.render.frame = result.referenceBounds
          ? {
            referenceBounds: {
              x: result.referenceBounds.x + dx,
              y: result.referenceBounds.y + dy,
              width: result.referenceBounds.width,
              height: result.referenceBounds.height,
            },
            enclosure: result.enclosure.map((p) => ({ x: p.x + dx, y: p.y + dy })),
            visibleStrokes: result.polylines.map((piece) => piece.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
          }
          : null;
        // 置顶装饰线统一放在 ndcZ = 0 的 billboard 平面；引线端点同一平面反投影
        cloud.render.frameNdcZ = 0;

        if (drawMode === 'bbox3d') {
          // §4.7：同一范围体的真实盒边（多成员多盒、剪切下按平行六面体），不再画随相机游动的波浪边；可见性由裁剪结果决定
          cloud.outline.visible = false;
          for (const extra of cloud.outlineExtra) extra.visible = false;
          updateCloudBboxLineSegmentsGeometry(cloud.bboxEdges, collectWorldCellEdgePositions(regionCells));
          cloudRenderStats.setPoints += 1;
          cloud.bboxEdges.visible = result.projection.state === 'visible';
        } else {
          cloud.bboxEdges.visible = false;
          const inverseViewProjection = viewProjection.clone().invert().elements;
          const pieces = result.polylines;
          // 第 1 段用主 MeshLine，其余段用同材质的备用 MeshLine（MeshLine 不支持子路径）
          while (cloud.outlineExtra.length < pieces.length - 1) {
            const extra = new MeshLine(new MeshLineGeometry(), cloud.outline.material as MeshLineMaterial);
            extra.frustumCulled = false;
            extra.renderOrder = cloud.outline.renderOrder;
            toolsGroup.add(extra);
            cloud.outlineExtra.push(extra);
          }
          const meshes = [cloud.outline, ...cloud.outlineExtra];
          for (let i = 0; i < meshes.length; i++) {
            const mesh = meshes[i]!;
            const piece = pieces[i];
            if (!piece || piece.length < 2) {
              mesh.visible = false;
              continue;
            }
            const positions = liftScreenPolylineToBillboard(piece, inverseViewProjection, viewport, 0);
            (mesh.geometry as MeshLineGeometry).setPoints(positions);
            mesh.geometry.computeBoundingSphere();
            mesh.visible = true;
            cloudRenderStats.setPoints += 1;
          }
        }
      } else if (dirty.shape) {
        cloudRenderStats.contourBuilds += 1;
        const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos);
        const labelScreen = labelV1 ? null : worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.labelWorldPos);
        cloud.render.frame = null;
        cloud.render.frameNdcZ = anchorScreen.ndcZ;
        cloud.render.regionState = regionRequested ? 'missing-region' : null;
        for (const extra of cloud.outlineExtra) extra.visible = false;

        let renderBbox3d = drawMode === 'bbox3d' && !!sb?.min && !!sb?.max;
        let bboxPositions: Float32Array | null = null;
        if (renderBbox3d && sb) {
          const camPos = new Vector3();
          viewer.camera.getWorldPosition(camPos);
          bboxPositions = buildWavySelectionBboxLinePositions(sb.min, sb.max, camPos, 10);
          if (bboxPositions.length < 6) {
            renderBbox3d = false;
            bboxPositions = null;
          }
        }

        if (renderBbox3d && bboxPositions && sb) {
          cloud.outline.visible = false;
          updateCloudBboxLineSegmentsGeometry(cloud.bboxEdges, bboxPositions);
          cloudRenderStats.setPoints += 1;
          cloud.bboxEdges.visible = anchorScreen.visible;
          // bbox3d 下文字框仍需要一个屏幕参考框：8 个角点全部可见时取其外接矩形 + padding，否则退回旧世界点布局
          const projectedCorners = boxCornersFromMinMaxVec(
            new Vector3(sb.min[0], sb.min[1], sb.min[2]),
            new Vector3(sb.max[0], sb.max[1], sb.max[2]),
          ).map((corner) => worldToOverlayPoint(viewer.camera, canvas, overlay, corner));
          if (projectedCorners.every((p) => p.visible)) {
            const fittedRect = computeFittedCloudRectFromCorners(projectedCorners, CLOUD_FIT_PADDING_PX);
            if (fittedRect) {
              cloud.render.frame = rectToCloudFrame({
                x: fittedRect.centerX - fittedRect.widthPx / 2,
                y: fittedRect.centerY - fittedRect.heightPx / 2,
                width: fittedRect.widthPx,
                height: fittedRect.heightPx,
              });
              cloud.render.frameNdcZ = worldToOverlayPoint(
                viewer.camera,
                canvas,
                overlay,
                new Vector3((sb.min[0] + sb.max[0]) * 0.5, (sb.min[1] + sb.max[1]) * 0.5, (sb.min[2] + sb.max[2]) * 0.5),
              ).ndcZ;
            }
          }
        } else {
          cloud.bboxEdges.visible = false;
          cloud.outline.visible = true;

          // 贴合优先：把目标合并 AABB 的 8 个角投影到屏幕求外接矩形（+padding），保证
          // 绑定目标在任意相机角度下都被云线包住；拖框尺寸只作最小尺寸兜底。
          // AABB 缺失或有角点越过近/远平面（如相机钻进目标内部）时退回锚点+偏移的固定布局。
          const minWidthPx = clamp(cloud.record.cloudSize?.width ?? 120, 72, 220);
          const minHeightPx = clamp(cloud.record.cloudSize?.height ?? 72, 48, 180);
          let widthPx = minWidthPx;
          let heightPx = minHeightPx;
          const off = cloud.record.screenOffset ?? { x: widthPx * 0.5 + 26, y: -(heightPx * 0.5 + 18) };
          let centerX = anchorScreen.x + off.x;
          let centerY = anchorScreen.y + off.y;
          let centerNdcZ = anchorScreen.ndcZ;
          let fitted = false;
          if (sb?.min && sb?.max) {
            const cornerPoints = boxCornersFromMinMaxVec(
              new Vector3(sb.min[0], sb.min[1], sb.min[2]),
              new Vector3(sb.max[0], sb.max[1], sb.max[2]),
            );
            const projectedCorners = cornerPoints.map(
              (corner) => worldToOverlayPoint(viewer.camera, canvas, overlay, corner),
            );
            if (projectedCorners.every((p) => p.visible)) {
              const fittedRect = computeFittedCloudRectFromCorners(projectedCorners, CLOUD_FIT_PADDING_PX, {
                width: minWidthPx,
                height: minHeightPx,
              });
              if (fittedRect) {
                widthPx = fittedRect.widthPx;
                heightPx = fittedRect.heightPx;
                centerX = fittedRect.centerX;
                centerY = fittedRect.centerY;
                // billboard 平面放在 AABB 中心深度，保证像素→世界换算与投影一致
                centerNdcZ = worldToOverlayPoint(
                  viewer.camera,
                  canvas,
                  overlay,
                  new Vector3(
                    (sb.min[0] + sb.max[0]) * 0.5,
                    (sb.min[1] + sb.max[1]) * 0.5,
                    (sb.min[2] + sb.max[2]) * 0.5,
                  ),
                ).ndcZ;
                fitted = true;
              }
            }
          }
          const cloudCenterWorld = overlayToWorld(
            viewer.camera,
            canvas,
            overlay,
            centerX,
            centerY,
            centerNdcZ,
          );
          const worldPerPixel = worldPerPixelAt(
            viewer.camera,
            cloudCenterWorld,
            Math.max(1, canvas.clientWidth),
            Math.max(1, canvas.clientHeight),
          );
          const cameraDir = viewer.camera.getWorldDirection(new Vector3()).normalize();
          let right = new Vector3().crossVectors(cameraDir, viewer.camera.up).normalize();
          if (!Number.isFinite(right.lengthSq()) || right.lengthSq() < 1e-8) {
            right = new Vector3(1, 0, 0);
          }
          const up = new Vector3().crossVectors(right, cameraDir).normalize();
          const wavesPerEdge = cloudWavesPerEdgeForSizePx(widthPx, heightPx);
          const positions = buildCloudBillboardPolyline(
            cloudCenterWorld,
            right,
            up,
            widthPx * worldPerPixel,
            heightPx * worldPerPixel,
            clamp(wavesPerEdge * 4, 16, 200),
            worldPerPixel,
            wavesPerEdge,
          );
          const outlineGeometry = cloud.outline.geometry as MeshLineGeometry;
          outlineGeometry.setPoints(positions);
          cloudRenderStats.setPoints += 1;
          cloud.outline.geometry.computeBoundingSphere();
          // V1 标签总在视口安全区内，可见性只看锚点；旧布局仍要求文字框世界点也在视锥内
          cloud.outline.visible = fitted || (anchorScreen.visible && (labelScreen?.visible ?? true));
          // 文字框的屏幕参考框 = 加 padding、未加波浪的矩形（波浪只向外，参考框不含它）
          cloud.render.frame = rectToCloudFrame({
            x: centerX - widthPx / 2,
            y: centerY - heightPx / 2,
            width: widthPx,
            height: heightPx,
          });
          cloud.render.frameNdcZ = centerNdcZ;
        }
      }

      // ---- ADR-0050 视口降级：盒边几何刚重建时按新尺度补一次虚线节拍；徽标贴到轮廓参考框左上角 ----
      if (cloud.degrade && dirty.shape && cloud.bboxEdges.visible) {
        applyDashedLineDegrade(cloud.bboxEdges.material as LineDashedMaterial, cloudStyle.color, cloud.degrade, dashSizeFromLineSegments(cloud.bboxEdges));
      }
      if (cloud.badgeEl && (dirty.shape || dirty.paint || cloud.badgeDirty)) {
        cloud.badgeDirty = false;
        const frame = cloud.render.frame;
        positionCloudDegradeBadge(
          cloud.badgeEl,
          frame ? { x: frame.referenceBounds.x, y: frame.referenceBounds.y } : null,
          worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos),
          cloud.outline.visible || cloud.bboxEdges.visible,
        );
      }

      // ---- 文字框 + 引线（方案 §5，开关 cloudLabelLayoutV1）----
      if (labelEntry) {
        const frame = cloud.render.frame;
        if (labelV1 && frame && layoutRecord && measured) {
          const dragTopLeft = cloud.render.labelDragTopLeft;
          if (dirty.label || dragTopLeft || labelEntry.layoutMode !== 'v1') {
            const preference: LabelPreference = dragTopLeft
              ? { uv: layoutRecord.anchor.uv, offsetPx: labelOffsetFromTopLeft(frame.referenceBounds, layoutRecord.anchor.uv, dragTopLeft) }
              : labelPreferenceFromRecord(layoutRecord);
            const layout = layoutCloudLabel(frame, preference, measured, viewportRect);
            cloud.render.labelLayout = layout;
            cloudRenderStats.labelLayouts += 1;

            labelEntry.layoutMode = 'v1';
            labelEntry.el.style.transform = 'none';
            labelEntry.el.style.left = `${layout.rect.x}px`;
            labelEntry.el.style.top = `${layout.rect.y}px`;
            labelEntry.el.style.opacity = '1';

            if (layout.leader) {
              const start = overlayToWorld(viewer.camera, canvas, overlay, layout.leader.start.x, layout.leader.start.y, cloud.render.frameNdcZ);
              const end = overlayToWorld(viewer.camera, canvas, overlay, layout.leader.end.x, layout.leader.end.y, cloud.render.frameNdcZ);
              updateLeaderGeometry(cloud.leader, start, end);
              cloud.leader.root.visible = true;
            } else {
              cloud.leader.root.visible = false;
            }
          }
        } else if (labelV1 && regionCells && layoutRecord) {
          // 范围体在（offscreen / depth-empty / 图标态）但本帧没有可用轮廓：藏起文字框与引线，
          // **不**回退旧世界点布局——「有范围但被裁剪 / 出屏」与「没有可用范围」是两种状态
          if (dirty.label || labelEntry.layoutMode !== 'v1') {
            labelEntry.layoutMode = 'v1';
            labelEntry.el.style.transform = 'none';
            labelEntry.el.style.opacity = '0';
            cloud.leader.root.visible = false;
            cloud.render.labelLayout = null;
          }
        } else if (labelEntry.layoutMode === 'v1') {
          // 从 V1 回到旧布局（开关关掉 / 本帧没有可用轮廓）：还原居中变换与图钉 → 文字框引线
          labelEntry.layoutMode = 'legacy';
          labelEntry.el.style.transform = 'translate(-50%,-50%)';
          cloud.leader.root.visible = true;
          updateLeaderGeometry(cloud.leader, cloud.worldPos, cloud.labelWorldPos);
          cloud.render.labelLayout = null;
        }
      }
    }

    // pin 档图钉的屏幕聚合只在 LOD 计划重算的那一帧重做（图钉屏幕位置只随相机 / 视口 / 集合变）；
    // 退出超预算（或开关关）那一帧拆掉徽标、放回图钉
    const clusterItems: PinClusterItem[] | null = lodReplanned && cloudLod.planSummary.overBudget ? [] : null;
    if (lodReplanned && !cloudLod.planSummary.overBudget && (cloudLod.clusterBadges.size > 0 || cloudLod.clusterHiddenMarkerIds.size > 0)) {
      lod.clearPinClusterDom();
    }
    for (const it of markers.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
      if (clusterItems && p.visible && it.marker?.kind === 'cloud' && cloudShapes.get(it.id)?.render.lodLevel === 'pin') {
        clusterItems.push({ id: it.id, x: p.x, y: p.y });
      }
    }
    if (clusterItems) lod.applyPinClusters(clusterItems);

    // 检视模式下有云线待探：等相机停下（settle）再打射线；置顶模式下不会有待探，也就一条射线都不打
    if (cloudLod.inspectionPending) inspection.scheduleCloudInspection();
    else if (cloudLod.inspectionTimer !== null && inspectionMode !== 'inspection') {
      clearTimeout(cloudLod.inspectionTimer);
      cloudLod.inspectionTimer = null;
    }

    for (const it of labels.values()) {
      if (it.layoutMode === 'v1') continue;
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
    }
  }

  /**
   * ADR-0050 视口降级：解析表变了（模型加载 / 版本切换、定位回执、详情卡重算、批注后到）就地换外观——
   * 不走 syncFromStore 重建：重建会打断行内编辑（输入框被换掉）并清空云线渲染缓存。
   * 云线：记 `degrade`、换引线、增删徽标，轮廓 / 盒边 / 小针交给下一帧 paint 阶段（paintTracker 含降级态）；
   * 图钉：原地重画 SVG；文字批注引线：直接换材质；rect / obb：线框 / 小针 / 引线直接换材质。
   */
  function applyBindingDegrade(): void {
    const overlay = overlayContainerRef.value;
    const degrades = bindingResolve.getRecordDegrades();
    let changed = false;

    for (const cloud of cloudShapes.values()) {
      const degrade = degrades.get(buildRecordDegradeKey('cloud', cloud.record.id)) ?? null;
      if (sameDegrade(cloud.degrade, degrade)) continue;
      changed = true;
      cloud.degrade = degrade;
      applyLeaderDegrade(cloud.leader, buildAnnotationLeaderStyle('cloud').color, degrade);
      if (cloud.badgeEl) {
        try { cloud.badgeEl.remove(); } catch { /* ignore */ }
        cloud.badgeEl = null;
      }
      if (degrade && overlay) {
        cloud.badgeEl = createCloudDegradeBadgeEl(overlay, degrade);
        cloud.badgeDirty = true;
      }
    }

    for (const entry of markers.values()) {
      const meta = entry.marker;
      if (!meta) continue;
      const degrade = degrades.get(buildRecordDegradeKey(meta.kind, meta.annotationId)) ?? null;
      if (repaintMarkerDegrade(entry, degrade)) changed = true;
    }

    for (const [key, leader] of textLeaders) {
      const degrade = degrades.get(buildRecordDegradeKey('text', key.slice('anno:'.length))) ?? null;
      if (sameDegrade(leader.degrade, degrade)) continue;
      changed = true;
      applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
    }

    for (const [kind, shapes] of [['rect', rectShapes], ['obb', obbShapes]] as const) {
      for (const entry of shapes.values()) {
        const degrade = degrades.get(buildRecordDegradeKey(kind, entry.id.slice(kind.length + 1))) ?? null;
        if (sameDegrade(entry.degrade, degrade)) continue;
        changed = true;
        applyBoxOverlayDegrade(entry, kind, degrade);
      }
    }

    if (!changed) return;
    updateOverlayPositions();
    requestRender?.();
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
      syncFromStore();
    },
    { deep: true }
  );

  watch(
    () => annotationStyleStore.cloudDrawMode.value,
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
      requestRender?.();
    },
  );

  watch(
    () => annotationStyleStore.style.cloud,
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  // ADR-0050：解析表整表替换（模型加载 / 定位回执 / 详情卡重算 / 批注后到）→ 就地换降级外观，不重建 overlay
  watch(bindingResolve.entries, () => {
    if (!dtxViewerRef.value || !overlayContainerRef.value) return;
    applyBindingDegrade();
  });

  // pick_refno：候选变化与取消拾取时同步高亮

  // 显示单位变化：刷新测量标签等 overlay 文本
  watch(
    () => [unitSettings.displayUnit.value, unitSettings.precision.value],
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
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
        syncFromStore();
      } else {
        clearGroup(toolsGroup);
        host.clearOverlayEls();
      }
    },
    { immediate: true }
  );

  const panelActions = createPanelActions(ctx, {
    resolveCloudTargetBbox,
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

    syncFromStore,
    updateOverlayPositions,

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
    applyBindingDegrade,
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
