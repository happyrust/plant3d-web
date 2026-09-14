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
import { useToolStore } from '@/composables/useToolStore';

const sampleScreenshot = {
  attachmentId: 'att-1',
  name: 'replay-shot.png',
  url: '/files/replay-shot.png',
  mimeType: 'image/png',
  size: 4096,
  width: 1600,
  height: 900,
  uploadedAt: 1_710_000_000_400,
  capturedAt: 1_710_000_000_000,
};

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
    objectIds: [`member-${id}`],
    anchorWorldPos: [1, 2, 3],
    anchorRefno: `anchor-${id}`,
    refnos: [`member-${id}`],
    bindings: [
      { refno: `anchor-${id}`, role: 'anchor', createdAt: 1 },
      { refno: `member-${id}`, role: 'member', noun: 'PIPE', createdAt: 1 },
    ],
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

  it('preserves screenshot metadata in legacy replay payload and snapshot replay payload', () => {
    const r0 = makeRecord({
      id: 'r0',
      annotations: [{ ...makeText('t-shot'), screenshot: sampleScreenshot }],
    });
    const records = [r0];

    const golden = JSON.parse(buildReviewRecordReplayPayload(toReplayRecords(records))) as {
      annotations: { id: string; screenshot?: unknown }[];
    };
    const adapted = JSON.parse(buildReplayPayloadFromSnapshot(buildSnapshotFromTaskRecords(records))) as {
      annotations: { id: string; screenshot?: unknown }[];
    };

    expect(golden.annotations[0]).toMatchObject({
      id: 't-shot',
      screenshot: sampleScreenshot,
    });
    expect(adapted.annotations[0]).toMatchObject({
      id: 't-shot',
      screenshot: sampleScreenshot,
    });
  });

  it('task_records 链路整对象透传云线空间范围体四字段，进 store 漏斗后深相等；同 id 以整条获胜记录为准', () => {
    const regionFields = {
      regionV1: {
        version: 1 as const,
        space: 'world' as const,
        source: { projectKey: null, modelSnapshotId: '7997:parquet:2026-09-14T10:00:00Z', globalModelMatrix: null, coordinateFrameId: '7997:0.001:0' },
        origin: 'members' as const,
        kind: 'obb-union' as const,
        boxes: [{ id: 'o:member-c-region:0', memberRefno: 'member-c-region', center: [1, 2, 3] as const, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const, halfSize: [1, 1, 1] as const }],
      },
      presentationV1: { version: 1 as const, algorithm: 'region-v1' as const, contour: 'convex-hull' as const, paddingPx: 14, wavelengthPx: 52, amplitudePx: 4, phaseAnchor: { featureId: 'o:member-c-region:0:0', offsetPx: 0 } },
      viewpointV1: {
        creation: {
          version: 1 as const, capturedAt: 1, position: [9, 9, 9] as const, target: [1, 2, 3] as const, up: [0, 0, 1] as const,
          projection: { kind: 'perspective' as const, verticalFovDeg: 45, zoom: 1, near: 0.1, far: 1000 },
          viewportCss: { width: 1280, height: 720 }, capturedContext: ['camera' as const],
        },
      },
      labelLayoutV1: { version: 1 as const, anchor: { kind: 'contour-bounds' as const, uv: [1, 0] as const, labelPoint: 'top-left' as const }, offsetPx: { x: 18, y: 0 } },
    };
    const olderDup: CloudAnnotationRecord = { ...makeCloud('c-dup'), title: 'older', selectionBbox: { min: [0, 0, 0], max: [1, 1, 1] } };
    const newerDup: CloudAnnotationRecord = { ...makeCloud('c-dup'), ...regionFields, title: 'newer' };
    const r0 = makeRecord({ id: 'r0', confirmedAt: 1, cloudAnnotations: [{ ...makeCloud('c-region'), ...regionFields }, olderDup] });
    const r1 = makeRecord({ id: 'r1', confirmedAt: 2, cloudAnnotations: [newerDup] });

    const payload = buildReplayPayloadFromSnapshot(buildSnapshotFromTaskRecords([r0, r1]));
    const parsed = JSON.parse(payload) as { cloudAnnotations: CloudAnnotationRecord[] };
    expect(parsed.cloudAnnotations.find((c) => c.id === 'c-region')).toMatchObject(regionFields);

    const store = useToolStore();
    store.clearAll();
    store.importJSON(payload);
    const restored = store.cloudAnnotations.value.find((c) => c.id === 'c-region');
    expect(restored?.regionV1).toEqual(regionFields.regionV1);
    expect(restored?.presentationV1).toEqual(regionFields.presentationV1);
    expect(restored?.viewpointV1).toEqual(regionFields.viewpointV1);
    expect(restored?.labelLayoutV1).toEqual(regionFields.labelLayoutV1);

    // 重复 id：后确认的整条获胜，bindings 与 regionV1 来自同一条，不会拼出「旧绑定 + 新范围」
    const dups = store.cloudAnnotations.value.filter((c) => c.id === 'c-dup');
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ title: 'newer', regionV1: regionFields.regionV1, bindings: newerDup.bindings });
    store.clearAll();
  });
});
