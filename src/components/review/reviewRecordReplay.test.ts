import { describe, expect, it } from 'vitest';

import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

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
    expect(payload.measurements[0]).toEqual(expect.objectContaining({
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

  it('会把旧 measurements 转成 xeokit 回放数据，并清空 classic measurements 以避免重复渲染', () => {
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

    expect(payload.measurements).toEqual([]);
    expect(payload.xeokitDistanceMeasurements).toEqual([
      expect.objectContaining({
        id: 'distance-1',
        kind: 'distance',
        approximate: false,
        sourceAnnotationId: 'annot-1',
        sourceAnnotationType: 'text',
        formId: 'FORM-2001',
      }),
    ]);
    expect(payload.xeokitAngleMeasurements).toEqual([
      expect.objectContaining({
        id: 'angle-1',
        kind: 'angle',
        approximate: false,
      }),
    ]);
  });
});
