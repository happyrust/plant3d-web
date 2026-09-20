import { ref } from 'vue';
import type { Ref } from 'vue';

import type { VisibleInstsIncomplete, VisibleInstsResponse } from '@/api/genModelE3dTypes';

import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, tryGetDbnumByRefno } from '@/composables/useDbMetaInfo';
import { isDtxRefnoLoaded, loadDbnoInstancesForVisibleRefnosDtx } from '@/composables/useDbnoInstancesDtxLoader';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { getGenModelV1ModelSource, getModelSource, subscribeModelSourceProgress, type GenModelV1ModelSource } from '@/model-source';
import { emitToast } from '@/ribbon/toastBus';

/**
 * 全局开关：是否显式启用自动生成
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

/** `?show_dbnum_full=1`：整库入口不做「安全概览」预算，全量装。 */
function isShowDbnumFullRequested(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('show_dbnum_full') === '1';
  } catch {
    return false;
  }
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

/** `showModelByDbnum` 的结果；`budgetLimited` 只有 gen-model-v1 整库撞到安全预算时为 true。 */
export type ShowModelByDbnumResult = {
  loaded: boolean
  instanceCount: number
  refnoCount: number
  refnos: string[]
  budgetLimited?: boolean
}

function normalizeRefnoString(refno: string): string {
  return String(refno || '').trim().replace('/', '_');
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

  // 约定：后端返回“子孙可见 refnos”（此处用 subtree-refnos 承接）；经数据源端口取数（plan 2026-09-06 P3-f）
  const resp = await getModelSource().tree.subtreeRefnos(normalized, { includeSelf: true, limit: 200_000 });
  if (!resp.success) {
    throw new Error(resp.error_message || 'e3d subtree-refnos 查询失败');
  }
  const list = Array.isArray(resp.refnos) ? resp.refnos : [];
  const out = uniqStrings(list.map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean);
  return { refnos: out, truncated: !!resp.truncated };
}

/** `visibleInsts` 的收集明细归一成 `a_b`；三项都空 = 收齐 = `null`。 */
function normalizeVisibleInstsIncomplete(raw: VisibleInstsResponse['incomplete']): VisibleInstsIncomplete | null {
  if (!raw) return null;
  const pending = uniqStrings((raw.pending ?? []).map((r) => normalizeRefnoString(String(r || ''))));
  const truncated = uniqStrings((raw.truncated_roots ?? []).map((r) => normalizeRefnoString(String(r || ''))));
  const errors: Record<string, string> = {};
  for (const [root, message] of Object.entries(raw.errors ?? {})) {
    const key = normalizeRefnoString(root);
    if (key) errors[key] = String(message ?? '');
  }
  if (pending.length === 0 && truncated.length === 0 && Object.keys(errors).length === 0) return null;
  return { pending, truncated_roots: truncated, errors };
}

/** 「生成中 2 根、预算外未取 1 根、出错 1 根」——给状态栏 / toast / 日志用。 */
export function describeVisibleInstsIncomplete(incomplete: VisibleInstsIncomplete): string {
  const failed = Object.keys(incomplete.errors).length;
  return [
    incomplete.pending.length ? `生成中 ${incomplete.pending.length} 根` : '',
    incomplete.truncated_roots.length ? `预算外未取 ${incomplete.truncated_roots.length} 根` : '',
    failed ? `出错 ${failed} 根` : '',
  ].filter(Boolean).join('、');
}

export async function queryLoadScopeRefnos(refno: string): Promise<{
  refnos: string[]
  source: 'visible-insts' | 'subtree-refnos'
  truncated: boolean
  /**
   * gen-model-v1：visibleInsts 那次 ensure → records 没收齐的明细（pending / 截断 / 出错的根）；legacy 与收齐时为 `null`。
   * 退到 subtree-refnos 时照样带着——范围虽换了来源，「这个节点还没生成完」这件事没变。
   */
  incomplete: VisibleInstsIncomplete | null
}> {
  const normalized = normalizeRefnoString(refno);
  if (!normalized) {
    return { refnos: [], source: 'visible-insts', truncated: false, incomplete: null };
  }

  let incomplete: VisibleInstsIncomplete | null = null;
  try {
    const resp = await getModelSource().tree.visibleInsts(normalized);
    if (!resp.success) {
      throw new Error(resp.error_message || 'e3d visible-insts 查询失败');
    }
    incomplete = normalizeVisibleInstsIncomplete(resp.incomplete);
    const list = Array.isArray(resp.refnos) ? resp.refnos : [];
    const refnos = uniqStrings(list.map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean);
    if (refnos.length > 0) {
      return { refnos, source: 'visible-insts', truncated: false, incomplete };
    }
  } catch {
    // 继续使用同一 root 的受限 subtree 范围。
  }
  const subtree = await querySubtreeRefnos(normalized);
  return {
    refnos: subtree.refnos,
    source: 'subtree-refnos',
    truncated: subtree.truncated,
    incomplete,
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
    const resp = await getModelSource().attributes.typeInfo(normalizedRoot);
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
  showModelByDbnum: (dbno: number, options?: { flyTo?: boolean }) => Promise<ShowModelByDbnumResult>
  showModelByRefno: (refno: string, options?: { flyTo?: boolean; regenerate?: boolean }) => Promise<boolean>
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

  type GenModelV1LoadTotals = {
    loadedRefnos: number
    skippedRefnos: number
    loadedObjects: number
    /** 画成告警色的无效直管（gen-model `is_invalid_tubi`） */
    invalidTubi: number
    mesh404: number
    noGeo: number
  }

  /**
   * gen-model-v1：把记录源缓存里的构件装进 DTX。超过一页（`VISIBLE_REFNOS_PAGE_SIZE`）就分批，进度在 `progressRange` 里走，
   * 每批之间让出一帧（P3-c 分批 + 进度）。`replace`（重生成 / 重载）**不分批**：它要 forceRefresh，分了批每一批都会把同一个根
   * 再 ensure 一遍（重生成还会再提交一次生成）。
   */
  async function loadGenModelV1Refnos(
    dtxLayer: any,
    dbno: number,
    refnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void },
    mode: { regenerate: boolean; replace: boolean },
    progressRange: [number, number],
    label: string,
  ): Promise<GenModelV1LoadTotals> {
    const totals: GenModelV1LoadTotals = { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, invalidTubi: 0, mesh404: 0, noGeo: 0 };
    const batchSize = mode.replace ? Math.max(1, refnos.length) : VISIBLE_REFNOS_PAGE_SIZE;
    const batches = Math.max(1, Math.ceil(refnos.length / batchSize));
    for (let index = 0; index < batches; index++) {
      const batch = refnos.slice(index * batchSize, (index + 1) * batchSize);
      if (batches > 1) {
        totalCount.value = refnos.length;
        currentIndex.value = Math.min(refnos.length, (index + 1) * batchSize);
        currentRefno.value = '';
        statusMessage.value = `${label}：装入第 ${index + 1}/${batches} 批（${currentIndex.value}/${refnos.length} 个 refno）...`;
        progress.value = progressRange[0] + Math.floor((index / batches) * (progressRange[1] - progressRange[0]));
        syncGlobalLoadStatus();
      }
      const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, batch, {
        lodAssetKey: 'L1',
        debug: false,
        dataSource: 'gen-model-v1',
        forceRegenerate: mode.regenerate,
        forceReloadRefnos: mode.replace ? batch : undefined,
        replaceExistingObjects: mode.replace,
        forceRefreshGeometries: mode.replace,
      });
      anyViewer.__dtxAfterInstancesLoaded?.(dbno, batch);
      totals.loadedRefnos += result.loadedRefnos;
      totals.skippedRefnos += result.skippedRefnos;
      totals.loadedObjects += result.loadedObjects;
      totals.invalidTubi += result.invalidTubiObjects ?? 0;
      totals.mesh404 += result.missingBreakdown.mesh404Refnos.length;
      totals.noGeo += result.missingBreakdown.noGeoRowsRefnos.length;
      if (index + 1 < batches) await sleep(0);
    }
    return totals;
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
    loadOptions?: {
      flyTo?: boolean
      regenerate?: boolean
    }
  ): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno);
    if (!normalizedRoot) return false;

    const genuinelyLoaded = loadedRoots.has(normalizedRoot);
    if (!loadOptions?.regenerate && checkRefnoExists(normalizedRoot)) {
      if (loadOptions?.flyTo) {
        try {
          const anyViewer = viewer as any;
          let aabb = anyViewer?.scene?.getAABB?.([normalizedRoot]) ?? null;
          // gen-model-v1 下子树 refno 集是逐节点 BFS（一个 ZONE 几百次请求），而这里只是给「已加载的东西」飞一下；
          // 不是真加载过的（树占位）直接落到下面的加载路，加载完自会 flyTo。
          const subtreeLookupWorthIt = genuinelyLoaded;
          if (!aabb && subtreeLookupWorthIt) {
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

    // gen-model-v1（P3-c）：范围查询里 visibleInsts 那次 ensure → records 的逐根进度只能从记录源听；
    // 容器（SITE / ZONE）展开出多根时把进度弹窗挂出来，单根 BRAN 不弹。legacy 下这是个空订阅。
    const unsubscribeProgress = subscribeModelSourceProgress(({ done, total, root }) => {
      totalCount.value = total;
      currentIndex.value = Math.min(total, done + 1);
      currentRefno.value = root;
      statusMessage.value = `gen-model 生成 / 取回记录：${done}/${total} 个生成根`;
      progress.value = 10 + Math.floor((done / Math.max(1, total)) * 20);
      if (total > 1) showProgressModal.value = true;
      syncGlobalLoadStatus();
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
      // gen-model-v1：这次 ensure → records 有没有收齐。没收齐的节点**不能**进 loadedRoots（B1）：下一次普通显示要能补齐
      let scopeIncomplete: VisibleInstsIncomplete | null = null;
      try {
        const { refnos, source, truncated, incomplete } = await queryLoadScopeRefnos(normalizedRoot);
        visibleRefnos = refnos;
        visibleSource = source;
        scopeIncomplete = incomplete;
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
      const incompleteTail = scopeIncomplete ? describeVisibleInstsIncomplete(scopeIncomplete) : '';
      consoleStore.addLog(
        'info',
        `[model-load] load_scope_refnos ok=${visibleOk ? 1 : 0} source=${visibleSource} refno=${normalizedRoot} dbno=${dbno} count=${visibleRefnos.length}` +
          (scopeIncomplete ? ` incomplete=${incompleteTail}` : '') +
          (visibleErr ? ` err=${visibleErr}` : '')
      );
      if (!visibleOk && visibleErr) {
        consoleStore.addLog('warning', `[model-load] 查询加载范围失败：${visibleErr}`);
        emitToast({
          message: `[警告] 查询加载范围失败：${visibleErr}`,
          level: 'warning',
        });
      } else if (visibleOk && visibleRefnos.length === 0 && scopeIncomplete) {
        // 一个构件都没取到，但不是「没有」：根还在生成 / 出错 / 预算外——别说成「未查询到可见实例」
        consoleStore.addLog('warning', `[model-load] refno=${normalizedRoot} 尚未取得可见实例：${incompleteTail}`);
        emitToast({ message: `[提示] ${normalizedRoot} 尚未取得可见实例（${incompleteTail}），稍后再显示一次`, level: 'warning' });
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
        // 收集没完成而一个构件都没有（根全在生成中）：不是「无可见实例」，也不算显示成功——节点不进 loadedRoots，下次再问
        statusMessage.value = scopeIncomplete
          ? `refno=${normalizedRoot} 模型尚未就绪（${incompleteTail}）`
          : `refno=${normalizedRoot} 无可见实例`;
        progress.value = 100;
        syncGlobalLoadStatus();
        consoleStore.addLog(
          'warning',
          scopeIncomplete
            ? `[model-load] refno=${normalizedRoot} 收集未完成（${incompleteTail}），本次没有可装入的构件`
            : `[model-load] refno=${normalizedRoot} 当前无可见实例，无需回退全量加载`,
        );
        return !scopeIncomplete;
      }

      // ========== gen-model-v1（plan 2026-09-06 P3-f）==========
      // 显式显示 = ensure(force=false) → records（D5-A），已在 visibleInsts 里做过一遍并进了记录缓存，这里只是把
      // 缓存里的实例装进 DTX；重生成 = ensure(force=true)。（旧后端的 realtime / parquet / SSE 那几条路 2026-09-20 随 legacy 删除。）
      const loadRefnos = loadScope.actualLoadRefnos;
      // regenerate（人要求重算）= ensure(force=true) 并替换场景里的旧对象。前端只吃自己 ensure 出来的数据，
      // 没有「服务端替你重算了、这里被动重载」这一路（2026-09-09 用户口径，收口计划 §12）。
      const regenerate = loadOptions?.regenerate === true;
      statusMessage.value = regenerate
        ? `正在重新生成 ${normalizedRoot}（gen-model）...`
        : `从 gen-model 加载 ${loadRefnos.length} 个 refno...`;
      progress.value = 30;
      syncGlobalLoadStatus();
      const v1Result = await loadGenModelV1Refnos(
        dtxLayer,
        dbno,
        loadRefnos,
        anyViewer,
        { regenerate, replace: regenerate },
        [30, 95],
        `从 gen-model 加载 ${normalizedRoot}`,
      );
      if (typeof anyViewer.scene?.ensureRefnos === 'function') {
        anyViewer.scene.ensureRefnos(loadRefnos, { computeAabb: false });
      }
      if (loadOptions?.flyTo) {
        try {
          const flyTargets = loadRefnos.length > 5000 ? loadRefnos.slice(0, 5000) : loadRefnos;
          const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
          if (aabb) anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
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
          loadedRefnos: v1Result.loadedRefnos,
          skippedRefnos: v1Result.skippedRefnos,
          loadedObjects: v1Result.loadedObjects,
        },
        ms: Date.now() - startedAt,
      };
      const mesh404 = v1Result.mesh404;
      const noGeo = v1Result.noGeo;
      consoleStore.addLog(
        'info',
        `[model-load] gen-model-v1 root=${normalizedRoot} dbno=${dbno} loaded_refnos=${v1Result.loadedRefnos} skipped=${v1Result.skippedRefnos} objects=${v1Result.loadedObjects} invalid_tubi=${v1Result.invalidTubi} mesh404=${mesh404} no_geo=${noGeo} ms=${Date.now() - startedAt}`
      );
      if (v1Result.invalidTubi > 0) {
        consoleStore.addLog('warning', `[model-load] refno=${normalizedRoot} 有 ${v1Result.invalidTubi} 段无效直管（is_invalid_tubi），已画成告警色`);
      }
      progress.value = 100;
      // 收集没完成（有根 pending / 预算外 / 出错）：已取得的构件照画，但这个节点**不**记进 loadedRoots——
      // 记了就会被 genuinelyLoaded 短路，恰好恢复的那几根永远补不上。记录源那边同样不备忘未收齐的结果，
      // 下一次普通显示会重新 ensure → records 把剩下的根补齐（B1）。
      const collectionIncomplete = scopeIncomplete !== null;
      if (v1Result.loadedObjects > 0) {
        if (collectionIncomplete) {
          statusMessage.value = regenerate ? `重新生成部分完成 (gen-model，${incompleteTail})` : `部分加载 (gen-model，${incompleteTail})`;
          syncGlobalLoadStatus();
          consoleStore.addLog(
            'warning',
            `[model-load] gen-model-v1 refno=${normalizedRoot} 收集未完成（${incompleteTail}），已画 ${v1Result.loadedObjects} 个实例，未记为已加载；再显示一次可补齐`,
          );
          emitToast({
            message: `[提示] 已从 gen-model 加载 ${v1Result.loadedObjects} 个几何实例，但 ${incompleteTail}；稍后再显示一次 ${normalizedRoot} 可补齐`,
            level: 'warning',
          });
          return true;
        }
        loadedRoots.add(normalizedRoot);
        statusMessage.value = regenerate ? '重新生成完成 (gen-model)' : '加载完成 (gen-model)';
        syncGlobalLoadStatus();
        emitToast({ message: `[成功] 已从 gen-model 加载 ${v1Result.loadedObjects} 个几何实例`, level: 'success' });
        return true;
      }
      if (v1Result.skippedRefnos > 0 && v1Result.loadedRefnos === 0) {
        // 全部已在场景里（缓存命中），不是失败；没收齐的照样不记 loadedRoots
        statusMessage.value = collectionIncomplete ? `部分加载 (gen-model，${incompleteTail})` : '已加载 (gen-model)';
        syncGlobalLoadStatus();
        if (collectionIncomplete) {
          consoleStore.addLog('warning', `[model-load] gen-model-v1 refno=${normalizedRoot} 已取得的构件都在场景中，但收集未完成（${incompleteTail}）`);
        }
        return true;
      }
      statusMessage.value = collectionIncomplete ? `模型尚未就绪 (gen-model，${incompleteTail})` : '无可见几何实例 (gen-model)';
      syncGlobalLoadStatus();
      const hint = collectionIncomplete
        ? incompleteTail
        : mesh404 > 0 ? `网格缺失 ${mesh404} 个 refno` : noGeo > 0 ? `${noGeo} 个 refno 没有几何记录` : '服务端未返回可绘制实例';
      consoleStore.addLog('warning', `[model-load] gen-model-v1 未绘制实例 refno=${normalizedRoot}：${hint}`);
      emitToast({ message: `[警告] 加载结束但未绘制实例（refno=${normalizedRoot}）：${hint}`, level: 'warning' });
      return false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      statusMessage.value = '加载失败';
      syncGlobalLoadStatus();
      emitToast({ message: `[错误] 模型加载失败：${msg}`, level: 'error' });
      return false;
    } finally {
      unsubscribeProgress();
      isGenerating.value = false;
      showProgressModal.value = false;
      modelLoadStatus.finish({
        message: statusMessage.value,
        error: error.value,
      });
    }
  }

  /**
   * gen-model-v1 的整库显示（plan P3-c / P3-f `show_dbnum`）。两条路（`collectDbnum` 自己选）：
   * - 服务端整库入口（收口计划 §17；plan 2026-09-10 §12 **实时**）：服务端流水线每提交一片，`onRefnosReady` 就把那些根的构件
   *   装进 DTX——几何边生成边进视口，不等整库生成完；进度弹窗第一段是服务端的 `completed/expected_roots`。
   * - 逐 SITE 老路：该库全部 SITE 逐个 ensure → records（进度按 SITE / 生成根走），收完再把构件分批装进 DTX。
   * 两条路收尾都以 `collected.refnos` 对账：还没进视口的构件在这里补装。由 `showModelByDbnum` 在 v1 源下调用，
   * 错误与收尾都由它的 try/finally 兜住。
   */
  async function showModelByDbnumGenModelV1(
    source: GenModelV1ModelSource,
    dbno: number,
    loadOptions?: { flyTo?: boolean },
  ): Promise<ShowModelByDbnumResult> {
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

    const startedAt = Date.now();
    showProgressModal.value = true;
    statusMessage.value = `gen-model：查找 dbnum=${dbno} 的 SITE...`;
    progress.value = 5;
    syncGlobalLoadStatus();

    // 预算（收口计划 P9-3 之后）：records 多根打包，生成根数缺省不限；缺省只守 collectDbnum 的构件预算（50 000 个 refno），
    // ?show_dbnum_full=1 连它也不设——与 legacy show_dbnum 的同名开关同义：全量，不做「安全概览」
    const fullLoad = isShowDbnumFullRequested();

    // 实时装载（服务端整库入口）：每批就绪根的构件立刻进 DTX，总数在这里累计；进度条只往前走
    const totals: GenModelV1LoadTotals = { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, invalidTubi: 0, mesh404: 0, noGeo: 0 };
    const addTotals = (part: GenModelV1LoadTotals) => {
      totals.loadedRefnos += part.loadedRefnos;
      totals.skippedRefnos += part.skippedRefnos;
      totals.loadedObjects += part.loadedObjects;
      totals.invalidTubi += part.invalidTubi;
      totals.mesh404 += part.mesh404;
      totals.noGeo += part.noGeo;
    };
    const loadedRefnos = new Set<string>();
    let loadedRootCount = 0;
    let liveBatches = 0;
    const bumpProgress = (value: number) => {
      progress.value = Math.max(progress.value, Math.min(95, Math.floor(value)));
    };

    // 逐 SITE 老路：收集阶段占 5 → 55，SITE 之间按个数走，SITE 内按已收完的生成根走；
    // 服务端整库入口：没有 SITE 维度，`generate` 是服务端流水线的进度（占到 50），`roots` 是这边已收记录的根（占到 95）
    const collected = await source.collectDbnum(dbno, {
      maxTotalRoots: fullLoad ? Number.POSITIVE_INFINITY : undefined,
      maxRefnos: fullLoad ? Number.POSITIVE_INFINITY : undefined,
      onFallback: ({ message }) => {
        statusMessage.value = `gen-model：${message}`;
        consoleStore.addLog('warning', `[model-load] gen-model-v1 dbnum=${dbno} ${message}`);
        syncGlobalLoadStatus();
      },
      onProgress: ({ phase, siteIndex, siteCount, site, rootsDone, rootsTotal, root }) => {
        totalCount.value = siteCount;
        currentIndex.value = siteIndex;
        const scope = site?.name ?? `dbnum=${dbno}`;
        currentRefno.value = root ? `${scope} › ${root}` : scope;
        if (!site) {
          const viewport = loadedRootCount > 0 ? ` · 已进视口 ${loadedRootCount} 根` : '';
          statusMessage.value = phase === 'generate'
            ? `gen-model：服务端生成 ${scope}，已完成 ${rootsDone}/${rootsTotal} 根${viewport}`
            : `gen-model：${scope}，已收记录 ${rootsDone}/${rootsTotal} 根${viewport}`;
          const fraction = rootsTotal > 0 ? rootsDone / rootsTotal : 0;
          bumpProgress(5 + fraction * (phase === 'generate' ? 45 : 90));
        } else {
          statusMessage.value = phase === 'roots'
            ? `gen-model：SITE ${siteIndex}/${siteCount} ${scope}，生成根 ${rootsDone}/${rootsTotal}`
            : `gen-model：SITE ${siteIndex}/${siteCount} ${scope}，正在 ensure...`;
          const withinSite = rootsTotal > 0 ? rootsDone / rootsTotal : 0;
          progress.value = 5 + Math.floor(((siteIndex - 1 + withinSite) / Math.max(1, siteCount)) * 50);
        }
        syncGlobalLoadStatus();
      },
      onRefnosReady: async ({ refnos, rootsDone, rootsTotal }) => {
        loadedRootCount = rootsDone;
        if (refnos.length === 0) return;
        liveBatches += 1;
        const from = progress.value;
        const to = Math.max(from, Math.min(95, 5 + Math.floor((rootsDone / Math.max(1, rootsTotal)) * 90)));
        addTotals(await loadGenModelV1Refnos(
          dtxLayer,
          dbno,
          refnos,
          anyViewer,
          { regenerate: false, replace: false },
          [from, to],
          `gen-model 整库 dbnum=${dbno} 第 ${liveBatches} 批`,
        ));
        for (const refno of refnos) loadedRefnos.add(refno);
        statusMessage.value = `gen-model：dbnum=${dbno} 已进视口 ${rootsDone}/${rootsTotal} 根（${totals.loadedObjects} 个实例）`;
        bumpProgress(to);
        syncGlobalLoadStatus();
      },
    });

    const compatibility = collected.fallback ? `${collected.fallback.message}；` : '';
    const failedRoots = Object.keys(collected.errors);
    const tail =
      (collected.pending.length ? `，生成中 ${collected.pending.length} 根` : '') +
      (collected.truncatedRoots.length ? `，预算外未取 ${collected.truncatedRoots.length} 根` : '') +
      (collected.skippedSites.length ? `，未轮到 ${collected.skippedSites.length} 个 SITE` : '') +
      (failedRoots.length ? `，出错 ${failedRoots.length} 根` : '');
    const collectionIncomplete =
      collected.pending.length > 0
      || collected.truncatedRoots.length > 0
      || collected.skippedSites.length > 0
      || failedRoots.length > 0
      || collected.budgetLimited === true;
    const incompleteStatus = failedRoots.length > 0
      ? '模型加载未完成 (gen-model)'
      : '模型尚未就绪 (gen-model)';
    const siteSummary = collected.siteSummaryAvailable === false
      ? 'SITE 摘要不可用'
      : `${collected.sites.length} 个 SITE`;

    if (collected.refnos.length === 0 && collectionIncomplete) {
      statusMessage.value = incompleteStatus;
      progress.value = 100;
      syncGlobalLoadStatus();
      const detail = tail || '，受安全预算限制';
      const message = `[提示] ${compatibility}dbnum=${dbno}（${siteSummary}）尚未取得可加载几何${detail}`;
      consoleStore.addLog('warning', `[model-load] gen-model-v1 ${message}`);
      emitToast({ message, level: 'warning' });
      return { loaded: false, instanceCount: 0, refnoCount: 0, refnos: [] };
    }

    // 服务端整库入口不依赖 tree/roots 才能生成与取数；SITE 清单只是汇总信息。
    // tree 摘要临时失败时 collectDbnum 会保留已收记录并把 sites 留空，不能把成功结果误判成空库。
    if (
      collected.siteSummaryAvailable !== false
      && collected.sites.length === 0
      && collected.refnos.length === 0
    ) {
      statusMessage.value = `${compatibility}dbnum=${dbno} 在当前 MDB 里没有 SITE`;
      progress.value = 100;
      syncGlobalLoadStatus();
      const message = `[警告] ${compatibility}dbnum=${dbno} 在 gen-model 当前 MDB 的 tree/roots 里没有 SITE，无法整库加载`;
      consoleStore.addLog('warning', `[model-load] ${message}`);
      emitToast({ message, level: 'warning' });
      return { loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] };
    }
    if (collected.refnos.length === 0) {
      statusMessage.value = 'Model is empty (0 instances)';
      progress.value = 100;
      syncGlobalLoadStatus();
      const message = collected.siteSummaryAvailable === false
        ? `[警告] ${compatibility}dbnum=${dbno} 的模型结果没有任何几何记录（SITE 摘要不可用）${tail}`
        : `[警告] ${compatibility}dbnum=${dbno} 的 ${collected.sites.length} 个 SITE 没有任何几何记录${tail}`;
      consoleStore.addLog('warning', `[model-load] gen-model-v1 ${message}`);
      emitToast({ message, level: 'warning' });
      return { loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] };
    }

    // 对账：还没进视口的构件在这里补装（逐 SITE 老路 = 全部；实时那一路正常为 0）
    const remaining = collected.refnos.filter((refno) => !loadedRefnos.has(refno));
    if (remaining.length > 0) {
      addTotals(await loadGenModelV1Refnos(
        dtxLayer,
        dbno,
        remaining,
        anyViewer,
        { regenerate: false, replace: false },
        [Math.max(55, progress.value), 95],
        `gen-model 整库 dbnum=${dbno}`,
      ));
    }

    if (loadOptions?.flyTo) {
      try {
        const flyTargets = collected.refnos.length > 5000 ? collected.refnos.slice(0, 5000) : collected.refnos;
        const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
        if (aabb) {
          anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
        }
      } catch {
        // ignore flyTo errors
      }
    }

    const alreadyLoaded =
      totals.loadedObjects === 0
      && totals.loadedRefnos === 0
      && totals.skippedRefnos === collected.refnos.length
      && totals.mesh404 === 0
      && totals.noGeo === 0;
    // records 收齐、构件也交给了装载器，却因为网格取不到（404）一个实例都没画出来：这是**装载阶段**失败，
    // 不是「权威空模型」——不能写 Model is empty，也不能回 loaded:true（I2）
    const meshMissingWithoutRenderedObjects = totals.loadedObjects === 0 && totals.mesh404 > 0;
    const incompleteWithoutRenderedObjects =
      (collectionIncomplete || meshMissingWithoutRenderedObjects)
      && totals.loadedObjects === 0
      && !alreadyLoaded;
    const loadTail = totals.mesh404 > 0 ? `，网格缺失 ${totals.mesh404} 个 refno` : '';
    progress.value = 100;
    statusMessage.value = totals.loadedObjects > 0
      ? 'Model loaded (gen-model)'
      : alreadyLoaded
        ? '已加载 (gen-model，本次未新增)'
        : incompleteWithoutRenderedObjects
          ? (meshMissingWithoutRenderedObjects ? '模型加载未完成 (gen-model)' : incompleteStatus)
          : 'Model is empty (0 instances)';
    syncGlobalLoadStatus();
    consoleStore.addLog(
      'info',
      `[model-load] gen-model-v1 dbnum=${dbno} path=${collected.fallback?.reason ?? 'whole-dbnum'} sites=${collected.sites.length} roots=${collected.generationRoots.length} refno_count=${collected.refnos.length} loaded_refnos=${totals.loadedRefnos} skipped_refnos=${totals.skippedRefnos} instance_count=${totals.loadedObjects} invalid_tubi=${totals.invalidTubi} mesh404=${totals.mesh404} no_geo=${totals.noGeo} pending=${collected.pending.length} truncated_roots=${collected.truncatedRoots.length} skipped_sites=${collected.skippedSites.length} errors=${failedRoots.length} live_batches=${liveBatches} ms=${Date.now() - startedAt}`
    );
    const loadedSummary = alreadyLoaded
      ? `全部 ${collected.refnos.length} 个 refno 已在场景中，本次未新增实例`
      : incompleteWithoutRenderedObjects
        ? `已取得 ${collected.refnos.length} 个 refno，本次尚未绘制实例`
        : `已加载 ${totals.loadedObjects} 个实例（${totals.loadedRefnos} 个 refno）`;
    const summary =
      `${compatibility}${collected.budgetLimited ? '安全概览 ' : ''}dbnum=${dbno}：${siteSummary} / ${collected.generationRoots.length} 个生成根，` +
      `${loadedSummary}${tail}${loadTail}`;
    if (alreadyLoaded) {
      emitToast({ message: `[信息] ${summary}`, level: 'info' });
    } else if (incompleteWithoutRenderedObjects) {
      emitToast({ message: `[提示] ${summary}`, level: 'warning' });
    } else if (totals.loadedObjects === 0) {
      emitToast({ message: `[警告] ${summary}，未绘制实例（可能全部被跳过或几何缺失）`, level: 'warning' });
    } else if (collected.budgetLimited) {
      emitToast({ message: `[提示] ${summary}。请从模型树按需加载；整库全量可加 show_dbnum_full=1。`, level: 'warning' });
    } else if (tail || loadTail) {
      emitToast({ message: `[提示] ${summary}`, level: 'warning' });
    } else {
      emitToast({ message: `[成功] ${summary}`, level: 'success' });
    }
    return {
      loaded: !incompleteWithoutRenderedObjects,
      instanceCount: totals.loadedObjects,
      refnoCount: collected.refnos.length,
      refnos: collected.refnos,
      budgetLimited: collected.budgetLimited,
    };
  }

  async function showModelByDbnum(
    dbno: number,
    loadOptions?: { flyTo?: boolean }
  ): Promise<ShowModelByDbnumResult> {
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

      // 整库 = 该库全部 SITE 逐个 ensure（P3-c）。
      // （2026-09-18 起不再有「带 manifestUrl 把某个版本装进主层」的分支：版本只在隔离图层里看，见 plan 2026-09-18 Q18。）
      return await showModelByDbnumGenModelV1(getGenModelV1ModelSource(), dbno, { flyTo: loadOptions?.flyTo });
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
