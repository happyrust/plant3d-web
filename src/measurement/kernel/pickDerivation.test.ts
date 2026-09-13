import { describe, expect, it } from 'vitest';

import {
  closestPointOnInfiniteLine,
  derivePickPosition,
  distanceAlongSegment,
  fractionAlongSegment,
  intersectLines,
  intersectPicks,
  isWithinSegmentExtent,
  lineRayControlPoint,
  orientSegmentToNearEnd,
  proportionAlongSegment,
  rayPlaneIntersection,
  snapSegmentEnd,
  type PickRay,
  type PickSegment,
  type PickVec3,
} from './pickDerivation';

/**
 * static_expectation · E3D 3.1 PMLLIB `gmfline.pmlobj` / `edgpicktype.pmlobj`.
 * Runtime golden G8 (pick types on a PLINE / edge) is still to be captured; when
 * it lands, the expected values below must be replaced by the observed ones.
 */

function mm(east: number, north: number, up: number): PickVec3 {
  return [east / 1000, north / 1000, up / 1000];
}

function positionOf(result: ReturnType<typeof derivePickPosition>): PickVec3 {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.position;
}

function expectMm(actual: PickVec3, expected: readonly [number, number, number]): void {
  expected.forEach((value, index) => expect((actual[index] ?? Number.NaN) * 1000).toBeCloseTo(value, 6));
}

/** A 4000 mm PLINE running east at N10000 U15000. */
const PLINE: PickSegment = { start: mm(10000, 10000, 15000), end: mm(14000, 10000, 15000) };

/** Pick ray looking down (D) onto the line at a given easting, offset north of it. */
function rayOver(eastMm: number, northMm = 10000): PickRay {
  return { origin: mm(eastMm, northMm, 20000), direction: [0, 0, -1] };
}

describe('GMFLINE primitives', () => {
  it('near / onProjected follow the infinite line but report the extent', () => {
    const near = closestPointOnInfiniteLine(PLINE, mm(11000, 12000, 15000));
    expectMm(near, [11000, 10000, 15000]);
    expect(isWithinSegmentExtent(PLINE, near)).toBe(true);
    expect(isWithinSegmentExtent(PLINE, mm(14500, 10000, 15000))).toBe(false);
    expect(isWithinSegmentExtent(PLINE, mm(10000, 10000, 15000))).toBe(true);
  });

  it('reverseSense: the end nearest to the control point becomes start; a tie keeps the sense', () => {
    expect(orientSegmentToNearEnd(PLINE, mm(13500, 10000, 15000))).toEqual({
      segment: { start: PLINE.end, end: PLINE.start },
      nearEnd: 'end',
    });
    expect(orientSegmentToNearEnd(PLINE, mm(10500, 10000, 15000)).nearEnd).toBe('start');
    expect(orientSegmentToNearEnd(PLINE, mm(12000, 10000, 15000)).nearEnd).toBe('start');
  });

  it('control point = pick ray ∩ item line, nearest point on the line for skew rays', () => {
    const control = lineRayControlPoint(PLINE, rayOver(11200, 10300));
    expect(control).not.toBeNull();
    expectMm(control!, [11200, 10000, 15000]);
    // Ray parallel to the line → (2,870) in E3D.
    expect(lineRayControlPoint(PLINE, { origin: mm(0, 10500, 15000), direction: [1, 0, 0] })).toBeNull();
  });

  it('ray ∩ plane; parallel ray → null', () => {
    const plane = { position: mm(0, 0, 15000), normal: [0, 0, 1] as PickVec3 };
    expectMm(rayPlaneIntersection(rayOver(12345, 10001), plane)!, [12345, 10001, 15000]);
    expect(rayPlaneIntersection({ origin: mm(0, 0, 16000), direction: [1, 0, 0] }, plane)).toBeNull();
  });
});

describe('Snap (GMFLINE.snap)', () => {
  it('returns the nearest end', () => {
    expectMm(positionOf(snapSegmentEnd(PLINE, mm(10800, 10000, 15000))), [10000, 10000, 15000]);
    expectMm(positionOf(snapSegmentEnd(PLINE, mm(13100, 10000, 15000))), [14000, 10000, 15000]);
  });

  it('a control point beyond the extent still snaps to the nearest end', () => {
    expectMm(positionOf(snapSegmentEnd(PLINE, mm(16000, 10000, 15000))), [14000, 10000, 15000]);
  });
});

describe('Distance (GMFLINE.distance)', () => {
  it('walks d from the nearest end towards the other end', () => {
    expectMm(positionOf(distanceAlongSegment(PLINE, 0.1, mm(10500, 10000, 15000))), [10100, 10000, 15000]);
    expectMm(positionOf(distanceAlongSegment(PLINE, 0.1, mm(13900, 10000, 15000))), [13900, 10000, 15000]);
  });

  it('is not clamped: over-length and negative distances leave the extent', () => {
    expectMm(positionOf(distanceAlongSegment(PLINE, 5, mm(10500, 10000, 15000))), [15000, 10000, 15000]);
    expectMm(positionOf(distanceAlongSegment(PLINE, -0.25, mm(10500, 10000, 15000))), [9750, 10000, 15000]);
  });

  it('Distance 0 (E3D default) is the nearest end', () => {
    expectMm(positionOf(distanceAlongSegment(PLINE, 0, mm(13000, 10000, 15000))), [14000, 10000, 15000]);
  });

  it('fails on a zero-length line (PML divides by length())', () => {
    expect(distanceAlongSegment({ start: PLINE.start, end: PLINE.start }, 0.1, PLINE.start))
      .toEqual({ ok: false, reason: 'zero-length-segment' });
  });
});

describe('Proportion / Mid-Point (GMFLINE.proportion)', () => {
  it('Mid-Point is Proportion 0.5 regardless of which end is nearer', () => {
    expectMm(positionOf(proportionAlongSegment(PLINE, 0.5, mm(10500, 10000, 15000))), [12000, 10000, 15000]);
    expectMm(positionOf(proportionAlongSegment(PLINE, 0.5, mm(13500, 10000, 15000))), [12000, 10000, 15000]);
  });

  it('Proportion 0.25 is measured from the nearest end', () => {
    expectMm(positionOf(proportionAlongSegment(PLINE, 0.25, mm(10500, 10000, 15000))), [11000, 10000, 15000]);
    expectMm(positionOf(proportionAlongSegment(PLINE, 0.25, mm(13500, 10000, 15000))), [13000, 10000, 15000]);
  });

  it('a control point outside the extent returns the nearest end instead', () => {
    expectMm(positionOf(proportionAlongSegment(PLINE, 0.5, mm(16000, 10000, 15000))), [14000, 10000, 15000]);
    expectMm(positionOf(proportionAlongSegment(PLINE, 0.5, mm(9000, 10000, 15000))), [10000, 10000, 15000]);
  });
});

describe('Fraction (GMFLINE.fraction)', () => {
  it('Fraction 2 (E3D default) snaps to start / mid / end, whichever is nearest', () => {
    expectMm(positionOf(fractionAlongSegment(PLINE, 2, mm(10800, 10000, 15000))), [10000, 10000, 15000]);
    expectMm(positionOf(fractionAlongSegment(PLINE, 2, mm(11300, 10000, 15000))), [12000, 10000, 15000]);
    expectMm(positionOf(fractionAlongSegment(PLINE, 2, mm(13700, 10000, 15000))), [14000, 10000, 15000]);
  });

  it('Fraction 3 exposes thirds; Fraction 4 quarters', () => {
    expectMm(positionOf(fractionAlongSegment(PLINE, 3, mm(11500, 10000, 15000))), [11333.333333, 10000, 15000]);
    expectMm(positionOf(fractionAlongSegment(PLINE, 3, mm(12500, 10000, 15000))), [12666.666667, 10000, 15000]);
    expectMm(positionOf(fractionAlongSegment(PLINE, 4, mm(10900, 10000, 15000))), [11000, 10000, 15000]);
  });

  it('truncates a real fraction value like REAL.int()', () => {
    expectMm(positionOf(fractionAlongSegment(PLINE, 3.9, mm(11500, 10000, 15000))), [11333.333333, 10000, 15000]);
  });

  it('a tie goes to the segment start (the end nearer to the pick)', () => {
    // Exactly between 10000 and 12000 with Fraction 2: PML `gt` keeps `start`.
    expectMm(positionOf(fractionAlongSegment(PLINE, 2, mm(11000, 10000, 15000))), [10000, 10000, 15000]);
  });

  it('outside the extent → nearest end; int(n) < 1 → the control point (loop never runs)', () => {
    expectMm(positionOf(fractionAlongSegment(PLINE, 2, mm(16000, 10000, 15000))), [14000, 10000, 15000]);
    expectMm(positionOf(fractionAlongSegment(PLINE, 0, mm(11300, 10000, 15000))), [11300, 10000, 15000]);
  });
});

describe('derivePickPosition · dispatch on geometry kind', () => {
  const ppoint = { kind: 'point' as const, position: mm(10000, 10000, 15000), direction: [0, 1, 0] as PickVec3 };

  it('P-point picks ignore Snap / Cursor / Mid-Point / Fraction / Proportion', () => {
    for (const type of ['snap', 'exact', 'midpoint', 'fraction', 'proportion'] as const) {
      expectMm(positionOf(derivePickPosition({ type, geometry: ppoint })), [10000, 10000, 15000]);
    }
  });

  it('Distance on a P-point offsets along its direction (pPosition.offset(pDirection, d))', () => {
    expectMm(positionOf(derivePickPosition({ type: 'distance', geometry: ppoint, distance: 0.25 })), [10000, 10250, 15000]);
    expectMm(positionOf(derivePickPosition({ type: 'distance', geometry: ppoint, distance: -0.1 })), [10000, 9900, 15000]);
  });

  it('Distance on a point without a direction (Aid POSITION) stays put', () => {
    expectMm(
      positionOf(derivePickPosition({ type: 'distance', geometry: { kind: 'point', position: ppoint.position }, distance: 1 })),
      [10000, 10000, 15000],
    );
  });

  it('segment geometry routes through GMFLINE with the ray control point', () => {
    const segment = { kind: 'segment' as const, start: PLINE.start, end: PLINE.end };
    expectMm(positionOf(derivePickPosition({ type: 'snap', geometry: segment, ray: rayOver(10700, 10200) })), [10000, 10000, 15000]);
    expectMm(positionOf(derivePickPosition({ type: 'exact', geometry: segment, ray: rayOver(10700, 10200) })), [10700, 10000, 15000]);
    expectMm(positionOf(derivePickPosition({ type: 'midpoint', geometry: segment, ray: rayOver(10700) })), [12000, 10000, 15000]);
    expectMm(positionOf(derivePickPosition({ type: 'proportion', geometry: segment, ray: rayOver(13700), proportion: 0.25 })), [13000, 10000, 15000]);
    expectMm(positionOf(derivePickPosition({ type: 'fraction', geometry: segment, ray: rayOver(12600), fraction: 4 })), [13000, 10000, 15000]);
    expectMm(positionOf(derivePickPosition({ type: 'distance', geometry: segment, ray: rayOver(13700), distance: 0.3 })), [13700, 10000, 15000]);
    expect(derivePickPosition({ type: 'snap', geometry: segment, ray: { origin: mm(0, 10500, 15000), direction: [1, 0, 0] } }))
      .toEqual({ ok: false, reason: 'ray-parallel' });
    expect(derivePickPosition({ type: 'snap', geometry: segment })).toEqual({ ok: false, reason: 'non-finite-input' });
  });

  it('plane geometry returns ray ∩ plane for every single-pick type', () => {
    const plane = { kind: 'plane' as const, position: mm(0, 0, 15000), normal: [0, 0, 1] as PickVec3 };
    for (const type of ['snap', 'exact', 'distance', 'midpoint', 'fraction', 'proportion'] as const) {
      expectMm(positionOf(derivePickPosition({ type, geometry: plane, ray: rayOver(12345, 10001) })), [12345, 10001, 15000]);
    }
    expect(derivePickPosition({ type: 'snap', geometry: plane, ray: { origin: mm(0, 0, 16000), direction: [1, 0, 0] } }))
      .toEqual({ ok: false, reason: 'ray-parallel' });
  });

  it('rejects non-finite input', () => {
    expect(derivePickPosition({ type: 'snap', geometry: { kind: 'point', position: [Number.NaN, 0, 0] } }))
      .toEqual({ ok: false, reason: 'non-finite-input' });
  });
});

describe('Intersect (EDGPICKTYPE.intersect)', () => {
  const east: PickSegment = { start: mm(0, 0, 0), end: mm(1000, 0, 0) };
  const north: PickSegment = { start: mm(500, -2000, 0), end: mm(500, -1000, 0) };

  it('line × line: coplanar lines meet at their (extended) intersection', () => {
    const result = intersectLines(east, north);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expectMm(result.position, [500, 0, 0]);
    expect(result.skew).toBe(false);
  });

  it('line × line: skew lines return the point on the first line nearest to the second, flagged skew', () => {
    const raised: PickSegment = { start: mm(500, -2000, 300), end: mm(500, -1000, 300) };
    const result = intersectLines(east, raised);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expectMm(result.position, [500, 0, 0]);
    expect(result.skew).toBe(true);
  });

  it('parallel lines → "Pick another line, last pick was parallel to first line"', () => {
    expect(intersectLines(east, { start: mm(0, 500, 0), end: mm(1000, 500, 0) }))
      .toEqual({ ok: false, reason: 'parallel-lines' });
  });

  it('line × plane and plane × line both intersect the line with the plane', () => {
    const plane = { kind: 'plane' as const, position: mm(700, 0, 0), normal: [1, 0, 0] as PickVec3 };
    const line = { kind: 'line' as const, start: east.start, end: east.end };
    for (const operands of [[line, plane], [plane, line]] as const) {
      const result = intersectPicks(operands);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expectMm(result.position, [700, 0, 0]);
    }
  });

  it('two planes need a third pick; three planes meet at a point', () => {
    const px = { kind: 'plane' as const, position: mm(100, 0, 0), normal: [1, 0, 0] as PickVec3 };
    const py = { kind: 'plane' as const, position: mm(0, 200, 0), normal: [0, 1, 0] as PickVec3 };
    const pz = { kind: 'plane' as const, position: mm(0, 0, 300), normal: [0, 0, 1] as PickVec3 };
    expect(intersectPicks([px, py])).toEqual({ ok: false, reason: 'needs-another-pick' });
    const result = intersectPicks([px, py, pz]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expectMm(result.position, [100, 200, 300]);
    expect(intersectPicks([px, py, { ...px, position: mm(900, 0, 0) }])).toEqual({ ok: false, reason: 'parallel-planes' });
  });

  it('a single operand is not enough', () => {
    expect(intersectPicks([{ kind: 'line', start: east.start, end: east.end }])).toEqual({ ok: false, reason: 'needs-another-pick' });
  });
});
