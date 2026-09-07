import { describe, expect, it } from 'vitest';

import { PerspectiveCamera, Vector3 } from 'three';

import {
  CLOUD_FIT_PADDING_PX,
  buildCloudBillboardPolyline,
  cloudWavesPerEdgeForSizePx,
  computeFittedCloudRectFromCorners,
} from './useDtxTools';

describe('computeFittedCloudRectFromCorners', () => {
  it('对角点求 2D 外接矩形并向外扩 padding', () => {
    const rect = computeFittedCloudRectFromCorners(
      [
        { x: 100, y: 50 },
        { x: 300, y: 50 },
        { x: 300, y: 250 },
        { x: 100, y: 250 },
      ],
      10,
    );
    expect(rect).not.toBeNull();
    expect(rect!.centerX).toBe(200);
    expect(rect!.centerY).toBe(150);
    expect(rect!.widthPx).toBe(200 + 20);
    expect(rect!.heightPx).toBe(200 + 20);
  });

  it('贴合结果小于最小尺寸时取最小尺寸兜底，中心不变', () => {
    const rect = computeFittedCloudRectFromCorners(
      [
        { x: 490, y: 295 },
        { x: 510, y: 305 },
      ],
      5,
      { width: 120, height: 72 },
    );
    expect(rect).not.toBeNull();
    expect(rect!.centerX).toBe(500);
    expect(rect!.centerY).toBe(300);
    expect(rect!.widthPx).toBe(120);
    expect(rect!.heightPx).toBe(72);
  });

  it('忽略非有限角点，其余角点仍参与贴合', () => {
    const rect = computeFittedCloudRectFromCorners(
      [
        { x: Number.NaN, y: 0 },
        { x: 10, y: 20 },
        { x: 50, y: 80 },
        { x: Number.POSITIVE_INFINITY, y: 40 },
      ],
      0,
    );
    expect(rect).not.toBeNull();
    expect(rect!.centerX).toBe(30);
    expect(rect!.centerY).toBe(50);
    expect(rect!.widthPx).toBe(40);
    expect(rect!.heightPx).toBe(60);
  });

  it('角点为空或全部非有限时返回 null，调用方回退固定布局', () => {
    expect(computeFittedCloudRectFromCorners([], 10)).toBeNull();
    expect(
      computeFittedCloudRectFromCorners([{ x: Number.NaN, y: Number.NaN }], 10),
    ).toBeNull();
  });

  it('负 padding 按 0 处理，不会反向收缩矩形', () => {
    const rect = computeFittedCloudRectFromCorners(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      -50,
    );
    expect(rect).not.toBeNull();
    expect(rect!.widthPx).toBe(100);
    expect(rect!.heightPx).toBe(100);
  });
});

describe('cloudWavesPerEdgeForSizePx', () => {
  it('小尺寸（旧拖框范围）退回 4 峰，保持旧观感', () => {
    expect(cloudWavesPerEdgeForSizePx(120, 72)).toBe(4);
    expect(cloudWavesPerEdgeForSizePx(220, 180)).toBe(4);
  });

  it('大尺寸按边长像素折算，波浪间距保持恒定像素观感', () => {
    expect(cloudWavesPerEdgeForSizePx(1000, 600)).toBe(Math.round(800 / 52));
  });

  it('超大尺寸钳制在 40 峰以内', () => {
    expect(cloudWavesPerEdgeForSizePx(10000, 10000)).toBe(40);
  });
});

describe('buildCloudBillboardPolyline（波峰数参数）', () => {
  it('折线点落在 right/up 展开的 billboard 平面内', () => {
    const pts = buildCloudBillboardPolyline(
      new Vector3(5, 6, 7),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      200,
      100,
      32,
      1,
      8,
    );
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 2; i < pts.length; i += 3) {
      expect(pts[i]).toBeCloseTo(7, 9);
    }
  });

  it('折线外接范围与矩形尺寸一致（偏差不超过最大振幅）', () => {
    const width = 400;
    const height = 240;
    const maxAmplitude = 6;
    const anchor = new Vector3(0, 0, 0);
    const pts = buildCloudBillboardPolyline(
      anchor,
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      width,
      height,
      64,
      1,
      8,
    );
    let maxAbsX = 0;
    let maxAbsY = 0;
    for (let i = 0; i < pts.length; i += 3) {
      maxAbsX = Math.max(maxAbsX, Math.abs(pts[i]!));
      maxAbsY = Math.max(maxAbsY, Math.abs(pts[i + 1]!));
    }
    expect(maxAbsX).toBeGreaterThanOrEqual(width / 2 - maxAmplitude);
    expect(maxAbsX).toBeLessThanOrEqual(width / 2 + maxAmplitude);
    expect(maxAbsY).toBeGreaterThanOrEqual(height / 2 - maxAmplitude);
    expect(maxAbsY).toBeLessThanOrEqual(height / 2 + maxAmplitude);
  });
});

describe('每帧贴合的包住性质（决策③：任意机位下目标投影角点都在云线矩形内）', () => {
  const viewportWidth = 1280;
  const viewportHeight = 800;

  function projectToScreen(camera: PerspectiveCamera, world: Vector3): { x: number; y: number; ndcZ: number } {
    const v = world.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * viewportWidth,
      y: (-v.y * 0.5 + 0.5) * viewportHeight,
      ndcZ: v.z,
    };
  }

  function boxCorners(min: Vector3, max: Vector3): Vector3[] {
    return [
      new Vector3(min.x, min.y, min.z),
      new Vector3(max.x, min.y, min.z),
      new Vector3(max.x, max.y, min.z),
      new Vector3(min.x, max.y, min.z),
      new Vector3(min.x, min.y, max.z),
      new Vector3(max.x, min.y, max.z),
      new Vector3(max.x, max.y, max.z),
      new Vector3(min.x, max.y, max.z),
    ];
  }

  it('围绕目标旋转/推拉多个机位，贴合矩形始终包住全部投影角点', () => {
    const min = new Vector3(-2, -1, -1.5);
    const max = new Vector3(2, 1.6, 1.5);
    const target = new Vector3().addVectors(min, max).multiplyScalar(0.5);
    const corners = boxCorners(min, max);

    const cameraPositions = [
      new Vector3(8, 5, 9),
      new Vector3(-10, 3, 6),
      new Vector3(0, 12, -8),
      new Vector3(6, -4, -10),
      new Vector3(15, 8, 14),
    ];

    for (const position of cameraPositions) {
      const camera = new PerspectiveCamera(50, viewportWidth / viewportHeight, 0.1, 1000);
      camera.position.copy(position);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();

      const projected = corners.map((corner) => projectToScreen(camera, corner));
      expect(projected.every((p) => p.ndcZ >= -1 && p.ndcZ <= 1)).toBe(true);

      const rect = computeFittedCloudRectFromCorners(projected, CLOUD_FIT_PADDING_PX, {
        width: 120,
        height: 72,
      });
      expect(rect).not.toBeNull();

      const left = rect!.centerX - rect!.widthPx / 2;
      const right = rect!.centerX + rect!.widthPx / 2;
      const top = rect!.centerY - rect!.heightPx / 2;
      const bottom = rect!.centerY + rect!.heightPx / 2;
      for (const p of projected) {
        expect(p.x).toBeGreaterThanOrEqual(left);
        expect(p.x).toBeLessThanOrEqual(right);
        expect(p.y).toBeGreaterThanOrEqual(top);
        expect(p.y).toBeLessThanOrEqual(bottom);
      }
    }
  });
});
