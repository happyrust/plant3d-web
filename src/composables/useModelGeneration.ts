import { ref } from 'vue';
import type { Ref } from 'vue';
import { loadParquetToXeokit } from './useParquetModelLoader';
import { streamGenerateToXeokit } from './useStreamGenerate';
import { useSurrealDB, getDefaultSurrealConfig } from './useSurrealDB';
import type { Viewer } from '@xeokit/xeokit-sdk';
import { getBaseUrl, getTaskProgressWebSocketUrl } from '@/api/genModelTaskApi';
import { useModelSettingsStore } from './useModelSettingsStore';

/** 是否使用 SurrealDB 直接查询模式（绕过后端 Parquet 生成）*/
const useSurrealMode = ref(true);

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
    /** 待生成的总数 */
    totalCount: Ref<number>;
    /** 当前正在生成的索引 (1-based) */
    currentIndex: Ref<number>;
    /** 当前正在处理的 refno */
    currentRefno: Ref<string>;
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
    showModelByRefno: (refno: string) => Promise<boolean>;
    checkRefnoExists: (refno: string) => boolean;
} {
    const { viewer } = options;
    const apiBase = getBaseUrl().replace(/\/$/, '');

    const isGenerating = ref(false);
    const progress = ref(0);
    const statusMessage = ref('');
    const error = ref<string | null>(null);
    const bundleUrl = ref<string | null>(null);
    const totalCount = ref(0);
    const currentIndex = ref(0);
    const currentRefno = ref('');
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Check if refno exists in current loaded model
     */
    function checkRefnoExists(refno: string): boolean {
        const sceneAny = viewer.scene as any;
        const managers = sceneAny.__aiosLazyEntityManagers;

        if (managers) {
            const activeId = sceneAny.__aiosActiveLazyModelId;
            const activeMgr = activeId ? managers[activeId] : undefined;

            // 1) 优先用 active manager
            if (activeMgr?.hasRefno && activeMgr.hasRefno(refno)) {
                return true;
            }

            // 2) 回退：遍历所有 manager
            for (const k of Object.keys(managers)) {
                const m = managers[k];
                if (m?.hasRefno?.(refno)) {
                    return true;
                }
            }
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
            const response = await fetch(buildApiUrl('/api/model/generate-by-refno', apiBase), {
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
            const wsUrl = getTaskProgressWebSocketUrl(taskId);

            const wsResult = await new Promise<{
                bundleUrl: string | null;
                dbno: number | null;
                parquetFiles: string[] | null;
                metadata?: Record<string, unknown>;
            }>((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                let progressTimeout: ReturnType<typeof setTimeout>;
                let settled = false;

                const finish = (fn: () => void) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(progressTimeout);
                    ws.close();
                    fn();
                };

                ws.onopen = () => {
                    console.log(`[ModelGeneration] WebSocket connected: ${wsUrl}`);
                    progressTimeout = setTimeout(() => {
                        finish(() => reject(new Error('生成超时（5 分钟）')));
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

                        if (data.status === 'completed' || data.task?.status === 'completed') {
                            const metadata = data.task?.metadata || data.metadata || {};
                            const bundle_url = (metadata as Record<string, unknown>)?.['bundle_url'] as string | undefined
                                || (metadata as Record<string, unknown>)?.['bundleUrl'] as string | undefined;
                            const dbno = (metadata as Record<string, unknown>)?.['dbno'] as number | undefined
                                || (metadata as Record<string, unknown>)?.['db_num'] as number | undefined;
                            const parquetFiles = (metadata as Record<string, unknown>)?.['parquet_files'] as string[] | undefined
                                || (metadata as Record<string, unknown>)?.['parquetFiles'] as string[] | undefined;

                            finish(() => {
                                console.log(`[ModelGeneration] Task completed, bundle_url:`, bundle_url);
                                resolve({
                                    bundleUrl: bundle_url || null,
                                    dbno: dbno ?? null,
                                    parquetFiles: parquetFiles ?? null,
                                    metadata,
                                });
                            });
                        } else if (data.status === 'failed' || data.task?.status === 'failed') {
                            finish(() => reject(new Error(data.error || data.task?.error || '生成失败')));
                        }
                    } catch (err) {
                        console.error('[ModelGeneration] Failed to parse WebSocket message:', err);
                    }
                };

                ws.onerror = (event) => {
                    console.error('[ModelGeneration] WebSocket error:', event);
                    finish(() => reject(new Error('WebSocket 连接错误')));
                };

                ws.onclose = (event) => {
                    console.log('[ModelGeneration] WebSocket closed:', event.code, event.reason);
                    if (!event.wasClean && !settled) {
                        finish(() => reject(new Error(`WebSocket 异常关闭: ${event.reason || event.code}`)));
                    }
                };
            });

            if (!wsResult) {
                throw new Error('任务完成但未返回结果');
            }

            bundleUrl.value = resolveResourceUrl(wsResult.bundleUrl, apiBase);
            statusMessage.value = '加载 Parquet 模型...';
            progress.value = 85;

            const effectiveDbno = wsResult.dbno ?? db_num;
            if (!effectiveDbno) {
                throw new Error('后端未返回 dbno');
            }

            console.log(`[ModelGeneration] Loading Parquet for dbno: ${effectiveDbno}`);

            const loadResult = await loadParquetToXeokit(viewer, effectiveDbno, {
                debug: false,
                modelId: `generated_${taskId}`,
                parquetFiles: wsResult.parquetFiles || undefined,
            });

            console.log(`[ModelGeneration] Parquet loaded, instances: ${loadResult.instanceCount}`);

            statusMessage.value = '显示模型 (Flying to)...';
            progress.value = 95;

            // Fly to model
            if (loadResult.sceneModel) {
                const aabb = (loadResult.sceneModel as any).aabb;
                if (aabb) {
                    viewer.cameraFlight.flyTo({ aabb, duration: 1.0 });
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

    /**
     * Show model directly without creating a task (for on-demand display)
     * 支持两种模式：
     * 1. SurrealDB 模式（useSurrealMode=true）：直接使用 surrealdb.js 查询数据库
     * 2. Parquet 模式（useSurrealMode=false）：调用后端 API 生成 Parquet 文件
     */
    async function showModelByRefno(refno: string): Promise<boolean> {
        // SurrealDB 直接查询模式
        if (useSurrealMode.value) {
            return showModelByRefnoSurreal(refno);
        } else {
            return showModelByRefnoParquet(refno);
        }
    }

    /**
     * 使用 SurrealDB 直接查询模式显示模型
     */
    /**
     * 使用 SurrealDB 直接查询模式显示模型
     */
    async function showModelByRefnoSurreal(refno: string): Promise<boolean> {
        isGenerating.value = true;
        error.value = null;
        progress.value = 0;
        totalCount.value = 1;
        currentIndex.value = 1;
        currentRefno.value = refno;
        statusMessage.value = `请求后台生成模型: ${refno}...`;

        // 获取设置
        const { isRegenModelEnabled } = useModelSettingsStore();
        const regenModel = isRegenModelEnabled.value;

        try {
            // 0. 初始化计数器
            totalCount.value = 1;
            currentIndex.value = 1;
            currentRefno.value = refno;

            // 1. 触发后台生成逻辑（但通知不生成 parquet）
            try {
                const response = await fetch(buildApiUrl('/api/model/show-by-refno', apiBase), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        refnos: [refno],
                        regen_model: regenModel,
                        gen_parquet: false, // 核心：通知后端只生成数据，不导出文件
                    }),
                });

                if (!response.ok) {
                    console.warn('[ModelGeneration] Backend generation hint failed, but will try SurrealDB anyway');
                } else {
                    const result = await response.json();
                    if (!result.success) {
                        console.warn('[ModelGeneration] Backend reported generation issue:', result.message);
                    }
                }
            } catch (apiErr) {
                console.warn('[ModelGeneration] Failed to call backend generation API:', apiErr);
            }

            statusMessage.value = '连接 SurrealDB...';
            progress.value = 30;

            // 2. 确保 SurrealDB 已连接
            const { connect, isConnected } = useSurrealDB();

            if (!isConnected.value) {
                console.log('[ModelGeneration] Connecting to SurrealDB...');
                await connect(getDefaultSurrealConfig());
            }

            statusMessage.value = '查询模型数据...';
            progress.value = 50;

            // 3. 走后端 SSE：边生成边加载（单个 refno 的场景下也复用该链路）
            console.log(`[ModelGeneration] Streaming generate+load via SurrealDB for refno: ${refno}`);
            const loadResult = await streamGenerateToXeokit(viewer, [refno], {
                debug: true,
                modelId: `surreal_stream_${refno}`,
                enableHoles: true,
                apiBaseUrl: apiBase,
                onProgress: (p, msg) => {
                    // SSE 进度映射到 50~95，保留 95~100 给 finalize 阶段
                    // finalize 完成后由 streamGenerateToXeokit 返回，再设置 100%
                    const mapped = 50 + Math.max(0, Math.min(100, p)) * 0.45;
                    progress.value = Math.max(progress.value, Math.round(mapped));
                    if (msg) statusMessage.value = msg;
                },
                onError: (e) => {
                    // 不中断主流程，但让 UI 能看到告警/错误信息
                    console.warn('[ModelGeneration] StreamGenerate warning/error:', e);
                },
            });

            if (!loadResult) {
                throw new Error('流式生成已取消或未返回结果');
            }

            console.log(`[ModelGeneration] SurrealDB model loaded, instances: ${loadResult.instanceCount}`);

            // 确保进度达到 100，用于 completedCount 正确显示
            progress.value = 100;
            statusMessage.value = '显示模型 (Flying to)...';

            // 4. Fly to model
            if (loadResult.sceneModel) {
                const aabb = (loadResult.sceneModel as any).aabb;
                if (aabb) {
                    viewer.cameraFlight.flyTo({ aabb, duration: 1.0 });
                }
            }

            statusMessage.value = '完成';

            return true;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error('[ModelGeneration] SurrealDB Error:', errorMsg, err);
            error.value = errorMsg;
            statusMessage.value = `错误: ${errorMsg}`;
            return false;
        } finally {
            if (closeTimer) {
                clearTimeout(closeTimer);
                closeTimer = null;
            }
            // 只要流程结束（成功），立刻关闭弹窗；失败则保持弹窗显示错误，等待用户手动关闭。
            if (!error.value) {
                isGenerating.value = false;
                closeTimer = null;
            } else {
                // 给错误 UI 一个最小渲染窗口，避免同步结束导致看不到错误信息
                closeTimer = setTimeout(() => {
                    closeTimer = null;
                }, 0);
            }
        }
    }

    /**
     * 使用 Parquet 模式显示模型（调用后端 API）
     */
    async function showModelByRefnoParquet(refno: string): Promise<boolean> {
        isGenerating.value = true;
        error.value = null;
        progress.value = 0;
        totalCount.value = 1;
        currentIndex.value = 1;
        currentRefno.value = refno;
        statusMessage.value = '正在生成模型...';

        // 获取设置
        const { isRegenModelEnabled } = useModelSettingsStore();
        const regenModel = isRegenModelEnabled.value;

        if (regenModel) {
            console.log('[ModelGeneration] regen_model 已启用，将强制重新生成模型');
        }

        try {
            const response = await fetch(buildApiUrl('/api/model/show-by-refno', apiBase), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    refnos: [refno],
                    regen_model: regenModel,
                    // 不再传递 db_num，后端自动从 SPdmsElement 查询
                }),
            });

            if (!response.ok) {
                throw new Error(`API 调用失败: ${response.statusText}`);
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || '生成失败');
            }

            // 从后端返回的 metadata 中获取 dbno
            const dbno = result.metadata?.dbno;
            if (!dbno) {
                throw new Error('后端未返回 dbno');
            }

            // 获取后端返回的 parquet 文件列表
            const parquetFiles = result.parquet_files || result.metadata?.parquet_files;

            statusMessage.value = '加载 Parquet 模型...';
            progress.value = 50;

            console.log(`[ModelGeneration] Loading Parquet for dbno: ${dbno}, files:`, parquetFiles);

            const loadResult = await loadParquetToXeokit(viewer, dbno, {
                debug: false,
                modelId: `parquet_${dbno}`,
                parquetFiles: parquetFiles  // 使用后端返回的文件列表
            });

            console.log(`[ModelGeneration] Parquet loaded, instances: ${loadResult.instanceCount}`);

            statusMessage.value = '显示模型 (Flying to)...';
            progress.value = 90;

            // Fly to model
            if (loadResult.sceneModel) {
                const aabb = (loadResult.sceneModel as any).aabb;
                if (aabb) {
                    viewer.cameraFlight.flyTo({ aabb, duration: 1.0 });
                }
            }

            // Parquet 加载器会自动创建 Entity，不需要手动 showEntity (非 lazy 模式)

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
            if (!error.value) {
                isGenerating.value = false;
            }
        }
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
    };
}

/**
 * Extract db_num from refno format like "17496_266204"
 */
function extractDbNumFromRefno(refno: string): number | null {
    // Support separators: underscore (_), slash (/), or even comma (,)
    const parts = refno.split(/[_/,]/);
    if (parts.length >= 2) {
        const val = parts[0];
        if (!val) return null;
        const dbNum = parseInt(val, 10);
        if (!isNaN(dbNum)) {
            return dbNum;
        }
    }
    return null;
}

/**
 * 构建完整 API URL，复用统一的基址配置
 */
function buildApiUrl(path: string, base: string): string {
    if (/^https?:\/\//.test(path)) return path;
    const cleanBase = base.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
}

/**
 * 处理后端返回的 bundle_url（可能为相对路径）
 */
function resolveResourceUrl(url: string | null, base: string): string | null {
    if (!url) return null;
    if (/^(https?:)?\/\//.test(url)) {
        return url;
    }
    const cleanBase = base.replace(/\/$/, '');
    const cleanUrl = url.startsWith('/') ? url : `/${url}`;
    return `${cleanBase}${cleanUrl}`;
}
