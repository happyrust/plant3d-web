import { ref } from 'vue';
import type { Ref } from 'vue';

import type { VisibleInstsIncomplete, VisibleInstsResponse } from '@/api/genModelE3dTypes';

import { genModelV1DbnumModelRoots } from '@/api/genModelV1Api';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, tryGetDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  evictDtxRefnos,
  isDtxRefnoLoaded,
  loadDbnoInstancesForVisibleRefnosDtx,
  resolveDtxRefnosByUnitRefno,
} from '@/composables/useDbnoInstancesDtxLoader';
import { noteDbnumModelGenerated, reconcileDbnumModelStatus, scheduleDbnumModelReprobe } from '@/composables/useGenModelV1DbnumStatus';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { getGenModelV1ModelSource, getModelSource, subscribeModelSourceProgress, type GenModelV1ModelSource } from '@/model-source';
import { getGenModelV1ServiceSnapshot } from '@/model-source/genModelV1/serviceLifecycle';
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

/** 「稍后再显示 2 处、预算外未取 1 根、出错 1 根」——给状态栏 / toast / 日志用。pending 是 409，库正被占用，不是生成。 */
export function describeVisibleInstsIncomplete(incomplete: VisibleInstsIncomplete): string {
  const failed = Object.keys(incomplete.errors).length;
  return [
    incomplete.pending.length ? `稍后再显示 ${incomplete.pending.length} 处` : '',
    incomplete.truncated_roots.length ? `预算外未取 ${incomplete.truncated_roots.length} 根` : '',
    failed ? `出错 ${failed} 根` : '',
  ].filter(Boolean).join('、');
}

export async function queryLoadScopeRefnos(refno: string): Promise<{
  refnos: string[]
  source: 'visible-insts' | 'subtree-refnos'
  truncated: boolean
  /**
   * gen-model-v1：visibleInsts 那次按祖先查询没收齐的明细（409 / 截断 / 出错）；收齐时为 `null`。
   * visibleInsts 成功但查空时不退到 subtree——查空就是未加载。只有查询失败才退到 subtree-refnos，incomplete 照样带着。
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
    // 查成功就是查询结果：空也是空，不退到整棵子树去装没生成的构件。
    return { refnos, source: 'visible-insts', truncated: false, incomplete };
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
    // 叶子构件的直接属主是 BRAN：TUBI 直管挂在生成根自己的 refno 上（`deliveryUnitScene.ts`），
    // 根不进加载集直管永远进不了层 —— 「管件要带直段」（方案 A），按生成根把整条 BRAN 装进来。
    const ownerNoun = resp.success ? String(resp.owner_noun || '').trim().toUpperCase() : '';
    const ownerRefno = normalizeRefnoString(String(resp.owner_refno ?? ''));
    const underBran = !isBranHang && ownerNoun === 'BRAN' && !!ownerRefno && ownerRefno !== normalizedRoot;
    const actualLoadRefnos = isBranHang
      ? uniqStrings([normalizedRoot, ...normalizedComponents])
      : underBran
        ? uniqStrings([ownerRefno, ...normalizedComponents])
        : (normalizedComponents.length > 0 ? normalizedComponents : [normalizedRoot]);

    return {
      componentRefnos: normalizedComponents,
      actualLoadRefnos,
      rootNoun: noun || null,
      branHangRootInjected: isBranHang || underBran || normalizedComponents.length === 0,
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
  showModelByRefno: (refno: string, options?: { flyTo?: boolean; regenerate?: boolean; refresh?: boolean }) => Promise<boolean>
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

  /** 已尝试自动生成的 refno（防重复触发）：库无模型 / 节点查空时每个 refno 每会话只自动一发 generateThenCollect */
  const autoGenerateAttempted = new Set<string>();
  /**
   * dbnum 级「现在有没有读得到的模型」的会话内结论：`true` = `model/roots` 有就绪根，或本实例刚生成 / 查到过记录；
   * `false` = 就绪根为零。`true` 随时盖，`false` 只写第一次——别让过期的空结论压住刚产出的模型。
   */
  const dbnumModelKnown = new Map<number, boolean>();

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

  /**
   * `dbnums/{dbnum}/model/roots`（诊断快照）的库级预检查：`ready_total > 0`（旧构建逐根看 `ready`）才算
   * 「这个库有模型」——它与「records 现在读得到」同一条判据（投影回执 / 落库 ACK）。`model_sesno` 只在
   * 整库任务收口时盖、按需生成不动它；`/dbnums` 骨架形态压根不带模型字段，所以库级只能问这里。
   *
   * 枚举整库生成根要几秒：每库每实例只问一次（`dbnumModelKnown`）；查不出来回 `null`（按「不知道」
   * 放行正常查询，不挡显示，也不写缓存——下次再问）。
   */
  async function probeDbnumHasModel(dbno: number): Promise<boolean | null> {
    const known = dbnumModelKnown.get(dbno);
    if (known !== undefined) return known;
    const generation = getGenModelV1ServiceSnapshot().generation;
    try {
      const view = await genModelV1DbnumModelRoots(dbno);
      if (getGenModelV1ServiceSnapshot().generation !== generation) return null;
      const ready = typeof view.ready_total === 'number'
        ? view.ready_total
        : (view.roots ?? []).filter((root) => root.ready === true).length;
      const has = ready > 0;
      if (has || !dbnumModelKnown.get(dbno)) dbnumModelKnown.set(dbno, has);
      consoleStore.addLog('info', `[model-load] dbnum=${dbno} 模型预检查：就绪根 ${ready}/${view.total ?? (view.roots ?? []).length}`);
      return has;
    } catch (probeError) {
      consoleStore.addLog(
        'info',
        `[model-load] dbnum=${dbno} 模型预检查失败（按不知道处理，交给节点查询）：${probeError instanceof Error ? probeError.message : String(probeError)}`
      );
      return null;
    }
  }

  type GenModelV1LoadTotals = {
    loadedRefnos: number
    skippedRefnos: number
    loadedObjects: number
    /** 画成告警色的无效直管（gen-model `is_invalid_tubi`） */
    invalidTubi: number
    mesh404: number
    noGeo: number
    /** `noGeo` 那几个 refno（`a_b`）：收口要分辨「没几何的只是注入的根自己」还是「构件真没几何」 */
    noGeoRefnos: string[]
  }

  /**
   * gen-model-v1：把记录源缓存里的构件装进 DTX。超过一页（`VISIBLE_REFNOS_PAGE_SIZE`）就分批，进度在 `progressRange` 里走，
   * 每批之间让出一帧（P3-c 分批 + 进度）。`replace`（右键重新生成之后的替换）**不分批**：它要 forceRefresh，
   * 分了批每一批都会把同一个根再查一遍。生成已经在进这里之前做完，装载本身不再 generate。
   */
  async function loadGenModelV1Refnos(
    dtxLayer: any,
    dbno: number,
    refnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void },
    mode: { replace: boolean },
    progressRange: [number, number],
    label: string,
  ): Promise<GenModelV1LoadTotals> {
    const totals: GenModelV1LoadTotals = { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, invalidTubi: 0, mesh404: 0, noGeo: 0, noGeoRefnos: [] };
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
      totals.noGeoRefnos.push(...result.missingBreakdown.noGeoRowsRefnos.map((r) => normalizeRefnoString(String(r ?? ''))));
      if (index + 1 < batches) await sleep(0);
    }
    return totals;
  }

  function checkRefnoExists(refno: string): boolean {
    // 调用方（模型树的 autoLocate）常拿 `a/b` 来问；loadedRoots 与场景状态表都按 `a_b` 记
    const key = normalizeRefnoString(refno);
    if (!key) return false;
    if (loadedRoots.has(key)) return true;
    const v = viewer as any;
    return !!v?.scene?.objects?.[key];
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

  /**
   * 重载（`refresh`）时这根按祖先查空：记录查询本身收齐了就是这根名下已没有几何——数据批次删了它，或删光了它名下
   * 带几何的成员。它和它名下的旧构件从场景撤下、不再算已加载；没收齐（409 / 截断 / 出错）或只是退到子树查询时不下结论，
   * 场景保持原样。两种都不生成。
   */
  function finishRefreshOfEmptyRoot(
    dbno: number,
    root: string,
    previousLeaves: string[],
    incomplete: VisibleInstsIncomplete | null,
    source: 'visible-insts' | 'subtree-refnos',
  ): boolean {
    if (
      incomplete
      && (incomplete.pending.length > 0 || incomplete.truncated_roots.length > 0 || Object.keys(incomplete.errors).length > 0)
    ) {
      const tail = describeVisibleInstsIncomplete(incomplete);
      statusMessage.value = `refno=${root} 模型尚未就绪（${tail}），场景保持原样`;
      progress.value = 100;
      syncGlobalLoadStatus();
      consoleStore.addLog('warning', `[model-load] 重载 ${root}：收集未完成（${tail}），场景保持原样`);
      return false;
    }
    if (source !== 'visible-insts') {
      statusMessage.value = `refno=${root} 记录查询未应答，场景保持原样`;
      progress.value = 100;
      syncGlobalLoadStatus();
      consoleStore.addLog('warning', `[model-load] 重载 ${root}：记录查询失败、退到子树查询也是空，不当作删除，场景保持原样`);
      return false;
    }
    const anyViewer = viewer as any;
    const targets = uniqStrings([root, ...previousLeaves, ...resolveDtxRefnosByUnitRefno(dbno, root)]);
    const dtxLayer = anyViewer?.__dtxLayer;
    const evicted = dtxLayer ? evictDtxRefnos(dtxLayer, dbno, targets) : [];
    anyViewer?.scene?.setObjectsVisible?.(targets, false);
    loadedRoots.delete(root);
    statusMessage.value = `refno=${root} 最新记录里已没有几何，已从场景撤下`;
    progress.value = 100;
    syncGlobalLoadStatus();
    consoleStore.addLog(
      'info',
      `[model-load] 重载 ${root}：最新记录里这根名下没有几何（根被删，或带几何的成员删光），撤下 ${targets.length} 个 refno（${evicted.length} 个有对象）`,
    );
    emitToast({ message: `[提示] ${root} 在最新记录里已没有几何（已删除或成员已删光），已从场景撤下`, level: 'info' });
    return true;
  }

  /** 重载装完之后：重载前在这根名下、最新记录里已经没有的构件（数据批次删掉的成员）从场景撤下；根自己不撤。 */
  function evictMembersMissingFromRefresh(dbno: number, root: string, previousLeaves: string[], loadRefnos: string[]): void {
    const keep = new Set([root, ...loadRefnos]);
    const stale = previousLeaves.filter((refno) => !keep.has(refno));
    if (stale.length === 0) return;
    const anyViewer = viewer as any;
    const dtxLayer = anyViewer?.__dtxLayer;
    const evicted = dtxLayer ? evictDtxRefnos(dtxLayer, dbno, stale) : [];
    anyViewer?.scene?.setObjectsVisible?.(stale, false);
    consoleStore.addLog(
      'info',
      `[model-load] 重载 ${root}：${stale.length} 个构件已不在最新记录里，从场景撤下（${evicted.length} 个有对象）`,
    );
  }

  async function showModelByRefno(
    refno: string,
    loadOptions?: {
      flyTo?: boolean
      regenerate?: boolean
      /** 轻量联动的「重载」：后端增量批次已把记录换掉，清本地缓存重查并替换场景里的实例；不重新生成 */
      refresh?: boolean
    }
  ): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno);
    if (!normalizedRoot) return false;
    const refresh = loadOptions?.refresh === true;

    const genuinelyLoaded = loadedRoots.has(normalizedRoot);
    if (!loadOptions?.regenerate && !refresh && checkRefnoExists(normalizedRoot)) {
      if (loadOptions?.flyTo) {
        try {
          const anyViewer = viewer as any;
          let aabb = anyViewer?.scene?.getAABB?.([normalizedRoot]) ?? null;
          // BRAN / HANG / EQUI 自己多半没有对象（几何在成员名下，只有隐含管子挂 BRAN 键）：`getAABB` 为空先并一下场景里
          // 已装的成员（本地 owner 链，不发请求）。成员在 → 飞成员盒；下面的加载路会按「成员已在场景」短路（#84）。
          if (!aabb) {
            aabb = anyViewer?.scene?.getSubtreeAABB?.([normalizedRoot]) ?? null;
          }
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
      // 「显示」= 保证可见：对象已在场景但 refno 级可见态是 false（此前「隐藏」写进 objects 状态表，
      // 是显隐回放的权威）时，只 return 不会有任何视觉变化——把可见态拉回 true，并留一条日志让控制台不再静默。
      const ensureShown = () => {
        (viewer as any)?.scene?.setObjectsVisible?.([normalizedRoot], true);
      };
      if (genuinelyLoaded) {
        ensureShown();
        consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 已在场景中，恢复可见并跳过重复加载`);
        return true;
      }
      // 非 genuinelyLoaded 时检查 DTX 层是否真有几何
      const anyV = viewer as any;
      const dtxLayer = anyV?.__dtxLayer;
      if (dtxLayer?.hasObject?.(normalizedRoot)) {
        ensureShown();
        consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} DTX 层已有几何，恢复可见并跳过重复加载`);
        return true;
      }
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

    // gen-model-v1：范围查询里那次按祖先查 records 的进度只能从记录源听。
    // 多个祖先时把进度弹窗挂出来，单根不弹。
    const unsubscribeProgress = subscribeModelSourceProgress(({ done, total, root, stage }) => {
      totalCount.value = total;
      currentIndex.value = Math.min(total, done + 1);
      currentRefno.value = root;
      statusMessage.value = stage === 'generate-start'
        ? `正在生成构件 ${root}（${done + 1}/${total}）`
        : stage === 'generate'
          ? `已生成 ${done}/${total} 个生成根`
          : `gen-model 查询记录：${done}/${total} 个生成根`;
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

      const regenerate = loadOptions?.regenerate === true;
      // 库级预检查与下面的范围查询并行：`model/roots` 要枚举整库生成根（大库几秒），不能挡住常规显示。
      // 结论在查询分支里才取。显式「重新生成」不问——它本来就不查库。
      const dbnumProbe: Promise<boolean | null> = regenerate
        ? Promise.resolve(true)
        : probeDbnumHasModel(dbno);
      if (regenerate) {
        statusMessage.value = `正在重新生成 ${normalizedRoot}...`;
        progress.value = 5;
        syncGlobalLoadStatus();
        const generated = await getGenModelV1ModelSource().records.generateThenCollect(normalizedRoot);
        if (generated.items.length === 0) {
          const timedOut = generated.pending.length > 0;
          if (timedOut) scheduleDbnumModelReprobe(dbno);
          const failed = Object.entries(generated.errors).map(([root, message]) => `${root}: ${message}`).join('; ');
          const hint = timedOut
            ? '服务端后台继续生成，完成后再点眼睛'
            : (failed || '没有可显示的新产物');
          statusMessage.value = hint;
          progress.value = 100;
          syncGlobalLoadStatus();
          consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 重新生成后不显示：${hint}`);
          emitToast({ message: `[提示] ${normalizedRoot}：${hint}`, level: 'info' });
          return false;
        }
        noteDbnumModelGenerated(dbno);
      }

      // 重载前这根名下的构件：重新查到的记录里没有的，就是数据批次删掉的，装完要从场景撤下
      let previousLeaves: string[] = [];
      if (refresh) {
        // 记录缓存里这一根连同构件先清掉：下面按祖先重新查到的才是新会话的实例；装载走 replace，不再 generate。
        previousLeaves = uniqStrings(
          getGenModelV1ModelSource().records.invalidateRoot(normalizedRoot).map((r) => normalizeRefnoString(r)),
        ).filter(Boolean);
        // `invalidateRoot` 连 `leavesByRoot` 一起删了，光靠它算差集，在「上一次重载没收齐」或「服务换代清了缓存」
        // 时会恒为空，被删成员就永远留在场景里。场景索引是另一份独立事实（DTX 运行时按属主链记得的 refno），并进来当基线。
        previousLeaves = uniqStrings([...previousLeaves, ...resolveDtxRefnosByUnitRefno(dbno, normalizedRoot)]);
      }
      statusMessage.value = '查询可见实例范围...';
      progress.value = 10;
      syncGlobalLoadStatus();
      let visibleOk = false;
      let visibleErr: string | null = null;
      let visibleRefnos: string[] = [];
      let visibleSource: 'visible-insts' | 'subtree-refnos' = 'visible-insts';
      // gen-model-v1：这次按祖先查询有没有收齐。没收齐的节点不进 loadedRoots：下一次普通显示还要能再查
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
      // 「重新生成」统一收口：库级预检查确认无模型（hasModel===false）或节点名下一条 records 都没查到，
      // 都默认重新生成当前节点——不再按类型白名单过滤，显示逻辑本身就是「没有模型就默认重新生成」。
      // 每个 refno 每会话只自动一发：真产不出（NoRenderableGeometry / 容器展开不到交付根）时重复点不再
      // 连环 generate，照旧给提示；右键「重新生成模型」走显式 regenerate，不受这一次的限制。
      const tryAutoGenerate = async (why: string): Promise<boolean> => {
        if (autoGenerateAttempted.has(normalizedRoot)) return false;
        autoGenerateAttempted.add(normalizedRoot);
        statusMessage.value = `正在自动生成 ${normalizedRoot} 模型...`;
        progress.value = 5;
        syncGlobalLoadStatus();
        consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} ${why}，默认重新生成模型`);
        emitToast({ message: `[提示] ${normalizedRoot} 尚未生成模型，正在自动生成...`, level: 'info' });
        try {
          const generated = await getGenModelV1ModelSource().records.generateThenCollect(normalizedRoot);
          if (generated.items.length > 0) {
            dbnumModelKnown.set(dbno, true);
            noteDbnumModelGenerated(dbno);
            // 生成成功，重新查询 records（generateThenCollect 清了这条请求名下的备忘并重查进缓存）
            const retry = await queryLoadScopeRefnos(normalizedRoot);
            visibleRefnos = uniqStrings(retry.refnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
            visibleSource = retry.source;
            scopeIncomplete = retry.incomplete;
            visibleOk = true;
            visibleErr = null;
            consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 自动生成成功，取得 ${visibleRefnos.length} 个构件`);
            if (visibleRefnos.length > 0) {
              emitToast({ message: `[成功] ${normalizedRoot} 模型已自动生成并加载`, level: 'success' });
              return true;
            }
            return false;
          }
          const timedOut = generated.pending.length > 0;
          if (timedOut) scheduleDbnumModelReprobe(dbno);
          const failed = Object.entries(generated.errors).map(([root, msg]) => `${root}: ${msg}`).join('; ');
          const hint = timedOut ? '服务端后台继续生成，完成后再点眼睛' : (failed || '生成未产出可显示模型');
          consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 自动生成未产出：${hint}`);
          emitToast({ message: `[提示] ${normalizedRoot} 自动生成未完成：${hint}`, level: 'info' });
          return false;
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e);
          consoleStore.addLog('error', `[model-load] refno=${normalizedRoot} 自动生成异常：${em}`);
          emitToast({ message: `[警告] ${normalizedRoot} 自动生成失败：${em}`, level: 'warning' });
          return false;
        }
      };

      // 重载只有在「visible-insts 真的查通了」时才敢下结论：查失败、或退到子树查询（那不是收齐的最新记录），
      // 都要保持场景原样。判 !visibleOk 而不是看 visibleErr——抛出空 message 的 Error 时 visibleErr 是 ''，
      // 按 visibleErr 判会从破坏性路径上 fail-open。
      if (refresh && (!visibleOk || visibleSource !== 'visible-insts')) {
        const why = visibleErr || (visibleOk ? `记录查询退到子树（${visibleSource}）` : '记录查询未应答');
        consoleStore.addLog('warning', `[model-load] 重载 ${normalizedRoot} 未取得收齐的记录（${why}），场景保持原样`);
        emitToast({ message: `[警告] ${normalizedRoot} 重载未完成：${why}，场景保持原样`, level: 'warning' });
        statusMessage.value = `refno=${normalizedRoot} 重载未完成，场景保持原样`;
        progress.value = 100;
        syncGlobalLoadStatus();
        return false;
      }

      if (!visibleOk && visibleErr) {
        consoleStore.addLog('warning', `[model-load] 查询加载范围失败：${visibleErr}`);
        emitToast({
          message: `[警告] 查询加载范围失败：${visibleErr}`,
          level: 'warning',
        });
        // 库级确认无模型：查询失败不改这个结论——照样默认重新生成一次；生成出了记录就落回正常装载
        if ((await dbnumProbe) === false && !(await tryAutoGenerate(`dbnum=${dbno} 无就绪模型`))) {
          statusMessage.value = `refno=${normalizedRoot} 未加载`;
          progress.value = 100;
          syncGlobalLoadStatus();
          return false;
        }
      } else if (visibleOk && visibleRefnos.length === 0) {
        if (refresh) return finishRefreshOfEmptyRoot(dbno, normalizedRoot, previousLeaves, scopeIncomplete, visibleSource);
        const hasModel = await dbnumProbe;
        // pending（409，库正被整库任务占用）时不发：generate 同样撞锁，「稍后再显示」才是对的
        const pendingBusy = (scopeIncomplete?.pending.length ?? 0) > 0;
        const autoGenerated = !pendingBusy && await tryAutoGenerate(
          hasModel === false ? `dbnum=${dbno} 无就绪模型` : 'records 查空'
        );
        if (!autoGenerated) {
          const tail = scopeIncomplete ? describeVisibleInstsIncomplete(scopeIncomplete) : '';
          const emptyHint = scopeIncomplete
            ? `${normalizedRoot} 尚未取得可见实例（${tail}）`
            : `${normalizedRoot}：范围内没有已生成的模型；右键「重新生成模型」可生成`;
          consoleStore.addLog('info', `[model-load] ${emptyHint}`);
          emitToast({ message: `[提示] ${emptyHint}`, level: 'info' });
          statusMessage.value = scopeIncomplete
            ? `refno=${normalizedRoot} 模型尚未就绪（${tail}）`
            : `refno=${normalizedRoot} 未加载`;
          progress.value = 100;
          syncGlobalLoadStatus();
          return false;
        }
        // autoGenerated = true，继续往下走装载流程
      }
      // 查询真拿到了记录 → 这个库就是有模型（与预检查同记正结论；探针回得晚也压不掉）
      if (visibleOk && visibleRefnos.length > 0) {
        dbnumModelKnown.set(dbno, true);
        // 行尾库状态圆点若还停在「无模型 / 未知」，records 证据推翻它 → 丢结论重探对齐
        reconcileDbnumModelStatus(dbno);
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
          setObjectsVisible?: (ids: string[], visible: boolean) => void
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

      // ========== gen-model-v1（ADR 0069）==========
      // 显示 = 按祖先查 records，已在 visibleInsts 里做过一遍并进了记录缓存，这里只是把缓存里的实例装进 DTX。
      // 生成在上面已经收口：右键是显式重新生成；库无模型 / 节点查空走 tryAutoGenerate（各一发）。
      // 这里替换或新装场景里的对象，不再 generate。
      const loadRefnos = loadScope.actualLoadRefnos;
      // 「显示」= 保证可见：先把本次范围的 refno 级可见态拉回 true（权威在 scene.objects 状态表）。
      // 否则先前「隐藏」写过 false 的 refno，装完会被 __dtxAfterInstancesLoaded 的 applyStateToRefnos 立刻再藏掉；
      // 已在层里、被 loader 跳过的旧对象也一并恢复可见。
      anyViewer.scene?.setObjectsVisible?.(uniqStrings([normalizedRoot, ...loadRefnos]), true);
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
        { replace: regenerate || refresh },
        [30, 95],
        `从 gen-model 加载 ${normalizedRoot}`,
      );
      if (refresh && !scopeIncomplete) evictMembersMissingFromRefresh(dbno, normalizedRoot, previousLeaves, loadRefnos);
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
      // 收集没完成（409 / 预算外 / 出错）：已取得的构件照画，但这个节点不记进 loadedRoots。
      // 记了就会被 genuinelyLoaded 短路。记录源同样不备忘未收齐的结果，下一次普通显示会再查。
      const collectionIncomplete = scopeIncomplete !== null;
      if (v1Result.loadedObjects > 0) {
        if (collectionIncomplete) {
          statusMessage.value = regenerate ? `重新生成部分完成 (gen-model，${incompleteTail})` : `部分加载 (gen-model，${incompleteTail})`;
          syncGlobalLoadStatus();
          consoleStore.addLog(
            'warning',
            `[model-load] gen-model-v1 refno=${normalizedRoot} 收集未完成（${incompleteTail}），已画 ${v1Result.loadedObjects} 个实例，未记为已加载`,
          );
          emitToast({
            message: `[提示] 已从 gen-model 加载 ${v1Result.loadedObjects} 个几何实例，但 ${incompleteTail}`,
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
      // 成员早在场景里（别的 useModelGeneration 实例 / 别的入口装的），这次只剩注入的根自己要装、而根本来就没有自己的几何
      //（BRAN / HANG 的几何在成员名下，HVAC 支管连隐含管子都没有）：这是「已加载」，不是「没有几何记录」（#84）。
      const onlyInjectedRootLacksGeometry =
        v1Result.loadedObjects === 0
        && v1Result.skippedRefnos > 0
        && v1Result.mesh404 === 0
        && v1Result.noGeoRefnos.length > 0
        && v1Result.noGeoRefnos.every((refno) => refno === normalizedRoot);
      if ((v1Result.skippedRefnos > 0 && v1Result.loadedRefnos === 0) || onlyInjectedRootLacksGeometry) {
        // 全部已在场景里（缓存命中），不是失败；没收齐的照样不记 loadedRoots
        statusMessage.value = collectionIncomplete ? `部分加载 (gen-model，${incompleteTail})` : '已加载 (gen-model)';
        syncGlobalLoadStatus();
        if (collectionIncomplete) {
          consoleStore.addLog('warning', `[model-load] gen-model-v1 refno=${normalizedRoot} 已取得的构件都在场景中，但收集未完成（${incompleteTail}）`);
        } else if (onlyInjectedRootLacksGeometry) {
          loadedRoots.add(normalizedRoot);
          consoleStore.addLog('info', `[model-load] gen-model-v1 refno=${normalizedRoot} 成员已在场景中，根自身无几何，按已加载收口`);
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
   * gen-model-v1 的整库显示（ADR 0069）：该库全部 SITE 逐个按祖先查 records，每个 SITE 收完经 `onRefnosReady` 装进 DTX。
   * 不发起整库生成。收尾以 `collected.refnos` 对账。错误与收尾由 `showModelByDbnum` 的 try/finally 兜住。
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
    const totals: GenModelV1LoadTotals = { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, invalidTubi: 0, mesh404: 0, noGeo: 0, noGeoRefnos: [] };
    const addTotals = (part: GenModelV1LoadTotals) => {
      totals.loadedRefnos += part.loadedRefnos;
      totals.skippedRefnos += part.skippedRefnos;
      totals.loadedObjects += part.loadedObjects;
      totals.invalidTubi += part.invalidTubi;
      totals.mesh404 += part.mesh404;
      totals.noGeo += part.noGeo;
      totals.noGeoRefnos.push(...part.noGeoRefnos);
    };
    const loadedRefnos = new Set<string>();
    let loadedRootCount = 0;
    let liveBatches = 0;
    const bumpProgress = (value: number) => {
      progress.value = Math.max(progress.value, Math.min(95, Math.floor(value)));
    };

    // 逐 SITE 查询：收集阶段占 5 → 55，SITE 之间按个数走。
    const collected = await source.collectDbnum(dbno, {
      maxTotalRoots: fullLoad ? Number.POSITIVE_INFINITY : undefined,
      maxRefnos: fullLoad ? Number.POSITIVE_INFINITY : undefined,
      onProgress: ({ phase, siteIndex, siteCount, site, rootsDone, rootsTotal, root }) => {
        totalCount.value = siteCount;
        currentIndex.value = siteIndex;
        const scope = site?.name ?? `dbnum=${dbno}`;
        currentRefno.value = root ? `${scope} › ${root}` : scope;
        statusMessage.value = phase === 'roots'
          ? `gen-model：SITE ${siteIndex}/${siteCount} ${scope}，已查 ${rootsDone}/${rootsTotal}`
          : `gen-model：SITE ${siteIndex}/${siteCount} ${scope}，正在查询已生成的记录...`;
        const withinSite = rootsTotal > 0 ? rootsDone / rootsTotal : 0;
        const next = 5 + Math.floor(((siteIndex - 1 + withinSite) / Math.max(1, siteCount)) * 50);
        progress.value = Math.max(progress.value, next);
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
          { replace: false },
          [from, to],
          `gen-model 整库 dbnum=${dbno} 第 ${liveBatches} 批`,
        ));
        for (const refno of refnos) loadedRefnos.add(refno);
        statusMessage.value = `gen-model：dbnum=${dbno} 已进视口 ${rootsDone}/${rootsTotal} 根（${totals.loadedObjects} 个实例）`;
        bumpProgress(to);
        syncGlobalLoadStatus();
      },
    });

    const failedRoots = Object.keys(collected.errors);
    const tail =
      (collected.pending.length ? `，稍后再显示 ${collected.pending.length} 处` : '') +
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
      const message = `[提示] dbnum=${dbno}（${siteSummary}）尚未取得可加载几何${detail}`;
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
      statusMessage.value = `dbnum=${dbno} 在当前 MDB 里没有 SITE`;
      progress.value = 100;
      syncGlobalLoadStatus();
      const message = `[警告] dbnum=${dbno} 在 gen-model 当前 MDB 的 tree/roots 里没有 SITE，无法整库加载`;
      consoleStore.addLog('warning', `[model-load] ${message}`);
      emitToast({ message, level: 'warning' });
      return { loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] };
    }
    if (collected.refnos.length === 0) {
      statusMessage.value = 'Model is empty (0 instances)';
      progress.value = 100;
      syncGlobalLoadStatus();
      const emptyHint = '范围内没有已生成的模型；右键「重新生成模型」可生成';
      const message = collected.siteSummaryAvailable === false
        ? `[提示] dbnum=${dbno} 的模型结果没有任何几何记录（SITE 摘要不可用）。${emptyHint}${tail}`
        : `[提示] dbnum=${dbno} 的 ${collected.sites.length} 个 SITE 没有任何几何记录。${emptyHint}${tail}`;
      consoleStore.addLog('info', `[model-load] gen-model-v1 ${message}`);
      emitToast({ message, level: 'info' });
      return { loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] };
    }

    // 整库真收到了记录 → 库级结论与行尾圆点同记「有模型」
    dbnumModelKnown.set(dbno, true);
    reconcileDbnumModelStatus(dbno);

    // 对账：还没进视口的构件在这里补装（逐 SITE 老路 = 全部；实时那一路正常为 0）
    const remaining = collected.refnos.filter((refno) => !loadedRefnos.has(refno));
    if (remaining.length > 0) {
      addTotals(await loadGenModelV1Refnos(
        dtxLayer,
        dbno,
        remaining,
        anyViewer,
        { replace: false },
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
      `[model-load] gen-model-v1 dbnum=${dbno} path=query-sites sites=${collected.sites.length} roots=${collected.generationRoots.length} refno_count=${collected.refnos.length} loaded_refnos=${totals.loadedRefnos} skipped_refnos=${totals.skippedRefnos} instance_count=${totals.loadedObjects} invalid_tubi=${totals.invalidTubi} mesh404=${totals.mesh404} no_geo=${totals.noGeo} pending=${collected.pending.length} truncated_roots=${collected.truncatedRoots.length} skipped_sites=${collected.skippedSites.length} errors=${failedRoots.length} live_batches=${liveBatches} ms=${Date.now() - startedAt}`
    );
    const loadedSummary = alreadyLoaded
      ? `全部 ${collected.refnos.length} 个 refno 已在场景中，本次未新增实例`
      : incompleteWithoutRenderedObjects
        ? `已取得 ${collected.refnos.length} 个 refno，本次尚未绘制实例`
        : `已加载 ${totals.loadedObjects} 个实例（${totals.loadedRefnos} 个 refno）`;
    const summary =
      `${collected.budgetLimited ? '安全概览 ' : ''}dbnum=${dbno}：${siteSummary} / ${collected.generationRoots.length} 个生成根，` +
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

      // 整库显示 = 该库全部 SITE 逐个按祖先查（ADR 0069）。
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
