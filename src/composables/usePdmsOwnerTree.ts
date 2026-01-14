import { computed, ref, shallowRef, watch } from 'vue'

import type { CheckState, FlatRow, TreeNode } from '@/composables/useModelTree'
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer'

import {
  e3dGetAncestors,
  e3dGetChildren,
  e3dSearch,
  e3dGetVisibleInsts,
  e3dGetSubtreeRefnos,
  e3dGetWorldRoot,
  type TreeNodeDto,
} from '@/api/genModelE3dApi'

export const NOUN_TYPES = [
  'PIPE', 'BRAN', 'EQUI', 'SUPP', 'STRU', 'WALL', 'SWALL', 'GWALL',
  'VALV', 'ELBO', 'TEE', 'FLAN', 'CATE', 'HANG', 'FITT',
] as const

export type NounType = typeof NOUN_TYPES[number]

function dtoToTreeNode(dto: TreeNodeDto, parentId: string | null): TreeNode {
  return {
    id: dto.refno,
    name: dto.name,
    type: dto.noun,
    parentId,
    childrenIds: [],
  }
}

export function usePdmsOwnerTree(viewerRef: { value: DtxCompatViewer | null }) {
  const nodesById = shallowRef<Record<string, TreeNode>>({})
  const rootIds = ref<string[]>([])

  const expandedIds = ref<Set<string>>(new Set())
  const selectedIds = ref<Set<string>>(new Set())
  const lastAnchorIndex = ref<number | null>(null)

  const filterText = ref('')
  const typeQuery = ref('')
  const selectedTypes = ref<Set<string>>(new Set())
  const customTypes = ref<Set<string>>(new Set())

  const searchItems = ref<TreeNodeDto[]>([])
  const searchLoading = ref(false)
  const searchError = ref<string | null>(null)

  const checkStateById = ref<Map<string, CheckState>>(new Map())

  const childrenCountById = ref<Map<string, number | null>>(new Map())
  const childrenLoadedById = new Set<string>()
  const childrenLoadingById = new Set<string>()

  const subtreeObjectIdsCache = ref<Map<string, string[]>>(new Map())
  const subtreeObjectIdsInFlight = new Map<string, Promise<string[]>>()

  const SUBTREE_MAX_DEPTH = 256
  const SUBTREE_LIMIT = 200_000

  function clearCaches() {
    subtreeObjectIdsCache.value.clear()
    subtreeObjectIdsInFlight.clear()
  }

  function resetAllState() {
    nodesById.value = {}
    rootIds.value = []
    expandedIds.value = new Set()
    selectedIds.value = new Set()
    lastAnchorIndex.value = null

    filterText.value = ''
    typeQuery.value = ''
    selectedTypes.value = new Set()
    customTypes.value = new Set()

    searchItems.value = []
    searchLoading.value = false
    searchError.value = null

    checkStateById.value = new Map()
    childrenCountById.value = new Map()
    childrenLoadedById.clear()
    childrenLoadingById.clear()
    clearCaches()
  }

  function rebuildInitialChecks() {
    const next = new Map<string, CheckState>()
    for (const id of Object.keys(nodesById.value)) {
      next.set(id, 'unchecked')
    }
    checkStateById.value = next
  }

  function matchesFilter(node: TreeNode) {
    const q = filterText.value.trim().toLowerCase()
    const typeSet = selectedTypes.value
    const textOk = !q || node.name.toLowerCase().includes(q)
    const typeOk = typeSet.size === 0 || typeSet.has(node.type)
    return textOk && typeOk
  }

  const allTypes = computed(() => {
    const set = new Set<string>()
    for (const id of Object.keys(nodesById.value)) {
      const t = nodesById.value[id]?.type
      if (t) set.add(t)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  })

  const filteredTypes = computed(() => {
    const q = typeQuery.value.trim().toLowerCase()
    const list = allTypes.value
    if (!q) return list
    return list.filter((t) => t.toLowerCase().includes(q))
  })

  const flatRows = computed(() => {
    const nodes = nodesById.value
    const roots = rootIds.value
    const out: FlatRow[] = []

    const hasText = filterText.value.trim().length > 0
    const hasType = selectedTypes.value.size > 0
    const filterActive = hasText || hasType

    const matchMemo = new Map<string, boolean>()
    const matchVisiting = new Set<string>()

    const subtreeMatches = (id: string): boolean => {
      const cached = matchMemo.get(id)
      if (cached !== undefined) return cached

      if (matchVisiting.has(id)) {
        matchMemo.set(id, false)
        return false
      }
      matchVisiting.add(id)

      const node = nodes[id]
      if (!node) {
        matchVisiting.delete(id)
        matchMemo.set(id, false)
        return false
      }

      let ok = matchesFilter(node)
      if (!ok) {
        for (const childId of node.childrenIds) {
          if (subtreeMatches(childId)) {
            ok = true
            break
          }
        }
      }

      matchMemo.set(id, ok)
      matchVisiting.delete(id)
      return ok
    }

    const hasChildren = (id: string, node: TreeNode): boolean => {
      if (node.childrenIds.length > 0) return true
      const cnt = childrenCountById.value.get(id)
      return typeof cnt === 'number' && cnt > 0
    }

    const visited = new Set<string>()
    const MAX_DEPTH = 256

    const build = (id: string, depth: number) => {
      if (depth > MAX_DEPTH) return
      if (visited.has(id)) return
      visited.add(id)

      const node = nodes[id]
      if (!node) return

      if (filterActive && !subtreeMatches(id)) return

      out.push({
        id: node.id,
        name: node.name,
        type: node.type,
        depth,
        hasChildren: hasChildren(id, node),
      })

      const shouldExpand = filterActive || expandedIds.value.has(id)
      if (!shouldExpand) return

      for (const childId of node.childrenIds) {
        build(childId, depth + 1)
      }
    }

    for (const rootId of roots) build(rootId, 0)
    return out
  })

  async function ensureChildrenLoaded(parentId: string) {
    const parent = nodesById.value[parentId]
    if (!parent) return

    if (childrenLoadedById.has(parentId) || childrenLoadingById.has(parentId)) return

    childrenLoadingById.add(parentId)
    try {
      const resp = await e3dGetChildren(parentId, 2000)
      if (!resp.success) throw new Error(resp.error_message || 'children api failed')

      const nextNodes: Record<string, TreeNode> = { ...nodesById.value }
      const nextChildrenCount = new Map(childrenCountById.value)

      const parentCheck = checkStateById.value.get(parentId) || 'unchecked'
      const inheritState: CheckState = parentCheck === 'unchecked' ? 'unchecked' : 'checked'

      const childrenIds: string[] = []
      for (const dto of resp.children) {
        const id = dto.refno
        childrenIds.push(id)

        const existing = nextNodes[id]
        if (!existing) {
          nextNodes[id] = dtoToTreeNode(dto, parentId)
        } else {
          nextNodes[id] = { ...existing, parentId }
        }

        nextChildrenCount.set(id, dto.children_count ?? null)

        if (!checkStateById.value.has(id)) {
          checkStateById.value.set(id, inheritState)
        }
      }

      nextNodes[parentId] = { ...parent, childrenIds }

      nodesById.value = nextNodes
      childrenCountById.value = nextChildrenCount
      childrenLoadedById.add(parentId)
      clearCaches()
    } finally {
      childrenLoadingById.delete(parentId)
    }
  }

  function toggleExpand(id: string) {
    const set = new Set(expandedIds.value)
    if (set.has(id)) {
      set.delete(id)
      expandedIds.value = set
      return
    }

    set.add(id)
    expandedIds.value = set
    void ensureChildrenLoaded(id)
  }

  function setFilter(text: string) {
    filterText.value = text
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  watch(
    () => [filterText.value, selectedTypes.value] as const,
    ([text, types]) => {
      const q = text.trim()

      if (searchTimer) {
        clearTimeout(searchTimer)
        searchTimer = null
      }

      if (q.length < 2) {
        searchItems.value = []
        searchLoading.value = false
        searchError.value = null
        return
      }

      const seq = ++searchSeq
      searchTimer = setTimeout(() => {
        void (async () => {
          searchLoading.value = true
          searchError.value = null
          try {
            const nouns = types.size > 0 ? Array.from(types) : undefined
            const resp = await e3dSearch({ keyword: q, nouns, limit: 50 })
            if (seq !== searchSeq) return
            if (!resp.success) {
              searchItems.value = []
              searchError.value = resp.error_message || 'search failed'
              return
            }
            searchItems.value = resp.items
          } catch (e) {
            if (seq !== searchSeq) return
            searchItems.value = []
            searchError.value = e instanceof Error ? e.message : String(e)
          } finally {
            if (seq === searchSeq) searchLoading.value = false
          }
        })()
      }, 250)
    }
  )

  function setTypeQuery(text: string) {
    typeQuery.value = text
  }

  function toggleType(type: string) {
    const set = new Set(selectedTypes.value)
    if (set.has(type)) {
      set.delete(type)
    } else {
      set.add(type)
    }
    selectedTypes.value = set
  }

  function selectAllTypes() {
    const set = new Set<string>(NOUN_TYPES)
    for (const t of customTypes.value) set.add(t)
    selectedTypes.value = set
  }

  function clearAllTypes() {
    selectedTypes.value = new Set()
  }

  function addCustomType(type: string) {
    const t = type.trim().toUpperCase()
    if (!t) return false
    if (NOUN_TYPES.includes(t as NounType)) return false
    if (customTypes.value.has(t)) return false

    const newCustom = new Set(customTypes.value)
    newCustom.add(t)
    customTypes.value = newCustom

    const newSelected = new Set(selectedTypes.value)
    newSelected.add(t)
    selectedTypes.value = newSelected

    return true
  }

  function removeCustomType(type: string) {
    const newCustom = new Set(customTypes.value)
    newCustom.delete(type)
    customTypes.value = newCustom

    const newSelected = new Set(selectedTypes.value)
    newSelected.delete(type)
    selectedTypes.value = newSelected
  }

  async function getObjectIdsForSubtree(id: string): Promise<string[]> {
    const viewer = viewerRef.value
    if (!viewer) return []

    const cached = subtreeObjectIdsCache.value.get(id)
    if (cached) return cached

    const inflight = subtreeObjectIdsInFlight.get(id)
    if (inflight) return await inflight

    const p = (async () => {
      const resp = await e3dGetSubtreeRefnos(id, {
        includeSelf: true,
        maxDepth: SUBTREE_MAX_DEPTH,
        limit: SUBTREE_LIMIT,
      })

      if (!resp.success) {
        throw new Error(resp.error_message || 'subtree-refnos api failed')
      }

      const filtered = (resp.refnos || []).filter((oid) => !!viewer.scene.objects[oid])
      subtreeObjectIdsCache.value.set(id, filtered)
      return filtered
    })()

    subtreeObjectIdsInFlight.set(id, p)
    try {
      return await p
    } finally {
      subtreeObjectIdsInFlight.delete(id)
    }
  }

  function setCheckStateDeep(id: string, state: CheckState) {
    const nodes = nodesById.value
    const stack: string[] = [id]
    while (stack.length > 0) {
      const cur = stack.pop()
      if (!cur) continue
      checkStateById.value.set(cur, state)
      const node = nodes[cur]
      if (!node) continue
      for (const childId of node.childrenIds) stack.push(childId)
    }
  }

  function recomputeParents(id: string) {
    const nodes = nodesById.value
    let cur: string | null = id

    while (cur) {
      const node: TreeNode | undefined = nodes[cur]
      const parentId: string | null = node?.parentId ?? null
      if (!parentId) break

      const parent = nodes[parentId]
      if (!parent) break

      let checkedCount = 0
      let uncheckedCount = 0
      let indeterminate = false

      for (const childId of parent.childrenIds) {
        const state = checkStateById.value.get(childId) || 'checked'
        if (state === 'indeterminate') {
          indeterminate = true
          break
        }
        if (state === 'checked') checkedCount++
        if (state === 'unchecked') uncheckedCount++
      }

      let parentState: CheckState
      if (indeterminate) {
        parentState = 'indeterminate'
      } else if (uncheckedCount === 0 && checkedCount > 0) {
        parentState = 'checked'
      } else if (checkedCount === 0 && uncheckedCount > 0) {
        parentState = 'unchecked'
      } else {
        parentState = 'indeterminate'
      }

      checkStateById.value.set(parentId, parentState)
      cur = parentId
    }
  }

  async function setVisible(id: string, visible: boolean) {
    const viewer = viewerRef.value
    if (!viewer) return

    const node = nodesById.value[id]
    const hasChild = (nodeId: string, n?: TreeNode): boolean => {
      const node = n ?? nodesById.value[nodeId]
      if (!node) return false
      if (node.childrenIds.length > 0) return true
      const cnt = childrenCountById.value.get(nodeId)
      return typeof cnt === 'number' && cnt > 0
    }

    const resolveTargetRefnos = async (): Promise<string[]> => {
      if (node && !hasChild(id, node)) return [id]

      if (node && (node.type === 'BRAN' || node.type === 'HANG')) {
        const resp = await e3dGetSubtreeRefnos(id, {
          includeSelf: true,
          maxDepth: SUBTREE_MAX_DEPTH,
          limit: SUBTREE_LIMIT,
        })
        if (!resp.success) throw new Error(resp.error_message || 'subtree-refnos api failed')
        return resp.refnos || []
      }

      const resp = await e3dGetVisibleInsts(id)
      if (!resp.success) throw new Error(resp.error_message || 'visible-insts api failed')
      return resp.refnos || []
    }

    let targetRefnos: string[] = []
    try {
      targetRefnos = await resolveTargetRefnos()
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn('[pdms-tree] resolveTargetRefnos failed', {
          id,
          visible,
          err: e instanceof Error ? e.message : String(e),
        })
      }
      targetRefnos = []
    }

    const loaded = targetRefnos.filter((r) => !!viewer.scene.objects[r])
    const finalIds = loaded.length > 0 ? loaded : (viewer.scene.objects[id] ? [id] : [])
    if (finalIds.length > 0) {
      viewer.scene.setObjectsVisible(finalIds, visible)
    }

    setCheckStateDeep(id, visible ? 'checked' : 'unchecked')
    recomputeParents(id)
  }

  function clearSelectionInScene(viewer: DtxCompatViewer) {
    const selectedObjectIds = viewer.scene.selectedObjectIds
    if (selectedObjectIds && selectedObjectIds.length > 0) {
      viewer.scene.setObjectsSelected(selectedObjectIds, false)
    }
  }

  async function syncSceneSelection() {
    const viewer = viewerRef.value
    if (!viewer) return

    clearSelectionInScene(viewer)

    const union = new Set<string>()
    for (const id of selectedIds.value) {
      try {
        const objIds = await getObjectIdsForSubtree(id)
        for (const objId of objIds) union.add(objId)
      } catch {
        void 0
      }
    }

    const list = Array.from(union)
    if (list.length > 0) {
      viewer.scene.setObjectsSelected(list, true)
    }
  }

  function selectByRowIndex(index: number, ev: MouseEvent) {
    const rows = flatRows.value
    if (index < 0 || index >= rows.length) return

    const id = rows[index]?.id
    if (!id) return

    const metaKey = ev.metaKey || ev.ctrlKey
    const shiftKey = ev.shiftKey

    if (shiftKey && lastAnchorIndex.value !== null) {
      const a = lastAnchorIndex.value
      const start = Math.min(a, index)
      const end = Math.max(a, index)
      const next = new Set(selectedIds.value)
      for (const row of rows.slice(start, end + 1)) next.add(row.id)
      selectedIds.value = next
    } else if (metaKey) {
      const next = new Set(selectedIds.value)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectedIds.value = next
      lastAnchorIndex.value = index
    } else {
      selectedIds.value = new Set([id])
      lastAnchorIndex.value = index
    }

    void syncSceneSelection()
  }

  async function flyTo(id: string) {
    const viewer = viewerRef.value
    if (!viewer) return

    const objectIds = await getObjectIdsForSubtree(id).catch(() => [])
    if (objectIds.length === 0) return

    const aabb = viewer.scene.getAABB(objectIds)
    viewer.cameraFlight.flyTo({ aabb })
  }

  async function isolateXray(id: string) {
    const viewer = viewerRef.value
    if (!viewer) return

    const allObjectIds = viewer.scene.objectIds
    if (allObjectIds && allObjectIds.length > 0) {
      viewer.scene.setObjectsXRayed(allObjectIds, true)
    }

    const objectIds = await getObjectIdsForSubtree(id).catch(() => [])
    if (objectIds.length > 0) {
      viewer.scene.setObjectsXRayed(objectIds, false)
      viewer.scene.setObjectsVisible(objectIds, true)
    }
  }

  function clearXray() {
    const viewer = viewerRef.value
    if (!viewer) return

    const allObjectIds = viewer.scene.objectIds
    if (allObjectIds && allObjectIds.length > 0) {
      viewer.scene.setObjectsXRayed(allObjectIds, false)
    }
  }

  function getCheckState(id: string): CheckState {
    return checkStateById.value.get(id) || 'unchecked'
  }

  async function ensureNodeAttached(parentId: string, childId: string) {
    await ensureChildrenLoaded(parentId)

    let parent = nodesById.value[parentId]
    if (!parent) return

    if (!nodesById.value[childId]) {
      await ensureChildrenLoaded(parentId)
    }

    const child = nodesById.value[childId]
    if (!child) return

    if (child.parentId !== parentId) {
      nodesById.value = {
        ...nodesById.value,
        [childId]: { ...child, parentId },
      }
    }

    parent = nodesById.value[parentId]
    if (!parent) return

    if (!parent.childrenIds.includes(childId)) {
      nodesById.value = {
        ...nodesById.value,
        [parentId]: { ...parent, childrenIds: [...parent.childrenIds, childId] },
      }
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
    const viewer = viewerRef.value
    if (!viewer) return

    const fly = options?.flyTo ?? true
    const syncScene = options?.syncSceneSelection ?? true
    const clearSearch = options?.clearSearch ?? true

    const rootId = rootIds.value[0]
    if (!rootId) return

    const resp = await e3dGetAncestors(refno)
    if (!resp.success) throw new Error(resp.error_message || 'ancestors failed')

    const ancestors = resp.refnos || []
    if (ancestors.length === 0) return

    const path = [...ancestors].reverse()
    const nextExpanded = new Set(expandedIds.value)
    nextExpanded.add(rootId)

    let parentId = rootId
    for (let i = 0; i < path.length; i++) {
      const curId = path[i]!
      await ensureNodeAttached(parentId, curId)
      if (i < path.length - 1) nextExpanded.add(curId)
      parentId = curId
    }

    expandedIds.value = nextExpanded
    selectedIds.value = new Set([refno])

    if (syncScene) await syncSceneSelection()
    if (fly) await flyTo(refno)

    if (clearSearch) {
      filterText.value = ''
      searchItems.value = []
      searchLoading.value = false
      searchError.value = null
    }
  }

  let initSeq = 0
  let initRetryTimer: ReturnType<typeof setTimeout> | null = null
  let initRetryCount = 0

  function clearInitRetry() {
    if (initRetryTimer) {
      clearTimeout(initRetryTimer)
      initRetryTimer = null
    }
    initRetryCount = 0
  }

  function scheduleInitRetry(seq: number) {
    if (seq !== initSeq) return
    if (!viewerRef.value) return
    if (initRetryTimer) return

    const next = initRetryCount + 1
    if (next > 5) return
    initRetryCount = next

    const delayMs = Math.min(8000, 500 * 2 ** (next - 1))
    initRetryTimer = setTimeout(() => {
      initRetryTimer = null
      if (seq !== initSeq) return
      if (!viewerRef.value) return
      void initTree(seq)
    }, delayMs)
  }

  async function initTree(seq: number) {
    try {
      const resp = await e3dGetWorldRoot()
      if (!resp.success || !resp.node) throw new Error(resp.error_message || 'world-root api failed')
      if (seq !== initSeq) return

      clearInitRetry()

      const root = dtoToTreeNode(resp.node, null)
      nodesById.value = { [root.id]: root }
      rootIds.value = [root.id]

      const nextChildrenCount = new Map<string, number | null>()
      nextChildrenCount.set(root.id, resp.node.children_count ?? null)
      childrenCountById.value = nextChildrenCount

      clearCaches()
      rebuildInitialChecks()

      void ensureChildrenLoaded(root.id)
      expandedIds.value = new Set([root.id])
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('[pdms-tree] initTree failed', e)
      }
      if (seq === initSeq) {
        resetAllState()
        scheduleInitRetry(seq)
      }
    }
  }

  watch(
    () => viewerRef.value,
    (viewer) => {
      initSeq++
      const seq = initSeq

      clearInitRetry()

      if (!viewer) {
        resetAllState()
        return
      }

      resetAllState()
      void initTree(seq)
    },
    { immediate: true }
  )

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
  }
}

