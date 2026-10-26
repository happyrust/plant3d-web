/**
 * 面板动作（flyTo* / remove* / highlight* / clearAllInScene / dispose）与 e2e / 单测用的 debug* 快照。
 * 只读写 ctx；还留在 useDtxTools 闭包里的几个收尾动作经 hooks 进来（后续步骤搬进各自控制器后改成控制器引用）。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 2 步），实现未改。
 */
import { MeshLineMaterial } from '@lume/three-meshline';
import { type BufferGeometry, type LineDashedMaterial } from 'three';

import { aabbFromPoints } from '../geometry';
import { clearGroup } from '../visuals';

import type { CloudClusterDebugSnapshot, CloudLodDebugSnapshot, CloudOverlayEl, CloudRenderStats } from '../cloudRegion';
import type { DtxToolsContext } from '../context';
import type { Vec3 } from '@/composables/useToolStore';
import type { CloudFitState, SmallTargetLod } from '@/review/domain/annotationProjection/annotationProjection';
import type { CloudFrame, LabelLayoutResult } from '@/review/domain/annotationProjection/labelLayout';

import { getCloudMemberRefnos } from '@/composables/useToolStore';
import { DEFAULT_CLOUD_LOD_OPTIONS } from '@/review/domain/annotationProjection/lod';

export type PanelActionHooks = {
  resolveCloudTargetBbox: (cloud: CloudOverlayEl) => { min: Vec3; max: Vec3 } | null;
  clearTextAnnotationMarkerClickTimer: () => void;
  resetPickCandidateSession: () => void;
  clearOverlayEls: () => void;
  hideMarquee: () => void;
  resetProgress: () => void;
  clearPendingCloudAnchor: () => void;
};

export function createPanelActions(ctx: DtxToolsContext, hooks: PanelActionHooks) {
  function debugAnnotationDegrades(): {
    id: string
    state: 'missing' | 'stale' | null
    /** 云线：轮廓材质是否虚线 + 颜色；图钉：SVG 填充色 */
    outlineDashed: boolean | null
    lineColor: number | null
    pinFill: string | null
    badgeText: string | null
    badgeLeft: string | null
    badgeTop: string | null
    badgeOpacity: string | null
  }[] {
    const out: ReturnType<typeof debugAnnotationDegrades> = [];
    for (const [id, cloud] of ctx.overlays.cloudShapes.entries()) {
      const outlineMat = cloud.outline.material as MeshLineMaterial;
      const marker = ctx.overlays.markers.get(id);
      out.push({
        id,
        state: cloud.degrade?.state ?? null,
        outlineDashed: outlineMat.useDash,
        lineColor: outlineMat.color.getHex(),
        pinFill: marker?.el.querySelector('svg path')?.getAttribute('fill') ?? null,
        badgeText: cloud.badgeEl?.textContent?.trim() ?? null,
        badgeLeft: cloud.badgeEl?.style.left ?? null,
        badgeTop: cloud.badgeEl?.style.top ?? null,
        badgeOpacity: cloud.badgeEl?.style.opacity ?? null,
      });
    }
    for (const [id, entry] of ctx.overlays.markers.entries()) {
      if (!entry.marker || entry.marker.kind === 'cloud') continue;
      const leader = ctx.overlays.textLeaders.get(id);
      // rect / obb：外观读线框材质（虚线 = gapSize > 0）；text：读引线
      const boxEntry = ctx.overlays.rectShapes.get(id) ?? ctx.overlays.obbShapes.get(id);
      const boxMat = boxEntry ? (boxEntry.box.material as LineDashedMaterial) : null;
      const badge = entry.el.querySelector<HTMLElement>('[data-role="annotation-binding-badge"]');
      out.push({
        id,
        state: entry.marker.degrade?.state ?? null,
        outlineDashed: boxMat ? boxMat.gapSize > 0 : leader ? leader.coreMaterial.useDash : null,
        lineColor: boxMat ? boxMat.color.getHex() : leader ? leader.coreMaterial.color.getHex() : null,
        pinFill: entry.el.querySelector('svg path')?.getAttribute('fill') ?? null,
        badgeText: badge?.textContent?.trim() ?? null,
        badgeLeft: badge?.style.left ?? null,
        badgeTop: badge?.style.top ?? null,
        badgeOpacity: null,
      });
    }
    return out;
  }

  /** 云线渲染计数快照（静止零重建等验收用） */
  function debugCloudRenderStats(): CloudRenderStats {
    return { ...ctx.cloudRenderStats };
  }

  function resetCloudRenderStats(): void {
    ctx.cloudRenderStats.frames = 0;
    ctx.cloudRenderStats.contourBuilds = 0;
    ctx.cloudRenderStats.setPoints = 0;
    ctx.cloudRenderStats.labelLayouts = 0;
    ctx.cloudRenderStats.paintUpdates = 0;
    ctx.cloudRenderStats.lodPlans = 0;
    ctx.cloudRenderStats.inspectionRays = 0;
  }

  /** e2e / 单测：pin 档图钉的屏幕聚合快照——每簇种子 / 位置 / 成员，被藏起的图钉，弹出列表对着哪一簇 */
  function debugCloudClusters(): CloudClusterDebugSnapshot {
    return {
      clusters: ctx.cloudLod.clusterCurrent.map((c) => ({ ...c, memberIds: [...c.memberIds] })),
      hiddenMarkerIds: [...ctx.cloudLod.clusterHiddenMarkerIds].sort(),
      badgeSeedIds: [...ctx.cloudLod.clusterBadges.keys()].sort(),
      popoverSeedId: ctx.cloudLod.clusterPopover?.seedId ?? null,
    };
  }

  /** e2e / 单测：P4 LOD 本帧计划——预算、是否超预算、每条云线的等级 / 优先级 / 是否固定高档、文字框 DOM 是否挂着 */
  function debugCloudLod(): CloudLodDebugSnapshot {
    const items: CloudLodDebugSnapshot['items'] = [];
    for (const [id, cloud] of ctx.overlays.cloudShapes.entries()) {
      items.push({
        id,
        level: cloud.render.lodLevel,
        applied: cloud.render.lodApplied,
        priority: cloud.render.lodPriority,
        pinnedHigh: cloud.render.lodPinnedHigh,
        labelMounted: ctx.overlays.labels.has(id),
      });
    }
    return {
      budget: DEFAULT_CLOUD_LOD_OPTIONS.budget,
      slack: DEFAULT_CLOUD_LOD_OPTIONS.slack,
      overBudget: ctx.cloudLod.planSummary.overBudget,
      fullCount: ctx.cloudLod.planSummary.fullCount,
      pinCount: ctx.cloudLod.planSummary.pinCount,
      hoveredId: ctx.cloudLod.hoveredId,
      items,
    };
  }

  /** e2e / 单测：每条云线本帧的范围体管线状态（P2）；`regionState === null` = 未走新管线（旧记录 / 开关关） */
  function debugCloudRegionRender(): {
    id: string
    regionState: CloudFitState | null
    lod: SmallTargetLod | null
    polylineCount: number
    invalidReason: string | null
    cellCount: number
    outlineVisible: boolean
    extraVisible: number
    bboxEdgesVisible: boolean
    phaseAnchorId: string | null
  }[] {
    const out: ReturnType<typeof debugCloudRegionRender> = [];
    for (const [id, cloud] of ctx.overlays.cloudShapes.entries()) {
      out.push({
        id,
        regionState: cloud.render.regionState,
        lod: cloud.render.regionLastLod,
        polylineCount: cloud.render.regionPolylineCount,
        invalidReason: cloud.render.regionInvalidReason,
        cellCount: cloud.render.regionCells?.length ?? 0,
        outlineVisible: cloud.outline.visible,
        extraVisible: cloud.outlineExtra.filter((m) => m.visible).length,
        bboxEdgesVisible: cloud.bboxEdges.visible,
        phaseAnchorId: cloud.render.regionPhase?.frame.anchorId ?? null,
      });
    }
    return out;
  }

  /** e2e / 单测：每条云线当前的屏幕参考框、V1 文字框布局与文字框 DOM 定位 */
  function debugCloudLabelLayouts(): {
    id: string
    frame: CloudFrame | null
    layout: LabelLayoutResult | null
    layoutMode: 'legacy' | 'v1'
    labelLeft: string
    labelTop: string
    leaderVisible: boolean
  }[] {
    const out: ReturnType<typeof debugCloudLabelLayouts> = [];
    for (const [id, cloud] of ctx.overlays.cloudShapes.entries()) {
      const labelEntry = ctx.overlays.labels.get(id);
      out.push({
        id,
        frame: cloud.render.frame,
        layout: cloud.render.labelLayout,
        layoutMode: labelEntry?.layoutMode === 'v1' ? 'v1' : 'legacy',
        labelLeft: labelEntry?.el.style.left ?? '',
        labelTop: labelEntry?.el.style.top ?? '',
        leaderVisible: cloud.leader.root.visible,
      });
    }
    return out;
  }

  /**
   * e2e/调试：导出每条云线轮廓当前渲染的世界坐标点与关联目标 AABB（不参与业务逻辑）。
   * `selectionBbox` 报的是本帧真正用于贴合的那份 AABB，而非记录里的创建时快照。
   */
  function debugCloudOutlines(): {
    id: string
    visible: boolean
    worldPositions: number[]
    selectionBbox: { min: Vec3; max: Vec3 } | null
  }[] {
    const out: {
      id: string
      visible: boolean
      worldPositions: number[]
      selectionBbox: { min: Vec3; max: Vec3 } | null
    }[] = [];
    for (const [id, cloud] of ctx.overlays.cloudShapes.entries()) {
      const worldPositions: number[] = [];
      for (const mesh of [cloud.outline, ...cloud.outlineExtra.filter((m) => m.visible)]) {
        const attr = (mesh.geometry as BufferGeometry).getAttribute('position');
        if (!attr) continue;
        for (let i = 0; i < attr.count; i += 1) {
          worldPositions.push(attr.getX(i), attr.getY(i), attr.getZ(i));
        }
      }
      out.push({
        id,
        visible: cloud.outline.visible || cloud.outlineExtra.some((m) => m.visible),
        worldPositions,
        selectionBbox: hooks.resolveCloudTargetBbox(cloud),
      });
    }
    return out;
  }

  function flyToMeasurement(id: string) {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;
    const rec = ctx.store.measurements.value.find((m) => m.id === id);
    if (!rec) return;
    const pts: Vec3[] = [];
    if (rec.kind === 'distance') {
      pts.push(rec.origin.worldPos, rec.target.worldPos);
    } else {
      pts.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos);
    }
    const aabb = aabbFromPoints(pts);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToAnnotation(id: string) {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;
    const rec = ctx.store.annotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints([rec.worldPos]);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToCloudAnnotation(id: string) {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;
    const rec = ctx.store.cloudAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const refnos = getCloudMemberRefnos(rec);
    const aabb = viewer.scene.getAABB(refnos);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToRectAnnotation(id: string) {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;
    const rec = ctx.store.rectAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints(rec.obb.corners as any);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToObbAnnotation(id: string) {
    const viewer = ctx.compatViewerRef.value;
    if (!viewer) return;
    const rec = ctx.store.obbAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints(rec.obb.corners as any);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function removeMeasurement(id: string) {
    ctx.store.removeMeasurement(id);
  }

  function removeAnnotation(id: string) {
    ctx.store.removeAnnotation(id);
  }

  function removeCloudAnnotation(id: string) {
    ctx.store.removeCloudAnnotation(id);
  }

  function removeRectAnnotation(id: string) {
    ctx.store.removeRectAnnotation(id);
  }

  function removeObbAnnotation(id: string) {
    ctx.store.removeObbAnnotation(id);
  }

  function highlightAnnotationTargets(refnos: string[]) {
    if (refnos.length === 0) return;
    window.dispatchEvent(new CustomEvent('showModelByRefnos', {
      detail: { refnos, regenModel: false, flyTo: true, highlight: true },
    }));
  }

  function highlightAnnotationTarget(refno: string) {
    highlightAnnotationTargets([refno]);
  }

  function clearAllInScene() {
    hooks.clearTextAnnotationMarkerClickTimer();
    hooks.resetPickCandidateSession();
    clearGroup(ctx.toolsGroup);
    hooks.clearOverlayEls();
    hooks.hideMarquee();
    try {
      ctx.rectPreviewLine.value?.geometry.dispose()
      ; (ctx.rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    ctx.rectPreviewLine.value = null;
    ctx.rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    hooks.resetProgress();
    hooks.clearPendingCloudAnchor();
    ctx.store.clearAll();
  }

  function dispose() {
    hooks.clearTextAnnotationMarkerClickTimer();
    hooks.resetPickCandidateSession();
    const viewer = ctx.dtxViewerRef.value;
    if (viewer && ctx.toolsGroup.parent === viewer.scene) {
      try { viewer.scene.remove(ctx.toolsGroup); } catch { /* ignore */ }
    }
    clearGroup(ctx.toolsGroup);
    hooks.clearOverlayEls();
    hooks.hideMarquee();
    ctx.cloudLod.levels.clear();
    ctx.cloudLod.planKey = '';
    ctx.cloudLod.hoveredId = null;
    ctx.cloudLod.clusterSeedOf = new Map();
    if (ctx.cloudLod.inspectionTimer !== null) {
      clearTimeout(ctx.cloudLod.inspectionTimer);
      ctx.cloudLod.inspectionTimer = null;
    }
    ctx.cloudLod.inspectionPending = false;

    if (ctx.marqueeDiv.value) {
      try { ctx.marqueeDiv.value.remove(); } catch { /* ignore */ }
      ctx.marqueeDiv.value = null;
    }

    try {
      ctx.rectPreviewLine.value?.geometry.dispose()
      ; (ctx.rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    ctx.rectPreviewLine.value = null;
  }

  return {
    debugAnnotationDegrades,
    debugCloudRenderStats,
    resetCloudRenderStats,
    debugCloudClusters,
    debugCloudLod,
    debugCloudRegionRender,
    debugCloudLabelLayouts,
    debugCloudOutlines,
    flyToMeasurement,
    flyToAnnotation,
    flyToCloudAnnotation,
    flyToRectAnnotation,
    flyToObbAnnotation,
    removeMeasurement,
    removeAnnotation,
    removeCloudAnnotation,
    removeRectAnnotation,
    removeObbAnnotation,
    highlightAnnotationTargets,
    highlightAnnotationTarget,
    clearAllInScene,
    dispose,
  };
}
