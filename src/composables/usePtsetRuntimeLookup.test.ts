import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  pdmsGetPtsetChildrenWithContext,
  pdmsGetPtsetWithContext,
  type PtsetResponse,
} from '@/api/genModelPdmsAttrApi';
import {
  queryDirectChildrenPtsetSummaryWithRuntimeFallback,
  queryPtsetWithRuntimeFallback,
} from '@/composables/usePtsetRuntimeLookup';

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetPtsetChildrenWithContext: vi.fn(),
  pdmsGetPtsetWithContext: vi.fn(),
}));

function emptyPtset(refno: string): PtsetResponse {
  return {
    success: false,
    refno,
    ptset: [],
    world_transform: null,
    unit_info: null,
    error_code: 'PTSET_POINTS_MISSING',
    error_message: 'cata_hash=elbo-a 未找到 ptset 点',
  };
}

function onePointPtset(refno: string): PtsetResponse {
  return {
    success: true,
    refno,
    ptset: [
      {
        number: 1,
        pt: [0, 0, 0],
        dir: null,
        dir_flag: 0,
        ref_dir: null,
        pbore: 100,
        pwidth: 0,
        pheight: 0,
        pconnect: '',
      },
    ],
    world_transform: null,
    unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
    error_message: null,
  };
}

describe('usePtsetRuntimeLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Parquet 返回缺点时会兜底调用运行态 PTSET API', async () => {
    const loader = {
      queryPtsetByRefnoFromParquet: vi.fn(async () => emptyPtset('24381_145018')),
    };
    vi.mocked(pdmsGetPtsetWithContext).mockResolvedValue(onePointPtset('24381_145018'));

    const out = await queryPtsetWithRuntimeFallback(loader, 7997, '24381/145018');

    expect(loader.queryPtsetByRefnoFromParquet).toHaveBeenCalledWith(
      7997,
      '24381_145018',
      { forceRefresh: undefined },
    );
    expect(pdmsGetPtsetWithContext).toHaveBeenCalledWith('24381_145018', {
      dbno: 7997,
      batchId: undefined,
    });
    expect(out.success).toBe(true);
    expect(out.ptset[0]?.number).toBe(1);
  });

  it('Parquet 直子汇总全失败时会兜底到 children API 并保留本地 noun/name', async () => {
    const loader = {
      queryDirectChildrenPtsetSummary: vi.fn(async () => [
        {
          refno: '24381_145019',
          noun: 'ELBO',
          name: 'E1',
          success: false,
          ptCount: 0,
          errorMessage: 'refno=24381_145019 缺少 cata_hash，无法查询 ptset',
        },
      ]),
    };
    vi.mocked(pdmsGetPtsetChildrenWithContext).mockResolvedValue({
      success: true,
      refno: '24381_145018',
      results: [
        {
          input_refno: '24381_145019',
          refno: '24381_145019',
          success: true,
          ...onePointPtset('24381_145019'),
        },
        {
          input_refno: '24381_145019',
          refno: '24381_145019',
          success: true,
          ...onePointPtset('24381_145019'),
        },
      ],
      total_count: 2,
      success_count: 2,
      failed_count: 0,
      error_message: null,
    });

    const out = await queryDirectChildrenPtsetSummaryWithRuntimeFallback(loader, 7997, '24381_145018');

    expect(pdmsGetPtsetChildrenWithContext).toHaveBeenCalledWith('24381_145018', {
      dbno: 7997,
      batchId: undefined,
    });
    expect(out).toEqual([
      {
        refno: '24381_145019',
        noun: 'ELBO',
        name: 'E1',
        success: true,
        ptCount: 1,
        errorMessage: null,
      },
    ]);
  });
});
