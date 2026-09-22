import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BoxGeometry, Matrix4 } from 'three';

import { DtxCompatScene } from './DtxCompatViewer';

import { DTXLayer } from '@/utils/three/dtx';

const {
  hasDtxDbnoCacheMock,
  resolveDtxObjectIdsByRefnoMock,
  resolveDtxTubeObjectIdsByKeysMock,
  markDtxTubeSegmentsHiddenMock,
  clearDtxTubeSegmentOverridesMock,
  tryGetDbnumByRefnoMock,
} = vi.hoisted(() => ({
  hasDtxDbnoCacheMock: vi.fn(),
  resolveDtxObjectIdsByRefnoMock: vi.fn(),
  resolveDtxTubeObjectIdsByKeysMock: vi.fn(),
  markDtxTubeSegmentsHiddenMock: vi.fn(),
  clearDtxTubeSegmentOverridesMock: vi.fn(),
  tryGetDbnumByRefnoMock: vi.fn(),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  hasDtxDbnoCache: hasDtxDbnoCacheMock,
  resolveDtxObjectIdsByRefno: resolveDtxObjectIdsByRefnoMock,
  resolveDtxObjectIdsByUnitRefno: vi.fn(() => []),
  resolveDtxTubeObjectIdsByKeys: resolveDtxTubeObjectIdsByKeysMock,
  markDtxTubeSegmentsHidden: markDtxTubeSegmentsHiddenMock,
  clearDtxTubeSegmentOverrides: clearDtxTubeSegmentOverridesMock,
}));

vi.mock('@/composables/useDbMetaInfo', () => ({
  tryGetDbnumByRefno: tryGetDbnumByRefnoMock,
}));

describe('DtxCompatScene', () => {
  beforeEach(() => {
    hasDtxDbnoCacheMock.mockReset();
    hasDtxDbnoCacheMock.mockReturnValue(false);
    resolveDtxObjectIdsByRefnoMock.mockReset();
    resolveDtxObjectIdsByRefnoMock.mockReturnValue([]);
    resolveDtxTubeObjectIdsByKeysMock.mockReset();
    resolveDtxTubeObjectIdsByKeysMock.mockReturnValue([]);
    markDtxTubeSegmentsHiddenMock.mockReset();
    clearDtxTubeSegmentOverridesMock.mockReset();
    tryGetDbnumByRefnoMock.mockReset();
    tryGetDbnumByRefnoMock.mockReturnValue(100);
  });

  it('能从已加载 objectId 推导当前可框选的 refno 列表', () => {
    const layer = new DTXLayer({
      maxVertices: 128,
      maxIndices: 256,
      maxObjects: 8,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('o:100_1:0', 'box', new Matrix4());
    layer.addObject('o:100_1:1', 'box', new Matrix4().makeTranslation(2, 0, 0));
    layer.addObject('o:100_2:0', 'box', new Matrix4().makeTranslation(4, 0, 0));
    layer.addObject('demo:0', 'box', new Matrix4().makeTranslation(6, 0, 0));

    const scene = new DtxCompatScene({ dtxLayer: layer });

    expect(scene.getLoadedRefnos()).toEqual(['100_1', '100_2', 'demo:0']);
  });

  it('对非 refno 风格 objectId 也能作为可框选目标返回并计算 AABB', () => {
    const layer = new DTXLayer({
      maxVertices: 128,
      maxIndices: 256,
      maxObjects: 8,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('demo:0', 'box', new Matrix4().makeTranslation(6, 0, 0));

    const scene = new DtxCompatScene({ dtxLayer: layer });

    expect(scene.getLoadedRefnos()).toEqual(['demo:0']);
    expect(scene.getAABB(['demo:0'])).toEqual([5.5, -0.5, -0.5, 6.5, 0.5, 0.5]);
  });

  it('在缺少 db_meta 映射时也能从已加载 objectId 回退解析 refno 选中', () => {
    tryGetDbnumByRefnoMock.mockReturnValue(null);

    const layer = new DTXLayer({
      maxVertices: 128,
      maxIndices: 256,
      maxObjects: 8,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('o:100_1:0', 'box', new Matrix4());
    layer.addObject('o:100_1:1', 'box', new Matrix4().makeTranslation(2, 0, 0));

    const selection = {
      select: vi.fn(),
      deselect: vi.fn(),
      clearSelection: vi.fn(),
    } as any;

    const scene = new DtxCompatScene({ dtxLayer: layer, selection });

    scene.setObjectsSelected(['100_1'], true);

    expect(scene.selectedObjectIds).toEqual(['100_1']);
    expect(selection.select).toHaveBeenCalledWith(['o:100_1:0', 'o:100_1:1'], true);
    expect(scene.getAABB(['100_1'])).toEqual([-0.5, -0.5, -0.5, 2.5, 0.5, 0.5]);
  });

  it('XRayed 只降低非目标对象透明度，不会隐藏它们', () => {
    const layer = new DTXLayer({
      maxVertices: 128,
      maxIndices: 256,
      maxObjects: 8,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('o:100_1:0', 'box', new Matrix4());
    layer.addObject('o:100_2:0', 'box', new Matrix4().makeTranslation(4, 0, 0));

    const scene = new DtxCompatScene({ dtxLayer: layer });

    scene.setObjectsXRayed(['100_2'], true);

    expect(scene.objects['100_2']?.xrayed).toBe(true);
    expect(scene.objects['100_2']?.visible).toBe(true);
    expect(layer.isObjectVisible('o:100_2:0')).toBe(true);
    expect(layer.getObjectOpacity('o:100_2:0')).toBeLessThan(1);
    expect(layer.getObjectOpacity('o:100_1:0')).toBe(1);
  });

  it('清除 XRayed 不会把原本隐藏的对象重新显示出来', () => {
    const layer = new DTXLayer({
      maxVertices: 128,
      maxIndices: 256,
      maxObjects: 8,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('o:100_1:0', 'box', new Matrix4());
    layer.addObject('o:100_2:0', 'box', new Matrix4().makeTranslation(4, 0, 0));

    const scene = new DtxCompatScene({ dtxLayer: layer });

    scene.setObjectsVisible(['100_2'], false);
    scene.setObjectsXRayed(['100_2'], true);
    scene.setObjectsXRayed(['100_2'], false);

    expect(scene.objects['100_2']?.visible).toBe(false);
    expect(scene.objects['100_2']?.xrayed).toBe(false);
    expect(layer.isObjectVisible('o:100_2:0')).toBe(false);
    expect(layer.getObjectOpacity('o:100_2:0')).toBe(1);
  });

  it('按需加载对象会回放 XRayed 透明度，而不是直接隐藏', () => {
    const layer = new DTXLayer({
      maxVertices: 128,
      maxIndices: 256,
      maxObjects: 8,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('o:100_1:0', 'box', new Matrix4());

    const scene = new DtxCompatScene({ dtxLayer: layer });

    scene.setObjectsXRayed(['100_2'], true);
    layer.addObject('o:100_2:0', 'box', new Matrix4().makeTranslation(4, 0, 0));
    scene.applyStateToRefnos(['100_2'], { forceVisible: true });

    expect(scene.objects['100_2']?.visible).toBe(true);
    expect(scene.objects['100_2']?.xrayed).toBe(true);
    expect(layer.isObjectVisible('o:100_2:0')).toBe(true);
    expect(layer.getObjectOpacity('o:100_2:0')).toBeLessThan(1);
  });

  it('逐段眼睛（方案 B T4）：setTubeSegmentsVisible 按直段键只藏那一个直管对象、不进 refno 状态表、覆盖表只记作用到的键；refno 级 setObjectsVisible / 显隐回放一来整条覆盖并清掉该 BRAN 的覆盖', () => {
    const layer = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 8 });
    layer.addGeometry('box', new BoxGeometry(1, 1, 1));
    layer.addObject('o:100_1:0', 'box', new Matrix4());
    layer.addObject('o:100_1:1', 'box', new Matrix4().makeTranslation(2, 0, 0));
    layer.addObject('o:100_1:2', 'box', new Matrix4().makeTranslation(4, 0, 0));
    resolveDtxObjectIdsByRefnoMock.mockImplementation((_dbno: number, refno: string) => (refno === '100_1' ? ['o:100_1:0', 'o:100_1:1', 'o:100_1:2'] : []));
    hasDtxDbnoCacheMock.mockReturnValue(true);
    const index = new Map([['100_1#100_5-100_6#0', 'o:100_1:1'], ['100_1#100_6-100_7#0', 'o:100_1:2']]);
    resolveDtxTubeObjectIdsByKeysMock.mockImplementation((keys: string[]) => keys.map((key) => index.get(key)).filter((id): id is string => !!id));

    const scene = new DtxCompatScene({ dtxLayer: layer });
    scene.ensureRefnos(['100_1'], { computeAabb: false });

    // 藏一段：只那一个对象隐、别的两个照旧；refno 状态仍 visible；覆盖表只记作用到的键（没装进来的键不记）
    expect(scene.setTubeSegmentsVisible(['100_1#100_5-100_6#0', '100_1#nope-x#0'], false)).toEqual(['100_1#100_5-100_6#0']);
    expect(layer.isObjectVisible('o:100_1:1')).toBe(false);
    expect(layer.isObjectVisible('o:100_1:0')).toBe(true);
    expect(layer.isObjectVisible('o:100_1:2')).toBe(true);
    expect(scene.objects['100_1']?.visible).toBe(true);
    expect(markDtxTubeSegmentsHiddenMock).toHaveBeenLastCalledWith(['100_1#100_5-100_6#0'], true);
    expect(scene.isTubeSegmentVisible('100_1#100_5-100_6#0')).toBe(false);
    expect(scene.isTubeSegmentVisible('100_1#100_6-100_7#0')).toBe(true);
    expect(scene.isTubeSegmentVisible('100_1#nope-x#0'), '没装进来的键').toBeNull();
    // 全没装进来：不动、不记
    markDtxTubeSegmentsHiddenMock.mockClear();
    expect(scene.setTubeSegmentsVisible(['100_1#nope-x#0'], false)).toEqual([]);
    expect(markDtxTubeSegmentsHiddenMock).not.toHaveBeenCalled();

    // refno 级显示：整条 BRAN（含被单独藏起来的那段）都亮回来，覆盖按 BRAN 清
    scene.setObjectsVisible(['100_1'], true);
    expect(layer.isObjectVisible('o:100_1:1')).toBe(true);
    expect(clearDtxTubeSegmentOverridesMock).toHaveBeenLastCalledWith(['100_1']);

    // 再藏一段，然后 refno 级隐藏 + 回放（applyStateToRefnos 只对真写了显隐的 refno 清覆盖）
    scene.setTubeSegmentsVisible(['100_1#100_6-100_7#0'], false);
    clearDtxTubeSegmentOverridesMock.mockClear();
    scene.setObjectsVisible(['100_1'], false);
    expect(clearDtxTubeSegmentOverridesMock).toHaveBeenLastCalledWith(['100_1']);
    clearDtxTubeSegmentOverridesMock.mockClear();
    scene.applyStateToRefnos(['100_1']);
    expect(clearDtxTubeSegmentOverridesMock).toHaveBeenLastCalledWith(['100_1']);
    // 可见且不 forceVisible 的回放没写显隐：不清覆盖
    scene.objects['100_1']!.visible = true;
    clearDtxTubeSegmentOverridesMock.mockClear();
    scene.applyStateToRefnos(['100_1']);
    expect(clearDtxTubeSegmentOverridesMock).toHaveBeenLastCalledWith([]);
  });
});
