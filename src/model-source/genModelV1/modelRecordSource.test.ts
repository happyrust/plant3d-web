import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_MODEL_RECORD_PAGES, type ModelRecordsApi } from './modelRecords';
import { createGenModelV1ModelRecordSource } from './modelRecordSource';

import { GenModelV1ApiError, toV1Refno, type GenModelV1RequestOptions, type GeomInstQuery } from '@/api/genModelV1Api';
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

/** 一根 BRAN 24381/145018，下面三个构件；ensure 任何一个构件都解到这根 */
function branApi(): ModelRecordsApi & { ensure: ReturnType<typeof vi.fn>; records: ReturnType<typeof vi.fn> } {
  const ensure = vi.fn(async ({ refno }: { refno: string; force?: boolean }) => {
    if (toV1Refno(refno) === '24381/1') throw new GenModelV1ApiError({ code: 'not_found', status: 404, path: '', message: 'gone' });
    return { status: 'AlreadyAvailable', generation_root: '24381/145018', generation_roots: ['24381/145018'] };
  });
  const records = vi.fn(async () => ({
    source: 'model-memory',
    items: [item('24381_145019', '24381_145018'), item('24381_145021', '24381_145018'), item('24381_145021', '24381_145018', 'h'), item('24381_145023', '24381_145018')],
    total: 4, truncated: false, next_cursor: null,
  }));
  return { ensure: ensure as never, records: records as never, children: vi.fn() as never, ...({} as object) } as never;
}

describe('createGenModelV1ModelRecordSource', () => {
  beforeEach(() => {
    __resetGenModelV1ServiceLifecycleForTests();
  });

  it('同根的多个构件只 ensure 一次：第一个构件把整根记录写进缓存，其余命中', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381/145021', '24381_145023']);

    expect(api.ensure).toHaveBeenCalledTimes(1);
    expect(api.records).toHaveBeenCalledTimes(1);
    expect([...out.keys()]).toEqual(['24381_145019', '24381_145021', '24381_145023']);
    expect(out.get('24381_145021')).toHaveLength(2);
    expect(out.get('24381_145019')![0]!.uniforms).toMatchObject({ refno: '24381_145019', owner_refno: '24381_145018', noun: 'ELBO' });
    expect(source.peek('24381_145023')).toHaveLength(1);

    // 第二次全部命中缓存，一次请求都不发
    await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145023']);
    expect(api.ensure).toHaveBeenCalledTimes(1);
  });

  it('请求到但记录里没有的构件记空数组；not_found 的根也记空，之后不再 ensure', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145099', '24381_1']);
    expect(out.get('24381_145099')).toEqual([]);
    expect(out.get('24381_1')).toEqual([]);
    // 145019 的 ensure 拉回整根；145099 不在这根的记录里、也不知道属于哪根，只能再问一次（同根 → 仍没有 → 记空）；
    // 24381_1 单独 ensure 一次（404 → 记空）
    expect(api.ensure).toHaveBeenCalledTimes(3);
    await source.instanceEntriesByRefnos(7997, ['24381_145099', '24381_1', '24381_145019']);
    expect(api.ensure).toHaveBeenCalledTimes(3);
  });

  it('forceRefresh 清掉请求的构件再问；forceRegenerate 只让第一次 ensure 带 force=true', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145021'], { forceRefresh: true, forceRegenerate: true });
    expect(api.ensure).toHaveBeenCalledTimes(2);
    expect(api.ensure.mock.calls[0]![0]).toEqual({ refno: '24381_145019' });
    expect(api.ensure.mock.calls[1]![0]).toEqual({ refno: '24381_145019', force: true });
  });

  it('collectedRoots / leavesOfRoot / invalidateRoot：按根归档，清一根连带清它的构件（P5 用）', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    expect(source.collectedRoots()).toEqual(['24381_145018']);
    expect(source.leavesOfRoot('24381/145018').sort()).toEqual(['24381_145018', '24381_145019', '24381_145021', '24381_145023']);

    const cleared = source.invalidateRoot('24381_145018');
    expect(cleared.sort()).toEqual(['24381_145018', '24381_145019', '24381_145021', '24381_145023']);
    expect(source.collectedRoots()).toEqual([]);
    expect(source.peek('24381_145021')).toBeUndefined();
    await source.instanceEntriesByRefnos(7997, ['24381_145021']);
    expect(api.ensure).toHaveBeenCalledTimes(2);
  });

  it('ensureAndCollect 后请求的节点与生成根都记空数组：树 visibleInsts(ZONE) 之后「根 + 构件」一起加载不再 ensure 第二次', async () => {
    // ZONE 24381/101410 → 生成根 24381/101412（BRAN），记录里没有 ZONE 自己
    const ensure = vi.fn(async () => ({ status: 'AlreadyAvailable', generation_root: '24381/101412', generation_roots: ['24381/101412'] }));
    const records = vi.fn(async () => ({
      source: 'model-memory', items: [item('24381_101413', '24381_101412'), item('24381_101414', '24381_101412')], total: 2, truncated: false, next_cursor: null,
    }));
    const source = createGenModelV1ModelRecordSource({ api: { ensure: ensure as never, records: records as never, children: vi.fn() as never } });

    const collected = await source.ensureAndCollect('24381_101410');
    expect(collected.generationRoots).toEqual(['24381_101412']);
    expect(source.peek('24381_101410')).toEqual([]);
    expect(source.peek('24381_101412')).toEqual([]);

    const out = await source.instanceEntriesByRefnos(7997, ['24381_101410', '24381_101413', '24381_101414']);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledTimes(1);
    expect(out.get('24381_101410')).toEqual([]);
    expect(out.get('24381_101413')).toHaveLength(1);
  });

  it('同一节点再问一遍 ensureAndCollect 直接回上次的干净结果（树勾一次眼睛会问两遍）；invalidate / force 之后重新问；有截断的不备忘', async () => {
    const ensure = vi.fn(async () => ({ status: 'AlreadyAvailable', generation_root: '24381/101412', generation_roots: ['24381/101412', '24381/101413'] }));
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => ({
      source: 'model-memory', items: [item(`${toV1Refno(generationRoot).replace('/', '_')}9`, generationRoot)], total: 1, truncated: false, next_cursor: null,
    }));
    const source = createGenModelV1ModelRecordSource({ api: { ensure: ensure as never, records: records as never, children: vi.fn() as never } });

    const first = await source.ensureAndCollect('24381_101410');
    const second = await source.ensureAndCollect('24381/101410');
    expect(second).toBe(first);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(records).toHaveBeenCalledTimes(2);

    // 预算截断的结果不备忘：带预算问一次 → 再不带预算问要拿到全的
    const budgeted = await source.ensureAndCollect('24381_101411', { maxRecordsRoots: 1 });
    expect(budgeted.truncatedRoots).toEqual(['24381_101413']);
    const full = await source.ensureAndCollect('24381_101411');
    expect(full.truncatedRoots).toEqual([]);
    expect(ensure).toHaveBeenCalledTimes(3);

    source.invalidateRoot('24381_101412');
    await source.ensureAndCollect('24381_101410');
    expect(ensure).toHaveBeenCalledTimes(4);

    await source.ensureAndCollect('24381_101410', { force: true });
    expect(ensure).toHaveBeenCalledTimes(5);
    expect(ensure).toHaveBeenLastCalledWith({ refno: '24381_101410', force: true }, expect.anything());
  });

  it('长期正缓存命中前仍先走合并 freshness 检查', async () => {
    const ensureFreshness = vi.fn(async () => {});
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api, ensureFreshness });
    await source.ensureAndCollect('24381_145019');
    await source.ensureAndCollect('24381_145019');
    expect(ensureFreshness).toHaveBeenCalledTimes(2);
    expect(api.ensure).toHaveBeenCalledTimes(1);
  });

  it('ensureAndCollect 有根 pending 时不给请求的节点记空：下次显示还要再问', async () => {
    const ensure = vi.fn(async () => {
      throw new GenModelV1ApiError({ code: 'generation_pending', status: 202, path: '', message: 'pending' });
    });
    const source = createGenModelV1ModelRecordSource({ api: { ensure: ensure as never, records: vi.fn() as never, children: vi.fn() as never } });
    const collected = await source.ensureAndCollect('24381_101410');
    expect(collected.pending).toEqual(['24381_101410']);
    expect(source.peek('24381_101410')).toBeUndefined();
  });

  it.each([
    ['generation_pending', 202],
    ['model_dependency_unavailable', 503],
  ] as const)('instanceEntriesByRefnos 遇到 %s 不负缓存空数组，下一次会重新 ensure', async (code, status) => {
    let attempt = 0;
    const ensure = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new GenModelV1ApiError({ code, status, path: '', message: `${code} for test` });
      }
      return { status: 'Generated', generation_root: '24381/145018' };
    });
    const records = vi.fn(async () => ({
      source: 'model-memory',
      items: [item('24381_145019', '24381_145018')],
      total: 1,
      truncated: false,
      next_cursor: null,
    }));
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
    });

    const first = await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    expect(first.get('24381_145019')).toEqual([]);
    expect(source.peek('24381_145019')).toBeUndefined();

    const second = await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(records).toHaveBeenCalledTimes(1);
    expect(second.get('24381_145019')).toHaveLength(1);
  });

  it('records 达到分页护栏仍 truncated 时不负缓存未读构件，下一次可重新 ensure', async () => {
    const target = '1_10001';
    let overflowing = true;
    let overflowPages = 0;
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_root: '1/1' }));
    const records = vi.fn(async () => {
      if (overflowing) {
        overflowPages += 1;
        return {
          source: 'model-memory',
          items: [item(`1_${overflowPages}`, '1_1')],
          total: MAX_MODEL_RECORD_PAGES + 1,
          truncated: true,
          next_cursor: overflowPages,
        };
      }
      return {
        source: 'model-memory',
        items: [item(target, '1_1')],
        total: 1,
        truncated: false,
        next_cursor: null,
      };
    });
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
      ensureOptions: { pageSize: 1 },
    });

    const first = await source.instanceEntriesByRefnos(7997, [target]);
    expect(overflowPages).toBe(MAX_MODEL_RECORD_PAGES);
    expect(first.get(target)).toEqual([]);
    expect(source.peek(target)).toBeUndefined();

    overflowing = false;
    const second = await source.instanceEntriesByRefnos(7997, [target]);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(second.get(target)).toHaveLength(1);
  });

  it('ensure / records 的 network 错误即使被收进结果也会通知服务生命周期', async () => {
    const ensureError = new GenModelV1ApiError({
      code: 'network',
      status: 0,
      path: '/api/v1/model/ensure',
      message: 'ensure disconnected',
    });
    const recordsError = new GenModelV1ApiError({
      code: 'network',
      status: 0,
      path: '/api/v1/model/records',
      message: 'records disconnected',
    });
    const ensure = vi.fn()
      .mockRejectedValueOnce(ensureError)
      .mockResolvedValueOnce({ status: 'Generated', generation_root: '1/2' });
    const records = vi.fn().mockRejectedValueOnce(recordsError);
    const noteRequestFailure = vi.fn();
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
      noteRequestFailure,
    });

    const ensureResult = await source.ensureAndCollect('1_1');
    const recordsResult = await source.ensureAndCollect('1_2');

    expect(ensureResult.errors['1_1']).toContain('ensure disconnected');
    expect(recordsResult.errors['1_2']).toContain('records disconnected');
    expect(noteRequestFailure.mock.calls.map(([error]) => error)).toEqual([ensureError, recordsError]);
  });

  it('subscribeProgress：任何一次 ensureAndCollect 的逐根进度都能听到，调用方自带的 onRootDone 照样触发，退订后不再收', async () => {
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_roots: ['1/1', '1/2'] }));
    // 两根 / 1 路 → 打成一批：假 records 照 spec §4.5.2 认多根（平铺、按 owner 归根）
    const records = vi.fn(async ({ generationRoot, generationRoots }: { generationRoot?: string; generationRoots?: string[] }) => {
      const roots = generationRoots ?? [generationRoot!];
      const items = roots.map((root) => item(`${toV1Refno(root).replace('/', '_')}9`, root));
      return { source: 'model-memory', items, total: items.length, truncated: false, next_cursor: null };
    });
    const source = createGenModelV1ModelRecordSource({ api: { ensure: ensure as never, records: records as never, children: vi.fn() as never } });

    const heard: string[] = [];
    const unsubscribe = source.subscribeProgress((p) => heard.push(`${p.refno}:${p.root}:${p.done}/${p.total}`));
    const own: number[] = [];
    await source.ensureAndCollect('1_0', { recordsConcurrency: 1, onRootDone: ({ done }) => own.push(done) });
    expect(heard).toEqual(['1_0:1_1:1/2', '1_0:1_2:2/2']);
    expect(own).toEqual([1, 2]);

    unsubscribe();
    source.invalidate();
    await source.instanceEntriesByRefnos(7997, ['1_19']);
    expect(heard).toHaveLength(2);
  });

  it('collectRoots：根清单已知时只取 records，进同一份缓存——后续 instanceEntriesByRefnos 一次 ensure 都不打', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    const result = await source.collectRoots(['24381/145018']);

    expect(api.ensure).not.toHaveBeenCalled();
    expect(api.records).toHaveBeenCalledTimes(1);
    expect(result.generationRoots).toEqual(['24381_145018']);
    expect(result.items).toHaveLength(4);
    expect(source.collectedRoots()).toContain('24381_145018');

    const out = await source.instanceEntriesByRefnos(7997, ['24381_145019', '24381_145021', '24381_145023']);
    expect(api.ensure).not.toHaveBeenCalled();
    expect(out.get('24381_145021')).toHaveLength(2);
    // 根自己记一笔空数组：调用方把「根 + 构件」一起交上来时不会为它再 ensure 一遍同一根
    expect(source.peek('24381_145018')).toEqual([]);
  });

  it('invalidate() 不带参数清全部', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    source.invalidate();
    expect(source.peek('24381_145019')).toBeUndefined();
    await source.instanceEntriesByRefnos(7997, ['24381_145019']);
    expect(api.ensure).toHaveBeenCalledTimes(2);
  });

  it('服务代次变化后才完成的旧 records 响应不能写回构件或 requested-result 缓存', async () => {
    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
    let resolveOld!: (value: {
      source: string;
      items: GeomInstQuery[];
      total: number;
      truncated: boolean;
      next_cursor: null;
    }) => void;
    const records = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({
        source: 'model-memory',
        items: [item('1_99', '1_1', 'fresh')],
        total: 1,
        truncated: false,
        next_cursor: null,
      });
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_root: '1/1' }));
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
    });

    const pending = source.ensureAndCollect('1_1');
    await vi.waitFor(() => expect(records).toHaveBeenCalledTimes(1));
    observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm');
    resolveOld({
      source: 'model-memory',
      items: [item('1_98', '1_1', 'stale')],
      total: 1,
      truncated: false,
      next_cursor: null,
    });
    await expect(pending).rejects.toThrow(/服务实例已变化/);
    expect(source.peek('1_98')).toBeUndefined();

    await source.ensureAndCollect('1_1');
    expect(source.peek('1_99')).toHaveLength(1);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('已 abort 的 signal 不能命中 ensureAndCollect 的备忘缓存：抛 cancelled（GenModelV1ApiError，abortSource=caller），一发请求都不打', async () => {
    const api = branApi();
    const source = createGenModelV1ModelRecordSource({ api });
    const clean = await source.ensureAndCollect('24381_145019');
    expect(clean.pending).toEqual([]);
    expect(api.ensure).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort(new Error('stop'));
    let thrown: unknown;
    try {
      await source.ensureAndCollect('24381_145019', { signal: controller.signal });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GenModelV1ApiError);
    expect(thrown).toMatchObject({ code: 'cancelled', abortSource: 'caller' });
    expect(api.ensure).toHaveBeenCalledTimes(1);
    expect(api.records).toHaveBeenCalledTimes(1);

    // 取消不是断线：不进 lifecycle 的失败账
    const noteRequestFailure = vi.fn();
    const observed = createGenModelV1ModelRecordSource({ api, noteRequestFailure });
    await expect(observed.ensureAndCollect('24381_145019', { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(noteRequestFailure.mock.calls.every(([error]) => (error as GenModelV1ApiError).code === 'cancelled')).toBe(true);
  });

  it('途中 abort(new Error("stop"))：ensureAndCollect / collectRoots 最终都以 cancelled GenModelV1ApiError 收口，不退回逐根；服务换代仍是独立错误类型', async () => {
    const roots = ['1/1', '1/2', '1/3'];
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_roots: roots }));
    let controller = new AbortController();
    // 假 records 像真 fetch 一样听 signal：批量那一发挂住直到被 abort，reason 原样抛出来（裸 Error）
    const records = vi.fn((req: { generationRoots?: string[] }, options?: GenModelV1RequestOptions) => new Promise<never>((_, reject) => {
      if (!req.generationRoots) {
        reject(new Error('取消后不该再逐根打请求'));
        return;
      }
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      queueMicrotask(() => controller.abort(new Error('stop')));
    }));
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
    });

    await expect(source.ensureAndCollect('1_0', { signal: controller.signal, recordsConcurrency: 1 }))
      .rejects.toMatchObject({ name: 'GenModelV1ApiError', code: 'cancelled', abortSource: 'caller' });
    expect(records).toHaveBeenCalledTimes(1);
    expect(source.peek('1_0')).toBeUndefined();

    controller = new AbortController();
    await expect(source.collectRoots(roots, { signal: controller.signal, recordsConcurrency: 1 }))
      .rejects.toMatchObject({ name: 'GenModelV1ApiError', code: 'cancelled', abortSource: 'caller' });
    expect(records).toHaveBeenCalledTimes(2);

    // 同一条路上换代：分型是 GenModelV1ServiceGenerationChangedError，不是 cancelled
    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
    records.mockImplementationOnce((_req, options?: GenModelV1RequestOptions) => new Promise<never>((_, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      queueMicrotask(() => observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm'));
    }));
    await expect(source.collectRoots(roots, { recordsConcurrency: 1 })).rejects.toBeInstanceOf(GenModelV1ServiceGenerationChangedError);
  });

  it('不取消、不换代时，catch 里的 guard.assertCurrent() 不吞原错误：裸 Error / network 原样到达调用方并上报 lifecycle', async () => {
    const plain = new Error('transport exploded');
    const network = new GenModelV1ApiError({ code: 'network', status: 0, path: '/api/v1/model/ensure', message: 'ECONNRESET' });
    const ensure = vi.fn().mockRejectedValueOnce(plain).mockRejectedValueOnce(network);
    const noteRequestFailure = vi.fn();
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: vi.fn() as never, children: vi.fn() as never },
      noteRequestFailure,
    });

    // 非 GenModelV1ApiError：ensureAndCollectRecords 直接抛 → 源的 catch 原样再抛（同一个对象）
    await expect(source.ensureAndCollect('1_1')).rejects.toBe(plain);
    expect(noteRequestFailure).toHaveBeenCalledWith(plain);
    // network 的 GenModelV1ApiError：按既有口径折进 errors（不 reject），但 lifecycle 必须看见原始错误
    const collected = await source.ensureAndCollect('1_2');
    expect(collected.errors['1_2']).toContain('ECONNRESET');
    expect(noteRequestFailure).toHaveBeenCalledWith(network);
    expect(noteRequestFailure.mock.calls.every(([error]) => !(error instanceof GenModelV1ApiError) || error.code !== 'cancelled')).toBe(true);
    expect(source.peek('1_2')).toBeUndefined();
  });

  it('多路并发逐根途中取消：先成的根不落缓存、后面的根不进 errors/pending，整次以 cancelled 收口', async () => {
    const controller = new AbortController();
    const roots = ['1/1', '1/2', '1/3'];
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_roots: roots }));
    let hanging: ((reason: unknown) => void) | null = null;
    const records = vi.fn(({ generationRoot }: { generationRoot: string }, options?: GenModelV1RequestOptions) => new Promise<unknown>((resolve, reject) => {
      const root = toV1Refno(generationRoot);
      if (root === '1/1') { resolve({ source: 'model-memory', items: [item('1_10', '1_1')], total: 1, truncated: false, next_cursor: null }); return; }
      if (root === '1/2') {
        queueMicrotask(() => {
          controller.abort(new Error('stop'));
          reject(new GenModelV1ApiError({ code: 'cancelled', status: 0, path: '', message: 'aborted', abortSource: 'caller' }));
        });
        return;
      }
      // 1/3 像真 fetch：挂着直到 signal abort
      hanging = reject;
      options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    }));
    const source = createGenModelV1ModelRecordSource({ api: { ensure: ensure as never, records: records as never, children: vi.fn() as never } });

    await expect(source.ensureAndCollect('1_0', { signal: controller.signal, recordsConcurrency: 3, recordsBatchSize: 1 }))
      .rejects.toMatchObject({ name: 'GenModelV1ApiError', code: 'cancelled', abortSource: 'caller' });
    expect(records).toHaveBeenCalledTimes(3);
    expect(hanging).not.toBeNull();
    // 先成的 1/1 的记录没有被吸进缓存，请求节点也没有备忘
    expect(source.peek('1_10')).toBeUndefined();
    expect(source.peek('1_0')).toBeUndefined();
    expect(source.collectedRoots()).toEqual([]);
  });

  it('not_generated 恢复会先清根缓存，再 ensure 一次并只接受重试后的记录', async () => {
    let phase: 'old' | 'retry' = 'old';
    const ensure = vi.fn(async () => ({ status: 'Generated', generation_root: '1/1' }));
    const records = vi.fn(async () => {
      if (phase === 'old') {
        return {
          source: 'model-memory',
          items: [item('1_10', '1_1', 'old')],
          total: 1,
          truncated: false,
          next_cursor: null,
        };
      }
      if (records.mock.calls.length === 2) {
        throw new GenModelV1ApiError({
          code: 'conflict',
          status: 409,
          path: '/api/v1/model/records',
          message: 'not_generated: generation root 1/1',
        });
      }
      return {
        source: 'model-memory',
        items: [item('1_11', '1_1', 'new')],
        total: 1,
        truncated: false,
        next_cursor: null,
      };
    });
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
    });
    await source.collectRoots(['1_1']);
    expect(source.peek('1_10')).toHaveLength(1);

    phase = 'retry';
    await source.collectRoots(['1_1']);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(source.peek('1_10')).toBeUndefined();
    expect(source.peek('1_11')).toHaveLength(1);
    expect(records).toHaveBeenCalledTimes(3);
  });
});
