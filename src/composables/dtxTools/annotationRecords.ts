/**
 * 批注记录构造与文字批注点击状态机。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { Box3, Vector3 } from 'three';

import { computeCloudLayout } from './cloudGeometry';
import { clamp, nowId, vec3ToTuple } from './geometry';

import type { ScreenPoint, TextAnnotationMarkerClickResult, TextAnnotationMarkerClickState } from './types';
import type { CloudAnnotationRecord, CloudElementBinding, Obb, RectAnnotationRecord, Vec3 } from '@/composables/useToolStore';
import type { CloudLabelLayoutV1, RegionV1 } from '@/review/domain/cloudRegion';
import type { DTXLayer } from '@/utils/three/dtx';

export function createCloudAnnotationRecordFromAnchorAndMarquee(params: {
  id?: string
  objectIds: string[]
  refnos?: string[]
  anchorWorldPos: Vec3
  anchorRefno?: string
  anchorScreen: ScreenPoint
  rect: { x1: number; y1: number; x2: number; y2: number }
  title: string
  description?: string
  createdAt?: number
  projectOverlayToWorld: (x: number, y: number, ndcZ: number) => Vec3
  /** 目标元素合并 AABB，供三维包围盒云线使用 */
  selectionBbox?: { min: Vec3; max: Vec3 }
  /** 带角色的关联结构；缺省时由 refnos / anchorRefno 归一推导 */
  bindings?: CloudElementBinding[]
  /** P1：文字框像素意图布局；给了就写进记录（`leaderEndWorldPos` 仍按旧逻辑双写） */
  labelLayoutV1?: CloudLabelLayoutV1
}): CloudAnnotationRecord {
  const marqueeCenter = {
    x: (params.rect.x1 + params.rect.x2) * 0.5,
    y: (params.rect.y1 + params.rect.y2) * 0.5,
  };
  const cloudSize = {
    width: clamp(params.rect.x2 - params.rect.x1, 72, 220),
    height: clamp(params.rect.y2 - params.rect.y1, 48, 180),
  };
  const screenOffset = {
    x: marqueeCenter.x - params.anchorScreen.x,
    y: marqueeCenter.y - params.anchorScreen.y,
  };
  const cloudLayout = computeCloudLayout(params.anchorScreen, screenOffset, cloudSize);
  const leaderEndWorldPos = params.projectOverlayToWorld(
    cloudLayout.labelX,
    cloudLayout.labelY,
    params.anchorScreen.ndcZ,
  );

  return {
    id: params.id ?? nowId('cloud'),
    objectIds: [...params.objectIds],
    anchorWorldPos: [...params.anchorWorldPos],
    anchorRefno: params.anchorRefno,
    leaderEndWorldPos,
    selectionBbox: params.selectionBbox
      ? { min: [...params.selectionBbox.min] as Vec3, max: [...params.selectionBbox.max] as Vec3 }
      : undefined,
    screenOffset,
    cloudSize,
    visible: true,
    title: params.title,
    description: params.description ?? '',
    createdAt: params.createdAt ?? Date.now(),
    refnos: params.refnos ? [...params.refnos] : [...params.objectIds],
    bindings: params.bindings ? [...params.bindings] : undefined,
    ...(params.labelLayoutV1
      ? {
        labelLayoutV1: {
          version: 1 as const,
          anchor: { ...params.labelLayoutV1.anchor, uv: [...params.labelLayoutV1.anchor.uv] as [number, number] },
          offsetPx: { ...params.labelLayoutV1.offsetPx },
        },
      }
      : {}),
  };
}

export function getDefaultTextAnnotationLabelWorldPos(worldPos: Vec3): Vec3 {
  return [
    worldPos[0] + 0.9,
    worldPos[1] + 0.6,
    worldPos[2] + 0.7,
  ];
}

export function shouldRenderTextAnnotationCard(collapsed?: boolean): boolean {
  return collapsed !== true;
}

export function toggleTextAnnotationCollapsed(collapsed?: boolean): boolean {
  return collapsed !== true;
}

/** @deprecated Use `resolveTextAnnotationMarkerSingleClickAction` instead. Kept for backward compat. */
export function resolveTextAnnotationMarkerClickAction(
  _prevState: TextAnnotationMarkerClickState | null,
  _annotationId: string,
  _timestamp: number,
  collapsed?: boolean,
  _thresholdMs = 400,
): TextAnnotationMarkerClickResult {
  return resolveTextAnnotationMarkerSingleClickAction(collapsed);
}

export function resolveTextAnnotationMarkerSingleClickAction(
  collapsed?: boolean,
): TextAnnotationMarkerClickResult {
  if (collapsed === true) {
    return {
      activate: true,
      nextCollapsed: false,
      nextState: null,
    };
  }

  return {
    activate: true,
    nextCollapsed: null,
    nextState: null,
  };
}

export function resolveTextAnnotationMarkerDoubleClickAction(
  collapsed?: boolean,
): TextAnnotationMarkerClickResult {
  return {
    activate: true,
    nextCollapsed: toggleTextAnnotationCollapsed(collapsed),
    nextState: null,
  };
}

export function isDtxInteractionReady(
  layer: Pick<DTXLayer, 'getStats' | 'getVisibleObjectIds' | 'objectCount'> | null | undefined,
): boolean {
  if (!layer) return false;
  try {
    const stats = layer.getStats();
    if (stats.compiled === true) return true;
    if (stats.totalObjects > 0) return true;
    if (layer.objectCount > 0) return true;
    return layer.getVisibleObjectIds().length > 0;
  } catch {
    return false;
  }
}

export function createRectAnnotationRecordFromObb(params: {
  id?: string
  objectIds: string[]
  refnos?: string[]
  obb: Obb
  title: string
  description?: string
  createdAt?: number
  /** P3 共享范围体（方案 §7）：给了就写进记录；`obb` 仍按旧含义双写 */
  regionV1?: RegionV1
}): RectAnnotationRecord {
  const center = new Vector3(...params.obb.center);
  const halfSize = new Vector3(...params.obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const leaderEnd = center.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));

  return {
    id: params.id ?? nowId('rect'),
    objectIds: [...params.objectIds],
    obb: params.obb,
    anchorWorldPos: [...params.obb.center] as Vec3,
    leaderEndWorldPos: vec3ToTuple(leaderEnd),
    visible: true,
    title: params.title,
    description: params.description ?? '',
    createdAt: params.createdAt ?? Date.now(),
    refnos: params.refnos ? [...params.refnos] : [...params.objectIds],
    ...(params.regionV1 ? { regionV1: params.regionV1 } : {}),
  };
}

export function computeAabbObbFromBox3(box: Box3): Obb {
  const center = new Vector3();
  box.getCenter(center);
  const size = new Vector3();
  box.getSize(size);
  const half = size.multiplyScalar(0.5);

  const corners: Vec3[] = [
    [box.min.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.max.z],
    [box.min.x, box.max.y, box.max.z],
  ];

  return {
    center: [center.x, center.y, center.z],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfSize: [half.x, half.y, half.z],
    corners: corners as any,
  };
}

export function topCenterFromBox3(box: Box3): Vector3 {
  const center = new Vector3();
  box.getCenter(center);
  return new Vector3(center.x, center.y, box.max.z);
}
