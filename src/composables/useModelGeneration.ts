import { ref } from 'vue'
import type { Ref } from 'vue'

import { e3dGetVisibleInsts } from '@/api/genModelE3dApi'
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore'
import {
  InstancesJsonNotFoundError,
  ensureDbnoInstancesAvailable,
  getDbnoInstancesManifest,
  triggerSubtreeGenerateSse,
  waitForDbnoInstancesFile,
} from '@/composables/useDbnoInstancesJsonLoader'
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader'
import type { InstanceManifest } from '@/utils/instances/instanceManifest'

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
  loadRefnos: { count: number; sample: string[] }
  result: { loadedRefnos: number; skippedRefnos: number; loadedObjects: number } | null
  ms: number
}

function extractDbNumFromRefno(refno: string): number | null {
  const normalized = refno.trim().replace('/', '_')
  const head = normalized.split('_')[0]
  const n = Number(head)
  return Number.isFinite(n) ? n : null
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
  showModelByRefno: (refno: string) => Promise<boolean>
  checkRefnoExists: (refno: string) => boolean
} {
  const { viewer } = options
  const dialog = useConfirmDialogStore()

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

  async function showModelByRefno(refno: string): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno)
    if (!normalizedRoot) return false
    if (checkRefnoExists(normalizedRoot)) return true

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
      const dbno = options.db_num ?? extractDbNumFromRefno(normalizedRoot)
      if (!dbno) throw new Error('无法确定 dbno')

      statusMessage.value = '查询可见几何子孙...'
      progress.value = 10
      let visibleOk = false
      let visibleErr: string | null = null
      let visibleRefnos: string[] = []
      try {
        const visible = await e3dGetVisibleInsts(normalizedRoot)
        if (!visible.success) {
          throw new Error(visible.error_message || 'visible-insts 查询失败')
        }
        visibleOk = true
        visibleRefnos = uniqStrings((visible.refnos || []).map((r) => normalizeRefnoString(r))).filter(Boolean)
      } catch (e) {
        visibleOk = false
        visibleErr = e instanceof Error ? e.message : String(e)
        visibleRefnos = []
      }

      statusMessage.value = `加载 instances_${dbno}.json...`
      progress.value = 20

      try {
        await ensureDbnoInstancesAvailable(dbno)
      } catch (e) {
        if (e instanceof InstancesJsonNotFoundError) {
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

      // 当 visible-insts 返回空/失败时，尝试从 instances manifest 推导加载目标：
      // - root 自身可能就是可渲染元件（叶子节点）
      // - V2 bran/equi group 需要加载 children（并包含 group 自身以承接 tubing fallbackRefno）
      const manifest = await getDbnoInstancesManifest(dbno)

      // gen-model-fork V0：manifest.instances（通常是“离线子集导出”），需要优先与 visibleRefnos 做交集，避免把整棵可见子孙（可能数万）都跑一遍但最终几乎全缺失。
      const flatV0 = (manifest as any)?.instances
      if (Array.isArray(flatV0) && flatV0.length > 0 && Array.isArray(flatV0[0]?.geo_instances)) {
        const available = new Set<string>(
          flatV0
            .map((x: any) => normalizeRefnoString(String(x?.refno ?? '')))
            .filter(Boolean)
        )
        const intersected = visibleRefnos.length > 0 ? visibleRefnos.filter((r) => available.has(r)) : []
        const loadRefnos = (intersected.length > 0 ? intersected : deriveLoadRefnosFromInstancesManifest(manifest, normalizedRoot)).filter(Boolean)
        const loadRefnoSample = loadRefnos.slice(0, 10)

        statusMessage.value = `加载 ${loadRefnos.length} 个 refno 的实例...`
        progress.value = 60

        const anyViewer = viewer as unknown as {
          __dtxLayer?: unknown
          __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
        }
        const dtxLayer = anyViewer.__dtxLayer as any
        if (!dtxLayer) throw new Error('DTXLayer 未初始化，无法加载模型')

        const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, loadRefnos, {
          lodAssetKey: 'L1',
          debug: false,
        })
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, loadRefnos)

        lastLoadDebug.value = {
          refno: normalizedRoot,
          dbno,
          visibleInsts: {
            ok: visibleOk,
            count: visibleRefnos.length,
            error: visibleErr,
          },
          loadRefnos: { count: loadRefnos.length, sample: loadRefnoSample },
          result: result ? { loadedRefnos: result.loadedRefnos, skippedRefnos: result.skippedRefnos, loadedObjects: result.loadedObjects } : null,
          ms: Date.now() - startedAt,
        }

        loadedRoots.add(normalizedRoot)
        statusMessage.value = result.loadedObjects > 0 ? '加载完成' : '无可见几何实例'
        progress.value = 100
        return true
      }

      const loadRefnos = visibleRefnos.length > 0 ? visibleRefnos : deriveLoadRefnosFromInstancesManifest(manifest, normalizedRoot)
      const loadRefnoSample = loadRefnos.slice(0, 10)

      statusMessage.value = `加载 ${loadRefnos.length} 个 refno 的实例...`
      progress.value = 60

      const anyViewer = viewer as unknown as {
        __dtxLayer?: unknown
        __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
      }
      const dtxLayer = anyViewer.__dtxLayer as any
      if (!dtxLayer) throw new Error('DTXLayer 未初始化，无法加载模型')

      const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, loadRefnos, {
        lodAssetKey: 'L1',
        debug: false,
      })
      anyViewer.__dtxAfterInstancesLoaded?.(dbno, loadRefnos)

      lastLoadDebug.value = {
        refno: normalizedRoot,
        dbno,
        visibleInsts: {
          ok: visibleOk,
          count: visibleRefnos.length,
          error: visibleErr,
        },
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
