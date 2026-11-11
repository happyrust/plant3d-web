/**
 * 装载链取网格的两条路（方案 2026-11-10 A4）：数据源给了打包取（`meshes.batch`）且可用时，要取的键在同一拍里全交给它；
 * 不可用时照旧按 `meshUrl` 逐个取。这里把数据源 mock 掉，只看装载链怎么用这两条路。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshBatchResult } from '@/model-source/ports';

type InstanceEntryStub = { geo_hash: string; matrix: number[]; uniforms: Record<string, unknown> | null };

const mocks = vi.hoisted(() => ({
  instanceEntriesByRefnos: vi.fn<(dbno: number, refnos: string[]) => Promise<Map<string, InstanceEntryStub[]>>>(async () => new Map()),
  batchAvailable: vi.fn(() => true),
  batchRequest: vi.fn<(geoHash: string) => Promise<MeshBatchResult>>(),
  withBatch: { value: true },
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    records: { instanceEntriesByRefnos: mocks.instanceEntriesByRefnos },
    meshes: {
      meshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh`,
      lod1MeshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh?lod=1`,
      ...(mocks.withBatch.value ? { batch: { available: mocks.batchAvailable, request: mocks.batchRequest } } : {}),
    },
  }),
}));

vi.mock('@/composables/useDisplayThemeStore', () => ({
  useDisplayThemeStore: () => ({ currentTheme: { value: 'design3d' } }),
}));

function meshFixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'src', 'fixtures', 'meshes', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function entry(refno: string, geoHash: string): InstanceEntryStub {
  return { geo_hash: geoHash, matrix: IDENTITY, uniforms: { refno, noun: 'VALV', owner_refno: '', owner_noun: '', spec_value: 0 } };
}

/** 一个 refno 一个网格：`refnos[i]` 用 `hashes[i]` */
function serveInstances(refnos: string[], hashes: string[]): void {
  mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(
    asked.map((refno) => [refno, [entry(refno, hashes[refnos.indexOf(refno)]!)]]),
  ));
}

async function newLayer() {
  const { DTXLayer } = await import('@/utils/three/dtx');
  return new DTXLayer({ maxVertices: 20_000, maxIndices: 60_000, maxObjects: 256 });
}

let nextDbno = 98_100;
const freshDbno = () => nextDbno++;

/** 发出去的逐个取网格的请求地址（装载链还会用 `fetch` 取一次显示配置，不算在内） */
function meshGets(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/api/v1/meshes/'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withBatch.value = true;
  mocks.batchAvailable.mockReturnValue(true);
  mocks.batchRequest.mockImplementation(async () => ({ kind: 'mesh', data: meshFixture('3.mesh') }));
  mocks.instanceEntriesByRefnos.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('装载链取网格：打包取可用时', () => {
  it('要取的键全交给打包取，一个逐个取的请求都不发；取回来的字节照常解析、装进图层', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    serveInstances(['1_1', '1_2'], ['ga', 'gb']);
    mocks.batchRequest.mockImplementation(async (geoHash) => ({
      kind: 'mesh', data: meshFixture(geoHash === 'ga' ? '3.mesh' : '23708_26903_1361.mesh'),
    }));

    const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, freshDbno(), ['1_1', '1_2'], { dataSource: 'gen-model-v1' });

    expect(mocks.batchRequest.mock.calls.map((call) => call[0]).sort()).toEqual(['ga', 'gb']);
    expect(meshGets(fetchMock)).toEqual([]);
    expect(result.loadedObjects).toBe(2);
    expect(result.missingBreakdown.mesh404GeoHashes).toEqual([]);
    expect(layer.hasGeometry('ga')).toBe(true);
    expect(layer.hasGeometry('gb')).toBe(true);
    // 3.mesh 是 629 顶点的单位球：装进去的是真网格，不是兜底盒子
    expect(layer.getStats().totalVertices).toBeGreaterThan(600);
  });

  it('上千个键在同一拍里交出去（源才攒得成批），不是 8 个 8 个地等', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const hashes = Array.from({ length: 40 }, (_, i) => `g${i}`);
    const resolvers: ((result: MeshBatchResult) => void)[] = [];
    mocks.batchRequest.mockImplementation(() => new Promise<MeshBatchResult>((resolve) => { resolvers.push(resolve); }));

    const pending = mod.prefetchDtxGeometries(layer, freshDbno(), hashes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.batchRequest).toHaveBeenCalledTimes(40);
    expect(mocks.batchRequest.mock.calls.map((call) => call[0])).toEqual(hashes);

    resolvers.forEach((resolve) => resolve({ kind: 'mesh', data: meshFixture('23708_26903_1361.mesh') }));
    await pending;
    expect(layer.hasGeometry('g39')).toBe(true);
  });

  it('源说没有这个网格：与逐个取遇到 404 同样处理（兜底盒子、记为缺失、下次不再问）', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const dbno = freshDbno();
    serveInstances(['1_1', '1_2'], ['gone', 'gone']);
    mocks.batchRequest.mockResolvedValue({ kind: 'missing' });

    const first = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1'], { dataSource: 'gen-model-v1' });
    expect(first.missingBreakdown.mesh404GeoHashes).toEqual(['gone']);
    expect(first.missingBreakdown.mesh404Refnos).toEqual(['1_1']);
    expect(first.loadedObjects).toBe(1);
    expect(layer.hasGeometry('gone')).toBe(true);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_2'], { dataSource: 'gen-model-v1' });
    expect(mocks.batchRequest).toHaveBeenCalledTimes(1);
    expect(meshGets(fetchMock)).toEqual([]);
  });

  it('源让某个键走单个路由：那个键按 meshUrl 逐个取，别的键不受影响', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const fetchMock = vi.fn(async (_url: string) => new Response(meshFixture('3.mesh'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    serveInstances(['1_1', '1_2'], ['ga', 'gb']);
    mocks.batchRequest.mockImplementation(async (geoHash) => (
      geoHash === 'ga' ? { kind: 'single', reason: 'status_2' } : { kind: 'mesh', data: meshFixture('23708_26903_1361.mesh') }
    ));

    const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, freshDbno(), ['1_1', '1_2'], { dataSource: 'gen-model-v1' });

    expect(meshGets(fetchMock)).toEqual(['/api/v1/meshes/ga.mesh']);
    expect(result.loadedObjects).toBe(2);
    expect(result.missingBreakdown.mesh404GeoHashes).toEqual([]);
  });

  it('退回逐个取的键同时在飞的不超过 8 个（单个网格的 8 秒时限从真正发出请求起算）', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 3));
      inFlight -= 1;
      return new Response(meshFixture('23708_26903_1361.mesh'), { status: 200 });
    }));
    mocks.batchRequest.mockResolvedValue({ kind: 'single', reason: 'route_missing_405' });

    await mod.prefetchDtxGeometries(layer, freshDbno(), Array.from({ length: 30 }, (_, i) => `s${i}`));

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(layer.hasGeometry('s29')).toBe(true);
  });

  it('打包取回来的字节解不出网格：与逐个取解析失败同样处理（兜底盒子，不抛错）', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      serveInstances(['1_1'], ['bad']);
      mocks.batchRequest.mockResolvedValue({ kind: 'mesh', data: new Uint8Array([1, 2, 3, 4]).buffer });
      const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, freshDbno(), ['1_1'], { dataSource: 'gen-model-v1' });
      expect(result.loadedObjects).toBe(1);
      expect(layer.hasGeometry('bad')).toBe(true);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('本地造的几何（1 / 2 / 3、tubi_*）不去打包取', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    await mod.prefetchDtxGeometries(layer, freshDbno(), ['1', '2', '3', 'tubi_x', 't_y']);
    expect(mocks.batchRequest).not.toHaveBeenCalled();
    expect(layer.hasGeometry('tubi_x')).toBe(true);
  });

  it('已经在取的键不再要第二次：后来的调用等同一个结果', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    let release!: (result: MeshBatchResult) => void;
    mocks.batchRequest.mockImplementation(() => new Promise<MeshBatchResult>((resolve) => { release = resolve; }));

    const first = mod.prefetchDtxGeometries(layer, dbno, ['ga']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = mod.prefetchDtxGeometries(layer, dbno, ['ga']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.batchRequest).toHaveBeenCalledTimes(1);
    release({ kind: 'mesh', data: meshFixture('3.mesh') });
    await Promise.all([first, second]);
    expect(layer.hasGeometry('ga')).toBe(true);
  });

  it('强制重取几何（重新生成之后）同样走打包取', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    serveInstances(['1_1'], ['ga']);
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1'], { dataSource: 'gen-model-v1' });
    expect(mocks.batchRequest).toHaveBeenCalledTimes(1);
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1'], {
      dataSource: 'gen-model-v1', forceReloadRefnos: ['1_1'], replaceExistingObjects: true, forceRefreshGeometries: true,
    });
    expect(mocks.batchRequest).toHaveBeenCalledTimes(2);
  });
});

describe('装载链取网格：打包取不可用时与原来一样逐个取', () => {
  async function expectSingleFetchOnly() {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async (_url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return new Response(meshFixture('23708_26903_1361.mesh'), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const refnos = Array.from({ length: 20 }, (_, i) => `1_${i}`);
    const hashes = refnos.map((_, i) => `u${i}`);
    serveInstances(refnos, hashes);

    const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, freshDbno(), refnos, { dataSource: 'gen-model-v1' });

    expect(mocks.batchRequest).not.toHaveBeenCalled();
    expect(meshGets(fetchMock).sort()).toEqual(hashes.map((hash) => `/api/v1/meshes/${hash}.mesh`).sort());
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(result.loadedObjects).toBe(20);
  }

  it('available() 为假（旧后端没有这条路由）', async () => {
    mocks.batchAvailable.mockReturnValue(false);
    await expectSingleFetchOnly();
  });

  it('数据源根本没给打包取', async () => {
    mocks.withBatch.value = false;
    await expectSingleFetchOnly();
  });
});
