/**
 * Dbno Instances Parquet Loader (new multi-table schema)
 *
 * 目标：
 * - 从 `/files/output/<project>/instances_parquet/manifest_{dbno}.json` 读取表清单
 * - 使用 DuckDB-WASM (HTTP Range) 查询 Parquet
 * - 按 refno 批量查询并返回 `Map<refnoKey, InstanceEntry[]>`，供 DTXLoader 增量加载
 *
 * 注意：
 * - 不替代旧 JSON loader；由 DTXLoader 在 dataSource=auto 时优先尝试本 loader，失败回退 JSON。
 */

import * as duckdb from '@duckdb/duckdb-wasm'
import { shallowRef } from 'vue'
import { buildFilesOutputUrl } from '@/lib/filesOutput'
import type { InstanceEntry } from '@/utils/instances/instanceManifest'
import { Matrix4 } from 'three'

type ParquetManifest = {
  version: number
  format: 'parquet'
  generated_at: string
  dbnum: number
  root_refno?: string | null
  tables: {
    instances: { file: string; rows?: number }
    geo_instances: { file: string; rows?: number }
    tubings: { file: string; rows?: number }
    transforms: { file: string; rows?: number }
    aabb: { file: string; rows?: number }
  }
}

type RegisteredDbno = {
  dbno: number
  baseDirUrl: string
  manifest: ParquetManifest
  // duckdb local filenames (to avoid cross-dbno collision)
  files: {
    instances: string
    geo_instances: string
    tubings: string
    transforms: string
    aabb: string
  }
}

class ParquetNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParquetNotFoundError'
  }
}

// DuckDB 单例（参考 useParquetSqlStore 的实现）
let db: duckdb.AsyncDuckDB | null = null
let conn: duckdb.AsyncDuckDBConnection | null = null
let initPromise: Promise<void> | null = null

// 每个 dbno 的注册缓存
const registeredByDbno = new Map<number, RegisteredDbno>()
const registeringByDbno = new Map<number, Promise<RegisteredDbno>>()

async function ensureDuckDB(): Promise<void> {
  if (db && conn) return
  if (initPromise) return await initPromise

  initPromise = (async () => {
    const bundles = duckdb.getJsDelivrBundles()
    const bundle = await duckdb.selectBundle(bundles)

    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    )
    const worker = new Worker(workerUrl)
    const logger = new duckdb.ConsoleLogger()
    db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    URL.revokeObjectURL(workerUrl)

    conn = await db.connect()
  })()

  return await initPromise
}

function normalizeRefnoKey(refno: string): string {
  // DTXLoader 使用的 key 约定：'/' -> '_'
  return String(refno || '').trim().replace('/', '_')
}

function sqlQuoteString(s: string): string {
  // DuckDB SQL: 单引号用 '' 转义
  return `'${String(s).replace(/'/g, "''")}'`
}

function buildInList(values: string[]): string {
  // 使用 LIST 常量 + UNNEST 比较安全，也避免超长 IN (...) 语句
  // e.g. UNNEST(['a','b','c'])
  const inner = values.map(sqlQuoteString).join(', ')
  return `[${inner}]`
}

function colsMajorToMatrixArray(row: any): number[] | null {
  // transforms.parquet: m00..m33 按列主序存储（后端 DMat4.to_cols_array）
  const keys = [
    'm00','m10','m20','m30',
    'm01','m11','m21','m31',
    'm02','m12','m22','m32',
    'm03','m13','m23','m33',
  ]
  const out: number[] = []
  for (const k of keys) {
    const v = (row as any)[k]
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return null
    out.push(n)
  }
  return out
}

function multiplyWorldAndGeoLocal(worldCols: number[], geoCols: number[] | null): number[] {
  // three.js Matrix4.fromArray 默认按列主序解释（与 glMatrix/OpenGL 一致）
  const mw = new Matrix4().fromArray(worldCols)
  if (!geoCols) return mw.toArray()
  const mg = new Matrix4().fromArray(geoCols)
  // world * geoLocal
  const combined = mw.multiply(mg)
  return combined.toArray()
}

async function fetchManifest(dbno: number): Promise<ParquetManifest> {
  const url = buildFilesOutputUrl(`instances_parquet/manifest_${dbno}.json`)
  const resp = await fetch(url)
  if (resp.status === 404) {
    throw new ParquetNotFoundError(`manifest not found: ${url}`)
  }
  if (!resp.ok) {
    throw new Error(`加载 manifest 失败: HTTP ${resp.status} ${resp.statusText}`)
  }
  const json = (await resp.json()) as ParquetManifest
  if (!json || typeof json !== 'object' || !json.tables?.instances?.file) {
    throw new Error('manifest 结构不符合预期')
  }
  return json
}

async function registerDbno(dbno: number): Promise<RegisteredDbno> {
  const cached = registeredByDbno.get(dbno)
  if (cached) return cached
  const pending = registeringByDbno.get(dbno)
  if (pending) return await pending

  const task = (async () => {
    await ensureDuckDB()
    if (!db || !conn) throw new Error('DuckDB not ready')

    const manifest = await fetchManifest(dbno)
    const baseDirUrl = buildFilesOutputUrl('instances_parquet')

    const files = {
      instances: `p_${dbno}_instances.parquet`,
      geo_instances: `p_${dbno}_geo_instances.parquet`,
      tubings: `p_${dbno}_tubings.parquet`,
      transforms: `p_${dbno}_transforms.parquet`,
      aabb: `p_${dbno}_aabb.parquet`,
    }

    // 注册远程文件（HTTP Range）
    const registerOne = async (localName: string, remoteFile: string) => {
      const url = `${baseDirUrl}/${remoteFile}`.replace(/\/{2,}/g, '/')
      // buildFilesOutputUrl 会返回以 /files/output 开头的绝对路径；这里做简单 join
      const remoteUrl = url.startsWith('/files/') ? url : `${baseDirUrl}/${remoteFile}`
      await db!.registerFileURL(localName, remoteUrl, duckdb.DuckDBDataProtocol.HTTP, false)
    }

    await Promise.all([
      registerOne(files.instances, manifest.tables.instances.file),
      registerOne(files.geo_instances, manifest.tables.geo_instances.file),
      registerOne(files.tubings, manifest.tables.tubings.file),
      registerOne(files.transforms, manifest.tables.transforms.file),
      registerOne(files.aabb, manifest.tables.aabb.file),
    ])

    const reg: RegisteredDbno = { dbno, baseDirUrl, manifest, files }
    registeredByDbno.set(dbno, reg)
    return reg
  })()

  registeringByDbno.set(dbno, task)
  try {
    return await task
  } finally {
    registeringByDbno.delete(dbno)
  }
}

export function useDbnoInstancesParquetLoader() {
  const lastError = shallowRef<string | null>(null)

  async function isParquetAvailable(dbno: number): Promise<boolean> {
    try {
      await fetchManifest(dbno)
      return true
    } catch {
      return false
    }
  }

  async function queryInstanceEntriesByRefnos(
    dbno: number,
    refnoKeys: string[],
    options?: { debug?: boolean }
  ): Promise<Map<string, InstanceEntry[]>> {
    lastError.value = null

    const debug = options?.debug === true
    const normalized = Array.from(new Set(refnoKeys.map(normalizeRefnoKey))).filter(Boolean)
    if (normalized.length === 0) return new Map()

    const reg = await registerDbno(dbno)
    await ensureDuckDB()
    if (!conn) throw new Error('DuckDB connection unavailable')

    // refno 在 parquet 里是 refno_str（带 /），而 DTX 侧使用 '_' key。
    // 这里需要把 '_' 转回 '/' 以匹配 parquet（仅替换第一个 '_'）
    const toRefnoStr = (k: string) => {
      const s = String(k)
      const idx = s.indexOf('_')
      if (idx <= 0) return s
      return `${s.slice(0, idx)}/${s.slice(idx + 1)}`
    }

    const resultMap = new Map<string, InstanceEntry[]>()

    const CHUNK = 500
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunkKeys = normalized.slice(i, i + CHUNK)
      const chunkRefnoStr = chunkKeys.map(toRefnoStr)
      const listExpr = buildInList(chunkRefnoStr)

      const sql = `
        WITH target(refno_str) AS (
          SELECT UNNEST(${listExpr}) AS refno_str
        )
        SELECT
          i.refno_str,
          i.noun,
          i.name,
          i.owner_refno_str,
          i.owner_noun,
          i.spec_value,
          i.has_neg,
          i.trans_hash,
          i.aabb_hash,
          gi.geo_index,
          gi.geo_hash,
          gi.geo_trans_hash,
          aw.min_x, aw.min_y, aw.min_z, aw.max_x, aw.max_y, aw.max_z,
          tw.m00, tw.m10, tw.m20, tw.m30,
          tw.m01, tw.m11, tw.m21, tw.m31,
          tw.m02, tw.m12, tw.m22, tw.m32,
          tw.m03, tw.m13, tw.m23, tw.m33,
          tg.m00 AS g_m00, tg.m10 AS g_m10, tg.m20 AS g_m20, tg.m30 AS g_m30,
          tg.m01 AS g_m01, tg.m11 AS g_m11, tg.m21 AS g_m21, tg.m31 AS g_m31,
          tg.m02 AS g_m02, tg.m12 AS g_m12, tg.m22 AS g_m22, tg.m32 AS g_m32,
          tg.m03 AS g_m03, tg.m13 AS g_m13, tg.m23 AS g_m23, tg.m33 AS g_m33
        FROM target t
        JOIN parquet_scan('${reg.files.instances}') i ON i.refno_str = t.refno_str
        JOIN parquet_scan('${reg.files.geo_instances}') gi ON gi.refno_str = i.refno_str
        LEFT JOIN parquet_scan('${reg.files.aabb}') aw ON aw.aabb_hash = i.aabb_hash
        LEFT JOIN parquet_scan('${reg.files.transforms}') tw ON tw.trans_hash = i.trans_hash
        LEFT JOIN parquet_scan('${reg.files.transforms}') tg ON tg.trans_hash = gi.geo_trans_hash
        ORDER BY i.refno_str, gi.geo_index
      `

      const arrow = await conn.query(sql)
      const rows = arrow.toArray() as any[]

      for (const row of rows) {
        const refnoStr = String(row.refno_str || '')
        const refnoKey = normalizeRefnoKey(refnoStr)
        if (!refnoKey) continue

        const worldCols = colsMajorToMatrixArray(row)
        if (!worldCols) continue

        // geo local matrix（可能为空）
        const geoLocal = (() => {
          const gRow: any = {
            m00: row.g_m00, m10: row.g_m10, m20: row.g_m20, m30: row.g_m30,
            m01: row.g_m01, m11: row.g_m11, m21: row.g_m21, m31: row.g_m31,
            m02: row.g_m02, m12: row.g_m12, m22: row.g_m22, m32: row.g_m32,
            m03: row.g_m03, m13: row.g_m13, m23: row.g_m23, m33: row.g_m33,
          }
          // 如果 tg 没 join 到，字段会是 null
          const anyVal = Object.values(gRow).some((v) => v !== null && v !== undefined)
          if (!anyVal) return null
          const arr = colsMajorToMatrixArray(gRow)
          return arr
        })()

        const matrix = multiplyWorldAndGeoLocal(worldCols, geoLocal)

        const aabb =
          row.min_x !== null && row.max_x !== null
            ? { min: [Number(row.min_x), Number(row.min_y), Number(row.min_z)], max: [Number(row.max_x), Number(row.max_y), Number(row.max_z)] }
            : null

        const noun = String(row.noun ?? '')
        const ownerRefno = row.owner_refno_str ? String(row.owner_refno_str) : null
        const ownerNoun = String(row.owner_noun ?? '')

        const entry: InstanceEntry = {
          geo_hash: String(row.geo_hash ?? ''),
          matrix,
          geo_index: Number(row.geo_index ?? 0),
          color_index: 0,
          name_index: 0,
          site_name_index: 0,
          lod_mask: 1,
          uniforms: {
            refno: refnoStr,
            noun,
            name: row.name ? String(row.name) : '',
            owner_refno: ownerRefno,
            owner_noun: ownerNoun,
            spec_value: Number(row.spec_value ?? 0),
            has_neg: Boolean(row.has_neg),
            trans_hash: row.trans_hash ? String(row.trans_hash) : '',
            aabb_hash: row.aabb_hash ? String(row.aabb_hash) : '',
          },
          refno_transform: worldCols,
          aabb,
        }

        if (!entry.geo_hash) continue

        const list = resultMap.get(refnoKey) ?? []
        list.push(entry)
        resultMap.set(refnoKey, list)
      }

      if (debug) {
        // eslint-disable-next-line no-console
        console.log('[instances-parquet] chunk loaded', { dbno, chunk: [i, i + CHUNK], rows: rows.length })
      }
    }

    return resultMap
  }

  return {
    lastError,
    isParquetAvailable,
    queryInstanceEntriesByRefnos,
  }
}

