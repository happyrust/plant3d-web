import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AID_PLANE_SIZE_M,
  aidDisplayName,
  aidLineDirection,
  aidLineFromDirection,
  aidLineMidPoint,
  aidLineRayHit,
  aidPlaneCorners,
  aidPlaneFrame,
  aidPlaneFromThreePoints,
  aidPlaneRayHit,
  createAidLine,
  createAidPlane,
  nextAidNumber,
  type MeasurementAidLine,
  type MeasurementAidPlane,
} from './designAid';

const close = (actual: readonly number[], expected: readonly number[], digits = 9): void => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));
};

function line(start: readonly [number, number, number], end: readonly [number, number, number]): MeasurementAidLine {
  const result = createAidLine({ id: 'l', number: 1, start, end });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function plane(input: Partial<Parameters<typeof createAidPlane>[0]> = {}): MeasurementAidPlane {
  const result = createAidPlane({ id: 'p', number: 2, position: [0, 0, 0], zDir: [0, 0, 1], ...input });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('createAidLine / aidLineFromDirection (GPHLINE)', () => {
  it('keeps a finite start → end and trims the description', () => {
    const result = createAidLine({ id: 'a', number: 3, description: '  梁顶  ', start: [0, 0, 0], end: [1, 2, 3] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ kind: 'line', number: 3, description: '梁顶', visible: true });
    expect(aidLineDirection(result.value)).toEqual([1, 2, 3]);
    close(aidLineMidPoint(result.value), [0.5, 1, 1.5]);
  });

  it('rejects coincident ends and non-finite input', () => {
    expect(createAidLine({ id: 'a', number: 1, start: [1, 1, 1], end: [1, 1, 1] })).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(createAidLine({ id: 'a', number: 1, start: [Number.NaN, 0, 0], end: [1, 1, 1] })).toEqual({ ok: false, reason: 'non-finite-input' });
  });

  it('builds a line from position + direction + length for each anchor (E3D line edit form)', () => {
    const fromStart = aidLineFromDirection({ id: 'a', number: 1, position: [1, 1, 1], direction: [0, 0, 5], length: 2 });
    expect(fromStart.ok && fromStart.value.start).toEqual([1, 1, 1]);
    expect(fromStart.ok && fromStart.value.end).toEqual([1, 1, 3]);

    const fromMid = aidLineFromDirection({ id: 'a', number: 1, position: [1, 1, 1], anchor: 'mid', direction: [0, 0, 1], length: 2 });
    expect(fromMid.ok && fromMid.value.start).toEqual([1, 1, 0]);
    expect(fromMid.ok && fromMid.value.end).toEqual([1, 1, 2]);

    const fromEnd = aidLineFromDirection({ id: 'a', number: 1, position: [1, 1, 1], anchor: 'end', direction: [0, 0, 1], length: 2 });
    expect(fromEnd.ok && fromEnd.value.start).toEqual([1, 1, -1]);
    expect(fromEnd.ok && fromEnd.value.end).toEqual([1, 1, 1]);

    expect(aidLineFromDirection({ id: 'a', number: 1, position: [0, 0, 0], direction: [0, 0, 0], length: 2 })).toEqual({ ok: false, reason: 'zero-length-line' });
    expect(aidLineFromDirection({ id: 'a', number: 1, position: [0, 0, 0], direction: [0, 0, 1], length: 0 })).toEqual({ ok: false, reason: 'zero-length-line' });
  });
});

describe('aidPlaneFrame / createAidPlane (GPHPLANE)', () => {
  it('gives the E3D default frame for a horizontal plane: X is E, Y is N, Z is U', () => {
    const frame = aidPlaneFrame([0, 0, 2]);
    expect(frame).not.toBeNull();
    close(frame!.xDir, [1, 0, 0]);
    close(frame!.yDir, [0, 1, 0]);
    close(frame!.zDir, [0, 0, 1]);
  });

  it('keeps Y as up-most as possible for a vertical plane and stays right-handed', () => {
    const frame = aidPlaneFrame([0, 1, 0]);
    close(frame!.yDir, [0, 0, 1]);
    close(frame!.xDir, [-1, 0, 0]);
    // right-handed: x × y = z
    const [x, y, z] = [frame!.xDir, frame!.yDir, frame!.zDir];
    close([
      x[1] * y[2] - x[2] * y[1],
      x[2] * y[0] - x[0] * y[2],
      x[0] * y[1] - x[1] * y[0],
    ], z);
  });

  it('honours a Y hint by projecting it onto the plane, ignoring one parallel to Z', () => {
    const hinted = aidPlaneFrame([0, 0, 1], [1, 1, 5]);
    close(hinted!.yDir, [Math.SQRT1_2, Math.SQRT1_2, 0]);
    const parallel = aidPlaneFrame([0, 0, 1], [0, 0, -3]);
    close(parallel!.yDir, [0, 1, 0]);
  });

  it('defaults to 5 m × 5 m and rejects degenerate normals / sizes', () => {
    const p = plane();
    expect(p.xSize).toBe(DEFAULT_AID_PLANE_SIZE_M);
    expect(p.ySize).toBe(DEFAULT_AID_PLANE_SIZE_M);
    expect(createAidPlane({ id: 'p', number: 1, position: [0, 0, 0], zDir: [0, 0, 0] })).toEqual({ ok: false, reason: 'degenerate-normal' });
    expect(createAidPlane({ id: 'p', number: 1, position: [0, 0, 0], zDir: [0, 0, 1], xSize: 0 })).toEqual({ ok: false, reason: 'non-positive-size' });
  });

  it('lays the rectangle corners at ±x/2 · ±y/2 in loop order', () => {
    const p = plane({ position: [10, 20, 30], xSize: 4, ySize: 2 });
    const corners = aidPlaneCorners(p);
    close(corners[0], [8, 19, 30]);
    close(corners[1], [8, 21, 30]);
    close(corners[2], [12, 21, 30]);
    close(corners[3], [12, 19, 30]);
  });

  it('builds a plane through three points with Y along p1 → p2 (E3D "Through three points")', () => {
    const result = aidPlaneFromThreePoints({ id: 'p', number: 1, p1: [0, 0, 1], p2: [0, 2, 1], p3: [3, 0, 1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    close(result.value.position, [0, 0, 1]);
    close(result.value.yDir, [0, 1, 0]);
    // (p2−p1) × (p3−p1) = (0,2,0) × (3,0,0) = (0,0,−6) → normal points down
    close(result.value.zDir, [0, 0, -1]);
    expect(aidPlaneFromThreePoints({ id: 'p', number: 1, p1: [0, 0, 0], p2: [1, 0, 0], p3: [2, 0, 0] })).toEqual({ ok: false, reason: 'degenerate-normal' });
  });
});

describe('aidPlaneRayHit (pointVector.intersection(plane))', () => {
  it('returns the ray ∩ plane point with in-plane coordinates and the rectangle test', () => {
    const p = plane({ position: [0, 0, 5], xSize: 4, ySize: 2 });
    const hit = aidPlaneRayHit(p, { origin: [1, 0.5, 20], direction: [0, 0, -1] });
    expect(hit).not.toBeNull();
    close(hit!.point, [1, 0.5, 5]);
    expect(hit!.t).toBeCloseTo(15, 9);
    expect(hit!.u).toBeCloseTo(1, 9);
    expect(hit!.v).toBeCloseTo(0.5, 9);
    expect(hit!.inside).toBe(true);
    const outside = aidPlaneRayHit(p, { origin: [3, 0, 20], direction: [0, 0, -1] });
    expect(outside!.inside).toBe(false);
    // 2 % margin lets a pick on the frame count as inside
    const onFrame = aidPlaneRayHit(p, { origin: [2.02, 0, 20], direction: [0, 0, -1] }, 0.02);
    expect(onFrame!.inside).toBe(true);
  });

  it('is null for a ray parallel to the plane or a plane behind the ray', () => {
    const p = plane();
    expect(aidPlaneRayHit(p, { origin: [0, 0, 1], direction: [1, 0, 0] })).toBeNull();
    expect(aidPlaneRayHit(p, { origin: [0, 0, 1], direction: [0, 0, 1] })).toBeNull();
  });
});

describe('aidLineRayHit (LINE.intersection(pointVector) on skew lines)', () => {
  it('finds the point of the line nearest to the ray and clamps to the extent', () => {
    const l = line([0, 0, 0], [10, 0, 0]);
    const skew = aidLineRayHit(l, { origin: [4, 5, 1], direction: [0, -1, 0] });
    close(skew!.point, [4, 0, 0]);
    expect(skew!.s).toBeCloseTo(0.4, 9);
    expect(skew!.distance).toBeCloseTo(1, 9);
    const beyond = aidLineRayHit(l, { origin: [14, 5, 0], direction: [0, -1, 0] });
    close(beyond!.point, [10, 0, 0]);
    expect(beyond!.s).toBe(1);
    expect(beyond!.distance).toBeCloseTo(4, 9);
  });

  it('takes the start when the ray is parallel to the line', () => {
    const l = line([0, 0, 0], [10, 0, 0]);
    const parallel = aidLineRayHit(l, { origin: [0, 2, 0], direction: [1, 0, 0] });
    close(parallel!.point, [0, 0, 0]);
    expect(parallel!.distance).toBeCloseTo(2, 9);
  });
});

describe('numbering and names', () => {
  it('hands out 1 + the largest number in use and names unnamed aids Line [n] / Plane [n]', () => {
    expect(nextAidNumber([])).toBe(1);
    expect(nextAidNumber([{ number: 2 }, { number: 7 }, { number: 3 }])).toBe(8);
    expect(aidDisplayName(line([0, 0, 0], [1, 0, 0]))).toBe('Line [1]');
    expect(aidDisplayName(plane())).toBe('Plane [2]');
    expect(aidDisplayName({ ...plane(), description: '楼面' })).toBe('楼面');
  });
});
