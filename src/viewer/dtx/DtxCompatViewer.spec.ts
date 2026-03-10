import { describe, expect, it, vi } from 'vitest';

import { BoxGeometry, Matrix4 } from 'three';

import { DtxCompatScene } from './DtxCompatViewer';

import { DTXLayer } from '@/utils/three/dtx';

vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  hasDtxDbnoCache: () => false,
  resolveDtxObjectIdsByRefno: () => [],
}));

vi.mock('@/composables/useDbMetaInfo', () => ({
  tryGetDbnumByRefno: () => 100,
}));

describe('DtxCompatScene', () => {
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
});
