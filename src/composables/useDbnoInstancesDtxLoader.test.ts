import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InstanceEntry } from '@/utils/instances/instanceManifest';

// 记录源经 `getModelSource().records`（gen-model-v1 ensure → records）喂给加载链；这里 mock 掉数据源，
// 只测加载链本身（实例 → DTX 对象、来源身份、隔离图层、直管归属…）。
// 真实 `InstanceEntry` 的 uniforms 就是 `Record<string, unknown>`；这里照抄，
// 让各用例只写自己关心的那几个键，不必为每个键补全。
type InstanceEntryStub = {
  geo_hash: string;
  matrix: number[];
  uniforms: Record<string, unknown> | null;
};

// 泛型标注成真实记录源的签名（按 refno 分组的实例表），
// 这样各用例里 mockImplementation 的返回形状与调用处的期望类型一致。
const recordSourceMocks = vi.hoisted(() => ({
  instanceEntriesByRefnos: vi.fn<(dbno: number, refnos: string[]) => Promise<Map<string, InstanceEntryStub[]>>>(
    async () => new Map(),
  ),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    records: { instanceEntriesByRefnos: recordSourceMocks.instanceEntriesByRefnos },
    meshes: {
      meshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh`,
      lod1MeshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh?lod=1`,
    },
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

// gen-model `assets/meshes` 里的真实语料（3.mesh 是 629 顶点的单位球），用来和兜底盒子区分
function meshFixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'src', 'fixtures', 'meshes', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** 响应头已到、响应体永不结束：只有 signal 能让它结束（浏览器里 abort 会让读体 reject） */
function bodyThatNeverEnds(signal: AbortSignal | null | undefined): Promise<ArrayBuffer> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
  });
}

/** 装载链在发出网格请求前后都只有微任务：转到条件成立或转够次数为止 */
async function flushUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i += 1) await Promise.resolve();
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

  it('图层释放后 invalidateDtxLoaderCaches：新层装载不再把已释放 refno 判成已加载而整批跳过', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99041;
    const refno = '24381_900041';
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([[refno, [makeInstanceEntry(refno)]]]));

    const layer1 = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 16 });
    const first = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer1, dbno, [refno], { dataSource: 'gen-model-v1' });
    expect(first.loadedObjects).toBeGreaterThan(0);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos(refno)).toBe(true);

    // 复现 bug 现场：缓存命中 → 同层重载整批跳过
    const again = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer1, dbno, [refno], { dataSource: 'gen-model-v1' });
    expect(again.loadedObjects).toBe(0);
    expect(again.skippedRefnos).toBe(1);

    // 层释放后失效：新层应重新装载而不是跳过
    layer1.dispose();
    const revisionBefore = mod.dtxLoaderRevision.value;
    mod.invalidateDtxLoaderCaches();
    expect(mod.dtxLoaderRevision.value).toBe(revisionBefore + 1);
    expect(mod.isDtxRefnoLoadedAcrossAllDbnos(refno)).toBe(false);

    const layer2 = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 16 });
    const reloaded = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer2, dbno, [refno], { dataSource: 'gen-model-v1' });
    expect(reloaded.loadedObjects).toBeGreaterThan(0);
    expect(reloaded.skippedRefnos).toBe(0);
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

  it('evictDtxRefnos：数据批次删掉的构件从场景撤下、不再算已加载，留下的不动（增量更新 K09）', async () => {
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    const dbno = 99012;
    const kept = '24384_24777';
    const removed = '24384_24779';
    recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map([
      [kept, [makeInstanceEntry(kept, '1', 'BOX')]],
      [removed, [makeInstanceEntry(removed, '1', 'CYLI')]],
    ]));
    const dtxLayer = new DTXLayer({ maxVertices: 128, maxIndices: 256, maxObjects: 8 });
    await mod.loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, [kept, removed], { dataSource: 'gen-model-v1' });
    const keptIds = mod.resolveDtxObjectIdsByRefno(dbno, kept);
    const removedIds = mod.resolveDtxObjectIdsByRefno(dbno, removed);
    expect(removedIds).toHaveLength(1);
    const revision = mod.dtxLoaderRevision.value;

    expect(mod.evictDtxRefnos(dtxLayer, dbno, [removed, '24384/24779', '24384_99999'])).toEqual([removed]);

    expect(dtxLayer.isObjectVisible(removedIds[0]!)).toBe(false);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, removed)).toEqual([]);
    expect(mod.isDtxRefnoLoaded(dbno, removed)).toBe(false);
    expect(mod.isDtxRefnoLoaded(dbno, kept)).toBe(true);
    expect(dtxLayer.isObjectVisible(keptIds[0]!)).toBe(true);
    expect(mod.dtxLoaderRevision.value).toBe(revision + 1);
    // 撤下的 refno 不能还留在「认识的构件」里：批注绑定靠它区分「在库未装」与「已删」
    expect(mod.isDtxRefnoKnownAcrossAllDbnos(removed)).toBe(false);
    expect(mod.resolveDtxNounByRefno(dbno, removed)).toBeNull();
    expect(mod.isDtxRefnoKnownAcrossAllDbnos(kept)).toBe(true);
    expect(mod.evictDtxRefnos(dtxLayer, 424242, [kept])).toEqual([]);
    expect(mod.evictDtxRefnos(dtxLayer, dbno, [removed])).toEqual([]);
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
    const entries = new Map<string, InstanceEntry[]>([[
      refno,
      [{
        geo_hash: '1',
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        uniforms: { refno, noun: 'BRAN', owner_refno: '', owner_noun: '', spec_value: 0 },
        geo_index: 0,
        color_index: 0,
        name_index: 0,
        site_name_index: 0,
        lod_mask: 0,
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

  describe('网格取回超时', () => {
    const geoHash = 'slow-body-mesh';
    const sphereVertices = 629;
    let meshCalls = 0;

    /** 第一次取网格：头到了、体卡住；之后每次都回真实的单位球 */
    function stubSlowThenOk(): void {
      const sphere = meshFixture('3.mesh');
      meshCalls = 0;
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).includes('/api/v1/meshes/')) return { ok: false, status: 404 };
        meshCalls += 1;
        if (meshCalls > 1) return { ok: true, status: 200, arrayBuffer: async () => sphere.slice(0) };
        return { ok: true, status: 200, arrayBuffer: () => bodyThatNeverEnds(init?.signal) };
      }));
      recordSourceMocks.instanceEntriesByRefnos.mockResolvedValue(new Map(
        ['24381_1', '24381_2'].map((refno) => [refno, [makeInstanceEntry(refno, geoHash, 'EQUI')]]),
      ));
    }

    it('响应体卡住也在 8 s 后结束并告警（不看 debug）；超时不记已加载，下次装载重拉并换掉兜底盒子', async () => {
      const { DTXLayer } = await import('@/utils/three/dtx');
      const mod = await import('./useDbnoInstancesDtxLoader');
      const dbno = 99009;
      stubSlowThenOk();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const layer = new DTXLayer({ maxVertices: 2048, maxIndices: 8192, maxObjects: 8 });

      try {
        let settled = false;
        void mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['24381_1'], { dataSource: 'gen-model-v1', debug: false })
          .then(() => { settled = true; });
        await flushUntil(() => meshCalls === 1);
        await vi.advanceTimersByTimeAsync(8_000);
        await flushUntil(() => settled);

        expect(settled).toBe(true);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('超时'), expect.objectContaining({ geoHash }));
        expect(layer.getAllObjectIds()).toHaveLength(1);
        expect(layer.getGeometryRawSlice(geoHash)!.positions.length).not.toBe(sphereVertices * 3);

        await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['24381_2'], { dataSource: 'gen-model-v1', debug: false });

        expect(meshCalls).toBe(2);
        expect(layer.getAllObjectIds()).toHaveLength(2);
        expect(layer.getGeometryRawSlice(geoHash)!.positions.length).toBe(sphereVertices * 3);
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        warn.mockRestore();
      }
    });

    it('两个图层同时等同一块超时网格：都先放兜底盒子；一层重拉成功后，另一层下次装载直接换上缓存的真几何', async () => {
      // 几何缓存按 dbno 共用、图层各装各的（版本对比两侧就是这样）：第二层是在等第一层的请求，
      // 重拉也只由一层发起，另一层的盒子要靠下次装载时换掉。
      const { DTXLayer } = await import('@/utils/three/dtx');
      const mod = await import('./useDbnoInstancesDtxLoader');
      const dbno = 99010;
      stubSlowThenOk();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const sideA = new DTXLayer({ maxVertices: 2048, maxIndices: 8192, maxObjects: 8 });
      const sideB = new DTXLayer({ maxVertices: 2048, maxIndices: 8192, maxObjects: 8 });
      const load = (layer: InstanceType<typeof DTXLayer>, prefix: string, refno: string) => mod.loadDbnoInstancesForVisibleRefnosDtx(
        layer, dbno, [refno], { dataSource: 'gen-model-v1', isolated: true, objectIdPrefix: prefix },
      );

      try {
        let settled = 0;
        void load(sideA, 'unit-compare:a', '24381_1').then(() => { settled += 1; });
        void load(sideB, 'unit-compare:b', '24381_1').then(() => { settled += 1; });
        await flushUntil(() => meshCalls === 1);
        await vi.advanceTimersByTimeAsync(8_000);
        await flushUntil(() => settled === 2);

        expect(settled).toBe(2);
        expect(meshCalls).toBe(1);
        expect(sideB.getGeometryRawSlice(geoHash)!.positions.length).not.toBe(sphereVertices * 3);

        await load(sideA, 'unit-compare:a', '24381_2');
        expect(meshCalls).toBe(2);
        expect(sideA.getGeometryRawSlice(geoHash)!.positions.length).toBe(sphereVertices * 3);

        await load(sideB, 'unit-compare:b', '24381_2');
        expect(meshCalls).toBe(2);
        expect(sideB.getGeometryRawSlice(geoHash)!.positions.length).toBe(sphereVertices * 3);
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        warn.mockRestore();
      }
    });
  });
});

describe('粗网格（L1）补拉', () => {
  it('关着时不发请求；开着时只拉够大的原网格，404 负缓存，补完 recompile 一次', async () => {
    const { BufferAttribute, BufferGeometry, Matrix4 } = await import('three');
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    mod.invalidateDtxLoaderCaches();

    const big = (tris: number) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(tris * 9), 3));
      return g;
    };
    const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 8 });
    // 原网格要比粗网格夹具（3.mesh，1080 三角）大，`addLod1Geometry` 才收
    layer.addGeometry('big', big(3000));
    layer.addGeometry('nolod', big(300));
    layer.addGeometry('small', big(10));
    layer.addObject('a', 'big', new Matrix4());
    layer.addObject('b', 'nolod', new Matrix4());
    layer.addObject('c', 'small', new Matrix4());
    layer.compile();

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/v1/meshes/big.mesh?lod=1')) {
        return { ok: true, status: 200, arrayBuffer: async () => meshFixture('3.mesh') } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      mod.configureDtxLod1Backfill({ enabled: false });
      expect(await mod.backfillDtxLod1Geometries(layer)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();

      const applied = vi.fn();
      mod.configureDtxLod1Backfill({ enabled: true, onApplied: applied });
      const recompile = vi.spyOn(layer, 'recompile');
      const stats = await mod.backfillDtxLod1Geometries(layer);
      expect(stats).toMatchObject({ candidates: 2, installed: 1, missing: 1 });
      expect(fetchMock.mock.calls.map((c) => String(c[0])).sort()).toEqual([
        '/api/v1/meshes/big.mesh?lod=1',
        '/api/v1/meshes/nolod.mesh?lod=1',
      ]);
      expect(recompile).toHaveBeenCalledTimes(1);
      expect(applied).toHaveBeenCalledTimes(1);
      expect(layer.hasLod1Geometry('big')).toBe(true);

      // 再跑一轮：big 已装、nolod 负缓存，不再发请求
      fetchMock.mockClear();
      expect(await mod.backfillDtxLod1Geometries(layer)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      mod.configureDtxLod1Backfill({ enabled: false });
      vi.unstubAllGlobals();
    }
  });

  it('holdDtxLod1Backfill 期间装载不触发补拉，解除后补一次；嵌套时最后一个解除才补', async () => {
    vi.useFakeTimers();
    const { BufferAttribute, BufferGeometry, Matrix4 } = await import('three');
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    mod.invalidateDtxLoaderCaches();

    const big = (tris: number) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(tris * 9), 3));
      return g;
    };
    const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 8 });
    layer.addGeometry('big', big(3000));
    layer.addObject('seed', 'big', new Matrix4());
    layer.compile();

    recordSourceMocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, refnos) => new Map(
      refnos.map((r) => [r, [{ geo_hash: 'big', matrix: new Matrix4().toArray(), uniforms: null }]]),
    ));
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/v1/meshes/big.mesh?lod=1')) {
        return { ok: true, status: 200, arrayBuffer: async () => meshFixture('3.mesh') } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const lod1Calls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('lod=1')).length;
    try {
      mod.configureDtxLod1Backfill({ enabled: true });
      const outer = mod.holdDtxLod1Backfill();
      const inner = mod.holdDtxLod1Backfill();
      await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, 7997, ['24381_1']);
      await vi.advanceTimersByTimeAsync(1000);
      expect(lod1Calls()).toBe(0);

      inner();
      inner(); // 重复解除不算数
      await vi.advanceTimersByTimeAsync(1000);
      expect(lod1Calls()).toBe(0);

      outer();
      await vi.advanceTimersByTimeAsync(1000);
      expect(lod1Calls()).toBe(1);
      expect(layer.hasLod1Geometry('big')).toBe(true);
    } finally {
      mod.configureDtxLod1Backfill({ enabled: false });
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('服务端对 ?lod=1 回原网格：响应头等大就不读正文、负缓存，攒够几块后本会话不再补拉', async () => {
    const { Matrix4 } = await import('three');
    const { DTXLayer } = await import('@/utils/three/dtx');
    const mod = await import('./useDbnoInstancesDtxLoader');
    mod.invalidateDtxLoaderCaches();

    const sphere = meshFixture('3.mesh');
    const hashes = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
    recordSourceMocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, refnos) => new Map(
      refnos.map((r, i) => [r, [{ geo_hash: hashes[i]!, matrix: new Matrix4().toArray(), uniforms: null }]]),
    ));
    const lod1BodyReads: string[] = [];
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(sphere.byteLength) }),
      arrayBuffer: async () => {
        if (String(url).includes('lod=1')) lod1BodyReads.push(String(url));
        return sphere.slice(0);
      },
    }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const lod1Calls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('lod=1')).length;
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
      await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, 7997, hashes.map((_, i) => `24381_${i + 1}`));
      mod.configureDtxLod1Backfill({ enabled: true });

      const stats = await mod.backfillDtxLod1Geometries(layer);
      expect(stats).toMatchObject({ candidates: 12, installed: 0 });
      expect(lod1Calls()).toBeLessThan(hashes.length);
      expect(lod1BodyReads).toEqual([]);
      expect(hashes.some((h) => layer.hasLod1Geometry(h))).toBe(false);
      expect(info).toHaveBeenCalledTimes(1);

      fetchMock.mockClear();
      expect(await mod.backfillDtxLod1Geometries(layer)).toBeNull();
      expect(lod1Calls()).toBe(0);
    } finally {
      mod.configureDtxLod1Backfill({ enabled: false });
      mod.invalidateDtxLoaderCaches();
      vi.unstubAllGlobals();
      info.mockRestore();
    }
  });
});
