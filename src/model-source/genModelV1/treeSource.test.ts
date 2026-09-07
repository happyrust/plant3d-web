import { describe, expect, it, vi } from 'vitest';

import { createGenModelV1TreeSource, eleTreeNodeToDto, isVirtualRootId, makeVirtualRootId, type GenModelV1TreeApi } from './treeSource';

import type { ModelRecordsApi } from './modelRecords';

import { GenModelV1ApiError, toV1Refno, type EleTreeNodeDto, type SearchResponse, type TreeRootsResponse } from '@/api/genModelV1Api';

// fixture：spec §2.2 / live :18082 的真实形状
const SITE_A: EleTreeNodeDto = { refno: '9304_2', noun: 'SITE', name: '/1RS-CIVI', owner: '9304_0', order: 0, children_count: 3, dbnum: 1112 };
const SITE_B: EleTreeNodeDto = { refno: '24381_2', noun: 'SITE', name: '/1WCC-PIPE', owner: '24381_1', order: 1, children_count: 12, dbnum: 7997 };
const ZONE_A1: EleTreeNodeDto = { refno: '17496_8518', noun: 'ZONE', name: '/1RS-WF05', owner: '9304_2', order: 0, children_count: 1, dbnum: 1112 };
const ZONE_A2: EleTreeNodeDto = { refno: '17496_8517', noun: 'ZONE', name: '', owner: '9304_2', order: 1, children_count: 0, dbnum: null };
const BRAN: EleTreeNodeDto = { refno: '24381_145018', noun: 'BRAN', name: '/B1', owner: '24381_101410', order: 0, children_count: 5, dbnum: 7997 };

const ROOTS: TreeRootsResponse = { source: 'direct', project: 'AvevaMarineSample', mdb: '/ALL', nodes: [SITE_A, SITE_B] };
const ROOT_ID = makeVirtualRootId('AvevaMarineSample', '/ALL');

function fakeApi(overrides: Partial<GenModelV1TreeApi> = {}): GenModelV1TreeApi & { calls: Record<string, number> } {
  const calls: Record<string, number> = { roots: 0, children: 0, ancestors: 0, search: 0 };
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
});

describe('createGenModelV1TreeSource', () => {
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
    expect(api.children).toHaveBeenLastCalledWith('9304_2');

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
    expect(api.ancestors).toHaveBeenCalledWith('17496_8518');
    expect(api.children).toHaveBeenCalledWith('9304_2');
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
    expect(api.search).toHaveBeenNthCalledWith(1, { query: 'PIPE', limit: 100, cursor: undefined });
    expect(api.search).toHaveBeenNthCalledWith(2, { query: 'PIPE', limit: 100, cursor: 2 });

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

  it('visibleInsts = ensure → records → 构件 refno 去重；容器 422 展开一层逐个 ensure', async () => {
    const ensure = vi.fn(async ({ refno: raw }: { refno: string }) => {
      const refno = toV1Refno(raw);
      if (refno === '9304/2') {
        throw new GenModelV1ApiError({ code: 'container', status: 422, path: '/api/v1/model/ensure', message: 'SITE' });
      }
      if (refno === '17496/8517') return { status: 'NoRenderableGeometry', model_available: false, generation_root: refno };
      return { status: 'Generated', generation_root: refno, generation_roots: [refno] };
    });
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => ({
      source: 'model-memory',
      items: [
        { refno: '17496_9001', old_refno: null, owner: generationRoot, world_aabb: null, world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, insts: [], has_neg: false, generic: 'ELBO', pts: null, date: null },
        { refno: '17496/9001', old_refno: null, owner: generationRoot, world_aabb: null, world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, insts: [], has_neg: false, generic: 'TUBI', pts: null, date: null },
        { refno: '17496_9002', old_refno: null, owner: generationRoot, world_aabb: null, world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, insts: [], has_neg: false, generic: 'VALV', pts: null, date: null },
      ],
      total: 3, truncated: false, next_cursor: null,
    }));
    const api = fakeApi();
    const recordsApi: ModelRecordsApi = { ensure: ensure as never, records: records as never, children: api.children };
    const tree = createGenModelV1TreeSource({ api, recordsApi });

    const resp = await tree.visibleInsts('9304_2');
    expect(resp.success).toBe(true);
    expect(resp.refnos).toEqual(['17496_9001', '17496_9002']);
    // SITE → container → 展开 → ZONE_A1 生成、ZONE_A2 无几何
    expect(ensure).toHaveBeenCalledTimes(3);
    expect(records).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledWith({ generationRoot: '17496_8518', limit: 5000, cursor: undefined }, expect.anything());
    expect(resp.debug?.source).toContain('roots=1');
    expect(resp.debug?.source).toContain('empty=1');

    expect((await tree.visibleInsts(ROOT_ID)).success).toBe(false);
  });
});
