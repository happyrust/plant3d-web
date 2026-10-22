import { describe, expect, it } from 'vitest';

import {
  CLEARANCE_EXTERNAL_SOURCE,
  clearanceDimensionText,
  clearanceRecordsToExternalDimensions,
  clearanceSourceLabel,
} from './clearanceExternalDimensions';

import type { PipeRowMetric } from '@/clearance/domain/pipeRowTypes';

import { createClearanceRecord, withClearanceStatus, type ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import {
  beyondMaxDistanceResponse,
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
  intersectingResponse,
  pipeInWallOpeningResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';
import { normalizeExternalDimension } from '@/dimension';
import { accuracyClassForMethod, createComputationProvenance } from '@/measurement/domain/computationProvenance';

const AT = new Date('2026-09-17T12:00:00.000Z');
const INPUT = { sourceRefno: '24384_22582', targetRefno: '17496_105912' } as const;

/** 最小连排记录：pair 在 y 向相距 centerDistanceMm，metric 决定 id / 方法 / signedGapM，targetEvidence 定目标侧外径来源。 */
function pipeRowRecord(
  metric: PipeRowMetric,
  centerDistanceMm: number,
  targetEvidence: 'catalogue' | 'bore-estimate' = 'catalogue',
): ClearanceRecord {
  const method = metric === 'center-distance' ? 'pipe-row-center-distance' : 'pipe-row-derived-gap';
  return createClearanceRecord({
    id: `piperow:center:${metric}:a~0_1:b~0_1@0-5000`,
    kind: 'component-to-component',
    inputs: { sourceRefno: 'a~0_1', targetRefno: 'b~0_1', targetKind: 'any' },
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance: createComputationProvenance({
      method,
      accuracyClass: accuracyClassForMethod(method),
      coordinateSpace: 'design-world',
      sourceModelVersion: 'sesno:1',
      source: { entityId: 'a', refno: 'a', segmentRefno: 'a~0_1' },
      target: { entityId: 'b', refno: 'b', segmentRefno: 'b~0_1' },
      warnings: [],
    }),
    snapshot: {
      distanceM: centerDistanceMm / 1000,
      intersects: false,
      sourcePoint: [0, 0, 0],
      targetPoint: [0, centerDistanceMm / 1000, 0],
      vector: [0, centerDistanceMm / 1000, 0],
      sourceLeafRefno: 'a~0_1',
      targetLeafRefno: 'b~0_1',
      targetLeafNoun: 'BRAN',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    pipeRow: {
      alignMode: 'center',
      metric,
      signedGapM: metric === 'derived-gap' ? centerDistanceMm / 1000 - 0.1 : null,
      section: { point: [0, 0, 0], normal: [1, 0, 0], axialStartM: 0, axialEndM: 5 },
      rowGroupId: 'row:a~0_1|b~0_1@0-5000:center',
      sourceOd: { odM: 0.1, evidence: 'catalogue' },
      targetOd: { odM: 0.1, evidence: targetEvidence },
    },
    modelVersion: { sourceSesno: 1, targetSesno: 1 },
    status: 'current',
    sourceAnnotation: null,
    computedAt: AT.toISOString(),
  });
}

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
    expect(dimension!.sourceLabel).toBe('实体外表面净距: 24384_22582 → 17496_105912（墙面外侧）');
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
    expect(clearanceSourceLabel(straight)).toBe('实体外表面净距: 24384_24830 → 17496_105812（墙面）');
    expect(clearanceDimensionText(withClearanceStatus(straight, 'stale'))).toBe('（过期）885mm');
    expect(clearanceDimensionText(withClearanceStatus(straight, 'failed'))).toBe('（重算失败，旧值）885mm');

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
    expect(clearanceSourceLabel(inHole)).toBe('实体外表面净距: 24384_30001 → 17496_105812（洞口）');
    expect(clearanceDimensionText(inHole)).toBe('50mm ⊥');
  });

  it('连排双度量：推导间隔画到连线另一侧，尺寸文字自带口径前缀', () => {
    const center = pipeRowRecord('center-distance', 300);
    const gap = pipeRowRecord('derived-gap', 50);
    expect(clearanceDimensionText(center)).toBe('中心距 300mm');
    expect(clearanceDimensionText(gap)).toBe('名义间隔 50mm');
    const result = clearanceRecordsToExternalDimensions([center, gap]);
    expect(result.skipped).toEqual([]);
    expect(result.records.map(d => ('placement' in d.layout && 'side' in d.layout.placement ? d.layout.placement.side : null))).toEqual([1, -1]);
    expect(result.records.map(d => d.sourceLabel)).toEqual([
      '连排截面中心距: a~0_1 → b~0_1',
      '连排外径推导间隔: a~0_1 → b~0_1',
    ]);
  });

  it('连排推导间隔：精度档 derived-nominal 不让每条都带 ≈，只有外径为估算时带；中心距不带', () => {
    expect(pipeRowRecord('derived-gap', 50).provenance.accuracyClass).toBe('derived-nominal');
    expect(clearanceDimensionText(pipeRowRecord('derived-gap', 50))).toBe('名义间隔 50mm');
    const gap = pipeRowRecord('derived-gap', 50, 'bore-estimate');
    expect(clearanceDimensionText(gap)).toBe('≈名义间隔 50mm');
    expect(clearanceDimensionText(withClearanceStatus(gap, 'stale'))).toBe('（过期）≈名义间隔 50mm');
    expect(clearanceDimensionText(pipeRowRecord('center-distance', 300, 'bore-estimate'))).toBe('中心距 300mm');
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
