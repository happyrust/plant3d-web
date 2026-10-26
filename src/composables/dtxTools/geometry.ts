/**
 * 小工具与画布 ↔ 世界坐标换算。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { Vector2, Vector3 } from 'three';

import type { ScreenPoint } from './types';
import type { Vec3 } from '@/composables/useToolStore';

export function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export const IDENTITY_MATRIX_ELEMENTS: readonly number[] = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export const EMPTY_BOUNDS: readonly number[] = Object.freeze([]);
/** 文字框还没排版（offsetWidth 为 0，如 happy-dom / 首帧）时用的兜底尺寸，只影响布局输入，不写回记录 */
const FALLBACK_LABEL_SIZE_PX = Object.freeze({ width: 240, height: 96 });

export function measureLabelSize(el: HTMLElement): { width: number; height: number } {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!(width > 1) || !(height > 1)) return { ...FALLBACK_LABEL_SIZE_PX };
  return { width, height };
}

export function escapeAnnotationLabelText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

export function vec3ToTuple(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

export function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const p of points) {
    const x = p[0];
    const y = p[1];
    const z = p[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) return null;
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

export function parseRefnoFromDtxObjectId(objectId: string): string | null {
  if (!objectId || !objectId.startsWith('o:')) return null;
  const parts = objectId.split(':');
  return parts.length >= 3 ? (parts[1] ?? null) : null;
}

export function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(e.clientX - rect.left, e.clientY - rect.top);
}

export function worldToOverlay(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): { x: number; y: number; visible: boolean } {
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  const visible = v.z >= -1 && v.z <= 1;

  const overlayRect = overlay.getBoundingClientRect();
  return { x: x + (rect.left - overlayRect.left), y: y + (rect.top - overlayRect.top), visible };
}

export function worldToOverlayPoint(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  const overlayRect = overlay.getBoundingClientRect();
  return {
    x: x + (rect.left - overlayRect.left),
    y: y + (rect.top - overlayRect.top),
    visible: v.z >= -1 && v.z <= 1,
    ndcZ: v.z,
  };
}

export function overlayToWorld(camera: any, canvas: HTMLCanvasElement, overlay: HTMLElement, x: number, y: number, ndcZ: number): Vector3 {
  const rect = canvas.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const localX = x - (rect.left - overlayRect.left);
  const localY = y - (rect.top - overlayRect.top);
  const ndc = new Vector3(
    (localX / rect.width) * 2 - 1,
    -((localY / rect.height) * 2 - 1),
    ndcZ,
  );
  return ndc.unproject(camera);
}
