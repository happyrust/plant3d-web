import { describe, expect, it } from 'vitest';

import { Box3, BoxGeometry, Matrix4, Vector3 } from 'three';

import { DTXLayer } from './DTXLayer';

/**
 * 云线空间范围体 P2 首项（方案 §4.1 / §15 ①）：`getObjectLocalBoxAndWorldMatrixInto`
 * 给出「几何局部盒 + global × instance 世界矩阵」这一对，与 `getObjectBoundingBoxInto`（可能是服务端预算 AABB）分开。
 */

function createLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(2, 4, 6)); // 局部盒 [-1,-2,-3] ~ [1,2,3]
  return layer;
}

describe('DTXLayer.getObjectLocalBoxAndWorldMatrixInto', () => {
  it('局部盒取几何全顶点扫描结果，世界矩阵 = global × instance（只乘一次）', () => {
    const layer = createLayer();
    const instance = new Matrix4().makeRotationZ(Math.PI / 2).setPosition(10, 20, 30);
    layer.addObject('o:1', 'box', instance);
    layer.setGlobalModelMatrix(new Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(1, 2, 3));

    const localBox = new Box3();
    const world = new Matrix4();
    expect(layer.getObjectLocalBoxAndWorldMatrixInto('o:1', localBox, world)).toBe(true);
    expect(localBox.min.toArray()).toEqual([-1, -2, -3]);
    expect(localBox.max.toArray()).toEqual([1, 2, 3]);

    const expected = layer.getGlobalModelMatrix().multiply(instance);
    expect(world.elements.map((v) => +v.toFixed(9))).toEqual(expected.elements.map((v) => +v.toFixed(9)));

    // 局部盒角点 × 世界矩阵 应落在（同一 global 下的）世界 AABB 内
    const worldAabb = layer.getObjectBoundingBoxInto('o:1', new Box3())!;
    const corner = new Vector3(1, 2, 3).applyMatrix4(world);
    expect(worldAabb.containsPoint(corner)).toBe(true);
  });

  it('服务端预算 AABB 不影响局部盒（它只进 obj.boundingBox）', () => {
    const layer = createLayer();
    layer.addObject('o:pre', 'box', new Matrix4(), undefined, {}, { min: [-1.5, -2.5, -3.5], max: [1.5, 2.5, 3.5] });
    const localBox = new Box3();
    const world = new Matrix4();
    expect(layer.getObjectLocalBoxAndWorldMatrixInto('o:pre', localBox, world)).toBe(true);
    expect(localBox.min.toArray()).toEqual([-1, -2, -3]);
    expect(localBox.max.toArray()).toEqual([1, 2, 3]);
    // 而世界 AABB 用的是预算盒
    const worldAabb = layer.getObjectBoundingBoxInto('o:pre', new Box3())!;
    expect(worldAabb.min.toArray()).toEqual([-1.5, -2.5, -3.5]);
  });

  it('对象不存在返回 false 且不改写入参', () => {
    const layer = createLayer();
    const localBox = new Box3(new Vector3(7, 7, 7), new Vector3(8, 8, 8));
    const world = new Matrix4().makeTranslation(5, 5, 5);
    expect(layer.getObjectLocalBoxAndWorldMatrixInto('missing', localBox, world)).toBe(false);
    expect(localBox.min.toArray()).toEqual([7, 7, 7]);
    expect(world.elements[12]).toBe(5);
  });
});
