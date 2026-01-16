import type { InstanceManifest } from '@/utils/instances/instanceManifest'
import { getBaseUrl } from '@/api/genModelTaskApi'

export class InstancesJsonNotFoundError extends Error {
  readonly dbno: number
  constructor(dbno: number) {
    super(`instances_${dbno}.json not found`)
    this.name = 'InstancesJsonNotFoundError'
    this.dbno = dbno
  }
}

export type StreamGenerateSseUpdate = {
  stage: 'expand' | 'generate' | 'exportInstances' | 'finished'
  message?: string
  currentRefno?: string
  completed?: number
  total?: number
  percent?: number
}

const manifestCache = new Map<number, InstanceManifest>()

async function fetchInstancesManifest(dbno: number): Promise<InstanceManifest> {
  const cached = manifestCache.get(dbno)
  if (cached) return cached

  const url = `/files/output/instances/instances_${dbno}.json`
  const resp = await fetch(url)
  if (resp.status === 404) {
    throw new InstancesJsonNotFoundError(dbno)
  }
  if (!resp.ok) {
    throw new Error(`加载 instances 失败: HTTP ${resp.status} ${resp.statusText}`)
  }

  const json = (await resp.json()) as InstanceManifest
  manifestCache.set(dbno, json)
  return json
}

export async function getDbnoInstancesManifest(dbno: number): Promise<InstanceManifest> {
  return await fetchInstancesManifest(dbno)
}

/**
 * 手动注入 instances manifest（用于本地导入/调试）
 * - 仅影响前端内存缓存，不会写回后端
 * - 注入后，`getDbnoInstancesManifest(dbno)` 将直接命中该缓存
 */
export function setDbnoInstancesManifest(dbno: number, manifest: InstanceManifest): void {
  manifestCache.set(dbno, manifest)
}

export function invalidateDbnoInstancesManifestCache(dbno: number): void {
  manifestCache.delete(dbno)
}

async function triggerDbnoGenerate(dbno: number): Promise<void> {
  const apiBase = getBaseUrl().replace(/\/$/, '')
  const url = `${apiBase}/api/database/${dbno}/generate`
  const resp = await fetch(url, { method: 'POST' })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`触发生成任务失败: HTTP ${resp.status} ${resp.statusText}: ${text}`)
  }
}

export async function triggerSubtreeGenerateSse(
  rootRefno: string,
  options?: {
    batchSize?: number
    maxDepth?: number
    onUpdate?: (u: StreamGenerateSseUpdate) => void
    timeoutMs?: number
  }
): Promise<void> {
  const apiBase = getBaseUrl().replace(/\/$/, '')
  const batchSize = options?.batchSize ?? 50
  const maxDepth = options?.maxDepth ?? 0
  const timeoutMs = options?.timeoutMs ?? 30 * 60 * 1000

  const qs = new URLSearchParams()
  qs.set('expandChildren', 'true')
  qs.set('batchSize', String(batchSize))
  qs.set('maxDepth', String(maxDepth))
  qs.set('forceRegenerate', 'false')
  qs.set('applyBoolean', 'false')
  qs.set('exportInstances', 'true')
  qs.set('mergeInstances', 'true')

  const url = `${apiBase}/api/model/stream-generate-by-root/${encodeURIComponent(rootRefno)}?${qs.toString()}`

  await new Promise<void>((resolve, reject) => {
    const es = new EventSource(url)
    let done = false

    const timer = window.setTimeout(() => {
      if (done) return
      done = true
      es.close()
      reject(new Error(`SSE 超时: ${timeoutMs}ms`))
    }, timeoutMs)

    function finishOk() {
      if (done) return
      done = true
      window.clearTimeout(timer)
      es.close()
      resolve()
    }

    function finishErr(err: unknown) {
      if (done) return
      done = true
      window.clearTimeout(timer)
      es.close()
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    es.addEventListener('message', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data || '{}') as any
        const type = String(data?.type || '')

        if (type === 'started') {
          options?.onUpdate?.({ stage: 'generate', message: data?.message })
          return
        }
        if (type === 'expandComplete') {
          options?.onUpdate?.({
            stage: 'expand',
            message: `展开完成: ${data?.expandedCount ?? 0}`,
            completed: 0,
            total: Number(data?.expandedCount ?? 0),
            percent: 0,
          })
          return
        }
        if (type === 'batchComplete') {
          options?.onUpdate?.({
            stage: 'generate',
            currentRefno: data?.currentRefno ?? undefined,
            completed: Number(data?.completedCount ?? 0),
            total: Number(data?.totalCount ?? 0),
            percent: Number(data?.progress ?? 0),
            message: data?.warning ? String(data.warning) : undefined,
          })
          return
        }
        if (type === 'batchFailed') {
          finishErr(new Error(`SSE 批次失败: ${data?.error || 'unknown'}`))
          return
        }
        if (type === 'exportInstancesStarted') {
          options?.onUpdate?.({ stage: 'exportInstances', message: data?.message })
          return
        }
        if (type === 'exportInstancesFinished') {
          options?.onUpdate?.({ stage: 'finished', message: 'instances 导出完成' })
          finishOk()
          return
        }
        if (type === 'error') {
          finishErr(new Error(String(data?.message || 'SSE error')))
        }
      } catch (e) {
        finishErr(e)
      }
    })

    es.onerror = () => {
      finishErr(new Error('SSE 连接失败/中断'))
    }
  })
}

async function waitForInstancesFile(dbno: number, timeoutMs = 10 * 60 * 1000): Promise<void> {
  const url = `/files/output/instances/instances_${dbno}.json`
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(url, { method: 'GET' })
    if (resp.ok) return
    if (resp.status !== 404) {
      const text = await resp.text().catch(() => '')
      throw new Error(`等待 instances 文件失败: HTTP ${resp.status} ${resp.statusText}: ${text}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`等待 instances_${dbno}.json 超时`)
}

export async function waitForDbnoInstancesFile(dbno: number, timeoutMs?: number): Promise<void> {
  await waitForInstancesFile(dbno, timeoutMs)
  invalidateDbnoInstancesManifestCache(dbno)
}

export async function ensureDbnoInstancesAvailable(dbno: number, options?: { autoGenerate?: boolean; timeoutMs?: number }): Promise<void> {
  try {
    await fetchInstancesManifest(dbno)
    return
  } catch (e) {
    if (!(e instanceof InstancesJsonNotFoundError)) throw e
    if (!options?.autoGenerate) throw e
    await triggerDbnoGenerate(dbno)
    await waitForInstancesFile(dbno, options?.timeoutMs)
    invalidateDbnoInstancesManifestCache(dbno)
    await fetchInstancesManifest(dbno)
  }
}

export type BatchGenerateSseUpdate = {
  stage: 'generating' | 'finished'
  message?: string
  currentRefno?: string
  completedCount: number
  totalCount: number
  percent: number
  failedRefnos?: string[]
}

export type BatchGenerateItemDone = {
  refno: string
  ok: boolean
  completedCount: number
  totalCount: number
  percent: number
}

/**
 * 串行生成多个 refno 的模型（逐个调用 SSE 接口）
 * - 每个 refno 生成完成后会自动合并到 instances.json
 * - 支持进度回调
 */
export async function triggerBatchGenerateSse(
  refnos: string[],
  options?: {
    onUpdate?: (u: BatchGenerateSseUpdate) => void
    onItemDone?: (u: BatchGenerateItemDone) => void | Promise<void>
    timeoutMs?: number
    skipOnError?: boolean
  }
): Promise<{ successRefnos: string[]; failedRefnos: string[] }> {
  const total = refnos.length
  const successRefnos: string[] = []
  const failedRefnos: string[] = []
  const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000
  const skipOnError = options?.skipOnError ?? true

  for (let i = 0; i < refnos.length; i++) {
    const refno = refnos[i]!
    const percent = Math.round((i / total) * 100)

    options?.onUpdate?.({
      stage: 'generating',
      message: `正在生成 ${refno}...`,
      currentRefno: refno,
      completedCount: i,
      totalCount: total,
      percent,
    })

    try {
      await triggerSubtreeGenerateSse(refno, {
        timeoutMs,
        maxDepth: 0,
      })
      successRefnos.push(refno)
      const donePercent = total > 0 ? Math.round(((i + 1) / total) * 100) : 100
      await options?.onItemDone?.({
        refno,
        ok: true,
        completedCount: i + 1,
        totalCount: total,
        percent: donePercent,
      })
    } catch (e) {
      console.warn(`[batch-generate] Failed to generate ${refno}:`, e)
      failedRefnos.push(refno)
      const donePercent = total > 0 ? Math.round(((i + 1) / total) * 100) : 100
      await options?.onItemDone?.({
        refno,
        ok: false,
        completedCount: i + 1,
        totalCount: total,
        percent: donePercent,
      })
      if (!skipOnError) {
        throw e
      }
    }
  }

  options?.onUpdate?.({
    stage: 'finished',
    message: `生成完成：成功 ${successRefnos.length}，失败 ${failedRefnos.length}`,
    completedCount: total,
    totalCount: total,
    percent: 100,
    failedRefnos,
  })

  return { successRefnos, failedRefnos }
}
