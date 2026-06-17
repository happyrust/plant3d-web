import { describe, expect, it } from 'vitest';

import { Matrix4 } from 'three';

import {
  applyPtsetTransformToDir,
  ptsetResponseToSceneCandidates,
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
});
