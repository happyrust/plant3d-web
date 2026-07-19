import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import {
  archiveLegacyDimensionBridge,
  archiveLegacyDimensions,
  parseLegacyDimensionArchive,
  type LegacyDimensionBridgeArchive,
  type LegacyDimensionArchive,
  type StorageLike,
} from './legacyDimensionV5Archive';

function storageAdapter(
  values: Map<string, string>,
  writes: string[] = [],
): StorageLike {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
  };
}

function createBrowserStorage(entries: readonly (readonly [string, string])[] = []) {
  const values = new Map<string, string>(entries);
  const writes: string[] = [];
  const storage: Storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
  return { storage, values, writes };
}

function installBrowserStorage(harness: ReturnType<typeof createBrowserStorage>) {
  (globalThis as unknown as { localStorage: Storage }).localStorage = harness.storage;
}

function setSearch(search: string) {
  window.history.replaceState({}, '', search);
}

describe('legacyDimensionV5Archive', () => {
  it('archives V5 dimensions once without interpreting or changing their shape', () => {
    const source = {
      version: 5,
      dimensions: [
        { id: 'legacy-linear-valid', custom: { enabled: true }, coordinates: [1, 2, 3] },
        'opaque-record',
        null,
      ],
    };
    const sourceRaw = JSON.stringify(source);
    const values = new Map<string, string>([['tools', sourceRaw]]);
    const now = vi.fn(() => 123);

    expect(archiveLegacyDimensions(storageAdapter(values), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 'project=A|db=1',
      now,
    })).toBe('created');
    expect(archiveLegacyDimensions(storageAdapter(values), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 'project=A|db=1',
      now: () => 456,
    })).toBe('exists');

    expect(JSON.parse(values.get('archive')!) satisfies LegacyDimensionArchive).toEqual({
      version: 1,
      sourceVersion: 5,
      scope: 'project=A|db=1',
      archivedAt: 123,
      records: source.dimensions,
    });
    expect(values.get('tools')).toBe(sourceRaw);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('archives scoped V4 dimensions as opaque records', () => {
    const values = new Map<string, string>([
      ['tools-v4', JSON.stringify({
        version: 4,
        dimensions: [{ legacy: 'v4-only-field' }],
      })],
    ]);

    expect(archiveLegacyDimensions(storageAdapter(values), {
      sourceKey: 'tools-v4',
      archiveKey: 'archive',
      scope: 'project=B|db=2',
      now: () => 234,
    })).toBe('created');
    expect(JSON.parse(values.get('archive')!)).toEqual({
      version: 1,
      sourceVersion: 4,
      scope: 'project=B|db=2',
      archivedAt: 234,
      records: [{ legacy: 'v4-only-field' }],
    });
  });

  it.each([
    ['missing dimensions', { version: 5 }],
    ['empty dimensions', { version: 4, dimensions: [] }],
  ])('does not create an archive for %s', (_label, source) => {
    const values = new Map<string, string>([['tools', JSON.stringify(source)]]);

    expect(archiveLegacyDimensions(storageAdapter(values), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 's',
      now: () => 1,
    })).toBe('empty');
    expect(values.has('archive')).toBe(false);
  });

  it('rejects invalid JSON without creating an archive', () => {
    const values = new Map<string, string>([['tools', '{"version":5,"dimensions":[}']]);

    expect(archiveLegacyDimensions(storageAdapter(values), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 's',
      now: () => 1,
    })).toBe('invalid');
    expect(values.has('archive')).toBe(false);
    expect(parseLegacyDimensionArchive('{"version":6,"dimensions":[]}', {
      scope: 's',
      archivedAt: 1,
    })).toBeNull();
  });

  it('never overwrites an existing archive', () => {
    const existing = JSON.stringify({ sentinel: 'keep-me' });
    const values = new Map<string, string>([
      ['tools', JSON.stringify({ version: 5, dimensions: [{ id: 'new' }] })],
      ['archive', existing],
    ]);
    const writes: string[] = [];

    expect(archiveLegacyDimensions(storageAdapter(values, writes), {
      sourceKey: 'tools',
      archiveKey: 'archive',
      scope: 's',
      now: () => 1,
    })).toBe('exists');
    expect(values.get('archive')).toBe(existing);
    expect(writes).toEqual([]);
  });

  it('archives V6 bridge dimensions without interpreting their shape', () => {
    const values = new Map<string, string>([
      ['bridge', JSON.stringify({
        version: 6,
        dimensions: [{ id: 'bridge-dimension', extra: { opaque: true } }],
      })],
    ]);

    expect(archiveLegacyDimensionBridge(storageAdapter(values), {
      sourceKey: 'bridge',
      archiveKey: 'bridge-archive',
      scope: 'project=C|db=3',
      now: () => 345,
    })).toBe('created');
    expect(JSON.parse(values.get('bridge-archive')!) satisfies LegacyDimensionBridgeArchive).toEqual({
      version: 1,
      sourceVersion: 'v6-bridge',
      scope: 'project=C|db=3',
      archivedAt: 345,
      records: [{ id: 'bridge-dimension', extra: { opaque: true } }],
    });
  });
});

describe('useToolStore legacy dimension archive bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    installBrowserStorage(createBrowserStorage());
    setSearch('?output_project=ArchiveDefault&show_dbnum=101');
  });

  it('archives scoped V5 before the first V6 persistence write and leaves V5 untouched', async () => {
    const scope = 'project=ArchiveProject|db=202';
    const v5Key = `plant3d-web-tools-v5:${scope}`;
    const archiveKey = `plant3d-web-dimensions-v5-archive:${scope}`;
    const v6Key = `plant3d-web-tools-v6:${scope}`;
    const sourceRaw = JSON.stringify({
      version: 5,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [{ id: 'legacy-dimension', custom: true }],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
      xeokitElevationPointMeasurements: [],
      xeokitElevationDeltaMeasurements: [],
    });
    const harness = createBrowserStorage([[v5Key, sourceRaw]]);
    installBrowserStorage(harness);
    setSearch('?output_project=ArchiveProject&show_dbnum=202');

    const mod = await import('../composables/useToolStore');
    const store = mod.useToolStore();
    store.addMeasurement({
      id: 'measurement-after-load',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    await nextTick();

    expect(harness.values.get(v5Key)).toBe(sourceRaw);
    expect(JSON.parse(harness.values.get(archiveKey)!)).toMatchObject({
      version: 1,
      sourceVersion: 5,
      scope,
      records: [{ id: 'legacy-dimension', custom: true }],
    });
    expect(JSON.parse(harness.values.get(v6Key)!)).toMatchObject({
      version: 6,
    });
    expect(JSON.parse(harness.values.get(v6Key)!)).not.toHaveProperty('dimensions');
    expect(harness.writes.indexOf(archiveKey)).toBeLessThan(harness.writes.indexOf(v6Key));
  });

  it('archives the latest V6 bridge dimensions before replacing the bridge with final V6', async () => {
    const scope = 'project=FreshProject|db=404';
    const v6Key = `plant3d-web-tools-v6:${scope}`;
    const bridgeArchiveKey = `plant3d-web-dimensions-v6-bridge-archive:${scope}`;
    const bridgeRaw = JSON.stringify({
      version: 6,
      measurements: [],
      annotations: [],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [{ id: 'fresh-dimension', visible: false }],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
      xeokitElevationPointMeasurements: [],
      xeokitElevationDeltaMeasurements: [],
    });
    const harness = createBrowserStorage([[v6Key, bridgeRaw]]);
    installBrowserStorage(harness);
    setSearch('?output_project=FreshProject&show_dbnum=404');

    const mod = await import('../composables/useToolStore');
    const store = mod.useToolStore();
    store.addMeasurement({
      id: 'measurement-after-bridge',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    });
    await nextTick();

    const archiveWrite = harness.writes.indexOf(bridgeArchiveKey);
    const v6Write = harness.writes.indexOf(v6Key);
    expect(archiveWrite).toBeGreaterThanOrEqual(0);
    expect(archiveWrite).toBeLessThan(v6Write);
    expect(JSON.parse(harness.values.get(bridgeArchiveKey)!) satisfies LegacyDimensionBridgeArchive).toEqual({
      version: 1,
      sourceVersion: 'v6-bridge',
      scope,
      archivedAt: expect.any(Number),
      records: [{ id: 'fresh-dimension', visible: false }],
    });
    expect(JSON.parse(harness.values.get(v6Key)!)).not.toHaveProperty('dimensions');
  });

  it('keeps browser archives isolated by project and database scope', async () => {
    const scopeA = 'project=ProjectA|db=1001';
    const scopeB = 'project=ProjectB|db=2002';
    const sourceKeyA = `plant3d-web-tools-v5:${scopeA}`;
    const sourceKeyB = `plant3d-web-tools-v4:${scopeB}`;
    const archiveKeyA = `plant3d-web-dimensions-v5-archive:${scopeA}`;
    const archiveKeyB = `plant3d-web-dimensions-v5-archive:${scopeB}`;
    const rawA = JSON.stringify({ version: 5, dimensions: [{ id: 'a' }] });
    const rawB = JSON.stringify({ version: 4, dimensions: [{ id: 'b' }] });
    const harness = createBrowserStorage([
      [sourceKeyA, rawA],
      [sourceKeyB, rawB],
    ]);
    installBrowserStorage(harness);
    setSearch('?output_project=ProjectA&show_dbnum=1001');

    const mod = await import('../composables/useToolStore');
    expect(JSON.parse(harness.values.get(archiveKeyA)!)).toMatchObject({
      sourceVersion: 5,
      scope: scopeA,
      records: [{ id: 'a' }],
    });
    expect(harness.values.has(archiveKeyB)).toBe(false);

    setSearch('?output_project=ProjectB&show_dbnum=2002');
    mod.refreshToolStorePersistedScope({ force: true });

    expect(JSON.parse(harness.values.get(archiveKeyB)!)).toMatchObject({
      sourceVersion: 4,
      scope: scopeB,
      records: [{ id: 'b' }],
    });
    expect(harness.values.get(sourceKeyA)).toBe(rawA);
    expect(harness.values.get(sourceKeyB)).toBe(rawB);
  });

  it('archives V4/V5 imports under unique injected timestamps and imports only non-dimension data', async () => {
    const scope = 'project=ImportProject|db=303';
    const importPrefix = `plant3d-web-dimensions-v5-import:${scope}`;
    const harness = createBrowserStorage();
    installBrowserStorage(harness);
    setSearch('?output_project=ImportProject&show_dbnum=303');

    const mod = await import('../composables/useToolStore');
    const store = mod.useToolStore();

    store.importJSON(JSON.stringify({
      version: 5,
      measurements: [],
      annotations: [{
        id: 'from-v5',
        entityId: 'entity-v5',
        worldPos: [1, 2, 3],
        visible: true,
        glyph: 'V5',
        title: 'V5 annotation',
        description: '',
        createdAt: 5,
      }],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [{ id: 'imported-v5', custom: 'opaque-v5' }],
      xeokitDistanceMeasurements: [],
      xeokitAngleMeasurements: [],
      xeokitElevationPointMeasurements: [],
      xeokitElevationDeltaMeasurements: [],
    }), { now: () => 500 });
    store.importJSON(JSON.stringify({
      version: 4,
      measurements: [],
      annotations: [{
        id: 'from-v4',
        entityId: 'entity-v4',
        worldPos: [4, 5, 6],
        visible: true,
        glyph: 'V4',
        title: 'V4 annotation',
        description: '',
        createdAt: 4,
      }],
      obbAnnotations: [],
      cloudAnnotations: [],
      rectAnnotations: [],
      dimensions: [{ id: 'imported-v4', custom: 'opaque-v4' }],
    }), { now: () => 500 });

    expect(JSON.parse(harness.values.get(`${importPrefix}:500`)!)).toEqual({
      version: 1,
      sourceVersion: 5,
      scope,
      archivedAt: 500,
      records: [{ id: 'imported-v5', custom: 'opaque-v5' }],
    });
    expect(JSON.parse(harness.values.get(`${importPrefix}:501`)!)).toEqual({
      version: 1,
      sourceVersion: 4,
      scope,
      archivedAt: 501,
      records: [{ id: 'imported-v4', custom: 'opaque-v4' }],
    });
    expect(store).not.toHaveProperty('dimensions');
    expect(store.annotations.value.map((record) => record.id)).toEqual(['from-v4']);
  });
});
