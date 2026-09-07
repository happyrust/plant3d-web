import { LffFont } from './glyph/lffParser';

import type { ViewportProjector } from './projector';
import type { Vec3 } from './types';

const TEST_LFF = [
  '# LetterSpacing: 1',
  '# WordSpacing: 4',
  '[0041] A',
  '0,0;1,10;2,0',
  '',
  '[0068] h',
  '0,0;0,12;2,12',
  '',
  '[0070] p',
  '0,-3;0,7;2,7',
  '',
  '[fffd] replacement',
  '0,0;1,10',
  '',
].join('\n');

export function createTestFont(): LffFont {
  return LffFont.fromText(TEST_LFF);
}

export function createTestProjector(pixelsPerMetre = 100): ViewportProjector {
  return {
    widthCssPx: 400,
    heightCssPx: 400,
    dpr: 2,
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, -1],
    project(point: Vec3) {
      return {
        x: 200 + point[0] * pixelsPerMetre,
        y: 200 - point[1] * pixelsPerMetre,
        depth: point[2],
      };
    },
    unproject(point) {
      return [
        (point.x - 200) / pixelsPerMetre,
        (200 - point.y) / pixelsPerMetre,
        point.depth,
      ];
    },
    worldPerPixelAt() {
      return 1 / pixelsPerMetre;
    },
  };
}

export function roundNumbers<T>(value: T, digits = 6): T {
  if (typeof value === 'number') {
    const factor = 10 ** digits;
    return (Math.round(value * factor) / factor) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => roundNumbers(entry, digits)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, roundNumbers(entry, digits)]),
    ) as T;
  }
  return value;
}
