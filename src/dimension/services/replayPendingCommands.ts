import { reduceDimensionDocument } from '../domain/reducer';

import type { DimensionCommand } from '../domain/commands';
import type { DimensionDocumentState } from '../domain/document';

export type ReplayPendingCommandsResult = Readonly<{
  state: DimensionDocumentState;
  applied: readonly DimensionCommand[];
  rejected: readonly Readonly<{
    command: DimensionCommand;
    reason: string;
  }>[];
}>;

export function replayPendingCommands(
  latest: DimensionDocumentState,
  commands: readonly DimensionCommand[],
): ReplayPendingCommandsResult {
  let state = latest;
  const applied: DimensionCommand[] = [];
  const rejected: Readonly<{
    command: DimensionCommand;
    reason: string;
  }>[] = [];

  commands.forEach((command) => {
    const result = reduceDimensionDocument(state, command);
    if (!result.ok) {
      rejected.push({
        command,
        reason: result.reason,
      });
      return;
    }
    state = result.state;
    applied.push(command);
  });

  return {
    state,
    applied,
    rejected,
  };
}
