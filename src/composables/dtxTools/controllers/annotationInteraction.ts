/**
 * 批注交互：激活 / 打开处理页与内联编辑器 / 内联文字草稿 / 文字标记单双击 / 文字框拖动（文字批注与云线·矩形·OBB 的内联文字框）。
 * 草稿表 / 标签双击状态 / 单击定时器是自有状态；两个拖动态在 ctx 上（所有者是本控制器，overlaySync / cloudLod 只读）。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 5 步），实现未改；文字框位置变化后的重排经 hooks.updateOverlayPositions 回到 overlaySync。
 */
import { Vector3 } from 'three';

import { resolveTextAnnotationMarkerDoubleClickAction, resolveTextAnnotationMarkerSingleClickAction } from '../annotationRecords';
import { overlayToWorld, vec3ToTuple, worldToOverlayPoint } from '../geometry';
import { updateLeaderGeometry } from '../leaderVisual';
import { resolveAnnotationLabelClickAction } from '../overlayHtml';

import type { DtxToolsContext } from '../context';
import type { AnnotationLabelClickState, AnnotationOverlayKind, InlineTextAnnotationDraft, TextAnnotationMarkerClickResult } from '../types';
import type { AnnotationRecord, CloudAnnotationRecord, ObbAnnotationRecord, RectAnnotationRecord } from '@/composables/useToolStore';
import type { CloudLabelLayoutV1 } from '@/review/domain/cloudRegion';

import { setAnnotationProcessingEntryTarget } from '@/components/review/annotationProcessingEntry';
import { isExternalSjFormFocusedMode, readPersistedEmbedModeParams } from '@/components/review/embedRoleLanding';
import { isCanonicalReturnedTask } from '@/components/review/reviewTaskFilters';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { DEFAULT_LABEL_PREFERENCE, labelOffsetFromTopLeft } from '@/review/domain/annotationProjection/labelLayout';
import { UserRole } from '@/types/auth';

export type AnnotationInteractionHooks = {
  updateOverlayPositions: () => void;
};

export function createAnnotationInteraction(ctx: DtxToolsContext, hooks: AnnotationInteractionHooks) {
  let lastAnnotationLabelClick: AnnotationLabelClickState | null = null;
  let textAnnotationMarkerClickTimer: ReturnType<typeof setTimeout> | null = null;
  const inlineTextAnnotationDrafts = new Map<string, InlineTextAnnotationDraft>();

  function activateAnnotation(kind: AnnotationOverlayKind, id: string) {
    ctx.store.activeAnnotationId.value = kind === 'text' ? id : null;
    ctx.store.activeCloudAnnotationId.value = kind === 'cloud' ? id : null;
    ctx.store.activeRectAnnotationId.value = kind === 'rect' ? id : null;
    ctx.store.activeObbAnnotationId.value = kind === 'obb' ? id : null;
  }

  function getAnnotationRecordByKind(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): AnnotationRecord | CloudAnnotationRecord | RectAnnotationRecord | ObbAnnotationRecord | null {
    if (kind === 'text') {
      return ctx.store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return ctx.store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return ctx.store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return ctx.store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function resolveCurrentFormId(): string | undefined {
    return normalizeOptionalString(ctx.store.activeAnnotationContext.value?.record.formId)
      ?? normalizeOptionalString(ctx.reviewStore.currentTask.value?.formId);
  }

  function openAnnotationProcessingPage(kind: AnnotationOverlayKind, id: string) {
    commitInlineAnnotationDraft(kind, id);
    const currentTask = ctx.reviewStore.currentTask.value;
    const currentUser = ctx.userStore.currentUser.value;
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
      ...ctx.store.annotations.value.map((annotation) => getInlineAnnotationDraftKey('text', annotation.id)),
      ...ctx.store.cloudAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('cloud', annotation.id)),
      ...ctx.store.rectAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('rect', annotation.id)),
      ...ctx.store.obbAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('obb', annotation.id)),
    ]);
    for (const draftKey of inlineTextAnnotationDrafts.keys()) {
      if (!existingKeys.has(draftKey)) {
        inlineTextAnnotationDrafts.delete(draftKey);
      }
    }
  }

  function clearPendingInlineAnnotationEdit(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    if (kind === 'text' && ctx.store.pendingTextAnnotationEditId.value === annotationId) {
      ctx.store.pendingTextAnnotationEditId.value = null;
    }
    if (kind === 'cloud' && ctx.store.pendingCloudAnnotationEditId.value === annotationId) {
      ctx.store.pendingCloudAnnotationEditId.value = null;
    }
    if (kind === 'rect' && ctx.store.pendingRectAnnotationEditId.value === annotationId) {
      ctx.store.pendingRectAnnotationEditId.value = null;
    }
    if (kind === 'obb' && ctx.store.pendingObbEditId.value === annotationId) {
      ctx.store.pendingObbEditId.value = null;
    }
  }

  function focusInlineAnnotationEditor(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const label = ctx.overlays.labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    if (!label) {
      if (kind === 'text') ctx.store.pendingTextAnnotationEditId.value = annotationId;
      if (kind === 'cloud') ctx.store.pendingCloudAnnotationEditId.value = annotationId;
      if (kind === 'rect') ctx.store.pendingRectAnnotationEditId.value = annotationId;
      if (kind === 'obb') ctx.store.pendingObbEditId.value = annotationId;
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
      ctx.store.updateAnnotation(id, { collapsed: result.nextCollapsed });
    }

    if (result.activate) {
      activateAnnotation('text', id);
    }
  }

  function handleTextAnnotationMarkerSingleClick(id: string) {
    commitInlineAnnotationDraft('text', id);
    const rec = ctx.store.annotations.value.find((item) => item.id === id);
    if (!rec) return;
    applyTextAnnotationMarkerAction(id, resolveTextAnnotationMarkerSingleClickAction(rec.collapsed));
  }

  function handleTextAnnotationMarkerDoubleClick(id: string) {
    clearTextAnnotationMarkerClickTimer();
    commitInlineAnnotationDraft('text', id);
    const rec = ctx.store.annotations.value.find((item) => item.id === id);
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
    ctx.store.updateAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function commitDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    labelWorldPos: Vector3,
  ) {
    const patch = { leaderEndWorldPos: vec3ToTuple(labelWorldPos) };
    if (kind === 'cloud') {
      ctx.store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      ctx.store.updateRectAnnotation(annotationId, patch);
      return;
    }
    ctx.store.updateObbAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function getInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): Pick<AnnotationRecord, 'title' | 'description'> | null {
    if (kind === 'text') {
      return ctx.store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return ctx.store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return ctx.store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return ctx.store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function updateInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    patch: { title?: string; description?: string },
  ) {
    if (kind === 'text') {
      ctx.store.updateAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'cloud') {
      ctx.store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      ctx.store.updateRectAnnotation(annotationId, patch);
      return;
    }
    ctx.store.updateObbAnnotation(annotationId, patch);
  }

  function commitInlineAnnotationDraft(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const rec = getInlineAnnotationRecord(kind, annotationId);
    if (!rec) return;
    const label = ctx.overlays.labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
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
    ctx.textAnnotationDrag.value = {
      annotationId: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
    };
  }

  function updateDraggedTextAnnotation(annotationId: string, nextLabelWorldPos: Vector3) {
    const labelEntry = ctx.overlays.labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    const leader = ctx.overlays.textLeaders.get(`anno:${annotationId}`);
    const dragAnchor = ctx.textAnnotationDrag.value.anchorWorldPos;
    if (leader && dragAnchor) {
      updateLeaderGeometry(leader, dragAnchor, nextLabelWorldPos);
    }
    hooks.updateOverlayPositions();
    ctx.requestRender?.();
  }

  function beginTextAnnotationDrag(
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = ctx.overlays.labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    ctx.textAnnotationDrag.value = {
      annotationId,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
    };
  }

  function continueTextAnnotationDrag(event: PointerEvent) {
    const dragState = ctx.textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
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
    const dragState = ctx.textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId) return;
    const labelEntry = ctx.overlays.labels.get(`anno:${dragState.annotationId}`);
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const shouldCommit = dragState.moved && finalLabelWorldPos;
    resetTextAnnotationDrag();
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedTextAnnotation(annotationId, finalLabelWorldPos);
    } else {
      hooks.updateOverlayPositions();
      ctx.requestRender?.();
    }
  }

  function resetInlineOverlayAnnotationDrag() {
    ctx.inlineOverlayAnnotationDrag.value = {
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
    const labelEntry = ctx.overlays.labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    if (kind === 'cloud') {
      const cloud = ctx.overlays.cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) {
        cloud.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(cloud.leader, cloud.worldPos, nextLabelWorldPos);
      }
    } else if (kind === 'rect') {
      const rect = ctx.overlays.rectShapes.get(`rect:${annotationId}`);
      if (rect) {
        rect.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(rect.leader, rect.worldPos, nextLabelWorldPos);
      }
    } else {
      const obb = ctx.overlays.obbShapes.get(`obb:${annotationId}`);
      if (obb) {
        obb.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(obb.leader, obb.worldPos, nextLabelWorldPos);
      }
    }
    hooks.updateOverlayPositions();
    ctx.requestRender?.();
  }

  function beginInlineOverlayAnnotationDrag(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = ctx.overlays.labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    // 云线 + 开关开：按屏幕像素拖（松手提交 labelLayoutV1 意图偏移）；记住按住点相对文字框左上角的偏移，
    // 拖动时文字框跟手而不是跳到指针下。旧记录（无 labelLayoutV1）第一次拖动即升级为 V1 布局（方案 §5）。
    let labelGrabOffsetPx: { x: number; y: number } | null = null;
    const cloud = kind === 'cloud' ? ctx.overlays.cloudShapes.get(`cloud:${annotationId}`) : undefined;
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
    ctx.inlineOverlayAnnotationDrag.value = {
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
    const dragState = ctx.inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    if (dragState.labelGrabOffsetPx && dragState.annotationKind === 'cloud') {
      const cloud = ctx.overlays.cloudShapes.get(`cloud:${dragState.annotationId}`);
      if (cloud) {
        cloud.render.labelDragTopLeft = {
          x: event.clientX - overlayRect.left - dragState.labelGrabOffsetPx.x,
          y: event.clientY - overlayRect.top - dragState.labelGrabOffsetPx.y,
        };
        dragState.moved = true;
        hooks.updateOverlayPositions();
        ctx.requestRender?.();
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
    const cloud = ctx.overlays.cloudShapes.get(`cloud:${annotationId}`);
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
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
    ctx.store.updateCloudAnnotation(annotationId, { labelLayoutV1, leaderEndWorldPos: vec3ToTuple(centerWorld) });
    return true;
  }

  function endInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = ctx.inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId) return;
    const labelEntry = ctx.overlays.labels.get(getInlineAnnotationLabelKey(dragState.annotationKind, dragState.annotationId));
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const annotationKind = dragState.annotationKind;
    const v1Drag = dragState.labelGrabOffsetPx !== null && annotationKind === 'cloud';
    const shouldCommit = dragState.moved && (v1Drag || finalLabelWorldPos);
    resetInlineOverlayAnnotationDrag();
    if (v1Drag) {
      const committed = shouldCommit && commitDraggedCloudLabelLayoutV1(annotationId);
      const cloud = ctx.overlays.cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) cloud.render.labelDragTopLeft = null;
      if (!committed) {
        hooks.updateOverlayPositions();
        ctx.requestRender?.();
      }
      return;
    }
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedOverlayAnnotation(annotationKind, annotationId, finalLabelWorldPos);
    } else {
      hooks.updateOverlayPositions();
      ctx.requestRender?.();
    }
  }

  return {
    activateAnnotation,
    openAnnotationProcessingPage,
    openAnnotationEditor,
    handleAnnotationOverlayClick,
    setInlineAnnotationDraft,
    getInlineTextAnnotationDraft,
    pruneInlineTextAnnotationDrafts,
    focusInlineAnnotationEditor,
    clearTextAnnotationMarkerClickTimer,
    scheduleTextAnnotationMarkerSingleClick,
    handleTextAnnotationMarkerDoubleClick,
    commitInlineAnnotationDraft,
    beginTextAnnotationDrag,
    continueTextAnnotationDrag,
    endTextAnnotationDrag,
    beginInlineOverlayAnnotationDrag,
    continueInlineOverlayAnnotationDrag,
    endInlineOverlayAnnotationDrag,
  };
}
