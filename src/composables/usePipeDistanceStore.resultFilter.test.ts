import { beforeEach, describe, expect, it } from 'vitest';

import {
  usePipeDistanceStore,
  type PipeDistanceResult,
} from './usePipeDistanceStore';

function makeResult(id: string, distance: number): PipeDistanceResult {
  return {
    id,
    distance,
    pipeA: 'BRAN/A',
    pipeB: 'BRAN/B',
    start: [0, 0, 0],
    end: [1, 0, 0],
  };
}

describe('usePipeDistanceStore · 结果筛选与单条切换', () => {
  beforeEach(() => {
    const store = usePipeDistanceStore();
    store.clearResults();
    store.results.value = [
      makeResult('r-1', 50),
      makeResult('r-2', 150),
      makeResult('r-3', 350),
      makeResult('r-4', 600),
    ];
  });

  it('初始 visibleResults = 全部 results', () => {
    const store = usePipeDistanceStore();
    expect(store.visibleResults.value.map((r) => r.id)).toEqual([
      'r-1', 'r-2', 'r-3', 'r-4',
    ]);
  });

  it('toggleResultHidden 把 id 加入隐藏集且从 visibleResults 中剔除', () => {
    const store = usePipeDistanceStore();
    store.toggleResultHidden('r-2');
    expect(store.hiddenResultIds.value.has('r-2')).toBe(true);
    expect(store.visibleResults.value.map((r) => r.id)).toEqual([
      'r-1', 'r-3', 'r-4',
    ]);

    store.toggleResultHidden('r-2');
    expect(store.hiddenResultIds.value.has('r-2')).toBe(false);
    expect(store.visibleResults.value).toHaveLength(4);
  });

  it('setResultMinDistance 过滤掉小于阈值的结果', () => {
    const store = usePipeDistanceStore();
    store.setResultMinDistance(200);
    expect(store.resultMinDistance.value).toBe(200);
    expect(store.visibleResults.value.map((r) => r.id)).toEqual(['r-3', 'r-4']);
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
    store.setResultMinDistance(100);
    store.toggleResultHidden('r-3');
    expect(store.visibleResults.value.map((r) => r.id)).toEqual(['r-2', 'r-4']);
  });

  it('resetResultFilters 一次性清空 hidden + minDistance 但保留 results', () => {
    const store = usePipeDistanceStore();
    store.toggleResultHidden('r-1');
    store.setResultMinDistance(300);
    expect(store.visibleResults.value).toHaveLength(2);

    store.resetResultFilters();

    expect(store.hiddenResultIds.value.size).toBe(0);
    expect(store.resultMinDistance.value).toBeNull();
    expect(store.results.value).toHaveLength(4);
    expect(store.visibleResults.value).toHaveLength(4);
  });

  it('clearResults 同时清空 results / hidden / minDistance', () => {
    const store = usePipeDistanceStore();
    store.toggleResultHidden('r-2');
    store.setResultMinDistance(150);
    store.clearResults();
    expect(store.results.value).toHaveLength(0);
    expect(store.visibleResults.value).toHaveLength(0);
    expect(store.hiddenResultIds.value.size).toBe(0);
    expect(store.resultMinDistance.value).toBeNull();
  });
});
