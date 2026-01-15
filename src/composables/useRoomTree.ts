import { computed, ref, shallowRef, watch } from 'vue';

import type { CheckState, FlatRow, TreeNode } from '@/composables/useModelTree';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import { collectLoadedSubtreeIds, useSceneGraphOps } from '@/composables/useSceneGraph';

import {
  roomTreeGetAncestors,
  roomTreeGetChildren,
  roomTreeGetRoot,
  roomTreeSearch,
  type RoomTreeNodeDto,
} from '@/api/genModelRoomTreeApi';

function dtoToTreeNode(dto: RoomTreeNodeDto, parentId: string | null): TreeNode {
  return {
    id: dto.id,
    name: dto.name,
    type: dto.noun,
    parentId,
    childrenIds: [],
  };
}

function isRoomObjectId(id: string) {
  return /^\d+_\d+(,\d+)?$/.test(id);
}

export function useRoomTree(
  viewerRef: { value: DtxCompatViewer | null },
  enabledRef?: { value: boolean },
) {
  const sceneGraph = useSceneGraphOps(viewerRef);

  const nodesById = shallowRef<Record<string, TreeNode>>({});
  const rootIds = ref<string[]>([]);

  const expandedIds = ref<Set<string>>(new Set());
  const selectedIds = ref<Set<string>>(new Set());
  const lastAnchorIndex = ref<number | null>(null);

  const filterText = ref('');
  const typeQuery = ref('');
  const selectedTypes = ref<Set<string>>(new Set());

  const searchItems = ref<RoomTreeNodeDto[]>([]);
  const searchLoading = ref(false);
  const searchError = ref<string | null>(null);

  const checkStateById = ref<Map<string, CheckState>>(new Map());

  const childrenCountById = ref<Map<string, number | null>>(new Map());
  const childrenLoadedById = new Set<string>();
  const childrenLoadingById = new Set<string>();

  const enabled = computed(() => enabledRef?.value ?? true);

  function resetAllState() {
    nodesById.value = {};
    rootIds.value = [];
    expandedIds.value = new Set();
    selectedIds.value = new Set();
    lastAnchorIndex.value = null;

    filterText.value = '';
    typeQuery.value = '';
    selectedTypes.value = new Set();

    searchItems.value = [];
    searchLoading.value = false;
    searchError.value = null;

    checkStateById.value = new Map();
    childrenCountById.value = new Map();
    childrenLoadedById.clear();
    childrenLoadingById.clear();
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

    const subtreeMatches = (id: string): boolean => {
      const cached = matchMemo.get(id);
      if (cached !== undefined) return cached;

      const node = nodes[id];
      if (!node) {
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
      return ok;
    };

    const hasChildren = (id: string, node: TreeNode): boolean => {
      if (node.childrenIds.length > 0) return true;
      const cnt = childrenCountById.value.get(id);
      return typeof cnt === 'number' && cnt > 0;
    };

    const build = (id: string, depth: number) => {
      const node = nodes[id];
      if (!node) return;

      if (filterActive && !subtreeMatches(id)) {
        return;
      }

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

    for (const rootId of roots) {
      build(rootId, 0);
    }

    return out;
  });

  async function ensureChildrenLoaded(parentId: string) {
    const parent = nodesById.value[parentId];
    if (!parent) return;

    if (childrenLoadedById.has(parentId) || childrenLoadingById.has(parentId)) return;

    childrenLoadingById.add(parentId);
    try {
      const resp = await roomTreeGetChildren(parentId, 2000);
      if (!resp.success) {
        throw new Error(resp.error_message || 'room-tree children api failed');
      }

      const nextNodes: Record<string, TreeNode> = { ...nodesById.value };
      const nextChildrenCount = new Map(childrenCountById.value);

      const parentCheck = checkStateById.value.get(parentId) || 'checked';
      const inheritState: CheckState = parentCheck === 'unchecked' ? 'unchecked' : 'checked';

      const childrenIds: string[] = [];
      for (const dto of resp.children) {
        const id = dto.id;
        childrenIds.push(id);

        const existing = nextNodes[id];
        if (!existing) {
          nextNodes[id] = dtoToTreeNode(dto, parentId);
        } else {
          nextNodes[id] = { ...existing, parentId };
        }

        if (dto.children_count !== undefined) {
          nextChildrenCount.set(id, dto.children_count ?? null);
        } else {
          nextChildrenCount.set(id, null);
        }

        if (!checkStateById.value.has(id)) {
          checkStateById.value.set(id, inheritState);
        }
      }

      nextNodes[parentId] = { ...parent, childrenIds };

      nodesById.value = nextNodes;
      childrenCountById.value = nextChildrenCount;
      childrenLoadedById.add(parentId);

      // 按需加载：新加载到树里的节点也需要继承可见性状态，以便后续实例加载时能回放状态
      sceneGraph.setVisible(childrenIds, inheritState !== 'unchecked');
    } finally {
      childrenLoadingById.delete(parentId);
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
    () => filterText.value,
    (text) => {
      if (!enabled.value) return;

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
            const resp = await roomTreeSearch({ keyword: q, limit: 50 });
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
            if (seq === searchSeq) {
              searchLoading.value = false;
            }
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

  function collectLoadedRoomRefnos(rootId: string) {
    const nodes = nodesById.value;
    const ids = collectLoadedSubtreeIds(
      rootId,
      (id) => nodes[id]?.childrenIds,
      { maxDepth: 256, maxNodes: 200_000 },
    );
    return ids.filter((id) => isRoomObjectId(id));
  }

  function setCheckStateDeep(id: string, state: CheckState) {
    const nodes = nodesById.value;
    const stack: string[] = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur) continue;
      checkStateById.value.set(cur, state);
      const node = nodes[cur];
      if (!node) continue;
      for (const childId of node.childrenIds) {
        stack.push(childId);
      }
    }
  }

  function recomputeParents(id: string) {
    const nodes = nodesById.value;
    let cur: string | null = id;

    while (cur) {
      const node: TreeNode | undefined = nodes[cur];
      const parentId: string | null = node?.parentId ?? null;
      if (!parentId) break;

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

  function setVisible(id: string, visible: boolean) {
    // 本地树：只对已加载到树中的对象做子树操作，同时记录状态用于后续实例按需加载回放
    const refnos = collectLoadedRoomRefnos(id);
    if (refnos.length > 0) sceneGraph.setVisible(refnos, visible);

    setCheckStateDeep(id, visible ? 'checked' : 'unchecked');
    recomputeParents(id);
  }

  function clearSelectionInScene(viewer: DtxCompatViewer) {
    const selectedObjectIds = viewer.scene.selectedObjectIds;
    if (selectedObjectIds && selectedObjectIds.length > 0) {
      viewer.scene.setObjectsSelected(selectedObjectIds, false);
    }
  }

  function syncSceneSelection() {
    const viewer = viewerRef.value;
    if (!viewer) return;

    clearSelectionInScene(viewer);

    const union = new Set<string>();
    for (const id of selectedIds.value) {
      const refnos = collectLoadedRoomRefnos(id);
      for (const refno of refnos) union.add(refno);
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
      for (const row of rows.slice(start, end + 1)) {
        next.add(row.id);
      }
      selectedIds.value = next;
    } else if (metaKey) {
      const next = new Set(selectedIds.value);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      selectedIds.value = next;
      lastAnchorIndex.value = index;
    } else {
      selectedIds.value = new Set([id]);
      lastAnchorIndex.value = index;
    }

    syncSceneSelection();
  }

  function flyTo(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const refnos = collectLoadedRoomRefnos(id);
    if (refnos.length === 0) return;

    const aabb = viewer.scene.getAABB(refnos);
    viewer.cameraFlight.flyTo({ aabb });
  }

  function isolateXray(id: string) {
    const keep = collectLoadedRoomRefnos(id);
    sceneGraph.isolate(keep);
  }

  function clearXray() {
    sceneGraph.clearIsolation();
  }

  function getCheckState(id: string): CheckState {
    return checkStateById.value.get(id) || 'checked';
  }

  async function ensureNodeAttached(parentId: string, childId: string) {
    if (parentId === childId) return;
    await ensureChildrenLoaded(parentId);

    const child = nodesById.value[childId];
    if (!child) return;

    if (child.parentId !== parentId) {
      nodesById.value = {
        ...nodesById.value,
        [childId]: { ...child, parentId },
      };
    }

    const parent = nodesById.value[parentId];
    if (!parent) return;

    if (!parent.childrenIds.includes(childId)) {
      nodesById.value = {
        ...nodesById.value,
        [parentId]: { ...parent, childrenIds: [...parent.childrenIds, childId] },
      };
    }
  }

  async function focusNodeById(
    id: string,
    options?: {
      flyTo?: boolean;
      syncSceneSelection?: boolean;
      clearSearch?: boolean;
    },
  ) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const fly = options?.flyTo ?? true;
    const syncScene = options?.syncSceneSelection ?? true;
    const clearSearch = options?.clearSearch ?? true;

    const rootId = rootIds.value[0];
    if (!rootId) return;

    const resp = await roomTreeGetAncestors(id);
    if (!resp.success) {
      throw new Error(resp.error_message || 'ancestors failed');
    }

    const ancestors = resp.ids || [];
    if (ancestors.length === 0) return;

    const path = [...ancestors].reverse();

    const nextExpanded = new Set(expandedIds.value);
    nextExpanded.add(rootId);

    let parentId = rootId;
    for (let i = 0; i < path.length; i++) {
      const curId = path[i]!;
      await ensureNodeAttached(parentId, curId);

      if (i < path.length - 1) {
        nextExpanded.add(curId);
      }

      parentId = curId;
    }

    expandedIds.value = nextExpanded;
    selectedIds.value = new Set([id]);
    if (syncScene) {
      syncSceneSelection();
    }

    if (fly && isRoomObjectId(id)) {
      flyTo(id);
    }

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
    if (!enabled.value) return;
    if (initRetryTimer) return;

    const next = initRetryCount + 1;
    if (next > 5) return;
    initRetryCount = next;

    const delayMs = Math.min(8000, 500 * 2 ** (next - 1));
    initRetryTimer = setTimeout(() => {
      initRetryTimer = null;
      if (seq !== initSeq) return;
      if (!viewerRef.value) return;
      if (!enabled.value) return;
      void initTree(seq);
    }, delayMs);
  }

  async function initTree(seq: number) {
    try {
      console.log('[room-tree] initTree: calling roomTreeGetRoot API...');
      const resp = await roomTreeGetRoot();
      console.log('[room-tree] initTree: API response:', resp);
      if (!resp.success || !resp.node) {
        throw new Error(resp.error_message || 'room-tree root api failed');
      }

      if (seq !== initSeq) return;

      clearInitRetry();

      const root = dtoToTreeNode(resp.node, null);

      nodesById.value = {
        [root.id]: root,
      };
      rootIds.value = [root.id];

      const nextChildrenCount = new Map<string, number | null>();
      nextChildrenCount.set(root.id, resp.node.children_count ?? null);
      childrenCountById.value = nextChildrenCount;

      rebuildInitialChecks();

      void ensureChildrenLoaded(root.id);
      expandedIds.value = new Set([root.id]);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[room-tree] initTree failed', e);
      }
      if (seq === initSeq) {
        resetAllState();
        scheduleInitRetry(seq);
      }
    }
  }

  watch(
    () => [viewerRef.value, enabled.value] as const,
    ([viewer, en]) => {
      initSeq++;
      const seq = initSeq;

      console.log('[room-tree] watch triggered, viewer:', viewer ? 'exists' : 'null', 'enabled:', en);

      clearInitRetry();

      if (!viewer || !en) {
        console.log('[room-tree] skipping init: viewer or enabled is falsy');
        resetAllState();
        return;
      }

      console.log('[room-tree] calling initTree, seq:', seq);
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
    allTypes,
    filteredTypes,

    toggleExpand,
    setFilter,
    setTypeQuery,
    toggleType,

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
