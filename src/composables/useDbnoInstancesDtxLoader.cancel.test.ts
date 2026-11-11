/**
 * 装载链的「叫停」（方案 2026-11-10 第三轮：加载中可以停）。调用方给一个 `signal`：
 * - 叫停之后不再发新的网格请求（已经发出去的让它回来，不打断——同一个网格别的装载可能也在等）；
 * - 对象还没开始往图层里加就收手，什么都不加、什么都不记，回 `cancelled`；
 * - 被叫停的那个网格不算「取不到」：别的装载在等同一个网格时自己再取一遍，不拿兜底盒子顶。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshBatchResult } from '@/model-source/ports';

type InstanceEntryStub = { geo_hash: string; matrix: number[]; uniforms: Record<string, unknown> | null };

const mocks = vi.hoisted(() => ({
  instanceEntriesByRefnos: vi.fn<(dbno: number, refnos: string[]) => Promise<Map<string, InstanceEntryStub[]>>>(async () => new Map()),
  batchAvailable: vi.fn(() => true),
  batchRequest: vi.fn<(geoHash: string, options?: { signal?: AbortSignal }) => Promise<MeshBatchResult>>(),
  withBatch: { value: false },
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

function meshFixture(name = '3.mesh'): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'src', 'fixtures', 'meshes', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function entry(refno: string, geoHash: string, uniforms: Record<string, unknown> = {}): InstanceEntryStub {
  return { geo_hash: geoHash, matrix: IDENTITY, uniforms: { refno, noun: 'VALV', owner_refno: '', owner_noun: '', spec_value: 0, ...uniforms } };
}

/** 一个 refno 一个网格：`1_<i>` 用 `g<i>` */
function serveOneMeshPerRefno(): void {
  mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(
    asked.map((refno) => [refno, [entry(refno, `g${refno.split('_')[1]}`)]]),
  ));
}

async function newLayer() {
  const { DTXLayer } = await import('@/utils/three/dtx');
  return new DTXLayer({ maxVertices: 40_000, maxIndices: 120_000, maxObjects: 256 });
}

let nextDbno = 97_100;
const freshDbno = () => nextDbno++;

function meshGets(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/api/v1/meshes/'));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 网格请求先挂着，`release()` 之后才回来（显示配置等别的请求照常回 404） */
function gatedMeshFetch() {
  const gates: (() => void)[] = [];
  const fetchMock = vi.fn((url: string) => {
    if (!String(url).includes('/api/v1/meshes/')) return Promise.resolve(new Response(null, { status: 404 }));
    return new Promise<Response>((resolve) => {
      gates.push(() => resolve(new Response(meshFixture(), { status: 200 })));
    });
  });
  return {
    fetchMock,
    /** 放行此刻挂着的全部网格请求 */
    release: () => { for (const open of gates.splice(0)) open(); },
    waiting: () => gates.length,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withBatch.value = false;
  mocks.batchAvailable.mockReturnValue(true);
  mocks.instanceEntriesByRefnos.mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('装载链叫停：逐个取网格', () => {
  it('叫停之后不再发新的网格请求；对象一个都不加，回 cancelled；这些构件不算已加载', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const gate = gatedMeshFetch();
    vi.stubGlobal('fetch', gate.fetchMock);
    serveOneMeshPerRefno();
    const refnos = Array.from({ length: 20 }, (_, i) => `1_${i}`);
    const dbno = freshDbno();
    const controller = new AbortController();

    const pending = mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, refnos, { dataSource: 'gen-model-v1', signal: controller.signal });
    await vi.waitFor(() => expect(gate.waiting()).toBe(8));
    expect(meshGets(gate.fetchMock)).toHaveLength(8);

    controller.abort();
    gate.release();
    const result = await pending;

    // 已经发出去的 8 个回来了，没有第 9 个
    expect(meshGets(gate.fetchMock)).toHaveLength(8);
    expect(result).toMatchObject({ cancelled: true, loadedRefnos: 0, loadedObjects: 0, loadedRefnoKeys: [] });
    expect(layer.objectCount).toBe(0);
    expect(refnos.some((refno) => mod.isDtxRefnoLoaded(dbno, refno))).toBe(false);
  });

  it('叫停之后再装同一批：取到过的网格不重取，没取的接着取，照常装完', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const gate = gatedMeshFetch();
    vi.stubGlobal('fetch', gate.fetchMock);
    serveOneMeshPerRefno();
    const refnos = Array.from({ length: 12 }, (_, i) => `1_${i}`);
    const dbno = freshDbno();
    const controller = new AbortController();

    const stopped = mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, refnos, { dataSource: 'gen-model-v1', signal: controller.signal });
    await vi.waitFor(() => expect(gate.waiting()).toBe(8));
    controller.abort();
    gate.release();
    expect((await stopped).cancelled).toBe(true);

    const again = mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, refnos, { dataSource: 'gen-model-v1' });
    await vi.waitFor(() => expect(gate.waiting()).toBe(4));
    gate.release();
    const result = await again;

    expect(meshGets(gate.fetchMock)).toHaveLength(12);
    expect(new Set(meshGets(gate.fetchMock)).size).toBe(12);
    expect(result.cancelled).toBeUndefined();
    expect(result.loadedObjects).toBe(12);
    expect(layer.objectCount).toBe(12);
    // 装进去的是真网格（629 顶点的单位球 × 12 种），没有被叫停的那几个留下兜底盒子
    expect(layer.getStats().totalVertices).toBeGreaterThan(12 * 600);
  });

  it('一开始就已经叫停：一个请求都不发', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const fetchMock = vi.fn(async () => new Response(meshFixture(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    serveOneMeshPerRefno();
    const controller = new AbortController();
    controller.abort();

    const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, freshDbno(), ['1_1', '1_2'], { dataSource: 'gen-model-v1', signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.instanceEntriesByRefnos).not.toHaveBeenCalled();
    expect(layer.objectCount).toBe(0);
  });

  it('网格都到了、对象还没加的时候叫停：不加', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const controller = new AbortController();
    // 两个网格请求都发出去之后、回来之前叫停
    const fetchMock = vi.fn(async (url: string) => {
      const isMesh = String(url).includes('/api/v1/meshes/');
      if (isMesh) {
        await tick();
        controller.abort();
      }
      return new Response(isMesh ? meshFixture() : null, { status: isMesh ? 200 : 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    serveOneMeshPerRefno();
    const dbno = freshDbno();

    const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2'], { dataSource: 'gen-model-v1', signal: controller.signal });
    expect(meshGets(fetchMock)).toHaveLength(2);
    expect(result.cancelled).toBe(true);
    expect(layer.objectCount).toBe(0);
    expect(mod.isDtxRefnoLoaded(dbno, '1_1')).toBe(false);
    // 取到的网格留在图层里：再装就不用取了
    expect(layer.hasGeometry('g1')).toBe(true);
    expect(layer.hasGeometry('g2')).toBe(true);
  });

  it('prefetchDtxGeometries 同样听 signal', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const gate = gatedMeshFetch();
    vi.stubGlobal('fetch', gate.fetchMock);
    const controller = new AbortController();
    const hashes = Array.from({ length: 12 }, (_, i) => `p${i}`);

    const pending = mod.prefetchDtxGeometries(layer, freshDbno(), hashes, 'L1', controller.signal);
    await vi.waitFor(() => expect(gate.waiting()).toBe(4));
    controller.abort();
    gate.release();
    await pending;
    expect(meshGets(gate.fetchMock)).toHaveLength(4);
  });
});

describe('装载链叫停：打包取', () => {
  beforeEach(() => {
    mocks.withBatch.value = true;
  });

  it('把 signal 交给打包取；叫停后源退回来的键不再逐个取，回 cancelled', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const fetchMock = vi.fn(async () => new Response(meshFixture(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    serveOneMeshPerRefno();
    const controller = new AbortController();
    const resolvers = new Map<string, (result: MeshBatchResult) => void>();
    mocks.batchRequest.mockImplementation((geoHash) => new Promise<MeshBatchResult>((resolve) => { resolvers.set(geoHash, resolve); }));
    const dbno = freshDbno();

    const pending = mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2', '1_3'], { dataSource: 'gen-model-v1', signal: controller.signal });
    await vi.waitFor(() => expect(mocks.batchRequest).toHaveBeenCalledTimes(3));
    expect(mocks.batchRequest.mock.calls.every((call) => call[1]?.signal === controller.signal)).toBe(true);

    // 一个已经回来了；叫停；源把还没发的两个退回来
    resolvers.get('g1')!({ kind: 'mesh', data: meshFixture() });
    controller.abort();
    resolvers.get('g2')!({ kind: 'single', reason: 'cancelled' });
    resolvers.get('g3')!({ kind: 'single', reason: 'cancelled' });
    const result = await pending;

    expect(result.cancelled).toBe(true);
    expect(meshGets(fetchMock)).toEqual([]);
    expect(layer.objectCount).toBe(0);
    expect(layer.hasGeometry('g1')).toBe(true);
    expect(layer.hasGeometry('g2')).toBe(false);
  });

  it('被叫停的网格不算取不到：同时在等同一个网格的另一次装载自己再取一遍，拿到的是真网格', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(asked.map((refno) => [refno, [entry(refno, 'shared')]])));
    const controller = new AbortController();
    const resolvers: ((result: MeshBatchResult) => void)[] = [];
    mocks.batchRequest.mockImplementation(() => new Promise<MeshBatchResult>((resolve) => { resolvers.push(resolve); }));
    const dbno = freshDbno();

    // A 带着 signal 先要；B 不带 signal，等的是 A 那一发
    const loadA = mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1'], { dataSource: 'gen-model-v1', signal: controller.signal });
    await vi.waitFor(() => expect(mocks.batchRequest).toHaveBeenCalledTimes(1));
    const loadB = mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_2'], { dataSource: 'gen-model-v1' });
    await tick();
    expect(mocks.batchRequest).toHaveBeenCalledTimes(1);

    controller.abort();
    resolvers[0]!({ kind: 'single', reason: 'cancelled' });
    // B 自己再要一遍
    await vi.waitFor(() => expect(mocks.batchRequest).toHaveBeenCalledTimes(2));
    expect(mocks.batchRequest.mock.calls[1]![1]?.signal).toBeUndefined();
    resolvers[1]!({ kind: 'mesh', data: meshFixture() });

    expect((await loadA).cancelled).toBe(true);
    const resultB = await loadB;
    expect(resultB.cancelled).toBeUndefined();
    expect(resultB.loadedObjects).toBe(1);
    expect(resultB.missingBreakdown.mesh404GeoHashes).toEqual([]);
    expect(layer.getStats().totalVertices).toBeGreaterThan(600);
    expect(mod.isDtxRefnoLoaded(dbno, '1_1')).toBe(false);
    expect(mod.isDtxRefnoLoaded(dbno, '1_2')).toBe(true);
  });
});

describe('装载结果里的 loadedRefnoKeys：这一次新装进来的构件', () => {
  it('只列这一次新装的；已经在场景里的不列；挂到属主 BRAN 名下的直段把 BRAN 也列上', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const dbno = freshDbno();
    // 基础几何 1 / 2 / 3 不用取网格
    mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(asked.map((refno) => {
      if (refno === '1_10') {
        // 管件自己有几何，另带一段挂在属主 BRAN 名下的直段
        return [refno, [entry(refno, '1', { noun: 'ELBO' }), entry(refno, '2', { noun: 'TUBI', owner_refno: '1_9', owner_noun: 'BRAN' })]];
      }
      return [refno, [entry(refno, '3')]];
    })));

    const first = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2'], { dataSource: 'gen-model-v1' });
    expect([...first.loadedRefnoKeys!].sort()).toEqual(['1_1', '1_2']);

    const second = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_2', '1_3', '1_10'], { dataSource: 'gen-model-v1' });
    expect([...second.loadedRefnoKeys!].sort()).toEqual(['1_10', '1_3', '1_9']);
    expect(second).toMatchObject({ loadedRefnos: 2, skippedRefnos: 1 });
  });
});
