/**
 * 整套替换（重载 / 重新生成）之后旧对象真的从图层里拿掉（方案 2026-11-10 第三轮）。
 * 原来只是隐藏：同一个节点每重载一次，图层里的对象槽就多出一份（1888 件的 ZONE 重载一次变成 3776 个槽）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type InstanceEntryStub = { geo_hash: string; matrix: number[]; uniforms: Record<string, unknown> | null };

const mocks = vi.hoisted(() => ({
  instanceEntriesByRefnos: vi.fn<(dbno: number, refnos: string[]) => Promise<Map<string, InstanceEntryStub[]>>>(async () => new Map()),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    records: { instanceEntriesByRefnos: mocks.instanceEntriesByRefnos },
    meshes: {
      meshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh`,
      lod1MeshUrl: (geoHash: string) => `/api/v1/meshes/${geoHash}.mesh?lod=1`,
    },
  }),
}));

vi.mock('@/composables/useDisplayThemeStore', () => ({
  useDisplayThemeStore: () => ({ currentTheme: { value: 'design3d' } }),
}));

const matrixAt = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

function entry(refno: string, geoHash: string, x = 0, uniforms: Record<string, unknown> = {}): InstanceEntryStub {
  return { geo_hash: geoHash, matrix: matrixAt(x), uniforms: { refno, noun: 'VALV', owner_refno: '', owner_noun: '', spec_value: 0, ...uniforms } };
}

/** 每个构件两个实例（基础几何 1 = 盒子、3 = 球，不用取网格）；`shift` 模拟重载后位置变了 */
function serveTwoPerRefno(shift = 0): void {
  mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(asked.map((refno) => {
    const n = Number(refno.split('_')[1]);
    return [refno, [entry(refno, '1', n * 10 + shift), entry(refno, '3', n * 10 + 5 + shift)]];
  })));
}

async function newLayer() {
  const { DTXLayer } = await import('@/utils/three/dtx');
  return new DTXLayer({ maxVertices: 20_000, maxIndices: 60_000, maxObjects: 64 });
}

let nextDbno = 96_100;
const freshDbno = () => nextDbno++;

const REPLACE = (refnos: string[]) => ({
  dataSource: 'gen-model-v1' as const, forceReloadRefnos: refnos, replaceExistingObjects: true, forceRefreshGeometries: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('整套替换：旧对象拿掉，不是隐藏', () => {
  it('连续重载三次，图层里的对象数稳定不涨；旧对象不在了，构件指到的是新对象', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    const node = ['1_1', '1_2', '1_3'];
    serveTwoPerRefno();
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, node, { dataSource: 'gen-model-v1' });
    expect(layer.getStats().totalObjects).toBe(6);

    for (let round = 1; round <= 3; round += 1) {
      const before = layer.getAllObjectIds();
      serveTwoPerRefno(round);
      const result = await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, node, REPLACE(node));

      expect(result.loadedObjects).toBe(6);
      expect(layer.getStats().totalObjects).toBe(6);
      expect(layer.objectCount).toBe(6);
      expect(layer.getVisibleObjectIds()).toHaveLength(6);
      // 旧对象不在图层里了，装载器的对象索引里也没有它们
      for (const old of before) {
        expect(layer.hasObject(old)).toBe(false);
        expect(mod.resolveDtxRefnoByObjectId(dbno, old)).toBeNull();
      }
      // 构件指到的是新对象，位置是这一次的
      const ids = mod.resolveDtxObjectIdsByRefno(dbno, '1_2');
      expect(ids).toHaveLength(2);
      expect(ids.every((id) => layer.hasObject(id))).toBe(true);
      expect(layer.getObjectMatrix(ids[0]!)!.elements[12]).toBe(20 + round);
    }
  });

  it('没参与替换的构件原样留着：对象、位置、显隐都不变', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    serveTwoPerRefno();
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2', '1_3', '1_4'], { dataSource: 'gen-model-v1' });
    const keptIds = [...mod.resolveDtxObjectIdsByRefno(dbno, '1_1'), ...mod.resolveDtxObjectIdsByRefno(dbno, '1_4')];
    layer.setObjectVisible(keptIds[3]!, false);

    serveTwoPerRefno(7);
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_2', '1_3'], REPLACE(['1_2', '1_3']));

    expect(layer.getStats().totalObjects).toBe(8);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, '1_1')).toEqual(keptIds.slice(0, 2));
    expect(mod.resolveDtxObjectIdsByRefno(dbno, '1_4')).toEqual(keptIds.slice(2));
    expect(keptIds.map((id) => layer.getObjectMatrix(id)!.elements[12])).toEqual([10, 15, 40, 45]);
    expect(keptIds.map((id) => layer.isObjectVisible(id))).toEqual([true, true, true, false]);
    expect(layer.getObjectMatrix(mod.resolveDtxObjectIdsByRefno(dbno, '1_3')[1]!)!.elements[12]).toBe(42);
  });

  it('直段对象（TUBI）被替换后，旧的不再算直管对象', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(asked.map((refno) => [
      refno, [entry(refno, '2', 0, { noun: 'TUBI', owner_refno: refno, owner_noun: 'BRAN', is_tubi: true })],
    ])));
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_9'], { dataSource: 'gen-model-v1' });
    const [oldId] = mod.resolveDtxObjectIdsByRefno(dbno, '1_9');
    expect(mod.isDtxTubiObject(dbno, oldId!)).toBe(true);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_9'], REPLACE(['1_9']));
    const [newId] = mod.resolveDtxObjectIdsByRefno(dbno, '1_9');
    expect(newId).not.toBe(oldId);
    expect(mod.isDtxTubiObject(dbno, newId!)).toBe(true);
    expect(mod.isDtxTubiObject(dbno, oldId!)).toBe(false);
    expect(layer.getStats().totalObjects).toBe(1);
  });

  it('替换没成（要用的网格取不到）：旧对象原样留着，一个都不拿掉', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    serveTwoPerRefno();
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2'], { dataSource: 'gen-model-v1' });
    const before = layer.getAllObjectIds();

    // 新记录引用了一个取不到的网格（请求回 500）
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    mocks.instanceEntriesByRefnos.mockImplementation(async (_dbno, asked) => new Map(asked.map((refno) => [refno, [entry(refno, 'unreachable')]])));
    await expect(mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2'], REPLACE(['1_1', '1_2'])))
      .rejects.toThrow('替换模型所需几何不完整');

    expect(layer.getAllObjectIds()).toEqual(before);
    expect(layer.getVisibleObjectIds()).toEqual(before);
    expect(mod.isDtxRefnoLoaded(dbno, '1_1')).toBe(true);
  });
});

describe('evictDtxRefnos', () => {
  it('缺省只是隐藏（原来的做法）：对象还在图层里', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    serveTwoPerRefno();
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2'], { dataSource: 'gen-model-v1' });

    expect(mod.evictDtxRefnos(layer, dbno, ['1_2'])).toEqual(['1_2']);
    expect(layer.getStats().totalObjects).toBe(4);
    expect(layer.getVisibleObjectIds()).toHaveLength(2);
    expect(mod.isDtxRefnoLoaded(dbno, '1_2')).toBe(false);
  });

  it('release：对象从图层里拿掉并重编；留下的构件不受影响；之后再装回来对象数不多', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    serveTwoPerRefno();
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2', '1_3'], { dataSource: 'gen-model-v1' });
    const kept = mod.resolveDtxObjectIdsByRefno(dbno, '1_2');

    expect(mod.evictDtxRefnos(layer, dbno, ['1_1', '1_3', '9_9'], { release: true })).toEqual(['1_1', '1_3']);
    expect(layer.getStats()).toMatchObject({ totalObjects: 2, compiled: true });
    expect(layer.getAllObjectIds()).toEqual(kept);
    expect(layer.getObjectMatrix(kept[1]!)!.elements[12]).toBe(25);
    expect(mod.isDtxRefnoLoaded(dbno, '1_1')).toBe(false);
    expect(mod.isDtxRefnoLoaded(dbno, '1_2')).toBe(true);
    expect(mod.resolveDtxObjectIdsByRefno(dbno, '1_1')).toEqual([]);

    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1', '1_2', '1_3'], { dataSource: 'gen-model-v1' });
    expect(layer.getStats().totalObjects).toBe(6);
    expect(mod.isDtxRefnoLoaded(dbno, '1_3')).toBe(true);
  });

  it('release 但这些构件本来就没有对象：不重编', async () => {
    const mod = await import('./useDbnoInstancesDtxLoader');
    const layer = await newLayer();
    const dbno = freshDbno();
    serveTwoPerRefno();
    await mod.loadDbnoInstancesForVisibleRefnosDtx(layer, dbno, ['1_1'], { dataSource: 'gen-model-v1' });
    const recompile = vi.spyOn(layer, 'recompile');

    expect(mod.evictDtxRefnos(layer, dbno, ['7_7'], { release: true })).toEqual([]);
    expect(recompile).not.toHaveBeenCalled();
    expect(layer.getStats().totalObjects).toBe(1 * 2);
  });
});
