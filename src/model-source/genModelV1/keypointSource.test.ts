import { describe, expect, it, vi } from 'vitest';

import { Vector3 } from 'three';

import {
  createGenModelV1KeypointSource,
  elementPlinesToKeypointCandidates,
  elementPlinesToSnapPoints,
  elementPtsetToChildrenResponse,
  elementPtsetToPtsetResponse,
  elementSpineToKeypointCandidates,
  elementTubiEndpointsToCandidates,
  emptyPtsetReason,
} from './keypointSource';

import {
  GenModelV1ApiError,
  type ElementPlinesResponse,
  type ElementPtsetItem,
  type ElementPtsetResponse,
  type ElementTubiEndpoints,
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

  it('Pick Settings 供给：斜切端点随端点候选带成 plineCut（平头端没有）；snap_points 摊成 plineSnapPoints（未知 kind / 非有限跳过；老构建没有这一格 → 空）', async () => {
    const items = elementPlinesToKeypointCandidates(sctnPlines());
    // NA 两端平头：没有 plineCut；TOS 两端都斜切。
    expect(items[0]!.plineCut).toBeUndefined();
    expect(items[1]!.plineCut).toBeUndefined();
    expect(items[2]).toMatchObject({ label: 'PLINE TOS 起点', plineCut: [1000, 2150, -75] });
    expect(items[3]).toMatchObject({ label: 'PLINE TOS 终点', plineCut: [1000, 2150, 3075] });

    const withSnapPoints = sctnPlines({
      snap_points: [
        { refno: '24381/177316', noun: 'SNOD', kind: 'node', zdis: 435.56, position: [1000, 2000, 435.56] },
        { refno: '24381/177317', noun: 'SJOI', kind: 'joint', zdis: 435.56, position: [1000, 2000, 435.56] },
        { refno: '24381/177399', noun: 'FITT', kind: 'fitting', zdis: 1200, position: [1000, 2050, 1200] },
        { refno: '24381/1', noun: 'SCOJ', kind: 'compound' as never, zdis: 1, position: [0, 0, 1] },
        { refno: '24381/2', noun: 'SNOD', kind: 'node', zdis: 2, position: [Number.NaN, 0, 2] },
      ],
    });
    expect(elementPlinesToSnapPoints(withSnapPoints)).toEqual([
      { refno: '24381_177316', noun: 'SNOD', kind: 'node', zdis: 435.56, world: [1000, 2000, 435.56], label: 'SNOD 24381_177316' },
      { refno: '24381_177317', noun: 'SJOI', kind: 'joint', zdis: 435.56, world: [1000, 2000, 435.56], label: 'SJOI 24381_177317' },
      { refno: '24381_177399', noun: 'FITT', kind: 'fitting', zdis: 1200, world: [1000, 2050, 1200], label: 'FITT 24381_177399' },
    ]);
    expect(elementPlinesToSnapPoints(sctnPlines())).toEqual([]);

    const elementPlines = vi.fn(async () => withSnapPoints);
    const elementPtset = vi.fn(async () => ({ source: 'e3d-model', ...elbo() }) satisfies ElementPtsetResponse);
    const source = createGenModelV1KeypointSource({ api: { elementPtset, elementPlines } });
    const result = await source.primitiveKeypoints(7997, '24381_177301');
    expect(result.plineSnapPoints).toHaveLength(3);
    expect(result.plineSnapPoints![0]).toMatchObject({ kind: 'node', refno: '24381_177316' });
  });

  describe('版本令牌与管身端点（#62 / #66）', () => {
    const tubi = (): ElementTubiEndpoints => ({
      branch_refno: '24381_145018',
      endpoints: [
        {
          point_id: 'TUBI:24381_145019~24381_145020:ARRIVE', end: 'arrive', instance_refno: '24381_145019~24381_145020',
          owner_refno: '24381_145018', order: 2, position: [1100, 100, 0], direction: [0, -1, 0], outside_diameter_mm: 114.3,
        },
        {
          point_id: 'TUBI:24381_145019~24381_145020:LEAVE', end: 'leave', instance_refno: '24381_145019~24381_145020',
          owner_refno: '24381_145018', order: 2, position: [1100, 900, 0], direction: [0, 1, 0], outside_diameter_mm: 114.3,
        },
        {
          point_id: 'TUBI:bad:LEAVE', end: 'leave', instance_refno: 'bad', owner_refno: '24381_145018', order: 3,
          position: [Number.NaN, 0, 0], direction: [0, 1, 0], outside_diameter_mm: null,
        },
      ],
      unresolved: [{ instance_refno: 'Head~24381_145019', end: 'arrive', reason: '端点坐标不是有限数' }],
    });

    it('管身端点 → 语义点候选：id 原样用 point_id，挂在所属 BRAN 上，非有限的跳过', () => {
      const items = elementTubiEndpointsToCandidates(tubi());
      expect(items.map(item => item.id)).toEqual([
        'TUBI:24381_145019~24381_145020:ARRIVE',
        'TUBI:24381_145019~24381_145020:LEAVE',
      ]);
      expect(items[1]).toMatchObject({
        refno: '24381_145019~24381_145020',
        objectId: 'o:24381_145018:0',
        kind: 'tubi_leave',
        label: 'TUBI LEAVE',
        world: [1100, 900, 0],
        dir: [0, 1, 0],
        hasDir: true,
      });
      expect(elementTubiEndpointsToCandidates(undefined)).toEqual([]);
    });

    it('适配器：ptset / plines 带回 dbnum:sesno，tubiEndpoints 发 include_tubi_endpoints 并报 unresolved', async () => {
      const version = { dbnum: 24381, sesno: 812, databases: [] };
      const elementPtset = vi.fn(async (req: { refno: string; includeTubiEndpoints?: boolean }) => ({
        source: 'e3d-model',
        ...elbo(),
        source_version: version,
        ...(req.includeTubiEndpoints ? { tubi_endpoints: tubi() } : {}),
      }) satisfies ElementPtsetResponse);
      const elementPlines = vi.fn(async () => sctnPlines({ source_version: version }));
      const source = createGenModelV1KeypointSource({ api: { elementPtset, elementPlines } });

      expect((await source.ptset(0, '24381_145031')).source_version_key).toBe('24381:812');
      expect((await source.primitiveKeypoints(0, '24381_177301')).sourceVersionKey).toBe('24381:812');

      const result = await source.tubiEndpoints!(0, '24381_145019');
      expect(elementPtset).toHaveBeenLastCalledWith({ refno: '24381_145019', includeTubiEndpoints: true });
      expect(result.items).toHaveLength(2);
      expect(result.ownerRefno).toBe('24381_145018');
      expect(result.sourceVersionKey).toBe('24381:812');
      expect(result.errors).toEqual(['Head~24381_145019 arrive：端点坐标不是有限数']);
    });

    it('老服务端没有版本 / 管身端点：版本为 null，管身给一句原因', async () => {
      const elementPtset = vi.fn(async () => ({ source: 'e3d-model', ...elbo() }) satisfies ElementPtsetResponse);
      const elementPlines = vi.fn(async () => sctnPlines());
      const source = createGenModelV1KeypointSource({ api: { elementPtset, elementPlines } });
      expect((await source.ptset(0, '24381_145031')).source_version_key).toBeNull();
      const result = await source.tubiEndpoints!(0, '24381_145031');
      expect(result.items).toEqual([]);
      expect(result.errors[0]).toContain('不支持');
      expect(result.sourceVersionKey).toBeNull();
    });
  });

  describe('GENSEC SPINE 拐点与弧（#77）', () => {
    const gensec = (): ElementPlinesResponse => sctnPlines({
      refno: '24381/200001',
      noun: 'GENSEC',
      plines: [],
      reason: 'GENSEC 的 SPINE 不是单一直段（3 段，弧型 CENT）：E3D 把它的 p-line 当弧（edgPline.arc），未接',
      spine: {
        vertices: [
          { point_id: 'SPINE:24381_200001:V0', order: 0, position: [0, 0, 0] },
          { point_id: 'SPINE:24381_200001:V1', order: 1, position: [1000, 0, 0] },
          { point_id: 'SPINE:bad:V9', order: 9, position: [Number.NaN, 0, 0] },
        ],
        arcs: [
          {
            point_id: 'SPINE:24381_200001:A1', order: 1, center: [1000, 500, 0], rim: [1000, 0, 0], end: [1500, 500, 0],
            normal: [0, 0, 2], radius: 500, sweep_deg: 90,
          },
          {
            point_id: 'SPINE:24381_200001:A3', order: 3, center: [0, 0, 0], rim: [1, 0, 0], end: [0, 1, 0],
            normal: [0, 0, 0], radius: 1, sweep_deg: 90,
          },
        ],
        notes: [],
      },
    });

    it('拐点按 point_id 出；弧带权威圆心 / 起点 / 单位转轴，点取弧中点；退化弧不出', () => {
      const items = elementSpineToKeypointCandidates(gensec());
      expect(items.map(item => [item.id, item.kind])).toEqual([
        ['SPINE:24381_200001:V0', 'spine_vertex'],
        ['SPINE:24381_200001:V1', 'spine_vertex'],
        ['SPINE:24381_200001:A1', 'spine_arc'],
      ]);
      const arc = items[2]!;
      expect(arc).toMatchObject({ refno: '24381_200001', objectId: 'o:24381_200001:0', label: 'SPINE 弧 #1 R500' });
      expect(arc.arc).toEqual({ center: [1000, 500, 0], rim: [1000, 0, 0], normal: [0, 0, 1] });
      const half = 500 * Math.SQRT1_2;
      expect(arc.world[0]).toBeCloseTo(1000 + half, 9);
      expect(arc.world[1]).toBeCloseTo(500 - half, 9);
      expect(elementSpineToKeypointCandidates(sctnPlines())).toEqual([]);
    });

    it('含弧 GENSEC 没有 p-line 也给出 SPINE 候选，不再只回原因', async () => {
      const source = createGenModelV1KeypointSource({
        api: { elementPtset: vi.fn(), elementPlines: vi.fn(async () => gensec()) },
      });
      const result = await source.primitiveKeypoints(0, '24381_200001');
      expect(result.items.map(item => item.kind)).toEqual(['spine_vertex', 'spine_vertex', 'spine_arc']);
      expect(result.errors).toEqual([]);
    });
  });
});
