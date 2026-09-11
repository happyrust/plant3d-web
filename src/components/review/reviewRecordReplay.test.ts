import { describe, expect, it } from 'vitest';

import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

import { createComputationProvenance } from '@/measurement/domain/computationProvenance';

describe('buildReviewRecordReplayPayload', () => {
  it('把父级 record 的 formId/taskId 注入子批注和测量，但不补几何字段', () => {
    const payload = JSON.parse(buildReviewRecordReplayPayload([
      {
        id: 'record-ctx-1',
        taskId: 'task-ctx',
        formId: 'FORM-CTX',
        confirmedAt: 10,
        annotations: [
          {
            id: 'anno-ctx-1',
            title: '缺几何的新模型校验',
          },
        ],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [
          {
            id: 'measure-fallback-ctx',
            kind: 'legacy',
          },
        ],
      },
    ]));

    expect(payload.annotations[0]).toEqual(expect.objectContaining({
      id: 'anno-ctx-1',
      formId: 'FORM-CTX',
      taskId: 'task-ctx',
    }));
    expect(payload.annotations[0]).not.toHaveProperty('worldPos');
    expect(payload.annotations[0]).not.toHaveProperty('entityId');
    expect(payload.annotations[0]).not.toHaveProperty('glyph');
    expect(payload.measurements).toEqual([]);
    expect(payload.legacyMeasurements[0]).toEqual(expect.objectContaining({
      id: 'measure-fallback-ctx',
      formId: 'FORM-CTX',
      taskId: 'task-ctx',
    }));
  });

  it('同一批注 id 多条记录时按 confirmedAt 取最新记录', () => {
    const payload = JSON.parse(buildReviewRecordReplayPayload([
      {
        id: 'record-newer',
        taskId: 'task-new',
        formId: 'FORM-NEW',
        confirmedAt: 20,
        annotations: [{ id: 'anno-dedupe', title: '最新批注' }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
      {
        id: 'record-older',
        taskId: 'task-old',
        formId: 'FORM-OLD',
        confirmedAt: 10,
        annotations: [{ id: 'anno-dedupe', title: '旧批注' }],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [],
      },
    ]));

    expect(payload.annotations).toEqual([
      expect.objectContaining({
        id: 'anno-dedupe',
        title: '最新批注',
        formId: 'FORM-NEW',
        taskId: 'task-new',
      }),
    ]);
  });

  it('会把旧 measurements 转成 V7 unified records 并显式标记未知来源', () => {
    const payload = JSON.parse(buildReviewRecordReplayPayload([
      {
        annotations: [],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [
          {
            id: 'distance-1',
            kind: 'distance',
            origin: { entityId: 'pipe-a', worldPos: [0, 0, 0] },
            target: { entityId: 'pipe-b', worldPos: [1, 0, 0] },
            visible: true,
            createdAt: 10,
            sourceAnnotationId: 'annot-1',
            sourceAnnotationType: 'text',
            formId: 'FORM-2001',
          },
          {
            id: 'angle-1',
            kind: 'angle',
            origin: { entityId: 'pipe-c', worldPos: [0, 0, 0] },
            corner: { entityId: 'pipe-d', worldPos: [1, 0, 0] },
            target: { entityId: 'pipe-e', worldPos: [1, 1, 0] },
            visible: true,
            createdAt: 20,
          },
        ],
      },
    ]));

    expect(payload.version).toBe(7);
    expect(payload.measurements).toEqual([
      expect.objectContaining({
        id: 'distance-1',
        kind: 'distance',
        source: 'replay',
        approximate: true,
        provenance: expect.objectContaining({
          method: 'legacy-unknown',
          accuracyClass: 'legacy-unknown',
        }),
        sourceAnnotationId: 'annot-1',
        sourceAnnotationType: 'text',
        formId: 'FORM-2001',
      }),
      expect.objectContaining({
        id: 'angle-1',
        kind: 'angle',
        source: 'replay',
        approximate: true,
        provenance: expect.objectContaining({
          method: 'legacy-unknown',
          accuracyClass: 'legacy-unknown',
        }),
      }),
    ]);
    expect(payload).not.toHaveProperty('xeokitDistanceMeasurements');
    expect(payload).not.toHaveProperty('xeokitAngleMeasurements');
  });

  it('preserves V7 provenance without downgrading an exact unified record', () => {
    const provenance = createComputationProvenance({
      method: 'semantic-point-pair',
      accuracyClass: 'exact-semantic',
      coordinateSpace: 'design-world',
      sourceModelVersion: 'review-v7',
      source: { entityId: 'pipe-a', candidateId: 'p1' },
      target: { entityId: 'pipe-b', candidateId: 'p2' },
    });
    const payload = JSON.parse(buildReviewRecordReplayPayload([
      {
        annotations: [],
        cloudAnnotations: [],
        rectAnnotations: [],
        obbAnnotations: [],
        measurements: [{
          id: 'distance-v7',
          kind: 'distance',
          origin: { entityId: 'pipe-a', worldPos: [0, 0, 0] },
          target: { entityId: 'pipe-b', worldPos: [1, 0, 0] },
          visible: true,
          approximate: false,
          source: 'xeokit',
          provenance,
          createdAt: 30,
        }],
      },
    ]));

    expect(payload.measurements).toEqual([
      expect.objectContaining({
        id: 'distance-v7',
        source: 'xeokit',
        approximate: false,
        provenance,
      }),
    ]);
  });

  it('uses a deterministic timestamp when a supported legacy record omitted createdAt', () => {
    const records: Parameters<typeof buildReviewRecordReplayPayload>[0] = [{
      annotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      obbAnnotations: [],
      measurements: [{
        id: 'distance-without-time',
        kind: 'distance',
        origin: { entityId: 'a', worldPos: [0, 0, 0] },
        target: { entityId: 'b', worldPos: [1, 0, 0] },
      }],
    }];

    const first = buildReviewRecordReplayPayload(records);
    const second = buildReviewRecordReplayPayload(records);

    expect(second).toBe(first);
    expect(JSON.parse(first).measurements[0].createdAt).toBe(0);
  });
});
