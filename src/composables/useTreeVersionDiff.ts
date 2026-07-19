import { computed, ref } from 'vue';

import type { FlatRow, TreeNode } from '@/composables/useModelTree';

/** 单个变更模型（来自 plant3d:incremental-version-compare 事件 payload 的 models 项） */
export type TreeDiffModel = {
  refno: string;
  category?: string;
  status?: string;
  beforeState?: string;
  afterState?: string;
  sourceChangeCount?: number;
  sourceNouns?: string;
  /** 删除节点的原父节点（幽灵节点回插位置）；派发方可选提供 */
  ownerRefno?: string;
};

export type TreeDiffContext = {
  project?: string;
  dbnum?: number;
  fromSesno?: number;
  toSesno?: number;
  mode?: string;
  refnos: string[];
  models: TreeDiffModel[];
};

export type TreeDiffStatus = 'added' | 'modified' | 'deleted';

export type TreeDiffFilter = 'all' | TreeDiffStatus;

/** 差异模式下树的展示行：在 FlatRow 基础上带差异装饰 */
export type DiffFlatRow = FlatRow & {
  /** 该节点自身的变更类别 */
  diffStatus?: TreeDiffStatus;
  /** 后代（含幽灵子节点）变更数量汇总，仅容器节点展示 */
  diffCount?: number;
  /** 幽灵节点：已删除、不存在于当前树，仅展示 */
  ghost?: boolean;
  /** 幽灵节点因原父/存活祖先均未能定位而回退挂载到根节点时为 true */
  ghostUnplaced?: boolean;
};

type TreeDeps = {
  nodesById: { value: Record<string, TreeNode> };
  rootIds: { value: string[] };
  expandedIds: { value: Set<string> };
  flatRows: { value: FlatRow[] };
  expandPathToNode: (refno: string) => Promise<boolean>;
};

/** 超过该数量的变更不再逐个解析祖先路径（保持界面可交互，FR-014） */
const MAX_PATH_RESOLVE = 500;
const RESOLVE_CONCURRENCY = 4;

export function normalizeTreeDiffStatus(status?: string): TreeDiffStatus {
  if (status === 'added') return 'added';
  if (status === 'deleted') return 'deleted';
  // mixed / modified / 未知 统一按“修改”呈现
  return 'modified';
}

function contextSignature(ctx: TreeDiffContext): string {
  return [
    ctx.project ?? '',
    ctx.dbnum ?? '',
    ctx.fromSesno ?? '',
    ctx.toSesno ?? '',
    ctx.models.map((m) => `${m.refno}:${m.status ?? ''}`).sort().join('|'),
  ].join('#');
}

export function useTreeVersionDiff(deps: TreeDeps) {
  const context = ref<TreeDiffContext | null>(null);
  const filter = ref<TreeDiffFilter>('all');
  const selectedRefno = ref<string | null>(null);

  const resolving = ref(false);
  const resolveDone = ref(0);
  const resolveTotal = ref(0);

  let resolveSeq = 0;
  let lastSignature = '';

  const isActive = computed(() => context.value !== null);

  const modelsByRefno = computed(() => {
    const map = new Map<string, TreeDiffModel>();
    for (const model of context.value?.models ?? []) {
      if (model.refno) map.set(model.refno, model);
    }
    return map;
  });

  const counts = computed(() => {
    const result = { all: 0, added: 0, modified: 0, deleted: 0 };
    for (const model of modelsByRefno.value.values()) {
      result.all += 1;
      result[normalizeTreeDiffStatus(model.status)] += 1;
    }
    return result;
  });

  const versionPairLabel = computed(() => {
    const ctx = context.value;
    if (!ctx) return '';
    const from = ctx.fromSesno ?? '-';
    const to = ctx.toSesno ?? '-';
    return `${from} → ${to}`;
  });

  const selectedModel = computed(() => {
    const refno = selectedRefno.value;
    if (!refno) return null;
    return modelsByRefno.value.get(refno) ?? null;
  });

  const selectedIsGhost = computed(() => {
    const refno = selectedRefno.value;
    if (!refno) return false;
    const model = selectedModel.value;
    if (!model) return false;
    return normalizeTreeDiffStatus(model.status) === 'deleted' && !deps.nodesById.value[refno];
  });

  function firstNoun(model: TreeDiffModel): string {
    const nouns = String(model.sourceNouns || '').split(',').map((s) => s.trim()).filter(Boolean);
    return (nouns[0] || model.category || '').toUpperCase();
  }

  /** 构建差异模式展示行：变更节点 + 祖先路径 + 幽灵节点，并计算祖先变更汇总 */
  const buildResult = computed(() => {
    const ctx = context.value;
    const empty = { rows: [] as DiffFlatRow[], unplaced: 0 };
    if (!ctx) return empty;

    const nodes = deps.nodesById.value;
    const rootId = deps.rootIds.value[0] ?? null;
    const currentFilter = filter.value;

    const allowed = new Set<string>();
    const rollup = new Map<string, number>();
    const ghostsByParent = new Map<string, { model: TreeDiffModel; unplaced: boolean }[]>();
    let unplaced = 0;

    /**
     * 幽灵节点挂载规则（data-model TreeDiffEntry）：原父存在 → 挂原父；
     * 原父也被删除 → 沿 ownerRefno 链（父也在本次删除集合中时可续链）向上找最近仍存活的祖先。
     * 找不到时返回 null，由调用方回退挂根并标记 unplaced。
     */
    const resolveGhostOwner = (model: TreeDiffModel): string | null => {
      const seen = new Set<string>();
      let cur = model.ownerRefno ?? null;
      while (cur && !seen.has(cur)) {
        if (nodes[cur]) return cur;
        seen.add(cur);
        cur = modelsByRefno.value.get(cur)?.ownerRefno ?? null;
      }
      return null;
    };

    const addAncestorChain = (startId: string, includeStart: boolean, countTarget: boolean) => {
      const seen = new Set<string>();
      let cur: string | null = includeStart ? startId : (nodes[startId]?.parentId ?? null);
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        allowed.add(cur);
        if (countTarget) rollup.set(cur, (rollup.get(cur) ?? 0) + 1);
        cur = nodes[cur]?.parentId ?? null;
      }
    };

    for (const model of modelsByRefno.value.values()) {
      const status = normalizeTreeDiffStatus(model.status);
      if (currentFilter !== 'all' && currentFilter !== status) continue;

      const node = nodes[model.refno];
      if (node) {
        // 节点仍在当前树中（新增/修改，或删除后又存在的边界情况）
        allowed.add(model.refno);
        addAncestorChain(model.refno, false, true);
        continue;
      }

      if (status === 'deleted') {
        // 幽灵节点：优先挂原父/最近存活祖先，均不可得时回退根节点
        const alive = resolveGhostOwner(model);
        const owner = alive ?? rootId;
        if (!owner) {
          unplaced += 1;
          continue;
        }
        const list = ghostsByParent.get(owner) ?? [];
        list.push({ model, unplaced: alive === null });
        ghostsByParent.set(owner, list);
        allowed.add(owner);
        addAncestorChain(owner, true, true);
        continue;
      }

      // 新增/修改但尚未定位到树（路径解析失败或超出解析上限）
      unplaced += 1;
    }

    const makeGhostRow = (model: TreeDiffModel, depth: number, unplacedGhost: boolean): DiffFlatRow => ({
      id: model.refno,
      refno: model.refno,
      name: model.refno,
      type: firstNoun(model),
      depth,
      hasChildren: false,
      ghost: true,
      ghostUnplaced: unplacedGhost,
      diffStatus: 'deleted',
    });

    // 按 DFS 顺序过滤源行，并把幽灵节点插到父节点的子块末尾
    const rows: DiffFlatRow[] = [];
    const ghostStack: { depth: number; ghosts: DiffFlatRow[] }[] = [];

    const flushGhosts = (uptoDepth: number) => {
      while (ghostStack.length > 0) {
        const top = ghostStack[ghostStack.length - 1]!;
        if (top.depth < uptoDepth) break;
        rows.push(...top.ghosts);
        ghostStack.pop();
      }
    };

    for (const row of deps.flatRows.value) {
      if (!allowed.has(row.id)) continue;

      // 当前行深度 <= 栈顶父节点深度 ⇒ 栈顶父节点的子块已结束
      flushGhosts(row.depth);

      const model = modelsByRefno.value.get(row.id);
      const status = model ? normalizeTreeDiffStatus(model.status) : undefined;
      const includeSelf = !!model && (currentFilter === 'all' || currentFilter === status);
      rows.push({
        ...row,
        diffStatus: includeSelf ? status : undefined,
        diffCount: !includeSelf ? rollup.get(row.id) : undefined,
      });

      const ghosts = ghostsByParent.get(row.id);
      if (ghosts && deps.expandedIds.value.has(row.id)) {
        ghostStack.push({
          depth: row.depth,
          ghosts: ghosts.map((g) => makeGhostRow(g.model, row.depth + 1, g.unplaced)),
        });
      }
    }
    flushGhosts(-1);

    return { rows, unplaced };
  });

  const rows = computed(() => buildResult.value.rows);
  const unplacedCount = computed(() => buildResult.value.unplaced);

  async function resolvePaths(ctx: TreeDiffContext) {
    const seq = ++resolveSeq;
    const targets: string[] = [];
    for (const model of ctx.models) {
      const status = normalizeTreeDiffStatus(model.status);
      if (status === 'deleted') {
        if (model.ownerRefno) targets.push(model.ownerRefno);
      } else {
        targets.push(model.refno);
      }
    }
    const unique = Array.from(new Set(targets)).slice(0, MAX_PATH_RESOLVE);

    resolving.value = true;
    resolveDone.value = 0;
    resolveTotal.value = unique.length;

    try {
      let cursor = 0;
      const worker = async () => {
        while (cursor < unique.length) {
          if (seq !== resolveSeq) return;
          const target = unique[cursor];
          cursor += 1;
          if (!target) continue;
          try {
            await deps.expandPathToNode(target);
          } finally {
            if (seq === resolveSeq) resolveDone.value += 1;
          }
        }
      };
      await Promise.all(Array.from({ length: RESOLVE_CONCURRENCY }, () => worker()));
    } finally {
      if (seq === resolveSeq) resolving.value = false;
    }
  }

  function apply(ctx: TreeDiffContext) {
    const signature = contextSignature(ctx);
    const sameContext = signature === lastSignature && context.value !== null;
    lastSignature = signature;
    context.value = ctx;
    if (sameContext) return;

    filter.value = 'all';
    selectedRefno.value = ctx.models[0]?.refno ?? null;
    void resolvePaths(ctx);
  }

  function clear() {
    resolveSeq += 1;
    lastSignature = '';
    context.value = null;
    selectedRefno.value = null;
    filter.value = 'all';
    resolving.value = false;
    resolveDone.value = 0;
    resolveTotal.value = 0;
  }

  function setFilter(next: TreeDiffFilter) {
    filter.value = next;
  }

  function select(refno: string) {
    if (!modelsByRefno.value.has(refno)) return;
    selectedRefno.value = refno;
  }

  return {
    context,
    isActive,
    filter,
    setFilter,
    counts,
    versionPairLabel,
    rows,
    unplacedCount,
    resolving,
    resolveDone,
    resolveTotal,
    selectedRefno,
    selectedModel,
    selectedIsGhost,
    modelsByRefno,
    apply,
    clear,
    select,
  };
}
