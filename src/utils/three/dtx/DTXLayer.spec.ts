import { describe, expect, it } from 'vitest';

import { BoxGeometry, BufferAttribute, BufferGeometry, Matrix4, Quaternion, Scene, Vector3 } from 'three';

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
  it('直接信任合法的服务端预计算 world_aabb，仅在预计算盒退化或越界时回退动态世界包围盒', () => {
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

    // 1b78523a：有限、非空且尺寸在 1e-6..1e6 内的服务端 world_aabb 直接采用，不扫全量顶点
    layer.addObject(
      'o:trusted:0',
      'box',
      matrix,
      undefined,
      {},
      {
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
    );
    const trusted = layer.getObjectBoundingBox('o:trusted:0');
    expect(trusted).not.toBeNull();
    expect(trusted?.min.x).toBeCloseTo(-0.5, 6);
    expect(trusted?.max.x).toBeCloseTo(0.5, 6);

    // 退化或非法的预计算 AABB（例如零体积点盒）自动回退到按网格与实例矩阵计算的动态世界包围盒
    layer.addObject(
      'o:fallback:0',
      'box',
      matrix,
      undefined,
      {},
      {
        min: [0, 0, 0],
        max: [0, 0, 0],
      },
    );
    const fallback = layer.getObjectBoundingBox('o:fallback:0');
    expect(fallback).not.toBeNull();
    expect(fallback?.min.x).toBeCloseTo(950, 6);
    expect(fallback?.max.x).toBeCloseTo(1050, 6);
    expect(fallback?.min.y).toBeCloseTo(1900, 6);
    expect(fallback?.max.y).toBeCloseTo(2100, 6);
    expect(fallback?.min.z).toBeCloseTo(2975, 6);
    expect(fallback?.max.z).toBeCloseTo(3025, 6);
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

describe('DTXLayer render passes', () => {
  it('does not draw the transparent pass when every object is opaque', () => {
    const layer = new DTXLayer({ maxVertices: 16, maxIndices: 16, maxObjects: 4 });
    const scene = new Scene();
    layer.addGeometry('tri', createTriangleGeometry());
    layer.addObject('o:test:0', 'tri', new Matrix4());
    layer.compile();
    layer.addToScene(scene);

    expect(scene.getObjectByName('DTXLayer')?.visible).toBe(true);
    expect(scene.getObjectByName('DTXLayerTransparent')?.visible).toBe(false);

    layer.setObjectsOpacity(['o:test:0'], 0.5);
    expect(scene.getObjectByName('DTXLayer')?.visible).toBe(false);
    expect(scene.getObjectByName('DTXLayerTransparent')?.visible).toBe(true);
  });
});
