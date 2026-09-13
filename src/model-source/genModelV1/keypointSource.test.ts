import { describe, expect, it, vi } from 'vitest';

import {
  GEN_MODEL_V1_PRIMITIVE_KEYPOINTS_UNSUPPORTED,
  createGenModelV1KeypointSource,
  elementPtsetToChildrenResponse,
  elementPtsetToPtsetResponse,
  emptyPtsetReason,
} from './keypointSource';

import { GenModelV1ApiError, type ElementPtsetItem, type ElementPtsetResponse } from '@/api/genModelV1Api';
import { ptsetResponseToSceneCandidates } from '@/utils/three/ptsetTransform';

/** 与 gen-model `POST /api/v1/element/ptset`（spec §4.11.1）同形：mm、局部系、列主序世界矩阵。 */
function elbo(overrides: Partial<ElementPtsetItem> = {}): ElementPtsetItem {
  return {
    refno: '24381/145031',
    dbnum: 7997,
    noun: 'ELBO',
    name: null,
    catalogue: { component: '24380/1234', point_set: '24380/1235' },
    // 平移 (7849.85, 9146.63, 18656.8) mm，旋转单位阵；平移在 12–14（THREE fromArray 布局）
    world_transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7849.85, 9146.63, 18656.8, 1],
    unit: 'mm',
    points: [
      { number: 1, noun: 'PTAX', pt: [0, 0, 100], dir: [0, 0, 1], bore: 100 },
      { number: 2, noun: 'PTAX', pt: [100, 0, 0], dir: [1, 0, 0], bore: 100 },
    ],
    unresolved: [{ number: 3, reason: 'P3（PTCA）方向解不出' }],
    ...overrides,
  };
}

describe('gen-model-v1 keypointSource', () => {
  it('element/ptset → PtsetResponse：refno 归一 a_b、mm 因子 1、pt/dir/bore 逐点映射、16 元素世界矩阵原样透传', () => {
    const resp = elementPtsetToPtsetResponse(elbo());
    expect(resp.success).toBe(true);
    expect(resp.refno).toBe('24381_145031');
    expect(resp.unit_info).toEqual({ source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 });
    expect(resp.world_transform).toHaveLength(16);
    expect(resp.ptset).toHaveLength(2);
    expect(resp.ptset[0]).toMatchObject({ number: 1, pt: [0, 0, 100], dir: [0, 0, 1], pbore: 100 });
    expect(resp.ptset[1]).toMatchObject({ number: 2, pt: [100, 0, 0], dir: [1, 0, 0], pbore: 100 });
    expect(resp.error_code).toBeNull();
  });

  it('映射结果直接喂 ptsetTransform：局部点经世界矩阵落到世界坐标，方向只过旋转', () => {
    const resp = elementPtsetToPtsetResponse(elbo());
    const candidates = ptsetResponseToSceneCandidates('24381_145031', resp, resp.world_transform, null);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.worldPos[0]).toBeCloseTo(7849.85, 6);
    expect(candidates[0]!.worldPos[1]).toBeCloseTo(9146.63, 6);
    expect(candidates[0]!.worldPos[2]).toBeCloseTo(18656.8 + 100, 6);
    expect(candidates[0]!.sceneDir).toEqual([0, 0, 1]);
    expect(candidates[1]!.worldPos[0]).toBeCloseTo(7849.85 + 100, 6);
  });

  it('bore 为 null 时 pbore 填 0；世界矩阵不是 16 个有限数时置 null（调用方回退 per-refno transform）', () => {
    const resp = elementPtsetToPtsetResponse(elbo({
      points: [{ number: 1, noun: 'PTCA', pt: [1, 2, 3], dir: [0, 1, 0], bore: null }],
      world_transform: [1, 0, 0],
    }));
    expect(resp.ptset[0]!.pbore).toBe(0);
    expect(resp.world_transform).toBeNull();
  });

  it('没有点时 success=false，原因区分「无目录链」「目录件无 PTSE」「全部解不出」「PTSE 为空」', () => {
    expect(emptyPtsetReason(elbo({ points: [], catalogue: null, unresolved: [] })))
      .toContain('没有目录 P 点');
    expect(emptyPtsetReason(elbo({ points: [], catalogue: { component: '24380/1', point_set: null }, unresolved: [] })))
      .toContain('没有 PTSE');
    expect(emptyPtsetReason(elbo({ points: [] })))
      .toContain('P3：P3（PTCA）方向解不出');
    expect(emptyPtsetReason(elbo({ points: [], unresolved: [] })))
      .toContain('PTSE 是空的');

    const resp = elementPtsetToPtsetResponse(elbo({ points: [], catalogue: null, unresolved: [] }));
    expect(resp.success).toBe(false);
    expect(resp.error_code).toBe('PTSET_POINTS_MISSING');
    expect(resp.ptset).toEqual([]);
  });

  it('include_members 的 members[] 摊成 PtsetChildrenResponse：有点的成员 success，计数与旧契约一致', () => {
    const bran: ElementPtsetResponse = {
      source: 'e3d-model',
      ...elbo({ refno: '24381/145018', noun: 'BRAN', catalogue: null, points: [], unresolved: [] }),
      members: [
        elbo({ refno: '24381/145031' }),
        elbo({ refno: '24381/145032', noun: 'ATTA', catalogue: null, points: [], unresolved: [] }),
      ],
    };
    const children = elementPtsetToChildrenResponse('24381_145018', bran);
    expect(children.success).toBe(true);
    expect(children.refno).toBe('24381_145018');
    expect(children.total_count).toBe(2);
    expect(children.success_count).toBe(1);
    expect(children.failed_count).toBe(1);
    expect(children.results[0]).toMatchObject({ refno: '24381_145031', noun: 'ELBO', success: true });
    expect(children.results[0]!.ptset).toHaveLength(2);
    // 成员 noun 透传：ATTA 没有几何、不在 DTX 登记里，测量拾取层只能从这里认出 ATTA 的 P-Point（EDGTUBING.line 跳过它）。
    expect(children.results[1]).toMatchObject({ refno: '24381_145032', noun: 'ATTA', success: false });
    expect(children.results[1]!.error_message).toContain('没有目录 P 点');
    expect(elementPtsetToPtsetResponse(elbo()).noun).toBe('ELBO');
    expect(elementPtsetToPtsetResponse(elbo({ noun: '  ' })).noun).toBeNull();
  });

  it('适配器：ptset 用 a/b 打接口、not_found 折成 success:false 不抛；memberPtsets 带 include_members', async () => {
    const elementPtset = vi.fn(async (req: { refno: string; includeMembers?: boolean }) => {
      if (req.refno === '24381_404') {
        throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/element/ptset', message: 'no such refno' });
      }
      return {
        source: 'e3d-model',
        ...elbo({ refno: '24381/145018', noun: 'BRAN', catalogue: null, points: [], unresolved: [] }),
        ...(req.includeMembers ? { members: [elbo()] } : {}),
      } satisfies ElementPtsetResponse;
    });
    const source = createGenModelV1KeypointSource({ api: { elementPtset } });

    const missing = await source.ptset(7997, '24381_404');
    expect(missing.success).toBe(false);
    expect(missing.error_code).toBe('PTSET_QUERY_FAILED');
    expect(missing.error_message).toContain('not_found');

    const members = await source.memberPtsets(7997, '24381_145018');
    expect(elementPtset).toHaveBeenLastCalledWith({ refno: '24381_145018', includeMembers: true });
    expect(members.success).toBe(true);
    expect(members.results[0]!.refno).toBe('24381_145031');

    const primitives = await source.primitiveKeypoints(7997, '24381_145031');
    expect(primitives.items).toEqual([]);
    expect(primitives.errors).toEqual([GEN_MODEL_V1_PRIMITIVE_KEYPOINTS_UNSUPPORTED]);
  });
});
