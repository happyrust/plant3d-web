/**
 * 云线批注的 overlay：文字框 DOM 的挂 / 卸（P4 LOD 只给 full 档挂）、syncFromStore 的云线段、目标包围盒回退解析、
 * 每帧的云线分阶段渲染（帧戳 / LOD 计划 / shape / layout / paint / inspection 待探）与视口降级的云线段。
 * 从 overlaySync.ts 按种类拆出（拆分计划第 8 步 b），语句未改；图钉聚合与探测排程仍由 overlaySync 按 renderFrame 的回传调 lod / inspection。
 */
import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { LineDashedMaterial, Matrix4, Vector3 } from 'three';

import { shouldRenderTextAnnotationCard, toggleTextAnnotationCollapsed } from '../../annotationRecords';
import { CLOUD_FIT_PADDING_PX, CLOUD_TARGET_BBOX_TTL_MS, boxCornersFromMinMaxVec, buildCloudBillboardPolyline, buildWavySelectionBboxLinePositions, cloudWavesPerEdgeForSizePx, computeFittedCloudRectFromCorners, dashSizeFromLineSegments, updateCloudBboxLineSegmentsGeometry } from '../../cloudGeometry';
import { type CloudOverlayEl, collectWorldCellEdgePositions, createCloudRenderCache, createDefaultCloudLabelLayoutV1, isRegionPresentationRecord, labelPreferenceFromRecord, regionRenderStyleFromRecord } from '../../cloudRegion';
import { EMPTY_BOUNDS, IDENTITY_MATRIX_ELEMENTS, clamp, measureLabelSize, overlayToWorld, worldToOverlayPoint } from '../../geometry';
import { buildAnnotationLeaderStyle, updateLeaderGeometry } from '../../leaderVisual';
import { makeInlineAnnotationCardEl, makeTextAnnotationMarkerEl } from '../../overlayDom';
import { createCloudAnnotationVisual } from '../../visuals';

import type { OverlaySyncFrame } from './frame';
import type { DtxToolsContext } from '../../context';
import type { createAnnotationInteraction } from '../annotationInteraction';
import type { createCloudInspection } from '../cloudInspection';
import type { createCloudLodController } from '../cloudLod';
import type { CloudInspectionMode } from '@/review/domain/annotationProjection/inspection';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { applyDashedLineDegrade, applyLeaderDegrade, applyMeshLineDegrade, createCloudDegradeBadgeEl, positionCloudDegradeBadge, sameDegrade } from '@/composables/annotationDegradeViewport';
import { buildRecordDegradeKey } from '@/composables/useAnnotationBindingResolve';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { dtxLoaderRevision } from '@/composables/useDbnoInstancesDtxLoader';
import { type Vec3, getCloudMemberRefnos } from '@/composables/useToolStore';
import { liftScreenPolylineToBillboard, matricesEqual, regionToWorldCells, renderCloudRegion } from '@/review/domain/annotationProjection/annotationProjection';
import { ALL_CLOUD_DIRTY, type CloudRenderStamp, computeCloudDirty } from '@/review/domain/annotationProjection/dirty';
import { inspectionFactor } from '@/review/domain/annotationProjection/inspection';
import { type LabelPreference, labelOffsetFromTopLeft, layoutCloudLabel, rectToCloudFrame } from '@/review/domain/annotationProjection/labelLayout';
import { DEFAULT_CLOUD_LOD_OPTIONS } from '@/review/domain/annotationProjection/lod';
import { regionCoversMembers } from '@/review/domain/cloudRegion';
import { worldPerPixelAt } from '@/utils/three/annotation/utils/solvespaceLike';

export type CloudOverlayDeps = {
  annotation: ReturnType<typeof createAnnotationInteraction>;
  lod: ReturnType<typeof createCloudLodController>;
  inspection: ReturnType<typeof createCloudInspection>;
};

export function createCloudOverlay(ctx: DtxToolsContext, deps: CloudOverlayDeps) {
  const { annotation, lod, inspection } = deps;

  /**
   * 云线文字框（行内卡）DOM：从 syncFromStore 抽出来，P4 LOD 下只给 `full` 档挂载、降到 `pin` 档时卸掉——
   * 上千条云线不为每条都建一张带输入框的卡。事件绑定与旧代码一致；重复调用（已挂载）不重建。
   */
  function mountCloudLabel(cloud: CloudOverlayEl): void {
    const overlay = ctx.overlayContainerRef.value;
    if (!overlay || ctx.overlays.labels.has(cloud.id)) return;
    const c = cloud.record;
    const anchor = cloud.worldPos;
    const labelWorldPos = cloud.labelWorldPos;
    const draft = annotation.getInlineTextAnnotationDraft('cloud', c.id, c);
    const label = makeInlineAnnotationCardEl(overlay, '云线批注', draft.title, draft.description);
    label.style.transform = 'translate(-50%,-50%)';
    if (c.severity) label.dataset.severity = c.severity;
    ctx.overlays.labels.set(cloud.id, { id: cloud.id, worldPos: labelWorldPos, el: label });
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
      if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== c.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      annotation.continueInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointerup', (ev) => {
      if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== c.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
      dragHandle.style.cursor = 'grab';
      annotation.endInlineOverlayAnnotationDrag(ev);
    });
    dragHandle?.addEventListener('pointercancel', (ev) => {
      if (ctx.inlineOverlayAnnotationDrag.value.annotationId !== c.id || ctx.inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
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

    if (ctx.store.pendingCloudAnnotationEditId.value === c.id) {
      queueMicrotask(() => annotation.focusInlineAnnotationEditor('cloud', c.id));
    }
  }

  /** 降到 `pin` 档：卸掉文字框 DOM（草稿在 inlineTextAnnotationDrafts 里，不随 DOM 丢） */
  function unmountCloudLabel(cloud: CloudOverlayEl): void {
    const entry = ctx.overlays.labels.get(cloud.id);
    if (!entry) return;
    try { entry.el.remove(); } catch { /* ignore */ }
    ctx.overlays.labels.delete(cloud.id);
    cloud.render.labelLayout = null;
  }

  /** 云线批注：图钉 / 轮廓 / 盒边 / 引线的场景实体 + DOM 图钉；超预算时文字框交给 renderFrame 按 LOD 计划挂。原 syncFromStore 的 Cloud 段。 */
  function syncCloudAnnotations(frame: OverlaySyncFrame): void {
    const { overlay, resolution, degradeOf } = frame;
    // ---------------- Cloud annotations (screen-space cloud + world anchor) ----------------
    // P4 LOD（方案 §9.3）：云线超过预算时文字框 DOM 不在这里建——由 updateOverlayPositions 按计划只给 full 档挂载
    // （本函数末尾就会调一次，同一同步调用内完成，不闪）；≤ 预算或开关关时照旧当场建。集合变了，LOD 计划要重算。
    let visibleCloudCount = 0;
    for (const c of ctx.store.cloudAnnotations.value) if (c.visible) visibleCloudCount += 1;
    const deferCloudLabels = isCloudRenderFlagEnabled('cloudAdaptiveLod') && visibleCloudCount > DEFAULT_CLOUD_LOD_OPTIONS.budget;
    ctx.cloudLod.setVersion += 1;
    ctx.cloudLod.planKey = '';

    for (const c of ctx.store.cloudAnnotations.value) {
      if (!c.visible) continue;
      const anchor = new Vector3(...c.anchorWorldPos);
      const visual = createCloudAnnotationVisual(c, resolution);
      const degrade = degradeOf('cloud', c.id);
      // 引线的降级在这里就地应用；轮廓 / 盒边 / 小针的颜色与虚线由 updateOverlayPositions 的 paint 阶段按 cloud.degrade 统一刷
      applyLeaderDegrade(visual.leader, buildAnnotationLeaderStyle('cloud').color, degrade);
      // pin / outline / bboxEdges 始终加入；leader（图钉 → 文字框引线）随 collapsed 控制，
      // 与文字批注的「双击图钉收起文字框 / 引线，保留图钉」行为对齐。
      ctx.toolsGroup.add(visual.pin, visual.outline, visual.bboxEdges);
      if (shouldRenderTextAnnotationCard(c.collapsed)) {
        ctx.toolsGroup.add(visual.leader.root);
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
      ctx.overlays.cloudShapes.set(cloudEntry.id, cloudEntry);

      // 云线的图钉只换灰虚线、不挂徽标——徽标挂在轮廓参考框左上角，一条记录一枚
      const cloudMarker = makeTextAnnotationMarkerEl(overlay, 'C', c.collapsed === true, { degrade, badge: false });
      ctx.overlays.markers.set(`cloud:${c.id}`, {
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
        ctx.store.setCloudAnnotationsCollapsed([c.id], toggleTextAnnotationCollapsed(c.collapsed));
        annotation.activateAnnotation('cloud', c.id);
      });
      // P4 LOD「悬停临时展示」：图钉上悬停即固定高档（补回轮廓 + 文字框），移开后按预算回落
      cloudMarker.addEventListener('pointerenter', () => lod.setHoveredCloudAnnotation(c.id));
      cloudMarker.addEventListener('pointerleave', () => {
        if (ctx.cloudLod.hoveredId === c.id) lod.setHoveredCloudAnnotation(null);
      });

      if (shouldRenderTextAnnotationCard(c.collapsed) && !deferCloudLabels) {
        mountCloudLabel(cloudEntry);
      }
    }
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
      ? ctx.compatViewerRef.value?.scene.getAABB(refnos) ?? null
      : null;
    cloud.targetBbox = live
      ? { min: [live[0], live[1], live[2]], max: [live[3], live[4], live[5]] }
      : cloud.record.selectionBbox ?? null;
    cloud.targetBboxAt = now;
    return cloud.targetBbox;
  }

  /**
   * 每帧：帧级版本戳 → P4 LOD 计划 → inspection 模式 → 逐云线分阶段渲染（切档 / shape / layout / paint / 待探标记）。
   * 原 updateOverlayPositions 的云线段；回传 LOD 是否重算与本帧检视模式，调用方据此做图钉聚合与探测排程。
   */
  function renderFrame(viewer: DtxViewer, overlay: HTMLElement, canvas: HTMLCanvasElement, resolution: { width: number; height: number }): { lodReplanned: boolean; inspectionMode: CloudInspectionMode } {
    // ---- 帧级版本戳（方案 §9.1，开关 cloudDirtyCache）：所有云线共用，一帧算一次 ----
    const dirtyCacheOn = isCloudRenderFlagEnabled('cloudDirtyCache');
    const labelFlagOn = isCloudRenderFlagEnabled('cloudLabelLayoutV1');
    const envelopeOn = isCloudRenderFlagEnabled('cloudProjectedEnvelope');
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const drawMode = ctx.annotationStyleStore.cloudDrawMode.value;
    const cloudStyle = ctx.annotationStyleStore.style.cloud;
    const frameStamp = {
      cameraWorld: ctx.cloudFrameTrackers.cameraWorld.update(viewer.camera.matrixWorld.elements),
      projection: ctx.cloudFrameTrackers.projection.update(viewer.camera.projectionMatrix.elements),
      viewportCss: ctx.cloudFrameTrackers.viewportCss.update([canvasRect.width, canvasRect.height]),
      overlayTransform: ctx.cloudFrameTrackers.overlayTransform.update([
        canvasRect.left - overlayRect.left,
        canvasRect.top - overlayRect.top,
        overlayRect.width,
        overlayRect.height,
      ]),
      dpr: ctx.cloudFrameTrackers.dpr.update([resolution.width, resolution.height]),
      globalModelMatrix: ctx.cloudFrameTrackers.globalModelMatrix.update(
        ctx.dtxLayerRef.value?.getGlobalModelMatrix().elements ?? IDENTITY_MATRIX_ELEMENTS,
      ),
      modelEpoch: dtxLoaderRevision.value,
      shapeStyle: ctx.cloudFrameTrackers.shapeStyle.update(`${drawMode}|${CLOUD_FIT_PADDING_PX}|${envelopeOn ? 1 : 0}|${cloudStyle.lineWidth}`),
      paintStyle: ctx.cloudFrameTrackers.paintStyle.update(`${cloudStyle.color}|${cloudStyle.opacity}|${cloudStyle.lineWidth}`),
    };
    const viewportRect = { x: 0, y: 0, width: overlayRect.width || canvasRect.width, height: overlayRect.height || canvasRect.height };
    ctx.cloudRenderStats.frames += 1;

    // ---- P4 LOD（方案 §9.3）：超预算时先定本帧谁算全轮廓、谁只留图钉；相机 / 视口 / 集合 / 交互态没变就复用上次计划 ----
    const lodReplanned = lod.planCloudLodForFrame(viewer.camera, `${frameStamp.cameraWorld}|${frameStamp.projection}|${frameStamp.viewportCss}`);
    // ---- P4 inspection（方案 §10）：本帧的显示模式，一帧读一次 ----
    const inspectionMode = inspection.currentCloudInspectionMode();
    ctx.cloudLod.inspectionPending = false;

    for (const cloud of ctx.overlays.cloudShapes.values()) {
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
          const current = ctx.dtxLayerRef.value?.getGlobalModelMatrix() ?? null;
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
      const labelEntry = ctx.overlays.labels.get(cloud.id);
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
        if (cloud.render.inspectionKey !== inspection.cloudInspectionKey(cloud, frameStamp)) ctx.cloudLod.inspectionPending = true;
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
        ctx.cloudRenderStats.paintUpdates += 1;
      }

      if (dirty.shape && regionCells) {
        // ---- P2 范围体管线（方案 §3.3）：齐次裁剪 → 屏幕凸包 → 圆角外扩 → 单侧余弦波纹 → billboard ----
        ctx.cloudRenderStats.contourBuilds += 1;
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
          active: ctx.store.activeCloudAnnotationId.value === cloud.record.id,
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
          ctx.cloudRenderStats.setPoints += 1;
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
            ctx.toolsGroup.add(extra);
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
            ctx.cloudRenderStats.setPoints += 1;
          }
        }
      } else if (dirty.shape) {
        ctx.cloudRenderStats.contourBuilds += 1;
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
          ctx.cloudRenderStats.setPoints += 1;
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
          ctx.cloudRenderStats.setPoints += 1;
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
            ctx.cloudRenderStats.labelLayouts += 1;

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
    return { lodReplanned, inspectionMode };
  }

  /** ADR-0050：云线记 degrade、换引线、增删徽标（轮廓 / 盒边 / 小针交给下一帧 paint）；回传是否有变化。原 applyBindingDegrade 的云线段。 */
  function applyDegrades(degrades: ReadonlyMap<string, AnnotationDegrade>, overlay: HTMLElement | null): boolean {
    let changed = false;
    for (const cloud of ctx.overlays.cloudShapes.values()) {
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
    return changed;
  }

  return { mountCloudLabel, unmountCloudLabel, syncCloudAnnotations, resolveCloudTargetBbox, renderFrame, applyDegrades };
}
