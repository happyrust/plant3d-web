import { EPSILON } from '../vec';

import type { ScreenRect, Vec2 } from '../types';

export type TrimResult = Readonly<{
  segments: readonly Readonly<{ from: Vec2; to: Vec2 }>[];
  outsideSide: -1 | 0 | 1;
}>;

function pointAt(from: Vec2, direction: Vec2, t: number): Vec2 {
  return [from[0] + direction[0] * t, from[1] + direction[1] * t];
}

function hasLength(from: Vec2, to: Vec2): boolean {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) > EPSILON;
}

export function trimLineAgainstRect(
  from: Vec2,
  to: Vec2,
  rect: ScreenRect,
  extend: boolean,
): TrimResult {
  const direction: Vec2 = [to[0] - from[0], to[1] - from[1]];
  if (Math.hypot(direction[0], direction[1]) <= EPSILON) {
    return { segments: [], outsideSide: 0 };
  }

  const minX = Math.min(rect.x, rect.x + rect.width);
  const maxX = Math.max(rect.x, rect.x + rect.width);
  const minY = Math.min(rect.y, rect.y + rect.height);
  const maxY = Math.max(rect.y, rect.y + rect.height);
  let entry = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;

  const applySlab = (origin: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) <= EPSILON) return origin >= min - EPSILON && origin <= max + EPSILON;
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    return entry <= exit + EPSILON;
  };

  if (
    !applySlab(from[0], direction[0], minX, maxX) ||
    !applySlab(from[1], direction[1], minY, maxY)
  ) {
    return {
      segments: hasLength(from, to) ? [{ from, to }] : [],
      outsideSide: 0,
    };
  }

  const entryInside = entry >= 0 && entry <= 1;
  const exitInside = exit >= 0 && exit <= 1;
  if (entryInside && exitInside) {
    const firstEnd = pointAt(from, direction, entry);
    const secondStart = pointAt(from, direction, exit);
    return {
      segments: [
        ...(hasLength(from, firstEnd) ? [{ from, to: firstEnd }] : []),
        ...(hasLength(secondStart, to) ? [{ from: secondStart, to }] : []),
      ],
      outsideSide: 0,
    };
  }
  if (entryInside) {
    const end = pointAt(from, direction, entry);
    return {
      segments: hasLength(from, end) ? [{ from, to: end }] : [],
      outsideSide: 0,
    };
  }
  if (exitInside) {
    const start = pointAt(from, direction, exit);
    return {
      segments: hasLength(start, to) ? [{ from: start, to }] : [],
      outsideSide: 0,
    };
  }
  if (exit < 0) {
    const extendedFrom = extend ? pointAt(from, direction, exit) : from;
    return {
      segments: hasLength(extendedFrom, to) ? [{ from: extendedFrom, to }] : [],
      outsideSide: 1,
    };
  }
  if (entry > 1) {
    const extendedTo = extend ? pointAt(from, direction, entry) : to;
    return {
      segments: hasLength(from, extendedTo) ? [{ from, to: extendedTo }] : [],
      outsideSide: -1,
    };
  }

  return { segments: [], outsideSide: 0 };
}
