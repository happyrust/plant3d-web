import type { DimensionCommand } from '../domain/commands';

const JOURNAL_KEY_PREFIX = 'plant3d-web-dimension-journal-v1';
const MAX_JOURNAL_COMMANDS = 500;

export type StorageLike = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export type DimensionCommandJournalState = Readonly<{
  version: 1;
  documentId: string;
  baseVersion: number;
  commands: readonly DimensionCommand[];
  updatedAt: number;
}>;

export type DimensionCommandJournal = Readonly<{
  load(documentId: string): DimensionCommandJournalState | null;
  append(
    documentId: string,
    baseVersion: number,
    command: DimensionCommand,
  ): void;
  replace(state: DimensionCommandJournalState): void;
  clear(documentId: string): void;
}>;

export class DimensionCommandJournalOverflowError extends Error {
  constructor(documentId: string) {
    super(
      `Dimension command journal for "${documentId}" exceeds ${MAX_JOURNAL_COMMANDS} commands`,
    );
    this.name = 'DimensionCommandJournalOverflowError';
  }
}

export class DimensionCommandJournalBaseVersionError extends Error {
  constructor(
    documentId: string,
    expectedBaseVersion: number,
    receivedBaseVersion: number,
  ) {
    super(
      `Dimension command journal for "${documentId}" has base version `
      + `${expectedBaseVersion}, not ${receivedBaseVersion}`,
    );
    this.name = 'DimensionCommandJournalBaseVersionError';
  }
}

export class DimensionCommandJournalInvalidStateError extends Error {
  constructor(documentId: string) {
    super(`Dimension command journal for "${documentId}" is invalid`);
    this.name = 'DimensionCommandJournalInvalidStateError';
  }
}

export function dimensionCommandJournalKey(documentId: string): string {
  return `${JOURNAL_KEY_PREFIX}:${documentId}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDimensionCommand(value: unknown): value is DimensionCommand {
  const command = asObject(value);
  if (
    !command
    || !isNonEmptyString(command.commandId)
    || !isNonEmptyString(command.actorId)
    || !isNonEmptyString(command.actorRole)
    || !isFiniteNumber(command.at)
  ) {
    return false;
  }

  switch (command.type) {
    case 'create':
    case 'restore':
      return asObject(command.record) !== null;
    case 'delete':
      return isNonEmptyString(command.dimensionId);
    case 'replace-placement':
      return isNonEmptyString(command.dimensionId)
        && asObject(command.placement) !== null;
    case 'set-angle-arc':
      return isNonEmptyString(command.dimensionId)
        && (command.arcChoice === 'minor' || command.arcChoice === 'major');
    case 'set-radial-display':
      return isNonEmptyString(command.dimensionId)
        && (command.display === 'radius' || command.display === 'diameter');
    case 'rebind-anchor':
      return isNonEmptyString(command.dimensionId)
        && isNonEmptyString(command.anchorSlot)
        && asObject(command.anchor) !== null;
    default:
      return false;
  }
}

function deduplicateCommands(
  commands: readonly DimensionCommand[],
): readonly DimensionCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (seen.has(command.commandId)) return false;
    seen.add(command.commandId);
    return true;
  });
}

function parseJournalState(
  raw: string | null,
  documentId: string,
): DimensionCommandJournalState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const state = asObject(parsed);
  if (
    !state
    || state.version !== 1
    || state.documentId !== documentId
    || !Number.isInteger(state.baseVersion)
    || (state.baseVersion as number) < 0
    || !Array.isArray(state.commands)
    || state.commands.length > MAX_JOURNAL_COMMANDS
    || !state.commands.every(isDimensionCommand)
    || !isFiniteNumber(state.updatedAt)
  ) {
    return null;
  }
  const commands = state.commands as DimensionCommand[];
  if (new Set(commands.map(command => command.commandId)).size
    !== commands.length) {
    return null;
  }
  return {
    version: 1,
    documentId,
    baseVersion: state.baseVersion as number,
    commands,
    updatedAt: state.updatedAt,
  };
}

function validateReplacement(
  state: DimensionCommandJournalState,
): DimensionCommandJournalState {
  if (
    state.version !== 1
    || !isNonEmptyString(state.documentId)
    || !Number.isInteger(state.baseVersion)
    || state.baseVersion < 0
    || !isFiniteNumber(state.updatedAt)
    || !state.commands.every(isDimensionCommand)
  ) {
    throw new DimensionCommandJournalInvalidStateError(state.documentId);
  }
  const commands = deduplicateCommands(state.commands);
  if (commands.length > MAX_JOURNAL_COMMANDS) {
    throw new DimensionCommandJournalOverflowError(state.documentId);
  }
  return {
    ...state,
    commands,
  };
}

export class LocalStorageDimensionCommandJournal
implements DimensionCommandJournal {
  constructor(private readonly storage: StorageLike) {}

  load(documentId: string): DimensionCommandJournalState | null {
    return parseJournalState(
      this.storage.getItem(dimensionCommandJournalKey(documentId)),
      documentId,
    );
  }

  append(
    documentId: string,
    baseVersion: number,
    command: DimensionCommand,
  ): void {
    if (
      !isNonEmptyString(documentId)
      || !Number.isInteger(baseVersion)
      || baseVersion < 0
      || !isDimensionCommand(command)
    ) {
      throw new DimensionCommandJournalInvalidStateError(documentId);
    }

    const key = dimensionCommandJournalKey(documentId);
    const raw = this.storage.getItem(key);
    const current = parseJournalState(raw, documentId);
    if (raw !== null && current === null) {
      throw new DimensionCommandJournalInvalidStateError(documentId);
    }
    if (current && current.baseVersion !== baseVersion) {
      throw new DimensionCommandJournalBaseVersionError(
        documentId,
        current.baseVersion,
        baseVersion,
      );
    }
    if (current?.commands.some(
      existing => existing.commandId === command.commandId,
    )) {
      return;
    }
    const commands = [...(current?.commands ?? []), command];
    if (commands.length > MAX_JOURNAL_COMMANDS) {
      throw new DimensionCommandJournalOverflowError(documentId);
    }
    const next: DimensionCommandJournalState = {
      version: 1,
      documentId,
      baseVersion,
      commands,
      updatedAt: command.at,
    };
    this.storage.setItem(key, JSON.stringify(next));
  }

  replace(state: DimensionCommandJournalState): void {
    const replacement = validateReplacement(state);
    this.storage.setItem(
      dimensionCommandJournalKey(replacement.documentId),
      JSON.stringify(replacement),
    );
  }

  clear(documentId: string): void {
    this.storage.removeItem(dimensionCommandJournalKey(documentId));
  }
}
