import { describe, expect, it } from 'vitest';

import { reduceDimensionDocument } from './reducer';
import {
  angularRecord,
  emptyDimensionDocument,
  exactAnchor,
  linearRecord,
  radialRecord,
} from './testFixtures';

describe('reduceDimensionDocument', () => {
  it('creates one immutable record', () => {
    const state = emptyDimensionDocument();
    const record = linearRecord({ id: 'd1', authorId: 'u1' });

    const result = reduceDimensionDocument(state, {
      type: 'create',
      commandId: 'c1',
      actorId: 'u1',
      actorRole: 'designer',
      at: 10,
      record,
    });

    expect(result.ok).toBe(true);
    expect(state.records).toEqual([]);
    if (result.ok) {
      expect(result.state).not.toBe(state);
      expect(result.state.records).toEqual([record]);
      expect(result.event).toEqual({
        type: 'created',
        commandId: 'c1',
        record,
      });
      expect(result.inverse).toEqual({
        type: 'delete',
        dimensionId: 'd1',
      });
    }
  });

  it('rejects create commands from a non-author non-admin', () => {
    const result = reduceDimensionDocument(emptyDimensionDocument(), {
      type: 'create',
      commandId: 'c1',
      actorId: 'other',
      actorRole: 'reviewer',
      at: 10,
      record: linearRecord({ id: 'd1', authorId: 'owner' }),
    });

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('rejects duplicate record ids', () => {
    const record = linearRecord({ id: 'd1' });
    const result = reduceDimensionDocument(emptyDimensionDocument([record]), {
      type: 'create',
      commandId: 'c1',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 10,
      record,
    });

    expect(result).toEqual({ ok: false, reason: 'duplicate-id' });
  });

  it('rejects mutation by a non-author non-admin', () => {
    const state = emptyDimensionDocument([
      linearRecord({ id: 'd1', authorId: 'owner' }),
    ]);
    const result = reduceDimensionDocument(state, {
      type: 'delete',
      commandId: 'c2',
      actorId: 'other',
      actorRole: 'reviewer',
      at: 20,
      dimensionId: 'd1',
    });

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('allows an admin to delete and returns a recreate inverse', () => {
    const record = linearRecord({ id: 'd1', authorId: 'owner' });
    const result = reduceDimensionDocument(emptyDimensionDocument([record]), {
      type: 'delete',
      commandId: 'c2',
      actorId: 'admin',
      actorRole: 'ADMIN',
      at: 20,
      dimensionId: 'd1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records).toEqual([]);
      expect(result.event).toEqual({
        type: 'deleted',
        commandId: 'c2',
        dimensionId: 'd1',
        previous: record,
      });
      expect(result.inverse).toEqual({ type: 'restore', record });
    }
  });

  it('allows an admin to restore an authored record without changing authorship', () => {
    const record = linearRecord({ id: 'd1', authorId: 'owner' });
    const result = reduceDimensionDocument(emptyDimensionDocument(), {
      type: 'restore',
      commandId: 'c-restore',
      actorId: 'admin-user',
      actorRole: 'admin',
      at: 21,
      record,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records).toEqual([record]);
      expect(result.inverse).toEqual({ type: 'delete', dimensionId: record.id });
    }
  });

  it('rejects a valid record whose required anchor snapshot is unresolved', () => {
    const record = linearRecord({
      a: { snapshot: null, accuracy: 'exact' },
      validity: 'valid',
    });
    expect(reduceDimensionDocument(emptyDimensionDocument(), {
      type: 'create',
      commandId: 'c-invalid-geometry',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 22,
      record,
    })).toEqual({ ok: false, reason: 'invalid-command' });
  });

  it('replaces matching placement immutably and updates the audit time', () => {
    const record = linearRecord({
      id: 'd1',
      labelPinned: false,
      updatedAt: 1,
    });
    const placement = { offsetM: 2, labelT: 0.25, side: -1 as const };
    const state = emptyDimensionDocument([record]);
    const result = reduceDimensionDocument(state, {
      type: 'replace-placement',
      commandId: 'c3',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 30,
      dimensionId: record.id,
      placement,
      labelPinned: true,
    });

    expect(result.ok).toBe(true);
    expect(state.records[0]).toBe(record);
    if (result.ok) {
      expect(result.state.records[0]).toEqual({
        ...record,
        placement,
        labelPinned: true,
        updatedAt: 30,
      });
      expect(result.inverse).toEqual({
        type: 'replace-placement',
        dimensionId: record.id,
        placement: record.placement,
        labelPinned: false,
      });
    }
  });

  it('restores automatic layout without changing anchors or placement', () => {
    const record = linearRecord({
      id: 'd1',
      labelPinned: true,
    });
    const result = reduceDimensionDocument(
      emptyDimensionDocument([record]),
      {
        type: 'set-label-pinned',
        commandId: 'c-auto-layout',
        actorId: record.authorId,
        actorRole: record.authorRole,
        at: 31,
        dimensionId: record.id,
        labelPinned: false,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records[0]).toEqual({
        ...record,
        labelPinned: false,
        updatedAt: 31,
      });
      expect(result.inverse).toEqual({
        type: 'set-label-pinned',
        dimensionId: record.id,
        labelPinned: true,
      });
    }
  });

  it('rejects a placement that does not match the record kind', () => {
    const record = linearRecord({ id: 'd1' });
    const result = reduceDimensionDocument(emptyDimensionDocument([record]), {
      type: 'replace-placement',
      commandId: 'c3',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 30,
      dimensionId: record.id,
      placement: {
        arcChoice: 'minor',
        labelT: 0.5,
        radiusM: 1,
      },
    });

    expect(result).toEqual({ ok: false, reason: 'kind-mismatch' });
  });

  it('sets angle arc choice only on angular records', () => {
    const record = angularRecord({ id: 'angle-1' });
    const result = reduceDimensionDocument(emptyDimensionDocument([record]), {
      type: 'set-angle-arc',
      commandId: 'c4',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 40,
      dimensionId: record.id,
      arcChoice: 'major',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records[0]?.placement.arcChoice).toBe('major');
      expect(result.inverse).toEqual({
        type: 'set-angle-arc',
        dimensionId: record.id,
        arcChoice: 'minor',
      });
    }

    const linear = linearRecord({ id: 'linear-1' });
    expect(reduceDimensionDocument(emptyDimensionDocument([linear]), {
      type: 'set-angle-arc',
      commandId: 'c5',
      actorId: linear.authorId,
      actorRole: linear.authorRole,
      at: 40,
      dimensionId: linear.id,
      arcChoice: 'major',
    })).toEqual({ ok: false, reason: 'kind-mismatch' });
  });

  it('sets radial display only on radial records', () => {
    const record = radialRecord({ id: 'radial-1' });
    const result = reduceDimensionDocument(emptyDimensionDocument([record]), {
      type: 'set-radial-display',
      commandId: 'c6',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 50,
      dimensionId: record.id,
      display: 'diameter',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records[0]).toMatchObject({
        display: 'diameter',
        updatedAt: 50,
      });
      expect(result.inverse).toEqual({
        type: 'set-radial-display',
        dimensionId: record.id,
        display: 'radius',
      });
    }
  });

  it('rebinds a valid slot and rejects a slot from another kind', () => {
    const record = angularRecord({ id: 'angle-1', validity: 'invalid' });
    const anchor = exactAnchor([5, 6, 7]);
    const state = emptyDimensionDocument([record]);
    const result = reduceDimensionDocument(state, {
      type: 'rebind-anchor',
      commandId: 'c7',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 60,
      dimensionId: record.id,
      anchorSlot: 'vertex',
      anchor,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records[0]).toEqual({
        ...record,
        vertex: anchor,
        updatedAt: 60,
        validity: 'valid',
      });
      expect(result.inverse).toEqual({
        type: 'rebind-anchor',
        dimensionId: record.id,
        anchorSlot: 'vertex',
        anchor: record.vertex,
      });
    }

    expect(reduceDimensionDocument(state, {
      type: 'rebind-anchor',
      commandId: 'c8',
      actorId: record.authorId,
      actorRole: record.authorRole,
      at: 60,
      dimensionId: record.id,
      anchorSlot: 'center',
      anchor,
    })).toEqual({ ok: false, reason: 'kind-mismatch' });
  });

  it('keeps a record invalid until every required anchor is rebound', () => {
    const record = angularRecord({
      vertex: { snapshot: null, accuracy: 'exact' },
      rayA: { snapshot: null, accuracy: 'exact' },
      validity: 'invalid',
    });
    const result = reduceDimensionDocument(
      emptyDimensionDocument([record]),
      {
        type: 'rebind-anchor',
        commandId: 'c-partial-rebind',
        actorId: record.authorId,
        actorRole: record.authorRole,
        at: 70,
        dimensionId: record.id,
        anchorSlot: 'vertex',
        anchor: exactAnchor([0, 0, 0]),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.records[0]).toMatchObject({
        validity: 'invalid',
        vertex: { snapshot: [0, 0, 0] },
        rayA: { snapshot: null },
      });
    }
  });
});
