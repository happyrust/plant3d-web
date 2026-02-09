/**
 * SurrealDB 模型查询 Composable
 * 
 * 将后端 aios-core 的 query_insts 逻辑移植到前端。
 * 直接查询 SurrealDB 获取几何实例数据，用于 3D 模型渲染。
 */

import type { Ref } from 'vue'
import { toRaw } from 'vue'
import type { Surreal } from 'surrealdb'

// ========================
// 类型定义
// ========================

/** 变换矩阵（4x4 列主序） */
export type TransformMatrix = number[]

/** 植物坐标系变换 */
export interface PlantTransform {
    /** 4x4 变换矩阵数据 */
    d?: TransformMatrix
}

/** 包围盒 */
export interface PlantAabb {
    /** 最小点 [x, y, z] */
    min: number[]
    /** 最大点 [x, y, z] */
    max: number[]
}

/** 几何实例中的单个 mesh */
export interface ModelHashInst {
    /** 几何哈希 (mesh ID) */
    geo_hash: string
    /** 局部变换矩阵 */
    transform?: TransformMatrix
    /** 颜色 [r, g, b, a] 0-255 */
    color?: number[]
    /** 材质 ID */
    material_id?: string
    /** 是否为管道直段 */
    is_tubi: boolean
    /** 是否为单位 mesh */
    unit_flag: boolean
}

/** 几何实例查询结果 */
export interface GeomInstQuery {
    /** 构件编号 */
    refno: string
    /** 所属构件编号 */
    owner: string
    /** 世界坐标系下的包围盒 */
    world_aabb: PlantAabb | null
    /** 世界坐标系下的变换矩阵 */
    world_trans: TransformMatrix
    /** 几何实例列表 */
    insts: ModelHashInst[]
    /** 是否包含负实体/布尔运算结果 */
    has_neg: boolean
    /** 构件类型 (generic) */
    generic: string
    /** 点集数据 */
    pts: number[][] | null
    /** 时间戳 */
    date: string | null
    /** 规格值 */
    spec_value: number | null
}

/** 管道直段查询结果 */
export interface TubiInstQuery {
    /** 管段 refno */
    refno: string
    /** 出口端 refno */
    leave: string
    /** 类型 */
    generic: string | null
    /** 世界包围盒 */
    world_aabb: PlantAabb | null
    /** 世界变换 */
    world_trans: TransformMatrix
    /** 几何哈希 */
    geo_hash: string
    /** 规格值 */
    spec_value: number | null
}

// ========================
// 辅助函数
// ========================

/**
 * 将 refno 字符串转换为 inst_relate 记录键
 * 例如: "17496_123456" -> "inst_relate:⟨17496_123456⟩"
 */
function toInstRelateKey(refno: string): string {
    return `inst_relate:⟨${refno}⟩`
}

/**
 * 将 refno 字符串转换为 pe 记录键
 * 例如: "17496_123456" -> "pe:⟨17496_123456⟩"
 */
function toPeKey(refno: string): string {
    return `pe:⟨${refno}⟩`
}

/**
 * 从 SurrealDB record ID 中提取 refno
 * 例如: "pe:⟨17496_123456⟩" -> "17496_123456"
 */
function extractRefno(recordId: string | { id?: string } | unknown): string {
    if (typeof recordId === 'string') {
        // 处理 "pe:⟨17496_123456⟩" 或 "inst_relate:⟨17496_123456⟩"
        const match = recordId.match(/[⟨<]([^⟩>]+)[⟩>]/)
        if (match) {
            return match[1] ?? recordId
        }
        // 处理 "table:id" 格式
        const colonIdx = recordId.indexOf(':')
        if (colonIdx !== -1) {
            return recordId.slice(colonIdx + 1)
        }
        return recordId
    }
    if (recordId && typeof recordId === 'object' && 'id' in (recordId as Record<string, unknown>)) {
        return extractRefno((recordId as { id: unknown }).id)
    }
    return String(recordId)
}

/**
 * 4x4 变换矩阵合成 (从 平移、旋转、缩放)
 */
function composeMat4(
    translation: [number, number, number],
    rotation: [number, number, number, number],
    scale: [number, number, number]
): TransformMatrix {
    const [x, y, z] = translation
    const [qx, qy, qz, qw] = rotation
    const [sx, sy, sz] = scale

    const x2 = qx + qx
    const y2 = qy + qy
    const z2 = qz + qz
    const xx = qx * x2
    const xy = qx * y2
    const xz = qx * z2
    const yy = qy * y2
    const yz = qy * z2
    const zz = qz * z2
    const wx = qw * x2
    const wy = qw * y2
    const wz = qw * z2

    const out = new Array<number>(16)

    out[0] = (1 - (yy + zz)) * sx
    out[1] = (xy + wz) * sx
    out[2] = (xz - wy) * sx
    out[3] = 0

    out[4] = (xy - wz) * sy
    out[5] = (1 - (xx + zz)) * sy
    out[6] = (yz + wx) * sy
    out[7] = 0

    out[8] = (xz + wy) * sz
    out[9] = (yz - wx) * sz
    out[10] = (1 - (xx + yy)) * sz
    out[11] = 0

    out[12] = x
    out[13] = y
    out[14] = z
    out[15] = 1

    return out as TransformMatrix
}

/**
 * 解析变换矩阵
 */
function parseTransform(trans: unknown): TransformMatrix {
    if (!trans) {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] // 单位矩阵
    }

    // 处理 { d: [...] } 格式
    if (typeof trans === 'object' && trans !== null && 'd' in trans) {
        const d = (trans as { d: unknown }).d
        return parseTransform(d)
    }

    // 处理 { rotation: [], scale: [], translation: [] } 格式
    if (typeof trans === 'object' && trans !== null) {
        const obj = trans as Record<string, unknown>
        if (Array.isArray(obj.rotation) && Array.isArray(obj.scale) && Array.isArray(obj.translation)) {
            const t = obj.translation as unknown[]
            const r = obj.rotation as unknown[]
            const s = obj.scale as unknown[]
            return composeMat4(
                [Number(t[0] ?? 0), Number(t[1] ?? 0), Number(t[2] ?? 0)],
                [Number(r[0] ?? 0), Number(r[1] ?? 0), Number(r[2] ?? 0), Number(r[3] ?? 1)],
                [Number(s[0] ?? 1), Number(s[1] ?? 1), Number(s[2] ?? 1)]
            )
        }
    }

    // 处理直接数组格式
    if (Array.isArray(trans) && trans.length === 16) {
        return trans as TransformMatrix
    }

    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * 解析包围盒
 */
function parseAabb(aabb: unknown): PlantAabb | null {
    if (!aabb) return null

    if (typeof aabb === 'object' && aabb !== null) {
        const obj = aabb as Record<string, unknown>
        if ('min' in obj && 'max' in obj) {
            return {
                min: obj.min as number[],
                max: obj.max as number[],
            }
        }
    }

    return null
}

// ========================
// 主要查询函数
// ========================

/**
 * SurrealDB 模型查询 Composable
 * 
 * @param db SurrealDB 客户端实例的 Ref
 */
export function useSurrealModelQuery(db: Ref<Surreal | null>) {

    /**
     * 查询几何实例信息 (移植自后端 query_insts)
     * 
     * @param refnos 构件编号列表
     * @param enableHoles 是否启用孔洞/布尔运算结果
     * @returns 几何实例查询结果
     */
    async function queryInsts(
        refnos: string[],
        enableHoles = false
    ): Promise<GeomInstQuery[]> {
        // 重要：使用 toRaw() 获取原始实例，避免 Vue Proxy 破坏私有字段访问
        const rawDb = toRaw(db.value)
        if (!rawDb || refnos.length === 0) {
            return []
        }

        // 批量处理，每批 50 个
        const batchSize = 50
        const results: GeomInstQuery[] = []

        for (let i = 0; i < refnos.length; i += batchSize) {
            const batch = refnos.slice(i, i + batchSize)
            const batchResults = await queryInstsBatch(batch, enableHoles)
            results.push(...batchResults)
        }

        return results
    }

    /**
     * 批量查询几何实例
     */
    async function queryInstsBatch(
        refnos: string[],
        enableHoles: boolean
    ): Promise<GeomInstQuery[]> {
        // 重要：使用 toRaw() 获取原始实例，避免 Vue Proxy 破坏私有字段访问
        const rawDb = toRaw(db.value)
        if (!rawDb) return []

        const instRelateKeys = refnos.map(r => toInstRelateKey(r)).join(',')

        // 布尔运算结果子查询
        // 这里不能用子查询 WHERE refno = in / in.in 去“关联外层记录”（Surreal 的子查询上下文不是这样传递的）。
        // 采用约定：inst_relate_bool 的 id 固定为 inst_relate_bool:⟨refno⟩，直接通过 type::record 构造记录引用。
        // 只有 status='Success' 时才返回 mesh_id，否则为 NONE。
        const boolMeshExpr =
            "IF type::record('inst_relate_bool', record::id(in.id)).status = 'Success' THEN type::record('inst_relate_bool', record::id(in.id)).mesh_id ELSE none END"

        // 构建查询 SQL (移植自 aios-core/src/rs_surreal/inst.rs)
        const sql = enableHoles ? `
            SELECT
                record::id(in.id) as refno,
                record::id(in.owner ?? in) as owner,
                generic,
                world_trans.d as world_trans,
                (SELECT value out.d FROM ->inst_relate_aabb LIMIT 1)[0] as world_aabb,
                (SELECT value out.pts.*.d FROM out->geo_relate WHERE visible && out.meshed && out.pts != none LIMIT 1)[0] as pts,
                IF ${boolMeshExpr} != none THEN
                    [{ "transform": world_trans.d, "geo_hash": ${boolMeshExpr}, "is_tubi": false, "unit_flag": false }]
                ELSE
                    (SELECT 
                        trans.d as transform, 
                        record::id(out) as geo_hash, 
                        color,
                        material_id,
                        false as is_tubi, 
                        out.unit_flag ?? false as unit_flag 
                     FROM out->geo_relate 
                     WHERE visible 
                       && (out.meshed || out.unit_flag || record::id(out) IN ['1','2','3']) 
                       && trans != none 
                       && geo_type IN ['Pos', 'Compound', 'DesiPos', 'CatePos'])
                END as insts,
                ${boolMeshExpr} != none as has_neg,
                <datetime>dt as date,
                spec_value
            FROM [${instRelateKeys}] 
            WHERE world_trans != none
        ` : `
            SELECT
                record::id(in.id) as refno,
                record::id(in.owner ?? in) as owner,
                generic,
                world_trans.d as world_trans,
                (SELECT value out.d FROM ->inst_relate_aabb LIMIT 1)[0] as world_aabb,
                (SELECT value out.pts.*.d FROM out->geo_relate WHERE visible && out.meshed && out.pts != none LIMIT 1)[0] as pts,
                (SELECT 
                    trans.d as transform, 
                    record::id(out) as geo_hash, 
                    color,
                    material_id,
                    false as is_tubi, 
                    out.unit_flag ?? false as unit_flag 
                 FROM out->geo_relate 
                 WHERE visible 
                   && (out.meshed || out.unit_flag || record::id(out) IN ['1','2','3']) 
                   && trans != none 
                   && geo_type IN ['Pos', 'DesiPos', 'CatePos']) as insts,
                ${boolMeshExpr} != none as has_neg,
                <datetime>dt as date,
                spec_value
            FROM [${instRelateKeys}] 
            WHERE world_trans != none
        `

        try {
            const rawResults = await rawDb.query(sql)
            const rows = (rawResults[0] ?? []) as unknown[]

            return rows.map(row => parseGeomInstRow(row))
        } catch (e) {
            console.error('[SurrealModelQuery] queryInsts failed:', e, '\nSQL:', sql)
            throw e
        }
    }

    /**
     * 解析查询结果行为 GeomInstQuery
     */
    function parseGeomInstRow(row: unknown): GeomInstQuery {
        const obj = row as Record<string, unknown>

        return {
            refno: extractRefno(obj.refno),
            owner: extractRefno(obj.owner),
            world_aabb: parseAabb(obj.world_aabb),
            world_trans: parseTransform(obj.world_trans),
            insts: parseInsts(obj.insts),
            has_neg: Boolean(obj.has_neg),
            generic: String(obj.generic ?? ''),
            pts: obj.pts as number[][] | null,
            date: obj.date ? String(obj.date) : null,
            spec_value: obj.spec_value != null ? Number(obj.spec_value) : null,
        }
    }

    /**
     * 解析实例列表
     */
    function parseInsts(insts: unknown): ModelHashInst[] {
        if (!Array.isArray(insts)) {
            return []
        }

        return insts.map(inst => {
            const obj = inst as Record<string, unknown>
            return {
                geo_hash: extractRefno(obj.geo_hash),
                transform: parseTransform(obj.transform),
                color: Array.isArray(obj.color) ? obj.color as number[] : undefined,
                material_id: obj.material_id ? String(obj.material_id) : undefined,
                is_tubi: Boolean(obj.is_tubi),
                unit_flag: Boolean(obj.unit_flag),
            }
        })
    }

    /**
     * 查询管道直段实例 (移植自后端 query_tubi_insts_by_brans)
     * 
     * @param branRefnos 分支构件编号列表
     * @returns 管道直段查询结果
     */
    async function queryTubiInstsByBrans(branRefnos: string[]): Promise<TubiInstQuery[]> {
        const rawDb = toRaw(db.value)
        if (!rawDb || branRefnos.length === 0) {
            return []
        }

        const results: TubiInstQuery[] = []

        for (const branRefno of branRefnos) {
            const peKey = toPeKey(branRefno)

            // 使用 ID range 查询 tubi_relate
            const sql = `
                SELECT
                    record::id(id[0]) as refno,
                    record::id(in) as leave,
                    id[0].owner.noun as generic,
                    aabb.d as world_aabb,
                    world_trans.d as world_trans,
                    record::id(geo) as geo_hash,
                    spec_value
                FROM tubi_relate:[${peKey}, 0]..[${peKey}, 999999]
            `

            try {
                const rawResults = await rawDb.query(sql)
                const rows = (rawResults[0] ?? []) as unknown[]

                for (const row of rows) {
                    const obj = row as Record<string, unknown>
                    results.push({
                        refno: extractRefno(obj.refno),
                        leave: extractRefno(obj.leave),
                        generic: obj.generic ? String(obj.generic) : null,
                        world_aabb: parseAabb(obj.world_aabb),
                        world_trans: parseTransform(obj.world_trans),
                        geo_hash: extractRefno(obj.geo_hash),
                        spec_value: obj.spec_value != null ? Number(obj.spec_value) : null,
                    })
                }
            } catch (e) {
                console.error('[SurrealModelQuery] queryTubiInstsByBrans failed:', e)
            }
        }

        return results
    }

    /**
     * 查询单个构件的基本信息
     */
    async function queryPeInfo(refno: string): Promise<Record<string, unknown> | null> {
        const rawDb = toRaw(db.value)
        if (!rawDb) return null

        const sql = `SELECT * FROM ${toPeKey(refno)}`

        try {
            const result = await rawDb.query(sql)
            const rows = result[0] as unknown[]
            return rows[0] as Record<string, unknown> | null
        } catch (e) {
            console.error('[SurrealModelQuery] queryPeInfo failed:', e)
            return null
        }
    }

    /**
     * 查询构件类型与父节点类型（用于 BRAN/HANG 特殊规则）
     */
    async function queryPeTypeInfo(refno: string): Promise<{ noun: string | null; ownerNoun: string | null } | null> {
        const rawDb = toRaw(db.value)
        if (!rawDb) return null

        const sql = `SELECT noun, owner.noun as owner_noun FROM ${toPeKey(refno)}`

        try {
            const result = await rawDb.query(sql)
            const rows = (result[0] ?? []) as Array<{ noun?: string; owner_noun?: string }>
            const row = rows[0]
            return {
                noun: row?.noun ? String(row.noun) : null,
                ownerNoun: row?.owner_noun ? String(row.owner_noun) : null,
            }
        } catch (e) {
            console.error('[SurrealModelQuery] queryPeTypeInfo failed:', e)
            return null
        }
    }

    /**
     * 查询可见几何子孙节点（移植自后端 query_visible_geo_descendants）
     */
    async function queryVisibleGeoDescendants(
        refno: string,
        options?: { includeSelf?: boolean; range?: string; applyBranHangRules?: boolean }
    ): Promise<string[]> {
        const rawDb = toRaw(db.value)
        if (!rawDb) return []

        const includeSelf = options?.includeSelf !== false
        const range = options?.range ?? '..'
        const applyRules = options?.applyBranHangRules !== false

        if (applyRules) {
            const typeInfo = await queryPeTypeInfo(refno)
            const noun = (typeInfo?.noun || '').toUpperCase()
            const ownerNoun = (typeInfo?.ownerNoun || '').toUpperCase()
            if (ownerNoun === 'BRAN' || ownerNoun === 'HANG') {
                return [refno]
            }
            if (noun === 'BRAN' || noun === 'HANG') {
                return await queryChildren(refno)
            }
        }

        const sql = `SELECT VALUE fn::visible_geo_descendants(${toPeKey(refno)}, ${includeSelf ? 'true' : 'false'}, "${range}")`

        try {
            const result = await rawDb.query(sql)
            const rows = (result[0] ?? []) as unknown[]
            const refnos = rows.map(r => extractRefno(r)).filter(Boolean)
            return Array.from(new Set(refnos))
        } catch (e) {
            console.error('[SurrealModelQuery] queryVisibleGeoDescendants failed:', e)
            throw e
        }
    }

    /**
     * 查询子构件列表
     */
    async function queryChildren(refno: string): Promise<string[]> {
        const rawDb = toRaw(db.value)
        if (!rawDb) return []

        const sql = `SELECT record::id(out) as child, order_index FROM ${toPeKey(refno)}->owns ORDER BY order_index`

        try {
            const result = await rawDb.query(sql)
            const rows = (result[0] ?? []) as { child: string }[]
            return rows.map(r => extractRefno(r.child))
        } catch (e) {
            console.error('[SurrealModelQuery] queryChildren failed:', e)
            return []
        }
    }

    return {
        /** 查询几何实例 */
        queryInsts,
        /** 查询管道直段 */
        queryTubiInstsByBrans,
        /** 查询构件信息 */
        queryPeInfo,
        /** 查询构件类型 */
        queryPeTypeInfo,
        /** 查询可见几何子孙 */
        queryVisibleGeoDescendants,
        /** 查询子构件 */
        queryChildren,
    }
}
