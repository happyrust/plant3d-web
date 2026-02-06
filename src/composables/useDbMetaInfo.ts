import { getJson, setJson } from '@/utils/storage/indexedDbCache'
import { buildFilesOutputUrl } from '@/lib/filesOutput'

type DbMetaFileEntry = {
  dbnum?: number
  ref0s?: Array<number | string>
}

type DbMetaInfoJson = {
  db_files?: Record<string, DbMetaFileEntry>
}

const IDB_STORE = 'meta_info' as const
const IDB_KEY = 'db_meta_info' as const
const META_URL = buildFilesOutputUrl('scene_tree/db_meta_info.json')

let ref0ToDbnum: Map<number, number> | null = null
let loadPromise: Promise<void> | null = null

function normalizeRefnoKeyLike(id: string): string {
  // 与模型树保持一致：兼容 record id 包装、= 前缀、/ 与 , 分隔符
  const raw = String(id || '').trim()
  if (!raw) return ''
  const wrapped = raw.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? raw
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '')
  return core.replace(/\//g, '_').replace(/,/g, '_')
}

function parseRef0FromRefno(refno: string): number {
  const normalized = normalizeRefnoKeyLike(refno)
  if (!normalized) throw new Error(`[db_meta] 非法 refno: ${String(refno)}`)
  const head = normalized.split('_')[0] || ''
  const n = Number(head)
  if (!Number.isFinite(n)) {
    throw new Error(`[db_meta] 无法从 refno 提取 ref0: ${normalized}`)
  }
  return n
}

function buildRef0Map(json: unknown): Map<number, number> {
  const map = new Map<number, number>()
  const anyJson = json as any

  const dbFiles: Record<string, DbMetaFileEntry> | null =
    anyJson && typeof anyJson === 'object' && anyJson.db_files && typeof anyJson.db_files === 'object'
      ? (anyJson.db_files as Record<string, DbMetaFileEntry>)
      : null

  if (!dbFiles) {
    throw new Error('[db_meta] db_meta_info.json 结构不符合预期：缺少 db_files')
  }

  for (const [dbnoKey, entry] of Object.entries(dbFiles)) {
    const dbnum = Number(entry?.dbnum ?? dbnoKey)
    if (!Number.isFinite(dbnum) || dbnum <= 0) {
      throw new Error(`[db_meta] 非法 dbnum: ${String(entry?.dbnum ?? dbnoKey)}`)
    }
    const ref0s = Array.isArray(entry?.ref0s) ? entry!.ref0s! : []
    for (const r0 of ref0s) {
      const ref0 = Number(r0)
      if (!Number.isFinite(ref0)) {
        throw new Error(`[db_meta] 非法 ref0: ${String(r0)} (dbnum=${dbnum})`)
      }
      const prev = map.get(ref0)
      if (prev != null && prev !== dbnum) {
        throw new Error(`[db_meta] ref0=${ref0} 同时映射到多个 dbnum: ${prev} / ${dbnum}`)
      }
      map.set(ref0, dbnum)
    }
  }

  if (map.size === 0) {
    throw new Error('[db_meta] db_meta_info.json 中未发现任何 ref0 映射')
  }

  return map
}

function applyDbMetaInfoJson(json: unknown): void {
  ref0ToDbnum = buildRef0Map(json)
}

export async function ensureDbMetaInfoLoaded(): Promise<void> {
  if (loadPromise) return await loadPromise

  loadPromise = (async () => {
    // 1) 尝试从 IndexedDB 预热（加速启动）
    const cached = await getJson<unknown>(IDB_STORE, IDB_KEY)
    if (cached) {
      try {
        applyDbMetaInfoJson(cached)
      } catch {
        // 缓存损坏：忽略预热，继续强制拉新
      }
    }

    // 2) 强制刷新（失败直接抛错，不回退）
    const resp = await fetch(META_URL)
    if (!resp.ok) {
      throw new Error(`[db_meta] 加载失败: HTTP ${resp.status} ${resp.statusText} (${META_URL})`)
    }
    const fresh = (await resp.json()) as unknown
    applyDbMetaInfoJson(fresh)
    await setJson(IDB_STORE, IDB_KEY, fresh)
  })()

  return await loadPromise
}

export function getDbnumByRefno(refno: string): number {
  if (!ref0ToDbnum) {
    throw new Error('[db_meta] 未加载：请先 await ensureDbMetaInfoLoaded()')
  }
  const ref0 = parseRef0FromRefno(refno)
  const dbnum = ref0ToDbnum.get(ref0)
  if (!dbnum) {
    throw new Error(`[db_meta] 未命中 ref0=${ref0}（refno=${normalizeRefnoKeyLike(refno)}）`)
  }
  return dbnum
}

/**
 * 宽松版：用于“场景状态回放/显隐”等非关键路径。
 * - 未加载 / 未命中：返回 null（不抛错）
 */
export function tryGetDbnumByRefno(refno: string): number | null {
  try {
    if (!ref0ToDbnum) return null
    const ref0 = parseRef0FromRefno(refno)
    const dbnum = ref0ToDbnum.get(ref0)
    return dbnum ?? null
  } catch {
    return null
  }
}
