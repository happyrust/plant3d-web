import { Vector3 } from 'three';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';
import type { Camera, Matrix4 } from 'three';

import { getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { getDtxRefnoTransform } from '@/composables/useDbnoInstancesDtxLoader';
import {
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

  function resolveWorldTransform(refno: string): unknown {
    try {
      const dbno = getDbnumByRefno(refno);
      const t = getDtxRefnoTransform(dbno, refno);
      if (t) return t;
    } catch {
      /* db meta 未加载或未命中：回退到 response.world_transform */
    }
    return null;
  }

  /** 写入/更新某构件的候选缓存，返回换算后的候选。 */
  function upsertCandidates(refno: string, response: PtsetResponse): PtsetSceneCandidate[] {
    const key = normalizeRefno(refno);
    const worldTransform = resolveWorldTransform(key) ?? response.world_transform;
    const gm = options.getGlobalModelMatrix?.() ?? null;
    const candidates = ptsetResponseToSceneCandidates(key, response, worldTransform, gm);
    cache.set(key, candidates);
    return candidates;
  }

  function hasCandidates(refno: string): boolean {
    return cache.has(normalizeRefno(refno));
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
  }

  function remove(refno: string): void {
    cache.delete(normalizeRefno(refno));
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
    remove,
    clear,
    snap,
  };
}

export type UsePtsetSnapReturn = ReturnType<typeof usePtsetSnap>;
