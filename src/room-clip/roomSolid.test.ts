import { describe, expect, it } from 'vitest';

import { Matrix4, Vector3 } from 'three';

import { panelTriMesh, pointInsidePanel, transformPointMm } from './predicate';
import {
  buildCapMatrix,
  buildPieceMatrix,
  collectInternalCutPoints,
  detectPrism,
  planTubeClip,
} from './prism';
import { RoomSolid } from './roomSolid';

/** 构造轴对齐长方体面板 `[x0, x1] × [y0, y1] × [z0, z1]`（毫米）的闭合三角网。 */
function makeBoxPanel(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) {
  const positions = new Float32Array([
    x0, y0, z0,
    x1, y0, z0,
    x1, y1, z0,
    x0, y1, z0,
    x0, y0, z1,
    x1, y0, z1,
    x1, y1, z1,
    x0, y1, z1,
  ]);
  const indices = new Uint32Array([
    // bottom
    0, 2, 1, 0, 3, 2,
    // top
    4, 5, 6, 4, 6, 7,
    // front
    0, 1, 5, 0, 5, 4,
    // back
    3, 6, 2, 3, 7, 6,
    // left
    0, 4, 7, 0, 7, 3,
    // right
    1, 2, 6, 1, 6, 5,
  ]);
  const mesh = panelTriMesh(positions, indices, new Matrix4().elements);
  if (!mesh) throw new Error('Failed to build box panel TriMesh');
  return mesh;
}

describe('room-clip pure geometry (predicate + RoomSolid + prism)', () => {
  it('detects point inside and outside a closed room panel via 3-ray parity vote', () => {
    const panel = makeBoxPanel(0, 0, 0, 1000, 1000, 1000);
    expect(pointInsidePanel(panel, [500, 500, 500])).toBe(true);
    expect(pointInsidePanel(panel, [-10, 500, 500])).toBe(false);
    expect(pointInsidePanel(panel, [1500, 500, 500])).toBe(false);
  });

  it('clips a tube crossing a single wall to the inside half', () => {
    const solid = RoomSolid.fromPanels([makeBoxPanel(0, 0, 0, 1000, 1000, 1000)])!;
    const intervals = solid.insideIntervals([-500, 500, 500], [500, 500, 500]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]![0]).toBeCloseTo(0.5, 4);
    expect(intervals[0]![1]).toBeCloseTo(1.0, 4);
  });

  it('clips a tube passing completely through a room to the middle interval', () => {
    const solid = RoomSolid.fromPanels([makeBoxPanel(0, 0, 0, 1000, 1000, 1000)])!;
    const intervals = solid.insideIntervals([-500, 500, 500], [1500, 500, 500]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]![0]).toBeCloseTo(0.25, 4);
    expect(intervals[0]![1]).toBeCloseTo(0.75, 4);
    expect(collectInternalCutPoints(intervals)).toHaveLength(2);
  });

  it('returns [[0, 1]] when wholly inside and [] when wholly outside', () => {
    const solid = RoomSolid.fromPanels([makeBoxPanel(0, 0, 0, 1000, 1000, 1000)])!;
    expect(solid.insideIntervals([100, 500, 500], [900, 500, 500])).toEqual([[0, 1]]);
    expect(solid.insideIntervals([-800, 500, 500], [-200, 500, 500])).toEqual([]);
  });

  it('merges adjacent panels sharing a coplanar wall without leaving a false cut seam', () => {
    const left = makeBoxPanel(0, 0, 0, 1000, 1000, 1000);
    const right = makeBoxPanel(1000, 0, 0, 2000, 1000, 1000);
    const solid = RoomSolid.fromPanels([left, right])!;
    const intervals = solid.insideIntervals([200, 500, 500], [1800, 500, 500]);
    expect(intervals).toEqual([[0, 1]]);
    expect(collectInternalCutPoints(intervals)).toEqual([]);
  });

  it('returns two intervals when a tube exits and re-enters an L-shaped room', () => {
    const wingA = makeBoxPanel(0, 0, 0, 400, 1000, 1000);
    const wingB = makeBoxPanel(600, 0, 0, 1000, 1000, 1000);
    const solid = RoomSolid.fromPanels([wingA, wingB])!;
    const intervals = solid.insideIntervals([100, 500, 500], [900, 500, 500]);
    expect(intervals).toHaveLength(2);
    expect(intervals[0]![0]).toBeCloseTo(0.0, 4);
    expect(intervals[0]![1]).toBeCloseTo(300 / 800, 4);
    expect(intervals[1]![0]).toBeCloseTo(500 / 800, 4);
    expect(intervals[1]![1]).toBeCloseTo(1.0, 4);
  });

  it('snaps endpoints within 1 mm of a wall to 0 or 1 to avoid sub-millimeter slivers', () => {
    const solid = RoomSolid.fromPanels([makeBoxPanel(0, 0, 0, 1000, 1000, 1000)])!;
    const intervals = solid.insideIntervals([-0.4, 500, 500], [800, 500, 500]);
    expect(intervals).toEqual([[0, 1]]);
  });

  it('remaps both [0, 1] cylinder prisms and [-0.5, 0.5] centered box prisms accurately', () => {
    // 1. z ∈ [0, 1] 圆柱端盖
    const cylPositions = new Float32Array([
      -50, 0, 0, 50, 0, 0, 0, 50, 0, 0, -50, 0,
      -50, 0, 1, 50, 0, 1, 0, 50, 1, 0, -50, 1,
    ]);
    const cylPrism = detectPrism(cylPositions);
    expect(cylPrism).toEqual({ cx: 0, cy: 0, z0: 0, z1: 1 });

    const baseMatrix = new Matrix4().makeTranslation(100, 200, 300).scale(new Vector3(1, 1, 2000));
    const pieceMat = buildPieceMatrix(baseMatrix, cylPrism!, [0.25, 0.75]);
    const startMm = transformPointMm(pieceMat.elements, 0, 0, 0);
    const endMm = transformPointMm(pieceMat.elements, 0, 0, 1);
    expect(startMm).toEqual([100, 200, 800]);
    expect(endMm).toEqual([100, 200, 1800]);

    // 2. z ∈ [-0.5, 0.5] 中心对称矩形风管
    const boxPositions = new Float32Array([
      -100, -50, -0.5, 100, -50, -0.5, 100, 50, -0.5, -100, 50, -0.5,
      -100, -50, 0.5, 100, -50, 0.5, 100, 50, 0.5, -100, 50, 0.5,
    ]);
    const boxPrism = detectPrism(boxPositions);
    expect(boxPrism).toEqual({ cx: 0, cy: 0, z0: -0.5, z1: 0.5 });

    const centeredMatrix = new Matrix4().makeTranslation(0, 0, 500).scale(new Vector3(1, 1, 1000));
    const boxPieceMat = buildPieceMatrix(centeredMatrix, boxPrism!, [0.2, 0.8]);
    const boxStart = transformPointMm(boxPieceMat.elements, 0, 0, -0.5);
    const boxEnd = transformPointMm(boxPieceMat.elements, 0, 0, 0.5);
    expect(boxStart[2]).toBeCloseTo(200, 4);
    expect(boxEnd[2]).toBeCloseTo(800, 4);

    // 3. 断口薄饼在 t = 0.25 处居中，厚度 2 mm
    const capMat = buildCapMatrix(baseMatrix, cylPrism!, 2000, 0.25);
    const capLow = transformPointMm(capMat.elements, 0, 0, 0);
    const capHigh = transformPointMm(capMat.elements, 0, 0, 1);
    expect(0.5 * (capLow[2] + capHigh[2])).toBeCloseTo(800, 4);
    expect(capHigh[2] - capLow[2]).toBeCloseTo(2.0, 4);
  });

  it('plans whole / hidden / cut / skipped correctly via planTubeClip', () => {
    const solid = RoomSolid.fromPanels([makeBoxPanel(0, 0, 0, 1000, 1000, 1000)])!;
    const prism = { cx: 0, cy: 0, z0: 0, z1: 1 };

    const cutMat = new Matrix4().makeTranslation(500, 500, -500).scale(new Vector3(1, 1, 2000));
    const cutPlan = planTubeClip(solid, cutMat, prism);
    expect(cutPlan.kind).toBe('cut');

    const wholeMat = new Matrix4().makeTranslation(500, 500, 100).scale(new Vector3(1, 1, 800));
    expect(planTubeClip(solid, wholeMat, prism).kind).toBe('whole');

    const hiddenMat = new Matrix4().makeTranslation(500, 500, 1500).scale(new Vector3(1, 1, 500));
    expect(planTubeClip(solid, hiddenMat, prism).kind).toBe('hidden');
  });
});