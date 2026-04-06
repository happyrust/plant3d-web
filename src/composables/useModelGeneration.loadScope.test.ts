import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const e3dGetVisibleInstsMock = vi.fn();
const e3dGetSubtreeRefnosMock = vi.fn();
const pdmsGetTypeInfoMock = vi.fn();

vi.mock('@/api/genModelE3dApi', () => ({
  e3dGetVisibleInsts: e3dGetVisibleInstsMock,
  e3dGetSubtreeRefnos: e3dGetSubtreeRefnosMock,
}));

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetTypeInfo: pdmsGetTypeInfoMock,
}));

describe('queryLoadScopeRefnos', () => {
  beforeEach(() => {
    vi.resetModules();
    e3dGetVisibleInstsMock.mockReset();
    e3dGetSubtreeRefnosMock.mockReset();
    pdmsGetTypeInfoMock.mockReset();
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

describe('resolveActualModelLoadScope', () => {
  beforeEach(() => {
    vi.resetModules();
    pdmsGetTypeInfoMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('非 BRAN/HANG root 时，保持 componentRefnos 不变', async () => {
    pdmsGetTypeInfoMock.mockResolvedValue({
      success: true,
      refno: '24381_145035',
      noun: 'VALV',
      owner_noun: 'BRAN',
      owner_refno: '24381_145018',
    });

    const { resolveActualModelLoadScope } = await import('@/composables/useModelGeneration');
    const result = await resolveActualModelLoadScope('24381_145035', ['24381_145035']);

    expect(result).toEqual({
      componentRefnos: ['24381_145035'],
      actualLoadRefnos: ['24381_145035'],
      rootNoun: 'VALV',
      branHangRootInjected: false,
      typeInfoError: null,
    });
  });

  it('BRAN root 时，将 root 注入实际加载范围', async () => {
    pdmsGetTypeInfoMock.mockResolvedValue({
      success: true,
      refno: '24381_145018',
      noun: 'BRAN',
      owner_noun: 'PIPE',
      owner_refno: '24381_144975',
    });

    const { resolveActualModelLoadScope } = await import('@/composables/useModelGeneration');
    const result = await resolveActualModelLoadScope('24381_145018', ['24381_145019', '24381_145020']);

    expect(result).toEqual({
      componentRefnos: ['24381_145019', '24381_145020'],
      actualLoadRefnos: ['24381_145018', '24381_145019', '24381_145020'],
      rootNoun: 'BRAN',
      branHangRootInjected: true,
      typeInfoError: null,
    });
  });

  it('HANG root 时，也将 root 注入实际加载范围', async () => {
    pdmsGetTypeInfoMock.mockResolvedValue({
      success: true,
      refno: '24381_245018',
      noun: 'HANG',
      owner_noun: 'STRU',
      owner_refno: '24381_244975',
    });

    const { resolveActualModelLoadScope } = await import('@/composables/useModelGeneration');
    const result = await resolveActualModelLoadScope('24381_245018', ['24381_245019']);

    expect(result).toEqual({
      componentRefnos: ['24381_245019'],
      actualLoadRefnos: ['24381_245018', '24381_245019'],
      rootNoun: 'HANG',
      branHangRootInjected: true,
      typeInfoError: null,
    });
  });

  it('pdmsGetTypeInfo 失败时，保守回退到旧行为', async () => {
    pdmsGetTypeInfoMock.mockRejectedValue(new Error('network down'));

    const { resolveActualModelLoadScope } = await import('@/composables/useModelGeneration');
    const result = await resolveActualModelLoadScope('24381_145018', ['24381_145019', '24381_145020']);

    expect(result).toEqual({
      componentRefnos: ['24381_145019', '24381_145020'],
      actualLoadRefnos: ['24381_145019', '24381_145020'],
      rootNoun: null,
      branHangRootInjected: false,
      typeInfoError: 'network down',
    });
  });
});
