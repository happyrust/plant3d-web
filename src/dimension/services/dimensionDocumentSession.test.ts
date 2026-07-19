import { describe, expect, it, vi } from 'vitest';

import {
  emptyDimensionDocument,
  linearRecord,
} from '../domain/testFixtures';

import { DimensionDocumentSession } from './dimensionDocumentSession';

import type {
  DimensionCommandJournal,
  DimensionCommandJournalState,
} from './commandJournal';
import type { DimensionCommand } from '../domain/commands';

class MemoryJournal implements DimensionCommandJournal {
  state: DimensionCommandJournalState | null = null;
  readonly appended: DimensionCommand[] = [];
  readonly cleared: string[] = [];
  onAppend?: () => void;
  onClear?: () => void;

  load(documentId: string): DimensionCommandJournalState | null {
    return this.state?.documentId === documentId ? this.state : null;
  }

  append(
    documentId: string,
    baseVersion: number,
    command: DimensionCommand,
  ): void {
    this.onAppend?.();
    this.appended.push(command);
    this.state = {
      version: 1,
      documentId,
      baseVersion,
      commands: [...(this.state?.commands ?? []), command],
      updatedAt: command.at,
    };
  }

  replace(state: DimensionCommandJournalState): void {
    this.state = state;
  }

  clear(documentId: string): void {
    this.onClear?.();
    this.cleared.push(documentId);
    if (this.state?.documentId === documentId) this.state = null;
  }
}

function createCommand(
  commandId: string,
  id: string,
  at: number,
): DimensionCommand {
  return {
    type: 'create',
    commandId,
    actorId: 'owner',
    actorRole: 'designer',
    at,
    record: linearRecord({
      id,
      authorId: 'owner',
      authorRole: 'designer',
      createdAt: at,
      updatedAt: at,
    }),
  };
}

describe('DimensionDocumentSession', () => {
  it('applies one command, journals before notification, and adds one undo entry', () => {
    const journal = new MemoryJournal();
    const order: string[] = [];
    journal.onAppend = () => order.push('journal');
    const session = new DimensionDocumentSession({
      initialState: emptyDimensionDocument(),
      journal,
    });
    session.subscribe(() => order.push('notify'));

    const result = session.apply(createCommand('c1', 'd1', 10));

    expect(result.ok).toBe(true);
    expect(session.state.records.map(record => record.id)).toEqual(['d1']);
    expect(session.dirty).toBe(true);
    expect(session.canUndo).toBe(true);
    expect(session.canRedo).toBe(false);
    expect(journal.appended.map(command => command.commandId)).toEqual(['c1']);
    expect(order).toEqual(['journal', 'notify']);
  });

  it('undoes and redoes with newly materialized commands', () => {
    const journal = new MemoryJournal();
    const session = new DimensionDocumentSession({
      initialState: emptyDimensionDocument(),
      journal,
    });
    session.apply(createCommand('c1', 'd1', 10));

    const undone = session.undo(
      { actorId: 'owner', actorRole: 'designer' },
      20,
      'c2',
    );
    expect(undone.ok).toBe(true);
    expect(session.state.records).toEqual([]);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(true);
    expect(journal.appended[1]).toEqual({
      type: 'delete',
      commandId: 'c2',
      actorId: 'owner',
      actorRole: 'designer',
      at: 20,
      dimensionId: 'd1',
    });

    const redone = session.redo(
      { actorId: 'owner', actorRole: 'designer' },
      30,
      'c3',
    );
    expect(redone.ok).toBe(true);
    expect(session.state.records.map(record => record.id)).toEqual(['d1']);
    expect(session.canUndo).toBe(true);
    expect(session.canRedo).toBe(false);
    expect(journal.appended.map(command => command.commandId)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
  });

  it('allows an admin to undo deletion without changing the original author', () => {
    const record = linearRecord({ id: 'd-admin', authorId: 'owner' });
    const session = new DimensionDocumentSession({
      initialState: emptyDimensionDocument([record]),
      journal: new MemoryJournal(),
    });
    const deleted = session.apply({
      type: 'delete',
      commandId: 'admin-delete',
      actorId: 'admin-user',
      actorRole: 'admin',
      at: 40,
      dimensionId: record.id,
    });
    expect(deleted.ok).toBe(true);

    const restored = session.undo(
      { actorId: 'admin-user', actorRole: 'admin' },
      41,
      'admin-undo',
    );

    expect(restored.ok).toBe(true);
    expect(session.state.records).toEqual([record]);
  });

  it('clears redo after a new command', () => {
    const session = new DimensionDocumentSession({
      initialState: emptyDimensionDocument(),
      journal: new MemoryJournal(),
    });
    session.apply(createCommand('c1', 'd1', 10));
    session.undo(
      { actorId: 'owner', actorRole: 'designer' },
      20,
      'c2',
    );
    expect(session.canRedo).toBe(true);

    session.apply(createCommand('c3', 'd2', 30));

    expect(session.canRedo).toBe(false);
    expect(session.state.records.map(record => record.id)).toEqual(['d2']);
  });

  it('does not journal, notify, or add history for a rejected command', () => {
    const journal = new MemoryJournal();
    const listener = vi.fn();
    const session = new DimensionDocumentSession({
      initialState: emptyDimensionDocument(),
      journal,
    });
    session.subscribe(listener);
    const command = createCommand('c1', 'd1', 10);
    session.apply(command);

    const result = session.apply({
      ...command,
      commandId: 'c2',
    });

    expect(result).toEqual({ ok: false, reason: 'duplicate-id' });
    expect(journal.appended).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.canUndo).toBe(true);
  });

  it('installs saved state before clearing journal and then resets history', () => {
    const journal = new MemoryJournal();
    const session = new DimensionDocumentSession({
      initialState: emptyDimensionDocument(),
      journal,
    });
    session.apply(createCommand('c1', 'd1', 10));
    const saved = emptyDimensionDocument(
      [linearRecord({ id: 'd1' })],
      { baseVersion: 1 },
    );
    const listener = vi.fn();
    session.subscribe(listener);
    journal.onClear = () => {
      expect(session.state).toBe(saved);
      expect(session.canUndo).toBe(true);
      expect(session.dirty).toBe(true);
    };

    session.acceptSavedState(saved);

    expect(journal.cleared).toEqual([saved.documentId]);
    expect(session.state).toBe(saved);
    expect(session.dirty).toBe(false);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(false);
    expect(listener).toHaveBeenCalledWith(saved);
  });

  it('does not publish reducer state if journaling fails', () => {
    const journal = new MemoryJournal();
    journal.onAppend = () => {
      throw new Error('storage unavailable');
    };
    const initialState = emptyDimensionDocument();
    const listener = vi.fn();
    const session = new DimensionDocumentSession({
      initialState,
      journal,
    });
    session.subscribe(listener);

    expect(() => session.apply(createCommand('c1', 'd1', 10))).toThrow(
      'storage unavailable',
    );
    expect(session.state).toBe(initialState);
    expect(session.dirty).toBe(false);
    expect(session.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
