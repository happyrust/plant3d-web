import { Matrix4, Vector3 } from 'three';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';

export type Vec3 = [number, number, number];

/**
 * 场景坐标系下的关键点候选（已应用 world_transform + globalModelMatrix，
 * 与测量 `selection.pickPoint` 命中点同坐标系，可直接用于吸附比较）。
 */
export type PtsetSceneCandidate = {
  refno: string;
  /** ptset 点编号 */
  number: number;
  /** 场景坐标 [x, y, z] */
  worldPos: Vec3;
  /** 管道外径（透传，用于显示/优先级判断） */
  pbore: number;
};

/**
 * 把局部坐标点应用 world_transform。
 *
 * 与 `usePtsetVisualizationThree` 中的同名逻辑保持一致：
 * - 长度 16 → 列主序 4x4；
 * - number[][] (>=3) → 行主序 3x4 / 4x4；
 * - 其它 → 原样返回。
 */
export function applyPtsetTransformToPoint(worldTransform: unknown, localPt: Vec3): Vec3 {
  const px = localPt[0];
  const py = localPt[1];
  const pz = localPt[2];

  if (Array.isArray(worldTransform) && worldTransform.length === 16) {
    const m = worldTransform as number[];
    return [
      (m[0] ?? 1) * px + (m[4] ?? 0) * py + (m[8] ?? 0) * pz + (m[12] ?? 0),
      (m[1] ?? 0) * px + (m[5] ?? 1) * py + (m[9] ?? 0) * pz + (m[13] ?? 0),
      (m[2] ?? 0) * px + (m[6] ?? 0) * py + (m[10] ?? 1) * pz + (m[14] ?? 0),
    ];
  }

  if (Array.isArray(worldTransform) && worldTransform.length >= 3 && Array.isArray((worldTransform as unknown[])[0])) {
    const m = worldTransform as unknown as number[][];
    const m0 = m[0] ?? [1, 0, 0, 0];
    const m1 = m[1] ?? [0, 1, 0, 0];
    const m2 = m[2] ?? [0, 0, 1, 0];
    return [
      (m0[0] ?? 1) * px + (m0[1] ?? 0) * py + (m0[2] ?? 0) * pz + (m0[3] ?? 0),
      (m1[0] ?? 0) * px + (m1[1] ?? 1) * py + (m1[2] ?? 0) * pz + (m1[3] ?? 0),
      (m2[0] ?? 0) * px + (m2[1] ?? 0) * py + (m2[2] ?? 1) * pz + (m2[3] ?? 0),
    ];
  }

  return localPt;
}

export function applyPtsetTransformToDir(worldTransform: unknown, localDir: Vec3): Vec3 {
  const dx = localDir[0];
  const dy = localDir[1];
  const dz = localDir[2];

  if (Array.isArray(worldTransform) && worldTransform.length === 16) {
    const m = worldTransform as number[];
    return [
      (m[0] ?? 1) * dx + (m[4] ?? 0) * dy + (m[8] ?? 0) * dz,
      (m[1] ?? 0) * dx + (m[5] ?? 1) * dy + (m[9] ?? 0) * dz,
      (m[2] ?? 0) * dx + (m[6] ?? 0) * dy + (m[10] ?? 1) * dz,
    ];
  }

  if (Array.isArray(worldTransform) && worldTransform.length >= 3 && Array.isArray((worldTransform as unknown[])[0])) {
    const m = worldTransform as unknown as number[][];
    const m0 = m[0] ?? [1, 0, 0, 0];
    const m1 = m[1] ?? [0, 1, 0, 0];
    const m2 = m[2] ?? [0, 0, 1, 0];
    return [
      (m0[0] ?? 1) * dx + (m0[1] ?? 0) * dy + (m0[2] ?? 0) * dz,
      (m1[0] ?? 0) * dx + (m1[1] ?? 1) * dy + (m1[2] ?? 0) * dz,
      (m2[0] ?? 0) * dx + (m2[1] ?? 0) * dy + (m2[2] ?? 1) * dz,
    ];
  }

  return localDir;
}

/**
 * 把一个 ptset 响应换算为场景坐标系的关键点候选集。
 *
 * 换算链与 `usePtsetVisualizationThree.appendEntry` 完全一致：
 * `pt(局部) * unitFactor → applyPtsetTransformToPoint(worldTransform) → applyMatrix4(globalModelMatrix)`，
 * 保证吸附候选与场景中渲染的关键点十字位置一致。
 *
 * @param worldTransform 该构件的 world_transform（优先用 per-refno transform，回退 response.world_transform）
 * @param globalModelMatrix DTX 图层的全局矩阵（mm→m + recenter）；为 null 时不做全局变换
 */
export function ptsetResponseToSceneCandidates(
  refno: string,
  response: PtsetResponse,
  worldTransform: unknown,
  globalModelMatrix: Matrix4 | null,
): PtsetSceneCandidate[] {
  if (!response?.success || !Array.isArray(response.ptset)) return [];
  const unitFactor = response.unit_info?.conversion_factor || 1;
  const out: PtsetSceneCandidate[] = [];

  for (const point of response.ptset) {
    if (!point?.pt) continue;
    const localPt: Vec3 = [
      point.pt[0] * unitFactor,
      point.pt[1] * unitFactor,
      point.pt[2] * unitFactor,
    ];
    const worldPt = applyPtsetTransformToPoint(worldTransform, localPt);

    let scenePos: Vec3 = worldPt;
    if (globalModelMatrix) {
      const v = new Vector3(worldPt[0], worldPt[1], worldPt[2]).applyMatrix4(globalModelMatrix);
      scenePos = [v.x, v.y, v.z];
    }

    out.push({
      refno,
      number: point.number,
      worldPos: scenePos,
      pbore: point.pbore,
    });
  }

  return out;
}
