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
import type { ReviewSnapshotMeasurementPayload } from '@/api/reviewApi';

import {
  buildReviewRecordReplayPayload,
  type ReplayRecordLike,
} from '@/components/review/reviewRecordReplay';

function lowerSnapshotMeasurements(snapshot: ReviewSnapshot): ReviewSnapshotMeasurementPayload[] {
  return snapshot.measurements.map((measurement) => ({
    ...measurement.payload,
    ...(typeof measurement.payload.kind === 'string' || measurement.kind === 'unknown'
      ? {}
      : { kind: measurement.kind }),
  }));
}

export function buildReplayPayloadFromSnapshot(snapshot: ReviewSnapshot): string {
  // 分桶容器是本地可变的临时数组，最后才作为只读记录交给序列化实现。
  const annotations: unknown[] = [];
  const cloudAnnotations: unknown[] = [];
  const rectAnnotations: unknown[] = [];
  const obbAnnotations: unknown[] = [];

  for (const annotation of snapshot.annotations) {
    switch (annotation.annotationType) {
      case 'text':
        annotations.push(annotation.payload);
        break;
      case 'cloud':
        cloudAnnotations.push(annotation.payload);
        break;
      case 'rect':
        rectAnnotations.push(annotation.payload);
        break;
      case 'obb':
        obbAnnotations.push(annotation.payload);
        break;
    }
  }

  const fakeRecord: ReplayRecordLike = {
    annotations,
    cloudAnnotations,
    rectAnnotations,
    obbAnnotations,
    measurements: lowerSnapshotMeasurements(snapshot),
  };

  return buildReviewRecordReplayPayload([fakeRecord]);
}

export function buildReplayPayloadFromImportSnapshot(snapshot: ReviewSnapshot): string {
  return buildReplayPayloadFromSnapshot(snapshot);
}
