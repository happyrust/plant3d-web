/**
 * `DTXLayer.replaceGeometry`：同一个键的几何再装一遍（重载 / 重新生成之后的替换）。
 * 内容没变的不往缓冲里再追加一遍（2026-11-11 第三轮：原来每重载一次，顶点 / 索引缓冲就多出一整份）；
 * 内容变了的照旧追加一份新的并换登记，旧对象仍画旧的那一份。
 */
import { describe, expect, it } from 'vitest';

import { BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three';

import { DTXLayer } from './DTXLayer';

function triangle(points: number[] = [0, 0, 0, 1, 0, 0, 0, 1, 0], index: number[] | null = [0, 1, 2]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
  if (index) geometry.setIndex(index);
  return geometry;
}

function quad(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function makeLayer(): DTXLayer {
  return new DTXLayer({ maxVertices: 64, maxIndices: 128, maxObjects: 4 });
}

describe('DTXLayer.replaceGeometry', () => {
  it('内容一模一样：留着原来那一份，顶点 / 索引总量不涨，句柄不变', () => {
    const layer = makeLayer();
    const first = layer.addGeometry('g', triangle());
    const before = layer.getStats();

    const again = layer.replaceGeometry('g', triangle());

    expect(again).toBe(first);
    expect(layer.getStats()).toMatchObject({ uniqueGeometries: 1 });
    // 连着换三次也一样
    layer.replaceGeometry('g', triangle());
    layer.replaceGeometry('g', triangle());
    layer.addObject('o:1_1:0', 'g', new Matrix4(), new Color(1, 0, 0));
    layer.compile();
    expect(layer.getStats()).toMatchObject({ totalVertices: 3, totalIndices: 3, uniqueGeometries: 1 });
    expect(before.uniqueGeometries).toBe(1);
  });

  it('内容一模一样时粗网格也留着（不用重新补拉）', () => {
    const layer = makeLayer();
    layer.addGeometry('g', quad());
    expect(layer.addLod1Geometry('g', triangle())).toBe(true);

    layer.replaceGeometry('g', quad());

    expect(layer.hasLod1Geometry('g')).toBe(true);
  });

  it('顶点动了一个：追加一份新的并换登记；先加的对象仍画旧的那一份，后加的画新的', () => {
    const layer = makeLayer();
    const first = layer.addGeometry('g', triangle());
    layer.addObject('o:1_1:0', 'g', new Matrix4(), new Color(1, 0, 0));

    const second = layer.replaceGeometry('g', triangle([0, 0, 0, 2, 0, 0, 0, 1, 0]));
    layer.addObject('o:1_2:1', 'g', new Matrix4(), new Color(0, 1, 0));
    layer.compile();

    expect(second).not.toBe(first);
    expect(second.vertexBase).toBe(first.vertexBase + first.vertexCount);
    expect(layer.getStats()).toMatchObject({ totalVertices: 6, totalIndices: 6, uniqueGeometries: 1 });
    expect(layer.getObject('o:1_1:0')!.vertexBase).toBe(first.vertexBase);
    expect(layer.getObject('o:1_2:1')!.vertexBase).toBe(second.vertexBase);
  });

  it('顶点数或索引不一样：都算变了', () => {
    const layer = makeLayer();
    const first = layer.addGeometry('g', triangle());

    const moreVertices = layer.replaceGeometry('g', quad());
    expect(moreVertices).not.toBe(first);

    const otherIndex = layer.replaceGeometry('g', (() => {
      const geometry = quad();
      geometry.setIndex([0, 1, 2, 0, 3, 2]);
      return geometry;
    })());
    expect(otherIndex).not.toBe(moreVertices);
  });

  it('不带索引的几何（按顺序画）和它自己比也是一样的', () => {
    const layer = makeLayer();
    const first = layer.addGeometry('g', triangle(undefined, null));

    expect(layer.replaceGeometry('g', triangle(undefined, null))).toBe(first);
    // 同样三个点、带顺序索引 0 1 2：缓冲里存的就是这个，算一样
    expect(layer.replaceGeometry('g', triangle())).toBe(first);
  });

  it('带法线的：法线变了也算变了', () => {
    const layer = makeLayer();
    const withNormal = (nz: number): BufferGeometry => {
      const geometry = triangle();
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, nz, 0, 0, nz, 0, 0, nz]), 3));
      return geometry;
    };
    const first = layer.addGeometry('g', withNormal(1));

    expect(layer.replaceGeometry('g', withNormal(1))).toBe(first);
    expect(layer.replaceGeometry('g', withNormal(-1))).not.toBe(first);
  });

  it('没登记过的键：等同于新增', () => {
    const layer = makeLayer();

    const handle = layer.replaceGeometry('g', triangle());

    expect(layer.hasGeometry('g')).toBe(true);
    expect(handle.vertexCount).toBe(3);
  });
});
