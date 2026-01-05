// @ts-nocheck
/**
 * DuckDB Model Loader
 *
 * 使用 DuckDB-WASM 从远程 DuckDB 文件加载模型数据。
 * 支持 HTTP Range Requests 实现虚拟化读取。
 */

import * as duckdb from '@duckdb/duckdb-wasm'
import { ref, shallowRef, computed } from 'vue'

// DuckDB Worker 配置
const DUCKDB_BUNDLES = duckdb.getJsDelivrBundles()

// 单例 DuckDB 实例
let dbInstance: duckdb.AsyncDuckDB | null = null
let workerInstance: Worker | null = null

/**
 * 初始化 DuckDB-WASM
 */
async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
    if (dbInstance) {
        return dbInstance
    }

    // 选择最佳 bundle
    const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES)

    // 创建 Worker
    const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    )
    workerInstance = new Worker(workerUrl)

    // 初始化日志
    const logger = new duckdb.ConsoleLogger()
    dbInstance = new duckdb.AsyncDuckDB(logger, workerInstance)
    await dbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker)

    console.log('📦 [DuckDB-WASM] 初始化完成')
    return dbInstance
}

/**
 * Instance 数据结构
 */
export interface DuckDBInstance {
    refno: string
    noun: string
    owner_refno: string | null
    color_index: number
    spec_value: number | null
}

/**
 * Geo 数据结构
 */
export interface DuckDBGeo {
    id: string
    refno: string
    geo_hash: string
    geo_transform: {
        rotation: number[]
        scale: number[]
        translation: number[]
    } | null
}

/**
 * AABB 数据结构
 */
export interface DuckDBAabb {
    refno: string
    min_x: number
    min_y: number
    min_z: number
    max_x: number
    max_y: number
    max_z: number
}

/**
 * DuckDB Model Loader Composable
 */
export function useDuckDBModelLoader() {
    const isLoading = ref(false)
    const isConnected = ref(false)
    const error = ref<string | null>(null)
    const stats = shallowRef<{
        instance_count: number
        geo_count: number
        aabb_count: number
    } | null>(null)

    let db: duckdb.AsyncDuckDB | null = null
    let conn: duckdb.AsyncDuckDBConnection | null = null
    const registeredUrl = ref<string | null>(null)

    /**
     * 注册远程 DuckDB 文件
     * 
     * @param baseUrl DuckDB 目录的基础 URL（如 '/files/web_duckdb'）
     *                会自动获取 latest.json 确定最新文件
     */
    async function registerRemoteDatabase(baseUrl: string): Promise<boolean> {
        isLoading.value = true
        error.value = null

        try {
            // 1. 获取 latest.json 确定最新文件
            const latestUrl = `${baseUrl}/latest.json`
            const latestResp = await fetch(latestUrl)
            if (!latestResp.ok) {
                throw new Error(`Failed to fetch latest.json: ${latestResp.statusText}`)
            }
            const latestInfo = await latestResp.json() as {
                db_filename: string
                updated_at: number
                stats?: { instance_count: number; geo_count: number; aabb_count: number }
            }

            const dbUrl = `${baseUrl}/${latestInfo.db_filename}`
            console.log('[DuckDB] 使用最新版本:', latestInfo.db_filename, 'updated_at:', new Date(latestInfo.updated_at * 1000))

            // 2. 初始化 DuckDB
            db = await initDuckDB()

            // 注册远程文件（支持 HTTP Range Requests）
            await db.registerFileURL('model.duckdb', dbUrl, duckdb.DuckDBDataProtocol.HTTP, false)

            // 打开连接
            conn = await db.connect()

            // 附加数据库
            await conn.query(`ATTACH 'model.duckdb' AS model (READ_ONLY)`)

            registeredUrl.value = dbUrl
            isConnected.value = true

            // 使用 latest.json 中的统计信息（如果有）
            if (latestInfo.stats) {
                stats.value = {
                    instance_count: latestInfo.stats.instance_count,
                    geo_count: latestInfo.stats.geo_count,
                    aabb_count: latestInfo.stats.aabb_count,
                }
            } else {
                // 否则从数据库查询
                const instanceResult = await conn.query('SELECT COUNT(*) as cnt FROM model.instance')
                const geoResult = await conn.query('SELECT COUNT(*) as cnt FROM model.geo')
                const aabbResult = await conn.query('SELECT COUNT(*) as cnt FROM model.aabb')

                stats.value = {
                    instance_count: Number(instanceResult.getChildAt(0)?.get(0) || 0),
                    geo_count: Number(geoResult.getChildAt(0)?.get(0) || 0),
                    aabb_count: Number(aabbResult.getChildAt(0)?.get(0) || 0),
                }
            }

            console.log('✅ [DuckDB] 远程数据库连接成功:', stats.value)
            return true
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e)
            console.error('[DuckDB] 连接失败:', e)
            return false
        } finally {
            isLoading.value = false
        }
    }

    /**
     * 注册指定 dbno 的 Parquet 文件夹
     * 
     * @param dbno 数据库编号
     * @param baseUrl Parquet 文件的基础 URL（默认 '/files/output/database_models'）
     */
    async function registerParquetFolder(
        dbno: number,
        baseUrl = '/files/output/database_models'
    ): Promise<boolean> {
        isLoading.value = true
        error.value = null

        try {
            // 1. 构建 Parquet 文件 URL
            const instanceUrl = `${baseUrl}/${dbno}/instance.parquet`
            const transformUrl = `${baseUrl}/${dbno}/transform.parquet`

            console.log('[DuckDB] 注册 Parquet 文件夹:', { dbno, instanceUrl, transformUrl })

            // 2. 初始化 DuckDB
            db = await initDuckDB()

            // 3. 注册 Parquet 文件（支持 HTTP Range Requests）
            await db.registerFileURL(
                'instance.parquet',
                instanceUrl,
                duckdb.DuckDBDataProtocol.HTTP,
                false  // 不强制下载，使用 HTTP Range
            )

            await db.registerFileURL(
                'transform.parquet',
                transformUrl,
                duckdb.DuckDBDataProtocol.HTTP,
                false
            )

            // 4. 打开连接
            conn = await db.connect()

            registeredUrl.value = `${baseUrl}/${dbno}`
            isConnected.value = true

            // 5. 查询统计信息
            const instanceResult = await conn.query("SELECT COUNT(*) as cnt FROM 'instance.parquet'")
            const transformResult = await conn.query("SELECT COUNT(*) as cnt FROM 'transform.parquet'")

            stats.value = {
                instance_count: Number(instanceResult.getChildAt(0)?.get(0) || 0),
                geo_count: 0,  // Parquet 模式下没有单独的 geo 表
                aabb_count: Number(instanceResult.getChildAt(0)?.get(0) || 0),  // AABB 在 instance 表中
            }

            console.log('✅ [DuckDB] Parquet 文件夹注册成功:', stats.value)
            return true
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e)
            console.error('[DuckDB] Parquet 文件夹注册失败:', e)
            return false
        } finally {
            isLoading.value = false
        }
    }

    /**
     * 查询所有实例
     */
    async function queryInstances(limit = 1000): Promise<DuckDBInstance[]> {
        if (!conn) throw new Error('Database not connected')

        const result = await conn.query(`
      SELECT refno, noun, owner_refno, color_index, spec_value
      FROM model.instance
      LIMIT ${limit}
    `)

        const instances: DuckDBInstance[] = []
        for (let i = 0; i < result.numRows; i++) {
            instances.push({
                refno: String(result.getChildAt(0)?.get(i) || ''),
                noun: String(result.getChildAt(1)?.get(i) || ''),
                owner_refno: result.getChildAt(2)?.get(i) as string | null,
                color_index: Number(result.getChildAt(3)?.get(i) || 0),
                spec_value: result.getChildAt(4)?.get(i) as number | null,
            })
        }

        return instances
    }

    /**
     * 查询指定 refno 的实例及其几何体
     */
    async function queryInstanceWithGeos(refno: string): Promise<{
        instance: DuckDBInstance | null
        geos: DuckDBGeo[]
    }> {
        if (!conn) throw new Error('Database not connected')

        // 查询实例
        const instResult = await conn.query(`
      SELECT refno, noun, owner_refno, color_index, spec_value
      FROM model.instance
      WHERE refno = '${refno}'
    `)

        let instance: DuckDBInstance | null = null
        if (instResult.numRows > 0) {
            instance = {
                refno: String(instResult.getChildAt(0)?.get(0) || ''),
                noun: String(instResult.getChildAt(1)?.get(0) || ''),
                owner_refno: instResult.getChildAt(2)?.get(0) as string | null,
                color_index: Number(instResult.getChildAt(3)?.get(0) || 0),
                spec_value: instResult.getChildAt(4)?.get(0) as number | null,
            }
        }

        // 查询几何体
        const geoResult = await conn.query(`
      SELECT id, refno, geo_hash, geo_transform
      FROM model.geo
      WHERE refno = '${refno}'
    `)

        const geos: DuckDBGeo[] = []
        for (let i = 0; i < geoResult.numRows; i++) {
            const transformStr = geoResult.getChildAt(3)?.get(i) as string | null
            geos.push({
                id: String(geoResult.getChildAt(0)?.get(i) || ''),
                refno: String(geoResult.getChildAt(1)?.get(i) || ''),
                geo_hash: String(geoResult.getChildAt(2)?.get(i) || ''),
                geo_transform: transformStr ? JSON.parse(transformStr) : null,
            })
        }

        return { instance, geos }
    }

    /**
     * 查询实例及其变换矩阵（Parquet 模式）
     * 支持 List<Struct> 字段（geo_items）
     */
    async function queryInstancesWithTransforms(
        limit = 1000
    ): Promise<Array<{
        refno: string
        noun: string
        owner_refno: string | null
        color_index: number
        geo_hash: string
        trans_id: string
        transform: Float32Array  // 16 个分量
    }>> {
        if (!conn) throw new Error('Database not connected')

        let result: duckdb.QueryResult
        try {
            result = await conn.query(`
                SELECT 
                    i.refno,
                    i.noun,
                    i.owner_refno,
                    i.color_index,
                    item.geo_hash as geo_hash,
                    item.geo_trans_id as trans_id,
                    t.t0, t.t1, t.t2, t.t3, t.t4, t.t5, t.t6, t.t7,
                    t.t8, t.t9, t.t10, t.t11, t.t12, t.t13, t.t14, t.t15
                FROM 'instance.parquet' i,
                    UNNEST(i.geo_items) AS item(geo_hash, geo_trans_id)
                JOIN 'transform.parquet' t ON t.trans_id = item.geo_trans_id
                LIMIT ${limit}
            `)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (!msg.includes('geo_items')) {
                throw e
            }
            result = await conn.query(`
                SELECT 
                    i.refno,
                    i.noun,
                    i.owner_refno,
                    i.color_index,
                    item.geo_hash as geo_hash,
                    item.geo_trans_id as trans_id,
                    t.t0, t.t1, t.t2, t.t3, t.t4, t.t5, t.t6, t.t7,
                    t.t8, t.t9, t.t10, t.t11, t.t12, t.t13, t.t14, t.t15
                FROM 'instance.parquet' i,
                    UNNEST(list_zip(i.geo_hashes, i.geo_trans_ids)) AS item(geo_hash, geo_trans_id)
                JOIN 'transform.parquet' t ON t.trans_id = item.geo_trans_id
                LIMIT ${limit}
            `)
        }

        const instances: Array<{
            refno: string
            noun: string
            owner_refno: string | null
            color_index: number
            geo_hash: string
            trans_id: string
            transform: Float32Array
        }> = []

        for (let i = 0; i < result.numRows; i++) {
            const transform = new Float32Array(16)
            for (let j = 0; j < 16; j++) {
                transform[j] = Number(result.getChildAt(6 + j)?.get(i) || (j % 5 === 0 ? 1 : 0))
            }

            instances.push({
                refno: String(result.getChildAt(0)?.get(i) || ''),
                noun: String(result.getChildAt(1)?.get(i) || ''),
                owner_refno: result.getChildAt(2)?.get(i) as string | null,
                color_index: Number(result.getChildAt(3)?.get(i) || 0),
                geo_hash: String(result.getChildAt(4)?.get(i) || ''),
                trans_id: String(result.getChildAt(5)?.get(i) || ''),
                transform,
            })
        }

        return instances
    }

    /**
     * 按 refno 查询单个实例及其变换（Parquet 模式）
     */
    async function queryInstanceWithTransformsById(refno: string): Promise<{
        instance: DuckDBInstance | null
        transforms: Array<{
            geo_hash: string
            trans_id: string
            matrix: Float32Array
        }>
    }> {
        if (!conn) throw new Error('Database not connected')

        // 查询实例基本信息
        const instResult = await conn.query(`
            SELECT refno, noun, owner_refno, color_index, spec_value
            FROM 'instance.parquet'
            WHERE refno = '${refno}'
        `)

        let instance: DuckDBInstance | null = null
        if (instResult.numRows > 0) {
            instance = {
                refno: String(instResult.getChildAt(0)?.get(0) || ''),
                noun: String(instResult.getChildAt(1)?.get(0) || ''),
                owner_refno: instResult.getChildAt(2)?.get(0) as string | null,
                color_index: Number(instResult.getChildAt(3)?.get(0) || 0),
                spec_value: instResult.getChildAt(4)?.get(0) as number | null,
            }
        }

        let transformResult: duckdb.QueryResult
        try {
            transformResult = await conn.query(`
                SELECT 
                    item.geo_hash as geo_hash,
                    item.geo_trans_id as trans_id,
                    t.t0, t.t1, t.t2, t.t3, t.t4, t.t5, t.t6, t.t7,
                    t.t8, t.t9, t.t10, t.t11, t.t12, t.t13, t.t14, t.t15
                FROM 'instance.parquet' i,
                    UNNEST(i.geo_items) AS item(geo_hash, geo_trans_id)
                JOIN 'transform.parquet' t ON t.trans_id = item.geo_trans_id
                WHERE i.refno = '${refno}'
            `)
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (!msg.includes('geo_items')) {
                throw e
            }
            transformResult = await conn.query(`
                SELECT 
                    item.geo_hash as geo_hash,
                    item.geo_trans_id as trans_id,
                    t.t0, t.t1, t.t2, t.t3, t.t4, t.t5, t.t6, t.t7,
                    t.t8, t.t9, t.t10, t.t11, t.t12, t.t13, t.t14, t.t15
                FROM 'instance.parquet' i,
                    UNNEST(list_zip(i.geo_hashes, i.geo_trans_ids)) AS item(geo_hash, geo_trans_id)
                JOIN 'transform.parquet' t ON t.trans_id = item.geo_trans_id
                WHERE i.refno = '${refno}'
            `)
        }

        const transforms: Array<{
            geo_hash: string
            trans_id: string
            matrix: Float32Array
        }> = []

        for (let i = 0; i < transformResult.numRows; i++) {
            const matrix = new Float32Array(16)
            for (let j = 0; j < 16; j++) {
                matrix[j] = Number(transformResult.getChildAt(2 + j)?.get(i) || (j % 5 === 0 ? 1 : 0))
            }

            transforms.push({
                geo_hash: String(transformResult.getChildAt(0)?.get(i) || ''),
                trans_id: String(transformResult.getChildAt(1)?.get(i) || ''),
                matrix,
            })
        }

        return { instance, transforms }
    }

    /**
     * 按 geo_hash 查询
     */
    async function queryByGeoHash(geoHash: string): Promise<DuckDBGeo[]> {
        if (!conn) throw new Error('Database not connected')

        const result = await conn.query(`
      SELECT id, refno, geo_hash, geo_transform
      FROM model.geo
      WHERE geo_hash = '${geoHash}'
    `)

        const geos: DuckDBGeo[] = []
        for (let i = 0; i < result.numRows; i++) {
            const transformStr = result.getChildAt(3)?.get(i) as string | null
            geos.push({
                id: String(result.getChildAt(0)?.get(i) || ''),
                refno: String(result.getChildAt(1)?.get(i) || ''),
                geo_hash: String(result.getChildAt(2)?.get(i) || ''),
                geo_transform: transformStr ? JSON.parse(transformStr) : null,
            })
        }

        return geos
    }

    /**
     * 空间查询：按包围盒查询
     */
    async function queryByBoundingBox(
        minX: number,
        minY: number,
        minZ: number,
        maxX: number,
        maxY: number,
        maxZ: number
    ): Promise<DuckDBAabb[]> {
        if (!conn) throw new Error('Database not connected')

        const result = await conn.query(`
      SELECT refno, min_x, min_y, min_z, max_x, max_y, max_z
      FROM model.aabb
      WHERE max_x >= ${minX} AND min_x <= ${maxX}
        AND max_y >= ${minY} AND min_y <= ${maxY}
        AND max_z >= ${minZ} AND min_z <= ${maxZ}
    `)

        const aabbs: DuckDBAabb[] = []
        for (let i = 0; i < result.numRows; i++) {
            aabbs.push({
                refno: String(result.getChildAt(0)?.get(i) || ''),
                min_x: Number(result.getChildAt(1)?.get(i) || 0),
                min_y: Number(result.getChildAt(2)?.get(i) || 0),
                min_z: Number(result.getChildAt(3)?.get(i) || 0),
                max_x: Number(result.getChildAt(4)?.get(i) || 0),
                max_y: Number(result.getChildAt(5)?.get(i) || 0),
                max_z: Number(result.getChildAt(6)?.get(i) || 0),
            })
        }

        return aabbs
    }

    /**
     * 关闭连接
     */
    async function close(): Promise<void> {
        if (conn) {
            await conn.close()
            conn = null
        }
        isConnected.value = false
        registeredUrl.value = null
        stats.value = null
    }

    return {
        // 状态
        isLoading,
        isConnected,
        error,
        stats,
        registeredUrl: computed(() => registeredUrl.value),

        // 方法
        registerRemoteDatabase,
        registerParquetFolder,
        queryInstances,
        queryInstanceWithGeos,
        queryInstancesWithTransforms,
        queryInstanceWithTransformsById,
        queryByGeoHash,
        queryByBoundingBox,
        close,
    }
}
