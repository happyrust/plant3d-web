import { describe, expect, it } from 'vitest';

import { Matrix4 } from 'three';

import {
  applyMatrix4ToDir,
  applyPtsetTransformToDir,
  ptsetResponseToSceneCandidates,
  transformPtsetPoint,
} from './ptsetTransform';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';

describe('ptsetTransform', () => {
  it('uses the same unit, world transform, and global model matrix chain for scene candidates', () => {
    const response: PtsetResponse = {
      success: true,
      refno: '24381_145714',
      ptset: [
        {
          number: 1,
          pt: [1000, 2000, 0],
          dir: null,
          dir_flag: 1,
          ref_dir: null,
          pbore: 100,
          pwidth: 0,
          pheight: 0,
          pconnect: '',
        },
      ],
      world_transform: null,
      unit_info: {
        source_unit: 'mm',
        target_unit: 'm',
        conversion_factor: 0.001,
      },
      error_message: null,
    };
    const worldTransform = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      10, 20, 30, 1,
    ];
    const globalModelMatrix = new Matrix4().makeTranslation(100, 0, 0);

    const out = ptsetResponseToSceneCandidates(
      '24381_145714',
      response,
      worldTransform,
      globalModelMatrix,
    );

    expect(out).toEqual([
      {
        refno: '24381_145714',
        number: 1,
        worldPos: [111, 22, 30],
        pbore: 100,
      },
    ]);
  });

  it('transforms direction vectors without applying translation', () => {
    const worldTransform = [
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 1, 0,
      10, 20, 30, 1,
    ];

    expect(applyPtsetTransformToDir(worldTransform, [1, 0, 0])).toEqual([0, 1, 0]);
  });

  it('transforms row-major direction vectors without applying translation', () => {
    const worldTransform = [
      [2, 0, 0, 100],
      [0, 3, 0, 200],
      [0, 0, 4, 300],
    ];

    expect(applyPtsetTransformToDir(worldTransform, [1, 1, 1])).toEqual([2, 3, 4]);
  });

  it('applies global matrices to direction vectors without applying translation', () => {
    const globalModelMatrix = new Matrix4()
      .makeTranslation(100, 200, 300)
      .multiply(new Matrix4().makeScale(2, 3, 4));

    expect(applyMatrix4ToDir(globalModelMatrix, [1, 1, 1])).toEqual([2, 3, 4]);
  });

  it('uses one helper for point and vector transform semantics', () => {
    const point = {
      number: 1,
      pt: [1, 1, 1] as [number, number, number],
      dir: [1, 1, 1] as [number, number, number],
      dir_flag: 1,
      ref_dir: null,
      pbore: 100,
      pwidth: 0,
      pheight: 0,
      pconnect: '',
    };
    const worldTransform = [
      [2, 0, 0, 10],
      [0, 3, 0, 20],
      [0, 0, 4, 30],
    ];
    const globalModelMatrix = new Matrix4().makeTranslation(100, 200, 300);

    const transformed = transformPtsetPoint({
      point,
      unitFactor: 10,
      worldTransform,
      globalModelMatrix,
    });

    expect(transformed.localPt).toEqual([10, 10, 10]);
    expect(transformed.worldPt).toEqual([30, 50, 70]);
    expect(transformed.scenePt).toEqual([130, 250, 370]);
    expect(transformed.localDir).toEqual([10, 10, 10]);
    expect(transformed.worldDir).toEqual([20, 30, 40]);
    expect(transformed.sceneDir).toEqual([20, 30, 40]);
  });
});
