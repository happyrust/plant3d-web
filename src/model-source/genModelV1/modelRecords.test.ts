import { describe, expect, it, vi } from 'vitest';

import {
  batchRecordsSupport, ensureAndCollectRecords, mapWithConcurrency, planRecordsBatches, refnosOfRecords, type ModelRecordsApi,
} from './modelRecords';

import { GenModelV1ApiError, toV1Refno, type GenModelV1RecordsRequest, type GeomInstQuery, type ModelRecordsResponse } from '@/api/genModelV1Api';

// 真 API 会把 a_b 转成 a/b；这里的假 API 同样先归一再比，免得测试只测到一种写法。
const v1 = toV1Refno;

function item(refno: string, owner: string): GeomInstQuery {
  return {
    refno, old_refno: null, owner, world_aabb: null,
    world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    insts: [], has_neg: false, generic: 'ELBO', pts: null, date: null,
  };
}

function container(): GenModelV1ApiError {
  return new GenModelV1ApiError({ code: 'container', status: 422, path: '/api/v1/model/ensure', message: 'SITE/ZONE 不能做生成根' });
}

/** 一根缺省的记录：`a_b` 根 → 一条 `a_9b` 构件。 */
function defaultItemsOf(root: string): GeomInstQuery[] {
  const [a, b] = v1(root).split('/');
  return [item(`${a}_9${b}`, root)];
}

/**
 * 照 spec §4.5.2 造一个同时认识单根与多根的假 `records`：单根 = 这根的记录切页；多根 = 按请求顺序平铺再切页、回显
 * `generation_roots` + `roots[]`。`itemsOf` 可以抛（模拟某根 409 等）——多根时整批一起抛（服务端就是整批 409）。
 */
function recordsServing(itemsOf: (root: string) => GeomInstQuery[] | Promise<GeomInstQuery[]> = defaultItemsOf) {
  return vi.fn(async (req: GenModelV1RecordsRequest): Promise<ModelRecordsResponse> => {
    const roots = req.generationRoots ?? [req.generationRoot!];
    const perRoot = await Promise.all(roots.map(async (root) => ({ root: v1(root), items: await itemsOf(root) })));
    const all = perRoot.flatMap((entry) => entry.items);
    const cursor = req.cursor ?? 0;
    const limit = req.limit ?? 1000;
    const page = all.slice(cursor, cursor + limit);
    const next = cursor + page.length;
    return {
      source: 'model-memory', items: page, total: all.length, truncated: next < all.length, next_cursor: next < all.length ? next : null,
      ...(req.generationRoots
        ? { generation_roots: perRoot.map((entry) => entry.root), roots: perRoot.map((entry) => ({ generation_root: entry.root, total: entry.items.length })) }
        : { generation_root: perRoot[0]!.root }),
    };
  });
}

/** 旧服务端（0.1.21）对带 `generation_roots` 的请求：JSON 反序列化就拒，422 纯文本、无信封 → 客户端兜成 precondition。 */
function legacyRecords(itemsOf: (root: string) => GeomInstQuery[] = defaultItemsOf) {
  return vi.fn(async (req: GenModelV1RecordsRequest): Promise<ModelRecordsResponse> => {
    if (req.generationRoots) {
      throw new GenModelV1ApiError({
        code: 'precondition', status: 422, path: '/api/v1/model/records',
        message: 'HTTP 422 Unprocessable Entity: Failed to deserialize the JSON body into the target type: missing field `generation_root` at line 1 column 62',
      });
    }
    const items = itemsOf(req.generationRoot!);
    return { source: 'model-memory', items, total: items.length, truncated: false, next_cursor: null, generation_root: v1(req.generationRoot!) };
  });
}

function api(overrides: Partial<ModelRecordsApi>): ModelRecordsApi {
  return {
    ensure: vi.fn(async ({ refno }) => ({ status: 'Generated', generation_root: v1(refno), generation_roots: [v1(refno)] })) as never,
    records: recordsServing() as never,
    children: vi.fn(async (refno: string) => ({ source: 'direct', parent: v1(refno), nodes: [] })) as never,
    ...overrides,
  };
}

/** 一批根的请求形状（`a/b`）；单根请求回 `[root]`。 */
function requestedRoots(call: unknown[]): string[] {
  const req = call[0] as GenModelV1RecordsRequest;
  return (req.generationRoots ?? [req.generationRoot!]).map(v1);
}

function node(refno: string, noun: string, owner: string, childrenCount: number) {
  return { refno, noun, name: refno, owner, order: 0, children_count: childrenCount };
}

describe('ensureAndCollectRecords', () => {
  it('读透形态：一次 ensure 给出多个生成根，逐根翻页收齐并去重', async () => {
    const records = vi.fn(async ({ generationRoot, cursor }: { generationRoot: string; cursor?: number }) => {
      const root = v1(generationRoot);
      if (root === '24381/145018' && cursor === undefined) {
        return { source: 'model-memory', items: [item('24381_1', '24381_145018')], total: 2, truncated: true, next_cursor: 1 };
      }
      if (root === '24381/145018') {
        return { source: 'model-memory', items: [item('24381_2', '24381_145018')], total: 2, truncated: false, next_cursor: null };
      }
      return { source: 'model-memory', items: [item('24381_3', root)], total: 1, truncated: false, next_cursor: null };
    });
    const ensure = vi.fn(async () => ({
      status: 'Generated', generation_roots: ['24381/145018', '24381/145019', '24381/145018'], snapshot_epoch: 3,
    }));
    const result = await ensureAndCollectRecords('24381_101410', { pageSize: 1 }, api({ ensure: ensure as never, records: records as never }));

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith({ refno: '24381_101410' }, expect.anything());
    expect(result.generationRoots).toEqual(['24381_145018', '24381_145019']);
    expect(records).toHaveBeenCalledTimes(3);
    expect(refnosOfRecords(result.items)).toEqual(['24381_1', '24381_2', '24381_3']);
    expect(result.pending).toEqual([]);
    expect(result.errors).toEqual({});
  });

  it('容器 422 展开一层；超过 maxContainerDepth 记 truncatedRoots；pending / not_found / 其它错误各归各', async () => {
    const ensure = vi.fn(async ({ refno: raw }: { refno: string }) => {
      const refno = v1(raw);
      if (refno === '1/1' || refno === '1/10') throw container();
      if (refno === '1/102') throw new GenModelV1ApiError({ code: 'generation_pending', status: 202, path: '', message: 'pending' });
      if (refno === '1/103') throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '', message: 'gone' });
      if (refno === '1/104') throw new GenModelV1ApiError({ code: 'generation_failed', status: 500, path: '', message: 'boom' });
      return { status: 'AlreadyAvailable', generation_root: refno };
    });
    const children = vi.fn(async (raw: string) => {
      const refno = v1(raw);
      if (refno === '1/1') return { source: 'direct', parent: refno, nodes: [node('1_10', 'ZONE', '1_1', 4)] };
      if (refno === '1/10') {
        return { source: 'direct', parent: refno, nodes: ['1_101', '1_102', '1_103', '1_104'].map((r) => node(r, 'BRAN', '1_10', 0)) };
      }
      return { source: 'direct', parent: refno, nodes: [] };
    });
    const result = await ensureAndCollectRecords('1_1', { maxContainerDepth: 2 }, api({ ensure: ensure as never, children: children as never }));

    expect(result.generationRoots).toEqual(['1_101']);
    expect(refnosOfRecords(result.items)).toEqual(['1_9101']);
    expect(result.pending).toEqual(['1_102']);
    expect(result.empty).toEqual(['1_103']);
    expect(result.errors).toEqual({ '1_104': 'generation_failed: boom' });
    expect(result.statuses).toMatchObject({ '1_101': 'AlreadyAvailable', '1_102': 'generation_pending', '1_103': 'not_found' });

    // 深度 1 就停：SITE 展开出 ZONE，ZONE 再是容器就不再展开
    const shallow = await ensureAndCollectRecords('1_1', { maxContainerDepth: 1 }, api({ ensure: ensure as never, children: children as never }));
    expect(shallow.generationRoots).toEqual([]);
    expect(shallow.truncatedRoots).toEqual(['1_10']);
  });

  it('maxRoots 上限：多出来的根进 truncatedRoots，不再 ensure', async () => {
    const ensure = vi.fn(async ({ refno: raw }: { refno: string }) => {
      const refno = v1(raw);
      if (refno === '1/1') throw container();
      return { status: 'Generated', generation_root: refno };
    });
    const children = vi.fn(async () => ({
      source: 'direct', parent: '1/1', nodes: ['1_201', '1_202', '1_203'].map((r) => node(r, 'BRAN', '1_1', 0)),
    }));
    const result = await ensureAndCollectRecords('1_1', { maxRoots: 3 }, api({ ensure: ensure as never, children: children as never }));
    expect(ensure).toHaveBeenCalledTimes(3); // 1_1 + 1_201 + 1_202
    expect(result.generationRoots).toEqual(['1_201', '1_202']);
    expect(result.truncatedRoots).toEqual(['1_203']);
  });

  it('maxRecordsRoots：一次 ensure 解出的根超出预算的不取 records、记 truncatedRoots；预算用完后队列里剩下的也不再 ensure', async () => {
    const ensure = vi.fn(async ({ refno: raw }: { refno: string }) => {
      const refno = v1(raw);
      if (refno === '1/1') throw container();
      // SITE 展开出两个 ZONE：第一个 ZONE 解出 3 根，第二个 ZONE 解出 1 根
      if (refno === '1/10') return { status: 'Generated', generation_roots: ['1/101', '1/102', '1/103'] };
      return { status: 'Generated', generation_roots: ['1/201'] };
    });
    const children = vi.fn(async () => ({ source: 'direct', parent: '1/1', nodes: [node('1_10', 'ZONE', '1_1', 3), node('1_20', 'ZONE', '1_1', 1)] }));
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => ({
      source: 'model-memory', items: [item(`1_9${v1(generationRoot).split('/')[1]}`, generationRoot)], total: 1, truncated: false, next_cursor: null,
    }));
    const result = await ensureAndCollectRecords('1_1', { maxRecordsRoots: 2 }, api({ ensure: ensure as never, children: children as never, records: records as never }));

    expect(result.generationRoots).toEqual(['1_101', '1_102']);
    expect(records).toHaveBeenCalledTimes(2);
    expect(refnosOfRecords(result.items)).toEqual(['1_9101', '1_9102']);
    // 1/103 是预算外的根；1/20 是预算用完后没再 ensure 的容器子节点
    expect(result.truncatedRoots).toEqual(['1_103', '1_20']);
    expect(ensure).toHaveBeenCalledTimes(2); // 1/1 + 1/10
  });

  it('records 回 409（还没进投影）当 pending，不当错误', async () => {
    const records = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '', message: 'not_generated' });
    });
    const result = await ensureAndCollectRecords('1_301', {}, api({ records: records as never }));
    expect(result.generationRoots).toEqual(['1_301']);
    expect(result.pending).toEqual(['1_301']);
    expect(result.errors).toEqual({});
  });

  it('NoRenderableGeometry 归 empty，不去翻 records', async () => {
    const ensure = vi.fn(async ({ refno }: { refno: string }) => ({ status: 'NoRenderableGeometry', model_available: false, generation_root: v1(refno) }));
    const records = vi.fn();
    const result = await ensureAndCollectRecords('1_401', {}, api({ ensure: ensure as never, records: records as never }));
    expect(result.empty).toEqual(['1_401']);
    expect(result.generationRoots).toEqual([]);
    expect(records).not.toHaveBeenCalled();
  });

  it('逐根口径（recordsBatchSize=1）：records 并发不超过 recordsConcurrency，结果按根顺序拼回，pending / 错误各归各，onRootDone 每根一次', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const root = v1(generationRoot);
      // 第一根最慢：后面的根先回，拼回时仍要按根的顺序
      await new Promise((resolve) => setTimeout(resolve, root === '1/1' ? 25 : 1));
      inFlight--;
      if (root === '1/3') throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '', message: 'not_generated' });
      if (root === '1/4') throw new GenModelV1ApiError({ code: 'internal', status: 500, path: '', message: 'boom' });
      return { source: 'model-memory', items: [item(`1_9${root.split('/')[1]}`, generationRoot)], total: 1, truncated: false, next_cursor: null };
    });
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_roots: ['1/1', '1/2', '1/3', '1/4', '1/5'] }));
    const progress: { done: number; total: number }[] = [];
    const result = await ensureAndCollectRecords(
      '1_0',
      { recordsConcurrency: 2, recordsBatchSize: 1, onRootDone: ({ done, total }) => progress.push({ done, total }) },
      api({ ensure: ensure as never, records: records as never }),
    );

    expect(records).toHaveBeenCalledTimes(5);
    expect(records.mock.calls.every((call) => !('generationRoots' in (call[0] as object)))).toBe(true);
    expect(maxInFlight).toBe(2);
    expect(result.generationRoots).toEqual(['1_1', '1_2', '1_3', '1_4', '1_5']);
    expect(refnosOfRecords(result.items)).toEqual(['1_91', '1_92', '1_95']);
    expect(result.pending).toEqual(['1_3']);
    expect(result.errors).toEqual({ '1_4': 'boom' });
    expect(progress.map((p) => p.done)).toEqual([1, 2, 3, 4, 5]);
    expect(progress.every((p) => p.total === 5)).toBe(true);
  });

  it('多根批量（spec §4.5.2）：一次 ensure 解出的根按批一次 records，平铺记录按 owner 归根、跨根连续翻页；根数 ≤ 并发路数时仍是单根请求', async () => {
    // 15 根 / 6 路 → 批大小 3 → 5 批；pageSize=4 让一页横跨两根
    const roots = Array.from({ length: 15 }, (_, i) => `1/${i + 1}`);
    const records = recordsServing((root) => {
      const b = v1(root).split('/')[1]!;
      // 1/5 这根就是 0 条（roots[] 里显式 total=0）；其余每根两条
      return b === '5' ? [] : [item(`1_9${b}`, root), item(`1_8${b}`, root)];
    });
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_roots: roots }));
    const recordsApi = api({ ensure: ensure as never, records: records as never });
    const progress: string[] = [];
    const result = await ensureAndCollectRecords(
      '1_0',
      { pageSize: 4, onRootDone: ({ done, total, root }) => progress.push(`${done}/${total}:${root}`) },
      recordsApi,
    );

    const batchCalls = records.mock.calls.filter((call) => (call[0] as GenModelV1RecordsRequest).generationRoots);
    expect(batchCalls.length).toBe(records.mock.calls.length); // 全是批量请求
    // 5 批各 3 根；6 条的批翻 2 页（4 + 2），含 0 条根的那批只有 4 条 → 1 页；翻页时原样带同一批根
    const firstPages = batchCalls.filter((call) => (call[0] as GenModelV1RecordsRequest).cursor === undefined);
    expect(firstPages.map(requestedRoots)).toEqual([
      ['1/1', '1/2', '1/3'], ['1/4', '1/5', '1/6'], ['1/7', '1/8', '1/9'], ['1/10', '1/11', '1/12'], ['1/13', '1/14', '1/15'],
    ]);
    expect(batchCalls.length).toBe(9);
    expect(batchCalls.filter((call) => (call[0] as GenModelV1RecordsRequest).cursor === 4).map(requestedRoots)).toEqual([
      ['1/1', '1/2', '1/3'], ['1/7', '1/8', '1/9'], ['1/10', '1/11', '1/12'], ['1/13', '1/14', '1/15'],
    ]);
    expect(batchRecordsSupport(recordsApi)).toBe('yes');

    expect(result.generationRoots).toEqual(roots.map((r) => r.replace('/', '_')));
    // 结果按根顺序拼回，0 条的根归 empty
    expect(refnosOfRecords(result.items)).toEqual(
      roots.flatMap((r) => { const b = r.split('/')[1]; return b === '5' ? [] : [`1_9${b}`, `1_8${b}`]; }),
    );
    expect(result.empty).toEqual(['1_5']);
    expect(result.pending).toEqual([]);
    expect(result.errors).toEqual({});
    expect(progress.map((p) => p.split(':')[0])).toEqual(Array.from({ length: 15 }, (_, i) => `${i + 1}/15`));
    expect(new Set(progress.map((p) => p.split(':')[1]))).toEqual(new Set(roots.map((r) => r.replace('/', '_'))));

    // 根数不超过并发路数：不打包，仍是单根请求（与旧口径一字不差）；「认不认识批量」按 api 对象记，新 api 是 unknown
    const few = recordsServing();
    const fewApi = api({ ensure: vi.fn(async () => ({ status: 'Generated', generation_roots: ['1/1', '1/2', '1/3'] })) as never, records: few as never });
    await ensureAndCollectRecords('1_0', {}, fewApi);
    expect(few).toHaveBeenCalledTimes(3);
    expect(few.mock.calls.every((call) => !(call[0] as GenModelV1RecordsRequest).generationRoots)).toBe(true);
    expect(batchRecordsSupport(fewApi)).toBe('unknown');
  });

  it('旧服务端不认识 generation_roots（422 missing field）：整批退回逐根、结果不变，并且这个 api 从此不再试批量', async () => {
    const roots = Array.from({ length: 12 }, (_, i) => `1/${i + 1}`);
    const records = legacyRecords();
    const recordsApi = api({ ensure: vi.fn(async () => ({ status: 'Generated', generation_roots: roots })) as never, records: records as never });

    const result = await ensureAndCollectRecords('1_0', { recordsConcurrency: 3 }, recordsApi);
    expect(refnosOfRecords(result.items)).toEqual(roots.map((r) => `1_9${r.split('/')[1]}`));
    expect(result.errors).toEqual({});
    expect(result.empty).toEqual([]);
    expect(batchRecordsSupport(recordsApi)).toBe('no');
    // 12 根 / 3 路 → 3 批各 4 根；第一批一 422 就记「不支持」，后面的批不再试：批量请求 ≤ 3 次，逐根 12 次
    const batchAttempts = records.mock.calls.filter((call) => (call[0] as GenModelV1RecordsRequest).generationRoots).length;
    expect(batchAttempts).toBeGreaterThanOrEqual(1);
    expect(batchAttempts).toBeLessThanOrEqual(3);
    expect(records.mock.calls.length - batchAttempts).toBe(12);

    // 同一 api 再来一次：零批量请求
    records.mockClear();
    await ensureAndCollectRecords('1_0', { recordsConcurrency: 3 }, recordsApi);
    expect(records.mock.calls.some((call) => (call[0] as GenModelV1RecordsRequest).generationRoots)).toBe(false);
    expect(records).toHaveBeenCalledTimes(12);
  });

  it('整批 409（有根未 ensure）/ 400 信封 / 5xx：退回逐根，只有真出问题的那根归 pending / errors，不记「不支持」', async () => {
    const roots = ['1/1', '1/2', '1/3', '1/4', '1/5', '1/6', '1/7', '1/8'];
    const records = recordsServing((root) => {
      const b = v1(root).split('/')[1];
      if (b === '3') throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '', message: 'not_generated: 1/3' });
      if (b === '6') throw new GenModelV1ApiError({ code: 'bad_request', status: 400, path: '', message: 'generation_roots 须属同一 dbnum' });
      if (b === '8') throw new GenModelV1ApiError({ code: 'internal', status: 500, path: '', message: 'boom' });
      return defaultItemsOf(root);
    });
    const recordsApi = api({ ensure: vi.fn(async () => ({ status: 'Generated', generation_roots: roots })) as never, records: records as never });

    // 8 根 / 4 路 → 4 批各 2 根：[1,2] 成、[3,4] 409、[5,6] 400、[7,8] 500
    const result = await ensureAndCollectRecords('1_0', { recordsConcurrency: 4 }, recordsApi);
    expect(refnosOfRecords(result.items)).toEqual(['1_91', '1_92', '1_94', '1_95', '1_97']);
    expect(result.pending).toEqual(['1_3']);
    expect(result.errors).toEqual({ '1_6': 'generation_roots 须属同一 dbnum', '1_8': 'boom' });
    expect(result.empty).toEqual([]);
    expect(batchRecordsSupport(recordsApi)).toBe('yes'); // 有一批成了；400 信封是这批的问题，不是能力问题
    const batchAttempts = records.mock.calls.filter((call) => (call[0] as GenModelV1RecordsRequest).generationRoots).length;
    expect(batchAttempts).toBe(4);
    expect(records.mock.calls.length - batchAttempts).toBe(6); // 失败的三批 × 2 根逐根重取
  });

  it('批量响应里 owner 不在批里的记录不丢', async () => {
    const roots = ['1/1', '1/2', '1/3', '1/4'];
    const records = recordsServing((root) => (v1(root) === '1/1' ? [item('1_91', root), item('1_77', '1_77')] : defaultItemsOf(root)));
    const result = await ensureAndCollectRecords(
      '1_0', { recordsConcurrency: 2 },
      api({ ensure: vi.fn(async () => ({ status: 'Generated', generation_roots: roots })) as never, records: records as never }),
    );
    expect(refnosOfRecords(result.items).sort()).toEqual(['1_77', '1_91', '1_92', '1_93', '1_94']);
  });
});

describe('planRecordsBatches', () => {
  it('批大小 = min(batchSize, ceil(根数 / 并发))：小根集摊成单根，上千根才顶到 64 一批', () => {
    const roots = (n: number) => Array.from({ length: n }, (_, i) => `1_${i + 1}`);
    expect(planRecordsBatches(roots(5), 64, 6).map((b) => b.length)).toEqual([1, 1, 1, 1, 1]);
    expect(planRecordsBatches(roots(17), 64, 6).map((b) => b.length)).toEqual([3, 3, 3, 3, 3, 2]);
    const b335 = planRecordsBatches(roots(335), 64, 6);
    expect(b335.length).toBe(6);
    expect(Math.max(...b335.map((b) => b.length))).toBe(56);
    const b1000 = planRecordsBatches(roots(1000), 64, 6);
    expect(b1000.length).toBe(16);
    expect(b1000.every((b) => b.length <= 64)).toBe(true);
    expect(b1000.flat()).toEqual(roots(1000));
    // batchSize=1 → 逐根；空输入 → 空
    expect(planRecordsBatches(roots(9), 1, 6).map((b) => b.length)).toEqual(Array(9).fill(1));
    expect(planRecordsBatches([], 64, 6)).toEqual([]);
  });

  it('同一 Ref0（同库）才同批；批内与批间都保持首次出现的顺序', () => {
    const roots = ['1_1', '2_1', '1_2', '1_3', '2_2', '3_1'];
    expect(planRecordsBatches(roots, 64, 1)).toEqual([['1_1', '1_2', '1_3'], ['2_1', '2_2'], ['3_1']]);
    expect(planRecordsBatches(roots, 2, 1)).toEqual([['1_1', '1_2'], ['1_3'], ['2_1', '2_2'], ['3_1']]);
  });
});

describe('mapWithConcurrency', () => {
  it('结果按输入顺序回；同时在飞的不超过 concurrency', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const delays = [30, 5, 20, 1, 10, 15, 2];
    const out = await mapWithConcurrency(delays, 3, async (ms, index) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, ms));
      inFlight--;
      return `${index}:${ms}`;
    });
    expect(out).toEqual(delays.map((ms, index) => `${index}:${ms}`));
    expect(maxInFlight).toBe(3);
  });

  it('空输入回空数组；concurrency 超过条数只开条数那么多路；一路抛错整体拒绝', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    let started = 0;
    await mapWithConcurrency([1, 2], 8, async (n) => { started++; return n; });
    expect(started).toBe(2);
    await expect(mapWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('x'); return n; })).rejects.toThrow('x');
  });
});
