import { describe, expect, it } from 'vitest';

import {
  CLEARANCE_EXTERNAL_SOURCE,
  clearanceDimensionText,
  clearanceRecordsToExternalDimensions,
  clearanceSourceLabel,
} from './clearanceExternalDimensions';

import { withClearanceStatus } from '@/clearance/domain/clearanceRecord';
import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import {
  beyondMaxDistanceResponse,
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
  intersectingResponse,
  pipeInWallOpeningResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';
import { normalizeExternalDimension } from '@/dimension';

const AT = new Date('2026-09-17T12:00:00.000Z');
const INPUT = { sourceRefno: '24384_22582', targetRefno: '17496_105912' } as const;

describe('clearanceExternalDimensions', () => {
  it('maps a current record to one linear external dimension in design-world metres', () => {
    const record = surfaceClearanceToRecord(elboToCurvedWallResponse(), INPUT, AT);
    const result = clearanceRecordsToExternalDimensions([record]);
    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(1);
    const [dimension] = result.records;
    expect(dimension!.id).toBe(`${CLEARANCE_EXTERNAL_SOURCE}:${record.id}`);
    expect(dimension!.source).toBe('clearance');
    expect(dimension!.role).toBe('external');
    expect(dimension!.sourceLabel).toBe('外表面净距: 24384_22582 → 17496_105912（墙面外侧）');
    const layout = normalizeExternalDimension(dimension!);
    expect(layout).toMatchObject({
      kind: 'linear',
      role: 'external',
      labelPinned: false,
      authoritativeText: '64mm ⊥',
      a: [120, 45, 3.2],
      placement: { offsetM: 0.5, labelT: 0.5, side: 1 },
    });
    expect((layout as { b: readonly number[] }).b[0]).toBeCloseTo(120.0644, 6);
  });

  it('formats text by status and geometry: stale prefix, no ⊥ without a perpendicular, sub-10mm keeps a decimal', () => {
    const straight = surfaceClearanceToRecord(boxToStraightWallResponse(), { sourceRefno: '24384_24830', targetRefno: '17496_105812' }, AT);
    expect(clearanceDimensionText(straight)).toBe('885mm');
    expect(clearanceSourceLabel(straight)).toBe('外表面净距: 24384_24830 → 17496_105812（墙面）');
    expect(clearanceDimensionText(withClearanceStatus(straight, 'stale'))).toBe('（过期）885mm');

    const tiny = surfaceClearanceToRecord(
      elboToCurvedWallResponse({ result: { ...elboToCurvedWallResponse().result!, distance_mm: 6.44, perpendicular: null } }),
      INPUT,
      AT,
    );
    expect(clearanceDimensionText(tiny)).toBe('6.4mm');
  });

  it('labels a hit on a wall opening as 洞口 and keeps its ⊥ (opening is a main face)', () => {
    const inHole = surfaceClearanceToRecord(pipeInWallOpeningResponse(), { sourceRefno: '24384_30001', targetRefno: '17496_105812' }, AT);
    expect(inHole.snapshot?.targetFace?.kind).toBe('opening');
    expect(clearanceSourceLabel(inHole)).toBe('外表面净距: 24384_30001 → 17496_105812（洞口）');
    expect(clearanceDimensionText(inHole)).toBe('50mm ⊥');
  });

  it('skips records without a drawable line (no snapshot, intersecting) and says why', () => {
    const none = surfaceClearanceToRecord(beyondMaxDistanceResponse(), INPUT, AT);
    const hit = surfaceClearanceToRecord(intersectingResponse(), INPUT, AT);
    expect(clearanceDimensionText(hit)).toBe('相交');
    expect(clearanceDimensionText(none)).toBe('');
    const result = clearanceRecordsToExternalDimensions([none, hit], { offsetM: 0.2 });
    expect(result.records).toEqual([]);
    expect(result.skipped.map(item => item.reason)).toEqual([
      'No snapshot (beyond max distance or never computed)',
      'Intersecting objects have no dimension line',
    ]);
  });
});
