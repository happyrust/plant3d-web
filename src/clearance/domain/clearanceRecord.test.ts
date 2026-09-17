import { describe, expect, it } from 'vitest';

import {
  clearanceModelChanged,
  clearanceRecordId,
  createClearanceRecord,
  isClearanceRecord,
  normalizeClearanceRefno,
  withClearanceStatus,
  type ClearanceRecordInput,
} from './clearanceRecord';

import { createComputationProvenance } from '@/measurement/domain/computationProvenance';

function provenance() {
  return createComputationProvenance({
    method: 'surface-to-surface',
    accuracyClass: 'exact-surface',
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
    inputs: { sourceRefno: '24384/22582', targetRefno: '17496_105912', targetKind: 'wall' },
    sourceNoun: 'elbo',
    targetNoun: 'WALL',
    provenance: provenance(),
    snapshot: {
      distanceM: 0.06443,
      intersects: false,
      sourcePoint: [120, 45, 3.2],
      targetPoint: [120.0644, 44.9989, 3.2],
      vector: [0.0644, -0.0011, 0],
      sourceLeafRefno: '24384/22582',
      targetLeafRefno: '17496/105912',
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

describe('clearanceRecord', () => {
  it('normalizes refnos to a_b, derives the id from the inputs and upper-cases nouns', () => {
    const record = createClearanceRecord(input());
    expect(record.id).toBe('clearance:24384_22582:17496_105912');
    expect(record.inputs).toEqual({ sourceRefno: '24384_22582', targetRefno: '17496_105912', targetKind: 'wall' });
    expect(record.sourceNoun).toBe('ELBO');
    expect(record.snapshot?.sourceLeafRefno).toBe('24384_22582');
    expect(record.snapshot?.targetLeafRefno).toBe('17496_105912');
    expect(record.snapshot?.targetLeafNoun).toBe('WALL');
    expect(record.status).toBe('current');
    expect(record.createdAt).toBe(record.computedAt);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isClearanceRecord(record)).toBe(true);
    expect(clearanceRecordId({ sourceRefno: ' 24384/22582 ', targetRefno: '17496_105912' })).toBe(record.id);
    expect(normalizeClearanceRefno('not-a-refno')).toBe('not-a-refno');
  });

  it('rejects records without a valid provenance contract (M0: no method / accuracyClass, no record)', () => {
    expect(() => createClearanceRecord(input({ provenance: undefined as never }))).toThrow(/provenance/);
    const broken = { ...provenance(), accuracyClass: 'approximate-bounds' } as never;
    expect(() => createClearanceRecord(input({ provenance: broken }))).toThrow(/provenance/);
  });

  it('rejects identical endpoints, unknown kinds / statuses / faces and non-finite geometry', () => {
    expect(() => createClearanceRecord(input({
      inputs: { sourceRefno: '1/2', targetRefno: '1_2', targetKind: 'wall' },
    }))).toThrow(/must differ/);
    expect(() => createClearanceRecord(input({ kind: 'pipe-to-pipe' as never }))).toThrow(/kind/);
    expect(() => createClearanceRecord(input({ status: 'done' as never }))).toThrow(/status/);
    const snapshot = input().snapshot!;
    expect(() => createClearanceRecord(input({
      snapshot: { ...snapshot, targetFace: { ...snapshot.targetFace!, kind: 'roof' as never } },
    }))).toThrow(/targetFace\.kind/);
    expect(() => createClearanceRecord(input({
      snapshot: { ...snapshot, distanceM: Number.NaN },
    }))).toThrow(/distanceM/);
    expect(() => createClearanceRecord(input({
      snapshot: { ...snapshot, sourcePoint: [1, 2] as never },
    }))).toThrow(/sourcePoint/);
    expect(() => createClearanceRecord(input({
      snapshot: { ...snapshot, intersects: true },
    }))).toThrow(/intersects/);
  });

  it('accepts a null snapshot (beyond max distance) and an intersecting snapshot with zero distance', () => {
    const empty = createClearanceRecord(input({ snapshot: null }));
    expect(empty.snapshot).toBeNull();
    const snapshot = input().snapshot!;
    const hit = createClearanceRecord(input({
      snapshot: {
        ...snapshot,
        distanceM: 0,
        intersects: true,
        targetFace: null,
        perpendicular: null,
        witness: 'aabb-overlap-center',
      },
    }));
    expect(hit.snapshot?.intersects).toBe(true);
    expect(hit.snapshot?.witness).toBe('aabb-overlap-center');
  });

  it('withClearanceStatus keeps the snapshot and returns the same object when unchanged', () => {
    const record = createClearanceRecord(input());
    const stale = withClearanceStatus(record, 'stale');
    expect(stale.status).toBe('stale');
    expect(stale.snapshot).toBe(record.snapshot);
    expect(withClearanceStatus(record, 'current')).toBe(record);
  });

  it('clearanceModelChanged only compares a side when its current sesno is known', () => {
    const record = createClearanceRecord(input());
    expect(clearanceModelChanged(record, {})).toBe(false);
    expect(clearanceModelChanged(record, { sourceSesno: 586, targetSesno: 729 })).toBe(false);
    expect(clearanceModelChanged(record, { targetSesno: 730 })).toBe(true);
    expect(clearanceModelChanged(record, { sourceSesno: null })).toBe(false);
    const unknown = createClearanceRecord(input({ modelVersion: { sourceSesno: null, targetSesno: null } }));
    expect(clearanceModelChanged(unknown, { sourceSesno: 1, targetSesno: 2 })).toBe(false);
  });
});
