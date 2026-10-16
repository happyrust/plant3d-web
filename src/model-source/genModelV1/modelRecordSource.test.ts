import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGenModelV1ModelRecordSource } from './modelRecordSource';

import type { ModelRecordsApi } from './modelRecords';

import { GenModelV1ApiError, type GenModelV1RequestOptions, type GeomInstQuery } from '@/api/genModelV1Api';
import {
  __resetGenModelV1ServiceLifecycleForTests,
  GenModelV1ServiceGenerationChangedError,
  observeGenModelV1Health,
} from '@/model-source/genModelV1/serviceLifecycle';

const IDENTITY = { translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };

function item(refno: string, owner: string, geoHash = 'g'): GeomInstQuery {
  return {
    refno, old_refno: null, owner, world_aabb: null, world_trans: IDENTITY,
    insts: [{ geo_hash: geoHash, transform: IDENTITY, is_tubi: false, is_invalid_tubi: false }],
    has_neg: false, generic: 'ELBO', pts: null, date: null,
  };
}

function page(items: GeomInstQuery[]) {
  return { source: 'model-database', items, total: items.length, truncated: false, next_cursor: null };
}

/** 一根 BRAN 24381/145018，下面三个构件。显示只查 records。 */
function branApi(): ModelRecordsApi & { generate: ReturnType<typeof vi.fn>; records: ReturnType<typeof vi.fn> } {
  const generate = vi.fn(async ({ refno }: { refno: string; force?: boolean }) => ({
    status: 'Generated', generation_root: '24381/145018', generation_roots: ['24381/145018'], refno,
  }));
  const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => {
    if (generationRoot === '24381_1' || generationRoot === '24381/1') {
      throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '/api/v1/model/records', message: 'not_generated: 24381/1' });
    }
    return page([
      item('24381_145019', '24381_145018'),
      item('24381_145021', '24381_145018'),
      item('24381_145021', '24381_145018', 'h'),
      item('24381_145023', '24381_145018'),
    ]);
  });
  return { generate: generate as never, records: records as never, children: vi.fn() as never };
}

describe('createGenModelV1ModelRecordSource', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('display_never_generates：同根多个构件只查一次 records，generate 一次都不打', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381/145021', '24381_145023']);

    expect(client.generate).not.toHaveBeenCalled();
    expect(client.records).toHaveBeenCalledTimes(1);
    expect([...out.keys()]).toEqual(['24381_145019', '24381_145021', '24381_145023']);
    expect(out.get('24381_145021')).toHaveLength(2);
    expect(source.peek('24381_145023')).toHaveLength(1);

    await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145023']);
    expect(client.records).toHaveBeenCalledTimes(1);
  });

  it('记录里没有的构件记空数组；not_generated 当查空，之后不再查，也不 generate', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145099', '24381_1']);
    expect(out.get('24381_145099')).toEqual([]);
    expect(out.get('24381_1')).toEqual([]);
    expect(client.generate).not.toHaveBeenCalled();
    const callsAfterFirst = client.records.mock.calls.length;
    await source.instanceEntriesByRefnos(7997, ['24381_145099', '24381_1', '24381_145019']);
    expect(client.records.mock.calls.length).toBe(callsAfterFirst);
  });

  it('forceRefresh 清掉再查，仍然不 generate', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145021'], { forceRefresh: true });
    expect(client.records).toHaveBeenCalledTimes(2);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('collectByAncestor 的干净结果备忘：同一节点再问不打请求；invalidate 之后重新问', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    const first = await source.collectByAncestor('24381_145018');
    const second = await source.collectByAncestor('24381/145018');
    expect(second).toBe(first);
    expect(client.records).toHaveBeenCalledTimes(1);
    source.invalidate();
    await source.collectByAncestor('24381_145018');
    expect(client.records).toHaveBeenCalledTimes(2);
  });

  it('409 conflict 不备忘：下次显示还要再问', async () => {
    const records = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'conflict', status: 409, path: '/api/v1/model/records', message: 'busy' });
    });
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
    });
    const collected = await source.collectByAncestor('24381_101410');
    expect(collected.pending).toEqual(['24381_101410']);
    await source.collectByAncestor('24381_101410');
    expect(records).toHaveBeenCalledTimes(2);
  });

  it('regenerate_generates_once_then_displays_the_targets：先清缓存，一发 force generate，再查进缓存', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    await source.collectByAncestor('24381_145018');
    expect(source.peek('24381_145019')).toHaveLength(1);

    const generated = await source.generateThenCollect('24381_145018');
    expect(client.generate).toHaveBeenCalledTimes(1);
    expect(client.generate).toHaveBeenCalledWith({ refno: '24381_145018', force: true }, expect.anything());
    expect(generated.items.length).toBeGreaterThan(0);
    expect(source.peek('24381_145019')).toHaveLength(1);
  });

  it('a_timed_out_generate_does_not_display：pending 不查 records，调用方拿到空 items', async () => {
    const generate = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'timeout', status: 504, path: '/api/v1/model/generate', message: 'budget' });
    });
    const records = vi.fn();
    const source = createGenModelV1ModelRecordSource({
      api: { generate: generate as never, records: records as never, children: vi.fn() as never },
    });
    const result = await source.generateThenCollect('1_1');
    expect(result.pending).toEqual(['1_1']);
    expect(result.items).toEqual([]);
    expect(records).not.toHaveBeenCalled();
  });

  it('subscribeProgress：查询的逐根进度能听到，退订后不再收', async () => {
    const heard: number[] = [];
    const own: number[] = [];
    const source = createGenModelV1ModelRecordSource({ api: branApi() });
    const unsubscribe = source.subscribeProgress((event) => heard.push(event.done));
    await source.collectByAncestor('24381_145018', { onRootDone: ({ done }) => own.push(done) });
    unsubscribe();
    await source.collectByAncestor('24381_145019');
    expect(own).toEqual([1]);
    expect(heard).toEqual([1]);
  });

  it('服务代次变化后才完成的旧 records 不能写回缓存', async () => {
    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    const records = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(page([item('1_99', '1_1', 'fresh')]));
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
    });

    const pending = source.collectByAncestor('1_1');
    await vi.waitFor(() => expect(records).toHaveBeenCalledTimes(1));
    observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm');
    resolveOld(page([item('1_98', '1_1', 'stale')]));
    await expect(pending).rejects.toThrow(/服务实例已变化/);
    expect(source.peek('1_98')).toBeUndefined();

    await source.collectByAncestor('1_1');
    expect(source.peek('1_99')).toHaveLength(1);
  });

  it('已 abort 的 signal 不能命中备忘：抛 cancelled，不再打请求', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    await source.collectByAncestor('24381_145019');
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(source.collectByAncestor('24381_145019', { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'cancelled', abortSource: 'caller' });
    expect(client.records).toHaveBeenCalledTimes(1);
    expect(client.generate).not.toHaveBeenCalled();
  });

  it('途中 abort 以 cancelled 收口；换代是独立错误类型', async () => {
    const controller = new AbortController();
    const records = vi.fn((_req: unknown, options?: GenModelV1RequestOptions) => new Promise<never>((_, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      queueMicrotask(() => controller.abort(new Error('stop')));
    }));
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
    });
    await expect(source.collectByAncestor('1_0', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'GenModelV1ApiError', code: 'cancelled', abortSource: 'caller' });
    expect(source.peek('1_0')).toBeUndefined();

    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
    records.mockImplementationOnce((_req, options?: GenModelV1RequestOptions) => new Promise<never>((_, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      queueMicrotask(() => observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm'));
    }));
    await expect(source.collectByAncestor('1_0')).rejects.toBeInstanceOf(GenModelV1ServiceGenerationChangedError);
  });

  it('network 折进 errors 并上报；取消不进失败账', async () => {
    const network = new GenModelV1ApiError({ code: 'network', status: 0, path: '/api/v1/model/records', message: 'ECONNRESET' });
    const records = vi.fn().mockRejectedValueOnce(network);
    const noteRequestFailure = vi.fn();
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
      noteRequestFailure,
    });
    const collected = await source.collectByAncestor('1_2');
    expect(collected.errors['1_2']).toContain('ECONNRESET');
    expect(noteRequestFailure).toHaveBeenCalledWith(network);
    expect(source.peek('1_2')).toBeUndefined();
  });
});
