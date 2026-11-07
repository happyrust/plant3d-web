import { describe, expect, it } from 'vitest';

import { rectsOverlapArea } from './obstacleGeometry';
import { createRectGrid } from './rectGrid';

import type { RectGrid } from './rectGrid';
import type { ScreenRect } from '../types';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const area: ScreenRect = { x: 0, y: 0, width: 400, height: 300 };
const insertRect = (grid: RectGrid, index: number, rect: ScreenRect): void =>
  grid.insert(index, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
const queryRect = (grid: RectGrid, rect: ScreenRect): number[] =>
  [...grid.query(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)];

describe('createRectGrid', () => {
  it('answers every item that overlaps the query, ascending and once, on screen or far beyond it', () => {
    const next = random(7);
    const rect = (spread: number, size: number): ScreenRect => ({
      x: (next() - 0.3) * spread,
      y: (next() - 0.3) * spread,
      width: next() * size,
      height: next() * size,
    });
    const items = [
      ...Array.from({ length: 300 }, () => rect(600, 120)),
      ...Array.from({ length: 40 }, () => rect(1e6, 5e5)),
    ];
    const grid = createRectGrid(area);
    items.forEach((item, index) => insertRect(grid, index, item));
    for (let probe = 0; probe < 200; probe += 1) {
      const query = probe % 4 === 0 ? rect(1e6, 2e5) : rect(600, 90);
      const answer = queryRect(grid, query);
      expect(answer).toEqual([...new Set(answer)].sort((a, b) => a - b));
      const overlapping = items
        .map((item, index) => (rectsOverlapArea(query, item) > 0 ? index : -1))
        .filter(index => index >= 0);
      expect(answer).toEqual(expect.arrayContaining(overlapping));
    }
  });

  it('keeps a near-camera item on the cells it crosses instead of registering billions', () => {
    const grid = createRectGrid(area);
    insertRect(grid, 0, { x: 100, y: 100, width: 1e9, height: 20 });
    insertRect(grid, 1, { x: -1e9, y: -1e9, width: 10, height: 10 });
    expect(queryRect(grid, { x: 350, y: 110, width: 10, height: 5 })).toEqual([0]);
    expect(queryRect(grid, { x: 350, y: 200, width: 10, height: 5 })).toEqual([]);
    expect(queryRect(grid, { x: -5e8, y: -5e8, width: 10, height: 10 })).toEqual([1]);
  });

  it('answers every item without an area or for a non-finite query, and never a NaN item', () => {
    const items: ScreenRect[] = [
      { x: 10, y: 10, width: 5, height: 5 },
      { x: 300, y: 200, width: 5, height: 5 },
      { x: Number.NaN, y: 10, width: 5, height: 5 },
    ];
    const plain = createRectGrid(null);
    const grid = createRectGrid(area);
    items.forEach((item, index) => {
      insertRect(plain, index, item);
      insertRect(grid, index, item);
    });
    const query = { x: 0, y: 0, width: 20, height: 20 };
    expect(queryRect(plain, query)).toEqual([0, 1, 2]);
    expect(queryRect(grid, query)).toEqual([0]);
    expect(queryRect(grid, { ...query, x: Number.POSITIVE_INFINITY })).toEqual([0, 1, 2]);
  });
});
