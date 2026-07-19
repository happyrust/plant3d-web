import type { UserDimensionRecord } from './types';

export const DIMENSION_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type DimensionDocumentState = Readonly<{
  schemaVersion: 1;
  documentId: string;
  taskId?: string;
  formId?: string;
  baseVersion: number;
  records: readonly UserDimensionRecord[];
}>;

export function createEmptyDimensionDocument(input: Readonly<{
  documentId: string;
  taskId?: string;
  formId?: string;
  baseVersion?: number;
}>): DimensionDocumentState {
  return {
    schemaVersion: DIMENSION_DOCUMENT_SCHEMA_VERSION,
    documentId: input.documentId,
    taskId: input.taskId,
    formId: input.formId,
    baseVersion: input.baseVersion ?? 0,
    records: [],
  };
}
