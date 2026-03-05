import { ref } from 'vue'
import type { Ref } from 'vue'

import { e3dGetSubtreeRefnos } from '@/api/genModelE3dApi'
import { enqueueParquetIncremental, getParquetVersion } from '@/api/genModelRealtimeApi'
import { modelShowByRefno } from '@/api/genModelTaskApi'
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore'
import { triggerBatchGenerateSse } from '@/composables/useDbnoInstancesJsonLoader'
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader'
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader'
import { useConsoleStore } from '@/composables/useConsoleStore'
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo'
import type { InstanceManifest } from '@/utils/instances/instanceManifest'

/**
 * 全局开关：是否跳过自动生成（SSE 流式生成、弹窗选择等）
 * 默认 false（开启自动补生成）；可通过 query/localStorage 强制关闭：
 * - query: `dtx_skip_auto_generation=1`
 * - localStorage: `dtx_skip_auto_generation=1`
 */
function shouldSkipAutoGeneration(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search)
    const rawQ = (q.get('dtx_skip_auto_generation') || '').trim().toLowerCase()
    if (rawQ === '1' || rawQ === 'true') return true
    if (rawQ === '0' || rawQ === 'false') return false

    const rawLs = (window.localStorage?.getItem('dtx_skip_auto_generation') || '').trim().toLowerCase()
    if (rawLs === '1' || rawLs === 'true') return true
    if (rawLs === '0' || rawLs === 'false') return false
  } catch {
    // ignore
  }
  return false
}

export const SKIP_AUTO_GENERATION = shouldSkipAutoGeneration()
const VISIBLE_REFNOS_PAGE_SIZE = 1000

export interface ModelGenerationOptions {
  db_num?: number
  viewer: unknown
}

export interface ModelGenerationState {
  isGenerating: Ref<boolean>
  showProgressModal: Ref<boolean>
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

function toBackendRefno(refno: string): string {
  const normalized = normalizeRefnoString(refno)
  const m = normalized.match(/^(\d+)_(\d+)$/)
  if (m) return `${m[1]}/${m[2]}`
  return normalized
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

function deriveLoadRefnosFromInstancesManifest(manifest: InstanceManifest, rootRefno: string): string[] {
  const root = normalizeRefnoString(rootRefno)
  if (!root) return []

  // -1) gen-model-fork V0：顶层 instances（每个 refno 下挂 geo_instances）
  // 这类数据没有层级信息，visible-insts 不可用时只能在“加载 root”与“加载文件内所有 refno”之间选择。
  const flatV0 = (manifest as any)?.instances
  if (Array.isArray(flatV0) && flatV0.length > 0 && Array.isArray(flatV0[0]?.geo_instances)) {
    const allRefnos = uniqStrings(flatV0.map((x: any) => normalizeRefnoString(String(x?.refno ?? ''))).filter(Boolean))
    if (allRefnos.length === 0) return [root]

    // root 在文件内：默认加载文件内所有 refno（更符合“离线/导出子集直接预览”场景）
    // 软阈值避免意外把超大 dbno 全量塞进前端（e3d 正常时仍会走 visible-insts 分支）
    const MAX_FALLBACK_REFNOS = 20_000
    if (allRefnos.includes(root)) {
      return allRefnos.length <= MAX_FALLBACK_REFNOS ? allRefnos : [root]
    }

    // root 不在文件内：兜底加载文件内所有 refno（小文件更直观；大文件仍避免卡死）
    return allRefnos.length <= MAX_FALLBACK_REFNOS ? allRefnos : [root]
  }

  // 0) export_dbnum_instances_json 新格式：groups（owner_refno + children/tubings）
  for (const g of (manifest as any)?.groups || []) {
    const ownerRefno = normalizeRefnoString(String(g?.owner_refno || ''))
    if (!ownerRefno) continue

    // root 是 owner：加载 owner + children + tubings（用于承接 tubing 的 refno 以及 UI 切换）
    if (ownerRefno === root) {
      const childRefnos = Array.isArray(g?.children)
        ? g.children.map((c: any) => normalizeRefnoString(String(c?.refno || ''))).filter(Boolean)
        : []

      const tubingRefnos = Array.isArray(g?.tubings)
        ? g.tubings.map((t: any) => normalizeRefnoString(String(t?.refno ?? t?.uniforms?.refno ?? ''))).filter(Boolean)
        : []

      return uniqStrings([ownerRefno, ...childRefnos, ...tubingRefnos]).filter(Boolean)
    }

    // root 是 child / tubing：直接加载自身
    if (Array.isArray(g?.children)) {
      for (const c of g.children) {
        const r = normalizeRefnoString(String(c?.refno || ''))
        if (r && r === root) return [root]
      }
    }
    if (Array.isArray(g?.tubings)) {
      for (const t of g.tubings) {
        const r = normalizeRefnoString(String(t?.refno ?? t?.uniforms?.refno ?? ''))
        if (r && r === root) return [root]
      }
    }
  }

  // 1) V2: bran/equi group root -> children + (可选) tubings refno + group 自身（用于承接 tubing fallbackRefno）
  const groups = ([] as any[]).concat(manifest.bran_groups || []).concat(manifest.equi_groups || [])
  for (const g of groups) {
    const groupRefno = normalizeRefnoString(String(g?.refno || ''))
    if (!groupRefno || groupRefno !== root) continue

    const childRefnos = Array.isArray(g?.children)
      ? g.children.map((c: any) => normalizeRefnoString(String(c?.refno || ''))).filter(Boolean)
      : []

    const tubingRefnos = Array.isArray(g?.tubings)
      ? g.tubings
          .map((t: any) => normalizeRefnoString(String(t?.refno ?? t?.uniforms?.refno ?? '')))
          .filter(Boolean)
      : []

    return uniqStrings([groupRefno, ...childRefnos, ...tubingRefnos]).filter(Boolean)
  }

  // 2) root 自身在 component 列表中（V1/V2 均可）
  const components = ([] as any[]).concat(manifest.ungrouped || []).concat(manifest.components || [])
  for (const c of components) {
    const r = normalizeRefnoString(String(c?.refno || ''))
    if (r && r === root) return [root]
  }

  // 3) root 是 group.children 中的某个 component（可直接加载自身）
  for (const g of groups) {
    for (const c of g?.children || []) {
      const r = normalizeRefnoString(String(c?.refno || ''))
      if (r && r === root) return [root]
    }
  }

  // 4) 兜底：尝试加载 root 本身
  return [root]
}

function isAutomationMode(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('dtx_automation') === '1') return true
    if (window.localStorage?.getItem('dtx_automation') === '1') return true
  } catch {
    // ignore
  }
  return false
}

export function useModelGeneration(options: ModelGenerationOptions): ModelGenerationState & {
  generateAndLoadModel: (refno: string) => Promise<boolean>
  showModelByRefno: (refno: string, options?: { flyTo?: boolean }) => Promise<boolean>
  checkRefnoExists: (refno: string) => boolean
} {
  const { viewer } = options
  const dialog = useConfirmDialogStore()
  const consoleStore = useConsoleStore()

  const isGenerating = ref(false)
  const showProgressModal = ref(false)
  const progress = ref(0)
  const statusMessage = ref('')
  const error = ref<string | null>(null)
  const bundleUrl = ref<string | null>(null)
  const totalCount = ref(0)
  const currentIndex = ref(0)
  const currentRefno = ref('')
  const lastLoadDebug = ref<ModelLoadDebugInfo | null>(null)

  const loadedRoots = new Set<string>()
  const PARQUET_VERSION_POLL_INTERVAL_MS = 3000

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function loadGeneratedRefnos(
    dtxLayer: any,
    dbno: number,
    refnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void }
  ): Promise<{
    loadedRefnos: number
    skippedRefnos: number
    loadedObjects: number
    missingRefnos: string[]
  }> {
    if (refnos.length === 0) {
      return { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, missingRefnos: [] }
    }

    statusMessage.value = '正在加载实时生成模型...'
    progress.value = Math.max(progress.value, 96)

    const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, refnos, {
      lodAssetKey: 'L1',
      debug: false,
      dataSource: 'backend',
      forceReloadRefnos: refnos,
    })
    anyViewer.__dtxAfterInstancesLoaded?.(dbno, refnos)
    return result
  }

  async function pollParquetVersionAfterEnqueue(
    dbno: number,
    baselineRevision: number,
    maxWaitMs = 3 * 60 * 1000
  ): Promise<{ updated: boolean; revision: number; error?: string }> {
    const startedAt = Date.now()
    let lastError = ''

    while (Date.now() - startedAt < maxWaitMs) {
      await sleep(PARQUET_VERSION_POLL_INTERVAL_MS)
      try {
        const version = await getParquetVersion(dbno)
        const revision = Number(version.revision || 0)
        if (revision > baselineRevision) {
          return { updated: true, revision }
        }
        if (!version.running && Number(version.pending_count || 0) <= 0) {
          return {
            updated: false,
            revision,
            error: version.last_error || undefined,
          }
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    return {
      updated: false,
      revision: baselineRevision,
      error: lastError || '版本轮询超时',
    }
  }

  async function ensureParquetAvailableByAutoExport(
    dbno: number,
    candidateRefnos: string[]
  ): Promise<boolean> {
    const parquetLoader = useDbnoInstancesParquetLoader()
    if (await parquetLoader.isParquetAvailable(dbno)) return true

    if (SKIP_AUTO_GENERATION) {
      console.warn(`[model-generation] parquet 缺失且已禁用自动补生成 dbno=${dbno}`)
      return false
    }

    const normalized = uniqStrings(candidateRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean)
    if (normalized.length === 0) return false
    const backendRefnos = normalized.map((r) => toBackendRefno(r))

    let baselineRevision = 0
    try {
      const version = await getParquetVersion(dbno)
      baselineRevision = Number(version.revision || 0)
    } catch {
      baselineRevision = 0
    }

    statusMessage.value = `检测到 parquet 缺失，正在自动导出（${backendRefnos.length} 个 refno）...`
    progress.value = Math.max(progress.value, 20)
    consoleStore.addLog('info', `[model-load] parquet 缺失，触发自动导出 dbno=${dbno} refno_count=${backendRefnos.length}`)

    const exportResp = await modelShowByRefno({
      db_num: dbno,
      refnos: backendRefnos,
      gen_model: true,
      gen_mesh: true,
      regen_model: false,
      gen_parquet: true,
    })

    if (!exportResp?.success) {
      consoleStore.addLog(
        'error',
        `[model-load] 自动导出 parquet 失败 dbno=${dbno} message=${exportResp?.message ?? 'unknown'}`
      )
      return false
    }

    const timeoutMs = 10 * 60 * 1000
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (await parquetLoader.isParquetAvailable(dbno)) {
        consoleStore.addLog('info', `[model-load] parquet 已可用 dbno=${dbno}`)
        return true
      }
      await sleep(2000)
    }

    const poll = await pollParquetVersionAfterEnqueue(dbno, baselineRevision, 2 * 60 * 1000)
    if (poll.updated && (await parquetLoader.isParquetAvailable(dbno))) {
      consoleStore.addLog('info', `[model-load] parquet 版本更新后可用 dbno=${dbno} revision=${poll.revision}`)
      return true
    }
    if (poll.error) {
      consoleStore.addLog('error', `[model-load] 自动导出后 parquet 仍不可用 dbno=${dbno} err=${poll.error}`)
    }

    return await parquetLoader.isParquetAvailable(dbno)
  }

  async function handleMissingRefnos(
    dtxLayer: any,
    dbno: number,
    missingRefnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void }
  ): Promise<{ loadedObjects: number; failedRefnos: string[] }> {
    const normalizedMissing = uniqStrings(missingRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean)
    if (normalizedMissing.length === 0) {
      return { loadedObjects: 0, failedRefnos: [] }
    }

    if (SKIP_AUTO_GENERATION) {
      console.warn(`[model-generation] 发现 ${normalizedMissing.length} 个缺失模型，已跳过自动生成`)
      return { loadedObjects: 0, failedRefnos: normalizedMissing }
    }

    showProgressModal.value = true
    statusMessage.value = `发现 ${normalizedMissing.length} 个缺失模型，正在实时生成...`
    totalCount.value = normalizedMissing.length
    currentIndex.value = 0
    currentRefno.value = ''

    let loadedObjects = 0
    let failedRefnos: string[] = []
    const backendMissing = new Set<string>()
    let baselineRevision = 0
    let enqueuedAny = false

    try {
      try {
        const version = await getParquetVersion(dbno)
        baselineRevision = Number(version.revision || 0)
      } catch (e) {
        console.warn('[model-generation] 读取 parquet 版本失败，继续执行实时加载', e)
      }

      const result = await triggerBatchGenerateSse(normalizedMissing, {
        onUpdate: (u) => {
          statusMessage.value = u.message || ''
          if (u.currentRefno) {
            currentRefno.value = normalizeRefnoString(u.currentRefno)
          }
          currentIndex.value = Math.max(0, Math.min(u.totalCount || normalizedMissing.length, u.completedCount || 0))
          if (u.stage === 'exportInstances') {
            progress.value = Math.max(95, Math.min(99, 95 + u.percent * 0.04))
          } else {
            progress.value = Math.max(60, Math.min(95, 60 + u.percent * 0.35))
          }
        },
        onBatchDone: async (u) => {
          const readyRefnos = uniqStrings(u.readyRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean)
          if (readyRefnos.length === 0) return

          const loadResult = await loadGeneratedRefnos(dtxLayer, dbno, readyRefnos, anyViewer)
          loadedObjects += loadResult.loadedObjects
          for (const missingRefno of loadResult.missingRefnos) {
            backendMissing.add(normalizeRefnoString(missingRefno))
          }

          try {
            await enqueueParquetIncremental(dbno, readyRefnos)
            enqueuedAny = true
          } catch (e) {
            console.warn('[model-generation] parquet 增量入队失败', e)
          }
        },
        skipOnError: true,
        exportInstances: false,
        mergeInstances: false,
      })

      failedRefnos = uniqStrings(result.failedRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean)
      if (failedRefnos.length > 0) {
        console.warn(`[model-generation] ${failedRefnos.length} refnos failed to generate:`, failedRefnos)
      }

      if (enqueuedAny) {
        statusMessage.value = '正在轮询 parquet 版本，等待离线缓存更新...'
        const poll = await pollParquetVersionAfterEnqueue(dbno, baselineRevision)
        if (poll.updated) {
          consoleStore.addLog('info', `[model-load] parquet 版本已更新 dbno=${dbno} revision=${poll.revision}`)
        } else if (poll.error) {
          consoleStore.addLog('error', `[model-load] parquet 版本轮询未更新 dbno=${dbno} err=${poll.error}`)
        }
      }
    } catch (e) {
      console.error('[model-generation] Batch generate failed:', e)
      const msg = e instanceof Error ? e.message : String(e)
      consoleStore.addLog('error', `[model-load] 实时生成失败 dbno=${dbno} err=${msg}`)
      failedRefnos = normalizedMissing
    } finally {
      showProgressModal.value = false
      totalCount.value = 0
      currentIndex.value = 0
      currentRefno.value = ''
    }

    const mergedFailed = uniqStrings([...failedRefnos, ...Array.from(backendMissing)])
    return { loadedObjects, failedRefnos: mergedFailed }
  }

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

      // ========== Parquet 优先路径（不可用时自动导出） ==========
      const parquetLoader = useDbnoInstancesParquetLoader()
      let parquetAvailable = await parquetLoader.isParquetAvailable(dbno)

      if (!parquetAvailable) {
        const exportTargets = visibleRefnos.length > 0 ? visibleRefnos : [normalizedRoot]
        parquetAvailable = await ensureParquetAvailableByAutoExport(dbno, exportTargets)
      }

      if (parquetAvailable) {
        consoleStore.addLog('info', `[model-load] 使用 Parquet 数据源 dbno=${dbno}`)
        statusMessage.value = `从 Parquet 加载 dbno=${dbno}...`
        progress.value = 20

        const anyViewer = viewer as unknown as {
          __dtxLayer?: unknown
          __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
        }
        const dtxLayer = anyViewer.__dtxLayer as any
        if (!dtxLayer) throw new Error('DTXLayer 未初始化，无法加载模型')

        // 可见 refnos 优先；若为空则从 Parquet 查询全量
        const loadRefnos = visibleRefnos.length > 0
          ? visibleRefnos
          : await parquetLoader.queryAllRefnoKeys(dbno, { debug: false })

        if (loadRefnos.length === 0) {
          statusMessage.value = `dbnum=${dbno} 无可加载 refno`
          progress.value = 100
          return false
        }

        statusMessage.value = `加载 ${loadRefnos.length} 个 refno (Parquet)...`
        progress.value = 60

        const LOAD_BATCH_SIZE = VISIBLE_REFNOS_PAGE_SIZE
        const total = loadRefnos.length
        const batchTotal = Math.ceil(total / LOAD_BATCH_SIZE)
        let totalLoaded = 0
        let totalSkipped = 0
        let totalObjects = 0
        const missingAll: string[] = []

        for (let start = 0; start < total; start += LOAD_BATCH_SIZE) {
          const end = Math.min(total, start + LOAD_BATCH_SIZE)
          const batch = loadRefnos.slice(start, end)
          const batchIndex = Math.floor(start / LOAD_BATCH_SIZE) + 1
          statusMessage.value = `加载批次 ${batchIndex}/${batchTotal} (${end}/${total}) [Parquet]`
          progress.value = Math.max(60, Math.min(95, 60 + Math.floor((end / total) * 35)))

          const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, batch, {
            lodAssetKey: 'L1',
            debug: false,
            dataSource: 'parquet',
          })
          anyViewer.__dtxAfterInstancesLoaded?.(dbno, batch)
          totalLoaded += result.loadedRefnos
          totalSkipped += result.skippedRefnos
          totalObjects += result.loadedObjects
          if (result.missingRefnos.length > 0) missingAll.push(...result.missingRefnos)
        }

        if (missingAll.length > 0) {
          const realtimeResult = await handleMissingRefnos(dtxLayer, dbno, uniqStrings(missingAll), anyViewer)
          totalObjects += realtimeResult.loadedObjects
        }

        if (loadOptions?.flyTo) {
          try {
            const av = viewer as any
            const max = 5000
            const flyRefnos = loadRefnos.length > max ? loadRefnos.slice(0, max) : loadRefnos
            const aabb = av?.scene?.getAABB?.(flyRefnos) ?? null
            if (aabb) {
              av?.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true })
            }
          } catch { /* ignore flyTo errors */ }
        }

        lastLoadDebug.value = {
          refno: normalizedRoot,
          dbno,
          visibleInsts: { ok: visibleOk, count: visibleRefnos.length, error: visibleErr },
          loadRefnos: { count: loadRefnos.length, sample: loadRefnos.slice(0, 10) },
          result: { loadedRefnos: totalLoaded, skippedRefnos: totalSkipped, loadedObjects: totalObjects },
          ms: Date.now() - startedAt,
        }
        if (totalObjects > 0) {
          loadedRoots.add(normalizedRoot)
        }
        statusMessage.value = totalObjects > 0 ? '加载完成 (Parquet)' : '无可见几何实例'
        progress.value = 100
        return true
      }

      throw new Error(`Parquet 不可用且自动导出失败 (dbno=${dbno})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      statusMessage.value = '加载失败'
      return false
    } finally {
      isGenerating.value = false
      showProgressModal.value = false
    }
  }

  async function generateAndLoadModel(refno: string): Promise<boolean> {
    // 统一入口：当前策略下“显示”即按需触发生成 instances 并加载
    return await showModelByRefno(refno)
  }

  return {
    isGenerating,
    showProgressModal,
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
