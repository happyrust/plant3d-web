/**
 * 流式模型生成 Composable
 *
 * 通过 SSE (Server-Sent Events) 实现增量模型加载，
 * 边生成边显示模型数据。
 */

import { ref, computed } from 'vue'
import type { Viewer, SceneModel } from '@xeokit/xeokit-sdk'
import { loadSurrealToXeokit, type SurrealLoadOptions, type SurrealLoadResult } from './useSurrealModelLoader'

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
            apiBaseUrl = 'http://localhost:8080',
            expandChildren = true,
            forceRegenerate = false,
            batchSize = 50,
            maxDepth = 10,
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
            // 1. 创建 SSE 连接
            const response = await fetch(`${apiBaseUrl}/api/model/stream-generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify({
                    refnos,
                    expandChildren,
                    forceRegenerate,
                    batchSize,
                    maxDepth,
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
            let allGeneratedRefnos: string[] = []
            let sceneModel: SceneModel | null = null

            // 2. 处理 SSE 事件
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
                                await handleStreamEvent(
                                    event,
                                    viewer,
                                    loadOptions,
                                    allGeneratedRefnos,
                                    onBatchComplete,
                                    onProgress,
                                    onError
                                )
                            } catch (e) {
                                console.warn('[StreamGenerate] Failed to parse event:', jsonStr, e)
                            }
                        }
                    }
                }
            }

            // 3. 加载所有生成的模型
            if (allGeneratedRefnos.length > 0 || state.value.skippedCount > 0) {
                // 使用所有原始 refnos 加载（包括跳过的已存在的）
                const refnosSet = new Set([...refnos, ...allGeneratedRefnos])
                const refnosToLoad = Array.from(refnosSet)
                console.log('[StreamGenerate] Loading final model with', refnosToLoad.length, 'refnos')

                const result = await loadSurrealToXeokit(viewer, refnosToLoad, {
                    ...loadOptions,
                    modelId: loadOptions.modelId || 'stream-generated',
                })

                state.value.isLoading = false
                state.value.progress = 100
                return result
            }

            state.value.isLoading = false
            return null
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            state.value.errors.push(errorMsg)
            state.value.isLoading = false
            onError?.(errorMsg)
            throw error
        }
    }

    /**
     * 处理 SSE 事件
     */
    async function handleStreamEvent(
        event: StreamGenerateEvent,
        viewer: Viewer,
        loadOptions: SurrealLoadOptions,
        allGeneratedRefnos: string[],
        onBatchComplete?: (refnos: string[], batchIndex: number) => void,
        onProgress?: (progress: number, message: string) => void,
        onError?: (error: string) => void
    ) {
        switch (event.type) {
            case 'started':
                console.log('[StreamGenerate] Started:', event.message)
                onProgress?.(0, event.message || '开始处理')
                break

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
                break

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

                if (event.generatedRefnos) {
                    allGeneratedRefnos.push(...event.generatedRefnos)
                    state.value.loadedRefnos.push(...event.generatedRefnos)
                    state.value.generatedCount += event.generatedRefnos.length
                    onBatchComplete?.(event.generatedRefnos, event.batchIndex || 0)
                }

                onProgress?.(
                    event.progress || 0,
                    `批次 ${(event.batchIndex || 0) + 1}/${event.batchCount} 完成`
                )
                break

            case 'batchFailed':
                console.error('[StreamGenerate] Batch', event.batchIndex, 'failed:', event.error)
                state.value.errors.push(event.error || '批次生成失败')
                onError?.(event.error || '批次生成失败')
                break

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
                break

            case 'error':
                console.error('[StreamGenerate] Error:', event.message)
                state.value.errors.push(event.message || '未知错误')
                onError?.(event.message || '未知错误')
                break
        }
    }

    /**
     * 取消当前加载
     */
    function cancel() {
        state.value.isLoading = false
        // TODO: 实现 AbortController 支持
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
