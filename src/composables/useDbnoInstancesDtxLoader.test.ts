import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  realtimeInstancesByRefnos: vi.fn(async () => ({
    items: [],
    missing_refnos: [],
  })),
}));

vi.mock('@/utils/parseGlbGeometry', () => ({
  parseGlbGeometry: vi.fn(() => null),
}));

vi.mock('@/composables/useDisplayThemeStore', () => ({
  useDisplayThemeStore: () => ({
    currentTheme: { value: 'design3d' },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  parquetLoaderMocks.isParquetAvailable.mockResolvedValue(true);
  parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map());
});

describe('useDbnoInstancesDtxLoader', () => {
  it('模块可被导入并导出加载函数', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');

    expect(typeof mod.loadDbnoInstancesForVisibleRefnosDtx).toBe('function');
    expect(typeof mod.hasDtxDbnoCache).toBe('function');
  });

  it('ELBO 自身已有几何时，不应把 owner 关系带出的 TUBI 也映射到 ELBO', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');

    const elboRefno = '24381_145714';
    const tubiRefno = '24381_145715';
    const dbno = 99001;

    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([
      [elboRefno, [
        {
          geo_hash: '1',
          matrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
          uniforms: {
            refno: elboRefno,
            noun: 'ELBO',
            owner_refno: '24381_145700',
            owner_noun: 'BRAN',
            spec_value: 0,
          },
        },
        {
          geo_hash: '2',
          matrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            10, 0, 0, 1,
          ],
          uniforms: {
            refno: tubiRefno,
            noun: 'TUBI',
            owner_refno: elboRefno,
            owner_noun: '',
            spec_value: 0,
          },
        },
      ]],
    ]));

    const dtxLayer = new DTXLayer({
      maxVertices: 256,
      maxIndices: 512,
      maxObjects: 16,
    });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [elboRefno], {
      dataSource: 'parquet',
      debug: false,
    });

    expect(mod.resolveDtxObjectIdsByRefno(dbno, elboRefno)).toHaveLength(1);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, tubiRefno)).toHaveLength(1);
  });

  it('ELBO 自身已有几何时，应跳过与 ELBO 同 refno 的 TUBI primitive', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');

    const elboRefno = '24381_145714';
    const dbno = 99002;

    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([
      [elboRefno, [
        {
          geo_hash: '3',
          matrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
          ],
          uniforms: {
            refno: elboRefno,
            noun: 'ELBO',
            owner_refno: '24381_145712',
            owner_noun: 'BRAN',
            spec_value: 3,
          },
        },
        {
          geo_hash: '2',
          matrix: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            10, 0, 0, 1,
          ],
          uniforms: {
            refno: elboRefno,
            noun: 'TUBI',
            owner_refno: '24381_145712',
            owner_noun: '',
            spec_value: 3,
          },
        },
      ]],
    ]));

    const dtxLayer = new DTXLayer({
      maxVertices: 256,
      maxIndices: 512,
      maxObjects: 16,
    });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [elboRefno], {
      dataSource: 'parquet',
      debug: false,
    });

    expect(mod.resolveDtxObjectIdsByRefno(dbno, elboRefno)).toHaveLength(1);
  });
});
