import { ref } from 'vue'
import type { Ref } from 'vue'

import { e3dGetSubtreeRefnos } from '@/api/genModelE3dApi'
import { enqueueParquetIncremental, getParquetVersion } from '@/api/genModelRealtimeApi'
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore'
import {
  InstancesJsonNotFoundError,
  ensureDbnoInstancesAvailable,
  getDbnoInstancesManifest,
  triggerBatchGenerateSse,
  triggerSubtreeGenerateSse,
  waitForDbnoInstancesFile,
} from '@/composables/useDbnoInstancesJsonLoader'
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader'
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader'
import { useConsoleStore } from '@/composables/useConsoleStore'
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo'

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

      // ========== Parquet 优先路径 ==========
      const parquetLoader = useDbnoInstancesParquetLoader()
      const parquetAvailable = await parquetLoader.isParquetAvailable(dbno)

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

      // ========== JSON 回退路径 ==========
      statusMessage.value = `加载 instances_${dbno}.json...`
      progress.value = 20

      try {
        await ensureDbnoInstancesAvailable(dbno)
      } catch (e) {
        if (e instanceof InstancesJsonNotFoundError) {
          // 开关打开时，跳过弹窗和自动生成，直接返回失败
          if (SKIP_AUTO_GENERATION) {
            console.warn(`[model-generation] instances_${dbno}.json 不存在，已跳过自动生成`)
            statusMessage.value = `instances_${dbno}.json 不存在`
            return false
          }
          if (isAutomationMode()) {
            throw new Error(`缺少 instances 数据: /files/output/instances/instances_${dbno}.json`)
          }
          const choice = await dialog.openChoice({
            title: '缺少 instances 数据',
            message:
              `后台未找到 /files/output/instances/instances_${dbno}.json。\n` +
              `请选择生成方式：\n` +
              `1) 全量生成该 dbno（覆盖完整，但耗时更长）\n` +
              `2) 仅生成当前节点子孙（SSE 流式，生成完会合并追加 instances_${dbno}.json）`,
            choices: [
              { id: 'full', text: '全量生成', color: 'primary', variant: 'flat' },
              { id: 'subtree', text: '仅生成子孙（SSE）', color: 'secondary', variant: 'flat' },
            ],
            cancelText: '取消',
          })
          if (!choice) return false

          if (choice === 'full') {
            statusMessage.value = '已提交全量生成任务，等待产出 instances 文件...'
            progress.value = 30
            await ensureDbnoInstancesAvailable(dbno, { autoGenerate: true, timeoutMs: 30 * 60 * 1000 })
          } else if (choice === 'subtree') {
            statusMessage.value = '通过 SSE 流式生成当前节点子孙...'
            progress.value = 25
            totalCount.value = 0
            currentIndex.value = 0
            currentRefno.value = normalizedRoot

            await triggerSubtreeGenerateSse(normalizedRoot, {
              timeoutMs: 30 * 60 * 1000,
              onUpdate: (u) => {
                if (u.message) statusMessage.value = u.message
                if (u.currentRefno) currentRefno.value = u.currentRefno
                if (typeof u.total === 'number' && u.total > 0) totalCount.value = u.total
                if (typeof u.completed === 'number') currentIndex.value = u.completed
                if (typeof u.percent === 'number') progress.value = Math.max(10, Math.min(90, u.percent))
              },
            })

            statusMessage.value = '等待 instances 文件写入...'
            progress.value = 92
            await waitForDbnoInstancesFile(dbno, 10 * 60 * 1000)
            await ensureDbnoInstancesAvailable(dbno)
          } else {
            return false
          }
        } else {
          throw e
        }
      }

      // 当可见 refnos 返回空/失败时，尝试从 instances manifest 推导加载目标：
      // - root 自身可能就是可渲染元件（叶子节点）
      // - V2 bran/equi group 需要加载 children（并包含 group 自身以承接 tubing fallbackRefno）
      const manifest = await getDbnoInstancesManifest(dbno)

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
            dataSource: 'json',
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

      // gen-model-fork V0：manifest.instances（通常是“离线子集导出”），需要优先与 visibleRefnos 做交集，避免把整棵可见子孙（可能数万）都跑一遍但最终几乎全缺失。
      // 注意：export_dbnum_instances_json 可能同时包含 groups + instances（instances 只是非聚合 refno 的补集），此时不能按“子集导出”处理，否则会误丢 groups。
      const flatV0 = (manifest as any)?.instances
      const hasNewGroups = Array.isArray((manifest as any)?.groups) && (manifest as any).groups.length > 0
      if (!hasNewGroups && Array.isArray(flatV0) && flatV0.length > 0 && Array.isArray(flatV0[0]?.geo_instances)) {
        const available = new Set<string>(
          flatV0
            .map((x: any) => normalizeRefnoString(String(x?.refno ?? '')))
            .filter(Boolean)
        )
        const intersected = visibleRefnos.length > 0 ? visibleRefnos.filter((r) => available.has(r)) : []
        const missingByManifest = visibleRefnos.length > 0 ? visibleRefnos.filter((r) => !available.has(r)) : []
        if (visibleRefnos.length > 0) {
          const sample = missingByManifest.slice(0, 50)
          consoleStore.addLog(
            missingByManifest.length > 0 ? 'error' : 'info',
            `[model-load] instances_${dbno}.json 匹配: candidates=${visibleRefnos.length} matched=${intersected.length} missing=${missingByManifest.length}` +
              (missingByManifest.length > 0 ? ` sample=${sample.join(',')}${missingByManifest.length > sample.length ? ' ...' : ''}` : '')
          )
        }

        const loadRefnos = (visibleRefnos.length > 0 ? intersected : deriveLoadRefnosFromInstancesManifest(manifest, normalizedRoot)).filter(Boolean)
        const loadRefnoSample = loadRefnos.slice(0, 10)

        if (visibleRefnos.length > 0 && loadRefnos.length === 0) {
          statusMessage.value = '无可加载模型（instances 未命中）'
          progress.value = 100
          lastLoadDebug.value = {
            refno: normalizedRoot,
            dbno,
            visibleInsts: {
              ok: visibleOk,
              count: visibleRefnos.length,
              error: visibleErr,
            },
            manifestMatch: {
              candidates: visibleRefnos.length,
              matched: intersected.length,
              missing: missingByManifest.length,
              missingSample: missingByManifest.slice(0, 10),
            },
            loadRefnos: { count: 0, sample: [] },
            result: { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0 },
            ms: Date.now() - startedAt,
          }
          return false
        }

        statusMessage.value = `加载 ${loadRefnos.length} 个 refno 的实例...`
        progress.value = 60
        consoleStore.addLog('info', `[model-load] 开始加载 dbno=${dbno} refno_count=${loadRefnos.length}`)

        const result = await loadRefnosInChunks(loadRefnos, dbno)
        let realtimeLoadedObjects = 0

        // 处理缺失的 refno：批量实时生成并边生成边加载
        if (result.missingRefnos.length > 0) {
          const realtimeResult = await handleMissingRefnos(dtxLayer, dbno, result.missingRefnos, anyViewer)
          realtimeLoadedObjects += realtimeResult.loadedObjects
        }
        if (result.missingRefnos.length > 0) {
          const sample = result.missingRefnos.slice(0, 50)
          consoleStore.addLog(
            'error',
            `[model-load] 缺失模型（loader missing） dbno=${dbno} missing=${result.missingRefnos.length} sample=${sample.join(',')}${result.missingRefnos.length > sample.length ? ' ...' : ''}`
          )
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
          manifestMatch: visibleRefnos.length > 0
            ? {
                candidates: visibleRefnos.length,
                matched: intersected.length,
                missing: missingByManifest.length,
                missingSample: missingByManifest.slice(0, 10),
              }
            : undefined,
          loadRefnos: { count: loadRefnos.length, sample: loadRefnoSample },
          result: result ? { loadedRefnos: result.loadedRefnos, skippedRefnos: result.skippedRefnos, loadedObjects: result.loadedObjects + realtimeLoadedObjects } : null,
          ms: Date.now() - startedAt,
        }

        const totalLoadedObjects = result.loadedObjects + realtimeLoadedObjects
        if (totalLoadedObjects > 0) {
          loadedRoots.add(normalizedRoot)
        }
        statusMessage.value = totalLoadedObjects > 0 ? '加载完成' : '无可见几何实例'
        progress.value = 100
        return true
      }

      statusMessage.value = `加载 ${loadRefnos.length} 个 refno 的 Parquet 实例...`
      progress.value = 60
      consoleStore.addLog('info', `[model-load] 开始 parquet 加载 dbno=${dbno} refno_count=${loadRefnos.length}`)

      const result = await loadRefnosInChunks(loadRefnos, dbno)
      let realtimeLoadedObjects = 0

      // 处理缺失的 refno：批量实时生成并边生成边加载
      if (result.missingRefnos.length > 0) {
        const realtimeResult = await handleMissingRefnos(dtxLayer, dbno, result.missingRefnos, anyViewer)
        realtimeLoadedObjects += realtimeResult.loadedObjects
      }
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
        result: result ? { loadedRefnos: result.loadedRefnos, skippedRefnos: result.skippedRefnos, loadedObjects: result.loadedObjects + realtimeLoadedObjects } : null,
        ms: Date.now() - startedAt,
      }

      const totalLoadedObjects = result.loadedObjects + realtimeLoadedObjects
      if (totalLoadedObjects > 0) {
        loadedRoots.add(normalizedRoot)
      }
      statusMessage.value = totalLoadedObjects > 0 ? '加载完成' : '无可见几何实例'
      progress.value = 100
      return true
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
