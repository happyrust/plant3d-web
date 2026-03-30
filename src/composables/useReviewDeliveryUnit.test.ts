import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveReviewDeliveryUnitRefno } from './useReviewDeliveryUnit';

const mocks = vi.hoisted(() => ({
  pdmsGetTypeInfo: vi.fn(),
  e3dGetAncestors: vi.fn(),
  e3dGetSubtreeRefnos: vi.fn(),
}));

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetTypeInfo: mocks.pdmsGetTypeInfo,
}));

vi.mock('@/api/genModelE3dApi', () => ({
  e3dGetAncestors: mocks.e3dGetAncestors,
  e3dGetSubtreeRefnos: mocks.e3dGetSubtreeRefnos,
}));

describe('resolveReviewDeliveryUnitRefno', () => {
  beforeEach(() => {
    mocks.pdmsGetTypeInfo.mockReset();
    mocks.e3dGetAncestors.mockReset();
    mocks.e3dGetSubtreeRefnos.mockReset();
  });

  it('直接返回最小交付单元 refno', async () => {
    mocks.pdmsGetTypeInfo.mockResolvedValue({
      success: true,
      refno: '24381_145018',
      noun: 'BRAN',
      owner_noun: 'PIPE',
      owner_refno: null,
    });

    await expect(resolveReviewDeliveryUnitRefno('24381/145018')).resolves.toBe('24381_145018');
  });

  it('优先向上归并到 owner 最小交付单元', async () => {
    mocks.pdmsGetTypeInfo.mockResolvedValue({
      success: true,
      refno: '24381_145999',
      noun: 'ELBO',
      owner_noun: 'BRAN',
      owner_refno: '24381_145018',
    });

    await expect(resolveReviewDeliveryUnitRefno('24381_145999')).resolves.toBe('24381_145018');
  });

  it('owner 信息不足时继续向上查祖先', async () => {
    mocks.pdmsGetTypeInfo.mockImplementation(async (refno: string) => ({
      success: true,
      refno,
      noun: refno === '24381_145018' ? 'BRAN' : 'ELBO',
      owner_noun: refno === '24381_145018' ? 'PIPE' : 'PIPE',
      owner_refno: null,
    }));
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000', '24381_145018'],
    });

    await expect(resolveReviewDeliveryUnitRefno('24381_145999')).resolves.toBe('24381_145018');
  });

  it('向下找到唯一最小交付单元时返回该节点', async () => {
    mocks.pdmsGetTypeInfo.mockImplementation(async (refno: string) => ({
      success: true,
      refno,
      noun: refno === '24381_145018' ? 'BRAN' : 'PIPE',
      owner_noun: 'ZONE',
      owner_refno: '24381_100000',
    }));
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000'],
    });
    mocks.e3dGetSubtreeRefnos.mockResolvedValue({
      success: true,
      refnos: ['24381_140000', '24381_145018'],
      truncated: false,
    });

    await expect(resolveReviewDeliveryUnitRefno('24381_140000')).resolves.toBe('24381_145018');
  });

  it('向下找到多个最小交付单元时报错', async () => {
    mocks.pdmsGetTypeInfo.mockImplementation(async (refno: string) => ({
      success: true,
      refno,
      noun: refno === '24381_145018' || refno === '24381_145019' ? 'BRAN' : 'PIPE',
      owner_noun: 'ZONE',
      owner_refno: '24381_100000',
    }));
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000'],
    });
    mocks.e3dGetSubtreeRefnos.mockResolvedValue({
      success: true,
      refnos: ['24381_145018', '24381_145019'],
      truncated: false,
    });

    await expect(resolveReviewDeliveryUnitRefno('24381_140000')).rejects.toThrow('跨多个最小交付单元');
  });

  it('上下都无法归并时使用 fallback 信息后仍报错', async () => {
    mocks.pdmsGetTypeInfo.mockRejectedValue(new Error('network'));
    mocks.e3dGetAncestors.mockResolvedValue({
      success: true,
      refnos: ['24381_100000'],
    });
    mocks.e3dGetSubtreeRefnos.mockResolvedValue({
      success: true,
      refnos: ['24381_140000'],
      truncated: false,
    });

    await expect(resolveReviewDeliveryUnitRefno('24381_140000', {
      getFallbackTypeInfo: (refno) => ({
        noun: refno === '24381_140000' ? 'PIPE' : 'ZONE',
        owner_noun: 'ZONE',
        owner_refno: '24381_100000',
      }),
    })).rejects.toThrow('无法归并到最小交付单元');
  });
});
