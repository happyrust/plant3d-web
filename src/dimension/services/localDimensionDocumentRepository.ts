import {
  dimensionDocumentFromSnapshot,
  dimensionDocumentToSnapshot,
} from '../adapters/reviewSnapshotAdapter';
import { createEmptyDimensionDocument } from '../domain/document';

import type { StorageLike } from './commandJournal';
import type { SnapshotDimensionDocument } from '../adapters/reviewSnapshotAdapter';
import type { DimensionDocumentState } from '../domain/document';
import type {
  DimensionDocumentRepository,
  SaveDimensionDocumentResult,
} from '../ports/repository';

const LOCAL_DOCUMENT_KEY_PREFIX = 'plant3d-web-dimension-document-local-v1';

type LocalDimensionDocumentEnvelope = Readonly<{
  version: 1;
  scope: string;
  baseVersion: number;
  document: SnapshotDimensionDocument;
  updatedAt: number;
}>;

export class LocalDimensionDocumentCorruptError extends Error {
  constructor(scope: string) {
    super(`Local dimension document for "${scope}" is invalid`);
    this.name = 'LocalDimensionDocumentCorruptError';
  }
}

export function localDimensionDocumentId(scope: string): string {
  const normalized = scope.trim();
  if (!normalized) throw new TypeError('Local dimension scope must not be empty');
  return `dimension-document:local:${normalized}`;
}

export function localDimensionDocumentKey(scope: string): string {
  return `${LOCAL_DOCUMENT_KEY_PREFIX}:${scope}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEnvelope(
  raw: string | null,
  scope: string,
): LocalDimensionDocumentEnvelope | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LocalDimensionDocumentCorruptError(scope);
  }
  if (
    !isObject(parsed)
    || parsed.version !== 1
    || parsed.scope !== scope
    || !Number.isSafeInteger(parsed.baseVersion)
    || (parsed.baseVersion as number) < 0
    || typeof parsed.updatedAt !== 'number'
    || !Number.isFinite(parsed.updatedAt)
  ) {
    throw new LocalDimensionDocumentCorruptError(scope);
  }
  try {
    const state = dimensionDocumentFromSnapshot(
      parsed.document as SnapshotDimensionDocument,
      { baseVersion: parsed.baseVersion as number },
    );
    if (state.documentId !== localDimensionDocumentId(scope)) {
      throw new LocalDimensionDocumentCorruptError(scope);
    }
    return {
      version: 1,
      scope,
      baseVersion: state.baseVersion,
      document: dimensionDocumentToSnapshot(state),
      updatedAt: parsed.updatedAt,
    };
  } catch (error) {
    if (error instanceof LocalDimensionDocumentCorruptError) throw error;
    throw new LocalDimensionDocumentCorruptError(scope);
  }
}

function stateFromEnvelope(
  envelope: LocalDimensionDocumentEnvelope,
): DimensionDocumentState {
  return dimensionDocumentFromSnapshot(envelope.document, {
    baseVersion: envelope.baseVersion,
  });
}

export class LocalStorageDimensionDocumentRepository
implements DimensionDocumentRepository {
  private readonly documentId: string;
  private readonly key: string;

  constructor(
    private readonly storage: StorageLike,
    private readonly scope: string,
  ) {
    this.documentId = localDimensionDocumentId(scope);
    this.key = localDimensionDocumentKey(scope);
  }

  async load(): Promise<DimensionDocumentState> {
    const envelope = parseEnvelope(this.storage.getItem(this.key), this.scope);
    return envelope
      ? stateFromEnvelope(envelope)
      : createEmptyDimensionDocument({ documentId: this.documentId });
  }

  async save(
    state: DimensionDocumentState,
  ): Promise<SaveDimensionDocumentResult> {
    if (state.documentId !== this.documentId) {
      return {
        ok: false,
        reason: 'invalid',
        message: `Local dimension document id must be "${this.documentId}"`,
      };
    }
    let current: LocalDimensionDocumentEnvelope | null;
    try {
      current = parseEnvelope(this.storage.getItem(this.key), this.scope);
    } catch (error) {
      return {
        ok: false,
        reason: 'invalid',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (current && current.baseVersion !== state.baseVersion) {
      return {
        ok: false,
        reason: 'conflict',
        latest: stateFromEnvelope(current),
      };
    }

    const saved: DimensionDocumentState = {
      ...state,
      baseVersion: state.baseVersion + 1,
    };
    try {
      const envelope: LocalDimensionDocumentEnvelope = {
        version: 1,
        scope: this.scope,
        baseVersion: saved.baseVersion,
        document: dimensionDocumentToSnapshot(saved),
        updatedAt: Date.now(),
      };
      this.storage.setItem(this.key, JSON.stringify(envelope));
      return { ok: true, state: saved };
    } catch (error) {
      return {
        ok: false,
        reason: 'network',
        message: error instanceof Error
          ? error.message
          : 'Local dimension document save failed',
      };
    }
  }
}
