import { describe, expect, it } from 'vitest';

import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from 'three';

import { DTXLayer } from './DTXLayer';

function makeUnitCylinderGeo(): BufferGeometry {
  const geo = new BufferGeometry();
  const positions = new Float32Array([
    -50, 0, 0, 50, 0, 0, 0, 50, 0, 0, -50, 0,
    -50, 0, 1, 50, 0, 1, 0, 50, 1, 0, -50, 1,
  ]);
  const indices = new Uint32Array([
    0, 1, 4, 1, 5, 4,
    1, 2, 5, 2, 6, 5,
    2, 3, 6, 3, 7, 6,
    3, 0, 7, 0, 4, 7,
  ]);
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setIndex(new BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

describe('DTXLayer.setObjectMatrix & getGeometryRawSlice', () => {
  it('synchronizes _matricesBuffer, _matricesTexture.image.data (4 rows), and obj.boundingBox without recompile', () => {
    const layer = new DTXLayer({ maxVertices: 256, maxIndices: 512, maxObjects: 64 });
    layer.addGeometry('cyl_v3', makeUnitCylinderGeo());

    const origMat = new Matrix4().makeTranslation(100, 200, 300).scale(new Vector3(1, 1, 2000));
    layer.addObject('o:24381_1200:0', 'cyl_v3', origMat, new Color(0x94a3b8));
    layer.compile();

    const beforeBox = layer.getObject('o:24381_1200:0')!.boundingBox.clone();
    expect(beforeBox.min.z).toBeCloseTo(300, 3);
    expect(beforeBox.max.z).toBeCloseTo(2300, 3);

    // 截断为前半段 [0, 0.5]：长度从 2000 缩为 1000
    const clippedMat = new Matrix4().makeTranslation(100, 200, 300).scale(new Vector3(1, 1, 1000));
    layer.setObjectMatrix('o:24381_1200:0', clippedMat);

    const readBack = layer.getObjectMatrix('o:24381_1200:0')!;
    expect(readBack.elements[10]).toBeCloseTo(1000, 3);

    const afterBox = layer.getObject('o:24381_1200:0')!.boundingBox;
    expect(afterBox.min.z).toBeCloseTo(300, 3);
    expect(afterBox.max.z).toBeCloseTo(1300, 3);

    const matricesTex = (layer as unknown as { _matricesTexture: { image: { data: Float32Array }; version: number } })._matricesTexture;
    expect(matricesTex.version).toBeGreaterThan(0);
    // 第 0 个对象的第 2 列（row = 2）第 2 分量是 Z 缩放 = 1000
    const width = 512; // OBJECTS_TEXTURE_WIDTH
    const row2Offset = (2 * width + 0) * 4;
    expect(matricesTex.image.data[row2Offset + 2]).toBeCloseTo(1000, 3);

    const rawSlice = layer.getGeometryRawSlice('cyl_v3');
    expect(rawSlice).not.toBeNull();
    expect(rawSlice!.positions.length).toBe(24);
    expect(rawSlice!.indices.length).toBe(24);
  });
});