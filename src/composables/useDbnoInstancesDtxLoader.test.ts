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
    expect(typeof mod.loadDtxAabbProxyRefnos).toBe('function');
    expect(typeof mod.hasDtxDbnoCache).toBe('function');
  });

  it('指定最小交付单元版本时直接使用该 manifest，不探测当前 dbno 包', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const manifestUrl = '/files/output/AvevaMarineSample/model_units/7997/24381_145018/897/manifest.json';
    const dtxLayer = new DTXLayer({ maxVertices: 64, maxIndices: 128, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, 7997, ['24381_145018'], {
      dataSource: 'parquet',
      parquetManifestUrl: manifestUrl,
    });

    expect(parquetLoaderMocks.isParquetAvailable).not.toHaveBeenCalled();
    expect(parquetLoaderMocks.queryInstanceEntriesByRefnos).toHaveBeenCalledWith(
      7997,
      ['24381_145018'],
      expect.objectContaining({ manifestUrl }),
    );
  });

  it('AABB 代理模型应登记到 DTX refno 索引，便于空间查询定位和显隐', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');

    const dtxLayer = new DTXLayer({
      maxVertices: 64,
      maxIndices: 128,
      maxObjects: 8,
    });

    const result = mod.loadDtxAabbProxyRefnos(dtxLayer, 99000, [
      {
        refno: '2013286704_479',
        noun: 'TEE',
        specValue: 0,
        aabb: {
          min: [-10, -20, -30],
          max: [10, 20, 30],
        },
      },
    ]);

    expect(result.loadedRefnos).toEqual(['2013286704_479']);
    expect(result.missingRefnos).toEqual([]);
    expect(result.loadedObjects).toBe(1);
    expect(dtxLayer.hasObject('o:2013286704_479:spatial-proxy')).toBe(true);
    expect(mod.resolveDtxObjectIdsByRefno(99000, '2013286704_479')).toEqual([
      'o:2013286704_479:spatial-proxy',
    ]);
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

  it('ELBO 自身已有几何时，同 refno 的 TUBI 应挂到 BRAN owner 而非丢弃', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');

    const elboRefno = '24381_145714';
    const branRefno = '24381_145712';
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
            owner_refno: branRefno,
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
            owner_refno: branRefno,
            owner_noun: 'BRAN',
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

    const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [elboRefno], {
      dataSource: 'parquet',
      debug: false,
    });

    expect(result.loadedObjects).toBe(2);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, elboRefno)).toHaveLength(1);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, branRefno)).toHaveLength(1);
  });

  it('已知 404 的 geoHash 默认不跨批次重复请求，forceReload 时允许重试', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');

    const dbno = 99003;
    const geoHash = 'missing-geo-hash';
    const makeEntry = (refno: string) => ({
      geo_hash: geoHash,
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      uniforms: {
        refno,
        noun: 'EQUI',
        owner_refno: '',
        owner_noun: '',
        spec_value: 0,
      },
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));

    vi.stubGlobal('fetch', fetchMock);
    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockImplementation(async (_dbno: number, refnos: string[]) => {
      return new Map(refnos.map((refno) => [refno, [makeEntry(refno)]]));
    });

    const dtxLayer = new DTXLayer({
      maxVertices: 256,
      maxIndices: 512,
      maxObjects: 16,
    });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, ['24381_1'], {
      dataSource: 'parquet',
      debug: false,
    });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, ['24381_2'], {
      dataSource: 'parquet',
      debug: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, ['24381_2'], {
      dataSource: 'parquet',
      debug: false,
      forceReloadRefnos: ['24381_2'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('replaceExistingObjects 应隐藏旧对象并只保留新对象索引', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99004;
    const refno = '24381_76693';
    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([[
      refno,
      [{
        geo_hash: '1',
        matrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
        uniforms: { refno, noun: 'STRT', owner_refno: '24381_76692', owner_noun: 'BRAN' },
      }],
    ]]));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'parquet',
    });
    const oldIds = mod.resolveDtxObjectIdsByRefno(dbno, refno);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'parquet',
      forceReloadRefnos: [refno],
      replaceExistingObjects: true,
    });
    const newIds = mod.resolveDtxObjectIdsByRefno(dbno, refno);

    expect(oldIds).toHaveLength(1);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe(oldIds[0]);
    expect(dtxLayer.isObjectVisible(oldIds[0]!)).toBe(false);
    expect(dtxLayer.isObjectVisible(newIds[0]!)).toBe(true);
  });

  it('替换所需几何加载失败时保留旧对象可见', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99009;
    const refno = '24381_76694';
    const entry = (geoHash: string) => ({
      geo_hash: geoHash,
      matrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      uniforms: { refno, noun: 'STRT', owner_refno: '24381_76692', owner_noun: 'BRAN' },
    });
    parquetLoaderMocks.queryInstanceEntriesByRefnos
      .mockResolvedValueOnce(new Map([[refno, [entry('1')]]]))
      .mockResolvedValueOnce(new Map([[refno, [entry('missing-mesh')]]]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'parquet' });
    const oldId = mod.resolveDtxObjectIdsByRefno(dbno, refno)[0]!;

    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'parquet',
      forceReloadRefnos: [refno],
      replaceExistingObjects: true,
    })).rejects.toThrow('替换模型所需几何不完整');

    expect(dtxLayer.isObjectVisible(oldId)).toBe(true);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, refno)).toEqual([oldId]);
  });

  it('替换追加对象或重编译失败时回滚旧对象索引和显隐', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99010;
    const refno = '24381_76695';
    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([[
      refno,
      [{
        geo_hash: '1',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'STRT', owner_refno: '24381_76692', owner_noun: 'BRAN' },
      }],
    ]]));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'parquet' });
    const oldId = mod.resolveDtxObjectIdsByRefno(dbno, refno)[0]!;
    vi.spyOn(dtxLayer, 'addObject').mockImplementationOnce(() => {
      throw new Error('simulated addObject failure');
    });

    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'parquet',
      forceReloadRefnos: [refno],
      replaceExistingObjects: true,
    })).rejects.toThrow();

    expect(dtxLayer.isObjectVisible(oldId)).toBe(true);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, refno)).toEqual([oldId]);
  });

  it('替换重编译失败时移除尾部对象并恢复全部 refno 元数据', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99011;
    const refno = '24381_76696';
    const childRefno = '24381_76697';
    const entry = (actualRefno: string, noun: string) => ({
      geo_hash: '1',
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      refno_transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
      uniforms: {
        refno: actualRefno,
        noun,
        owner_refno: actualRefno === childRefno ? refno : '',
        owner_noun: actualRefno === childRefno ? 'BRAN' : '',
        spec_value: actualRefno === childRefno ? 42 : 0,
      },
    });
    parquetLoaderMocks.queryInstanceEntriesByRefnos
      .mockResolvedValueOnce(new Map([[refno, [entry(refno, 'BRAN')]]]))
      .mockResolvedValue(new Map([[refno, [entry(refno, 'BRAN'), entry(childRefno, 'ELBO')]]]));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'parquet' });
    const oldId = mod.resolveDtxObjectIdsByRefno(dbno, refno)[0]!;
    vi.spyOn(dtxLayer, 'recompile').mockImplementationOnce(() => {
      throw new Error('simulated recompile failure');
    });

    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'parquet',
      forceReloadRefnos: [refno],
      replaceExistingObjects: true,
    })).rejects.toThrow('simulated recompile failure');

    expect(dtxLayer.getAllObjectIds()).toEqual([oldId]);
    expect(dtxLayer.isObjectVisible(oldId)).toBe(true);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, refno)).toEqual([oldId]);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, childRefno)).toEqual([]);
    expect(mod.resolveDtxNounByRefno(dbno, childRefno)).toBeNull();
    expect(mod.getDtxRefnoTransform(dbno, childRefno)).toBeUndefined();

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'parquet',
      forceReloadRefnos: [refno],
      replaceExistingObjects: true,
    });
    expect(mod.resolveDtxObjectIdsByRefno(dbno, refno)).toEqual([`o:${refno}:1`]);
  });

  it('隔离加载应写入独立 DTXLayer 且不污染当前模型 refno 索引', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99005;
    const refno = '24381_145018';
    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([[
      refno,
      [{
        geo_hash: '1',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'BRAN', owner_refno: '', owner_noun: '' },
      }],
    ]]));
    const primary = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    const compare = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(primary, dbno, [refno], { dataSource: 'parquet' });
    const primaryIds = mod.resolveDtxObjectIdsByRefno(dbno, refno);
    await mod.loadDbnoInstancesForVisibleRefnosDtx(compare, dbno, [refno], {
      dataSource: 'parquet',
      isolated: true,
      objectIdPrefix: 'unit-compare:a',
    });

    expect(compare.getAllObjectIds()).toEqual([expect.stringMatching(/^unit-compare:a:24381_145018:/)]);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, refno)).toEqual(primaryIds);
  });

  it('两个版本并发加载同一未缓存网格时应分别写入各自的 DTXLayer', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99006;
    const refno = '24381_145018';
    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([[
      refno,
      [{
        geo_hash: 'shared-pending-mesh',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'BRAN', owner_refno: '', owner_noun: '' },
      }],
    ]]));
    let resolveFetch!: (value: { status: number; ok: boolean }) => void;
    const fetchPromise = new Promise<{ status: number; ok: boolean }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal('fetch', fetchMock);
    const before = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    const after = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    try {
      const loading = Promise.all([
        mod.loadDbnoInstancesForVisibleRefnosDtx(before, dbno, [refno], {
          dataSource: 'parquet', isolated: true, objectIdPrefix: 'unit-compare:a',
        }),
        mod.loadDbnoInstancesForVisibleRefnosDtx(after, dbno, [refno], {
          dataSource: 'parquet', isolated: true, objectIdPrefix: 'unit-compare:b',
        }),
      ]);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      resolveFetch({ status: 404, ok: false });
      await loading;

      expect(before.getAllObjectIds()).toHaveLength(1);
      expect(after.getAllObjectIds()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('应按 owner 链解析当前最小交付单元的全部对象', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99007;
    const root = '24381_145018';
    const child = '24381_145019';
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    parquetLoaderMocks.queryInstanceEntriesByRefnos.mockResolvedValue(new Map([
      [root, [{ geo_hash: '1', matrix, uniforms: { refno: root, noun: 'BRAN', owner_refno: '', owner_noun: '' } }]],
      [child, [{ geo_hash: '1', matrix, uniforms: { refno: child, noun: 'ELBO', owner_refno: root, owner_noun: 'BRAN' } }]],
    ]));
    const layer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, [root, child], { dataSource: 'parquet' });

    expect(mod.resolveDtxObjectIdsByUnitRefno(dbno, root).sort()).toEqual(layer.getAllObjectIds().sort());
  });

  it('提供预读实例索引时不应再次查询 parquet', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const refno = '24381_145018';
    const entries = new Map([[
      refno,
      [{
        geo_hash: '1',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'BRAN', owner_refno: '', owner_noun: '' },
      }],
    ]]);
    const layer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, 99008, [refno], {
      dataSource: 'parquet',
      isolated: true,
      instanceEntriesByRefno: entries,
    });

    expect(parquetLoaderMocks.queryInstanceEntriesByRefnos).not.toHaveBeenCalled();
    expect(layer.getAllObjectIds()).toHaveLength(1);
  });
});
