import { describe, expect, it, vi } from 'vitest';

import {
  createGenModelV1ModelVersionSource,
  historyRowsToGeomInstQueries,
  MAX_PAGES,
  ownerMapFromHistoryRows,
  type GenModelV1VersionApi,
} from './versionSource';

import { GenModelV1ApiError, unpackRefno, type ModelVersionsResponse, type TaskEntryDto } from '@/api/genModelV1Api';
import { NotDeliveryUnitRootError } from '@/model-source/modelVersionErrors';

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

function api(overrides: Partial<GenModelV1VersionApi> = {}): GenModelV1VersionApi {
  return {
    listVersions: vi.fn(async () => response({})),
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
});
