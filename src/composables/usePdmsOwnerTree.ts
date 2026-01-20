import { computed, ref, shallowRef, watch } from 'vue'

import type { CheckState, FlatRow, TreeNode } from '@/composables/useModelTree'
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer'
import { collectLoadedSubtreeIds, useSceneGraphOps } from '@/composables/useSceneGraph'

import {
  e3dGetAncestors,
  e3dGetChildren,
  e3dSearch,
  e3dGetWorldRoot,
  e3dGetSubtreeRefnos,
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
  const sceneGraph = useSceneGraphOps(viewerRef)

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

  const SUBTREE_MAX_DEPTH = 256
  const SUBTREE_LIMIT = 200_000

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
  }

  function rebuildInitialChecks() {
    const next = new Map<string, CheckState>()
    for (const id of Object.keys(nodesById.value)) {
      next.set(id, 'checked')
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

      // 按需加载：新加载到树里的节点也需要继承可见性状态，以便后续实例加载时能回放状态
      sceneGraph.setVisible(childrenIds, inheritState !== 'unchecked')
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

  function collectLoadedSubtreeRefnos(rootId: string): string[] {
    const nodes = nodesById.value
    return collectLoadedSubtreeIds(
      rootId,
      (id) => nodes[id]?.childrenIds,
      { maxDepth: SUBTREE_MAX_DEPTH, maxNodes: SUBTREE_LIMIT },
    )
  }

  /**
   * 从 web-server 查询指定 refno 的子树所有 refnos
   */
  async function querySubtreeRefnos(refno: string): Promise<string[]> {
    try {
      const normalizedRefno = refno.replace('/', '_')
      const resp = await e3dGetSubtreeRefnos(normalizedRefno)
      
      if (!resp.success) {
        console.error('[pdms-tree] querySubtreeRefnos failed:', resp.error_message)
        return []
      }

      // 将 RefnoEnum 格式 (17496_106028) 转换为前端格式 (17496/106028)
      return resp.refnos.map(r => String(r).replace('_', '/'))
    } catch (e) {
      console.error('[pdms-tree] querySubtreeRefnos error:', e)
      return []
    }
  }

  /**
   * 批量设置状态，只处理已加载到树中的节点，避免遍历大量未加载节点
   */
  async function setCheckStateDeep(id: string, state: CheckState) {
    const nodes = nodesById.value
    const stack: string[] = [id]
    const toUpdate: string[] = []
    
    // 先收集所有需要更新的节点（只处理已加载的）
    while (stack.length > 0) {
      const cur = stack.pop()
      if (!cur) continue
      
      // 只处理已加载到树中的节点
      if (nodes[cur]) {
        toUpdate.push(cur)
        const node = nodes[cur]
        if (node) {
          for (const childId of node.childrenIds) {
            if (nodes[childId]) {
              stack.push(childId)
            }
          }
        }
      }
    }
    
    // 批量更新状态，避免频繁触发响应式更新
    if (toUpdate.length > 0) {
      const batchSize = 1000
      for (let i = 0; i < toUpdate.length; i += batchSize) {
        const batch = toUpdate.slice(i, i + batchSize)
        for (const cur of batch) {
          checkStateById.value.set(cur, state)
        }
        
        // 让出控制权
        if (i + batchSize < toUpdate.length) {
          await new Promise(resolve => {
            if ('requestIdleCallback' in window) {
              requestIdleCallback(() => resolve(undefined), { timeout: 10 })
            } else {
              setTimeout(resolve, 1)
            }
          })
        }
      }
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

  function setVisible(id: string, visible: boolean) {
    const viewer = viewerRef.value
    if (!viewer) return

    // 1. 收集 refnos：隐藏时用后端 API，显示时用前端已加载节点
    let refnos: string[] = []
    // —— 全部暂时注释排查卡死 ——
    // if (!visible) {
    //   querySubtreeRefnos(id).then((r) => {
    //     if (r.length > 0) {
    //       const normalized = r.map((s) => String(s).replace('/', '_'))
    //       sceneGraph.setVisible(normalized, false)
    //     }
    //   }).catch(() => {})
    // }
    // refnos = collectLoadedSubtreeRefnos(id)
    // if (refnos.length === 0) refnos = [id]
    // refnos = refnos.map((r) => String(r).replace('/', '_'))
    // sceneGraph.setVisible(refnos, visible)
    // setCheckStateDeep(id, visible ? 'checked' : 'unchecked')
    // recomputeParents(id)
    console.log('[pdms-tree] setVisible called but all logic commented out for debugging:', id, visible)
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
      const ids = collectLoadedSubtreeRefnos(id)
      for (const refno of ids) union.add(refno)
    }

    const list = Array.from(union)
    if (list.length > 0) sceneGraph.setSelected(list, true)
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

    const refnos = collectLoadedSubtreeRefnos(id)
    if (refnos.length === 0) return

    const aabb = viewer.scene.getAABB(refnos)
    viewer.cameraFlight.flyTo({ aabb })
  }

  async function isolateXray(id: string) {
    const keep = collectLoadedSubtreeRefnos(id)
    sceneGraph.isolate(keep)
  }

  function clearXray() {
    sceneGraph.clearIsolation()
  }

  function getCheckState(id: string): CheckState {
    return checkStateById.value.get(id) || 'checked'
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
