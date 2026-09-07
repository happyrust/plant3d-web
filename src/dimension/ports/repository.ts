import type { DimensionDocumentState } from '../domain/document';

export type SaveDimensionDocumentResult =
  | Readonly<{ ok: true; state: DimensionDocumentState }>
  | Readonly<{
    ok: false;
    reason: 'conflict';
    latest: DimensionDocumentState;
  }>
  | Readonly<{
    ok: false;
    reason: 'network' | 'forbidden' | 'invalid';
    message: string;
  }>;

export type DimensionDocumentRepository = {
  load(
    context: Readonly<{ taskId?: string; formId?: string }>,
  ): Promise<DimensionDocumentState>;
  save(state: DimensionDocumentState): Promise<SaveDimensionDocumentResult>;
}
