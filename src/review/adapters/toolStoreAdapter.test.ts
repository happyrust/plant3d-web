import { describe, expect, it } from 'vitest';

import { buildSnapshotFromTaskRecords } from './reviewRecordAdapter';
import { buildReplayPayloadFromSnapshot } from './toolStoreAdapter';

import type { ConfirmedRecord } from '@/composables/useReviewStore';
import type {
  AnnotationRecord,
  CloudAnnotationRecord,
  RectAnnotationRecord,
  ObbAnnotationRecord,
  DistanceMeasurementRecord,
  AngleMeasurementRecord,
  MeasurementPoint,
} from '@/composables/useToolStore';

import { buildReviewRecordReplayPayload } from '@/components/review/reviewRecordReplay';

function makeText(id: string): AnnotationRecord {
  return {
    id,
    entityId: `entity-${id}`,
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'M',
    title: `t-${id}`,
    description: `d-${id}`,
    createdAt: 1,
  };
}

function makeCloud(id: string): CloudAnnotationRecord {
  return {
    id,
    objectIds: [],
    anchorWorldPos: [1, 2, 3],
    visible: true,
    title: `c-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makeRect(id: string): RectAnnotationRecord {
  return {
    id,
    objectIds: [],
    obb: {
      center: [0, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      halfSize: [1, 1, 1],
      corners: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    anchorWorldPos: [0, 0, 0],
    visible: true,
    title: `r-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makeObb(id: string): ObbAnnotationRecord {
  return {
    id,
    objectIds: [],
    obb: {
      center: [0, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      halfSize: [1, 1, 1],
      corners: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    },
    labelWorldPos: [0, 0, 0],
    anchor: { kind: 'top_center' },
    visible: true,
    title: `o-${id}`,
    description: '',
    createdAt: 1,
  };
}

function makePoint(entityId: string): MeasurementPoint {
  return { entityId, worldPos: [0, 0, 0] };
}

function makeDistance(id: string): DistanceMeasurementRecord {
  return {
    id,
    kind: 'distance',
    origin: makePoint('a'),
    target: makePoint('b'),
    visible: true,
    createdAt: 1,
  };
}

function makeAngle(id: string): AngleMeasurementRecord {
  return {
    id,
    kind: 'angle',
    origin: makePoint('a'),
    corner: makePoint('b'),
    target: makePoint('c'),
    visible: true,
    createdAt: 1,
  };
}

function makeRecord(partial: Partial<ConfirmedRecord> & { id: string }): ConfirmedRecord {
  return {
    type: 'batch',
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    confirmedAt: 0,
    note: '',
    ...partial,
  };
}

function toReplayRecords(records: ConfirmedRecord[]) {
  return records.map((r) => ({
    annotations: r.annotations,
    cloudAnnotations: r.cloudAnnotations,
    rectAnnotations: r.rectAnnotations,
    obbAnnotations: r.obbAnnotations ?? [],
    measurements: r.measurements,
  })) as Parameters<typeof buildReviewRecordReplayPayload>[0];
}

describe('buildReplayPayloadFromSnapshot', () => {
  it('produces empty payload for empty snapshot, byte-equal to legacy', () => {
    const records: ConfirmedRecord[] = [];
    const golden = buildReviewRecordReplayPayload(toReplayRecords(records));

    const snapshot = buildSnapshotFromTaskRecords(records);
    const adapted = buildReplayPayloadFromSnapshot(snapshot);

    expect(adapted).toBe(golden);
  });

  it('matches legacy payload across multiple records and all annotation types', () => {
    const r0 = makeRecord({
      id: 'r0',
      annotations: [makeText('t0a'), makeText('t0b')],
      cloudAnnotations: [makeCloud('c0')],
      rectAnnotations: [makeRect('rc0')],
      obbAnnotations: [makeObb('o0')],
      measurements: [makeDistance('d0')],
    });
    const r1 = makeRecord({
      id: 'r1',
      annotations: [makeText('t1')],
      cloudAnnotations: [makeCloud('c1')],
      rectAnnotations: [makeRect('rc1')],
      obbAnnotations: [],
      measurements: [makeAngle('a1')],
    });

    const records = [r0, r1];
    const golden = buildReviewRecordReplayPayload(toReplayRecords(records));

    const snapshot = buildSnapshotFromTaskRecords(records);
    const adapted = buildReplayPayloadFromSnapshot(snapshot);

    expect(adapted).toBe(golden);
  });

  it('preserves dedupe-by-id behavior across records', () => {
    const dup = makeText('t-dup');
    const r0 = makeRecord({ id: 'r0', annotations: [dup, makeText('keep')] });
    const r1 = makeRecord({ id: 'r1', annotations: [{ ...dup, title: 'modified' }] });

    const records = [r0, r1];
    const golden = buildReviewRecordReplayPayload(toReplayRecords(records));

    const snapshot = buildSnapshotFromTaskRecords(records);
    const adapted = buildReplayPayloadFromSnapshot(snapshot);

    expect(adapted).toBe(golden);
  });

  it('preserves measurements normalization (distance + angle bucketed)', () => {
    const r0 = makeRecord({
      id: 'r0',
      measurements: [makeDistance('d-1'), makeAngle('a-1')],
    });
    const records = [r0];
    const golden = buildReviewRecordReplayPayload(toReplayRecords(records));

    const snapshot = buildSnapshotFromTaskRecords(records);
    const adapted = buildReplayPayloadFromSnapshot(snapshot);

    expect(adapted).toBe(golden);
  });
});
