/**
 * Scene Tree 驱动的模型树
 * 
 * 优先从 SurrealDB 加载场景树，Parquet 作为备选
 * 展开节点时从 instance Parquet 按需加载几何数据
 */

import { computed, ref, shallowRef, watch } from 'vue'
import type { Viewer } from '@xeokit/xeokit-sdk'
import { useSceneTreeLoader, type SceneTreeNode } from './useSceneTreeLoader'
import { useNodeGeometryLoader } from './useNodeGeometryLoader'

export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

export type TreeNode = {
    id: string
    name: string
    type: string          // noun (EQUI, STRU, TUBI, etc.)
    parentId: string | null
    childrenIds: string[]
    hasGeo: boolean
    isLeaf: boolean
    geoLoaded: boolean    // 几何数据是否已加载
}

export type FlatRow = {
    id: string
    name: string
    type: string
    depth: number
    hasChildren: boolean
    hasGeo: boolean
    geoLoaded: boolean
}

/**
 * Scene Tree 驱动的模型树
 */
export function useSceneTreeModelTree(viewerRef: { value: Viewer | null }) {
    // 子 composables
    const sceneTreeLoader = useSceneTreeLoader()
    const nodeGeometryLoader = useNodeGeometryLoader(viewerRef)

    // 当前加载的 dbno
    const currentDbno = ref<number | null>(null)

    // 树节点
    const nodesById = shallowRef<Record<string, TreeNode>>({})
    const rootIds = ref<string[]>([])

    // UI 状态
    const autoExpandDepth = 3
    const expandedIds = ref<Set<string>>(new Set())
    const selectedIds = ref<Set<string>>(new Set())
    const lastAnchorIndex = ref<number | null>(null)

    // 过滤
    const filterText = ref('')
    const typeQuery = ref('')
    const selectedTypes = ref<Set<string>>(new Set())

    // 勾选状态
    const checkStateById = ref<Map<string, CheckState>>(new Map())

    // 缓存
    const subtreeObjectIdsCache = ref<Map<string, string[]>>(new Map())

    // 正在加载几何的节点
    const loadingGeoIds = ref<Set<string>>(new Set())

    /**
     * 从 scene_tree Parquet 初始化模型树
     */
    async function initFromSceneTree(dbno: number): Promise<boolean> {
        console.log('[SceneTreeModelTree] Initializing from dbno:', dbno)

        // 1. 加载 scene tree 结构
        const ok = await sceneTreeLoader.loadSceneTree(dbno)
        if (!ok) {
            console.error('[SceneTreeModelTree] Failed to load scene tree')
            return false
        }

        currentDbno.value = dbno

        // 2. 转换为 TreeNode 格式
        const nextNodes: Record<string, TreeNode> = {}
        const nextRoots: string[] = []

        const entries = Array.from(sceneTreeLoader.nodesById.value.entries())
        for (const [id, sceneNode] of entries) {
            nextNodes[id] = {
                id,
                name: sceneNode.name,
                type: sceneNode.geoType || 'Unknown',
                parentId: sceneNode.parentId,
                childrenIds: sceneNode.childrenIds,
                hasGeo: sceneNode.hasGeo,
                isLeaf: sceneNode.isLeaf,
                geoLoaded: false,
            }
        }

        for (const rootId of sceneTreeLoader.rootIds.value) {
            nextRoots.push(rootId)
        }

        nodesById.value = nextNodes
        rootIds.value = nextRoots

        // 3. 初始化展开状态（前 N 层）
        const initialExpanded = new Set<string>()
        for (const rootId of nextRoots) {
            const stack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }]
            while (stack.length > 0) {
                const cur = stack.pop()
                if (!cur) continue
                if (cur.depth >= autoExpandDepth) continue

                const node = nextNodes[cur.id]
                if (!node) continue
                if (node.childrenIds.length === 0) continue

                initialExpanded.add(cur.id)
                for (const childId of node.childrenIds) {
                    stack.push({ id: childId, depth: cur.depth + 1 })
                }
            }
        }

        expandedIds.value = initialExpanded
        selectedIds.value = new Set()
        lastAnchorIndex.value = null
        subtreeObjectIdsCache.value.clear()
        rebuildInitialChecks()

        console.log(`[SceneTreeModelTree] Initialized: ${Object.keys(nextNodes).length} nodes, ${nextRoots.length} roots`)
        return true
    }

    /**
     * 重建初始勾选状态
     */
    function rebuildInitialChecks() {
        const next = new Map<string, CheckState>()
        const ids = Object.keys(nodesById.value)
        for (const id of ids) {
            next.set(id, 'checked')
        }
        checkStateById.value = next
    }

    /**
     * 获取所有类型
     */
    const allTypes = computed(() => {
        const set = new Set<string>()
        for (const id of Object.keys(nodesById.value)) {
            const t = nodesById.value[id]?.type
            if (t && t !== 'Unknown') set.add(t)
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    })

    /**
     * 过滤后的类型列表
     */
    const filteredTypes = computed(() => {
        const q = typeQuery.value.trim().toLowerCase()
        const list = allTypes.value
        if (!q) return list
        return list.filter((t) => t.toLowerCase().includes(q))
    })

    /**
     * 检查节点是否匹配过滤条件
     */
    function matchesFilter(node: TreeNode) {
        const q = filterText.value.trim().toLowerCase()
        const typeSet = selectedTypes.value

        const textOk = !q || node.name.toLowerCase().includes(q)
        const typeOk = typeSet.size === 0 || typeSet.has(node.type)
        return textOk && typeOk
    }

    /**
     * 扁平化树结构
     */
    function flatten(): FlatRow[] {
        const nodes = nodesById.value
        const roots = rootIds.value
        const out: FlatRow[] = []

        const hasText = filterText.value.trim().length > 0
        const hasType = selectedTypes.value.size > 0
        const filterActive = hasText || hasType

        const matchMemo = new Map<string, boolean>()

        const subtreeMatches = (id: string): boolean => {
            const cached = matchMemo.get(id)
            if (cached !== undefined) return cached

            const node = nodes[id]
            if (!node) {
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
            return ok
        }

        const build = (id: string, depth: number) => {
            const node = nodes[id]
            if (!node) return

            if (filterActive && !subtreeMatches(id)) {
                return
            }

            out.push({
                id: node.id,
                name: node.name,
                type: node.type,
                depth,
                hasChildren: node.childrenIds.length > 0,
                hasGeo: node.hasGeo,
                geoLoaded: node.geoLoaded,
            })

            const shouldExpand = filterActive || expandedIds.value.has(id)
            if (!shouldExpand) return

            for (const childId of node.childrenIds) {
                build(childId, depth + 1)
            }
        }

        for (const rootId of roots) {
            build(rootId, 0)
        }

        return out
    }

    const flatRows = computed(() => flatten())

    /**
     * 展开/折叠节点（带懒加载）
     */
    async function toggleExpand(id: string) {
        const set = new Set(expandedIds.value)

        if (set.has(id)) {
            // 折叠
            set.delete(id)
            expandedIds.value = set
            return
        }

        // 展开
        set.add(id)
        expandedIds.value = set

        // 触发子节点几何加载
        await ensureChildrenGeometryLoaded(id)
    }

    /**
     * 确保子节点的几何数据已加载
     */
    async function ensureChildrenGeometryLoaded(parentId: string) {
        const dbno = currentDbno.value
        if (!dbno) return

        const node = nodesById.value[parentId]
        if (!node) return

        // 收集需要加载几何的子节点
        const toLoad: string[] = []
        for (const childId of node.childrenIds) {
            const child = nodesById.value[childId]
            if (child && child.hasGeo && !child.geoLoaded && !loadingGeoIds.value.has(childId)) {
                toLoad.push(childId)
            }
        }

        if (toLoad.length === 0) return

        console.log(`[SceneTreeModelTree] Loading geometry for ${toLoad.length} children of ${parentId}`)

        // 标记为加载中
        const newLoading = new Set(loadingGeoIds.value)
        for (const id of toLoad) {
            newLoading.add(id)
        }
        loadingGeoIds.value = newLoading

        try {
            // 批量加载几何
            await nodeGeometryLoader.loadNodesGeometry(dbno, toLoad)

            // 更新节点状态
            const updatedNodes = { ...nodesById.value }
            for (const id of toLoad) {
                if (updatedNodes[id] && nodeGeometryLoader.isLoaded(id)) {
                    updatedNodes[id] = { ...updatedNodes[id], geoLoaded: true }
                }
            }
            nodesById.value = updatedNodes

        } finally {
            // 移除加载中标记
            const nextLoading = new Set(loadingGeoIds.value)
            for (const id of toLoad) {
                nextLoading.delete(id)
            }
            loadingGeoIds.value = nextLoading
        }
    }

    /**
     * 设置过滤文本
     */
    function setFilter(text: string) {
        filterText.value = text
    }

    /**
     * 设置类型查询
     */
    function setTypeQuery(text: string) {
        typeQuery.value = text
    }

    /**
     * 切换类型选择
     */
    function toggleType(type: string) {
        const set = new Set(selectedTypes.value)
        if (set.has(type)) {
            set.delete(type)
        } else {
            set.add(type)
        }
        selectedTypes.value = set
    }

    /**
     * 获取子树对象 ID
     */
    function getObjectIdsForSubtree(id: string): string[] {
        const viewer = viewerRef.value
        if (!viewer) return []

        const cached = subtreeObjectIdsCache.value.get(id)
        if (cached) return cached

        // 递归收集所有后代节点 ID
        const nodes = nodesById.value
        const result: string[] = []
        const stack = [id]

        while (stack.length > 0) {
            const nodeId = stack.pop()
            if (!nodeId) continue

            const node = nodes[nodeId]
            if (!node) continue

            // 只添加有几何且已加载的节点
            if (node.hasGeo && node.geoLoaded) {
                // 检查 viewer 中是否存在这个对象
                if (viewer.scene.objects[nodeId]) {
                    result.push(nodeId)
                }
            }

            for (const childId of node.childrenIds) {
                stack.push(childId)
            }
        }

        subtreeObjectIdsCache.value.set(id, result)
        return result
    }

    /**
     * 设置子树勾选状态
     */
    function setCheckStateDeep(id: string, state: CheckState) {
        const nodes = nodesById.value
        const stack: string[] = [id]
        while (stack.length > 0) {
            const cur = stack.pop()
            if (!cur) continue
            checkStateById.value.set(cur, state)
            const node = nodes[cur]
            if (!node) continue
            for (const childId of node.childrenIds) {
                stack.push(childId)
            }
        }
    }

    /**
     * 重新计算父节点勾选状态
     */
    function recomputeParents(id: string) {
        const nodes = nodesById.value
        let cur: string | null = id

        while (cur) {
            const node = nodes[cur]
            const parentId = node?.parentId
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

    /**
     * 设置节点可见性
     */
    function setVisible(id: string, visible: boolean) {
        const viewer = viewerRef.value
        if (!viewer) return

        const objectIds = getObjectIdsForSubtree(id)
        if (objectIds.length > 0) {
            viewer.scene.setObjectsVisible(objectIds, visible)
        }

        setCheckStateDeep(id, visible ? 'checked' : 'unchecked')
        recomputeParents(id)
    }

    /**
     * 选择节点
     */
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
            for (const row of rows.slice(start, end + 1)) {
                next.add(row.id)
            }
            selectedIds.value = next
        } else if (metaKey) {
            const next = new Set(selectedIds.value)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            selectedIds.value = next
            lastAnchorIndex.value = index
        } else {
            selectedIds.value = new Set([id])
            lastAnchorIndex.value = index
        }

        syncSceneSelection()
    }

    /**
     * 同步场景选择状态
     */
    function syncSceneSelection() {
        const viewer = viewerRef.value
        if (!viewer) return

        // 清除现有选择
        const selectedObjectIds = viewer.scene.selectedObjectIds
        if (selectedObjectIds && selectedObjectIds.length > 0) {
            viewer.scene.setObjectsSelected(selectedObjectIds, false)
        }

        // 设置新选择
        const union = new Set<string>()
        const selectedArray = Array.from(selectedIds.value)
        for (const id of selectedArray) {
            const objIds = getObjectIdsForSubtree(id)
            for (const objId of objIds) union.add(objId)
        }

        const list = Array.from(union)
        if (list.length > 0) {
            viewer.scene.setObjectsSelected(list, true)
        }
    }

    /**
     * 飞到节点
     */
    function flyTo(id: string) {
        const viewer = viewerRef.value
        if (!viewer) return

        const objectIds = getObjectIdsForSubtree(id)
        if (objectIds.length === 0) return

        const aabb = viewer.scene.getAABB(objectIds)
        viewer.cameraFlight.flyTo({ aabb })
    }

    /**
     * 隔离显示节点
     */
    function isolateXray(id: string) {
        const viewer = viewerRef.value
        if (!viewer) return

        const allObjectIds = viewer.scene.objectIds
        if (allObjectIds && allObjectIds.length > 0) {
            viewer.scene.setObjectsXRayed(allObjectIds, true)
        }

        const objectIds = getObjectIdsForSubtree(id)
        if (objectIds.length > 0) {
            viewer.scene.setObjectsXRayed(objectIds, false)
            viewer.scene.setObjectsVisible(objectIds, true)
        }
    }

    /**
     * 清除 X-Ray
     */
    function clearXray() {
        const viewer = viewerRef.value
        if (!viewer) return

        const allObjectIds = viewer.scene.objectIds
        if (allObjectIds && allObjectIds.length > 0) {
            viewer.scene.setObjectsXRayed(allObjectIds, false)
        }
    }

    /**
     * 获取勾选状态
     */
    function getCheckState(id: string): CheckState {
        return checkStateById.value.get(id) || 'checked'
    }

    /**
     * 展开到指定 refno
     */
    async function expandToRefno(refno: string): Promise<boolean> {
        const node = nodesById.value[refno]
        if (!node) return false

        // 收集所有祖先节点
        const ancestorIds: string[] = []
        let currentId: string | null = refno
        while (currentId) {
            const n = nodesById.value[currentId]
            if (!n) break
            if (n.parentId) {
                ancestorIds.push(n.parentId)
            }
            currentId = n.parentId
        }

        // 展开所有祖先
        const newExpanded = new Set(expandedIds.value)
        for (const ancestorId of ancestorIds) {
            newExpanded.add(ancestorId)
        }
        expandedIds.value = newExpanded

        // 加载几何（如果需要）
        if (node.hasGeo && !node.geoLoaded && currentDbno.value) {
            await nodeGeometryLoader.loadNodeGeometry(currentDbno.value, refno)
            const updatedNodes = { ...nodesById.value }
            if (updatedNodes[refno]) {
                updatedNodes[refno] = { ...updatedNodes[refno], geoLoaded: true }
            }
            nodesById.value = updatedNodes
        }

        // 选择并飞到
        selectedIds.value = new Set([refno])
        syncSceneSelection()
        flyTo(refno)

        return true
    }

    /**
     * 清空
     */
    function clear() {
        nodesById.value = {}
        rootIds.value = []
        expandedIds.value = new Set()
        selectedIds.value = new Set()
        checkStateById.value = new Map()
        subtreeObjectIdsCache.value.clear()
        loadingGeoIds.value = new Set()
        currentDbno.value = null
        sceneTreeLoader.clear()
        nodeGeometryLoader.clear()
    }

    return {
        // 状态
        nodesById,
        rootIds,
        expandedIds,
        selectedIds,
        flatRows,
        currentDbno,
        loadingGeoIds,

        // 过滤
        filterText,
        typeQuery,
        selectedTypes,
        allTypes,
        filteredTypes,

        // 子加载器状态
        sceneTreeLoadingState: sceneTreeLoader.loadingState,
        geoLoadingState: nodeGeometryLoader.loadingState,

        // 方法
        initFromSceneTree,
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
        expandToRefno,
        clear,
    }
}
