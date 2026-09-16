import { Vector3 } from 'three';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';
import type { Camera, Matrix4 } from 'three';

import { getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { getDtxRefnoTransform } from '@/composables/useDbnoInstancesDtxLoader';
import {
  pickPtsetWorldTransform,
  ptsetElementOriginToScene,
  ptsetResponseToSceneCandidates,
  type PtsetSceneCandidate,
  type Vec3,
} from '@/utils/three/ptsetTransform';

/** 默认吸附像素阈值（与缩放无关，体验稳定）。 */
export const DEFAULT_PTSET_SNAP_PX = 12;

export type PtsetSnapHit = {
  refno: string;
  number: number;
  /** 吸附目标关键点的场景坐标 */
  worldPos: Vec3;
  /** 命中时光标与该点的屏幕像素距离 */
  pixelDistance: number;
};

export type CanvasRectLike = { width: number; height: number };
export type CanvasPosLike = { x: number; y: number };

export type UsePtsetSnapOptions = {
  /** 与 DTXLayer.getGlobalModelMatrix 对齐（mm→m + recenter）。 */
  getGlobalModelMatrix?: (() => Matrix4 | null) | null;
};

function normalizeRefno(refno: string): string {
  return String(refno ?? '').trim().replace('/', '_');
}

/**
 * 把场景坐标点投影到画布像素坐标（投影公式与 usePtsetVisualizationThree.updateLabelPositions 一致）。
 */
export function projectToCanvas(
  worldPos: Vec3,
  camera: Camera,
  rect: CanvasRectLike,
): { x: number; y: number; visible: boolean } {
  const v = new Vector3(worldPos[0], worldPos[1], worldPos[2]);
  v.project(camera);
  const visible = v.z >= -1 && v.z <= 1;
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  return { x, y, visible };
}

/**
 * 在候选关键点中找出与光标屏幕像素距离最近且不超过阈值者。纯函数，便于单测。
 */
export function snapToCandidates(
  cursor: CanvasPosLike,
  camera: Camera,
  rect: CanvasRectLike,
  candidates: readonly PtsetSceneCandidate[],
  pxThreshold: number = DEFAULT_PTSET_SNAP_PX,
): PtsetSnapHit | null {
  let best: PtsetSnapHit | null = null;
  for (const c of candidates) {
    const p = projectToCanvas(c.worldPos, camera, rect);
    if (!p.visible) continue;
    const dx = p.x - cursor.x;
    const dy = p.y - cursor.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= pxThreshold && (best === null || dist < best.pixelDistance)) {
      best = { refno: c.refno, number: c.number, worldPos: c.worldPos, pixelDistance: dist };
    }
  }
  return best;
}

/**
 * 关键点吸附引擎：按 refno 缓存场景系关键点候选，并对光标做屏幕像素吸附。
 *
 * 设计要点：
 * - `snap()` 同步返回，只使用“已缓存”候选 —— 异步取数由调用方（测量 hover）负责填充缓存；
 * - 候选坐标换算与 `usePtsetVisualizationThree` 完全一致，保证与渲染的关键点十字对齐。
 */
export function usePtsetSnap(options: UsePtsetSnapOptions = {}) {
  const cache = new Map<string, PtsetSceneCandidate[]>();
  /** 构件原点（E3D `POS`）的场景坐标，与同一构件的候选同一换算链；矩阵不可用的构件没有条目。 */
  const origins = new Map<string, Vec3>();

  /** DTX 登记的 per-refno 放置矩阵（float32 网格数据）；db meta 未加载或未命中时为 null。 */
  function resolveDtxTransform(refno: string): unknown {
    try {
      const dbno = getDbnumByRefno(refno);
      const t = getDtxRefnoTransform(dbno, refno);
      if (t) return t;
    } catch {
      /* db meta 未加载或未命中 */
    }
    return null;
  }

  /**
   * 写入/更新某构件的候选缓存，返回换算后的候选。放置矩阵优先点集接口自己的 `world_transform`（float64），
   * 接口没给才回落 DTX 矩阵（`pickPtsetWorldTransform`，2026-09-16 起）。
   */
  function upsertCandidates(refno: string, response: PtsetResponse): PtsetSceneCandidate[] {
    const key = normalizeRefno(refno);
    const worldTransform = pickPtsetWorldTransform(response.world_transform, resolveDtxTransform(key));
    const gm = options.getGlobalModelMatrix?.() ?? null;
    const candidates = ptsetResponseToSceneCandidates(key, response, worldTransform, gm);
    cache.set(key, candidates);
    const origin = ptsetElementOriginToScene(worldTransform, gm);
    if (origin) origins.set(key, origin);
    else origins.delete(key);
    return candidates;
  }

  function hasCandidates(refno: string): boolean {
    return cache.has(normalizeRefno(refno));
  }

  /**
   * 构件原点（E3D `POS`）的场景坐标；未拉过点集、或点集没带可用放置矩阵时为 null。
   * ELBO / BEND 的中心线弧（`arc()` = fillet(P1, POS, P2)）用它当两条切线的角点。
   */
  function getOrigin(refno: string): Vec3 | null {
    return origins.get(normalizeRefno(refno)) ?? null;
  }

  /** 取指定 refno 集合的候选；不传则返回全部缓存候选。 */
  function getCandidates(refnos?: readonly string[]): PtsetSceneCandidate[] {
    if (!refnos) {
      const all: PtsetSceneCandidate[] = [];
      for (const list of cache.values()) all.push(...list);
      return all;
    }
    const out: PtsetSceneCandidate[] = [];
    for (const r of refnos) {
      const list = cache.get(normalizeRefno(r));
      if (list) out.push(...list);
    }
    return out;
  }

  function clear(): void {
    cache.clear();
    origins.clear();
  }

  function remove(refno: string): void {
    const key = normalizeRefno(refno);
    cache.delete(key);
    origins.delete(key);
  }

  /**
   * 对光标做吸附。`refnos` 限定候选范围（建议传当前/邻域构件）；不传则用全部缓存。
   */
  function snap(
    cursor: CanvasPosLike,
    camera: Camera,
    rect: CanvasRectLike,
    refnos?: readonly string[],
    pxThreshold: number = DEFAULT_PTSET_SNAP_PX,
  ): PtsetSnapHit | null {
    const candidates = getCandidates(refnos);
    if (candidates.length === 0) return null;
    return snapToCandidates(cursor, camera, rect, candidates, pxThreshold);
  }

  return {
    cache,
    upsertCandidates,
    hasCandidates,
    getCandidates,
    getOrigin,
    remove,
    clear,
    snap,
  };
}

export type UsePtsetSnapReturn = ReturnType<typeof usePtsetSnap>;
