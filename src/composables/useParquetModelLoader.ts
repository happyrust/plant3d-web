/**
 * Parquet 模型加载器
 * 
 * 从服务器加载 Parquet 格式的模型实例数据，并转换为 xeokit SceneModel。
 * 使用 parquet-wasm 进行高效的 Parquet 数据解析。
 */

import { ref } from 'vue'

// parquet-wasm 懒加载
let parquetWasm: typeof import('parquet-wasm') | null = null

async function getParquetWasm() {
    if (!parquetWasm) {
        parquetWasm = await import('parquet-wasm')
        // 初始化 WASM
        await parquetWasm.default()
    }
    return parquetWasm
}

/** 实例数据行 */
export interface InstanceRow {
    refno: string
    noun: string
    geo_hash: string
    is_tubi: boolean
    owner_refno: string | null
    // transform 存储为 t0-t15 列
    transform: Float32Array
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
            url: `${baseUrl}/${filename}`,
        }))
    }

    /**
     * 加载单个 Parquet 文件并解析为实例数据
     */
    async function loadParquetFile(url: string): Promise<InstanceRow[]> {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to load parquet file: ${response.statusText}`)
        }

        const buffer = await response.arrayBuffer()
        const uint8Array = new Uint8Array(buffer)

        // 使用 parquet-wasm 读取 Parquet 文件
        const pq = await getParquetWasm()
        const arrowTable = pq.readParquet(uint8Array)

        // 转换为 Arrow Table 以便读取数据
        const { tableFromIPC } = await import('apache-arrow')
        const table = tableFromIPC(arrowTable.intoIPCStream())

        const rows: InstanceRow[] = []
        const numRows = table.numRows

        // 获取列
        const refnoCol = table.getChild('refno')
        const nounCol = table.getChild('noun')
        const geoHashCol = table.getChild('geo_hash')
        const isTubiCol = table.getChild('is_tubi')
        const ownerRefnoCol = table.getChild('owner_refno')

        // transform 列 (t0-t15)
        const tCols: any[] = []
        for (let i = 0; i < 16; i++) {
            tCols.push(table.getChild(`t${i}`))
        }

        for (let i = 0; i < numRows; i++) {
            const transform = new Float32Array(16)
            for (let j = 0; j < 16; j++) {
                const col = tCols[j]
                transform[j] = col ? (col.get(i) ?? (j % 5 === 0 ? 1 : 0)) : (j % 5 === 0 ? 1 : 0)
            }

            rows.push({
                refno: refnoCol?.get(i) ?? '',
                noun: nounCol?.get(i) ?? '',
                geo_hash: geoHashCol?.get(i) ?? '',
                is_tubi: isTubiCol?.get(i) ?? false,
                owner_refno: ownerRefnoCol?.get(i) ?? null,
                transform,
            })
        }

        return rows
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
        // 后加载的文件优先（增量文件是最新的）
        for (const row of rows) {
            map.set(row.refno, row)
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

    // 1. 加载 Parquet 数据
    let rows: InstanceRow[] = []

    if (options.parquetFiles && options.parquetFiles.length > 0) {
        // 直接使用传入的文件列表
        const baseUrl = '/files/output/database_models'
        for (const filename of options.parquetFiles) {
            const url = `${baseUrl}/${filename}`
            log('Loading file:', url)
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

    // 2. 创建 SceneModel
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

    // 3. 按 geo_hash 分组
    const groups = loader.groupByGeoHash(rows)
    log('Geometry groups:', groups.size)

    // 4. 为每个 geo_hash 创建几何体和实例
    let meshCounter = 0
    const meshIdsByRefno = new Map<string, string[]>()

    for (const [geoHash, instances] of groups) {
        const geometryId = `g:${geoHash}`

        // 对于 TUBI，使用简单的圆柱体几何体
        // TODO: 从 GLB 文件加载实际几何体
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
        }

        // 为每个实例创建 mesh
        for (const inst of instances) {
            const meshId = `m:${meshCounter++}`
            const refno = inst.refno

            // 将 Float32Array 转换为 number[]
            const matrix = Array.from(inst.transform)

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

    // 7. 触发事件
    viewer.scene.fire('modelLoaded', modelId)

    log('Model loaded successfully')

    return { sceneModel, instanceCount: rows.length }
}

