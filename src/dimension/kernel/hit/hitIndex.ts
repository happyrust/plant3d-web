import {
  distanceToHitRegion,
  isHitRegionWithinTolerance,
} from './hitTest';

import type {
  HitRegion,
  LayoutResult,
  ScreenRect,
  Vec2,
} from '../types';

export type HitTarget = Readonly<{
  dimensionId: string;
  part: string;
  distancePx: number;
}>;

export type HitIndex = {
  hitTest(point: Vec2, tolerancePx: number): HitTarget | null;
}

type IndexedRegion = Readonly<{
  key: number;
  dimensionId: string;
  region: HitRegion;
}>;

function boundsOf(region: HitRegion): ScreenRect {
  if (region.kind === 'rect') return region.rect;
  const halfWidth = region.widthPx / 2;
  return {
    x: Math.min(region.from[0], region.to[0]) - halfWidth,
    y: Math.min(region.from[1], region.to[1]) - halfWidth,
    width: Math.abs(region.to[0] - region.from[0]) + halfWidth * 2,
    height: Math.abs(region.to[1] - region.from[1]) + halfWidth * 2,
  };
}

function partPriority(region: HitRegion): number {
  if (region.kind === 'rect') return 0;
  switch (region.part) {
    case 'arrow':
      return 1;
    case 'dimension':
    case 'arc':
    case 'leader':
      return 2;
    case 'extension':
    case 'projection':
      return 3;
    default:
      return 4;
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const HIT_INDEX_CELL_PX = 64;

type CellRange = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

/**
 * Restrict a cell range to the indexed area. A projected region whose
 * vertex lies near the camera plane (a close-up, or the default camera of a
 * pipe whose MBD records arrive before its geometry) has coordinates in the
 * 1e5–1e9 px range; registering it cell by cell would take 1e7–1e10 cells
 * (`RangeError: Map maximum size exceeded`, or a 4 GB heap — all-pipes
 * sweep, 2026-09-14). Only the cells inside the area can ever be queried, so
 * the rest are dropped; a non-finite coordinate ends up as an empty range.
 */
function clampCellRange(range: CellRange, clip: CellRange | null): CellRange {
  if (!clip) return range;
  return {
    minX: Math.max(range.minX, clip.minX),
    minY: Math.max(range.minY, clip.minY),
    maxX: Math.min(range.maxX, clip.maxX),
    maxY: Math.min(range.maxY, clip.maxY),
  };
}

/**
 * Spatial index over the hit regions of a layout batch, on a square grid of
 * `cellSizePx`. With `bounds` (the viewport) a region is registered only in
 * the cells it covers inside the viewport padded by one cell, so hit tests
 * for on-screen points with a tolerance up to `cellSizePx` stay exact while
 * regions that project far off-screen cost nothing; without it every cell a
 * region covers is registered.
 */
export function buildHitIndex(
  layouts: readonly LayoutResult[],
  cellSizePx = HIT_INDEX_CELL_PX,
  bounds?: ScreenRect,
): HitIndex {
  if (!Number.isFinite(cellSizePx) || cellSizePx <= 0) {
    throw new RangeError('Hit-index cell size must be positive');
  }

  const cells = new Map<string, IndexedRegion[]>();
  let nextKey = 0;
  const rawCellRange = (rect: ScreenRect): CellRange => ({
    minX: Math.floor(rect.x / cellSizePx),
    minY: Math.floor(rect.y / cellSizePx),
    maxX: Math.floor((rect.x + Math.max(rect.width, 0)) / cellSizePx),
    maxY: Math.floor((rect.y + Math.max(rect.height, 0)) / cellSizePx),
  });
  const clip = bounds
    ? rawCellRange({
      x: bounds.x - cellSizePx,
      y: bounds.y - cellSizePx,
      width: bounds.width + cellSizePx * 2,
      height: bounds.height + cellSizePx * 2,
    })
    : null;
  const cellRange = (rect: ScreenRect): CellRange => clampCellRange(rawCellRange(rect), clip);

  for (const layout of layouts) {
    for (const region of layout.hitRegions) {
      const indexed: IndexedRegion = {
        key: nextKey,
        dimensionId: layout.dimensionId,
        region,
      };
      nextKey += 1;
      const range = cellRange(boundsOf(region));
      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let x = range.minX; x <= range.maxX; x += 1) {
          const key = `${x}:${y}`;
          const entries = cells.get(key);
          if (entries) entries.push(indexed);
          else cells.set(key, [indexed]);
        }
      }
    }
  }

  return {
    hitTest(point: Vec2, tolerancePx: number): HitTarget | null {
      const tolerance = Math.max(0, tolerancePx);
      const range = cellRange({
        x: point[0] - tolerance,
        y: point[1] - tolerance,
        width: tolerance * 2,
        height: tolerance * 2,
      });
      const seen = new Set<number>();
      const candidates: {
        indexed: IndexedRegion;
        distancePx: number;
        priority: number;
      }[] = [];

      for (let y = range.minY; y <= range.maxY; y += 1) {
        for (let x = range.minX; x <= range.maxX; x += 1) {
          for (const indexed of cells.get(`${x}:${y}`) ?? []) {
            if (seen.has(indexed.key)) continue;
            seen.add(indexed.key);
            if (!isHitRegionWithinTolerance(point, indexed.region, tolerance)) continue;
            candidates.push({
              indexed,
              distancePx: distanceToHitRegion(point, indexed.region),
              priority: partPriority(indexed.region),
            });
          }
        }
      }

      candidates.sort(
        (a, b) =>
          a.priority - b.priority ||
          a.distancePx - b.distancePx ||
          compareIds(a.indexed.dimensionId, b.indexed.dimensionId) ||
          compareIds(a.indexed.region.part, b.indexed.region.part),
      );
      const winner = candidates[0];
      return winner
        ? {
          dimensionId: winner.indexed.dimensionId,
          part: winner.indexed.region.part,
          distancePx: winner.distancePx,
        }
        : null;
    },
  };
}
