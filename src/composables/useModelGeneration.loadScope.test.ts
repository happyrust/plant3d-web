import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const e3dGetVisibleInstsMock = vi.fn();
const e3dGetSubtreeRefnosMock = vi.fn();

vi.mock('@/api/genModelE3dApi', () => ({
  e3dGetVisibleInsts: e3dGetVisibleInstsMock,
  e3dGetSubtreeRefnos: e3dGetSubtreeRefnosMock,
}));

describe('queryLoadScopeRefnos', () => {
  beforeEach(() => {
    vi.resetModules();
    e3dGetVisibleInstsMock.mockReset();
    e3dGetSubtreeRefnosMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('优先使用 visible-insts，成功时不再回退 subtree-refnos', async () => {
    e3dGetVisibleInstsMock.mockResolvedValue({ success: true, refnos: ['24381_145019', '24381_145020'] });

    const { queryLoadScopeRefnos } = await import('@/composables/useModelGeneration');
    const result = await queryLoadScopeRefnos('24381_145018');

    expect(result).toEqual({
      refnos: ['24381_145019', '24381_145020'],
      source: 'visible-insts',
      truncated: false,
    });
    expect(e3dGetVisibleInstsMock).toHaveBeenCalledWith('24381_145018');
    expect(e3dGetSubtreeRefnosMock).not.toHaveBeenCalled();
  });

  it('visible-insts 成功但为空时，直接返回空，不回退 subtree-refnos', async () => {
    e3dGetVisibleInstsMock.mockResolvedValue({ success: true, refnos: [] });

    const { queryLoadScopeRefnos } = await import('@/composables/useModelGeneration');
    const result = await queryLoadScopeRefnos('24381_145018');

    expect(result).toEqual({
      refnos: [],
      source: 'visible-insts',
      truncated: false,
    });
    expect(e3dGetSubtreeRefnosMock).not.toHaveBeenCalled();
  });

  it('visible-insts 失败时，回退 subtree-refnos', async () => {
    e3dGetVisibleInstsMock.mockResolvedValue({ success: false, error_message: 'visible api failed', refnos: [] });
    e3dGetSubtreeRefnosMock.mockResolvedValue({
      success: true,
      refnos: ['24381_145018', '24381_145019'],
      truncated: true,
    });

    const { queryLoadScopeRefnos } = await import('@/composables/useModelGeneration');
    const result = await queryLoadScopeRefnos('24381_145018');

    expect(result).toEqual({
      refnos: ['24381_145018', '24381_145019'],
      source: 'subtree-refnos',
      truncated: true,
    });
    expect(e3dGetVisibleInstsMock).toHaveBeenCalledWith('24381_145018');
    expect(e3dGetSubtreeRefnosMock).toHaveBeenCalledWith('24381_145018', { includeSelf: true, limit: 200_000 });
  });
});
