import { computed, ref, shallowRef, watch } from 'vue';

import type { CheckState, FlatRow, TreeNode } from '@/composables/useModelTree';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import {
  e3dGetAncestors,
  e3dGetChildren,
  e3dSearch,
  e3dGetWorldRoot,
  e3dGetSubtreeRefnos,
  e3dGetVisibleInsts,
  type TreeNodeDto,
} from '@/api/genModelE3dApi';
import { collectLoadedSubtreeIds, useSceneGraphOps } from '@/composables/useSceneGraph';

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
  return {
    id: normalizeRefnoKey(dto.refno),
    name: dto.name,
    type: dto.noun,
    parentId,
    childrenIds: [],
  };
}

export function usePdmsOwnerTree(viewerRef: { value: DtxCompatViewer | null }) {
  const sceneGraph = useSceneGraphOps(viewerRef);

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
    visibleInstCache.clear();
  }

  function rebuildInitialChecks() {
    const next = new Map<string, CheckState>();
    for (const id of Object.keys(nodesById.value)) {
      next.set(id, 'checked');
    }
    checkStateById.value = next;
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

    const visited = new Set<string>();
    const MAX_DEPTH = 256;

    const build = (id: string, depth: number) => {
      if (depth > MAX_DEPTH) return;
      if (visited.has(id)) return;
      visited.add(id);

      const node = nodes[id];
      if (!node) return;

      if (filterActive && !subtreeMatches(id)) return;

      out.push({
        id: node.id,
        name: node.name,
        type: node.type,
        depth,
        hasChildren: hasChildren(id, node),
      });

      const shouldExpand = filterActive || expandedIds.value.has(id);
      if (!shouldExpand) return;

      for (const childId of node.childrenIds) {
        build(childId, depth + 1);
      }
    };

    for (const rootId of roots) build(rootId, 0);
    return out;
  });

  async function ensureChildrenLoaded(parentId: string) {
    const parentKey = normalizeRefnoKey(parentId);
    const parent = nodesById.value[parentKey];
    if (!parent) return;

    if (childrenLoadedById.has(parentKey) || childrenLoadingById.has(parentKey)) return;

    childrenLoadingById.add(parentKey);
    try {
      let resp = await e3dGetChildren(parentKey, 2000);
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await e3dGetChildren(wrapSurrealThingId(parentKey), 2000);
      }
      if (!resp.success) throw new Error(resp.error_message || 'children api failed');

      const nextNodes: Record<string, TreeNode> = { ...nodesById.value };
      const nextChildrenCount = new Map(childrenCountById.value);

      // 缺省按 checked 处理，避免出现“父节点可见但新加载子节点默认不可见”的反直觉情况。
      const parentCheck = checkStateById.value.get(parentKey) || 'checked';
      const inheritState: CheckState = parentCheck === 'unchecked' ? 'unchecked' : 'checked';
      const forceInherit = parentCheck !== 'indeterminate';

      const childrenIds: string[] = [];
      for (const dto of resp.children) {
        const id = normalizeRefnoKey(dto.refno);
        // 后端若返回“子列表包含自身”，会污染树结构（self-parent / 环），导致 recomputeParents 死循环卡死。
        if (id === parentKey) {
          console.warn('[pdms-tree] children api returned self, ignored:', { parentId: parentKey, id });
          continue;
        }
        childrenIds.push(id);

        const existing = nextNodes[id];
        if (!existing) {
          nextNodes[id] = dtoToTreeNode(dto, parentKey);
        } else {
          nextNodes[id] = { ...existing, parentId: parentKey };
        }

        nextChildrenCount.set(id, dto.children_count ?? null);

        // 若父节点处于确定态（checked/unchecked），则子节点显隐应与父保持一致；
        // 若父为 indeterminate，则仅在子节点无状态时才继承，避免覆盖“局部子树”显隐差异。
        if (forceInherit || !checkStateById.value.has(id)) checkStateById.value.set(id, inheritState);
      }

      nextNodes[parentKey] = { ...parent, childrenIds };

      nodesById.value = nextNodes;
      childrenCountById.value = nextChildrenCount;
      childrenLoadedById.add(parentKey);

      // 按需加载：新加载到树里的节点也需要继承可见性状态，以便后续实例加载时能回放状态
      sceneGraph.setVisible(childrenIds, inheritState !== 'unchecked');
    } finally {
      childrenLoadingById.delete(parentKey);
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
    void ensureChildrenLoaded(id);
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
            const resp = await e3dSearch({ keyword: q, nouns, limit: 50 });
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
      let resp = await e3dGetSubtreeRefnos(normalizedRefno, { includeSelf: true });
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await e3dGetSubtreeRefnos(wrapSurrealThingId(normalizedRefno), { includeSelf: true });
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
      let resp = await e3dGetVisibleInsts(normalizedRefno);
      if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
        resp = await e3dGetVisibleInsts(wrapSurrealThingId(normalizedRefno));
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
   * 批量设置状态，只处理已加载到树中的节点，避免遍历大量未加载节点
   */
  async function setCheckStateDeep(id: string, state: CheckState, guard?: () => boolean) {
    const nodes = nodesById.value;
    const stack: string[] = [id];
    const toUpdate: string[] = [];
    
    // 先收集所有需要更新的节点（只处理已加载的）
    while (stack.length > 0) {
      if (guard && !guard()) return;
      const cur = stack.pop();
      if (!cur) continue;
      
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
        if (guard && !guard()) return;
        const batch = toUpdate.slice(i, i + batchSize);
        for (const cur of batch) {
          checkStateById.value.set(cur, state);
        }
        
        // 让出控制权
        if (i + batchSize < toUpdate.length) {
          if (guard && !guard()) return;
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
  }

  function recomputeParents(id: string) {
    const nodes = nodesById.value;
    let cur: string | null = id;
    const visited = new Set<string>();

    while (cur) {
      // 防御：若树数据出现 parentId 环（例如 A->B->A 或 self-parent），会导致死循环卡死 UI。
      // 这里直接中断并给出诊断日志。
      if (visited.has(cur)) {
        console.warn('[pdms-tree] recomputeParents detected cycle, aborting:', { start: id, at: cur });
        return;
      }
      visited.add(cur);

      const node: TreeNode | undefined = nodes[cur];
      const parentId: string | null = node?.parentId ?? null;
      if (!parentId) break;
      if (parentId === cur) {
        console.warn('[pdms-tree] recomputeParents detected self-parent, aborting:', { start: id, at: cur });
        return;
      }

      const parent = nodes[parentId];
      if (!parent) break;

      let checkedCount = 0;
      let uncheckedCount = 0;
      let indeterminate = false;

      for (const childId of parent.childrenIds) {
        const state = checkStateById.value.get(childId) || 'checked';
        if (state === 'indeterminate') {
          indeterminate = true;
          break;
        }
        if (state === 'checked') checkedCount++;
        if (state === 'unchecked') uncheckedCount++;
      }

      let parentState: CheckState;
      if (indeterminate) {
        parentState = 'indeterminate';
      } else if (uncheckedCount === 0 && checkedCount > 0) {
        parentState = 'checked';
      } else if (checkedCount === 0 && uncheckedCount > 0) {
        parentState = 'unchecked';
      } else {
        parentState = 'indeterminate';
      }

      checkStateById.value.set(parentId, parentState);
      cur = parentId;
    }
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

    // 先同步树侧 eye（子节点应跟随父节点变化），再异步应用到三维与 instances.json
    if (!DEBUG.skipTreeCascade) {
      const t2 = DEBUG.logTiming ? performance.now() : 0;
      await setCheckStateDeep(rootId, desiredState, () => seq === setVisibleSeq);
      if (DEBUG.logTiming) {
        console.log('[pdms-tree][perf] apply tree checkState', { refno: rootId, ms: performance.now() - t2 });
      }
    }
    if (seq !== setVisibleSeq) return;
    if (!DEBUG.skipTreeCascade) {
      const t3 = DEBUG.logTiming ? performance.now() : 0;
      recomputeParents(rootId);
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

  async function flyTo(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const refnos = collectLoadedSubtreeRefnos(id);
    if (refnos.length === 0) return;

    const aabb = viewer.scene.getAABB(refnos);
    viewer.cameraFlight.flyTo({ aabb });
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

    if (!parent.childrenIds.includes(childId)) {
      nodesById.value = {
        ...nodesById.value,
        [parentId]: { ...parent, childrenIds: [...parent.childrenIds, childId] },
      };
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
    let resp = await e3dGetAncestors(key);
    if (!resp.success && shouldRetryWithWrappedId(resp.error_message)) {
      resp = await e3dGetAncestors(wrapSurrealThingId(key));
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

    const nextExpanded = new Set(expandedIds.value);
    nextExpanded.add(rootId);

    // 从树根向下逐层查找：在每层子节点中找到属于祖先集合的节点，依次展开
    let curParent = rootId;
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

  async function initTree(seq: number) {
    try {
      const resp = await e3dGetWorldRoot();
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

    getCheckState,
    setVisible,

    selectByRowIndex,

    flyTo,
    isolateXray,
    clearXray,
  };
}
