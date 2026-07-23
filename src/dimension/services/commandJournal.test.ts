import { describe, expect, it } from 'vitest';

import {
  dimensionCommandJournalKey,
  DimensionCommandJournalBaseVersionError,
  DimensionCommandJournalOverflowError,
  LocalStorageDimensionCommandJournal,
  type StorageLike,
} from './commandJournal';

import type { DimensionCommand } from '../domain/commands';

function deleteCommand(commandId: string, at: number): DimensionCommand {
  return {
    type: 'delete',
    commandId,
    actorId: 'owner',
    actorRole: 'designer',
    at,
    dimensionId: `dimension-${commandId}`,
  };
}

function storageHarness(initial: readonly (readonly [string, string])[] = []) {
  const values = new Map<string, string>(initial);
  const writes: string[] = [];
  const removals: string[] = [];
  const storage: StorageLike = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
    removeItem: (key) => {
      removals.push(key);
      values.delete(key);
    },
  };
  return { storage, values, writes, removals };
}

describe('LocalStorageDimensionCommandJournal', () => {
  it('appends commands under the versioned document key', () => {
    const harness = storageHarness();
    const journal = new LocalStorageDimensionCommandJournal(harness.storage);
    const first = deleteCommand('c1', 10);
    const second = deleteCommand('c2', 20);

    journal.append('document-1', 3, first);
    journal.append('document-1', 3, second);

    expect(journal.load('document-1')).toEqual({
      version: 1,
      documentId: 'document-1',
      baseVersion: 3,
      commands: [first, second],
      updatedAt: 20,
    });
    expect(harness.writes).toEqual([
      dimensionCommandJournalKey('document-1'),
      dimensionCommandJournalKey('document-1'),
    ]);
  });

  it('deduplicates repeated command ids without rewriting storage', () => {
    const harness = storageHarness();
    const journal = new LocalStorageDimensionCommandJournal(harness.storage);
    const command = deleteCommand('c1', 10);

    journal.append('document-1', 0, command);
    journal.append('document-1', 0, {
      ...command,
      at: 99,
    });

    expect(journal.load('document-1')?.commands).toEqual([command]);
    expect(journal.load('document-1')?.updatedAt).toBe(10);
    expect(harness.writes).toHaveLength(1);
  });

  it('round-trips label pinning commands without losing the flag', () => {
    const harness = storageHarness();
    const journal = new LocalStorageDimensionCommandJournal(harness.storage);
    const command: DimensionCommand = {
      type: 'set-label-pinned',
      commandId: 'pin-1',
      actorId: 'owner',
      actorRole: 'designer',
      at: 15,
      dimensionId: 'dimension-1',
      labelPinned: true,
    };

    journal.append('document-1', 0, command);

    expect(journal.load('document-1')?.commands).toEqual([command]);
  });

  it('refuses to mix commands from different base versions', () => {
    const harness = storageHarness();
    const journal = new LocalStorageDimensionCommandJournal(harness.storage);
    journal.append('document-1', 1, deleteCommand('c1', 10));

    expect(() => journal.append(
      'document-1',
      2,
      deleteCommand('c2', 20),
    )).toThrowError(DimensionCommandJournalBaseVersionError);
    expect(journal.load('document-1')?.commands).toHaveLength(1);
  });

  it('throws explicitly at 500 commands instead of dropping history', () => {
    const harness = storageHarness();
    const journal = new LocalStorageDimensionCommandJournal(harness.storage);
    const commands = Array.from(
      { length: 500 },
      (_, index) => deleteCommand(`c${index}`, index),
    );
    journal.replace({
      version: 1,
      documentId: 'document-1',
      baseVersion: 0,
      commands,
      updatedAt: 499,
    });
    const before = harness.values.get(
      dimensionCommandJournalKey('document-1'),
    );

    expect(() => journal.append(
      'document-1',
      0,
      deleteCommand('overflow', 500),
    )).toThrowError(DimensionCommandJournalOverflowError);
    expect(harness.values.get(
      dimensionCommandJournalKey('document-1'),
    )).toBe(before);
  });

  it('returns null for malformed storage and clears one document', () => {
    const key = dimensionCommandJournalKey('document-1');
    const harness = storageHarness([[key, '{"version":2}']]);
    const journal = new LocalStorageDimensionCommandJournal(harness.storage);

    expect(journal.load('document-1')).toBeNull();
    journal.clear('document-1');

    expect(harness.removals).toEqual([key]);
    expect(harness.values.has(key)).toBe(false);
  });
});
