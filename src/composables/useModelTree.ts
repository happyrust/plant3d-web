import { computed, ref, shallowRef, watch } from 'vue';

import type { Viewer } from '@xeokit/xeokit-sdk';

export type CheckState = 'checked' | 'unchecked' | 'indeterminate';

export type TreeNode = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  childrenIds: string[];
};

export type FlatRow = {
  id: string;
  name: string;
  type: string;
  depth: number;
  hasChildren: boolean;
};

type MetaObjectLike = {
  id: string | number;
  name?: string;
  type?: string;
  parent?: MetaObjectLike | null;
  children?: MetaObjectLike[];
};

type MetaModelLike = {
  id: string | number;
  rootMetaObjects?: MetaObjectLike[];
  rootMetaObject?: MetaObjectLike | null;
  metaObjects?: Record<string, MetaObjectLike>;
};

type MetaSceneLike = {
  metaModels?: Record<string, MetaModelLike>;
  getObjectIDsInSubtree: (id: string, includeTypes?: string[], excludeTypes?: string[]) => string[];
  on: (event: string, cb: (value: unknown) => void) => void;
};

function normalizeId(id: string | number) {
  return String(id);
}

export function useModelTree(viewerRef: { value: Viewer | null }) {
  const nodesById = shallowRef<Record<string, TreeNode>>({});
  const rootIds = ref<string[]>([]);

  const autoExpandDepth = 3;

  const expandedIds = ref<Set<string>>(new Set());
  const selectedIds = ref<Set<string>>(new Set());
  const lastAnchorIndex = ref<number | null>(null);

  const filterText = ref('');
  const typeQuery = ref('');
  const selectedTypes = ref<Set<string>>(new Set());

  const checkStateById = ref<Map<string, CheckState>>(new Map());

  const subtreeObjectIdsCache = ref<Map<string, string[]>>(new Map());

  function clearCaches() {
    subtreeObjectIdsCache.value.clear();
  }

  function rebuildInitialChecks() {
    const next = new Map<string, CheckState>();
    const ids = Object.keys(nodesById.value);
    for (const id of ids) {
      next.set(id, 'checked');
    }
    checkStateById.value = next;
  }

  function buildFromMetaScene(viewer: Viewer) {
    const metaScene = viewer.metaScene as unknown as MetaSceneLike;
    const nextNodes: Record<string, TreeNode> = {};
    const nextRoots: string[] = [];

    const metaModels = metaScene.metaModels || {};
    for (const modelIdRaw of Object.keys(metaModels)) {
      const metaModel = metaModels[modelIdRaw];
      if (!metaModel) continue;

      const modelId = normalizeId(metaModel.id ?? modelIdRaw);
      const modelRootId = `model:${modelId}`;

      const rootMetaObjects = metaModel.rootMetaObjects
        ? metaModel.rootMetaObjects
        : (metaModel.rootMetaObject ? [metaModel.rootMetaObject] : []);

      const modelChildren = rootMetaObjects.map((o) => normalizeId(o.id));

      nextNodes[modelRootId] = {
        id: modelRootId,
        name: String(metaModel.id ?? modelId),
        type: 'Model',
        parentId: null,
        childrenIds: modelChildren
      };
      nextRoots.push(modelRootId);

      const modelMetaObjects = metaModel.metaObjects || {};
      for (const metaObjectIdRaw of Object.keys(modelMetaObjects)) {
        const metaObject = modelMetaObjects[metaObjectIdRaw];
        if (!metaObject) continue;

        const id = normalizeId(metaObject.id);
        const parentId = metaObject.parent ? normalizeId(metaObject.parent.id) : null;
        const childrenIds = (metaObject.children || []).map((c) => normalizeId(c.id));

        nextNodes[id] = {
          id,
          name: String(metaObject.name || id),
          type: String(metaObject.type || 'Unknown'),
          parentId,
          childrenIds
        };
      }

      for (const childId of modelChildren) {
        const child = nextNodes[childId];
        if (child) {
          nextNodes[childId] = { ...child, parentId: modelRootId };
        }
      }
    }

    nodesById.value = nextNodes;
    rootIds.value = nextRoots;

    const initialExpanded = new Set<string>();
    for (const rootId of nextRoots) {
      const stack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) continue;
        if (cur.depth >= autoExpandDepth) continue;

        const node = nextNodes[cur.id];
        if (!node) continue;
        if (node.childrenIds.length === 0) continue;

        initialExpanded.add(cur.id);
        for (const childId of node.childrenIds) {
          stack.push({ id: childId, depth: cur.depth + 1 });
        }
      }
    }

    expandedIds.value = initialExpanded;
    selectedIds.value = new Set();
    lastAnchorIndex.value = null;
    clearCaches();
    rebuildInitialChecks();

    if (import.meta.env.DEV) {
      const metaSceneAny = viewer.metaScene as unknown as { metaModels?: Record<string, unknown>; metaObjects?: Record<string, unknown> };
      const metaModelsCount = Object.keys(metaSceneAny.metaModels || {}).length;
      const metaObjectsCount = Object.keys(metaSceneAny.metaObjects || {}).length;
      const nodeCount = Object.keys(nextNodes).length;
      console.debug('[model-tree] buildFromMetaScene', {
        metaModelsCount,
        metaObjectsCount,
        nodeCount,
        roots: nextRoots,
      });
    }
  }

  function ensureBuilt() {
    const viewer = viewerRef.value;
    if (!viewer) {
      nodesById.value = {};
      rootIds.value = [];
      expandedIds.value = new Set();
      selectedIds.value = new Set();
      checkStateById.value = new Map();
      subtreeObjectIdsCache.value = new Map();
      return;
    }

    buildFromMetaScene(viewer);
  }

  watch(
    () => viewerRef.value,
    (viewer) => {
      if (!viewer) {
        ensureBuilt();
        return;
      }

      ensureBuilt();

      const metaScene = viewer.metaScene as unknown as MetaSceneLike;
      metaScene.on('metaModelCreated', (id: unknown) => {
        if (import.meta.env.DEV) {
          console.debug('[model-tree] metaModelCreated', id);
        }
        buildFromMetaScene(viewer);
      });
    },
    { immediate: true }
  );

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

  function matchesFilter(node: TreeNode) {
    const q = filterText.value.trim().toLowerCase();
    const typeSet = selectedTypes.value;

    const textOk = !q || node.name.toLowerCase().includes(q);
    const typeOk = typeSet.size === 0 || typeSet.has(node.type);
    return textOk && typeOk;
  }

  function flatten() {
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
        hasChildren: node.childrenIds.length > 0
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
  }

  const flatRows = computed(() => flatten());

  function toggleExpand(id: string) {
    const set = new Set(expandedIds.value);
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    expandedIds.value = set;
  }

  function setFilter(text: string) {
    filterText.value = text;
  }

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

  function getObjectIdsForSubtree(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return [];

    const cached = subtreeObjectIdsCache.value.get(id);
    if (cached) return cached;

    const metaScene = viewer.metaScene as unknown as MetaSceneLike;
    const node = nodesById.value[id];

    let raw: string[];

    if (node?.type === 'Model' && node.childrenIds.length > 0) {
      const union = new Set<string>();
      for (const childRootId of node.childrenIds) {
        const sub = metaScene.getObjectIDsInSubtree(childRootId);
        for (const oid of sub) union.add(oid);
      }
      raw = Array.from(union);
    } else {
      raw = metaScene.getObjectIDsInSubtree(id);
    }

    const filtered = raw.filter((oid) => !!viewer.scene.objects[oid]);
    subtreeObjectIdsCache.value.set(id, filtered);
    return filtered;
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
    const viewer = viewerRef.value;
    if (!viewer) return;

    const objectIds = getObjectIdsForSubtree(id);
    if (objectIds.length > 0) {
      viewer.scene.setObjectsVisible(objectIds, visible);
    }

    setCheckStateDeep(id, visible ? 'checked' : 'unchecked');
    recomputeParents(id);
  }

  function clearSelectionInScene(viewer: Viewer) {
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
      const objIds = getObjectIdsForSubtree(id);
      for (const objId of objIds) union.add(objId);
    }

    const list = Array.from(union);
    if (list.length > 0) {
      viewer.scene.setObjectsSelected(list, true);
    }
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

    const objectIds = getObjectIdsForSubtree(id);
    if (objectIds.length === 0) return;

    const aabb = viewer.scene.getAABB(objectIds);
    viewer.cameraFlight.flyTo({ aabb });
  }

  function isolateXray(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const allObjectIds = viewer.scene.objectIds;
    if (allObjectIds && allObjectIds.length > 0) {
      viewer.scene.setObjectsXRayed(allObjectIds, true);
    }

    const objectIds = getObjectIdsForSubtree(id);
    if (objectIds.length > 0) {
      viewer.scene.setObjectsXRayed(objectIds, false);
      viewer.scene.setObjectsVisible(objectIds, true);
    }
  }

  function clearXray() {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const allObjectIds = viewer.scene.objectIds;
    if (allObjectIds && allObjectIds.length > 0) {
      viewer.scene.setObjectsXRayed(allObjectIds, false);
    }
  }

  function getCheckState(id: string): CheckState {
    return checkStateById.value.get(id) || 'checked';
  }

  /**
   * Expand ancestors and select a node in the tree
   * @param refno - The refno to expand and select
   */
  async function expandToRefno(refno: string) {
    // Check if node already exists in tree
    const existingNode = nodesById.value[refno];
    if (existingNode) {
      // Expand all ancestors
      const ancestorIds: string[] = [];
      let currentId: string | null = refno;
      while (currentId) {
        const node: TreeNode | undefined = nodesById.value[currentId];
        if (!node) break;
        if (node.parentId) {
          ancestorIds.push(node.parentId);
        }
        currentId = node.parentId;
      }

      // Expand all ancestors
      const newExpanded = new Set(expandedIds.value);
      for (const ancestorId of ancestorIds) {
        newExpanded.add(ancestorId);
      }
      expandedIds.value = newExpanded;

      // Select the node
      selectedIds.value = new Set([refno]);
      syncSceneSelection();
      flyTo(refno);
      return true;
    }

    return false;
  }

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

    getCheckState,
    setVisible,

    selectByRowIndex,

    flyTo,
    isolateXray,
    clearXray,
    expandToRefno
  };
}
