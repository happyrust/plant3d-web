import { describe, expect, it } from 'vitest';

import { DtxDimensionSnapPort } from './dtxDimensionSnapPort';

import type { ViewerSnapCandidate } from './dtxDimensionSnapPort';

const candidates: readonly ViewerSnapCandidate[] = [
  {
    id: 'mesh',
    source: 'mesh_pick_point',
    sceneWorld: [4, 0, 0],
    refno: 'MESH',
    distancePx: 1,
  },
  {
    id: 'position',
    source: 'position',
    sceneWorld: [3, 0, 0],
    refno: 'POS',
    distancePx: 3,
  },
  {
    id: 'ptset',
    source: 'ptset',
    sceneWorld: [2, 0, 0],
    refno: 'PT',
    distancePx: 7,
  },
  {
    id: 'primitive',
    source: 'primitive_key_point',
    sceneWorld: [1, 0, 0],
    refno: 'PRIM',
    distancePx: 9,
  },
];

describe('DtxDimensionSnapPort', () => {
  it('maps source semantics and sorts by the shared measurement priorities', () => {
    const port = new DtxDimensionSnapPort({
      queryMeasurementCandidates: () => candidates,
      sceneWorldToDesignMetres: point => point,
    });

    const result = port.query({
      screen: { x: 50, y: 60 },
      capabilities: ['point'],
      thresholdPx: 10,
    });

    expect(result.map(candidate => candidate.id)).toEqual([
      'primitive',
      'ptset',
      'position',
      'mesh',
    ]);
    expect(result.map(candidate => [
      candidate.anchor.semanticRef?.source,
      candidate.anchor.accuracy,
    ])).toEqual([
      ['primitive-key-point', 'exact'],
      ['p-point', 'exact'],
      ['instance-origin', 'exact'],
      ['model-surface', 'approximate'],
    ]);
  });

  it('filters by threshold and requested capabilities', () => {
    const port = new DtxDimensionSnapPort({
      queryMeasurementCandidates: () => candidates,
      sceneWorldToDesignMetres: point => point,
    });

    expect(port.query({
      screen: { x: 0, y: 0 },
      capabilities: ['point'],
      thresholdPx: 4,
    }).map(candidate => candidate.id)).toEqual(['position', 'mesh']);
    expect(port.query({
      screen: { x: 0, y: 0 },
      capabilities: ['direction'],
      thresholdPx: 20,
    })).toEqual([]);
  });

  it('maps exact circle geometry without inferring it from a mesh hit', () => {
    const port = new DtxDimensionSnapPort({
      queryMeasurementCandidates: () => [
        {
          id: 'circle-1',
          source: 'primitive_key_point',
          sceneWorld: [1, 0, 0],
          refno: 'CIRCLE',
          label: 'Pipe circle',
          distancePx: 2,
          circle: {
            center: [1, 2, 3],
            rim: [2, 2, 3],
            normal: [0, 0, 1],
          },
        },
        candidates[0],
      ],
      sceneWorldToDesignMetres: point => [
        point[0] * 0.001,
        point[1] * 0.001,
        point[2] * 0.001,
      ],
    });

    const result = port.query({
      screen: { x: 0, y: 0 },
      capabilities: ['circle'],
      thresholdPx: 10,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'circle-1:circle',
        capability: 'circle',
        anchor: expect.objectContaining({
          snapshot: [0.001, 0.002, 0.003],
          accuracy: 'exact',
          semanticRef: expect.objectContaining({ source: 'circle' }),
        }),
        direction: [0.001, 0, 0],
        normal: [0, 0, 0.001],
      }),
    ]);
  });

  it('preserves primitive directions and exact arc metadata in design units', () => {
    const port = new DtxDimensionSnapPort({
      queryMeasurementCandidates: () => [{
        id: 'primitive-arc',
        source: 'primitive_key_point',
        sceneWorld: [1000, 0, 0],
        refno: 'ARC',
        distancePx: 1,
        direction: [0, 1000, 0],
        arc: {
          center: [1000, 2000, 0],
          rim: [2000, 2000, 0],
          normal: [0, 0, 1],
        },
      }],
      sceneWorldToDesignMetres: point => [
        point[0] * 0.001,
        point[1] * 0.001,
        point[2] * 0.001,
      ],
    });

    expect(port.query({
      screen: { x: 0, y: 0 },
      capabilities: ['direction', 'arc'],
      thresholdPx: 10,
    })).toEqual([
      expect.objectContaining({
        id: 'primitive-arc:arc',
        capability: 'arc',
        anchor: expect.objectContaining({
          snapshot: [1, 2, 0],
          semanticRef: expect.objectContaining({ source: 'arc' }),
        }),
        direction: [1, 0, 0],
        normal: [0, 0, 0.001],
      }),
      expect.objectContaining({
        id: 'primitive-arc:direction',
        capability: 'direction',
        direction: [0, 1, 0],
      }),
    ]);
  });
});
