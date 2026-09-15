import { describe, expect, it } from 'vitest';

import { ANGLE_DEGREES_SNAP_DEG, ANGLE_DIRECTION_SNAP } from './angleSnap';
import { buildThreePointAngle, type AnglePoint } from './threePointAngle';

function mm(east: number, north: number, up: number): AnglePoint {
  return [east / 1000, north / 1000, up / 1000];
}

function valueOf(result: ReturnType<typeof buildThreePointAngle>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function expectUnit(actual: AnglePoint, expected: AnglePoint): void {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
}

/** Golden G6-03 root / first (capture-angle-degenerate.pmlmac). */
const ROOT = mm(10000, 10000, 15000);
const FIRST = mm(12000, 10000, 15000);

describe('buildThreePointAngle · E3D 3.1 runtime golden G6-03', () => {
  it.each([
    ['0deg same ray', mm(13000, 10000, 15000)],
    ['180deg opposite ray', mm(8000, 10000, 15000)],
    ['second equals first', mm(12000, 10000, 15000)],
  ])('rejects exactly collinear picks like radius3PointsNoError (%s)', (_name, second) => {
    // E3D: POSITION.plane() → (2,886) "Plane lines derived from points are parallel", arc unset.
    expect(buildThreePointAngle(ROOT, FIRST, second)).toEqual({ ok: false, reason: 'collinear' });
  });

  it('rejects a second point on the root (E3D (2,892) co-incident point)', () => {
    expect(buildThreePointAngle(ROOT, FIRST, ROOT)).toEqual({ ok: false, reason: 'coincident-point' });
    expect(buildThreePointAngle(ROOT, ROOT, FIRST)).toEqual({ ok: false, reason: 'coincident-point' });
  });

  it('accepts 0.1° near-collinear picks (golden 0.10000009331775°; the 9e-8° tail is below the 1e-5° snap grid)', () => {
    const value = valueOf(buildThreePointAngle(ROOT, FIRST, mm(10999.99848, 10001.74533, 15000)));
    expect(Math.abs(value.angleDeg - 0.10000009331775)).toBeLessThan(ANGLE_DEGREES_SNAP_DEG);
    expect(value.angleDeg).toBe(0.1);
    expectUnit(value.direction1, [1, 0, 0]);
    // Direction2 "E 0.1 N".
    expectUnit(value.direction2, [Math.cos((0.1 * Math.PI) / 180), Math.sin((0.1 * Math.PI) / 180), 0]);
    expectUnit(value.planeNormal, [0, 0, 1]);
  });

  it('accepts 179.9° near-collinear picks (golden 179.899999906682°; snapped to the 1e-5° grid)', () => {
    const value = valueOf(buildThreePointAngle(ROOT, FIRST, mm(9000.00152, 10001.74533, 15000)));
    expect(Math.abs(value.angleDeg - 179.899999906682)).toBeLessThan(ANGLE_DEGREES_SNAP_DEG);
    expect(value.angleDeg).toBe(179.9);
    // Direction2 "W 0.1 N".
    expectUnit(value.direction2, [-Math.cos((0.1 * Math.PI) / 180), Math.sin((0.1 * Math.PI) / 180), 0]);
    expectUnit(value.planeNormal, [0, 0, 1]);
  });

  it('90° with the second point north: plane normal U (orientation "Y is N and Z is U")', () => {
    const value = valueOf(buildThreePointAngle(ROOT, FIRST, mm(10000, 12000, 15000)));
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expect(value.radiusM).toBeCloseTo(2, 9);
    expectUnit(value.direction1, [1, 0, 0]);
    expectUnit(value.direction2, [0, 1, 0]);
    expectUnit(value.planeNormal, [0, 0, 1]);
  });

  it('90° with the second point south: the normal flips to D, the angle stays minor (no 270°)', () => {
    const value = valueOf(buildThreePointAngle(ROOT, FIRST, mm(10000, 8000, 15000)));
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expectUnit(value.direction2, [0, -1, 0]);
    expectUnit(value.planeNormal, [0, 0, -1]);
  });

  it('135°: Direction2 "W 45 N"', () => {
    const value = valueOf(buildThreePointAngle(ROOT, FIRST, mm(9292.89322, 10707.10678, 15000)));
    expect(value.angleDeg).toBeCloseTo(135, 5);
    expectUnit(value.direction2, [-Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('90° with the second point up: plane normal S (orientation "Y is U and Z is S")', () => {
    const value = valueOf(buildThreePointAngle(ROOT, FIRST, mm(10000, 10000, 17000)));
    expect(value.angleDeg).toBeCloseTo(90, 9);
    expectUnit(value.direction2, [0, 0, 1]);
    expectUnit(value.planeNormal, [0, -1, 0]);
  });

  it('G6-01/02: the AvevaMarineSample three-point sample reproduces 37.4013215953213°', () => {
    // Root = the G1 start point; arms rebuilt from the golden Direction1/Direction2 at radius 4984.347 mm.
    const radiusM = 4984.34735326502 / 1000;
    const root = mm(9769.75, 10047.18, 18664.8);
    const toUnit = (westDeg: number, northSign: number, tiltDownDeg: number): AnglePoint => {
      // "W a N b D": from W rotate a° toward N (or S), then tilt b° down.
      const horizontal = Math.cos((tiltDownDeg * Math.PI) / 180);
      return [
        -horizontal * Math.cos((westDeg * Math.PI) / 180),
        northSign * horizontal * Math.sin((westDeg * Math.PI) / 180),
        -Math.sin((tiltDownDeg * Math.PI) / 180),
      ];
    };
    const d1 = toUnit(11.7755, 1, 66.8266); // Direction1 "W 11.7755 N 66.8266 D"
    const d2 = toUnit(12.9006, -1, 32.3892); // Direction2 "W 12.9006 S 32.3892 D"
    const first: AnglePoint = [root[0] + d1[0] * radiusM, root[1] + d1[1] * radiusM, root[2] + d1[2] * radiusM];
    const second: AnglePoint = [root[0] + d2[0] * radiusM, root[1] + d2[1] * radiusM, root[2] + d2[2] * radiusM];
    const value = valueOf(buildThreePointAngle(root, first, second));
    // Direction strings carry 4–6 significant digits, so allow 1e-3°.
    expect(Math.abs(value.angleDeg - 37.4013215953213)).toBeLessThan(1e-3);
    expect(value.radiusM).toBeCloseTo(radiusM, 9);
  });
});

describe('buildThreePointAngle · mesh-noise snapping shared with the two-line kernel (angleSnap.ts)', () => {
  it('a geometrically vertical arm with float32 noise snaps to exactly U; the other arm keeps its real components', () => {
    // Root → second carries the kind of noise a mesh vertex leaves behind (~1e-9 per component).
    const root: AnglePoint = [10.3, 14.0, 0.27];
    const first: AnglePoint = [root[0] - 0.7697511183832466, root[1] + 0.5389855411949357, root[2] + 0.3420201779581775];
    const second: AnglePoint = [root[0] + 1.2101366035762613e-9, root[1] + 1.7282620438027327e-9, root[2] + 1];
    const value = valueOf(buildThreePointAngle(root, first, second));
    expect(value.direction2).toEqual([0, 0, 1]);
    expect(Math.abs(value.direction1[0] + 0.7697511183832466)).toBeLessThan(1e-9);
    expect(Math.abs(value.direction1[2] - 0.3420201779581775)).toBeLessThan(1e-9);
    // 70° between the arms: snapped angle lands on the grid, DMS truncation gives 70° 0' 0''.
    expect(value.angleDeg).toBe(70);
    const deg = Math.trunc(value.angleDeg);
    const min = Math.trunc((value.angleDeg - deg) * 60);
    const sec = Math.trunc((value.angleDeg - deg - min / 60) * 3600);
    expect([deg, min, sec]).toEqual([70, 0, 0]);
    // The arc-plane normal follows the snapped arms (d1 × U is horizontal).
    expect(value.planeNormal[2] === 0).toBe(true);
    expectUnit(value.planeNormal, [0.5389855411949357 / 0.9396926207859084, 0.7697511183832466 / 0.9396926207859084, 0]);
  });

  it('angles land on the 1e-5° grid and exact inputs pass through unchanged', () => {
    // 69.9999979°-style noise: second point rotated 70° − 2.1e-6° from first around U.
    const theta = ((70 - 2.1e-6) * Math.PI) / 180;
    const noisy = valueOf(buildThreePointAngle(ROOT, FIRST, [ROOT[0] + 2 * Math.cos(theta), ROOT[1] + 2 * Math.sin(theta), ROOT[2]]));
    expect(noisy.angleDeg).toBe(70);
    const exact = valueOf(buildThreePointAngle(ROOT, FIRST, mm(10000, 12000, 15000)));
    expect(exact.angleDeg).toBe(90);
    expect(exact.direction1).toEqual([1, 0, 0]);
    expect(exact.direction2).toEqual([0, 1, 0]);
    expect(exact.planeNormal).toEqual([0, 0, 1]);
    expect(ANGLE_DIRECTION_SNAP).toBe(1e-6);
    expect(ANGLE_DEGREES_SNAP_DEG).toBe(1e-5);
  });

  it('rejections still use the raw arms: exact collinearity is rejected, a 1e-7 rad opening is accepted without dividing by zero', () => {
    expect(buildThreePointAngle(ROOT, FIRST, mm(13000, 10000, 15000))).toEqual({ ok: false, reason: 'collinear' });
    const tiny = valueOf(buildThreePointAngle(ROOT, FIRST, [ROOT[0] + 2, ROOT[1] + 2e-7, ROOT[2]]));
    expect(Number.isFinite(tiny.angleDeg)).toBe(true);
    expect(tiny.planeNormal.every(Number.isFinite)).toBe(true);
    expectUnit(tiny.planeNormal, [0, 0, 1]);
  });
});

describe('buildThreePointAngle · input validation', () => {
  it('rejects non-finite coordinates', () => {
    expect(buildThreePointAngle([Number.NaN, 0, 0], FIRST, ROOT))
      .toEqual({ ok: false, reason: 'non-finite-input' });
  });
});
