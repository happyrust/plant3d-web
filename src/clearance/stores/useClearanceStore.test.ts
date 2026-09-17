import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    useClearanceStore().clearRecords();
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
