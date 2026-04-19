import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearReviewFlagOverrides } from '../flags';

import {
  isSnapshotShadowEnabled,
  runTaskRecordsShadow,
  runWorkflowSyncShadow,
} from './reviewSnapshotService';

import type {
  WorkflowAnnotationCommentData,
  WorkflowRecordData,
  WorkflowSyncData,
} from '@/api/reviewApi';
import type { ConfirmedRecord } from '@/composables/useReviewStore';
import type {
  AnnotationRecord,
  DistanceMeasurementRecord,
  MeasurementPoint,
} from '@/composables/useToolStore';

import { buildReviewRecordReplayPayload, buildWorkflowSnapshotReplayPayload } from '@/components/review/reviewRecordReplay';

function makeText(id: string): AnnotationRecord {
  return {
    id,
    entityId: `entity-${id}`,
    worldPos: [0, 0, 0],
    visible: true,
    glyph: 'M',
    title: `t-${id}`,
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

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe('reviewSnapshotService', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = createLocalStorageMock();
    clearReviewFlagOverrides();
  });

  afterEach(() => {
    clearReviewFlagOverrides();
    vi.unstubAllEnvs();
  });

  it('isSnapshotShadowEnabled defaults to false', () => {
    expect(isSnapshotShadowEnabled()).toBe(false);
  });

  it('runTaskRecordsShadow returns null when flag is off (default)', () => {
    const records = [makeRecord({ id: 'r0', annotations: [makeText('t0')] })];
    const legacy = buildReviewRecordReplayPayload(toReplayRecords(records));

    const reporter = vi.fn();
    const result = runTaskRecordsShadow({
      legacyPayload: legacy,
      records,
      reporter,
    });

    expect(result).toBeNull();
    expect(reporter).not.toHaveBeenCalled();
  });

  it('runTaskRecordsShadow reports match=true when flag is on (or forced) and payloads identical', () => {
    const records = [
      makeRecord({
        id: 'r0',
        annotations: [makeText('t0a'), makeText('t0b')],
        measurements: [makeDistance('d0')],
      }),
    ];
    const legacy = buildReviewRecordReplayPayload(toReplayRecords(records));

    const reporter = vi.fn();
    const result = runTaskRecordsShadow({
      legacyPayload: legacy,
      records,
      reporter,
      force: true,
    });

    expect(result?.match).toBe(true);
    expect(result?.source).toBe('task_records');
    expect(result?.legacyByteLength).toBe(legacy.length);
    expect(result?.shadowByteLength).toBe(legacy.length);
    expect(result?.diffPreview).toBeUndefined();
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(result);
  });

  it('runTaskRecordsShadow flags mismatch with diff preview', () => {
    const records = [makeRecord({ id: 'r0', annotations: [makeText('t0')] })];
    const legacy = `${buildReviewRecordReplayPayload(toReplayRecords(records))}/* tampered */`;

    const reporter = vi.fn();
    const result = runTaskRecordsShadow({
      legacyPayload: legacy,
      records,
      reporter,
      force: true,
    });

    expect(result?.match).toBe(false);
    expect(result?.diffPreview).toBeDefined();
    expect(result?.diffPreview?.index).toBeGreaterThanOrEqual(0);
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it('runTaskRecordsShadow runs once flag is enabled via localStorage', () => {
    const records = [makeRecord({ id: 'r0', annotations: [makeText('t0')] })];
    const legacy = buildReviewRecordReplayPayload(toReplayRecords(records));

    localStorage.setItem('review.flag.REVIEW_B_SNAPSHOT_LAYER_SHADOW', '1');
    expect(isSnapshotShadowEnabled()).toBe(true);

    const reporter = vi.fn();
    const result = runTaskRecordsShadow({
      legacyPayload: legacy,
      records,
      reporter,
    });
    expect(result?.match).toBe(true);
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it('runWorkflowSyncShadow matches legacy buildWorkflowSnapshotReplayPayload', () => {
    const records: WorkflowRecordData[] = [
      {
        id: 'r0',
        taskId: 'task-1',
        type: 'batch',
        annotations: [makeText('t0')],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
        note: '',
        confirmedAt: '2026-04-19 00:00:00',
      },
    ];
    const comments: WorkflowAnnotationCommentData[] = [
      {
        id: 'cm-1',
        annotationId: 't0',
        annotationType: 'text',
        authorId: 'u-1',
        authorName: 'Alice',
        authorRole: 'sh',
        content: 'opinion',
        createdAt: '2026-04-19 00:01:00',
      },
    ];

    const data: WorkflowSyncData = {
      models: [],
      records,
      annotationComments: comments,
      attachments: [],
      currentNode: 'jd',
    };

    const legacy = buildWorkflowSnapshotReplayPayload(records, comments);

    const reporter = vi.fn();
    const result = runWorkflowSyncShadow({
      legacyPayload: legacy,
      data,
      reporter,
      force: true,
    });

    expect(result?.match).toBe(true);
    expect(result?.source).toBe('workflow_sync');
    expect(reporter).toHaveBeenCalledTimes(1);
  });
});
