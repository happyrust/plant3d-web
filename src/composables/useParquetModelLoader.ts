// @ts-nocheck
/**
 * Parquet 模型加载器
 * 
 * 从服务器加载 Parquet 格式的模型实例数据，并转换为 xeokit SceneModel。
 * 使用 DuckDB-WASM 进行高效的 Parquet 数据解析 (支持 LargeList 类型)。
 */

import { ref } from 'vue'
import type * as duckdb from '@duckdb/duckdb-wasm'

// DuckDB 实例单例
let duckDbInstance: duckdb.AsyncDuckDB | null = null

/**
 * 4x4 矩阵乘法 (列主序，符合 glTF/OpenGL 格式)
 * result = a × b
 */
function multiplyMat4(a: Float32Array, b: Float32Array): number[] {
    const result: number[] = new Array(16)
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0
            for (let k = 0; k < 4; k++) {
                sum += a[k * 4 + row] * b[col * 4 + k]
            }
            result[col * 4 + row] = sum
        }
    }
    return result
}

/** GLB 几何体数据 */
interface GLBGeometry {
    positions: number[]
    indices: number[]
    normals?: number[]
}

/**
 * 解析 GLB 文件，提取几何体数据
 * GLB 是 glTF 2.0 的二进制封装格式
 */
async function parseGLBGeometry(glbData: ArrayBuffer): Promise<GLBGeometry | null> {
    try {
        const dataView = new DataView(glbData)

        // GLB Header (12 bytes)
        const magic = dataView.getUint32(0, true)
        if (magic !== 0x46546C67) { // 'glTF'
            console.warn('[parseGLBGeometry] Invalid GLB magic number')
            return null
        }

        // const version = dataView.getUint32(4, true)
        // const length = dataView.getUint32(8, true)

        // Chunk 0: JSON
        const jsonChunkLength = dataView.getUint32(12, true)
        const jsonChunkType = dataView.getUint32(16, true)
        if (jsonChunkType !== 0x4E4F534A) { // 'JSON'
            console.warn('[parseGLBGeometry] First chunk is not JSON')
            return null
        }

        const jsonBytes = new Uint8Array(glbData, 20, jsonChunkLength)
        const jsonString = new TextDecoder().decode(jsonBytes)
        const gltf = JSON.parse(jsonString)

        // Chunk 1: Binary buffer
        const binChunkOffset = 20 + jsonChunkLength
        const binChunkLength = dataView.getUint32(binChunkOffset, true)
        // const binChunkType = dataView.getUint32(binChunkOffset + 4, true)
        const binBuffer = glbData.slice(binChunkOffset + 8, binChunkOffset + 8 + binChunkLength)

        // 获取第一个 mesh 的第一个 primitive
        const mesh = gltf.meshes?.[0]
        const primitive = mesh?.primitives?.[0]
        if (!primitive) {
            console.warn('[parseGLBGeometry] No mesh primitive found')
            return null
        }

        // 提取顶点位置
        const positionAccessorIndex = primitive.attributes?.POSITION
        if (positionAccessorIndex === undefined) {
            console.warn('[parseGLBGeometry] No POSITION attribute')
            return null
        }

        const positions = extractAccessorData(gltf, binBuffer, positionAccessorIndex)

        // 提取索引
        let indices: number[] = []
        if (primitive.indices !== undefined) {
            indices = extractAccessorData(gltf, binBuffer, primitive.indices)
        }

        // 提取法线（可选）
        let normals: number[] | undefined
        const normalAccessorIndex = primitive.attributes?.NORMAL
        if (normalAccessorIndex !== undefined) {
            normals = extractAccessorData(gltf, binBuffer, normalAccessorIndex)
        }

        return { positions, indices, normals }
    } catch (e) {
        console.error('[parseGLBGeometry] Failed to parse GLB:', e)
        return null
    }
}

/**
 * 从 glTF accessor 提取数据
 */
function extractAccessorData(gltf: Record<string, unknown>, binBuffer: ArrayBuffer, accessorIndex: number): number[] {
    const accessors = gltf.accessors as Array<{ bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }>
    const bufferViews = gltf.bufferViews as Array<{ buffer: number; byteOffset: number; byteLength: number; byteStride?: number }>

    const accessor = accessors[accessorIndex]
    if (!accessor) return []

    const bufferView = bufferViews[accessor.bufferView]
    if (!bufferView) return []

    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0)
    const componentType = accessor.componentType
    const count = accessor.count
    const type = accessor.type

    // 计算每个元素的组件数
    const componentCount: Record<string, number> = {
        'SCALAR': 1,
        'VEC2': 2,
        'VEC3': 3,
        'VEC4': 4,
        'MAT2': 4,
        'MAT3': 9,
        'MAT4': 16,
    }
    const numComponents = componentCount[type] || 1
    const totalComponents = count * numComponents

    // 根据 componentType 读取数据
    const dataView = new DataView(binBuffer, byteOffset)
    const result: number[] = []

    for (let i = 0; i < totalComponents; i++) {
        let value: number
        switch (componentType) {
            case 5120: // BYTE
                value = dataView.getInt8(i)
                break
            case 5121: // UNSIGNED_BYTE
                value = dataView.getUint8(i)
                break
            case 5122: // SHORT
                value = dataView.getInt16(i * 2, true)
                break
            case 5123: // UNSIGNED_SHORT
                value = dataView.getUint16(i * 2, true)
                break
            case 5125: // UNSIGNED_INT
                value = dataView.getUint32(i * 4, true)
                break
            case 5126: // FLOAT
                value = dataView.getFloat32(i * 4, true)
                break
            default:
                value = 0
        }
        result.push(value)
    }

    return result
}

/** 实例数据行 (扁平化格式，每行对应一个几何体) */
export interface InstanceRow {
    refno: string
    noun: string
    geo_hash: string
    geo_trans_id: string     // 几何体局部变换 ID (e.g. {refno}_geo_{index})
    inst_trans_id: string    // 实例世界变换 ID (e.g. {refno}_world)
    is_tubi: boolean
    owner_refno: string | null
}

interface ParquetGeoItem {
    geo_hash: string
    geo_trans_id: string
}

/** Parquet 原始行数据 (List<Struct> 格式，与后端 schema 一致) */
interface ParquetRawRow {
    refno: string
    noun: string
    spec_value?: bigint | null
    color_index?: number
    is_tubi: boolean
    owner_refno: string | null
    geo_items?: ParquetGeoItem[]
    geo_hashes?: string[]
    geo_trans_ids?: string[]
}

/** Parquet 文件信息 */
export interface ParquetFileInfo {
    filename: string
    url: string
    size?: number
}

/** 加载状态 */
export interface LoadingState {
    loading: boolean
    progress: number
    error: string | null
    loadedFiles: number
    totalFiles: number
}

/** Parquet 加载器选项 */
export interface ParquetLoaderOptions {
    baseUrl?: string
    onProgress?: (state: LoadingState) => void
}

/**
 * 从 Parquet 文件加载模型实例数据
 */
export function useParquetModelLoader(options: ParquetLoaderOptions = {}) {
    const baseUrl = options.baseUrl || '/files/output/database_models'

    const loadingState = ref<LoadingState>({
        loading: false,
        progress: 0,
        error: null,
        loadedFiles: 0,
        totalFiles: 0,
    })

    /**
     * 获取指定 dbno 的 Parquet 文件列表
     */
    async function listParquetFiles(dbno: number): Promise<ParquetFileInfo[]> {
        const response = await fetch(`/api/model/${dbno}/files`)
        if (!response.ok) {
            throw new Error(`Failed to list parquet files: ${response.statusText}`)
        }
        const files: string[] = await response.json()
        // URL 格式修正：文件直接在 database_models 目录下
        return files.map(filename => ({
            filename,
            url: `${baseUrl}/${dbno}/${filename}`,
        }))
    }

    /**
     * 加载单个 Parquet 文件并解析为实例数据 (使用 DuckDB-WASM)
     */
    async function loadParquetFile(url: string): Promise<InstanceRow[]> {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to load parquet file: ${response.statusText}`)
        }

        const buffer = await response.arrayBuffer()
        const uint8Array = new Uint8Array(buffer)

        // 使用 DuckDB-WASM 读取 Parquet (支持 LargeList 类型)
        const duckdb = await import('@duckdb/duckdb-wasm')

        // 获取或创建 DuckDB 实例
        if (!duckDbInstance) {
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
        }

        // 创建临时连接
        const conn = await duckDbInstance.connect()

        try {
            // 注册文件到 DuckDB 虚拟文件系统
            const filename = url.split('/').pop() || 'temp.parquet'
            await duckDbInstance.registerFileBuffer(filename, uint8Array)

            let result: duckdb.QueryResult
            try {
                // 新格式: geo_items (List<Struct>)
                result = await conn.query(`
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
                `)
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                if (msg.includes('geo_items')) {
                    // 旧格式回退: geo_hashes + geo_trans_ids
                    result = await conn.query(`
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
                    `)
                } else if (
                    msg.includes('geo_trans_id') ||
                    msg.includes('geo_hash') ||
                    msg.includes('Could not find key')
                ) {
                    // geo_items 仅包含 geo_hash（或为标量列表）
                    try {
                        result = await conn.query(`
                            SELECT 
                                i.refno,
                                i.noun,
                                item.unnest.geo_hash as geo_hash,
                                NULL as geo_trans_id,
                                i.inst_trans_id,
                                i.is_tubi,
                                i.owner_refno
                            FROM parquet_scan('${filename}') AS i,
                                UNNEST(i.geo_items) AS item(unnest)
                        `)
                    } catch {
                        result = await conn.query(`
                            SELECT 
                                i.refno,
                                i.noun,
                                item.unnest as geo_hash,
                                NULL as geo_trans_id,
                                i.inst_trans_id,
                                i.is_tubi,
                                i.owner_refno
                            FROM parquet_scan('${filename}') AS i,
                                UNNEST(i.geo_items) AS item(unnest)
                        `)
                    }
                } else {
                    throw e
                }
            }

            const rows: InstanceRow[] = []
            const resultArray = result.toArray()

            for (const row of resultArray) {
                rows.push({
                    refno: row.refno ?? '',
                    noun: row.noun ?? '',
                    geo_hash: row.geo_hash ?? '',
                    geo_trans_id: row.geo_trans_id ?? '',
                    inst_trans_id: row.inst_trans_id ?? '',
                    is_tubi: row.is_tubi ?? false,
                    owner_refno: row.owner_refno ?? null,
                })
            }

            // 清理临时文件
            await duckDbInstance.dropFile(filename)

            return rows
        } finally {
            await conn.close()
        }
    }

    /**
     * 加载指定 dbno 的所有 Parquet 文件
     */
    async function loadAllParquetFiles(dbno: number): Promise<InstanceRow[]> {
        loadingState.value = {
            loading: true,
            progress: 0,
            error: null,
            loadedFiles: 0,
            totalFiles: 0,
        }

        try {
            const files = await listParquetFiles(dbno)
            loadingState.value.totalFiles = files.length

            if (files.length === 0) {
                loadingState.value.loading = false
                return []
            }

            const allRows: InstanceRow[] = []

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                if (!file) continue
                const rows = await loadParquetFile(file.url)
                allRows.push(...rows)

                loadingState.value.loadedFiles = i + 1
                loadingState.value.progress = ((i + 1) / files.length) * 100

                if (options.onProgress) {
                    options.onProgress(loadingState.value)
                }
            }

            loadingState.value.loading = false
            return allRows
        } catch (error) {
            loadingState.value.error = error instanceof Error ? error.message : String(error)
            loadingState.value.loading = false
            throw error
        }
    }

    /**
     * 按 geo_hash 分组实例数据
     */
    function groupByGeoHash(rows: InstanceRow[]): Map<string, InstanceRow[]> {
        const groups = new Map<string, InstanceRow[]>()
        for (const row of rows) {
            const existing = groups.get(row.geo_hash) || []
            existing.push(row)
            groups.set(row.geo_hash, existing)
        }
        return groups
    }

    /**
     * 去重实例数据（基于 refno，后加载的文件优先）
     */
    function deduplicateRows(rows: InstanceRow[]): InstanceRow[] {
        const map = new Map<string, InstanceRow>()
        // 使用 refno + geo_trans_id 作为唯一键去重
        // 后加载的文件优先（增量文件是最新的覆盖）
        for (const row of rows) {
            const key = row.geo_trans_id
                ? `${row.refno}::${row.geo_trans_id}`
                : `${row.refno}::${row.geo_hash}`
            map.set(key, row)
        }
        return Array.from(map.values())
    }

    // NOTE: createInstancedMesh 需要 Three.js，但当前项目使用 xeokit
    // 如需 Three.js 支持，请安装 `npm install three @types/three`
    // 并取消下方注释
    /*
    function createInstancedMesh(
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
        instances: InstanceRow[]
    ): THREE.InstancedMesh {
        const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
        const matrix = new THREE.Matrix4()
        for (let i = 0; i < instances.length; i++) {
            const row = instances[i]
            matrix.fromArray(row.transform)
            mesh.setMatrixAt(i, matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        return mesh
    }
    */

    return {
        loadingState,
        listParquetFiles,
        loadParquetFile,
        loadAllParquetFiles,
        groupByGeoHash,
        deduplicateRows,
    }
}

// ============ Xeokit Integration ============

import type { Viewer, SceneModel } from '@xeokit/xeokit-sdk'

/** Xeokit 加载选项 */
export interface XeokitLoadOptions {
    modelId?: string
    meshBaseUrl?: string  // GLB 文件的基础 URL
    debug?: boolean
    /** 直接传入 Parquet 文件列表（从 API 返回） */
    parquetFiles?: string[]
}

/**
 * 将 Parquet 数据加载到 xeokit Viewer
 * 
 * @param viewer xeokit Viewer 实例
 * @param dbno 数据库编号
 * @param options 加载选项
 */
export async function loadParquetToXeokit(
    viewer: Viewer,
    dbno: number,
    options: XeokitLoadOptions = {}
): Promise<{ sceneModel: SceneModel; instanceCount: number }> {
    const { useParquetModelLoader } = await import('./useParquetModelLoader')
    const loader = useParquetModelLoader()

    const modelId = options.modelId || `parquet-${dbno}`
    const debug = options.debug === true
    const log = (...args: unknown[]) => debug && console.log('[Parquet→Xeokit]', ...args)

    log('Loading Parquet for dbno:', dbno)

    // 1. 加载 Transforms 数据 (矩阵映射) - 使用 DuckDB-WASM
    const transformMap = new Map<string, Float32Array>()
    try {
        const transResponse = await fetch(`/api/model/${dbno}/files?type=transforms`)
        const transFiles: string[] = transResponse.ok ? await transResponse.json() : []
        const baseUrl = '/files/output/database_models'

        // 初始化 DuckDB (如果尚未初始化)
        const duckdb = await import('@duckdb/duckdb-wasm')
        if (!duckDbInstance) {
            const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles()
            const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES)
            const worker_url = URL.createObjectURL(
                new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
            )
            const worker = new Worker(worker_url)
            const duckLogger = new duckdb.ConsoleLogger()
            duckDbInstance = new duckdb.AsyncDuckDB(duckLogger, worker)
            await duckDbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker)
            URL.revokeObjectURL(worker_url)
        }

        const conn = await duckDbInstance.connect()
        try {
            for (const filename of transFiles) {
                const url = `${baseUrl}/${dbno}/${filename}`
                log('Loading transform file:', url)
                const response = await fetch(url)
                if (!response.ok) continue

                const buffer = await response.arrayBuffer()
                const uint8Array = new Uint8Array(buffer)

                await duckDbInstance.registerFileBuffer(filename, uint8Array)

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

                await duckDbInstance.dropFile(filename)
            }
        } finally {
            await conn.close()
        }
        log('Loaded transforms:', transformMap.size)
    } catch (e) {
        log('Failed to load transforms:', e)
    }

    // 2. 加载 Instances 数据
    let rows: InstanceRow[] = []

    if (options.parquetFiles && options.parquetFiles.length > 0) {
        // 直接使用传入的文件列表
        const baseUrl = '/files/output/database_models'
        for (const filename of options.parquetFiles) {
            const url = `${baseUrl}/${dbno}/${filename}`
            log('Loading instance file:', url)
            try {
                const fileRows = await loader.loadParquetFile(url)
                rows.push(...fileRows)
            } catch (e) {
                log('Failed to load file:', url, e)
            }
        }
    } else {
        // 使用默认的加载方法
        rows = await loader.loadAllParquetFiles(dbno)
    }

    log('Loaded rows (before dedup):', rows.length)

    // 去重
    rows = loader.deduplicateRows(rows)
    log('Loaded rows (after dedup):', rows.length)

    if (rows.length === 0) {
        throw new Error(`No Parquet data found for dbno ${dbno}`)
    }

    // 3. 创建 SceneModel
    const { SceneModel: SceneModelClass } = await import('@xeokit/xeokit-sdk')

    // 检查并销毁已存在的模型
    const existing = viewer.scene.models[modelId] as unknown as { destroy?: () => void }
    if (existing) {
        log('Destroying existing model:', modelId)
        existing.destroy?.()
    }

    const sceneModel = new SceneModelClass(viewer.scene, {
        id: modelId,
        isModel: true,
    } as unknown as Record<string, unknown>)

    // 4. 按 geo_hash 分组
    const groups = loader.groupByGeoHash(rows)
    log('Geometry groups:', groups.size)

    // 5. 为每个 geo_hash 创建几何体和实例
    let meshCounter = 0
    const meshIdsByRefno = new Map<string, string[]>()

    for (const [geoHash, instances] of groups) {
        const geometryId = `g:${geoHash}`

        // 对于 TUBI，使用简单的圆柱体几何体
        // 对于其他元素，使用简单的盒子几何体作为占位
        const isTubi = instances[0]?.is_tubi ?? false

        if (isTubi) {
            // 创建简单的管道几何体（圆柱体近似）
            const segments = 8
            const positions: number[] = []
            const indices: number[] = []

            // 创建单位圆柱（半径1，高度1，中心在原点）
            for (let i = 0; i <= segments; i++) {
                const angle = (i / segments) * Math.PI * 2
                const x = Math.cos(angle)
                const y = Math.sin(angle)

                // 底部顶点
                positions.push(x, y, -0.5)
                // 顶部顶点
                positions.push(x, y, 0.5)
            }

            // 创建侧面三角形
            for (let i = 0; i < segments; i++) {
                const b1 = i * 2
                const t1 = b1 + 1
                const b2 = (i + 1) * 2
                const t2 = b2 + 1

                indices.push(b1, b2, t1)
                indices.push(t1, b2, t2)
            }

            sceneModel.createGeometry({
                id: geometryId,
                primitive: 'triangles',
                positions,
                indices,
            } as unknown as Parameters<SceneModel['createGeometry']>[0])
        } else {
            // 尝试从后端加载 GLB 几何体
            const glbUrl = `/files/meshes/lod_L1/${geoHash}_L1.glb`
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
                        log('Loaded GLB geometry for:', geoHash)
                    }
                }
            } catch (e) {
                log('Failed to load GLB for:', geoHash, e)
            }

            // Fallback: 创建简单的单位盒子几何体作为占位符
            if (!geometryLoaded) {
                const positions = [
                    // front face
                    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
                    // back face
                    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
                    // top face
                    -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
                    // bottom face
                    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
                    // right face
                    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
                    // left face
                    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
                ]
                const indices = [
                    0, 1, 2, 0, 2, 3,     // front
                    4, 5, 6, 4, 6, 7,     // back
                    8, 9, 10, 8, 10, 11,  // top
                    12, 13, 14, 12, 14, 15, // bottom
                    16, 17, 18, 16, 18, 19, // right
                    20, 21, 22, 20, 22, 23, // left
                ]

                sceneModel.createGeometry({
                    id: geometryId,
                    primitive: 'triangles',
                    positions,
                    indices,
                } as unknown as Parameters<SceneModel['createGeometry']>[0])

                log('Created placeholder box geometry for:', geoHash)
            }
        }

        // 为每个实例创建 mesh
        for (const inst of instances) {
            const meshId = `m:${meshCounter++}`
            const refno = inst.refno

            // 从 transformMap 获取世界变换和局部变换，运行时组合
            const worldMatrix = transformMap.get(inst.inst_trans_id)
            const geoMatrix = transformMap.get(inst.geo_trans_id)

            // 组合变换: world × local
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
                color: isTubi ? [0.2, 0.45, 0.85] : [0.85, 0.85, 0.85],
                opacity: 1.0,
                metallic: 0,
                roughness: 1,
            } as unknown as Parameters<SceneModel['createMesh']>[0])

            // 记录 refno → meshId 映射
            const list = meshIdsByRefno.get(refno) || []
            list.push(meshId)
            meshIdsByRefno.set(refno, list)
        }
    }

    // 5. 为每个 refno 创建 Entity
    for (const [refno, meshIds] of meshIdsByRefno) {
        sceneModel.createEntity({
            id: refno,
            meshIds,
            isObject: true,
        } as unknown as Parameters<SceneModel['createEntity']>[0])
    }

    log('Created entities:', meshIdsByRefno.size)

    // 6. Finalize
    sceneModel.finalize()

    // 等待一个 tick，确保 AABB 被正确计算
    await new Promise(resolve => setTimeout(resolve, 100))

    // 7. 触发事件
    viewer.scene.fire('modelLoaded', modelId)

    log('Model loaded successfully')

    return { sceneModel, instanceCount: rows.length }
}
