import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClearanceStore } from './useClearanceStore';

import type { SurfaceClearanceResponse } from '@/api/genModelV1Api';

import { createClearanceService, type ClearanceService } from '@/clearance/services/clearanceService';
import {
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';

const AT = new Date('2026-09-17T12:00:00.000Z');

function serviceReturning(responses: SurfaceClearanceResponse[], clock = { now: AT }): ClearanceService {
  const queue = [...responses];
  return createClearanceService({
    fetchSurfaceClearance: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('no more fixtures');
      return next;
    }),
    now: () => clock.now,
  });
}

describe('useClearanceStore', () => {
  beforeEach(() => {
    useClearanceStore().detachPersistence();
    useClearanceStore().clearRecords();
  });
  afterEach(() => { useClearanceStore().detachPersistence(); });

  function memoryStorage() {
    const data = new Map<string, string>();
    return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  }

  it('persists result snapshots and visibility per scope, restores as stale, and isolates projects/tasks/versions', async () => {
    const storage = memoryStorage();
    const store = useClearanceStore();
    store.bindPersistence('project-A/task-A/node-SJ/626-630', storage);
    const record = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: serviceReturning([elboToCurvedWallResponse()]) });
    store.setHidden(record!.id, true);
    store.showAnnotations.value = false;
    expect(store.persistenceLabel.value).toContain('本机已保存');
    expect(JSON.parse(storage.data.get('plant3d-clearance-v1:project-A/task-A/node-SJ/626-630')!).records[0].modelVersion).toEqual(record!.modelVersion);
    store.bindPersistence('project-B/task-A/node-SJ/626-630', storage);
    expect(store.records.value).toEqual([]);
    store.bindPersistence('project-A/task-A/node-SJ/626-630', storage);
    expect(store.records.value).toHaveLength(1);
    expect(store.records.value[0]?.status).toBe('stale');
    expect(store.records.value[0]?.snapshot).toEqual(record!.snapshot);
    expect(store.activeId.value).toBe(record!.id);
    expect(store.hiddenIds.value.has(record!.id)).toBe(true);
    expect(store.showAnnotations.value).toBe(false);
    expect(store.persistenceLabel.value).toContain('请重算');
    store.bindPersistence('project-A/task-A/node-SJ/627-631', storage);
    expect(store.records.value).toEqual([]);
  });

  it('preflights a detached cloud snapshot without clearing a draft or accepting later response changes', async () => {
    const store = useClearanceStore();
    const record = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: serviceReturning([elboToCurvedWallResponse()]) });
    const snapshot = store.captureSnapshot();
    expect(() => store.prepareSnapshotRestore({ ...snapshot, records: [{ ...snapshot.records[0], id: 'wrong' }] })).toThrow();
    expect(store.records.value[0]).toBe(record);
    const apply = store.prepareSnapshotRestore(snapshot);
    snapshot.records.length = 0;
    expect(store.records.value[0]?.status).toBe('current');
    apply();
    expect(store.records.value).toHaveLength(1);
    expect(store.records.value[0]?.status).toBe('stale');
  });

  it('keeps corrupt persisted data intact and does not label rejected data as saved', async () => {
    const storage = memoryStorage();
    const scope = 'corrupt-test';
    storage.data.set(`plant3d-clearance-v1:${scope}`, '{not json');
    const store = useClearanceStore();
    store.bindPersistence(scope, storage);
    expect(store.persistenceError.value).not.toBeNull();
    await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: serviceReturning([elboToCurvedWallResponse()]) });
    expect(storage.data.get(`plant3d-clearance-v1:${scope}`)).toBe('{not json');
    expect(store.persistenceLabel.value).toContain('未覆盖');
  });

  it('retains unsaved records across scope switches when local storage is full, then allows retry', async () => {
    const storage = memoryStorage();
    const store = useClearanceStore();
    const blocked = { getItem: storage.getItem, setItem: () => { throw new Error('quota'); } };
    store.bindPersistence('quota-test', blocked);
    const record = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: serviceReturning([elboToCurvedWallResponse()]) });
    expect(store.persistenceError.value).toBe('quota');
    expect(store.persistenceLabel.value).toContain('保存失败');
    store.bindPersistence('quota-other', storage);
    expect(store.records.value).toEqual([]);
    store.bindPersistence('quota-test', storage);
    expect(store.records.value[0]?.snapshot).toEqual(record!.snapshot);
    expect(store.persistRecords()).toBe(true);
    expect(store.persistenceError.value).toBeNull();
  });

  it('rejects a persisted envelope copied from another context', () => {
    const storage = memoryStorage();
    storage.data.set('plant3d-clearance-v1:context-B', JSON.stringify({ version: 1, scope: 'context-A', records: [], hiddenIds: [], activeId: null, showAnnotations: true }));
    const store = useClearanceStore();
    store.bindPersistence('context-B', storage);
    expect(store.persistenceError.value).toContain('上下文不匹配');
    expect(store.persistRecords()).toBe(false);
  });

  it('discards an in-flight response after changing scope or clearing records', async () => {
    const storage = memoryStorage();
    const store = useClearanceStore();
    store.bindPersistence('slow-A', storage);
    let resolve!: (value: SurfaceClearanceResponse) => void;
    const service = createClearanceService({ fetchSurfaceClearance: () => new Promise(done => { resolve = done; }) });
    const pending = store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    store.bindPersistence('slow-B', storage);
    resolve(elboToCurvedWallResponse());
    expect(await pending).toBeNull();
    expect(store.records.value).toEqual([]);
    const second = store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    store.clearRecords();
    resolve(elboToCurvedWallResponse());
    expect(await second).toBeNull();
    expect(store.records.value).toEqual([]);
  });

  it('blocks current-mesh calculations in historical comparison contexts', async () => {
    const store = useClearanceStore();
    const compute = vi.fn(serviceReturning([elboToCurvedWallResponse()]).compute);
    const service = { compute, computeComponentToWall: compute };
    store.bindPersistence('historical-626-630', memoryStorage(), false);
    expect(await store.compute({ sourceRefno: '1_2', targetRefno: '1_3' }, { service })).toBeNull();
    expect(compute).not.toHaveBeenCalled();
    expect(store.lastError.value).toContain('历史版本');
  });

  it('keeps the latest same-pair response and reports busy until all current-context requests settle', async () => {
    const store = useClearanceStore();
    const resolvers: ((response: SurfaceClearanceResponse) => void)[] = [];
    const service = createClearanceService({ fetchSurfaceClearance: () => new Promise(done => { resolvers.push(done); }) });
    const input = { sourceRefno: '24384_22582', targetRefno: '17496_105912' };
    const older = store.compute(input, { service });
    const newer = store.compute(input, { service });
    const response = elboToCurvedWallResponse();
    resolvers[1]!({ ...response, result: { ...response.result!, distance_mm: 70 } });
    expect((await newer)?.snapshot?.distanceM).toBe(0.07);
    expect(store.isComputing.value).toBe(true);
    resolvers[0]!(response);
    expect(await older).toBeNull();
    expect(store.records.value[0]?.snapshot?.distanceM).toBe(0.07);
    expect(store.isComputing.value).toBe(false);
  });

  it('invalidates a pending calculation as soon as historical mode starts, before its detail is available', async () => {
    const store = useClearanceStore();
    const storage = memoryStorage();
    store.bindPersistence('same-scope-loading', storage);
    let resolve!: (value: SurfaceClearanceResponse) => void;
    const service = createClearanceService({ fetchSurfaceClearance: () => new Promise(done => { resolve = done; }) });
    const pending = store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    store.bindPersistence('same-scope-loading', storage, false);
    resolve(elboToCurvedWallResponse());
    expect(await pending).toBeNull();
    expect(store.records.value).toEqual([]);
  });

  it('compute upserts one record per input pair, activates it and unhides it', async () => {
    const store = useClearanceStore();
    const service = serviceReturning([elboToCurvedWallResponse(), boxToStraightWallResponse()]);

    const first = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    expect(first?.id).toBe('clearance:24384_22582:17496_105912');
    expect(store.records.value).toHaveLength(1);
    expect(store.activeId.value).toBe(first?.id);
    expect(store.isComputing.value).toBe(false);
    expect(store.lastError.value).toBeNull();

    store.toggleHidden(first!.id);
    expect(store.visibleRecords.value).toHaveLength(0);

    const second = await store.compute({ sourceRefno: '24384_24830', targetRefno: '17496_105812' }, { service, activate: false });
    expect(store.records.value).toHaveLength(2);
    expect(store.activeId.value).toBe(first?.id);
    expect(store.visibleRecords.value.map(record => record.id)).toEqual([second!.id]);
    expect(store.activeRecord.value?.id).toBe(first?.id);
  });

  it('recompute overwrites the snapshot but keeps createdAt and current status', async () => {
    const store = useClearanceStore();
    const clock = { now: AT };
    const service = serviceReturning([
      elboToCurvedWallResponse(),
      elboToCurvedWallResponse({ result: { ...elboToCurvedWallResponse().result!, distance_mm: 70 } }),
    ], clock);
    const first = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    store.markStale([first!.id]);
    expect(store.findRecord(first!.id)?.status).toBe('stale');

    clock.now = new Date('2026-09-17T13:00:00.000Z');
    const again = await store.recompute(first!.id, { service });
    expect(store.records.value).toHaveLength(1);
    expect(again?.snapshot?.distanceM).toBeCloseTo(0.07, 9);
    expect(again?.status).toBe('current');
    expect(again?.createdAt).toBe(AT.toISOString());
    expect(again?.computedAt).toBe(clock.now.toISOString());
  });

  it('a failed compute keeps the previous snapshot, marks it failed and records the error', async () => {
    const store = useClearanceStore();
    const ok = serviceReturning([elboToCurvedWallResponse()]);
    const first = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: ok });

    const failing = createClearanceService({
      fetchSurfaceClearance: vi.fn(async () => {
        throw new Error('404 not_found: no_model_mesh');
      }),
    });
    const result = await store.recompute(first!.id, { service: failing });
    expect(result).toBeNull();
    expect(store.lastError.value).toMatch(/no_model_mesh/);
    const record = store.findRecord(first!.id);
    expect(record?.status).toBe('failed');
    expect(record?.snapshot?.distanceM).toBeCloseTo(0.06443, 9);

    const fresh = await store.compute({ sourceRefno: '1_2', targetRefno: '1_3' }, { service: failing });
    expect(fresh).toBeNull();
    expect(store.records.value).toHaveLength(1);
  });

  it('markStaleByModelSesno only touches records whose known side changed', async () => {
    const store = useClearanceStore();
    const service = serviceReturning([elboToCurvedWallResponse(), boxToStraightWallResponse()]);
    const a = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    const b = await store.compute({ sourceRefno: '24384_24830', targetRefno: '17496_105812' }, { service });

    expect(store.markStaleByModelSesno({ '17496_105912': 729 })).toEqual([]);
    expect(store.markStaleByModelSesno({ '17496_105912': 730, '24384_24830': 586 })).toEqual([a!.id]);
    expect(store.findRecord(a!.id)?.status).toBe('stale');
    expect(store.findRecord(b!.id)?.status).toBe('current');
    expect(store.markStaleByModelSesno({ '17496_105912': 731 })).toEqual([]);
  });

  it('removeRecord drops active / hidden bookkeeping and clearRecords resets everything', async () => {
    const store = useClearanceStore();
    const service = serviceReturning([elboToCurvedWallResponse()]);
    const record = await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service });
    store.setHidden(record!.id, true);
    store.removeRecord(record!.id);
    expect(store.records.value).toHaveLength(0);
    expect(store.activeId.value).toBeNull();
    expect(store.hiddenIds.value.size).toBe(0);
    store.setActive('missing');
    expect(store.activeId.value).toBeNull();
  });
});
