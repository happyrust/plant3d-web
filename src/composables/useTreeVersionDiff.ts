import { computed, ref } from 'vue';

import type { FlatRow, TreeNode } from '@/composables/useModelTree';
import type { ModelVersionAttributes } from '@/model-source/ports';

/**
 * 树内差异模式的驱动事件（`CustomEvent<TreeDiffContext>`）。
 *
 * 唯一派发方是「模型版本对比」面板（`ModelUnitVersionComparePanel`），唯一消费者是 `ModelTreePanel`。
 * `models` 与 `refnos` 都为空 = 退出差异模式。2026-09-18 之前叫 `plant3d:incremental-version-compare`，
 * 由 release diff 面板 / 版本时间线 / 增量更新面板三处派发；那三处随 release 线一起删除（ADR 0065，
 * `docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` §1.4）。
 */
export const MODEL_VERSION_TREE_DIFF_EVENT = 'plant3d:model-version-tree-diff';

/** 派发一份树内差异上下文；传 `null` 表示退出差异模式。 */
export function dispatchTreeDiffContext(context: TreeDiffContext | null): void {
  if (typeof window === 'undefined') return;
  const detail: TreeDiffContext = context ?? { refnos: [], models: [] };
  window.dispatchEvent(new CustomEvent<TreeDiffContext>(MODEL_VERSION_TREE_DIFF_EVENT, { detail }));
}

/** 单个变更模型（`MODEL_VERSION_TREE_DIFF_EVENT` payload 的 models 项） */
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

/** 属性历史对比的取数口：某构件在 A（`before`）/ B（`after`）版本下的属性；由派发方（版本对比面板）按它手里的两份版本几何闭包出来。 */
export type TreeDiffAttributesAt = (side: 'before' | 'after', refno: string, signal?: AbortSignal) => Promise<ModelVersionAttributes>;

export type TreeDiffContext = {
  project?: string;
  dbnum?: number;
  fromSesno?: number;
  toSesno?: number;
  mode?: string;
  refnos: string[];
  models: TreeDiffModel[];
  /** 可选：给差异模式底部的「属性历史对比」面板取两侧属性；没有就不显示那块。 */
  attributesAt?: TreeDiffAttributesAt;
};

export type TreeDiffStatus = 'added' | 'modified' | 'deleted';

export type TreeDiffFilter = 'all' | TreeDiffStatus;

/** 差异模式下树的展示行：在 FlatRow 基础上带差异装饰 */
export type DiffFlatRow = FlatRow & {
  /** 该节点自身的变更类别 */
  diffStatus?: TreeDiffStatus;
  /** 后代（含幽灵子节点）变更数量汇总，仅容器节点展示 */
  diffCount?: number;
  /**
   * 幽灵节点：不存在于当前树，仅展示。两种来源——B 版把它删了（`diffStatus === 'deleted'`），
   * 或者它在 B 版还在、B 版之后又被删了（`added` / `modified` 但路径解析不到，行尾标「当前已不在」）。
   */
  ghost?: boolean;
  /** 幽灵节点因原父/存活祖先均未能定位而回退挂载到根节点时为 true */
  ghostUnplaced?: boolean;
};

type TreeDeps = {
  nodesById: { value: Record<string, TreeNode> };
  rootIds: { value: string[] };
  expandedIds: { value: Set<string> };
  flatRows: { value: FlatRow[] };
  /** 加载 + 展开到目标节点的路径；`expandSelf` 时连目标自己也展开（幽灵行的挂载点要靠这个才看得见） */
  expandPathToNode: (refno: string, options?: { expandSelf?: boolean }) => Promise<boolean>;
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
  /**
   * 路径解析整条链都失败的新增 / 修改构件：B 版里还在、当前会话里已经没有了（B 版之后又被删）。
   * 它们和被删构件一样只能按幽灵行展示——但要等解析真的失败才算数，解析还在跑时先按「未定位」计。
   */
  const unresolved = ref<Set<string>>(new Set());

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

  /** 选中的构件在当前会话里已经没有了：被 B 版删掉的，或 B 版之后又被删、路径解析不到的新增 / 修改。 */
  const selectedIsGhost = computed(() => {
    const refno = selectedRefno.value;
    if (!refno) return false;
    const model = selectedModel.value;
    if (!model) return false;
    if (deps.nodesById.value[refno]) return false;
    return normalizeTreeDiffStatus(model.status) === 'deleted' || unresolved.value.has(refno);
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

      // 不在当前树：被 B 版删掉的直接走幽灵；新增 / 修改要等路径解析整条链都失败了才算「当前已不在」，
      // 解析还在跑（或超出解析上限）时仍记「未定位」，免得先闪一行错的。
      if (status === 'deleted' || unresolved.value.has(model.refno)) {
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

      // 新增/修改但尚未定位到树（路径解析进行中或超出解析上限）
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
      // 徽章保留它在这次对比里的身份：被删的「删」，B 版之后才没的仍是「增 / 改」
      diffStatus: normalizeTreeDiffStatus(model.status),
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

  /**
   * 幽灵行挂载点的候选链：沿 `ownerRefno` 一级级往上，跳过「自己也在本次删除集合里、且不在当前树中」的
   * 原父——它在当前会话里必然不存在，拿它去后端查祖先只会 404。碰到已经在树里的祖先就停（那一个就够）。
   * 其余（不在变更集里，或在变更集里但不是删除）都值得试一次，前一个查不到再往上退。
   */
  function ghostAnchorChain(model: TreeDiffModel, byRefno: Map<string, TreeDiffModel>): string[] {
    const nodes = deps.nodesById.value;
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur = model.ownerRefno ?? null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (nodes[cur]) {
        chain.push(cur);
        break;
      }
      const owner = byRefno.get(cur);
      if (owner && normalizeTreeDiffStatus(owner.status) === 'deleted') {
        cur = owner.ownerRefno ?? null;
        continue;
      }
      chain.push(cur);
      cur = owner?.ownerRefno ?? null;
    }
    return chain;
  }

  /**
   * 每条变更一份解析计划：非删除的先试它自己（路径可见即可），删除的、以及自己查不到的，
   * 沿 `ownerRefno` 链逐级试幽灵挂载点（挂载点必须自己展开，`buildResult` 才插幽灵行）。
   * 整条链都失败 = 这个构件当前会话里已经没有了（B 版之后又被删），记进 `unresolved` 走幽灵行。
   */
  async function resolvePaths(ctx: TreeDiffContext) {
    const seq = ++resolveSeq;
    const byRefno = new Map<string, TreeDiffModel>();
    for (const model of ctx.models) if (model.refno) byRefno.set(model.refno, model);

    const plans = Array.from(byRefno.values())
      .slice(0, MAX_PATH_RESOLVE)
      .map((model) => ({
        refno: model.refno,
        self: normalizeTreeDiffStatus(model.status) === 'deleted' ? null : model.refno,
        anchors: ghostAnchorChain(model, byRefno),
      }));

    resolving.value = true;
    resolveDone.value = 0;
    resolveTotal.value = plans.length;
    unresolved.value = new Set();

    // 同一个挂载点常被多条变更共用（整单元被删时尤其），按「目标 + 是否展开自身」记一次结果就够
    const attempts = new Map<string, Promise<boolean>>();
    const tryExpand = (target: string, expandSelf: boolean): Promise<boolean> => {
      const key = `${target}|${expandSelf ? 1 : 0}`;
      let pending = attempts.get(key);
      if (!pending) {
        pending = Promise.resolve()
          .then(() => deps.expandPathToNode(target, expandSelf ? { expandSelf: true } : undefined))
          .catch(() => false);
        attempts.set(key, pending);
      }
      return pending;
    };

    const failed: string[] = [];
    try {
      let cursor = 0;
      const worker = async () => {
        while (cursor < plans.length) {
          if (seq !== resolveSeq) return;
          const plan = plans[cursor];
          cursor += 1;
          if (!plan) continue;
          try {
            const selfOk = plan.self ? await tryExpand(plan.self, false) : false;
            // 自己查不到（或本来就是被删的）：把幽灵行的挂载点展开出来，第一个成功的祖先就够
            if (!selfOk) {
              for (const anchor of plan.anchors) {
                if (seq !== resolveSeq) break;
                if (await tryExpand(anchor, true)) break;
              }
              // 非删除却查不到自己 = 它在 B 版之后又被删了，当前会话里没有这个构件
              if (plan.self) failed.push(plan.refno);
            }
          } finally {
            if (seq === resolveSeq) resolveDone.value += 1;
          }
        }
      };
      await Promise.all(Array.from({ length: RESOLVE_CONCURRENCY }, () => worker()));
      if (seq === resolveSeq && failed.length > 0) unresolved.value = new Set(failed);
    } finally {
      if (seq === resolveSeq) resolving.value = false;
    }
  }

  /** 返回的 promise 在路径解析落定后 resolve：调用方要等它才知道某条变更到底在不在当前会话。 */
  function apply(ctx: TreeDiffContext): Promise<void> {
    const signature = contextSignature(ctx);
    const sameContext = signature === lastSignature && context.value !== null;
    lastSignature = signature;
    context.value = ctx;
    if (sameContext) return Promise.resolve();

    filter.value = 'all';
    selectedRefno.value = ctx.models[0]?.refno ?? null;
    return resolvePaths(ctx);
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
    unresolved.value = new Set();
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
