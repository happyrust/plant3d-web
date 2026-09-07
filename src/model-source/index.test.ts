import { beforeEach, describe, expect, it, vi } from 'vitest';

import { legacyMeshUrl } from './legacy';

import { __resetModelSourceForTests, getModelSource, parseModelSourceKind, resolveModelSourceKind } from './index';

const legacyMocks = vi.hoisted(() => ({
  e3dGetWorldRoot: vi.fn(async () => ({ success: true, node: { refno: '24381_1', name: 'WORL', noun: 'WORL' } })),
  e3dGetNode: vi.fn(async (refno: string) => ({ success: true, node: { refno, name: refno, noun: 'BRAN' } })),
  e3dGetChildren: vi.fn(async (refno: string) => ({ success: true, parent_refno: refno, children: [], truncated: false })),
  e3dGetAncestors: vi.fn(async (refno: string) => ({ success: true, refnos: [refno] })),
  e3dSearch: vi.fn(async () => ({ success: true, items: [] })),
  e3dGetSubtreeRefnos: vi.fn(async (refno: string) => ({ success: true, refnos: [refno], truncated: false })),
  e3dGetVisibleInsts: vi.fn(async (refno: string) => ({ success: true, refno, refnos: [] })),
  pdmsGetUiAttr: vi.fn(async (refno: string) => ({ success: true, refno, attrs: {} })),
  pdmsGetTypeInfo: vi.fn(async (refno: string) => ({ success: true, refno, noun: 'BRAN' })),
  queryInstanceEntriesByRefnos: vi.fn(async () => new Map()),
}));

vi.mock('@/api/genModelE3dApi', () => ({
  e3dGetWorldRoot: legacyMocks.e3dGetWorldRoot,
  e3dGetNode: legacyMocks.e3dGetNode,
  e3dGetChildren: legacyMocks.e3dGetChildren,
  e3dGetAncestors: legacyMocks.e3dGetAncestors,
  e3dSearch: legacyMocks.e3dSearch,
  e3dGetSubtreeRefnos: legacyMocks.e3dGetSubtreeRefnos,
  e3dGetVisibleInsts: legacyMocks.e3dGetVisibleInsts,
}));

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetUiAttr: legacyMocks.pdmsGetUiAttr,
  pdmsGetTypeInfo: legacyMocks.pdmsGetTypeInfo,
}));

vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({
    queryInstanceEntriesByRefnos: legacyMocks.queryInstanceEntriesByRefnos,
  }),
}));

beforeEach(() => {
  __resetModelSourceForTests();
  vi.clearAllMocks();
});

describe('resolveModelSourceKind（?model_source= → VITE_MODEL_SOURCE → legacy）', () => {
  it('默认 legacy：旧链路一个字节都不变', () => {
    expect(resolveModelSourceKind({})).toBe('legacy');
    expect(resolveModelSourceKind({ search: '?show_refno=24381_145018' })).toBe('legacy');
  });

  it('URL 参数压过环境变量', () => {
    expect(resolveModelSourceKind({ search: '?model_source=gen-model-v1', envValue: 'legacy' })).toBe('gen-model-v1');
    expect(resolveModelSourceKind({ search: '?model_source=legacy', envValue: 'gen-model-v1' })).toBe('legacy');
    expect(resolveModelSourceKind({ envValue: 'gen-model-v1' })).toBe('gen-model-v1');
  });

  it('接受几种顺手写法，认不出的值忽略', () => {
    expect(parseModelSourceKind('V1')).toBe('gen-model-v1');
    expect(parseModelSourceKind('gen_model_v1')).toBe('gen-model-v1');
    expect(parseModelSourceKind('parquet')).toBe('legacy');
    expect(parseModelSourceKind('surreal')).toBeNull();
    expect(resolveModelSourceKind({ search: '?model_source=surreal' })).toBe('legacy');
  });
});

describe('legacy 适配器：零逻辑委托', () => {
  it('tree 的每个方法都是对现有 e3d* 函数的一次转发，参数原样', async () => {
    const source = getModelSource('legacy');
    expect(source.kind).toBe('legacy');

    await source.tree.worldRoot();
    await source.tree.node('24381_1');
    await source.tree.children('24381_2', 50);
    await source.tree.ancestors('24381_145018');
    await source.tree.search({ keyword: 'PIPE', nouns: ['ZONE'], limit: 20 });
    await source.tree.subtreeRefnos('24381_2', { includeSelf: true, maxDepth: 3 });
    await source.tree.visibleInsts('24381_145018');

    expect(legacyMocks.e3dGetWorldRoot).toHaveBeenCalledTimes(1);
    expect(legacyMocks.e3dGetNode).toHaveBeenCalledWith('24381_1');
    expect(legacyMocks.e3dGetChildren).toHaveBeenCalledWith('24381_2', 50);
    expect(legacyMocks.e3dGetAncestors).toHaveBeenCalledWith('24381_145018');
    expect(legacyMocks.e3dSearch).toHaveBeenCalledWith({ keyword: 'PIPE', nouns: ['ZONE'], limit: 20 });
    expect(legacyMocks.e3dGetSubtreeRefnos).toHaveBeenCalledWith('24381_2', { includeSelf: true, maxDepth: 3 });
    expect(legacyMocks.e3dGetVisibleInsts).toHaveBeenCalledWith('24381_145018');
  });

  it('records / attributes 同样原样转发', async () => {
    const source = getModelSource('legacy');
    await source.records.instanceEntriesByRefnos(7997, ['24381_145018'], { includeOwnedTubings: false, manifestUrl: '/m.json' });
    await source.attributes.uiAttr('24381_145018');
    await source.attributes.typeInfo('24381_145018');

    expect(legacyMocks.queryInstanceEntriesByRefnos).toHaveBeenCalledWith(
      7997,
      ['24381_145018'],
      { includeOwnedTubings: false, manifestUrl: '/m.json' },
    );
    expect(legacyMocks.pdmsGetUiAttr).toHaveBeenCalledWith('24381_145018');
    expect(legacyMocks.pdmsGetTypeInfo).toHaveBeenCalledWith('24381_145018');
  });

  it('网格 URL 模板与 useDbnoInstancesDtxLoader 现有写法逐字相同', () => {
    expect(legacyMeshUrl('abc123', 'L1')).toMatch(/\/files\/meshes\/lod_L1\/abc123_L1\.glb$/);
    expect(getModelSource('legacy').meshes.meshUrl('abc123', 'L1')).toBe(legacyMeshUrl('abc123', 'L1'));
  });

  it('gen-model-v1：树 / 几何记录 / 网格 / 属性全部走 /api/v1，一个旧后端函数都不碰；同种类只建一份', () => {
    const source = getModelSource('gen-model-v1');
    const legacy = getModelSource('legacy');
    expect(source.kind).toBe('gen-model-v1');
    expect(getModelSource('gen-model-v1')).toBe(source);
    expect(source.meshes.meshUrl('12240963882128803248', 'L1')).toMatch(/\/api\/v1\/meshes\/12240963882128803248\.glb$/);

    expect(source.tree.worldRoot).not.toBe(legacy.tree.worldRoot);
    expect(source.records.instanceEntriesByRefnos).not.toBe(legacy.records.instanceEntriesByRefnos);
    expect(source.attributes.typeInfo).not.toBe(legacy.attributes.typeInfo);
    expect(source.attributes.uiAttr).not.toBe(legacy.attributes.uiAttr);
    expect(legacyMocks.e3dGetWorldRoot).not.toHaveBeenCalled();
    expect(legacyMocks.queryInstanceEntriesByRefnos).not.toHaveBeenCalled();
    expect(legacyMocks.pdmsGetTypeInfo).not.toHaveBeenCalled();
    expect(legacyMocks.pdmsGetUiAttr).not.toHaveBeenCalled();
  });
});
