import { describe, expect, it, vi } from 'vitest';

import {
  formatGroupFailures,
  formatSideEffectFailures,
  mergeRootRefnoWithVisibleRefnos,
  prepareBranLoadPlan,
  resolveShowDbnumOverride,
  runBranLoadPlan,
  type PreparedGroup,
  type VisibleInstsResult,
} from './multiBranLoadPlan';

/** 24381_* → 1，24383_* → 2；其它一律解析不出。 */
const DBNUM_BY_REF0: Readonly<Record<string, number>> = {
  '24381': 1,
  '24383': 2,
};

const resolveDbno = (refno: string): number | null => DBNUM_BY_REF0[refno.split('_')[0] ?? ''] ?? null;

const noVisible: VisibleInstsResult = { success: true, refnos: [] };
const noReason = async (): Promise<string | null> => null;

describe('mergeRootRefnoWithVisibleRefnos', () => {
  it('keeps the root first and normalizes slash / leading equals', () => {
    expect(mergeRootRefnoWithVisibleRefnos(' 24381/145018 ', ['=24381/200001'])).toEqual([
      '24381_145018',
      '24381_200001',
    ]);
  });

  it('de-duplicates when the root also shows up in the visible list', () => {
    expect(mergeRootRefnoWithVisibleRefnos('24381_145018', ['24381_145018', '24381_145018'])).toEqual([
      '24381_145018',
    ]);
  });
});

describe('prepareBranLoadPlan', () => {
  it('produces a single group for a single BRAN', async () => {
    const plan = await prepareBranLoadPlan(
      ['24381_145018'],
      resolveDbno,
      async () => ({ success: true, refnos: ['24381_200001', '24381_200002'] }),
      noReason,
    );

    expect(plan).toEqual({
      prepared: [
        { dbno: 1, refnos: ['24381_145018', '24381_200001', '24381_200002'], noGeometryReason: null },
      ],
      unresolved: [],
      hints: [],
      failures: [],
    });
  });

  it('splits cross-database BRANs and keeps each group inside its own dbnum', async () => {
    const visibleInsts = vi.fn(async (refno: string) => ({
      success: true,
      refnos: refno === '24381_145018'
        ? ['24381_200001']
        : refno === '24383_91813'
          ? ['24383_300001']
          : [],
    }));

    const plan = await prepareBranLoadPlan(
      ['24381_145018', '24383_91813'],
      resolveDbno,
      visibleInsts,
      noReason,
    );

    expect(plan.prepared).toEqual([
      { dbno: 1, refnos: ['24381_145018', '24381_200001'], noGeometryReason: null },
      { dbno: 2, refnos: ['24383_91813', '24383_300001'], noGeometryReason: null },
    ]);
    expect(plan.failures).toEqual([]);
    // 每组只查自己那一个 BRAN，不会把跨库的包塞进错误的库。
    expect(visibleInsts.mock.calls.map(([refno]) => refno)).toEqual(['24381_145018', '24383_91813']);
  });

  it('isolates a failing group so the other groups still get prepared', async () => {
    const plan = await prepareBranLoadPlan(
      ['24381_145018', '24383_91813'],
      resolveDbno,
      async (refno) => {
        if (refno.startsWith('24383_')) throw new Error('属性服务不可用');
        return { success: true, refnos: ['24381_200001'] };
      },
      noReason,
    );

    // 24383 那组的 visibleInsts 抛错只是回退成「只装根」，不拖累 24381。
    expect(plan.prepared).toEqual([
      { dbno: 1, refnos: ['24381_145018', '24381_200001'], noGeometryReason: null },
      { dbno: 2, refnos: ['24383_91813'], noGeometryReason: null },
    ]);
    expect(plan.failures).toEqual([]);
    expect(plan.hints).toEqual([
      '查询可见子实例失败（refno=24383_91813），已回退为仅加载根 refno',
    ]);
  });

  it('falls back to the root refno when visibleInsts throws, and reports a hint', async () => {
    const plan = await prepareBranLoadPlan(
      ['24381_145018'],
      resolveDbno,
      async () => { throw new Error('timeout'); },
      noReason,
    );

    expect(plan.prepared).toEqual([
      { dbno: 1, refnos: ['24381_145018'], noGeometryReason: null },
    ]);
    expect(plan.hints).toEqual(['查询可见子实例失败（refno=24381_145018），已回退为仅加载根 refno']);
    expect(plan.failures).toEqual([]);
  });

  it('records the no-geometry reason and a hint when visibleInsts succeeds with zero children', async () => {
    const plan = await prepareBranLoadPlan(
      ['24381_145018'],
      resolveDbno,
      async () => noVisible,
      async () => '该 BOX 尺寸为 0',
    );

    expect(plan.prepared).toHaveLength(1);
    expect(plan.prepared[0]?.noGeometryReason).toBe('该 BOX 尺寸为 0');
    expect(plan.hints[0]).toContain('可见子实例为 0（refno=24381_145018）');
    expect(plan.hints[0]).toContain('该 BOX 尺寸为 0');
  });

  it('treats success=false as a silent root-only load (missing BRAN is reported by the loader)', async () => {
    const plan = await prepareBranLoadPlan(
      ['24381_999999'],
      resolveDbno,
      async () => ({ success: false, refnos: [] }),
      noReason,
    );

    expect(plan.prepared).toEqual([
      { dbno: 1, refnos: ['24381_999999'], noGeometryReason: null },
    ]);
    expect(plan.hints).toEqual([]);
    expect(plan.failures).toEqual([]);
  });

  it('keeps loading a group when describeNoGeometry throws', async () => {
    const plan = await prepareBranLoadPlan(
      ['24381_145018'],
      resolveDbno,
      async () => noVisible,
      async () => { throw new Error('boom'); },
    );

    expect(plan.prepared).toEqual([
      { dbno: 1, refnos: ['24381_145018'], noGeometryReason: null },
    ]);
    expect(plan.failures).toEqual([]);
    expect(plan.hints[0]).toContain('可见子实例为 0');
  });

  it('collects BRANs whose dbnum cannot be resolved', async () => {
    const visibleInsts = vi.fn(async () => ({ success: true, refnos: [] as string[] }));
    const plan = await prepareBranLoadPlan(
      ['24381_145018', '99999_1', 'not-a-refno'],
      resolveDbno,
      visibleInsts,
      noReason,
    );

    expect(plan.prepared.map(group => group.dbno)).toEqual([1]);
    expect(plan.unresolved).toEqual(['99999_1', 'not-a-refno']);
    // 解析不出库号的 BRAN 根本不该发请求。
    expect(visibleInsts).toHaveBeenCalledTimes(1);
  });

  it('returns an empty plan for empty input', async () => {
    const plan = await prepareBranLoadPlan([], resolveDbno, async () => noVisible, noReason);
    expect(plan).toEqual({ prepared: [], unresolved: [], hints: [], failures: [] });
  });
});

describe('resolveShowDbnumOverride', () => {
  it('lets show_dbnum win for a single BRAN (legacy behaviour)', () => {
    expect(resolveShowDbnumOverride(7997, 1)).toBe(7997);
  });

  it('ignores show_dbnum for multi-BRAN loads so cross-database BRANs keep their own dbnum', () => {
    expect(resolveShowDbnumOverride(7997, 2)).toBeNull();
    expect(resolveShowDbnumOverride(7997, 3)).toBeNull();
  });

  it('passes null through unchanged', () => {
    expect(resolveShowDbnumOverride(null, 1)).toBeNull();
  });
});

describe('formatGroupFailures', () => {
  it('renders one line per failed group', () => {
    expect(formatGroupFailures([
      { dbno: 7997, refnos: ['24381_145018'], error: 'ECONNRESET' },
      { dbno: 7999, refnos: ['24383_91813', '24383_91814'], error: 'boom' },
    ])).toBe(
      'dbnum 7997（1 个 refno）失败：ECONNRESET；dbnum 7999（2 个 refno）失败：boom',
    );
  });

  it('returns an empty string when nothing failed', () => {
    expect(formatGroupFailures([])).toBe('');
  });
});

describe('runBranLoadPlan', () => {
  const groups: PreparedGroup[] = [
    { dbno: 1, refnos: ['24381_145018'], noGeometryReason: null },
    { dbno: 2, refnos: ['24383_91813'], noGeometryReason: null },
  ];

  it('loads groups one at a time, never in parallel', async () => {
    const order: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await runBranLoadPlan(groups, async (group) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(group.dbno);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return `db${group.dbno}`;
    });

    expect(order).toEqual([1, 2]);
    expect(maxInFlight).toBe(1);
    expect(result.succeeded).toEqual([
      { dbno: 1, refnos: ['24381_145018'], value: 'db1' },
      { dbno: 2, refnos: ['24383_91813'], value: 'db2' },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.sideEffectFailures).toEqual([]);
  });

  it('keeps loading the remaining groups when one throws', async () => {
    const result = await runBranLoadPlan(groups, async (group) => {
      if (group.dbno === 1) throw new Error('7997 的包坏了');
      return 'ok';
    });

    expect(result.succeeded).toEqual([
      { dbno: 2, refnos: ['24383_91813'], value: 'ok' },
    ]);
    expect(result.failures).toEqual([
      { dbno: 1, refnos: ['24381_145018'], error: '7997 的包坏了' },
    ]);
  });

  it('reports every group as failed when all of them throw', async () => {
    const result = await runBranLoadPlan(groups, async () => {
      throw new Error('backend down');
    });

    expect(result.succeeded).toEqual([]);
    expect(result.failures).toEqual([
      { dbno: 1, refnos: ['24381_145018'], error: 'backend down' },
      { dbno: 2, refnos: ['24383_91813'], error: 'backend down' },
    ]);
  });

  it('reports a non-Error throw as text', async () => {
    const result = await runBranLoadPlan(groups.slice(0, 1), async () => {
      throw 'plain string';
    });
    expect(result.failures).toEqual([
      { dbno: 1, refnos: ['24381_145018'], error: 'plain string' },
    ]);
  });

  it('fires onGroupStart before each group so progress stays observable', async () => {
    const started: number[] = [];
    await runBranLoadPlan(groups, async () => 'ok', {
      onGroupStart: group => started.push(group.dbno),
    });
    expect(started).toEqual([1, 2]);
  });

  it('does not fail a group when onGroupStart throws', async () => {
    const result = await runBranLoadPlan(groups, async () => 'ok', {
      onGroupStart: () => { throw new Error('log 坏了'); },
    });
    expect(result.succeeded).toHaveLength(2);
    expect(result.failures).toEqual([]);
    expect(result.sideEffectFailures).toEqual([]);
  });

  it('keeps a loaded group successful when its after-load side effect throws', async () => {
    // 几何已经在场景里了：收尾失败只能记 sideEffectFailures，不能把整组说成没装上。
    const result = await runBranLoadPlan(groups, async () => 'loaded', {
      afterGroupLoaded: (group) => {
        if (group.dbno === 1) throw new Error('auto-fit 失败');
      },
    });

    expect(result.succeeded.map(outcome => outcome.dbno)).toEqual([1, 2]);
    expect(result.failures).toEqual([]);
    expect(result.sideEffectFailures).toEqual([
      { dbno: 1, error: 'auto-fit 失败' },
    ]);
  });

  it('never runs the side effect for a group whose load threw', async () => {
    const sideEffects: number[] = [];
    const result = await runBranLoadPlan(groups, async (group) => {
      if (group.dbno === 1) throw new Error('boom');
      return 'ok';
    }, {
      afterGroupLoaded: (group) => sideEffects.push(group.dbno),
    });

    expect(sideEffects).toEqual([2]);
    expect(result.sideEffectFailures).toEqual([]);
  });

  it('returns empty results for an empty plan', async () => {
    expect(await runBranLoadPlan([], async () => 'ok')).toEqual({
      succeeded: [],
      failures: [],
      sideEffectFailures: [],
    });
  });
});

describe('formatSideEffectFailures', () => {
  it('says the group was loaded, only the wrap-up failed', () => {
    expect(formatSideEffectFailures([
      { dbno: 7997, error: 'auto-fit 失败' },
      { dbno: 7999, error: 'refreshSpatialIndex 失败' },
    ])).toBe(
      'dbnum 7997 已装载但收尾失败：auto-fit 失败；dbnum 7999 已装载但收尾失败：refreshSpatialIndex 失败',
    );
  });

  it('returns an empty string when nothing failed', () => {
    expect(formatSideEffectFailures([])).toBe('');
  });
});
