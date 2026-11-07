export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

export type TreeNode = {
  id: string
  refno?: string
  /** 显示名。有名字就是 NAME；gen-model-v1 下无名构件是 E3D 的整条默认全名（`ZONE 4 of SITE 2`） */
  name: string
  type: string
  parentId: string | null
  childrenIds: string[]
  /** 所属库号；只有 gen-model-v1 数据源给（plan 2026-09-06 P2-4），legacy 源没有这一格 */
  dbnum?: number
  /** 无名构件的短形态（`ZONE 4`），树默认显示它；有名字的构件、legacy 源没有这一格 */
  shortName?: string
  /**
   * 分组（GPWL / GPSET）在解析视图下收录的二级成员：子 id → 经由的 GPITEM（`a_b`；规则成员为 `null`）。
   * 成员自己的 `parentId` 仍是主位置；只有 gen-model-v1 的解析视图给这一格。
   */
  groupMemberVia?: Record<string, string | null>
  /** 分组里解析不出的成员槽数（GPREF 缺失 / 目标库不在 MDB / 目标不存在） */
  unresolvedCount?: number
  /** GPSET 的子节点仍是存储视图（老 gen-model 没认 `resolved=1`）：列的是 GPITEM 槽本身，行上提示「后端未支持分组解析」 */
  groupViewUnsupported?: boolean
}

export type FlatRow = {
  id: string
  refno?: string
  name: string
  type: string
  depth: number
  hasChildren: boolean
  /** 见 `TreeNode.dbnum`；行尾小徽标只在有值时画 */
  dbnum?: number
  /** 该行是不是一个库段的首行（父节点 dbnum 与本行不同 / 没有）；模型生成状态圆点只在库边界行画 */
  dbBoundary?: boolean
  /** 见 `TreeNode.shortName` */
  shortName?: string
  /** 分组收录的二级成员行：主位置在别处（见 `TreeNode.groupMemberVia`） */
  secondary?: boolean
  /** 二级成员行经由的 GPITEM（`a_b`）；规则成员没有 */
  via?: string
  /** 见 `TreeNode.unresolvedCount` */
  unresolvedCount?: number
  /** 见 `TreeNode.groupViewUnsupported` */
  groupViewUnsupported?: boolean
}

/** 一个父节点在 `recomputeViewAncestors` 里最多重算几次；正常的树 / 分组图一两次就收敛，超过即视为数据成环。 */
const MAX_RECOMPUTE_VISITS = 8;

/** 子节点勾选态 → 父节点聚合态；还没有状态的子节点按 `checked` 算（与按需加载的继承缺省一致），空表为 `indeterminate`。 */
export function aggregateCheckState(
  childIds: readonly string[],
  stateOf: (id: string) => CheckState | undefined,
): CheckState {
  let checkedCount = 0;
  let uncheckedCount = 0;
  for (const childId of childIds) {
    const state = stateOf(childId) || 'checked';
    if (state === 'indeterminate') return 'indeterminate';
    if (state === 'checked') checkedCount++;
    else uncheckedCount++;
  }
  if (uncheckedCount === 0 && checkedCount > 0) return 'checked';
  if (checkedCount === 0 && uncheckedCount > 0) return 'unchecked';
  return 'indeterminate';
}

export type CheckStateGraph = {
  /** 当前视图里的全部父节点：主位置之外，还有收录它的分组（GPSET） */
  parentsOf: (id: string) => readonly string[]
  /** 已加载的子节点；没加载过的父节点给 `undefined`，不参与重算 */
  childrenOf: (id: string) => readonly string[] | undefined
  stateOf: (id: string) => CheckState | undefined
  setState: (id: string, state: CheckState) => void
}

/**
 * 从 `id` 沿当前视图的**全部**父节点向上重算聚合态：主位置一条链，收录它的每个分组（GPSET → GPWL）各一条。
 * 父节点第一次算到时总是继续上推（与单父链逐级重算一致），之后只在聚合态变了时再推；数据成环时每个父节点
 * 最多重算 `MAX_RECOMPUTE_VISITS` 次就停。
 */
export function recomputeViewAncestors(id: string, graph: CheckStateGraph): void {
  const visits = new Map<string, number>();
  const queue: string[] = [id];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    for (const parentId of graph.parentsOf(cur)) {
      if (parentId === cur) {
        console.warn('[pdms-tree] recomputeParents detected self-parent, skipped:', { start: id, at: cur });
        continue;
      }
      const children = graph.childrenOf(parentId);
      if (!children) continue;
      const seen = visits.get(parentId) ?? 0;
      if (seen >= MAX_RECOMPUTE_VISITS) {
        console.warn('[pdms-tree] recomputeParents detected cycle, aborting:', { start: id, at: parentId });
        return;
      }
      visits.set(parentId, seen + 1);
      const next = aggregateCheckState(children, graph.stateOf);
      const changed = graph.stateOf(parentId) !== next;
      graph.setState(parentId, next);
      if (seen === 0 || changed) queue.push(parentId);
    }
  }
}

