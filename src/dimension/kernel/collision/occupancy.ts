import type { ScreenRect } from '../types';

/**
 * Occupancy grid cell size. Algorithm structure, not a tunable: changing it
 * changes which pairs of labels are compared, hence the resolved positions.
 */
export const OCCUPANCY_GRID_PX = 64;

function cellEnd(origin: number, size: number): number {
  return size > 0
    ? Math.ceil((origin + size) / OCCUPANCY_GRID_PX) - 1
    : Math.floor(origin / OCCUPANCY_GRID_PX);
}

export type OccupancyCellRange = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

function cellRangeOf(rect: ScreenRect): OccupancyCellRange {
  return {
    minX: Math.floor(rect.x / OCCUPANCY_GRID_PX),
    minY: Math.floor(rect.y / OCCUPANCY_GRID_PX),
    maxX: cellEnd(rect.x, rect.width),
    maxY: cellEnd(rect.y, rect.height),
  };
}

/**
 * Occupied label rectangles on a 64 px grid. With `bounds` (the viewport)
 * the grid only covers the viewport padded by one cell: a label that
 * projects beyond it — a vertex near the camera plane puts label bounds in
 * the 1e5–1e9 px range, which registered cell by cell is 1e7–1e10 cells
 * (`RangeError: Map maximum size exceeded` / a 4 GB heap, all-pipes sweep
 * 2026-09-14) — neither claims space nor collides, and a label straddling
 * the edge is registered in its on-screen cells only. A non-finite bound
 * yields an empty range.
 */
export class LabelOccupancy {
  private readonly columns = new Map<number, Map<number, ScreenRect[]>>();
  private readonly clip: OccupancyCellRange | null;

  constructor(bounds?: ScreenRect) {
    this.clip = bounds
      ? cellRangeOf({
        x: bounds.x - OCCUPANCY_GRID_PX,
        y: bounds.y - OCCUPANCY_GRID_PX,
        width: bounds.width + OCCUPANCY_GRID_PX * 2,
        height: bounds.height + OCCUPANCY_GRID_PX * 2,
      })
      : null;
  }

  private cellRange(rect: ScreenRect): OccupancyCellRange {
    const range = cellRangeOf(rect);
    if (!this.clip) return range;
    return {
      minX: Math.max(range.minX, this.clip.minX),
      minY: Math.max(range.minY, this.clip.minY),
      maxX: Math.min(range.maxX, this.clip.maxX),
      maxY: Math.min(range.maxY, this.clip.maxY),
    };
  }

  insert(rect: ScreenRect): void {
    const { minX, minY, maxX, maxY } = this.cellRange(rect);
    for (let x = minX; x <= maxX; x += 1) {
      let column = this.columns.get(x);
      if (!column) {
        column = new Map();
        this.columns.set(x, column);
      }
      for (let y = minY; y <= maxY; y += 1) {
        const entries = column.get(y);
        if (entries) entries.push(rect);
        else column.set(y, [rect]);
      }
    }
  }

  overlaps(rect: ScreenRect): boolean {
    return this.overlapsAt(rect, 0, 0);
  }

  overlapsAt(rect: ScreenRect, offsetX: number, offsetY: number): boolean {
    const rectX = rect.x + offsetX;
    const rectY = rect.y + offsetY;
    const { minX, minY, maxX, maxY } = this.cellRange({
      x: rectX,
      y: rectY,
      width: rect.width,
      height: rect.height,
    });
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const column = this.columns.get(cellX);
      if (!column) continue;
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        for (const occupied of column.get(cellY) ?? []) {
          if (
            rectX < occupied.x + occupied.width &&
            rectX + rect.width > occupied.x &&
            rectY < occupied.y + occupied.height &&
            rectY + rect.height > occupied.y
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
