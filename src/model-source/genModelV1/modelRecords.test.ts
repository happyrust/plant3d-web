import { describe, expect, it, vi } from 'vitest';

import { ensureAndCollectRecords, mapWithConcurrency, refnosOfRecords, type ModelRecordsApi } from './modelRecords';

import { GenModelV1ApiError, toV1Refno, type GeomInstQuery } from '@/api/genModelV1Api';

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

function api(overrides: Partial<ModelRecordsApi>): ModelRecordsApi {
  return {
    ensure: vi.fn(async ({ refno }) => ({ status: 'Generated', generation_root: v1(refno), generation_roots: [v1(refno)] })) as never,
    records: vi.fn(async ({ generationRoot }) => ({
      source: 'model-memory', items: [item(`${v1(generationRoot).split('/')[0]}_9${v1(generationRoot).split('/')[1]}`, generationRoot)], total: 1, truncated: false, next_cursor: null,
    })) as never,
    children: vi.fn(async (refno: string) => ({ source: 'direct', parent: v1(refno), nodes: [] })) as never,
    ...overrides,
  };
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

  it('一次 ensure 解出多根：records 并发不超过 recordsConcurrency，结果按根顺序拼回，pending / 错误各归各，onRootDone 每根一次', async () => {
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
      { recordsConcurrency: 2, onRootDone: ({ done, total }) => progress.push({ done, total }) },
      api({ ensure: ensure as never, records: records as never }),
    );

    expect(records).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(2);
    expect(result.generationRoots).toEqual(['1_1', '1_2', '1_3', '1_4', '1_5']);
    expect(refnosOfRecords(result.items)).toEqual(['1_91', '1_92', '1_95']);
    expect(result.pending).toEqual(['1_3']);
    expect(result.errors).toEqual({ '1_4': 'boom' });
    expect(progress.map((p) => p.done)).toEqual([1, 2, 3, 4, 5]);
    expect(progress.every((p) => p.total === 5)).toBe(true);
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
