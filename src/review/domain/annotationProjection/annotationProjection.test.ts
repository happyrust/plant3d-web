import { describe, expect, it } from 'vitest';

import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

import {
  chooseSmallTargetLod,
  liftScreenPolylineToBillboard,
  obbSnapshotFromLocalBoxAndMatrix,
  projectCloudRegion,
  regionToWorldCells,
  renderCloudRegion,
  worldPerPixelFromProjection,
  DEFAULT_CLOUD_REGION_RENDER_STYLE,
  obbSnapshotEdges,
} from './annotationProjection';
import { buildObjectBoxCell, clipConvexSolid4, containsPointInConvexCell, depthPlanes, toClipSolid, type WorldCell } from './clip4';
import { convexHull2d, signedArea, type P2 } from './hull2d';
import { pointInPolygon } from './labelLayout';
import { atArcLength, buildRoundedConvexPath, visibleCloudPathIntervals } from './roundedPath';
import { buildVisibleCloudPolylines, cloudHeightAt, transportCloudPhase } from './wave';

import type { ObbSnapshot, RegionV1 } from '../cloudRegion';

/**
 * 几何内核验收（方案 §12.1 + GPT 参考内核 21 项自检的本仓移植）。
 * 参考裁剪器 = 直接在盒内采样世界点（不复用被测函数）：所有落在有效深度内的采样点投影后必须在轮廓包围区内。
 */

const VIEWPORT = { width: 800, height: 600 };
const IDENTITY = new Matrix4().elements;

function perspective(pos: [number, number, number], look: [number, number, number] = [0, 0, 0], near = 0.1, far = 1000) {
  const cam = new PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, near, far);
  cam.position.set(...pos);
  cam.lookAt(...look);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function viewProjectionOf(cam: PerspectiveCamera | OrthographicCamera): number[] {
  return new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements.slice();
}

function unitBoxCell(min: [number, number, number], max: [number, number, number], m = IDENTITY, id = 'box') {
  return buildObjectBoxCell(min, max, m, id);
}

/** 在盒内均匀采样（含角点），过深度平面的点投影到 CSS 像素 */
function sampleBoxProjected(min: number[], max: number[], vp: number[], n = 5): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const m = new Matrix4().fromArray(vp);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const p = new Vector3(
      min[0]! + ((max[0]! - min[0]!) * i) / (n - 1),
      min[1]! + ((max[1]! - min[1]!) * j) / (n - 1),
      min[2]! + ((max[2]! - min[2]!) * k) / (n - 1),
    );
    const h = [p.x, p.y, p.z, 1];
    const e = m.elements;
    const c = [0, 1, 2, 3].map((r) => e[r]! * h[0]! + e[4 + r]! * h[1]! + e[8 + r]! * h[2]! + e[12 + r]! * h[3]!);
    const w = c[3]!;
    if (!(w > 1e-8) || c[2]! < -w || c[2]! > w) continue; // 深度外的点不要求被包住
    out.push({ x: ((c[0]! / w + 1) * VIEWPORT.width) / 2, y: ((1 - c[1]! / w) * VIEWPORT.height) / 2 });
  }
  return out;
}

function expectEnclosed(points: readonly { x: number; y: number }[], enclosure: readonly { x: number; y: number }[], tol = 0.5) {
  expect(enclosure.length).toBeGreaterThanOrEqual(3);
  for (const p of points) {
    // 容差：把点向多边形中心缩 tol 像素后再判，避免恰在边上的浮点误差
    const cx = enclosure.reduce((s, q) => s + q.x, 0) / enclosure.length;
    const cy = enclosure.reduce((s, q) => s + q.y, 0) / enclosure.length;
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    const q = { x: p.x + ((cx - p.x) / d) * tol, y: p.y + ((cy - p.y) / d) * tol };
    expect(pointInPolygon(q, enclosure), `point (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) outside enclosure`).toBe(true);
  }
}

describe('clip4 · 齐次裁剪', () => {
  it('前方盒：投影得到保守凸包，全部采样点在包围区内', () => {
    const cam = perspective([0, 0, 20]);
    const vp = viewProjectionOf(cam);
    const cell = unitBoxCell([-2, -1, -1], [2, 1, 1]);
    const projection = projectCloudRegion([cell], vp, VIEWPORT);
    expect(projection.state).toBe('visible');
    expect(projection.depthClipped).toBe(false);
    expect(projection.rawHull.length).toBeGreaterThanOrEqual(4);
    expect(signedArea(projection.rawHull)).toBeGreaterThan(0);
    expectEnclosed(sampleBoxProjected([-2, -1, -1], [2, 1, 1], vp), projection.rawHull, 0.01);
  });

  it('跨近平面：不进入旧布局，仍给出可见凸包并包住深度内采样点', () => {
    const cam = perspective([0, 0, 0.5], [0, 0, -10], 0.1, 100);
    const vp = viewProjectionOf(cam);
    const cell = unitBoxCell([-1, -1, -3], [1, 1, 3]); // 盒穿过相机近平面
    const projection = projectCloudRegion([cell], vp, VIEWPORT);
    expect(projection.depthClipped).toBe(true);
    expect(projection.state).not.toBe('depth-empty');
    expect(projection.rawHull.length).toBeGreaterThanOrEqual(3);
    expect(projection.rawHull.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // 深度内的采样点（含近平面前的一段）必须被包住
    expectEnclosed(sampleBoxProjected([-1, -1, -3], [1, 1, 3], vp, 7), projection.rawHull, 0.01);
  });

  it('相机后方与远平面之外 → depth-empty', () => {
    const cam = perspective([0, 0, 20], [0, 0, 0], 0.1, 50);
    const vp = viewProjectionOf(cam);
    expect(projectCloudRegion([unitBoxCell([-1, -1, 25], [1, 1, 27])], vp, VIEWPORT).state).toBe('depth-empty');
    expect(projectCloudRegion([unitBoxCell([-1, -1, -60], [1, 1, -55])], vp, VIEWPORT).state).toBe('depth-empty');
  });

  it('相机钻入单元内部：范围体包住整个视锥时仍靠新截面得到（全屏）足迹，且 containsPoint 判相机在体内', () => {
    const cam = perspective([0, 0, 0], [0, 0, -1], 0.1, 10);
    const vp = viewProjectionOf(cam);
    const cell = unitBoxCell([-50, -50, -50], [50, 50, 50]);
    const projection = projectCloudRegion([cell], vp, VIEWPORT);
    expect(projection.state).toBe('visible');
    expect(projection.viewportCut).toBe(true);
    // 可见部分覆盖整个视口
    const vis = projection.visibleHull;
    const xs = vis.map((p) => p.x);
    const ys = vis.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(VIEWPORT.width, 6);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(VIEWPORT.height, 6);
    expect(containsPointInConvexCell(cell, [0, 0, 0])).toBe(true);
    expect(containsPointInConvexCell(cell, [0, 0, 60])).toBe(false);
  });

  it('六个原始面全在视锥外时，逐平面裁剪必须保留新截面（不为空）', () => {
    const cam = perspective([0, 0, 0], [0, 0, -1], 0.1, 10);
    const vp = viewProjectionOf(cam);
    const solid = toClipSolid(unitBoxCell([-50, -50, -50], [50, 50, 50]), vp);
    const clipped = clipConvexSolid4(solid, depthPlanes(1e-8));
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.flat().every((v) => v.h[3] > 0)).toBe(true);
  });

  it('左右各在屏外的两个目标，集合凸包仍穿过视口（不能先删出屏对象）', () => {
    const cam = perspective([0, 0, 10]);
    const vp = viewProjectionOf(cam);
    const left = unitBoxCell([-30, -0.5, -0.5], [-28, 0.5, 0.5], IDENTITY, 'L');
    const right = unitBoxCell([28, -0.5, -0.5], [30, 0.5, 0.5], IDENTITY, 'R');
    const each = [projectCloudRegion([left], vp, VIEWPORT), projectCloudRegion([right], vp, VIEWPORT)];
    expect(each.every((p) => p.state === 'offscreen')).toBe(true);
    const group = projectCloudRegion([left, right], vp, VIEWPORT);
    expect(group.state).toBe('visible');
    expect(group.viewportCut).toBe(true);
  });

  it('部分出屏：可见部分是真实交集，rawHull 保留屏外支撑点', () => {
    const cam = perspective([0, 0, 10]);
    const vp = viewProjectionOf(cam);
    const projection = projectCloudRegion([unitBoxCell([0, -1, -1], [20, 1, 1])], vp, VIEWPORT);
    expect(projection.state).toBe('visible');
    expect(projection.viewportCut).toBe(true);
    expect(projection.visibleHull.every((p) => p.x >= -1e-6 && p.x <= VIEWPORT.width + 1e-6)).toBe(true);
    expect(projection.rawHull.some((p) => p.x > VIEWPORT.width)).toBe(true);
  });

  it('剪切矩阵下的局部盒保持为仿射单元（平行六面体），不重建 OBB', () => {
    const shear = new Matrix4().set(1, 0.6, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1).elements;
    const cell = unitBoxCell([-1, -1, -1], [1, 1, 1], shear);
    const top = cell[1]!.map((v) => v.p);
    // 顶面 y=1 的角点 x 被剪切了 0.6
    expect(top.some((p) => Math.abs(p[0] - 1.6) < 1e-9)).toBe(true);
    expect(cell.length).toBe(6);
    expect(cell.flat().length).toBe(24);
  });
});

describe('roundedPath / wave · 圆角外扩与波纹', () => {
  const square: P2[] = [
    { id: 'a', x: 100, y: 100 }, { id: 'b', x: 300, y: 100 }, { id: 'c', x: 300, y: 200 }, { id: 'd', x: 100, y: 200 },
  ];

  it('Minkowski 路径长度 = 周长 + 2π·padding', () => {
    const path = buildRoundedConvexPath(square, 14);
    expect(path.length).toBeCloseTo(600 + 2 * Math.PI * 14, 6);
    expect(Object.keys(path.features).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('波纹高度非负、在收口区连续归零', () => {
    const path = buildRoundedConvexPath(square, 14);
    const { frame } = transportCloudPhase(path, 52, null);
    for (let s = 0; s < path.length; s += 0.5) {
      expect(cloudHeightAt(s, path.length, frame, 4)).toBeGreaterThanOrEqual(0);
    }
    expect(cloudHeightAt(frame.anchorS, path.length, frame, 4)).toBeCloseTo(0, 9);
    expect(cloudHeightAt(frame.anchorS + path.length - 1e-6, path.length, frame, 4)).toBeCloseTo(0, 5);
  });

  it('外扩采样折线包住凸包顶点与边（波只向外）', () => {
    const path = buildRoundedConvexPath(square, 14);
    const { frame } = transportCloudPhase(path, 52, null);
    const [poly] = buildVisibleCloudPolylines(path, frame, { left: 0, top: 0, right: 800, bottom: 600 }, 4, 2);
    expect(poly!.length).toBeGreaterThan(100);
    const enclosure = poly!.map((p) => ({ x: p.x, y: p.y }));
    for (const v of square) expect(pointInPolygon(v, enclosure)).toBe(true);
    for (let t = 0; t <= 1; t += 0.1) expect(pointInPolygon({ x: 100 + 200 * t, y: 100 }, enclosure)).toBe(true);
    // 首尾重合 = 闭合
    expect(Math.hypot(poly![0]!.x - poly![poly!.length - 1]!.x, poly![0]!.y - poly![poly!.length - 1]!.y)).toBeLessThan(1e-6);
  });

  it('插入共线点或改变输入顺序不改变相位锚定', () => {
    const path = buildRoundedConvexPath(square, 14);
    const { frame } = transportCloudPhase(path, 52, null);
    const withCollinear = buildRoundedConvexPath([...square, { id: 'mid', x: 200, y: 100 }].reverse(), 14);
    const next = transportCloudPhase(withCollinear, 52, { path, frame });
    expect(next.handover).toBe(false);
    expect(next.frame.anchorId).toBe(frame.anchorId);
    expect(next.frame.anchorS).toBeCloseTo(frame.anchorS, 9);
  });

  it('锚定特征消失时在共同存活特征处转移解析相位', () => {
    const path = buildRoundedConvexPath(square, 14);
    const { frame } = transportCloudPhase(path, 52, null); // 锚 'a'
    const without = buildRoundedConvexPath(square.filter((p) => p.id !== 'a').concat({ id: 'e', x: 90, y: 150 }), 14);
    const next = transportCloudPhase(without, 52, { path, frame });
    expect(next.handover).toBe(true);
    expect(['b', 'c', 'd']).toContain(next.frame.anchorId);
    // 旧轮廓在该特征处的相位 = 新框架在该特征处的相位
    const oldPhaseAtFeature = (2 * Math.PI * ((path.features[next.frame.anchorId]! - frame.anchorS + path.length) % path.length)) / 52;
    expect(next.frame.phaseAtAnchor).toBeCloseTo(oldPhaseAtFeature % (2 * Math.PI), 9);
  });

  it('超大屏外周长只在视口附近采样', () => {
    const huge: P2[] = [
      { id: 'a', x: -1e6, y: -1e6 }, { id: 'b', x: 1e6, y: -1e6 }, { id: 'c', x: 1e6, y: 300 }, { id: 'd', x: -1e6, y: 300 },
    ];
    const path = buildRoundedConvexPath(huge, 14);
    const intervals = visibleCloudPathIntervals(path, { left: 0, top: 0, right: 800, bottom: 600 }, 10);
    const total = intervals.reduce((s, [lo, hi]) => s + (hi - lo), 0);
    expect(total).toBeLessThan(2000);
    const { frame } = transportCloudPhase(path, 52, null);
    const pieces = buildVisibleCloudPolylines(path, frame, { left: 0, top: 0, right: 800, bottom: 600 }, 4, 2);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    expect(pieces.flat().length).toBeLessThan(2000);
    // 采样点的 s 保留全局弧长：与 atArcLength 一致
    const p0 = atArcLength(path, intervals[0]![0]);
    expect(Number.isFinite(p0.x)).toBe(true);
  });

  it('细长目标不按面积判成图标；小目标滞回', () => {
    expect(chooseSmallTargetLod(1, 300, 'cloud', false)).toBe('cloud');
    expect(chooseSmallTargetLod(10, 8, 'cloud', false)).toBe('icon');
    expect(chooseSmallTargetLod(10, 8, 'cloud', true)).toBe('minimum-halo');
    expect(chooseSmallTargetLod(15, 8, 'icon', false)).toBe('icon'); // 12 < 15 < 18 仍是图标
    expect(chooseSmallTargetLod(15, 8, 'cloud', false)).toBe('cloud');
  });
});

describe('renderCloudRegion · 一帧', () => {
  const region: RegionV1 = {
    version: 1,
    space: 'world',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    origin: 'members',
    kind: 'obb-union',
    boxes: [
      { id: 'o1', memberRefno: 'r1', center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [2, 1, 1] },
      { id: 'o2', memberRefno: 'r2', center: [4, 2, 0], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], halfSize: [1, 0.5, 0.5] },
    ],
  };

  const cameraCases: { name: string; cam: PerspectiveCamera | OrthographicCamera }[] = [
    { name: '正对', cam: perspective([0, 0, 20]) },
    { name: '斜视', cam: perspective([12, 8, 15]) },
    { name: 'roll', cam: (() => { const c = perspective([0, 0, 20]); c.up.set(1, 1, 0).normalize(); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); return c; })() },
    { name: '近平面穿越', cam: perspective([0.5, 0.3, 1.2], [0, 0, -5], 0.1, 100) },
    { name: '正交', cam: (() => { const c = new OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 100); c.position.set(0, 0, 20); c.lookAt(0, 0, 0); c.updateMatrixWorld(true); c.updateProjectionMatrix(); return c; })() },
  ];

  it.each(cameraCases)('新版范围包围：$name', ({ cam }) => {
    const vp = viewProjectionOf(cam);
    const cells = regionToWorldCells(region);
    expect(cells.ok).toBe(true);
    const result = renderCloudRegion({ cells: (cells as { cells: WorldCell[] }).cells, viewProjection: vp, viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(['complete', 'viewport-cut']).toContain(result.state);
    // 范围覆盖整个视口时真实轮廓全在屏外：允许没有可见片段，但状态必须是 viewport-cut（不伪造一个小框）
    if (result.polylines.length === 0) expect(result.state).toBe('viewport-cut');
    expect(result.polylines.flat().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // 独立参考：盒内采样点投影必须在 enclosure（含 padding、未加波浪）内
    const samples = [
      ...sampleBoxProjected([-2, -1, -1], [2, 1, 1], vp),
      // o2 是旋转盒：按 axes 采样
      ...(() => {
        const box = region.boxes[1]!;
        const out: { x: number; y: number }[] = [];
        const m = new Matrix4().fromArray(vp);
        for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 0.5) for (let k = -1; k <= 1; k += 0.5) {
          const p = new Vector3(...box.center)
            .addScaledVector(new Vector3(...box.axes[0]), i * box.halfSize[0])
            .addScaledVector(new Vector3(...box.axes[1]), j * box.halfSize[1])
            .addScaledVector(new Vector3(...box.axes[2]), k * box.halfSize[2]);
          const e = m.elements;
          const c = [0, 1, 2, 3].map((r) => e[r]! * p.x + e[4 + r]! * p.y + e[8 + r]! * p.z + e[12 + r]!);
          const w = c[3]!;
          if (!(w > 1e-8) || c[2]! < -w || c[2]! > w) continue;
          out.push({ x: ((c[0]! / w + 1) * VIEWPORT.width) / 2, y: ((1 - c[1]! / w) * VIEWPORT.height) / 2 });
        }
        return out;
      })(),
    ];
    expectEnclosed(samples, result.enclosure, 0.5);
    // 参考框包住 enclosure
    const rb = result.referenceBounds!;
    for (const p of result.enclosure) {
      expect(p.x).toBeGreaterThanOrEqual(rb.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(rb.x + rb.width + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(rb.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(rb.y + rb.height + 1e-6);
    }
  });

  it('连续小步相机移动：相位不重置（锚点特征保持），轮廓位移有界', () => {
    const cells = (regionToWorldCells(region) as { cells: WorldCell[] }).cells;
    let previous = null as { path: NonNullable<ReturnType<typeof renderCloudRegion>['path']>; frame: NonNullable<ReturnType<typeof renderCloudRegion>['phase']> } | null;
    let lastBounds: { x: number; y: number } | null = null;
    let anchorId: string | null = null;
    for (let step = 0; step < 30; step++) {
      const cam = perspective([0.2 * step, 0.1 * step, 20]);
      const result = renderCloudRegion({ cells, viewProjection: viewProjectionOf(cam), viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE, previous });
      expect(result.state).toBe('complete');
      if (anchorId) expect(result.phase!.anchorId).toBe(anchorId);
      anchorId = result.phase!.anchorId;
      if (lastBounds) {
        expect(Math.abs(result.referenceBounds!.x - lastBounds.x)).toBeLessThan(30);
        expect(Math.abs(result.referenceBounds!.y - lastBounds.y)).toBeLessThan(30);
      }
      lastBounds = { x: result.referenceBounds!.x, y: result.referenceBounds!.y };
      previous = { path: result.path!, frame: result.phase! };
    }
  });

  it('近平面穿越 · 细长目标：有可见轮廓片段，深度内采样点被包住，不回退旧布局', () => {
    const pipe: RegionV1 = { ...region, boxes: [{ id: 'p', memberRefno: null, center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [0.05, 0.05, 3] }] };
    const cells = (regionToWorldCells(pipe) as { cells: WorldCell[] }).cells;
    const cam = perspective([0.3, 0.2, 0], [0.3, 0.2, -10], 0.1, 100); // 管子从相机旁边穿过近平面
    const vp = viewProjectionOf(cam);
    const result = renderCloudRegion({ cells, viewProjection: vp, viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(result.projection.depthClipped).toBe(true);
    expect(result.state).toBe('viewport-cut');
    expect(result.polylines.length).toBeGreaterThanOrEqual(1);
    expectEnclosed(sampleBoxProjected([-0.05, -0.05, -3], [0.05, 0.05, 3], vp, 9), result.enclosure, 0.5);
  });

  it('范围覆盖整个视口（相机贴着目标）：viewport-cut、无可见片段，enclosure 仍包住采样点', () => {
    const cells = (regionToWorldCells(region) as { cells: WorldCell[] }).cells;
    const cam = perspective([0.5, 0.3, 1.2], [0, 0, -5], 0.1, 100);
    const vp = viewProjectionOf(cam);
    const result = renderCloudRegion({ cells, viewProjection: vp, viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(result.state).toBe('viewport-cut');
    expect(result.polylines).toEqual([]);
    expect(result.referenceBounds).not.toBeNull();
    expectEnclosed(sampleBoxProjected([-2, -1, -1], [2, 1, 1], vp), result.enclosure, 0.5);
  });

  it('全部在深度外 → depth-empty，不产生轮廓也不产生参考框（不回退旧布局）', () => {
    const cells = (regionToWorldCells(region) as { cells: WorldCell[] }).cells;
    const cam = perspective([0, 0, -30], [0, 0, -60]);
    const result = renderCloudRegion({ cells, viewProjection: viewProjectionOf(cam), viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(result.state).toBe('depth-empty');
    expect(result.polylines).toEqual([]);
    expect(result.referenceBounds).toBeNull();
  });

  it('全部在视口外 → offscreen', () => {
    const cells = (regionToWorldCells(region) as { cells: WorldCell[] }).cells;
    const cam = perspective([60, 0, 20], [60, 0, 0]);
    const result = renderCloudRegion({ cells, viewProjection: viewProjectionOf(cam), viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(result.state).toBe('offscreen');
    expect(result.polylines).toEqual([]);
  });

  it('侧视成线的零厚度盒：退化凸包也能外扩成胶囊而不抛错', () => {
    const flat: RegionV1 = { ...region, boxes: [{ id: 'f', memberRefno: null, center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [2, 0, 1] }] };
    const cells = (regionToWorldCells(flat) as { cells: WorldCell[] }).cells;
    const cam = perspective([0, 0, 20]);
    const result = renderCloudRegion({ cells, viewProjection: viewProjectionOf(cam), viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(result.state).toBe('complete');
    expect(result.referenceBounds!.height).toBeGreaterThan(2 * 14);
  });

  it('coverage：极远小目标进入图标态（无轮廓），激活时给最小提示框', () => {
    const cells = (regionToWorldCells(region) as { cells: WorldCell[] }).cells;
    const cam = perspective([0, 0, 900], [0, 0, 0], 0.1, 5000);
    const idle = renderCloudRegion({ cells, viewProjection: viewProjectionOf(cam), viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(idle.lod).toBe('icon');
    expect(idle.polylines).toEqual([]);
    const active = renderCloudRegion({ cells, viewProjection: viewProjectionOf(cam), viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE, active: true });
    expect(active.lod).toBe('minimum-halo');
    expect(active.referenceBounds!.width).toBeGreaterThanOrEqual(32 + 28 - 1e-6);
  });

  it('坐标系重映射：G_new · G_old⁻¹ 后投影随之平移（正交相机下宽度不变）', () => {
    const cells = (regionToWorldCells(region) as { cells: WorldCell[] }).cells;
    const cam = new OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 100);
    cam.position.set(0, 0, 20);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const vp = viewProjectionOf(cam);
    const base = renderCloudRegion({ cells, viewProjection: vp, viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    const remapped = regionToWorldCells(region, new Matrix4().makeTranslation(2, 0, 0).elements) as { cells: WorldCell[] };
    const moved = renderCloudRegion({ cells: remapped.cells, viewProjection: vp, viewport: VIEWPORT, style: DEFAULT_CLOUD_REGION_RENDER_STYLE });
    expect(moved.referenceBounds!.x).toBeGreaterThan(base.referenceBounds!.x + 10);
    expect(moved.referenceBounds!.width).toBeCloseTo(base.referenceBounds!.width, 6);
  });
});

describe('regionToWorldCells · 校验', () => {
  const base: RegionV1 = {
    version: 1, space: 'world', origin: 'members',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null },
    kind: 'obb-union',
    boxes: [{ id: 'a', memberRefno: null, center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [1, 1, 1] }],
  };
  it('合法 OBB 通过；非正交轴 / 非有限数 / 未知版本 / 超预算 拒绝', () => {
    expect(regionToWorldCells(base).ok).toBe(true);
    expect(regionToWorldCells({ ...base, boxes: [{ ...base.boxes[0]!, axes: [[1, 0, 0], [1, 0, 0], [0, 0, 1]] }] } as RegionV1).ok).toBe(false);
    expect(regionToWorldCells({ ...base, boxes: [{ ...base.boxes[0]!, center: [Number.NaN, 0, 0] }] } as RegionV1).ok).toBe(false);
    expect(regionToWorldCells({ ...base, version: 2 } as unknown as RegionV1).ok).toBe(false);
    expect(regionToWorldCells({ ...base, kind: 'weird' } as unknown as RegionV1).ok).toBe(false);
    expect(regionToWorldCells({ ...base, boxes: Array.from({ length: 257 }, (_, i) => ({ ...base.boxes[0]!, id: `b${i}` })) } as RegionV1).ok).toBe(false);
    expect(regionToWorldCells(null).ok).toBe(false);
  });
  it('hull / lasso-prism 单元：面索引越界拒绝', () => {
    const cell = { id: 'c', memberRefno: null, vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as const, faces: [[0, 1, 2], [0, 1, 3], [1, 2, 3], [0, 2, 3]] };
    expect(regionToWorldCells({ ...base, kind: 'hull', hull: cell } as unknown as RegionV1).ok).toBe(true);
    expect(regionToWorldCells({ ...base, kind: 'hull', hull: { ...cell, faces: [[0, 1, 9], [0, 1, 3], [1, 2, 3], [0, 2, 3]] } } as unknown as RegionV1).ok).toBe(false);
    expect(regionToWorldCells({ ...base, kind: 'lasso-prism', cells: [cell] } as unknown as RegionV1).ok).toBe(true);
  });
});

describe('obbSnapshotFromLocalBoxAndMatrix · 创建时的 OBB', () => {
  it('刚体 + 均匀缩放 → 真 OBB（轴正交、halfSize 按缩放）', () => {
    const m = new Matrix4().makeRotationZ(Math.PI / 4).multiply(new Matrix4().makeScale(0.5, 0.5, 0.5)).setPosition(10, 0, 0);
    const box = obbSnapshotFromLocalBoxAndMatrix([-2, -1, -1], [2, 1, 1], m.elements, 'x', 'r');
    expect(box.halfSize.map((v) => +v.toFixed(9))).toEqual([1, 0.5, 0.5]);
    expect(box.center.map((v) => +v.toFixed(9))).toEqual([10, 0, 0]);
    expect(Math.abs(box.axes[0][0] - Math.SQRT1_2)).toBeLessThan(1e-9);
    expect(Math.abs(box.axes[0][1] - Math.SQRT1_2)).toBeLessThan(1e-9);
    // 角点应与 buildObjectBoxCell 一致
    const corners = obbSnapshotEdges(box).flat();
    const cell = buildObjectBoxCell([-2, -1, -1], [2, 1, 1], m.elements, 'x').flat().map((v) => v.p);
    for (const c of corners) expect(cell.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 1e-9)).toBe(true);
  });
  it('剪切矩阵 → 退成变换角点的单位轴 AABB（保守包住）', () => {
    const shear = new Matrix4().set(1, 0.6, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    const box = obbSnapshotFromLocalBoxAndMatrix([-1, -1, -1], [1, 1, 1], shear.elements, 's', null);
    expect(box.axes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(box.halfSize[0]).toBeCloseTo(1.6, 9);
    const cell = buildObjectBoxCell([-1, -1, -1], [1, 1, 1], shear.elements, 's').flat().map((v) => v.p);
    for (const p of cell) {
      expect(Math.abs(p[0] - box.center[0])).toBeLessThanOrEqual(box.halfSize[0] + 1e-9);
      expect(Math.abs(p[1] - box.center[1])).toBeLessThanOrEqual(box.halfSize[1] + 1e-9);
    }
  });
});

describe('像素 ↔ 世界', () => {
  it('正交 worldPerPixel 与深度无关且含 zoom；透视按视深', () => {
    const ortho = new OrthographicCamera(-10, 10, 7.5, -7.5, 0.1, 100);
    ortho.zoom = 2;
    ortho.updateProjectionMatrix();
    const a = worldPerPixelFromProjection('orthographic', ortho.projectionMatrix.elements, VIEWPORT, 5);
    const b = worldPerPixelFromProjection('orthographic', ortho.projectionMatrix.elements, VIEWPORT, 50);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.x).toBeCloseTo(20 / 2 / VIEWPORT.width, 12);
    const persp = perspective([0, 0, 20]);
    const near = worldPerPixelFromProjection('perspective', persp.projectionMatrix.elements, VIEWPORT, 10);
    const far = worldPerPixelFromProjection('perspective', persp.projectionMatrix.elements, VIEWPORT, 20);
    expect(far.x / near.x).toBeCloseTo(2, 9);
  });

  it('billboard 反投影往返 CSS 坐标', () => {
    const cam = perspective([3, 2, 20]);
    const vp = viewProjectionOf(cam);
    const inv = new Matrix4().fromArray(vp).invert().elements;
    const pts = [{ x: 100, y: 50 }, { x: 700, y: 550 }, { x: 400, y: 300 }];
    const world = liftScreenPolylineToBillboard(pts, inv, VIEWPORT, 0);
    for (let i = 0; i < pts.length; i++) {
      const v = new Vector3(world[i * 3]!, world[i * 3 + 1]!, world[i * 3 + 2]!).project(cam);
      expect((v.x + 1) * VIEWPORT.width / 2).toBeCloseTo(pts[i]!.x, 6);
      expect((1 - v.y) * VIEWPORT.height / 2).toBeCloseTo(pts[i]!.y, 6);
    }
  });
});

describe('hull2d', () => {
  it('非有限输入抛错（不能丢支撑点后宣称包住）', () => {
    expect(() => convexHull2d([{ id: 'a', x: Number.NaN, y: 0 }])).toThrow();
  });
  it('输入顺序不影响结果；重复点合并', () => {
    const pts: P2[] = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 10 }, { id: 'd', x: 0, y: 10 }, { id: 'e', x: 5, y: 5 }, { id: 'a2', x: 0, y: 0 }];
    const h1 = convexHull2d(pts).map((p) => p.id);
    const h2 = convexHull2d([...pts].reverse()).map((p) => p.id);
    expect(h1).toEqual(h2);
    expect(h1.length).toBe(4);
    expect(h1).not.toContain('e');
  });
});

// 保证 ObbSnapshot 类型在本文件被引用（供 it.each 类型推断）
const _typeCheck: ObbSnapshot | null = null;
void _typeCheck;
