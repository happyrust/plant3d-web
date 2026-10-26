/**
 * 云线屏幕几何：billboard 折线、贴合矩形、波纹包围盒、布局。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from 'three';

import { clamp } from './geometry';

import type { CloudLayout, ScreenPoint } from './types';
import type { Vec3 } from '@/composables/useToolStore';

export function buildCloudBillboardPolyline(
  anchor: Vector3,
  right: Vector3,
  up: Vector3,
  width: number,
  height: number,
  segments = 16,
  worldPerPixel = 1,
  wavesPerEdge = 4,
): number[] {
  const safeRight = right.clone().normalize();
  const safeUp = up.clone().normalize();
  const safeWorldPerPixel = Math.max(worldPerPixel, Number.EPSILON);
  const minAmplitudeWorld = safeWorldPerPixel * 1;
  const maxAmplitudeWorld = safeWorldPerPixel * 6;
  const points = buildCloudWavyRectanglePoints2D(
    0,
    0,
    width,
    height,
    {
      segmentsPerEdge: segments,
      wavesPerEdge,
      amplitude: {
        ratio: 0.015,
        minPx: minAmplitudeWorld,
        maxPx: maxAmplitudeWorld,
      },
    },
  );
  const pts: number[] = [];
  for (const point of points) {
    const p = anchor.clone()
      .addScaledVector(safeRight, point.x)
      .addScaledVector(safeUp, point.y);
    pts.push(p.x, p.y, p.z);
  }
  return pts;
}

/** 屏幕空间贴合云线的默认内边距（px），保证目标轮廓与波浪线之间有呼吸感。 */
export const CLOUD_FIT_PADDING_PX = 14;

/**
 * 目标合并 AABB 的缓存时长（ms）。每帧现算太贵，只认创建时快照又无法自愈；
 * 折中为低频重解析——按需加载完成、模型版本切换后半秒内云线自动回到目标上。
 */
export const CLOUD_TARGET_BBOX_TTL_MS = 500;

export type FittedCloudRect = {
  centerX: number
  centerY: number
  widthPx: number
  heightPx: number
}

/**
 * 由目标合并 AABB 的屏幕投影角点求云线贴合矩形：2D 外接矩形向外扩 padding，
 * 再与最小尺寸（拖框尺寸兜底）取最大值，使绑定目标在任意相机角度下都被云线包住。
 * 返回 null 表示角点不可用（为空或均为非有限值），调用方应回退固定尺寸布局。
 */
export function computeFittedCloudRectFromCorners(
  corners: readonly { x: number; y: number }[],
  paddingPx: number,
  minSize?: { width?: number; height?: number },
): FittedCloudRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  if (maxX < minX || maxY < minY) return null;
  const safePadding = Math.max(paddingPx, 0);
  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    widthPx: Math.max(maxX - minX + safePadding * 2, minSize?.width ?? 0),
    heightPx: Math.max(maxY - minY + safePadding * 2, minSize?.height ?? 0),
  };
}

/** 贴合矩形的波峰数按边长像素折算，保持波浪间距的恒定像素观感（小尺寸退回旧观感 4 峰）。 */
export function cloudWavesPerEdgeForSizePx(widthPx: number, heightPx: number): number {
  return clamp(Math.round(((widthPx + heightPx) * 0.5) / 52), 4, 40);
}

export const CLOUD_BBOX_EDGE_INDEX_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function boxCornersFromMinMaxVec(min: Vector3, max: Vector3): Vector3[] {
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

function pushWavyEdgeLineSegmentPairs(
  v0: Vector3,
  v1: Vector3,
  cameraWorldPos: Vector3,
  segments: number,
  waves: number,
  out: number[],
): void {
  const edge = new Vector3().subVectors(v1, v0);
  const len = edge.length();
  if (len < 1e-9) return;
  const edgeDir = edge.multiplyScalar(1 / len);
  const mid = new Vector3().addVectors(v0, v1).multiplyScalar(0.5);
  const toCam = new Vector3().subVectors(cameraWorldPos, mid);
  const binormal = new Vector3().crossVectors(edgeDir, toCam);
  if (binormal.lengthSq() < 1e-12) {
    binormal.crossVectors(edgeDir, new Vector3(0, 1, 0));
  }
  if (binormal.lengthSq() < 1e-12) {
    binormal.crossVectors(edgeDir, new Vector3(1, 0, 0));
  }
  binormal.normalize();
  const amp = clamp(len * 0.022, len * 0.004, len * 0.12);

  const base0 = new Vector3();
  const base1 = new Vector3();
  const p0 = new Vector3();
  const p1 = new Vector3();
  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    base0.copy(v0).lerp(v1, t0);
    base1.copy(v0).lerp(v1, t1);
    const w0 = Math.sin(t0 * Math.PI * 2 * waves) * amp;
    const w1 = Math.sin(t1 * Math.PI * 2 * waves) * amp;
    p0.copy(base0).addScaledVector(binormal, w0);
    p1.copy(base1).addScaledVector(binormal, w1);
    out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
  }
}

export function buildWavySelectionBboxLinePositions(
  min: Vec3,
  max: Vec3,
  cameraWorldPos: Vector3,
  segmentsPerEdge = 10,
): Float32Array {
  const mn = new Vector3(min[0], min[1], min[2]);
  const mx = new Vector3(max[0], max[1], max[2]);
  const corners = boxCornersFromMinMaxVec(mn, mx);
  const waves = 3;
  const out: number[] = [];
  for (const [ia, ib] of CLOUD_BBOX_EDGE_INDEX_PAIRS) {
    pushWavyEdgeLineSegmentPairs(corners[ia]!, corners[ib]!, cameraWorldPos, segmentsPerEdge, waves, out);
  }
  return new Float32Array(out);
}

export function updateCloudBboxLineSegmentsGeometry(line: LineSegments, positions: Float32Array): void {
  const geom = line.geometry as BufferGeometry;
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.computeBoundingSphere();
  // 材质是 LineDashedMaterial（降级时画虚线），lineDistance 属性要随位置一起重算
  line.computeLineDistances();
}

/** 波浪盒 / 盒边的虚线节拍：按几何包围球直径的 1.5%（一条边约 40 段）；还没有几何时回 0（实线灰） */
export function dashSizeFromLineSegments(line: LineSegments): number {
  const radius = line.geometry.boundingSphere?.radius ?? 0;
  return Number.isFinite(radius) && radius > 0 ? radius * 2 * 0.015 : 0;
}

type CloudWavyRectangleOptions = {
  segmentsPerEdge: number;
  wavesPerEdge: number;
  amplitude: {
    ratio: number;
    minPx: number;
    maxPx: number;
  };
};

type CloudPoint2D = {
  x: number;
  y: number;
};

function buildCloudWavyRectanglePoints2D(
  cx: number,
  cy: number,
  width: number,
  height: number,
  options: CloudWavyRectangleOptions,
): CloudPoint2D[] {
  const safeWidth = Math.max(width, 12);
  const safeHeight = Math.max(height, 12);
  const halfWidth = safeWidth * 0.5;
  const halfHeight = safeHeight * 0.5;
  const segmentsPerEdge = Math.max(2, Math.floor(options.segmentsPerEdge));
  const wavesPerEdge = Math.max(1, Math.floor(options.wavesPerEdge));
  const corners = [
    { x: -halfWidth, y: -halfHeight }, // 上
    { x: halfWidth, y: -halfHeight }, // 右
    { x: halfWidth, y: halfHeight }, // 下
    { x: -halfWidth, y: halfHeight }, // 左
  ];
  const edgeNormals = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  const points: CloudPoint2D[] = [];

  for (let i = 0; i < corners.length; i += 1) {
    const start = corners[i]!;
    const end = corners[(i + 1) % corners.length]!;
    const normal = edgeNormals[i]!;
    const edgeLength = Math.hypot(end.x - start.x, end.y - start.y);
    const amp = clamp(edgeLength * options.amplitude.ratio, options.amplitude.minPx, options.amplitude.maxPx);
    for (let step = 0; step <= segmentsPerEdge; step += 1) {
      if (i > 0 && step === 0) {
        continue;
      }
      const t = step / segmentsPerEdge;
      const baseX = start.x + (end.x - start.x) * t;
      const baseY = start.y + (end.y - start.y) * t;
      const wave = Math.sin(t * Math.PI * 2 * wavesPerEdge + i * 0.35) * amp;
      points.push({
        x: cx + baseX + normal.x * wave,
        y: cy + baseY + normal.y * wave,
      });
    }
  }

  if (points.length > 0) {
    points.push({ ...points[0] });
  }

  return points;
}

export function computeCloudLayout(anchorScreen: ScreenPoint, screenOffset?: { x: number; y: number }, cloudSize?: { width: number; height: number }): CloudLayout {
  const width = clamp(cloudSize?.width ?? 120, 72, 220);
  const height = clamp(cloudSize?.height ?? 72, 48, 180);
  const offsetX = screenOffset?.x ?? width * 0.5 + 26;
  const offsetY = screenOffset?.y ?? -(height * 0.5 + 18);
  const cloudCenterX = anchorScreen.x + offsetX;
  const cloudCenterY = anchorScreen.y + offsetY;
  const markerX = cloudCenterX;
  const markerY = cloudCenterY;
  const labelAlign = offsetX >= 0 ? 'left' : 'right';
  const labelOffsetX = offsetX >= 0 ? width * 0.5 + 18 : -(width * 0.5 + 18);
  return {
    markerX,
    markerY,
    cloudCenterX,
    cloudCenterY,
    labelX: cloudCenterX + labelOffsetX,
    labelY: cloudCenterY,
    labelAlign,
  };
}
