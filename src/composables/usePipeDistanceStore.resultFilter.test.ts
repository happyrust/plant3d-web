import { beforeEach, describe, expect, it } from 'vitest';

import {
  usePipeDistanceStore,
  type PipeDistanceResult,
} from './usePipeDistanceStore';

import { useClearanceStore } from '@/clearance/stores/useClearanceStore';

/**
 * #64：结果真相是 ClearanceStore 里的 ClearanceRecord——本文件的断言按记录语义写：
 * `id` 由 `clearanceRecordId(inputs)` 决定（不在夹具里编），距离是快照 design 米的毫米值。
 */
function makeResult(distance: number, a: string, b: string, kind: PipeDistanceResult['measurementKind'] = 'surface'): PipeDistanceResult {
  return {
    id: `${a}__${b}`,
    distance,
    measurementKind: kind,
    pipeA: a,
    pipeB: b,
    start: [0, 0, 0],
    end: [0, 0, 0],
    designPoints: { start: [0, 0, 0], end: [distance, 0, 0] },
  };
}

function seed(store: ReturnType<typeof usePipeDistanceStore>): string[] {
  const created = store.commitPipeDistanceResults([
    makeResult(50, '24381_1001', '24381_1002'),
    makeResult(150, '24381_1001', '24381_1003'),
    makeResult(350, '24381_1002', '24381_1003'),
    makeResult(600, '24381_1003', '24381_1004'),
  ]);
  return created.map(record => record.id);
}

describe('usePipeDistanceStore · 结果筛选与单条切换', () => {
  beforeEach(() => {
    useClearanceStore().clearRecords();
    const store = usePipeDistanceStore();
    store.clearResults();
    store.clearBranRefnos();
    seed(store);
  });

  function ids(store: ReturnType<typeof usePipeDistanceStore>): string[] {
    return store.pipeResults.value.map(record => record.id);
  }

  it('初始 visibleResults = 全部记录', () => {
    const store = usePipeDistanceStore();
    expect(store.pipeResults.value).toHaveLength(4);
    expect(store.visibleResults.value.map(record => record.id)).toEqual(ids(store));
  });

  it('toggleResultHidden 把 id 加入隐藏集且从 visibleResults 中剔除（语义与 ClearanceStore.toggleHidden 同一条）', () => {
    const store = usePipeDistanceStore();
    const [, second] = ids(store);
    store.toggleResultHidden(second!);
    expect(store.hiddenResultIds.value.has(second!)).toBe(true);
    expect(store.visibleResults.value.map(record => record.id)).toEqual(ids(store).filter(id => id !== second));

    store.toggleResultHidden(second!);
    expect(store.hiddenResultIds.value.has(second!)).toBe(false);
    expect(store.visibleResults.value).toHaveLength(4);
  });

  it('setResultMinDistance 过滤掉小于阈值的记录（距离取快照 design 米换算的 mm）', () => {
    const store = usePipeDistanceStore();
    store.setResultMinDistance(200);
    expect(store.resultMinDistance.value).toBe(200);
    const distances = store.visibleResults.value.map(record => Math.round(record.snapshot!.distanceM * 1000));
    expect(distances).toEqual([350, 600]);
  });

  it('setResultMinDistance 传入 0 / 非法 → 清空阈值', () => {
    const store = usePipeDistanceStore();
    store.setResultMinDistance(200);
    expect(store.resultMinDistance.value).toBe(200);

    store.setResultMinDistance(0);
    expect(store.resultMinDistance.value).toBeNull();

    store.setResultMinDistance(-1);
    expect(store.resultMinDistance.value).toBeNull();

    store.setResultMinDistance(Number.NaN);
    expect(store.resultMinDistance.value).toBeNull();

    store.setResultMinDistance(null);
    expect(store.resultMinDistance.value).toBeNull();
  });

  it('阈值过滤 + 单条隐藏 叠加 ; 两个条件都满足才显示', () => {
    const store = usePipeDistanceStore();
    const [, , third] = ids(store);
    store.setResultMinDistance(100);
    store.toggleResultHidden(third!);
    const distances = store.visibleResults.value.map(record => Math.round(record.snapshot!.distanceM * 1000));
    expect(distances).toEqual([150, 600]);
  });

  it('resetResultFilters 一次性清空 hidden + minDistance 但保留记录', () => {
    const store = usePipeDistanceStore();
    const [first] = ids(store);
    store.toggleResultHidden(first!);
    store.setResultMinDistance(300);
    expect(store.visibleResults.value).toHaveLength(2);

    store.resetResultFilters();

    expect(store.hiddenResultIds.value.size).toBe(0);
    expect(store.resultMinDistance.value).toBeNull();
    expect(store.pipeResults.value).toHaveLength(4);
    expect(store.visibleResults.value).toHaveLength(4);
  });

  it('clearResults 清掉本域全部记录 + hidden + minDistance', () => {
    const store = usePipeDistanceStore();
    const [, second] = ids(store);
    store.toggleResultHidden(second!);
    store.setResultMinDistance(150);
    store.clearResults();
    expect(store.pipeResults.value).toHaveLength(0);
    expect(store.visibleResults.value).toHaveLength(0);
    expect(store.hiddenResultIds.value.size).toBe(0);
    expect(store.resultMinDistance.value).toBeNull();
  });

  it('新快照只存抽屉设置；旧快照的 legacy 结果迁成 stale 记录进 ClearanceStore', () => {
    const clearance = useClearanceStore();
    const store = usePipeDistanceStore();
    const designPoints = { start: [1000, 2000, 3000], end: [1100, 2000, 3000] } as PipeDistanceResult['designPoints'];
    const legacy = { ...makeResult(100, '24381_9001', '24381_9002'), designPoints, measurementKind: 'surface' as const };
    const snapshot = store.captureSnapshot();
    // 新抓的快照不再携带结果真相（在 component 段）
    expect(snapshot.results).toEqual([]);

    // 旧云快照：results 段还是 legacy 形状 → 恢复时迁成记录
    const apply = store.prepareSnapshotRestore({
      ...snapshot,
      results: [legacy],
      hiddenIds: [legacy.id],
      activeIndex: 0,
    });
    apply();
    const migrated = clearance.records.value.find(record => record.inputs.sourceRefno === '24381_9001');
    expect(migrated).toBeTruthy();
    expect(migrated?.status).toBe('stale');
    expect(migrated?.snapshot?.sourcePoint).toEqual([1, 2, 3]);
    expect(clearance.hiddenIds.value.has(migrated!.id)).toBe(true);
    expect(clearance.activeId.value).toBe(migrated!.id);

    // 形状坏了依旧拒收（不改基线行为）：缺 designPoints 的 legacy 结果直接抛
    expect(() => store.prepareSnapshotRestore({ ...snapshot, results: [{ ...legacy, designPoints: null }] })).toThrow();
  });
});
