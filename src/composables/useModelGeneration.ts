import { ref } from 'vue';
import type { Ref } from 'vue';

import { e3dGetSubtreeRefnos, e3dGetVisibleInsts } from '@/api/genModelE3dApi';
import { pdmsGetTypeInfo } from '@/api/genModelPdmsAttrApi';
import { enqueueParquetIncremental, getParquetVersion } from '@/api/genModelRealtimeApi';
import { modelRegenerateByRefno, modelShowByRefno } from '@/api/genModelTaskApi';
import { getModelUnitCommit } from '@/api/modelUnitVersionApi';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, tryGetDbnumByRefno } from '@/composables/useDbMetaInfo';
import { isDtxRefnoLoaded, loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader';
import {
  getDbnoInstancesManifest,
  InstancesJsonNotFoundError,
  setDbnoInstancesManifest,
  triggerBatchGenerateSse,
} from '@/composables/useDbnoInstancesJsonLoader';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { emitToast } from '@/ribbon/toastBus';
import { buildInstanceIndexByRefno, type InstanceManifest } from '@/utils/instances/instanceManifest';

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

/** URL `data_source=json|parquet|backend` 强制数据源；未指定时走默认优先级。 */
function preferredDataSourceFromUrl(): 'json' | 'parquet' | 'backend' | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = (new URLSearchParams(window.location.search).get('data_source') || '')
      .trim()
      .toLowerCase();
    if (raw === 'json' || raw === 'parquet' || raw === 'backend') return raw;
  } catch {
    // ignore
  }
  return null;
}

function isViewerDebugToastEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    const rawQuery = (q.get('viewer_debug') || q.get('debug_toast') || '').trim().toLowerCase();
    if (rawQuery === '1' || rawQuery === 'true' || rawQuery === 'yes') return true;
    const rawStorage = (window.localStorage?.getItem('plant3d-web:debug-toast') || '').trim().toLowerCase();
    return rawStorage === '1' || rawStorage === 'true' || rawStorage === 'yes';
  } catch {
    return false;
  }
}

function emitDebugWarningToast(message: string): void {
  if (!isViewerDebugToastEnabled()) return;
  emitToast({ message, level: 'warning' });
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
  componentRefnos?: { count: number; sample: string[] }
  manifestMatch?: { candidates: number; matched: number; missing: number; missingSample: string[] }
  loadRefnos: { count: number; sample: string[] }
  scopeDecision?: {
    rootNoun: string | null
    branHangRootInjected: boolean
    typeInfoError: string | null
  }
  result: { loadedRefnos: number; skippedRefnos: number; loadedObjects: number } | null
  ms: number
}

export type ActualModelLoadScope = {
  componentRefnos: string[]
  actualLoadRefnos: string[]
  rootNoun: string | null
  branHangRootInjected: boolean
  typeInfoError: string | null
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

export function mergeVersionReplacementRefnos(
  targetRefnos: string[],
  previouslyLoadedRefnos: string[],
): string[] {
  return uniqStrings(
    [...targetRefnos, ...previouslyLoadedRefnos]
      .map((refno) => normalizeRefnoString(refno))
      .filter(Boolean),
  );
}

async function prepareJsonManifestForFallback(
  dbno: number,
  rootRefno: string,
  loadRefnos: string[],
  rootNoun: string | null,
): Promise<{ ready: boolean; syntheticAabb?: number[] | null; syntheticNoun?: string | null }> {
  let manifest: InstanceManifest;

  try {
    manifest = await getDbnoInstancesManifest(dbno);
  } catch (error) {
    if (!(error instanceof InstancesJsonNotFoundError)) {
      return { ready: false };
    }
    manifest = {
      generated_at: new Date().toISOString(),
      instances: [],
    };
  }

  const wanted = new Set(loadRefnos);
  const existingIndex = buildInstanceIndexByRefno(manifest, wanted);
  const hasAnyWanted = loadRefnos.some((refno) => (existingIndex.get(refno)?.length ?? 0) > 0);
  if (hasAnyWanted || (rootNoun !== 'BRAN' && rootNoun !== 'HANG')) {
    return { ready: true };
  }

  return { ready: true };
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
    const refnos = uniqStrings(list.map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean);
    if (refnos.length > 0) {
      return { refnos, source: 'visible-insts', truncated: false };
    }
  } catch {
    // 继续使用同一 root 的受限 subtree 范围。
  }
  const subtree = await querySubtreeRefnos(normalized);
  return {
    refnos: subtree.refnos,
    source: 'subtree-refnos',
    truncated: subtree.truncated,
  };
}

export async function resolveActualModelLoadScope(
  rootRefno: string,
  componentRefnos: string[]
): Promise<ActualModelLoadScope> {
  const normalizedRoot = normalizeRefnoString(rootRefno);
  const normalizedComponents = uniqStrings(componentRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
  if (!normalizedRoot) {
    return {
      componentRefnos: normalizedComponents,
      actualLoadRefnos: normalizedComponents,
      rootNoun: null,
      branHangRootInjected: false,
      typeInfoError: null,
    };
  }

  try {
    const resp = await pdmsGetTypeInfo(normalizedRoot);
    const noun = resp.success ? String(resp.noun || '').trim().toUpperCase() : '';
    const isBranHang = noun === 'BRAN' || noun === 'HANG';
    const actualLoadRefnos = isBranHang
      ? uniqStrings([normalizedRoot, ...normalizedComponents])
      : (normalizedComponents.length > 0 ? normalizedComponents : [normalizedRoot]);

    return {
      componentRefnos: normalizedComponents,
      actualLoadRefnos,
      rootNoun: noun || null,
      branHangRootInjected: isBranHang || normalizedComponents.length === 0,
      typeInfoError: resp.success ? null : (resp.error_message || 'pdms type-info 查询失败'),
    };
  } catch (e) {
    return {
      componentRefnos: normalizedComponents,
      actualLoadRefnos: normalizedComponents.length > 0 ? normalizedComponents : [normalizedRoot],
      rootNoun: null,
      branHangRootInjected: normalizedComponents.length === 0,
      typeInfoError: e instanceof Error ? e.message : String(e),
    };
  }
}

export function useModelGeneration(options: ModelGenerationOptions): ModelGenerationState & {
  generateAndLoadModel: (refno: string) => Promise<boolean>
  showModelByDbnum: (dbno: number, options?: { flyTo?: boolean; manifestUrl?: string; replaceRefnos?: string[] }) => Promise<{ loaded: boolean; instanceCount: number; refnoCount: number; refnos: string[] }>
  showModelByRefno: (refno: string, options?: { flyTo?: boolean; regenerate?: boolean }) => Promise<boolean>
  showModelUnitVersion: (unitRefno: string, dbno: number, sesno: number, options?: { flyTo?: boolean }) => Promise<boolean>
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
  const loadedUnitVersionRefnos = new Map<string, string[]>();
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
    const dbno = tryGetDbnumByRefno(normalizedRoot);
    if (dbno != null && isDtxRefnoLoaded(dbno, normalizedRoot)) return true;
    const anyViewer = viewer as any;
    const dtxLayer = anyViewer?.__dtxLayer;
    return !!dtxLayer?.hasObject?.(normalizedRoot);
  }

  async function showModelByRefno(
    refno: string,
    loadOptions?: { flyTo?: boolean; regenerate?: boolean }
  ): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno);
    if (!normalizedRoot) return false;

    const genuinelyLoaded = loadedRoots.has(normalizedRoot);
    if (!loadOptions?.regenerate && checkRefnoExists(normalizedRoot)) {
      if (loadOptions?.flyTo) {
        try {
          const anyViewer = viewer as any;
          let aabb = anyViewer?.scene?.getAABB?.([normalizedRoot]) ?? null;
          if (!aabb) {
            try {
              const { refnos } = await querySubtreeRefnos(normalizedRoot);
              if (refnos && refnos.length > 0) {
                aabb = anyViewer?.scene?.getAABB?.(refnos) ?? null;
              }
            } catch (subtreeError) {
              consoleStore.addLog(
                'warning',
                `[model-load] flyTo 子树范围查询失败，继续尝试模型加载 refno=${normalizedRoot} err=${subtreeError instanceof Error ? subtreeError.message : String(subtreeError)}`
              );
            }
          }
          if (aabb) {
            anyViewer?.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
            consoleStore.addLog('info', `[model-load] flyTo 已加载 refno=${normalizedRoot}`);
          } else if (!genuinelyLoaded) {
            // refno 仅在 scene.objects 中有占位（来自树选择/可见性操作），
            // 但实际几何数据未加载 → 回落到下方加载路径
            consoleStore.addLog(
              'info',
              `[model-load] refno=${normalizedRoot} 命中占位节点，转入真实模型加载`
            );
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
        const mappedDbno = tryGetDbnumByRefno(normalizedRoot);
        if (mappedDbno == null) {
          statusMessage.value = `refno=${normalizedRoot} 不在当前项目模型库映射中`;
          progress.value = 100;
          syncGlobalLoadStatus();
          consoleStore.addLog(
            'warning',
            `[model-load] 跳过不可加载节点 refno=${normalizedRoot}：db_meta_info.json 未包含该 ref0，通常表示它不是当前部署模型库中的可绘制实例`
          );
          emitToast({
            message: `[提示] 当前节点不在已部署模型库映射中，未触发模型加载（refno=${normalizedRoot}）`,
            level: 'info',
          });
          return false;
        }
        dbno = mappedDbno;
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

      const loadScope = await resolveActualModelLoadScope(normalizedRoot, visibleRefnos);
      if (loadScope.typeInfoError) {
        consoleStore.addLog(
          'warning',
          `[model-load] root type-info 查询失败，沿用 component scope refno=${normalizedRoot} err=${loadScope.typeInfoError}`
        );
      }
      consoleStore.addLog(
        'info',
        `[model-load] resolved_load_scope refno=${normalizedRoot} dbno=${dbno} component_count=${loadScope.componentRefnos.length} actual_load_count=${loadScope.actualLoadRefnos.length} bran_hang_root_injected=${loadScope.branHangRootInjected ? 1 : 0}` +
          (loadScope.rootNoun ? ` root_noun=${loadScope.rootNoun}` : '')
      );

      const anyViewer = viewer as unknown as {
        __dtxLayer?: unknown
        __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
        scene?: {
          ensureRefnos?: (ids: string[], options?: { computeAabb?: boolean }) => void
          getAABB?: (ids: string[]) => unknown
        }
        cameraFlight?: { flyTo?: (options: { aabb?: unknown; duration?: number; fit?: boolean }) => void }
      };
      const dtxLayer = anyViewer.__dtxLayer as any;
      if (!dtxLayer) throw new Error('DTXLayer 未初始化，无法加载模型');

      if (loadScope.actualLoadRefnos.length === 0) {
        statusMessage.value = `refno=${normalizedRoot} 无可见实例`;
        progress.value = 100;
        syncGlobalLoadStatus();
        consoleStore.addLog('warning', `[model-load] refno=${normalizedRoot} 当前无可见实例，无需回退全量加载`);
        return true;
      }

      if (loadOptions?.regenerate) {
        statusMessage.value = `正在重新生成 ${normalizedRoot}...`;
        progress.value = 20;
        showProgressModal.value = true;
        syncGlobalLoadStatus();
        consoleStore.addLog(
          'info',
          `[model-regen] start root=${normalizedRoot} dbno=${dbno} component_count=${loadScope.actualLoadRefnos.length}`
        );

        const regen = await modelRegenerateByRefno({
          refnos: [toBackendRefno(normalizedRoot)],
          db_num: dbno,
          gen_parquet: false,
        });
        if (!regen?.success) {
          throw new Error(regen?.message || `模型重新生成失败：${normalizedRoot}`);
        }

        statusMessage.value = '重新生成完成，正在替换场景模型...';
        progress.value = 80;
        syncGlobalLoadStatus();
        const regeneratedRefnos = loadScope.actualLoadRefnos;
        const regenerated = await loadDbnoInstancesForVisibleRefnosDtx(
          dtxLayer,
          dbno,
          regeneratedRefnos,
          {
            lodAssetKey: 'L1',
            debug: false,
            dataSource: 'backend',
            forceReloadRefnos: regeneratedRefnos,
            replaceExistingObjects: true,
            forceRefreshGeometries: true,
          }
        );
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, regeneratedRefnos);
        if (regenerated.loadedObjects <= 0) {
          throw new Error(`重新生成完成，但后端未返回可绘制实例：${normalizedRoot}`);
        }

        loadedRoots.add(normalizedRoot);
        progress.value = 100;
        statusMessage.value = `重新生成完成（${regenerated.loadedObjects} 个几何实例）`;
        syncGlobalLoadStatus();
        if (loadOptions.flyTo) {
          const aabb = anyViewer.scene?.getAABB?.(regeneratedRefnos) ?? null;
          if (aabb) anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
        }
        consoleStore.addLog(
          'info',
          `[model-regen] done root=${normalizedRoot} dbno=${dbno} loaded_objects=${regenerated.loadedObjects}`
        );
        emitToast({ message: `[成功] ${normalizedRoot} 已重新生成并替换`, level: 'success' });
        return true;
      }

      try {
        const loadRefnos = loadScope.actualLoadRefnos;
        statusMessage.value = `从后端实时数据加载 dbno=${dbno}...`;
        progress.value = 20;
        syncGlobalLoadStatus();

        const backendResult = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, loadRefnos, {
          lodAssetKey: 'L1',
          debug: false,
          dataSource: 'backend',
          forceReloadRefnos: loadRefnos,
        });
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, loadRefnos);

        if (typeof anyViewer.scene?.ensureRefnos === 'function') {
          anyViewer.scene.ensureRefnos(loadRefnos, { computeAabb: false });
        }

        if (loadOptions?.flyTo) {
          try {
            const flyTargets = loadRefnos.length > 5000 ? loadRefnos.slice(0, 5000) : loadRefnos;
            const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
            if (aabb) {
              anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
            }
          } catch {
            // ignore flyTo errors
          }
        }

        lastLoadDebug.value = {
          refno: normalizedRoot,
          dbno,
          visibleInsts: { ok: visibleOk, count: visibleRefnos.length, error: visibleErr },
          componentRefnos: { count: loadScope.componentRefnos.length, sample: loadScope.componentRefnos.slice(0, 10) },
          loadRefnos: { count: loadRefnos.length, sample: loadRefnos.slice(0, 10) },
          scopeDecision: {
            rootNoun: loadScope.rootNoun,
            branHangRootInjected: loadScope.branHangRootInjected,
            typeInfoError: loadScope.typeInfoError,
          },
          result: {
            loadedRefnos: backendResult.loadedRefnos,
            skippedRefnos: backendResult.skippedRefnos,
            loadedObjects: backendResult.loadedObjects,
          },
          ms: Date.now() - startedAt,
        };

        if (backendResult.loadedObjects > 0) {
          loadedRoots.add(normalizedRoot);
          statusMessage.value = '加载完成 (Backend)';
          progress.value = 100;
          syncGlobalLoadStatus();
          emitToast({ message: `[成功] 已通过后端实时数据加载 ${backendResult.loadedObjects} 个几何实例`, level: 'success' });
          return true;
        }

        consoleStore.addLog(
          'warning',
          `[model-load] 后端实时数据未返回可绘制实例 refno=${normalizedRoot} dbno=${dbno}，继续尝试 Parquet/JSON`
        );
      } catch (backendError) {
        consoleStore.addLog(
          'warning',
          `[model-load] 后端实时加载失败，继续尝试 Parquet/JSON dbno=${dbno} err=${backendError instanceof Error ? backendError.message : String(backendError)}`
        );
      }

      // ========== Parquet 优先路径（不可用时自动导出） ==========
      // URL data_source=json 时跳过 parquet，直接用已修复的 instances JSON
      const forcedSource = preferredDataSourceFromUrl();
      const parquetLoader = useDbnoInstancesParquetLoader();
      let parquetAvailable =
        forcedSource === 'json' || forcedSource === 'backend'
          ? false
          : await parquetLoader.isParquetAvailable(dbno);

      if (!parquetAvailable && forcedSource !== 'json' && forcedSource !== 'backend') {
        const exportTargets = loadScope.actualLoadRefnos;
        parquetAvailable = await ensureParquetAvailableByAutoExport(dbno, exportTargets);
      }

      if (parquetAvailable) {
        consoleStore.addLog('info', `[model-load] 使用 Parquet 数据源 dbno=${dbno}`);
        statusMessage.value = `从 Parquet 加载 dbno=${dbno}...`;
        progress.value = 20;
        syncGlobalLoadStatus();

        const loadRefnos = loadScope.actualLoadRefnos;

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
          componentRefnos: { count: loadScope.componentRefnos.length, sample: loadScope.componentRefnos.slice(0, 10) },
          loadRefnos: { count: loadRefnos.length, sample: loadRefnos.slice(0, 10) },
          scopeDecision: {
            rootNoun: loadScope.rootNoun,
            branHangRootInjected: loadScope.branHangRootInjected,
            typeInfoError: loadScope.typeInfoError,
          },
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
            const message = `[警告] 加载结束但未绘制任何实例（refno=${normalizedRoot}）。请检查左侧可见性（眼睛图标）或 Parquet 是否包含该范围几何`;
            consoleStore.addLog('warning', `[model-load] ${message}`);
          }
        } else {
          emitToast({ message: `[成功] 已加载 ${totalObjects} 个几何实例`, level: 'success' });
        }
        return true;
      }

      const loadRefnos = loadScope.actualLoadRefnos;

      if (AUTO_GENERATION_ENABLED) {
        try {
          statusMessage.value = `从后端实时数据加载 dbno=${dbno}...`;
          progress.value = 20;
          syncGlobalLoadStatus();

          const backendResult = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, loadRefnos, {
            lodAssetKey: 'L1',
            debug: false,
            dataSource: 'backend',
            forceReloadRefnos: loadRefnos,
          });
          anyViewer.__dtxAfterInstancesLoaded?.(dbno, loadRefnos);

          if (typeof anyViewer.scene?.ensureRefnos === 'function') {
            anyViewer.scene.ensureRefnos(loadRefnos, { computeAabb: false });
          }

          if (loadOptions?.flyTo) {
            try {
              const flyTargets = loadRefnos.length > 5000 ? loadRefnos.slice(0, 5000) : loadRefnos;
              const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
              if (aabb) {
                anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
              }
            } catch {
              // ignore flyTo errors
            }
          }

          lastLoadDebug.value = {
            refno: normalizedRoot,
            dbno,
            visibleInsts: { ok: visibleOk, count: visibleRefnos.length, error: visibleErr },
            componentRefnos: { count: loadScope.componentRefnos.length, sample: loadScope.componentRefnos.slice(0, 10) },
            loadRefnos: { count: loadRefnos.length, sample: loadRefnos.slice(0, 10) },
            scopeDecision: {
              rootNoun: loadScope.rootNoun,
              branHangRootInjected: loadScope.branHangRootInjected,
              typeInfoError: loadScope.typeInfoError,
            },
            result: {
              loadedRefnos: backendResult.loadedRefnos,
              skippedRefnos: backendResult.skippedRefnos,
              loadedObjects: backendResult.loadedObjects,
            },
            ms: Date.now() - startedAt,
          };

          if (backendResult.loadedObjects > 0) {
            loadedRoots.add(normalizedRoot);
            statusMessage.value = '加载完成 (Backend)';
            progress.value = 100;
            syncGlobalLoadStatus();
            emitToast({ message: `[成功] 已通过后端实时数据加载 ${backendResult.loadedObjects} 个几何实例`, level: 'success' });
            return true;
          }

          consoleStore.addLog(
            'warning',
            `[model-load] 后端实时数据未返回可绘制实例 refno=${normalizedRoot} dbno=${dbno}`
          );
        } catch (backendError) {
          consoleStore.addLog(
            'warning',
            `[model-load] 后端实时加载失败，继续尝试 JSON fallback dbno=${dbno} err=${backendError instanceof Error ? backendError.message : String(backendError)}`
          );
        }
      }

      const jsonFallback = await prepareJsonManifestForFallback(
        dbno,
        normalizedRoot,
        loadRefnos,
        loadScope.rootNoun,
      );
      if (jsonFallback.ready) {
        consoleStore.addLog('warning', `[model-load] parquet 不可用，回退 instances JSON dbno=${dbno}`);
        statusMessage.value = `从 instances JSON 加载 dbno=${dbno}...`;
        progress.value = 20;
        syncGlobalLoadStatus();

        const jsonResult = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, loadRefnos, {
          lodAssetKey: 'L1',
          debug: false,
          dataSource: 'json',
          forceReloadRefnos: loadRefnos,
        });
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, loadRefnos);

        if (typeof anyViewer.scene?.ensureRefnos === 'function') {
          anyViewer.scene.ensureRefnos(loadRefnos, { computeAabb: false });
        }
        if (jsonFallback.syntheticAabb && anyViewer.scene?.objects?.[normalizedRoot]) {
          (anyViewer.scene.objects[normalizedRoot] as { aabb?: number[]; noun?: string }).aabb = jsonFallback.syntheticAabb;
          if (jsonFallback.syntheticNoun) {
            (anyViewer.scene.objects[normalizedRoot] as { aabb?: number[]; noun?: string }).noun = jsonFallback.syntheticNoun;
          }
        }

        if (loadOptions?.flyTo) {
          try {
            const flyTargets = loadRefnos.length > 5000 ? loadRefnos.slice(0, 5000) : loadRefnos;
            const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
            if (aabb) {
              anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
            }
          } catch {
            // ignore flyTo errors
          }
        }

        lastLoadDebug.value = {
          refno: normalizedRoot,
          dbno,
          visibleInsts: { ok: visibleOk, count: visibleRefnos.length, error: visibleErr },
          componentRefnos: { count: loadScope.componentRefnos.length, sample: loadScope.componentRefnos.slice(0, 10) },
          loadRefnos: { count: loadRefnos.length, sample: loadRefnos.slice(0, 10) },
          scopeDecision: {
            rootNoun: loadScope.rootNoun,
            branHangRootInjected: loadScope.branHangRootInjected,
            typeInfoError: loadScope.typeInfoError,
          },
          result: {
            loadedRefnos: jsonResult.loadedRefnos,
            skippedRefnos: jsonResult.skippedRefnos,
            loadedObjects: jsonResult.loadedObjects,
          },
          ms: Date.now() - startedAt,
        };

        if (jsonResult.loadedObjects > 0) {
          loadedRoots.add(normalizedRoot);
        }

        statusMessage.value = jsonResult.loadedObjects > 0 ? '加载完成 (JSON)' : '无可见几何实例';
        progress.value = 100;
        syncGlobalLoadStatus();
        if (jsonResult.loadedObjects === 0) {
          const message = `[警告] JSON fallback 已执行，但未绘制任何实例（refno=${normalizedRoot}）。请检查 instances_*.json 或 MBD 语义数据`;
          consoleStore.addLog('warning', `[model-load] ${message}`);
          emitDebugWarningToast(message);
        } else {
          emitToast({ message: `[成功] 已通过 JSON fallback 加载 ${jsonResult.loadedObjects} 个几何实例`, level: 'success' });
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
    loadOptions?: { flyTo?: boolean; manifestUrl?: string; replaceRefnos?: string[] }
  ): Promise<{ loaded: boolean; instanceCount: number; refnoCount: number; refnos: string[] }> {
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

      if (!loadOptions?.manifestUrl) {
        let parquetAvailable = await parquetLoader.isParquetAvailable(dbno);
        if (!parquetAvailable) {
          parquetAvailable = await ensureParquetAvailableByAutoExport(dbno, []);
        }
        if (!parquetAvailable) {
          throw new Error(`Model files not found for dbnum=${dbno}`);
        }
      }

      statusMessage.value = `Loading refnos for dbnum=${dbno}...`;
      progress.value = 25;
      syncGlobalLoadStatus();
      const loadRefnos = await parquetLoader.queryAllRefnosByDbno(dbno, {
        debug: false,
        manifestUrl: loadOptions?.manifestUrl,
      });
      const uniqueRefnos = uniqStrings(loadRefnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
      const requestRefnos = loadOptions?.manifestUrl
        ? mergeVersionReplacementRefnos(uniqueRefnos, loadOptions.replaceRefnos ?? [])
        : uniqueRefnos;

      if (uniqueRefnos.length === 0) {
        statusMessage.value = 'Model is empty (0 instances)';
        progress.value = 100;
        syncGlobalLoadStatus();
        const message = `[警告] dbno=${dbno} 的 Parquet 中没有任何 refno，无法加载模型`;
        consoleStore.addLog('warning', `[model-load] ${message}`);
        emitDebugWarningToast(message);
        return { loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] };
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

      totalCount.value = requestRefnos.length;
      currentIndex.value = 0;

      const LOAD_BATCH_SIZE = VISIBLE_REFNOS_PAGE_SIZE;
      let totalLoadedRefnos = 0;
      let totalSkippedRefnos = 0;
      let totalLoadedObjects = 0;
      const missingAll: string[] = [];

      for (let start = 0; start < requestRefnos.length; start += LOAD_BATCH_SIZE) {
        const end = Math.min(requestRefnos.length, start + LOAD_BATCH_SIZE);
        const batch = requestRefnos.slice(start, end);
        currentIndex.value = end;
        statusMessage.value = `Loading model batch ${Math.ceil(end / LOAD_BATCH_SIZE)}/${Math.ceil(requestRefnos.length / LOAD_BATCH_SIZE)}...`;
        progress.value = Math.max(35, Math.min(92, 35 + Math.floor((end / requestRefnos.length) * 55)));
        syncGlobalLoadStatus();

        const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, batch, {
          lodAssetKey: 'L1',
          debug: false,
          dataSource: 'parquet',
          forceReloadRefnos: batch,
          replaceExistingObjects: !!loadOptions?.manifestUrl,
          // 单元 manifest 已包含 root 与全部成员；按 refno 逐项加载时关闭 owner 扩展，
          // 避免同一 TUBI 同时命中 BRAN root 和 leave refno 而重复绘制。
          includeOwnedTubings: loadOptions?.manifestUrl ? false : undefined,
          parquetManifestUrl: loadOptions?.manifestUrl,
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
      if (uniqueMissing.length > 0 && !loadOptions?.manifestUrl) {
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
        refnos: uniqueRefnos,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      statusMessage.value = '加载失败';
      syncGlobalLoadStatus();
      emitToast({ message: `[错误] 按 dbnum 加载失败：${msg}`, level: 'error' });
      return { loaded: false, instanceCount: 0, refnoCount: 0, refnos: [] };
    } finally {
      isGenerating.value = false;
      showProgressModal.value = false;
      modelLoadStatus.finish({
        message: statusMessage.value,
        error: error.value,
      });
    }
  }

  async function showModelUnitVersion(
    unitRefno: string,
    dbno: number,
    sesno: number,
    loadOptions?: { flyTo?: boolean },
  ): Promise<boolean> {
    const normalized = normalizeRefnoString(unitRefno);
    const unitKey = `${dbno}|${normalized}`;
    try {
      const version = await getModelUnitCommit(dbno, normalized, sesno);
      const result = await showModelByDbnum(dbno, {
        flyTo: loadOptions?.flyTo,
        manifestUrl: version.manifest_url,
        replaceRefnos: loadedUnitVersionRefnos.get(unitKey) ?? [],
      });
      if (result.loaded) {
        loadedRoots.add(normalized);
        loadedUnitVersionRefnos.set(unitKey, result.refnos);
        consoleStore.addLog(
          'info',
          `[model-load] unit version loaded dbno=${dbno} unit_refno=${normalized} sesno=${sesno} artifact_sesno=${version.commit.artifact_sesno}`,
        );
      }
      return result.loaded;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      error.value = message;
      emitToast({ message: `[错误] 模型版本加载失败：${message}`, level: 'error' });
      return false;
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
    showModelUnitVersion,
    isModelActuallyLoaded,
    checkRefnoExists,
  };
}
