import { describe, expect, it } from 'vitest';

import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

describe('buildReviewRecordReplayPayload', () => {
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
