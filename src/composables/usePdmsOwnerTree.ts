import { computed, ref, shallowRef, watch } from 'vue';

import type { TreeNodeDto } from '@/api/genModelE3dTypes';
import type { CheckState, FlatRow, TreeNode } from '@/composables/useModelTree';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { aggregateCheckState, recomputeViewAncestors } from '@/composables/useModelTree';
import { collectLoadedSubtreeIds, useSceneGraphOps } from '@/composables/useSceneGraph';
import { getModelSource } from '@/model-source';
import { flyToScope } from '@/viewer/camera/focusScope';

export const NOUN_TYPES = [
  'PIPE', 'BRAN', 'EQUI', 'SUPP', 'STRU', 'WALL', 'SWALL', 'GWALL',
  'VALV', 'ELBO', 'TEE', 'FLAN', 'CATE', 'HANG', 'FITT',
] as const;

export type NounType = typeof NOUN_TYPES[number]

function normalizeRefnoKey(value: string): string {
  // 统一前端内部使用的 refno key：
  // - 去掉 SurrealDB recordId 包装（例如 pe:⟨17496_123456⟩ -> 17496_123456）
  // - 兼容 123/456 与 123,456
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/[⟨<]([^⟩>]+)[⟩>]/);
  const core = match?.[1] ?? raw;
  return core.replace(/\//g, '_').replace(/,/g, '_');
}

function isPdmsRefnoKey(value: string): boolean {
  // 17496_171640（dbno_refno）。只要是纯数字 + "_" + 纯数字即可。
  return /^\d+_\d+$/.test(value);
}

function formatBadRefno(value: string): string {
  const s = String(value || '');
  return s.length > 120 ? `${s.slice(0, 120)}...` : s;
}

function wrapSurrealThingId(value: string): string {
  const key = normalizeRefnoKey(value);
  if (!key) return '';
  // 已经是 ⟨...⟩ / <...> 形式则不重复包裹
  if (/[⟨<].*[⟩>]/.test(String(value || ''))) return String(value || '').trim();
  // 用 ASCII "<...>"，避免 Unicode 角括号在部分服务端/代理层被错误处理。
  return `<${key}>`;
}

function shouldRetryWithWrappedId(errorMessage: string | null | undefined): boolean {
  const msg = String(errorMessage || '');
  // 后端 Surreal 查询构造失败/解析失败时常会带 SQL/rs_surreal 字样
  return msg.includes('rs_surreal') || msg.includes('SQL:') || msg.includes('query_ancestor_refnos failed');
}

function dtoToTreeNode(dto: TreeNodeDto, parentId: string | null): TreeNode {
  const node: TreeNode = {
    id: normalizeRefnoKey(dto.refno),
    name: dto.name,
    type: dto.noun,
    parentId,
    childrenIds: [],
  };
  // 只有 gen-model-v1 的 DTO 带 dbnum / short_name；legacy 的节点对象与从前逐字段相同
  if (typeof dto.dbnum === 'number' && Number.isFinite(dto.dbnum)) node.dbnum = dto.dbnum;
  const shortName = typeof dto.short_name === 'string' ? dto.short_name.trim() : '';
  if (shortName && shortName !== dto.name) node.shortName = shortName;
  return node;
}

export function usePdmsOwnerTree(viewerRef: { value: DtxCompatViewer | null }) {
  const sceneGraph = useSceneGraphOps(viewerRef);
  // 取数一律经数据源端口（plan 2026-09-06 P2-2）：`legacy` 下每个方法就是原来那个 e3d* 函数的一次转发，
  // `gen-model-v1` 下换成 /api/v1 适配器（虚拟根 + 节点映射）。状态机本身不动。
  const treeSource = getModelSource().tree;

  const nodesById = shallowRef<Record<string, TreeNode>>({});
  const rootIds = ref<string[]>([]);

  const expandedIds = ref<Set<string>>(new Set());
  const selectedIds = ref<Set<string>>(new Set());
  const lastAnchorIndex = ref<number | null>(null);

  const filterText = ref('');
  const typeQuery = ref('');
  const selectedTypes = ref<Set<string>>(new Set());
  const customTypes = ref<Set<string>>(new Set());

  const searchItems = ref<TreeNodeDto[]>([]);
  const searchLoading = ref(false);
  const searchError = ref<string | null>(null);

  const checkStateById = ref<Map<string, CheckState>>(new Map());

  function yieldToMainThread(): Promise<void> {
    return new Promise((resolve) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => resolve(), { timeout: 10 });
      } else {
        setTimeout(resolve, 1);
      }
    });
  }

  function yieldToNextFrame(): Promise<void> {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  const childrenCountById = ref<Map<string, number | null>>(new Map());
  const childrenLoadedById = new Set<string>();
  const childrenLoadingById = new Set<string>();

  // 当前视图里的父节点：refno → 父 refno 集。解析视图下一个元素可以同时挂在主位置和收录它的 GPSET 下，
  // `parentId` 只记主位置；勾选聚合要沿这里的全部父节点上推。
  const viewParentsById = new Map<string, Set<string>>();

  function linkViewParent(childId: string, parentId: string) {
    let parents = viewParentsById.get(childId);
    if (!parents) {
      parents = new Set();
      viewParentsById.set(childId, parents);
    }
    parents.add(parentId);
  }

  function viewParentsOf(id: string): string[] {
    const parentId = nodesById.value[id]?.parentId;
    const linked = viewParentsById.get(id);
    if (!linked || linked.size === 0) return parentId ? [parentId] : [];
    if (!parentId || linked.has(parentId)) return [...linked];
    return [parentId, ...linked];
  }

  // 空闲预取：用户展开一层后，把「下一层」的 children 也拉进树——钻取式浏览的
  // 下一次展开直接命中 childrenLoadedById，不再等后端往返。只挂用户主动展开
  // （toggleExpand）：批量路径（setVisible 级联 / 祖先链定位）不预取，免得一次
  // 定位放大成整棵子树的请求风暴。预算 = 单次排队上限，逐条串行发。
  const PREFETCH_CHILDREN_BUDGET = 8;
  let prefetchSeq = 0;
  const prefetchQueue: string[] = [];
  let prefetchRunning = false;

  const SUBTREE_MAX_DEPTH = 256;
  const SUBTREE_LIMIT = 200_000;

  // 缓存 queryVisibleInstRefnos 结果，避免选中组节点时重复请求后端
  const visibleInstCache = new Map<string, string[]>();

  function resetAllState() {
    nodesById.value = {};
    rootIds.value = [];
    expandedIds.value = new Set();
    selectedIds.value = new Set();
    lastAnchorIndex.value = null;

    filterText.value = '';
    typeQuery.value = '';
    selectedTypes.value = new Set();
    customTypes.value = new Set();

    searchItems.value = [];
    searchLoading.value = false;
    searchError.value = null;

    checkStateById.value = new Map();
    childrenCountById.value = new Map();
    childrenLoadedById.clear();
    childrenLoadingById.clear();
    viewParentsById.clear();
    prefetchSeq++;
    prefetchQueue.length = 0;
    visibleInstCache.clear();
  }

  function rebuildInitialChecks() {
    const next = new Map<string, CheckState>();
    for (const id of Object.keys(nodesById.value)) {
      next.set(id, 'checked');
    }
    checkStateById.value = next;
  }

  /** 定位从哪个根往下找：祖先链落在「分组」分区（链尾是分组根）就从分组根走，否则从世界根走。 */
  function pickStartRoot(ancestorSet: ReadonlySet<string>, fallback: string): string {
    return rootIds.value.find((id) => ancestorSet.has(id)) ?? fallback;
  }

  function matchesFilter(node: TreeNode) {
    const q = filterText.value.trim().toLowerCase();
    const typeSet = selectedTypes.value;
    const textOk = !q || node.name.toLowerCase().includes(q);
    const typeOk = typeSet.size === 0 || typeSet.has(node.type);
    return textOk && typeOk;
  }

  const allTypes = computed(() => {
    const set = new Set<string>();
    for (const id of Object.keys(nodesById.value)) {
      const t = nodesById.value[id]?.type;
      if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  const filteredTypes = computed(() => {
    const q = typeQuery.value.trim().toLowerCase();
    const list = allTypes.value;
    if (!q) return list;
    return list.filter((t) => t.toLowerCase().includes(q));
  });

  const flatRows = computed(() => {
    const nodes = nodesById.value;
    const roots = rootIds.value;
    const out: FlatRow[] = [];

    const hasText = filterText.value.trim().length > 0;
    const hasType = selectedTypes.value.size > 0;
    const filterActive = hasText || hasType;

    const matchMemo = new Map<string, boolean>();
    const matchVisiting = new Set<string>();

    const subtreeMatches = (id: string): boolean => {
      const cached = matchMemo.get(id);
      if (cached !== undefined) return cached;

      if (matchVisiting.has(id)) {
        matchMemo.set(id, false);
        return false;
      }
      matchVisiting.add(id);

      const node = nodes[id];
      if (!node) {
        matchVisiting.delete(id);
        matchMemo.set(id, false);
        return false;
      }

      let ok = matchesFilter(node);
      if (!ok) {
        for (const childId of node.childrenIds) {
          if (subtreeMatches(childId)) {
            ok = true;
            break;
          }
        }
      }

      matchMemo.set(id, ok);
      matchVisiting.delete(id);
      return ok;
    };

    const hasChildren = (id: string, node: TreeNode): boolean => {
      if (node.childrenIds.length > 0) return true;
      const cnt = childrenCountById.value.get(id);
      return typeof cnt === 'number' && cnt > 0;
    };

    // 解析视图下同一元素可以同时挂在主位置和收录它的 GPSET 下，两处都出行：防环只看当前祖先链。
    const onPath = new Set<string>();
    const MAX_DEPTH = 256;

    const build = (id: string, depth: number, viewParentId: string | null) => {
      if (depth > MAX_DEPTH) return;
      if (onPath.has(id)) return;

      const node = nodes[id];
      if (!node) return;

      if (filterActive && !subtreeMatches(id)) return;

      const row: FlatRow = {
        id: node.id,
        name: node.name,
        type: node.type,
        depth,
        hasChildren: hasChildren(id, node),
      };
      if (node.dbnum !== undefined) {
        row.dbnum = node.dbnum;
        const parentId = viewParentId ?? node.parentId;
        const parentDbnum = parentId ? nodes[parentId]?.dbnum : undefined;
        if (parentDbnum !== node.dbnum) row.dbBoundary = true;
      }
      if (node.shortName !== undefined) row.shortName = node.shortName;
      const via = viewParentId ? nodes[viewParentId]?.groupMemberVia?.[id] : undefined;
      if (via !== undefined) {
        row.secondary = true;
        if (via) row.via = via;
      }
      // 规则成员：`groupMemberVia[id]` 是 null（没有经由的 GPITEM），所以 `secondary` 为真而 `via` 不出现；
      // `groupRule` 是独立的承载位，两者同时为真时行只画「规则」角标。
      const rule = viewParentId ? nodes[viewParentId]?.groupRule?.[id] : undefined;
      if (rule === true) row.rule = true;
      if (node.unresolvedCount) row.unresolvedCount = node.unresolvedCount;
      if (node.groupViewUnsupported) row.groupViewUnsupported = true;
      out.push(row);

      const shouldExpand = filterActive || expandedIds.value.has(id);
      if (!shouldExpand) return;

      onPath.add(id);
      for (const childId of node.childrenIds) {
        build(childId, depth + 1, id);
      }
      onPath.delete(id);
    };

    for (const rootId of roots) build(rootId, 0, null);
    return out;
  });

  async function ensureChildrenLoaded(parentId: string) {
    const parentKey = normalizeRefnoKey(parentId);
    const parent = nodesById.value[parentKey];
    if (!parent) return;

    if (childrenLoadedById.has(parentKey) || childrenLoadingById.has(parentKey)) return;

    childrenLoadingById.add(parentKey);
    try {
      let resp = await treeSource.children(parentKey, 2000);
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await treeSource.children(wrapSurrealThingId(parentKey), 2000);
      }
      if (!resp.success) throw new Error(resp.error_message || 'children api failed');

      const nextNodes: Record<string, TreeNode> = { ...nodesById.value };
      const nextChildrenCount = new Map(childrenCountById.value);

      // 缺省按 checked 处理，避免出现“父节点可见但新加载子节点默认不可见”的反直觉情况。
      const parentCheck = checkStateById.value.get(parentKey) || 'checked';
      const inheritState: CheckState = parentCheck === 'unchecked' ? 'unchecked' : 'checked';
      const forceInherit = parentCheck !== 'indeterminate';

      const childrenIds: string[] = [];
      const inheritedIds: string[] = [];
      const memberVia: Record<string, string | null> = {};
      // 规则成员（后端 `rule: true`）：与 `memberVia` 并列，`groupMemberVia[id]` 为 null 但这一格为 true。
      const memberRule: Record<string, boolean> = {};
      let keptOwnState = false;
      for (const dto of resp.children) {
        const id = normalizeRefnoKey(dto.refno);
        // 后端若返回“子列表包含自身”，会污染树结构（self-parent / 环），导致 recomputeParents 死循环卡死。
        if (id === parentKey) {
          console.warn('[pdms-tree] children api returned self, ignored:', { parentId: parentKey, id });
          continue;
        }
        childrenIds.push(id);
        linkViewParent(id, parentKey);

        // 分组在解析视图下收录的二级成员：主位置在别处，不改它的 parentId，也不动它已有的勾选态。
        const secondary = dto.secondary === true;
        if (secondary) memberVia[id] = dto.via ? normalizeRefnoKey(dto.via) : null;
        // 规则成员：后端给 `rule: true` + `via: null` + `secondary: true`。形状与普通二级成员一样落在
        // `memberVia` 里（null 表示没有经由的 GPITEM），另外在 `memberRule` 记一笔供行渲染选角标。
        if (dto.rule === true) memberRule[id] = true;
        const existing = nextNodes[id];
        if (!existing) {
          nextNodes[id] = dtoToTreeNode(dto, secondary ? null : parentKey);
        } else if (!secondary) {
          nextNodes[id] = { ...existing, parentId: parentKey };
        }

        nextChildrenCount.set(id, dto.children_count ?? null);

        if (secondary && checkStateById.value.has(id)) {
          keptOwnState = true;
          continue;
        }
        inheritedIds.push(id);

        // 若父节点处于确定态（checked/unchecked），则子节点显隐应与父保持一致；
        // 若父为 indeterminate，则仅在子节点无状态时才继承，避免覆盖“局部子树”显隐差异。
        if (forceInherit || !checkStateById.value.has(id)) checkStateById.value.set(id, inheritState);
      }

      const kept = new Set(childrenIds);
      for (const staleId of parent.childrenIds) {
        if (!kept.has(staleId)) viewParentsById.get(staleId)?.delete(parentKey);
      }
      const nextParent: TreeNode = { ...parent, childrenIds };
      delete nextParent.groupMemberVia;
      delete nextParent.groupRule;
      delete nextParent.unresolvedCount;
      delete nextParent.groupViewUnsupported;
      if (Object.keys(memberVia).length > 0) nextParent.groupMemberVia = memberVia;
      if (Object.keys(memberRule).length > 0) nextParent.groupRule = memberRule;
      if (resp.unresolved && resp.unresolved.length > 0) nextParent.unresolvedCount = resp.unresolved.length;
      // 新前端 × 老服务端：GPSET 下仍是存储视图（GPITEM 槽本身），照物理视图显示、行上提示
      if (resp.view === 'stored' && parent.type.toUpperCase() === 'GPSET') nextParent.groupViewUnsupported = true;
      nextNodes[parentKey] = nextParent;

      nodesById.value = nextNodes;
      childrenCountById.value = nextChildrenCount;
      childrenLoadedById.add(parentKey);

      // 按需加载：新加载到树里的节点也需要继承可见性状态，以便后续实例加载时能回放状态
      sceneGraph.setVisible(inheritedIds, inheritState !== 'unchecked');
      if (keptOwnState) {
        checkStateById.value.set(parentKey, aggregateCheckState(childrenIds, (key) => checkStateById.value.get(key)));
        recomputeParents(parentKey);
      }
    } finally {
      childrenLoadingById.delete(parentKey);
    }
  }

  function scheduleChildrenPrefetch(parentId: string) {
    const seq = prefetchSeq;
    const parent = nodesById.value[normalizeRefnoKey(parentId)];
    if (!parent) return;
    for (const childId of parent.childrenIds) {
      if (prefetchQueue.length >= PREFETCH_CHILDREN_BUDGET) break;
      if (childrenLoadedById.has(childId) || childrenLoadingById.has(childId)) continue;
      const count = childrenCountById.value.get(childId);
      if (typeof count === 'number' && count <= 0) continue;
      if (!prefetchQueue.includes(childId)) prefetchQueue.push(childId);
    }
    if (!prefetchRunning) void runChildrenPrefetch(seq);
  }

  async function runChildrenPrefetch(seq: number) {
    prefetchRunning = true;
    try {
      while (seq === prefetchSeq && prefetchQueue.length > 0) {
        // 让出主线程：预取不许跟用户的下一次点击抢帧。
        await yieldToMainThread();
        const id = prefetchQueue.shift();
        if (!id || seq !== prefetchSeq) break;
        // ensureChildrenLoaded 自带 childrenLoadedById / childrenLoadingById 去重，
        // 预取与真实展开共享同一条加载路径，副作用（勾选继承 / 可见性回放）同形。
        // 预取失败静默跳过：真实展开会再试并在原路径上报错，后台不重复制造噪音。
        await ensureChildrenLoaded(id).catch(() => undefined);
      }
    } finally {
      prefetchRunning = false;
      // seq 换代退出的 runner 可能留下新入队的项，补一个按当前 seq 的 runner。
      if (prefetchQueue.length > 0) void runChildrenPrefetch(prefetchSeq);
    }
  }

  function toggleExpand(id: string) {
    const set = new Set(expandedIds.value);
    if (set.has(id)) {
      set.delete(id);
      expandedIds.value = set;
      return;
    }

    set.add(id);
    expandedIds.value = set;
    // 展开完成后顺带预取「下一层」：已加载的节点 ensureChildrenLoaded 直接 resolve，
    // 折叠再展开同样会预热。
    void ensureChildrenLoaded(id).then(() => scheduleChildrenPrefetch(id));
  }

  function setFilter(text: string) {
    filterText.value = text;
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSeq = 0;

  watch(
    () => [filterText.value, selectedTypes.value] as const,
    ([text, types]) => {
      const q = text.trim();

      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }

      if (q.length < 2) {
        searchItems.value = [];
        searchLoading.value = false;
        searchError.value = null;
        return;
      }

      const seq = ++searchSeq;
      searchTimer = setTimeout(() => {
        void (async () => {
          searchLoading.value = true;
          searchError.value = null;
          try {
            const nouns = types.size > 0 ? Array.from(types) : undefined;
            const resp = await treeSource.search({ keyword: q, nouns, limit: 50 });
            if (seq !== searchSeq) return;
            if (!resp.success) {
              searchItems.value = [];
              searchError.value = resp.error_message || 'search failed';
              return;
            }
            searchItems.value = resp.items;
          } catch (e) {
            if (seq !== searchSeq) return;
            searchItems.value = [];
            searchError.value = e instanceof Error ? e.message : String(e);
          } finally {
            if (seq === searchSeq) searchLoading.value = false;
          }
        })();
      }, 250);
    }
  );

  function setTypeQuery(text: string) {
    typeQuery.value = text;
  }

  function toggleType(type: string) {
    const set = new Set(selectedTypes.value);
    if (set.has(type)) {
      set.delete(type);
    } else {
      set.add(type);
    }
    selectedTypes.value = set;
  }

  function selectAllTypes() {
    const set = new Set<string>(NOUN_TYPES);
    for (const t of customTypes.value) set.add(t);
    selectedTypes.value = set;
  }

  function clearAllTypes() {
    selectedTypes.value = new Set();
  }

  function addCustomType(type: string) {
    const t = type.trim().toUpperCase();
    if (!t) return false;
    if (NOUN_TYPES.includes(t as NounType)) return false;
    if (customTypes.value.has(t)) return false;

    const newCustom = new Set(customTypes.value);
    newCustom.add(t);
    customTypes.value = newCustom;

    const newSelected = new Set(selectedTypes.value);
    newSelected.add(t);
    selectedTypes.value = newSelected;

    return true;
  }

  function removeCustomType(type: string) {
    const newCustom = new Set(customTypes.value);
    newCustom.delete(type);
    customTypes.value = newCustom;

    const newSelected = new Set(selectedTypes.value);
    newSelected.delete(type);
    selectedTypes.value = newSelected;
  }

  function collectLoadedSubtreeRefnos(rootId: string): string[] {
    const nodes = nodesById.value;
    return collectLoadedSubtreeIds(
      rootId,
      (id) => nodes[id]?.childrenIds,
      { maxDepth: SUBTREE_MAX_DEPTH, maxNodes: SUBTREE_LIMIT },
    );
  }

  /**
   * 从 web-server 查询指定 refno 的子树所有 refnos
   */
  async function querySubtreeRefnos(refno: string): Promise<string[]> {
    try {
      const normalizedRefno = normalizeRefnoKey(refno);
      let resp = await treeSource.subtreeRefnos(normalizedRefno, { includeSelf: true });
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await treeSource.subtreeRefnos(wrapSurrealThingId(normalizedRefno), { includeSelf: true });
      }
      
      if (!resp.success) {
        console.error('[pdms-tree] querySubtreeRefnos failed:', resp.error_message);
        return [];
      }

      // 全项目统一使用 "_" refno 格式
      return (resp.refnos || []).map((r) => normalizeRefnoKey(String(r))).filter(Boolean);
    } catch (e) {
      console.error('[pdms-tree] querySubtreeRefnos error:', e);
      return [];
    }
  }

  /**
   * 查询“可见几何实例”相关的 refnos（子孙 + 自身），用于切换 instances.json 里的显示/隐藏。
   */
  async function queryVisibleInstRefnos(refno: string): Promise<string[]> {
    try {
      const normalizedRefno = normalizeRefnoKey(refno);
      let resp = await treeSource.visibleInsts(normalizedRefno);
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await treeSource.visibleInsts(wrapSurrealThingId(normalizedRefno));
      }
      if (!resp.success) {
        console.error('[pdms-tree] queryVisibleInstRefnos failed:', resp.error_message);
        return [];
      }
      return (resp.refnos || []).map((r) => normalizeRefnoKey(String(r))).filter(Boolean);
    } catch (e) {
      console.error('[pdms-tree] queryVisibleInstRefnos error:', e);
      return [];
    }
  }

  async function setSceneVisibleInBatches(refnos: string[], visible: boolean, batchSize = 50): Promise<void> {
    const viewer = viewerRef.value;
    if (!viewer) return;
    if (!refnos || refnos.length === 0) return;

    // 关键：不要把大量 refno 堆进 useSceneGraphOps.pendingVisible（否则 flush 会一次性 setObjectsVisible 导致长时间阻塞）。
    // 直接分批调用 compat.scene.setObjectsVisible，把“重同步”工作切小并穿插让出帧。
    for (let i = 0; i < refnos.length; i += batchSize) {
      const batch = refnos.slice(i, i + batchSize);
      viewer.scene.setObjectsVisible(batch, visible);

      if (i + batchSize < refnos.length) {
        // 让浏览器有机会渲染与响应输入，避免“看起来卡死”
        await yieldToNextFrame();
      }
    }
  }

  /**
   * 批量设置状态，只处理已加载到树中的节点，避免遍历大量未加载节点；返回改到的节点（中途取消回空表）
   */
  async function setCheckStateDeep(id: string, state: CheckState, guard?: () => boolean): Promise<string[]> {
    const nodes = nodesById.value;
    const stack: string[] = [id];
    const toUpdate: string[] = [];
    // 解析视图下同一节点可以经多个父节点到达（分组成员），只收一次。
    const seen = new Set<string>();
    
    // 先收集所有需要更新的节点（只处理已加载的）
    while (stack.length > 0) {
      if (guard && !guard()) return [];
      const cur = stack.pop();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      
      // 只处理已加载到树中的节点
      if (nodes[cur]) {
        toUpdate.push(cur);
        const node = nodes[cur];
        if (node) {
          for (const childId of node.childrenIds) {
            if (nodes[childId]) {
              stack.push(childId);
            }
          }
        }
      }
    }
    
    // 批量更新状态，避免频繁触发响应式更新
    if (toUpdate.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < toUpdate.length; i += batchSize) {
        if (guard && !guard()) return [];
        const batch = toUpdate.slice(i, i + batchSize);
        for (const cur of batch) {
          checkStateById.value.set(cur, state);
        }
        
        // 让出控制权
        if (i + batchSize < toUpdate.length) {
          if (guard && !guard()) return [];
          await new Promise(resolve => {
            if ('requestIdleCallback' in window) {
              requestIdleCallback(() => resolve(undefined), { timeout: 10 });
            } else {
              setTimeout(resolve, 1);
            }
          });
        }
      }
    }
    return toUpdate;
  }

  function recomputeParents(id: string) {
    const nodes = nodesById.value;
    recomputeViewAncestors(id, {
      parentsOf: viewParentsOf,
      childrenOf: (parentId) => nodes[parentId]?.childrenIds,
      stateOf: (key) => checkStateById.value.get(key),
      setState: (key, state) => {
        checkStateById.value.set(key, state);
      },
    });
  }

  let setVisibleSeq = 0;

  async function setVisible(id: string, visible: boolean) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    // Debug: 分段禁用以定位卡死点（改这里的开关即可，不用反复注释多处代码）
    const DEBUG = {
      // true: 不调用 /api/e3d/visible-insts，直接只切换当前 refno
      skipVisibleInstsApi: false,
      // true: 不对三维场景应用可见性（仅更新树 eye 状态）
      skipSceneApply: false,
      // true: 不做已加载子孙的 eye 批量更新/父节点重算（仅更新当前节点）
      skipTreeCascade: false,
      // true: 输出耗时日志（console）
      logTiming: false,
    };

    const rootId = normalizeRefnoKey(id);
    const desiredState: CheckState = visible ? 'checked' : 'unchecked';

    const seq = ++setVisibleSeq;
    // 先更新当前节点的 eye（提升响应感）；子孙节点由 setCheckStateDeep 批量更新
    checkStateById.value.set(rootId, desiredState);
    let updated: string[] = [];

    // 先同步树侧 eye（子节点应跟随父节点变化），再异步应用到三维与 instances.json
    if (!DEBUG.skipTreeCascade) {
      const t2 = DEBUG.logTiming ? performance.now() : 0;
      await ensureDescendantStateLoaded(rootId, desiredState, () => seq === setVisibleSeq);
      updated = await setCheckStateDeep(rootId, desiredState, () => seq === setVisibleSeq);
      if (DEBUG.logTiming) {
        console.log('[pdms-tree][perf] apply tree checkState', { refno: rootId, ms: performance.now() - t2 });
      }
    }
    if (seq !== setVisibleSeq) return;
    if (!DEBUG.skipTreeCascade) {
      const t3 = DEBUG.logTiming ? performance.now() : 0;
      recomputeParents(rootId);
      // 级联改到的节点若还挂在别处（主位置 ↔ 收录它的 GPSET），那些位置的父节点也要重算。
      for (const id of updated) {
        if (id !== rootId && viewParentsOf(id).length > 1) recomputeParents(id);
      }
      if (DEBUG.logTiming) {
        // recomputeParents 可能会遍历父节点的所有 childrenIds（子数很大时可能阻塞）
        console.log('[pdms-tree][perf] recomputeParents', { refno: rootId, ms: performance.now() - t3 });
      }
    }

    // 关键：不在前端递归遍历子树；改为后端一次性返回“可见实例 refnos（含子孙 + 自身）”
    const t0 = DEBUG.logTiming ? performance.now() : 0;
    let refnos = DEBUG.skipVisibleInstsApi ? [rootId] : await queryVisibleInstRefnos(rootId);
    if (seq !== setVisibleSeq) return;

    if (refnos.length === 0) {
      // 兜底：至少切换自身
      refnos = [rootId];
    } else if (!refnos.includes(rootId)) {
      // 需求：包含自己
      refnos.unshift(rootId);
    }

    // 去重 + 规范化
    const dedup: string[] = Array.from(new Set(refnos.map((r) => normalizeRefnoKey(r)).filter(Boolean)));
    if (DEBUG.logTiming) {
      console.log('[pdms-tree][perf] visible-insts+dedup', { refno: rootId, count: dedup.length, ms: performance.now() - t0 });
    }

    if (!DEBUG.skipSceneApply) {
      const t1 = DEBUG.logTiming ? performance.now() : 0;
      await setSceneVisibleInBatches(dedup, visible);
      if (DEBUG.logTiming) {
        console.log('[pdms-tree][perf] apply scene visible', { refno: rootId, count: dedup.length, ms: performance.now() - t1 });
      }
    }
  }

  async function ensureDescendantStateLoaded(
    rootId: string,
    desiredState: CheckState,
    shouldContinue?: () => boolean,
  ) {
    if (desiredState === 'indeterminate') return;
    const queue: string[] = [rootId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      if (shouldContinue && !shouldContinue()) return;
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);

      const node = nodesById.value[currentId];
      if (!node) continue;

      const expectedChildren = childrenCountById.value.get(currentId) ?? 0;
      if (node.childrenIds.length === 0 && expectedChildren > 0) {
        await ensureChildrenLoaded(currentId);
        if (shouldContinue && !shouldContinue()) return;
      }

      const refreshedNode = nodesById.value[currentId];
      if (!refreshedNode) continue;

      for (const childId of refreshedNode.childrenIds) {
        checkStateById.value.set(childId, desiredState);
        queue.push(childId);
      }
    }
  }

  function clearSelectionInScene(viewer: DtxCompatViewer) {
    const selectedObjectIds = viewer.scene.selectedObjectIds;
    if (selectedObjectIds && selectedObjectIds.length > 0) {
      viewer.scene.setObjectsSelected(selectedObjectIds, false);
    }
  }

  async function syncSceneSelection() {
    const viewer = viewerRef.value;
    if (!viewer) return;

    clearSelectionInScene(viewer);

    const union = new Set<string>();
    for (const id of selectedIds.value) {
      const localIds = collectLoadedSubtreeRefnos(id);

      // 检查是否为"子节点未加载的组节点"：前端树只有自身，但后端显示有子节点
      const node = nodesById.value[id];
      const childrenNotLoaded = node && node.childrenIds.length === 0 && (childrenCountById.value.get(id) ?? 0) > 0;

      if (localIds.length <= 1 && childrenNotLoaded) {
        // 组节点且子节点未展开：使用缓存或后端查询可见实例 refnos
        let cached = visibleInstCache.get(id);
        if (!cached) {
          cached = await queryVisibleInstRefnos(id);
          if (cached.length > 0) visibleInstCache.set(id, cached);
        }
        for (const refno of cached) union.add(refno);
        // 始终包含自身
        union.add(id);
      } else {
        for (const refno of localIds) union.add(refno);
      }
    }

    const list = Array.from(union);
    if (list.length > 0) sceneGraph.setSelected(list, true);
  }

  function selectByRowIndex(index: number, ev: MouseEvent) {
    const rows = flatRows.value;
    if (index < 0 || index >= rows.length) return;

    const id = rows[index]?.id;
    if (!id) return;

    const metaKey = ev.metaKey || ev.ctrlKey;
    const shiftKey = ev.shiftKey;

    if (shiftKey && lastAnchorIndex.value !== null) {
      const a = lastAnchorIndex.value;
      const start = Math.min(a, index);
      const end = Math.max(a, index);
      const next = new Set(selectedIds.value);
      for (const row of rows.slice(start, end + 1)) next.add(row.id);
      selectedIds.value = next;
    } else if (metaKey) {
      const next = new Set(selectedIds.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectedIds.value = next;
      lastAnchorIndex.value = index;
    } else {
      selectedIds.value = new Set([id]);
      lastAnchorIndex.value = index;
    }

    void syncSceneSelection();
  }

  /**
   * 定位到节点。
   *
   * 原来只收「已加载」的构件（`collectLoadedSubtreeRefnos`），一个都没加载就 `return` ——
   * SITE / ZONE / PIPE 这类范围根从来没单独装过，按定位什么都不会发生，也没有任何提示
   * （plant-ui `fix(focus)` `36cc91f2d` 修的就是这个）。现在走 `resolveFocusScope`：
   * 直接并 → 子树并集（本地索引，`getSubtreeAABB`）→ 查一次子树清单，三级都空才回 false。
   */
  async function flyTo(id: string): Promise<boolean> {
    const viewer = viewerRef.value;
    if (!viewer) return false;

    const loaded = collectLoadedSubtreeRefnos(id);
    const result = await flyToScope(viewer, {
      refnos: loaded,
      scopeRefnos: [id],
      allowSubtreeQuery: true,
      lookupSubtreeRefnos: querySubtreeRefnos,
      source: 'tree',
    });
    return result.ok;
  }

  async function isolateXray(id: string) {
    const keep = collectLoadedSubtreeRefnos(id);
    sceneGraph.isolate(keep);
  }

  function clearXray() {
    sceneGraph.clearIsolation();
  }

  function getCheckState(id: string): CheckState {
    return checkStateById.value.get(id) || 'checked';
  }

  async function ensureNodeAttached(parentId: string, childId: string) {
    // 防御：避免把节点挂到自己下面，造成 self-parent / 环，进而触发 recomputeParents 死循环。
    if (!parentId || !childId) return;
    if (parentId === childId) {
      console.warn('[pdms-tree] ensureNodeAttached skip self-parent:', { parentId, childId });
      return;
    }
    await ensureChildrenLoaded(parentId);

    let parent = nodesById.value[parentId];
    if (!parent) return;

    if (!nodesById.value[childId]) {
      await ensureChildrenLoaded(parentId);
    }

    const child = nodesById.value[childId];
    if (!child) return;

    if (child.parentId !== parentId) {
      nodesById.value = {
        ...nodesById.value,
        [childId]: { ...child, parentId },
      };
    }

    parent = nodesById.value[parentId];
    if (!parent) return;

    linkViewParent(childId, parentId);
    if (!parent.childrenIds.includes(childId)) {
      nodesById.value = {
        ...nodesById.value,
        [parentId]: { ...parent, childrenIds: [...parent.childrenIds, childId] },
      };
    }
  }

  /**
   * 仅“加载 + 展开”到目标节点的路径，不做选中/飞行/滚动等副作用。
   * 供版本差异模式批量定位变更节点使用；任何失败都返回 false（不抛错）。
   *
   * `expandSelf`：连目标节点自己也展开（并加载其子节点）。差异模式里已删除节点的幽灵行挂在
   * 「最近仍存活的祖先」下面，只把路径展开到那个祖先是不够的——它自己收着，幽灵行就一行都看不见
   * （2026-09-18 真机 602→604：EQUI 与 BOX 都被删，ZONE 挂着「2」却收着，`attr-diff/live-8026/a602-b604-*`）。
   */
  async function expandPathToNode(refno: string, options?: { expandSelf?: boolean }): Promise<boolean> {
    const rootId = rootIds.value[0];
    if (!rootId) return false;

    const key = normalizeRefnoKey(refno);
    if (!isPdmsRefnoKey(key)) return false;

    const expandSelf = options?.expandSelf === true;

    // 已在树中：只需确保祖先链展开
    if (nodesById.value[key]) {
      const nextExpanded = new Set(expandedIds.value);
      let cur: string | null = nodesById.value[key]?.parentId ?? null;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        nextExpanded.add(cur);
        cur = nodesById.value[cur]?.parentId ?? null;
      }
      if (expandSelf) nextExpanded.add(key);
      expandedIds.value = nextExpanded;
      if (expandSelf) await ensureChildrenLoaded(key).catch(() => undefined);
      return true;
    }

    try {
      let resp = await treeSource.ancestors(key);
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await treeSource.ancestors(wrapSurrealThingId(key));
      }
      if (!resp.success) return false;

      const ancestors = (resp.refnos || []).map((r) => normalizeRefnoKey(String(r))).filter(Boolean);
      if (ancestors.length === 0) return false;

      const ancestorSet = new Set(ancestors);
      ancestorSet.add(key);
      const startRoot = pickStartRoot(ancestorSet, rootId);

      const nextExpanded = new Set(expandedIds.value);
      nextExpanded.add(startRoot);

      // 与 focusNodeById 相同的“从根向下逐层查找”策略（不依赖祖先链返回顺序）
      let curParent = startRoot;
      const maxSteps = ancestors.length + 2;
      for (let step = 0; step < maxSteps; step++) {
        await ensureChildrenLoaded(curParent);
        nextExpanded.add(curParent);

        const parent = nodesById.value[curParent];
        if (!parent) break;
        if (parent.childrenIds.includes(key)) break;

        const nextStep = parent.childrenIds.find((childId) => ancestorSet.has(childId));
        if (!nextStep) break;
        curParent = nextStep;
      }

      await ensureChildrenLoaded(curParent);
      const located = !!nodesById.value[key];
      if (expandSelf && located) {
        nextExpanded.add(key);
        await ensureChildrenLoaded(key).catch(() => undefined);
      }
      expandedIds.value = nextExpanded;
      return located;
    } catch {
      return false;
    }
  }

  async function focusNodeById(
    refno: string,
    options?: {
      flyTo?: boolean
      syncSceneSelection?: boolean
      clearSearch?: boolean
    },
  ) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const fly = options?.flyTo ?? true;
    const syncScene = options?.syncSceneSelection ?? true;
    const clearSearch = options?.clearSearch ?? true;

    const rootId = rootIds.value[0];
    if (!rootId) return;

    const key = normalizeRefnoKey(refno);
    if (!isPdmsRefnoKey(key)) {
      throw new Error(`非法 refno（期望 17496/171640 或 17496_171640）: ${formatBadRefno(refno)}`);
    }
    let resp = await treeSource.ancestors(key);
    if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
      resp = await treeSource.ancestors(wrapSurrealThingId(key));
    }
    if (!resp.success) throw new Error(resp.error_message || 'ancestors failed');

    const ancestors = (resp.refnos || []).map((r) => normalizeRefnoKey(String(r))).filter(Boolean);
    if (ancestors.length === 0) return;

    // 祖先集合（包含目标节点本身），用于在每层子节点中识别"路径上的下一个节点"。
    // 注意：后端和 Parquet 返回的祖先链顺序不同（TOP-DOWN vs BOTTOM-UP），
    // 且 MDB 环境下祖先链的 WORL 节点可能与树根不同，因此不能依赖返回顺序。
    // 改用"从根向下逐层查找"策略，完全不依赖返回顺序。
    const ancestorSet = new Set(ancestors);
    ancestorSet.add(key);
    const startRoot = pickStartRoot(ancestorSet, rootId);

    const nextExpanded = new Set(expandedIds.value);
    nextExpanded.add(startRoot);

    // 从树根向下逐层查找：在每层子节点中找到属于祖先集合的节点，依次展开
    let curParent = startRoot;
    const maxSteps = ancestors.length + 2;
    for (let step = 0; step < maxSteps; step++) {
      await ensureChildrenLoaded(curParent);
      nextExpanded.add(curParent);

      const parent = nodesById.value[curParent];
      if (!parent) break;

      // 目标节点已经在当前层级的子节点中 → 找到了
      if (parent.childrenIds.includes(key)) break;

      // 在子节点中找属于祖先链的下一跳节点
      const nextStep = parent.childrenIds.find((childId) => ancestorSet.has(childId));
      if (!nextStep) break;

      curParent = nextStep;
    }

    // 确保最终父节点的子节点已加载（目标节点应在其中）
    await ensureChildrenLoaded(curParent);

    expandedIds.value = nextExpanded;
    selectedIds.value = new Set([key]);

    if (syncScene) await syncSceneSelection();
    if (fly) await flyTo(key);

    if (clearSearch) {
      filterText.value = '';
      searchItems.value = [];
      searchLoading.value = false;
      searchError.value = null;
    }
  }

  let initSeq = 0;
  let initRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let initRetryCount = 0;

  function clearInitRetry() {
    if (initRetryTimer) {
      clearTimeout(initRetryTimer);
      initRetryTimer = null;
    }
    initRetryCount = 0;
  }

  function scheduleInitRetry(seq: number) {
    if (seq !== initSeq) return;
    if (!viewerRef.value) return;
    if (initRetryTimer) return;

    const next = initRetryCount + 1;
    if (next > 5) return;
    initRetryCount = next;

    const delayMs = Math.min(8000, 500 * 2 ** (next - 1));
    initRetryTimer = setTimeout(() => {
      initRetryTimer = null;
      if (seq !== initSeq) return;
      if (!viewerRef.value) return;
      void initTree(seq);
    }, delayMs);
  }

  /**
   * 「分组」分区（D5-b）：GPWL 挂在单独的虚拟根下，排在世界根之后、默认收起。
   * 数据源不给（项目里没有分组 / 服务端不支持）就不出现；失败不影响世界根那棵树。
   */
  async function attachGroupRoot(seq: number) {
    if (!treeSource.groupRoot) return;
    try {
      const resp = await treeSource.groupRoot();
      if (seq !== initSeq || !resp.success || !resp.node) return;
      const root = dtoToTreeNode(resp.node, null);
      if (nodesById.value[root.id]) return;
      nodesById.value = { ...nodesById.value, [root.id]: root };
      rootIds.value = [...rootIds.value, root.id];
      const nextChildrenCount = new Map(childrenCountById.value);
      nextChildrenCount.set(root.id, resp.node.children_count ?? null);
      childrenCountById.value = nextChildrenCount;
      const nextChecks = new Map(checkStateById.value);
      nextChecks.set(root.id, 'checked');
      checkStateById.value = nextChecks;
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[pdms-tree] group root unavailable', e);
    }
  }

  async function initTree(seq: number) {
    try {
      const resp = await treeSource.worldRoot();
      if (!resp.success || !resp.node) throw new Error(resp.error_message || 'world-root api failed');
      if (seq !== initSeq) return;

      clearInitRetry();

      const root = dtoToTreeNode(resp.node, null);
      nodesById.value = { [root.id]: root };
      rootIds.value = [root.id];

      const nextChildrenCount = new Map<string, number | null>();
      nextChildrenCount.set(root.id, resp.node.children_count ?? null);
      childrenCountById.value = nextChildrenCount;

      rebuildInitialChecks();

      void ensureChildrenLoaded(root.id);
      expandedIds.value = new Set([root.id]);
      void attachGroupRoot(seq);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[pdms-tree] initTree failed', e);
      }
      if (seq === initSeq) {
        resetAllState();
        scheduleInitRetry(seq);
      }
    }
  }

  watch(
    () => viewerRef.value,
    (viewer) => {
      initSeq++;
      const seq = initSeq;

      clearInitRetry();

      if (!viewer) {
        resetAllState();
        return;
      }

      resetAllState();
      void initTree(seq);
    },
    { immediate: true }
  );

  return {
    nodesById,
    rootIds,
    expandedIds,
    selectedIds,
    flatRows,

    filterText,
    typeQuery,
    selectedTypes,
    customTypes,
    allTypes,
    filteredTypes,

    toggleExpand,
    setFilter,
    setTypeQuery,
    toggleType,
    selectAllTypes,
    clearAllTypes,
    addCustomType,
    removeCustomType,

    searchItems,
    searchLoading,
    searchError,
    focusNodeById,
    expandPathToNode,

    getCheckState,
    setVisible,

    selectByRowIndex,

    flyTo,
    isolateXray,
    clearXray,
  };
}
