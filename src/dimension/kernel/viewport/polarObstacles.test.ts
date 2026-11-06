import { describe, expect, it } from 'vitest';

import { arcDirection } from '../layout/polar/numeric/arc';
import { polarArcFrame } from '../layout/polar/place/result';

import { polarCandidateObstacle, pointToPolarCoords, siblingAnchorObstacle } from './polarObstacles';

import type { PolarCandidate } from '../layout/polar/place/types';
import type { PolarReference } from '../layout/polar/reference/types';

/**
 * Same `VERTICAL` fixture as `place/place.test.ts` / `place/dirAndCha.test.ts`:
 * axis = up, angle 0° = north `[0,1,0]`, angle 90° = west `[-1,0,0]`
 * (`arcDirection`'s right-handed basis about `+z` from `plane.zero`).
 */
const VERTICAL: PolarReference = {
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  plane: { zero: [0, 1, 0], normal: [0, 0, 1] },
  showDir: [0, 1, 0],
  horiDir: [0, 1, 0],
  up: [0, 0, 1],
  mainDimDir: null,
  disRange: [0, 10],
  basicRadius: 0.1,
  isInstPipe: false,
  kind: 'iso-sheet',
};

function candidateAt(
  dis: number,
  angle: number,
  radius: number,
): PolarCandidate {
  return {
    score: 0,
    dis,
    angle,
    radius,
    dir: arcDirection(polarArcFrame(VERTICAL), angle),
    disIndex: 0,
    radiusIndex: 0,
    haveLead: false,
    pos: [0, 0, 0],
    textOri: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    source: 'solved',
  };
}

describe('pointToPolarCoords', () => {
  it('round-trips with `arcDirection` / `polarArcFrame`: a point built from a known '
    + '(dis, angle, radius) decodes back to the same triple', () => {
    const frame = polarArcFrame(VERTICAL);
    const dis = 3;
    const angle = 125;
    const radius = 0.4;
    const direction = arcDirection(frame, angle);
    const point: readonly [number, number, number] = [
      VERTICAL.origin[0] + VERTICAL.axis[0] * dis + direction[0] * radius,
      VERTICAL.origin[1] + VERTICAL.axis[1] * dis + direction[1] * radius,
      VERTICAL.origin[2] + VERTICAL.axis[2] * dis + direction[2] * radius,
    ];

    const coords = pointToPolarCoords(VERTICAL, point);

    expect(coords).not.toBeNull();
    expect(coords!.dis).toBeCloseTo(dis, 9);
    expect(coords!.angle).toBeCloseTo(angle, 9);
    expect(coords!.radius).toBeCloseTo(radius, 9);
  });

  it('keeps a negative `dis` (point behind `origin` along `axis`) — unlike PML\'s own '
    + 'unsigned `suidirdis`, every caller here (`ExplicitPolarInput.disRange`, '
    + '`polarInputForLabel`) allows it', () => {
    const point: readonly [number, number, number] = [0, 1, -2];
    const coords = pointToPolarCoords(VERTICAL, point);
    expect(coords!.dis).toBeCloseTo(-2, 9);
    expect(coords!.angle).toBeCloseTo(0, 9);
    expect(coords!.radius).toBeCloseTo(1, 9);
  });

  it('returns null for a point on the axis itself (radius underflows EPSILON)', () => {
    expect(pointToPolarCoords(VERTICAL, [0, 0, 5])).toBeNull();
  });
});

describe('polarCandidateObstacle', () => {
  it('boxes the candidate at (dis, angle, radius) padded by half the needs triple', () => {
    const candidate = candidateAt(2, 40, 0.3);
    const obstacle = polarCandidateObstacle('a', candidate, 1, 30, 0.1);

    expect(obstacle).toMatchObject({ id: 'a', type: 'AIDTEX', basic: false });
    expect(obstacle.dis).toEqual([1.5, 2.5]);
    expect(obstacle.angle).toEqual([25, 55]);
    expect(obstacle.radius[0]).toBeCloseTo(0.25, 9);
    expect(obstacle.radius[1]).toBeCloseTo(0.35, 9);
  });

  it('leaves an angle window that crosses 0/360 unwrapped (a single PolarElement '
    + 'cannot express two disjoint ranges)', () => {
    const candidate = candidateAt(0, 2, 0.1);
    const obstacle = polarCandidateObstacle('wrap', candidate, 1, 30, 0.1);
    expect(obstacle.angle).toEqual([-13, 17]);
  });
});

describe('siblingAnchorObstacle', () => {
  it('converts a non-polar sibling anchor into a small box around its polar position', () => {
    const anchor: readonly [number, number, number] = [0, 0.5, 4];
    const obstacle = siblingAnchorObstacle('sibling', VERTICAL, anchor, 0.1, 30);

    expect(obstacle).not.toBeNull();
    expect(obstacle).toMatchObject({ id: 'sibling', type: 'AIDTEX', basic: false });
    // dis = 4, angle = 0 (north), radius = 0.5; half padding is textHeightM / 2 = 0.05.
    expect(obstacle!.dis[0]).toBeCloseTo(3.95, 9);
    expect(obstacle!.dis[1]).toBeCloseTo(4.05, 9);
    expect(obstacle!.angle).toEqual([-15, 15]);
    expect(obstacle!.radius[0]).toBeCloseTo(0.45, 9);
    expect(obstacle!.radius[1]).toBeCloseTo(0.55, 9);
  });

  it('clamps the radial lower bound at 0 instead of going negative for a sibling '
    + 'close to the axis', () => {
    const anchor: readonly [number, number, number] = [0, 0.02, 0];
    const obstacle = siblingAnchorObstacle('close', VERTICAL, anchor, 0.1, 30);
    expect(obstacle!.radius[0]).toBe(0);
  });

  it('returns null for a sibling anchor sitting on the axis itself', () => {
    expect(siblingAnchorObstacle('on-axis', VERTICAL, [0, 0, 1], 0.1, 30)).toBeNull();
  });
});
