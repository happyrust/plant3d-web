import { describe, expect, it, vi } from 'vitest';

import { Vector3 } from 'three';

import {
  createGenModelV1KeypointSource,
  elementPlinesToKeypointCandidates,
  elementPtsetToChildrenResponse,
  elementPtsetToPtsetResponse,
  emptyPtsetReason,
} from './keypointSource';

import {
  GenModelV1ApiError,
  type ElementPlinesResponse,
  type ElementPtsetItem,
  type ElementPtsetResponse,
} from '@/api/genModelV1Api';
import { attachPlineSegments, type MeasurementPickCandidate } from '@/composables/useMeasurementPickSources';
import { ptsetResponseToSceneCandidates } from '@/utils/three/ptsetTransform';

/** 与 gen-model `POST /api/v1/element/plines`（spec §4.11.2）同形：世界系 mm，PSTR 成员原序。 */
function sctnPlines(overrides: Partial<ElementPlinesResponse> = {}): ElementPlinesResponse {
  return {
    source: 'e3d-model',
    refno: '24381/177301',
    dbnum: 7997,
    noun: 'SCTN',
    name: '/COL-1',
    unit: 'mm',
    justification_line: 'NA',
    plines: [
      { key: 'NA', offset: [0, 0], start: [1000, 2000, 0], end: [1000, 2000, 3000], dir: [0, 0, 1], length: 3000 },
      {
        key: 'TOS', offset: [0, 150], start: [1000, 2150, 0], end: [1000, 2150, 3000], dir: [0, 0, 1], length: 3000,
        start_cut: [1000, 2150, -75], end_cut: [1000, 2150, 3075],
      },
    ],
    notes: [],
    ...overrides,
  };
}

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
    const elementPlines = vi.fn(async () => sctnPlines({ plines: [], reason: 'ELBO 不是 SCTN / GENSEC，没有 PLINE', noun: 'ELBO' }));
    const source = createGenModelV1KeypointSource({ api: { elementPtset, elementPlines } });

    const missing = await source.ptset(7997, '24381_404');
    expect(missing.success).toBe(false);
    expect(missing.error_code).toBe('PTSET_QUERY_FAILED');
    expect(missing.error_message).toContain('not_found');

    const members = await source.memberPtsets(7997, '24381_145018');
    expect(elementPtset).toHaveBeenLastCalledWith({ refno: '24381_145018', includeMembers: true });
    expect(members.success).toBe(true);
    expect(members.results[0]!.refno).toBe('24381_145031');

    // 没有 p-line 的构件：候选空，原因是服务端说的那句（不再报「接口不支持」）。
    const primitives = await source.primitiveKeypoints(7997, '24381_145031');
    expect(elementPlines).toHaveBeenLastCalledWith({ refno: '24381_145031' });
    expect(primitives.items).toEqual([]);
    expect(primitives.errors).toEqual(['ELBO 不是 SCTN / GENSEC，没有 PLINE']);
  });

  it('element/plines → PLINE 端点候选：每条 p-line 出「起点 / 终点」两个、label 是 attachPlineSegments 认的写法、带线向；退化 / 非有限的跳过', () => {
    const items = elementPlinesToKeypointCandidates(sctnPlines({
      plines: [
        ...sctnPlines().plines,
        { key: 'BOS', offset: [0, -150], start: [1, 1, 1], end: [1, 1, 1], dir: [0, 0, 0], length: 0 }, // 零长
        { key: '', offset: [0, 0], start: [0, 0, 0], end: [0, 0, 1], dir: [0, 0, 1], length: 1 }, // 无 key
        { key: 'LTOS', offset: [0, 0], start: [Number.NaN, 0, 0], end: [0, 0, 1], dir: [0, 0, 1], length: 1 }, // 非有限
      ],
    }));
    expect(items.map((item) => item.label)).toEqual(['PLINE NA 起点', 'PLINE NA 终点', 'PLINE TOS 起点', 'PLINE TOS 终点']);
    expect(items.map((item) => item.kind)).toEqual(['pline_start', 'pline_end', 'pline_start', 'pline_end']);
    expect(items[0]).toMatchObject({
      id: 'plines:24381_177301:NA:pline_start',
      refno: '24381_177301',
      objectId: 'o:24381_177301:0',
      keypointIndex: 0,
      world: [1000, 2000, 0],
      local: [1000, 2000, 0],
      hasDir: true,
      dir: [0, 0, 1],
    });
    expect(items[3]).toMatchObject({ keypointIndex: 1, world: [1000, 2150, 3000] });
    // 服务端没给 dir 时用两端算。
    const derived = elementPlinesToKeypointCandidates(sctnPlines({
      plines: [{ key: 'NA', offset: [0, 0], start: [0, 0, 0], end: [0, 3, 4], dir: undefined as never, length: 5 }],
    }));
    expect(derived[0]!.dir).toEqual([0, 0.6, 0.8]);
  });

  it('端点候选经测量工具的 attachPlineSegments 配成一条线：同一 PLINE 两端共用 segment、feature 标 pline', () => {
    const items = elementPlinesToKeypointCandidates(sctnPlines());
    const candidates: MeasurementPickCandidate[] = items.map((item) => ({
      id: item.id,
      source: 'primitive_key_point',
      entityId: item.id,
      objectId: 'o:24381_177301:12',
      worldPos: new Vector3(...item.world),
      label: item.label,
    }));
    const attached = attachPlineSegments(candidates);
    expect(attached.every((candidate) => candidate.feature === 'pline')).toBe(true);
    const [naStart, naEnd, tosStart, tosEnd] = attached;
    expect(naStart!.segment).toBeDefined();
    expect(naStart!.segment).toBe(naEnd!.segment);
    expect(naStart!.segment!.start.toArray()).toEqual([1000, 2000, 0]);
    expect(naStart!.segment!.end.toArray()).toEqual([1000, 2000, 3000]);
    expect(tosStart!.segment).toBe(tosEnd!.segment);
    expect(tosStart!.segment).not.toBe(naStart!.segment);
  });

  it('适配器：primitiveKeypoints 打 element/plines；有 p-line 时 errors 为空；接口异常折成 errors 不抛', async () => {
    const elementPlines = vi.fn(async (req: { refno: string }) => {
      if (req.refno === '24381_500') {
        throw new GenModelV1ApiError({ code: 'internal', status: 500, path: '/api/v1/element/plines', message: 'boom' });
      }
      return sctnPlines();
    });
    const elementPtset = vi.fn(async () => ({ source: 'e3d-model', ...elbo() }) satisfies ElementPtsetResponse);
    const source = createGenModelV1KeypointSource({ api: { elementPtset, elementPlines } });

    const ok = await source.primitiveKeypoints(7997, '24381_177301');
    expect(elementPlines).toHaveBeenLastCalledWith({ refno: '24381_177301' });
    expect(ok.items).toHaveLength(4);
    expect(ok.errors).toEqual([]);

    const failed = await source.primitiveKeypoints(7997, '24381_500');
    expect(failed.items).toEqual([]);
    expect(failed.errors).toHaveLength(1);
    expect(failed.errors[0]).toContain('PLINE 查询失败');
    expect(failed.errors[0]).toContain('internal');
  });
});
