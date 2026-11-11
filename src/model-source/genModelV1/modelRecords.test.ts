import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectRecordsByAncestor,
  collectRecordsForAncestors,
  EMPTY_GROUP_HINT,
  emptyGroupHintFor,
  generateThenCollect,
  GROUP_EMPTY_HINT,
  GROUP_RULE_NO_MATCH_HINT,
  GROUP_RULE_UNEVALUABLE_HINT,
  isLegacyNotGenerated,
  mapWithConcurrency,
  MAX_MODEL_RECORD_PAGES,
  pushRecordPageListener,
  RECORDS_BATCH_RAMP,
  RECORDS_MEMBER_BATCH,
  RECORDS_MEMBER_BATCH_MIN_MEMBERS,
  recordsMemberBatchSize,
  refnosOfRecords,
  type ModelRecordsApi,
} from './modelRecords';

import { GenModelV1ApiError, toV1Refno, type GeomInstQuery, type ModelRecordsResponse } from '@/api/genModelV1Api';
import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';

const v1 = toV1Refno;

function item(refno: string, owner: string): GeomInstQuery {
  return {
    refno, old_refno: null, owner, world_aabb: null,
    world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    insts: [], has_neg: false, generic: 'ELBO', pts: null, date: null,
  };
}

function page(items: GeomInstQuery[], cursor = 0, limit = 5000): ModelRecordsResponse {
  const slice = items.slice(cursor, cursor + limit);
  const next = cursor + slice.length;
  return {
    source: 'model-database',
    items: slice,
    total: items.length,
    truncated: next < items.length,
    next_cursor: next < items.length ? next : null,
  };
}

function api(overrides: Partial<ModelRecordsApi> = {}): ModelRecordsApi & {
  generate: ReturnType<typeof vi.fn>;
  records: ReturnType<typeof vi.fn>;
  children: ReturnType<typeof vi.fn>;
} {
  return {
    generate: vi.fn(async ({ refno }: { refno: string }) => ({
      status: 'Generated',
      generation_root: v1(refno),
      generation_roots: [v1(refno)],
    })),
    records: vi.fn(async () => page([])),
    children: vi.fn(async (refno: string) => ({ source: 'direct', parent: v1(refno), nodes: [] })),
    ...overrides,
  } as never;
}

describe('collectRecordsByAncestor', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('display_never_generates：以节点为祖先查 records，不调用 generate', async () => {
    const records = vi.fn(async () => page([item('1_10', '1_1'), item('1_11', '1_1')]));
    const client = api({ records: records as never });
    const result = await collectRecordsByAncestor('1_2', {}, client);

    expect(client.generate).not.toHaveBeenCalled();
    expect(records).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledWith(
      { generationRoot: '1_2', limit: 5000, cursor: undefined },
      expect.anything(),
    );
    expect(result.items).toHaveLength(2);
    expect(result.generationRoots).toEqual(['1_1']);
    expect(result.empty).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(refnosOfRecords(result.items)).toEqual(['1_10', '1_11']);
  });

  it('an_empty_scope_is_a_hint_not_an_error：查空与 409 not_generated 都进 empty，不进 errors', async () => {
    const empty = await collectRecordsByAncestor('1_2', {}, api());
    expect(empty.empty).toEqual(['1_2']);
    expect(empty.errors).toEqual({});
    expect(empty.items).toEqual([]);

    const legacy = api({
      records: vi.fn(async () => {
        throw new GenModelV1ApiError({
          code: 'conflict',
          status: 409,
          path: '/api/v1/model/records',
          message: 'not_generated: generation root 1/2',
        });
      }) as never,
    });
    const missed = await collectRecordsByAncestor('1_2', {}, legacy);
    expect(isLegacyNotGenerated(new GenModelV1ApiError({
      code: 'conflict', status: 409, path: '/api/v1/model/records', message: 'not_generated: x',
    }))).toBe(true);
    expect(missed.empty).toEqual(['1_2']);
    expect(missed.errors).toEqual({});
    expect(legacy.generate).not.toHaveBeenCalled();
  });

  it('409 conflict（库正被占用）记 pending，其它错误记 errors，都不 generate', async () => {
    const busy = api({
      records: vi.fn(async () => {
        throw new GenModelV1ApiError({
          code: 'conflict', status: 409, path: '/api/v1/model/records', message: 'dbnum task running',
        });
      }) as never,
    });
    expect((await collectRecordsByAncestor('1_2', {}, busy)).pending).toEqual(['1_2']);

    const boom = api({
      records: vi.fn(async () => {
        throw new GenModelV1ApiError({
          code: 'internal', status: 500, path: '/api/v1/model/records', message: 'boom',
        });
      }) as never,
    });
    expect((await collectRecordsByAncestor('1_2', {}, boom)).errors['1_2']).toContain('boom');
    expect(busy.generate).not.toHaveBeenCalled();
    expect(boom.generate).not.toHaveBeenCalled();
  });

  it('分页读完；truncated 却没有 next_cursor 时失败', async () => {
    const rows = [item('1_10', '1_1'), item('1_11', '1_1'), item('1_12', '1_1')];
    const records = vi.fn(async ({ cursor, limit }: { cursor?: number; limit?: number }) => page(rows, cursor ?? 0, limit ?? 2));
    const result = await collectRecordsByAncestor('1_1', { pageSize: 2 }, api({ records: records as never }));
    expect(result.items).toHaveLength(3);
    expect(records).toHaveBeenCalledTimes(2);

    const broken = api({
      records: vi.fn(async () => ({ source: 'model-database', items: [item('1_10', '1_1')], total: 2, truncated: true, next_cursor: null })) as never,
    });
    const failed = await collectRecordsByAncestor('1_1', {}, broken);
    expect(failed.errors['1_1']).toContain('next_cursor');
    expect(MAX_MODEL_RECORD_PAGES).toBeGreaterThan(0);
  });

  it('多个祖先有界并发，各查一次', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return page([item(`${generationRoot}_9`, generationRoot)]);
    });
    const result = await collectRecordsForAncestors(['1_1', '1_2', '1_3', '1_1'], { concurrency: 2 }, api({ records: records as never }));
    expect(result.ancestors).toEqual(['1_1', '1_2', '1_3']);
    expect(records).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('onAncestorRecords：每收完一个祖先就交出它的记录，不等还没回来的祖先（边取边画）', async () => {
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => {
      if (generationRoot === '1_2') await slow;
      return page([item(`${generationRoot}_9`, generationRoot)]);
    });
    const heard: string[] = [];
    const pending = collectRecordsForAncestors(['1_1', '1_2', '1_3'], {
      concurrency: 3,
      onAncestorRecords: ({ ancestor, items, done, total }) => {
        heard.push(`${ancestor}:${items.map((record) => record.refno).join(',')}:${done}/${total}`);
      },
    }, api({ records: records as never }));

    await vi.waitFor(() => expect(heard).toHaveLength(2));
    // 1_2 还没回来，另外两个已经交出来了
    expect(heard).toEqual(['1_1:1_1_9:1/3', '1_3:1_3_9:2/3']);
    releaseSlow();
    const result = await pending;
    expect(heard[2]).toBe('1_2:1_2_9:3/3');
    // 最终结果照旧按传入顺序拼
    expect(result.items.map((record) => record.refno)).toEqual(['1_1_9', '1_2_9', '1_3_9']);
  });

  it('onAncestorRecords：查空、出错、409 的祖先不交；回调自己抛错不影响读取；选项不漏进请求参数', async () => {
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }, _options?: unknown) => {
      if (generationRoot === '1_2') return page([]);
      if (generationRoot === '1_3') throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '/x', message: 'busy' });
      if (generationRoot === '1_4') throw new GenModelV1ApiError({ code: 'internal', status: 500, path: '/x', message: 'boom' });
      return page([item(`${generationRoot}_9`, generationRoot)]);
    });
    const heard: string[] = [];
    const result = await collectRecordsForAncestors(['1_1', '1_2', '1_3', '1_4', '1_5'], {
      concurrency: 1,
      onAncestorRecords: ({ ancestor }) => {
        heard.push(ancestor);
        throw new Error('listener failed');
      },
    }, api({ records: records as never }));

    expect(heard).toEqual(['1_1', '1_5']);
    expect(result.items).toHaveLength(2);
    expect(result.empty).toEqual(['1_2']);
    expect(result.pending).toEqual(['1_3']);
    expect(Object.keys(result.errors)).toEqual(['1_4']);
    for (const call of records.mock.calls) {
      expect(call[1]).not.toHaveProperty('onAncestorRecords');
    }
  });
});

describe('collectRecordsForAncestors：几个祖先打包成一发（批量形，batchAncestors）', () => {
  type BatchReq = { generationRoot?: string; generationRoots?: string[]; limit?: number; cursor?: number };

  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  /** 祖先 `5_<n>` 有 `rowsOf(n)` 条记录；批量形照后端的做法回：按请求顺序平铺、`roots[]` 逐根条数、超过一页就截断。 */
  function backend(rowsOf: (n: number) => number) {
    const rowsFor = (ancestor: string): GeomInstQuery[] => {
      const n = Number(ancestor.split('_')[1]);
      return Array.from({ length: rowsOf(n) }, (_, i) => item(`${ancestor}${String(i).padStart(3, '0')}`, ancestor));
    };
    const records = vi.fn(async (req: BatchReq, _options?: unknown): Promise<ModelRecordsResponse> => {
      if (req.generationRoots) {
        const all = req.generationRoots.flatMap(rowsFor);
        return {
          ...page(all, req.cursor ?? 0, req.limit ?? 5000),
          generation_roots: req.generationRoots.map(v1),
          roots: req.generationRoots.map((root) => ({ generation_root: v1(root), total: rowsFor(root).length })),
        };
      }
      return page(rowsFor(req.generationRoot!), req.cursor ?? 0, req.limit ?? 5000);
    });
    return { records, rowsFor };
  }
  const shapeOf = (records: ReturnType<typeof vi.fn>) => records.mock.calls.map(([req]) => (req as BatchReq).generationRoots?.join('+') ?? `single:${(req as BatchReq).generationRoot}`);
  const names = (count: number) => Array.from({ length: count }, (_, i) => `5_${i + 1}`);

  it('不给 batchAncestors：一个祖先一发，一个批量形请求都不发', async () => {
    const { records } = backend(() => 2);
    await collectRecordsForAncestors(names(5), { concurrency: 2 }, api({ records: records as never }));
    expect(shapeOf(records).sort()).toEqual(names(5).map((name) => `single:${name}`));
  });

  it('头两发各带一个（单根形），之后 2、4，再带满；结果与一个一个查相同', async () => {
    const { records, rowsFor } = backend((n) => (n % 3 === 0 ? 0 : n));
    const heard: string[] = [];
    const progress: string[] = [];
    const result = await collectRecordsForAncestors(names(12), {
      concurrency: 1,
      batchAncestors: 4,
      onAncestorRecords: ({ ancestor, items, done, total }) => heard.push(`${ancestor}:${items.length}:${done}/${total}`),
      onRootDone: ({ done, total, root }) => progress.push(`${root}:${done}/${total}`),
    }, api({ records: records as never }));

    expect(shapeOf(records)).toEqual(['single:5_1', 'single:5_2', '5_3+5_4', '5_5+5_6+5_7+5_8', '5_9+5_10+5_11+5_12']);
    for (const [req] of records.mock.calls) expect((req as BatchReq).limit).toBe(5000);
    const plain = await collectRecordsForAncestors(names(12), { concurrency: 1 }, api({ records: backend((n) => (n % 3 === 0 ? 0 : n)).records as never }));
    expect(result).toEqual(plain);
    expect(result.items.map((record) => record.refno)).toEqual(names(12).flatMap((name) => rowsFor(name).map((record) => record.refno)));
    expect(result.empty).toEqual(['5_3', '5_6', '5_9', '5_12']);
    // 一个祖先交一次、报一次进度；查空的不交
    expect(heard).toEqual(names(12).filter((_, i) => (i + 1) % 3 !== 0).map((name) => `${name}:${rowsFor(name).length}:${Number(name.split('_')[1])}/12`));
    expect(progress).toEqual(names(12).map((name, i) => `${name}:${i + 1}/12`));
  });

  it('并发时各路各取下一组，同时在飞的不超过 concurrency；选项不漏进请求参数', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { records: plainRecords } = backend(() => 1);
    const records = vi.fn(async (req: BatchReq, options?: unknown) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 3));
      inFlight -= 1;
      return plainRecords(req, options);
    });
    const result = await collectRecordsForAncestors(names(40), { concurrency: 3, batchAncestors: 8 }, api({ records: records as never }));
    expect(result.items).toHaveLength(40);
    expect(maxInFlight).toBe(3);
    // 头几发 1、1、2、4，带满 8、8；剩 16 个起一组不超过「剩下的平摊到 3 路」：6、4、2、2、1、1
    expect(records.mock.calls.map(([req]) => (req as BatchReq).generationRoots?.length ?? 1)).toEqual([1, 1, 2, 4, 8, 8, 6, 4, 2, 2, 1, 1]);
    for (const call of records.mock.calls) expect(call[1]).not.toHaveProperty('batchAncestors');
  });

  it('祖先不多时一组不超过剩下的平摊到每一路：19 个、6 路，最大的一组 3 个，各路都有活干', async () => {
    const { records } = backend(() => 1);
    const result = await collectRecordsForAncestors(names(19), { concurrency: 6, batchAncestors: 16 }, api({ records: records as never }));
    expect(result.items).toHaveLength(19);
    expect(records.mock.calls.map(([req]) => (req as BatchReq).generationRoots?.length ?? 1)).toEqual([1, 1, 2, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1]);
  });

  it('祖先比路数还少：全是一个一发（和不打包一样）', async () => {
    const { records } = backend(() => 1);
    await collectRecordsForAncestors(names(4), { concurrency: 6, batchAncestors: 16 }, api({ records: records as never }));
    expect(shapeOf(records)).toEqual(names(4).map((name) => `single:${name}`));
  });

  it('一页装不下：装完的照收，没装完的按条数重新分组再发（不拿游标翻批量形）；单独就超过一页的走单根形分页', async () => {
    // 页大小 10。5_3..5_6 是 4 + 9 + 25 + 3 条：第一页只装下 5_3（5_4 只来了一部分，不要）
    const rows: Record<number, number> = { 1: 1, 2: 1, 3: 4, 4: 9, 5: 25, 6: 3 };
    const { records, rowsFor } = backend((n) => rows[n] ?? 0);
    const heard: string[] = [];
    const result = await collectRecordsForAncestors(names(6), {
      concurrency: 1,
      pageSize: 10,
      batchAncestors: 4,
      onAncestorRecords: ({ ancestor, items }) => heard.push(`${ancestor}:${items.length}`),
    }, api({ records: records as never }));

    expect(shapeOf(records)).toEqual([
      'single:5_1', 'single:5_2',
      '5_3+5_4',            // 4 + 9 > 10：截断，5_3 齐了
      'single:5_4',         // 9 条，自己一组
      '5_5+5_6',            // 25 + 3：截断，一个都没装完
      'single:5_5', 'single:5_5', 'single:5_5', // 25 条按游标翻三页
      'single:5_6',
    ]);
    // 批量形从不带游标
    for (const [req] of records.mock.calls) if ((req as BatchReq).generationRoots) expect((req as BatchReq).cursor).toBeUndefined();
    expect(heard).toEqual(['5_1:1', '5_2:1', '5_3:4', '5_4:9', '5_5:25', '5_6:3']);
    expect(result.items.map((record) => record.refno)).toEqual(names(6).flatMap((name) => rowsFor(name).map((record) => record.refno)));
    expect(result.errors).toEqual({});
  });

  it('一页装不下、没装完的几个加起来不超过一页：合成一组再发一次', async () => {
    const rows: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 8, 6: 3, 7: 3, 8: 3 };
    const { records, rowsFor } = backend((n) => rows[n] ?? 0);
    const result = await collectRecordsForAncestors(names(8), { concurrency: 1, pageSize: 10, batchAncestors: 4 }, api({ records: records as never }));
    // 5_5..5_8 = 8 + 3 + 3 + 3 = 17 条：第一页装完 5_5，5_6 只来了 2 条 → 5_6+5_7+5_8（9 条）再发一次，正好一页
    expect(shapeOf(records)).toEqual(['single:5_1', 'single:5_2', '5_3+5_4', '5_5+5_6+5_7+5_8', '5_6+5_7+5_8']);
    expect(result.items.map((record) => record.refno)).toEqual(names(8).flatMap((name) => rowsFor(name).map((record) => record.refno)));
  });

  it('批量形每回来一页，分页监听者听到的是这一页里收下的记录（下一发回来之前先拉网格用）', async () => {
    const rows: Record<number, number> = { 1: 1, 2: 1, 3: 4, 4: 9 };
    const { records } = backend((n) => rows[n] ?? 0);
    const heardPages: number[] = [];
    const release = pushRecordPageListener((items) => heardPages.push(items.length));
    try {
      await collectRecordsForAncestors(names(4), { concurrency: 1, pageSize: 10, batchAncestors: 4 }, api({ records: records as never }));
    } finally {
      release();
    }
    // 5_1、5_2 各一页；5_3+5_4 那一页来了 10 条、只收下 5_3 的 4 条；5_4 自己再来 9 条
    expect(heardPages).toEqual([1, 1, 4, 9]);
  });
  it('批量请求没成（旧后端 422）：这一组一个一个重问，余下的也不再打包', async () => {
    const { records: plainRecords } = backend(() => 2);
    const failures: unknown[] = [];
    const records = vi.fn(async (req: BatchReq, options?: unknown) => {
      if (req.generationRoots) throw new GenModelV1ApiError({ code: 'http', status: 422, path: '/api/v1/model/records', message: 'unknown field' });
      return plainRecords(req, options);
    });
    const result = await collectRecordsForAncestors(names(9), {
      concurrency: 1,
      batchAncestors: 4,
      onRequestFailure: (error) => failures.push(error),
    }, api({ records: records as never }));

    expect(shapeOf(records)).toEqual([
      'single:5_1', 'single:5_2', '5_3+5_4', 'single:5_3', 'single:5_4',
      'single:5_5', 'single:5_6', 'single:5_7', 'single:5_8', 'single:5_9',
    ]);
    expect(result.items).toHaveLength(18);
    expect(result.errors).toEqual({});
    expect(failures).toHaveLength(1);
  });

  it('整批回 409：逐个重问之后各自记 pending，不记 errors', async () => {
    const records = vi.fn(async (_req: BatchReq) => {
      throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '/api/v1/model/records', message: 'busy' });
    });
    const result = await collectRecordsForAncestors(names(4), { concurrency: 1, batchAncestors: 4 }, api({ records: records as never }));
    expect(result.pending).toEqual(names(4));
    expect(result.errors).toEqual({});
    expect(shapeOf(records)).toEqual(['single:5_1', 'single:5_2', '5_3+5_4', 'single:5_3', 'single:5_4']);
  });

  it('响应对不上（没有 roots、根名不符、条数和记录数矛盾）：不猜，逐个重问', async () => {
    const broken: ((resp: ModelRecordsResponse) => ModelRecordsResponse)[] = [
      (resp) => ({ ...resp, roots: undefined }),
      (resp) => ({ ...resp, roots: resp.roots!.map((root, i) => (i === 0 ? { ...root, generation_root: '9/9' } : root)) }),
      (resp) => ({ ...resp, roots: resp.roots!.map((root, i) => (i === 0 ? { ...root, total: root.total + 1 } : root)) }),
      (resp) => ({ ...resp, roots: resp.roots!.slice(1) }),
      (resp) => ({ ...resp, truncated: true, next_cursor: 1 }),
    ];
    for (const breakIt of broken) {
      const { records: plainRecords, rowsFor } = backend(() => 2);
      const records = vi.fn(async (req: BatchReq, options?: unknown) => {
        const resp = await plainRecords(req, options);
        return req.generationRoots ? breakIt(resp) : resp;
      });
      const result = await collectRecordsForAncestors(names(4), { concurrency: 1, batchAncestors: 4 }, api({ records: records as never }));
      expect(shapeOf(records)).toEqual(['single:5_1', 'single:5_2', '5_3+5_4', 'single:5_3', 'single:5_4']);
      expect(result.items.map((record) => record.refno)).toEqual(names(4).flatMap((name) => rowsFor(name).map((record) => record.refno)));
    }
  });

  it('途中取消：整次读取向上抛 cancelled，不退回逐个重问，也不再发下一组', async () => {
    const controller = new AbortController();
    const records = vi.fn(async (req: BatchReq, options?: { signal?: AbortSignal }) => {
      if (req.generationRoots) {
        controller.abort();
        throw new GenModelV1ApiError({ code: 'cancelled', status: 0, path: '/api/v1/model/records', message: 'aborted' });
      }
      void options;
      return page([item(`${req.generationRoot}9`, req.generationRoot!)]);
    });
    const heard: string[] = [];
    await expect(collectRecordsForAncestors(names(12), {
      concurrency: 1,
      batchAncestors: 4,
      signal: controller.signal,
      onAncestorRecords: ({ ancestor }) => heard.push(ancestor),
    }, api({ records: records as never }))).rejects.toMatchObject({ code: 'cancelled' });
    expect(shapeOf(records)).toEqual(['single:5_1', 'single:5_2', '5_3+5_4']);
    expect(heard).toEqual(['5_1', '5_2']);
  });

  it('只有一个祖先、或 batchAncestors 给 1 / 0 / 乱值：不走批量形', async () => {
    for (const [ancestors, batchAncestors] of [[names(1), 16], [names(4), 1], [names(4), 0], [names(4), Number.NaN]] as const) {
      const { records } = backend(() => 1);
      await collectRecordsForAncestors([...ancestors], { concurrency: 1, batchAncestors }, api({ records: records as never }));
      expect(shapeOf(records).every((shape) => shape.startsWith('single:'))).toBe(true);
    }
  });

  it('一发最多带 64 个（服务端上限），给得再大也不超', async () => {
    const { records } = backend(() => 0);
    await collectRecordsForAncestors(names(200), { concurrency: 1, batchAncestors: 500 }, api({ records: records as never }));
    expect(Math.max(...records.mock.calls.map(([req]) => (req as BatchReq).generationRoots?.length ?? 1))).toBe(64);
  });
});

describe('recordsMemberBatchSize', () => {
  it('后端没声明批量形（旧后端、health 还没回来）：1', () => {
    expect(recordsMemberBatchSize(null)).toBe(1);
    expect(recordsMemberBatchSize(undefined)).toBe(1);
    expect(recordsMemberBatchSize({})).toBe(1);
    expect(recordsMemberBatchSize({ model_records_batch_max_roots: 1 })).toBe(1);
    expect(recordsMemberBatchSize({ model_records_batch_max_roots: '64' })).toBe(1);
  });

  it('声明了：缺省一发带 RECORDS_MEMBER_BATCH 个，不超过后端的上限', () => {
    expect(recordsMemberBatchSize({ model_records_batch_max_roots: 64 })).toBe(RECORDS_MEMBER_BATCH);
    expect(recordsMemberBatchSize({ model_records_batch_max_roots: 8 })).toBe(8);
    expect(recordsMemberBatchSize({ model_records_batch_max_roots: 1000 })).toBe(RECORDS_MEMBER_BATCH);
  });

  it('成员不多（不超过 RECORDS_MEMBER_BATCH_MIN_MEMBERS 个）不打包；多了才打包', () => {
    const caps = { model_records_batch_max_roots: 64 };
    expect(recordsMemberBatchSize(caps, null, 19)).toBe(1);
    expect(recordsMemberBatchSize(caps, null, RECORDS_MEMBER_BATCH_MIN_MEMBERS)).toBe(1);
    expect(recordsMemberBatchSize(caps, null, RECORDS_MEMBER_BATCH_MIN_MEMBERS + 1)).toBe(RECORDS_MEMBER_BATCH);
    expect(recordsMemberBatchSize(caps, null, 531)).toBe(RECORDS_MEMBER_BATCH);
    expect(recordsMemberBatchSize(caps, null, Number.NaN)).toBe(1);
    // 地址上明说了个数就照办，不再看成员数；明说关掉就关掉
    expect(recordsMemberBatchSize(caps, '8', 19)).toBe(8);
    expect(recordsMemberBatchSize(caps, '0', 531)).toBe(1);
  });

  it('页面地址上的 gm_records_batch：0 / 1 关掉，别的正整数改个数（不超过上限），乱值不理', () => {
    const caps = { model_records_batch_max_roots: 64 };
    expect(recordsMemberBatchSize(caps, '0')).toBe(1);
    expect(recordsMemberBatchSize(caps, '1')).toBe(1);
    expect(recordsMemberBatchSize(caps, '32')).toBe(32);
    expect(recordsMemberBatchSize(caps, '500')).toBe(64);
    expect(recordsMemberBatchSize(caps, 'abc')).toBe(RECORDS_MEMBER_BATCH);
    expect(recordsMemberBatchSize(caps, '-3')).toBe(RECORDS_MEMBER_BATCH);
    expect(recordsMemberBatchSize(caps, '')).toBe(RECORDS_MEMBER_BATCH);
    expect(recordsMemberBatchSize(caps, null)).toBe(RECORDS_MEMBER_BATCH);
    // 后端没声明时，地址上写什么都不打包
    expect(recordsMemberBatchSize({}, '32')).toBe(1);
  });

  it('头几发带的个数是 1、1、2、4、8', () => {
    expect([...RECORDS_BATCH_RAMP]).toEqual([1, 1, 2, 4, 8]);
  });
});

describe('generateThenCollect', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('regenerate_generates_once_then_displays_the_targets：恰好一发 force generate，成功后再按祖先查', async () => {
    const records = vi.fn(async () => page([item('1_10', '1_1')]));
    const client = api({ records: records as never });
    const result = await generateThenCollect('1_1', {}, client);

    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(client.generate).toHaveBeenCalledWith({ refno: '1_1', force: true }, expect.anything());
    expect(records).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.generationRoots).toContain('1_1');
  });

  it('a_timed_out_generate_does_not_display：pending / timeout 不查 records', async () => {
    const client = api({
      generate: vi.fn(async () => {
        throw new GenModelV1ApiError({
          code: 'generation_pending', status: 202, path: '/api/v1/model/generate', message: 'still running',
        });
      }) as never,
    });
    const result = await generateThenCollect('1_1', {}, client);
    expect(result.pending).toEqual(['1_1']);
    expect(result.items).toEqual([]);
    expect(client.records).not.toHaveBeenCalled();
  });

  it('逐根记错：200 回执里点名的失败根带进 failedRoots（a_b、可不可重试），其余根的产物照样查回来', async () => {
    const records = vi.fn(async () => page([item('24381_550', '24381_549')]));
    const client = api({
      records: records as never,
      generate: vi.fn(async () => ({
        status: 'Generated',
        generation_root: '24381/536',
        generation_roots: ['24381/537', '24381/549'],
        failed_root_count: 2,
        failed_roots: [
          { generation_root: '24381/537', error: 'generation_failed: 截面数据损坏', retryable: false },
          { generation_root: '24381/553', error: '根锁被占', retryable: true },
        ],
      })) as never,
    });
    const result = await generateThenCollect('24381_536', { force: false }, client);
    expect(client.generate).toHaveBeenCalledWith({ refno: '24381_536' }, expect.anything());
    expect(result.failedRoots).toEqual([
      { root: '24381_537', error: 'generation_failed: 截面数据损坏', retryable: false },
      { root: '24381_553', error: '根锁被占', retryable: true },
    ]);
    expect(result.items).toHaveLength(1);
    expect(records).toHaveBeenCalledTimes(1);
  });

  it('回执里没有失败根：failedRoots 不出现（老调用方看到的形状不变）', async () => {
    const result = await generateThenCollect('1_1', { force: false }, api({ records: vi.fn(async () => page([item('1_10', '1_1')])) as never }));
    expect(result).not.toHaveProperty('failedRoots');
  });

  it('容器 422 时只在右键里展开一层，逐个 generate', async () => {
    const generate = vi.fn(async ({ refno }: { refno: string }) => {
      if (toV1Refno(refno) === '1/2') {
        throw new GenModelV1ApiError({ code: 'container', status: 422, path: '/api/v1/model/generate', message: 'SITE' });
      }
      return { status: 'Generated', generation_root: v1(refno), generation_roots: [v1(refno)] };
    });
    const children = vi.fn(async () => ({
      source: 'direct',
      parent: '1/2',
      nodes: [
        { refno: '1_1', noun: 'BRAN', name: '/B1', owner: '1_2', order: 0, children_count: 0 },
        { refno: '1_3', noun: 'BRAN', name: '/B3', owner: '1_2', order: 1, children_count: 0 },
      ],
    }));
    const records = vi.fn(async () => page([item('1_10', '1_1'), item('1_30', '1_3')]));
    const result = await generateThenCollect('1_2', {}, api({ generate: generate as never, children: children as never, records: records as never }));
    expect(generate).toHaveBeenCalledTimes(3);
    expect(children).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledTimes(1);
    expect(result.generationRoots).toEqual(expect.arrayContaining(['1_1', '1_3']));
  });

  it('超过 maxRoots 的节点记 truncatedRoots，不再 generate', async () => {
    const generate = vi.fn(async ({ refno }: { refno: string }) => {
      throw new GenModelV1ApiError({ code: 'container', status: 422, path: '/api/v1/model/generate', message: 'SITE' });
    });
    const children = vi.fn(async (refno: string) => ({
      source: 'direct',
      parent: v1(refno),
      nodes: ['1_1', '1_3', '1_4'].map((id) => ({ refno: id, noun: 'BRAN', name: id, owner: '1_2', order: 0, children_count: 0 })),
    }));
    const result = await generateThenCollect('1_2', { maxRoots: 2 }, api({ generate: generate as never, children: children as never }));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.truncatedRoots.length).toBeGreaterThan(0);
    expect(result.items).toEqual([]);
  });

  it('分组 force 回 422 group_scope：不带 force 按成员生成一次，再按分组查记录；生成根是成员的，不含分组自己', async () => {
    const generate = vi.fn(async (params: { refno: string; force?: boolean }) => {
      if (params.force) {
        throw new GenModelV1ApiError({ code: 'group_scope', status: 422, path: '/api/v1/model/generate', message: 'GPSET' });
      }
      return { status: 'Generated', generation_root: v1(params.refno), generation_roots: ['1/10', '2/20'], scope_kind: 'group' };
    });
    const records = vi.fn(async () => page([item('1_11', '1_10'), item('2_21', '2_20')]));
    const result = await generateThenCollect('9_1', {}, api({ generate: generate as never, records: records as never }));
    expect(generate.mock.calls.map(([params]) => params)).toEqual([{ refno: '9_1', force: true }, { refno: '9_1' }]);
    expect(records).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledWith(expect.objectContaining({ generationRoot: '9_1' }), expect.anything());
    expect(result.generationRoots).toEqual(['1_10', '2_20']);
    expect(result.items).toHaveLength(2);
    expect(result.errors).toEqual({});
  });

  it('空分组（generation_roots: []）记 empty 并给提示：不回退为分组自己、不查记录', async () => {
    const generate = vi.fn(async ({ refno }: { refno: string }) => ({
      status: 'NoRenderableGeometry', model_available: false, generation_root: v1(refno), generation_roots: [], scope_kind: 'group', unresolved_count: 2,
    }));
    const client = api({ generate: generate as never });
    const result = await generateThenCollect('9_1', { force: false }, client);
    expect(generate).toHaveBeenCalledWith({ refno: '9_1' }, expect.anything());
    expect(result.empty).toEqual(['9_1']);
    expect(result.generationRoots).toEqual([]);
    // 回执没有 `unresolved` 键（开关关 / 旧后端）→ 逐字回落原文案
    expect(result.hints).toEqual({ '9_1': EMPTY_GROUP_HINT });
    expect(client.records).not.toHaveBeenCalled();
  });

  /** 空分组回执只换 `unresolved`，其余字段与真后端一致（见 gen-model 的 model-generate-gpset-empty.json）。 */
  const emptyGroupReceipt = (unresolved?: { via: string; target: string | null; reason: string }[]) => vi.fn(async ({ refno }: { refno: string }) => ({
    status: 'NoRenderableGeometry',
    model_available: false,
    generation_root: v1(refno),
    generation_roots: [],
    scope_kind: 'group',
    unresolved_count: unresolved?.length ?? 1,
    ...(unresolved ? { unresolved } : {}),
  }));

  it('group_empty 回执：提示「分组为空」，且不含「规则」字样', async () => {
    const client = api({ generate: emptyGroupReceipt([{ via: '2013286764_3', target: null, reason: 'group_empty' }]) as never });
    const result = await generateThenCollect('2013286764_3', { force: false }, client);
    expect(result.hints?.['2013286764_3']).toBe(GROUP_EMPTY_HINT);
    expect(result.hints?.['2013286764_3']).toContain('分组为空');
    expect(result.hints?.['2013286764_3']).not.toContain('规则');
  });

  it('scosel_no_match 回执：提示「规则没有命中任何构件」', async () => {
    const client = api({ generate: emptyGroupReceipt([{ via: '2013286748_7', target: null, reason: 'scosel_no_match' }]) as never });
    const result = await generateThenCollect('2013286748_7', { force: false }, client);
    expect(result.hints?.['2013286748_7']).toBe(GROUP_RULE_NO_MATCH_HINT);
    expect(result.hints?.['2013286748_7']).toContain('规则没有命中');
  });

  it.each(['scosel_unsupported', 'scosel_eval_failed'])('%s 回执：提示规则无法求值（成员不可解析）', async (reason) => {
    const client = api({ generate: emptyGroupReceipt([{ via: '2013286748_7', target: null, reason }]) as never });
    const result = await generateThenCollect('2013286748_7', { force: false }, client);
    expect(result.hints?.['2013286748_7']).toBe(GROUP_RULE_UNEVALUABLE_HINT);
    expect(result.hints?.['2013286748_7']).toMatch(/不可解析|无法求值/);
  });
});

describe('emptyGroupHintFor（空态文案按后端原因码分流）', () => {
  it('group_empty → 「分组为空」，不含「规则」', () => {
    expect(emptyGroupHintFor([{ via: '1_1', target: null, reason: 'group_empty' }])).toBe(GROUP_EMPTY_HINT);
    expect(emptyGroupHintFor([{ via: '1_1', target: null, reason: 'group_empty' }])).not.toContain('规则');
  });

  it('scosel_no_match → 「规则没有命中任何构件」', () => {
    expect(emptyGroupHintFor([{ via: '1_1', target: null, reason: 'scosel_no_match' }])).toBe(GROUP_RULE_NO_MATCH_HINT);
  });

  it('scosel_unsupported / scosel_eval_failed → 「规则无法求值（成员不可解析）」', () => {
    expect(emptyGroupHintFor([{ via: '1_1', target: null, reason: 'scosel_unsupported' }])).toBe(GROUP_RULE_UNEVALUABLE_HINT);
    expect(emptyGroupHintFor([{ via: '1_1', target: null, reason: 'scosel_eval_failed' }])).toBe(GROUP_RULE_UNEVALUABLE_HINT);
  });

  it('键缺失 / 空表 / 只有 GPREF 族码 → 逐字回落 EMPTY_GROUP_HINT', () => {
    expect(emptyGroupHintFor(undefined)).toBe(EMPTY_GROUP_HINT);
    expect(emptyGroupHintFor(null)).toBe(EMPTY_GROUP_HINT);
    expect(emptyGroupHintFor([])).toBe(EMPTY_GROUP_HINT);
    expect(emptyGroupHintFor([
      { via: '1_1', target: null, reason: 'gpref_missing' },
      { via: '1_2', target: '9_1', reason: 'db_not_in_mdb' },
      { via: '1_3', target: '1_99', reason: 'target_missing' },
    ])).toBe(EMPTY_GROUP_HINT);
    expect(EMPTY_GROUP_HINT).toBe('分组为空或成员不可解析');
  });

  it('多种原因码并存时按「越具体越先」定序，不串味', () => {
    expect(emptyGroupHintFor([
      { via: '1_1', target: null, reason: 'gpref_missing' },
      { via: '1_1', target: null, reason: 'group_empty' },
    ])).toBe(GROUP_EMPTY_HINT);
    expect(emptyGroupHintFor([
      { via: '1_1', target: null, reason: 'scosel_eval_failed' },
      { via: '1_1', target: null, reason: 'scosel_no_match' },
    ])).toBe(GROUP_RULE_NO_MATCH_HINT);
  });
});

describe('mapWithConcurrency', () => {
  it('保持输入顺序', async () => {
    const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30]);
  });
});

describe('display_never_generates 源码钉', () => {
  it('树的 visibleInsts、记录源的显示函数、整库显示、装载器都不出现 generate / forceRegenerate', () => {
    const dir = resolve(__dirname);
    const tree = readFileSync(resolve(dir, 'treeSource.ts'), 'utf8');
    const visible = tree.slice(tree.indexOf('async function visibleInsts'), tree.indexOf('function invalidate'));
    expect(visible).not.toMatch(/\.generate\(|ensureAndCollect|model\/ensure/);

    const records = readFileSync(resolve(dir, 'modelRecordSource.ts'), 'utf8');
    const query = records.slice(records.indexOf('async function collectByAncestor'), records.indexOf('async function generateThenCollect'));
    const entries = records.slice(records.indexOf('async function instanceEntriesByRefnos'), records.indexOf('function peek'));
    expect(query).not.toMatch(/generate\(/);
    expect(entries).not.toMatch(/generate\(/);

    const dbnum = readFileSync(resolve(dir, 'collectDbnum.ts'), 'utf8');
    const dbnumBody = dbnum.slice(dbnum.indexOf('export async function collectDbnumRefnos'));
    expect(dbnumBody).not.toMatch(/model\/ensure|genModelV1DbnumModelEnsure|\.generate\(/);

    const loader = readFileSync(resolve(dir, '../../composables/useDbnoInstancesDtxLoader.ts'), 'utf8');
    expect(loader).not.toMatch(/forceRegenerate/);

    const ports = readFileSync(resolve(dir, '../ports.ts'), 'utf8');
    expect(ports).not.toMatch(/forceRegenerate/);
  });
});
