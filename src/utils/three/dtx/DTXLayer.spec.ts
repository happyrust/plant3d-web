import { describe, expect, it } from 'vitest';

import { BoxGeometry, BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three';

import { DTXLayer } from './DTXLayer';

function createTriangleGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]), 3),
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

describe('DTXLayer.raycastObject', () => {
  it('应用 globalModelMatrix 后仍能命中对象三角形', () => {
    const layer = new DTXLayer({
      maxVertices: 16,
      maxIndices: 16,
      maxObjects: 4,
    });

    layer.addGeometry('tri', createTriangleGeometry());
    layer.addObject('o:100_1:0', 'tri', new Matrix4());
    layer.setGlobalModelMatrix(new Matrix4().makeTranslation(10, 20, 30));

    const hit = layer.raycastObject(
      'o:100_1:0',
      new Vector3(10.2, 20.2, 31),
      new Vector3(0, 0, -1),
    );

    expect(hit).not.toBeNull();
    expect(hit?.point.x).toBeCloseTo(10.2, 6);
    expect(hit?.point.y).toBeCloseTo(20.2, 6);
    expect(hit?.point.z).toBeCloseTo(30, 6);
  });
});

describe('DTXLayer bounding boxes', () => {
  it('当预计算 AABB 与实例矩阵明显不一致时回退到动态世界包围盒', () => {
    const layer = new DTXLayer({
      maxVertices: 64,
      maxIndices: 128,
      maxObjects: 4,
    });

    layer.addGeometry('box', new BoxGeometry(1, 1, 1));

    const matrix = new Matrix4().compose(
      new Vector3(1000, 2000, 3000),
      new Quaternion(),
      new Vector3(100, 200, 50),
    );

    layer.addObject(
      'o:test:0',
      'box',
      matrix,
      undefined,
      {},
      {
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
    );

    const bbox = layer.getObjectBoundingBox('o:test:0');

    expect(bbox).not.toBeNull();
    expect(bbox?.min.x).toBeCloseTo(950, 6);
    expect(bbox?.max.x).toBeCloseTo(1050, 6);
    expect(bbox?.min.y).toBeCloseTo(1900, 6);
    expect(bbox?.max.y).toBeCloseTo(2100, 6);
    expect(bbox?.min.z).toBeCloseTo(2975, 6);
    expect(bbox?.max.z).toBeCloseTo(3025, 6);
  });
});

describe('DTXLayer.getObjectGeometryData', () => {
  it('遇到包含 NaN 顶点的几何体时应跳过 outline 几何构建', () => {
    const layer = new DTXLayer({
      maxVertices: 16,
      maxIndices: 16,
      maxObjects: 4,
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([
        Number.NaN, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]), 3),
    );
    geometry.setIndex([0, 1, 2]);

    layer.addGeometry('bad-tri', geometry);
    layer.addObject('o:bad:0', 'bad-tri', new Matrix4());

    expect(layer.getObjectGeometryData('o:bad:0')).toBeNull();
  });
});
