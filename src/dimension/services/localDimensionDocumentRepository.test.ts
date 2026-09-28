import { describe, expect, it } from 'vitest';

import { linearRecord } from '../domain/testFixtures';

import {
  LocalDimensionDocumentCorruptError,
  LocalStorageDimensionDocumentRepository,
  localDimensionDocumentId,
  localDimensionDocumentKey,
} from './localDimensionDocumentRepository';

function createStorage() {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
    values,
  };
}

describe('LocalStorageDimensionDocumentRepository', () => {
  it('isolates documents by project and db scope', async () => {
    const { storage } = createStorage();
    const scopeA = 'project=A|db=1';
    const scopeB = 'project=A|db=2';
    const repositoryA = new LocalStorageDimensionDocumentRepository(
      storage,
      scopeA,
    );
    const repositoryB = new LocalStorageDimensionDocumentRepository(
      storage,
      scopeB,
    );
    const initialA = await repositoryA.load({});
    const saved = await repositoryA.save({
      ...initialA,
      records: [linearRecord({ id: 'local-a' })],
    });

    expect(saved.ok).toBe(true);
    await expect(repositoryA.load({})).resolves.toMatchObject({
      documentId: localDimensionDocumentId(scopeA),
      baseVersion: 1,
      records: [expect.objectContaining({ id: 'local-a' })],
    });
    await expect(repositoryB.load({})).resolves.toMatchObject({
      documentId: localDimensionDocumentId(scopeB),
      baseVersion: 0,
      records: [],
    });
  });

  it('returns the latest local state on an optimistic version conflict', async () => {
    const { storage } = createStorage();
    const repository = new LocalStorageDimensionDocumentRepository(
      storage,
      'project=A|db=1',
    );
    const stale = await repository.load({});
    const first = await repository.save({
      ...stale,
      records: [linearRecord({ id: 'first' })],
    });
    expect(first.ok).toBe(true);

    const conflict = await repository.save({
      ...stale,
      records: [linearRecord({ id: 'stale' })],
    });

    expect(conflict).toMatchObject({
      ok: false,
      reason: 'conflict',
      latest: {
        baseVersion: 1,
        records: [expect.objectContaining({ id: 'first' })],
      },
    });
  });

  it('rejects corrupt persisted data instead of silently discarding it', async () => {
    const scope = 'project=A|db=1';
    const { storage, values } = createStorage();
    values.set(localDimensionDocumentKey(scope), '{broken');
    const repository = new LocalStorageDimensionDocumentRepository(
      storage,
      scope,
    );

    await expect(repository.load({})).rejects.toBeInstanceOf(
      LocalDimensionDocumentCorruptError,
    );
  });
});
