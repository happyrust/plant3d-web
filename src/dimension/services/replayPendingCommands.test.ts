import { describe, expect, it } from 'vitest';

import {
  emptyDimensionDocument,
  linearRecord,
} from '../domain/testFixtures';

import { replayPendingCommands } from './replayPendingCommands';

import type { DimensionCommand } from '../domain/commands';

describe('replayPendingCommands', () => {
  it('previews commands sequentially and reports rejected commands explicitly', () => {
    const existing = linearRecord({ id: 'existing', authorId: 'owner' });
    const latest = emptyDimensionDocument(
      [existing],
      { baseVersion: 7 },
    );
    const create: DimensionCommand = {
      type: 'create',
      commandId: 'c1',
      actorId: 'owner',
      actorRole: 'designer',
      at: 10,
      record: linearRecord({ id: 'created', authorId: 'owner' }),
    };
    const missingDelete: DimensionCommand = {
      type: 'delete',
      commandId: 'c2',
      actorId: 'owner',
      actorRole: 'designer',
      at: 20,
      dimensionId: 'missing',
    };
    const forbiddenEdit: DimensionCommand = {
      type: 'replace-placement',
      commandId: 'c3',
      actorId: 'other',
      actorRole: 'reviewer',
      at: 30,
      dimensionId: 'existing',
      placement: {
        offsetM: 2,
        labelT: 0.5,
        side: 1,
      },
    };
    const deleteCreated: DimensionCommand = {
      type: 'delete',
      commandId: 'c4',
      actorId: 'owner',
      actorRole: 'designer',
      at: 40,
      dimensionId: 'created',
    };

    const result = replayPendingCommands(latest, [
      create,
      missingDelete,
      forbiddenEdit,
      deleteCreated,
    ]);

    expect(latest.records).toEqual([existing]);
    expect(result.state.records).toEqual([existing]);
    expect(result.state.baseVersion).toBe(7);
    expect(result.applied).toEqual([create, deleteCreated]);
    expect(result.rejected).toEqual([
      { command: missingDelete, reason: 'not-found' },
      { command: forbiddenEdit, reason: 'forbidden' },
    ]);
  });

  it('returns the latest state unchanged when there are no pending commands', () => {
    const latest = emptyDimensionDocument([], { baseVersion: 2 });

    const result = replayPendingCommands(latest, []);

    expect(result).toEqual({
      state: latest,
      applied: [],
      rejected: [],
    });
    expect(result.state).toBe(latest);
  });
});
