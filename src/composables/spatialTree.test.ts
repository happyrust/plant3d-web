import { describe, expect, it } from 'vitest';

import {
  branUnitRefnosCoveredBy,
  branUnitRefnosOfTree,
  forEachTreeLeaf,
  fullMatchesFromTree,
  mergeTreeLeaves,
  treeNodeLeavesInline,
  treeNodeRefnos,
  treeToNearbyResult,
} from './spatialTree';

import type { SpatialTreeResult } from '@/api/genModelSpatialApi';

/** 两间房：R1 里 BRAN b1（两条）+ EQUI e1（一条）+ 其他构件 PANE 一条；R2 里 b1 的一条跨房构件。 */
function tree(overrides: Partial<SpatialTreeResult> = {}): SpatialTreeResult {
  return {
    success: true,
    total_count: 4,
    candidate_count: 5,
    truncated_candidates: false,
    candidate_cap: 200000,
    leaves_inline: true,
    leaf_cap: 5000,
    leaf_count: 5,
    inlined: null,
    delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
    center: { x: 1, y: 2, z: 3, source: 'refno_aabb_center' },
    radius: 3000,
    shape: 'sphere',
    room_status: { rooms: [{ refno: 'r1', room_num: 'R1' }, { refno: 'r2', room_num: 'R2' }], source: 'memory', matched: 4, unresolved: 0, definition_version: 'g', library_alignment_current: null },
    warnings: ['w1'],
    coverage: 'global-tree',
    spatial_state: 'ready',
    rooms: [
      {
        refno: 'r1',
        room_num: 'R1',
        name: '/R1',
        count: 4,
        specs: [
          {
            spec_value: 0,
            count: 1,
            unit_types: [],
            others: { count: 1, by_noun: [{ noun: 'PANE', count: 1, min_distance: 9, elements: [{ refno: 'p1', noun: 'PANE', distance: 9 }] }] },
          },
          {
            spec_value: 3,
            count: 3,
            unit_types: [
              { noun: 'BRAN', count: 2, units: [{ refno: 'b1', noun: 'BRAN', name: '/B1', count: 2, min_distance: 1, elements: [{ refno: 't1', noun: 'TUBI', distance: 1 }, { refno: 'x1', noun: 'ELBO', distance: 5, shared_rooms: 2 }] }] },
              { noun: 'EQUI', count: 1, units: [{ refno: 'e1', noun: 'EQUI', name: null, count: 1, min_distance: 2, elements: [{ refno: 'n1', noun: 'NOZZ', distance: 2 }] }] },
            ],
            others: { count: 0, by_noun: [] },
          },
        ],
      },
      {
        refno: 'r2',
        room_num: 'R2',
        name: null,
        count: 1,
        specs: [
          {
            spec_value: 3,
            count: 1,
            unit_types: [{ noun: 'BRAN', count: 1, units: [{ refno: 'b1', noun: 'BRAN', name: '/B1', count: 1, min_distance: 5, elements: [{ refno: 'x1', noun: 'ELBO', distance: 5, shared_rooms: 2 }] }] }],
            others: { count: 0, by_noun: [] },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('spatialTree（ADR 0068 纯函数）', () => {
  it('forEachTreeLeaf 走遍全树，跨房构件每间房各来一次并带所在专业与房间', () => {
    const seen: string[] = [];
    forEachTreeLeaf(tree(), (leaf, spec, room) => seen.push(`${room.room_num}/${spec}/${leaf.refno}`));
    expect(seen).toEqual(['R1/0/p1', 'R1/3/t1', 'R1/3/x1', 'R1/3/n1', 'R2/3/x1']);
  });

  it('treeNodeRefnos：各层节点下的构件去重、保持距离序；treeNodeLeavesInline 按 elements 是否都在', () => {
    const t = tree();
    const r1 = t.rooms[0]!;
    expect(treeNodeRefnos({ kind: 'room', node: r1 })).toEqual(['p1', 't1', 'x1', 'n1']);
    expect(treeNodeRefnos({ kind: 'spec', node: r1.specs[1]! })).toEqual(['t1', 'x1', 'n1']);
    expect(treeNodeRefnos({ kind: 'unitType', node: r1.specs[1]!.unit_types[0]! })).toEqual(['t1', 'x1']);
    expect(treeNodeRefnos({ kind: 'unit', node: r1.specs[1]!.unit_types[1]!.units[0]! })).toEqual(['n1']);
    expect(treeNodeRefnos({ kind: 'others', node: r1.specs[0]!.others })).toEqual(['p1']);
    expect(treeNodeRefnos({ kind: 'otherNoun', node: r1.specs[0]!.others.by_noun[0]! })).toEqual(['p1']);
    expect(treeNodeLeavesInline({ kind: 'room', node: r1 })).toBe(true);

    const stripped = tree();
    delete stripped.rooms[0]!.specs[1]!.unit_types[0]!.units[0]!.elements;
    const s1 = stripped.rooms[0]!;
    expect(treeNodeLeavesInline({ kind: 'unit', node: s1.specs[1]!.unit_types[0]!.units[0]! })).toBe(false);
    expect(treeNodeLeavesInline({ kind: 'unitType', node: s1.specs[1]!.unit_types[0]! })).toBe(false);
    expect(treeNodeLeavesInline({ kind: 'unitType', node: s1.specs[1]!.unit_types[1]! })).toBe(true);
    expect(treeNodeLeavesInline({ kind: 'spec', node: s1.specs[1]! })).toBe(false);
    expect(treeNodeLeavesInline({ kind: 'room', node: s1 })).toBe(false);
    expect(treeNodeRefnos({ kind: 'unitType', node: s1.specs[1]!.unit_types[0]! }), '未内联的单元没有 refno 可给').toEqual([]);
  });

  it('branUnitRefnosCoveredBy：动作的 refno 集把某间房下该 BRAN 单元列出的叶子全包住才算盖住，跨房单元只出一次；EQUI 不算；未内联的单元不算。branUnitRefnosOfTree 列全树 BRAN 单元', () => {
    const t = tree();
    // 单元级 / 更高层动作给的就是它名下全部叶子
    expect(branUnitRefnosCoveredBy(t, treeNodeRefnos({ kind: 'unit', node: t.rooms[0]!.specs[1]!.unit_types[0]!.units[0]! }))).toEqual(['b1']);
    expect(branUnitRefnosCoveredBy(t, treeNodeRefnos({ kind: 'room', node: t.rooms[0]! }))).toEqual(['b1']);
    // R2 下 b1 只列了跨房的 x1：在 R2 对它做单元动作也算盖住整条 BRAN
    expect(branUnitRefnosCoveredBy(t, ['x1'])).toEqual(['b1']);
    // 只给 t1：R1 下 b1 还有 x1 没盖住，R2 下 b1 没有 t1 → 不算
    expect(branUnitRefnosCoveredBy(t, ['t1'])).toEqual([]);
    // EQUI 单元没有直管，不给
    expect(branUnitRefnosCoveredBy(t, ['n1'])).toEqual([]);
    expect(branUnitRefnosCoveredBy(t, [])).toEqual([]);

    const stripped = tree();
    for (const room of stripped.rooms) for (const spec of room.specs) for (const group of spec.unit_types) for (const unit of group.units) delete unit.elements;
    expect(branUnitRefnosCoveredBy(stripped, ['t1', 'x1']), '叶子未内联：还不知道有哪些，不算盖住').toEqual([]);

    expect(branUnitRefnosOfTree(t)).toEqual(['b1']);
    expect(branUnitRefnosOfTree(stripped), '列单元不看叶子').toEqual(['b1']);
  });

  it('treeToNearbyResult：叶子按 refno 去重摊成一页、按请求排序、不分页；专业分组按去重数；facet 有就用 facet 的', () => {
    const byDistance = treeToNearbyResult(tree(), 'distanceAsc', null);
    expect(byDistance.results!.map((item) => [item.refno, item.spec_value, item.distance])).toEqual([
      ['t1', 3, 1],
      ['n1', 3, 2],
      ['x1', 3, 5],
      ['p1', 0, 9],
    ]);
    expect(byDistance).toMatchObject({ success: true, total_count: 4, returned_count: 4, page: 1, per_page: 4, has_more: false, candidate_count: 5, coverage: 'global-tree', warnings: ['w1'] });
    expect(byDistance.groups).toEqual([{ spec_value: 0, count: 1 }, { spec_value: 3, count: 3 }]);
    expect(byDistance.filter_options).toEqual({ nouns: [], spec_values: [{ value: 0, count: 1 }, { value: 3, count: 3 }] });
    expect(byDistance.dbnum_groups).toEqual([]);
    expect(byDistance.room_status?.matched).toBe(4);
    expect(byDistance.center).toEqual({ x: 1, y: 2, z: 3, source: 'refno_aabb_center' });

    const bySpec = treeToNearbyResult(tree(), 'specThenDistance', null);
    expect(bySpec.results!.map((item) => item.refno)).toEqual(['p1', 't1', 'n1', 'x1']);
    const byName = treeToNearbyResult(tree(), 'nameAsc', null);
    expect(byName.results!.map((item) => item.noun)).toEqual(['ELBO', 'NOZZ', 'PANE', 'TUBI']);

    const facets = treeToNearbyResult(tree(), 'distanceAsc', {
      success: true,
      filter_options: { nouns: [{ value: 'TUBI', count: 9 }], spec_values: [{ value: 3, count: 9 }] },
      dbnum_groups: [{ dbnum: 24381, count: 9 }],
    });
    expect(facets.filter_options?.nouns).toEqual([{ value: 'TUBI', count: 9 }]);
    expect(facets.dbnum_groups).toEqual([{ dbnum: 24381, count: 9 }]);
    expect(facets.groups, '专业分组仍按树的去重数，不用 facet 的').toEqual([{ spec_value: 0, count: 1 }, { spec_value: 3, count: 3 }]);

    // 叶子未内联：一页为空，专业分组退到各房间节点计数之和（跨房会重复，只作展示）
    const empty = tree({ leaves_inline: false });
    for (const room of empty.rooms) for (const spec of room.specs) { for (const g of spec.unit_types) for (const u of g.units) delete u.elements; for (const g of spec.others.by_noun) delete g.elements; }
    const capped = treeToNearbyResult(empty, 'distanceAsc', null);
    expect(capped.results).toEqual([]);
    expect(capped.total_count).toBe(4);
    expect(capped.per_page).toBe(1);
    expect(capped.groups).toEqual([{ spec_value: 0, count: 1 }, { spec_value: 3, count: 4 }]);
  });

  it('fullMatchesFromTree：整树去重当全集，按专业分桶，不截断', () => {
    expect(fullMatchesFromTree(tree())).toEqual({
      refnos: ['p1', 't1', 'x1', 'n1'],
      byDbnum: {},
      bySpecValue: { '0': ['p1'], '3': ['t1', 'x1', 'n1'] },
      total: 4,
      truncated: false,
      cap: null,
    });
  });

  it('mergeTreeLeaves：按 unit= / other_noun= 补回来的 elements 填进同一单元（每间房）/ 同一 noun 组，别的节点不动，不改入参', () => {
    const base = tree({ leaves_inline: false });
    for (const room of base.rooms) for (const spec of room.specs) { for (const g of spec.unit_types) for (const u of g.units) delete u.elements; for (const g of spec.others.by_noun) delete g.elements; }
    const partial = tree({ leaves_inline: false, inlined: 'unit:b1' });
    for (const room of partial.rooms) for (const spec of room.specs) { for (const g of spec.unit_types) for (const u of g.units) if (u.refno !== 'b1') delete u.elements; for (const g of spec.others.by_noun) delete g.elements; }

    const merged = mergeTreeLeaves(base, partial);
    expect(merged).not.toBe(base);
    expect(base.rooms[0]!.specs[1]!.unit_types[0]!.units[0]!.elements).toBeUndefined();
    expect(merged.rooms[0]!.specs[1]!.unit_types[0]!.units[0]!.elements?.map((leaf) => leaf.refno)).toEqual(['t1', 'x1']);
    expect(merged.rooms[1]!.specs[0]!.unit_types[0]!.units[0]!.elements?.map((leaf) => leaf.refno)).toEqual(['x1']);
    expect(merged.rooms[0]!.specs[1]!.unit_types[1]!.units[0]!.elements).toBeUndefined();
    expect(merged.rooms[0]!.specs[0]!.others.by_noun[0]!.elements).toBeUndefined();
    expect(merged.leaves_inline).toBe(false);

    const withNoun = tree({ leaves_inline: false, inlined: 'other_noun:PANE' });
    for (const room of withNoun.rooms) for (const spec of room.specs) for (const g of spec.unit_types) for (const u of g.units) delete u.elements;
    const merged2 = mergeTreeLeaves(merged, withNoun);
    expect(merged2.rooms[0]!.specs[0]!.others.by_noun[0]!.elements?.map((leaf) => leaf.refno)).toEqual(['p1']);
    expect(merged2.rooms[0]!.specs[1]!.unit_types[0]!.units[0]!.elements?.length, '上一轮补的单元叶子还在').toBe(2);
  });
});
