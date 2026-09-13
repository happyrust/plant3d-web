import { describe, expect, it } from 'vitest';

import { ReferenceFrameResolver, designPointToFrame } from './referenceFrameResolver';

import type { ReferenceFrameDataPort } from './ports';
import type { ReferenceFrameElementData, ReferenceFrameResult } from './types';
import type { MeasurementPoint } from '@/composables/useToolStore';

import {
  buildDistanceMeasurementResultRows,
  computeDistanceMeasurementResultInFrame,
} from '@/utils/xeokitMeasurementFormat';

/**
 * E3D 3.1 runtime golden G3-02 (rotated ordinary WRT), captured 2026-09-12 in
 * docs/verification/e3d-measurement-runtime-golden/G3-02-rotated-wrt.trace.txt.
 *
 * E3D rule under test: an ordinary (non-GENSEC) WRT reinterprets the World
 * delta in the element frame — offset = Rᵀ·Δworld with signs kept, U/V/W labels,
 * Distance invariant, Direction expressed in the element frame.
 */

const DEG = Math.PI / 180;

function mm(east: number, north: number, up: number): readonly [number, number, number] {
  return [east / 1000, north / 1000, up / 1000];
}

function point(designWorldPos: readonly [number, number, number]): MeasurementPoint {
  return {
    entityId: 'golden',
    worldPos: [...designWorldPos],
    designWorldPos: [...designWorldPos],
  };
}

/** Same World sample as golden G1. */
const FROM = point(mm(9769.75, 10047.18, 18664.8));
const TO = point(mm(7849.61, 10447.46, 14234.127));

/**
 * EQUI /Copy-of-RCS151MM (=24381/101439): ORI "Y is E and Z is U", POS W 6696.92 N 9656.05 U 6133.
 * World axes of the frame: X=S, Y=E, Z=U.
 */
const RCS151MM: ReferenceFrameElementData = {
  refno: '24381_101439',
  ownerRefno: null,
  coordinateSpace: 'design-world',
  lengthUnit: 'm',
  origin: mm(-6696.92, 9656.05, 6133),
  basis: {
    u: [0, -1, 0],
    v: [1, 0, 0],
    w: [0, 0, 1],
  },
  provenance: { source: 'e3d-golden-G3-02' },
};

/**
 * EQUI /Copy-of-RCS616MD (=24381/101423): ORI "Y is U and Z is S 21 E", POS W 6376.75 N 16349.28 U 2430.
 * World axes of the frame: X = E 21 N, Y = U, Z = S 21 E.
 */
const RCS616MD: ReferenceFrameElementData = {
  refno: '24381_101423',
  ownerRefno: null,
  coordinateSpace: 'design-world',
  lengthUnit: 'm',
  origin: mm(-6376.75, 16349.28, 2430),
  basis: {
    u: [Math.cos(21 * DEG), Math.sin(21 * DEG), 0],
    v: [0, 0, 1],
    w: [Math.sin(21 * DEG), -Math.cos(21 * DEG), 0],
  },
  provenance: { source: 'e3d-golden-G3-02' },
};

const port: ReferenceFrameDataPort = {
  currentElementRefno: () => null,
  elementByRefno: refno => {
    const element = [RCS151MM, RCS616MD].find(item => item.refno === refno);
    return element
      ? { ok: true, element }
      : { ok: false, reason: 'not-found', message: `missing ${refno}` };
  },
};

function valueOf<T>(result: ReferenceFrameResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function expectMm(actualM: number, expectedMm: number, toleranceMm = 0.01): void {
  expect(Math.abs(actualM * 1000 - expectedMm)).toBeLessThanOrEqual(toleranceMm);
}

/** E3D compass string → unit vector in the frame's own axes (X/Y/Z read as E/N/U). */
function compass(
  horizontalFrom: 'N' | 'S' | 'E' | 'W',
  swingDeg: number,
  horizontalToward: 'N' | 'S' | 'E' | 'W',
  tiltDeg: number,
  tilt: 'U' | 'D',
): readonly [number, number, number] {
  const axis = (name: 'N' | 'S' | 'E' | 'W'): readonly [number, number] => {
    switch (name) {
      case 'E': return [1, 0];
      case 'W': return [-1, 0];
      case 'N': return [0, 1];
      case 'S': return [0, -1];
    }
  };
  const [fx, fy] = axis(horizontalFrom);
  const [tx, ty] = axis(horizontalToward);
  const horizontal = Math.cos(tiltDeg * DEG);
  const swing = swingDeg * DEG;
  return [
    horizontal * (fx * Math.cos(swing) + tx * Math.sin(swing)),
    horizontal * (fy * Math.cos(swing) + ty * Math.sin(swing)),
    (tilt === 'U' ? 1 : -1) * Math.sin(tiltDeg * DEG),
  ];
}

describe('E3D 3.1 runtime golden G3-02 · rotated ordinary WRT', () => {
  const resolver = new ReferenceFrameResolver(port, { basisPolicy: 'reject' });

  it('World reference: the same sample reproduces the G1 rows', async () => {
    const frame = valueOf(await resolver.resolve('World'));
    const result = computeDistanceMeasurementResultInFrame(FROM, TO, frame)!;
    expectMm(result.distance, 4845.4130910139);
    expectMm(result.offsets.components[0], -1920.14003836707);
    expectMm(result.offsets.components[1], 400.279963591009);
    expectMm(result.offsets.components[2], -4430.67333555253);
    // Direction "W 11.7755 N 66.1215 D WRT /*".
    const expected = compass('W', 11.7755, 'N', 66.1215, 'D');
    expected.forEach((value, index) => expect(result.direction!.vector[index]).toBeCloseTo(value, 5));
  });

  it('/Copy-of-RCS151MM (Y is E and Z is U): offsets U -400.28 / V -1920.14 / W -4430.67 mm', async () => {
    const frame = valueOf(await resolver.resolve('=24381/101439'));
    expect(frame.kind).toBe('element');
    expect(frame.axisLabels).toEqual(['U', 'V', 'W']);

    const result = computeDistanceMeasurementResultInFrame(FROM, TO, frame)!;
    expectMm(result.distance, 4845.41);
    expectMm(result.offsets.components[0], -400.279999999999);
    expectMm(result.offsets.components[1], -1920.14);
    expectMm(result.offsets.components[2], -4430.673);

    // from_in_wrt = W 391.13 N 16466.67 U 12531.8 → local (-391.13, 16466.67, 12531.8) mm.
    const fromLocal = valueOf(designPointToFrame(frame, FROM.designWorldPos!));
    expectMm(fromLocal[0], -391.13);
    expectMm(fromLocal[1], 16466.67);
    expectMm(fromLocal[2], 12531.8);
    // to_in_wrt = W 791.41 N 14546.53 U 8101.127.
    const toLocal = valueOf(designPointToFrame(frame, TO.designWorldPos!));
    expectMm(toLocal[0], -791.41);
    expectMm(toLocal[1], 14546.53);
    expectMm(toLocal[2], 8101.127);

    // Direction "S 11.7755 W 66.1215 D WRT /Copy-of-RCS151MM" read in the frame's own axes.
    const expected = compass('S', 11.7755, 'W', 66.1215, 'D');
    expected.forEach((value, index) => expect(result.direction!.vector[index]).toBeCloseTo(value, 5));

    const rows = buildDistanceMeasurementResultRows(result, 'mm', 2);
    expect(rows.map(row => row.label)).toEqual([
      'Distance',
      'Offset U',
      'Offset V',
      'Offset W',
      'Direction',
    ]);
    expect(rows[0]!.valueText).toBe('4845.41mm');
    expect(rows[1]!.valueText).toBe('-400.28mm');
    expect(rows[2]!.valueText).toBe('-1920.14mm');
    expect(rows[3]!.valueText).toBe('-4430.67mm');
  });

  it('/Copy-of-RCS616MD (Y is U and Z is S 21 E): offsets -1649.16 / -4430.67 / -1061.81 mm', async () => {
    const frame = valueOf(await resolver.resolve('=24381/101423'));
    expect(frame.axisLabels).toEqual(['U', 'V', 'W']);

    const result = computeDistanceMeasurementResultInFrame(FROM, TO, frame)!;
    expectMm(result.distance, 4845.41);
    expectMm(result.offsets.components[0], -1649.15759729034);
    expectMm(result.offsets.components[1], -4430.673);
    expectMm(result.offsets.components[2], -1061.81020775821);

    // from_in_wrt = E 12815.586 N 16234.8 U 11669.905; to_in_wrt = E 11166.428 N 11804.127 U 10608.095.
    const fromLocal = valueOf(designPointToFrame(frame, FROM.designWorldPos!));
    expectMm(fromLocal[0], 12815.586);
    expectMm(fromLocal[1], 16234.8);
    expectMm(fromLocal[2], 11669.905);
    const toLocal = valueOf(designPointToFrame(frame, TO.designWorldPos!));
    expectMm(toLocal[0], 11166.428);
    expectMm(toLocal[1], 11804.127);
    expectMm(toLocal[2], 10608.095);

    // Direction "S 20.416 W 12.6584 D WRT /Copy-of-RCS616MD".
    const expected = compass('S', 20.416, 'W', 12.6584, 'D');
    expected.forEach((value, index) => expect(result.direction!.vector[index]).toBeCloseTo(value, 5));
  });

  it('the projection is Rᵀ·Δworld: components dotted with the World-expressed axes', async () => {
    const frame = valueOf(await resolver.resolve('=24381/101423'));
    const from = FROM.designWorldPos!;
    const to = TO.designWorldPos!;
    const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const;
    const dot = (axis: readonly [number, number, number]) =>
      delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2];
    const result = computeDistanceMeasurementResultInFrame(FROM, TO, frame)!;
    expect(result.offsets.components[0]).toBeCloseTo(dot(frame.basis.u), 12);
    expect(result.offsets.components[1]).toBeCloseTo(dot(frame.basis.v), 12);
    expect(result.offsets.components[2]).toBeCloseTo(dot(frame.basis.w), 12);
    // Distance is frame-invariant.
    expect(result.distance).toBeCloseTo(Math.hypot(...delta), 12);
  });
});
