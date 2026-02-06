import { ref } from 'vue'
import type { Ref } from 'vue'

import { e3dGetSubtreeRefnos } from '@/api/genModelE3dApi'
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore'
import {
  InstancesJsonNotFoundError,
  ensureDbnoInstancesAvailable,
  getDbnoInstancesManifest,
  invalidateDbnoInstancesManifestCache,
  triggerBatchGenerateSse,
  triggerSubtreeGenerateSse,
  waitForDbnoInstancesFile,
} from '@/composables/useDbnoInstancesJsonLoader'
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader'
import { useConsoleStore } from '@/composables/useConsoleStore'
import { getDefaultSurrealConfig, useSurrealDB } from '@/composables/useSurrealDB'
import { useSurrealModelQuery } from '@/composables/useSurrealModelQuery'
import { pdmsGetOwnsChildren, pdmsGetTypeInfo } from '@/api/genModelPdmsAttrApi'
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo'
import { buildInstanceIndexByRefno, type InstanceManifest } from '@/utils/instances/instanceManifest'

/**
 * 全局开关：是否跳过自动生成（SSE 流式生成、弹窗选择等）
 * 设为 true 时，只加载已有的 instances 文件，不触发任何生成流程
 */
export const SKIP_AUTO_GENERATION = true
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
  const surreal = useSurrealDB()
  const surrealQuery = useSurrealModelQuery(surreal.db)

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
  const BATCH_LOAD_THRESHOLD = 20

  async function ensureSurrealConnected(): Promise<boolean> {
    if (surreal.isConnected.value) return true
    try {
      await surreal.connect(getDefaultSurrealConfig())
      return true
    } catch (e) {
      console.warn('[model-generation] SurrealDB connect failed:', e)
      return false
    }
  }

  async function loadGeneratedRefnos(
    dtxLayer: any,
    dbno: number,
    refnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void }
  ): Promise<void> {
    if (refnos.length === 0) return
    invalidateDbnoInstancesManifestCache(dbno)
    statusMessage.value = '正在加载新生成的模型...'
    progress.value = 96
    await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, refnos, {
      lodAssetKey: 'L1',
      debug: false,
      forceReloadRefnos: refnos,
    })
    anyViewer.__dtxAfterInstancesLoaded?.(dbno, refnos)
  }

  async function handleMissingRefnos(
    dtxLayer: any,
    dbno: number,
    missingRefnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void }
  ): Promise<void> {
    if (missingRefnos.length === 0) return

    // 开关打开时，跳过 SSE 批量生成
    if (SKIP_AUTO_GENERATION) {
      console.warn(`[model-generation] 发现 ${missingRefnos.length} 个缺失模型，已跳过自动生成`)
      return
    }

    statusMessage.value = `发现 ${missingRefnos.length} 个缺失模型，正在生成...`
    totalCount.value = missingRefnos.length
    currentIndex.value = 0

    const pending: string[] = []

    try {
      const { failedRefnos } = await triggerBatchGenerateSse(
        missingRefnos,
        {
          onUpdate: (u) => {
            statusMessage.value = u.message || ''
            currentRefno.value = u.currentRefno || ''
            currentIndex.value = u.completedCount
            progress.value = Math.max(60, Math.min(95, 60 + u.percent * 0.35))
          },
          onItemDone: async (u) => {
            if (!u.ok) return
            pending.push(u.refno)
            if (pending.length >= BATCH_LOAD_THRESHOLD) {
              const batch = pending.splice(0, pending.length)
              await loadGeneratedRefnos(dtxLayer, dbno, batch, anyViewer)
            }
          },
          skipOnError: true,
        }
      )

      if (pending.length > 0) {
        const batch = pending.splice(0, pending.length)
        await loadGeneratedRefnos(dtxLayer, dbno, batch, anyViewer)
      }

      if (failedRefnos.length > 0) {
        console.warn(`[model-generation] ${failedRefnos.length} refnos failed to generate:`, failedRefnos)
      }
    } catch (e) {
      console.error('[model-generation] Batch generate failed:', e)
    }
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
        const canUseSurreal = await ensureSurrealConnected()
        let appliedRule = false

        if (canUseSurreal) {
          const typeInfo = await surrealQuery.queryPeTypeInfo(normalizedRoot)
          const noun = (typeInfo?.noun || '').toUpperCase()
          const ownerNoun = (typeInfo?.ownerNoun || '').toUpperCase()

          if (ownerNoun === 'BRAN' || ownerNoun === 'HANG') {
            visibleRefnos = [normalizedRoot]
            appliedRule = true
          } else if (noun === 'BRAN' || noun === 'HANG') {
            visibleRefnos = await surrealQuery.queryChildren(normalizedRoot)
            appliedRule = true
          }
        } else {
          // WS 直连失败时，改走后端 HTTP（后端再查 SurrealDB），避免 BRAN/HANG 场景“只见面板不见模型”
          try {
            const resp = await pdmsGetTypeInfo(normalizedRoot)
            if (resp.success) {
              const noun = String(resp.noun || '').toUpperCase()
              const ownerNoun = String(resp.owner_noun || '').toUpperCase()
              if (ownerNoun === 'BRAN' || ownerNoun === 'HANG') {
                visibleRefnos = [normalizedRoot]
                appliedRule = true
              } else if (noun === 'BRAN' || noun === 'HANG') {
                const childrenResp = await pdmsGetOwnsChildren(normalizedRoot)
                if (childrenResp.success) {
                  visibleRefnos = childrenResp.children || []
                  appliedRule = true
                }
              }
            }
          } catch (e) {
            console.warn('[model-generation] SurrealDB 未连接，且后端 BRAN/HANG 查询失败，将回退 e3d subtree-refnos', e)
          }
        }

        if (!appliedRule) {
          const { refnos, truncated } = await querySubtreeRefnos(normalizedRoot)
          visibleRefnos = refnos
          if (truncated) {
            consoleStore.addLog('error', `[model-load] subtree-refnos 返回被截断 refno=${normalizedRoot}（limit=200000）`)
          }
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

      const LOAD_BATCH_SIZE = VISIBLE_REFNOS_PAGE_SIZE

      async function loadRefnosInChunks(refnos: string[], dbnoValue: number): Promise<{
        loadedRefnos: number
        skippedRefnos: number
        loadedObjects: number
        missingRefnos: string[]
      }> {
        if (refnos.length === 0) {
          return { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, missingRefnos: [] }
        }

        const total = refnos.length
        const batchTotal = Math.ceil(total / LOAD_BATCH_SIZE)
        let loadedRefnos = 0
        let skippedRefnos = 0
        let loadedObjects = 0
        const missingAll: string[] = []

        for (let start = 0; start < total; start += LOAD_BATCH_SIZE) {
          const end = Math.min(total, start + LOAD_BATCH_SIZE)
          const batch = refnos.slice(start, end)
          const batchIndex = Math.floor(start / LOAD_BATCH_SIZE) + 1

          statusMessage.value = `加载 refno 批次 ${batchIndex}/${batchTotal} (${end}/${total})...`
          progress.value = Math.max(60, Math.min(95, 60 + Math.floor((end / total) * 35)))

          const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbnoValue, batch, {
            lodAssetKey: 'L1',
            debug: false,
          })
          anyViewer.__dtxAfterInstancesLoaded?.(dbnoValue, batch)

          loadedRefnos += result.loadedRefnos
          skippedRefnos += result.skippedRefnos
          loadedObjects += result.loadedObjects

          if (result.missingRefnos.length > 0) {
            missingAll.push(...result.missingRefnos)
          }
        }

        return {
          loadedRefnos,
          skippedRefnos,
          loadedObjects,
          missingRefnos: uniqStrings(missingAll),
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

        // 处理缺失的 refno：达到阈值或全部完成后再分批加载
        if (result.missingRefnos.length > 0) {
          await handleMissingRefnos(dtxLayer, dbno, result.missingRefnos, anyViewer)
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
          result: result ? { loadedRefnos: result.loadedRefnos, skippedRefnos: result.skippedRefnos, loadedObjects: result.loadedObjects } : null,
          ms: Date.now() - startedAt,
        }

        loadedRoots.add(normalizedRoot)
        statusMessage.value = result.loadedObjects > 0 ? '加载完成' : '无可见几何实例'
        progress.value = 100
        return true
      }

      let loadRefnos: string[] = []
      let missingByManifest: string[] = []
      if (visibleRefnos.length > 0) {
        const candidate = uniqStrings(visibleRefnos)
        const index = buildInstanceIndexByRefno(manifest, new Set(candidate))
        loadRefnos = candidate.filter((r) => index.has(r))
        missingByManifest = candidate.filter((r) => !index.has(r))

        const sample = missingByManifest.slice(0, 50)
        consoleStore.addLog(
          missingByManifest.length > 0 ? 'error' : 'info',
          `[model-load] instances_${dbno}.json 匹配: candidates=${candidate.length} matched=${loadRefnos.length} missing=${missingByManifest.length}` +
            (missingByManifest.length > 0 ? ` sample=${sample.join(',')}${missingByManifest.length > sample.length ? ' ...' : ''}` : '')
        )

        if (loadRefnos.length === 0) {
          statusMessage.value = '无可加载模型（instances 未命中）'
          progress.value = 100
          lastLoadDebug.value = {
            refno: normalizedRoot,
            dbno,
            visibleInsts: { ok: visibleOk, count: visibleRefnos.length, error: visibleErr },
            manifestMatch: {
              candidates: candidate.length,
              matched: 0,
              missing: missingByManifest.length,
              missingSample: missingByManifest.slice(0, 10),
            },
            loadRefnos: { count: 0, sample: [] },
            result: { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0 },
            ms: Date.now() - startedAt,
          }
          return false
        }
      } else {
        loadRefnos = deriveLoadRefnosFromInstancesManifest(manifest, normalizedRoot)
      }
      const loadRefnoSample = loadRefnos.slice(0, 10)

      statusMessage.value = `加载 ${loadRefnos.length} 个 refno 的实例...`
      progress.value = 60
      consoleStore.addLog('info', `[model-load] 开始加载 dbno=${dbno} refno_count=${loadRefnos.length}`)

      const result = await loadRefnosInChunks(loadRefnos, dbno)

      // 处理缺失的 refno：达到阈值或全部完成后再分批加载
      if (result.missingRefnos.length > 0) {
        await handleMissingRefnos(dtxLayer, dbno, result.missingRefnos, anyViewer)
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
              matched: loadRefnos.length,
              missing: missingByManifest.length,
              missingSample: missingByManifest.slice(0, 10),
            }
          : undefined,
        loadRefnos: { count: loadRefnos.length, sample: loadRefnoSample },
        result: result ? { loadedRefnos: result.loadedRefnos, skippedRefnos: result.skippedRefnos, loadedObjects: result.loadedObjects } : null,
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
