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

type ReplayRecordLike = {
  annotations: unknown[];
  cloudAnnotations: unknown[];
  rectAnnotations: unknown[];
  obbAnnotations: unknown[];
  measurements: unknown[];
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
