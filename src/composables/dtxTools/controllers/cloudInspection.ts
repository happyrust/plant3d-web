/**
 * P4 inspection（方案 §10）：遮挡淡化——相机停下后给 full 档、非强调、非失效的云线打射线，按命中 / 遮挡结果算淡化因子；
 * 检视模式跟尺寸面板同一口径（URL mbd_mode），测试 / 外部可覆盖。帧间状态在 ctx.cloudLod 的 inspection* 字段（所有者是本控制器）。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 7 步），实现未改；重排经 hooks.updateOverlayPositions，目标包围盒回退经 hooks.resolveCloudTargetBbox。
 */
import { MeshLineMaterial } from '@lume/three-meshline';
import { Vector3 } from 'three';

import { type CloudInspectionDebugSnapshot, type CloudOverlayEl, resolveRegionObjectIdsForRefno } from '../cloudRegion';

import type { DtxToolsContext } from '../context';

import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { dtxLoaderRevision } from '@/composables/useDbnoInstancesDtxLoader';
import { type Vec3, getCloudMemberRefnos } from '@/composables/useToolStore';
import { SOLVESPACE_DIMENSION_THEME, isWorldSegmentBlocked } from '@/dimension';
import { type CloudInspectionMode, type OcclusionProbe, chooseInspectionProbeMembers, inspectionFactor, inspectionModeFromSearch } from '@/review/domain/annotationProjection/inspection';
import { worldPerPixelAt } from '@/utils/three/annotation/utils/solvespaceLike';

export type CloudInspectionHooks = {
  updateOverlayPositions: () => void;
  resolveCloudTargetBbox: (cloud: CloudOverlayEl) => { min: Vec3; max: Vec3 } | null;
};

export function createCloudInspection(ctx: DtxToolsContext, hooks: CloudInspectionHooks) {
  const CLOUD_INSPECTION_SETTLE_MS = 120;
  const CLOUD_INSPECTION_MAX_PROBES = 3;
  const inspectionScratch = { origin: new Vector3(), point: new Vector3(), direction: new Vector3(), hit: new Vector3() };

  // ---------------- P4 inspection：遮挡淡化（方案 §10） ----------------

  /** 当前模式：开关关 → 置顶；否则测试 / 外部覆盖优先，再看 URL `mbd_mode`（与尺寸面板同一口径，按 search 字串缓存） */
  function currentCloudInspectionMode(): CloudInspectionMode {
    if (!isCloudRenderFlagEnabled('cloudInspectionFade')) return 'always-on-top';
    if (ctx.cloudLod.inspectionModeOverride) return ctx.cloudLod.inspectionModeOverride;
    const search = typeof window !== 'undefined' ? (window.location?.search ?? '') : '';
    if (search !== ctx.cloudLod.inspectionSearchCache.search) {
      ctx.cloudLod.inspectionSearchCache = { search, mode: inspectionModeFromSearch(search) };
    }
    return ctx.cloudLod.inspectionSearchCache.mode;
  }

  /** 覆盖检视模式（null = 跟随 URL）；立刻重排一帧让因子回位 / 触发探测 */
  function setCloudInspectionMode(mode: CloudInspectionMode | null): void {
    if (ctx.cloudLod.inspectionModeOverride === mode) return;
    ctx.cloudLod.inspectionModeOverride = mode;
    hooks.updateOverlayPositions();
    ctx.requestRender?.();
  }

  /** 强调 = 激活 / 悬停 / 拖动中 / 待编辑：inspection 不淡它，LOD 也固定高档 */
  function isCloudEmphasized(cloud: CloudOverlayEl): boolean {
    const id = cloud.record.id;
    const drag = ctx.inlineOverlayAnnotationDrag.value;
    return ctx.store.activeCloudAnnotationId.value === id
      || ctx.cloudLod.hoveredId === id
      || (drag.annotationKind === 'cloud' && drag.annotationId === id)
      || ctx.store.pendingCloudAnnotationEditId.value === id
      || cloud.render.labelDragTopLeft !== null;
  }

  /**
   * 探一条云线：≤ 3 个代表性成员，每个先从相机向它的放置盒中心打射线、要**命中成员自己的表面**（否则 `unknown`），
   * 再问 ADR-0061 的缝：相机 → 命中点之间有没有别的可见几何（成员 refno 作 `subject`，排除它自己的各片）。
   * 容差 = max(尺寸系统 toleranceMm × 全局矩阵缩放, tolerancePx × 命中点处每像素世界长度)。
   */
  function probeCloudOcclusion(cloud: CloudOverlayEl, camera: any, canvas: HTMLCanvasElement): OcclusionProbe[] {
    const layer = ctx.dtxLayerRef.value;
    if (!layer) return [];
    const members = getCloudMemberRefnos(cloud.record);
    let fallback: readonly [number, number, number] | null = null;
    if (!cloud.render.regionCells) {
      const sb = hooks.resolveCloudTargetBbox(cloud);
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
        ctx.cloudRenderStats.inspectionRays += 1;
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
      ctx.cloudRenderStats.inspectionRays += 1;
      out.push(isWorldSegmentBlocked(layer, origin, hitPoint, tolerance, { subject: sample.refno }) ? 'blocked' : 'clear');
    }
    return out;
  }

  function cloudInspectionKey(cloud: CloudOverlayEl, frame: { cameraWorld: number; modelEpoch: number; globalModelMatrix: number }): string {
    return `${frame.cameraWorld}|${frame.modelEpoch}|${frame.globalModelMatrix}|${cloud.render.recordTracker.version}`;
  }

  /** 相机停下之后跑：给所有该探而没探过（key 变了）的 full 档云线打射线；因子变了就请一帧，paint 阶段按新因子刷材质 */
  function runCloudInspection(): void {
    if (ctx.cloudLod.inspectionTimer !== null) {
      clearTimeout(ctx.cloudLod.inspectionTimer);
      ctx.cloudLod.inspectionTimer = null;
    }
    ctx.cloudLod.inspectionPending = false;
    const viewer = ctx.dtxViewerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !canvas || currentCloudInspectionMode() !== 'inspection') return;
    const frame = {
      cameraWorld: ctx.cloudFrameTrackers.cameraWorld.version,
      modelEpoch: dtxLoaderRevision.value,
      globalModelMatrix: ctx.cloudFrameTrackers.globalModelMatrix.version,
    };
    const occludedAlpha = SOLVESPACE_DIMENSION_THEME.inspection.occludedAlpha;
    let changed = false;
    for (const cloud of ctx.overlays.cloudShapes.values()) {
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
    if (changed) ctx.requestRender?.();
  }

  function scheduleCloudInspection(): void {
    if (ctx.cloudLod.inspectionTimer !== null) clearTimeout(ctx.cloudLod.inspectionTimer);
    ctx.cloudLod.inspectionTimer = setTimeout(runCloudInspection, CLOUD_INSPECTION_SETTLE_MS);
  }

  /** 测试 / 调试：不等相机停下，立刻探一遍并把因子刷进材质（先跑一帧让版本戳对上当前相机） */
  function runCloudInspectionNow(): void {
    hooks.updateOverlayPositions();
    runCloudInspection();
    hooks.updateOverlayPositions();
  }

  /** e2e / 单测：inspection 当前模式、是否有待探、每条云线的因子 / 样本 / 探测键 */
  function debugCloudInspection(): CloudInspectionDebugSnapshot {
    const items: CloudInspectionDebugSnapshot['items'] = [];
    for (const [id, cloud] of ctx.overlays.cloudShapes.entries()) {
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
      pending: ctx.cloudLod.inspectionPending || ctx.cloudLod.inspectionTimer !== null,
      occludedAlpha: SOLVESPACE_DIMENSION_THEME.inspection.occludedAlpha,
      items,
    };
  }

  return {
    cloudInspectionKey,
    currentCloudInspectionMode,
    debugCloudInspection,
    isCloudEmphasized,
    runCloudInspectionNow,
    scheduleCloudInspection,
    setCloudInspectionMode,
  };
}
