import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetMeasurementSnapNounCacheForTest,
  formatMeasurementSnapLabel,
  getCachedNounForRefno,
  requestNounForRefno,
} from './measurementSnapLabel';

const treeNode = vi.hoisted(() => vi.fn(async (refno: string) => {
  if (refno === '24381_145018') {
    return { success: true, node: { refno, name: '/100-A', noun: 'VALVE' } };
  }
  if (refno === 'boom') throw new Error('network');
  return { success: true, node: null };
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({ tree: { node: treeNode } }),
}));

describe('formatMeasurementSnapLabel', () => {
  it('noun + label 组合成 E3D Snap 目标名', () => {
    expect(formatMeasurementSnapLabel({ label: '100-A', noun: 'VALVE' }))
      .toBe('VALVE 100-A');
  });

  it('无 noun 时回落点源标签，再回落 formatPdmsRef', () => {
    expect(formatMeasurementSnapLabel({ label: 'P-Point #3', refno: '24381_145018' }))
      .toBe('P-Point #3');
    expect(formatMeasurementSnapLabel({ refno: '24381_145018' }))
      .toBe('24381/145018');
  });

  it('只有 noun 时带 refno 展示', () => {
    expect(formatMeasurementSnapLabel({ noun: 'VALVE', refno: '24381_145018' }))
      .toBe('VALVE 24381/145018');
    expect(formatMeasurementSnapLabel({ noun: 'VALVE' })).toBe('VALVE');
  });

  it('全部缺失返回空串', () => {
    expect(formatMeasurementSnapLabel({})).toBe('');
  });
});

describe('noun 缓存', () => {
  beforeEach(() => {
    __resetMeasurementSnapNounCacheForTest();
  });

  it('异步查询后可同步读取 noun；失败缓存 null 不再重复请求', async () => {
    expect(getCachedNounForRefno('24381_145018')).toBeNull();
    requestNounForRefno('24381_145018');
    requestNounForRefno('boom');
    await vi.waitFor(() => {
      expect(getCachedNounForRefno('24381_145018')).toBe('VALVE');
    });
    expect(getCachedNounForRefno('boom')).toBeNull();

    const callsBefore = treeNode.mock.calls.length;
    requestNounForRefno('24381_145018');
    requestNounForRefno('boom');
    expect(treeNode.mock.calls.length).toBe(callsBefore);
  });
});
