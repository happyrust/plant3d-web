import {
  DIMENSION_DOCUMENT_SCHEMA_VERSION,
  createEmptyDimensionDocument,
} from '../domain/document';
import { reduceDimensionDocument } from '../domain/reducer';

import type { DimensionDocumentState } from '../domain/document';
import type { UserDimensionRecord } from '../domain/types';

export type SnapshotDimensionDocument = Readonly<{
  schemaVersion: 1;
  documentId: string;
  records: readonly UserDimensionRecord[];
}>;

export class DimensionSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DimensionSnapshotValidationError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertBaseVersion(baseVersion: unknown): asserts baseVersion is number {
  if (
    typeof baseVersion !== 'number'
    || !Number.isSafeInteger(baseVersion)
    || baseVersion < 0
  ) {
    throw new DimensionSnapshotValidationError(
      'dimension document baseVersion must be a non-negative safe integer',
    );
  }
}

export function validateDimensionDocumentSnapshot(
  value: unknown,
): SnapshotDimensionDocument {
  if (!isObject(value)) {
    throw new DimensionSnapshotValidationError(
      'dimension document snapshot must be an object',
    );
  }
  if (value.schemaVersion !== DIMENSION_DOCUMENT_SCHEMA_VERSION) {
    throw new DimensionSnapshotValidationError(
      `unsupported dimension document schemaVersion: ${String(value.schemaVersion)}`,
    );
  }
  if (!isNonEmptyString(value.documentId)) {
    throw new DimensionSnapshotValidationError(
      'dimension document documentId must be a non-empty string',
    );
  }
  if (!Array.isArray(value.records)) {
    throw new DimensionSnapshotValidationError(
      'dimension document records must be an array',
    );
  }

  let validatedState = createEmptyDimensionDocument({
    documentId: value.documentId,
  });
  for (let index = 0; index < value.records.length; index += 1) {
    const candidate = value.records[index];
    const candidateObject = isObject(candidate) ? candidate : null;
    const result = reduceDimensionDocument(validatedState, {
      type: 'create',
      commandId: `snapshot-validate-${index}`,
      actorId: candidateObject?.authorId as string,
      actorRole: candidateObject?.authorRole as string,
      at: 0,
      record: candidate as UserDimensionRecord,
    });
    if (!result.ok) {
      const detail = result.reason === 'duplicate-id'
        ? 'duplicate record id'
        : `invalid record at index ${index}`;
      throw new DimensionSnapshotValidationError(
        `dimension document snapshot contains ${detail}`,
      );
    }
    validatedState = result.state;
  }

  return {
    schemaVersion: DIMENSION_DOCUMENT_SCHEMA_VERSION,
    documentId: value.documentId,
    records: [...validatedState.records],
  };
}

export function dimensionDocumentToSnapshot(
  state: DimensionDocumentState,
): SnapshotDimensionDocument {
  assertBaseVersion(state.baseVersion);
  return validateDimensionDocumentSnapshot({
    schemaVersion: state.schemaVersion,
    documentId: state.documentId,
    records: state.records,
  });
}

export function dimensionDocumentFromSnapshot(
  snapshot: SnapshotDimensionDocument,
  context: Readonly<{
    taskId?: string;
    formId?: string;
    baseVersion: number;
  }>,
): DimensionDocumentState {
  assertBaseVersion(context.baseVersion);
  const validated = validateDimensionDocumentSnapshot(snapshot);
  return {
    schemaVersion: DIMENSION_DOCUMENT_SCHEMA_VERSION,
    documentId: validated.documentId,
    taskId: context.taskId,
    formId: context.formId,
    baseVersion: context.baseVersion,
    records: validated.records,
  };
}
