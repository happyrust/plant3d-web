import { describe, expect, it, vi } from 'vitest';

import { useNodeVersionTimeline } from './useNodeVersionTimeline';

import type { ModelAttributeHistory, ModelElementVersionTimeline, ModelVersionImpactKind } from '@/model-source';

/**
 * `useNodeVersionTimeline`（版本对比审核计划 P2-2 从面板抽出的时间线那一半）：缺省范围 / 缺省 A-B、切范围保留 A-B、
 * 选边前先收三维对比、手填校验、徽章按范围取列。并表 / 筛行 / 切片本身在 `utils/nodeVersionTimeline.test.ts`，这里不重复。
 */

function timelineOf(
  refno: string,
  unitRefno: string | null,
  rows: [sesno: number, self: ModelVersionImpactKind | null, unit: ModelVersionImpactKind | null][],
  unitColumnOnly = false,
): ModelElementVersionTimeline {
  return {
    dbnum: 8000,
    refno,
    noun: 'BRAN',
    unitRefno,
    unitNoun: unitRefno ? 'BRAN' : null,
    versions: rows.map(([sesno, elementImpact, unitImpact]) => ({ sesno, sessionTime: `2026-09-${String(sesno).padStart(2, '0')}T00:00:00Z`, elementImpact, unitImpact })),
    unitColumnOnly,
  };
}

function historyOf(refno: string, sesnos: number[]): ModelAttributeHistory {
  return {
    dbnum: 8000,
    refno,
    noun: 'BRAN',
    unitRefno: refno,
    unitNoun: 'BRAN',
    entries: sesnos.map((sesno) => ({
      sesno,
      sessionTime: null,
      user: 'u',
      comment: '',
      kind: 'modified',
      impact: 'noop',
      changedCount: 1,
      changes: [],
      members: null,
      owner: null,
      attributesUnavailable: null,
    })),
  };
}

describe('useNodeVersionTimeline', () => {
  it('setNode：单元根有成员 → 缺省「所有子节点」，A / B = 范围内最近两版；叶子 → 「仅自身」', () => {
    const state = useNodeVersionTimeline();
    state.setNode({ timeline: timelineOf('1_1', '1_1', [[10, 'mesh', 'mesh'], [12, null, 'mesh'], [15, 'noop', 'placement']]), history: null, nodeVersions: null, hasMembers: true });
    expect(state.scope.value).toBe('subtree');
    expect(state.beforeSesno.value).toBe(12);
    expect(state.afterSesno.value).toBe(15);
    expect(state.pairReady.value).toBe(true);
    expect(state.queriedIsUnitRoot.value).toBe(true);
    expect(state.hasUnit.value).toBe(true);
    expect(state.counts.value).toEqual({ versions: 3, attributeOnly: 0 });

    const leaf = useNodeVersionTimeline();
    leaf.setNode({ timeline: timelineOf('1_2', '1_1', [[10, 'mesh', 'mesh'], [12, null, 'mesh'], [15, 'placement', 'placement']]), history: null, nodeVersions: null, hasMembers: false });
    expect(leaf.scope.value).toBe('self');
    // 「仅自身」只数左列非空的：10 / 15
    expect(leaf.beforeSesno.value).toBe(10);
    expect(leaf.afterSesno.value).toBe(15);
    expect(leaf.queriedIsUnitRoot.value).toBe(false);
    expect(leaf.queriedElementRefno.value).toBe('1_2');
  });

  it('setScope：切范围不重选 A / B（Q9 a），叶子切不到「所有子节点」，切完回调 afterScopeChange', () => {
    const afterScopeChange = vi.fn();
    const state = useNodeVersionTimeline({ afterScopeChange });
    state.setNode({ timeline: timelineOf('1_1', '1_1', [[10, 'mesh', 'mesh'], [12, null, 'mesh'], [15, 'noop', 'placement']]), history: null, nodeVersions: null, hasMembers: true });
    state.setScope('self');
    expect(state.scope.value).toBe('self');
    expect([state.beforeSesno.value, state.afterSesno.value]).toEqual([12, 15]);
    // 12 在「仅自身」里不算变过：行还在（被选中），但灰掉
    expect(state.visibleRows.value.find((row) => row.sesno === 12)?.inScope).toBe(false);
    expect(afterScopeChange).toHaveBeenCalledTimes(1);
    state.setScope('self');
    expect(afterScopeChange).toHaveBeenCalledTimes(1);

    const leaf = useNodeVersionTimeline({ afterScopeChange });
    leaf.setNode({ timeline: timelineOf('1_2', '1_1', [[10, 'mesh', 'mesh'], [15, 'placement', 'placement']]), history: null, nodeVersions: null, hasMembers: false });
    leaf.setScope('subtree');
    expect(leaf.scope.value).toBe('self');
  });

  it('pickSide / 与上一版比 / 与最新比：换了才先收三维对比（beforePairChange），没换不收', () => {
    const beforePairChange = vi.fn();
    const state = useNodeVersionTimeline({ beforePairChange });
    state.setNode({ timeline: timelineOf('1_1', '1_1', [[10, 'mesh', 'mesh'], [12, null, 'mesh'], [15, 'noop', 'placement']]), history: null, nodeVersions: null, hasMembers: true });
    state.pickSide('a', 10);
    expect([state.beforeSesno.value, state.afterSesno.value]).toEqual([10, 15]);
    expect(beforePairChange).toHaveBeenCalledTimes(1);
    // 再选同一版：什么都不动
    state.pickSide('a', 10);
    expect(beforePairChange).toHaveBeenCalledTimes(1);
    // 把 B 选到 A 之前：两端摆正
    state.pickSide('b', 12);
    expect([state.beforeSesno.value, state.afterSesno.value]).toEqual([10, 12]);
    expect(beforePairChange).toHaveBeenCalledTimes(2);
    state.compareWithLatest();
    expect([state.beforeSesno.value, state.afterSesno.value]).toEqual([10, 15]);
    state.compareWithPrevious();
    expect([state.beforeSesno.value, state.afterSesno.value]).toEqual([12, 15]);
    expect(beforePairChange).toHaveBeenCalledTimes(4);
  });

  it('applyManualPair：填错回文案、不动两端；填对按新旧摆正、不走 beforePairChange（容器兜底）', () => {
    const beforePairChange = vi.fn();
    const state = useNodeVersionTimeline({ beforePairChange });
    state.setNode({ timeline: timelineOf('2_1', null, [[7, 'noop', null]]), history: null, nodeVersions: null, hasMembers: null });
    expect(state.hasUnit.value).toBe(false);
    state.manualA.value = '9';
    state.manualB.value = '9';
    expect(state.applyManualPair()).toBe('手填的 A / B 要是两个不同的会话号');
    state.manualB.value = 'x';
    expect(state.applyManualPair()).toBe('手填的 A / B 要是两个不同的会话号');
    state.manualA.value = '30';
    state.manualB.value = '12';
    expect(state.applyManualPair()).toBeNull();
    expect([state.beforeSesno.value, state.afterSesno.value]).toEqual([12, 30]);
    expect(beforePairChange).not.toHaveBeenCalled();
  });

  it('徽章按范围取列、「仅属性」只在版本表没算成一版时；reset 清空；sessionTimeOf 从并起来的行里取', () => {
    const state = useNodeVersionTimeline();
    state.setNode({
      timeline: timelineOf('1_1', '1_1', [[10, 'mesh', 'mesh'], [12, null, 'placement']]),
      history: historyOf('1_1', [12, 13]),
      nodeVersions: null,
      hasMembers: true,
    });
    const row12 = state.rows.value.find((row) => row.sesno === 12)!;
    const row13 = state.rows.value.find((row) => row.sesno === 13)!;
    expect(state.rowImpact(row12)).toBe('placement');
    expect(state.attributeOnlyShown(row13)).toBe(true);
    expect(state.attributeOnlyShown(row12)).toBe(false);
    expect(state.counts.value).toEqual({ versions: 2, attributeOnly: 1 });
    state.setScope('self');
    expect(state.rowImpact(row12)).toBe('noop');
    expect(state.sessionTimeOf(10)).toBe('2026-09-10T00:00:00Z');
    expect(state.sessionTimeOf(99)).toBeNull();
    state.timelineExpanded.value = true;
    state.reset();
    expect(state.rows.value).toEqual([]);
    expect(state.beforeSesno.value).toBeNull();
    expect(state.timelineExpanded.value).toBe(false);
    expect(state.pairReady.value).toBe(false);
  });
});
