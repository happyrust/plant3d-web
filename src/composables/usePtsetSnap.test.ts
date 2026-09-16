import { describe, it, expect } from 'vitest';

import { Matrix4, PerspectiveCamera } from 'three';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';

import { projectToCanvas, snapToCandidates } from '@/composables/usePtsetSnap';
import {
  applyPtsetTransformToPoint,
  isUsablePtsetWorldTransform,
  pickPtsetWorldTransform,
  ptsetResponseToSceneCandidates,
} from '@/utils/three/ptsetTransform';

function makeResponse(points: { number: number; pt: [number, number, number]; pbore?: number }[], conversion = 1): PtsetResponse {
  return {
    success: true,
    refno: '1_1',
    ptset: points.map((p) => ({
      number: p.number,
      pt: p.pt,
      dir: null,
      dir_flag: 0,
      ref_dir: null,
      pbore: p.pbore ?? 0,
      pwidth: 0,
      pheight: 0,
      pconnect: '',
    })),
    world_transform: null,
    unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: conversion },
  };
}

function centeredCamera(): PerspectiveCamera {
  // 相机在 +Z 看向原点，aspect=1；原点投影到画布中心。
  const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true); // Camera.updateMatrixWorld 同步 matrixWorldInverse
  cam.updateProjectionMatrix();
  return cam;
}

describe('ptsetTransform', () => {
  it('单位矩阵 + 无 globalModelMatrix 时坐标透传', () => {
    const resp = makeResponse([{ number: 1, pt: [1, 2, 3] }]);
    const identity16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const cands = ptsetResponseToSceneCandidates('1_1', resp, identity16, null);
    expect(cands).toHaveLength(1);
    expect(cands[0].worldPos[0]).toBeCloseTo(1, 6);
    expect(cands[0].worldPos[1]).toBeCloseTo(2, 6);
    expect(cands[0].worldPos[2]).toBeCloseTo(3, 6);
  });

  it('应用 globalModelMatrix（mm→m 缩放）', () => {
    const resp = makeResponse([{ number: 7, pt: [1000, 2000, 3000] }]);
    const identity16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const gm = new Matrix4().makeScale(0.001, 0.001, 0.001);
    const cands = ptsetResponseToSceneCandidates('1_1', resp, identity16, gm);
    expect(cands[0].worldPos[0]).toBeCloseTo(1, 6);
    expect(cands[0].worldPos[1]).toBeCloseTo(2, 6);
    expect(cands[0].worldPos[2]).toBeCloseTo(3, 6);
  });

  it('conversion_factor 作用于局部坐标', () => {
    const resp = makeResponse([{ number: 1, pt: [1, 2, 3] }], 2);
    const cands = ptsetResponseToSceneCandidates('1_1', resp, null, null);
    expect(cands[0].worldPos).toEqual([2, 4, 6]);
  });

  it('行主序 3x4 矩阵带平移', () => {
    const m = [
      [1, 0, 0, 10],
      [0, 1, 0, 20],
      [0, 0, 1, 30],
    ];
    expect(applyPtsetTransformToPoint(m, [1, 1, 1])).toEqual([11, 21, 31]);
  });
});

describe('pickPtsetWorldTransform · 点集进场景优先接口的 float64 world_transform（golden MD §35 补采 (2)，2026-09-16）', () => {
  // gen-model element/ptset 给的列主序矩阵（float64）与 DTX 登记的同一构件放置矩阵（float32 量化：18 m 处差 ~1 µm）。
  const api = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 7849.85, 11787.49, 18643.63, 1];
  const dtx = api.map((v) => Math.fround(v));

  it('接口给了可用矩阵就用接口的，DTX 只是回落', () => {
    expect(pickPtsetWorldTransform(api, dtx)).toBe(api);
    expect(pickPtsetWorldTransform(null, dtx)).toBe(dtx);
    expect(pickPtsetWorldTransform(undefined, dtx)).toBe(dtx);
    expect(pickPtsetWorldTransform(null, undefined)).toBeNull();
    // 接口给的形状不认得（长度不对 / 有 NaN）→ 回落 DTX；两边都不可用时把接口原样交回去（applyPtsetTransformToPoint 会原样返回局部点）。
    expect(pickPtsetWorldTransform([1, 2, 3], dtx)).toBe(dtx);
    expect(pickPtsetWorldTransform([...api.slice(0, 15), Number.NaN], dtx)).toBe(dtx);
    const junk = { not: 'a matrix' };
    expect(pickPtsetWorldTransform(junk, 'junk')).toBe(junk);
  });

  it('isUsablePtsetWorldTransform 认列主序 16 元与 ≥ 3 行的行主序，元素得是有限数', () => {
    expect(isUsablePtsetWorldTransform(api)).toBe(true);
    expect(isUsablePtsetWorldTransform([[1, 0, 0, 10], [0, 1, 0, 20], [0, 0, 1, 30]])).toBe(true);
    expect(isUsablePtsetWorldTransform([[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBe(false);
    expect(isUsablePtsetWorldTransform(api.slice(0, 12))).toBe(false);
    expect(isUsablePtsetWorldTransform(null)).toBe(false);
    expect(isUsablePtsetWorldTransform('1,0,0')).toBe(false);
  });

  it('同一枚 P-Point：DTX 矩阵算出来的位置离接口矩阵 ~1 µm，选接口矩阵后与手算完全一致', () => {
    const resp = makeResponse([{ number: 1, pt: [0, -151.2436857842262, 0] }]);
    resp.world_transform = api;
    const viaApi = ptsetResponseToSceneCandidates('24381_145029', resp, pickPtsetWorldTransform(resp.world_transform, dtx), null)[0]!.worldPos;
    const viaDtx = ptsetResponseToSceneCandidates('24381_145029', resp, dtx, null)[0]!.worldPos;
    const expected = applyPtsetTransformToPoint(api, [0, -151.2436857842262, 0]);
    expect(viaApi).toEqual(expected);
    const gapMm = Math.hypot(viaApi[0] - viaDtx[0], viaApi[1] - viaDtx[1], viaApi[2] - viaDtx[2]);
    expect(gapMm).toBeGreaterThan(1e-4); // float32 在 1e4 mm 量级上的量化 ≈ 1e-3 mm
    expect(gapMm).toBeLessThan(5e-3);
  });
});

describe('snapToCandidates', () => {
  const camera = centeredCamera();
  const rect = { width: 800, height: 600 };

  it('原点候选投影到画布中心', () => {
    const p = projectToCanvas([0, 0, 0], camera, rect);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(400, 0);
    expect(p.y).toBeCloseTo(300, 0);
  });

  it('阈值内吸附到最近关键点', () => {
    const candidates = [
      { refno: '1_1', number: 1, worldPos: [0, 0, 0] as [number, number, number], pbore: 50 },
    ];
    const hit = snapToCandidates({ x: 403, y: 302 }, camera, rect, candidates, 12);
    expect(hit).not.toBeNull();
    expect(hit!.number).toBe(1);
    expect(hit!.pixelDistance).toBeLessThanOrEqual(12);
  });

  it('阈值外不吸附', () => {
    const candidates = [
      { refno: '1_1', number: 1, worldPos: [0, 0, 0] as [number, number, number], pbore: 50 },
    ];
    const hit = snapToCandidates({ x: 600, y: 300 }, camera, rect, candidates, 12);
    expect(hit).toBeNull();
  });

  it('多候选取像素最近者', () => {
    // 原点 → 中心(400,300)；另一点偏离一点点但仍在阈值外的更远位置。
    const candidates = [
      { refno: '1_1', number: 1, worldPos: [0, 0, 0] as [number, number, number], pbore: 0 },
      { refno: '1_1', number: 2, worldPos: [0.05, 0, 0] as [number, number, number], pbore: 0 },
    ];
    const hit = snapToCandidates({ x: 401, y: 300 }, camera, rect, candidates, 100);
    expect(hit).not.toBeNull();
    // 光标几乎在中心，#1（原点）应更近
    expect(hit!.number).toBe(1);
  });

  it('空候选返回 null', () => {
    expect(snapToCandidates({ x: 400, y: 300 }, camera, rect, [], 12)).toBeNull();
  });
});
