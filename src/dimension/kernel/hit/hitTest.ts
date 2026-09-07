import { clamp } from '../vec';

import type { HitRegion, ScreenRect, Vec2 } from '../types';

export function distancePointToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - from[0], point[1] - from[1]);
  const t = clamp(
    ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(point[0] - (from[0] + dx * t), point[1] - (from[1] + dy * t));
}

export function distancePointToRect(point: Vec2, rect: ScreenRect): number {
  const dx = Math.max(rect.x - point[0], 0, point[0] - (rect.x + rect.width));
  const dy = Math.max(rect.y - point[1], 0, point[1] - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function distanceToHitRegion(point: Vec2, region: HitRegion): number {
  return region.kind === 'segment'
    ? distancePointToSegment(point, region.from, region.to)
    : distancePointToRect(point, region.rect);
}

export function isHitRegionWithinTolerance(
  point: Vec2,
  region: HitRegion,
  tolerancePx: number,
): boolean {
  const distance = distanceToHitRegion(point, region);
  return region.kind === 'segment'
    ? distance <= tolerancePx + region.widthPx / 2
    : distance <= tolerancePx;
}
