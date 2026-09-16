import { describe, expect, it } from 'vitest';

import {
  computePerpendicularDistance,
  PERPENDICULAR_ZERO_DISTANCE_M,
  type PerpendicularPoint,
  type PerpendicularTarget,
} from './perpendicularDistance';

/** E3D design coordinates in the golden are millimetres; the kernel works in metres. */
function mm(east: number, north: number, up: number): PerpendicularPoint {
  return [east / 1000, north / 1000, up / 1000];
}

/** Tolerance in metres for values the golden reports to 1e-3 mm (with ~1e-3 mm ARC drift). */
const GOLDEN_MM_TOLERANCE_M = 0.01 / 1000;

function expectPointMm(actual: PerpendicularPoint, expected: PerpendicularPoint): void {
  expected.forEach((value, index) => {
    expect(Math.abs(actual[index]! - value)).toBeLessThanOrEqual(GOLDEN_MM_TOLERANCE_M);
  });
}

function expectMm(actualM: number, expectedMm: number): void {
  expect(Math.abs(actualM * 1000 - expectedMm)).toBeLessThanOrEqual(0.01);
}

function valueOf(result: ReturnType<typeof computePerpendicularDistance>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

/** GPHLINE aid 10020 from prepare-real-perpendicular-aids.pmlmac. */
const GOLDEN_LINE: PerpendicularTarget = {
  kind: 'line',
  start: mm(8000, 9000, 15000),
  end: mm(11000, 9000, 15000),
};

/** GPHPLANE aid 10021: through E 8500 N 10500 U 17500, normal N, drawn patch 2200 mm. */
const GOLDEN_PLANE: PerpendicularTarget = {
  kind: 'plane',
  position: mm(8500, 10500, 17500),
  normal: [0, 1, 0],
};

describe('computePerpendicularDistance · E3D 3.1 runtime golden G4', () => {
  it('G4-01 real pick: point → registered LINE (foot at the line end)', () => {
    const value = valueOf(computePerpendicularDistance(mm(11000, 9500, 17500), GOLDEN_LINE));
    expectPointMm(value.foot, mm(11000, 9000, 15000));
    expectMm(value.distanceM, 2549.50975679639);
    expectMm(value.verticalM, 2500);
    expectMm(value.horizontalM, 500);
    // E3D Direction "N 78.6901 U": from N, tilted 78.6901° up.
    expect(value.direction[0]).toBeCloseTo(0, 9);
    expect(value.direction[1]).toBeCloseTo(Math.cos((78.6901 * Math.PI) / 180), 5);
    expect(value.direction[2]).toBeCloseTo(Math.sin((78.6901 * Math.PI) / 180), 5);
  });

  it('G4-01 fixture: foot inside the segment', () => {
    const value = valueOf(computePerpendicularDistance(mm(9500, 9800, 17000), GOLDEN_LINE));
    expectPointMm(value.foot, mm(9500, 9000, 15000));
    expectMm(value.distanceM, 2154.0659228538);
    expectMm(value.verticalM, 2000);
    expectMm(value.horizontalM, 800);
    // Direction "N 68.1986 U".
    expect(value.direction[1]).toBeCloseTo(Math.cos((68.1986 * Math.PI) / 180), 5);
    expect(value.direction[2]).toBeCloseTo(Math.sin((68.1986 * Math.PI) / 180), 5);
  });

  it('G4-04: the foot beyond the segment end is not clamped (LINE.near is infinite)', () => {
    const value = valueOf(computePerpendicularDistance(mm(12000, 9800, 17000), GOLDEN_LINE));
    expectPointMm(value.foot, mm(12000, 9000, 15000));
    expectMm(value.distanceM, 2154.0659228538);
    expectMm(value.verticalM, 2000);
    expectMm(value.horizontalM, 800);
  });

  it('G4-02 real pick: point → registered PLANE, foot inside the drawn patch', () => {
    const value = valueOf(computePerpendicularDistance(mm(8000, 9000, 16500), GOLDEN_PLANE));
    expectPointMm(value.foot, mm(8000, 10500, 16500));
    expectMm(value.distanceM, 1500);
    expectMm(value.verticalM, 0);
    expectMm(value.horizontalM, 1500);
    // Direction "S": foot → source points south.
    expect(value.direction).toEqual([0, -1, 0]);
  });

  it('G4-02 fixture: second plane sample (source north of the plane, Direction N)', () => {
    const value = valueOf(computePerpendicularDistance(mm(8700, 12300, 18000), GOLDEN_PLANE));
    expectPointMm(value.foot, mm(8700, 10500, 18000));
    expectMm(value.distanceM, 1800);
    expectMm(value.verticalM, 0);
    expectMm(value.horizontalM, 1800);
    expect(value.direction).toEqual([0, 1, 0]);
  });

  it('G4-04: the foot outside the drawn 2200 mm patch is still on the infinite plane', () => {
    const value = valueOf(computePerpendicularDistance(mm(12000, 9500, 17500), GOLDEN_PLANE));
    expectPointMm(value.foot, mm(12000, 10500, 17500));
    expectMm(value.distanceM, 1000);
    expectMm(value.verticalM, 0);
    expectMm(value.horizontalM, 1000);
    expect(value.direction).toEqual([0, -1, 0]);
  });

  it('G4-04: a source on the plane or on the line has no perpendicular dimension', () => {
    expect(computePerpendicularDistance(mm(8500, 10500, 17500), GOLDEN_PLANE))
      .toEqual({ ok: false, reason: 'zero-distance' });
    expect(computePerpendicularDistance(mm(9000, 9000, 15000), GOLDEN_LINE))
      .toEqual({ ok: false, reason: 'zero-distance' });
  });

  it('zero-distance threshold is 1 µm: design-data noise below it is "0", anything at or above it is measured (golden MD §36 (2))', () => {
    expect(PERPENDICULAR_ZERO_DISTANCE_M).toBe(1e-6);
    // golden MD §36: ELBO 145028 P2 (A) onto the vertical axis through ELBO 145029 P1 (B) — the two
    // P-Points differ by 9.5e-5 mm in N, so the perpendicular distance is 9.5029e-8 m. That is noise,
    // not a dimension: it must be refused like an exact zero (E3D would otherwise print `0mm`).
    const axisB: PerpendicularTarget = { kind: 'line', start: mm(7849.85, 11787.49, 18492.386314), end: mm(7849.85, 11787.49, 18491.386314) };
    expect(computePerpendicularDistance(mm(7849.85, 11787.489905, 16892.523686), axisB))
      .toEqual({ ok: false, reason: 'zero-distance' });
    // Same for a point target that sits within noise of the source.
    expect(computePerpendicularDistance(mm(1, 2, 3), { kind: 'point', position: mm(1, 2 + 5e-4, 3) }))
      .toEqual({ ok: false, reason: 'zero-distance' });
    // Just below the threshold is still zero; at the threshold it is a (tiny) dimension.
    expect(computePerpendicularDistance([0, 0, 0.99e-6], { kind: 'plane', position: [0, 0, 0], normal: [0, 0, 1] }))
      .toEqual({ ok: false, reason: 'zero-distance' });
    const tiny = valueOf(computePerpendicularDistance([0, 0, 1.01e-6], { kind: 'plane', position: [0, 0, 0], normal: [0, 0, 1] }));
    expect(tiny.distanceM).toBeCloseTo(1.01e-6, 12);
    expect(tiny.direction).toEqual([0, 0, 1]);
    // A real 0.1 mm perpendicular is untouched.
    const real = valueOf(computePerpendicularDistance(mm(9000, 9000.1, 15000), GOLDEN_LINE));
    expectMm(real.distanceM, 0.1);
  });

  it('G4-03: two point picks fall back to the point-to-point split', () => {
    // First pick (source) E 9769.75 N 10047.176 U 18664.801; second pick E 9897.433 N 8954.701 U 13330.416.
    const value = valueOf(computePerpendicularDistance(
      mm(9769.75, 10047.176, 18664.801),
      { kind: 'point', position: mm(9897.433, 8954.701, 13330.416) },
    ));
    expectPointMm(value.foot, mm(9897.433, 8954.701, 13330.416));
    expectMm(value.distanceM, 5446.60105926797);
    expectMm(value.verticalM, 5334.38438847279);
    expectMm(value.horizontalM, 1099.91194867441);
    // Direction "N 6.66615 W 78.3493 U": foot → source.
    const horizontal = Math.cos((78.3493 * Math.PI) / 180);
    expect(value.direction[0]).toBeCloseTo(-horizontal * Math.sin((6.66615 * Math.PI) / 180), 5);
    expect(value.direction[1]).toBeCloseTo(horizontal * Math.cos((6.66615 * Math.PI) / 180), 5);
    expect(value.direction[2]).toBeCloseTo(Math.sin((78.3493 * Math.PI) / 180), 5);
  });

  it('G4-06: the result is World-framed regardless of the displayed WRT (kernel exposes World only)', () => {
    const value = valueOf(computePerpendicularDistance(mm(8000, 9000, 16500), GOLDEN_PLANE));
    // Expressed in EQUI /Copy-of-RCS151MM (Y is E and Z is U) the same direction would be +X;
    // the kernel deliberately reports the World vector the E3D form shows ("S").
    expect(value.direction).toEqual([0, -1, 0]);
    expect(value.targetKind).toBe('plane');
  });
});

describe('computePerpendicularDistance · degenerate inputs', () => {
  it('rejects a zero-length line and a zero normal', () => {
    expect(computePerpendicularDistance([0, 0, 0], {
      kind: 'line',
      start: [1, 1, 1],
      end: [1, 1, 1],
    })).toEqual({ ok: false, reason: 'degenerate-target' });
    expect(computePerpendicularDistance([0, 0, 0], {
      kind: 'plane',
      position: [1, 1, 1],
      normal: [0, 0, 0],
    })).toEqual({ ok: false, reason: 'degenerate-target' });
  });

  it('rejects non-finite coordinates', () => {
    expect(computePerpendicularDistance([Number.NaN, 0, 0], GOLDEN_PLANE))
      .toEqual({ ok: false, reason: 'non-finite-input' });
    expect(computePerpendicularDistance([0, 0, 0], {
      kind: 'point',
      position: [0, Number.POSITIVE_INFINITY, 0],
    })).toEqual({ ok: false, reason: 'non-finite-input' });
  });

  it('accepts an unnormalised plane normal', () => {
    const value = valueOf(computePerpendicularDistance(mm(8000, 9000, 16500), {
      kind: 'plane',
      position: mm(8500, 10500, 17500),
      normal: [0, 2.5, 0],
    }));
    expectMm(value.distanceM, 1500);
    expectPointMm(value.foot, mm(8000, 10500, 16500));
  });
});
