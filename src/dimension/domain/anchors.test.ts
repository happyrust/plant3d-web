import { describe, expect, it, vi } from 'vitest';

import { refreshDocumentAnchors } from './anchors';
import {
  emptyDimensionDocument,
  exactAnchor,
  linearRecord,
  projectedRecord,
} from './testFixtures';

import type { SemanticAnchorRef } from './types';
import type { DimensionAnchorResolver } from '../ports/anchorResolver';

describe('refreshDocumentAnchors', () => {
  it('resolves every semantic anchor in one batch and degrades failures', async () => {
    const aRef: SemanticAnchorRef = {
      source: 'p-point',
      refno: 'A',
      candidateId: 'P1',
    };
    const bRef: SemanticAnchorRef = {
      source: 'primitive-key-point',
      refno: 'B',
      candidateId: 'K1',
    };
    const record = linearRecord({
      a: exactAnchor([1, 2, 3], aRef),
      b: exactAnchor([4, 5, 6], bRef),
      updatedAt: 1,
      validity: 'valid',
    });
    const resolveMany = vi.fn<DimensionAnchorResolver['resolveMany']>(
      async refs => {
        expect(refs).toEqual([aRef, bRef]);
        return [
          {
            ok: true,
            anchor: {
              snapshot: [10, 20, 30],
              accuracy: 'approximate',
            },
          },
          {
            ok: false,
            reason: 'not-found',
          },
        ];
      },
    );
    const state = emptyDimensionDocument([record]);

    const refreshed = await refreshDocumentAnchors(
      state,
      { resolveMany },
      100,
    );

    expect(resolveMany).toHaveBeenCalledTimes(1);
    expect(state.records[0]).toBe(record);
    expect(refreshed.records[0]).toEqual({
      ...record,
      a: {
        snapshot: [10, 20, 30],
        accuracy: 'approximate',
        semanticRef: aRef,
      },
      b: record.b,
      updatedAt: 100,
      validity: 'invalid',
    });
    expect(refreshed.baseVersion).toBe(state.baseVersion);
  });

  it('marks a previously invalid record valid when all refs resolve', async () => {
    const aRef: SemanticAnchorRef = {
      source: 'p-point',
      candidateId: 'A',
    };
    const bRef: SemanticAnchorRef = {
      source: 'p-point',
      candidateId: 'B',
    };
    const record = linearRecord({
      a: { snapshot: null, accuracy: 'exact', semanticRef: aRef },
      b: { snapshot: null, accuracy: 'exact', semanticRef: bRef },
      validity: 'invalid',
    });
    const resolver: DimensionAnchorResolver = {
      resolveMany: async () => [
        { ok: true, anchor: exactAnchor([1, 0, 0], aRef) },
        { ok: true, anchor: exactAnchor([2, 0, 0], bRef) },
      ],
    };

    const refreshed = await refreshDocumentAnchors(
      emptyDimensionDocument([record]),
      resolver,
      200,
    );

    expect(refreshed.records[0]).toMatchObject({
      validity: 'valid',
      updatedAt: 200,
      a: { snapshot: [1, 0, 0] },
      b: { snapshot: [2, 0, 0] },
    });
  });

  it('keeps a record invalid when an unresolved anchor has no semantic ref', async () => {
    const aRef: SemanticAnchorRef = {
      source: 'p-point',
      candidateId: 'A',
    };
    const record = linearRecord({
      a: { snapshot: null, accuracy: 'exact', semanticRef: aRef },
      b: { snapshot: null, accuracy: 'exact' },
      validity: 'invalid',
    });
    const resolver: DimensionAnchorResolver = {
      resolveMany: async () => [
        { ok: true, anchor: exactAnchor([1, 0, 0], aRef) },
      ],
    };

    const refreshed = await refreshDocumentAnchors(
      emptyDimensionDocument([record]),
      resolver,
      250,
    );

    expect(refreshed.records[0]).toMatchObject({
      validity: 'invalid',
      a: { snapshot: [1, 0, 0] },
      b: { snapshot: null },
    });
  });

  it('also refreshes a semantic projection direction', async () => {
    const directionRef: SemanticAnchorRef = {
      source: 'direction',
      refno: 'PIPE-1',
      candidateId: 'axis',
    };
    const record = projectedRecord({
      axis: {
        kind: 'semantic-direction',
        snapshot: [1, 0, 0],
        semanticRef: directionRef,
      },
    });
    const resolver: DimensionAnchorResolver = {
      resolveMany: async refs => {
        expect(refs).toEqual([directionRef]);
        return [{
          ok: true,
          anchor: exactAnchor([0, 1, 0], directionRef),
        }];
      },
    };

    const refreshed = await refreshDocumentAnchors(
      emptyDimensionDocument([record]),
      resolver,
      300,
    );

    expect(refreshed.records[0]).toMatchObject({
      axis: {
        kind: 'semantic-direction',
        snapshot: [0, 1, 0],
        semanticRef: directionRef,
      },
      validity: 'valid',
      updatedAt: 300,
    });
  });

  it('does not call the resolver when the document has no semantic refs', async () => {
    const state = emptyDimensionDocument([linearRecord()]);
    const resolveMany = vi.fn<DimensionAnchorResolver['resolveMany']>();

    const refreshed = await refreshDocumentAnchors(
      state,
      { resolveMany },
      400,
    );

    expect(resolveMany).not.toHaveBeenCalled();
    expect(refreshed).toBe(state);
  });
});
