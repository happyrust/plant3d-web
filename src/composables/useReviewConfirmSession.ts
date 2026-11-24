import { computed } from 'vue';

import {
  buildReviewConfirmSnapshotPayload,
  buildReviewConfirmSnapshotPayloadFromRecords,
  buildReviewEvidenceSnapshotKey,
  buildUnsavedReviewEvidencePayload,
  hasReviewEvidenceData,
} from '@/components/review/reviewPanelActions';
import { useAnnotationDraftSession } from '@/composables/useAnnotationDraftSession';
import { useReviewStore, type ConfirmedRecord } from '@/composables/useReviewStore';
import {
  useToolStore,
  type AnnotationRecord,
  type CloudAnnotationRecord,
  type MeasurementRecord,
  type ObbAnnotationRecord,
  type RectAnnotationRecord,
} from '@/composables/useToolStore';

type ConfirmSessionRecord = Parameters<typeof buildReviewConfirmSnapshotPayloadFromRecords>[0][number];

export type ReviewConfirmRecordDraft = Omit<ConfirmedRecord, 'id' | 'confirmedAt'>;

/**
 * 三处确认入口共用的草稿、已确认基线和回执戳。
 *
 * 服务端 `review_records` 按 form + 节点 + 操作者整槽替换 annotations，不把多次 POST 的数组合并。
 * 因此写入必须是当前完整草稿；增量差只用来判断「有没有未确认证据」。
 */
export function useReviewConfirmSession(options: {
  confirmedRecords?: () => readonly ConfirmSessionRecord[];
} = {}) {
  const toolStore = useToolStore();
  const reviewStore = useReviewStore();
  const draftSession = useAnnotationDraftSession();

  const currentDraftConfirmPayload = computed(() => buildReviewConfirmSnapshotPayload({
    annotations: [...(toolStore.annotations?.value ?? [])],
    cloudAnnotations: [...(toolStore.cloudAnnotations?.value ?? [])],
    rectAnnotations: [...(toolStore.rectAnnotations?.value ?? [])],
    obbAnnotations: [...(toolStore.obbAnnotations?.value ?? [])],
    measurements: [...(toolStore.measurements?.value ?? [])],
    unifiedMeasurements: [...(toolStore.unifiedMeasurements?.value ?? [])],
    legacyMeasurements: [...(toolStore.legacyMeasurements?.value ?? [])],
    xeokitDistanceMeasurements: [...(toolStore.xeokitDistanceMeasurements?.value ?? [])],
    xeokitAngleMeasurements: [...(toolStore.xeokitAngleMeasurements?.value ?? [])],
    xeokitElevationPointMeasurements: [...(toolStore.xeokitElevationPointMeasurements?.value ?? [])],
    xeokitElevationDeltaMeasurements: [...(toolStore.xeokitElevationDeltaMeasurements?.value ?? [])],
    ...(reviewStore.getBoundDimensionConfirmPayload?.() ?? {}),
  }));

  const confirmedSnapshotPayload = computed(() => (
    buildReviewConfirmSnapshotPayloadFromRecords([...(options.confirmedRecords?.() ?? [])])
  ));

  const unsavedConfirmPayload = computed(() => buildUnsavedReviewEvidencePayload(
    currentDraftConfirmPayload.value,
    confirmedSnapshotPayload.value,
  ));

  const hasUnsavedChanges = computed(() => (
    buildReviewEvidenceSnapshotKey(currentDraftConfirmPayload.value)
    !== buildReviewEvidenceSnapshotKey(confirmedSnapshotPayload.value)
  ));

  const hasPendingConfirmation = computed(() => (
    hasReviewEvidenceData(unsavedConfirmPayload.value)
    || unsavedConfirmPayload.value.clearanceSnapshot !== undefined
  ));

  const hasDraftEvidence = computed(() => hasReviewEvidenceData(currentDraftConfirmPayload.value));

  function buildConfirmRecord(note: string): ReviewConfirmRecordDraft {
    const payload = currentDraftConfirmPayload.value;
    return {
      type: 'batch',
      annotations: [...payload.annotations] as AnnotationRecord[],
      cloudAnnotations: [...payload.cloudAnnotations] as CloudAnnotationRecord[],
      rectAnnotations: [...payload.rectAnnotations] as RectAnnotationRecord[],
      obbAnnotations: [...payload.obbAnnotations] as ObbAnnotationRecord[],
      measurements: [...payload.measurements] as MeasurementRecord[],
      dimensionDocument: payload.dimensionDocument,
      dimensionDocumentVersion: payload.dimensionDocumentVersion,
      note: note.trim(),
    };
  }

  function captureReceiptStamp() {
    return draftSession.currentStamp();
  }

  function shouldClearDraftAfterConfirm(stamp: ReturnType<typeof draftSession.currentStamp>): boolean {
    return draftSession.routeDataReceipt(stamp).kind !== 'other-scope';
  }

  function isReceiptCurrent(stamp: ReturnType<typeof draftSession.currentStamp>): boolean {
    return draftSession.isTransientReceiptCurrent(stamp);
  }

  return {
    currentDraftConfirmPayload,
    confirmedSnapshotPayload,
    unsavedConfirmPayload,
    hasUnsavedChanges,
    hasPendingConfirmation,
    hasDraftEvidence,
    buildConfirmRecord,
    captureReceiptStamp,
    shouldClearDraftAfterConfirm,
    isReceiptCurrent,
  };
}
