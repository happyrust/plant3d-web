import { describe, expect, it, vi } from 'vitest';

import {
  collectDbnumRefnos,
  DEFAULT_DBNUM_REFNOS_BUDGET,
  DEFAULT_DBNUM_ROOTS_BUDGET,
  listSitesOfDbnum,
} from './collectDbnum';

import type { CollectRecordsResult } from './modelRecords';
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

function fakeRecords(plan: Record<string, Partial<CollectRecordsResult> & { items?: GeomInstQuery[] }>): GenModelV1ModelRecordSource & {
  collectByAncestor: ReturnType<typeof vi.fn>;
  generateThenCollect: ReturnType<typeof vi.fn>;
} {
  const collectByAncestor = vi.fn(async (refno: string, options: { onRootDone?: (p: { done: number; total: number; root: string }) => void } = {}) => {
    const entry = plan[refno] ?? {};
    const roots = entry.generationRoots ?? [];
    roots.forEach((root, index) => options.onRootDone?.({ done: index + 1, total: Math.max(1, roots.length), root }));
    if (roots.length === 0) options.onRootDone?.({ done: 1, total: 1, root: refno });
    return {
      refno,
      generationRoots: roots,
      items: entry.items ?? [],
      pending: entry.pending ?? [],
      empty: entry.empty ?? (entry.items?.length ? [] : [refno]),
      truncatedRoots: entry.truncatedRoots ?? [],
      errors: entry.errors ?? {},
      statuses: {},
    };
  });
  const generateThenCollect = vi.fn();
  return { collectByAncestor, generateThenCollect } as unknown as GenModelV1ModelRecordSource & {
    collectByAncestor: ReturnType<typeof vi.fn>;
    generateThenCollect: ReturnType<typeof vi.fn>;
  };
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
  it('display_never_generates：该库 SITE 串行按祖先查，不调用 generateThenCollect', async () => {
    const records = fakeRecords({
      '24381_2': { generationRoots: ['24381_10'], items: [item('24381_11', '24381_10'), item('24381_12', '24381_10')], empty: [] },
      '24383_2': { generationRoots: ['24383_20'], items: [item('24383_21', '24383_20')], pending: ['24383_2'], empty: [], errors: { '24383_9': 'boom' } },
    });
    const ready: string[][] = [];
    const phases: string[] = [];
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, {
      onRefnosReady: (batch) => { ready.push(batch.refnos); },
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(records.generateThenCollect).not.toHaveBeenCalled();
    expect(records.collectByAncestor).toHaveBeenCalledTimes(2);
    expect(records.collectByAncestor.mock.calls.map((call) => call[0])).toEqual(['24381_2', '24383_2']);
    expect(result.refnos).toEqual(['24381_11', '24381_12', '24383_21']);
    expect(result.generationRoots).toEqual(['24381_10', '24383_20']);
    expect(result.pending).toEqual(['24383_2']);
    expect(result.errors).toEqual({ '24383_9': 'boom' });
    expect(ready).toEqual([['24381_11', '24381_12'], ['24383_21']]);
    expect(phases).toEqual(['sites', 'roots', 'sites', 'roots']);
    expect(DEFAULT_DBNUM_ROOTS_BUDGET).toBe(Number.POSITIVE_INFINITY);
    expect(DEFAULT_DBNUM_REFNOS_BUDGET).toBe(50_000);
  });

  it('查空的 SITE 记 empty，不生成', async () => {
    const records = fakeRecords({
      '24381_2': { items: [], empty: ['24381_2'] },
      '24383_2': { items: [], empty: ['24383_2'] },
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997);
    expect(result.refnos).toEqual([]);
    expect(result.empty).toEqual(['24381_2', '24383_2']);
    expect(records.generateThenCollect).not.toHaveBeenCalled();
  });

  it('构件预算用尽后剩下的 SITE 记 skippedSites', async () => {
    const records = fakeRecords({
      '24381_2': { generationRoots: ['24381_10'], items: [item('24381_11', '24381_10'), item('24381_12', '24381_10')], empty: [] },
      '24383_2': { generationRoots: ['24383_20'], items: [item('24383_21', '24383_20')], empty: [] },
    });
    const result = await collectDbnumRefnos(fakeTree(), records, 7997, { maxRefnos: 1 });
    expect(result.refnos).toEqual(['24381_11']);
    expect(result.budgetLimited).toBe(true);
    expect(result.skippedSites).toEqual(['24383_2']);
    expect(records.collectByAncestor).toHaveBeenCalledTimes(1);
  });
});
