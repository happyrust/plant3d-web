import { EPSILON } from '../vec';

import type { ScreenLine, Vec2 } from '../types';

export function makeOpenArrow(
  tip: Vec2,
  inwardDirection: Vec2,
  lengthPx: number,
  halfAngleDeg: number,
  styleRole: string,
): readonly [ScreenLine, ScreenLine] {
  const halfAngleRad = (halfAngleDeg * Math.PI) / 180;
  const magnitude = Math.hypot(inwardDirection[0], inwardDirection[1]);
  if (magnitude <= EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector');
  }
  const unitX = inwardDirection[0] / magnitude;
  const unitY = inwardDirection[1] / magnitude;
  const sideOffset = lengthPx * Math.tan(halfAngleRad);
  const makeLeg = (side: 1 | -1): ScreenLine => {
    return {
      kind: 'line',
      from: tip,
      to: [
        tip[0] + unitX * lengthPx - unitY * sideOffset * side,
        tip[1] + unitY * lengthPx + unitX * sideOffset * side,
      ],
      part: 'arrow',
      styleRole,
    };
  };

  return [makeLeg(1), makeLeg(-1)];
}
