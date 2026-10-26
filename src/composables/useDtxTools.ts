import { type Ref, computed, nextTick, ref, watch } from 'vue';

import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { Box3, BufferAttribute, BufferGeometry, Frustum, Group, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, Matrix4, Plane, Vector3 } from 'three';

import { computeAabbObbFromBox3, createCloudAnnotationRecordFromAnchorAndMarquee, createRectAnnotationRecordFromObb, getDefaultTextAnnotationLabelWorldPos, isDtxInteractionReady, resolveTextAnnotationMarkerDoubleClickAction, resolveTextAnnotationMarkerSingleClickAction, shouldRenderTextAnnotationCard, toggleTextAnnotationCollapsed, topCenterFromBox3 } from './dtxTools/annotationRecords';
import { CLOUD_FIT_PADDING_PX, CLOUD_TARGET_BBOX_TTL_MS, boxCornersFromMinMaxVec, buildCloudBillboardPolyline, buildWavySelectionBboxLinePositions, cloudWavesPerEdgeForSizePx, computeFittedCloudRectFromCorners, dashSizeFromLineSegments, updateCloudBboxLineSegmentsGeometry } from './dtxTools/cloudGeometry';
import { type CloudClusterDebugSnapshot, type CloudInspectionDebugSnapshot, type CloudLodDebugSnapshot, type CloudOverlayEl, type CloudRenderStats, buildCloudSourceStamp, buildMembersRegionV1, captureCreationViewSnapshot, collectWorldCellEdgePositions, createCloudRenderCache, createDefaultCloudLabelLayoutV1, isRegionPresentationRecord, labelPreferenceFromRecord, regionRenderStyleFromRecord, resolveRegionObjectIdsForRefno } from './dtxTools/cloudRegion';
import { createPanelActions } from './dtxTools/controllers/panelActions';
import { EMPTY_BOUNDS, IDENTITY_MATRIX_ELEMENTS, aabbFromPoints, clamp, escapeAnnotationLabelText, getCanvasPos, measureLabelSize, nowId, overlayToWorld, parseRefnoFromDtxObjectId, vec3ToTuple, worldToOverlay, worldToOverlayPoint } from './dtxTools/geometry';
import { buildAnnotationLeaderStyle, createTextAnnotationLeader, setAnnotationLeaderResolution, updateLeaderGeometry } from './dtxTools/leaderVisual';
import { ensureDiv, makeInlineAnnotationCardEl, makeTextAnnotationCardEl, makeTextAnnotationMarkerEl, repaintMarkerDegrade } from './dtxTools/overlayDom';
import { resolveAnnotationLabelClickAction } from './dtxTools/overlayHtml';
import { type PickRefnoCandidate, type PickRefnoRayHit, buildPickRefnoCandidates, buildPickTubeCandidates, isSamePickAnchor, isSamePickCandidateSequence, isTubeKeyLike, isTubePickFilter, nextPickCandidateIndex, resolveBoxPickRefnos } from './dtxTools/pickCandidates';
import { type ObjectMeasureCandidate, PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES, PIPE_STRUCTURE_DEFAULT_NOUNS, PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES, PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT, type PipeMeasureResult, type PipeMeasureSeed, type PipeToPipeBranCandidate, type PipeWallDistanceCandidate, asVec3, buildObjectMeasurePairKey, choosePipeMeasureBetterSeed, collectOrderedPipeReferencePointSeeds, computeApproxNearestBetweenObjects, fromSeed, normalizeRefnoKey, parseDbnumFromRefno, resolveLoadedVisibleObjectCandidateByRefno, vec3ByMatrix } from './dtxTools/pipeMeasureMath';
import { applyBoxOverlayDegrade, buildWireBoxGeometryFromBox3, clearGroup, createCloudAnnotationVisual, createObbAnnotationVisual, createRectAnnotationVisual, disposeObject3d, getCanvasResolution, resolveObbAnnotationAnchorWorldPos } from './dtxTools/visuals';

import type { CloudLodState, DtxToolsContext } from './dtxTools/context';
import type { AnnotationLabelClickState, AnnotationLeaderVisual, AnnotationOverlayKind, DragRect, InlineOverlayAnnotationDragState, InlineTextAnnotationDraft, LabelEl, ObbOverlayEl, PendingCloudAnchor, RectOverlayEl, RectPlaneDrag, TextAnnotationDragState, TextAnnotationMarkerClickResult } from './dtxTools/types';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { genModelV1SpatialCenterline, genModelV1SpatialNearestClearance } from '@/api/genModelV1Api';
import { reviewAttachmentDelete } from '@/api/reviewApi';
import { commitBranParallelSpacing } from '@/clearance/adapters/branSpacingRecords';
import { parseServerWarning } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import { setAnnotationProcessingEntryTarget } from '@/components/review/annotationProcessingEntry';
import { isExternalSjFormFocusedMode, readPersistedEmbedModeParams } from '@/components/review/embedRoleLanding';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import { applyDashedLineDegrade, applyLeaderDegrade, applyMeshLineDegrade, createCloudDegradeBadgeEl, positionCloudDegradeBadge, sameDegrade } from '@/composables/annotationDegradeViewport';
import { attachAnnotationScreenshotByRoute } from '@/composables/annotationReceiptRoute';
import { DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG, buildStraightRuns, findParallelRunPairs } from '@/composables/branParallelSpacing';
import { buildRecordDegradeKey, useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { dtxLoaderRevision, findNounByRefnoAcrossAllDbnos, findOwnerBranRefnoAcrossAllDbnos, getDtxRefnoTransform, listDtxTubeObjects, resolveDtxObjectIdsByRefno } from '@/composables/useDbnoInstancesDtxLoader';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useReviewStore } from '@/composables/useReviewStore';
import { useScreenshot } from '@/composables/useScreenshot';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { type AnnotationRecord, type CloudAnnotationRecord, type MeasurementPoint, type ObbAnnotationRecord, type RectAnnotationRecord, type Vec3, buildCloudBindings, getCloudMemberRefnos, useToolStore } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useUserStore } from '@/composables/useUserStore';
import { SOLVESPACE_DIMENSION_THEME, isWorldSegmentBlocked } from '@/dimension';
import { commitDtxObjectToObjectClearance, commitDtxPointToObjectMeasurement } from '@/measurement/adapters/dtxDistanceRecords';
import { type CloudFitState, type SmallTargetLod, liftScreenPolylineToBillboard, matricesEqual, regionToWorldCells, renderCloudRegion } from '@/review/domain/annotationProjection/annotationProjection';
import { DEFAULT_PIN_CLUSTER_OPTIONS, type PinCluster, type PinClusterItem, clusterPins } from '@/review/domain/annotationProjection/cluster';
import { ALL_CLOUD_DIRTY, type CloudRenderStamp, computeCloudDirty, createArrayVersionTracker, createValueVersionTracker } from '@/review/domain/annotationProjection/dirty';
import { type CloudInspectionMode, type OcclusionProbe, chooseInspectionProbeMembers, inspectionFactor, inspectionModeFromSearch } from '@/review/domain/annotationProjection/inspection';
import { type CloudFrame, DEFAULT_LABEL_PREFERENCE, type LabelLayoutResult, type LabelPreference, labelOffsetFromTopLeft, layoutCloudLabel, rectToCloudFrame } from '@/review/domain/annotationProjection/labelLayout';
import { type CloudLodCandidate, type CloudLodLevel, DEFAULT_CLOUD_LOD_OPTIONS, cloudLodPriority, planCloudLod } from '@/review/domain/annotationProjection/lod';
import { type CloudLabelLayoutV1, type ObbSnapshot, type RegionV1, createRegionCloudPresentationV1, regionCoversMembers } from '@/review/domain/cloudRegion';
import { emitToast } from '@/ribbon/toastBus';
import { UserRole } from '@/types/auth';
import { worldPerPixelAt } from '@/utils/three/annotation/utils/solvespaceLike';
import { formatLengthMeters } from '@/utils/unitFormat';

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
  const { captureAndUpload } = useScreenshot();
  // U0：异步回执（自动截图）出发前盖 scope 戳，回来时按戳决定落到当前内存还是出发时那个 scope 的容器
  const draftSession = useAnnotationDraftSession();
  const userStore = useUserStore();
  const unitSettings = useUnitSettingsStore();
  const clearanceStore = useClearanceStore();
  const annotationStyleStore = useAnnotationStyleStore();
  // ADR-0050：批注关联的失效解析表（只读）；missing / stale 的记录在视口降级为灰虚线 + 左上角小徽标
  const bindingResolve = useAnnotationBindingResolve();
  const readyRevision = ref(0);

  /** 共享范围体（方案 §7 / §8）：成员 refno → 已加载对象的真实放置盒；拿不到几何回 null（不用子集冒充） */
  function resolveMemberRegionBoxes(refno: string): ObbSnapshot[] | null {
    const layer = dtxLayerRef.value;
    if (!layer) return null;
    const region = buildMembersRegionV1({
      memberRefnos: [refno],
      layer,
      getMemberAabb: (r) => compatViewerRef.value?.scene.getAABB([r]) ?? null,
      source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    });
    return region && region.kind === 'obb-union' ? [...region.boxes] : null;
  }
  // 重绑 member 时 store 用它给 `origin:'members'` 范围体补盒（原子更新绑定 + 范围 + 兼容字段）
  store.setAnnotationRegionMemberBoxResolver(resolveMemberRegionBoxes);

  /** rect / obb 新建（开关 `annotationSharedRegion`）：目标集合 → `regionV1(obb-union, origin:'members')`；范围不完整回 null 不写 */
  function buildSharedRegionForMembers(memberRefnos: readonly string[]): RegionV1 | null {
    if (!isCloudRenderFlagEnabled('annotationSharedRegion')) return null;
    const layer = dtxLayerRef.value;
    if (!layer) return null;
    return buildMembersRegionV1({
      memberRefnos,
      layer,
      getMemberAabb: (refno) => compatViewerRef.value?.scene.getAABB([refno]) ?? null,
      source: buildCloudSourceStamp(memberRefnos, layer),
    });
  }

  let lastAnnotationLabelClick: AnnotationLabelClickState | null = null;
  let textAnnotationMarkerClickTimer: ReturnType<typeof setTimeout> | null = null;

  // pick_refno：仅在拾取会话内维护，不写入 store
  const pickedHighlightByBran = new Map<string, string>();
  const pickedHighlightPinned = new Set<string>(); // 已在外部选中的对象，不应被拾取会话取消选中
  let lastAppliedPickHighlights: string[] = [];
  /** 按直段拾取的高亮（直段身份键，对象级选中） */
  let lastAppliedPickTubeHighlights: string[] = [];

  // pick_refno 候选轮换：一次点击命中的全部重叠构件 + 当前预览下标
  const pickCandidates = ref<PickRefnoCandidate[]>([]);
  const pickCandidateIndex = ref(0);
  let pickCandidateAnchor: { x: number; y: number } | null = null;
  let pickCandidatePreview: LineSegments | null = null;

  const ready = computed(() => {
    void readyRevision.value;
    return isDtxInteractionReady(dtxLayerRef.value);
  });

  const pointToObjectStart = ref<MeasurementPoint | null>(null);
  const objectToObjectSourceCandidate = ref<ObjectMeasureCandidate | null>(null);
  const objectToObjectTargetCandidate = ref<ObjectMeasureCandidate | null>(null);
  const objectToObjectBusy = ref(false);
  const objectToObjectStatus = ref('');
  const lastAppliedObjectMeasurePairKey = ref<string | null>(null);
  const pipeMeasureBusy = ref(false);
  const pipeMeasureStatus = ref<string>('');
  const pipeToPipeSourceCandidate = ref<PipeToPipeBranCandidate | null>(null);

  function activateAnnotation(kind: AnnotationOverlayKind, id: string) {
    store.activeAnnotationId.value = kind === 'text' ? id : null;
    store.activeCloudAnnotationId.value = kind === 'cloud' ? id : null;
    store.activeRectAnnotationId.value = kind === 'rect' ? id : null;
    store.activeObbAnnotationId.value = kind === 'obb' ? id : null;
  }

  function getAnnotationRecordByKind(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): AnnotationRecord | CloudAnnotationRecord | RectAnnotationRecord | ObbAnnotationRecord | null {
    if (kind === 'text') {
      return store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function resolveCurrentFormId(): string | undefined {
    return normalizeOptionalString(store.activeAnnotationContext.value?.record.formId)
      ?? normalizeOptionalString(reviewStore.currentTask.value?.formId);
  }

  function openAnnotationProcessingPage(kind: AnnotationOverlayKind, id: string) {
    commitInlineAnnotationDraft(kind, id);
    const currentTask = reviewStore.currentTask.value;
    const currentUser = userStore.currentUser.value;
    // SJ 经 PMS 外部流程打开带 form_id 的单据时，统一在 review 面板里处理批注，
    // 不再路由到设计侧 DCH。详见 .plannotator/plan-sj-reject-ui.md §5。
    const externalSjFormFocused = isExternalSjFormFocusedMode(readPersistedEmbedModeParams());
    const shouldUseDesignerPanel = !externalSjFormFocused && (
      currentUser?.role === UserRole.DESIGNER
      || (currentTask ? isCanonicalReturnedTask(currentTask) : false)
    );
    const formId = normalizeOptionalString(getAnnotationRecordByKind(kind, id)?.formId) ?? resolveCurrentFormId();
    activateAnnotation(kind, id);
    setAnnotationProcessingEntryTarget({
      annotationId: id,
      annotationType: kind,
      formId: formId ?? null,
    });
    ensurePanelAndActivate(shouldUseDesignerPanel ? 'designerCommentHandling' : 'review');
  }

  function openAnnotationEditor(kind: AnnotationOverlayKind, id: string) {
    if (kind === 'text') {
      focusInlineAnnotationEditor('text', id);
      return;
    }
    if (kind === 'cloud') {
      focusInlineAnnotationEditor('cloud', id);
      return;
    }
    if (kind === 'rect') {
      focusInlineAnnotationEditor('rect', id);
      return;
    }
    focusInlineAnnotationEditor('obb', id);
  }

  function getInlineAnnotationLabelKey(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string): string {
    if (kind === 'text') return `anno:${annotationId}`;
    if (kind === 'cloud') return `cloud:${annotationId}`;
    if (kind === 'rect') return `rect:${annotationId}`;
    return `obb:${annotationId}`;
  }

  function getInlineAnnotationDraftKey(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string): string {
    return `${kind}:${annotationId}`;
  }

  function setInlineAnnotationDraft(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    draft: InlineTextAnnotationDraft,
  ) {
    inlineTextAnnotationDrafts.set(getInlineAnnotationDraftKey(kind, annotationId), draft);
  }

  function getInlineTextAnnotationDraft(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    fallback: Pick<AnnotationRecord, 'title' | 'description'>,
  ): InlineTextAnnotationDraft {
    return inlineTextAnnotationDrafts.get(getInlineAnnotationDraftKey(kind, annotationId)) ?? {
      title: fallback.title || '批注',
      description: fallback.description || '',
    };
  }

  function pruneInlineTextAnnotationDrafts() {
    const existingKeys = new Set<string>([
      ...store.annotations.value.map((annotation) => getInlineAnnotationDraftKey('text', annotation.id)),
      ...store.cloudAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('cloud', annotation.id)),
      ...store.rectAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('rect', annotation.id)),
      ...store.obbAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('obb', annotation.id)),
    ]);
    for (const draftKey of inlineTextAnnotationDrafts.keys()) {
      if (!existingKeys.has(draftKey)) {
        inlineTextAnnotationDrafts.delete(draftKey);
      }
    }
  }

  function clearPendingInlineAnnotationEdit(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    if (kind === 'text' && store.pendingTextAnnotationEditId.value === annotationId) {
      store.pendingTextAnnotationEditId.value = null;
    }
    if (kind === 'cloud' && store.pendingCloudAnnotationEditId.value === annotationId) {
      store.pendingCloudAnnotationEditId.value = null;
    }
    if (kind === 'rect' && store.pendingRectAnnotationEditId.value === annotationId) {
      store.pendingRectAnnotationEditId.value = null;
    }
    if (kind === 'obb' && store.pendingObbEditId.value === annotationId) {
      store.pendingObbEditId.value = null;
    }
  }

  function focusInlineAnnotationEditor(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const label = labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    if (!label) {
      if (kind === 'text') store.pendingTextAnnotationEditId.value = annotationId;
      if (kind === 'cloud') store.pendingCloudAnnotationEditId.value = annotationId;
      if (kind === 'rect') store.pendingRectAnnotationEditId.value = annotationId;
      if (kind === 'obb') store.pendingObbEditId.value = annotationId;
      return;
    }
    const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    if (titleInput) {
      titleInput.focus();
      titleInput.select();
    }
    clearPendingInlineAnnotationEdit(kind, annotationId);
  }

  function handleAnnotationOverlayClick(kind: AnnotationOverlayKind, id: string) {
    const result = resolveAnnotationLabelClickAction(lastAnnotationLabelClick, kind, id, Date.now());
    lastAnnotationLabelClick = result.nextState;
    if (result.action === 'edit') {
      openAnnotationEditor(kind, id);
      return;
    }
    activateAnnotation(kind, id);
  }

  function clearTextAnnotationMarkerClickTimer() {
    if (!textAnnotationMarkerClickTimer) return;
    clearTimeout(textAnnotationMarkerClickTimer);
    textAnnotationMarkerClickTimer = null;
  }

  function applyTextAnnotationMarkerAction(id: string, result: TextAnnotationMarkerClickResult) {
    if (result.nextCollapsed !== null) {
      store.updateAnnotation(id, { collapsed: result.nextCollapsed });
    }

    if (result.activate) {
      activateAnnotation('text', id);
    }
  }

  function handleTextAnnotationMarkerSingleClick(id: string) {
    commitInlineAnnotationDraft('text', id);
    const rec = store.annotations.value.find((item) => item.id === id);
    if (!rec) return;
    applyTextAnnotationMarkerAction(id, resolveTextAnnotationMarkerSingleClickAction(rec.collapsed));
  }

  function handleTextAnnotationMarkerDoubleClick(id: string) {
    clearTextAnnotationMarkerClickTimer();
    commitInlineAnnotationDraft('text', id);
    const rec = store.annotations.value.find((item) => item.id === id);
    if (!rec) return;
    applyTextAnnotationMarkerAction(id, resolveTextAnnotationMarkerDoubleClickAction(rec.collapsed));
  }

  function scheduleTextAnnotationMarkerSingleClick(id: string) {
    clearTextAnnotationMarkerClickTimer();
    textAnnotationMarkerClickTimer = setTimeout(() => {
      textAnnotationMarkerClickTimer = null;
      handleTextAnnotationMarkerSingleClick(id);
    }, 220);
  }

  function commitDraggedTextAnnotation(annotationId: string, labelWorldPos: Vector3) {
    store.updateAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function commitDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    labelWorldPos: Vector3,
  ) {
    const patch = { leaderEndWorldPos: vec3ToTuple(labelWorldPos) };
    if (kind === 'cloud') {
      store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      store.updateRectAnnotation(annotationId, patch);
      return;
    }
    store.updateObbAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function getInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): Pick<AnnotationRecord, 'title' | 'description'> | null {
    if (kind === 'text') {
      return store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function updateInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    patch: { title?: string; description?: string },
  ) {
    if (kind === 'text') {
      store.updateAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'cloud') {
      store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      store.updateRectAnnotation(annotationId, patch);
      return;
    }
    store.updateObbAnnotation(annotationId, patch);
  }

  function commitInlineAnnotationDraft(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const rec = getInlineAnnotationRecord(kind, annotationId);
    if (!rec) return;
    const label = labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    const titleInput = label?.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    const descriptionInput = label?.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
    const draft = inlineTextAnnotationDrafts.get(getInlineAnnotationDraftKey(kind, annotationId));
    const nextTitle = titleInput
      ? (titleInput.value.trim() || '批注')
      : (draft ? (draft.title.trim() || '批注') : rec.title);
    const nextDescription = descriptionInput
      ? descriptionInput.value
      : (draft ? draft.description : rec.description);
    const patch: Partial<AnnotationRecord> = {};
    if (nextTitle !== rec.title) {
      patch.title = nextTitle;
    }
    if (nextDescription !== rec.description) {
      patch.description = nextDescription;
    }
    if (Object.keys(patch).length > 0) {
      updateInlineAnnotationRecord(kind, annotationId, patch);
    }
    inlineTextAnnotationDrafts.delete(getInlineAnnotationDraftKey(kind, annotationId));
  }

  function resetTextAnnotationDrag() {
    textAnnotationDrag.value = {
      annotationId: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
    };
  }

  function updateDraggedTextAnnotation(annotationId: string, nextLabelWorldPos: Vector3) {
    const labelEntry = labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    const leader = textLeaders.get(`anno:${annotationId}`);
    const dragAnchor = textAnnotationDrag.value.anchorWorldPos;
    if (leader && dragAnchor) {
      updateLeaderGeometry(leader, dragAnchor, nextLabelWorldPos);
    }
    updateOverlayPositions();
    requestRender?.();
  }

  function beginTextAnnotationDrag(
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    textAnnotationDrag.value = {
      annotationId,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
    };
  }

  function continueTextAnnotationDrag(event: PointerEvent) {
    const dragState = textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    const nextLabelWorldPos = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      event.clientX - overlayRect.left,
      event.clientY - overlayRect.top,
      dragState.anchorNdcZ,
    );
    dragState.moved = true;
    updateDraggedTextAnnotation(dragState.annotationId, nextLabelWorldPos);
  }

  function endTextAnnotationDrag(event: PointerEvent) {
    const dragState = textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId) return;
    const labelEntry = labels.get(`anno:${dragState.annotationId}`);
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const shouldCommit = dragState.moved && finalLabelWorldPos;
    resetTextAnnotationDrag();
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedTextAnnotation(annotationId, finalLabelWorldPos);
    } else {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  function resetInlineOverlayAnnotationDrag() {
    inlineOverlayAnnotationDrag.value = {
      annotationId: null,
      annotationKind: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
      labelGrabOffsetPx: null,
    };
  }

  function updateDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    nextLabelWorldPos: Vector3,
  ) {
    const labelEntry = labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    if (kind === 'cloud') {
      const cloud = cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) {
        cloud.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(cloud.leader, cloud.worldPos, nextLabelWorldPos);
      }
    } else if (kind === 'rect') {
      const rect = rectShapes.get(`rect:${annotationId}`);
      if (rect) {
        rect.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(rect.leader, rect.worldPos, nextLabelWorldPos);
      }
    } else {
      const obb = obbShapes.get(`obb:${annotationId}`);
      if (obb) {
        obb.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(obb.leader, obb.worldPos, nextLabelWorldPos);
      }
    }
    updateOverlayPositions();
    requestRender?.();
  }

  function beginInlineOverlayAnnotationDrag(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    // 云线 + 开关开：按屏幕像素拖（松手提交 labelLayoutV1 意图偏移）；记住按住点相对文字框左上角的偏移，
    // 拖动时文字框跟手而不是跳到指针下。旧记录（无 labelLayoutV1）第一次拖动即升级为 V1 布局（方案 §5）。
    let labelGrabOffsetPx: { x: number; y: number } | null = null;
    const cloud = kind === 'cloud' ? cloudShapes.get(`cloud:${annotationId}`) : undefined;
    if (cloud && labelEntry && isCloudRenderFlagEnabled('cloudLabelLayoutV1')) {
      const overlayRect = overlay.getBoundingClientRect();
      const pointerX = event.clientX - overlayRect.left;
      const pointerY = event.clientY - overlayRect.top;
      const currentRect = cloud.render.labelLayout?.rect ?? (() => {
        const elRect = labelEntry.el.getBoundingClientRect();
        return { x: elRect.left - overlayRect.left, y: elRect.top - overlayRect.top, width: elRect.width, height: elRect.height };
      })();
      labelGrabOffsetPx = { x: pointerX - currentRect.x, y: pointerY - currentRect.y };
    }
    inlineOverlayAnnotationDrag.value = {
      annotationId,
      annotationKind: kind,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
      labelGrabOffsetPx,
    };
  }

  function continueInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    if (dragState.labelGrabOffsetPx && dragState.annotationKind === 'cloud') {
      const cloud = cloudShapes.get(`cloud:${dragState.annotationId}`);
      if (cloud) {
        cloud.render.labelDragTopLeft = {
          x: event.clientX - overlayRect.left - dragState.labelGrabOffsetPx.x,
          y: event.clientY - overlayRect.top - dragState.labelGrabOffsetPx.y,
        };
        dragState.moved = true;
        updateOverlayPositions();
        requestRender?.();
        return;
      }
    }
    const nextLabelWorldPos = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      event.clientX - overlayRect.left,
      event.clientY - overlayRect.top,
      dragState.anchorNdcZ,
    );
    dragState.moved = true;
    updateDraggedOverlayAnnotation(dragState.annotationKind, dragState.annotationId, nextLabelWorldPos);
  }

  /**
   * V1 标签拖动松手：把最终文字框（已夹紧到安全区）反算成相对参考包围框锚点的意图偏移写进 `labelLayoutV1`，
   * 并按旧含义双写一次 `leaderEndWorldPos`（文字框中心在 billboard 深度上的世界点），旧端仍能按世界点布局。
   * 没有可用轮廓（frame 为空）时不提交，保持原记录。
   */
  function commitDraggedCloudLabelLayoutV1(annotationId: string): boolean {
    const cloud = cloudShapes.get(`cloud:${annotationId}`);
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!cloud || !viewer || !overlay || !canvas) return false;
    const frame = cloud.render.frame;
    const layout = cloud.render.labelLayout;
    if (!frame || !layout) return false;
    const uv = cloud.record.labelLayoutV1?.anchor.uv ?? DEFAULT_LABEL_PREFERENCE.uv;
    const offsetPx = labelOffsetFromTopLeft(frame.referenceBounds, uv, { x: layout.rect.x, y: layout.rect.y });
    const labelLayoutV1: CloudLabelLayoutV1 = {
      version: 1,
      anchor: { kind: 'contour-bounds', uv: [uv[0], uv[1]], labelPoint: 'top-left' },
      offsetPx: { x: Math.round(offsetPx.x * 100) / 100, y: Math.round(offsetPx.y * 100) / 100 },
    };
    const centerWorld = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      layout.rect.x + layout.rect.width / 2,
      layout.rect.y + layout.rect.height / 2,
      cloud.render.frameNdcZ,
    );
    store.updateCloudAnnotation(annotationId, { labelLayoutV1, leaderEndWorldPos: vec3ToTuple(centerWorld) });
    return true;
  }

  function endInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId) return;
    const labelEntry = labels.get(getInlineAnnotationLabelKey(dragState.annotationKind, dragState.annotationId));
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const annotationKind = dragState.annotationKind;
    const v1Drag = dragState.labelGrabOffsetPx !== null && annotationKind === 'cloud';
    const shouldCommit = dragState.moved && (v1Drag || finalLabelWorldPos);
    resetInlineOverlayAnnotationDrag();
    if (v1Drag) {
      const committed = shouldCommit && commitDraggedCloudLabelLayoutV1(annotationId);
      const cloud = cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) cloud.render.labelDragTopLeft = null;
      if (!committed) {
        updateOverlayPositions();
        requestRender?.();
      }
      return;
    }
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedOverlayAnnotation(annotationKind, annotationId, finalLabelWorldPos);
    } else {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  /** 直段高亮只落在那一段直管对象上（对象级），不走 refno 级选中。 */
  function applyPickTubeHighlights(keys: string[]): void {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const stale = lastAppliedPickTubeHighlights.filter((key) => !keys.includes(key));
    if (stale.length > 0) viewer.scene.setTubeSegmentsSelected(stale, false);
    if (keys.length > 0) viewer.scene.setTubeSegmentsSelected(keys, true);
    lastAppliedPickTubeHighlights = keys;
  }

  function applyPickHighlights(): void {
    const viewer = compatViewerRef.value;
    if (!viewer) return;

    const highlights = Array.from(new Set(pickedHighlightByBran.values())).filter(Boolean);
    applyPickTubeHighlights(highlights.filter(isTubeKeyLike));
    const next = highlights.filter((id) => !isTubeKeyLike(id));

    if (lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    if (next.length > 0) {
      // 若对象在进入/拾取前已被外部选中，则“取消拾取/删除候选”不应取消其高亮
      const selectedNow = new Set<string>(viewer.scene.selectedObjectIds);
      for (const id of next) {
        if (selectedNow.has(id) && !lastAppliedPickHighlights.includes(id)) {
          pickedHighlightPinned.add(id);
        }
      }
      viewer.scene.setObjectsSelected(next, true);
    }
    lastAppliedPickHighlights = next;
  }

  function clearPickHighlights(): void {
    const viewer = compatViewerRef.value;
    if (viewer && lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    applyPickTubeHighlights([]);
    pickedHighlightByBran.clear();
    pickedHighlightPinned.clear();
    lastAppliedPickHighlights = [];
  }

  function clearPickCandidatePreview(): void {
    if (!pickCandidatePreview) return;
    try { toolsGroup.remove(pickCandidatePreview); } catch { /* ignore */ }
    disposeObject3d(pickCandidatePreview);
    pickCandidatePreview = null;
  }

  function resetPickCandidateSession(): void {
    clearPickCandidatePreview();
    pickCandidates.value = [];
    pickCandidateIndex.value = 0;
    pickCandidateAnchor = null;
  }

  /**
   * 用独立线框标出「当前轮换到的候选」。
   *
   * 不复用 `setObjectsSelected`：那是全局选中通道，候选与普通选中长得一样就分不出
   * 轮换到了哪一个。只有存在重叠候选时才画，单一候选靠选中高亮已经足够。
   */
  function renderPickCandidatePreview(): void {
    clearPickCandidatePreview();
    if (pickCandidates.value.length <= 1) return;

    const candidate = pickCandidates.value[pickCandidateIndex.value];
    const viewer = compatViewerRef.value;
    if (!candidate || !viewer) return;

    const aabb = isTubeKeyLike(candidate.refno)
      ? viewer.scene.getTubeSegmentAABB(candidate.refno)
      : viewer.scene.getAABB([candidate.refno]);
    if (!aabb) return;

    const geometry = buildWireBoxGeometryFromBox3(
      new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5])),
    );
    const line = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    line.renderOrder = 903;
    line.frustumCulled = false;

    ensureToolsGroupAttached();
    toolsGroup.add(line);
    pickCandidatePreview = line;
  }

  /** 把候选写入拾取结果；`previous` 非空表示这是一次轮换，替换而不是追加。 */
  function applyPickCandidate(candidate: PickRefnoCandidate, previous: PickRefnoCandidate | null): void {
    if (previous && previous.refno !== candidate.refno) {
      store.removePickedRefno(previous.refno);
      pickedHighlightByBran.delete(previous.refno);
    }
    store.addPickedRefno(candidate.refno);

    const viewer = compatViewerRef.value;
    if (viewer) {
      // 优先高亮 refno 本体；BRAN 之类无自身几何的元素回退到命中的子构件；直段键只高亮那一段直管。
      const highlightId = isTubeKeyLike(candidate.refno) || viewer.scene.getAABB([candidate.refno]) ? candidate.refno : candidate.hitRefno;
      pickedHighlightByBran.set(candidate.refno, highlightId);
      applyPickHighlights();
    }

    renderPickCandidatePreview();
  }

  /** 在光标处的重叠构件之间轮换；返回是否真的换了一个候选。 */
  function cyclePickCandidate(step = 1): boolean {
    if (store.toolMode.value !== 'pick_refno') return false;
    const total = pickCandidates.value.length;
    if (total <= 1) return false;

    const previous = pickCandidates.value[pickCandidateIndex.value] ?? null;
    pickCandidateIndex.value = nextPickCandidateIndex(pickCandidateIndex.value, total, step);
    const candidate = pickCandidates.value[pickCandidateIndex.value];
    if (!candidate) return false;

    applyPickCandidate(candidate, previous);
    requestRender?.();
    return true;
  }

  function setPipeMeasureStatus(message: string): void {
    pipeMeasureStatus.value = message;
  }

  function setObjectMeasureStatus(message: string): void {
    objectToObjectStatus.value = message;
  }

  function clearPipeToPipeCandidate(options?: { clearStatus?: boolean }): void {
    pipeToPipeSourceCandidate.value = null;
    if (options?.clearStatus) {
      pipeMeasureStatus.value = '';
    }
  }

  function pipeToPipeSourceStatus(candidate: PipeToPipeBranCandidate): string {
    const picked = candidate.pickedRefno !== candidate.branRefno ? `（点选 ${candidate.pickedRefno}）` : '';
    return `管-管间距：已选第一条 BRAN ${candidate.branRefno}${picked}，请点第二条 BRAN 上的管件`;
  }

  function applyPipeToPipeSourceCandidate(candidate: PipeToPipeBranCandidate): void {
    pipeToPipeSourceCandidate.value = candidate;
    setPipeMeasureStatus(pipeToPipeSourceStatus(candidate));
  }

  function clearObjectMeasureCandidates(options?: { clearStatus?: boolean; clearLastPairKey?: boolean }): void {
    objectToObjectSourceCandidate.value = null;
    objectToObjectTargetCandidate.value = null;
    objectToObjectBusy.value = false;
    if (options?.clearStatus) {
      objectToObjectStatus.value = '';
    }
    if (options?.clearLastPairKey) {
      lastAppliedObjectMeasurePairKey.value = null;
    }
  }

  function applyObjectMeasureSourceCandidate(candidate: ObjectMeasureCandidate | null): void {
    objectToObjectSourceCandidate.value = candidate;
    objectToObjectTargetCandidate.value = null;
    if (!candidate) return;
    setObjectMeasureStatus(`构件最近点测量：已选第一个构件 ${candidate.refno}，请选择第二个构件`);
  }

  function createObjectMeasureCandidateFromHit(hit: {
    entityId: string
    worldPos: Vector3
    objectId: string
  }): ObjectMeasureCandidate | null {
    const refno = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '');
    if (!refno || !hit.objectId) return null;
    return {
      refno,
      objectId: hit.objectId,
      entityId: hit.entityId || refno,
      hitPoint: vec3ToTuple(hit.worldPos),
    };
  }

  function commitObjectToObjectMeasurement(
    source: ObjectMeasureCandidate,
    target: ObjectMeasureCandidate,
  ): boolean {
    const layer = dtxLayerRef.value;
    if (!layer) {
      setObjectMeasureStatus('DTX 图层未就绪');
      return false;
    }
    if (source.objectId === target.objectId || source.refno === target.refno) {
      objectToObjectTargetCandidate.value = null;
      setObjectMeasureStatus('请选择另一个构件');
      return false;
    }

    objectToObjectBusy.value = true;
    setObjectMeasureStatus('构件最近点测量：正在计算…');

    try {
      const approx = computeApproxNearestBetweenObjects(layer, {
        sourceObjectId: source.objectId,
        targetObjectId: target.objectId,
        sourceHitPoint: source.hitPoint ?? null,
        targetHitPoint: target.hitPoint ?? null,
      });
      if (!approx) {
        objectToObjectTargetCandidate.value = null;
        setObjectMeasureStatus('未能计算两个构件之间的最近点');
        return false;
      }

      // #58：构件最近点归 ClearanceStore（sampled-object / approximate-sampled，
      // 种子点采样的估算，永不标精确或外表面净距）；端点/距离换算成 design-world 米。
      // 无效输入 → TypeError（类型化失败），不落半成品记录，状态如实报失败。
      try {
        commitDtxObjectToObjectClearance({
          sourceRefno: source.refno,
          targetRefno: target.refno,
          sourcePointScene: approx.sourcePoint,
          targetPointScene: approx.targetPoint,
          dtxLayerRef,
          sourceAnnotation: store.activeAnnotationContext.value,
          computedAt: new Date(),
          upsertRecord: clearanceStore.upsertRecord,
        });
      } catch (error) {
        objectToObjectTargetCandidate.value = null;
        setObjectMeasureStatus(
          `构件最近点记录失败：${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
      lastAppliedObjectMeasurePairKey.value = buildObjectMeasurePairKey(source.refno, target.refno);
      clearObjectMeasureCandidates();
      setObjectMeasureStatus(
        `已生成构件最近点测量：${source.refno} ↔ ${target.refno}，距离 ${formatLengthMeters(approx.distance, unitSettings.displayUnit.value, unitSettings.precision.value)}`,
      );
      requestRender?.();
      return true;
    } finally {
      objectToObjectBusy.value = false;
    }
  }

  function handleTreeObjectMeasureSelection(selectedRefnos: string[]): void {
    if (store.toolMode.value !== 'measure_object_to_object') return;

    const normalized = selectedRefnos
      .map((refno) => normalizeRefnoKey(refno))
      .filter(Boolean);
    if (normalized.length === 0) {
      clearObjectMeasureCandidates({ clearStatus: true });
      return;
    }
    if (normalized.length > 2) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('该模式仅支持两个构件');
      return;
    }

    const layer = dtxLayerRef.value;
    if (!layer) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('DTX 图层未就绪');
      return;
    }

    const resolvedCandidates = normalized.map((refno) => resolveLoadedVisibleObjectCandidateByRefno(layer, refno));
    if (normalized.length === 1) {
      const only = resolvedCandidates[0];
      if (!only) {
        clearObjectMeasureCandidates();
        setObjectMeasureStatus('请先显示该构件后再测量');
        return;
      }
      applyObjectMeasureSourceCandidate(only);
      return;
    }

    const [sourceCandidate, targetCandidate] = resolvedCandidates;
    if (!sourceCandidate || !targetCandidate) {
      clearObjectMeasureCandidates();
      setObjectMeasureStatus('请先显示这两个构件后再测量');
      return;
    }

    const pairKey = buildObjectMeasurePairKey(sourceCandidate.refno, targetCandidate.refno);
    objectToObjectSourceCandidate.value = sourceCandidate;
    objectToObjectTargetCandidate.value = targetCandidate;
    if (lastAppliedObjectMeasurePairKey.value === pairKey) {
      setObjectMeasureStatus(`构件最近点测量：已选 ${sourceCandidate.refno} 与 ${targetCandidate.refno}`);
      return;
    }

    void commitObjectToObjectMeasurement(sourceCandidate, targetCandidate);
  }

  /** 点到的构件 → 它所属的 BRAN（DTX 缓存的 owner；点到 BRAN 自己的隐式直管时就是它自己）。解不出回 null。 */
  function resolvePipeToPipeBranCandidate(hit: {
    entityId: string
    worldPos: Vector3
    objectId: string
  }): PipeToPipeBranCandidate | null {
    const pickedRefno = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '');
    if (!pickedRefno || !hit.objectId) return null;
    const branRefno = findOwnerBranRefnoAcrossAllDbnos(pickedRefno);
    if (!branRefno) return null;
    return { branRefno: normalizeRefnoKey(branRefno), pickedRefno, objectId: hit.objectId };
  }

  function collectPipeReferencePointsWorld(params: {
    sourceRefno: string
    sourceObjectId: string
    dbnum: number
    layer: DTXLayer
    globalMatrix: any
  }): Vector3[] {
    const { sourceRefno, sourceObjectId, dbnum, layer, globalMatrix } = params;
    const refnoTransform = getDtxRefnoTransform(dbnum, sourceRefno);
    let refnoPosition: Vec3 | null = null;
    if (Array.isArray(refnoTransform) && refnoTransform.length === 16) {
      const tx = refnoTransform[12];
      const ty = refnoTransform[13];
      const tz = refnoTransform[14];
      if (Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz)) {
        refnoPosition = vec3ByMatrix([tx, ty, tz], globalMatrix);
      }
    }

    let aabbCenter: Vec3 | null = null;
    const sourceAabb = layer.getObjectBoundingBox(sourceObjectId);
    if (sourceAabb) {
      const center = sourceAabb.getCenter(new Vector3());
      aabbCenter = [center.x, center.y, center.z];
    }

    const seeds = collectOrderedPipeReferencePointSeeds({
      sourceRefno,
      segments: [],
      refnoPosition,
      aabbCenter,
    });
    return seeds.map((seed) => new Vector3(seed[0], seed[1], seed[2]));
  }

  function collectSourceSamplePointsWorld(
    layer: DTXLayer,
    sourceObjectId: string,
    limit: number,
  ): Vector3[] {
    const data = layer.getObjectGeometryData(sourceObjectId);
    if (!data) return [];
    const geometry = data.geometry;
    const matrix = data.matrix;
    const posAttr = geometry.getAttribute('position') as BufferAttribute | undefined;
    const indexAttr = geometry.getIndex() as BufferAttribute | null;
    if (!posAttr || posAttr.count <= 0) return [];

    const out: Vector3[] = [];
    const maxCount = Math.max(1, Math.floor(limit));

    const pushPoint = (point: Vector3) => {
      if (out.length >= maxCount) return;
      out.push(point.clone());
    };

    const vertexBudget = Math.max(1, Math.floor(maxCount * 0.7));
    const vertexStep = Math.max(1, Math.floor(posAttr.count / vertexBudget));
    const tempVertex = new Vector3();
    for (let i = 0; i < posAttr.count && out.length < vertexBudget; i += vertexStep) {
      tempVertex.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
      pushPoint(tempVertex);
    }

    const remaining = maxCount - out.length;
    if (remaining <= 0) return out;

    const tempA = new Vector3();
    const tempB = new Vector3();
    const tempC = new Vector3();
    const triCount = indexAttr
      ? Math.floor(indexAttr.count / 3)
      : Math.floor(posAttr.count / 3);
    if (triCount <= 0) return out;
    const triStep = Math.max(1, Math.floor(triCount / Math.max(1, remaining)));

    for (let triIndex = 0; triIndex < triCount && out.length < maxCount; triIndex += triStep) {
      const base = triIndex * 3;
      const ia = indexAttr ? indexAttr.getX(base) : base;
      const ib = indexAttr ? indexAttr.getX(base + 1) : base + 1;
      const ic = indexAttr ? indexAttr.getX(base + 2) : base + 2;
      if (ia >= posAttr.count || ib >= posAttr.count || ic >= posAttr.count) continue;

      tempA.fromBufferAttribute(posAttr, ia).applyMatrix4(matrix);
      tempB.fromBufferAttribute(posAttr, ib).applyMatrix4(matrix);
      tempC.fromBufferAttribute(posAttr, ic).applyMatrix4(matrix);

      const midAB = tempA.clone().add(tempB).multiplyScalar(0.5);
      const midBC = tempB.clone().add(tempC).multiplyScalar(0.5);
      const midCA = tempC.clone().add(tempA).multiplyScalar(0.5);
      pushPoint(midAB);
      if (out.length >= maxCount) break;
      pushPoint(midBC);
      if (out.length >= maxCount) break;
      pushPoint(midCA);
    }

    return out;
  }

  function resolveTargetObjectPairs(
    dbnum: number,
    candidates: PipeWallDistanceCandidate[],
  ): { targetRefno: string; targetObjectId: string }[] {
    const out: { targetRefno: string; targetObjectId: string }[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const targetRefno = normalizeRefnoKey(candidate.refno);
      const objectIds = resolveDtxObjectIdsByRefno(dbnum, targetRefno);
      for (const objectId of objectIds) {
        if (!objectId || seen.has(objectId)) continue;
        seen.add(objectId);
        out.push({ targetRefno, targetObjectId: objectId });
      }
    }
    return out;
  }

  function findBestPipeMeasureResult(
    layer: DTXLayer,
    sourcePoints: Vector3[],
    targetPairs: { targetRefno: string; targetObjectId: string }[],
  ): PipeMeasureResult | null {
    let best: { seed: PipeMeasureSeed; targetRefno: string; targetObjectId: string } | null = null;

    for (const sourcePoint of sourcePoints) {
      const sourceTuple = vec3ToTuple(sourcePoint);
      for (const targetPair of targetPairs) {
        const closest = layer.closestPointToObject(targetPair.targetObjectId, sourcePoint);
        if (!closest) continue;
        const nextSeed: PipeMeasureSeed = {
          distance: closest.distance,
          sourcePoint: sourceTuple,
          targetPoint: vec3ToTuple(closest.point),
        };
        const winnerSeed = choosePipeMeasureBetterSeed(best?.seed || null, nextSeed);
        if (winnerSeed === nextSeed) {
          best = {
            seed: nextSeed,
            targetObjectId: targetPair.targetObjectId,
            targetRefno: targetPair.targetRefno,
          };
        }
      }
    }

    if (!best) return null;
    return fromSeed(best.seed, best.targetObjectId, best.targetRefno);
  }

  /** 中心距在状态栏里的写法：中心线给的是 mm，`formatLengthMeters` 吃米。 */
  function formatMillimetres(mm: number): string {
    return formatLengthMeters(mm / 1000, unitSettings.displayUnit.value, unitSettings.precision.value);
  }

  /**
   * 「管-管间距」的后半程（plan 2026-09-16 §3.3 ④，#63 改落 ClearanceStore）：两条 BRAN 的真实中心线
   * （`GET /api/v1/spatial/centerline`）→ 连续共线的段合成直段（ELBO / BEND 不算）→ 直段两两配平行对
   * （夹角 ≤ 0.5°、沿轴投影有重叠）→ 每对一条 `ClearanceRecord`（`parallel-centerline` / `exact-centerline`，
   * inputs 是直段首段 refno，BRAN refno 在 provenance operand），同一对 BRAN 再测整组替换。
   * 没有平行直段也要走一遍（把上一次同一对的记录清掉），只是状态栏直说。尺寸只经显式转换，不在这条路径建。
   */
  async function completePipeToPipeSpacing(
    source: PipeToPipeBranCandidate,
    target: PipeToPipeBranCandidate,
  ): Promise<boolean> {
    const pair = `${source.branRefno} ↔ ${target.branRefno}`;
    setPipeMeasureStatus(`管-管间距：正在取 ${pair} 两条 BRAN 的中心线…`);
    const [sourceLine, targetLine] = await Promise.all([
      genModelV1SpatialCenterline(source.branRefno),
      genModelV1SpatialCenterline(target.branRefno),
    ]);
    const sourceRuns = buildStraightRuns(sourceLine);
    const targetRuns = buildStraightRuns(targetLine);
    const pairs = findParallelRunPairs(sourceRuns, targetRuns);
    clearPipeToPipeCandidate();

    const distances = pairs.map((item) => formatMillimetres(item.axisDistanceMm));
    const distanceText = distances.length > 4 ? `${distances.slice(0, 4).join(' / ')} …` : distances.join(' / ');
    const runsText = `${sourceRuns.length} / ${targetRuns.length} 条直段`;

    try {
      commitBranParallelSpacing({
        sourceBranRefno: source.branRefno,
        targetBranRefno: target.branRefno,
        pairs,
        sourceSesno: sourceLine.source_version?.sesno ?? null,
        targetSesno: targetLine.source_version?.sesno ?? null,
        warnings: [...(sourceLine.warnings ?? []), ...(targetLine.warnings ?? [])].map(parseServerWarning),
        sourceAnnotation: store.activeAnnotationContext.value,
        computedAt: new Date(),
        records: clearanceStore.records.value,
        upsertRecord: clearanceStore.upsertRecord,
        removeRecord: clearanceStore.removeRecord,
      });
    } catch (error) {
      setPipeMeasureStatus(`管-管间距：${pair} 中心距记录生成失败：${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    setPipeMeasureStatus(pairs.length > 0
      ? `管-管间距：${pair} 找到 ${pairs.length} 对平行直段（${runsText}），中心距 ${distanceText}，已生成 ${pairs.length} 条中心距记录`
      : `管-管间距：${pair} 没有平行的直段（${runsText}，夹角容差 ${DEFAULT_PARALLEL_ANGLE_TOLERANCE_DEG}°），上一次这一对的中心距记录已清掉`);
    requestRender?.();
    return pairs.length > 0;
  }

  /**
   * 三维里点选管件算出的一条管-墙/柱估算净距（scene 世界坐标的最近点对）→ `ClearanceRecord`（#63）：
   * `sampled-object` / `approximate-sampled`，端点经全局矩阵逆换算成 design-world 米，
   * 与构件最近点（#58）走同一个适配器。尺寸只经显式转换，不在这条路径建；
   * 失败抛 TypeError（类型化失败），不落半成品记录。
   */
  function commitInteractiveClearance(params: {
    kindLabel: string
    sourceRefno: string
    targetRefno: string
    targetNoun: string
    sourcePoint: Vector3
    targetPoint: Vector3
  }): void {
    const distance = params.sourcePoint.distanceTo(params.targetPoint);
    const distanceText = formatLengthMeters(distance, unitSettings.displayUnit.value, unitSettings.precision.value);
    const pair = `${params.sourceRefno} ↔ ${params.targetRefno}${params.targetNoun ? `（${params.targetNoun}）` : ''}`;

    try {
      commitDtxObjectToObjectClearance({
        sourceRefno: params.sourceRefno,
        targetRefno: params.targetRefno,
        sourcePointScene: [params.sourcePoint.x, params.sourcePoint.y, params.sourcePoint.z],
        targetPointScene: [params.targetPoint.x, params.targetPoint.y, params.targetPoint.z],
        dtxLayerRef,
        targetNoun: params.targetNoun,
        warnings: [{
          code: 'mesh_sampling',
          message: '源侧参考点/网格采样 + 目标表面最近点，估算距离非外表面净距',
        }],
        sourceAnnotation: store.activeAnnotationContext.value,
        computedAt: new Date(),
        upsertRecord: clearanceStore.upsertRecord,
      });
    } catch (error) {
      setPipeMeasureStatus(`${params.kindLabel}：${pair} 净距记录生成失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setPipeMeasureStatus(
      `${params.kindLabel}：${pair} 估算最近距离 ${distanceText}（网格采样），已生成净距记录`,
    );
    requestRender?.();
  }

  /**
   * 「管-管间距」：点两根管，各自解到所属 BRAN，量两条 BRAN 平行直段的中心距（plan 2026-09-16 §3.3 ④）。
   * 用户 2026-09-16 的口径：「两个排管的距离测量是指两条 BRAN 的直段之间，如果有平行的部分就可以标注它们的间距」——
   * 不再是两个网格采样出的最近点对。
   */
  async function runPipeToPipeMeasurement(canvas: HTMLCanvasElement, e: PointerEvent): Promise<void> {
    if (pipeMeasureBusy.value) {
      setPipeMeasureStatus('正在计算上一条间距，请稍候…');
      return;
    }

    const hit = pickSurfacePoint(canvas, e);
    if (!hit) {
      setPipeMeasureStatus('管-管间距：未拾取到有效管道对象');
      return;
    }

    pipeMeasureBusy.value = true;
    try {
      const candidate = resolvePipeToPipeBranCandidate(hit);
      if (!candidate) {
        const picked = normalizeRefnoKey(hit.entityId || parseRefnoFromDtxObjectId(hit.objectId) || '') || hit.objectId;
        setPipeMeasureStatus(`管-管间距：${picked} 不属于任何 BRAN——只能量两条 BRAN 之间的平行直段，请点管件或直管`);
        return;
      }

      const source = pipeToPipeSourceCandidate.value;
      if (!source) {
        applyPipeToPipeSourceCandidate(candidate);
        return;
      }
      if (source.branRefno === candidate.branRefno) {
        setPipeMeasureStatus(`管-管间距：${candidate.pickedRefno} 与第一根同属 BRAN ${source.branRefno}，请点另一条 BRAN 上的管件`);
        return;
      }

      await completePipeToPipeSpacing(source, candidate);
    } catch (error) {
      setPipeMeasureStatus(`管-管间距计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pipeMeasureBusy.value = false;
    }
  }

  async function runPipeToStructureMeasurement(canvas: HTMLCanvasElement, e: PointerEvent): Promise<void> {
    if (pipeMeasureBusy.value) {
      setPipeMeasureStatus('正在计算上一条净距，请稍候…');
      return;
    }

    const hit = pickSurfacePoint(canvas, e);
    if (!hit) {
      setPipeMeasureStatus('未拾取到有效管道对象');
      return;
    }

    const layer = dtxLayerRef.value;
    if (!layer) {
      setPipeMeasureStatus('DTX 图层未就绪');
      return;
    }

    const sourceRefno = normalizeRefnoKey(hit.entityId);
    const dbnum = parseDbnumFromRefno(sourceRefno);
    if (!dbnum) {
      setPipeMeasureStatus(`无法解析 dbnum：${sourceRefno}`);
      return;
    }

    const loadedSourceObjectIds = resolveDtxObjectIdsByRefno(dbnum, sourceRefno);
    const sourceObjectId = hit.objectId || loadedSourceObjectIds[0];
    if (!sourceObjectId) {
      setPipeMeasureStatus(`源管道未加载几何：${sourceRefno}`);
      return;
    }

    pipeMeasureBusy.value = true;
    try {
      setPipeMeasureStatus('正在查询墙/柱候选…');
      // 候选来自 gen-model `/api/v1/spatial/nearest-clearance`：沿所属 BRAN 中心线按类型找半径内最近的墙 / 柱
      // （旧后端 `/api/space/wall-distance` 2026-09-20 随 legacy 退役）。拾中的是管件时先找它所属的 BRAN。
      const sourceBranRefno = findOwnerBranRefnoAcrossAllDbnos(sourceRefno) ?? sourceRefno;
      const response = await genModelV1SpatialNearestClearance({
        sourceRefno: sourceBranRefno,
        sourceMode: 'bran_centerline',
        targetNouns: PIPE_STRUCTURE_DEFAULT_NOUNS,
        groupBy: 'noun',
        maxPerGroup: PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES,
        scope: 'all_loaded',
      });
      // 失败走 HTTP 错误信封（`GenModelV1ApiError`，由外层 catch 报状态），200 里 success 恒为 true
      const candidates: PipeWallDistanceCandidate[] = (response.nearest_by_group ?? [])
        .flatMap((group) => group.candidates ?? [])
        .filter((candidate) => PIPE_STRUCTURE_DEFAULT_NOUNS.includes(String(candidate.noun || '').toUpperCase()))
        .sort((a, b) => a.distance_mm - b.distance_mm)
        .slice(0, PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES)
        .map((candidate) => ({ refno: candidate.refno, noun: candidate.noun, distance_mm: candidate.distance_mm }));
      if (candidates.length === 0) {
        setPipeMeasureStatus('未找到可用墙/柱候选');
        return;
      }

      const targetPairs = resolveTargetObjectPairs(dbnum, candidates);
      if (targetPairs.length === 0) {
        setPipeMeasureStatus('候选对象未加载到当前场景');
        return;
      }

      setPipeMeasureStatus('正在收集参考点…');
      const globalMatrix = layer.getGlobalModelMatrix();
      const referencePoints = collectPipeReferencePointsWorld({
        sourceRefno,
        sourceObjectId,
        dbnum,
        layer,
        globalMatrix,
      });
      if (referencePoints.length === 0) {
        setPipeMeasureStatus('参考点收集失败');
        return;
      }

      setPipeMeasureStatus('阶段A：参考点最近距离计算…');
      let best = findBestPipeMeasureResult(layer, referencePoints, targetPairs);

      const samplePoints = collectSourceSamplePointsWorld(
        layer,
        sourceObjectId,
        PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT,
      );
      if (samplePoints.length > 0) {
        setPipeMeasureStatus('阶段B：采样点精化…');
        const refined = findBestPipeMeasureResult(layer, samplePoints, targetPairs);
        if (refined && (!best || refined.distance < best.distance)) {
          best = refined;
        }
      }

      if (!best) {
        setPipeMeasureStatus('最近点计算失败');
        return;
      }

      const bestTargetRefno = best.targetRefno;
      commitInteractiveClearance({
        kindLabel: '管-墙/柱净距',
        sourceRefno,
        targetRefno: bestTargetRefno,
        targetNoun: candidates.find((candidate) => normalizeRefnoKey(candidate.refno) === bestTargetRefno)?.noun ?? '',
        sourcePoint: best.sourcePoint,
        targetPoint: best.targetPoint,
      });
    } catch (error) {
      setPipeMeasureStatus(`计算失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pipeMeasureBusy.value = false;
    }
  }

  const statusText = computed(() => {
    const mode = store.toolMode.value;
    if (mode === 'none') return '未启用工具';
    if (!dtxViewerRef.value) return '三维查看器未初始化';
    if (!dtxLayerRef.value) return 'DTX 图层未初始化';
    if (!selectionRef.value) return '拾取控制器未就绪';
    if (!ready.value) return '等待模型加载完成…';

    if (mode === 'measure_point_to_object') {
      return pointToObjectStart.value ? '点到面测量：请点击选择目标对象（自动计算最近距离）' : '点到面测量：请点击选择起始点';
    }
    if (mode === 'measure_object_to_object') {
      if (objectToObjectBusy.value) {
        return objectToObjectStatus.value || '构件最近点测量：正在计算…';
      }
      if (objectToObjectStatus.value) {
        return objectToObjectStatus.value;
      }
      if (objectToObjectSourceCandidate.value) {
        return `构件最近点测量：已选第一个构件 ${objectToObjectSourceCandidate.value.refno}，请选择第二个构件`;
      }
      return '构件最近点测量：请选择第一个构件（可点三维或在模型树选中）';
    }
    if (mode === 'measure_pipe_to_structure') {
      if (pipeMeasureBusy.value) {
        return pipeMeasureStatus.value || '管-墙/柱净距测量：正在计算…';
      }
      return pipeMeasureStatus.value
        || '管-墙/柱净距测量：点击管道，估算到最近墙/柱的距离，生成净距记录（网格采样）';
    }
    if (mode === 'measure_pipe_to_pipe') {
      if (pipeMeasureBusy.value) {
        return pipeMeasureStatus.value || '管-管间距：正在计算…';
      }
      if (pipeMeasureStatus.value) {
        return pipeMeasureStatus.value;
      }
      return pipeToPipeSourceCandidate.value
        ? pipeToPipeSourceStatus(pipeToPipeSourceCandidate.value)
        : '管-管间距：点第一根管道（量两条 BRAN 平行直段之间的中心距，一对平行直段一条中心距记录）';
    }
    if (mode === 'pick_query_center') {
      return '请点击模型拾取查询中心点';
    }
    if (mode === 'pick_refno') {
      const filter = store.pickRefnoFilter.value;
      const count = store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      const total = pickCandidates.value.length;
      const cycleText = total > 1
        ? ` — 光标处 ${pickCandidateIndex.value + 1}/${total} 个重叠${isTubePickFilter(filter) ? '直段' : '构件'}，Tab 切换`
        : '';
      return isTubePickFilter(filter)
        ? `直段拾取：点击直管选择直段 [已选 ${count}]${cycleText} — Enter 确认 / ESC 取消`
        : `拾取模式${filterText}：点击选择构件 [已选 ${count}]${cycleText} — Enter 确认 / ESC 取消`;
    }
    if (mode === 'pick_refno_box') {
      const filter = store.pickRefnoFilter.value;
      const count = store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      return isTubePickFilter(filter)
        ? `直段框选：拖拽矩形框选直管 [已选 ${count}] — 松开鼠标即确认 / ESC 取消`
        : `框选模式${filterText}：拖拽矩形框选构件 [已选 ${count}] — 松开鼠标即确认 / ESC 取消`;
    }
    if (mode === 'annotation_cloud') {
      const targetCount = store.cloudTargetRefnos.value.length;
      if (targetCount === 0) return '云线批注：请先选择目标元素';
      return pendingCloudAnchor.value
        ? `云线批注：已选 ${targetCount} 个目标元素，锚点已就绪，请拖拽绘制云线轮廓`
        : `云线批注：已选 ${targetCount} 个目标元素，请点击模型选择锚点`;
    }
    if (mode === 'annotation_rect') {
      return '矩形批注：点击对象生成 OBB 包围框批注';
    }
    return '批注：点击模型表面创建';
  });

  const objectToObjectUiState = computed(() => {
    return {
      sourceRefno: objectToObjectSourceCandidate.value?.refno ?? null,
      targetRefno: objectToObjectTargetCandidate.value?.refno ?? null,
      busy: objectToObjectBusy.value,
      canReset: !!objectToObjectSourceCandidate.value || !!objectToObjectTargetCandidate.value,
      statusText: statusText.value,
    };
  });

  const toolsGroup = new Group();
  toolsGroup.name = 'dtx-tools';

  const labels = new Map<string, LabelEl>();
  const markers = new Map<string, LabelEl>();
  const cloudShapes = new Map<string, CloudOverlayEl>();
  const rectShapes = new Map<string, RectOverlayEl>();
  const obbShapes = new Map<string, ObbOverlayEl>();
  const textLeaders = new Map<string, AnnotationLeaderVisual>();
  const inlineTextAnnotationDrafts = new Map<string, InlineTextAnnotationDraft>();
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
  const CLOUD_INSPECTION_SETTLE_MS = 120;
  const CLOUD_INSPECTION_MAX_PROBES = 3;
  const inspectionScratch = { origin: new Vector3(), point: new Vector3(), direction: new Vector3(), hit: new Vector3() };
  const lodProjectScratch = new Vector3();

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
    toolsGroup,
    overlays: { labels, markers, cloudShapes, rectShapes, obbShapes, textLeaders },
    cloudRenderStats,
    cloudLod,
    marqueeDiv,
    rectDrag,
    rectPreviewLine,
  };

  function resetProgress() {
    pointToObjectStart.value = null;
    clearObjectMeasureCandidates({ clearStatus: true, clearLastPairKey: true });
    clearPipeToPipeCandidate({ clearStatus: true });
    pipeMeasureBusy.value = false;
    pipeMeasureStatus.value = '';
  }

  function clearPendingCloudAnchor() {
    pendingCloudAnchor.value = null;
  }

  /**
   * 云线绘制闸门：目标元素集合为空时，既不允许 pick 锚点也不允许拖框。
   *
   * 刻意集中在工具层——进入 `annotation_cloud` 的入口有四处（批注面板、
   * 视口浮动工具条、校审工作台、校审面板），逐个面板校验必然漏网。
   */
  function canDrawCloudAnnotation(): boolean {
    return store.cloudTargetRefnos.value.length > 0;
  }

  /**
   * 闸门拦截的外发信号：浮动工具条据此把对应步骤闪红。
   * 闸门本身只能 return，没有反馈用户就只会反复拖框而不知道缺了哪一步。
   */
  const cloudGateBlock = ref<{ step: 'target' | 'anchor'; at: number } | null>(null);
  let lastCloudGateToastAt = 0;

  const CLOUD_GATE_MESSAGE: Record<'target' | 'anchor', string> = {
    target: '请先关联至少一个目标元素，再绘制云线',
    anchor: '请先在模型上点击一处锚点，再拖拽绘制云线轮廓',
  };

  function notifyCloudGateBlocked(step: 'target' | 'anchor') {
    const now = Date.now();
    cloudGateBlock.value = { step, at: now };
    // 拖框会连续触发 pointerdown，节流避免同一句提示刷屏。
    if (now - lastCloudGateToastAt < 1500) return;
    lastCloudGateToastAt = now;
    emitToast({ message: CLOUD_GATE_MESSAGE[step], level: 'warning' });
  }

  /** 云线创建的统一回退入口：清掉锚点、拖框预览与目标集合。 */
  function cancelCloudCreation() {
    clearPendingCloudAnchor();
    hideMarquee();
    store.clearCloudTargetRefnos();
  }

  /** 退出云线工具但保留目标集合，再次进入可直接复用（方案 §2.1）。 */
  function suspendCloudCreation() {
    clearPendingCloudAnchor();
    hideMarquee();
  }

  /** 拖框被中途打断时归还相机控制与指针捕获，否则退出后视角就转不动了。 */
  function releaseMarqueeCapture() {
    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    const pointerId = marqueeState.value.pointerId;
    const canvas = viewer?.canvas;
    if (canvas && pointerId !== null) {
      try { canvas.releasePointerCapture(pointerId); } catch { /* ignore */ }
    }
  }

  /**
   * 云线创建的分级回退：一次 Esc 只退一步（拖框预览 → 锚点 → 退出工具）。
   *
   * 目标集合是整个流程里最贵的一步——可能逐个点了十几个构件——不能因为
   * 想重拖一次轮廓就被连坐清空；退出工具时也保留，方案 §2.1 要求「再次进入可复用」。
   * 返回 true 表示这次 Esc 已被云线状态机消费，调用方不应再退出工具模式。
   */
  function rollbackCloudCreationStep(): boolean {
    if (store.toolMode.value !== 'annotation_cloud') return false;
    if (marqueeState.value.active) {
      releaseMarqueeCapture();
      hideMarquee();
      return true;
    }
    if (pendingCloudAnchor.value) {
      clearPendingCloudAnchor();
      return true;
    }
    return false;
  }

  async function captureCreatedCloudScreenshot(rec: CloudAnnotationRecord) {
    const taskId = reviewStore.currentTask.value?.id;
    if (!taskId) return null;

    // 出发前盖戳：上传期间用户可能切到别的任务
    const scopeStamp = draftSession.currentStamp();
    await nextTick();
    const attachment = await captureAndUpload(taskId, {
      kind: 'auto_cloud_finish',
      sourceAnnotationId: rec.id,
      description: rec.title,
    });
    const route = draftSession.routeDataReceipt(scopeStamp);
    if (!attachment) {
      // 提示是瞬态的：人已经在别的任务里就不打扰
      if (route.kind !== 'other-scope') {
        emitToast({ message: '云线已创建，但自动截图失败，可在批注面板重拍', level: 'warning' });
      }
      return null;
    }

    const screenshot = {
      url: attachment.url,
      attachmentId: attachment.id,
      name: attachment.name,
      capturedAt: attachment.capturedAt,
      mimeType: attachment.mimeType,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      uploadedAt: attachment.uploadedAt,
    };
    // 按落点挂：还在出发时的任务就写内存；迟到的截图只能归属它出发时的任务——写进那个 scope 的本机容器，
    // 不碰当前任务的内存（方案 §3.6）。两条路都找不到这条云线就删掉刚上传的附件，别留孤儿。
    const attached = attachAnnotationScreenshotByRoute(store, route, 'cloud', rec.id, screenshot);
    if (!attached) {
      void reviewAttachmentDelete(attachment.id).catch((error) => {
        console.warn('[annotation] Failed to clean orphan cloud screenshot:', error);
      });
      return null;
    }
    return attachment;
  }

  try {
    if (localStorage.getItem('plant3d_automation_review') === '1') {
      (window as unknown as {
        __plant3dDtxE2E?: {
          addCloudAnnotationWithScreenshot: () => Promise<{
            annotationId: string;
            attachmentId: string;
            url: string;
            mimeType?: string;
            size?: number;
            width?: number;
            height?: number;
          }>;
        };
      }).__plant3dDtxE2E = {
        addCloudAnnotationWithScreenshot: async () => {
          const createdAt = Date.now();
          const rec: CloudAnnotationRecord = {
            id: `cloud-e2e-${createdAt}`,
            objectIds: ['24381_145018'],
            refnos: ['24381_145018'],
            anchorWorldPos: [0, 0, 0],
            visible: true,
            title: '云线批注（仿 PMS 自动化）',
            description: '',
            createdAt,
          };
          store.addCloudAnnotation(rec);
          const attachment = await captureCreatedCloudScreenshot(rec);
          if (!attachment) throw new Error('云线自动截图上传未返回附件');
          const screenshot = store.cloudAnnotations.value.find((item) => item.id === rec.id)?.screenshot;
          if (!screenshot?.attachmentId || !screenshot.url) {
            throw new Error('云线自动截图未写回批注');
          }
          return {
            annotationId: rec.id,
            attachmentId: screenshot.attachmentId,
            url: screenshot.url,
            mimeType: screenshot.mimeType,
            size: screenshot.size,
            width: screenshot.width,
            height: screenshot.height,
          };
        },
      };
    }
  } catch {
    // 自动化钩子不可用时不影响正式云线工具。
  }

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  function setPendingCloudAnchor(anchor: PendingCloudAnchor) {
    pendingCloudAnchor.value = {
      worldPos: [...anchor.worldPos],
      refno: anchor.refno,
      entityId: anchor.entityId,
    };
  }

  function ensureToolsGroupAttached() {
    const viewer = dtxViewerRef.value;
    if (!viewer) return;
    if (toolsGroup.parent !== viewer.scene) {
      try {
        toolsGroup.parent?.remove(toolsGroup);
      } catch {
        // ignore
      }
      viewer.scene.add(toolsGroup);
    }
  }

  function clearOverlayEls() {
    clearPinClusterDom();
    for (const it of labels.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    labels.clear();
    for (const it of markers.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    markers.clear();
    for (const it of cloudShapes.values()) {
      try { it.badgeEl?.remove(); } catch { /* ignore */ }
    }
    cloudShapes.clear();
    rectShapes.clear();
    obbShapes.clear();
  }

  function ensureMarqueeDiv() {
    const overlay = overlayContainerRef.value;
    if (!overlay) return null;
    if (marqueeDiv.value && marqueeDiv.value.parentElement === overlay) return marqueeDiv.value;

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove(); } catch { /* ignore */ }
    }

    marqueeDiv.value = ensureDiv(
      overlay,
      'dtx-marquee',
      [
        'position:absolute',
        'display:none',
        'left:0',
        'top:0',
        'width:0',
        'height:0',
        'pointer-events:none',
        'z-index:930',
      ].join(';')
    );
    return marqueeDiv.value;
  }

  function hideMarquee() {
    marqueeState.value = { active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null };
    const div = marqueeDiv.value;
    if (div) div.style.display = 'none';
  }

  function updateMarqueeStyle(mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    div.style.display = 'block';
    if (mode === 'annotation_cloud') {
      div.style.border = '3px solid #dc2626';
      div.style.borderRadius = '8px';
      div.style.background = 'rgba(220, 38, 38, 0.08)';
      div.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)';
    } else {
      div.style.border = dx >= 0 ? '2px dashed #333' : '2px solid #333';
      div.style.borderRadius = '0';
      div.style.background = 'rgba(0,0,0,0.06)';
      div.style.boxShadow = 'none';
    }
  }

  function updateMarqueeRect(start: { x: number; y: number }, end: { x: number; y: number }) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    div.style.left = `${x1}px`;
    div.style.top = `${y1}px`;
    div.style.width = `${x2 - x1}px`;
    div.style.height = `${y2 - y1}px`;
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
    const draft = getInlineTextAnnotationDraft('cloud', c.id, c);
    const label = makeInlineAnnotationCardEl(overlay, '云线批注', draft.title, draft.description);
    label.style.transform = 'translate(-50%,-50%)';
    if (c.severity) label.dataset.severity = c.severity;
    labels.set(cloud.id, { id: cloud.id, worldPos: labelWorldPos, el: label });
    const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
    const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

    label.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activateAnnotation('cloud', c.id);
    });
    label.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      focusInlineAnnotationEditor('cloud', c.id);
    });
    label.addEventListener('focusout', () => {
      queueMicrotask(() => {
        const activeElement = label.ownerDocument?.activeElement;
        if (activeElement && label.contains(activeElement)) return;
        commitInlineAnnotationDraft('cloud', c.id);
      });
    });

    dragHandle?.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      commitInlineAnnotationDraft('cloud', c.id);
      dragHandle.style.cursor = 'grabbing';
      beginInlineOverlayAnnotationDrag('cloud', c.id, ev, labelWorldPos, anchor);
      try {
        dragHandle.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    });
    dragHandle?.addEventListener('pointermove', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      continueInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointerup', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      endInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointercancel', (ev) => {
      if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      endInlineOverlayAnnotationDrag(ev);
    });

    titleInput?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activateAnnotation('cloud', c.id);
    });
    titleInput?.addEventListener('input', () => {
      setInlineAnnotationDraft('cloud', c.id, {
        title: titleInput.value,
        description: descriptionInput?.value ?? draft.description,
      });
    });
    descriptionInput?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activateAnnotation('cloud', c.id);
    });
    descriptionInput?.addEventListener('input', () => {
      setInlineAnnotationDraft('cloud', c.id, {
        title: titleInput?.value ?? draft.title,
        description: descriptionInput.value,
      });
    });

    if (store.pendingCloudAnnotationEditId.value === c.id) {
      queueMicrotask(() => focusInlineAnnotationEditor('cloud', c.id));
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

  function setHoveredCloudAnnotation(id: string | null): void {
    if (cloudLod.hoveredId === id) return;
    cloudLod.hoveredId = id;
    // 只有 LOD 真在生效（上次计划超预算）时悬停才改变呈现；否则不为一次 hover 白跑一帧
    if (cloudLod.planSummary.overBudget) {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  /**
   * P4 LOD 计划（方案 §9.3）：云线 > 预算时，按锚点到视口中心的距离排优先级，激活 / 拖动 / 悬停 / 待编辑固定高档，
   * 交给纯函数 `planCloudLod`（预算 64、滞回 16）。输入指纹没变就不重算；≤ 预算或开关关 → 全部 `full`。
   * 结果写在每条 `cloud.render.lodLevel`，由渲染循环按「计划 ≠ 已应用」切档。返回 true = 本帧重算了计划。
   */
  function planCloudLodForFrame(camera: any, frameKey: string): boolean {
    const lodOn = isCloudRenderFlagEnabled('cloudAdaptiveLod');
    if (!lodOn || cloudShapes.size <= DEFAULT_CLOUD_LOD_OPTIONS.budget) {
      if (cloudLod.planKey !== 'all-full') {
        cloudLod.planKey = 'all-full';
        cloudLod.planSummary = { overBudget: false, fullCount: cloudShapes.size, pinCount: 0 };
        for (const cloud of cloudShapes.values()) {
          cloud.render.lodLevel = 'full';
          cloud.render.lodPinnedHigh = false;
        }
        cloudLod.levels.clear();
        return true;
      }
      return false;
    }
    const drag = inlineOverlayAnnotationDrag.value;
    const dragId = drag.annotationKind === 'cloud' ? drag.annotationId : null;
    const activeId = store.activeCloudAnnotationId.value;
    const pendingEditId = store.pendingCloudAnnotationEditId.value;
    const key = `${frameKey}|${cloudLod.setVersion}|${activeId ?? ''}|${dragId ?? ''}|${cloudLod.hoveredId ?? ''}|${pendingEditId ?? ''}`;
    if (key === cloudLod.planKey) return false;
    cloudLod.planKey = key;
    cloudRenderStats.lodPlans += 1;

    const candidates: CloudLodCandidate[] = [];
    for (const cloud of cloudShapes.values()) {
      const recordId = cloud.record.id;
      const v = lodProjectScratch.copy(cloud.worldPos).applyMatrix4(camera.matrixWorldInverse);
      // three 相机看向视空间 -z：z ≥ 0 = 锚点在相机背后，投影坐标会翻转，不能拿它当屏内
      const behind = v.z >= 0;
      v.applyMatrix4(camera.projectionMatrix);
      const priority = cloudLodPriority(v.x, v.y, behind);
      const pinnedHigh = recordId === activeId
        || recordId === dragId
        || recordId === cloudLod.hoveredId
        || recordId === pendingEditId
        || cloud.render.labelDragTopLeft !== null;
      cloud.render.lodPriority = priority;
      cloud.render.lodPinnedHigh = pinnedHigh;
      candidates.push({ id: cloud.id, priority, pinnedHigh, previous: cloudLod.levels.get(cloud.id) ?? null });
    }
    const plan = planCloudLod(candidates, DEFAULT_CLOUD_LOD_OPTIONS);
    cloudLod.planSummary = { overBudget: plan.overBudget, fullCount: plan.fullCount, pinCount: plan.pinCount };
    // 记忆只留还在场的条目，删掉的记录不占着旧等级
    for (const id of cloudLod.levels.keys()) if (!cloudShapes.has(id)) cloudLod.levels.delete(id);
    for (const cloud of cloudShapes.values()) {
      const level = plan.levels.get(cloud.id) ?? 'full';
      cloud.render.lodLevel = level;
      cloudLod.levels.set(cloud.id, level);
    }
    return true;
  }

  // ---------------- P4 LOD 第二步：pin 档图钉的屏幕聚合 ----------------

  function cloudTitleForList(record: CloudAnnotationRecord): string {
    const title = (record.title ?? '').trim();
    return title || `云线批注 ${record.id}`;
  }

  /** 聚合徽标（带计数的圆标），一簇一枚，按种子 id 复用 */
  function ensureClusterBadgeEl(seedId: string): HTMLDivElement {
    const existing = cloudLod.clusterBadges.get(seedId);
    if (existing) return existing;
    const overlay = overlayContainerRef.value!;
    const el = ensureDiv(
      overlay,
      'dtx-anno-cluster',
      [
        'position:absolute',
        'left:0',
        'top:0',
        'transform:translate(-50%,-50%)',
        'min-width:26px',
        'height:26px',
        'padding:0 7px',
        'box-sizing:border-box',
        'border-radius:13px',
        'background:#1f2937',
        'color:#fff',
        'border:2px solid #fff',
        'box-shadow:0 2px 6px rgba(15,23,42,0.35)',
        'font-family:\'Roboto Mono\',\'Consolas\',monospace',
        'font-size:12px',
        'font-weight:700',
        'line-height:22px',
        'text-align:center',
        'pointer-events:auto',
        'user-select:none',
        'cursor:pointer',
        'z-index:921',
      ].join(';'),
    );
    el.dataset.clusterSeed = seedId;
    el.setAttribute('role', 'button');
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (cloudLod.clusterPopover?.seedId === seedId) closeClusterPopover();
      else openClusterPopover(seedId);
    });
    el.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      const cluster = cloudLod.clusterCurrent.find((c) => c.seedId === seedId);
      if (cluster) flyToCloudAnnotations(cluster.memberIds.map((id) => id.replace(/^cloud:/, '')));
    });
    cloudLod.clusterBadges.set(seedId, el);
    return el;
  }

  /** 相机飞到这些云线记录的合并范围（锚点 ∪ 创建时目标快照 AABB） */
  function flyToCloudAnnotations(recordIds: readonly string[]): boolean {
    const viewer = compatViewerRef.value;
    if (!viewer) return false;
    const points: Vec3[] = [];
    for (const id of recordIds) {
      const rec = store.cloudAnnotations.value.find((c) => c.id === id);
      if (!rec) continue;
      points.push(rec.anchorWorldPos);
      if (rec.selectionBbox) {
        points.push(rec.selectionBbox.min, rec.selectionBbox.max);
      }
    }
    const aabb = aabbFromPoints(points);
    if (!aabb) return false;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
    return true;
  }

  function closeClusterPopover(): void {
    const popover = cloudLod.clusterPopover;
    if (!popover) return;
    cloudLod.clusterPopover = null;
    const doc = popover.el.ownerDocument;
    doc.removeEventListener('pointerdown', popover.onDocPointerDown, true);
    doc.removeEventListener('keydown', popover.onKeyDown, true);
    try { popover.el.remove(); } catch { /* ignore */ }
  }

  /** 弹出成员列表：点一行 = 选中那条（激活即升 full 档）；「放大」= 相机飞到全部成员 */
  function openClusterPopover(seedId: string): void {
    const overlay = overlayContainerRef.value;
    const cluster = cloudLod.clusterCurrent.find((c) => c.seedId === seedId);
    if (!overlay || !cluster) return;
    closeClusterPopover();
    const el = ensureDiv(
      overlay,
      'dtx-anno-cluster-popover',
      [
        'position:absolute',
        'left:0',
        'top:0',
        'min-width:200px',
        'max-width:280px',
        'max-height:260px',
        'overflow:auto',
        'box-sizing:border-box',
        'padding:8px',
        'border-radius:8px',
        'background:#fff',
        'color:#111827',
        'border:1px solid #cbd5e1',
        'box-shadow:0 8px 24px rgba(15,23,42,0.22)',
        'font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif',
        'font-size:12px',
        'line-height:18px',
        'pointer-events:auto',
        'user-select:none',
        'z-index:922',
      ].join(';'),
    );
    el.dataset.clusterSeed = seedId;
    const onDocPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (target && (el.contains(target) || cloudLod.clusterBadges.get(seedId)?.contains(target))) return;
      closeClusterPopover();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeClusterPopover();
    };
    el.ownerDocument.addEventListener('pointerdown', onDocPointerDown, true);
    el.ownerDocument.addEventListener('keydown', onKeyDown, true);
    cloudLod.clusterPopover = { seedId, el, onDocPointerDown, onKeyDown };
    renderClusterPopover(cluster);
  }

  function renderClusterPopover(cluster: PinCluster): void {
    const popover = cloudLod.clusterPopover;
    const overlay = overlayContainerRef.value;
    if (!popover || !overlay || popover.seedId !== cluster.seedId) return;
    const recordIds = cluster.memberIds.map((id) => id.replace(/^cloud:/, ''));
    const records = recordIds
      .map((id) => store.cloudAnnotations.value.find((c) => c.id === id))
      .filter((rec): rec is CloudAnnotationRecord => !!rec);
    const rows = records
      .map((rec) => `<div data-role="cluster-member" data-annotation-id="${escapeAnnotationLabelText(rec.id)}" style="padding:4px 6px;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="单击选中这条云线批注">${escapeAnnotationLabelText(cloudTitleForList(rec))}</div>`)
      .join('');
    popover.el.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">',
      `<span style="font-weight:600">${records.length} 条云线批注</span>`,
      '<button type="button" data-role="cluster-zoom" style="border:1px solid #94a3b8;border-radius:4px;background:#f8fafc;color:#111827;font-size:12px;line-height:18px;padding:0 8px;cursor:pointer">放大到这些</button>',
      '</div>',
      `<div data-role="cluster-members">${rows}</div>`,
    ].join('');
    popover.el.querySelector('[data-role="cluster-zoom"]')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      flyToCloudAnnotations(recordIds);
      closeClusterPopover();
    });
    for (const row of popover.el.querySelectorAll<HTMLElement>('[data-role="cluster-member"]')) {
      row.addEventListener('pointerenter', () => { row.style.background = '#e2e8f0'; });
      row.addEventListener('pointerleave', () => { row.style.background = ''; });
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = row.dataset.annotationId;
        if (!id) return;
        closeClusterPopover();
        // 选中即「当前问题」：LOD 固定高档，轮廓 + 文字框补回来（store 变化经 watch 重建）
        activateAnnotation('cloud', id);
      });
    }
    positionClusterPopover(cluster);
  }

  function positionClusterPopover(cluster: PinCluster): void {
    const popover = cloudLod.clusterPopover;
    const overlay = overlayContainerRef.value;
    if (!popover || !overlay || popover.seedId !== cluster.seedId) return;
    const overlayRect = overlay.getBoundingClientRect();
    const width = popover.el.offsetWidth || 220;
    const height = popover.el.offsetHeight || 120;
    // 徽标右下方；越界就贴到视口内
    const x = clamp(cluster.x + 16, 4, Math.max(4, overlayRect.width - width - 4));
    const y = clamp(cluster.y + 16, 4, Math.max(4, overlayRect.height - height - 4));
    popover.el.style.left = `${x}px`;
    popover.el.style.top = `${y}px`;
  }

  /** 只拆 DOM（overlay 重建 / LOD 退出超预算时）；成员 → 种子的记忆留着，簇身份跨重建稳定 */
  function clearPinClusterDom(): void {
    closeClusterPopover();
    for (const el of cloudLod.clusterBadges.values()) {
      try { el.remove(); } catch { /* ignore */ }
    }
    cloudLod.clusterBadges.clear();
    for (const id of cloudLod.clusterHiddenMarkerIds) {
      const marker = markers.get(id);
      if (marker) marker.el.style.display = '';
    }
    cloudLod.clusterHiddenMarkerIds.clear();
    cloudLod.clusterCurrent = [];
  }

  /**
   * 按本帧 pin 档图钉的屏幕位置重算聚合并落到 DOM：合进徽标的图钉藏起、徽标定位 + 计数 + 成员标题提示；
   * 弹出列表若还对着一个在场的簇就刷新，否则关掉。只在 LOD 计划重算的那一帧调（相机 / 集合 / 交互态变了）。
   */
  function applyPinClusters(items: readonly PinClusterItem[]): void {
    const result = clusterPins(items, cloudLod.clusterSeedOf, DEFAULT_PIN_CLUSTER_OPTIONS);
    cloudLod.clusterSeedOf = result.seedOf;
    cloudLod.clusterCurrent = result.clusters;

    // 图钉显隐：新合进来的藏、散出去的放回
    const nextHidden = new Set(result.seedOf.keys());
    for (const id of cloudLod.clusterHiddenMarkerIds) {
      if (!nextHidden.has(id)) markers.get(id)?.el.style.setProperty('display', '');
    }
    for (const id of nextHidden) {
      if (!cloudLod.clusterHiddenMarkerIds.has(id)) markers.get(id)?.el.style.setProperty('display', 'none');
    }
    cloudLod.clusterHiddenMarkerIds.clear();
    for (const id of nextHidden) cloudLod.clusterHiddenMarkerIds.add(id);

    // 徽标：一簇一枚，按种子复用；不在场的拆掉
    const liveSeeds = new Set<string>();
    for (const cluster of result.clusters) {
      liveSeeds.add(cluster.seedId);
      const el = ensureClusterBadgeEl(cluster.seedId);
      el.textContent = String(cluster.memberIds.length);
      el.dataset.count = String(cluster.memberIds.length);
      el.style.left = `${cluster.x}px`;
      el.style.top = `${cluster.y}px`;
      const titles: string[] = [];
      for (const id of cluster.memberIds) {
        const rec = cloudShapes.get(id)?.record;
        if (rec) titles.push(cloudTitleForList(rec));
        if (titles.length >= 8) break;
      }
      const more = cluster.memberIds.length - titles.length;
      el.title = `${cluster.memberIds.length} 条云线批注（单击列出成员，双击放大）\n${titles.join('\n')}${more > 0 ? `\n…还有 ${more} 条` : ''}`;
    }
    for (const [seedId, el] of cloudLod.clusterBadges.entries()) {
      if (liveSeeds.has(seedId)) continue;
      try { el.remove(); } catch { /* ignore */ }
      cloudLod.clusterBadges.delete(seedId);
    }

    if (cloudLod.clusterPopover) {
      const cluster = result.clusters.find((c) => c.seedId === cloudLod.clusterPopover!.seedId);
      if (cluster) renderClusterPopover(cluster);
      else closeClusterPopover();
    }
  }

  // ---------------- P4 inspection：遮挡淡化（方案 §10） ----------------

  /** 当前模式：开关关 → 置顶；否则测试 / 外部覆盖优先，再看 URL `mbd_mode`（与尺寸面板同一口径，按 search 字串缓存） */
  function currentCloudInspectionMode(): CloudInspectionMode {
    if (!isCloudRenderFlagEnabled('cloudInspectionFade')) return 'always-on-top';
    if (cloudLod.inspectionModeOverride) return cloudLod.inspectionModeOverride;
    const search = typeof window !== 'undefined' ? (window.location?.search ?? '') : '';
    if (search !== cloudLod.inspectionSearchCache.search) {
      cloudLod.inspectionSearchCache = { search, mode: inspectionModeFromSearch(search) };
    }
    return cloudLod.inspectionSearchCache.mode;
  }

  /** 覆盖检视模式（null = 跟随 URL）；立刻重排一帧让因子回位 / 触发探测 */
  function setCloudInspectionMode(mode: CloudInspectionMode | null): void {
    if (cloudLod.inspectionModeOverride === mode) return;
    cloudLod.inspectionModeOverride = mode;
    updateOverlayPositions();
    requestRender?.();
  }

  /** 强调 = 激活 / 悬停 / 拖动中 / 待编辑：inspection 不淡它，LOD 也固定高档 */
  function isCloudEmphasized(cloud: CloudOverlayEl): boolean {
    const id = cloud.record.id;
    const drag = inlineOverlayAnnotationDrag.value;
    return store.activeCloudAnnotationId.value === id
      || cloudLod.hoveredId === id
      || (drag.annotationKind === 'cloud' && drag.annotationId === id)
      || store.pendingCloudAnnotationEditId.value === id
      || cloud.render.labelDragTopLeft !== null;
  }

  /**
   * 探一条云线：≤ 3 个代表性成员，每个先从相机向它的放置盒中心打射线、要**命中成员自己的表面**（否则 `unknown`），
   * 再问 ADR-0061 的缝：相机 → 命中点之间有没有别的可见几何（成员 refno 作 `subject`，排除它自己的各片）。
   * 容差 = max(尺寸系统 toleranceMm × 全局矩阵缩放, tolerancePx × 命中点处每像素世界长度)。
   */
  function probeCloudOcclusion(cloud: CloudOverlayEl, camera: any, canvas: HTMLCanvasElement): OcclusionProbe[] {
    const layer = dtxLayerRef.value;
    if (!layer) return [];
    const members = getCloudMemberRefnos(cloud.record);
    let fallback: readonly [number, number, number] | null = null;
    if (!cloud.render.regionCells) {
      const sb = resolveCloudTargetBbox(cloud);
      if (sb) fallback = [(sb.min[0] + sb.max[0]) / 2, (sb.min[1] + sb.max[1]) / 2, (sb.min[2] + sb.max[2]) / 2];
    }
    const samples = chooseInspectionProbeMembers(cloud.render.regionCells ? cloud.record.regionV1 : null, members, fallback, CLOUD_INSPECTION_MAX_PROBES);
    if (samples.length === 0) return [];
    const origin = camera.getWorldPosition(inspectionScratch.origin);
    const mmToWorld = layer.getGlobalModelMatrix().getMaxScaleOnAxis();
    const toleranceFromMm = SOLVESPACE_DIMENSION_THEME.inspection.toleranceMm * (Number.isFinite(mmToWorld) && mmToWorld > 0 ? mmToWorld : 0);
    const out: OcclusionProbe[] = [];
    for (const sample of samples) {
      const point = inspectionScratch.point.set(sample.point[0], sample.point[1], sample.point[2]);
      const direction = inspectionScratch.direction.subVectors(point, origin);
      const length = direction.length();
      if (!(length > 0)) {
        out.push('unknown');
        continue;
      }
      direction.divideScalar(length);
      let nearest: { point: Vector3; distance: number } | null = null;
      for (const objectId of resolveRegionObjectIdsForRefno(layer, sample.refno)) {
        cloudRenderStats.inspectionRays += 1;
        const hit = layer.raycastObject(objectId, origin, direction);
        if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
      }
      if (!nearest) {
        out.push('unknown');
        continue;
      }
      const hitPoint = inspectionScratch.hit.copy(nearest.point);
      const perPixel = worldPerPixelAt(camera, hitPoint, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
      const tolerance = Math.max(toleranceFromMm, Number.isFinite(perPixel) ? SOLVESPACE_DIMENSION_THEME.inspection.tolerancePx * perPixel : 0);
      cloudRenderStats.inspectionRays += 1;
      out.push(isWorldSegmentBlocked(layer, origin, hitPoint, tolerance, { subject: sample.refno }) ? 'blocked' : 'clear');
    }
    return out;
  }

  function cloudInspectionKey(cloud: CloudOverlayEl, frame: { cameraWorld: number; modelEpoch: number; globalModelMatrix: number }): string {
    return `${frame.cameraWorld}|${frame.modelEpoch}|${frame.globalModelMatrix}|${cloud.render.recordTracker.version}`;
  }

  /** 相机停下之后跑：给所有该探而没探过（key 变了）的 full 档云线打射线；因子变了就请一帧，paint 阶段按新因子刷材质 */
  function runCloudInspection(): void {
    if (cloudLod.inspectionTimer !== null) {
      clearTimeout(cloudLod.inspectionTimer);
      cloudLod.inspectionTimer = null;
    }
    cloudLod.inspectionPending = false;
    const viewer = dtxViewerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !canvas || currentCloudInspectionMode() !== 'inspection') return;
    const frame = {
      cameraWorld: cloudFrameTrackers.cameraWorld.version,
      modelEpoch: dtxLoaderRevision.value,
      globalModelMatrix: cloudFrameTrackers.globalModelMatrix.version,
    };
    const occludedAlpha = SOLVESPACE_DIMENSION_THEME.inspection.occludedAlpha;
    let changed = false;
    for (const cloud of cloudShapes.values()) {
      if (cloud.render.lodLevel !== 'full' || cloud.degrade || isCloudEmphasized(cloud)) continue;
      const key = cloudInspectionKey(cloud, frame);
      if (cloud.render.inspectionKey === key) continue;
      const probes = probeCloudOcclusion(cloud, viewer.camera, canvas);
      const factor = inspectionFactor('inspection', probes, false, false, occludedAlpha);
      cloud.render.inspectionKey = key;
      cloud.render.inspectionProbes = probes;
      if (cloud.render.inspectionFactor !== factor) {
        cloud.render.inspectionFactor = factor;
        changed = true;
      }
    }
    if (changed) requestRender?.();
  }

  function scheduleCloudInspection(): void {
    if (cloudLod.inspectionTimer !== null) clearTimeout(cloudLod.inspectionTimer);
    cloudLod.inspectionTimer = setTimeout(runCloudInspection, CLOUD_INSPECTION_SETTLE_MS);
  }

  /** 测试 / 调试：不等相机停下，立刻探一遍并把因子刷进材质（先跑一帧让版本戳对上当前相机） */
  function runCloudInspectionNow(): void {
    updateOverlayPositions();
    runCloudInspection();
    updateOverlayPositions();
  }

  /** e2e / 单测：inspection 当前模式、是否有待探、每条云线的因子 / 样本 / 探测键 */
  function debugCloudInspection(): CloudInspectionDebugSnapshot {
    const items: CloudInspectionDebugSnapshot['items'] = [];
    for (const [id, cloud] of cloudShapes.entries()) {
      items.push({
        id,
        factor: cloud.render.inspectionFactor,
        probes: [...cloud.render.inspectionProbes],
        key: cloud.render.inspectionKey,
        outlineOpacity: (cloud.outline.material as MeshLineMaterial).opacity,
        leaderOpacity: cloud.leader.coreMaterial.opacity,
      });
    }
    return {
      mode: currentCloudInspectionMode(),
      pending: cloudLod.inspectionPending || cloudLod.inspectionTimer !== null,
      occludedAlpha: SOLVESPACE_DIMENSION_THEME.inspection.occludedAlpha,
      items,
    };
  }

  function syncFromStore() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    if (!viewer || !overlay) return;
    const resolution = getCanvasResolution(viewer.canvas);

    ensureToolsGroupAttached();
    clearGroup(toolsGroup);
    clearOverlayEls();
    textLeaders.clear();
    pruneInlineTextAnnotationDrafts();

    // clearGroup 连同候选预览一起销毁了，重建以免轮换线框在批注同步时凭空消失。
    pickCandidatePreview = null;
    renderPickCandidatePreview();

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
        scheduleTextAnnotationMarkerSingleClick(a.id);
      });
      marker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        handleTextAnnotationMarkerDoubleClick(a.id);
      });

      if (shouldRenderTextAnnotationCard(a.collapsed)) {
        const leader = createTextAnnotationLeader(wp, labelWorldPos, resolution);
        applyLeaderDegrade(leader, buildAnnotationLeaderStyle('text').color, degrade);
        toolsGroup.add(leader.root);
        textLeaders.set(`anno:${a.id}`, leader);

        const draft = getInlineTextAnnotationDraft('text', a.id, a);
        const label = makeTextAnnotationCardEl(overlay, draft.title, draft.description);
        if (a.severity) label.dataset.severity = a.severity;
        labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: labelWorldPos, el: label });

        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('text', a.id);
          });
        });

        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('text', a.id);
          dragHandle.style.cursor = 'grabbing';
          beginTextAnnotationDrag(a.id, ev, labelWorldPos, wp);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          continueTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          endTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          endTextAnnotationDrag(ev);
        });

        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('text', a.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });

        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('text', a.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingTextAnnotationEditId.value === a.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('text', a.id));
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
        activateAnnotation('cloud', c.id);
      });
      // 与文字批注 marker 一致：双击图钉切换 collapsed，
      // 收起时只渲染图钉，展开后再补回文字框 / 引线。
      cloudMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setCloudAnnotationsCollapsed([c.id], toggleTextAnnotationCollapsed(c.collapsed));
        activateAnnotation('cloud', c.id);
      });
      // P4 LOD「悬停临时展示」：图钉上悬停即固定高档（补回轮廓 + 文字框），移开后按预算回落
      cloudMarker.addEventListener('pointerenter', () => setHoveredCloudAnnotation(c.id));
      cloudMarker.addEventListener('pointerleave', () => {
        if (cloudLod.hoveredId === c.id) setHoveredCloudAnnotation(null);
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
        activateAnnotation('rect', r.id);
      });
      rectMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setRectAnnotationsCollapsed([r.id], toggleTextAnnotationCollapsed(r.collapsed));
        activateAnnotation('rect', r.id);
      });

      if (shouldRenderTextAnnotationCard(r.collapsed)) {
        const draft = getInlineTextAnnotationDraft('rect', r.id, r);
        const label = makeInlineAnnotationCardEl(overlay, '矩形批注', draft.title, draft.description);
        if (r.severity) label.dataset.severity = r.severity;
        const labelWorldPos = r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos;
        labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: labelWorldPos, el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('rect', r.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          focusInlineAnnotationEditor('rect', r.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('rect', r.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('rect', r.id);
          dragHandle.style.cursor = 'grabbing';
          beginInlineOverlayAnnotationDrag('rect', r.id, ev, labelWorldPos, rectAnchor);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('rect', r.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('rect', r.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('rect', r.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('rect', r.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingRectAnnotationEditId.value === r.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('rect', r.id));
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
        activateAnnotation('obb', o.id);
      });
      obbMarker.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        store.setObbAnnotationsCollapsed([o.id], toggleTextAnnotationCollapsed(o.collapsed));
        activateAnnotation('obb', o.id);
      });

      if (shouldRenderTextAnnotationCard(o.collapsed)) {
        const draft = getInlineTextAnnotationDraft('obb', o.id, o);
        const label = makeInlineAnnotationCardEl(overlay, 'OBB 批注', draft.title, draft.description);
        if (o.severity) label.dataset.severity = o.severity;
        labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: visual.labelWorldPos.clone(), el: label });
        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('obb', o.id);
        });
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          focusInlineAnnotationEditor('obb', o.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('obb', o.id);
          });
        });
        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('obb', o.id);
          dragHandle.style.cursor = 'grabbing';
          beginInlineOverlayAnnotationDrag('obb', o.id, ev, visual.labelWorldPos.clone(), anchorWorldPos);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          continueInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
          dragHandle.style.cursor = 'grab';
          endInlineOverlayAnnotationDrag(ev);
        });
        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('obb', o.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('obb', o.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });
        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('obb', o.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('obb', o.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingObbEditId.value === o.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('obb', o.id));
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
    const lodReplanned = planCloudLodForFrame(viewer.camera, `${frameStamp.cameraWorld}|${frameStamp.projection}|${frameStamp.viewportCss}`);
    // ---- P4 inspection（方案 §10）：本帧的显示模式，一帧读一次 ----
    const inspectionMode = currentCloudInspectionMode();
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
      if (inspectionMode === 'inspection' && !cloud.degrade && !isCloudEmphasized(cloud)) {
        if (cloud.render.inspectionKey !== cloudInspectionKey(cloud, frameStamp)) cloudLod.inspectionPending = true;
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
      clearPinClusterDom();
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
    if (clusterItems) applyPinClusters(clusterItems);

    // 检视模式下有云线待探：等相机停下（settle）再打射线；置顶模式下不会有待探，也就一条射线都不打
    if (cloudLod.inspectionPending) scheduleCloudInspection();
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

  function computeRectPlaneBasis(camera: any, normal: Vector3): { u: Vector3; v: Vector3 } {
    const camUp = camera.up ? (camera.up as Vector3) : new Vector3(0, 0, 1);
    const u = new Vector3().crossVectors(normal, camUp);
    if (u.lengthSq() < 1e-8) {
      u.set(1, 0, 0);
    } else {
      u.normalize();
    }
    const v = new Vector3().crossVectors(u, normal).normalize();
    return { u, v };
  }

  function intersectPlaneFromPointer(canvas: HTMLCanvasElement, e: PointerEvent, plane: Plane): Vector3 | null {
    const viewer = dtxViewerRef.value;
    if (!viewer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const ndc = new Vector3(x, y, 0.5);
    ndc.unproject(viewer.camera);
    const dir = ndc.sub(viewer.camera.position).normalize();
    const rayOrigin = viewer.camera.position.clone();
    const hit = new Vector3();
    // Plane.intersectLine expects Line3; use analytic ray-plane intersection
    const denom = plane.normal.dot(dir);
    if (Math.abs(denom) < 1e-8) return null;
    const t = -(rayOrigin.dot(plane.normal) + plane.constant) / denom;
    if (!Number.isFinite(t)) return null;
    hit.copy(dir).multiplyScalar(t).add(rayOrigin);
    return hit;
  }

  function updateRectPreview(worldCorners: Vector3[]) {
    if (worldCorners.length !== 4) return;
    const pts = [...worldCorners, worldCorners[0]!];
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      arr.push(p.x, p.y, p.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    const mat = new LineBasicMaterial({ color: 0x111827 })
      ; (mat as any).depthTest = false;
    const line = new Line(g, mat);
    line.renderOrder = 950;

    if (rectPreviewLine.value) {
      try {
        toolsGroup.remove(rectPreviewLine.value);
        rectPreviewLine.value.geometry.dispose()
        ; (rectPreviewLine.value.material as any)?.dispose?.();
      } catch { /* ignore */ }
    }
    rectPreviewLine.value = line;
    toolsGroup.add(line);
  }

  /**
   * 框选命中计算。逐条目投影八个角点，规模等于已加载构件数，因此这里对热点很敏感：
   * - 视口矩形只读一次，`worldToOverlay` 每次调用都会 getBoundingClientRect，
   *   放在角点循环里就是每个构件 16 次强制重排；
   * - 先用视锥剔除掉屏幕外的构件，绝大多数条目连投影都不用做。
   * `fillBox` 把条目的世界盒写进 `box`，没有盒回 false。
   */
  function collectInScreenRect<T>(
    canvas: HTMLCanvasElement,
    rect: { x1: number; y1: number; x2: number; y2: number },
    containMode: boolean,
    items: readonly T[],
    fillBox: (item: T, box: Box3) => boolean,
  ): T[] {
    const overlay = overlayContainerRef.value;
    const dtxViewer = dtxViewerRef.value;
    if (!overlay || !dtxViewer || items.length === 0) return [];

    const camera = dtxViewer.camera;
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new Frustum().setFromProjectionMatrix(viewProjection);

    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const offsetX = canvasRect.left - overlayRect.left;
    const offsetY = canvasRect.top - overlayRect.top;

    const box = new Box3();
    const corner = new Vector3();
    const sel: T[] = [];

    for (const item of items) {
      if (!fillBox(item, box)) continue;
      if (!frustum.intersectsBox(box)) continue;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let anyVisible = false;
      for (let i = 0; i < 8; i++) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(viewProjection);
        if (corner.z < -1 || corner.z > 1) continue;
        anyVisible = true;
        const x = (corner.x * 0.5 + 0.5) * canvasRect.width + offsetX;
        const y = (-corner.y * 0.5 + 0.5) * canvasRect.height + offsetY;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (!anyVisible) continue;

      const intersects = !(maxX < rect.x1 || minX > rect.x2 || maxY < rect.y1 || minY > rect.y2);
      const contained = minX >= rect.x1 && maxX <= rect.x2 && minY >= rect.y1 && maxY <= rect.y2;

      if (containMode ? contained : intersects) {
        sel.push(item);
      }
    }

    return sel;
  }

  function collectRefnosInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box', dx: number): string[] {
    const viewer = compatViewerRef.value;
    if (!viewer) return [];
    const containMode = (mode === 'annotation_obb' || mode === 'pick_refno_box') && dx < 0;
    return collectInScreenRect(canvas, rect, containMode, viewer.scene.getLoadedRefnos(), (refno, box) => {
      const aabb = viewer.scene.getAABB([refno]);
      if (!aabb) return false;
      box.min.set(aabb[0], aabb[1], aabb[2]);
      box.max.set(aabb[3], aabb[4], aabb[5]);
      return true;
    });
  }

  /** 按直段框选：框里可见的直管对象 → 直段身份键（向左拖完全包含、向右拖相交即选，与构件框选同一口径）。 */
  function collectTubeKeysInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, dx: number): string[] {
    const layer = dtxLayerRef.value;
    if (!layer) return [];
    const tubes = listDtxTubeObjects().filter(({ objectId }) => layer.hasObject(objectId) && layer.isObjectVisible(objectId));
    return collectInScreenRect(canvas, rect, dx < 0, tubes, ({ objectId }, box) => {
      const bounds = layer.getObjectBoundingBoxInto(objectId, box);
      return !!bounds && !bounds.isEmpty();
    }).map(({ key }) => key);
  }

  function beginMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!ready.value) return;
    if (e.button !== 0) return;
    if (mode === 'annotation_cloud' && !canDrawCloudAnnotation()) {
      notifyCloudGateBlocked('target');
      return;
    }
    if (mode === 'annotation_cloud' && !pendingCloudAnchor.value) {
      notifyCloudGateBlocked('anchor');
      return;
    }
    const start = getCanvasPos(canvas, e);
    marqueeState.value = {
      active: true,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startCanvas: { x: start.x, y: start.y },
      currentCanvas: { x: start.x, y: start.y },
    };
    updateMarqueeStyle(mode, 0);
    updateMarqueeRect(marqueeState.value.startCanvas!, marqueeState.value.currentCanvas!);

    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function moveMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!marqueeState.value.active) return;
    if (marqueeState.value.pointerId !== e.pointerId) return;
    const cur = getCanvasPos(canvas, e);
    marqueeState.value.currentCanvas = { x: cur.x, y: cur.y };
    const start = marqueeState.value.startCanvas!;
    const dx = (cur.x - start.x);
    updateMarqueeStyle(mode, dx);
    updateMarqueeRect(start, marqueeState.value.currentCanvas);
  }

  function endMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb' | 'pick_refno_box') {
    if (!marqueeState.value.active) return;
    if (marqueeState.value.pointerId !== e.pointerId) return;

    const start = marqueeState.value.startCanvas;
    const end = marqueeState.value.currentCanvas;
    if (!start || !end) {
      hideMarquee();
      return;
    }

    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    const rect = {
      x1: Math.min(start.x, end.x),
      y1: Math.min(start.y, end.y),
      x2: Math.max(start.x, end.x),
      y2: Math.max(start.y, end.y),
    };
    if (rect.x2 - rect.x1 < 6 || rect.y2 - rect.y1 < 6) {
      hideMarquee();
      if (mode === 'annotation_cloud') {
        const hit = pickSurfacePoint(canvas, e);
        if (hit) {
          setPendingCloudAnchor({
            worldPos: vec3ToTuple(hit.worldPos),
            refno: hit.entityId,
            entityId: hit.entityId,
          });
        }
      }
      return;
    }
    const dx = end.x - start.x;

    if (!compatViewerRef.value || !overlayContainerRef.value || !dtxViewerRef.value) {
      hideMarquee();
      emitToast({ message: '三维视图尚未就绪，无法完成框选', level: 'warning' });
      if (mode === 'pick_refno_box') store.cancelPickRefno();
      return;
    }

    // 云线的关联来自目标元素集合，框内构件与它无关；而这个函数要遍历全部已加载构件
    // 逐个取 AABB 再投影 8 个角，大模型上白算一遍就是松手时一次可感的卡顿。
    const tubeBoxPick = mode === 'pick_refno_box' && isTubePickFilter(store.pickRefnoFilter.value);
    let selectedRefnos: string[] = [];
    if (mode !== 'annotation_cloud') {
      try {
        selectedRefnos = tubeBoxPick
          ? collectTubeKeysInScreenRect(canvas, rect, dx)
          : collectRefnosInScreenRect(canvas, rect, mode, dx);
      } catch (err) {
        // 抛出会跳过下面的 hideMarquee，把选择框永久留在屏幕上，
        // 且拾取会话卡在 pick_refno_box 无法退出。
        console.error('[dtx-tools] 框选构件失败', err);
        hideMarquee();
        emitToast({ message: '框选失败：计算框内构件时出错，请缩小范围后重试', level: 'error' });
        if (mode === 'pick_refno_box') store.cancelPickRefno();
        return;
      }
    }
    hideMarquee();

    if (tubeBoxPick) {
      if (selectedRefnos.length === 0) {
        emitToast({ message: '框选范围内没有可选的直段（直管 TUBI），请扩大框选范围或先加载模型。', level: 'warning' });
      }
      for (const key of selectedRefnos) store.addPickedRefno(key);
      store.confirmPickRefno();
      return;
    }
    if (mode === 'pick_refno_box') {
      const filterUpper = store.pickRefnoFilter.value;
      const resolution = resolveBoxPickRefnos(selectedRefnos, filterUpper, findNounByRefnoAcrossAllDbnos);
      if (resolution.kind === 'noun_unavailable') {
        emitToast({ message: '构件类型信息尚未加载完成，请稍后重试框选', level: 'warning' });
        store.cancelPickRefno();
        return;
      }
      if (resolution.refnos.length === 0) {
        emitToast({
          message: '框选范围内未检测到已加载构件，请扩大框选范围或先加载模型。',
          level: 'warning',
        });
      }
      for (const refno of resolution.refnos) store.addPickedRefno(refno);
      store.confirmPickRefno();
      return;
    }

    const compat = compatViewerRef.value;
    if (!compat) return;

    if (mode === 'annotation_cloud') {
      // 关联来自目标元素集合；拖框只决定屏幕轮廓，bbox3d 亦用目标集合合并 AABB。
      const targetRefnos = [...store.cloudTargetRefnos.value];
      if (targetRefnos.length === 0) return;
      const viewer = dtxViewerRef.value;
      const overlay = overlayContainerRef.value;
      const anchorState = pendingCloudAnchor.value;
      if (!viewer || !overlay || !anchorState) return;
      const targetAabb = compat.scene.getAABB(targetRefnos);
      if (!targetAabb) {
        if (annotationStyleStore.cloudDrawMode.value === 'bbox3d') {
          emitToast({ message: '目标元素尚未加载，无法绘制三维包围盒云线', level: 'warning' });
          return;
        }
        // screen2d 允许先建：贴合所需的 AABB 由 resolveCloudTargetBbox 在目标加载后补上，
        // 但此刻只能按拖框尺寸出图，不说清楚用户会以为云线画歪了。
        emitToast({
          message: '目标元素尚未加载，云线暂按拖框尺寸显示，加载后会自动贴合目标',
          level: 'warning',
        });
      }
      const n = store.cloudAnnotations.value.length + 1;
      const anchor = new Vector3(...anchorState.worldPos);
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchor);
      const createdAt = Date.now();
      const rec = createCloudAnnotationRecordFromAnchorAndMarquee({
        id: nowId('cloud'),
        objectIds: targetRefnos,
        refnos: targetRefnos,
        anchorWorldPos: anchorState.worldPos,
        anchorRefno: anchorState.refno,
        anchorScreen,
        rect,
        title: `云线批注 ${n}`,
        description: '',
        createdAt,
        selectionBbox: targetAabb
          ? {
            min: [targetAabb[0], targetAabb[1], targetAabb[2]],
            max: [targetAabb[3], targetAabb[4], targetAabb[5]],
          }
          : undefined,
        bindings: buildCloudBindings({
          memberRefnos: targetRefnos,
          anchorRefno: anchorState.refno,
          createdAt,
          nounOf: (refno) => findNounByRefnoAcrossAllDbnos(refno) ?? undefined,
        }),
        projectOverlayToWorld: (x, y, ndcZ) => vec3ToTuple(
          overlayToWorld(viewer.camera, canvas, overlay, x, y, ndcZ),
        ),
        // P1：新建即写像素意图布局（右上角 + 18 px）；开关关着就只写旧字段
        labelLayoutV1: isCloudRenderFlagEnabled('cloudLabelLayoutV1') ? createDefaultCloudLabelLayoutV1() : undefined,
      });
      // P2：范围体 + 创建视点（方案 §6.2 / §11 P2）。范围不完整（成员未加载 / 超预算）时**不写**新版记录，
      // 漏斗按 selectionBbox 补 legacy-snapshot + legacy-v0；创建视点是独立证据，只要开关开就记。
      if (isCloudRenderFlagEnabled('cloudProjectedEnvelope')) {
        const layer = dtxLayerRef.value;
        const source = buildCloudSourceStamp(targetRefnos, layer);
        const regionV1 = layer
          ? buildMembersRegionV1({
            memberRefnos: targetRefnos,
            layer,
            getMemberAabb: (refno) => compat.scene.getAABB([refno]) ?? null,
            source,
          })
          : null;
        const canvasRect = canvas.getBoundingClientRect();
        rec.viewpointV1 = {
          creation: captureCreationViewSnapshot({
            camera: viewer.camera,
            controlsTarget: viewer.controls?.target instanceof Vector3 ? viewer.controls.target : null,
            anchorWorldPos: anchor,
            viewportCss: {
              width: canvasRect.width || canvas.clientWidth || 1,
              height: canvasRect.height || canvas.clientHeight || 1,
            },
            capturedAt: createdAt,
            modelSnapshotId: source.modelSnapshotId,
          }),
        };
        if (regionV1) {
          rec.regionV1 = regionV1;
          rec.presentationV1 = createRegionCloudPresentationV1();
        }
      }
      store.addCloudAnnotation(rec);
      clearPendingCloudAnchor();
      store.clearCloudTargetRefnos();
      // 画完自动选中新云线：主工具条「错误类型」立即可用、「打开批注单」能定位到这条、右侧证据卡有明确焦点，
      // 否则用户画完得不到任何“选中”反馈，容易误以为没成功而重复绘制。
      activateAnnotation('cloud', rec.id);
      void captureCreatedCloudScreenshot(rec);
      return;
    }

    if (selectedRefnos.length === 0) return;

    // 计算 combined bbox
    const aabb = compat.scene.getAABB(selectedRefnos);
    if (!aabb) return;
    const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));

    const obb = computeAabbObbFromBox3(box);
    if (mode === 'annotation_obb') {
      const n = store.obbAnnotations.value.length + 1;
      const anchorWorldPos = topCenterFromBox3(box);
      const halfSize = new Vector3(...obb.halfSize);
      const boxRadius = Math.max(halfSize.length(), 0.1);
      const labelWorldPos = anchorWorldPos.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));
      // P3 共享范围体：`obb` 旧字段（合并 AABB）照旧双写；范围完整时另写每成员真实放置盒
      const sharedRegion = buildSharedRegionForMembers(selectedRefnos);
      const rec: ObbAnnotationRecord = {
        id: nowId('obb'),
        objectIds: selectedRefnos,
        obb,
        labelWorldPos: vec3ToTuple(labelWorldPos),
        anchor: { kind: 'top_center' },
        visible: true,
        title: `OBB 批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refnos: selectedRefnos,
        ...(sharedRegion ? { regionV1: sharedRegion } : {}),
      };
      store.addObbAnnotation(rec);
      return;
    }

    const n = store.rectAnnotations.value.length + 1;
    const rec = createRectAnnotationRecordFromObb({
      objectIds: selectedRefnos,
      refnos: selectedRefnos,
      obb,
      title: `矩形批注 ${n}`,
      regionV1: buildSharedRegionForMembers(selectedRefnos) ?? undefined,
    });
    store.addRectAnnotation(rec);
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
      beginMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (pendingCloudAnchor.value) {
        beginMarquee(canvas, e, mode);
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
      moveMarquee(canvas, e, mode);
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
      endMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (marqueeState.value.active) {
        endMarquee(canvas, e, mode);
        return;
      }
      if (clickTracker.value.moved) {
        clickTracker.value = { down: null, moved: false };
        return;
      }
      clickTracker.value = { down: null, moved: false };
      if (!canDrawCloudAnnotation()) {
        notifyCloudGateBlocked('target');
        return;
      }
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      setPendingCloudAnchor({
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
        regionV1: buildSharedRegionForMembers([pickedRefno]) ?? undefined,
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

    if (mode === 'pick_refno') {
      const pos = getCanvasPos(canvas, e);
      const filter = store.pickRefnoFilter.value;
      const hits = pickSurfaceRayHits(canvas, e);
      const candidates = isTubePickFilter(filter) ? buildPickTubeCandidates(hits) : buildPickRefnoCandidates(hits, filter);
      if (isTubePickFilter(filter) && hits.length > 0 && candidates.length === 0) {
        emitToast({ message: '这里没有可选的直段：请点直管（TUBI）。服务端没给直段身份时只能按整根管道选。', level: 'warning' });
      }

      // 原地再点一次 = 在光标下的重叠构件之间轮换，而不是重新拾取同一个。
      if (
        isSamePickAnchor(pickCandidateAnchor, pos) &&
        isSamePickCandidateSequence(pickCandidates.value, candidates)
      ) {
        if (cyclePickCandidate(1)) return;
      }

      pickCandidateAnchor = { x: pos.x, y: pos.y };
      pickCandidates.value = candidates;
      pickCandidateIndex.value = 0;

      const nearest = candidates[0];
      if (!nearest) {
        clearPickCandidatePreview();
        return;
      }
      applyPickCandidate(nearest, null);
      return;
    }

    if (mode === 'measure_pipe_to_structure') {
      void runPipeToStructureMeasurement(canvas, e);
      return;
    }

    if (mode === 'measure_pipe_to_pipe') {
      void runPipeToPipeMeasurement(canvas, e);
      return;
    }

    if (mode === 'measure_point_to_object') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;

      if (!pointToObjectStart.value) {
        pointToObjectStart.value = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
        return;
      }

      const layer = dtxLayerRef.value;
      if (!layer) return;
      const start = new Vector3(...pointToObjectStart.value.worldPos);
      const closest = layer.closestPointToObject(hit.objectId, start);
      if (!closest) return;

      // #58：点到面仍是 Measurement，但端点补 designWorldPos、provenance 写全，
      // 经适配器走统一写入命令——流程里不再有裸 store.addMeasurement。
      commitDtxPointToObjectMeasurement({
        id: nowId('pto'),
        origin: pointToObjectStart.value,
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(closest.point) },
        dtxLayerRef,
        sourceAnnotation: store.activeAnnotationContext.value,
        createdAt: Date.now(),
        addMeasurement: (record) => store.addMeasurement(record),
      });
      pointToObjectStart.value = null;
      return;
    }

    if (mode === 'measure_object_to_object') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) {
        setObjectMeasureStatus('未拾取到有效构件');
        return;
      }

      const candidate = createObjectMeasureCandidateFromHit(hit);
      if (!candidate) {
        setObjectMeasureStatus('未拾取到有效构件');
        return;
      }

      if (!objectToObjectSourceCandidate.value) {
        applyObjectMeasureSourceCandidate(candidate);
        return;
      }

      objectToObjectTargetCandidate.value = candidate;
      void commitObjectToObjectMeasurement(objectToObjectSourceCandidate.value, candidate);
      return;
    }

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
    hideMarquee();
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
    clickTracker.value = { down: null, moved: false };
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function cancelMeasurementInteraction(): void {
    const mode = store.toolMode.value;
    if (mode === 'pick_query_center' || mode === 'pick_refno') {
      store.setToolMode('none');
      return;
    }
    if (mode === 'measure_object_to_object') {
      clearObjectMeasureCandidates({ clearStatus: true, clearLastPairKey: true });
      return;
    }
    resetProgress();
    clearPendingCloudAnchor();
    hideMarquee();
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
  watch(
    () => ({
      mode: store.toolMode.value,
      picked: store.pickedRefnos.value,
    }),
    (next, prev) => {
      const mode = next.mode;
      const picked = next.picked ?? [];

      if (mode === 'pick_refno') {
        // 进入拾取模式：重置会话状态（不清除外部高亮）
        if (prev?.mode !== 'pick_refno') {
          pickedHighlightByBran.clear();
          pickedHighlightPinned.clear();
          lastAppliedPickHighlights = [];
        }

        // pickedRefnos 为空：视为取消/重置，撤销本会话高亮
        if (!picked || picked.length === 0) {
          clearPickHighlights();
          resetPickCandidateSession();
          return;
        }

        // 同步删除的候选
        const pickedSet = new Set<string>(picked);
        for (const k of Array.from(pickedHighlightByBran.keys())) {
          if (!pickedSet.has(k)) {
            pickedHighlightByBran.delete(k);
          }
        }
        applyPickHighlights();
        return;
      }

      // 退出拾取模式：确认场景保持当前高亮；仅清理会话内状态，避免后续误同步。
      // 直段高亮是对象级选中、不进 refno 状态表，留下来就没有入口能清，退出时一并撤掉。
      if (prev?.mode === 'pick_refno') {
        applyPickTubeHighlights([]);
        pickedHighlightByBran.clear();
        lastAppliedPickHighlights = [];
        resetPickCandidateSession();
      }
    },
    { deep: true }
  );

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
      handleTreeObjectMeasureSelection(refnos);
    },
    { immediate: true },
  );

  watch(
    () => store.cloudTargetRefnos.value.join('|'),
    () => {
      clearPendingCloudAnchor();
      hideMarquee();
    },
  );

  watch(
    () => store.toolMode.value,
    (mode, prev) => {
      if (mode !== prev) {
        resetProgress();
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
        if (mode === 'none') suspendCloudCreation();
        else cancelCloudCreation();
      }
      if (mode === 'none' && prev !== 'none') {
        hideMarquee();
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
        ensureToolsGroupAttached();
        syncFromStore();
      } else {
        clearGroup(toolsGroup);
        clearOverlayEls();
      }
    },
    { immediate: true }
  );

  const panelActions = createPanelActions(ctx, {
    resolveCloudTargetBbox,
    clearTextAnnotationMarkerClickTimer,
    resetPickCandidateSession,
    clearOverlayEls,
    hideMarquee,
    resetProgress,
    clearPendingCloudAnchor,
  });

  return {
    ready,
    statusText,
    objectToObjectUiState,
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
    canDrawCloudAnnotation,
    cancelCloudCreation,
    suspendCloudCreation,
    rollbackCloudCreationStep,
    clearPendingCloudAnchor,
    cloudGateBlock,

    // pick_refno 候选轮换（重叠构件）
    pickCandidates,
    pickCandidateIndex,
    cyclePickCandidate,

    // e2e/调试：读取云线轮廓当前渲染几何（世界坐标），用于验证「贴合包住」性质
    debugCloudOutlines: panelActions.debugCloudOutlines,
    // e2e/调试：云线渲染计数（静止零重建验收）与 V1 标签布局结果
    debugCloudRenderStats: panelActions.debugCloudRenderStats,
    resetCloudRenderStats: panelActions.resetCloudRenderStats,
    debugCloudLabelLayouts: panelActions.debugCloudLabelLayouts,
    debugCloudRegionRender: panelActions.debugCloudRegionRender,
    // P4 LOD：本帧计划快照；悬停临时升档（图钉的 pointerenter / leave 已绑定，这里给测试与外部调用）
    debugCloudLod: panelActions.debugCloudLod,
    setHoveredCloudAnnotation,
    // P4 LOD 聚合：pin 档图钉的屏幕聚合快照；打开 / 关闭某簇的成员列表；相机飞到一组云线
    debugCloudClusters: panelActions.debugCloudClusters,
    openClusterPopover,
    closeClusterPopover,
    flyToCloudAnnotations,
    // P4 inspection：遮挡淡化快照；覆盖显示模式（null = 跟随 URL mbd_mode）；不等相机停下立刻探一遍
    debugCloudInspection,
    setCloudInspectionMode,
    runCloudInspectionNow,
    // ADR-0050 视口降级：解析表变化后就地换外观（watch 已接；这里给测试直接调）与当前外观快照
    applyBindingDegrade,
    debugAnnotationDegrades: panelActions.debugAnnotationDegrades,

    // 云线 V1 标签拖动（文字框拖柄的 pointer 事件由 syncFromStore 绑定；这里给测试与外部调用）
    beginInlineOverlayAnnotationDrag,
    continueInlineOverlayAnnotationDrag,
    endInlineOverlayAnnotationDrag,

    clearAllInScene: panelActions.clearAllInScene,
    dispose: panelActions.dispose,

    // input hook (ViewerPanel 使用)
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    cancelMeasurementInteraction,

    // 兼容：selectionStore 在 none 模式下由 ViewerPanel 处理
    selectionStore,
  };
}
