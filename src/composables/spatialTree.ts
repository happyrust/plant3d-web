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
  SpatialTreeTubeNode,
  SpatialTreeUnitNode,
  SpatialTreeUnitTypeNode,
} from '@/api/genModelSpatialApi';
import type { SpatialQueryFullMatchSet, SpatialQuerySortBy } from '@/types/spatialQuery';

// ---- 直段（方案 B，2026-09-22；服务端 `tubes=1`）----

/**
 * 直段的身份键：`<单元 refno>#<from>-<to>#<ordinal>`——与服务端 `(BRAN, from, to, ordinal)` 四元组同一身份，拼成一个字串好当
 * Map 键 / 节点 id。直段没有 refno，**不进任何 refno 集**（`treeNodeRefnos` / `branUnitRefnosCoveredBy` 都不看它）；
 * 单元级动作已经带整条 BRAN（`deliveryUnitScene.ts`），直段行只是读出来、可定位。
 */
export function tubeKey(unitRefno: string, tube: Pick<SpatialTreeTubeNode, 'from' | 'to' | 'ordinal'>): string {
  return `${unitRefno}#${tube.from}-${tube.to}#${tube.ordinal}`;
}

/** 直段行的主标识：两端 noun「REDU → BEND」；读不出的一端画 `?`（容器头 / 尾那一端服务端给 `BRAN`）。 */
export function tubeLabel(tube: Pick<SpatialTreeTubeNode, 'from_noun' | 'to_noun'>): string {
  return `${tube.from_noun || '?'} → ${tube.to_noun || '?'}`;
}

/** 直管长度：< 1 m 用整 mm，≥ 1 m 两位小数的 m（去尾零）。 */
export function formatTubeLength(mm: number): string {
  if (!Number.isFinite(mm)) return '';
  if (mm < 1000) return `${Math.round(mm)} mm`;
  return `${(mm / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} m`;
}

/** 一个节点下已内联的全部直段（每条带所属单元；按身份键去重、保持树序）。`tubes` 缺的单元不算——与 `elements` 同一套内联规则。 */
export function treeNodeTubes(target: SpatialTreeActionNode): { unit: SpatialTreeUnitNode; tube: SpatialTreeTubeNode }[] {
  const seen = new Set<string>();
  const out: { unit: SpatialTreeUnitNode; tube: SpatialTreeTubeNode }[] = [];
  const pushUnit = (unit: SpatialTreeUnitNode) => {
    for (const tube of unit.tubes ?? []) {
      const key = tubeKey(unit.refno, tube);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ unit, tube });
    }
  };
  const pushSpec = (spec: SpatialTreeSpecNode) => {
    for (const group of spec.unit_types) for (const unit of group.units) pushUnit(unit);
  };
  switch (target.kind) {
    case 'room':
      for (const spec of target.node.specs) pushSpec(spec);
      break;
    case 'spec':
      pushSpec(target.node);
      break;
    case 'unitType':
      for (const unit of target.node.units) pushUnit(unit);
      break;
    case 'unit':
      pushUnit(target.node);
      break;
    case 'others':
    case 'otherNoun':
      break;
  }
  return out;
}

/** 计数句「N 个构件 · M 段直管」：服务端没给 `tube_count`（老构建 / 关着）就只说构件。 */
export function countPhrase(count: number, tubeCount: number | undefined): string {
  return typeof tubeCount === 'number' ? `${count} 个构件 · ${tubeCount} 段直管` : `${count} 个构件`;
}

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

/**
 * 一次节点动作「整个盖住」的 BRAN 单元 refno（去重，按树序）：动作的 refno 集包含了该单元已内联的全部叶子才算。
 * 单元级及以上的动作（单元 / 单元类型 / 专业 / 房间）天然满足；叶子行的眼睛不经这里。叶子未内联的单元不算（还不知道有哪些）。
 * 直管挂在 BRAN 自己的 refno 上（`deliveryUnitScene.ts`），调用方拿这份去把整条 BRAN 一起显隐 / 隔离；HANG / EQUI 没有直管，不给。
 */
export function branUnitRefnosCoveredBy(tree: SpatialTreeResult, refnos: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const refno of refnos) set.add(refno);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const room of tree.rooms) {
    for (const spec of room.specs) {
      for (const group of spec.unit_types) {
        if (group.noun !== 'BRAN') continue;
        for (const unit of group.units) {
          if (seen.has(unit.refno)) continue;
          const leaves = unit.elements;
          if (!Array.isArray(leaves) || leaves.length === 0) continue;
          if (!leaves.every((leaf) => set.has(leaf.refno))) continue;
          seen.add(unit.refno);
          out.push(unit.refno);
        }
      }
    }
  }
  return out;
}

/** 全树里的 BRAN 单元 refno（去重，按树序）——「全部显示 / 隐藏 / 隔离结果」把它们的直段一起带上。 */
export function branUnitRefnosOfTree(tree: SpatialTreeResult): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const room of tree.rooms) {
    for (const spec of room.specs) {
      for (const group of spec.unit_types) {
        if (group.noun !== 'BRAN') continue;
        for (const unit of group.units) {
          if (seen.has(unit.refno)) continue;
          seen.add(unit.refno);
          out.push(unit.refno);
        }
      }
    }
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
 * 把按 `unit=` / `other_noun=` 补回来的叶子合进已有的树：同一单元 refno / 同一 noun 组的 `elements` 用新响应里的填上
 * （单元的 `tubes` 跟 `elements` 一起来、一起填——同一套内联规则），别的节点不动。回一棵新树（不改入参）。
 */
export function mergeTreeLeaves(tree: SpatialTreeResult, partial: SpatialTreeResult): SpatialTreeResult {
  const unitLeaves = new Map<string, Pick<SpatialTreeUnitNode, 'elements' | 'tubes'>>();
  const otherLeaves = new Map<string, SpatialTreeLeafNode[]>();
  for (const room of partial.rooms) {
    for (const spec of room.specs) {
      for (const group of spec.unit_types) {
        for (const unit of group.units) {
          if (unit.elements) {
            unitLeaves.set(`${room.refno}|${unit.refno}`, { elements: unit.elements, ...(unit.tubes ? { tubes: unit.tubes } : {}) });
          }
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
            const filled = unitLeaves.get(`${room.refno}|${unit.refno}`);
            return filled ? { ...unit, ...filled } : unit;
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
