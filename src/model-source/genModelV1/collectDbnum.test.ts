import { describe, expect, it, vi } from 'vitest';

import {
  collectDbnumRefnos,
  DEFAULT_DBNUM_ROOTS_BUDGET,
  dbnumServerEntrySupport,
  listSitesOfDbnum,
  type CollectDbnumProgress,
  type DbnumServerEntryApi,
} from './collectDbnum';

import type { CollectRootsOptions, CollectRootsResult, EnsureAndCollectOptions, EnsureAndCollectResult } from './modelRecords';
import type { GenModelV1ModelRecordSource } from './modelRecordSource';
import type { TreeSource } from '../ports';
import type { GeomInstQuery } from '@/api/genModelV1Api';

import { GenModelV1ApiError } from '@/api/genModelV1Api';

function item(refno: string, owner: string): GeomInstQuery {
  return {
    refno, old_refno: null, owner, world_aabb: null,
    world_trans: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    insts: [], has_neg: false, generic: 'ELBO', pts: null, date: null,
  };
}

const ROOT_ID = 'gm-root:AvevaMarineSample:ALL';

function fakeTree(): TreeSource {
  return {
    worldRoot: vi.fn(async () => ({ success: true, node: { refno: ROOT_ID, name: 'AvevaMarineSample / ALL', noun: 'WORL', owner: null, children_count: 3, dbnum: null } })),
    children: vi.fn(async (refno: string) => ({
      success: true, parent_refno: refno, truncated: false,
      children: [
        { refno: '9304_2', name: '/1RS-CIVI', noun: 'SITE', owner: ROOT_ID, children_count: 3, dbnum: 1112 },
        { refno: '24381_2', name: '/1WCC-PIPE', noun: 'SITE', owner: ROOT_ID, children_count: 12, dbnum: 7997 },
        { refno: '24383_2', name: '', noun: 'SITE', owner: ROOT_ID, children_count: 1, dbnum: 7997 },
      ],
    })),
  } as unknown as TreeSource;
}

function fakeRecords(plan: Record<string, Partial<EnsureAndCollectResult> & { roots?: string[] }>): GenModelV1ModelRecordSource & { ensureAndCollect: ReturnType<typeof vi.fn>; collectRoots: ReturnType<typeof vi.fn> } {
  const ensureAndCollect = vi.fn(async (refno: string, options: EnsureAndCollectOptions = {}): Promise<EnsureAndCollectResult> => {
    const entry = plan[refno] ?? {};
    const allRoots = entry.roots ?? [];
    // 照 ensureAndCollectRecords 的 maxRecordsRoots 语义：预算内的根取 records，预算外的记 truncatedRoots
    const budget = options.maxRecordsRoots ?? Number.POSITIVE_INFINITY;
    const roots = allRoots.slice(0, Math.max(0, Math.min(allRoots.length, budget)));
    const truncated = allRoots.slice(roots.length);
    roots.forEach((root, index) => options.onRootDone?.({ done: index + 1, total: roots.length, root }));
    const items = (entry.items ?? []).filter((item) => roots.includes(item.owner));
    return {
      refno, generationRoots: roots, items, pending: [], empty: [], truncatedRoots: [...truncated, ...(entry.truncatedRoots ?? [])], errors: {}, statuses: {},
      ...(({ items: _items, roots: _roots, truncatedRoots: _truncatedRoots, ...rest }) => rest)(entry),
    };
  });
  const collectRoots = vi.fn(async (roots: string[], options: CollectRootsOptions = {}): Promise<CollectRootsResult> => {
    const items = Object.values(plan).flatMap((entry) => entry.items ?? []).filter((item) => roots.includes(item.owner));
    roots.forEach((root, index) => options.onRootDone?.({ done: index + 1, total: roots.length, root }));
    return { generationRoots: roots, items, pending: [], empty: [], errors: {} };
  });
  return { ensureAndCollect, collectRoots } as unknown as GenModelV1ModelRecordSource & {
    ensureAndCollect: ReturnType<typeof vi.fn>;
    collectRoots: ReturnType<typeof vi.fn>;
  };
}

function apiError(code: string, status: number): GenModelV1ApiError {
  return new GenModelV1ApiError({ code, status, message: `${code} for test`, path: '/api/v1/dbnums/7997/model/ensure' });
}

/**
 * 旧服务端（没有 spec §4.5.3 整库入口，整条路由 404）。逐 SITE 老路的用例都用它——不给的话
 * `collectDbnumRefnos` 会先去打真实的 `defaultDbnumServerEntryApi`。
 */
function legacyServerApi(): DbnumServerEntryApi {
  return {
    ensureDbnum: vi.fn(async () => { throw apiError('not_found', 404); }),
    dbnumRoots: vi.fn(async () => { throw apiError('not_found', 404); }),
    task: vi.fn(async () => { throw apiError('not_found', 404); }),
  } as unknown as DbnumServerEntryApi;
}

/** 有整库入口的服务端：`ensure` 回 202 回执，`tasks/{id}` 按给定的状态序列走，`roots` 回根清单（`a/b` 口径）。 */
function serverEntryApi(options: {
  expectedRoots: number;
  states: { state: string; units_done: number; result?: Record<string, unknown> }[];
  roots: string[];
}): DbnumServerEntryApi & { ensureDbnum: ReturnType<typeof vi.fn>; task: ReturnType<typeof vi.fn>; dbnumRoots: ReturnType<typeof vi.fn> } {
  let poll = 0;
  return {
    ensureDbnum: vi.fn(async (dbnum: number) => ({
      task_id: `dbnum-model-ensure-${dbnum}-1`, dbnum, expected_roots: options.expectedRoots, state: 'queued',
      model_source: 'memory', model_source_reason: 'read-through', durable: false,
    })),
    task: vi.fn(async (taskId: string) => {
      const step = options.states[Math.min(poll++, options.states.length - 1)]!;
      return {
        task_id: taskId, kind: 'dbnum_model_ensure', state: step.state,
        units_done: step.units_done, total_units: options.expectedRoots, result: step.result ?? null,
      };
    }),
    dbnumRoots: vi.fn(async (dbnum: number) => ({
      source: 'direct', dbnum, total: options.roots.length,
      roots: options.roots.map((root) => ({ generation_root: root, noun: 'EQUI', name: root })),
    })),
  } as unknown as DbnumServerEntryApi & { ensureDbnum: ReturnType<typeof vi.fn>; task: ReturnType<typeof vi.fn>; dbnumRoots: ReturnType<typeof vi.fn> };
}

describe('listSitesOfDbnum', () => {
  it('只取虚拟根下 dbnum 相等的 SITE；空名退回 refno', async () => {
    const tree = fakeTree();
    expect(await listSitesOfDbnum(tree, 7997)).toEqual([
      { refno: '24381_2', name: '/1WCC-PIPE' },
      { refno: '24383_2', name: '24383_2' },
    ]);
    expect(await listSitesOfDbnum(tree, 1)).toEqual([]);
    expect(tree.children).toHaveBeenCalledWith(ROOT_ID, 1_000_000);
  });

  it('tree/roots 不可用时抛错，不吞', async () => {
    const tree = { ...fakeTree(), worldRoot: vi.fn(async () => ({ success: false, node: null, error_message: 'network: down' })) } as unknown as TreeSource;
    await expect(listSitesOfDbnum(tree, 7997)).rejects.toThrow('network: down');
  });
});

describe('collectDbnumRefnos', () => {
  it('该库的 SITE 逐个（串行）ensureAndCollect，构件 refno 按 SITE 顺序去重，pending / 错误合并，进度按 SITE 与生成根两级回调', async () => {
    const records = fakeRecords({
      '24381_2': {
        roots: ['24381_145018', '24381_145019'],
        items: [item('24381_1', '24381_145018'), item('24381_2', '24381_145018'), item('24381_3', '24381_145019'), item('24381/2', '24381_145018')],
        pending: ['24381_145020'],
      },
      '24383_2': {
        roots: ['24383_9'],
        items: [item('24383_1', '24383_9'), item('24381_3', '24383_9')],
        errors: { '24383_10': 'boom' },
        truncatedRoots: ['24383_11'],
      },
    });
    const progress: CollectDbnumProgress[] = [];
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { onProgress: (p) => progress.push(p) }, legacyServerApi());

    expect(records.ensureAndCollect).toHaveBeenCalledTimes(2);
    expect(records.ensureAndCollect.mock.calls.map((c) => c[0])).toEqual(['24381_2', '24383_2']);
    // 每个 SITE 的 ensure 上限比单节点显示宽；生成根预算缺省不限（P9-3 之后 records 按批取），所以不给 maxRecordsRoots
    expect(records.ensureAndCollect.mock.calls[0]![1]).toMatchObject({ maxRoots: 4096, maxContainerDepth: 4, maxRecordsRoots: undefined });
    expect(records.ensureAndCollect.mock.calls[1]![1]).toMatchObject({ maxRecordsRoots: undefined });

    expect(result.sites.map((s) => s.refno)).toEqual(['24381_2', '24383_2']);
    expect(result.refnos).toEqual(['24381_1', '24381_2', '24381_3', '24383_1']);
    expect(result.generationRoots).toEqual(['24381_145018', '24381_145019', '24383_9']);
    expect(result.pending).toEqual(['24381_145020']);
    expect(result.errors).toEqual({ '24383_10': 'boom' });
    expect(result.truncatedRoots).toEqual(['24383_11']);
    expect(result.skippedSites).toEqual([]);
    expect(result.budgetLimited).toBe(false);

    expect(progress.map((p) => `${p.phase}:${p.siteIndex}/${p.siteCount}:${p.rootsDone}/${p.rootsTotal}:${p.root ?? '-'}`)).toEqual([
      'sites:1/2:0/0:-',
      'roots:1/2:1/2:24381_145018',
      'roots:1/2:2/2:24381_145019',
      'sites:2/2:0/0:-',
      'roots:2/2:1/1:24383_9',
    ]);
    expect(progress[1]!.site).toEqual({ refno: '24381_2', name: '/1WCC-PIPE' });
  });

  it('构件数到 maxRefnos 就不再处理后面的 SITE，记进 skippedSites，budgetLimited', async () => {
    const records = fakeRecords({
      '24381_2': { roots: ['24381_145018'], items: [item('24381_1', '24381_145018'), item('24381_2', '24381_145018')] },
      '24383_2': { roots: ['24383_9'], items: [item('24383_1', '24383_9')] },
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { maxRefnos: 2 }, legacyServerApi());
    expect(records.ensureAndCollect).toHaveBeenCalledTimes(1);
    expect(result.refnos).toEqual(['24381_1', '24381_2']);
    expect(result.skippedSites).toEqual(['24383_2']);
    expect(result.budgetLimited).toBe(true);
  });

  it('安全概览预算 maxTotalRoots（调用方显式给有限值）：跨 SITE 累计，一个 SITE 里超出的根记 truncatedRoots、后面的 SITE 整个跳过；缺省 = 不限 = 全量', async () => {
    const plan = {
      '24381_2': { roots: ['r1', 'r2', 'r3'], items: [item('24381_1', 'r1'), item('24381_2', 'r2'), item('24381_3', 'r3')] },
      '24383_2': { roots: ['r4'], items: [item('24383_1', 'r4')] },
    };
    const budgeted = fakeRecords(plan);
    const limited = await collectDbnumRefnos(fakeTree(), budgeted, 7997, { maxTotalRoots: 2 }, legacyServerApi());
    expect(budgeted.ensureAndCollect.mock.calls[0]![1]).toMatchObject({ maxRecordsRoots: 2 });
    expect(limited.generationRoots).toEqual(['r1', 'r2']);
    expect(limited.refnos).toEqual(['24381_1', '24381_2']);
    expect(limited.truncatedRoots).toEqual(['r3']);
    expect(limited.skippedSites).toEqual(['24383_2']);
    expect(limited.budgetLimited).toBe(true);

    expect(DEFAULT_DBNUM_ROOTS_BUDGET).toBe(Number.POSITIVE_INFINITY);
    for (const options of [{}, { maxTotalRoots: Number.POSITIVE_INFINITY }]) {
      const records = fakeRecords(plan);
      const full = await collectDbnumRefnos(fakeTree(), records, 7997, options, legacyServerApi());
      expect(records.ensureAndCollect.mock.calls[0]![1]).toMatchObject({ maxRecordsRoots: undefined });
      expect(full.generationRoots).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect(full.budgetLimited).toBe(false);
    }
  });

  it('库里没有 SITE：不 ensure，回空', async () => {
    const records = fakeRecords({});
    const result = await collectDbnumRefnos(fakeTree(), records, 4242, {}, legacyServerApi());
    expect(records.ensureAndCollect).not.toHaveBeenCalled();
    expect(result.sites).toEqual([]);
    expect(result.refnos).toEqual([]);
  });
});

/** 服务端整库入口（spec §4.5.3，读透 / kv-mem 形态；收口计划 §17）。 */
describe('collectDbnumRefnos · 服务端整库入口', () => {
  const plan = {
    all: { items: [item('24381_1', '24381_145018'), item('24381_2', '24381_145018'), item('24383_1', '24383_9')] },
  };

  it('起任务 → 轮询到终态 → 取根清单 → 只取 records：一次 ensureAndCollect 都不打，进度先 generate 后 roots', async () => {
    const records = fakeRecords(plan);
    const api = serverEntryApi({
      expectedRoots: 2,
      states: [{ state: 'running', units_done: 1 }, { state: 'succeeded', units_done: 2 }],
      roots: ['24381/145018', '24383/9'],
    });
    const progress: CollectDbnumProgress[] = [];
    const result = await collectDbnumRefnos(
      fakeTree(), records, 7997, { onProgress: (p) => progress.push(p), taskPollIntervalMs: 0 }, api,
    );

    expect(api.ensureDbnum).toHaveBeenCalledTimes(1);
    expect(api.task).toHaveBeenCalledTimes(2);
    expect(api.dbnumRoots).toHaveBeenCalledTimes(1);
    // 服务端已经把该库生成完了，前端一根也不催
    expect(records.ensureAndCollect).not.toHaveBeenCalled();
    // 根清单是服务端口径的 a/b，进缓存前统一成 a_b
    expect(records.collectRoots.mock.calls[0]![0]).toEqual(['24381_145018', '24383_9']);

    expect(result.generationRoots).toEqual(['24381_145018', '24383_9']);
    expect(result.refnos).toEqual(['24381_1', '24381_2', '24383_1']);
    expect(result.sites.map((s) => s.refno)).toEqual(['24381_2', '24383_2']);
    expect(result.skippedSites).toEqual([]);
    expect(result.budgetLimited).toBe(false);

    expect(progress.map((p) => `${p.phase}:${p.rootsDone}/${p.rootsTotal}:${p.root ?? '-'}`)).toEqual([
      'generate:0/2:-',
      'generate:1/2:-',
      'generate:2/2:-',
      'roots:1/2:24381_145018',
      'roots:2/2:24383_9',
    ]);
    // 这一路不按 SITE 推进，进度里没有 SITE
    expect(progress.every((p) => p.site === null)).toBe(true);
    expect(dbnumServerEntrySupport(api)).toBe('yes');
  });

  it('旧服务端没有这条路由（404）：退回逐 SITE 老路，并记住——第二次整库显示不再白打一发', async () => {
    const records = fakeRecords({ '24381_2': { roots: ['24381_145018'], items: [item('24381_1', '24381_145018')] } });
    const api = legacyServerApi();
    const first = await collectDbnumRefnos(fakeTree(), records, 7997, {}, api);
    expect(first.refnos).toEqual(['24381_1']);
    expect(records.ensureAndCollect).toHaveBeenCalled();
    expect(dbnumServerEntrySupport(api)).toBe('no');

    await collectDbnumRefnos(fakeTree(), records, 7997, {}, api);
    expect(api.ensureDbnum).toHaveBeenCalledTimes(1);
  });

  it('这个库以 rocksdb 为准（409 指路 rebuild）：本次退回老路，但不把服务端记成「没有」——别的库仍可能是 memory 形态', async () => {
    const records = fakeRecords({ '24381_2': { roots: ['24381_145018'], items: [item('24381_1', '24381_145018')] } });
    const api = legacyServerApi();
    (api.ensureDbnum as ReturnType<typeof vi.fn>).mockImplementation(async () => { throw apiError('conflict', 409); });
    await collectDbnumRefnos(fakeTree(), records, 7997, {}, api);
    expect(records.ensureAndCollect).toHaveBeenCalled();
    expect(dbnumServerEntrySupport(api)).toBe('unknown');

    await collectDbnumRefnos(fakeTree(), records, 7997, {}, api);
    expect(api.ensureDbnum).toHaveBeenCalledTimes(2);
  });

  it('任务失败且一根都没成：抛错，不把「0 条记录」当成空库', async () => {
    const api = serverEntryApi({
      expectedRoots: 2,
      states: [{ state: 'failed', units_done: 0, result: { error: 'no credential' } }],
      roots: [],
    });
    await expect(
      collectDbnumRefnos(fakeTree(), fakeRecords(plan), 7997, { taskPollIntervalMs: 0 }, api),
    ).rejects.toThrow('no credential');
    expect(api.dbnumRoots).not.toHaveBeenCalled();
  });

  it('部分失败（partial）照常取记录；maxTotalRoots 有限值只切根清单，超出的记 truncatedRoots', async () => {
    const records = fakeRecords(plan);
    const api = serverEntryApi({
      expectedRoots: 2,
      states: [{ state: 'partial', units_done: 1 }],
      roots: ['24381/145018', '24383/9'],
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { taskPollIntervalMs: 0, maxTotalRoots: 1 }, api);
    expect(records.collectRoots.mock.calls[0]![0]).toEqual(['24381_145018']);
    expect(result.truncatedRoots).toEqual(['24383_9']);
    expect(result.budgetLimited).toBe(true);
    expect(result.refnos).toEqual(['24381_1', '24381_2']);
  });

  it('任务查不到（服务端重启过，任务只活在进程内）：不再等，按现状取记录', async () => {
    const records = fakeRecords(plan);
    const api = serverEntryApi({ expectedRoots: 2, states: [], roots: ['24381/145018'] });
    (api.task as ReturnType<typeof vi.fn>).mockImplementation(async () => { throw apiError('not_found', 404); });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { taskPollIntervalMs: 0 }, api);
    expect(result.generationRoots).toEqual(['24381_145018']);
    expect(result.refnos).toEqual(['24381_1', '24381_2']);
  });

  it('旧 §4.5.3 构建（roots 行没有 ready）：等终态整取，onRefnosReady 收尾时给一次、带全部构件', async () => {
    const records = fakeRecords(plan);
    const api = serverEntryApi({
      expectedRoots: 2,
      states: [{ state: 'succeeded', units_done: 2 }],
      roots: ['24381/145018', '24383/9'],
    });
    const batches: { roots: string[]; refnos: string[]; rootsDone: number; rootsTotal: number }[] = [];
    const result = await collectDbnumRefnos(
      fakeTree(), records, 7997, { taskPollIntervalMs: 0, onRefnosReady: (batch) => { batches.push(batch); } }, api,
    );
    expect(batches).toEqual([{ roots: ['24381_145018', '24383_9'], refnos: ['24381_1', '24381_2', '24383_1'], rootsDone: 2, rootsTotal: 2 }]);
    expect(result.refnos).toEqual(['24381_1', '24381_2', '24383_1']);
    // 探能力那一发回的就是全清单，收尾不再多打
    expect(api.dbnumRoots).toHaveBeenCalledTimes(1);
  });
});

/**
 * 实时（plan 2026-09-10 §12）：服务端 `roots` 认 `ready`——流水线每提交一片，那些根就绪；前端每拍问 `?ready=1`，
 * 新就绪的根立刻取记录并经 `onRefnosReady` 交给调用方，不等任务终态。
 */
describe('collectDbnumRefnos · 服务端整库入口 · 实时（roots 认 ready）', () => {
  type Tick = { state: string; units_done: number; ready: string[] };

  /** `roots?ready=1` 按当前拍回就绪子集（带 `ready:true` / `only_ready:true`）；不带 `ready` 回全清单并逐行标 `ready`。 */
  function liveServerApi(options: { allRoots: string[]; ticks: Tick[]; expectedRoots?: number }) {
    let poll = 0;
    const expectedRoots = options.expectedRoots ?? options.allRoots.length;
    const currentTick = () => options.ticks[Math.max(0, Math.min(poll - 1, options.ticks.length - 1))]!;
    const dbnumRoots = vi.fn(async (dbnum: number, opts?: { ready?: boolean }) => {
      const readyNow = new Set(currentTick().ready);
      const rows = options.allRoots.map((root) => ({ generation_root: root, noun: 'EQUI', name: root, ready: readyNow.has(root) }));
      const filtered = opts?.ready ? rows.filter((row) => row.ready) : rows;
      return { source: 'direct', dbnum, total: options.allRoots.length, ready_total: readyNow.size, only_ready: opts?.ready === true, roots: filtered };
    });
    return {
      ensureDbnum: vi.fn(async (dbnum: number) => ({
        task_id: `dbnum-model-ensure-${dbnum}-1`, dbnum, expected_roots: expectedRoots, state: 'queued',
        model_source: 'memory', model_source_reason: 'read-through', durable: false,
      })),
      task: vi.fn(async (taskId: string) => {
        poll += 1;
        const tick = currentTick();
        return { task_id: taskId, kind: 'dbnum_model_ensure', state: tick.state, units_done: tick.units_done, total_units: expectedRoots, result: null };
      }),
      dbnumRoots,
    } as unknown as DbnumServerEntryApi & { ensureDbnum: ReturnType<typeof vi.fn>; task: ReturnType<typeof vi.fn>; dbnumRoots: ReturnType<typeof vi.fn> };
  }

  const livePlan = {
    all: { items: [item('101_1', '101_1'), item('101_2', '101_1'), item('102_1', '102_1'), item('103_1', '103_1')] },
  };

  it('每拍只取新就绪的根、立刻回调装视口；终态前就有构件回调；收尾不重取', async () => {
    const records = fakeRecords(livePlan);
    const api = liveServerApi({
      allRoots: ['101/1', '102/1', '103/1'],
      ticks: [
        { state: 'running', units_done: 1, ready: ['101/1'] },
        { state: 'running', units_done: 2, ready: ['101/1', '102/1'] },
        { state: 'succeeded', units_done: 3, ready: ['101/1', '102/1', '103/1'] },
      ],
    });
    const progress: CollectDbnumProgress[] = [];
    const batches: { roots: string[]; refnos: string[]; rootsDone: number; rootsTotal: number }[] = [];
    const result = await collectDbnumRefnos(
      fakeTree(), records, 7997,
      { taskPollIntervalMs: 0, onProgress: (p) => progress.push(p), onRefnosReady: (batch) => { batches.push(batch); } },
      api,
    );

    expect(records.collectRoots.mock.calls.map((c) => c[0])).toEqual([['101_1'], ['102_1'], ['103_1']]);
    expect(records.ensureAndCollect).not.toHaveBeenCalled();
    expect(batches).toEqual([
      { roots: ['101_1'], refnos: ['101_1', '101_2'], rootsDone: 1, rootsTotal: 3 },
      { roots: ['102_1'], refnos: ['102_1'], rootsDone: 2, rootsTotal: 3 },
      { roots: ['103_1'], refnos: ['103_1'], rootsDone: 3, rootsTotal: 3 },
    ]);
    // 第一批构件在任务终态（generate 3/3）之前就回来了——这就是「实时」
    const flat = progress.map((p) => `${p.phase}:${p.rootsDone}/${p.rootsTotal}:${p.root ?? '-'}`);
    expect(flat.indexOf('roots:1/3:101_1')).toBeLessThan(flat.indexOf('generate:3/3:-'));
    expect(flat).toEqual([
      'generate:0/3:-',
      'generate:1/3:-', 'roots:1/3:101_1',
      'generate:2/3:-', 'roots:2/3:102_1',
      'generate:3/3:-', 'roots:3/3:103_1',
    ]);
    // 每拍一次 ?ready=1，收尾再拿一次全清单对账
    expect(api.dbnumRoots.mock.calls.map((c) => c[1]?.ready === true)).toEqual([true, true, true, false]);

    expect(result.generationRoots).toEqual(['101_1', '102_1', '103_1']);
    expect(result.refnos).toEqual(['101_1', '101_2', '102_1', '103_1']);
    expect(result.errors).toEqual({});
    expect(result.pending).toEqual([]);
    expect(result.budgetLimited).toBe(false);
    expect(dbnumServerEntrySupport(api)).toBe('yes');
  });

  it('服务端一根都没完成时不问 ready；partial 收口后仍没就绪的根记 errors、不去取它的 records', async () => {
    const records = fakeRecords(livePlan);
    const api = liveServerApi({
      allRoots: ['101/1', '102/1', '103/1'],
      ticks: [
        { state: 'running', units_done: 0, ready: [] },
        { state: 'partial', units_done: 2, ready: ['101/1', '102/1'] },
      ],
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { taskPollIntervalMs: 0 }, api);
    // 第一拍 units_done=0：没有就绪根可问；第二拍 + 收尾
    expect(api.dbnumRoots).toHaveBeenCalledTimes(2);
    expect(records.collectRoots.mock.calls.map((c) => c[0])).toEqual([['101_1', '102_1']]);
    expect(result.refnos).toEqual(['101_1', '101_2', '102_1']);
    expect(Object.keys(result.errors)).toEqual(['103_1']);
    expect(result.errors['103_1']).toContain('partial');
    expect(result.truncatedRoots).toEqual([]);
    expect(result.budgetLimited).toBe(false);
  });

  it('预算在批边界上判：构件到 maxRefnos 就不再取后面的根，其余根记 truncatedRoots、budgetLimited', async () => {
    const records = fakeRecords(livePlan);
    const api = liveServerApi({
      allRoots: ['101/1', '102/1', '103/1'],
      ticks: [
        { state: 'running', units_done: 1, ready: ['101/1'] },
        { state: 'running', units_done: 2, ready: ['101/1', '102/1'] },
        { state: 'succeeded', units_done: 3, ready: ['101/1', '102/1', '103/1'] },
      ],
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { taskPollIntervalMs: 0, maxRefnos: 2 }, api);
    // a 的两个构件用完预算；b 那一批取到了记录但构件被切掉；预算已尽，第三拍不再问 ready、也不取 c
    expect(records.collectRoots.mock.calls.map((c) => c[0])).toEqual([['101_1'], ['102_1']]);
    expect(api.dbnumRoots.mock.calls.map((c) => c[1]?.ready === true)).toEqual([true, true, false]);
    expect(result.refnos).toEqual(['101_1', '101_2']);
    expect(result.truncatedRoots).toEqual(['103_1']);
    expect(result.budgetLimited).toBe(true);

    const limitedRoots = fakeRecords(livePlan);
    const api2 = liveServerApi({
      allRoots: ['101/1', '102/1', '103/1'],
      ticks: [{ state: 'succeeded', units_done: 3, ready: ['101/1', '102/1', '103/1'] }],
    });
    const byRoots = await collectDbnumRefnos(fakeTree(), limitedRoots, 7997, { taskPollIntervalMs: 0, maxTotalRoots: 1 }, api2);
    expect(limitedRoots.collectRoots.mock.calls.map((c) => c[0])).toEqual([['101_1']]);
    expect(byRoots.truncatedRoots).toEqual(['102_1', '103_1']);
    expect(byRoots.budgetLimited).toBe(true);
  });

  it('超时未终态：已就绪的照常进视口，其余根记 pending', async () => {
    const records = fakeRecords(livePlan);
    const api = liveServerApi({
      allRoots: ['101/1', '102/1', '103/1'],
      ticks: [{ state: 'running', units_done: 1, ready: ['101/1'] }],
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { taskPollIntervalMs: 0, taskWaitTimeoutMs: 0 }, api);
    expect(records.collectRoots.mock.calls.map((c) => c[0])).toEqual([['101_1']]);
    expect(result.refnos).toEqual(['101_1', '101_2']);
    expect(result.pending).toEqual(['102_1', '103_1']);
    expect(result.errors).toEqual({});
  });
});
