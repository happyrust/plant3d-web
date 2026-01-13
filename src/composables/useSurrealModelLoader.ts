/**
 * SurrealDB 模型加载器
 * 
 * 使用 SurrealDB 直接查询模型数据，并加载到 xeokit Viewer。
 * 替代 Parquet + DuckDB-WASM 方案。
 */

import { ref, shallowRef } from 'vue'
import type { Viewer, SceneModel } from '@xeokit/xeokit-sdk'
import { useSurrealDB, getDefaultSurrealConfig, type SurrealDBConfig } from './useSurrealDB'
import { useSurrealModelQuery, type GeomInstQuery, type ModelHashInst } from './useSurrealModelQuery'

// ========================
// 类型定义
// ========================

/** GLB 几何体数据 */
interface GLBGeometry {
    positions: number[]
    indices: number[]
    normals?: number[]
}

/** 加载选项 */
export interface SurrealLoadOptions {
    /** 模型 ID */
    modelId?: string
    /** mesh 文件基础 URL */
    meshBaseUrl?: string
    /** 是否启用调试日志 */
    debug?: boolean
    /** 是否启用孔洞/布尔运算 */
    enableHoles?: boolean
    /** SurrealDB 连接配置 */
    surrealConfig?: SurrealDBConfig
}

/** 加载结果 */
export interface SurrealLoadResult {
    sceneModel: SceneModel
    instanceCount: number
    refnoToMeshIds: Map<string, string[]>
}

// ========================
// 辅助函数
// ========================

/**
 * 4x4 矩阵乘法 (列主序，符合 glTF/OpenGL 格式)
 */
function multiplyMat4(a: number[], b: number[]): number[] {
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

function normalizeRgbMaybe(rgb: number[]): [number, number, number] {
    const r = Number(rgb[0] ?? 1)
    const g = Number(rgb[1] ?? 1)
    const b = Number(rgb[2] ?? 1)
    if (![r, g, b].every((v) => Number.isFinite(v))) {
        return [1, 1, 1]
    }
    const max = Math.max(r, g, b)
    if (max > 1.0) {
        return [r / 255, g / 255, b / 255]
    }
    return [r, g, b]
}

/**
 * 解析 GLB 文件，提取几何体数据
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
function extractAccessorData(
    gltf: Record<string, unknown>,
    binBuffer: ArrayBuffer,
    accessorIndex: number
): number[] {
    const accessors = gltf.accessors as Array<{
        bufferView: number
        componentType: number
        count: number
        type: string
        byteOffset?: number
    }>
    const bufferViews = gltf.bufferViews as Array<{
        buffer: number
        byteOffset: number
        byteLength: number
        byteStride?: number
    }>

    const accessor = accessors[accessorIndex]
    if (!accessor) return []

    const bufferView = bufferViews[accessor.bufferView]
    if (!bufferView) return []

    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0)
    const componentType = accessor.componentType
    const count = accessor.count
    const type = accessor.type

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

type AiosSceneWithManagers = {
    __aiosLazyEntityManagers?: Record<string, unknown>
    __aiosActiveLazyModelId?: string
}

type SurrealEntityManager = {
    id: string
    __aiosManagerKind: 'surreal'
    hasRefno: (refno: string) => boolean
    showEntity: (refno: string) => boolean | Promise<boolean>
    hideEntity: (refno: string) => boolean
    setVisibility: (refnos: string[], visible: boolean) => Promise<number>
    debugEntity: (refno: string) => unknown
    isEntityCreated: (refno: string) => boolean
    isEntityVisible: (refno: string) => boolean
    getAllRefnos: () => string[]
    getDebugStats: () => {
        lazyRefnoCount: number
        createdEntityCount: number
        meshCfgCount: number
        geometryCount: number
    }
}

function registerSurrealEntityManager(
    viewer: Viewer,
    modelKey: string,
    refnoToMeshIds: Map<string, string[]>,
    debug: boolean
) {
    const log = (...args: unknown[]) => debug && console.log('[Surreal→Xeokit]', ...args)

    const hasRefno = (refno: string) => refnoToMeshIds.has(refno)

    const showEntity = async (refno: string): Promise<boolean> => {
        const obj = viewer.scene.objects?.[refno] as unknown as { visible?: boolean } | undefined
        if (!obj) return false
        obj.visible = true
        return true
    }

    const hideEntity = (refno: string): boolean => {
        const obj = viewer.scene.objects?.[refno] as unknown as { visible?: boolean } | undefined
        if (!obj) return true
        obj.visible = false
        return true
    }

    const manager: SurrealEntityManager = {
        id: modelKey,
        __aiosManagerKind: 'surreal',
        hasRefno,
        showEntity,
        hideEntity,
        setVisibility: async (refnos: string[], visible: boolean) => {
            let count = 0
            for (const refno of refnos) {
                const ok = visible ? await showEntity(refno) : hideEntity(refno)
                if (ok) count++
            }
            return count
        },
        debugEntity: (refno: string) => {
            const obj = viewer.scene.objects?.[refno] as unknown as { visible?: boolean } | undefined
            return {
                refno,
                hasRefno: hasRefno(refno),
                entityPresent: !!obj,
                visible: !!obj && obj.visible !== false,
            }
        },
        isEntityCreated: (refno: string) => !!viewer.scene.objects?.[refno],
        isEntityVisible: (refno: string) => {
            const obj = viewer.scene.objects?.[refno] as unknown as { visible?: boolean } | undefined
            return !!obj && obj.visible !== false
        },
        getAllRefnos: () => Array.from(refnoToMeshIds.keys()),
        getDebugStats: () => ({
            lazyRefnoCount: refnoToMeshIds.size,
            createdEntityCount: Array.from(refnoToMeshIds.keys()).filter((r) => !!viewer.scene.objects?.[r]).length,
            meshCfgCount: 0,
            geometryCount: 0,
        }),
    }

    try {
        const sceneAny = viewer.scene as unknown as AiosSceneWithManagers
        sceneAny.__aiosLazyEntityManagers ??= {}
        sceneAny.__aiosLazyEntityManagers[modelKey] = manager
        if (!sceneAny.__aiosActiveLazyModelId) {
            sceneAny.__aiosActiveLazyModelId = modelKey
        }
        log('Registered __aiosLazyEntityManagers:', { modelKey, refnos: refnoToMeshIds.size })
    } catch {
        // ignore
    }
}

// ========================
// 主加载函数
// ========================

/**
 * 使用 SurrealDB 查询模型数据并加载到 xeokit Viewer
 * 
 * @param viewer xeokit Viewer 实例
 * @param refnos 要加载的构件编号列表
 * @param options 加载选项
 * @returns 加载结果
 * 
 * @example
 * ```ts
 * const result = await loadSurrealToXeokit(viewer, ['17496_123456', '17496_789012'], {
 *     modelId: 'my-model',
 *     debug: true,
 * })
 * console.log('Loaded', result.instanceCount, 'instances')
 * ```
 */
export async function loadSurrealToXeokit(
    viewer: Viewer,
    refnos: string[],
    options: SurrealLoadOptions = {}
): Promise<SurrealLoadResult> {
    const modelId = options.modelId || `surreal-${Date.now()}`
    const meshBaseUrl = options.meshBaseUrl || '/files/meshes/lod_L1'
    const debug = options.debug === true
    const enableHoles = options.enableHoles ?? true
    const surrealConfig = options.surrealConfig || getDefaultSurrealConfig()

    const log = (...args: unknown[]) => debug && console.log('[Surreal→Xeokit]', ...args)

    log('Loading model for refnos:', refnos.length)

    // 1. 连接 SurrealDB
    const { connect, getRawDbInstance, isConnected } = useSurrealDB()

    if (!isConnected.value) {
        log('Connecting to SurrealDB:', surrealConfig.url)
        await connect(surrealConfig)
    }

    // 2. 查询几何实例
    // 重要：使用原始实例而非 Vue 代理，避免私有字段访问问题
    const rawDb = getRawDbInstance()
    const dbRef = ref(rawDb) as unknown as ReturnType<typeof ref>
    const { queryInsts } = useSurrealModelQuery(dbRef as unknown as Parameters<typeof useSurrealModelQuery>[0])

    log('Querying geometry instances...')
    const geomInsts = await queryInsts(refnos, enableHoles)
    log('Got', geomInsts.length, 'geometry instances')

    if (geomInsts.length === 0) {
        throw new Error(`No geometry instances found for refnos: ${refnos.slice(0, 5).join(', ')}...`)
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

    // 4. 收集所有 geo_hash 并去重
    const allGeoHashes = new Set<string>()
    for (const inst of geomInsts) {
        for (const meshInst of inst.insts) {
            if (meshInst.geo_hash) {
                allGeoHashes.add(meshInst.geo_hash)
            }
        }
    }
    log('Unique geometry hashes:', allGeoHashes.size)

    // 5. 加载几何体
    const loadedGeometries = new Set<string>()

    for (const geoHash of allGeoHashes) {
        const geometryId = `g:${geoHash}`

        // 尝试加载 GLB 文件
        const glbUrl = `${meshBaseUrl}/${geoHash}_L1.glb`
        let geometryLoaded = false

        try {
            const response = await fetch(glbUrl)
            if (response.ok) {
                const glbData = await response.arrayBuffer()
                const geometry = await parseGLBGeometry(glbData)

                if (geometry && geometry.positions.length > 0) {
                    sceneModel.createGeometry({
                        id: geometryId,
                        primitive: 'triangles',
                        positions: geometry.positions,
                        indices: geometry.indices,
                        normals: geometry.normals,
                    } as unknown as Parameters<SceneModel['createGeometry']>[0])

                    loadedGeometries.add(geoHash)
                    geometryLoaded = true
                }
            }
        } catch (e) {
            // 忽略加载失败
        }

        // Fallback: 创建占位盒子几何体
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

            loadedGeometries.add(geoHash)
        }
    }

    log('Loaded geometries:', loadedGeometries.size)

    // 6. 创建 mesh 和 entity
    let meshCounter = 0
    const refnoToMeshIds = new Map<string, string[]>()

    for (const inst of geomInsts) {
        const meshIds: string[] = []

        for (const meshInst of inst.insts) {
            if (!meshInst.geo_hash || !loadedGeometries.has(meshInst.geo_hash)) {
                continue
            }

            const meshId = `m:${meshCounter++}`
            const geometryId = `g:${meshInst.geo_hash}`

            // 组合世界变换和局部变换
            let matrix: number[]
            if (inst.world_trans && meshInst.transform) {
                matrix = multiplyMat4(inst.world_trans, meshInst.transform)
            } else if (inst.world_trans) {
                matrix = inst.world_trans
            } else if (meshInst.transform) {
                matrix = meshInst.transform
            } else {
                matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            }

            // 获取颜色 (优先使用后端返回的颜色，否则使用默认规则)
            let color: number[]
            if (meshInst.color && meshInst.color.length >= 3) {
                color = Array.from(normalizeRgbMaybe(meshInst.color))
            } else {
                const isTubi = meshInst.is_tubi
                color = isTubi ? [0.2, 0.45, 0.85] : [0.75, 0.75, 0.78]
            }

            // 使用 PBR 材质
            sceneModel.createMesh({
                id: meshId,
                geometryId,
                primitive: 'triangles',
                matrix,
                color,
                opacity: 1.0,
                // PBR 属性
                metallic: 0.0,
                roughness: 1.0,
            } as unknown as Parameters<SceneModel['createMesh']>[0])

            meshIds.push(meshId)
        }

        // 为每个 refno 创建 Entity
        if (meshIds.length > 0) {
            sceneModel.createEntity({
                id: inst.refno,
                meshIds,
                isObject: true,
            } as unknown as Parameters<SceneModel['createEntity']>[0])

            refnoToMeshIds.set(inst.refno, meshIds)
        }
    }

    log('Created entities:', refnoToMeshIds.size, 'meshes:', meshCounter)

    // 7. Finalize
    sceneModel.finalize()

    // 等待一个 tick，确保 AABB 被正确计算
    await new Promise(resolve => setTimeout(resolve, 100))

    // 让 PDMS 树能识别 Surreal loader 创建的模型，避免走“传统方式”分支
    registerSurrealEntityManager(viewer, modelId, refnoToMeshIds, debug)

    // 8. 触发事件
    viewer.scene.fire('modelLoaded', modelId)

    log('Model loaded successfully')

    return {
        sceneModel,
        instanceCount: geomInsts.length,
        refnoToMeshIds,
    }
}

/**
 * 使用 SurrealDB 查询并显示单个构件
 */
export async function showRefnoViaSurreal(
    viewer: Viewer,
    refno: string,
    options: SurrealLoadOptions = {}
): Promise<SurrealLoadResult> {
    return loadSurrealToXeokit(viewer, [refno], {
        ...options,
        modelId: options.modelId || `refno-${refno}`,
    })
}
