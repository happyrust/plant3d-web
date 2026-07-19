import { reduceDimensionDocument } from '../domain/reducer';

import type { DimensionCommandJournal } from './commandJournal';
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

  acceptSavedState(state: DimensionDocumentState): void {
    if (state.documentId !== this.currentState.documentId) {
      throw new Error(
        `Cannot hydrate dimension document "${this.currentState.documentId}" `
        + `from "${state.documentId}"`,
      );
    }
    const previousState = this.currentState;
    this.currentState = state;
    try {
      this.journal.clear(state.documentId);
    } catch (error) {
      this.currentState = previousState;
      throw error;
    }
    this.undoIntents = [];
    this.redoIntents = [];
    this.pendingCommandIds.clear();
    this.dirtyValue = false;
    this.notify();
  }

  private notify(): void {
    [...this.listeners].forEach(listener => listener(this.currentState));
  }
}
