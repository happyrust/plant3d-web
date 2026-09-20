import { describe, expect, it, vi } from 'vitest';

import type { PtsetBatchItemResponse, PtsetChildrenResponse, PtsetPoint, PtsetResponse } from '@/api/genModelPdmsAttrApi';

import { collectPtsetEntries } from '@/composables/usePtsetVisualizationEntries';

function point(number: number): PtsetPoint {
  return {
    number,
    pt: [number, 0, 0],
    dir: null,
    dir_flag: 0,
    ref_dir: null,
    pbore: 100,
    pwidth: 0,
    pheight: 0,
    pconnect: '',
  };
}

function ptset(refno: string, count: number): PtsetResponse {
  return {
    success: count > 0,
    refno,
    ptset: Array.from({ length: count }, (_, i) => point(i + 1)),
    world_transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
    error_code: count > 0 ? null : 'PTSET_POINTS_MISSING',
    error_message: count > 0 ? null : `${refno} 没有目录 P 点`,
  };
}

function member(refno: string, count: number): PtsetBatchItemResponse {
  const base = ptset(refno, count);
  return {
    input_refno: refno,
    refno,
    noun: 'ELBO',
    success: base.success,
    ptset: base.ptset,
    world_transform: base.world_transform,
    unit_info: base.unit_info,
    error_message: base.error_message,
  };
}

function children(refno: string, items: PtsetBatchItemResponse[]): PtsetChildrenResponse {
  const successCount = items.filter((item) => item.success).length;
  return {
    success: successCount > 0,
    refno,
    results: items,
    total_count: items.length,
    success_count: successCount,
    failed_count: items.length - successCount,
    error_message: successCount > 0 ? null : '未找到子元件 ptset 数据',
  };
}

describe('collectPtsetEntries', () => {
  it('自身有点：只显示自身，不去问成员', async () => {
    const memberPtsets = vi.fn();
    const result = await collectPtsetEntries(
      { keypoints: { ptset: async () => ptset('24381_145031', 2), memberPtsets } },
      7997,
      '24381/145031',
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ refno: '24381_145031' });
    expect(result.entries[0]!.response.ptset).toHaveLength(2);
    expect(memberPtsets).not.toHaveBeenCalled();
  });

  it('自身没点：成员的点随 memberPtsets 一起回来，不再逐个问', async () => {
    const self = vi.fn(async () => ptset('24381_145018', 0));
    const result = await collectPtsetEntries(
      {
        keypoints: {
          ptset: self,
          memberPtsets: async () => children('24381_145018', [
            member('24381_145019', 2),
            member('24381_145020', 0),
          ]),
        },
      },
      7997,
      '24381_145018',
    );
    expect(self).toHaveBeenCalledTimes(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.refno).toBe('24381_145019');
    expect(result.entries[0]!.response).toMatchObject({
      success: true,
      noun: 'ELBO',
      unit_info: { conversion_factor: 1 },
    });
    expect(result.entries[0]!.response.world_transform).toHaveLength(16);
    expect(result.memberErrors).toEqual(['24381_145020 没有目录 P 点']);
  });

  it('自身与成员都没点：entries 空，self 与成员原因都留着给调用方拼提示', async () => {
    const result = await collectPtsetEntries(
      {
        keypoints: {
          ptset: async () => ptset('24381_145018', 0),
          memberPtsets: async () => children('24381_145018', []),
        },
      },
      7997,
      '24381_145018',
    );
    expect(result.entries).toEqual([]);
    expect(result.self.error_message).toBe('24381_145018 没有目录 P 点');
    expect(result.memberErrors).toEqual(['未找到子元件 ptset 数据']);
  });
});

