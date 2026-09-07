import { beforeEach, describe, expect, it, vi } from 'vitest';

// gen-model `is_invalid_tubi` 告警色（plan 2026-09-06 §8 Q2）：装入时画琥珀色、计数，重刷材质时保住。
// 记录源只是把 uniforms 交给加载链，所以这里借 parquet 的 mock 形状喂实例即可——标记在 uniforms 上，与数据源无关。

const parquetLoaderMocks = vi.hoisted(() => ({
  isParquetAvailable: vi.fn(async () => true),
  queryInstanceEntriesByRefnos: vi.fn(async () => new Map()),
}));

vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({
    isParquetAvailable: parquetLoaderMocks.isParquetAvailable,
    queryInstanceEntriesByRefnos: parquetLoaderMocks.queryInstanceEntriesByRefnos,
  }),
}));

vi.mock('@/api/genModelRealtimeApi', () => ({
  realtimeInstancesByRefnos: vi.fn(async () => ({ items: [], missing_refnos: [] })),
}));

vi.mock('@/utils/parseGlbGeometry', () => ({
  parseGlbGeometry: vi.fn(() => null),
}));

vi.mock('@/composables/useDisplayThemeStore', () => ({
  useDisplayThemeStore: () => ({
    currentTheme: { value: 'design3d' },
  }),
}));

const AMBER = 'f59e0b';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const BRAN = '24381_145018';

function tubi(refno: string, extra: Record<string, unknown> = {}) {
  return {
    geo_hash: '2',
    matrix: IDENTITY,
    uniforms: { refno, noun: 'TUBI', owner_refno: BRAN, owner_noun: 'BRAN', is_tubi: true, ...extra },
  };
}

async function loadWith(dbno: number, insts: ReturnType<typeof tubi>[]) {
  const { DTXLayer } = await import('@/utils/three/dtx');
  const mod = await import('./useDbnoInstancesDtxLoader');
  parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([[BRAN, insts]]));
  const layer = new DTXLayer({ maxVertices: 512, maxIndices: 1024, maxObjects: 8 });
  const addObject = vi.spyOn(layer, 'addObject');
  const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, [BRAN], { dataSource: 'parquet' });
  const colorByObjectId = new Map(addObject.mock.calls.map((call) => [call[0], call[3]!.getHexString()]));
  return { mod, layer, result, colorByObjectId };
}

beforeEach(() => {
  vi.clearAllMocks();
  parquetLoaderMocks.isParquetAvailable.mockResolvedValue(true);
  parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map());
});

describe('useDbnoInstancesDtxLoader · is_invalid_tubi 告警色', () => {
  it('带标记的直管画琥珀色并计入 invalidTubiObjects，同批普通直管照主题走', async () => {
    const { result, colorByObjectId } = await loadWith(99101, [
      tubi('24381_145019', { is_invalid_tubi: false }),
      tubi('24381_145020', { is_invalid_tubi: true }),
    ]);

    expect(result.loadedObjects).toBe(2);
    expect(result.invalidTubiObjects).toBe(1);
    const colors = [...colorByObjectId.values()];
    expect(colors.filter((hex) => hex === AMBER)).toHaveLength(1);
    expect(colors.filter((hex) => hex !== AMBER)).toHaveLength(1);
  });

  it('legacy 形状的实例（uniforms 里没有这个字段）永远计 0，没有一个对象是告警色', async () => {
    const { result, colorByObjectId } = await loadWith(99102, [tubi('24381_145019'), tubi('24381_145020')]);

    expect(result.loadedObjects).toBe(2);
    expect(result.invalidTubiObjects).toBe(0);
    expect([...colorByObjectId.values()]).not.toContain(AMBER);
  });

  it('换主题 / 改配置重刷时告警色保住，invalidTubiMaterial 生效，普通直管跟新配置走', async () => {
    const { mod, layer, colorByObjectId } = await loadWith(99103, [
      tubi('24381_145019'),
      tubi('24381_145020', { is_invalid_tubi: true }),
    ]);
    const invalidId = [...colorByObjectId.entries()].find(([, hex]) => hex === AMBER)![0];
    const validId = [...colorByObjectId.keys()].find((id) => id !== invalidId)!;
    const setObjectMaterial = vi.spyOn(layer, 'setObjectMaterial');

    mod.applyMaterialConfigToLoadedDtx(layer, 99103, { materialConfigs: { TUBI: { color: '#4682b4' } } }, 'default');
    let refreshed = new Map(setObjectMaterial.mock.calls.map((call) => [call[0], call[1].color!.getHexString()]));
    expect(refreshed.get(invalidId)).toBe(AMBER);
    expect(refreshed.get(validId)).toBe('4682b4');

    setObjectMaterial.mockClear();
    mod.applyMaterialConfigToLoadedDtx(
      layer,
      99103,
      { materialConfigs: { TUBI: { color: '#4682b4' } }, invalidTubiMaterial: { color: '#ff0000' } },
      'default',
    );
    refreshed = new Map(setObjectMaterial.mock.calls.map((call) => [call[0], call[1].color!.getHexString()]));
    expect(refreshed.get(invalidId)).toBe('ff0000');
    expect(refreshed.get(validId)).toBe('4682b4');
  });
});
