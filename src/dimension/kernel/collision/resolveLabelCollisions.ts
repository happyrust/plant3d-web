import { translateRect } from '../geometry/screenGeometry';

import type {
  HitRegion,
  LayoutPrimitive,
  LayoutResult,
  ScreenLine,
  ScreenRect,
  Vec2,
} from '../types';

const GRID_SIZE_PX = 64;
const CANDIDATE_STEP_PX = 8;
const CANDIDATE_COUNT = 8;
const DIRECTIONS: readonly Vec2[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cellEnd(origin: number, size: number): number {
  return size > 0
    ? Math.ceil((origin + size) / GRID_SIZE_PX) - 1
    : Math.floor(origin / GRID_SIZE_PX);
}

class LabelOccupancy {
  private readonly columns = new Map<number, Map<number, ScreenRect[]>>();

  insert(rect: ScreenRect): void {
    const minX = Math.floor(rect.x / GRID_SIZE_PX);
    const minY = Math.floor(rect.y / GRID_SIZE_PX);
    const maxX = cellEnd(rect.x, rect.width);
    const maxY = cellEnd(rect.y, rect.height);
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
    const minX = Math.floor(rectX / GRID_SIZE_PX);
    const minY = Math.floor(rectY / GRID_SIZE_PX);
    const maxX = cellEnd(rectX, rect.width);
    const maxY = cellEnd(rectY, rect.height);
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

function pointInRect(point: Vec2, rect: ScreenRect): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

function movePoint(point: Vec2, offset: Vec2): Vec2 {
  return [point[0] + offset[0], point[1] + offset[1]];
}

function moveConnectedLine(line: ScreenLine, originalBounds: ScreenRect, offset: Vec2): ScreenLine {
  return {
    ...line,
    from: pointInRect(line.from, originalBounds) ? movePoint(line.from, offset) : line.from,
    to: pointInRect(line.to, originalBounds) ? movePoint(line.to, offset) : line.to,
  };
}

function moveConnectedHitRegion(
  region: HitRegion,
  originalBounds: ScreenRect,
  offset: Vec2,
): HitRegion {
  if (region.kind === 'rect' && region.part === 'label') {
    return { ...region, rect: translateRect(region.rect, offset) };
  }
  if (region.kind === 'segment' && region.part === 'leader') {
    return {
      ...region,
      from: pointInRect(region.from, originalBounds)
        ? movePoint(region.from, offset)
        : region.from,
      to: pointInRect(region.to, originalBounds) ? movePoint(region.to, offset) : region.to,
    };
  }
  return region;
}

function moveLabel(result: LayoutResult, offset: Vec2): LayoutResult {
  const originalBounds = result.labelBounds;
  const originalCenter: Vec2 = [
    originalBounds.x + originalBounds.width / 2,
    originalBounds.y + originalBounds.height / 2,
  ];
  const movedCenter = movePoint(originalCenter, offset);
  let hasConnectedLeader = false;
  const primitives: LayoutPrimitive[] = result.primitives.map((primitive) => {
    if (primitive.kind === 'glyph-run') {
      return {
        ...primitive,
        origin: movePoint(primitive.origin, offset),
        bounds: translateRect(primitive.bounds, offset),
      };
    }
    if (
      primitive.kind === 'line' &&
      primitive.part === 'leader' &&
      (pointInRect(primitive.from, originalBounds) || pointInRect(primitive.to, originalBounds))
    ) {
      hasConnectedLeader = true;
      return moveConnectedLine(primitive, originalBounds, offset);
    }
    return primitive;
  });
  const hitRegions = result.hitRegions.map((region) =>
    moveConnectedHitRegion(region, originalBounds, offset),
  );

  if (!hasConnectedLeader) {
    const glyphIndex = primitives.findIndex((primitive) => primitive.kind === 'glyph-run');
    const glyph = primitives[glyphIndex];
    const leader: ScreenLine = {
      kind: 'line',
      from: originalCenter,
      to: movedCenter,
      part: 'leader',
      styleRole: glyph?.styleRole ?? 'normal',
    };
    primitives.splice(glyphIndex < 0 ? primitives.length : glyphIndex, 0, leader);
    const labelHitIndex = hitRegions.findIndex(
      (region) => region.kind === 'rect' && region.part === 'label',
    );
    hitRegions.splice(labelHitIndex < 0 ? hitRegions.length : labelHitIndex, 0, {
      kind: 'segment',
      from: leader.from,
      to: leader.to,
      widthPx: 1,
      part: 'leader',
    });
  }

  return {
    ...result,
    primitives,
    hitRegions,
    labelBounds: translateRect(originalBounds, offset),
  };
}

export function resolveLabelCollisions(
  inputs: readonly LayoutResult[],
): readonly LayoutResult[] {
  const occupancy = new LabelOccupancy();
  const results = [...inputs];
  for (const result of inputs) {
    if (result.labelPinned) occupancy.insert(result.labelBounds);
  }

  const automatic = inputs
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !result.labelPinned)
    .sort((a, b) => compareIds(a.result.dimensionId, b.result.dimensionId) || a.index - b.index);

  for (const { result, index } of automatic) {
    if (!occupancy.overlaps(result.labelBounds)) {
      occupancy.insert(result.labelBounds);
      continue;
    }

    let resolved: LayoutResult | undefined;
    for (let candidate = 0; candidate < CANDIDATE_COUNT; candidate += 1) {
      const direction = DIRECTIONS[candidate % DIRECTIONS.length];
      const distance = (candidate + 1) * CANDIDATE_STEP_PX;
      const offset = [direction[0] * distance, direction[1] * distance] as const;
      if (occupancy.overlapsAt(result.labelBounds, offset[0], offset[1])) continue;
      resolved = moveLabel(result, offset);
      break;
    }

    if (resolved) {
      results[index] = resolved;
      occupancy.insert(resolved.labelBounds);
    } else {
      occupancy.insert(result.labelBounds);
    }
  }

  return results;
}
