import { describe, expect, it } from 'vitest';

import { clearanceRecordToDimensionInput } from './clearanceDimensionInput';

import {
  createClearanceRecord,
  withDerivedDimension,
  type ClearanceRecordInput,
} from '@/clearance/domain/clearanceRecord';
import { accuracyClassForMethod, createComputationProvenance } from '@/measurement/domain/computationProvenance';

function provenance(method: 'surface-to-surface' | 'aabb-to-aabb' = 'surface-to-surface') {
  return createComputationProvenance({
    method,
    accuracyClass: method === 'surface-to-surface' ? 'exact-surface' : 'approximate-bounds',
    coordinateSpace: 'design-world',
    source: { entityId: '24384_22582', refno: '24384_22582' },
    target: { entityId: '17496_105912', refno: '17496_105912' },
    sourceModelVersion: 'src:586;tgt:729',
    errorBoundM: 0.0005,
  });
}

function input(overrides: Partial<ClearanceRecordInput> = {}): ClearanceRecordInput {
  return {
    kind: 'component-to-wall',
    inputs: { sourceRefno: '24384_22582', targetRefno: '17496_105912', targetKind: 'wall' },
    provenance: provenance(),
    snapshot: {
      distanceM: 0.06443,
      intersects: false,
      sourcePoint: [120, 45, 3.2],
      targetPoint: [120.0644, 44.9989, 3.2],
      vector: [0.0644, -0.0011, 0],
      sourceLeafRefno: '24384_22582',
      targetLeafRefno: '17496_105912',
      targetLeafNoun: 'wall',
      targetFace: { kind: 'outer', normal: [-0.9998, 0.0171, 0], confidence: 'geometric' },
      perpendicular: { distanceM: 0.0645, from: [120, 45, 3.2], to: [120.06449, 44.9989, 3.2] },
      witness: 'closest-points',
    },
    modelVersion: { sourceSesno: 586, targetSesno: 729 },
    computedAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

const options = { id: 'dim-1', authorId: 'u1', authorRole: 'designer', createdAt: 1726567200000 };

describe('clearanceRecordToDimensionInput', () => {
  it('casts snapshot endpoints into a linear dimension with semantic anchors on both leaves', () => {
    const record = createClearanceRecord(input());
    const dim = clearanceRecordToDimensionInput(record, options);
    expect(dim).not.toBeNull();
    expect(dim!.kind).toBe('linear');
    expect(dim!.a).toEqual({
      snapshot: [120, 45, 3.2],
      accuracy: 'exact',
      semanticRef: { source: 'model-surface', refno: '24384_22582' },
    });
    expect(dim!.b).toEqual({
      snapshot: [120.0644, 44.9989, 3.2],
      accuracy: 'exact',
      semanticRef: { source: 'model-surface', refno: '17496_105912' },
    });
    expect(dim!.placement).toEqual({ offsetM: 0.3, labelT: 0.5, side: 1 });
    expect(dim!.authorId).toBe('u1');
    expect(dim!.validity).toBe('valid');
  });

  it('projects approximate provenance to approximate dimension accuracy', () => {
    const record = createClearanceRecord(input({ provenance: provenance('aabb-to-aabb') }));
    const dim = clearanceRecordToDimensionInput(record, options);
    expect(dim!.a.accuracy).toBe('approximate');
    expect(dim!.b.accuracy).toBe('approximate');
  });

  it('projects every pipe-row derived gap to approximate: a nominal cylinder-model value is never an exact dimension', () => {
    const pipeRowGap = (targetEvidence: 'catalogue' | 'bore-estimate') => createClearanceRecord(input({
      kind: 'component-to-component',
      inputs: { sourceRefno: 'a~0_1', targetRefno: 'b~0_1', targetKind: 'any' },
      provenance: createComputationProvenance({
        method: 'pipe-row-derived-gap',
        accuracyClass: accuracyClassForMethod('pipe-row-derived-gap'),
        coordinateSpace: 'design-world',
        source: { entityId: 'a', refno: 'a', segmentRefno: 'a~0_1' },
        target: { entityId: 'b', refno: 'b', segmentRefno: 'b~0_1' },
      }),
      snapshot: { ...input().snapshot!, targetFace: null, perpendicular: null },
      pipeRow: {
        alignMode: 'center',
        metric: 'derived-gap',
        signedGapM: 0.06443,
        section: { point: [0, 0, 0], normal: [1, 0, 0], axialStartM: 0, axialEndM: 5 },
        rowGroupId: 'row:a~0_1|b~0_1@0.0-5000.0:center',
        sourceOd: { odM: 0.1143, evidence: 'catalogue' },
        targetOd: { odM: 0.0603, evidence: targetEvidence },
      },
    }));
    for (const evidence of ['catalogue', 'bore-estimate'] as const) {
      const dimension = clearanceRecordToDimensionInput(pipeRowGap(evidence), options);
      expect(dimension!.a.accuracy).toBe('approximate');
      expect(dimension!.b.accuracy).toBe('approximate');
    }
  });

  it('does not mutate the clearance record — linking is a separate explicit step', () => {
    const record = createClearanceRecord(input());
    clearanceRecordToDimensionInput(record, options);
    expect(record.derivedDimensionId).toBeNull();
    const linked = withDerivedDimension(record, 'dim-1');
    expect(linked.derivedDimensionId).toBe('dim-1');
    expect(withDerivedDimension(linked, null).derivedDimensionId).toBeNull();
  });

  it('returns null when the snapshot is missing or the pair intersects', () => {
    const noSnapshot = createClearanceRecord(input({ snapshot: null }));
    expect(clearanceRecordToDimensionInput(noSnapshot, options)).toBeNull();
    const intersecting = createClearanceRecord(input({
      snapshot: { ...input().snapshot!, distanceM: 0, intersects: true, perpendicular: null },
    }));
    expect(clearanceRecordToDimensionInput(intersecting, options)).toBeNull();
  });

  it('still converts stale records — the retained snapshot is the honest old value', () => {
    const record = createClearanceRecord(input({ status: 'stale' }));
    expect(clearanceRecordToDimensionInput(record, options)).not.toBeNull();
  });
});
