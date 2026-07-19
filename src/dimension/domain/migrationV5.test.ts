import { describe, expect, it } from 'vitest';

import worldOnlyFixture from '../../fixtures/dimensions/v5-samples/unresolvable-worldpos.json';
import validLinearFixture from '../../fixtures/dimensions/v5-samples/valid-linear.json';
import {
  legacyDimensionBridgeArchiveKey,
  legacyDimensionV5ArchiveKey,
  loadArchivedDimensionArchives,
} from '../adapters/archivedV5Source';

import { migrateLegacyDimensionArchives } from './migrationV5';

import type {
  LegacyDimensionArchive,
  LegacyDimensionBridgeArchive,
} from '../../migrations/legacyDimensionV5Archive';

const migrationContext = {
  documentId: 'dimension-document-1',
  taskId: 'task-1',
  actorId: 'migration-user',
  actorRole: 'designer',
};

function v5Archive(
  records: readonly unknown[],
  archivedAt = 10,
): LegacyDimensionArchive {
  return {
    version: 1,
    sourceVersion: 5,
    scope: 'project=A|db=1',
    archivedAt,
    records,
  };
}

function bridgeArchive(
  records: readonly unknown[],
  archivedAt = 20,
): LegacyDimensionBridgeArchive {
  return {
    version: 1,
    sourceVersion: 'v6-bridge',
    scope: 'project=A|db=1',
    archivedAt,
    records,
  };
}

describe('migrateLegacyDimensionArchives', () => {
  it('maps trusted design coordinates to a valid linear user dimension', () => {
    const result = migrateLegacyDimensionArchives(
      [v5Archive(validLinearFixture.dimensions)],
      migrationContext,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.state).toMatchObject({
      schemaVersion: 1,
      documentId: 'dimension-document-1',
      taskId: 'task-1',
      baseVersion: 0,
    });
    expect(result.state.records).toHaveLength(1);
    expect(result.state.records[0]).toEqual({
      id: 'legacy-linear-valid',
      kind: 'linear',
      a: {
        snapshot: [1, 2, 3],
        accuracy: 'exact',
        semanticRef: {
          source: 'p-point',
          refno: 'A',
          candidateId: 'P1',
        },
      },
      b: {
        snapshot: [4, 5, 6],
        accuracy: 'exact',
        semanticRef: {
          source: 'primitive-key-point',
          refno: 'B',
          candidateId: 'K1',
        },
      },
      placement: {
        offsetM: 0.5,
        labelT: 0.5,
        side: 1,
      },
      authorId: 'migration-user',
      authorRole: 'designer',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      validity: 'valid',
    });
  });

  it('keeps world-only records invalid without trusting scene coordinates', () => {
    const raw = worldOnlyFixture.dimensions[0]!;
    const result = migrateLegacyDimensionArchives(
      [v5Archive(worldOnlyFixture.dimensions)],
      migrationContext,
    );

    expect(result.state.records).toHaveLength(1);
    expect(result.state.records[0]).toMatchObject({
      id: 'legacy-linear-world-only',
      kind: 'linear',
      a: { snapshot: null },
      b: { snapshot: null },
      validity: 'invalid',
    });
    expect(result.state.records[0]).not.toHaveProperty('textOverride');
    expect(result.state.records[0]).not.toHaveProperty('isReference');
    expect(result.state.records[0]).not.toHaveProperty('worldPos');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      {
        legacyId: 'legacy-linear-world-only',
        level: 'error',
        code: 'world-only',
        raw,
      },
      {
        legacyId: 'legacy-linear-world-only',
        level: 'warning',
        code: 'ignored-text-override',
        raw,
      },
      {
        legacyId: 'legacy-linear-world-only',
        level: 'warning',
        code: 'ignored-reference',
        raw,
      },
    ]));
  });

  it('lets the later V6 bridge record win for a duplicate id', () => {
    const earlier = {
      ...validLinearFixture.dimensions[0],
      id: 'same-id',
    };
    const later = {
      ...validLinearFixture.dimensions[0],
      id: 'same-id',
      origin: {
        ...validLinearFixture.dimensions[0]!.origin,
        designWorldPos: [9, 8, 7],
      },
    };

    const result = migrateLegacyDimensionArchives(
      [bridgeArchive([later], 20), v5Archive([earlier], 10)],
      migrationContext,
    );

    expect(result.state.records).toHaveLength(1);
    expect(result.state.records[0]).toMatchObject({
      id: 'same-id',
      a: { snapshot: [9, 8, 7] },
    });
  });

  it('maps legacy supplementary angles to an explicit major arc', () => {
    const result = migrateLegacyDimensionArchives([v5Archive([{
      id: 'legacy-angle',
      kind: 'angle',
      origin: { designWorldPos: [1, 0, 0] },
      corner: { designWorldPos: [0, 0, 0] },
      target: { designWorldPos: [0, 1, 0] },
      offset: 0.8,
      labelT: 0.25,
      supplementary: true,
      displayUnit: 'mm',
      precision: 3,
      createdAt: 123,
    }])], migrationContext);

    expect(result.state.records[0]).toEqual({
      id: 'legacy-angle',
      kind: 'angular',
      vertex: { snapshot: [0, 0, 0], accuracy: 'exact' },
      rayA: { snapshot: [1, 0, 0], accuracy: 'exact' },
      rayB: { snapshot: [0, 1, 0], accuracy: 'exact' },
      placement: {
        radiusM: 0.8,
        labelT: 0.25,
        arcChoice: 'major',
      },
      authorId: 'migration-user',
      authorRole: 'designer',
      createdAt: 123,
      updatedAt: 123,
      validity: 'valid',
    });
    expect(result.state.records[0]).not.toHaveProperty('displayUnit');
    expect(result.state.records[0]).not.toHaveProperty('precision');
  });

  it('maps legacy mesh and position source aliases with correct accuracy', () => {
    const result = migrateLegacyDimensionArchives([v5Archive([{
      id: 'legacy-source-aliases',
      kind: 'linear_distance',
      origin: {
        entityId: 'surface-1',
        designWorldPos: [0, 0, 0],
        sourceInfo: { source: 'mesh_pick_point', refno: 'SURFACE-1' },
      },
      target: {
        entityId: 'position-1',
        designWorldPos: [1, 0, 0],
        sourceInfo: { source: 'position', refno: 'POSITION-1' },
      },
      offset: 0.1,
      createdAt: 124,
    }])], migrationContext);

    expect(result.state.records[0]).toMatchObject({
      a: {
        accuracy: 'approximate',
        semanticRef: { source: 'model-surface', refno: 'SURFACE-1' },
      },
      b: {
        accuracy: 'exact',
        semanticRef: { source: 'instance-origin', refno: 'POSITION-1' },
      },
      validity: 'valid',
    });
  });

  it('reports malformed and unsupported entries without aborting valid records', () => {
    const result = migrateLegacyDimensionArchives([v5Archive([
      null,
      { id: 'unsupported', kind: 'ordinate' },
      validLinearFixture.dimensions[0],
    ])], migrationContext);

    expect(result.state.records.map(record => record.id)).toEqual([
      'legacy-linear-valid',
    ]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'malformed',
      'unsupported-kind',
    ]);
  });
});

describe('loadArchivedDimensionArchives', () => {
  it('reads only the immutable scoped V5 and V6 bridge archive keys', () => {
    const scope = 'project=A|db=1';
    const v5 = v5Archive(validLinearFixture.dimensions, 10);
    const bridge = bridgeArchive(worldOnlyFixture.dimensions, 20);
    const values = new Map<string, string>([
      [legacyDimensionV5ArchiveKey(scope), JSON.stringify(v5)],
      [legacyDimensionBridgeArchiveKey(scope), JSON.stringify(bridge)],
      [`plant3d-web-tools-v5:${scope}`, JSON.stringify({
        version: 5,
        dimensions: [{ id: 'must-not-be-read' }],
      })],
    ]);
    const reads: string[] = [];

    const archives = loadArchivedDimensionArchives({
      getItem(key) {
        reads.push(key);
        return values.get(key) ?? null;
      },
    }, scope);

    expect(reads).toEqual([
      legacyDimensionV5ArchiveKey(scope),
      legacyDimensionBridgeArchiveKey(scope),
    ]);
    expect(archives).toEqual([v5, bridge]);
  });
});
