import { ref } from 'vue'
import type { Ref } from 'vue'
import type { Viewer } from '@xeokit/xeokit-sdk'

import { e3dGetVisibleInsts } from '@/api/genModelE3dApi'
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore'
import {
  InstancesJsonNotFoundError,
  ensureDbnoInstancesAvailable,
  triggerSubtreeGenerateSse,
  waitForDbnoInstancesFile,
} from '@/composables/useDbnoInstancesJsonLoader'
import { loadDbnoInstancesForVisibleRefnos as loadDbnoInstancesForVisibleRefnosXeokit } from '@/composables/useDbnoInstancesJsonLoader'
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader'

export interface ModelGenerationOptions {
  db_num?: number
  viewer: Viewer
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
}

function extractDbNumFromRefno(refno: string): number | null {
  const normalized = refno.trim().replace('/', '_')
  const head = normalized.split('_')[0]
  const n = Number(head)
  return Number.isFinite(n) ? n : null
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

  const loadedRoots = new Set<string>()

  function checkRefnoExists(refno: string): boolean {
    if (loadedRoots.has(refno)) return true
    return !!viewer.scene.objects[refno]
  }

  async function showModelByRefno(refno: string): Promise<boolean> {
    if (!refno) return false
    if (checkRefnoExists(refno)) return true

    isGenerating.value = true
    error.value = null
    progress.value = 0
    statusMessage.value = '准备加载模型...'
    currentRefno.value = refno
    totalCount.value = 1
    currentIndex.value = 1

    try {
      const dbno = options.db_num ?? extractDbNumFromRefno(refno)
      if (!dbno) throw new Error('无法确定 dbno')

      statusMessage.value = '查询可见几何子孙...'
      progress.value = 10
      const visible = await e3dGetVisibleInsts(refno)
      if (!visible.success) {
        throw new Error(visible.error_message || 'visible-insts 查询失败')
      }

      const visibleRefnos = visible.refnos || []
      if (visibleRefnos.length === 0) {
        loadedRoots.add(refno)
        statusMessage.value = '无可见几何子孙'
        progress.value = 100
        return true
      }

      statusMessage.value = `加载 instances_${dbno}.json...`
      progress.value = 20

      try {
        await ensureDbnoInstancesAvailable(dbno)
      } catch (e) {
        if (e instanceof InstancesJsonNotFoundError) {
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
            currentRefno.value = refno

            await triggerSubtreeGenerateSse(refno, {
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

      statusMessage.value = `加载 ${visibleRefnos.length} 个 refno 的实例...`
      progress.value = 60

      const anyViewer = viewer as unknown as {
        __dtxLayer?: unknown
        __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
      }
      const dtxLayer = anyViewer.__dtxLayer as any
      if (dtxLayer) {
        await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, visibleRefnos, {
          lodAssetKey: 'L1',
          debug: false,
        })
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, visibleRefnos)
      } else {
        await loadDbnoInstancesForVisibleRefnosXeokit(viewer, dbno, visibleRefnos, {
          modelId: `instances-${dbno}`,
          lodAssetKey: 'L1',
          debug: false,
        })
      }

      loadedRoots.add(refno)
      statusMessage.value = '加载完成'
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
    generateAndLoadModel,
    showModelByRefno,
    checkRefnoExists,
  }
}
