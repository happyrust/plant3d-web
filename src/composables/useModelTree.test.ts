import { describe, expect, it } from 'vitest';

import { aggregateCheckState, recomputeViewAncestors, type CheckState, type CheckStateGraph } from './useModelTree';

/** 用父 → 子表搭一张图；`parentsOf` 由子表反推，一个元素可以挂多个父（主位置 + 收录它的 GPSET）。 */
function graphOf(children: Record<string, string[]>, initial: Record<string, CheckState>) {
  const states = new Map(Object.entries(initial));
  const parents = new Map<string, string[]>();
  for (const [parent, kids] of Object.entries(children)) {
    for (const kid of kids) parents.set(kid, [...(parents.get(kid) ?? []), parent]);
  }
  const graph: CheckStateGraph = {
    parentsOf: (id) => parents.get(id) ?? [],
    childrenOf: (id) => children[id],
    stateOf: (id) => states.get(id),
    setState: (id, state) => {
      states.set(id, state);
    },
  };
  return { graph, states };
}

describe('aggregateCheckState', () => {
  it('全勾 / 全不勾 / 混合；没有状态的子节点按 checked 算，空表为 indeterminate', () => {
    const states: Record<string, CheckState> = { a: 'checked', b: 'unchecked', c: 'indeterminate' };
    const stateOf = (id: string) => states[id];
    expect(aggregateCheckState(['a', 'x'], stateOf)).toBe('checked');
    expect(aggregateCheckState(['b'], stateOf)).toBe('unchecked');
    expect(aggregateCheckState(['a', 'b'], stateOf)).toBe('indeterminate');
    expect(aggregateCheckState(['a', 'c'], stateOf)).toBe('indeterminate');
    expect(aggregateCheckState([], stateOf)).toBe('indeterminate');
  });
});

describe('recomputeViewAncestors（GPSET 二级成员的双位置聚合）', () => {
  // site ─ zone ─ { pipe, equi }；gpwl ─ gpset ─ { pipe（经 GPITEM 收录）, bran }
  const children = { site: ['zone'], zone: ['pipe', 'equi'], gpwl: ['gpset'], gpset: ['pipe', 'bran'] };

  it('取消勾选一个被收录的元素：主位置一条链和分组一条链都重算', () => {
    const { graph, states } = graphOf(children, {
      site: 'checked', zone: 'checked', equi: 'checked', gpwl: 'checked', gpset: 'checked', bran: 'checked', pipe: 'unchecked',
    });
    recomputeViewAncestors('pipe', graph);
    expect(states.get('zone')).toBe('indeterminate');
    expect(states.get('site')).toBe('indeterminate');
    expect(states.get('gpset')).toBe('indeterminate');
    expect(states.get('gpwl')).toBe('indeterminate');
  });

  it('分组的成员全不勾时分组与分组世界也不勾', () => {
    const { graph, states } = graphOf(children, {
      site: 'checked', zone: 'checked', equi: 'checked', gpwl: 'checked', gpset: 'checked', pipe: 'unchecked', bran: 'unchecked',
    });
    recomputeViewAncestors('bran', graph);
    expect(states.get('gpset')).toBe('unchecked');
    expect(states.get('gpwl')).toBe('unchecked');
  });

  it('分组互相收录成环（A ∋ B ∋ A）时也会收敛，不死循环', () => {
    const { graph, states } = graphOf({ a: ['b', 'x'], b: ['a'] }, { x: 'unchecked' });
    recomputeViewAncestors('x', graph);
    expect(states.get('a')).toBe('indeterminate');
    expect(states.get('b')).toBe('indeterminate');
  });
});
