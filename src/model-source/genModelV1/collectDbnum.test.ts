import { describe, expect, it, vi } from 'vitest';

import { collectDbnumRefnos, listSitesOfDbnum, type CollectDbnumProgress } from './collectDbnum';

import type { EnsureAndCollectOptions, EnsureAndCollectResult } from './modelRecords';
import type { GenModelV1ModelRecordSource } from './modelRecordSource';
import type { TreeSource } from '../ports';
import type { GeomInstQuery } from '@/api/genModelV1Api';

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

function fakeRecords(plan: Record<string, Partial<EnsureAndCollectResult> & { roots?: string[] }>): GenModelV1ModelRecordSource & { ensureAndCollect: ReturnType<typeof vi.fn> } {
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
  return { ensureAndCollect } as unknown as GenModelV1ModelRecordSource & { ensureAndCollect: ReturnType<typeof vi.fn> };
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
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { onProgress: (p) => progress.push(p) });

    expect(records.ensureAndCollect).toHaveBeenCalledTimes(2);
    expect(records.ensureAndCollect.mock.calls.map((c) => c[0])).toEqual(['24381_2', '24383_2']);
    // 每个 SITE 的 ensure 上限比单节点显示宽；records 预算 = 缺省 200 减去已收的根
    expect(records.ensureAndCollect.mock.calls[0]![1]).toMatchObject({ maxRoots: 4096, maxContainerDepth: 4, maxRecordsRoots: 200 });
    expect(records.ensureAndCollect.mock.calls[1]![1]).toMatchObject({ maxRecordsRoots: 198 });

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
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { maxRefnos: 2 });
    expect(records.ensureAndCollect).toHaveBeenCalledTimes(1);
    expect(result.refnos).toEqual(['24381_1', '24381_2']);
    expect(result.skippedSites).toEqual(['24383_2']);
    expect(result.budgetLimited).toBe(true);
  });

  it('安全概览预算 maxTotalRoots：跨 SITE 累计，一个 SITE 里超出的根记 truncatedRoots、后面的 SITE 整个跳过；Infinity = 全量', async () => {
    const plan = {
      '24381_2': { roots: ['r1', 'r2', 'r3'], items: [item('24381_1', 'r1'), item('24381_2', 'r2'), item('24381_3', 'r3')] },
      '24383_2': { roots: ['r4'], items: [item('24383_1', 'r4')] },
    };
    const limited = await collectDbnumRefnos(fakeTree(), fakeRecords(plan), 7997, { maxTotalRoots: 2 });
    expect(limited.generationRoots).toEqual(['r1', 'r2']);
    expect(limited.refnos).toEqual(['24381_1', '24381_2']);
    expect(limited.truncatedRoots).toEqual(['r3']);
    expect(limited.skippedSites).toEqual(['24383_2']);
    expect(limited.budgetLimited).toBe(true);

    const records = fakeRecords(plan);
    const full = await collectDbnumRefnos(fakeTree(), records, 7997, { maxTotalRoots: Number.POSITIVE_INFINITY });
    expect(records.ensureAndCollect.mock.calls[0]![1]).toMatchObject({ maxRecordsRoots: undefined });
    expect(full.generationRoots).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(full.budgetLimited).toBe(false);
  });

  it('库里没有 SITE：不 ensure，回空', async () => {
    const records = fakeRecords({});
    const result = await collectDbnumRefnos(fakeTree(), records, 4242);
    expect(records.ensureAndCollect).not.toHaveBeenCalled();
    expect(result.sites).toEqual([]);
    expect(result.refnos).toEqual([]);
  });
});
