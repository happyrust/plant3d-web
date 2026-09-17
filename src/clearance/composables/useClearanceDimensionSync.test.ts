import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { useClearanceDimensionSync, type ClearanceDimensionSink } from './useClearanceDimensionSync';

import { createClearanceService } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import {
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
  intersectingResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';

function sink() {
  const replaceExternalSource = vi.fn<ClearanceDimensionSink['replaceExternalSource']>();
  return { system: { replaceExternalSource } as ClearanceDimensionSink, replaceExternalSource };
}

function service(responses: unknown[]) {
  const queue = [...responses];
  return createClearanceService({
    fetchSurfaceClearance: vi.fn(async () => queue.shift() as never),
    now: () => new Date('2026-09-17T12:00:00.000Z'),
  });
}

describe('useClearanceDimensionSync', () => {
  beforeEach(() => {
    useClearanceStore().clearRecords();
    useClearanceStore().showAnnotations.value = true;
  });

  it('pushes visible records into the clearance external source and clears when the toggle is off', async () => {
    const store = useClearanceStore();
    const { system, replaceExternalSource } = sink();
    const systemRef = ref<ClearanceDimensionSink | null>(null);
    const requestRender = vi.fn();
    useClearanceDimensionSync(systemRef, store, requestRender);

    // 尺寸系统还没就绪：什么都不推。
    expect(replaceExternalSource).not.toHaveBeenCalled();
    systemRef.value = system;
    await nextTick();
    expect(replaceExternalSource).toHaveBeenLastCalledWith('clearance', []);

    await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: service([elboToCurvedWallResponse()]) });
    await nextTick();
    const [, records] = replaceExternalSource.mock.calls.at(-1)!;
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('clearance:clearance:24384_22582:17496_105912');
    expect(records[0]?.source).toBe('clearance');
    expect(requestRender).toHaveBeenCalled();

    store.showAnnotations.value = false;
    await nextTick();
    expect(replaceExternalSource).toHaveBeenLastCalledWith('clearance', []);
    store.showAnnotations.value = true;
    await nextTick();
    expect(replaceExternalSource.mock.calls.at(-1)![1]).toHaveLength(1);
  });

  it('hidden records and intersecting records are not drawn; stop() detaches the watcher', async () => {
    const store = useClearanceStore();
    const { system, replaceExternalSource } = sink();
    const systemRef = ref<ClearanceDimensionSink | null>(system);
    const sync = useClearanceDimensionSync(systemRef, store);
    const svc = service([boxToStraightWallResponse(), intersectingResponse()]);
    const straight = await store.compute({ sourceRefno: '24384_24830', targetRefno: '17496_105812' }, { service: svc });
    await store.compute({ sourceRefno: '24384_22582', targetRefno: '17496_105912' }, { service: svc });
    await nextTick();
    expect(replaceExternalSource.mock.calls.at(-1)![1].map(record => record.id)).toEqual([
      'clearance:clearance:24384_24830:17496_105812',
    ]);

    store.toggleHidden(straight!.id);
    await nextTick();
    expect(replaceExternalSource.mock.calls.at(-1)![1]).toEqual([]);

    sync.stop();
    const calls = replaceExternalSource.mock.calls.length;
    store.toggleHidden(straight!.id);
    await nextTick();
    expect(replaceExternalSource.mock.calls.length).toBe(calls);
    sync.clear();
    expect(replaceExternalSource).toHaveBeenLastCalledWith('clearance', []);
  });
});
