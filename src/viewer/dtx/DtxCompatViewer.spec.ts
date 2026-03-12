import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BoxGeometry, Matrix4 } from 'three';

import { DtxCompatScene } from './DtxCompatViewer';

import { DTXLayer } from '@/utils/three/dtx';

const {
  hasDtxDbnoCacheMock,
  resolveDtxObjectIdsByRefnoMock,
  tryGetDbnumByRefnoMock,
} = vi.hoisted(() => ({
  hasDtxDbnoCacheMock: vi.fn(),
  resolveDtxObjectIdsByRefnoMock: vi.fn(),
  tryGetDbnumByRefnoMock: vi.fn(),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  hasDtxDbnoCache: hasDtxDbnoCacheMock,
  resolveDtxObjectIdsByRefno: resolveDtxObjectIdsByRefnoMock,
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
});
