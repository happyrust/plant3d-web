import { describe, expect, it } from 'vitest';

import { ReferenceFrameResolver } from './referenceFrameResolver';

import type { ReferenceFrameDataPort } from './ports';
import type { ReferenceFrameElementData, ReferenceFrameResult } from './types';
import type { MeasurementPoint } from '@/composables/useToolStore';

import {
  buildDistanceMeasurementResultRows,
  buildMeasurementComponentsText,
  computeDistanceMeasurementResultInFrame,
  formatMeasurementSummary,
  isGensecReferenceFrame,
} from '@/utils/xeokitMeasurementFormat';

/**
 * E3D 3.1 runtime golden G3-04 (GENSEC as WRT), captured 2026-09-11 in
 * docs/verification/e3d-measurement-runtime-golden/G3-04-gensec-wrt.trace.txt:
 *
 *   wrt==23406/14  wrt_type=GENSEC  wrt_ydir_world=S  wrt_zdir_world=U
 *   offset_1_text=1920.14mm  offset_2_text=400.28mm  offset_3_text=4430.67mm
 *   direction_world=W 11.7755 N 66.1215 D WRT /*   (displayed)
 *   direction_wrt=N 11.7755 E 66.1215 D WRT =23406/14   (not displayed)
 *
 * E3D rule under test (`gphmeasure.pmlfrm` 396–399 + `offsetType()`): a GENSEC frame keeps
 * U/V/W labels, but the three Offset rows are the **non-negative** projections on the frame
 * axes and Direction is expressed in **World**. The same World sample as G1 / G3-02.
 */

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

const FROM = point(mm(9769.75, 10047.18, 18664.8));
const TO = point(mm(7849.61, 10447.46, 14234.127));

/**
 * GENSEC =23406/14 has two frames in the trace:
 * - ORI (what `POS WRT` / `DIRECTION.wrt` use, and what `/api/pdms/transform` returns): from the
 *   positions `E 5897.18 S 9694.75 U 18669.8` → `E 6297.46 S 7774.61 U 14239.127` and
 *   `direction_wrt=N 11.7755 E 66.1215 D`, X = N, Y = W, Z = U.
 * - Section frame (`wrt_ydir_world=S`, `wrt_zdir_world=U`): X = W, Y = S, Z = U (W × S = U).
 * Only the section frame reproduces the displayed offsets 1920.14 / 400.28 / 4430.67
 * (|Δ·W| / |Δ·S| / |Δ·U|); the ORI frame would give 400.28 / 1920.14 / 4430.67.
 * The origin is not in the trace; offsets and directions do not depend on it.
 */
const ORI_BASIS = {
  u: [0, 1, 0],
  v: [-1, 0, 0],
  w: [0, 0, 1],
} as const;
const SECTION_BASIS = {
  u: [-1, 0, 0],
  v: [0, -1, 0],
  w: [0, 0, 1],
} as const;

const GENSEC: ReferenceFrameElementData = {
  refno: '23406_14',
  ownerRefno: null,
  coordinateSpace: 'design-world',
  lengthUnit: 'm',
  origin: mm(0, 0, 0),
  basis: ORI_BASIS,
  noun: 'GENSEC',
  sectionBasis: SECTION_BASIS,
  provenance: { source: 'e3d-golden-G3-04' },
};

/** Same ORI frame, but the type is unknown → ordinary element rule (signed offsets, frame direction). */
const UNTYPED = { ...GENSEC, refno: '23406_15', noun: null, sectionBasis: null } satisfies ReferenceFrameElementData;

/** GENSEC whose p-lines were unavailable: the ORI axes stand in for the section frame (documented fallback). */
const NO_SECTION = { ...GENSEC, refno: '23406_16', sectionBasis: null } satisfies ReferenceFrameElementData;

const port: ReferenceFrameDataPort = {
  currentElementRefno: () => null,
  elementByRefno: refno => {
    const element = [GENSEC, UNTYPED, NO_SECTION].find(item => item.refno === refno);
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

describe('E3D 3.1 runtime golden G3-04 · GENSEC as WRT', () => {
  const resolver = new ReferenceFrameResolver(port, { basisPolicy: 'reject' });

  it('Offset rows are the non-negative projections 1920.14 / 400.28 / 4430.67 mm under U/V/W labels', async () => {
    const frame = valueOf(await resolver.resolve('=23406/14'));
    expect(frame.kind).toBe('element');
    expect(frame.noun).toBe('GENSEC');
    expect(isGensecReferenceFrame(frame)).toBe(true);

    expect(frame.sectionBasis).toEqual(SECTION_BASIS);

    const result = computeDistanceMeasurementResultInFrame(FROM, TO, frame)!;
    expect(result.offsetMode).toBe('magnitude');
    expect(result.distance * 1000).toBeCloseTo(4845.41, 2);
    // Signed section-frame projections would be +1920.14 (W) / -400.28 (S) / -4430.67 (U); E3D shows magnitudes.
    expect(result.offsets.components.map(v => v * 1000)).toEqual([
      expect.closeTo(1920.14, 2),
      expect.closeTo(400.28, 2),
      expect.closeTo(4430.67, 2),
    ]);

    const rows = buildDistanceMeasurementResultRows(result, 'mm', 2);
    expect(rows.map(row => [row.label, row.valueText])).toEqual([
      ['Distance', '4845.41mm'],
      ['Offset U', '1920.14mm'],
      ['Offset V', '400.28mm'],
      ['Offset W', '4430.67mm'],
      // Direction follows World, not the GENSEC frame (which would read "N 11.7755 E 66.1215 D").
      ['Direction', 'W 11.7755 N 66.1215 D'],
    ]);
  });

  it('list summary and "copy components" print the magnitudes without a sign', async () => {
    const frame = valueOf(await resolver.resolve('=23406/14'));
    const record = {
      id: 'g3-04',
      kind: 'distance' as const,
      origin: FROM,
      target: TO,
      visible: true,
      approximate: false,
      createdAt: 1,
    };
    expect(formatMeasurementSummary(record, 'mm', 2, { referenceFrame: frame }))
      .toContain('距离 4845.41mm · U 1920.14mm · V 400.28mm · W 4430.67mm');
    expect(buildMeasurementComponentsText(record, 'mm', 2, frame)).toBe('U 1920.14mm\nV 400.28mm\nW 4430.67mm');
  });

  it('the same frame without a known type falls back to the ordinary element rule', async () => {
    const frame = valueOf(await resolver.resolve('=23406/15'));
    expect(frame.noun).toBeNull();
    expect(isGensecReferenceFrame(frame)).toBe(false);

    const result = computeDistanceMeasurementResultInFrame(FROM, TO, frame)!;
    expect(result.offsetMode).toBe('signed');
    const rows = buildDistanceMeasurementResultRows(result, 'mm', 2);
    expect(rows.map(row => row.valueText)).toEqual([
      '4845.41mm',
      // ORI frame X = N / Y = W / Z = U: the from/to positions of the trace read in this frame.
      '+400.28mm',
      '+1920.14mm',
      '-4430.67mm',
      // Frame-expressed direction: trace `direction_wrt=N 11.7755 E 66.1215 D`.
      'N 11.7755 E 66.1215 D',
    ]);
  });

  it('GENSEC without a derivable section frame falls back to magnitudes on the ORI axes (order differs from E3D)', async () => {
    const frame = valueOf(await resolver.resolve('=23406/16'));
    expect(isGensecReferenceFrame(frame)).toBe(true);
    expect(frame.sectionBasis).toBeNull();
    const rows = buildDistanceMeasurementResultRows(computeDistanceMeasurementResultInFrame(FROM, TO, frame)!, 'mm', 2);
    expect(rows.map(row => row.valueText)).toEqual([
      '4845.41mm',
      '400.28mm',
      '1920.14mm',
      '4430.67mm',
      'W 11.7755 N 66.1215 D',
    ]);
  });
});
