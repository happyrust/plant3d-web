/**
 * 房间层级树的纯函数（ADR 0068；plan `docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md` §4.3）：
 * 服务端一次聚合的 房间 → 专业 → 最小交付单元类型 → 单元 → 构件 在前端只做三件事——摊平成 `nearby` 的一页交给
 * `useSpatialQuery.mergeResults` 原样接手、取某个节点下的全部 refno 供节点动作用、把 `unit=` / `other_noun=` 补回来的叶子
 * 合进已有的树。不碰 Vue，抽屉组件与 store 共用。
 */
import type {
  SpatialQueryFilterOptions as ApiSpatialQueryFilterOptions,
  SpatialQueryResult as ApiSpatialQueryResult,
  SpatialQueryResultItem as ApiSpatialQueryResultItem,
  SpatialTreeLeafNode,
  SpatialTreeOtherNounNode,
  SpatialTreeResult,
  SpatialTreeRoomNode,
  SpatialTreeSpecNode,
  SpatialTreeUnitNode,
  SpatialTreeUnitTypeNode,
} from '@/api/genModelSpatialApi';
import type { SpatialQueryFullMatchSet, SpatialQuerySortBy } from '@/types/spatialQuery';

/** 树里可以挂动作的节点：房间 / 专业 / 单元类型 / 单元 / 其他构件（整块）/ 其他构件里的一个 noun 组。 */
export type SpatialTreeActionNode =
  | { kind: 'room'; node: SpatialTreeRoomNode }
  | { kind: 'spec'; node: SpatialTreeSpecNode }
  | { kind: 'unitType'; node: SpatialTreeUnitTypeNode }
  | { kind: 'unit'; node: SpatialTreeUnitNode }
  | { kind: 'others'; node: SpatialTreeSpecNode['others'] }
  | { kind: 'otherNoun'; node: SpatialTreeOtherNounNode };

/** 遍历一个专业节点下的全部叶子（单元里的 + 其他构件里的）。 */
function forEachSpecLeaf(spec: SpatialTreeSpecNode, visit: (leaf: SpatialTreeLeafNode) => void): void {
  for (const group of spec.unit_types) {
    for (const unit of group.units) {
      for (const leaf of unit.elements ?? []) visit(leaf);
    }
  }
  for (const group of spec.others.by_noun) {
    for (const leaf of group.elements ?? []) visit(leaf);
  }
}

/** 遍历全树叶子；跨房构件在每间房下各来一次，调用方自己去重。 */
export function forEachTreeLeaf(
  tree: SpatialTreeResult,
  visit: (leaf: SpatialTreeLeafNode, specValue: number, room: SpatialTreeRoomNode) => void,
): void {
  for (const room of tree.rooms) {
    for (const spec of room.specs) {
      forEachSpecLeaf(spec, (leaf) => visit(leaf, spec.spec_value, room));
    }
  }
}

/** 某个节点下已内联的全部构件 refno（去重、保持距离序）。叶子未内联时为空——调用方先按选择器补叶子。 */
export function treeNodeRefnos(target: SpatialTreeActionNode): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (leaf: SpatialTreeLeafNode) => {
    if (seen.has(leaf.refno)) return;
    seen.add(leaf.refno);
    out.push(leaf.refno);
  };
  switch (target.kind) {
    case 'room':
      for (const spec of target.node.specs) forEachSpecLeaf(spec, push);
      break;
    case 'spec':
      forEachSpecLeaf(target.node, push);
      break;
    case 'unitType':
      for (const unit of target.node.units) for (const leaf of unit.elements ?? []) push(leaf);
      break;
    case 'unit':
      for (const leaf of target.node.elements ?? []) push(leaf);
      break;
    case 'others':
      for (const group of target.node.by_noun) for (const leaf of group.elements ?? []) push(leaf);
      break;
    case 'otherNoun':
      for (const leaf of target.node.elements ?? []) push(leaf);
      break;
  }
  return out;
}

/** 一个节点的叶子是不是都在（未内联的单元 / noun 组 `elements` 键不存在）。 */
export function treeNodeLeavesInline(target: SpatialTreeActionNode): boolean {
  switch (target.kind) {
    case 'room':
      return target.node.specs.every((spec) => treeNodeLeavesInline({ kind: 'spec', node: spec }));
    case 'spec':
      return target.node.unit_types.every((group) => treeNodeLeavesInline({ kind: 'unitType', node: group }))
        && treeNodeLeavesInline({ kind: 'others', node: target.node.others });
    case 'unitType':
      return target.node.units.every((unit) => Array.isArray(unit.elements));
    case 'unit':
      return Array.isArray(target.node.elements);
    case 'others':
      return target.node.by_noun.every((group) => Array.isArray(group.elements));
    case 'otherNoun':
      return Array.isArray(target.node.elements);
  }
}

function compareLeaves(sortBy: SpatialQuerySortBy): (a: ApiSpatialQueryResultItem, b: ApiSpatialQueryResultItem) => number {
  const byDistance = (a: ApiSpatialQueryResultItem, b: ApiSpatialQueryResultItem) =>
    (a.distance ?? 0) - (b.distance ?? 0) || a.refno.localeCompare(b.refno);
  if (sortBy === 'specThenDistance') {
    return (a, b) => a.spec_value - b.spec_value || byDistance(a, b);
  }
  if (sortBy === 'nameAsc') {
    return (a, b) => a.noun.localeCompare(b.noun) || a.refno.localeCompare(b.refno);
  }
  return byDistance;
}

/**
 * 树的叶子摊平成 legacy `nearby` 的「一页」（按 refno 去重、按请求的排序排、不分页），`mergeResults` 原样接手：
 * loaded / visible / 本地合并 / warnings 全部复用。`facets`（同参 `nearby` 只取 1 条拿到的 `filter_options` / 分组计数）
 * 有就并进去——树响应不再重复给 facet。
 */
export function treeToNearbyResult(
  tree: SpatialTreeResult,
  sortBy: SpatialQuerySortBy,
  facets: ApiSpatialQueryResult | null,
): ApiSpatialQueryResult {
  const byRefno = new Map<string, ApiSpatialQueryResultItem>();
  const specCounts = new Map<number, number>();
  forEachTreeLeaf(tree, (leaf, specValue) => {
    if (byRefno.has(leaf.refno)) return;
    byRefno.set(leaf.refno, {
      refno: leaf.refno,
      noun: leaf.noun,
      spec_value: specValue,
      distance: leaf.distance,
    });
    specCounts.set(specValue, (specCounts.get(specValue) ?? 0) + 1);
  });
  const results = Array.from(byRefno.values()).sort(compareLeaves(sortBy));
  const groups = tree.leaves_inline
    ? Array.from(specCounts.entries()).map(([spec_value, count]) => ({ spec_value, count })).sort((a, b) => a.spec_value - b.spec_value)
    : specGroupsFromTreeCounts(tree);
  const filterOptions: ApiSpatialQueryFilterOptions = facets?.filter_options ?? {
    nouns: [],
    spec_values: groups.map((group) => ({ value: group.spec_value, count: group.count })),
  };
  return {
    success: true,
    results,
    center: tree.center ?? undefined,
    radius: tree.radius,
    shape: tree.shape,
    total_count: tree.total_count,
    returned_count: results.length,
    page: 1,
    per_page: Math.max(1, results.length),
    has_more: false,
    candidate_count: tree.candidate_count,
    candidate_cap: tree.candidate_cap,
    truncated_candidates: tree.truncated_candidates,
    filter_options: filterOptions,
    groups,
    dbnum_groups: facets?.dbnum_groups ?? [],
    coverage: tree.coverage,
    spatial_state: tree.spatial_state,
    ...(tree.room_status ? { room_status: tree.room_status } : {}),
    ...(tree.warnings && tree.warnings.length > 0 ? { warnings: tree.warnings } : {}),
  };
}

/** 叶子未内联时按各房间专业节点的计数估专业分组（跨房构件会重复计，只作展示）。 */
function specGroupsFromTreeCounts(tree: SpatialTreeResult): { spec_value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const room of tree.rooms) {
    for (const spec of room.specs) {
      counts.set(spec.spec_value, (counts.get(spec.spec_value) ?? 0) + spec.count);
    }
  }
  return Array.from(counts.entries()).map(([spec_value, count]) => ({ spec_value, count })).sort((a, b) => a.spec_value - b.spec_value);
}

/** 叶子内联时整树就是全集：批量动作（全部显示 / 隔离 / 只加载未加载）按它作用。 */
export function fullMatchesFromTree(tree: SpatialTreeResult): SpatialQueryFullMatchSet {
  const refnos: string[] = [];
  const seen = new Set<string>();
  const bySpecValue: Record<string, string[]> = {};
  forEachTreeLeaf(tree, (leaf, specValue) => {
    if (seen.has(leaf.refno)) return;
    seen.add(leaf.refno);
    refnos.push(leaf.refno);
    (bySpecValue[String(specValue)] ??= []).push(leaf.refno);
  });
  return { refnos, byDbnum: {}, bySpecValue, total: tree.total_count, truncated: false, cap: null };
}

/**
 * 把按 `unit=` / `other_noun=` 补回来的叶子合进已有的树：同一单元 refno / 同一 noun 组的 `elements` 用新响应里的填上，
 * 别的节点不动。回一棵新树（不改入参）。
 */
export function mergeTreeLeaves(tree: SpatialTreeResult, partial: SpatialTreeResult): SpatialTreeResult {
  const unitLeaves = new Map<string, SpatialTreeLeafNode[]>();
  const otherLeaves = new Map<string, SpatialTreeLeafNode[]>();
  for (const room of partial.rooms) {
    for (const spec of room.specs) {
      for (const group of spec.unit_types) {
        for (const unit of group.units) {
          if (unit.elements) unitLeaves.set(`${room.refno}|${unit.refno}`, unit.elements);
        }
      }
      for (const group of spec.others.by_noun) {
        if (group.elements) otherLeaves.set(`${room.refno}|${spec.spec_value}|${group.noun}`, group.elements);
      }
    }
  }
  return {
    ...tree,
    rooms: tree.rooms.map((room) => ({
      ...room,
      specs: room.specs.map((spec) => ({
        ...spec,
        unit_types: spec.unit_types.map((group) => ({
          ...group,
          units: group.units.map((unit) => {
            const elements = unitLeaves.get(`${room.refno}|${unit.refno}`);
            return elements ? { ...unit, elements } : unit;
          }),
        })),
        others: {
          ...spec.others,
          by_noun: spec.others.by_noun.map((group) => {
            const elements = otherLeaves.get(`${room.refno}|${spec.spec_value}|${group.noun}`);
            return elements ? { ...group, elements } : group;
          }),
        },
      })),
    })),
  };
}
