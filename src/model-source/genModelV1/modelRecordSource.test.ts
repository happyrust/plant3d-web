import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGenModelV1ModelRecordSource, MISSING_REFNO_QUERY_CONCURRENCY } from './modelRecordSource';

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

  it('备忘没命中时 records 不等 health 先发；这一轮 health 查出换代就清掉重查一次，不报错', async () => {
    observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
    let finishHealth!: () => void;
    const ensureFreshness = vi.fn(() => new Promise<void>((resolve) => { finishHealth = resolve; }));
    const records = vi.fn()
      .mockImplementationOnce((_req: unknown, options?: GenModelV1RequestOptions) => new Promise<never>((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      }))
      .mockResolvedValueOnce(page([item('1_99', '1_1', 'fresh')]));
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
      ensureFreshness,
    });

    const pending = source.collectByAncestor('1_1');
    await vi.waitFor(() => expect(records).toHaveBeenCalledTimes(1));
    // health 探针先记下新代次（在飞的读取随之作废），再收口
    observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm');
    finishHealth();

    const result = await pending;
    expect(records).toHaveBeenCalledTimes(2);
    expect(result.items.map((record) => record.refno)).toEqual(['1_99']);
    expect(source.peek('1_99')).toHaveLength(1);
  });

  it('备忘命中前先等 health 收口', async () => {
    const client = branApi();
    const healthGates: (() => void)[] = [];
    let gated = false;
    const ensureFreshness = vi.fn(() => (gated ? new Promise<void>((resolve) => { healthGates.push(resolve); }) : Promise.resolve()));
    const source = createGenModelV1ModelRecordSource({ api: client, ensureFreshness });
    const first = await source.collectByAncestor('24381_145018');

    gated = true;
    let settled = false;
    const second = source.collectByAncestor('24381_145018').then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    healthGates.forEach((open) => open());
    expect(await second).toBe(first);
    expect(client.records).toHaveBeenCalledTimes(1);
  });

  it('同一节点的并发查询共用一发 records', async () => {
    const client = branApi();
    const source = createGenModelV1ModelRecordSource({ api: client });
    const [a, b] = await Promise.all([source.collectByAncestor('24381_145018'), source.collectByAncestor('24381/145018')]);
    expect(b).toBe(a);
    expect(client.records).toHaveBeenCalledTimes(1);
  });

  it('expandAncestor 给出成员时按成员并行查，结果仍记在请求的节点名下', async () => {
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => (
      generationRoot === '9_2' ? page([]) : page([item(`${generationRoot}1`, generationRoot)])
    ));
    const expandAncestor = vi.fn(async (refno: string) => (refno === '9_0' ? ['9_1', '9_2', '9_3'] : null));
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
      expandAncestor,
    });

    const site = await source.collectByAncestor('9_0');
    expect(records.mock.calls.map(([req]) => req.generationRoot).sort()).toEqual(['9_1', '9_2', '9_3']);
    expect(site.refno).toBe('9_0');
    expect(site.items.map((record) => record.refno).sort()).toEqual(['9_11', '9_31']);
    expect(site.empty).toEqual(['9_2']);
    expect(source.peek('9_31')).toHaveLength(1);

    await source.collectByAncestor('9_0');
    expect(records).toHaveBeenCalledTimes(3);
    // 2026-11-11 起：按成员查到的记录也记在成员自己名下，之后单独显示这个 ZONE 不再问服务端（原来会再发一次）
    const member = await source.collectByAncestor('9_1');
    expect(records).toHaveBeenCalledTimes(3);
    expect(member.refno).toBe('9_1');
    expect(member.items.map((record) => record.refno)).toEqual(['9_11']);
    expect(member.generationRoots).toEqual(['9_1']);
    // 查空的成员没有单独记：单独问它时照常去查
    await source.collectByAncestor('9_2');
    expect(records).toHaveBeenCalledTimes(4);
    expect(records.mock.calls.at(-1)![0].generationRoot).toBe('9_2');
  });

  describe('cancelCollect 与成员备忘（加载中可以停：已经取到的留着，再点眼睛只取剩下的）', () => {
    /** SITE 8_0 → 成员 8_1 … 8_5，各两条记录；`gate(member)` 之后那个成员要等放行（或被取消）才回 */
    function siteSource() {
      const gates: Record<string, { open: () => void; wait: Promise<void> }> = {};
      const gate = (member: string) => {
        let open!: () => void;
        const wait = new Promise<void>((resolve) => { open = resolve; });
        gates[member] = { open, wait };
      };
      const signals: AbortSignal[] = [];
      const records = vi.fn(async ({ generationRoot }: { generationRoot: string }, requestOptions?: GenModelV1RequestOptions) => {
        const signal = requestOptions?.signal;
        if (signal) signals.push(signal);
        if (gates[generationRoot]) {
          await Promise.race([
            gates[generationRoot]!.wait,
            new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true })),
          ]);
        }
        if (signal?.aborted) throw signal.reason;
        return page([item(`${generationRoot}1`, `${generationRoot}0`), item(`${generationRoot}2`, `${generationRoot}0`)]);
      });
      const source = createGenModelV1ModelRecordSource({
        api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
        expandAncestor: async (refno) => (refno === '8_0' ? ['8_1', '8_2', '8_3', '8_4', '8_5'] : null),
        // 一次只放两个成员在飞：叫停时后面的成员还没发
        recordsOptions: { concurrency: 2 },
      });
      const asked = () => records.mock.calls.map(([req]) => req.generationRoot);
      return { source, records, gate, gates, signals, asked };
    }

    it('叫停正在进行的读取：在飞的请求被取消，后面的成员不再发；这次读取以 cancelled 收口', async () => {
      const { source, gate, gates, signals, asked } = siteSource();
      gate('8_2');
      gate('8_3');
      const pending = source.collectByAncestor('8_0');
      pending.catch(() => undefined);
      await vi.waitFor(() => expect(asked()).toEqual(['8_1', '8_2', '8_3']));

      expect(source.cancelCollect('8/0')).toBe(true);
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      // 8_4、8_5 没有发出去；放行也不会再有新请求
      gates['8_2']!.open();
      gates['8_3']!.open();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(asked()).toEqual(['8_1', '8_2', '8_3']);
      // 没有在读的时候叫停无效
      expect(source.cancelCollect('8_0')).toBe(false);
    });

    it('叫停之前收齐的成员留着：再读这个节点只问没收齐的；留着的成员先交给边取边画，实例还是缓存里那一份', async () => {
      const { source, gate, asked } = siteSource();
      gate('8_2');
      gate('8_3');
      const first = source.collectByAncestor('8_0');
      first.catch(() => undefined);
      await vi.waitFor(() => expect(source.peek('8_11')).toHaveLength(1));
      source.cancelCollect('8_0');
      await expect(first).rejects.toMatchObject({ code: 'cancelled' });
      const kept = source.peek('8_11');
      expect(source.peek('8_21')).toBeUndefined();

      // 第二次：8_1 不重问；批次里先到的是留着的 8_1
      const heard: string[] = [];
      const handed = new Map<string, unknown>();
      source.subscribeMemberRecords(({ refno, member, entries, done, total }) => {
        heard.push(`${refno}<-${member}:${done}/${total}`);
        for (const [key, value] of entries) handed.set(key, value);
      });
      const again = source.collectByAncestor('8_0');
      // 8_2、8_3 还挡着（第一次的闸没放）：只有留着的成员先交
      await vi.waitFor(() => expect(heard).toEqual(['8_0<-8_1:1/5']));
      expect(handed.get('8_11')).toBe(kept);
      expect(asked().slice(3)).toEqual(['8_2', '8_3']);
      source.cancelCollect('8_0');
      await expect(again).rejects.toMatchObject({ code: 'cancelled' });
    });

    it('第二次读完：结果里留着的成员和新取的成员都在，整个节点记进备忘；再问一次不发请求', async () => {
      const { source, gate, gates, asked, records } = siteSource();
      gate('8_3');
      const first = source.collectByAncestor('8_0');
      first.catch(() => undefined);
      // 8_1、8_2 收齐，8_3 挡着，8_4 在飞或已回
      await vi.waitFor(() => expect(source.peek('8_21')).toHaveLength(1));
      source.cancelCollect('8_0');
      await expect(first).rejects.toMatchObject({ code: 'cancelled' });
      const askedBefore = asked().length;
      const keptMembers = ['8_1', '8_2', '8_4', '8_5'].filter((member) => source.peek(`${member}1`) !== undefined);
      expect(keptMembers).toContain('8_1');
      expect(keptMembers).toContain('8_2');

      gates['8_3']!.open();
      const result = await source.collectByAncestor('8_0');
      const askedAgain = asked().slice(askedBefore);
      // 留着的成员一个都没重问
      expect(askedAgain.filter((member) => keptMembers.includes(member))).toEqual([]);
      expect(askedAgain).toContain('8_3');
      expect(result.items.map((record) => record.refno).sort()).toEqual([
        '8_11', '8_12', '8_21', '8_22', '8_31', '8_32', '8_41', '8_42', '8_51', '8_52',
      ]);
      expect(result.refno).toBe('8_0');
      expect(result.generationRoots.sort()).toEqual(['8_10', '8_20', '8_30', '8_40', '8_50']);
      expect(result.pending).toEqual([]);
      expect(result.empty).toEqual([]);

      const total = records.mock.calls.length;
      expect(await source.collectByAncestor('8_0')).toBe(result);
      expect(records).toHaveBeenCalledTimes(total);
    });

    it('叫停之后马上再读：开的是新的一次读取，不会拿到刚被取消的那一次', async () => {
      const { source, gate, gates } = siteSource();
      gate('8_1');
      const first = source.collectByAncestor('8_0');
      first.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      source.cancelCollect('8_0');
      gates['8_1']!.open();
      const second = source.collectByAncestor('8_0');
      expect(second).not.toBe(first);
      await expect(first).rejects.toMatchObject({ code: 'cancelled' });
      expect((await second).items).toHaveLength(10);
    });

    it('invalidate 之后成员备忘也清掉：全部重问', async () => {
      const { source, asked } = siteSource();
      await source.collectByAncestor('8_0');
      expect(asked()).toHaveLength(5);
      source.invalidate();
      await source.collectByAncestor('8_0');
      expect(asked()).toHaveLength(10);
    });

    it('进度按整个节点的成员数报：留着的成员一上来就算完成', async () => {
      const { source, gate, gates } = siteSource();
      gate('8_2');
      gate('8_3');
      const first = source.collectByAncestor('8_0');
      first.catch(() => undefined);
      await vi.waitFor(() => expect(source.peek('8_11')).toHaveLength(1));
      source.cancelCollect('8_0');
      await expect(first).rejects.toMatchObject({ code: 'cancelled' });

      const progress: string[] = [];
      source.subscribeProgress(({ root, done, total }) => progress.push(`${root}:${done}/${total}`));
      gates['8_2']!.open();
      gates['8_3']!.open();
      await source.collectByAncestor('8_0');
      expect(progress[0]).toBe('8_1:1/5');
      expect(progress).toHaveLength(5);
      expect(progress.at(-1)!.endsWith(':5/5')).toBe(true);
    });
  });

  describe('subscribeMemberRecords（边取边画：按成员拆开查时，每个成员收完就交一批）', () => {
    /** SITE 9_0 → 成员 9_1 / 9_2 / 9_3；`gates[member]` 存在时那个成员要等放行才回 */
    function siteSource(extra: { ensureFreshness?: () => Promise<unknown> } = {}) {
      const gates: Record<string, { open: () => void; wait: Promise<void> }> = {};
      const gate = (member: string) => {
        let open!: () => void;
        const wait = new Promise<void>((resolve) => { open = resolve; });
        gates[member] = { open, wait };
      };
      const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => {
        await gates[generationRoot]?.wait;
        return generationRoot === '9_3' ? page([]) : page([item(`${generationRoot}1`, `${generationRoot}0`), item(`${generationRoot}2`, `${generationRoot}0`)]);
      });
      const source = createGenModelV1ModelRecordSource({
        api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
        expandAncestor: async (refno) => (refno === '9_0' ? ['9_1', '9_2', '9_3'] : null),
        ...extra,
      });
      return { source, records, gate, gates };
    }

    it('成员收完就交出它的实例并进缓存，不等还没回来的成员；查空的成员不交；最终结果照旧', async () => {
      const { source, gate, gates } = siteSource();
      gate('9_2');
      const heard: string[] = [];
      source.subscribeMemberRecords(({ refno, member, entries, done, total }) => {
        heard.push(`${refno}<-${member}:${[...entries.keys()].join(',')}:${done}/${total}`);
      });

      const pending = source.collectByAncestor('9_0');
      await vi.waitFor(() => expect(heard).toHaveLength(1));
      expect(heard).toEqual(['9_0<-9_1:9_11,9_12:1/3']);
      // 9_2 还没回来，9_1 的构件已经能从缓存里拿到（装载器按它装第一批）
      expect(source.peek('9_11')).toHaveLength(1);
      expect(source.peek('9_21')).toBeUndefined();

      gates['9_2']!.open();
      const result = await pending;
      expect(heard).toEqual(['9_0<-9_1:9_11,9_12:1/3', '9_0<-9_2:9_21,9_22:3/3']);
      expect(result.items.map((record) => record.refno)).toEqual(['9_11', '9_12', '9_21', '9_22']);
      expect(result.empty).toEqual(['9_3']);
      expect(source.peek('9_22')).toHaveLength(1);
      expect(source.leavesOfRoot('9_10').sort()).toEqual(['9_10', '9_11', '9_12']);
    });

    it('交出去的实例和最后留在缓存里的是同一份：收尾时不把已交的成员重新映射一遍', async () => {
      const { source } = siteSource();
      const handed = new Map<string, unknown>();
      source.subscribeMemberRecords(({ entries }) => { for (const [key, value] of entries) handed.set(key, value); });
      await source.collectByAncestor('9_0');
      expect([...handed.keys()].sort()).toEqual(['9_11', '9_12', '9_21', '9_22']);
      for (const [key, value] of handed) expect(source.peek(key)).toBe(value);
    });

    it('不拆成员的节点（一发查完）不发批次', async () => {
      const { source } = siteSource();
      const heard: string[] = [];
      source.subscribeMemberRecords(({ member }) => heard.push(member));
      await source.collectByAncestor('9_1');
      expect(heard).toEqual([]);
      expect(source.peek('9_11')).toHaveLength(1);
    });

    it('health 还没确认服务代次之前不交、不进缓存；确认之后把攒着的补交', async () => {
      let confirm!: () => void;
      const ensureFreshness = vi.fn(() => new Promise<void>((resolve) => { confirm = resolve; }));
      const { source } = siteSource({ ensureFreshness });
      const heard: string[] = [];
      source.subscribeMemberRecords(({ member }) => heard.push(member));

      const pending = source.collectByAncestor('9_0');
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(heard).toEqual([]);
      expect(source.peek('9_11')).toBeUndefined();

      confirm();
      await pending;
      expect(heard.sort()).toEqual(['9_1', '9_2']);
      expect(source.peek('9_11')).toHaveLength(1);
    });

    it('服务换代之后才回来的成员不交、不进缓存', async () => {
      observeGenModelV1Health({ status: 'ok', started_at: 'old' }, '/gm');
      const { source, gate, gates } = siteSource();
      gate('9_1');
      gate('9_2');
      const heard: string[] = [];
      source.subscribeMemberRecords(({ member }) => heard.push(member));

      const pending = source.collectByAncestor('9_0');
      pending.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      observeGenModelV1Health({ status: 'ok', started_at: 'new' }, '/gm');
      gates['9_1']!.open();
      gates['9_2']!.open();
      await expect(pending).rejects.toBeInstanceOf(GenModelV1ServiceGenerationChangedError);
      expect(heard).toEqual([]);
      expect(source.peek('9_11')).toBeUndefined();
    });

    it('订阅方抛错不影响取数；退订之后不再收', async () => {
      const { source } = siteSource();
      const heard: string[] = [];
      const unsubscribe = source.subscribeMemberRecords(({ member }) => {
        heard.push(member);
        throw new Error('listener failed');
      });
      const result = await source.collectByAncestor('9_0');
      expect(result.items).toHaveLength(4);
      expect(heard.sort()).toEqual(['9_1', '9_2']);

      unsubscribe();
      source.invalidate();
      await source.collectByAncestor('9_0');
      expect(heard).toHaveLength(2);
    });
  });

  it('instanceEntriesByRefnos：缓存没有的构件第一个单独查，其余有界并发', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const records = vi.fn(async ({ generationRoot }: { generationRoot: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return page([item(generationRoot, generationRoot)]);
    });
    const source = createGenModelV1ModelRecordSource({
      api: { generate: vi.fn() as never, records: records as never, children: vi.fn() as never },
    });
    const refnos = Array.from({ length: 20 }, (_, i) => `5_${i + 1}`);
    const out = await source.instanceEntriesByRefnos(5, refnos);
    expect(records).toHaveBeenCalledTimes(20);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(MISSING_REFNO_QUERY_CONCURRENCY);
    expect([...out.values()].every((entries) => entries.length === 1)).toBe(true);
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
