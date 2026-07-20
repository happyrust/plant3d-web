import { reduceDimensionDocument } from '../domain/reducer';

import { replayPendingCommands } from './replayPendingCommands';

import type { DimensionCommandJournal } from './commandJournal';
import type { ReplayPendingCommandsResult } from './replayPendingCommands';
import type {
  DimensionActor,
  DimensionCommand,
  DimensionCommandIntent,
  ReduceDimensionResult,
} from '../domain/commands';
import type { DimensionDocumentState } from '../domain/document';

type DimensionDocumentListener = (state: DimensionDocumentState) => void;

function invalidHistoryCommand(): ReduceDimensionResult {
  return { ok: false, reason: 'invalid-command' };
}

function materializeCommand(
  intent: DimensionCommandIntent,
  actor: DimensionActor,
  at: number,
  commandId: string,
): DimensionCommand {
  return {
    ...intent,
    commandId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    at,
  };
}

export class DimensionDocumentSession {
  private currentState: DimensionDocumentState;
  private dirtyValue: boolean;
  private readonly listeners = new Set<DimensionDocumentListener>();
  private readonly pendingCommandIds = new Set<string>();
  private undoIntents: DimensionCommandIntent[] = [];
  private redoIntents: DimensionCommandIntent[] = [];
  private readonly journal: DimensionCommandJournal;

  constructor(input: Readonly<{
    initialState: DimensionDocumentState;
    journal: DimensionCommandJournal;
  }>) {
    this.currentState = input.initialState;
    this.journal = input.journal;
    const pending = this.journal.load(input.initialState.documentId);
    pending?.commands.forEach(
      command => this.pendingCommandIds.add(command.commandId),
    );
    this.dirtyValue = (pending?.commands.length ?? 0) > 0;
  }

  get state(): DimensionDocumentState {
    return this.currentState;
  }

  get dirty(): boolean {
    return this.dirtyValue;
  }

  get canUndo(): boolean {
    return this.undoIntents.length > 0;
  }

  get canRedo(): boolean {
    return this.redoIntents.length > 0;
  }

  get pendingCommands(): readonly DimensionCommand[] {
    return this.journal.load(this.currentState.documentId)?.commands ?? [];
  }

  subscribe(listener: DimensionDocumentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  apply(command: DimensionCommand): ReduceDimensionResult {
    if (this.pendingCommandIds.has(command.commandId)) {
      return invalidHistoryCommand();
    }
    const result = reduceDimensionDocument(this.currentState, command);
    if (!result.ok) return result;

    this.journal.append(
      this.currentState.documentId,
      this.currentState.baseVersion,
      command,
    );
    this.currentState = result.state;
    this.undoIntents.push(result.inverse);
    this.redoIntents = [];
    this.pendingCommandIds.add(command.commandId);
    this.dirtyValue = true;
    this.notify();
    return result;
  }

  undo(
    actor: DimensionActor,
    at: number,
    commandId: string,
  ): ReduceDimensionResult {
    const intent = this.undoIntents[this.undoIntents.length - 1];
    if (!intent || this.pendingCommandIds.has(commandId)) {
      return invalidHistoryCommand();
    }
    const command = materializeCommand(intent, actor, at, commandId);
    const result = reduceDimensionDocument(this.currentState, command);
    if (!result.ok) return result;

    this.journal.append(
      this.currentState.documentId,
      this.currentState.baseVersion,
      command,
    );
    this.currentState = result.state;
    this.undoIntents.pop();
    this.redoIntents.push(result.inverse);
    this.pendingCommandIds.add(commandId);
    this.dirtyValue = true;
    this.notify();
    return result;
  }

  redo(
    actor: DimensionActor,
    at: number,
    commandId: string,
  ): ReduceDimensionResult {
    const intent = this.redoIntents[this.redoIntents.length - 1];
    if (!intent || this.pendingCommandIds.has(commandId)) {
      return invalidHistoryCommand();
    }
    const command = materializeCommand(intent, actor, at, commandId);
    const result = reduceDimensionDocument(this.currentState, command);
    if (!result.ok) return result;

    this.journal.append(
      this.currentState.documentId,
      this.currentState.baseVersion,
      command,
    );
    this.currentState = result.state;
    this.redoIntents.pop();
    this.undoIntents.push(result.inverse);
    this.pendingCommandIds.add(commandId);
    this.dirtyValue = true;
    this.notify();
    return result;
  }

  /**
   * Replace the current state after a batch anchor re-resolution (ADR 0005).
   * Unlike `acceptSavedState`, this keeps the command journal, undo/redo
   * stacks and dirty flag: an anchor refresh is a recomputable system event,
   * not a user edit and not a backend save.
   */
  acceptRefreshedState(state: DimensionDocumentState): void {
    this.assertSameDocument(state, 'refresh');
    this.currentState = state;
    this.notify();
  }

  previewPendingCommands(
    latest: DimensionDocumentState,
  ): ReplayPendingCommandsResult {
    this.assertSameDocument(latest, 'replay');
    return replayPendingCommands(latest, this.pendingCommands);
  }

  acceptReplayedState(
    preview: ReplayPendingCommandsResult,
    options: Readonly<{ preserveHistory?: boolean }> = {},
  ): void {
    this.assertSameDocument(preview.state, 'replay');
    const commands = [...preview.applied];
    if (commands.length > 0) {
      this.journal.replace({
        version: 1,
        documentId: preview.state.documentId,
        baseVersion: preview.state.baseVersion,
        commands,
        updatedAt: Math.max(...commands.map(command => command.at)),
      });
    } else {
      this.journal.clear(preview.state.documentId);
    }

    this.currentState = preview.state;
    this.pendingCommandIds.clear();
    commands.forEach(command => this.pendingCommandIds.add(command.commandId));
    if (!options.preserveHistory) {
      this.undoIntents = [];
      this.redoIntents = [];
    }
    this.dirtyValue = commands.length > 0;
    this.notify();
  }

  acceptPersistedState(
    state: DimensionDocumentState,
    options: Readonly<{ preserveHistory?: boolean }> = {},
  ): void {
    this.assertSameDocument(state, 'hydrate');
    const previousState = this.currentState;
    this.currentState = state;
    try {
      this.journal.clear(state.documentId);
    } catch (error) {
      this.currentState = previousState;
      throw error;
    }
    if (!options.preserveHistory) {
      this.undoIntents = [];
      this.redoIntents = [];
    }
    this.pendingCommandIds.clear();
    this.dirtyValue = false;
    this.notify();
  }

  acceptSavedState(state: DimensionDocumentState): void {
    this.acceptPersistedState(state);
  }

  discardPendingCommands(latest: DimensionDocumentState): void {
    this.acceptPersistedState(latest);
  }

  private assertSameDocument(
    state: DimensionDocumentState,
    operation: 'hydrate' | 'refresh' | 'replay',
  ): void {
    if (state.documentId === this.currentState.documentId) return;
    throw new Error(
      `Cannot ${operation} dimension document "${this.currentState.documentId}" `
      + `from "${state.documentId}"`,
    );
  }

  private notify(): void {
    [...this.listeners].forEach(listener => listener(this.currentState));
  }
}
