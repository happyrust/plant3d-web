import { ref } from 'vue';
import type { Ref } from 'vue';

import type { InstanceManifest } from '@/utils/instances/instanceManifest';

import { e3dGetSubtreeRefnos, e3dGetVisibleInsts } from '@/api/genModelE3dApi';
import { enqueueParquetIncremental, getParquetVersion } from '@/api/genModelRealtimeApi';
import { modelShowByRefno } from '@/api/genModelTaskApi';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader';
import { triggerBatchGenerateSse } from '@/composables/useDbnoInstancesJsonLoader';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { emitToast } from '@/ribbon/toastBus';

/**
 * 全局开关：是否显式启用自动生成（SSE 流式生成、自动导出 parquet）
 * 默认 false（关闭自动补生成）；仅支持 query 参数：
 * - query: `dtx_enable_auto_generation=1`
 */
function shouldEnableAutoGeneration(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    const rawQ = (q.get('dtx_enable_auto_generation') || '').trim().toLowerCase();
    if (rawQ === '1' || rawQ === 'true') return true;
    if (rawQ === '0' || rawQ === 'false') return false;
  } catch {
    // ignore
  }
  return false;
}

export function isAutoGenerationEnabled(): boolean {
  return shouldEnableAutoGeneration();
}

export const AUTO_GENERATION_ENABLED = shouldEnableAutoGeneration();
const VISIBLE_REFNOS_PAGE_SIZE = 1000;

export type ModelGenerationOptions = {
  db_num?: number
  viewer: unknown
}

export type ModelGenerationState = {
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
  return String(refno || '').trim().replace('/', '_');
}

function toBackendRefno(refno: string): string {
  const normalized = normalizeRefnoString(refno);
  const m = normalized.match(/^(\d+)_(\d+)$/);
  if (m) return `${m[1]}/${m[2]}`;
  return normalized;
}

function uniqStrings(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const v = String(raw || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function querySubtreeRefnos(refno: string): Promise<{ refnos: string[]; truncated: boolean }> {
  const normalized = normalizeRefnoString(refno);
  if (!normalized) return { refnos: [], truncated: false };

  // 约定：后端返回“子孙可见 refnos”（此处用 subtree-refnos 承接）
  const resp = await e3dGetSubtreeRefnos(normalized, { includeSelf: true, limit: 200_000 });
  if (!resp.success) {
    throw new Error(resp.error_message || 'e3d subtree-refnos 查询失败');
  }
  const list = Array.isArray(resp.refnos) ? resp.refnos : [];
  const out = uniqStrings(list.map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean);
  return { refnos: out, truncated: !!resp.truncated };
}

export async function queryLoadScopeRefnos(refno: string): Promise<{
  refnos: string[]
  source: 'visible-insts' | 'subtree-refnos'
  truncated: boolean
}> {
  const normalized = normalizeRefnoString(refno);
  if (!normalized) {
    return { refnos: [], source: 'visible-insts', truncated: false };
  }

  try {
    const resp = await e3dGetVisibleInsts(normalized);
    if (!resp.success) {
      throw new Error(resp.error_message || 'e3d visible-insts 查询失败');
    }
    const list = Array.isArray(resp.refnos) ? resp.refnos : [];
    return {
      refnos: uniqStrings(list.map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean),
      source: 'visible-insts',
      truncated: false,
    };
  } catch {
    const subtree = await querySubtreeRefnos(normalized);
    return {
      refnos: subtree.refnos,
      source: 'subtree-refnos',
      truncated: subtree.truncated,
    };
  }
}

export function useModelGeneration(options: ModelGenerationOptions): ModelGenerationState & {
  generateAndLoadModel: (refno: string) => Promise<boolean>
  showModelByDbnum: (dbno: number, options?: { flyTo?: boolean }) => Promise<{ loaded: boolean; instanceCount: number; refnoCount: number }>
  showModelByRefno: (refno: string, options?: { flyTo?: boolean }) => Promise<boolean>
  isModelActuallyLoaded: (refno: string) => boolean
  checkRefnoExists: (refno: string) => boolean
} {
  const { viewer } = options;
  const consoleStore = useConsoleStore();
  const modelLoadStatus = useModelLoadStatus();

  const isGenerating = ref(false);
  const showProgressModal = ref(false);
  const progress = ref(0);
  const statusMessage = ref('');
  const error = ref<string | null>(null);
  const bundleUrl = ref<string | null>(null);
  const totalCount = ref(0);
  const currentIndex = ref(0);
  const currentRefno = ref('');
  const lastLoadDebug = ref<ModelLoadDebugInfo | null>(null);

  const loadedRoots = new Set<string>();
  const PARQUET_VERSION_POLL_INTERVAL_MS = 3000;

  function syncGlobalLoadStatus() {
    modelLoadStatus.update({
      progress: progress.value,
      message: statusMessage.value,
      currentRefno: currentRefno.value,
      error: error.value,
    });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      return { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, missingRefnos: [] };
    }

    statusMessage.value = '正在加载实时生成模型...';
    progress.value = Math.max(progress.value, 96);

    const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, refnos, {
      lodAssetKey: 'L1',
      debug: false,
      dataSource: 'backend',
      forceReloadRefnos: refnos,
    });
    anyViewer.__dtxAfterInstancesLoaded?.(dbno, refnos);
    return result;
  }

  async function pollParquetVersionAfterEnqueue(
    dbno: number,
    baselineRevision: number,
    maxWaitMs = 3 * 60 * 1000
  ): Promise<{ updated: boolean; revision: number; error?: string }> {
    const startedAt = Date.now();
    let lastError = '';

    while (Date.now() - startedAt < maxWaitMs) {
      await sleep(PARQUET_VERSION_POLL_INTERVAL_MS);
      try {
        const version = await getParquetVersion(dbno);
        const revision = Number(version.revision || 0);
        if (revision > baselineRevision) {
          return { updated: true, revision };
        }
        if (!version.running && Number(version.pending_count || 0) <= 0) {
          return {
            updated: false,
            revision,
            error: version.last_error || undefined,
          };
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      updated: false,
      revision: baselineRevision,
      error: lastError || '版本轮询超时',
    };
  }

  async function ensureParquetAvailableByAutoExport(
    dbno: number,
    candidateRefnos: string[]
  ): Promise<boolean> {
    const parquetLoader = useDbnoInstancesParquetLoader();
    if (await parquetLoader.isParquetAvailable(dbno)) return true;

    if (!AUTO_GENERATION_ENABLED) {
      console.warn(`[model-generation] parquet 缺失，当前默认不自动导出 dbno=${dbno}`);
      consoleStore.addLog('warning', `[model-load] parquet 缺失，当前默认不自动导出 dbno=${dbno}`);
      return false;
    }

    const normalized = uniqStrings(candidateRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
    if (normalized.length === 0) return false;
    const backendRefnos = normalized.map((r) => toBackendRefno(r));

    let baselineRevision = 0;
    try {
      const version = await getParquetVersion(dbno);
      baselineRevision = Number(version.revision || 0);
    } catch {
      baselineRevision = 0;
    }

    statusMessage.value = `检测到 parquet 缺失，正在自动导出（${backendRefnos.length} 个 refno）...`;
    progress.value = Math.max(progress.value, 20);
    consoleStore.addLog('info', `[model-load] parquet 缺失，触发自动导出 dbno=${dbno} refno_count=${backendRefnos.length}`);

    const exportResp = await modelShowByRefno({
      db_num: dbno,
      refnos: backendRefnos,
      gen_model: true,
      gen_mesh: true,
      regen_model: false,
      gen_parquet: true,
    });

    if (!exportResp?.success) {
      consoleStore.addLog(
        'error',
        `[model-load] 自动导出 parquet 失败 dbno=${dbno} message=${exportResp?.message ?? 'unknown'}`
      );
      return false;
    }

    const timeoutMs = 10 * 60 * 1000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await parquetLoader.isParquetAvailable(dbno)) {
        consoleStore.addLog('info', `[model-load] parquet 已可用 dbno=${dbno}`);
        return true;
      }
      await sleep(2000);
    }

    const poll = await pollParquetVersionAfterEnqueue(dbno, baselineRevision, 2 * 60 * 1000);
    if (poll.updated && (await parquetLoader.isParquetAvailable(dbno))) {
      consoleStore.addLog('info', `[model-load] parquet 版本更新后可用 dbno=${dbno} revision=${poll.revision}`);
      return true;
    }
    if (poll.error) {
      consoleStore.addLog('error', `[model-load] 自动导出后 parquet 仍不可用 dbno=${dbno} err=${poll.error}`);
    }

    return await parquetLoader.isParquetAvailable(dbno);
  }

  async function handleMissingRefnos(
    dtxLayer: any,
    dbno: number,
    missingRefnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void }
  ): Promise<{ loadedObjects: number; failedRefnos: string[] }> {
    const normalizedMissing = uniqStrings(missingRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
    if (normalizedMissing.length === 0) {
      return { loadedObjects: 0, failedRefnos: [] };
    }

    if (!AUTO_GENERATION_ENABLED) {
      console.warn(`[model-generation] 发现 ${normalizedMissing.length} 个缺失模型，已按默认策略跳过自动生成`);
      consoleStore.addLog(
        'warning',
        `[model-load] 发现 ${normalizedMissing.length} 个缺失模型，已按默认策略跳过自动生成 dbno=${dbno}`
      );
      return { loadedObjects: 0, failedRefnos: normalizedMissing };
    }

    showProgressModal.value = true;
    statusMessage.value = `发现 ${normalizedMissing.length} 个缺失模型，正在实时生成...`;
    totalCount.value = normalizedMissing.length;
    currentIndex.value = 0;
    currentRefno.value = '';

    let loadedObjects = 0;
    let failedRefnos: string[] = [];
    const backendMissing = new Set<string>();
    let baselineRevision = 0;
    let enqueuedAny = false;

    try {
      try {
        const version = await getParquetVersion(dbno);
        baselineRevision = Number(version.revision || 0);
      } catch (e) {
        console.warn('[model-generation] 读取 parquet 版本失败，继续执行实时加载', e);
      }

      const result = await triggerBatchGenerateSse(normalizedMissing, {
        onUpdate: (u) => {
          statusMessage.value = u.message || '';
          if (u.currentRefno) {
            currentRefno.value = normalizeRefnoString(u.currentRefno);
          }
          currentIndex.value = Math.max(0, Math.min(u.totalCount || normalizedMissing.length, u.completedCount || 0));
          if (u.stage === 'exportInstances') {
            progress.value = Math.max(95, Math.min(99, 95 + u.percent * 0.04));
          } else {
            progress.value = Math.max(60, Math.min(95, 60 + u.percent * 0.35));
          }
        },
        onBatchDone: async (u) => {
          const readyRefnos = uniqStrings(u.readyRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
          if (readyRefnos.length === 0) return;

          const loadResult = await loadGeneratedRefnos(dtxLayer, dbno, readyRefnos, anyViewer);
          loadedObjects += loadResult.loadedObjects;
          for (const missingRefno of loadResult.missingRefnos) {
            backendMissing.add(normalizeRefnoString(missingRefno));
          }

          try {
            await enqueueParquetIncremental(dbno, readyRefnos);
            enqueuedAny = true;
          } catch (e) {
            console.warn('[model-generation] parquet 增量入队失败', e);
          }
        },
        skipOnError: true,
        exportInstances: false,
        mergeInstances: false,
      });

      failedRefnos = uniqStrings(result.failedRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
      if (failedRefnos.length > 0) {
        console.warn(`[model-generation] ${failedRefnos.length} refnos failed to generate:`, failedRefnos);
      }

      if (enqueuedAny) {
        statusMessage.value = '正在轮询 parquet 版本，等待离线缓存更新...';
        const poll = await pollParquetVersionAfterEnqueue(dbno, baselineRevision);
        if (poll.updated) {
          consoleStore.addLog('info', `[model-load] parquet 版本已更新 dbno=${dbno} revision=${poll.revision}`);
        } else if (poll.error) {
          consoleStore.addLog('error', `[model-load] parquet 版本轮询未更新 dbno=${dbno} err=${poll.error}`);
        }
      }
    } catch (e) {
      console.error('[model-generation] Batch generate failed:', e);
      const msg = e instanceof Error ? e.message : String(e);
      consoleStore.addLog('error', `[model-load] 实时生成失败 dbno=${dbno} err=${msg}`);
      failedRefnos = normalizedMissing;
    } finally {
      showProgressModal.value = false;
      totalCount.value = 0;
      currentIndex.value = 0;
      currentRefno.value = '';
    }

    const mergedFailed = uniqStrings([...failedRefnos, ...Array.from(backendMissing)]);
    return { loadedObjects, failedRefnos: mergedFailed };
  }

  function checkRefnoExists(refno: string): boolean {
    if (loadedRoots.has(refno)) return true;
    const v = viewer as any;
    return !!v?.scene?.objects?.[refno];
  }

  function isModelActuallyLoaded(refno: string): boolean {
    const normalizedRoot = normalizeRefnoString(refno);
    if (!normalizedRoot) return false;
    if (loadedRoots.has(normalizedRoot)) return true;
    const anyViewer = viewer as any;
    const dtxLayer = anyViewer?.__dtxLayer;
    return !!dtxLayer?.hasObject?.(normalizedRoot);
  }

  async function showModelByRefno(refno: string, loadOptions?: { flyTo?: boolean }): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno);
    if (!normalizedRoot) return false;

    const genuinelyLoaded = loadedRoots.has(normalizedRoot);
    if (checkRefnoExists(normalizedRoot)) {
      if (loadOptions?.flyTo) {
        try {
          const anyViewer = viewer as any;
          let aabb = anyViewer?.scene?.getAABB?.([normalizedRoot]) ?? null;
          if (!aabb) {
            const { refnos } = await querySubtreeRefnos(normalizedRoot);
            if (refnos && refnos.length > 0) {
              aabb = anyViewer?.scene?.getAABB?.(refnos) ?? null;
            }
          }
          if (aabb) {
            anyViewer?.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
            consoleStore.addLog('info', `[model-load] flyTo 已加载 refno=${normalizedRoot}`);
          } else if (!genuinelyLoaded) {
            // refno 仅在 scene.objects 中有占位（来自树选择/可见性操作），
            // 但实际几何数据未加载 → 回落到下方加载路径
            const w = `[警告] 节点 ${normalizedRoot} 仅为占位、尚无几何，正在重新加载模型数据`;
            consoleStore.addLog('warning', `[model-load] refno=${normalizedRoot} 占位但无几何，回落加载`);
            emitToast({ message: w, level: 'warning' });
          } else {
            const err = `[错误] 无法定位：包围盒为空（refno=${normalizedRoot}）`;
            consoleStore.addLog('error', `[model-load] flyTo 失败：AABB 为空 refno=${normalizedRoot}`);
            emitToast({ message: err, level: 'error' });
          }
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e);
          consoleStore.addLog('error', `[model-load] flyTo 异常 refno=${normalizedRoot} err=${em}`);
          emitToast({ message: `[错误] 定位异常：${em}`, level: 'error' });
        }
      }
      if (genuinelyLoaded) return true;
      // 非 genuinelyLoaded 时检查 DTX 层是否真有几何
      const anyV = viewer as any;
      const dtxLayer = anyV?.__dtxLayer;
      if (dtxLayer?.hasObject?.(normalizedRoot)) return true;
    }

    isGenerating.value = true;
    error.value = null;
    lastLoadDebug.value = null;
    progress.value = 0;
    statusMessage.value = '准备加载模型...';
    currentRefno.value = normalizedRoot;
    totalCount.value = 1;
    currentIndex.value = 1;
    modelLoadStatus.begin({
      progress: progress.value,
      message: statusMessage.value,
      currentRefno: currentRefno.value,
    });

    try {
      const startedAt = Date.now();
      let dbno: number;
      if (typeof options.db_num === 'number') {
        dbno = options.db_num;
      } else {
        await ensureDbMetaInfoLoaded();
        dbno = getDbnumByRefno(normalizedRoot);
      }
      if (!Number.isFinite(dbno) || dbno <= 0) throw new Error('无法确定 dbno');

      statusMessage.value = '查询可见实例范围...';
      progress.value = 10;
      syncGlobalLoadStatus();
      let visibleOk = false;
      let visibleErr: string | null = null;
      let visibleRefnos: string[] = [];
      let visibleSource: 'visible-insts' | 'subtree-refnos' = 'visible-insts';
      try {
        const { refnos, source, truncated } = await queryLoadScopeRefnos(normalizedRoot);
        visibleRefnos = refnos;
        visibleSource = source;
        if (source === 'subtree-refnos' && truncated) {
          consoleStore.addLog('error', `[model-load] subtree-refnos 返回被截断 refno=${normalizedRoot}（limit=200000）`);
          emitToast({
            message: `[错误] 子孙 refno 列表过大已被截断（${normalizedRoot}），结果可能不完整`,
            level: 'error',
          });
        }

        visibleRefnos = uniqStrings(visibleRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
        visibleOk = true;
        visibleErr = null;
      } catch (e) {
        visibleOk = false;
        visibleErr = e instanceof Error ? e.message : String(e);
        visibleRefnos = [];
      }
      consoleStore.addLog(
        'info',
        `[model-load] load_scope_refnos ok=${visibleOk ? 1 : 0} source=${visibleSource} refno=${normalizedRoot} dbno=${dbno} count=${visibleRefnos.length}` +
          (visibleErr ? ` err=${visibleErr}` : '')
      );
      if (!visibleOk && visibleErr) {
        consoleStore.addLog('warning', `[model-load] 查询加载范围失败，将尝试从 Parquet 加载：${visibleErr}`);
        emitToast({
          message: `[警告] 查询加载范围失败，将尝试从 Parquet 加载：${visibleErr}`,
          level: 'warning',
        });
      } else if (visibleOk && visibleRefnos.length === 0) {
        consoleStore.addLog(
          'warning',
          `[model-load] 未查询到可见实例 refno（${normalizedRoot}），本次不再回退加载本库全部几何`
        );
        emitToast({
          message: `[警告] 未查询到可见实例 refno（${normalizedRoot}），本次不再回退加载本库全部几何`,
          level: 'warning',
        });
      }

      // ========== Parquet 优先路径（不可用时自动导出） ==========
      const parquetLoader = useDbnoInstancesParquetLoader();
      let parquetAvailable = await parquetLoader.isParquetAvailable(dbno);

      if (!parquetAvailable) {
        const exportTargets = visibleRefnos;
        parquetAvailable = await ensureParquetAvailableByAutoExport(dbno, exportTargets);
      }

      if (parquetAvailable) {
        consoleStore.addLog('info', `[model-load] 使用 Parquet 数据源 dbno=${dbno}`);
        statusMessage.value = `从 Parquet 加载 dbno=${dbno}...`;
        progress.value = 20;
        syncGlobalLoadStatus();

        const anyViewer = viewer as unknown as {
          __dtxLayer?: unknown
          __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
        };
        const dtxLayer = anyViewer.__dtxLayer as any;
        if (!dtxLayer) throw new Error('DTXLayer 未初始化，无法加载模型');

        const loadRefnos = visibleRefnos;

        if (loadRefnos.length === 0) {
          statusMessage.value = `refno=${normalizedRoot} 无可见实例`;
          progress.value = 100;
          syncGlobalLoadStatus();
          consoleStore.addLog('warning', `[model-load] refno=${normalizedRoot} 当前无可见实例，无需回退全量加载`);
          return true;
        }

        statusMessage.value = `加载 ${loadRefnos.length} 个 refno (Parquet)...`;
        progress.value = 60;
        syncGlobalLoadStatus();

        const LOAD_BATCH_SIZE = VISIBLE_REFNOS_PAGE_SIZE;
        const total = loadRefnos.length;
        const batchTotal = Math.ceil(total / LOAD_BATCH_SIZE);
        let totalLoaded = 0;
        let totalSkipped = 0;
        let totalObjects = 0;
        const missingAll: string[] = [];

        for (let start = 0; start < total; start += LOAD_BATCH_SIZE) {
          const end = Math.min(total, start + LOAD_BATCH_SIZE);
          const batch = loadRefnos.slice(start, end);
          const batchIndex = Math.floor(start / LOAD_BATCH_SIZE) + 1;
          statusMessage.value = `加载批次 ${batchIndex}/${batchTotal} (${end}/${total}) [Parquet]`;
          progress.value = Math.max(60, Math.min(95, 60 + Math.floor((end / total) * 35)));
          syncGlobalLoadStatus();

          const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, batch, {
            lodAssetKey: 'L1',
            debug: false,
            dataSource: 'parquet',
          });
          anyViewer.__dtxAfterInstancesLoaded?.(dbno, batch);
          totalLoaded += result.loadedRefnos;
          totalSkipped += result.skippedRefnos;
          totalObjects += result.loadedObjects;
          if (result.missingRefnos.length > 0) missingAll.push(...result.missingRefnos);
        }

        if (missingAll.length > 0) {
          const realtimeResult = await handleMissingRefnos(dtxLayer, dbno, uniqStrings(missingAll), anyViewer);
          totalObjects += realtimeResult.loadedObjects;
        }

        if (loadOptions?.flyTo) {
          try {
            const av = viewer as any;
            const max = 5000;
            const flyRefnos = loadRefnos.length > max ? loadRefnos.slice(0, max) : loadRefnos;
            const aabb = av?.scene?.getAABB?.(flyRefnos) ?? null;
            if (aabb) {
              av?.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
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
        };
        if (totalObjects > 0) {
          loadedRoots.add(normalizedRoot);
        }
        const noNewRefnosLoaded = totalLoaded === 0;
        statusMessage.value = totalObjects > 0 ? '加载完成 (Parquet)' : '无可见几何实例';
        progress.value = 100;
        syncGlobalLoadStatus();
        if (totalObjects === 0) {
          if (noNewRefnosLoaded) {
            consoleStore.addLog(
              'info',
              `[model-load] refno=${normalizedRoot} 本次未新增实例，已存在于场景或缓存中，跳过重复提示`
            );
          } else {
            emitToast({
              message:
                `[警告] 加载结束但未绘制任何实例（refno=${normalizedRoot}）。请检查左侧可见性（眼睛图标）或 Parquet 是否包含该范围几何`,
              level: 'warning',
            });
          }
        } else {
          emitToast({ message: `[成功] 已加载 ${totalObjects} 个几何实例`, level: 'success' });
        }
        return true;
      }

      throw new Error(`Parquet 不可用且自动导出失败 (dbno=${dbno})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      statusMessage.value = '加载失败';
      syncGlobalLoadStatus();
      emitToast({ message: `[错误] 模型加载失败：${msg}`, level: 'error' });
      return false;
    } finally {
      isGenerating.value = false;
      showProgressModal.value = false;
      modelLoadStatus.finish({
        message: statusMessage.value,
        error: error.value,
      });
    }
  }

  async function showModelByDbnum(
    dbno: number,
    loadOptions?: { flyTo?: boolean }
  ): Promise<{ loaded: boolean; instanceCount: number; refnoCount: number }> {
    isGenerating.value = true;
    error.value = null;
    lastLoadDebug.value = null;
    progress.value = 0;
    currentRefno.value = '';
    totalCount.value = 0;
    currentIndex.value = 0;
    modelLoadStatus.begin({
      progress: progress.value,
      message: '准备按 dbnum 加载模型...',
    });

    try {
      if (!Number.isFinite(dbno) || dbno <= 0) {
        throw new Error(`Invalid dbnum: ${dbno}`);
      }

      const parquetLoader = useDbnoInstancesParquetLoader();
      statusMessage.value = `Checking model files for dbnum=${dbno}...`;
      progress.value = 10;
      syncGlobalLoadStatus();

      let parquetAvailable = await parquetLoader.isParquetAvailable(dbno);
      if (!parquetAvailable) {
        parquetAvailable = await ensureParquetAvailableByAutoExport(dbno, []);
      }
      if (!parquetAvailable) {
        throw new Error(`Model files not found for dbnum=${dbno}`);
      }

      statusMessage.value = `Loading refnos for dbnum=${dbno}...`;
      progress.value = 25;
      syncGlobalLoadStatus();
      const loadRefnos = await parquetLoader.queryAllRefnosByDbno(dbno, { debug: false });
      const uniqueRefnos = uniqStrings(loadRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);

      if (uniqueRefnos.length === 0) {
        statusMessage.value = 'Model is empty (0 instances)';
        progress.value = 100;
        syncGlobalLoadStatus();
        consoleStore.addLog('warning', `[model-load] Model loaded dbno=${dbno} refno_count=0 instance_count=0`);
        emitToast({
          message: `[警告] dbno=${dbno} 的 Parquet 中没有任何 refno，无法加载模型`,
          level: 'warning',
        });
        return { loaded: true, instanceCount: 0, refnoCount: 0 };
      }

      const anyViewer = viewer as unknown as {
        __dtxLayer?: unknown
        __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
        scene?: { getAABB?: (ids: string[]) => unknown }
        cameraFlight?: { flyTo?: (options: { aabb?: unknown; duration?: number; fit?: boolean }) => void }
      };
      const dtxLayer = anyViewer.__dtxLayer as any;
      if (!dtxLayer) {
        throw new Error('DTXLayer 未初始化，无法加载模型');
      }

      totalCount.value = uniqueRefnos.length;
      currentIndex.value = 0;

      const LOAD_BATCH_SIZE = VISIBLE_REFNOS_PAGE_SIZE;
      let totalLoadedRefnos = 0;
      let totalSkippedRefnos = 0;
      let totalLoadedObjects = 0;
      const missingAll: string[] = [];

      for (let start = 0; start < uniqueRefnos.length; start += LOAD_BATCH_SIZE) {
        const end = Math.min(uniqueRefnos.length, start + LOAD_BATCH_SIZE);
        const batch = uniqueRefnos.slice(start, end);
        currentIndex.value = end;
        statusMessage.value = `Loading model batch ${Math.ceil(end / LOAD_BATCH_SIZE)}/${Math.ceil(uniqueRefnos.length / LOAD_BATCH_SIZE)}...`;
        progress.value = Math.max(35, Math.min(92, 35 + Math.floor((end / uniqueRefnos.length) * 55)));
        syncGlobalLoadStatus();

        const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, batch, {
          lodAssetKey: 'L1',
          debug: false,
          dataSource: 'parquet',
          forceReloadRefnos: batch,
        });
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, batch);
        totalLoadedRefnos += result.loadedRefnos;
        totalSkippedRefnos += result.skippedRefnos;
        totalLoadedObjects += result.loadedObjects;
        if (result.missingRefnos.length > 0) {
          missingAll.push(...result.missingRefnos);
        }
      }

      const uniqueMissing = uniqStrings(missingAll.map((r) => normalizeRefnoString(r))).filter(Boolean);
      if (uniqueMissing.length > 0) {
        const realtimeResult = await handleMissingRefnos(dtxLayer, dbno, uniqueMissing, anyViewer);
        totalLoadedObjects += realtimeResult.loadedObjects;
      }

      if (loadOptions?.flyTo) {
        try {
          const flyTargets = uniqueRefnos.length > 5000 ? uniqueRefnos.slice(0, 5000) : uniqueRefnos;
          const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
          if (aabb) {
            anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
          }
        } catch {
          // ignore flyTo errors
        }
      }

      progress.value = 100;
      statusMessage.value = totalLoadedObjects > 0 ? 'Model loaded' : 'Model is empty (0 instances)';
      syncGlobalLoadStatus();
      consoleStore.addLog(
        'info',
        `[model-load] Model loaded dbno=${dbno} refno_count=${uniqueRefnos.length} loaded_refnos=${totalLoadedRefnos} skipped_refnos=${totalSkippedRefnos} instance_count=${totalLoadedObjects}`
      );
      if (totalLoadedObjects === 0) {
        emitToast({
          message: `[警告] dbno=${dbno} 加载完成但未绘制实例（可能全部被跳过或几何缺失）`,
          level: 'warning',
        });
      } else {
        emitToast({ message: `[成功] dbno=${dbno} 已加载 ${totalLoadedObjects} 个实例`, level: 'success' });
      }
      return {
        loaded: true,
        instanceCount: totalLoadedObjects,
        refnoCount: uniqueRefnos.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      statusMessage.value = '加载失败';
      syncGlobalLoadStatus();
      emitToast({ message: `[错误] 按 dbnum 加载失败：${msg}`, level: 'error' });
      return { loaded: false, instanceCount: 0, refnoCount: 0 };
    } finally {
      isGenerating.value = false;
      showProgressModal.value = false;
      modelLoadStatus.finish({
        message: statusMessage.value,
        error: error.value,
      });
    }
  }

  async function generateAndLoadModel(refno: string): Promise<boolean> {
    // 统一入口：当前策略下“显示”即按需触发生成 instances 并加载
    return await showModelByRefno(refno);
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
    showModelByDbnum,
    showModelByRefno,
    isModelActuallyLoaded,
    checkRefnoExists,
  };
}
