/**
 * SITE Node 层级管理 Composable
 *
 * 使用 xeokit 原生 Node 类构建 SITE 层级拓扑（SITE/ZONE/EQUI 等大级节点），
 * 与 SceneModel.Entity 共存于同一 Scene，通过 refno ID 关联。
 */

import { ref, shallowRef } from 'vue'
import type { Viewer } from '@xeokit/xeokit-sdk'
import {
    e3dGetSiteNodes,
    type NodeAabb,
    type SiteNodeData,
    type SiteNodesResponse,
} from '@/api/genModelE3dApi'

// ========================
// 类型定义
// ========================

// 重新导出 API 类型供外部使用
export type { NodeAabb, SiteNodeData, SiteNodesResponse }

/** 前端 Node 包装 */
export interface FrontendSiteNode {
    refno: string
    parent: string | null
    childrenIds: string[]
    noun: string
    name: string
    aabb: NodeAabb | null
    hasGeo: boolean
    xeokitNode?: unknown  // xeokit Node 实例引用
}

/**
 * xeokit Node 对象 ID 前缀
 *
 * 目的：
 * - 允许 Node 注册到 scene.objects（isObject: true）
 * - 避免与几何 Entity 的 refno ID 冲突
 */
const SITE_NODE_OBJECT_ID_PREFIX = 'siteNode:'

function toSiteNodeObjectId(refno: string): string {
    return `${SITE_NODE_OBJECT_ID_PREFIX}${refno}`
}


// ========================
// Composable
// ========================

/**
 * SITE Node 层级管理
 *
 * @param viewerRef xeokit Viewer 的响应式引用
 */
export function useSiteNodeTree(viewerRef: { value: Viewer | null }) {
    /** 按 refno 索引的 Node 映射 */
    const nodeMap = shallowRef(new Map<string, FrontendSiteNode>())

    /** 已加载的 SITE refno 集合 */
    const loadedSites = ref(new Set<string>())

    /** 加载状态 */
    const isLoading = ref(false)

    /** 错误信息 */
    const error = ref<string | null>(null)

    /**
     * 计算节点在树中的深度（用于排序，确保父节点先创建）
     */
    function getDepth(node: SiteNodeData, allNodes: SiteNodeData[]): number {
        let depth = 0
        let current: SiteNodeData | undefined = node
        const visited = new Set<string>()

        while (current?.parent) {
            if (visited.has(current.refno)) break // 防止循环
            visited.add(current.refno)
            depth++
            current = allNodes.find((n) => n.refno === current!.parent)
        }

        return depth
    }

    /**
     * 加载指定 SITE 的 Node 层级
     *
     * @param siteRefno SITE 节点的 refno
     */
    async function loadSiteNodes(siteRefno: string): Promise<void> {
        if (loadedSites.value.has(siteRefno)) {
            console.log(`[SiteNodeTree] SITE ${siteRefno} already loaded, skipping`)
            return
        }

        const viewer = viewerRef.value
        if (!viewer) {
            throw new Error('[SiteNodeTree] Viewer not available')
        }

        isLoading.value = true
        error.value = null

        try {
            const data = await e3dGetSiteNodes(siteRefno)

            if (!data.success) {
                throw new Error(data.error_message || 'Failed to load site nodes')
            }

            console.log(`[SiteNodeTree] Loaded ${data.nodes.length} nodes for SITE ${siteRefno}`)

            // 按深度排序，确保父节点先创建
            const sortedNodes = [...data.nodes].sort(
                (a, b) => getDepth(a, data.nodes) - getDepth(b, data.nodes)
            )

            // 动态导入 Node 类
            const { Node } = await import('@xeokit/xeokit-sdk')

            // 临时 Map 用于构建
            const tempMap = new Map<string, FrontendSiteNode>(nodeMap.value)

            for (const n of sortedNodes) {
                // 检查是否已存在（避免重复创建）
                if (tempMap.has(n.refno)) {
                    continue
                }

                // 确定父级：xeokit Node 或 scene
                let parentNode: unknown = viewer.scene
                if (n.parent && tempMap.has(n.parent)) {
                    parentNode = tempMap.get(n.parent)!.xeokitNode || viewer.scene
                }

                // 创建 xeokit Node
                // isObject: true 可让节点注册到 scene.objects
                const xeokitNode = new Node(parentNode as ConstructorParameters<typeof Node>[0], {
                    id: toSiteNodeObjectId(n.refno),
                    isObject: true,
                } as any)

                // 构建前端包装
                const frontendNode: FrontendSiteNode = {
                    refno: n.refno,
                    parent: n.parent,
                    childrenIds: [],
                    noun: n.noun,
                    name: n.name || n.refno,
                    aabb: n.aabb,
                    hasGeo: n.has_geo,
                    xeokitNode,
                }

                tempMap.set(n.refno, frontendNode)

                // 更新父节点的 childrenIds
                if (n.parent && tempMap.has(n.parent)) {
                    tempMap.get(n.parent)!.childrenIds.push(n.refno)
                }
            }

            nodeMap.value = tempMap
            loadedSites.value.add(siteRefno)

            console.log(`[SiteNodeTree] Successfully built Node tree for SITE ${siteRefno}`)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error('[SiteNodeTree] Failed to load site nodes:', msg)
            error.value = msg
            throw e
        } finally {
            isLoading.value = false
        }
    }

    /**
     * 获取节点的 AABB
     */
    function getNodeAabb(refno: string): NodeAabb | null {
        const node = nodeMap.value.get(refno)
        return node?.aabb ?? null
    }

    /**
     * 获取子树的所有 refnos（包含自身）
     */
    function getSubtreeRefnos(rootId: string): string[] {
        const result: string[] = []
        const stack = [rootId]

        while (stack.length > 0) {
            const id = stack.pop()!
            result.push(id)

            const node = nodeMap.value.get(id)
            if (node) {
                stack.push(...node.childrenIds)
            }
        }

        return result
    }

    /**
     * 计算子树的合并 AABB
     */
    function getMergedAabb(refnos: string[]): NodeAabb | null {
        let merged: NodeAabb | null = null

        for (const refno of refnos) {
            const aabb = getNodeAabb(refno)
            if (!aabb) continue

            if (!merged) {
                merged = {
                    min: [...aabb.min],
                    max: [...aabb.max],
                }
            } else {
                merged.min[0] = Math.min(merged.min[0], aabb.min[0])
                merged.min[1] = Math.min(merged.min[1], aabb.min[1])
                merged.min[2] = Math.min(merged.min[2], aabb.min[2])
                merged.max[0] = Math.max(merged.max[0], aabb.max[0])
                merged.max[1] = Math.max(merged.max[1], aabb.max[1])
                merged.max[2] = Math.max(merged.max[2], aabb.max[2])
            }
        }

        return merged
    }

    /**
     * 设置子树的可见性
     */
    function setSubtreeVisible(rootId: string, visible: boolean): number {
        const refnos = getSubtreeRefnos(rootId)
        let count = 0

        for (const refno of refnos) {
            const node = nodeMap.value.get(refno)
            if (node?.xeokitNode) {
                (node.xeokitNode as { visible?: boolean }).visible = visible
                count++
            }
        }

        return count
    }

    /**
     * 根据节点 refno 查找其所属的 SITE refno
     * 沿 parent 链向上遍历直到找到 SITE 类型节点
     */
    function findSiteForNode(refno: string): string | null {
        let current = nodeMap.value.get(refno)

        while (current) {
            if (current.noun === 'SITE') {
                return current.refno
            }

            if (!current.parent) break
            current = nodeMap.value.get(current.parent)
        }

        return null
    }

    /**
     * 检查指定 SITE 是否已加载
     */
    function isSiteLoaded(siteRefno: string): boolean {
        return loadedSites.value.has(siteRefno)
    }

    /**
     * 清除所有已加载的 Node 层级
     */
    function clearAll(): void {
        // 销毁 xeokit Node
        for (const node of nodeMap.value.values()) {
            if (node.xeokitNode) {
                try {
                    (node.xeokitNode as { destroy?: () => void }).destroy?.()
                } catch {
                    // ignore
                }
            }
        }

        nodeMap.value = new Map()
        loadedSites.value = new Set()
        error.value = null
    }

    return {
        /** Node 映射表 */
        nodeMap,
        /** 已加载的 SITE 集合 */
        loadedSites,
        /** 加载状态 */
        isLoading,
        /** 错误信息 */
        error,

        /** 加载 SITE Node 层级 */
        loadSiteNodes,
        /** 获取节点 AABB */
        getNodeAabb,
        /** 获取子树 refnos */
        getSubtreeRefnos,
        /** 获取子树合并 AABB */
        getMergedAabb,
        /** 设置子树可见性 */
        setSubtreeVisible,
        /** 查找节点所属 SITE */
        findSiteForNode,
        /** 检查 SITE 是否已加载 */
        isSiteLoaded,
        /** 清除所有 */
        clearAll,
    }
}
