export const RECT_GRID_CELL_PX = 64;

/** Above this many cells the grid answers every item instead (a degenerate area). */
const MAX_CELLS = 1 << 20;

/**
 * Item indices on a square screen grid, answering "which items could overlap
 * this extent". Items and queries are closed extents `[minX, maxX] × [minY,
 * maxY]`, given as the caller's own overlap test computes them, so two that
 * overlap there always share a cell. The grid covers `area` padded by one
 * cell; an extent beyond it is clamped onto the border cells instead of being
 * dropped (projected coordinates near the camera plane reach 1e5–1e9 px, see
 * `hit/hitIndex.ts`). Without an area, or for a query with a non-finite
 * coordinate, every item is an answer; an item with a NaN coordinate answers
 * no finite query.
 */
export type RectGrid = Readonly<{
  insert(index: number, minX: number, minY: number, maxX: number, maxY: number): void;
  /** Ascending, each index once; the view is only valid until the next query. */
  query(minX: number, minY: number, maxX: number, maxY: number): Int32Array;
}>;

export type RectGridArea = Readonly<{ x: number; y: number; width: number; height: number }>;

export function createRectGrid(area: RectGridArea | null, cellSizePx = RECT_GRID_CELL_PX): RectGrid {
  if (!Number.isFinite(cellSizePx) || cellSizePx <= 0) {
    throw new RangeError('Rect-grid cell size must be positive');
  }
  const minCellX = area ? Math.floor(area.x / cellSizePx) - 1 : 0;
  const minCellY = area ? Math.floor(area.y / cellSizePx) - 1 : 0;
  const maxCellX = area ? Math.floor((area.x + Math.max(area.width, 0)) / cellSizePx) + 1 : 0;
  const maxCellY = area ? Math.floor((area.y + Math.max(area.height, 0)) / cellSizePx) + 1 : 0;
  const columns = maxCellX - minCellX + 1;
  const rows = maxCellY - minCellY + 1;
  const gridded = area !== null && Number.isFinite(columns) && Number.isFinite(rows)
    && columns * rows <= MAX_CELLS;
  const cells: (number[] | undefined)[] = gridded ? new Array(columns * rows) : [];
  const all: number[] = [];
  let seen = new Uint32Array(64);
  let stamp = 0;
  let buffer = new Int32Array(64);

  // A NaN coordinate makes an empty cell range.
  const cellX = (value: number): number => Math.min(Math.max(Math.floor(value / cellSizePx), minCellX), maxCellX);
  const cellY = (value: number): number => Math.min(Math.max(Math.floor(value / cellSizePx), minCellY), maxCellY);
  const push = (count: number, index: number): number => {
    if (count === buffer.length) {
      const grown = new Int32Array(buffer.length * 2);
      grown.set(buffer);
      buffer = grown;
    }
    buffer[count] = index;
    return count + 1;
  };

  return {
    insert(index, minX, minY, maxX, maxY) {
      all.push(index);
      if (index >= seen.length) {
        const grown = new Uint32Array(Math.max(index + 1, seen.length * 2));
        grown.set(seen);
        seen = grown;
      }
      if (!gridded) return;
      const x0 = cellX(minX);
      const x1 = cellX(maxX);
      const y1 = cellY(maxY);
      for (let y = cellY(minY); y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const cell = (y - minCellY) * columns + (x - minCellX);
          const list = cells[cell];
          if (list) list.push(index);
          else cells[cell] = [index];
        }
      }
    },
    query(minX, minY, maxX, maxY) {
      stamp += 1;
      if (stamp === 0xffffffff) {
        seen.fill(0);
        stamp = 1;
      }
      let count = 0;
      const finite = Number.isFinite(minX) && Number.isFinite(minY)
        && Number.isFinite(maxX) && Number.isFinite(maxY);
      if (!gridded || !finite) {
        for (const index of all) count = push(count, index);
      } else {
        const x0 = cellX(minX);
        const x1 = cellX(maxX);
        const y1 = cellY(maxY);
        for (let y = cellY(minY); y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const list = cells[(y - minCellY) * columns + (x - minCellX)];
            if (!list) continue;
            for (const index of list) {
              if (seen[index] === stamp) continue;
              seen[index] = stamp;
              count = push(count, index);
            }
          }
        }
      }
      return buffer.subarray(0, count).sort();
    },
  };
}
