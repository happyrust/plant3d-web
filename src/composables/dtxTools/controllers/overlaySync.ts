/**
 * overlay 同步的编排：store 记录 → 场景 / DOM 实体的重建（syncFromStore）、每帧投影（updateOverlayPositions）与 ADR-0050 视口降级（applyBindingDegrade）。
 * overlays / cloudRenderStats / cloudFrameTrackers 的所有者；交互、LOD、inspection、宿主、拾取预览都经 deps 调回对应控制器。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 8 步 a）；第 8 步 b 把各种类的段落拆到 overlay/textOverlay · cloudOverlay · boxOverlay，这里只剩编排：
 * 重建的前后处理、每帧的引线分辨率 / 图钉与文字框定位 / 图钉聚合 / 探测排程，以及降级改变后的重排。
 */

import { worldToOverlay } from '../geometry';
import { setAnnotationLeaderResolution } from '../leaderVisual';
import { repaintMarkerDegrade } from '../overlayDom';
import { clearGroup, getCanvasResolution } from '../visuals';

import { createBoxOverlay } from './overlay/boxOverlay';
import { createCloudOverlay } from './overlay/cloudOverlay';
import { createTextOverlay } from './overlay/textOverlay';

import type { DtxToolsContext } from '../context';
import type { AnnotationOverlayKind } from '../types';
import type { createAnnotationInteraction } from './annotationInteraction';
import type { createCloudInspection } from './cloudInspection';
import type { createCloudLodController } from './cloudLod';
import type { OverlaySyncFrame } from './overlay/frame';
import type { createOverlayHost } from './overlayHost';
import type { createPickCandidateController } from './pickCandidateController';
import type { PinClusterItem } from '@/review/domain/annotationProjection/cluster';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

import { buildRecordDegradeKey } from '@/composables/useAnnotationBindingResolve';

export type OverlaySyncDeps = {
  annotation: ReturnType<typeof createAnnotationInteraction>;
  lod: ReturnType<typeof createCloudLodController>;
  inspection: ReturnType<typeof createCloudInspection>;
  host: ReturnType<typeof createOverlayHost>;
  pick: ReturnType<typeof createPickCandidateController>;
};

export function createOverlaySync(ctx: DtxToolsContext, deps: OverlaySyncDeps) {
  const { annotation, lod, inspection, host, pick } = deps;

  const text = createTextOverlay(ctx, { annotation });
  const cloud = createCloudOverlay(ctx, { annotation, lod, inspection });
  const box = createBoxOverlay(ctx, { annotation });

  function syncFromStore() {
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
    if (!viewer || !overlay) return;
    const resolution = getCanvasResolution(viewer.canvas);

    host.ensureToolsGroupAttached();
    clearGroup(ctx.toolsGroup);
    host.clearOverlayEls();
    ctx.overlays.textLeaders.clear();
    annotation.pruneInlineTextAnnotationDrafts();

    // clearGroup 连同候选预览一起销毁了，重建以免轮换线框在批注同步时凭空消失。
    pick.rebuildCandidatePreview();

    if (ctx.suppressStoreOverlays) return;

    // ADR-0050：一趟拿全部记录的降级态（missing / stale），创建时就画成灰虚线；之后解析表变化走 applyBindingDegrade 原地更新
    const degrades = ctx.bindingResolve.getRecordDegrades();
    const degradeOf = (kind: AnnotationOverlayKind, id: string): AnnotationDegrade | null =>
      degrades.get(buildRecordDegradeKey(kind, id)) ?? null;

    // 按种类重建：文字 / 云线 / 矩形 / OBB（段落顺序与拆分前一致）
    const frame: OverlaySyncFrame = { overlay, resolution, degradeOf };
    text.syncTextAnnotations(frame);
    cloud.syncCloudAnnotations(frame);
    box.syncRectAnnotations(frame);
    box.syncObbAnnotations(frame);

    // preview rect line (if exists)
    if (ctx.rectPreviewLine.value) {
      ctx.toolsGroup.add(ctx.rectPreviewLine.value);
    }

    updateOverlayPositions();
    ctx.requestRender?.();
  }

  function updateOverlayPositions() {
    const viewer = ctx.dtxViewerRef.value;
    const overlay = ctx.overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const resolution = getCanvasResolution(canvas);

    for (const leader of ctx.overlays.textLeaders.values()) {
      setAnnotationLeaderResolution(leader, resolution.width, resolution.height);
    }
    for (const cloud of ctx.overlays.cloudShapes.values()) {
      setAnnotationLeaderResolution(cloud.leader, resolution.width, resolution.height);
    }
    for (const rect of ctx.overlays.rectShapes.values()) {
      setAnnotationLeaderResolution(rect.leader, resolution.width, resolution.height);
    }
    for (const obb of ctx.overlays.obbShapes.values()) {
      setAnnotationLeaderResolution(obb.leader, resolution.width, resolution.height);
    }

    // 云线：帧戳 / LOD 计划 / 逐条分阶段渲染（cloudOverlay）；回传给下面的图钉聚合与探测排程
    const { lodReplanned, inspectionMode } = cloud.renderFrame(viewer, overlay, canvas, resolution);

    // pin 档图钉的屏幕聚合只在 LOD 计划重算的那一帧重做（图钉屏幕位置只随相机 / 视口 / 集合变）；
    // 退出超预算（或开关关）那一帧拆掉徽标、放回图钉
    const clusterItems: PinClusterItem[] | null = lodReplanned && ctx.cloudLod.planSummary.overBudget ? [] : null;
    if (lodReplanned && !ctx.cloudLod.planSummary.overBudget && (ctx.cloudLod.clusterBadges.size > 0 || ctx.cloudLod.clusterHiddenMarkerIds.size > 0)) {
      lod.clearPinClusterDom();
    }
    for (const it of ctx.overlays.markers.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
      if (clusterItems && p.visible && it.marker?.kind === 'cloud' && ctx.overlays.cloudShapes.get(it.id)?.render.lodLevel === 'pin') {
        clusterItems.push({ id: it.id, x: p.x, y: p.y });
      }
    }
    if (clusterItems) lod.applyPinClusters(clusterItems);

    // 检视模式下有云线待探：等相机停下（settle）再打射线；置顶模式下不会有待探，也就一条射线都不打
    if (ctx.cloudLod.inspectionPending) inspection.scheduleCloudInspection();
    else if (ctx.cloudLod.inspectionTimer !== null && inspectionMode !== 'inspection') {
      clearTimeout(ctx.cloudLod.inspectionTimer);
      ctx.cloudLod.inspectionTimer = null;
    }

    for (const it of ctx.overlays.labels.values()) {
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
    const overlay = ctx.overlayContainerRef.value;
    const degrades = ctx.bindingResolve.getRecordDegrades();
    let changed = false;

    if (cloud.applyDegrades(degrades, overlay)) changed = true;

    for (const entry of ctx.overlays.markers.values()) {
      const meta = entry.marker;
      if (!meta) continue;
      const degrade = degrades.get(buildRecordDegradeKey(meta.kind, meta.annotationId)) ?? null;
      if (repaintMarkerDegrade(entry, degrade)) changed = true;
    }

    if (text.applyDegrades(degrades)) changed = true;

    if (box.applyDegrades(degrades)) changed = true;

    if (!changed) return;
    updateOverlayPositions();
    ctx.requestRender?.();
  }

  return {
    syncFromStore,
    resolveCloudTargetBbox: cloud.resolveCloudTargetBbox,
    updateOverlayPositions,
    applyBindingDegrade,
  };
}
