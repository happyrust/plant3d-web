/**
 * 表面拾点：光标下最近的表面命中（refno + 世界点 + objectId）与射线上的全部命中（候选轮换用）。无状态，只读 ctx.selectionRef。
 * 从 useDtxTools.ts 搬出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 9 步），实现未改；cloudCreationFlow / pickCandidate / measure / pointerDispatcher 都经它拾点。
 */
import { Vector3 } from 'three';

import { getCanvasPos, parseRefnoFromDtxObjectId } from '../geometry';

import type { DtxToolsContext } from '../context';
import type { PickRefnoRayHit } from '../pickCandidates';

export function createSurfacePicker(ctx: DtxToolsContext) {
  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const sel = ctx.selectionRef.value;
    if (!sel) return null;
    const pos = getCanvasPos(canvas, e);
    const hit = sel.pickPoint(pos);
    if (!hit) return null;
    const refno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId;
    return { entityId: refno, worldPos: hit.point.clone(), objectId: hit.objectId };
  }

  /** 光标射线上的全部命中（含被遮挡的），由近到远，供候选轮换使用。 */
  function pickSurfaceRayHits(canvas: HTMLCanvasElement, e: PointerEvent): PickRefnoRayHit[] {
    const sel = ctx.selectionRef.value;
    if (typeof sel?.pickPoints !== 'function') return [];
    return sel.pickPoints(getCanvasPos(canvas, e)).map((hit) => ({
      entityId: parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId,
      objectId: hit.objectId,
      distance: hit.distance,
    }));
  }

  return { pickSurfacePoint, pickSurfaceRayHits };
}
