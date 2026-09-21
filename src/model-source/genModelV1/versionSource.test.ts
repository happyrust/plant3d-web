import { describe, expect, it, vi } from 'vitest';

import {
  createGenModelV1ModelVersionSource,
  historyRowsToGeomInstQueries,
  MAX_PAGES,
  ownerMapFromHistoryRows,
  type GenModelV1VersionApi,
} from './versionSource';

import {
  GenModelV1ApiError,
  unpackRefno,
  type AttributeDiffResponse,
  type AttributeHistoryResponse,
  type ElementVersionsResponse,
  type ModelVersionsResponse,
  type NodeDiffSummaryResponse,
  type NodeVersionsResponse,
  type TaskEntryDto,
} from '@/api/genModelV1Api';
import { ModelVersionRouteUnavailableError, NotDeliveryUnitRootError } from '@/model-source/modelVersionErrors';

function response(partial: Partial<ModelVersionsResponse>): ModelVersionsResponse {
  return {
    dbnum: 7997,
    unit_refno: '24381/145018',
    unit_noun: 'BRAN',
    file_latest_sesno: 332,
    truncated: false,
    versions: [],
    ...partial,
  };
}

function elementResponse(partial: Partial<ElementVersionsResponse> = {}): ElementVersionsResponse {
  return {
    dbnum: 8000,
    refno: '24384/23262',
    noun: 'FTUB',
    unit_root: '24384/23257',
    unit_noun: 'BRAN',
    file_latest_sesno: 633,
    truncated: false,
    versions: [],
    ...partial,
  };
}

function attributeHistoryResponse(partial: Partial<AttributeHistoryResponse> = {}): AttributeHistoryResponse {
  return {
    dbnum: 8000,
    refno: '24384/23262',
    noun: 'FTUB',
    unit_root: '24384/23257',
    unit_noun: 'BRAN',
    file_latest_sesno: 636,
    truncated: false,
    entries: [],
    ...partial,
  };
}

function attributeDiffResponse(partial: Partial<AttributeDiffResponse> = {}): AttributeDiffResponse {
  return {
    dbnum: 8000,
    refno: '24384/23262',
    noun: 'FTUB',
    unit_root: '24384/23257',
    unit_noun: 'BRAN',
    file_latest_sesno: 636,
    a: 573,
    b: 626,
    kind: 'modified',
    impact: 'placement',
    changed_count: 0,
    changes: [],
    ...partial,
  };
}

function diffSummaryResponse(partial: Partial<NodeDiffSummaryResponse> = {}): NodeDiffSummaryResponse {
  return {
    dbnum: 8000,
    refno: '24384/23257',
    noun: 'BRAN',
    scope: 'subtree',
    a: 573,
    b: 626,
    units: { changed: 1, unchanged: 0, total: 1, complete: true },
    elements: { added: 0, deleted: 0, modified: 1, noop: 1 },
    groups: [],
    needs_confirm: false,
    estimated_projections: 2,
    confirm_threshold_units: 20,
    ...partial,
  };
}

function nodeVersionsResponse(partial: Partial<NodeVersionsResponse> = {}): NodeVersionsResponse {
  return {
    dbnum: 8000,
    refno: '24384/22399',
    noun: 'SITE',
    scope: 'subtree',
    unit_root: null,
    unit_noun: null,
    file_latest_sesno: 639,
    truncated: false,
    versions: [],
    ...partial,
  };
}

function api(overrides: Partial<GenModelV1VersionApi> = {}): GenModelV1VersionApi {
  return {
    listVersions: vi.fn(async () => response({})),
    listElementVersions: vi.fn(async () => elementResponse()),
    attributeHistory: vi.fn(async () => attributeHistoryResponse()),
    attributeDiff: vi.fn(async () => attributeDiffResponse()),
    nodeVersions: vi.fn(async () => nodeVersionsResponse()),
    diffSummary: vi.fn(async () => diffSummaryResponse()),
    historyGenerate: vi.fn(async () => ({ task_id: 't-1' })),
    taskGet: vi.fn(async () => ({ task_id: 't-1', kind: 'model-history', state: 'succeeded', result: { snapshot_key: '24381_145018@66' } }) as TaskEntryDto),
    historyQuery: vi.fn(async () => []) as unknown as GenModelV1VersionApi['historyQuery'],
    historyDelete: vi.fn(async () => ({ snapshot_key: '24381_145018@66', status: 'deleted' })),
    sleep: vi.fn(async () => {}),
    now: () => 0,
    ...overrides,
  };
}

describe('genModelV1 ModelVersionSource', () => {
  it('listVersions 把服务端行映成 ModelVersion（无资产字段），refno 归一成 a_b 发给服务端', async () => {
    const listVersions = vi.fn(async () => response({
      versions: [
        { sesno: 66, session_time: '2022-11-16T09:19:47+00:00', impact_kind: 'delivery' },
        { sesno: 120, session_time: null, impact_kind: 'placement' },
      ],
    }));
    const source = createGenModelV1ModelVersionSource(api({ listVersions }));

    const versions = await source.listVersions(7997, '24381/145018');

    expect(listVersions).toHaveBeenCalledWith({ dbnum: 7997, refno: '24381_145018', sinceSesno: undefined });
    expect(versions).toEqual([
      { dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 66, sessionTime: '2022-11-16T09:19:47+00:00', impactKind: 'delivery' },
      { dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 120, sessionTime: null, impactKind: 'placement' },
    ]);
    expect(versions[0]).not.toHaveProperty('geometryKey');
  });

  it('listElementVersions 给出构件自身与所属单元两列，refno 归一成 a_b', async () => {
    const listElementVersions = vi.fn(async () => elementResponse({
      versions: [
        // 单元变了、构件自己没变：左列 null——「邻居带着我变」那一档
        { sesno: 573, session_time: '2026-09-13T16:19:46+08:00', element_impact: null, unit_impact: 'mesh' },
        { sesno: 626, session_time: '2026-09-18T19:31:48+08:00', element_impact: 'mesh', unit_impact: 'mesh' },
      ],
    }));
    const source = createGenModelV1ModelVersionSource(api({ listElementVersions }));

    const timeline = await source.listElementVersions(8000, '24384/23262');

    expect(listElementVersions).toHaveBeenCalledWith({ dbnum: 8000, refno: '24384_23262', sinceSesno: undefined });
    expect(timeline).toEqual({
      dbnum: 8000,
      refno: '24384_23262',
      noun: 'FTUB',
      unitRefno: '24384_23257',
      unitNoun: 'BRAN',
      unitColumnOnly: false,
      versions: [
        { sesno: 573, sessionTime: '2026-09-13T16:19:46+08:00', elementImpact: null, unitImpact: 'mesh' },
        { sesno: 626, sessionTime: '2026-09-18T19:31:48+08:00', elementImpact: 'mesh', unitImpact: 'mesh' },
      ],
    });
  });

  it('listElementVersions 在没有 element/versions 路由的旧服务端上回落到单元表（只剩单元那一列）', async () => {
    const listElementVersions = vi.fn(async () => {
      // 路由不存在：axum 的 404 没有错误信封，客户端按状态码回落成 not_found
      throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/element/versions', message: 'HTTP 404 Not Found' });
    });
    const listVersions = vi.fn(async () => response({
      versions: [
        { sesno: 66, session_time: null, impact_kind: 'delivery' },
        { sesno: 120, session_time: null, impact_kind: 'mesh' },
      ],
    }));
    const source = createGenModelV1ModelVersionSource(api({ listElementVersions, listVersions }));

    const timeline = await source.listElementVersions(7997, '24381_145018');

    expect(timeline.unitColumnOnly).toBe(true);
    expect(timeline.unitRefno).toBe('24381_145018');
    expect(timeline.versions).toEqual([
      { sesno: 66, sessionTime: null, elementImpact: null, unitImpact: 'delivery' },
      { sesno: 120, sessionTime: null, elementImpact: null, unitImpact: 'mesh' },
    ]);
  });

  it('listElementVersions 不把服务端自己答的 404（REFNO_NOT_FOUND）当成缺路由', async () => {
    const listElementVersions = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'REFNO_NOT_FOUND' as never, status: 404, path: '/api/v1/element/versions', message: '整条链上都没有 24384/999999' });
    });
    const listVersions = vi.fn(async () => response({}));
    const source = createGenModelV1ModelVersionSource(api({ listElementVersions, listVersions }));

    await expect(source.listElementVersions(8000, '24384_999999')).rejects.toThrow('整条链上都没有');
    expect(listVersions).not.toHaveBeenCalled();
  });

  it('truncated 时按最后一条 sesno 作 since_sesno 连续拉到全表（Q17）', async () => {
    const pages = [
      response({ truncated: true, versions: [{ sesno: 1, session_time: null, impact_kind: 'delivery' }, { sesno: 5, session_time: null, impact_kind: 'mesh' }] }),
      response({ truncated: true, versions: [{ sesno: 9, session_time: null, impact_kind: 'noop' }] }),
      response({ truncated: false, versions: [{ sesno: 12, session_time: null, impact_kind: 'tombstone' }] }),
    ];
    const listVersions = vi.fn(async () => pages.shift() ?? response({}));
    const source = createGenModelV1ModelVersionSource(api({ listVersions }));

    const versions = await source.listVersions(7997, '24381_145018');

    expect(versions.map((v) => v.sesno)).toEqual([1, 5, 9, 12]);
    expect(listVersions.mock.calls.map((call) => (call as unknown as [{ sinceSesno?: number }])[0].sinceSesno)).toEqual([undefined, 5, 9]);
  });

  it('页数超过上限就放弃，不无限拉', async () => {
    const listVersions = vi.fn(async () => response({ truncated: true, versions: [{ sesno: 1, session_time: null, impact_kind: 'noop' }] }));
    const source = createGenModelV1ModelVersionSource(api({ listVersions }));

    await expect(source.listVersions(7997, '24381_145018')).rejects.toThrow(`${MAX_PAGES} 页`);
    expect(listVersions).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it('422 NOT_A_DELIVERY_UNIT_ROOT 翻成 NotDeliveryUnitRootError，noun 与类型集来自 detail（Q6）', async () => {
    const listVersions = vi.fn(async () => {
      throw new GenModelV1ApiError({
        code: 'NOT_A_DELIVERY_UNIT_ROOT',
        status: 422,
        path: '/api/v1/model/versions',
        message: 'not a unit root',
        detail: { noun: 'ZONE', delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'] },
      });
    });
    const source = createGenModelV1ModelVersionSource(api({ listVersions }));

    const error = await source.listVersions(7997, '24381_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotDeliveryUnitRootError);
    expect((error as NotDeliveryUnitRootError).noun).toBe('ZONE');
    expect((error as NotDeliveryUnitRootError).deliveryUnitTypes).toEqual(['BRAN', 'HANG', 'SUPPO', 'EQUI']);
    expect((error as Error).message).toContain('BRAN / HANG / SUPPO / EQUI');
  });

  it('loadVersion：generate → 轮询到 succeeded → instances + tubes → InstanceEntry，release 即 DELETE 快照', async () => {
    const states: TaskEntryDto[] = [
      { task_id: 't-1', kind: 'model-history', state: 'running' },
      { task_id: 't-1', kind: 'model-history', state: 'succeeded', result: { snapshot_key: '24381_145018@66' } },
    ];
    const taskGet = vi.fn(async () => states.shift()!);
    const historyQuery = vi.fn(async (_key: string, tool: string) => {
      if (tool === 'instances') {
        return [{
          id: 'r1', snapshot_key: '24381_145018@66', dbnum: 7997, generic: 'VALV', source_refno: '24381_145020',
          mesh_id: 'm-valve', booled: true,
          anc: [24381 * 2 ** 32 + 145020, 24381 * 2 ** 32 + 145018],
          world_bounds: { mins: [0, 0, 0], maxs: [1, 1, 1] },
          world_transform: { translation: [10, 20, 30], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        }];
      }
      return [{
        id: 'r2', snapshot_key: '24381_145018@66', dbnum: 7997, container_refno: '24381_145018', source_refno: '24381_145018',
        leave_refno: '24381_145020', arrive_refno: '24381_145021', mesh_id: 'm-tube', invalid: false,
        world_bounds: null,
        world_transform: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 5] },
      }];
    }) as unknown as GenModelV1VersionApi['historyQuery'];
    const historyDelete = vi.fn(async () => ({ snapshot_key: '24381_145018@66', status: 'deleted' }));
    const historyGenerate = vi.fn(async () => ({ task_id: 't-1' }));
    const source = createGenModelV1ModelVersionSource(api({ taskGet, historyQuery, historyDelete, historyGenerate }));

    const geometry = await source.loadVersion({
      dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 66, sessionTime: null, impactKind: 'mesh',
    });

    expect(historyGenerate).toHaveBeenCalledWith({ dbnum: 7997, refno: '24381_145018', sesno: 66 }, { signal: undefined });
    expect(taskGet).toHaveBeenCalledTimes(2);
    expect(historyQuery).toHaveBeenCalledWith('24381_145018@66', 'instances', { signal: undefined });
    expect(historyQuery).toHaveBeenCalledWith('24381_145018@66', 'tubes', { signal: undefined });
    expect(geometry.refnos.sort()).toEqual(['24381_145018', '24381_145020']);

    const valve = geometry.entries.get('24381_145020')!;
    expect(valve).toHaveLength(1);
    expect(valve[0]!.geo_hash).toBe('m-valve');
    expect(valve[0]!.matrix.slice(12, 15)).toEqual([10, 20, 30]);
    expect(valve[0]!.uniforms).toMatchObject({ refno: '24381_145020', noun: 'VALV', owner_refno: '24381_145018', has_neg: true, is_tubi: false });

    const tube = geometry.entries.get('24381_145018')!;
    expect(tube[0]!.geo_hash).toBe('m-tube');
    expect(tube[0]!.uniforms).toMatchObject({ noun: 'TUBI', is_tubi: true, owner_noun: 'BRAN' });
    expect(geometry.ownerByRefno?.get('24381_145020')).toBe('24381_145018');

    await geometry.release();
    await geometry.release();
    expect(historyDelete).toHaveBeenCalledTimes(1);
    expect(historyDelete).toHaveBeenCalledWith('24381_145018@66');
  });

  it('tombstone 版本不打后端，回空几何', async () => {
    const historyGenerate = vi.fn(async () => ({ task_id: 't-1' }));
    const source = createGenModelV1ModelVersionSource(api({ historyGenerate }));

    const geometry = await source.loadVersion({
      dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 604, sessionTime: null, impactKind: 'tombstone',
    });

    expect(geometry.refnos).toEqual([]);
    expect(geometry.entries.size).toBe(0);
    expect(historyGenerate).not.toHaveBeenCalled();
  });

  it('任务 failed 时带出服务端 code / message', async () => {
    const taskGet = vi.fn(async () => ({
      task_id: 't-1', kind: 'model-history', state: 'failed',
      result: { code: 'REFNO_NOT_FOUND_AT_SESSION', message: 'root 24381/145018 is not in session 3' },
    }) as TaskEntryDto);
    const source = createGenModelV1ModelVersionSource(api({ taskGet }));

    await expect(source.loadVersion({
      dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 3, sessionTime: null, impactKind: 'mesh',
    })).rejects.toThrow('REFNO_NOT_FOUND_AT_SESSION: root 24381/145018 is not in session 3');
  });

  it('轮询超过预算就放弃', async () => {
    let clock = 0;
    const taskGet = vi.fn(async () => ({ task_id: 't-1', kind: 'model-history', state: 'running' }) as TaskEntryDto);
    const source = createGenModelV1ModelVersionSource(api({
      taskGet,
      now: () => clock,
      sleep: vi.fn(async () => { clock += 200_000; }),
    }));

    await expect(source.loadVersion({
      dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 66, sessionTime: null, impactKind: 'mesh',
    })).rejects.toThrow('仍未完成');
  });

  it('attributesAt：拿几何句柄（snapshot_key）打 history/query tool=attributes { refno: a/b }，行映成属性面板同型', async () => {
    const historyQuery = vi.fn(async (_key: string, tool: string) => {
      if (tool === 'attributes') {
        return {
          snapshot_key: '24381_145018@66', dbnum: 7997, sesno: 66, refno: '24381/145019', exists: true, noun: 'ELBO',
          attributes: [
            { name: 'NAME', value_type: 'string', display: '/P1', is_unset: false, editable: true, is_uda: false },
            { name: 'ANGL', value_type: 'real', display: '90', is_unset: false, editable: true, is_uda: false },
            { name: 'DESC', value_type: 'string', display: '', is_unset: true, editable: true, is_uda: false },
          ],
        };
      }
      return [];
    }) as unknown as GenModelV1VersionApi['historyQuery'];
    const source = createGenModelV1ModelVersionSource(api({ historyQuery }));
    const geometry = await source.loadVersion({
      dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 66, sessionTime: null, impactKind: 'mesh',
    });
    expect(geometry.handle).toBe('24381_145018@66');

    const side = await source.attributesAt(geometry, '24381_145019');
    expect(historyQuery).toHaveBeenLastCalledWith('24381_145018@66', 'attributes', expect.objectContaining({ arguments: { refno: '24381/145019' } }));
    expect(side).toEqual({
      sesno: 66,
      exists: true,
      noun: 'ELBO',
      attributes: [
        { name: 'NAME', valueType: 'string', display: '/P1', isUnset: false, isUda: false },
        { name: 'ANGL', valueType: 'real', display: '90', isUnset: false, isUda: false },
        { name: 'DESC', valueType: 'string', display: '', isUnset: true, isUda: false },
      ],
    });
  });

  it('attributesAt：tombstone（没有句柄）不打后端，直接回 exists:false', async () => {
    const historyQuery = vi.fn(async () => []) as unknown as GenModelV1VersionApi['historyQuery'];
    const source = createGenModelV1ModelVersionSource(api({ historyQuery }));
    const geometry = await source.loadVersion({
      dbnum: 7997, unitRefno: '24381_145018', unitNoun: 'BRAN', sesno: 604, sessionTime: null, impactKind: 'tombstone',
    });
    await expect(source.attributesAt(geometry, '24381_145019')).resolves.toEqual({ sesno: 0, exists: false, noun: null, attributes: [] });
    expect(historyQuery).not.toHaveBeenCalled();
  });

  it('ownerMapFromHistoryRows：anc（自身 → 顶层，打包 refno）拆成逐级直接属主表', () => {
    const pack = (w0: number, w1: number) => w0 * 2 ** 32 + w1;
    const owners = ownerMapFromHistoryRows([
      { anc: [pack(24384, 26481), pack(24384, 26480), pack(24384, 100)] }, // BOX → EQUI → ZONE
      { anc: [pack(24384, 26482), pack(24384, 26480)] }, // 另一件成员 → EQUI（链短一截，不覆盖已知的 EQUI → ZONE）
      { anc: [] },
      {},
    ]);
    expect(owners.get('24384_26481')).toBe('24384_26480');
    expect(owners.get('24384_26482')).toBe('24384_26480');
    expect(owners.get('24384_26480')).toBe('24384_100');
    expect(owners.has('24384_100')).toBe(false);
    expect(unpackRefno(pack(24384, 26481))).toBe('24384_26481');
    expect(unpackRefno(-1)).toBe('');
    expect(unpackRefno('x')).toBe('');
  });

  it('historyRowsToGeomInstQueries：规范基本体保留 local_transform、烘焙件用单位阵并标 has_neg', () => {
    const items = historyRowsToGeomInstQueries('24381_145018', [
      {
        id: 'a', snapshot_key: 'k', dbnum: 7997, generic: 'ELBO', source_refno: '24381_1', mesh_id: 'prim', booled: false,
        primitive_key: 'cyl', local_transform: { translation: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        world_bounds: null, world_transform: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
      {
        id: 'b', snapshot_key: 'k', dbnum: 7997, generic: 'FLAN', source_refno: '24381_2', mesh_id: 'baked', booled: true,
        world_bounds: null, world_transform: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
      { id: 'c', snapshot_key: 'k', dbnum: 7997, generic: 'X', source_refno: '24381_3', mesh_id: '', world_bounds: null, world_transform: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
    ], []);

    expect(items.map((item) => item.refno)).toEqual(['24381_1', '24381_2']);
    expect(items[0]!.insts[0]!.transform.translation).toEqual([1, 2, 3]);
    expect(items[0]!.has_neg).toBe(false);
    expect(items[1]!.insts[0]!.transform.translation).toEqual([0, 0, 0]);
    expect(items[1]!.has_neg).toBe(true);
    expect(items.every((item) => item.owner === '24381_145018')).toBe(true);
  });

  it('attributeHistory：行映成端口形状（refno 归一 a_b、成员 / owner 也归一），truncated 时按最后一条连续拉', async () => {
    const attributeHistory = vi.fn()
      .mockResolvedValueOnce(attributeHistoryResponse({
        truncated: true,
        entries: [{
          sesno: 5, session_time: '2026-07-02T09:00:00+08:00', user: 'dpc', comment: '初始交付', kind: 'created',
          impact: 'delivery', changed_count: 0, changes: [],
        }],
      }))
      .mockResolvedValueOnce(attributeHistoryResponse({
        entries: [{
          sesno: 626, session_time: '2026-09-18T19:31:48+08:00', user: 'dpc', comment: 'up 500mm', kind: 'modified',
          impact: 'mesh', changed_count: 3,
          changes: [{ name: 'POS', value_type: 'vec3', before: '10887, 12332, 2900', after: '10887, 12332, 3400', stamp: false },
            { name: 'CACHID', value_type: 'int', before: '41', after: '42', stamp: true }],
          members: { added: ['24384/9'], removed: [], reordered: false },
          owner: ['24384/1', '24384/2'],
        }],
      }));
    const source = createGenModelV1ModelVersionSource(api({ attributeHistory }));

    const history = await source.attributeHistory(8000, '24384/23262');

    expect(attributeHistory.mock.calls.map(([req]) => (req as { sinceSesno?: number }).sinceSesno)).toEqual([undefined, 5]);
    expect(history.refno).toBe('24384_23262');
    expect(history.unitRefno).toBe('24384_23257');
    expect(history.entries.map((entry) => entry.sesno)).toEqual([5, 626]);
    expect(history.entries[1]).toMatchObject({
      user: 'dpc', comment: 'up 500mm', kind: 'modified', impact: 'mesh', changedCount: 3,
      members: { added: ['24384_9'], removed: [], reordered: false },
      owner: ['24384_1', '24384_2'],
    });
    expect(history.entries[1]!.changes[1]).toEqual({ name: 'CACHID', valueType: 'int', before: '41', after: '42', stamp: true });
    expect(history.entries[0]!.members).toBeNull();
  });

  it('attributeHistory / diffSummary：旧服务端没有这条路由（无信封 404）→ ModelVersionRouteUnavailableError，带信封的 404 原样抛', async () => {
    const missing = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/node/diff-summary', message: 'HTTP 404 Not Found' });
    });
    const source = createGenModelV1ModelVersionSource(api({ attributeHistory: missing as never, diffSummary: missing as never }));

    await expect(source.attributeHistory(8000, '24384_23262')).rejects.toBeInstanceOf(ModelVersionRouteUnavailableError);
    await expect(source.diffSummary(8000, '24384_23257', 573, 626, 'subtree')).rejects.toBeInstanceOf(ModelVersionRouteUnavailableError);

    const real404 = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'SESSION_NOT_FOUND' as never, status: 404, path: '/api/v1/node/diff-summary', message: '会话 9 不在链上' });
    });
    const strict = createGenModelV1ModelVersionSource(api({ diffSummary: real404 as never }));
    await expect(strict.diffSummary(8000, '24384_23257', 9, 626, 'self')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('attributeDiff：回执映成端口形状（refno / unit / 成员 / owner 归一 a_b、attributes_unavailable → null），旧服务端无路由 → ModelVersionRouteUnavailableError', async () => {
    const attributeDiff = vi.fn().mockResolvedValue(attributeDiffResponse({
      kind: 'modified',
      impact: 'placement',
      changed_count: 2,
      changes: [{ name: 'POS', value_type: 'vec3', before: '10887, 12332, 2900', after: '10887, 12332, 3400', stamp: false }],
      members: { added: ['24384/9'], removed: ['24384/8'], reordered: true },
      owner: ['24384/1', '24384/2'],
      warnings: ['w1'],
    }));
    const source = createGenModelV1ModelVersionSource(api({ attributeDiff }));

    const diff = await source.attributeDiff(8000, '24384/23262', 573, 626);

    // 发给服务端的 refno 归一成 a_b
    expect(attributeDiff.mock.calls.map(([req]) => req)[0]).toMatchObject({ dbnum: 8000, refno: '24384_23262', a: 573, b: 626 });
    expect(diff).toMatchObject({
      refno: '24384_23262',
      unitRefno: '24384_23257',
      unitNoun: 'BRAN',
      kind: 'modified',
      impact: 'placement',
      changedCount: 2,
      members: { added: ['24384_9'], removed: ['24384_8'], reordered: true },
      owner: ['24384_1', '24384_2'],
      attributesUnavailable: null,
      warnings: ['w1'],
    });

    // 旧服务端没有这条路由（无信封 404）→ 回落信号
    const missing = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/element/attribute-diff', message: 'HTTP 404 Not Found' });
    });
    const stale = createGenModelV1ModelVersionSource(api({ attributeDiff: missing as never }));
    await expect(stale.attributeDiff(8000, '24384_23262', 573, 626)).rejects.toBeInstanceOf(ModelVersionRouteUnavailableError);
  });

  it('listNodeVersions：行映成端口形状（impact / self_impact / 两格单元数），scope 原样发给服务端，truncated 时按最后一条连续拉', async () => {
    const nodeVersions = vi.fn()
      .mockResolvedValueOnce(nodeVersionsResponse({
        truncated: true,
        versions: [
          { sesno: 444, session_time: '2026-09-01T00:00:00+08:00', impact: 'delivery', self_impact: 'delivery', units_changed: 449, units_touched: 449 },
          { sesno: 618, session_time: null, impact: 'mesh', self_impact: null, units_changed: 1, units_touched: 2 },
        ],
      }))
      .mockResolvedValueOnce(nodeVersionsResponse({
        versions: [{ sesno: 628, session_time: 't628', impact: 'mesh', self_impact: null, units_changed: 2, units_touched: 2 }],
      }));
    const source = createGenModelV1ModelVersionSource(api({ nodeVersions }));

    const table = await source.listNodeVersions(8000, '24384/22399', 'subtree');

    expect(nodeVersions).toHaveBeenNthCalledWith(1, { dbnum: 8000, refno: '24384_22399', scope: 'subtree', sinceSesno: undefined }, { signal: undefined });
    expect(nodeVersions).toHaveBeenNthCalledWith(2, { dbnum: 8000, refno: '24384_22399', scope: 'subtree', sinceSesno: 618 }, { signal: undefined });
    expect(table).toMatchObject({ dbnum: 8000, refno: '24384_22399', noun: 'SITE', scope: 'subtree', unitRefno: null, unitNoun: null });
    expect(table.versions).toEqual([
      { sesno: 444, sessionTime: '2026-09-01T00:00:00+08:00', impact: 'delivery', selfImpact: 'delivery', unitsChanged: 449, unitsTouched: 449 },
      { sesno: 618, sessionTime: null, impact: 'mesh', selfImpact: null, unitsChanged: 1, unitsTouched: 2 },
      { sesno: 628, sessionTime: 't628', impact: 'mesh', selfImpact: null, unitsChanged: 2, unitsTouched: 2 },
    ]);

    // 构件：所属单元照归一成 a_b
    const leaf = createGenModelV1ModelVersionSource(api({
      nodeVersions: vi.fn(async () => nodeVersionsResponse({ refno: '24384/23262', noun: 'FTUB', scope: 'self', unit_root: '24384/23257', unit_noun: 'BRAN' })),
    }));
    expect(await leaf.listNodeVersions(8000, '24384_23262', 'self')).toMatchObject({ refno: '24384_23262', unitRefno: '24384_23257', unitNoun: 'BRAN', scope: 'self' });
  });

  it('listNodeVersions：旧服务端没有这条路由 → ModelVersionRouteUnavailableError(node/versions)，带信封的 404 原样抛', async () => {
    const missing = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/node/versions', message: 'HTTP 404 Not Found' });
    });
    const source = createGenModelV1ModelVersionSource(api({ nodeVersions: missing as never }));
    await expect(source.listNodeVersions(8000, '24384_22399', 'subtree')).rejects.toMatchObject({ name: 'ModelVersionRouteUnavailableError', route: 'node/versions' });

    const real404 = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'REFNO_NOT_FOUND' as never, status: 404, path: '/api/v1/node/versions', message: '整条链上都没有它' });
    });
    const strict = createGenModelV1ModelVersionSource(api({ nodeVersions: real404 as never }));
    await expect(strict.listNodeVersions(8000, '24384_1', 'subtree')).rejects.toMatchObject({ code: 'REFNO_NOT_FOUND' });
  });

  it('diffSummary：分组 / 行归一成 a_b，scope 原样发给服务端', async () => {
    const diffSummary = vi.fn(async () => diffSummaryResponse({
      groups: [{
        unit_root: '24384/23257', unit_noun: 'BRAN', unit_name: '/C-OR-1R345-C',
        counts: { added: 0, deleted: 0, modified: 1, noop: 1 }, geometry_changed: true, rows_truncated: 0,
        rows: [
          { refno: '24384/23257', noun: 'BRAN', status: 'noop', impact: 'noop', is_node: true },
          { refno: '24384/23262', noun: 'FTUB', status: 'modified', impact: 'mesh', is_node: false },
        ],
      }],
      warnings: ['x'],
    }));
    const source = createGenModelV1ModelVersionSource(api({ diffSummary }));

    const summary = await source.diffSummary(8000, '24384/23257', 573, 626, 'self');

    expect(diffSummary).toHaveBeenCalledWith({ dbnum: 8000, refno: '24384_23257', a: 573, b: 626, scope: 'self' }, { signal: undefined });
    expect(summary.refno).toBe('24384_23257');
    expect(summary.units).toEqual({ changed: 1, unchanged: 0, total: 1, complete: true });
    expect(summary.groups[0]).toMatchObject({ unitRefno: '24384_23257', unitName: '/C-OR-1R345-C', geometryChanged: true });
    expect(summary.groups[0]!.rows.map((row) => [row.refno, row.status, row.isNode])).toEqual([
      ['24384_23257', 'noop', true],
      ['24384_23262', 'modified', false],
    ]);
    expect(summary.warnings).toEqual(['x']);
  });
});
