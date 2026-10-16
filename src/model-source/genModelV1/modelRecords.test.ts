import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectRecordsByAncestor,
  collectRecordsForAncestors,
  generateThenCollect,
  isLegacyNotGenerated,
  mapWithConcurrency,
  MAX_MODEL_RECORD_PAGES,
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
