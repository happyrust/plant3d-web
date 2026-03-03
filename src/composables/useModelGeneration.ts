import { ref } from 'vue'
import type { Ref } from 'vue'

import { e3dGetSubtreeRefnos } from '@/api/genModelE3dApi'
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader'
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader'
import { useConsoleStore } from '@/composables/useConsoleStore'
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo'

/**
 * 全局开关：是否跳过自动生成（SSE 流式生成、弹窗选择等）
 * 设为 true 时，只加载已有的 instances 文件，不触发任何生成流程
 */
export const SKIP_AUTO_GENERATION = false

/**
 * 运行时开关：是否跳过自动生成。
 *
 * 优先级（从高到低）：
 * 1) URL query: `skip_auto_gen=1`
 * 2) localStorage: `skip_auto_gen=1`
 * 3) env: `VITE_SKIP_AUTO_GENERATION=1`
 * 4) 默认：false（即自动生成开启）
 */
export function isSkipAutoGeneration(): boolean {
  if (typeof window === 'undefined') return false

  try {
    const q = new URLSearchParams(window.location.search)
    const qv = String(q.get('skip_auto_gen') ?? '').trim().toLowerCase()
    if (qv === '1' || qv === 'true') return true
  } catch {
    // ignore
  }

  try {
    const ls: any = (globalThis as any).localStorage ?? (window as any).localStorage
    const raw =
      ls && typeof ls.getItem === 'function'
        ? ls.getItem('skip_auto_gen')
        : ls
          ? ls['skip_auto_gen']
          : null
    const lv = String(raw ?? '').trim().toLowerCase()
    if (lv === '1' || lv === 'true') return true
  } catch {
    // ignore
  }

  // env（构建时注入）
  try {
    const v = String((import.meta.env as any)?.VITE_SKIP_AUTO_GENERATION ?? '').trim().toLowerCase()
    if (v === '1' || v === 'true') return true
  } catch {
    // ignore
  }

  return false
}
const VISIBLE_REFNOS_PAGE_SIZE = 1000

export interface ModelGenerationOptions {
  db_num?: number
  viewer: unknown
}

export interface ModelGenerationState {
  isGenerating: Ref<boolean>
  progress: Ref<number>
  statusMessage: Ref<string>
  error: Ref<string | null>
  bundleUrl: Ref<string | null>
  totalCount: Ref<number>
  currentIndex: Ref<number>
  currentRefno: Ref<string>
  lastLoadDebug: Ref<ModelLoadDebugInfo | null>
}

export type ModelLoadDebugInfo = {
  refno: string
  dbno: number
  visibleInsts: { ok: boolean; count: number; error: string | null }
  manifestMatch?: { candidates: number; matched: number; missing: number; missingSample: string[] }
  loadRefnos: { count: number; sample: string[] }
  result: { loadedRefnos: number; skippedRefnos: number; loadedObjects: number } | null
  ms: number
}

function normalizeRefnoString(refno: string): string {
  return String(refno || '').trim().replace('/', '_')
}

function uniqStrings(list: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const v = String(raw || '').trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

async function querySubtreeRefnos(refno: string): Promise<{ refnos: string[]; truncated: boolean }> {
  const normalized = normalizeRefnoString(refno)
  if (!normalized) return { refnos: [], truncated: false }

  // 约定：后端返回“子孙可见 refnos”（此处用 subtree-refnos 承接）
  const resp = await e3dGetSubtreeRefnos(normalized, { includeSelf: true, limit: 200_000 })
  if (!resp.success) {
    throw new Error(resp.error_message || 'e3d subtree-refnos 查询失败')
  }
  const list = Array.isArray(resp.refnos) ? resp.refnos : []
  const out = uniqStrings(list.map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean)
  return { refnos: out, truncated: !!resp.truncated }
}

export function useModelGeneration(options: ModelGenerationOptions): ModelGenerationState & {
  generateAndLoadModel: (refno: string) => Promise<boolean>
  showModelByRefno: (refno: string, options?: { flyTo?: boolean }) => Promise<boolean>
  checkRefnoExists: (refno: string) => boolean
} {
  const { viewer } = options
  const consoleStore = useConsoleStore()

  const isGenerating = ref(false)
  const progress = ref(0)
  const statusMessage = ref('')
  const error = ref<string | null>(null)
  const bundleUrl = ref<string | null>(null)
  const totalCount = ref(0)
  const currentIndex = ref(0)
  const currentRefno = ref('')
  const lastLoadDebug = ref<ModelLoadDebugInfo | null>(null)

  const loadedRoots = new Set<string>()

  function checkRefnoExists(refno: string): boolean {
    if (loadedRoots.has(refno)) return true
    const v = viewer as any
    return !!v?.scene?.objects?.[refno]
  }

  async function showModelByRefno(refno: string, loadOptions?: { flyTo?: boolean }): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno)
    if (!normalizedRoot) return false
    if (checkRefnoExists(normalizedRoot)) {
      if (loadOptions?.flyTo) {
        try {
          const anyViewer = viewer as any
          const aabb = anyViewer?.scene?.getAABB?.([normalizedRoot]) ?? null
          if (aabb) {
            anyViewer?.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true })
            consoleStore.addLog('info', `[model-load] flyTo 已加载 refno=${normalizedRoot}`)
          } else {
            consoleStore.addLog('error', `[model-load] flyTo 失败：AABB 为空 refno=${normalizedRoot}`)
          }
        } catch (e) {
          consoleStore.addLog(
            'error',
            `[model-load] flyTo 异常 refno=${normalizedRoot} err=${e instanceof Error ? e.message : String(e)}`
          )
        }
      }
      return true
    }

    isGenerating.value = true
    error.value = null
    lastLoadDebug.value = null
    progress.value = 0
    statusMessage.value = '准备加载模型...'
    currentRefno.value = normalizedRoot
    totalCount.value = 1
    currentIndex.value = 1

    try {
      const startedAt = Date.now()
      let dbno: number
      if (typeof options.db_num === 'number') {
        dbno = options.db_num
      } else {
        await ensureDbMetaInfoLoaded()
        dbno = getDbnumByRefno(normalizedRoot)
      }
      if (!Number.isFinite(dbno) || dbno <= 0) throw new Error('无法确定 dbno')

      statusMessage.value = '查询可见几何子孙...'
      progress.value = 10
      let visibleOk = false
      let visibleErr: string | null = null
      let visibleRefnos: string[] = []
      try {
        const { refnos, truncated } = await querySubtreeRefnos(normalizedRoot)
        visibleRefnos = refnos
        if (truncated) {
          consoleStore.addLog('error', `[model-load] subtree-refnos 返回被截断 refno=${normalizedRoot}（limit=200000）`)
        }

        visibleRefnos = uniqStrings(visibleRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean)
        visibleOk = true
        visibleErr = null
      } catch (e) {
        visibleOk = false
        visibleErr = e instanceof Error ? e.message : String(e)
        visibleRefnos = []
      }
      consoleStore.addLog(
        'info',
        `[model-load] visible_refnos ok=${visibleOk ? 1 : 0} refno=${normalizedRoot} dbno=${dbno} count=${visibleRefnos.length}` +
          (visibleErr ? ` err=${visibleErr}` : '')
      )

      const anyViewer = viewer as unknown as {
        __dtxLayer?: unknown
        __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
      }
      const dtxLayer = anyViewer.__dtxLayer as any
      if (!dtxLayer) throw new Error('DTXLayer 未初始化，无法加载模型')

      const loadRefnos = uniqStrings(visibleRefnos.length > 0 ? visibleRefnos : [normalizedRoot]).filter(Boolean)
      if (loadRefnos.length === 0) {
        statusMessage.value = '无可加载模型（无可见 refno）'
        progress.value = 100
        lastLoadDebug.value = {
          refno: normalizedRoot,
          dbno,
          visibleInsts: { ok: visibleOk, count: visibleRefnos.length, error: visibleErr },
          loadRefnos: { count: 0, sample: [] },
          result: { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0 },
          ms: Date.now() - startedAt,
        }
        return false
      }

      const LOAD_BATCH_SIZE = VISIBLE_REFNOS_PAGE_SIZE

      async function loadRefnosInChunks(refnos: string[], dbnoValue: number): Promise<{
        loadedRefnos: number
        skippedRefnos: number
        loadedObjects: number
        missingRefnos: string[]
        missingBreakdown: {
          noGeoRowsRefnos: string[]
          mesh404Refnos: string[]
          mesh404GeoHashes: string[]
        }
      }> {
        if (refnos.length === 0) {
          return {
            loadedRefnos: 0,
            skippedRefnos: 0,
            loadedObjects: 0,
            missingRefnos: [],
            missingBreakdown: {
              noGeoRowsRefnos: [],
              mesh404Refnos: [],
              mesh404GeoHashes: [],
            },
          }
        }

        const total = refnos.length
        const batchTotal = Math.ceil(total / LOAD_BATCH_SIZE)
        let loadedRefnos = 0
        let skippedRefnos = 0
        let loadedObjects = 0
        const missingAll: string[] = []
        const noGeoRowsAll = new Set<string>()
        const mesh404RefnosAll = new Set<string>()
        const mesh404GeoHashesAll = new Set<string>()

        for (let start = 0; start < total; start += LOAD_BATCH_SIZE) {
          const end = Math.min(total, start + LOAD_BATCH_SIZE)
          const batch = refnos.slice(start, end)
          const batchIndex = Math.floor(start / LOAD_BATCH_SIZE) + 1

          statusMessage.value = `加载 refno 批次 ${batchIndex}/${batchTotal} (${end}/${total})...`
          progress.value = Math.max(60, Math.min(95, 60 + Math.floor((end / total) * 35)))

          const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbnoValue, batch, {
            lodAssetKey: 'L1',
            debug: false,
            dataSource: 'parquet',
          })
          anyViewer.__dtxAfterInstancesLoaded?.(dbnoValue, batch)

          loadedRefnos += result.loadedRefnos
          skippedRefnos += result.skippedRefnos
          loadedObjects += result.loadedObjects

          if (result.missingRefnos.length > 0) {
            missingAll.push(...result.missingRefnos)
          }
          for (const r of result.missingBreakdown.noGeoRowsRefnos) {
            noGeoRowsAll.add(r)
          }
          for (const r of result.missingBreakdown.mesh404Refnos) {
            mesh404RefnosAll.add(r)
          }
          for (const gh of result.missingBreakdown.mesh404GeoHashes) {
            mesh404GeoHashesAll.add(gh)
          }
        }

        return {
          loadedRefnos,
          skippedRefnos,
          loadedObjects,
          missingRefnos: uniqStrings(missingAll),
          missingBreakdown: {
            noGeoRowsRefnos: Array.from(noGeoRowsAll),
            mesh404Refnos: Array.from(mesh404RefnosAll),
            mesh404GeoHashes: Array.from(mesh404GeoHashesAll),
          },
        }
      }

      statusMessage.value = `加载 ${loadRefnos.length} 个 refno 的 Parquet 实例...`
      progress.value = 60
      consoleStore.addLog('info', `[model-load] 开始 parquet 加载 dbno=${dbno} refno_count=${loadRefnos.length}`)

      const result = await loadRefnosInChunks(loadRefnos, dbno)

      if (result.missingRefnos.length > 0) {
        const sample = result.missingRefnos.slice(0, 50)
        const noGeoCount = result.missingBreakdown.noGeoRowsRefnos.length
        const mesh404RefnoCount = result.missingBreakdown.mesh404Refnos.length
        const mesh404HashCount = result.missingBreakdown.mesh404GeoHashes.length

        if (mesh404RefnoCount > 0) {
          const meshRefSample = result.missingBreakdown.mesh404Refnos.slice(0, 30)
          const meshHashSample = result.missingBreakdown.mesh404GeoHashes.slice(0, 10)
          consoleStore.addLog(
            'error',
            `[model-load] parquet mesh文件缺失 dbno=${dbno} refnos=${mesh404RefnoCount} geo_hashes=${mesh404HashCount} refno_sample=${meshRefSample.join(',')}${mesh404RefnoCount > meshRefSample.length ? ' ...' : ''} geo_hash_sample=${meshHashSample.join(',')}${mesh404HashCount > meshHashSample.length ? ' ...' : ''}`
          )
          try {
            const parquetLoader = useDbnoInstancesParquetLoader()
            const validation = await parquetLoader.queryMeshValidationInfoByDbno(dbno, { topN: 5 })
            if (validation) {
              const top = validation.topMissingGeoHashes
                .map((x) => `${x.geoHash}(${x.rowCount})`)
                .join(',')
              consoleStore.addLog(
                'info',
                `[model-load] parquet mesh校验报告 dbno=${dbno} checked=${validation.checkedGeoHashes} missing_hashes=${validation.missingGeoHashes} missing_owner_refnos=${validation.missingOwnerRefnos} report=${validation.reportFile ?? 'N/A'}${top ? ` top=${top}` : ''}`
              )
            }
          } catch {
            // ignore report loading errors
          }
        }
        if (noGeoCount > 0) {
          const noGeoSample = result.missingBreakdown.noGeoRowsRefnos.slice(0, 30)
          consoleStore.addLog(
            'info',
            `[model-load] parquet 无几何行 dbno=${dbno} refnos=${noGeoCount} sample=${noGeoSample.join(',')}${noGeoCount > noGeoSample.length ? ' ...' : ''}`
          )
        }
        if (mesh404RefnoCount === 0 && noGeoCount === 0) {
          consoleStore.addLog(
            'error',
            `[model-load] parquet 缺失模型 dbno=${dbno} missing=${result.missingRefnos.length} sample=${sample.join(',')}${result.missingRefnos.length > sample.length ? ' ...' : ''}`
          )
        }
      }

      if (loadOptions?.flyTo) {
        try {
          const anyViewer = viewer as any
          const max = 5000
          const flyRefnos = loadRefnos.length > max ? loadRefnos.slice(0, max) : loadRefnos
          if (loadRefnos.length > flyRefnos.length) {
            consoleStore.addLog('info', `[model-load] flyTo refnos 过多，截断 ${flyRefnos.length}/${loadRefnos.length}`)
          }
          const aabb = anyViewer?.scene?.getAABB?.(flyRefnos) ?? null
          if (aabb) {
            anyViewer?.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true })
            consoleStore.addLog('info', `[model-load] flyTo 完成 refno=${normalizedRoot}`)
          } else {
            consoleStore.addLog('error', `[model-load] flyTo 失败：AABB 为空 refno=${normalizedRoot}`)
          }
        } catch (e) {
          consoleStore.addLog(
            'error',
            `[model-load] flyTo 异常 refno=${normalizedRoot} err=${e instanceof Error ? e.message : String(e)}`
          )
        }
      }

      lastLoadDebug.value = {
        refno: normalizedRoot,
        dbno,
        visibleInsts: {
          ok: visibleOk,
          count: visibleRefnos.length,
          error: visibleErr,
        },
        loadRefnos: { count: loadRefnos.length, sample: loadRefnos.slice(0, 10) },
        result: result
          ? { loadedRefnos: result.loadedRefnos, skippedRefnos: result.skippedRefnos, loadedObjects: result.loadedObjects }
          : null,
        ms: Date.now() - startedAt,
      }

      loadedRoots.add(normalizedRoot)
      statusMessage.value = result.loadedObjects > 0 ? '加载完成' : '无可见几何实例'
      progress.value = 100
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      statusMessage.value = '加载失败'
      return false
    } finally {
      isGenerating.value = false
    }
  }

  async function generateAndLoadModel(refno: string): Promise<boolean> {
    // 统一入口：当前策略下“显示”即按需触发生成 instances 并加载
    return await showModelByRefno(refno)
  }

  return {
    isGenerating,
    progress,
    statusMessage,
    error,
    bundleUrl,
    totalCount,
    currentIndex,
    currentRefno,
    lastLoadDebug,
    generateAndLoadModel,
    showModelByRefno,
    checkRefnoExists,
  }
}
