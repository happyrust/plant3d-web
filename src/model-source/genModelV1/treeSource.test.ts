import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGenModelV1TreeSource, eleTreeNodeToDto, isGroupRootId, isVirtualRootId, makeGroupRootId, makeVirtualRootId, SUBTREE_CONCURRENCY, type GenModelV1TreeApi } from './treeSource';

import type { ModelRecordsApi } from './modelRecords';

import { GenModelV1ApiError, toV1Refno, type EleTreeNodeDto, type SearchResponse, type TreeRootsResponse } from '@/api/genModelV1Api';
import {
  __resetGenModelV1ServiceLifecycleForTests,
  observeGenModelV1Health,
} from '@/model-source/genModelV1/serviceLifecycle';

// fixture：spec §2.2 / live :18082 的真实形状
const SITE_A: EleTreeNodeDto = { refno: '9304_2', noun: 'SITE', name: '/1RS-CIVI', owner: '9304_0', order: 0, children_count: 3, dbnum: 1112 };
const SITE_B: EleTreeNodeDto = { refno: '24381_2', noun: 'SITE', name: '/1WCC-PIPE', owner: '24381_1', order: 1, children_count: 12, dbnum: 7997 };
const ZONE_A1: EleTreeNodeDto = { refno: '17496_8518', noun: 'ZONE', name: '/1RS-WF05', owner: '9304_2', order: 0, children_count: 1, dbnum: 1112 };
const ZONE_A2: EleTreeNodeDto = { refno: '17496_8517', noun: 'ZONE', name: '', owner: '9304_2', order: 1, children_count: 0, dbnum: null };
const BRAN: EleTreeNodeDto = { refno: '24381_145018', noun: 'BRAN', name: '/B1', owner: '24381_101410', order: 0, children_count: 5, dbnum: 7997 };

const ROOTS: TreeRootsResponse = { source: 'direct', project: 'AvevaMarineSample', mdb: '/ALL', nodes: [SITE_A, SITE_B] };
const ROOT_ID = makeVirtualRootId('AvevaMarineSample', '/ALL');

type CallCounters = {
  roots: number;
  children: number;
  ancestors: number;
  search: number;
};

function fakeApi(overrides: Partial<GenModelV1TreeApi> = {}): GenModelV1TreeApi & { calls: CallCounters } {
  const calls: CallCounters = { roots: 0, children: 0, ancestors: 0, search: 0 };
  const api: GenModelV1TreeApi = {
    roots: vi.fn(async () => { calls.roots++; return ROOTS; }),
    children: vi.fn(async (refno: string) => {
      calls.children++;
      const parent = toV1Refno(refno); // 真 API 会把 a_b 转成 a/b，这里照抄
      if (parent === '9304/2') return { source: 'direct', parent, nodes: [ZONE_A1, ZONE_A2] };
      if (parent === '17496/8518') return { source: 'direct', parent, nodes: [BRAN] };
      if (parent === '9304/0') return { source: 'direct', parent, nodes: [SITE_A] };
      return { source: 'direct', parent, nodes: [] };
    }),
    ancestors: vi.fn(async (raw: string) => {
      calls.ancestors++;
      const refno = toV1Refno(raw);
      if (refno === '24381/145018') return { source: 'direct', refnos: ['24381_145018', '24381_101410', '24381_2', '24381_1'] };
      if (refno === '17496/8518') return { source: 'direct', refnos: ['17496_8518', '9304_2', '9304_0'] };
      if (refno === '9304/2') return { source: 'direct', refnos: ['9304_2', '9304_0'] };
      throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '/api/v1/tree/ancestors', message: `no ${refno}` });
    }),
    search: vi.fn(async () => { calls.search++; return { source: 'snapshot', epoch: 1, session_vector: [], items: [], total: 0, truncated: false, next_cursor: null } satisfies SearchResponse; }),
    ...overrides,
  };
  return Object.assign(api, { calls });
}

describe('虚拟根 id', () => {
  it('不含 normalizeRefnoKey 会改写的字符（/ , < >），mdb 去掉前导斜杠', () => {
    expect(ROOT_ID).toBe('gm-root:AvevaMarineSample:ALL');
    expect(isVirtualRootId(ROOT_ID)).toBe(true);
    expect(isVirtualRootId('24381_2')).toBe(false);
    expect(makeVirtualRootId('P/Q', '/A,B')).toBe('gm-root:P_Q:A_B');
  });
});

describe('EleTreeNode → TreeNodeDto', () => {
  it('refno / owner 归一为 a_b，空名退回 noun，dbnum 透传（null 保持 null）', () => {
    expect(eleTreeNodeToDto(ZONE_A2, '9304_2')).toEqual({
      refno: '17496_8517', name: 'ZONE', noun: 'ZONE', owner: '9304_2', children_count: 0, dbnum: null,
    });
    expect(eleTreeNodeToDto({ ...BRAN, refno: '24381/145018', owner: '24381/101410' })).toMatchObject({
      refno: '24381_145018', owner: '24381_101410', dbnum: 7997,
    });
  });

  it('short_name 只在与 name 不同（无名构件）时带上；stored_name 服务端给了就透传，null 保持 null', () => {
    // 2026-09-20 起的服务端：无名 ZONE 的 name 是整条 FLNM，short_name 是短名，stored_name 是 null
    const unnamed: EleTreeNodeDto = { ...ZONE_A2, name: 'ZONE 4 of SITE 2', short_name: 'ZONE 4', stored_name: null };
    expect(eleTreeNodeToDto(unnamed, '9304_2')).toEqual({
      refno: '17496_8517', name: 'ZONE 4 of SITE 2', noun: 'ZONE', owner: '9304_2', children_count: 0, dbnum: null,
      short_name: 'ZONE 4', stored_name: null,
    });
    // 有名字的构件：short_name 与 name 相同，不带——树上本来就显示 name
    const named: EleTreeNodeDto = { ...BRAN, short_name: '/B1', stored_name: '/B1' };
    expect(eleTreeNodeToDto(named)).toEqual({ ...eleTreeNodeToDto(BRAN), stored_name: '/B1' });
    // 老服务端两格都不给：DTO 与从前逐字段相同
    expect(eleTreeNodeToDto(BRAN)).not.toHaveProperty('short_name');
    expect(eleTreeNodeToDto(BRAN)).not.toHaveProperty('stored_name');
  });
});

describe('createGenModelV1TreeSource', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('worldRoot 合成虚拟根，children(虚拟根) 复用同一份 tree/roots（不打第二次）', async () => {
    const api = fakeApi();
    const tree = createGenModelV1TreeSource({ api });
    const root = await tree.worldRoot();
    expect(root).toEqual({
      success: true,
      node: { refno: ROOT_ID, name: 'AvevaMarineSample / ALL', noun: 'WORL', owner: null, children_count: 2, dbnum: null },
    });
    const children = await tree.children(ROOT_ID, 2000);
    expect(children.success).toBe(true);
    expect(children.parent_refno).toBe(ROOT_ID);
    expect(children.children.map((c) => c.refno)).toEqual(['9304_2', '24381_2']);
    expect(children.children[0]).toMatchObject({ noun: 'SITE', name: '/1RS-CIVI', owner: ROOT_ID, dbnum: 1112, children_count: 3 });
    expect(children.truncated).toBe(false);
    expect(api.calls.roots).toBe(1);
  });

  it('children(refno) 收 a_b 写法、按 limit 截断并置 truncated', async () => {
    const api = fakeApi();
    const tree = createGenModelV1TreeSource({ api });
    const all = await tree.children('9304_2');
    expect(all.children.map((c) => c.refno)).toEqual(['17496_8518', '17496_8517']);
    expect(all.truncated).toBe(false);
    expect(api.children).toHaveBeenLastCalledWith('9304_2', expect.objectContaining({ signal: expect.anything() }));

    const one = await tree.children('9304/2', 1);
    expect(one.children).toHaveLength(1);
    expect(one.truncated).toBe(true);
  });

  it('ancestors：a_b 归一、自己在前、末尾补虚拟根；虚拟根自己只回自己', async () => {
    const api = fakeApi();
    const tree = createGenModelV1TreeSource({ api });
    expect(await tree.ancestors('24381/145018')).toEqual({
      success: true,
      refnos: ['24381_145018', '24381_101410', '24381_2', '24381_1', ROOT_ID],
    });
    expect(await tree.ancestors(ROOT_ID)).toEqual({ success: true, refnos: [ROOT_ID] });
  });

  it('GenModelV1ApiError 折成 success:false + error_message，不抛', async () => {
    const api = fakeApi();
    const tree = createGenModelV1TreeSource({ api });
    const resp = await tree.ancestors('1_1');
    expect(resp.success).toBe(false);
    expect(resp.refnos).toEqual([]);
    expect(resp.error_message).toContain('not_found');
  });

  it('node：祖先链第二项是属主，从属主 children 里捞出自己', async () => {
    const api = fakeApi();
    const tree = createGenModelV1TreeSource({ api });
    const resp = await tree.node('17496_8518');
    expect(resp.success).toBe(true);
    expect(resp.node).toMatchObject({ refno: '17496_8518', noun: 'ZONE', owner: '9304_2', dbnum: 1112 });
    expect(api.ancestors).toHaveBeenCalledWith('17496_8518', expect.objectContaining({ signal: expect.anything() }));
    expect(api.children).toHaveBeenCalledWith('9304_2', expect.objectContaining({ signal: expect.anything() }));
  });

  it('search：noun 过滤在客户端做，不够一页就翻页，达到 limit 停', async () => {
    const pages: SearchResponse[] = [
      {
        source: 'snapshot', epoch: 1, session_vector: [], total: 4, truncated: true, next_cursor: 2,
        items: [
          { name: '/1PCS-LX-PIPE', refno: '24381/101410', dbnum: 7997, noun: 'ZONE' },
          { name: '/1RCV-PIPEBJ', refno: '24383/73927', dbnum: 7999, noun: 'SITE' },
        ],
      },
      {
        source: 'snapshot', epoch: 1, session_vector: [], total: 4, truncated: false, next_cursor: null,
        items: [
          { name: '/PIPE-B1', refno: '24381/145018', dbnum: 7997, noun: 'BRAN' },
          { name: '/PIPE-B2', refno: '24381/145019', dbnum: 7997, noun: 'BRAN' },
        ],
      },
    ];
    let call = 0;
    const api = fakeApi({ search: vi.fn(async () => pages[call++]!) });
    const tree = createGenModelV1TreeSource({ api });

    const brans = await tree.search({ keyword: 'PIPE', nouns: ['bran'], limit: 1 });
    expect(brans.success).toBe(true);
    expect(brans.items).toEqual([{ refno: '24381_145018', name: '/PIPE-B1', noun: 'BRAN', owner: null, children_count: null, dbnum: 7997 }]);
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(api.search).toHaveBeenNthCalledWith(
      1,
      { query: 'PIPE', limit: 100, cursor: undefined },
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(api.search).toHaveBeenNthCalledWith(
      2,
      { query: 'PIPE', limit: 100, cursor: 2 },
      expect.objectContaining({ signal: expect.anything() }),
    );

    call = 0;
    const all = await tree.search({ keyword: 'PIPE', limit: 50 });
    expect(all.items.map((i) => i.refno)).toEqual(['24381_101410', '24383_73927', '24381_145018', '24381_145019']);
    expect(await tree.search({ keyword: '  ' })).toEqual({ success: true, items: [] });
  });

  it('subtreeRefnos：BFS children，includeSelf / maxDepth 生效，虚拟根拒绝', async () => {
    const api = fakeApi();
    const tree = createGenModelV1TreeSource({ api });
    const full = await tree.subtreeRefnos('9304_2', { includeSelf: true });
    expect(full.success).toBe(true);
    expect(full.refnos).toEqual(['9304_2', '17496_8518', '17496_8517', '24381_145018']);
    expect(full.truncated).toBe(false);
    // children_count=0 的 ZONE_A2 不再请求：9304/2、17496/8518、24381/145018 三次
    expect(api.calls.children).toBe(3);

    const shallow = await tree.subtreeRefnos('9304_2', { includeSelf: false, maxDepth: 1 });
    expect(shallow.refnos).toEqual(['17496_8518', '17496_8517']);
    expect(shallow.truncated).toBe(true);

    const root = await tree.subtreeRefnos(ROOT_ID);
    expect(root.success).toBe(false);
  });

  it('subtreeRefnos：同一层的 children 并发请求（≤ SUBTREE_CONCURRENCY），层内顺序不变', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const zones: EleTreeNodeDto[] = Array.from({ length: 20 }, (_, i) => ({
      refno: `5_${i + 1}`, noun: 'ZONE', name: `/Z${i + 1}`, owner: '5_0', order: i, children_count: 1, dbnum: 5,
    }));
    const api = fakeApi({
      children: vi.fn(async (raw: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        const parent = toV1Refno(raw);
        if (parent === '5/0') return { source: 'direct', parent, nodes: zones };
        const n = Number(parent.split('/')[1]);
        return { source: 'direct', parent, nodes: [{ refno: `5_${100 + n}`, noun: 'BRAN', name: `/B${n}`, owner: `5_${n}`, order: 0, children_count: 0, dbnum: 5 }] };
      }),
    });
    const tree = createGenModelV1TreeSource({ api });
    const resp = await tree.subtreeRefnos('5_0', { includeSelf: false });
    expect(resp.success).toBe(true);
    expect(resp.truncated).toBe(false);
    expect(resp.refnos).toEqual([...zones.map((z) => z.refno), ...zones.map((_, i) => `5_${101 + i}`)]);
    expect(api.children).toHaveBeenCalledTimes(21);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(SUBTREE_CONCURRENCY);
  });

  it('children 要解析视图（resolved=1）：分组成员行带 via / secondary，坏槽 refno 归一后透传', async () => {
    const api = fakeApi({
      children: vi.fn(async (raw: string) => ({
        source: 'direct',
        parent: toV1Refno(raw),
        view: 'resolved' as const,
        nodes: [
          { ...ZONE_A1, via: '2013286748_12', secondary: true, rule: false },
          { refno: '2013286748_13', noun: 'GPSET', name: '/NESTED', owner: '2013286748_11', order: 1, children_count: 0, dbnum: 250204 },
        ],
        unresolved: [{ via: '2013286748/14', target: '9999/1', reason: 'db_not_in_mdb' as const }],
      })),
    });
    const tree = createGenModelV1TreeSource({ api });
    const resp = await tree.children('2013286748_11');
    expect(api.children).toHaveBeenLastCalledWith('2013286748_11', expect.objectContaining({ resolved: true }));
    expect(resp.children[0]).toMatchObject({ refno: '17496_8518', owner: '2013286748_11', via: '2013286748_12', secondary: true });
    expect(resp.children[0]).not.toHaveProperty('rule');
    expect(resp.children[1]).not.toHaveProperty('via');
    expect(resp.children[1]).not.toHaveProperty('secondary');
    expect(resp.unresolved).toEqual([{ via: '2013286748_14', target: '9999_1', reason: 'db_not_in_mdb' }]);
  });

  it('children 记下服务端的视图：老服务端不回 view（没认 resolved=1）记 stored，认了记 resolved，虚拟根不带', async () => {
    let view: 'resolved' | undefined;
    const api = fakeApi({
      children: vi.fn(async (raw: string) => ({ source: 'direct', parent: toV1Refno(raw), ...(view ? { view } : {}), nodes: [] })),
    });
    const tree = createGenModelV1TreeSource({ api });
    expect((await tree.children('2013286748_11')).view).toBe('stored');
    view = 'resolved';
    expect((await tree.children('2013286748_11')).view).toBe('resolved');
    expect((await tree.children(ROOT_ID)).view).toBeUndefined();
  });

  it('subtreeRefnos：映射时见过的分组（GPWL / GPSET）不走 BFS，直接拒绝', async () => {
    const GPSET: EleTreeNodeDto = { refno: '2013286748_11', noun: 'GPSET', name: '/AREA01_PIPE', owner: '2013286748_1', order: 0, children_count: 2, dbnum: 250204 };
    const api = fakeApi({
      children: vi.fn(async (raw: string) => ({ source: 'direct', parent: toV1Refno(raw), nodes: toV1Refno(raw) === '2013286748/1' ? [GPSET] : [] })),
    });
    const tree = createGenModelV1TreeSource({ api });
    await tree.children('2013286748_1');
    const resp = await tree.subtreeRefnos('2013286748_11');
    expect(resp.success).toBe(false);
    expect(resp.error_message).toMatch(/generation_roots/);
    expect(api.children).toHaveBeenCalledTimes(1);
  });

  it('groupRoot：tree/roots?nouns=GPWL 有分组才出「分组」根；children(分组根) 列 GPWL；分组层级里的祖先链挂分组根', async () => {
    const GPWL: EleTreeNodeDto = { refno: '2013286748_1', noun: 'GPWL', name: '/GROUPS', owner: '2013286748_0', order: 0, children_count: 1, dbnum: 250204 };
    const roots = vi.fn(async (options?: { nouns?: string }) => (options?.nouns === 'GPWL' ? { ...ROOTS, nodes: [GPWL, SITE_A] } : ROOTS));
    const api = fakeApi({
      roots,
      ancestors: vi.fn(async (raw: string) => {
        if (toV1Refno(raw) === '2013286748/11') {
          return { source: 'direct' as const, refnos: ['2013286748_11', '2013286748_1', '2013286748_0'] };
        }
        return {
          source: 'direct' as const,
          refnos: ['17496_8518', '9304_2', '9304_0'],
          secondary_parents: [{ member: '17496/8518', group: '2013286748/11', group_noun: 'GPSET', group_name: '/HVAC', via: '2013286748/12' }],
        };
      }),
    });
    const tree = createGenModelV1TreeSource({ api });
    const GROUP_ROOT_ID = makeGroupRootId('AvevaMarineSample', '/ALL');
    expect(isGroupRootId(GROUP_ROOT_ID)).toBe(true);
    expect(isVirtualRootId(GROUP_ROOT_ID)).toBe(true);
    expect(isGroupRootId(ROOT_ID)).toBe(false);

    const root = await tree.groupRoot?.();
    expect(roots).toHaveBeenCalledWith(expect.objectContaining({ nouns: 'GPWL' }));
    expect(root).toEqual({ success: true, node: expect.objectContaining({ refno: GROUP_ROOT_ID, name: '分组', children_count: 1 }) });

    const kids = await tree.children(GROUP_ROOT_ID);
    expect(kids.children.map((child) => [child.refno, child.owner])).toEqual([['2013286748_1', GROUP_ROOT_ID]]);
    expect((await tree.node(GROUP_ROOT_ID)).node?.refno).toBe(GROUP_ROOT_ID);

    expect((await tree.ancestors('2013286748_11')).refnos.at(-1)).toBe(GROUP_ROOT_ID);
    const design = await tree.ancestors('17496_8518');
    expect(design.refnos.at(-1)).toBe(ROOT_ID);
    expect(design.secondary_parents).toEqual([
      { member: '17496_8518', group: '2013286748_11', group_noun: 'GPSET', group_name: '/HVAC', via: '2013286748_12' },
    ]);
  });

  it('groupRoot：没有分组 → node: null；老服务端不认 nouns=GPWL（400）→ node: null，不记请求失败', async () => {
    const empty = createGenModelV1TreeSource({ api: fakeApi({ roots: vi.fn(async () => ({ ...ROOTS, nodes: [] })) }) });
    expect(await empty.groupRoot?.()).toEqual({ success: true, node: null });

    const noteRequestFailure = vi.fn();
    const old = createGenModelV1TreeSource({
      api: fakeApi({
        roots: vi.fn(async () => {
          throw new GenModelV1ApiError({ code: 'bad_request', status: 400, path: '/api/v1/tree/roots', message: 'nouns 只接受 SITE / APPLDW' });
        }),
      }),
      noteRequestFailure,
    });
    expect(await old.groupRoot?.()).toEqual({ success: true, node: null });
    expect(noteRequestFailure).not.toHaveBeenCalled();
  });

  it('visibleInsts = 按祖先查 records → 构件 refno 去重，不 generate', async () => {
    const generate = vi.fn();
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => ({
      source: 'model-database',
      items: [
        { refno: '17496_9001', old_refno: null, owner: generationRoot, world_aabb: null, world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, insts: [], has_neg: false, generic: 'ELBO', pts: null, date: null },
        { refno: '17496/9001', old_refno: null, owner: generationRoot, world_aabb: null, world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, insts: [], has_neg: false, generic: 'TUBI', pts: null, date: null },
        { refno: '17496_9002', old_refno: null, owner: generationRoot, world_aabb: null, world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, insts: [], has_neg: false, generic: 'VALV', pts: null, date: null },
      ],
      total: 3, truncated: false, next_cursor: null,
    }));
    const api = fakeApi();
    const recordsApi: ModelRecordsApi = { generate: generate as never, records: records as never, children: api.children };
    const tree = createGenModelV1TreeSource({ api, recordsApi });

    const resp = await tree.visibleInsts('9304_2');
    expect(resp.success).toBe(true);
    expect(resp.refnos).toEqual(['17496_9001', '17496_9002']);
    expect(generate).not.toHaveBeenCalled();
    expect(records).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledWith({ generationRoot: '9304_2', limit: 5000, cursor: undefined }, expect.anything());
    expect(resp.debug?.source).toContain('roots=1');
    expect(resp.incomplete).toBeNull();

    expect((await tree.visibleInsts(ROOT_ID)).success).toBe(false);
  });

  it('visibleInsts 碰上 409 conflict 时把范围放进 incomplete.pending，不 generate', async () => {
    const generate = vi.fn();
    const records = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '/api/v1/model/records', message: 'dbnum task running' });
    });
    const api = fakeApi();
    const recordsApi: ModelRecordsApi = { generate: generate as never, records: records as never, children: api.children };
    const tree = createGenModelV1TreeSource({ api, recordsApi });

    const resp = await tree.visibleInsts('9304_2');
    expect(resp.success).toBe(true);
    expect(resp.refnos).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(resp.incomplete).toEqual({
      pending: ['9304_2'],
      truncated_roots: [],
      errors: {},
    });
  });

  it('invalidate 清 roots Promise；代次变化后才返回的旧 roots 不能回填或交给调用方', async () => {
    const freshRoots = { ...ROOTS, project: 'FreshProject' };
    let resolveOld!: (value: TreeRootsResponse) => void;
    const roots = vi.fn()
      .mockImplementationOnce(() => new Promise<TreeRootsResponse>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(freshRoots);
    const tree = createGenModelV1TreeSource({ api: fakeApi({ roots }) });
    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');

    const pending = tree.worldRoot();
    await vi.waitFor(() => expect(roots).toHaveBeenCalledTimes(1));
    observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm');
    tree.invalidate();
    resolveOld(ROOTS);
    const stale = await pending;
    expect(stale.success).toBe(false);
    expect(stale.error_message).toMatch(/服务实例已变化/);

    const fresh = await tree.worldRoot();
    expect(fresh.success).toBe(true);
    expect(fresh.node?.name).toContain('FreshProject');
    expect(roots).toHaveBeenCalledTimes(2);
  });
});
