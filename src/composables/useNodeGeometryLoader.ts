/**
 * 节点几何加载器
 * 
 * 按 refno 按需从 instance.parquet 加载几何数据并渲染到 xeokit Viewer
 * 用于展开节点时的懒加载
 */

import { ref, shallowRef } from 'vue'
import type { Viewer, SceneModel } from '@xeokit/xeokit-sdk'
import type * as duckdb from '@duckdb/duckdb-wasm'
import { parseGlbGeometry as parseGLBGeometry } from '@/utils/parseGlbGeometry'

// DuckDB 实例单例
let duckDbInstance: duckdb.AsyncDuckDB | null = null

/**
 * 几何实例数据
 */
interface GeoInstance {
    refno: string
    noun: string
    geo_hash: string
    geo_trans_id: string
    inst_trans_id: string
    is_tubi: boolean
    owner_refno: string | null
}

/**
 * 加载状态
 */
export interface NodeGeometryLoadingState {
    loading: boolean
    error: string | null
    loadedCount: number
    pendingCount: number
}

/**
 * 初始化 DuckDB 实例
 */
async function ensureDuckDB(): Promise<duckdb.AsyncDuckDB> {
    if (duckDbInstance) {
        return duckDbInstance
    }

    const duckdb = await import('@duckdb/duckdb-wasm')
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)
    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    )
    const worker = new Worker(worker_url)
    const logger = new duckdb.ConsoleLogger()
    duckDbInstance = new duckdb.AsyncDuckDB(logger, worker)
    await duckDbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker)
    URL.revokeObjectURL(worker_url)

    return duckDbInstance
}

/**
 * 4x4 矩阵乘法 (列主序)
 */
function multiplyMat4(a: Float32Array, b: Float32Array): number[] {
    const result: number[] = new Array(16)
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0
            for (let k = 0; k < 4; k++) {
                sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
            }
            result[col * 4 + row] = sum
        }
    }
    return result
}

// parseGLBGeometry moved to src/utils/parseGlbGeometry.ts

/**
 * 节点几何加载器
 */
export function useNodeGeometryLoader(viewerRef: { value: Viewer | null }) {
    const loadingState = ref<NodeGeometryLoadingState>({
        loading: false,
        error: null,
        loadedCount: 0,
        pendingCount: 0,
    })

    // 已加载的 refno 集合
    const loadedRefnos = shallowRef<Set<string>>(new Set())

    // 正在加载的 refno 集合
    const loadingRefnos = new Set<string>()

    // 变换矩阵缓存 (dbno -> Map<trans_id, Float32Array>)
    const transformCache = new Map<number, Map<string, Float32Array>>()

    // Parquet 文件是否已注册
    const registeredFiles = new Map<number, boolean>()

    /**
     * 确保变换矩阵已加载
     */
    async function ensureTransformsLoaded(dbno: number): Promise<Map<string, Float32Array>> {
        if (transformCache.has(dbno)) {
            return transformCache.get(dbno)!
        }

        const transformMap = new Map<string, Float32Array>()
        const baseUrl = '/files/output/database_models'

        try {
            const response = await fetch(`/api/model/${dbno}/files?type=transforms`)
            if (!response.ok) {
                transformCache.set(dbno, transformMap)
                return transformMap
            }

            const files: string[] = await response.json()
            const db = await ensureDuckDB()
            const conn = await db.connect()

            try {
                for (const filename of files) {
                    const url = `${baseUrl}/${dbno}/${filename}`
                    const res = await fetch(url)
                    if (!res.ok) continue

                    const buffer = await res.arrayBuffer()
                    await db.registerFileBuffer(filename, new Uint8Array(buffer))

                    const result = await conn.query(`
                        SELECT trans_id, t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15
                        FROM parquet_scan('${filename}')
                    `)

                    for (const row of result.toArray()) {
                        const transId = row.trans_id
                        if (!transId) continue

                        const matrix = new Float32Array(16)
                        for (let j = 0; j < 16; j++) {
                            matrix[j] = row[`t${j}`] ?? (j % 5 === 0 ? 1 : 0)
                        }
                        transformMap.set(transId, matrix)
                    }

                    await db.dropFile(filename)
                }
            } finally {
                await conn.close()
            }
        } catch (e) {
            console.warn('[NodeGeometryLoader] Failed to load transforms:', e)
        }

        transformCache.set(dbno, transformMap)
        return transformMap
    }

    /**
     * 加载单个节点的几何数据
     */
    async function loadNodeGeometry(dbno: number, refno: string): Promise<boolean> {
        if (loadedRefnos.value.has(refno) || loadingRefnos.has(refno)) {
            return true
        }

        loadingRefnos.add(refno)
        loadingState.value = {
            ...loadingState.value,
            loading: true,
            pendingCount: loadingRefnos.size,
        }

        try {
            const viewer = viewerRef.value
            if (!viewer) {
                throw new Error('Viewer not initialized')
            }

            // 1. 加载变换矩阵
            const transformMap = await ensureTransformsLoaded(dbno)

            // 2. 查询实例数据
            const instances = await queryInstancesByRefno(dbno, [refno])
            if (instances.length === 0) {
                console.warn(`[NodeGeometryLoader] No instances found for refno: ${refno}`)
                return false
            }

            // 3. 创建或获取 SceneModel
            const modelId = `parquet-${dbno}`
            let sceneModel = viewer.scene.models[modelId] as unknown as SceneModel | undefined

            if (!sceneModel) {
                const { SceneModel: SceneModelClass } = await import('@xeokit/xeokit-sdk')
                sceneModel = new SceneModelClass(viewer.scene, {
                    id: modelId,
                    isModel: true,
                } as unknown as Record<string, unknown>)
            }

            // 4. 为每个几何创建 mesh
            let meshCounter = 0
            const meshIds: string[] = []

            for (const inst of instances) {
                const geometryId = `g:${inst.geo_hash}`
                const meshId = `m:${refno}:${meshCounter++}`

                // 检查几何体是否已存在
                const existingGeo = (sceneModel as unknown as { geometries?: Record<string, unknown> }).geometries?.[geometryId]
                if (!existingGeo) {
                    // 尝试加载 GLB
                    const glbUrl = `/files/meshes/lod_L1/${inst.geo_hash}_L1.glb`
                    let geometryLoaded = false

                    try {
                        const response = await fetch(glbUrl)
                        if (response.ok) {
                            const glbData = await response.arrayBuffer()
                            const geometry = await parseGLBGeometry(glbData)
                            if (geometry) {
                                sceneModel.createGeometry({
                                    id: geometryId,
                                    primitive: 'triangles',
                                    positions: geometry.positions,
                                    indices: geometry.indices,
                                    normals: geometry.normals,
                                } as unknown as Parameters<SceneModel['createGeometry']>[0])
                                geometryLoaded = true
                            }
                        }
                    } catch {
                        // 忽略加载错误
                    }

                    // 回退：创建占位盒子
                    if (!geometryLoaded) {
                        const positions = [
                            -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
                            -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
                            -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
                            -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
                            0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
                            -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
                        ]
                        const indices = [
                            0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
                            8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
                            16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
                        ]
                        sceneModel.createGeometry({
                            id: geometryId,
                            primitive: 'triangles',
                            positions,
                            indices,
                        } as unknown as Parameters<SceneModel['createGeometry']>[0])
                    }
                }

                // 组合变换矩阵
                const worldMatrix = transformMap.get(inst.inst_trans_id)
                const geoMatrix = transformMap.get(inst.geo_trans_id)
                let matrix: number[]
                if (worldMatrix && geoMatrix) {
                    matrix = multiplyMat4(worldMatrix, geoMatrix)
                } else if (worldMatrix) {
                    matrix = Array.from(worldMatrix)
                } else if (geoMatrix) {
                    matrix = Array.from(geoMatrix)
                } else {
                    matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
                }

                sceneModel.createMesh({
                    id: meshId,
                    geometryId,
                    primitive: 'triangles',
                    matrix,
                    color: inst.is_tubi ? [0.2, 0.45, 0.85] : [0.85, 0.85, 0.85],
                    opacity: 1.0,
                } as unknown as Parameters<SceneModel['createMesh']>[0])

                meshIds.push(meshId)
            }

            // 5. 创建 Entity
            if (meshIds.length > 0) {
                sceneModel.createEntity({
                    id: refno,
                    meshIds,
                    isObject: true,
                } as unknown as Parameters<SceneModel['createEntity']>[0])
            }

            // 6. Finalize (如果是新模型)
            if (!(sceneModel as unknown as { finalized?: boolean }).finalized) {
                sceneModel.finalize()
            }

            // 更新已加载集合
            const newLoaded = new Set(loadedRefnos.value)
            newLoaded.add(refno)
            loadedRefnos.value = newLoaded

            return true

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[NodeGeometryLoader] Failed to load ${refno}:`, message)
            loadingState.value = {
                ...loadingState.value,
                error: message,
            }
            return false

        } finally {
            loadingRefnos.delete(refno)
            loadingState.value = {
                loading: loadingRefnos.size > 0,
                error: loadingState.value.error,
                loadedCount: loadedRefnos.value.size,
                pendingCount: loadingRefnos.size,
            }
        }
    }

    /**
     * 批量加载多个节点的几何数据
     */
    async function loadNodesGeometry(dbno: number, refnos: string[]): Promise<number> {
        const toLoad = refnos.filter(r => !loadedRefnos.value.has(r) && !loadingRefnos.has(r))
        if (toLoad.length === 0) return 0

        let successCount = 0
        for (const refno of toLoad) {
            const ok = await loadNodeGeometry(dbno, refno)
            if (ok) successCount++
        }
        return successCount
    }

    /**
     * 从 Parquet 查询指定 refno 的实例数据
     */
    async function queryInstancesByRefno(dbno: number, refnos: string[]): Promise<GeoInstance[]> {
        const db = await ensureDuckDB()
        const conn = await db.connect()
        const baseUrl = '/files/output/database_models'

        try {
            // 获取实例文件列表
            const response = await fetch(`/api/model/${dbno}/files`)
            if (!response.ok) return []
            const files: string[] = await response.json()

            const instanceFiles = files.filter(f => f.includes('inst') && f.endsWith('.parquet'))
            const results: GeoInstance[] = []

            // 构建 WHERE 条件
            const refnoList = refnos.map(r => `'${r}'`).join(', ')

            for (const filename of instanceFiles) {
                const url = `${baseUrl}/${dbno}/${filename}`

                try {
                    const res = await fetch(url)
                    if (!res.ok) continue

                    const buffer = await res.arrayBuffer()
                    await db.registerFileBuffer(filename, new Uint8Array(buffer))

                    // 尝试新格式 (geo_items)
                    let queryResult
                    try {
                        queryResult = await conn.query(`
                            SELECT 
                                i.refno,
                                i.noun,
                                item.unnest.geo_hash as geo_hash,
                                item.unnest.geo_trans_id as geo_trans_id,
                                i.inst_trans_id,
                                i.is_tubi,
                                i.owner_refno
                            FROM parquet_scan('${filename}') AS i,
                                UNNEST(i.geo_items) AS item(unnest)
                            WHERE i.refno IN (${refnoList})
                        `)
                    } catch {
                        // 旧格式回退
                        try {
                            queryResult = await conn.query(`
                                SELECT 
                                    i.refno,
                                    i.noun,
                                    struct_extract(item.unnest, 1) as geo_hash,
                                    struct_extract(item.unnest, 2) as geo_trans_id,
                                    i.inst_trans_id,
                                    i.is_tubi,
                                    i.owner_refno
                                FROM parquet_scan('${filename}') AS i,
                                    UNNEST(list_zip(i.geo_hashes, i.geo_trans_ids)) AS item(unnest)
                                WHERE i.refno IN (${refnoList})
                            `)
                        } catch {
                            continue
                        }
                    }

                    for (const row of queryResult.toArray()) {
                        results.push({
                            refno: row.refno ?? '',
                            noun: row.noun ?? '',
                            geo_hash: row.geo_hash ?? '',
                            geo_trans_id: row.geo_trans_id ?? '',
                            inst_trans_id: row.inst_trans_id ?? '',
                            is_tubi: row.is_tubi ?? false,
                            owner_refno: row.owner_refno ?? null,
                        })
                    }

                    await db.dropFile(filename)
                } catch {
                    // 忽略单个文件错误
                }
            }

            return results

        } finally {
            await conn.close()
        }
    }

    /**
     * 检查 refno 是否已加载
     */
    function isLoaded(refno: string): boolean {
        return loadedRefnos.value.has(refno)
    }

    /**
     * 清空加载状态
     */
    function clear() {
        loadedRefnos.value = new Set()
        loadingRefnos.clear()
        loadingState.value = {
            loading: false,
            error: null,
            loadedCount: 0,
            pendingCount: 0,
        }
    }

    return {
        loadingState,
        loadedRefnos,
        loadNodeGeometry,
        loadNodesGeometry,
        isLoaded,
        clear,
    }
}
