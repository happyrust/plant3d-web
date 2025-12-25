/**
 * DuckDB Parquet 到 Xeokit 加载器
 * 
 * 使用 DuckDB-WASM 查询 Parquet 文件并加载到 Xeokit Viewer
 */

import type { Viewer, SceneModel } from '@xeokit/xeokit-sdk'
import { useDuckDBModelLoader } from './useDuckDBModelLoader'

/** 加载选项 */
export interface DuckDBXeokitLoadOptions {
    dbno: number
    modelId?: string
    baseUrl?: string  // Parquet 文件的基础 URL
    meshBaseUrl?: string  // GLB 文件的基础 URL
    debug?: boolean
}

/**
 * 从 GLB 文件解析几何体数据
 */
async function parseGLBGeometry(glbData: ArrayBuffer): Promise<{
    positions: number[]
    indices: number[]
    normals?: number[]
} | null> {
    try {
        const dataView = new DataView(glbData)

        // GLB Header
        const magic = dataView.getUint32(0, true)
        if (magic !== 0x46546C67) return null  // 'glTF'

        // Chunk 0: JSON
        const jsonChunkLength = dataView.getUint32(12, true)
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
        if (!primitive) return null

        // 提取顶点位置
        const positionAccessorIndex = primitive.attributes?.POSITION
        if (positionAccessorIndex === undefined) return null

        const positions = extractAccessorData(gltf, binBuffer, positionAccessorIndex)

        // 提取索引
        let indices: number[] = []
        if (primitive.indices !== undefined) {
            indices = extractAccessorData(gltf, binBuffer, primitive.indices)
        }

        // 提取法线
        let normals: number[] | undefined
        const normalAccessorIndex = primitive.attributes?.NORMAL
        if (normalAccessorIndex !== undefined) {
            normals = extractAccessorData(gltf, binBuffer, normalAccessorIndex)
        }

        return { positions, indices, normals }
    } catch (e) {
        console.error('[parseGLBGeometry]', e)
        return null
    }
}

function extractAccessorData(gltf: any, binBuffer: ArrayBuffer, accessorIndex: number): number[] {
    const accessors = gltf.accessors
    const bufferViews = gltf.bufferViews
    const accessor = accessors[accessorIndex]
    if (!accessor) return []

    const bufferView = bufferViews[accessor.bufferView]
    if (!bufferView) return []

    const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0)
    const componentType = accessor.componentType
    const count = accessor.count
    const type = accessor.type

    const componentCount: Record<string, number> = {
        'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4,
        'MAT2': 4, 'MAT3': 9, 'MAT4': 16,
    }
    const numComponents = componentCount[type] || 1
    const totalComponents = count * numComponents

    const dataView = new DataView(binBuffer, byteOffset)
    const result: number[] = []

    for (let i = 0; i < totalComponents; i++) {
        let value: number
        switch (componentType) {
            case 5120: value = dataView.getInt8(i); break  // BYTE
            case 5121: value = dataView.getUint8(i); break  // UNSIGNED_BYTE
            case 5122: value = dataView.getInt16(i * 2, true); break  // SHORT
            case 5123: value = dataView.getUint16(i * 2, true); break  // UNSIGNED_SHORT
            case 5125: value = dataView.getUint32(i * 4, true); break  // UNSIGNED_INT
            case 5126: value = dataView.getFloat32(i * 4, true); break  // FLOAT
            default: value = 0
        }
        result.push(value)
    }

    return result
}

/**
 * 从 DuckDB Parquet 加载模型到 Xeokit
 */
export async function loadDuckDBParquetToXeokit(
    viewer: Viewer,
    options: DuckDBXeokitLoadOptions
): Promise<{ sceneModel: SceneModel; instanceCount: number }> {
    const { dbno, modelId = `duckdb-${dbno}`, baseUrl, meshBaseUrl = '/files/meshes/lod_L1', debug = false } = options
    const log = (...args: unknown[]) => debug && console.log('[DuckDB→Xeokit]', ...args)

    log('Loading Parquet for dbno:', dbno)

    // 1. 初始化 DuckDB 并注册 Parquet 文件
    const loader = useDuckDBModelLoader()
    const success = await loader.registerParquetFolder(dbno, baseUrl)

    if (!success) {
        throw new Error(`Failed to register Parquet folder for dbno ${dbno}`)
    }

    log('DuckDB stats:', loader.stats.value)

    // 2. 查询数据
    const instances = await loader.queryInstancesWithTransforms(10000)  // 限制10000条
    log('Loaded instances (with transforms):', instances.length)

    if (instances.length === 0) {
        throw new Error(`No data found for dbno ${dbno}`)
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
    const groups = new Map<string, typeof instances>()
    for (const inst of instances) {
        const existing = groups.get(inst.geo_hash) || []
        existing.push(inst)
        groups.set(inst.geo_hash, existing)
    }

    log('Geometry groups:', groups.size)

    // 5. 为每个 geo_hash 创建几何体和实例
    let meshCounter = 0
    const meshIdsByRefno = new Map<string, string[]>()

    for (const [geoHash, insts] of groups) {
        const geometryId = `g:${geoHash}`

        // 尝试加载 GLB 几何体
        const glbUrl = `${meshBaseUrl}/${geoHash}_L1.glb`
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

        // Fallback: 创建简单的单位盒子几何体
        if (!geometryLoaded) {
            const positions = [
                -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,  // front
                -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,  // back
                -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,  // top
                -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,  // bottom
                0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,  // right
                -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,  // left
            ]
            const indices = [
                0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
                12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
            ]

            sceneModel.createGeometry({
                id: geometryId,
                primitive: 'triangles',
                positions,
                indices,
            } as unknown as Parameters<SceneModel['createGeometry']>[0])

            log('Created placeholder box for:', geoHash)
        }

        // 为每个实例创建 mesh
        for (const inst of insts) {
            const meshId = `m:${meshCounter++}`
            const refno = inst.refno

            // 将 Float32Array 转换为 number[]
            const matrix = Array.from(inst.transform)

            sceneModel.createMesh({
                id: meshId,
                geometryId,
                primitive: 'triangles',
                matrix,
                color: [0.85, 0.85, 0.85],
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

    // 6. 为每个 refno 创建 Entity
    for (const [refno, meshIds] of meshIdsByRefno) {
        sceneModel.createEntity({
            id: refno,
            meshIds,
            isObject: true,
        } as unknown as Parameters<SceneModel['createEntity']>[0])
    }

    log('Created entities:', meshIdsByRefno.size)

    // 7. Finalize
    sceneModel.finalize()

    // 8. 触发事件
    viewer.scene.fire('modelLoaded', modelId)

    log('Model loaded successfully')

    return { sceneModel, instanceCount: instances.length }
}
