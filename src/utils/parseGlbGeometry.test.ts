import { describe, expect, it } from 'vitest';

import { parseGlbGeometryResult } from './parseGlbGeometry';

function createTriangleGlb(): ArrayBuffer {
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 44 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const binLength = 44;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const jsonBytes = new Uint8Array(buffer, 20, jsonLength);
  jsonBytes.fill(0x20);
  jsonBytes.set(encodedJson);

  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  const binOffset = binHeader + 8;
  const positions = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ];
  positions.forEach((value, index) => view.setFloat32(binOffset + index * 4, value, true));
  view.setUint16(binOffset + 36, 0, true);
  view.setUint16(binOffset + 38, 1, true);
  view.setUint16(binOffset + 40, 2, true);
  return buffer;
}

describe('parseGlbGeometryResult', () => {
  it('validates the container and returns triangle geometry', async () => {
    const result = await parseGlbGeometryResult(createTriangleGlb(), 'triangle.glb');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.positions).toHaveLength(9);
    expect(result.data.indices).toEqual([0, 1, 2]);
  });

  it('reports a precise source and header offset for a truncated transfer', async () => {
    const whole = createTriangleGlb();
    const result = await parseGlbGeometryResult(
      whole.slice(0, whole.byteLength - 4),
      'truncated.glb',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issue).toMatchObject({
      source: 'truncated.glb',
      format: 'glb',
      reason: 'GLB 声明长度与实际长度不一致',
      byteOffset: 8,
    });
  });
});
