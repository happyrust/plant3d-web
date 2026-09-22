import { beforeEach, describe, expect, it, vi } from 'vitest';

// 记录源经 `getModelSource().records`（gen-model-v1 ensure → records）喂给加载链；这里 mock 掉数据源，
// 只测加载链本身（实例 → DTX 对象、来源身份、隔离图层、直管归属…）。
const recordSourceMocks = vi.hoisted(() => ({
  instanceEntriesByRefnos: vi.fn(async () => new Map()),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    records: { instanceEntriesByRefnos: recordSourceMocks.instanceEntriesByRefnos },
    meshes: { meshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh` },
  }),
}));

vi.mock('@/composables/useDisplayThemeStore', () => ({
  useDisplayThemeStore: () => ({
    currentTheme: { value: 'design3d' },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map());
});

// geo_hash '1' 是前端本地生成的基础几何（单位盒），不走网络；来源身份测试不关心几何本身。
function makeInstanceEntry(refno: string, geoHash = '1', noun = 'VALV') {
  return {
    geo_hash: geoHash,
    matrix: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    uniforms: { refno, noun, owner_refno: '', owner_noun: '', spec_value: 0 },
  };
}

describe('useDbnoInstancesDtxLoader', () => {
  it('模块可被导入并导出加载函数', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');

    expect(typeof mod.loadDbnoInstancesForVisibleRefnosDtx).toBe('function');
    expect(typeof mod.loadDtxAabbProxyRefnos).toBe('function');
    expect(typeof mod.hasDtxDbnoCache).toBe('function');
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

  it('跨库 refno 探针与运行时索引修订号（ADR-0050）：登记后 loaded / known 为真、两种 refno 写法都命中、每批装载修订号 +1', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dtxLayer = new DTXLayer({ maxVertices: 64, maxIndices: 128, maxObjects: 8 });
    const revisionBefore = mod.dtxLoaderRevision.value;

    expect(mod.isDtxRefnoLoadedAcrossAllDbnos('2013286704_480')).toBe(false);
    expect(mod.isDtxRefnoKnownAcrossAllDbnos('2013286704_480')).toBe(false);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos('')).toBe(false);

    mod.loadDtxAabbProxyRefnos(dtxLayer, 99002, [
      { refno: '2013286704_480', noun: 'TEE', specValue: 0, aabb: { min: [-1, -1, -1], max: [1, 1, 1] } },
    ]);

    expect(mod.dtxLoaderRevision.value).toBe(revisionBefore + 1);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos('2013286704_480')).toBe(true);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos('=2013286704/480')).toBe(true);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos(' 2013286704/480 ')).toBe(true);
    expect(mod.isDtxRefnoKnownAcrossAllDbnos('=2013286704/480')).toBe(true);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos('2013286704_481')).toBe(false);

    // 空批不算一次装载，修订号不动
    mod.loadDtxAabbProxyRefnos(dtxLayer, 99002, []);
    expect(mod.dtxLoaderRevision.value).toBe(revisionBefore + 1);

    // AABB 代理盒也记来源身份（没有快照概念，身份为 null）
    expect(mod.getDtxRefnoLoadSource(99002, '=2013286704/480')).toMatchObject({
      dataSource: 'aabb-proxy',
      modelSnapshotId: null,
      generatedAt: null,
    });
  });

  it('装进场景的 refno 记几何来源身份（gen-model-v1，快照身份暂为 null）；跨库探针可查', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99021;
    const refno = '24381_900001';
    const dtxLayer = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 16 });

    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[refno, [makeInstanceEntry(refno)]]]));
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'gen-model-v1' });

    expect(mod.getDtxRefnoLoadSource(dbno, refno)).toMatchObject({
      dataSource: 'gen-model-v1',
      modelSnapshotId: null,
      generatedAt: null,
    });
    expect(mod.getDtxRefnoLoadSourceAcrossAllDbnos('=24381/900001')?.dataSource).toBe('gen-model-v1');
    expect(mod.getDtxRefnoLoadSource(dbno, '24381_nothing')).toBeNull();
    expect(mod.getDtxRefnoLoadSource(dbno + 1, refno)).toBeNull();
  });

  it('逐段眼睛（方案 B T4）：直管实例的 uniforms.tube 登进 tubeKey(BRAN, from, to, ordinal) → 对象 id 索引，跨库可查；没有 tube 的直管 / 构件不登；对象级隐藏覆盖表独立于 refno 状态，按 BRAN 前缀清', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99031;
    const bran = '24381_105030';
    const tube = (from: string, to: string, ordinal: number, withIdentity = true) => ({
      ...makeInstanceEntry(bran, '1', 'TUBI'),
      uniforms: {
        refno: bran, noun: 'TUBI', owner_refno: bran, owner_noun: 'BRAN', is_tubi: true, is_invalid_tubi: false, spec_value: 0,
        ...(withIdentity ? { tube: { ordinal, from, to } } : {}),
      },
    });
    const dtxLayer = new DTXLayer({ maxVertices: 512, maxIndices: 1024, maxObjects: 16 });
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[bran, [
      // 两端写法 a/b 也归一成 a_b；同 (from, to) 第二段 ordinal=1；一条老服务端形态（没有 tube）；一个构件
      tube('24381/105031', '24381_105032', 0),
      tube('24381_105032', '24381_105033', 0),
      tube('24381_105032', '24381_105033', 1),
      tube('24381_105040', '24381_105041', 0, false),
      { ...makeInstanceEntry(bran, '1', 'BEND'), uniforms: { refno: '24381_105031', noun: 'BEND', owner_refno: bran, owner_noun: 'BRAN', spec_value: 0 } },
    ]]]));
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [bran], { dataSource: 'gen-model-v1' });

    const k0 = '24381_105030#24381_105031-24381_105032#0';
    const k1 = '24381_105030#24381_105032-24381_105033#0';
    const k2 = '24381_105030#24381_105032-24381_105033#1';
    const ids = mod.resolveDtxTubeObjectIdsByKeys([k0, k1, k2, '24381_105030#24381_105040-24381_105041#0', 'nope#a-b#0']);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size, '三段各自一个对象').toBe(3);
    for (const id of ids) {
      expect(mod.isDtxTubiObject(dbno, id)).toBe(true);
      expect(mod.resolveDtxRefnoByObjectId(dbno, id)).toBe(bran);
      expect(dtxLayer.hasObject(id)).toBe(true);
    }
    expect(mod.isDtxTubeSegmentLoadedAcrossAllDbnos(k2)).toBe(true);
    expect(mod.isDtxTubeSegmentLoadedAcrossAllDbnos('24381_105030#24381_105040-24381_105041#0'), '没有 tube 的直管不登').toBe(false);
    // 直管对象总数 4（含没身份的那段），构件不进直管表
    expect(mod.listDtxTubiObjectIdsForRefno(bran)).toHaveLength(4);

    // 对象级隐藏覆盖表：标 / 清 / 读都响应式地换整份；按 BRAN 前缀清，别的 BRAN 不受影响
    expect(mod.isDtxTubeSegmentHidden(k0)).toBe(false);
    mod.markDtxTubeSegmentsHidden([k0, 'other_1#x-y#0'], true);
    expect(mod.isDtxTubeSegmentHidden(k0)).toBe(true);
    expect(mod.dtxHiddenTubeKeys.value.has('other_1#x-y#0')).toBe(true);
    mod.markDtxTubeSegmentsHidden([k0], false);
    expect(mod.isDtxTubeSegmentHidden(k0)).toBe(false);
    mod.markDtxTubeSegmentsHidden([k0, k1], true);
    mod.clearDtxTubeSegmentOverrides(['24381/105030']);
    expect(mod.isDtxTubeSegmentHidden(k0)).toBe(false);
    expect(mod.isDtxTubeSegmentHidden(k1)).toBe(false);
    expect(mod.isDtxTubeSegmentHidden('other_1#x-y#0'), '别的 BRAN 的覆盖不动').toBe(true);
    mod.clearDtxTubeSegmentOverrides(['other_1']);
    expect(mod.dtxHiddenTubeKeys.value.size).toBe(0);
  });

  it('版本对比的隔离图层（isolated）加载不推进 dtxLoaderRevision——主模型没变，不该触发批注重解析', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99022;
    const refno = '24381_900002';
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[refno, [makeInstanceEntry(refno)]]]));

    const isolatedLayer = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 16 });
    const revisionBefore = mod.dtxLoaderRevision.value;
    const isolatedResult = await mod.loadDbnoInstancesForVisibleRefnosDtx(isolatedLayer, dbno, [refno], {
      dataSource: 'gen-model-v1',
      isolated: true,
      objectIdPrefix: 'cmp-before',
    });
    expect(isolatedResult.loadedRefnos).toBe(1);
    expect(mod.dtxLoaderRevision.value).toBe(revisionBefore);

    // 同样的一批装进主图层则 +1
    const primaryLayer = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 16 });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(primaryLayer, dbno, [refno], { dataSource: 'gen-model-v1' });
    expect(mod.dtxLoaderRevision.value).toBe(revisionBefore + 1);
  });

  it('ELBO 自身已有几何时，不应把 owner 关系带出的 TUBI 也映射到 ELBO', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');

    const elboRefno = '24381_145714';
    const tubiRefno = '24381_145715';
    const dbno = 99001;

    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([
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
      dataSource: 'gen-model-v1',
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

    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([
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
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos.mockImplementation(async (_dbno: number, refnos: string[]) => {
      return new Map(refnos.map((refno) => [refno, [makeEntry(refno)]]));
    });

    const dtxLayer = new DTXLayer({
      maxVertices: 256,
      maxIndices: 512,
      maxObjects: 16,
    });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, ['24381_1'], {
      dataSource: 'gen-model-v1',
      debug: false,
    });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, ['24381_2'], {
      dataSource: 'gen-model-v1',
      debug: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, ['24381_2'], {
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[
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
      dataSource: 'gen-model-v1',
    });
    const oldIds = mod.resolveDtxObjectIdsByRefno(dbno, refno);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos
      .mockResolvedValueOnce(new Map([[refno, [entry('1')]]]))
      .mockResolvedValueOnce(new Map([[refno, [entry('missing-mesh')]]]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'gen-model-v1' });
    const oldId = mod.resolveDtxObjectIdsByRefno(dbno, refno)[0]!;

    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[
      refno,
      [{
        geo_hash: '1',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'STRT', owner_refno: '24381_76692', owner_noun: 'BRAN' },
      }],
    ]]));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'gen-model-v1' });
    const oldId = mod.resolveDtxObjectIdsByRefno(dbno, refno)[0]!;
    vi.spyOn(dtxLayer, 'addObject').mockImplementationOnce(() => {
      throw new Error('simulated addObject failure');
    });

    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos
      .mockResolvedValueOnce(new Map([[refno, [entry(refno, 'BRAN')]]]))
      .mockResolvedValue(new Map([[refno, [entry(refno, 'BRAN'), entry(childRefno, 'ELBO')]]]));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], { dataSource: 'gen-model-v1' });
    const oldId = mod.resolveDtxObjectIdsByRefno(dbno, refno)[0]!;
    vi.spyOn(dtxLayer, 'recompile').mockImplementationOnce(() => {
      throw new Error('simulated recompile failure');
    });

    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [refno], {
      dataSource: 'gen-model-v1',
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
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[
      refno,
      [{
        geo_hash: '1',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'BRAN', owner_refno: '', owner_noun: '' },
      }],
    ]]));
    const primary = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    const compare = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(primary, dbno, [refno], { dataSource: 'gen-model-v1' });
    const primaryIds = mod.resolveDtxObjectIdsByRefno(dbno, refno);
    await mod.loadDbnoInstancesForVisibleRefnosDtx(compare, dbno, [refno], {
      dataSource: 'gen-model-v1',
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
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[
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
          dataSource: 'gen-model-v1', isolated: true, objectIdPrefix: 'unit-compare:a',
        }),
        mod.loadDbnoInstancesForVisibleRefnosDtx(after, dbno, [refno], {
          dataSource: 'gen-model-v1', isolated: true, objectIdPrefix: 'unit-compare:b',
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
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([
      [root, [{ geo_hash: '1', matrix, uniforms: { refno: root, noun: 'BRAN', owner_refno: '', owner_noun: '' } }]],
      [child, [{ geo_hash: '1', matrix, uniforms: { refno: child, noun: 'ELBO', owner_refno: root, owner_noun: 'BRAN' } }]],
    ]));
    const layer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });

    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, [root, child], { dataSource: 'gen-model-v1' });

    expect(mod.resolveDtxObjectIdsByUnitRefno(dbno, root).sort()).toEqual(layer.getAllObjectIds().sort());
  });

  it('提供预读实例索引时不应再向数据源取实例', async () => {
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
      dataSource: 'gen-model-v1',
      isolated: true,
      instanceEntriesByRefno: entries,
    });

    expect(recordSourceMocks.instanceEntriesByRefnos).not.toHaveBeenCalled();
    expect(layer.getAllObjectIds()).toHaveLength(1);
  });
});
