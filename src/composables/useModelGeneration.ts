import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import { useWebSocket } from './useWebSocket';
import { loadAiosPrepackBundle } from '@/aios-prepack-bundle-loader';
import type { Viewer } from '@xeokit/xeokit-sdk';

export interface ModelGenerationOptions {
    db_num?: number;
    viewer: Viewer;
}

export interface ModelGenerationState {
    isGenerating: Ref<boolean>;
    progress: Ref<number>;
    statusMessage: Ref<string>;
    error: Ref<string | null>;
    bundleUrl: Ref<string | null>;
}

/**
 * Composable for dynamic model generation by refno
 * 
 * Usage:
 * ```ts
 * const modelGen = useModelGeneration({ viewer: viewerInstance });
 * await modelGen.generateAndLoadModel('17496_266204');
 * ```
 */
export function useModelGeneration(options: ModelGenerationOptions): ModelGenerationState & {
    generateAndLoadModel: (refno: string) => Promise<boolean>;
    checkRefnoExists: (refno: string) => boolean;
} {
    const { viewer } = options;

    const isGenerating = ref(false);
    const progress = ref(0);
    const statusMessage = ref('');
    const error = ref<string | null>(null);
    const bundleUrl = ref<string | null>(null);

    /**
     * Check if refno exists in current loaded model
     */
    function checkRefnoExists(refno: string): boolean {
        const sceneAny = viewer.scene as any;
        const managers = sceneAny.__aiosLazyEntityManagers;

        if (!managers) return false;

        const activeId = sceneAny.__aiosActiveLazyModelId;
        const mgr = activeId ? managers[activeId] : undefined;

        if (mgr?.hasRefno) {
            return mgr.hasRefno(refno);
        }

        // Fallback: check if entity exists in scene
        return !!viewer.scene.objects[refno];
    }

    /**
     * Generate model on backend and load into scene
     */
    async function generateAndLoadModel(refno: string): Promise<boolean> {
        // 1. Check if already exists
        if (checkRefnoExists(refno)) {
            console.log(`[ModelGeneration] refno ${refno} already exists, showing entity`);
            const sceneAny = viewer.scene as any;
            const managers = sceneAny.__aiosLazyEntityManagers;
            const activeId = sceneAny.__aiosActiveLazyModelId;
            const mgr = activeId ? managers[activeId] : undefined;

            if (mgr?.showEntity) {
                mgr.showEntity(refno);
            }
            return true;
        }

        isGenerating.value = true;
        error.value = null;
        progress.value = 0;
        statusMessage.value = '准备生成模型...';

        try {
            // 2. Determine db_num
            const db_num = options.db_num || extractDbNumFromRefno(refno);

            if (!db_num) {
                throw new Error('无法确定 db_num，请在配置中指定或使用有效的 refno 格式');
            }

            statusMessage.value = '调用生成 API...';

            // 3. Call generation API
            const response = await fetch('http://localhost:8080/api/model/generate-by-refno', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    refnos: [refno],
                    db_num: db_num,
                    gen_model: true,
                    gen_mesh: true,
                }),
            });

            if (!response.ok) {
                throw new Error(`API 调用失败: ${response.statusText}`);
            }

            const result = await response.json();

            if (!result.success || !result.task_id) {
                throw new Error(result.message || '生成任务创建失败');
            }

            const taskId = result.task_id;
            console.log(`[ModelGeneration] Task created: ${taskId}`);

            statusMessage.value = '等待生成完成...';
            progress.value = 10;

            // 4. Subscribe to WebSocket progress
            const wsUrl = `ws://localhost:8080/ws/progress/${taskId}`;

            const wsResult = await new Promise<string | null>((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                let progressTimeout: ReturnType<typeof setTimeout>;

                const cleanup = () => {
                    clearTimeout(progressTimeout);
                    ws.close();
                };

                ws.onopen = () => {
                    console.log(`[ModelGeneration] WebSocket connected: ${wsUrl}`);
                    // Set timeout for task completion (5 minutes)
                    progressTimeout = setTimeout(() => {
                        cleanup();
                        reject(new Error('生成超时（5 分钟）'));
                    }, 5 * 60 * 1000);
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log(`[ModelGeneration] Progress:`, data);

                        if (data.progress && data.progress.percentage !== undefined) {
                            progress.value = 10 + (data.progress.percentage * 0.7); // 10-80%
                            statusMessage.value = data.progress.current_step || '生成中...';
                        }

                        // Check for completion
                        if (data.status === 'completed' || data.task?.status === 'completed') {
                            cleanup();

                            // Extract bundle_url from metadata
                            const metadata = data.task?.metadata || data.metadata;
                            const bundle_url = metadata?.bundle_url;

                            console.log(`[ModelGeneration] Task completed, bundle_url:`, bundle_url);
                            resolve(bundle_url || null);
                        } else if (data.status === 'failed' || data.task?.status === 'failed') {
                            cleanup();
                            reject(new Error(data.error || data.task?.error || '生成失败'));
                        }
                    } catch (err) {
                        console.error('[ModelGeneration] Failed to parse WebSocket message:', err);
                    }
                };

                ws.onerror = (event) => {
                    console.error('[ModelGeneration] WebSocket error:', event);
                    cleanup();
                    reject(new Error('WebSocket 连接错误'));
                };

                ws.onclose = (event) => {
                    console.log('[ModelGeneration] WebSocket closed:', event.code, event.reason);
                    if (!event.wasClean) {
                        cleanup();
                        reject(new Error(`WebSocket 异常关闭: ${event.reason || event.code}`));
                    }
                };
            });

            if (!wsResult) {
                throw new Error('任务完成但未返回 bundle_url');
            }

            bundleUrl.value = wsResult;
            statusMessage.value = '加载模型...';
            progress.value = 85;

            // 5. Load bundle using loadAiosPrepackBundle
            const baseUrl = `http://localhost:8080${wsResult}`;

            console.log(`[ModelGeneration] Loading bundle from: ${baseUrl}`);

            await loadAiosPrepackBundle(viewer, {
                baseUrl,
                modelId: `generated_${taskId}`,
                lodAssetKey: 'L1',
                edges: true,
                lazyEntities: true,
            });

            statusMessage.value = '显示模型...';
            progress.value = 95;

            // 6. Show the entity
            const sceneAny = viewer.scene as any;
            const managers = sceneAny.__aiosLazyEntityManagers;
            const activeId = sceneAny.__aiosActiveLazyModelId;
            const mgr = activeId ? managers[activeId] : undefined;

            if (mgr?.showEntity) {
                const shown = mgr.showEntity(refno);
                if (!shown) {
                    console.warn(`[ModelGeneration] Failed to show entity ${refno} after loading`);
                }
            }

            progress.value = 100;
            statusMessage.value = '完成';

            return true;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[ModelGeneration] Error:', errorMsg, err);
            error.value = errorMsg;
            statusMessage.value = `错误: ${errorMsg}`;
            return false;
        } finally {
            setTimeout(() => {
                isGenerating.value = false;
            }, 1000); // Keep UI feedback for a moment
        }
    }

    return {
        isGenerating,
        progress,
        statusMessage,
        error,
        bundleUrl,
        generateAndLoadModel,
        checkRefnoExists,
    };
}

/**
 * Extract db_num from refno format like "17496_266204"
 */
function extractDbNumFromRefno(refno: string): number | null {
    const parts = refno.split('_');
    if (parts.length >= 2) {
        const dbNum = parseInt(parts[0], 10);
        if (!isNaN(dbNum)) {
            return dbNum;
        }
    }
    return null;
}
