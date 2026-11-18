/**
 * 「取最新」（E3D 的 GETWORK）里模型树这一半：把**已经取过子节点的层**重取一遍，和树上现有的对账。
 *
 * 为什么要有这个：`usePdmsOwnerTree.ensureChildrenLoaded` 对取过子节点的父节点直接返回，一层取过就再也不会重取——
 * 后台（或别人在 E3D 里）新增、删除、改名、挪位置之后，树上看不到（2026-11-12 分析，
 * `docs/investigation/incremental-update-frontend-sync-2026-11-12.md` 第 3 节）。
 *
 * 这个文件只管对账，不发请求、不碰 Vue 状态：
 * - `reconcileTreeLayers`（纯函数）：现有的树 + 这一轮各层的答复 → 新的树 + 一份「动了什么」的回执；
 * - `fetchTreeLayerAnswers`：有上限地并发取各层（取数函数由调用方给）；
 * - `classifyDisappearedNodes`：从树上消失的节点到底是被删了，还是挪到了树上还没展开的位置。
 *
 * 规则（与第一次取子节点 `ensureChildrenLoaded` 同一套，只是不覆盖已有节点的状态）：
 * - 只对账取过子节点的层，没取过的不白取——它们第一次展开时自然拿到最新的；
 * - 新节点的勾选态继承父节点（父节点未勾选 → 未勾选，否则勾选）；已有节点的勾选、展开、选中原样留着；
 * - 一层没取到（网络错、超时）就保持原样、记进回执，不当成「子节点都没了」；
 * - 从根出发走不到的节点从树上撤掉，连同它的展开、选中、勾选、子节点数这些记录一起清掉；
 *   挪位置的节点只要新位置那一层已经在树上，它自己的状态都留着。
 */
import type { TreeNodeDto } from '@/api/genModelE3dTypes';
import type { CheckState, TreeNode } from '@/composables/useModelTree';

import { aggregateCheckState, recomputeViewAncestors } from '@/composables/useModelTree';

/** 一层重取的答复。`gone`：这一层的节点自己在库文件最新会话上已经不存在（树接口回 404）。 */
export type TreeLayerAnswer =
  | { ok: true; children: readonly TreeNodeDto[]; unresolvedCount: number; view?: string | null }
  | { ok: false; gone: boolean; error: string };

/** 对账要读的树状态（都是只读的，对账不就地改） */
export type TreeRefreshState = {
  nodesById: Readonly<Record<string, TreeNode>>;
  rootIds: readonly string[];
  /** 取过子节点的层（父节点 id） */
  loadedLayers: ReadonlySet<string>;
  expandedIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  checkStateById: ReadonlyMap<string, CheckState>;
  childrenCountById: ReadonlyMap<string, number | null>;
  /** 子 → 当前视图里的父节点集（解析视图下一个元素可以同时挂在主位置和收录它的分组下） */
  viewParentsById: ReadonlyMap<string, ReadonlySet<string>>;
};

export type TreeRefreshDeps = {
  /** refno → 树内部用的 key（`a_b`） */
  normalizeId: (refno: string) => string;
  /** 接口的节点 → 树节点（与第一次取子节点用同一个） */
  toNode: (dto: TreeNodeDto, parentId: string | null) => TreeNode;
};

export type TreeRefreshChange = { id: string; name: string; type: string; dbnum: number | null };

/** 从树上消失的节点的下落：`deleted` 库里已经没有；`relocated` 还在库里，挪到了树上还没展开的位置；`unknown` 没问到 */
export type DisappearedFate = 'deleted' | 'relocated' | 'unknown';

export type TreeRefreshReport = {
  /** 这一轮要对账的层数 */
  layersRequested: number;
  /** 取到并对过账的层数 */
  layersRefreshed: number;
  /** 没取到、保持原样的层（它的节点还在树上的才算；节点自己被撤掉的不算失败） */
  layersFailed: { id: string; name: string; error: string }[];
  added: TreeRefreshChange[];
  /** 从树上消失的节点里最上面的那些（它们名下一起消失的后代不逐个列） */
  removed: (TreeRefreshChange & { fate: DisappearedFate })[];
  /** 消失的节点总数（含后代） */
  removedNodeCount: number;
  /** 每个消失的节点 → 它属于 `removed` 里的哪一个（自己就是最上面的那个时指向自己） */
  removedUnder: Record<string, string>;
  renamed: (TreeRefreshChange & { previousName: string; previousType: string })[];
  /** 在树上换了父节点的（新旧位置都在树上） */
  moved: (TreeRefreshChange & { from: string | null; to: string })[];
  /** 原来选中、这一轮从树上消失的节点 */
  droppedSelection: string[];
  /** 树上有没有任何变化（含同一层里只是顺序变了） */
  changed: boolean;
};

export type TreeRefreshResult = {
  nodesById: Record<string, TreeNode>;
  loadedLayers: Set<string>;
  expandedIds: Set<string>;
  selectedIds: Set<string>;
  checkStateById: Map<string, CheckState>;
  childrenCountById: Map<string, number | null>;
  viewParentsById: Map<string, Set<string>>;
  /** 新进树的节点要回放到场景的可见性（与第一次取子节点同一个动作） */
  show: string[];
  hide: string[];
  /** 这一轮里「自己那一层回 404」的节点：它们确定已经不在库里 */
  goneLayers: Set<string>;
  report: TreeRefreshReport;
};

/**
 * 树接口对「库文件最新会话上没有这个节点」的答复。gen-model 回 404 `{"code":"not_found"}`
 * （2026-11-12 现网实测：`tree/children?refno=24384/26716` → `dbnum 8000 会话 Some(1155) 的索引里没有 24384/26716`），
 * 数据源把它折成 `not_found (404): …`。别的失败（网络、超时、5xx）都不算。
 */
export function isTreeNodeGoneMessage(message: string | null | undefined): boolean {
  return /^not_found\b/.test(String(message ?? '').trim());
}

function changeOf(node: TreeNode): TreeRefreshChange {
  return { id: node.id, name: node.name, type: node.type, dbnum: typeof node.dbnum === 'number' ? node.dbnum : null };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 从根出发沿 `childrenIds` 走得到的节点 */
function reachableFrom(rootIds: readonly string[], nodes: Readonly<Record<string, TreeNode>>): Set<string> {
  const seen = new Set<string>();
  const stack = rootIds.filter((id) => !!nodes[id]);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const childId of nodes[id]?.childrenIds ?? []) {
      if (!seen.has(childId) && nodes[childId]) stack.push(childId);
    }
  }
  return seen;
}

/**
 * 对账（纯函数）：`answers` 是这一轮各层重取的答复（层 id → 答复）。不在 `answers` 里的层原样不动。
 * 回执里 `removed[].fate` 这里只能定出「自己那一层回 404」的（`deleted`），其余先记 `unknown`，
 * 由 `classifyDisappearedNodes` 再问。
 */
export function reconcileTreeLayers(
  state: TreeRefreshState,
  answers: ReadonlyMap<string, TreeLayerAnswer>,
  deps: TreeRefreshDeps,
): TreeRefreshResult {
  const nodes: Record<string, TreeNode> = { ...state.nodesById };
  const checks = new Map(state.checkStateById);
  const counts = new Map(state.childrenCountById);
  const viewParents = new Map<string, Set<string>>();
  for (const [childId, parents] of state.viewParentsById) viewParents.set(childId, new Set(parents));
  const reachableBefore = reachableFrom(state.rootIds, state.nodesById);

  const added = new Map<string, TreeRefreshChange>();
  const renamed = new Map<string, TreeRefreshChange & { previousName: string; previousType: string }>();
  const moved = new Map<string, TreeRefreshChange & { from: string | null; to: string }>();
  const failed: { id: string; error: string }[] = [];
  const goneLayers = new Set<string>();
  const refreshedOk = new Set<string>();
  /** 子节点表变了的层：勾选聚合要重算 */
  const touched = new Set<string>();
  const show: string[] = [];
  const hide: string[] = [];
  let layersRequested = 0;

  const linkViewParent = (childId: string, parentId: string) => {
    let parents = viewParents.get(childId);
    if (!parents) {
      parents = new Set();
      viewParents.set(childId, parents);
    }
    parents.add(parentId);
  };

  for (const [layerId, answer] of answers) {
    const parent = nodes[layerId];
    // 这一层的节点已经不在树上，或者它的子节点从没取过：不对账（没取过的层不白取）
    if (!parent || !state.loadedLayers.has(layerId)) continue;
    layersRequested += 1;
    if (!answer.ok) {
      failed.push({ id: layerId, error: answer.error });
      if (answer.gone) goneLayers.add(layerId);
      continue;
    }
    refreshedOk.add(layerId);

    // 与 `ensureChildrenLoaded` 同一套继承：父节点未勾选 → 新节点未勾选，否则勾选
    const parentCheck = checks.get(layerId) || 'checked';
    const inheritState: CheckState = parentCheck === 'unchecked' ? 'unchecked' : 'checked';

    const childrenIds: string[] = [];
    const listed = new Set<string>();
    const memberVia: Record<string, string | null> = {};
    const memberRule: Record<string, boolean> = {};
    for (const dto of answer.children) {
      const id = deps.normalizeId(dto.refno);
      // 后端若把自己也列进子节点，会造出自己挂自己的环
      if (!id || id === layerId || listed.has(id)) continue;
      listed.add(id);
      childrenIds.push(id);
      linkViewParent(id, layerId);

      // 分组在解析视图下收录的二级成员：主位置在别处，不改它的 parentId
      const secondary = dto.secondary === true;
      if (secondary) memberVia[id] = dto.via ? deps.normalizeId(dto.via) : null;
      if (dto.rule === true) memberRule[id] = true;

      const existing = nodes[id];
      if (!existing) {
        const node = deps.toNode(dto, secondary ? null : layerId);
        nodes[id] = node;
        added.set(id, changeOf(node));
        checks.set(id, inheritState);
        (inheritState === 'unchecked' ? hide : show).push(id);
      } else {
        const fresh = deps.toNode(dto, null);
        const next: TreeNode = { ...existing, name: fresh.name, type: fresh.type };
        if (fresh.dbnum !== undefined) next.dbnum = fresh.dbnum;
        else delete next.dbnum;
        if (fresh.shortName !== undefined) next.shortName = fresh.shortName;
        else delete next.shortName;
        const original = state.nodesById[id];
        if (original && (original.name !== fresh.name || original.type !== fresh.type)) {
          renamed.set(id, { ...changeOf(next), previousName: original.name, previousType: original.type });
        }
        if (!secondary && existing.parentId !== layerId) {
          // 这一轮才进树的节点先在分组下出现、再在主位置出现，不算挪位置
          if (original) moved.set(id, { ...changeOf(next), from: original.parentId, to: layerId });
          next.parentId = layerId;
        }
        nodes[id] = next;
      }
      counts.set(id, dto.children_count ?? null);
    }

    for (const staleId of parent.childrenIds) {
      if (!listed.has(staleId)) viewParents.get(staleId)?.delete(layerId);
    }
    if (!sameOrder(parent.childrenIds, childrenIds)) touched.add(layerId);
    const nextParent: TreeNode = { ...nodes[layerId]!, childrenIds };
    delete nextParent.groupMemberVia;
    delete nextParent.groupRule;
    delete nextParent.unresolvedCount;
    delete nextParent.groupViewUnsupported;
    if (Object.keys(memberVia).length > 0) nextParent.groupMemberVia = memberVia;
    if (Object.keys(memberRule).length > 0) nextParent.groupRule = memberRule;
    if (answer.unresolvedCount > 0) nextParent.unresolvedCount = answer.unresolvedCount;
    // 新前端 × 老服务端：GPSET 下仍是存储视图，照物理视图显示、行上提示（同 `ensureChildrenLoaded`）
    if (answer.view === 'stored' && nextParent.type.toUpperCase() === 'GPSET') nextParent.groupViewUnsupported = true;
    nodes[layerId] = nextParent;
  }

  // 挪走了、而原来那一层这一轮没取到：一个节点只有一个主位置，从旧位置的子节点表里拿掉，免得两处都出行
  for (const [id, change] of moved) {
    const from = change.from;
    if (!from || refreshedOk.has(from)) continue;
    const oldParent = nodes[from];
    if (!oldParent || !oldParent.childrenIds.includes(id)) continue;
    nodes[from] = { ...oldParent, childrenIds: oldParent.childrenIds.filter((childId) => childId !== id) };
    viewParents.get(id)?.delete(from);
    touched.add(from);
  }

  // 从根出发走不到的：从树上撤掉
  const reachable = reachableFrom(state.rootIds, nodes);
  const removedIds: string[] = [];
  for (const id of Object.keys(nodes)) {
    if (reachable.has(id)) continue;
    // 对账之前就走不到的（历史遗留的孤儿）悄悄清掉，不算这一轮删的
    if (reachableBefore.has(id)) removedIds.push(id);
    delete nodes[id];
    checks.delete(id);
    counts.delete(id);
    viewParents.delete(id);
  }
  const removedSet = new Set(removedIds);
  for (const [childId, parents] of viewParents) {
    for (const parentId of [...parents]) {
      if (!nodes[parentId]) parents.delete(parentId);
    }
    if (parents.size === 0) viewParents.delete(childId);
  }

  const loadedLayers = new Set<string>();
  for (const id of state.loadedLayers) if (nodes[id]) loadedLayers.add(id);
  const expandedIds = new Set<string>();
  for (const id of state.expandedIds) if (!removedSet.has(id)) expandedIds.add(id);
  const selectedIds = new Set<string>();
  const droppedSelection: string[] = [];
  for (const id of state.selectedIds) {
    if (removedSet.has(id)) droppedSelection.push(id);
    else selectedIds.add(id);
  }

  // 每个消失的节点归到最上面那个消失的祖先名下
  const formerParentsOf = (id: string): string[] => {
    const parentId = state.nodesById[id]?.parentId;
    const linked = state.viewParentsById.get(id);
    const out = parentId ? [parentId] : [];
    if (linked) for (const item of linked) if (!out.includes(item)) out.push(item);
    return out;
  };
  const removedUnder: Record<string, string> = {};
  const topOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cur)) return cur;
      seen.add(cur);
      const up = formerParentsOf(cur).find((parentId) => removedSet.has(parentId));
      if (!up) return cur;
      cur = up;
    }
  };
  for (const id of removedIds) removedUnder[id] = topOf(id);
  const removedTop = removedIds.filter((id) => removedUnder[id] === id);

  // 子节点表变了的层：勾选聚合重算并沿父节点上推（删掉唯一一个没勾的子节点后，父节点该从半选回到勾选）
  const parentsOf = (id: string): string[] => {
    const parentId = nodes[id]?.parentId;
    const linked = viewParents.get(id);
    if (!linked || linked.size === 0) return parentId ? [parentId] : [];
    if (!parentId || linked.has(parentId)) return [...linked];
    return [parentId, ...linked];
  };
  for (const layerId of touched) {
    const node = nodes[layerId];
    if (!node) continue;
    // 子节点删光了：没有可聚合的，留着它自己的状态
    if (node.childrenIds.length > 0) checks.set(layerId, aggregateCheckState(node.childrenIds, (key) => checks.get(key)));
    recomputeViewAncestors(layerId, {
      parentsOf,
      childrenOf: (parentId) => nodes[parentId]?.childrenIds,
      stateOf: (key) => checks.get(key),
      setState: (key, value) => {
        checks.set(key, value);
      },
    });
  }

  // 挪位置只算新旧位置都还在树上的；这一轮被撤掉的不算
  const movedList = [...moved.values()].filter((item) => !!nodes[item.id]);
  const renamedList = [...renamed.values()].filter((item) => !!nodes[item.id]);
  const addedList = [...added.values()].filter((item) => !!nodes[item.id]);
  const layersFailed = failed
    .filter((item) => !!nodes[item.id])
    .map((item) => ({ id: item.id, name: nodes[item.id]!.name, error: item.error }));

  return {
    nodesById: nodes,
    loadedLayers,
    expandedIds,
    selectedIds,
    checkStateById: checks,
    childrenCountById: counts,
    viewParentsById: viewParents,
    show: show.filter((id) => !!nodes[id]),
    hide: hide.filter((id) => !!nodes[id]),
    goneLayers,
    report: {
      layersRequested,
      layersRefreshed: refreshedOk.size,
      layersFailed,
      added: addedList,
      removed: removedTop.map((id) => ({
        ...changeOf(state.nodesById[id]!),
        fate: goneLayers.has(id) ? 'deleted' as const : 'unknown' as const,
      })),
      removedNodeCount: removedIds.length,
      removedUnder,
      renamed: renamedList,
      moved: movedList,
      droppedSelection,
      changed: addedList.length > 0 || removedIds.length > 0 || renamedList.length > 0 || movedList.length > 0 || touched.size > 0,
    },
  };
}

/** 一轮里同时在飞的树请求数 */
export const TREE_REFRESH_CONCURRENCY = 6;

/**
 * 有上限地并发取各层。`fetchLayer` 抛错按「这一层没取到」记（不当成子节点都没了）。
 */
export async function fetchTreeLayerAnswers(
  layerIds: readonly string[],
  fetchLayer: (layerId: string) => Promise<TreeLayerAnswer>,
  concurrency: number = TREE_REFRESH_CONCURRENCY,
): Promise<Map<string, TreeLayerAnswer>> {
  const answers = new Map<string, TreeLayerAnswer>();
  const queue = [...new Set(layerIds)];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const layerId = queue[next++]!;
      try {
        answers.set(layerId, await fetchLayer(layerId));
      } catch (error) {
        answers.set(layerId, { ok: false, gone: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return answers;
}

/** 一轮最多为多少个消失的节点去问下落（再多的记 `unknown`，回执里照实说） */
export const DISAPPEARED_PROBE_LIMIT = 24;

/**
 * 从树上消失的节点：库里还有没有。`probe` 回 `exists`（还在，只是挪到了树上没展开的位置）、`gone`（库里没有了）、
 * `unknown`（没问到）。已经定了下落的（`fate !== 'unknown'`）不再问；超过 `limit` 的不问、留 `unknown`。
 */
export async function classifyDisappearedNodes<T extends { id: string; fate: DisappearedFate }>(
  removed: readonly T[],
  probe: (id: string) => Promise<'exists' | 'gone' | 'unknown'>,
  options: { limit?: number; concurrency?: number } = {},
): Promise<T[]> {
  const limit = options.limit ?? DISAPPEARED_PROBE_LIMIT;
  const out = removed.map((item) => ({ ...item }));
  const pending = out.filter((item) => item.fate === 'unknown').slice(0, Math.max(0, limit));
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const item = pending[next++]!;
      try {
        const answer = await probe(item.id);
        item.fate = answer === 'gone' ? 'deleted' : answer === 'exists' ? 'relocated' : 'unknown';
      } catch {
        item.fate = 'unknown';
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? TREE_REFRESH_CONCURRENCY, pending.length)) }, worker));
  return out;
}
