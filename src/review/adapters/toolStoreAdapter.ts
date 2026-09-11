/**
 * `ReviewSnapshot` → `useToolStore.importJSON` V7 payload 适配器。
 *
 * 设计目的：
 *   - 让 task/workflow/import 三条恢复链统一产出 V7 unified measurement；
 *   - 为缺少几何或未知 kind 的历史记录保留 `legacyMeasurements` 旁路，
 *     避免为了迁移而猜测其精度或形状。
 *   - 实现方式：将 snapshot.annotations 按 annotationType 重新分桶为伪
 *     `ReplayRecordLike`，再交给 `buildReviewRecordReplayPayload`，使
 *     dedupe、provenance 升级和 V7 序列化只有一个实现。
 */

import type { ReviewSnapshot } from '../domain/reviewSnapshot';

import { buildReviewRecordReplayPayload } from '@/components/review/reviewRecordReplay';

type ReplayRecordLike = {
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: unknown[];
};

function lowerSnapshotMeasurements(snapshot: ReviewSnapshot): unknown[] {
  return snapshot.measurements.map((measurement) => ({
    ...measurement.payload,
    ...(typeof measurement.payload.kind === 'string' || measurement.kind === 'unknown'
      ? {}
      : { kind: measurement.kind }),
  }));
}

export function buildReplayPayloadFromSnapshot(snapshot: ReviewSnapshot): string {
  const fakeRecord: ReplayRecordLike = {
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: lowerSnapshotMeasurements(snapshot),
  };

  for (const annotation of snapshot.annotations) {
    switch (annotation.annotationType) {
      case 'text':
        fakeRecord.annotations.push(annotation.payload);
        break;
      case 'cloud':
        fakeRecord.cloudAnnotations.push(annotation.payload);
        break;
      case 'rect':
        fakeRecord.rectAnnotations.push(annotation.payload);
        break;
      case 'obb':
        fakeRecord.obbAnnotations.push(annotation.payload);
        break;
    }
  }

  return buildReviewRecordReplayPayload([fakeRecord]);
}

export function buildReplayPayloadFromImportSnapshot(snapshot: ReviewSnapshot): string {
  return buildReplayPayloadFromSnapshot(snapshot);
}
