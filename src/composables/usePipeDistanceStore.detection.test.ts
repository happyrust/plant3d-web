import { beforeEach, describe, expect, it } from 'vitest';

import { usePipeDistanceStore } from './usePipeDistanceStore';

describe('usePipeDistanceStore · BRAN 自动净距检测', () => {
  beforeEach(() => {
    const store = usePipeDistanceStore();
    store.clearResults();
    store.clearBranRefnos();
  });

  it('MBD 管段接口移除后应给出不可用提示', async () => {
    const store = usePipeDistanceStore();
    await store.autoDetectBrans(['24381/1001', '24381_1002']);

    expect(store.selectedBranRefnos.value).toEqual(['24381_1001', '24381_1002']);
    expect(store.detectError.value).toContain('MBD 管段数据接口已移除');
    expect(store.results.value).toHaveLength(0);
  });
});
