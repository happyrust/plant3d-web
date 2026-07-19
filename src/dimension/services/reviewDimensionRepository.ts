import {
  DimensionSnapshotValidationError,
  dimensionDocumentFromSnapshot,
  dimensionDocumentToSnapshot,
} from '../adapters/reviewSnapshotAdapter';
import { createEmptyDimensionDocument } from '../domain/document';

import type { SnapshotDimensionDocument } from '../adapters/reviewSnapshotAdapter';
import type { DimensionDocumentState } from '../domain/document';
import type {
  DimensionDocumentRepository,
  SaveDimensionDocumentResult,
} from '../ports/repository';
import type {
  ConfirmedRecordData,
  ConfirmedRecordResponse,
} from '@/api/reviewApi';

type ReviewRecordWithDimension = ConfirmedRecordData & Readonly<{
  confirmedAt?: number;
}>;

export type ReviewDimensionApi = Readonly<{
  loadRecords(
    context: Readonly<{ taskId?: string; formId?: string }>,
  ): Promise<readonly ReviewRecordWithDimension[]>;
  buildBaseRecord(): Promise<
    Omit<
      ConfirmedRecordData,
      'dimensionDocument' | 'dimensionDocumentBaseVersion'
    >
  >;
  saveRecord(
    payload: ConfirmedRecordData & Readonly<{
      dimensionDocument: SnapshotDimensionDocument;
      dimensionDocumentBaseVersion: number;
    }>,
  ): Promise<ConfirmedRecordResponse>;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function statusFromError(error: unknown): number | undefined {
  if (!isObject(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function dimensionVersion(
  value: unknown,
  options: Readonly<{ required: boolean }>,
): number {
  if (value === undefined && !options.required) return 0;
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new DimensionSnapshotValidationError(
      'dimensionDocumentVersion must be a non-negative safe integer',
    );
  }
  return value;
}

function documentIdForEmptyState(
  context: Readonly<{ taskId?: string; formId?: string }>,
): string {
  const formId = context.formId?.trim();
  if (formId) return `dimension-document:form:${formId}`;
  const taskId = context.taskId?.trim();
  if (taskId) return `dimension-document:task:${taskId}`;
  return 'dimension-document:unscoped';
}

function newestRecordWithDocument(
  records: readonly ReviewRecordWithDimension[],
): ReviewRecordWithDimension | undefined {
  let newest: ReviewRecordWithDimension | undefined;
  let newestVersion = -1;
  let newestConfirmedAt = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (record.dimensionDocument === undefined) continue;
    const version = dimensionVersion(record.dimensionDocumentVersion, {
      required: false,
    });
    const confirmedAt = typeof record.confirmedAt === 'number'
      && Number.isFinite(record.confirmedAt)
      ? record.confirmedAt
      : Number.NEGATIVE_INFINITY;
    if (
      version > newestVersion
      || (version === newestVersion && confirmedAt >= newestConfirmedAt)
    ) {
      newest = record;
      newestVersion = version;
      newestConfirmedAt = confirmedAt;
    }
  }
  return newest;
}

function stateFromRecord(
  record: ReviewRecordWithDimension,
  context: Readonly<{
    taskId?: string;
    formId?: string;
    requireVersion: boolean;
  }>,
): DimensionDocumentState {
  if (record.dimensionDocument === undefined) {
    throw new DimensionSnapshotValidationError(
      'review record is missing dimensionDocument',
    );
  }
  return dimensionDocumentFromSnapshot(record.dimensionDocument, {
    taskId: context.taskId ?? record.taskId,
    formId: context.formId ?? record.formId,
    baseVersion: dimensionVersion(record.dimensionDocumentVersion, {
      required: context.requireVersion,
    }),
  });
}

function conflictRecordFromError(
  error: unknown,
): ReviewRecordWithDimension | undefined {
  if (!isObject(error) || !isObject(error.responseBody)) return undefined;
  const body = error.responseBody;
  if (isObject(body.record)) {
    return body.record as ReviewRecordWithDimension;
  }
  if (Array.isArray(body.records)) {
    return newestRecordWithDocument(
      body.records.filter(isObject) as ReviewRecordWithDimension[],
    );
  }
  return undefined;
}

export class ReviewDimensionRepository implements DimensionDocumentRepository {
  constructor(private readonly api: ReviewDimensionApi) {}

  async load(
    context: Readonly<{ taskId?: string; formId?: string }>,
  ): Promise<DimensionDocumentState> {
    const records = await this.api.loadRecords(context);
    const newest = newestRecordWithDocument(records);
    if (!newest) {
      return createEmptyDimensionDocument({
        documentId: documentIdForEmptyState(context),
        taskId: context.taskId,
        formId: context.formId,
      });
    }
    return stateFromRecord(newest, {
      taskId: context.taskId,
      formId: context.formId,
      requireVersion: false,
    });
  }

  async save(
    state: DimensionDocumentState,
  ): Promise<SaveDimensionDocumentResult> {
    try {
      const dimensionDocument = dimensionDocumentToSnapshot(state);
      const baseRecord = await this.api.buildBaseRecord();
      const response = await this.api.saveRecord({
        ...baseRecord,
        dimensionDocument,
        dimensionDocumentBaseVersion: state.baseVersion,
      });
      if (!response.success || !response.record) {
        return {
          ok: false,
          reason: 'invalid',
          message: response.error_message || 'review API returned no saved record',
        };
      }
      return {
        ok: true,
        state: stateFromRecord(response.record, {
          taskId: state.taskId,
          formId: state.formId,
          requireVersion: true,
        }),
      };
    } catch (error) {
      if (error instanceof DimensionSnapshotValidationError) {
        return {
          ok: false,
          reason: 'invalid',
          message: error.message,
        };
      }

      const status = statusFromError(error);
      if (status === 409) {
        const latestRecord = conflictRecordFromError(error);
        if (!latestRecord) {
          return {
            ok: false,
            reason: 'invalid',
            message: 'conflict response did not include the latest dimension document',
          };
        }
        try {
          return {
            ok: false,
            reason: 'conflict',
            latest: stateFromRecord(latestRecord, {
              taskId: state.taskId,
              formId: state.formId,
              requireVersion: true,
            }),
          };
        } catch (validationError) {
          return {
            ok: false,
            reason: 'invalid',
            message: messageFromError(
              validationError,
              'conflict response included an invalid dimension document',
            ),
          };
        }
      }
      if (status === 403) {
        return {
          ok: false,
          reason: 'forbidden',
          message: messageFromError(error, 'dimension document save is forbidden'),
        };
      }
      if (status === 400 || status === 422) {
        return {
          ok: false,
          reason: 'invalid',
          message: messageFromError(error, 'dimension document save is invalid'),
        };
      }
      return {
        ok: false,
        reason: 'network',
        message: messageFromError(error, 'dimension document save failed'),
      };
    }
  }
}
