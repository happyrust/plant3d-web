/**
 * SurrealDB 连接管理 Composable
 * 
 * 提供 SurrealDB 数据库的连接管理、查询执行和状态跟踪。
 * 支持 WebSocket 连接到 SurrealDB 3.0 实例。
 */

import { ref, shallowRef, computed } from 'vue'
import { Surreal } from 'surrealdb'

export interface SurrealDBConfig {
    /** WebSocket URL, 例如 ws://localhost:8020 */
    url: string
    /** 命名空间 */
    namespace: string
    /** 数据库名 */
    database: string
    /** 用户名 */
    username?: string
    /** 密码 */
    password?: string
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// 全局单例实例
let globalDb: Surreal | null = null
let globalConfig: SurrealDBConfig | null = null

/**
 * SurrealDB 连接管理 Composable
 * 
 * @example
 * ```ts
 * const { connect, query, db, status } = useSurrealDB()
 * 
 * await connect({
 *     url: 'ws://localhost:8020',
 *     namespace: '1516',
 *     database: 'AvevaMarineSample',
 *     username: 'root',
 *     password: 'root'
 * })
 * 
 * const result = await query('SELECT * FROM pe LIMIT 10')
 * ```
 */
export function useSurrealDB() {
    const db = shallowRef<Surreal | null>(globalDb)
    const status = ref<ConnectionStatus>(globalDb ? 'connected' : 'disconnected')
    const error = ref<string | null>(null)
    const config = ref<SurrealDBConfig | null>(globalConfig)

    const isConnected = computed(() => status.value === 'connected')

    /**
     * 连接到 SurrealDB
     */
    async function connect(newConfig: SurrealDBConfig): Promise<void> {
        // 如果已有相同配置的连接，复用
        if (globalDb && globalConfig &&
            globalConfig.url === newConfig.url &&
            globalConfig.namespace === newConfig.namespace &&
            globalConfig.database === newConfig.database) {
            db.value = globalDb
            config.value = globalConfig
            status.value = 'connected'
            return
        }

        // 断开旧连接
        if (globalDb) {
            try {
                await globalDb.close()
            } catch (e) {
                console.warn('[SurrealDB] Failed to close previous connection:', e)
            }
            globalDb = null
        }

        status.value = 'connecting'
        error.value = null
        config.value = newConfig

        try {
            const surreal = new Surreal()

            console.log('[SurrealDB] Connecting to:', newConfig.url)
            await surreal.connect(newConfig.url, {
                versionCheck: false,   // SurrealDB 3.0 超出 SDK 1.x 的版本范围检查，跳过
            })

            // 登录
            if (newConfig.username && newConfig.password) {
                console.log('[SurrealDB] Signing in as:', newConfig.username)
                await surreal.signin({
                    username: newConfig.username,
                    password: newConfig.password,
                })
            }

            // 选择命名空间和数据库
            console.log('[SurrealDB] Using namespace/database:', newConfig.namespace, newConfig.database)
            await surreal.use({
                namespace: newConfig.namespace,
                database: newConfig.database,
            })

            globalDb = surreal
            globalConfig = newConfig
            db.value = surreal
            status.value = 'connected'

            console.log('[SurrealDB] Connected successfully')
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            console.error('[SurrealDB] Connection failed:', message)
            error.value = message
            status.value = 'error'
            throw e
        }
    }

    /**
     * 断开连接
     */
    async function disconnect(): Promise<void> {
        if (globalDb) {
            try {
                await globalDb.close()
            } catch (e) {
                console.warn('[SurrealDB] Error closing connection:', e)
            }
            globalDb = null
            globalConfig = null
        }
        db.value = null
        config.value = null
        status.value = 'disconnected'
        console.log('[SurrealDB] Disconnected')
    }

    /**
     * 执行 SurrealQL 查询
     * 
     * @param sql SurrealQL 查询语句
     * @param vars 查询参数
     * @returns 查询结果数组
     */
    async function query<T = unknown>(sql: string, vars?: Record<string, unknown>): Promise<T[]> {
        if (!globalDb) {
            throw new Error('[SurrealDB] Not connected')
        }

        try {
            const result = await globalDb.query(sql, vars)
            // SurrealDB 返回的是多个语句的结果数组，取第一个
            return (result[0] ?? []) as T[]
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            console.error('[SurrealDB] Query failed:', message, '\nSQL:', sql)
            throw e
        }
    }

    /**
     * 执行原始查询，返回完整响应
     */
    async function queryRaw<T = unknown>(sql: string, vars?: Record<string, unknown>): Promise<T[][]> {
        if (!globalDb) {
            throw new Error('[SurrealDB] Not connected')
        }

        const result = await globalDb.query(sql, vars)
        return result as T[][]
    }

    /**
     * 切换到不同的命名空间/数据库
     */
    async function use(namespace: string, database: string): Promise<void> {
        if (!globalDb) {
            throw new Error('[SurrealDB] Not connected')
        }

        await globalDb.use({ namespace, database })

        if (globalConfig) {
            globalConfig.namespace = namespace
            globalConfig.database = database
        }
        if (config.value) {
            config.value = { ...config.value, namespace, database }
        }

        console.log('[SurrealDB] Switched to:', namespace, database)
    }

    /**
     * 获取数据库版本
     */
    async function version(): Promise<string> {
        if (!globalDb) {
            throw new Error('[SurrealDB] Not connected')
        }
        const info = await globalDb.version()
        return info?.version ?? String(info)
    }

    return {
        /** SurrealDB 客户端实例 (响应式引用，用于监听变化) */
        db,
        /** 获取原始的 SurrealDB 实例 (非响应式，用于直接调用方法) */
        getRawDbInstance: () => globalDb,
        /** 连接状态 */
        status,
        /** 是否已连接 */
        isConnected,
        /** 错误信息 */
        error,
        /** 当前配置 */
        config,
        /** 连接到数据库 */
        connect,
        /** 断开连接 */
        disconnect,
        /** 执行查询 */
        query,
        /** 执行原始查询 */
        queryRaw,
        /** 切换命名空间/数据库 */
        use,
        /** 获取版本 */
        version,
    }
}

/**
 * 获取默认的 SurrealDB 配置
 * 从环境变量或默认值读取
 */
export function getDefaultSurrealConfig(): SurrealDBConfig {
    return {
        url: import.meta.env.VITE_SURREAL_URL || 'ws://localhost:8020',
        namespace: import.meta.env.VITE_SURREAL_NS || '1516',
        database: import.meta.env.VITE_SURREAL_DB || 'AvevaMarineSample',
        username: import.meta.env.VITE_SURREAL_USER || 'root',
        password: import.meta.env.VITE_SURREAL_PASS || 'root',
    }
}
