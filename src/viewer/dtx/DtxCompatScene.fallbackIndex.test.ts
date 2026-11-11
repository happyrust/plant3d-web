/**
 * `DtxCompatScene` 的兜底索引（库映射里查不到这个 refno 时，按 `o:<refno>:<n>` 扫图层里的对象）。
 * 它是增量建的，原来默认「对象只增不减」；图层现在会真的拿掉对象（2026-11-11：重载换下来的旧对象、加载中叫停
 * 收回去的），拿掉之后要认得出来、整个重建，不然新加的对象查不到、拿掉的对象还查得到。
 */
import { describe, expect, it, vi } from 'vitest';

import { BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three';

import { DtxCompatScene } from './DtxCompatViewer';

import { DTXLayer } from '@/utils/three/dtx/DTXLayer';

// 库映射里查不到：走兜底索引
vi.mock('@/composables/useDbMetaInfo', () => ({ tryGetDbnumByRefno: () => null }));
vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  hasDtxDbnoCache: () => false,
  resolveDtxObjectIdsByRefno: () => [],
  resolveDtxObjectIdsByUnitRefno: () => [],
  resolveDtxRefnosByUnitRefno: () => [],
}));

function triangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

const at = (x: number) => new Matrix4().makeTranslation(x, 0, 0);

function makeScene() {
  const layer = new DTXLayer({ maxVertices: 64, maxIndices: 128, maxObjects: 8 });
  layer.addGeometry('tri', triangle());
  layer.addObject('o:1_1:0', 'tri', at(0), new Color(1, 0, 0));
  layer.addObject('o:1_2:1', 'tri', at(10), new Color(0, 1, 0));
  layer.addObject('o:1_3:2', 'tri', at(20), new Color(0, 0, 1));
  layer.compile();
  return { layer, scene: new DtxCompatScene({ dtxLayer: layer }) };
}

/** 这个 refno 的对象盒的最小 x（查不到是 null） */
const minX = (scene: DtxCompatScene, refno: string): number | null => scene.getAABB([refno])?.[0] ?? null;

describe('DtxCompatScene 兜底索引', () => {
  it('只增不减：后加的对象增量进索引', () => {
    const { layer, scene } = makeScene();
    expect(minX(scene, '1_3')).toBe(20);

    layer.addObject('o:1_4:3', 'tri', at(30), new Color(1, 1, 0));
    layer.recompile();

    expect(minX(scene, '1_4')).toBe(30);
    expect(minX(scene, '1_1')).toBe(0);
  });

  it('拿掉一个再加一个（对象数没变）：新加的查得到，拿掉的查不到', () => {
    const { layer, scene } = makeScene();
    expect(minX(scene, '1_2')).toBe(10);

    layer.removeObjects(['o:1_2:1']);
    layer.addObject('o:1_4:3', 'tri', at(30), new Color(1, 1, 0));
    layer.recompile();

    expect(minX(scene, '1_4')).toBe(30);
    expect(minX(scene, '1_2')).toBeNull();
    expect(minX(scene, '1_3')).toBe(20);
  });

  it('整套替换（先加新的、再拿掉旧的）：同一个 refno 只剩新对象', () => {
    const { layer, scene } = makeScene();
    expect(minX(scene, '1_1')).toBe(0);

    layer.addObject('o:1_1:3', 'tri', at(100), new Color(1, 0, 0));
    layer.removeObjects(['o:1_1:0']);
    layer.recompile();

    expect(minX(scene, '1_1')).toBe(100);
  });

  it('只拿掉（对象数变少）：拿掉的不再查得到', () => {
    const { layer, scene } = makeScene();
    expect(minX(scene, '1_3')).toBe(20);

    layer.removeObjects(['o:1_3:2']);
    layer.recompile();

    expect(minX(scene, '1_3')).toBeNull();
    expect(minX(scene, '1_1')).toBe(0);
  });
});
