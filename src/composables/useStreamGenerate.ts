/**
 * 流式模型生成 Composable
 *
 * 通过 SSE (Server-Sent Events) 实现增量模型加载，
 * 边生成边显示模型数据。
 */

import { ref, computed } from 'vue'
import type { Viewer } from '@xeokit/xeokit-sdk'
import { loadSurrealToXeokit, type SurrealLoadOptions, type SurrealLoadResult } from './useSurrealModelLoader'
import { getBaseUrl } from '@/api/genModelTaskApi'

// ========================
// 类型定义
// ========================

/** SSE 事件类型 */
export interface StreamGenerateEvent {
    type: 'started' | 'expandComplete' | 'batchComplete' | 'batchFailed' | 'finished' | 'error'
    totalRefnos?: number
    message?: string
    originalCount?: number
    expandedCount?: number
    skippedCount?: number
    batchIndex?: number
    batchCount?: number
    generatedRefnos?: string[]
    skippedRefnos?: string[]
    warning?: string
    progress?: number
    totalGenerated?: number
    totalSkipped?: number
    durationMs?: number
    error?: string
}

/** 流式生成请求参数 */
export interface StreamGenerateRequest {
    refnos: string[]
    expandChildren?: boolean
    forceRegenerate?: boolean
    batchSize?: number
    maxDepth?: number
    applyBoolean?: boolean
}

/** 流式生成状态 */
export interface StreamGenerateState {
    isLoading: boolean
    progress: number
    currentBatch: number
    totalBatches: number
    generatedCount: number
    skippedCount: number
    loadedRefnos: string[]
    errors: string[]
}

/** 流式生成选项 */
export interface StreamGenerateOptions extends SurrealLoadOptions {
    /** API 服务器地址 */
    apiBaseUrl?: string
    /** 是否展开子节点 */
    expandChildren?: boolean
    /** 是否强制重新生成 */
    forceRegenerate?: boolean
    /** 每批处理数量 */
    batchSize?: number
    /** 最大展开深度 */
    maxDepth?: number
    /** 是否执行布尔运算（孔洞/负实体结果） */
    applyBoolean?: boolean
    /** 批次完成回调 */
    onBatchComplete?: (refnos: string[], batchIndex: number) => void
    /** 进度更新回调 */
    onProgress?: (progress: number, message: string) => void
    /** 错误回调 */
    onError?: (error: string) => void
}

// ========================
// Composable
// ========================

/**
 * 流式模型生成 Composable
 */
export function useStreamGenerate() {
    const state = ref<StreamGenerateState>({
        isLoading: false,
        progress: 0,
        currentBatch: 0,
        totalBatches: 0,
        generatedCount: 0,
        skippedCount: 0,
        loadedRefnos: [],
        errors: [],
    })

    const isLoading = computed(() => state.value.isLoading)
    const progress = computed(() => state.value.progress)
    const loadedCount = computed(() => state.value.loadedRefnos.length)

    /**
     * 流式生成并加载模型
     *
     * 1. 调用后端 SSE API 触发模型生成
     * 2. 每个批次完成后，从 SurrealDB 查询并渲染新生成的模型
     */
    async function streamGenerateAndLoad(
        viewer: Viewer,
        refnos: string[],
        options: StreamGenerateOptions = {}
    ): Promise<SurrealLoadResult | null> {
        const {
            apiBaseUrl = getBaseUrl(),
            expandChildren = true,
            forceRegenerate = false,
            batchSize = 50,
            maxDepth = 0,
            applyBoolean,
            onBatchComplete,
            onProgress,
            onError,
            ...loadOptions
        } = options

        // 重置状态
        state.value = {
            isLoading: true,
            progress: 0,
            currentBatch: 0,
            totalBatches: 0,
            generatedCount: 0,
            skippedCount: 0,
            loadedRefnos: [],
            errors: [],
        }

        try {
            const abortController = new AbortController()
            currentAbortController = abortController

            // 1. 创建 SSE 连接
            const response = await fetch(`${apiBaseUrl}/api/model/stream-generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                signal: abortController.signal,
                body: JSON.stringify({
                    refnos,
                    expandChildren,
                    forceRegenerate,
                    batchSize,
                    maxDepth,
                    applyBoolean: applyBoolean ?? !!loadOptions.enableHoles,
                } as StreamGenerateRequest),
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const reader = response.body?.getReader()
            if (!reader) {
                throw new Error('无法获取响应流')
            }

            const decoder = new TextDecoder()
            let buffer = ''
            const loadedSet = new Set<string>()
            const loadedBatches: string[][] = []
            // 收集所有待加载的 refnos，SSE 结束后统一加载
            const allRefnosToLoad: string[] = []
            let shouldStop = false

            // 2. 处理 SSE 事件（只收集数据，不立即加载）
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })

                // 解析 SSE 事件
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const jsonStr = line.slice(5).trim()
                        if (jsonStr) {
                            try {
                                const event: StreamGenerateEvent = JSON.parse(jsonStr)
                                const batchToLoad = await handleStreamEvent(
                                    event,
                                    loadedSet,
                                    loadedBatches,
                                    onBatchComplete,
                                    onProgress,
                                    onError
                                )
                                if (event.type === 'finished' || event.type === 'error') {
                                    shouldStop = true
                                    break
                                }
                                // 收集 refnos，不立即加载
                                if (batchToLoad && batchToLoad.length > 0) {
                                    allRefnosToLoad.push(...batchToLoad)
                                }
                            } catch (e) {
                                console.warn('[StreamGenerate] Failed to parse event:', jsonStr, e)
                            }
                        }
                    }
                }
                if (shouldStop) {
                    try {
                        await reader.cancel()
                    } catch {
                        // ignore
                    }
                    break
                }
            }

            // 3. SSE 结束后，统一加载所有 refnos（只调用一次 finalize）
            let loadResult: SurrealLoadResult | null = null
            if (allRefnosToLoad.length > 0) {
                onProgress?.(90, `正在渲染 ${allRefnosToLoad.length} 个构件...`)
                const modelId = loadOptions.modelId || `stream-generated-${Date.now()}`
                loadResult = await loadSurrealToXeokit(viewer, allRefnosToLoad, {
                    ...loadOptions,
                    modelId,
                })
            }

            state.value.isLoading = false
            state.value.progress = 100
            currentAbortController = null
            return loadResult
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                state.value.isLoading = false
                currentAbortController = null
                return null
            }
            const errorMsg = error instanceof Error ? error.message : String(error)
            state.value.errors.push(errorMsg)
            state.value.isLoading = false
            onError?.(errorMsg)
            throw error
        } finally {
            currentAbortController = null
        }
    }

    /**
     * 处理 SSE 事件
     */
    async function handleStreamEvent(
        event: StreamGenerateEvent,
        loadedSet: Set<string>,
        loadedBatches: string[][],
        onBatchComplete?: (refnos: string[], batchIndex: number) => void,
        onProgress?: (progress: number, message: string) => void,
        onError?: (error: string) => void
    ): Promise<string[] | null> {
        switch (event.type) {
            case 'started':
                console.log('[StreamGenerate] Started:', event.message)
                onProgress?.(0, event.message || '开始处理')
                return null

            case 'expandComplete':
                console.log(
                    '[StreamGenerate] Expanded:',
                    event.originalCount,
                    '->',
                    event.expandedCount,
                    'skipped:',
                    event.skippedCount
                )
                state.value.skippedCount = event.skippedCount || 0
                onProgress?.(5, `展开完成: ${event.expandedCount} 个节点`)
                return null

            case 'batchComplete':
                console.log(
                    '[StreamGenerate] Batch',
                    event.batchIndex,
                    '/',
                    event.batchCount,
                    'completed:',
                    event.generatedRefnos?.length
                )
                state.value.currentBatch = (event.batchIndex || 0) + 1
                state.value.totalBatches = event.batchCount || 0
                state.value.progress = event.progress || 0
                if (event.warning) {
                    state.value.errors.push(event.warning)
                    onError?.(event.warning)
                }

                const ready = [
                    ...(event.skippedRefnos || []),
                    ...(event.generatedRefnos || []),
                ]
                const uniqueToLoad: string[] = []
                for (const r of ready) {
                    if (!loadedSet.has(r)) {
                        loadedSet.add(r)
                        uniqueToLoad.push(r)
                    }
                }

                if (event.generatedRefnos && event.generatedRefnos.length > 0) {
                    state.value.generatedCount += event.generatedRefnos.length
                    onBatchComplete?.(event.generatedRefnos, event.batchIndex || 0)
                }
                if (uniqueToLoad.length > 0) {
                    state.value.loadedRefnos.push(...uniqueToLoad)
                }
                loadedBatches.push(uniqueToLoad)

                onProgress?.(
                    event.progress || 0,
                    `批次 ${(event.batchIndex || 0) + 1}/${event.batchCount} 完成`
                )
                return uniqueToLoad

            case 'batchFailed':
                console.error('[StreamGenerate] Batch', event.batchIndex, 'failed:', event.error)
                state.value.errors.push(event.error || '批次生成失败')
                onError?.(event.error || '批次生成失败')
                // 即使生成失败，也尝试加载 skipped（如果后端提供）
                if (event.skippedRefnos && event.skippedRefnos.length > 0) {
                    const uniqueToLoad: string[] = []
                    for (const r of event.skippedRefnos) {
                        if (!loadedSet.has(r)) {
                            loadedSet.add(r)
                            uniqueToLoad.push(r)
                        }
                    }
                    loadedBatches.push(uniqueToLoad)
                    if (uniqueToLoad.length > 0) {
                        state.value.loadedRefnos.push(...uniqueToLoad)
                    }
                    return uniqueToLoad
                }
                return null

            case 'finished':
                console.log(
                    '[StreamGenerate] Finished:',
                    event.totalGenerated,
                    'generated,',
                    event.totalSkipped,
                    'skipped in',
                    event.durationMs,
                    'ms'
                )
                state.value.progress = 100
                onProgress?.(100, `完成: ${event.totalGenerated} 个生成, ${event.totalSkipped} 个跳过`)
                return null

            case 'error':
                console.error('[StreamGenerate] Error:', event.message)
                state.value.errors.push(event.message || '未知错误')
                onError?.(event.message || '未知错误')
                return null
        }
        return null
    }

    let currentAbortController: AbortController | null = null

    /**
     * 取消当前加载
     */
    function cancel() {
        currentAbortController?.abort()
        currentAbortController = null
        state.value.isLoading = false
    }

    /**
     * 重置状态
     */
    function reset() {
        state.value = {
            isLoading: false,
            progress: 0,
            currentBatch: 0,
            totalBatches: 0,
            generatedCount: 0,
            skippedCount: 0,
            loadedRefnos: [],
            errors: [],
        }
    }

    return {
        state,
        isLoading,
        progress,
        loadedCount,
        streamGenerateAndLoad,
        cancel,
        reset,
    }
}

// ========================
// 便捷函数
// ========================

/**
 * 单次调用流式生成并加载模型
 */
export async function streamGenerateToXeokit(
    viewer: Viewer,
    refnos: string[],
    options: StreamGenerateOptions = {}
): Promise<SurrealLoadResult | null> {
    const { streamGenerateAndLoad } = useStreamGenerate()
    return streamGenerateAndLoad(viewer, refnos, options)
}
