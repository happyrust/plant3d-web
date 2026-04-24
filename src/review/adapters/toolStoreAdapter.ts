/**
 * `ReviewSnapshot` → 旧 `useToolStore.importJSON` payload 适配器。
 *
 * 设计目的（M2 SHADOW 阶段）：
 *   - 让所有走 snapshot 中间层的恢复链路最终能产出**与现行 payload 字节一致**
 *     的 JSON，确保 SHADOW 阶段不影响 viewer 行为。
 *   - 实现方式：将 snapshot.annotations 按 annotationType 重新分桶为伪
 *     `ReplayRecordLike`，再交给现有 `buildReviewRecordReplayPayload`。这样
 *     dedupe / measurement 归一行为完全沿用既有实现。
 *
 * 一旦 M2 进入 CUTOVER，UI 与 viewer 应直接消费 snapshot 自身，本适配器在
 * 后续阶段可以收敛或下线。
 */

import type { ReviewSnapshot } from '../domain/reviewSnapshot';

import { buildReviewRecordReplayPayload } from '@/components/review/reviewRecordReplay';

import type { ReviewSnapshotMeasurementPayload } from '@/api/reviewApi';

type ReplayRecordLike = {
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: ReviewSnapshotMeasurementPayload[];
};

export function buildReplayPayloadFromSnapshot(snapshot: ReviewSnapshot): string {
  const fakeRecord: ReplayRecordLike = {
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: snapshot.measurements.map((m) => m.payload),
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
  const annotations: unknown[] = [];
  const cloudAnnotations: unknown[] = [];
  const rectAnnotations: unknown[] = [];
  const obbAnnotations: unknown[] = [];
  const measurements: ReviewSnapshotMeasurementPayload[] = [];
  const xeokitDistanceMeasurements: ReviewSnapshotMeasurementPayload[] = [];
  const xeokitAngleMeasurements: ReviewSnapshotMeasurementPayload[] = [];

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

  for (const measurement of snapshot.measurements) {
    if (measurement.kind === 'distance') {
      xeokitDistanceMeasurements.push(measurement.payload);
      continue;
    }
    if (measurement.kind === 'angle') {
      xeokitAngleMeasurements.push(measurement.payload);
      continue;
    }
    measurements.push(measurement.payload);
  }

  return JSON.stringify({
    version: 5,
    measurements,
    annotations,
    obbAnnotations,
    cloudAnnotations,
    rectAnnotations,
    dimensions: [],
    xeokitDistanceMeasurements,
    xeokitAngleMeasurements,
  });
}
