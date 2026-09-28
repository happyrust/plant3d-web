import { describe, expect, it } from 'vitest';

import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

import {
  detectDtxBranchAxisDistances,
  type DtxBranchAxisDistanceLayer,
} from './detectDtxBranchAxisDistances';

type MockObject = {
  geometry: BufferGeometry;
  matrix: Matrix4;
  visible: boolean;
};

function createPipePointCloud(center: Vector3, radius = 0.05, length = 4): BufferGeometry {
  const positions: number[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const z = center.z - length / 2 + (length * i) / steps;
    for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      positions.push(center.x + dx, center.y + dy, z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function createLayer(objects: Record<string, MockObject>): DtxBranchAxisDistanceLayer {
  return {
    hasObject: (objectId) => !!objects[objectId],
    isObjectVisible: (objectId) => objects[objectId]?.visible ?? false,
    getAllObjectIds: () => Object.keys(objects),
    getObjectGeometryData: (objectId) => {
      const object = objects[objectId];
      return object ? { geometry: object.geometry, matrix: object.matrix } : null;
    },
  };
}

describe('detectDtxBranchAxisDistances', () => {
  it('fits visible BRAN geometry and returns centerline spacing in millimeters', () => {
    const layer = createLayer({
      'o:24381_1001:0': {
        geometry: createPipePointCloud(new Vector3(0, 0, 0)),
        matrix: new Matrix4(),
        visible: true,
      },
      'o:24381_1002:0': {
        geometry: createPipePointCloud(new Vector3(2, 0, 0)),
        matrix: new Matrix4(),
        visible: true,
      },
    });

    const results = detectDtxBranchAxisDistances(layer, {
      refnos: ['24381_1001', '24381_1002'],
      maxDistanceMm: 500,
      includeBeyondMaxDistanceForSinglePair: true,
      resolveObjectIdsByRefno: (refno) => [`o:${refno}:0`],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.pipeA).toBe('24381_1001');
    expect(results[0]?.pipeB).toBe('24381_1002');
    expect(results[0]?.distance).toBe(2000);
    expect(results[0]?.start[0]).toBeCloseTo(0, 5);
    expect(results[0]?.end[0]).toBeCloseTo(2, 5);
  });

  it('keeps the max-distance guard when scanning more than an explicit pair', () => {
    const layer = createLayer({
      'o:24381_1001:0': {
        geometry: createPipePointCloud(new Vector3(0, 0, 0)),
        matrix: new Matrix4(),
        visible: true,
      },
      'o:24381_1002:0': {
        geometry: createPipePointCloud(new Vector3(2, 0, 0)),
        matrix: new Matrix4(),
        visible: true,
      },
    });

    const results = detectDtxBranchAxisDistances(layer, {
      refnos: ['24381_1001', '24381_1002'],
      maxDistanceMm: 500,
      includeBeyondMaxDistanceForSinglePair: false,
      resolveObjectIdsByRefno: (refno) => [`o:${refno}:0`],
    });

    expect(results).toEqual([]);
  });
});
