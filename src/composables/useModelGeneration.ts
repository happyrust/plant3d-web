import { ref } from 'vue';
import type { Ref } from 'vue';

import type { VisibleInstsIncomplete, VisibleInstsResponse } from '@/api/genModelE3dTypes';
import type { PdmsTypeInfoResponse } from '@/api/genModelPdmsAttrApi';
import type { DbnumRow } from '@/api/genModelV1Api';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import { judgeDbnumFreshness } from '@/composables/dbnumFreshness';
import {
  chunkResultFromCollect,
  describeGenerationConfirm,
  describeGenerationFillSummary,
  isWholeNodePlan,
  planModelGeneration,
  remainingGenerationChunks,
  runGenerationFill,
  type GenerationChunk,
  type GenerationFillSummary,
  type GenerationPlan,
  type GenerationTreeNode,
  type GenerationUnitFacts,
} from '@/composables/generationFill';
import { beginGenerationFill, clearPendingGenerationFill, notePendingGenerationFill } from '@/composables/generationFillState';
import { noteGetWorkDbnumScope, noteGetWorkRoot, type GetWorkWatermark } from '@/composables/modelGetWorkRegistry';
import { beginModelLoadSession, beginWholeLibraryLoad, ModelLoadStoppedError, type ModelLoadSession } from '@/composables/modelLoadSession';
import { backendMeshPurgeKeepsShared, fetchGenerationFacts, fetchNodeModelFacts } from '@/composables/nodeModelFacts';
import { changedSessionsOfNodeVersions, type NodeModelFacts } from '@/composables/nodeModelStatus';
import { decideNodeUpdate, describeNodeUpdateSummary, planNodeUpdateChunks } from '@/composables/nodeModelUpdate';
import { progressiveBatchWaitMs, shouldLoadProgressiveBatch } from '@/composables/progressiveLoadPolicy';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { useConsoleStore } from '@/composables/useConsoleStore';
import { ensureDbMetaInfoLoaded, tryGetDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  evictDtxRefnos,
  holdDtxLod1Backfill,
  isDtxRefnoLoaded,
  loadDbnoInstancesForVisibleRefnosDtx,
  prefetchDtxGeometries,
  resolveDtxRefnosByUnitRefno,
} from '@/composables/useDbnoInstancesDtxLoader';
import { peekGenModelV1Dbnums } from '@/composables/useGenModelV1Dbnums';
import { noteDbnumModelGenerated, reconcileDbnumModelStatus, scheduleDbnumModelReprobe } from '@/composables/useGenModelV1DbnumStatus';
import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import {
  forgetLoadedNode,
  markLoadedNodeStale,
  noteLoadedNode,
  noteNodeWithoutModel,
  provideLoadedNodeChangeQuery,
  provideLoadedNodeFactsQuery,
  recheckLoadedNode,
  recheckLoadedNodeLater,
} from '@/composables/useLoadedNodeStatus';
import { useModelLoadStatus } from '@/composables/useModelLoadStatus';
import { getGenModelV1ModelSource, getModelSource, subscribeModelSourceProgress, type GenModelV1ModelSource } from '@/model-source';
import { pushRecordPageListener } from '@/model-source/genModelV1/modelRecords';
import { emitToast } from '@/ribbon/toastBus';
import { toRefnoKey } from '@/utils/refnoKey';
import { beginCameraIntent, isCameraIntentCurrent } from '@/viewer/camera/cameraIntent';

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

/** 正在边取边画的节点（`a_b`）。跨 `useModelGeneration` 实例共用：模型树和查看器各有一份实例，装的是同一个场景。 */
const progressiveRoots = new Set<string>();

/** 生成到一半被叫停之后，隔多久再问行上的状态（在飞的那一块后端照常算完，多数是几秒的事） */
const STOPPED_FILL_RECHECK_DELAYS_MS: readonly number[] = [5_000, 20_000];

/** 已有的模型画出来之后顺带问一次后端的生成预检，最多等这么久（后端第一次算一个大 SITE 要一两秒；平时几毫秒） */
const PRECHECK_AFTER_SHOWN_TIMEOUT_MS = 3_000;
/** 一个模型都没有、要生成之前问预检，最多等这么久 */
const PRECHECK_BEFORE_GENERATE_TIMEOUT_MS = 10_000;
/** 节点一级的更新动手之前重新问一次节点模型状态，最多等这么久（等不到就不更新：不知道有没有单元被删） */
const NODE_UPDATE_FACTS_TIMEOUT_MS = 15_000;

/** 等一个承诺，最多等 `ms` 毫秒；超时就抛（原来的请求不取消，回来了也没人要）。 */
function withTimeout<T>(task: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} 超过 ${ms} 毫秒没有回来`)), ms);
    task.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * 每个已显示的节点上一次装进场景的构件（`a_b`）。重载时拿它和最新记录比：上一次有、这一次没有的，就是数据批次删掉的，
 * 要从场景撤下。装载器的属主链只到生成根（BRAN / EQUI），认不出一个构件在不在某个 SITE / ZONE 下面，所以容器节点的
 * 重载要靠这一份（2026-11-11：真机上删掉一台设备再重载 SITE，那台设备还留在屏幕上）。
 * 跨 `useModelGeneration` 实例共用：模型树和查看器各有一份实例，装的是同一个场景（节点可能在这一份里装、在另一份里重载）。
 */
const loadedRefnosByRoot = new Map<string, Set<string>>();

export function __resetLoadedRefnosByRootForTests(): void {
  loadedRefnosByRoot.clear();
}

/**
 * 不经 `showModelByRefno` 装进场景的节点（地址栏直装）：记下它这一次装了哪些构件，「取最新」重载它时才比得出
 * 哪些被删了（容器节点靠这一份，见 `loadedRefnosByRoot`）。
 */
export function rememberLoadedRefnosOfRoot(root: string, refnos: readonly string[]): void {
  const key = normalizeRefnoString(root);
  if (key) loadedRefnosByRoot.set(key, new Set(refnos.map((refno) => normalizeRefnoString(refno)).filter(Boolean)));
}

// 已加载节点表判「模型水位之后谁改到了这个节点」要问节点版本表（`node/versions?since_sesno=`）：在这里接上数据源。
provideLoadedNodeChangeQuery(async ({ dbnum, refno, sinceSesno, signal }) => {
  const table = await getModelSource().versions.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno, signal });
  return changedSessionsOfNodeVersions(table.versions);
});
// 行上的新旧先问后端的节点模型状态接口（`GET node/model-status`）；生成预检（下面的 `prepareFill`）问的是同一个接口。
provideLoadedNodeFactsQuery(fetchNodeModelFacts);

/**
 * 分批装入的每批大小：首批 `first` 个先出画，之后逐批翻倍。每批装完 DTX 层都要整层 recompile（全量重建 GPU 纹理），
 * 等长分批的总重建量随批数平方增长，翻倍分批只有对数个批次。
 */
export function planLoadBatchSizes(total: number, first: number = VISIBLE_REFNOS_PAGE_SIZE): number[] {
  const sizes: number[] = [];
  let size = Math.max(1, first);
  for (let done = 0; done < total; done += size, size *= 2) sizes.push(Math.min(size, total - done));
  return sizes;
}

/**
 * 这个库在库里有没有成套落过的模型，按 `/dbnums` 那一行判：未初始化（数据水位没立）或模型水位从没盖过 = 没有（`true`）；
 * 行不在（缓存还没有 / 库不在清单里）或老服务端不带这两格 = 不知道（`null`）。
 * 它不回答「某个节点有没有模型」——那是 `model/records` 的事。
 */
export function dbnumRowLacksModel(row: DbnumRow | null | undefined): boolean | null {
  if (!row) return null;
  if (row.initialized === false) return true;
  if (typeof row.model_sesno === 'number') return row.model_sesno <= 0;
  return null;
}

/**
 * 节点查空时**不该**自动补齐的库：`/dbnums` 说这个库的模型读源还没回到库里（gen-model 规范 §4.12 的 `model_source_reason`）。
 * - `model_lagging`：模型水位落后于已入库的数据，库正在追平，或有根生成失败（gen-model #74）——这时查空不代表没生成过；
 * - `initialization_publishing`：这个库的任务在飞，按需生成只会撞 409。
 * 返回给人看的原因；可以补齐回 `null`。
 */
export function dbnumEmptyQueryCaveat(row: DbnumRow | null | undefined): string | null {
  const reason = String(row?.model_source_reason ?? '');
  if (reason === 'model_lagging') {
    return '这个库的模型正在追平已入库的数据（或有生成失败的根），查空不代表没生成过；稍后再显示，或到「模型生成」面板查看';
  }
  if (reason === 'initialization_publishing') return '这个库正在更新，稍后再显示';
  return null;
}

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

// 归一化统一收口到 toRefnoKey（修「只替换首个斜杠」），保留函数名以免动调用点。
function normalizeRefnoString(refno: string): string {
  return toRefnoKey(refno);
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

export async function queryLoadScopeRefnos(
  refno: string,
  /** `isStopped`：加载被叫停了——记录读取被取消不是「查询失败」，不要退到逐节点的子树查询（那要发几百个请求） */
  options: { isStopped?: () => boolean } = {},
): Promise<{
  refnos: string[]
  source: 'visible-insts' | 'subtree-refnos'
  truncated: boolean
  /**
   * gen-model-v1：visibleInsts 那次按祖先查询没收齐的明细（409 / 截断 / 出错）；收齐时为 `null`。
   * visibleInsts 成功但查空时不退到 subtree——查空就是未加载。只有查询失败才退到 subtree-refnos，incomplete 照样带着。
   */
  incomplete: VisibleInstsIncomplete | null
  /**
   * gen-model-v1：查过、一条记录都没有的范围（`a_b`）——节点自己，或按成员拆开查时没有记录的成员（顶层 SITE 的 ZONE）。
   * 模型资产补齐按它分块（方案 B3）。退到 subtree-refnos 时为空表：那不是「查空」。
   */
  emptyScopes: string[]
}> {
  const normalized = normalizeRefnoString(refno);
  if (!normalized) {
    return { refnos: [], source: 'visible-insts', truncated: false, incomplete: null, emptyScopes: [] };
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
    const emptyScopes = uniqStrings((resp.empty_scopes ?? []).map((r) => normalizeRefnoString(String(r || '')))).filter(Boolean);
    // 查成功就是查询结果：空也是空，不退到整棵子树去装没生成的构件。
    return { refnos, source: 'visible-insts', truncated: false, incomplete, emptyScopes };
  } catch {
    // 被叫停的：到此为止
    if (options.isStopped?.()) throw new ModelLoadStoppedError(normalized);
    // 继续使用同一 root 的受限 subtree 范围。
  }
  const subtree = await querySubtreeRefnos(normalized);
  return {
    refnos: subtree.refnos,
    source: 'subtree-refnos',
    truncated: subtree.truncated,
    incomplete,
    emptyScopes: [],
  };
}

/**
 * `rootTypeInfo`：调用方已经发出的根节点 `typeInfo`（它只依赖根，显示流程与范围查询并行发出）；不给就在这里现查。
 */
export async function resolveActualModelLoadScope(
  rootRefno: string,
  componentRefnos: string[],
  rootTypeInfo?: Promise<PdmsTypeInfoResponse>,
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
    const resp = await (rootTypeInfo ?? getModelSource().attributes.typeInfo(normalizedRoot));
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
  showModelByRefno: (
    refno: string,
    options?: { flyTo?: boolean; regenerate?: boolean; refresh?: boolean; fill?: boolean; update?: boolean; confirmEmpty?: boolean },
  ) => Promise<boolean>
  isModelActuallyLoaded: (refno: string) => boolean
  checkRefnoExists: (refno: string) => boolean
  listLoadedRoots: () => string[]
  withdrawRemovedRoot: (refno: string) => number
  loadedRefnosOf: (refno: string) => string[] | null
  isRootInScene: (refno: string) => boolean
  rememberLoadedRefnos: (root: string, refnos: readonly string[]) => void
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

  /**
   * 模型资产补齐试过、有了定论的范围（`a_b`，节点自己或它的一个 ZONE）：`empty` = 生成跑过了、没有可显示的东西（数据的终局，
   * 再发只会把同样的生成再跑一遍）；`failed` = 有不可重试的失败。这两种在本页面里不再自动重发（防连环 generate），
   * 照旧给提示；行上的「生成」（显式补齐）会重试 `failed` 的。后端还没做完（超时）的不记——下次显示接着问，
   * 不带 `force` 的生成对已有的根只是确认一下。右键「重新生成模型」走显式 regenerate（带 force），不受这里限制。
   */
  const fillScopeStates = new Map<string, 'empty' | 'failed'>();
  /** 自动生成回过的说明（目前只有空分组）：同一 refno 再点眼睛时照样给它，不提示「右键重新生成」——分组没有这一项 */
  const autoGenerateHints = new Map<string, string>();
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
   * 库级预检查用的那一行：只读 `/dbnums` 共享缓存里现成的（`useDbMetaInfo` 把节点号映射成库号时已经拉过），
   * **不发请求、不等待**；缓存里没有就是 `null`（不知道）。
   *
   * 2026-11-10 之前这里问的是 `dbnums/{dbnum}/model/roots`：要枚举整库生成根（7997 一次 21–24 s），查空的显示
   * 要等它回来才决定生不生成；而它的「就绪根」只是后端本进程投影的判据，后端重启后恒为零，答不了这个问题（方案 A1）。
   */
  function peekDbnumRow(dbno: number): DbnumRow | null {
    return peekGenModelV1Dbnums()?.response.dbnums?.find((item) => item.dbnum === dbno) ?? null;
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

  type DtxLoadResult = Awaited<ReturnType<typeof loadDbnoInstancesForVisibleRefnosDtx>>;

  function emptyLoadTotals(): GenModelV1LoadTotals {
    return { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, invalidTubi: 0, mesh404: 0, noGeo: 0, noGeoRefnos: [] };
  }

  /** 把 `add` 的合计并进 `target`（就地改 `target` 并回它） */
  function mergeLoadTotals(target: GenModelV1LoadTotals, add: GenModelV1LoadTotals): GenModelV1LoadTotals {
    target.loadedRefnos += add.loadedRefnos;
    target.skippedRefnos += add.skippedRefnos;
    target.loadedObjects += add.loadedObjects;
    target.invalidTubi += add.invalidTubi;
    target.mesh404 += add.mesh404;
    target.noGeo += add.noGeo;
    target.noGeoRefnos.push(...add.noGeoRefnos);
    return target;
  }

  function addLoadResult(totals: GenModelV1LoadTotals, result: DtxLoadResult): void {
    totals.loadedRefnos += result.loadedRefnos;
    totals.skippedRefnos += result.skippedRefnos;
    totals.loadedObjects += result.loadedObjects;
    totals.invalidTubi += result.invalidTubiObjects ?? 0;
    totals.mesh404 += result.missingBreakdown.mesh404Refnos.length;
    totals.noGeo += result.missingBreakdown.noGeoRowsRefnos.length;
    totals.noGeoRefnos.push(...result.missingBreakdown.noGeoRowsRefnos.map((r) => normalizeRefnoString(String(r ?? ''))));
  }

  type ProgressiveViewer = {
    __dtxViewer?: { canvas?: unknown }
    __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
    scene?: {
      objects?: Record<string, { visible?: boolean } | undefined>
      getAABB?: (ids: string[]) => unknown
      setObjectsVisible?: (ids: string[], visible: boolean) => void
    }
    cameraFlight?: { flyTo?: (options: { aabb?: unknown; duration?: number; fit?: boolean }) => void }
  };

  /**
   * 一次显示里「被叫停时要收回去」的账（加载中可以停，2026-11-11）：停 = 回到点之前的样子。
   * - `loadedKeys`：这一次新装进场景的构件（装载器回的 `loadedRefnoKeys`）——叫停时从场景里拿掉；
   * - `unhidden`：原来就装着、只是藏着，这一次改成显示的构件——叫停时藏回去。
   * 点之前就在屏幕上的构件（比如它下面某个 ZONE 先前单独显示过）不在这两本账里，原样留着。
   */
  type LoadUndoLog = {
    session: ModelLoadSession
    dbno: number
    loadedKeys: string[]
    unhidden: string[]
  };

  /** 把这些构件置为可见（「显示」= 保证可见）；其中原来装着但藏着的记进 `unhidden` */
  function showRefnosTracked(scene: ProgressiveViewer['scene'], ids: string[], undo: LoadUndoLog | null): void {
    const objects = undo ? scene?.objects : undefined;
    if (undo && objects) {
      for (const id of ids) {
        if (objects[id]?.visible === false && isDtxRefnoLoaded(undo.dbno, id)) undo.unhidden.push(id);
      }
    }
    scene?.setObjectsVisible?.(ids, true);
  }

  /** 记下一次装载新装进来的构件；装载器说它被叫停了（什么都没装）就回 `true` */
  function noteLoaderOutcome(undo: LoadUndoLog | null, result: DtxLoadResult): boolean {
    if (undo && result.loadedRefnoKeys) {
      for (const key of result.loadedRefnoKeys) undo.loadedKeys.push(key);
    }
    return result.cancelled === true;
  }

  /**
   * 加载被叫停：把这一次画出来的收回去。新装的构件从场景里拿掉（对象槽一起释放），这一次从隐藏改成显示的藏回去；
   * 记录和网格留在缓存里，再点眼睛只取没取完的。回拿掉了几个构件。
   */
  function withdrawStoppedLoad(undo: LoadUndoLog): number {
    const anyViewer = viewer as ProgressiveViewer & { __dtxLayer?: Parameters<typeof evictDtxRefnos>[0] };
    const layer = anyViewer?.__dtxLayer;
    const evicted = layer && undo.loadedKeys.length > 0
      ? evictDtxRefnos(layer, undo.dbno, undo.loadedKeys, { release: true })
      : [];
    if (undo.unhidden.length > 0) anyViewer?.scene?.setObjectsVisible?.(undo.unhidden, false);
    // 对象表变了：让拾取用的空间索引等跟着刷新
    if (evicted.length > 0) anyViewer?.__dtxAfterInstancesLoaded?.(undo.dbno, []);
    undo.loadedKeys = [];
    undo.unhidden = [];
    return evicted.length;
  }

  /** 边取边画在记录收齐那一刻的交接：哪些构件已经装了、装出了什么。 */
  type ProgressiveLoadOutcome = {
    /** 已经装进场景的构件（`a_b`）；收尾只装不在这里面的 */
    loadedRefnos: Set<string>
    totals: GenModelV1LoadTotals
  };

  type ProgressiveLoad = {
    /** 记录收齐了：不再开新批，等在装的那一批装完，交出已装的情况 */
    finish: () => Promise<ProgressiveLoadOutcome>
    /** 第一批到的时候飞过相机、之后用户又在视口里按过 / 滚过：收尾不该再把相机拽走。到收尾要飞的那一刻再问 */
    cameraTakenOverByUser: () => boolean
    /** 退订、停表、撤视口监听；可重复调 */
    dispose: () => void
  };

  /** 用户「动过视口」的信号：按下、滚轮、触摸。只在一次装载期间监听。 */
  const VIEW_TOUCH_EVENTS = ['pointerdown', 'wheel', 'touchstart'];

  /**
   * 边取边画（方案 2026-11-10 A3）：顶层 SITE 的记录是按 ZONE 拆开并行查的，记录源每收完一个成员就交一批
   *（`subscribeMemberRecords`）。这里不等整个节点收齐，按 `progressiveLoadPolicy` 的节奏把到了的构件先装进场景：
   * 第一批立刻装并重建，之后攒够翻倍、或离上一批够久再装。装载一次只跑一批（装载器对「已装」的判断不是并发安全的）。
   *
   * 这只是把装载**提前**：记录收齐后调用方 `finish()` 拿到「已装的构件」，剩下的仍由原来的收尾路径装完、对账、
   * 决定记不记「已加载」。某一批装载出错就停掉边取边画，那一批退回给收尾。一发查完的节点没有批次，等于没开。
   */
  function startProgressiveLoad(params: {
    root: string
    dbno: number
    dtxLayer: Parameters<typeof loadDbnoInstancesForVisibleRefnosDtx>[0]
    anyViewer: ProgressiveViewer
    flyTo: boolean
    cameraStamp: number
    onBatchLoaded: (shownRefnos: number) => void
    /** 被叫停时要收回去的账；装载带着会话的取消信号 */
    undo: LoadUndoLog
  }): ProgressiveLoad {
    const { root, dbno, dtxLayer, anyViewer, undo } = params;
    const pending = new Map<string, InstanceEntry[]>();
    const loaded = new Set<string>();
    const totals = emptyLoadTotals();
    let accepting = true;
    let failed = false;
    let running: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let batchesDone = 0;
    let lastBatchEndedAt = 0;
    let lastBatchMs = 0;
    let flew = false;
    let viewTouchedAfterFly = false;

    progressiveRoots.add(root);
    const canvas = anyViewer.__dtxViewer?.canvas as Partial<Pick<EventTarget, 'addEventListener' | 'removeEventListener'>> | undefined;
    const onViewTouched = () => { if (flew) viewTouchedAfterFly = true; };
    for (const name of VIEW_TOUCH_EVENTS) canvas?.addEventListener?.(name, onViewTouched, { capture: true, passive: true });

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    async function loadBatch(): Promise<void> {
      const batch = new Map(pending);
      pending.clear();
      const refnos = [...batch.keys()];
      const first = batchesDone === 0;
      const startedAt = performance.now();
      for (const refno of refnos) loaded.add(refno);
      try {
        // 「显示」= 保证可见（同收尾路径）：先把这一批的 refno 级可见态拉回 true，装完的回放才不会把它们再藏掉
        showRefnosTracked(anyViewer.scene, first ? uniqStrings([root, ...refnos]) : refnos, undo);
        const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, refnos, {
          lodAssetKey: 'L1',
          debug: false,
          dataSource: 'gen-model-v1',
          // 这一批的实例记录源已经交到手里了，直接带过去：不回头查缓存，缓存中途被清也不会逐个构件去问服务端
          instanceEntriesByRefno: batch,
          recompile: true,
          signal: undo.session.signal,
        });
        if (noteLoaderOutcome(undo, result)) {
          // 被叫停：这一批什么都没装，不算已装；不再开新批（收回去由显示流程统一做）
          for (const refno of refnos) loaded.delete(refno);
          accepting = false;
          return;
        }
        anyViewer.__dtxAfterInstancesLoaded?.(dbno, refnos);
        addLoadResult(totals, result);
        batchesDone += 1;
        if (first && params.flyTo) {
          try {
            const aabb = anyViewer.scene?.getAABB?.(refnos.length > 5000 ? refnos.slice(0, 5000) : refnos) ?? null;
            if (aabb && isCameraIntentCurrent(params.cameraStamp)) {
              anyViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
              flew = true;
            }
          } catch {
            // ignore flyTo errors
          }
        }
        params.onBatchLoaded(loaded.size);
      } catch (e) {
        // 这一批没装成：退回给收尾（装载器会跳过其中已经装上的），之后不再边取边画
        failed = true;
        for (const refno of refnos) loaded.delete(refno);
        consoleStore.addLog(
          'warning',
          `[model-load] 边取边画 ${root}：一批 ${refnos.length} 个构件装载出错，改为收齐后一起装 err=${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        lastBatchEndedAt = performance.now();
        lastBatchMs = lastBatchEndedAt - startedAt;
      }
    }

    function pump(): void {
      if (!accepting || failed || running || undo.session.stopped) return;
      clearTimer();
      const state = {
        pending: pending.size,
        loaded: loaded.size,
        sinceLastBatchMs: performance.now() - lastBatchEndedAt,
        lastBatchMs,
      };
      if (shouldLoadProgressiveBatch(state)) {
        running = loadBatch().finally(() => {
          running = null;
          pump();
        });
        return;
      }
      const wait = progressiveBatchWaitMs(state);
      if (wait !== null) timer = setTimeout(pump, wait);
    }

    // 记录源没有这个能力（测试里的简化源）就等于没开：全部构件由收尾路径装
    const unsubscribe = getModelSource().records.subscribeMemberRecords?.((batch) => {
      if (!accepting || failed || batch.refno !== root) return;
      for (const [refno, entries] of batch.entries) {
        const key = normalizeRefnoString(refno);
        if (key && !loaded.has(key)) pending.set(key, entries);
      }
      pump();
    });

    let disposed = false;
    function dispose(): void {
      if (disposed) return;
      disposed = true;
      accepting = false;
      clearTimer();
      progressiveRoots.delete(root);
      unsubscribe?.();
      for (const name of VIEW_TOUCH_EVENTS) canvas?.removeEventListener?.(name, onViewTouched, { capture: true });
    }

    async function finish(): Promise<ProgressiveLoadOutcome> {
      // 不再开新批；在装的那一批让它装完（装到一半停不下来，也不该和收尾并行装）
      accepting = false;
      clearTimer();
      unsubscribe?.();
      if (running) await running;
      return { loadedRefnos: loaded, totals };
    }

    return { finish, cameraTakenOverByUser: () => flew && viewTouchedAfterFly, dispose };
  }

  /**
   * gen-model-v1：把记录源缓存里的构件装进 DTX。超过一页（`VISIBLE_REFNOS_PAGE_SIZE`）就按 `planLoadBatchSizes` 分批，
   * 进度在 `progressRange` 里按已装 refno 数走，每批之间让出一帧（P3-c 分批 + 进度）。`replace`（右键重新生成之后的替换）
   * **不分批**：它要 forceRefresh，分了批每一批都会把同一个根再查一遍。生成已经在进这里之前做完，装载本身不再 generate。
   */
  async function loadGenModelV1Refnos(
    dtxLayer: any,
    dbno: number,
    refnos: string[],
    anyViewer: { __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void },
    mode: {
      replace: boolean
      /** 不分批：边取边画之后的收尾用——场景里已经有东西了，不需要「先出 1000 个」，一批装完少跑几轮重建与回放钩子 */
      singleBatch?: boolean
      /**
       * 整套替换时：这些构件的记录刚按祖先重新查过（重载），或刚生成完查回来（重新生成），缓存里已经是最新的——
       * 直接交给装载器，不让它逐个构件清掉重问（2026-11-11：一个 1888 件的 ZONE 重载要多发 1708 个请求、多等 4 秒）。
       * 不在这里面的（并进来的 BRAN / HANG 根、叶子构件的属主 BRAN）照旧清掉重问。不给就全部清掉重问。
       */
      freshRefnos?: ReadonlySet<string>
    },
    progressRange: [number, number],
    label: string,
    /** 加载中可以停：装载带着会话的取消信号，新装的构件记进账；被叫停就抛 `ModelLoadStoppedError`。不给就是不能停的装载 */
    undo: LoadUndoLog | null = null,
  ): Promise<GenModelV1LoadTotals> {
    const totals = emptyLoadTotals();
    const sizes = mode.replace || mode.singleBatch ? [refnos.length] : planLoadBatchSizes(refnos.length);
    if (sizes.length === 0) sizes.push(0);
    const batches = sizes.length;
    let offset = 0;
    for (let index = 0; index < batches; index++) {
      const batch = refnos.slice(offset, offset + sizes[index]!);
      if (batches > 1) {
        totalCount.value = refnos.length;
        currentIndex.value = Math.min(refnos.length, offset + batch.length);
        currentRefno.value = '';
        statusMessage.value = `${label}：装入第 ${index + 1}/${batches} 批（${currentIndex.value}/${refnos.length} 个 refno）...`;
        progress.value = progressRange[0] + Math.floor((offset / refnos.length) * (progressRange[1] - progressRange[0]));
        syncGlobalLoadStatus();
      }
      offset += batch.length;
      let freshEntries: Map<string, InstanceEntry[]> | null = null;
      if (mode.replace && mode.freshRefnos) {
        const fresh = mode.freshRefnos;
        const records = getModelSource().records;
        freshEntries = new Map(await records.instanceEntriesByRefnos(dbno, batch.filter((refno) => fresh.has(refno))));
        const others = batch.filter((refno) => !fresh.has(refno));
        if (others.length > 0) {
          for (const [key, entries] of await records.instanceEntriesByRefnos(dbno, others, { forceRefresh: true })) {
            freshEntries.set(key, entries);
          }
        }
        undo?.session.throwIfStopped();
      }
      const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, batch, {
        lodAssetKey: 'L1',
        debug: false,
        dataSource: 'gen-model-v1',
        forceReloadRefnos: mode.replace ? batch : undefined,
        replaceExistingObjects: mode.replace,
        forceRefreshGeometries: mode.replace,
        recompile: batches === 1 || index === 0 || index + 1 === batches,
        ...(freshEntries ? { instanceEntriesByRefno: freshEntries } : {}),
        ...(undo ? { signal: undo.session.signal } : {}),
      });
      // 整套替换的那一次不进「新装的」账：被叫停时它要么还没开始换（什么都没动），要么已经换完了
      if (noteLoaderOutcome(mode.replace ? null : undo, result)) throw new ModelLoadStoppedError(undo?.session.root ?? '');
      anyViewer.__dtxAfterInstancesLoaded?.(dbno, batch);
      addLoadResult(totals, result);
      if (index + 1 < batches) {
        await sleep(0);
        undo?.session.throwIfStopped();
      }
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
    // 撤下的对象真的从图层里拿掉（2026-11-11，只隐藏的话对象槽只增不减）；对象表变了，派生索引跟着刷新
    const evicted = dtxLayer ? evictDtxRefnos(dtxLayer, dbno, targets, { release: true }) : [];
    anyViewer?.scene?.setObjectsVisible?.(targets, false);
    if (evicted.length > 0) anyViewer?.__dtxAfterInstancesLoaded?.(dbno, []);
    loadedRoots.delete(root);
    loadedRefnosByRoot.delete(root);
    forgetLoadedNode(root);
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

  /**
   * 「取最新」发起的重载查空时的护栏。后端重启之后，模型按需生成的库（未初始化）里什么模型都没有，按祖先查记录
   * 照样是「查空且收齐」——那不是被删了，不能把场景里的东西撤掉。所以动手撤之前问一次节点模型状态：只有后端明说
   * 这个节点的单元都生成过（`latest` / `lagging`）、它名下确实没有生成单元（`empty`）、或库里已经没有这个节点
   * （`REFNO_NOT_FOUND`）才当成「没有几何了」；没生成、只生成了一部分、库在更新、判不了、问不到，一律保持原样。
   */
  async function emptyRefreshMeansRemoved(root: string): Promise<{ removed: boolean; why: string }> {
    try {
      const facts = await withTimeout(fetchNodeModelFacts({ refno: root }), NODE_UPDATE_FACTS_TIMEOUT_MS, '节点模型状态');
      if (!facts) return { removed: false, why: '后端没有节点模型状态接口，确认不了它是不是真的没有几何了' };
      if (facts.verdict === 'latest' || facts.verdict === 'lagging' || facts.verdict === 'empty') return { removed: true, why: '' };
      return {
        removed: false,
        why: facts.verdict === 'updating' ? '所在的库正在更新' : '后端现在没有这个节点的完整模型（可能重启过，或还没生成）',
      };
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === 'REFNO_NOT_FOUND') return { removed: true, why: '' };
      return { removed: false, why: `节点模型状态没问到（${e instanceof Error ? e.message : String(e)}）` };
    }
  }

  /** 节点所在的库：与显示流程同一个口径（调用方钉了库号就用它，否则按 refno 查映射） */
  function dbnoOfRoot(root: string): number | null {
    return typeof options.db_num === 'number' ? options.db_num : tryGetDbnumByRefno(root);
  }

  /**
   * 库里已经没有这个节点了（「取最新」问到 `REFNO_NOT_FOUND`）：它和它名下的构件从场景撤下、不再算已加载。
   * 不发请求、不出提示（取最新自己汇总成一句）。回撤下的构件数。
   */
  function withdrawRemovedRoot(refno: string): number {
    const root = normalizeRefnoString(refno);
    if (!root) return 0;
    const dbno = dbnoOfRoot(root);
    const cached = getGenModelV1ModelSource().records.invalidateRoot(root).map((r) => normalizeRefnoString(r)).filter(Boolean);
    const targets = uniqStrings([
      root,
      ...cached,
      ...(dbno != null ? resolveDtxRefnosByUnitRefno(dbno, root) : []),
      ...(loadedRefnosByRoot.get(root) ?? []),
    ]);
    let evicted: string[] = [];
    if (dbno != null) {
      const anyViewer = viewer as any;
      const dtxLayer = anyViewer?.__dtxLayer;
      evicted = dtxLayer ? evictDtxRefnos(dtxLayer, dbno, targets, { release: true }) : [];
      anyViewer?.scene?.setObjectsVisible?.(targets, false);
      if (evicted.length > 0) anyViewer?.__dtxAfterInstancesLoaded?.(dbno, []);
    }
    loadedRoots.delete(root);
    loadedRefnosByRoot.delete(root);
    forgetLoadedNode(root);
    consoleStore.addLog('info', `[model-load] 取最新：${root} 在库里已经没有了，撤下 ${targets.length} 个 refno（${evicted.length} 个有对象）`);
    return evicted.length;
  }

  /** 这个节点现在装着哪些构件（「取最新」比对重载前后用）；不知道回 `null`。 */
  function loadedRefnosOf(refno: string): string[] | null {
    const root = normalizeRefnoString(refno);
    const known = loadedRefnosByRoot.get(root);
    if (known) return [...known];
    const dbno = dbnoOfRoot(root);
    const viaUnit = dbno != null ? resolveDtxRefnosByUnitRefno(dbno, root) : [];
    return viaUnit.length > 0 ? uniqStrings(viaUnit) : null;
  }

  /** 这个节点（或它名下装过的构件）还在不在场景里：别处已经撤掉的，「取最新」不该把它装回来。 */
  function isRootInScene(refno: string): boolean {
    const root = normalizeRefnoString(refno);
    if (!root) return false;
    if (loadedRoots.has(root)) return true;
    const dbno = dbnoOfRoot(root);
    if (dbno == null) return false;
    if (isDtxRefnoLoaded(dbno, root)) return true;
    if (resolveDtxRefnosByUnitRefno(dbno, root).length > 0) return true;
    for (const member of loadedRefnosByRoot.get(root) ?? []) {
      if (isDtxRefnoLoaded(dbno, member)) return true;
    }
    return false;
  }

  /** 重载装完之后：重载前在这根名下、最新记录里已经没有的构件（数据批次删掉的成员）从场景撤下；根自己不撤。 */
  function evictMembersMissingFromRefresh(dbno: number, root: string, previousLeaves: string[], loadRefnos: string[]): void {
    const keep = new Set([root, ...loadRefnos]);
    const stale = previousLeaves.filter((refno) => !keep.has(refno));
    if (stale.length === 0) return;
    const anyViewer = viewer as any;
    const dtxLayer = anyViewer?.__dtxLayer;
    // 同上：撤下的对象从图层里拿掉，派生索引跟着刷新
    const evicted = dtxLayer ? evictDtxRefnos(dtxLayer, dbno, stale, { release: true }) : [];
    anyViewer?.scene?.setObjectsVisible?.(stale, false);
    if (evicted.length > 0) anyViewer?.__dtxAfterInstancesLoaded?.(dbno, []);
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
      /**
       * 行上的「生成」（显式补齐，方案 B3）：节点已经显示了，但它下面还有没有模型的部分——不走「已在场景就跳过」的捷径，
       * 重新查一遍范围，把没有模型的块生成并显示。不带 force，不动已有的模型。
       */
      fill?: boolean
      /**
       * 行上的「更新」，节点一级（方案第 12 节）：节点落后，而它所在的库没有库一级的更新可走（模型按需生成，或不在
       * 后端的更新范围里）。先让后端把这个节点下的单元按库文件最新会话重新生成，再照「重载」那条路把屏幕上的换掉。
       * 生成走哪条路、要不要先问，按后端此刻的节点模型状态定（`nodeModelUpdate.decideNodeUpdate`）。
       */
      update?: boolean
      /**
       * 「取最新」发起的重载：记录查空时不直接当成「被删了」，先问后端这个节点的模型状态再决定撤不撤
       * （见 `emptyRefreshMeansRemoved`）。别的重载入口（状态栏、行上的「重载」）不带，行为照旧。
       */
      confirmEmpty?: boolean
    }
  ): Promise<boolean> {
    const normalizedRoot = normalizeRefnoString(refno);
    if (!normalizedRoot) return false;
    const update = loadOptions?.update === true;
    // 节点一级的更新，后一半就是重载：清本地记录缓存、重查、整套替换、撤下已不在的构件
    const refresh = loadOptions?.refresh === true || update;
    const explicitFill = loadOptions?.fill === true;
    // 相机意图戳：本次加载要飞的话，加载前盖一次；落地时核对，期间用户点了别处就不动相机。
    const cameraStamp = loadOptions?.flyTo ? beginCameraIntent() : 0;

    const genuinelyLoaded = loadedRoots.has(normalizedRoot);
    if (!loadOptions?.regenerate && !refresh && !explicitFill && checkRefnoExists(normalizedRoot)) {
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
              // 先用显示时查到的那份记录定范围（记录源里有备忘，通常一个请求都不发；备忘被清了也只是按成员再查一遍记录）。
              // 2026-11-11 之前这里直接逐节点 BFS 子树：已加载的 SITE 隐藏后再显示要发 512 个 `tree` 请求，只为算一个包围盒。
              // 记录查不通时 `queryLoadScopeRefnos` 自己会退到子树查询；查通了却是空的（不该发生）再退一次。
              const scope = await queryLoadScopeRefnos(normalizedRoot);
              const refnos = scope.refnos.length > 0 ? scope.refnos : (await querySubtreeRefnos(normalizedRoot)).refnos;
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
    // 加载会话（加载中可以停，2026-11-11）：行尾的转圈和状态条经它叫停这一次显示。右键「重新生成模型」不能停——
    // 后端已经在清旧模型、算新模型，前端停下来只会留下一个对不上的场景。
    const session = beginModelLoadSession(normalizedRoot, { stoppable: loadOptions?.regenerate !== true });
    const undo: LoadUndoLog = { session, dbno: 0, loadedKeys: [], unhidden: [] };
    /** 这一次显示里把节点记成了「已加载」（被叫停时要不要撤掉看它） */
    let markedLoadedHere = false;
    /** 后端对这个节点的生成预检（补齐之前问到的）；没问、没问到、服务端没有那个接口为 `null` */
    let rootFacts: GenerationUnitFacts | null = null;
    modelLoadStatus.begin({
      progress: progress.value,
      message: statusMessage.value,
      currentRefno: currentRefno.value,
      stopKey: normalizedRoot,
    });

    // 边取边画已经装进场景的构件数（状态条上带一句，让人知道模型是一块块长出来的）
    let shownEarly = 0;
    // 模型资产补齐在跑（方案 B3）：进度由分块执行自己写状态条，记录源的逐根进度不理会，也不弹整屏遮罩——
    // 遮罩会把「做完一块显示一块」的模型挡在后面
    let fillRunning = false;
    // gen-model-v1：范围查询里那次按祖先查 records 的进度只能从记录源听。
    // 整屏遮罩只在**生成**阶段弹（多根时）。读记录（collect）不弹：遮罩会把边取边画出来的模型挡在后面，
    // 读记录的进度走查看器左下角的状态条就够了（方案 A3；词汇表「上下文生成进度」本来也不要阻塞式弹窗）。
    const unsubscribeProgress = subscribeModelSourceProgress(({ done, total, root, stage }) => {
      if (fillRunning) return;
      totalCount.value = total;
      currentIndex.value = Math.min(total, done + 1);
      currentRefno.value = root;
      const generating = stage === 'generate-start' || stage === 'generate';
      statusMessage.value = stage === 'generate-start'
        ? `正在生成构件 ${root}（${done + 1}/${total}）`
        : stage === 'generate'
          ? `已生成 ${done}/${total} 个生成根`
          : `gen-model 查询记录：${done}/${total} 个生成根${shownEarly > 0 ? `，已显示 ${shownEarly} 个构件` : ''}`;
      progress.value = 10 + Math.floor((done / Math.max(1, total)) * 20);
      if (total > 1 && generating) showProgressModal.value = true;
      syncGlobalLoadStatus();
    });
    // 多批装载期间不补拉粗网格：补拉的请求与 recompile 会插进批与批之间，和本次装载抢连接与主线程
    const releaseLod1Backfill = holdDtxLod1Backfill();
    let stopRecordPageListener: (() => void) | null = null;
    let progressiveLoad: ProgressiveLoad | null = null;

    /** 节点一级的更新：后端这一次做了什么（收尾时写进提示）；没走到生成为 `null` */
    let updateReport: { level: 'success' | 'info' | 'warning'; message: string } | null = null;
    /**
     * 节点一级的更新里，生成请求已经发出去过（后端那边可能已经换了一部分、甚至全部）。之后没能把屏幕上的换掉
     * （被叫停、后端还在后台算）时，要在已加载节点表里记一笔「本页装的不是后端现在的那一版」。
     */
    let updateSentToBackend = false;
    /**
     * 节点一级的「更新到最新」的前一半：让后端把这个节点下的单元按库文件最新会话重新生成。
     * 回 `true` = 接着照「重载」那条路把屏幕上的换掉；回 `false` = 不做了（取消、没做成），场景保持原样。
     * 被叫停时抛 `ModelLoadStoppedError`（由显示流程的收尾统一处理）。
     */
    const runNodeUpdate = async (dbno: number, listChildren: (parent: string) => Promise<GenerationTreeNode[]>): Promise<boolean> => {
      const records = getGenModelV1ModelSource().records;
      const leave = (level: 'info' | 'warning', message: string, recheck: boolean): false => {
        statusMessage.value = `refno=${normalizedRoot} 没有更新`;
        progress.value = 100;
        syncGlobalLoadStatus();
        consoleStore.addLog(level === 'warning' ? 'warning' : 'info', `[model-load] 更新 ${normalizedRoot}：${message}`);
        emitToast({ message: `[${level === 'warning' ? '警告' : '提示'}] ${normalizedRoot}：${message}`, level });
        if (recheck) recheckLoadedNode(normalizedRoot);
        return false;
      };
      // 动手之前重新问一次后端（不用行上那份旧的）：有没有单元被删决定走哪条路
      statusMessage.value = `正在核对 ${normalizedRoot} 的模型状态...`;
      progress.value = 3;
      syncGlobalLoadStatus();
      let facts: NodeModelFacts | null;
      try {
        facts = await withTimeout(
          fetchNodeModelFacts({ refno: normalizedRoot, signal: session.signal }),
          NODE_UPDATE_FACTS_TIMEOUT_MS,
          `节点模型状态 ${normalizedRoot}`,
        );
      } catch (e) {
        if (session.stopped) throw e;
        return leave('warning', `没有问到后端的节点模型状态（${e instanceof Error ? e.message : String(e)}），没有更新`, false);
      }
      session.throwIfStopped();
      const decision = decideNodeUpdate({ facts, purgeKeepsShared: backendMeshPurgeKeepsShared() });
      if (decision.kind === 'abort') return leave(decision.level, decision.message, decision.recheck);
      if (decision.kind === 'reload') {
        consoleStore.addLog('info', `[model-load] 更新 ${normalizedRoot}：${decision.message}`);
        updateReport = { level: 'info', message: decision.message };
        return true;
      }
      if (decision.confirm) {
        statusMessage.value = `等待确认：更新 ${normalizedRoot}`;
        syncGlobalLoadStatus();
        const choice = await useConfirmDialogStore().openChoice({
          title: decision.confirm.title,
          message: decision.confirm.message,
          choices: [{ id: 'update', text: decision.confirm.confirmText }],
          cancelText: decision.confirm.cancelText,
        });
        session.throwIfStopped();
        if (choice !== 'update') return leave('info', '已取消更新，模型保持现在的样子', false);
      }

      if (decision.kind === 'regenerate') {
        // 有单元被删：先清后生成（同右键「重新生成模型」）。后端一开始清就停不了了。
        session.setStoppable(false);
        statusMessage.value = `正在重新生成 ${normalizedRoot}（有单元被删，先清后生成）...`;
        progress.value = 5;
        syncGlobalLoadStatus();
        consoleStore.addLog(
          'info',
          `[model-load] 更新 ${normalizedRoot}：${decision.unitsRemoved} 个单元已被删，先清后生成（带 force），共 ${decision.unitsTotal} 个单元`,
        );
        updateSentToBackend = true;
        const generated = await records.generateThenCollect(normalizedRoot, { force: true });
        if (generated.items.length === 0) {
          const timedOut = generated.pending.length > 0;
          if (timedOut) scheduleDbnumModelReprobe(dbno);
          const failed = Object.entries(generated.errors).map(([root, message]) => `${root}: ${message}`).join('; ');
          // 范围内的旧模型后端已经清掉了，屏幕上还是旧的：记一笔，后端做完之后行上给「重载」
          markLoadedNodeStale(normalizedRoot, '后端已经重新生成，屏幕上还是原来的');
          recheckLoadedNodeLater(normalizedRoot, STOPPED_FILL_RECHECK_DELAYS_MS);
          return leave(
            'warning',
            timedOut
              ? '后端还在后台重新生成（范围内的旧模型已清掉），做完之后行上会给「重载」'
              : `重新生成没有产出可显示的模型（${failed || generated.hints?.[generated.refno] || '没有新产物'}）；屏幕上还是原来的`,
            true,
          );
        }
        noteDbnumModelGenerated(dbno);
        updateReport = { level: 'success', message: `有 ${decision.unitsRemoved} 个单元被删，已先清后生成 ${decision.unitsTotal} 个单元` };
        return true;
      }

      // 不带 force：后端逐根核对，不是库文件最新会话的重新生成，已是最新的跳过；不清几何。SITE 一个 ZONE 一块。
      const plan = await planNodeUpdateChunks({
        root: normalizedRoot,
        rootNoun: facts?.noun ?? null,
        unitsTotal: decision.unitsTotal,
        thresholdUnits: decision.thresholdUnits,
        listChildren,
      });
      session.throwIfStopped();
      const whole = isWholeNodePlan(plan);
      consoleStore.addLog(
        'info',
        `[model-load] 更新 ${normalizedRoot}：不带 force 重新生成落后的单元（共 ${decision.unitsTotal} 个单元，其中 ${decision.unitsLagging} 个被改到）`
          + (whole ? '' : `，分 ${plan.chunks.length} 块`),
      );
      let summary: GenerationFillSummary | null = null;
      let failure: unknown = null;
      fillRunning = true;
      showProgressModal.value = false;
      try {
        summary = await runGenerationFill({
          plan,
          generateChunk: async (chunk) => {
            updateSentToBackend = true;
            // 带着会话的取消信号：叫停时这一发请求当场取消（后端那边照常算完）
            return chunkResultFromCollect(chunk.refno, await records.generateThenCollect(chunk.refno, { force: false, signal: session.signal }));
          },
          // 屏幕上的等全部核对完再整套换（重载那条路），这里不装
          loadChunk: async () => {},
          onProgress: (step) => {
            const units = `已核对 ${step.unitsDone} / ${plan.exact ? '' : '约 '}${step.unitsTotal} 个单元`;
            const where = whole ? normalizedRoot : `第 ${step.chunkIndex + 1}/${step.chunkCount} 块`;
            const reason = String(step.reason ?? '');
            statusMessage.value = step.phase === 'waiting'
              ? `${where}：${reason.length > 24 ? `${reason.slice(0, 24)}…` : reason}，`
                + `${Math.round((step.waitMs ?? 0) / 1000)} 秒后自动再问（已问 ${step.attempt} 次）· ${units}`
              : `正在更新 ${where}（落后的单元重新生成）· ${units}`;
            totalCount.value = step.chunkCount;
            currentIndex.value = step.chunkIndex + 1;
            currentRefno.value = step.chunk.name && step.chunk.name !== step.chunk.refno
              ? `${step.chunk.name} · ${step.chunk.refno}`
              : step.chunk.refno;
            progress.value = Math.min(28, 5 + Math.floor((step.unitsDone / Math.max(1, step.unitsTotal)) * 23));
            syncGlobalLoadStatus();
          },
          shouldStop: () => session.stopped,
          sleep,
        });
      } catch (e) {
        failure = e;
      } finally {
        fillRunning = false;
      }
      // 被叫停：没发的块不再发，在飞的那一发后端照常算完。屏幕上的不动，由显示流程的收尾记账
      if (session.stopped || summary?.stopped) throw new ModelLoadStoppedError(normalizedRoot);
      if (failure || !summary) {
        const em = failure instanceof Error ? failure.message : String(failure ?? '没有结果');
        if (!updateSentToBackend) return leave('warning', `更新没有做成：${em}`, true);
        // 做了一部分才出错：后端那边已经换了一部分，屏幕上跟着换
        updateReport = { level: 'warning', message: `更新中途出错（${em}），后端已经做完的部分换到屏幕上` };
        return true;
      }
      if (summary.outcomes.some((outcome) => outcome.state === 'pending')) scheduleDbnumModelReprobe(dbno);
      if (summary.unitsDone > 0) noteDbnumModelGenerated(dbno);
      updateReport = describeNodeUpdateSummary(summary);
      return true;
    };

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
      undo.dbno = dbno;
      session.throwIfStopped();

      const levelTag = { success: '成功', info: '提示', warning: '警告' } as const;
      /** 一个节点的子节点（生成预检、分块时取成员的名字和类型） */
      const listGenerationChildren = async (parent: string): Promise<GenerationTreeNode[]> => {
        const resp = await getModelSource().tree.children(parent);
        if (!resp.success) throw new Error(resp.error_message || 'tree children 查询失败');
        return resp.children.map((child) => {
          const key = normalizeRefnoString(String(child.refno ?? ''));
          return {
            refno: key,
            noun: String(child.noun ?? ''),
            name: String(child.name ?? '') || key,
            childrenCount: typeof child.children_count === 'number' ? child.children_count : null,
          };
        });
      };

      // ---------- 节点一级的「更新到最新」的前一半（方案第 12 节；用户 2026-11-11 定：现在就加）----------
      // 这个库没有库一级的更新可走（模型按需生成 / 不在后端的更新范围里）：让后端把这个节点下的单元按库文件最新会话
      // 重新生成。做完往下走的就是「重载」那条路。
      if (update) {
        const proceed = await runNodeUpdate(dbno, listGenerationChildren);
        if (!proceed) return false;
        // 后端那边已经是新的了，屏幕上还没换：先记一笔。下面的重载做成了会重新登记这个节点（这一笔随之清掉）；
        // 没做成（记录没查通、被叫停、出错）这一笔留着，后端说「最新」时行上给「重载」。
        if (updateSentToBackend) markLoadedNodeStale(normalizedRoot, '后端已经重新生成，屏幕上还没换上');
        session.throwIfStopped();
      }

      // 「装的时候是哪一版」：开始取数之前读到的库水位（已加载节点表按它判「有更新可重载」）。取早不取晚——
      // 装的过程中后端正好跑完一个批次时，宁可之后多提示一次，不能漏掉。
      const rowAtStart = peekDbnumRow(dbno);
      const loadWatermark = {
        modelSesno: typeof rowAtStart?.model_sesno === 'number' ? rowAtStart.model_sesno : null,
        fileLatestSesno: typeof rowAtStart?.file_latest_sesno === 'number' ? rowAtStart.file_latest_sesno : null,
      };

      const prefetchLayer = (viewer as { __dtxLayer?: Parameters<typeof prefetchDtxGeometries>[0] }).__dtxLayer ?? null;
      const meshPrefetches: Promise<unknown>[] = [];
      stopRecordPageListener = prefetchLayer
        ? pushRecordPageListener((items) => {
          const hashes: string[] = [];
          const seen = new Set<string>();
          for (const item of items) {
            for (const inst of item.insts ?? []) {
              const hash = String(inst.geo_hash ?? '').trim();
              if (!hash || seen.has(hash)) continue;
              seen.add(hash);
              hashes.push(hash);
            }
          }
          if (hashes.length > 0 && !session.stopped) {
            meshPrefetches.push(prefetchDtxGeometries(prefetchLayer, dbno, hashes, 'L1', session.signal));
          }
        })
        : null;

      const regenerate = loadOptions?.regenerate === true;
      if (regenerate) {
        statusMessage.value = `正在重新生成 ${normalizedRoot}...`;
        progress.value = 5;
        syncGlobalLoadStatus();
        // 右键「重新生成模型」是唯一带 force 的入口：先把范围内已有的模型清掉再逐根生成
        const generated = await getGenModelV1ModelSource().records.generateThenCollect(normalizedRoot, { force: true });
        if (generated.items.length === 0) {
          const timedOut = generated.pending.length > 0;
          if (timedOut) scheduleDbnumModelReprobe(dbno);
          const failed = Object.entries(generated.errors).map(([root, message]) => `${root}: ${message}`).join('; ');
          const hint = timedOut
            ? '服务端后台继续生成，完成后再点眼睛'
            : (failed || generated.hints?.[generated.refno] || '没有可显示的新产物');
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
        // 这两份都只认得到生成根为止的属主链：节点是容器（SITE / ZONE）时，再并上「这个节点上一次装了哪些构件」。
        previousLeaves = uniqStrings([
          ...previousLeaves,
          ...resolveDtxRefnosByUnitRefno(dbno, normalizedRoot),
          ...(loadedRefnosByRoot.get(normalizedRoot) ?? []),
        ]);
      }
      // 根的 typeInfo 只依赖根：与范围查询并行发出，定装载范围时再取
      const rootTypeInfo = Promise.resolve().then(() => getModelSource().attributes.typeInfo(normalizedRoot));
      rootTypeInfo.catch(() => undefined);
      // 边取边画：普通显示才开（重新生成 / 重载是整套替换，要等记录收齐才知道换成什么）。
      // 同一个节点已经有一路在边取边画（别的入口 / 别的 useModelGeneration 实例）时不再开第二路：两路会同时去装同一批构件。
      if (!regenerate && !refresh && prefetchLayer && !progressiveRoots.has(normalizedRoot)) {
        progressiveLoad = startProgressiveLoad({
          root: normalizedRoot,
          dbno,
          dtxLayer: prefetchLayer,
          anyViewer: viewer as ProgressiveViewer,
          flyTo: loadOptions?.flyTo === true,
          cameraStamp,
          onBatchLoaded: (shown) => { shownEarly = shown; },
          undo,
        });
      }
      let earlyLoad: ProgressiveLoadOutcome | null = null;
      statusMessage.value = '查询可见实例范围...';
      progress.value = 10;
      syncGlobalLoadStatus();
      let visibleOk = false;
      let visibleErr: string | null = null;
      let visibleRefnos: string[] = [];
      let visibleSource: 'visible-insts' | 'subtree-refnos' = 'visible-insts';
      // gen-model-v1：这次按祖先查询有没有收齐。没收齐的节点不进 loadedRoots：下一次普通显示还要能再查
      let scopeIncomplete: VisibleInstsIncomplete | null = null;
      // 查过、一条记录都没有的范围（节点自己，或它没有记录的 ZONE）：模型资产补齐按它分块
      let emptyScopes: string[] = [];
      // 叫停时当场取消那次共用的记录读取（它不认会话的信号）；收齐的成员留在缓存里，再点眼睛只问没收齐的
      const stopRecordsRead = session.onStop(() => { getModelSource().records.cancelCollect?.(normalizedRoot); });
      try {
        const { refnos, source, truncated, incomplete, emptyScopes: empty } = await queryLoadScopeRefnos(
          normalizedRoot,
          { isStopped: () => session.stopped },
        );
        visibleRefnos = refnos;
        visibleSource = source;
        scopeIncomplete = incomplete;
        emptyScopes = empty;
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
        if (meshPrefetches.length > 0) await Promise.all(meshPrefetches);
      } catch (e) {
        // 被叫停的不是查询失败：直接到收尾那里把已经画出来的收回去
        if (session.stopped) throw e;
        visibleOk = false;
        visibleErr = e instanceof Error ? e.message : String(e);
        visibleRefnos = [];
      } finally {
        stopRecordsRead();
      }
      // 记录收齐（或查询失败）：边取边画到此为止，等在装的那一批装完；剩下的由下面的收尾路径装
      if (progressiveLoad) earlyLoad = await progressiveLoad.finish();
      session.throwIfStopped();
      const incompleteTail = scopeIncomplete ? describeVisibleInstsIncomplete(scopeIncomplete) : '';
      consoleStore.addLog(
        'info',
        `[model-load] load_scope_refnos ok=${visibleOk ? 1 : 0} source=${visibleSource} refno=${normalizedRoot} dbno=${dbno} count=${visibleRefnos.length}` +
          (scopeIncomplete ? ` incomplete=${incompleteTail}` : '') +
          (visibleErr ? ` err=${visibleErr}` : '')
      );
      // ---------- 模型资产补齐（方案 B1 / B3；ADR 0072 第 3 条）----------
      // 只有「记录查询成功、收齐」才补，而且只补查过、确实一条记录都没有的范围（节点自己，或它没有记录的 ZONE），
      // 不按类型白名单过滤。记录查询失败、没收齐时一律不生成——那不是「没有模型」。
      // 补齐**不带 force**：服务端只生成缺的 / 落后的根，已有的回 `AlreadyAvailable`；带 force 会先把范围内已有的模型
      // 连同网格清掉再算（gen-model 规范 §4.5「显示补齐不要传」）。
      // 先做生成预检（大约多少个单元）：超过阈值先让人确认；然后一块一块生成，回 504 / 409 自动接着问，做完一块显示一块。
      // 真产不出（NoRenderableGeometry / 确定性的失败）的范围本页面里不再自动重发，照旧给提示。
      const fillViewer = viewer as unknown as {
        __dtxLayer?: unknown
        __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void
        scene?: {
          objects?: Record<string, { visible?: boolean } | undefined>
          ensureRefnos?: (ids: string[], options?: { computeAabb?: boolean }) => void
          getAABB?: (ids: string[]) => unknown
          setObjectsVisible?: (ids: string[], visible: boolean) => void
        }
        cameraFlight?: { flyTo?: (options: { aabb?: unknown; duration?: number; fit?: boolean }) => void }
      };
      /** 分块生成已经装进场景的构件与合计（一个模型都没有的节点：交给收尾路径对账） */
      const fillLoaded = new Set<string>();
      const fillTotals = emptyLoadTotals();
      let fillRan = false;
      let fillFlew = false;
      const unitsLabel = (plan: Pick<GenerationPlan, 'units' | 'exact'>): string => `${plan.exact ? ' ' : '约 '}${plan.units} 个单元`;

      /**
       * 这次能不能补、补哪几块。`existingShown`：这个节点已经有一部分模型显示出来了。
       * 回 `null` = 不补（不该补、没有可补的范围、或者数下来没有东西可生成）。
       */
      const prepareFill = async (existingShown: boolean): Promise<GenerationPlan | null> => {
        if (regenerate || refresh || fillRan) return null;
        if (!visibleOk || visibleSource !== 'visible-insts' || scopeIncomplete) return null;
        const row = peekDbnumRow(dbno);
        if (dbnumEmptyQueryCaveat(row)) return null;
        // 库的三枚水位对齐（数据、模型都追到了库文件最新）、这个节点又已经有模型显示出来：缺单元只可能是上次生成失败的，
        // 行上的状态会说出来并给「生成」。显示不为它多等一次后端的预检（一次显示几十个节点时每个都要多等一发）。
        // 人点「生成」时照问。
        if (existingShown && !explicitFill && row && judgeDbnumFreshness(row).kind === 'latest') return null;
        // 这一页里试过、有了定论的范围不再自动重发（真产不出的重发只会把同样的生成再跑一遍）；
        // 人点「生成」时只跳过确认没有东西可生成的
        const settled = (scope: string): boolean => (explicitFill ? fillScopeStates.get(scope) === 'empty' : fillScopeStates.has(scope));
        const members = emptyScopes.filter((scope) => scope !== normalizedRoot);
        // 过渡办法（服务端没有节点模型状态接口时）挑的范围。已经有一部分模型的节点：只有「模型按需生成」的库
        // （未初始化 / 模型水位没立过）才把没有记录的 ZONE 当成没生成过；库里有成套模型时，没有记录的 ZONE 多半本来
        // 就没有几何，分不清就不去生成。有接口时不靠这条猜：接口说缺就补、说不缺就不补（见 `planModelGeneration`）。
        const legacyCandidates = existingShown
          ? (dbnumRowLacksModel(row) === true ? members : [])
          : (members.length > 0 ? members : [normalizedRoot]);
        let rootNoun: string | null = null;
        try {
          const info = await rootTypeInfo;
          rootNoun = info.success ? String(info.noun || '').trim().toUpperCase() || null : null;
        } catch {
          rootNoun = null;
        }
        // 后端的预检不能把显示拖住：已有的模型已经画出来了、只是顺带看看有没有要补的，最多等 3 秒；
        // 一个模型都没有、正等着生成的，最多等 10 秒。等不到就按没有这个接口处理（退回过渡办法），行上的状态之后照样会说。
        const precheckTimeoutMs = existingShown && !explicitFill ? PRECHECK_AFTER_SHOWN_TIMEOUT_MS : PRECHECK_BEFORE_GENERATE_TIMEOUT_MS;
        const precheck = (scope: string) => withTimeout(fetchGenerationFacts(scope), precheckTimeoutMs, `生成预检 ${scope}`);
        const plan = await planModelGeneration({
          root: normalizedRoot,
          rootNoun,
          scopes: legacyCandidates.filter((scope) => !settled(scope)),
          listChildren: listGenerationChildren,
          deliveryUnitTypes: useGenModelV1Health().state.deliveryUnitTypes,
          facts: { fetch: precheck, emptyMembers: members.filter((scope) => !settled(scope)) },
        });
        rootFacts = plan.rootFacts;
        // 没有东西可生成的范围（没有子节点的容器；接口说没有要生成的单元的成员）：记下来，下次不再问
        for (const scope of plan.skipped) fillScopeStates.set(scope, 'empty');
        const chunks = plan.chunks.filter((chunk) => !settled(chunk.refno));
        if (chunks.length === 0) return null;
        if (chunks.length === plan.chunks.length) return plan;
        // 有的块这一页里已经试出了定论：只做剩下的
        const units = chunks.reduce((sum, chunk) => sum + chunk.units, 0);
        return { ...plan, chunks, units, needsConfirm: plan.thresholdUnits > 0 && units > plan.thresholdUnits };
      };

      /** 一个模型都没有、也没有东西可生成时要告诉人的原因（后端的节点模型状态说得清的两种）；说不清回 `null` */
      const nothingToGenerateHint = (): string | null => {
        if (!rootFacts) return null;
        if (rootFacts.unitsToGenerate > 0) return awaitingUpdateHint();
        return rootFacts.unitsTotal === 0
          ? '这个节点下没有要生成的模型（没有生成单元）'
          : `这个节点下的 ${rootFacts.unitsTotal} 个单元都生成过了，没有可显示的几何`;
      };

      /**
       * 缺的单元归「更新到最新」管时要告诉人的话（库有模型水位、在后端的更新范围里、库文件比水位新：没有模型的单元
       * 多半是水位之后才建的）。这时不按需生成，行上给的是「更新」。不是这种情形回 `null`。
       */
      const awaitingUpdateHint = (): string | null => (
        rootFacts && rootFacts.preferUpdate && rootFacts.unitsToGenerate > 0
          ? `有 ${rootFacts.unitsToGenerate} 个单元还没有模型，是库的模型水位之后才有的：点行上的「更新」让后端把这个库更新到最新`
          : null
      );

      /** 需确认生成：单元数超过阈值先问。回 `true` = 生成 */
      const confirmFill = async (plan: GenerationPlan, existingShown: boolean): Promise<boolean> => {
        if (!plan.needsConfirm) return true;
        const dialog = describeGenerationConfirm(plan, existingShown);
        statusMessage.value = `等待确认：${normalizedRoot} 有${unitsLabel(plan)}要生成`;
        syncGlobalLoadStatus();
        const choice = await useConfirmDialogStore().openChoice({
          title: dialog.title,
          message: dialog.message,
          choices: [{ id: 'generate', text: dialog.confirmText }],
          cancelText: dialog.cancelText,
        });
        return choice === 'generate';
      };

      /** 把一块新生成的构件装进场景（做完一块显示一块） */
      const loadFillChunk = async (chunk: GenerationChunk, refnos: string[], existingShown: boolean): Promise<void> => {
        const layer = fillViewer.__dtxLayer;
        if (!layer) throw new Error('DTXLayer 未初始化，无法加载模型');
        const fresh = uniqStrings(refnos.map((r) => normalizeRefnoString(r))).filter((r) => r && !fillLoaded.has(r));
        if (fresh.length === 0) return;
        for (const key of fresh) fillLoaded.add(key);
        // 「显示」= 保证可见（同收尾路径）：先把这一块的 refno 级可见态拉回 true，装完的回放才不会把它们再藏掉
        showRefnosTracked(fillViewer.scene, uniqStrings([normalizedRoot, ...fresh]), undo);
        const totals = await loadGenModelV1Refnos(
          layer, dbno, fresh, fillViewer, { replace: false, singleBatch: true }, [30, 95], `从 gen-model 加载 ${chunk.name}`, undo,
        );
        mergeLoadTotals(fillTotals, totals);
        fillViewer.scene?.ensureRefnos?.(fresh, { computeAabb: false });
        // 一个模型都没有的节点：第一块出来就飞一次（全部做完后收尾路径会对整体再对一次焦）
        if (!existingShown && !fillFlew && loadOptions?.flyTo) {
          fillFlew = true;
          try {
            const aabb = fillViewer.scene?.getAABB?.(fresh.length > 5000 ? fresh.slice(0, 5000) : fresh) ?? null;
            if (aabb && isCameraIntentCurrent(cameraStamp)) fillViewer.cameraFlight?.flyTo?.({ aabb, duration: 0.8, fit: true });
          } catch {
            // ignore flyTo errors
          }
        }
      };

      /**
       * 分块生成。`probeRefno`：已经显示出来的一个构件——它被隐藏了说明人不要这个节点了。
       * 被叫停（或节点被隐藏）时抛 `ModelLoadStoppedError`：已经发出去的那一块后端照常算完、留在后端；没发的不再发；
       * 这一次画出来的由显示流程的收尾统一收回去。还没做完的块记一笔，行上留「生成」。
       */
      const runFill = async (plan: GenerationPlan, existingShown: boolean, probeRefno: string | null): Promise<GenerationFillSummary> => {
        fillRan = true;
        const whole = isWholeNodePlan(plan);
        const fill = beginGenerationFill(normalizedRoot);
        // 人点的是「显示」：先把这个节点的可见态立成 true，之后它被改成 false 就是人把它隐藏了
        if (!existingShown) showRefnosTracked(fillViewer.scene, [normalizedRoot], undo);
        // 显示意图：这个节点（或它刚显示出来的构件）被隐藏了，就不再往下生成、装载
        const hidden = (): boolean => {
          const objects = fillViewer.scene?.objects;
          if (!objects) return false;
          if (objects[normalizedRoot]?.visible === false) return true;
          const probe = probeRefno ?? (fillLoaded.values().next().value as string | undefined);
          return probe ? objects[probe]?.visible === false : false;
        };
        /** 做到第几块了（被叫停在一块中间时，从这一块起算没做完） */
        let chunkIndexNow = 0;
        let summary: GenerationFillSummary | null = null;
        fillRunning = true;
        showProgressModal.value = false;
        try {
          summary = await runGenerationFill({
            plan,
            generateChunk: async (chunk) => chunkResultFromCollect(
              chunk.refno,
              // 带着会话的取消信号：叫停时这一发请求当场取消（后端那边照常算完）
              await getGenModelV1ModelSource().records.generateThenCollect(chunk.refno, { force: false, signal: session.signal }),
            ),
            // 节点自己一块时不在这里装：生成完按原来的路重查、定范围（BRAN / HANG 要并上根自己）、一次装完
            loadChunk: whole ? async () => {} : (chunk, refnos) => loadFillChunk(chunk, refnos, existingShown),
            onProgress: (step) => {
              chunkIndexNow = step.chunkIndex;
              // 状态条只有一行、会截断：要紧的（第几块、已生成多少）放前面，块的名字放第二行
              const units = `已生成 ${step.unitsDone} / ${plan.exact ? '' : '约 '}${step.unitsTotal} 个单元`;
              const where = whole ? '' : `第 ${step.chunkIndex + 1}/${step.chunkCount} 块`;
              const reason = String(step.reason ?? '');
              statusMessage.value = step.phase === 'waiting'
                ? `${where || normalizedRoot}：${reason.length > 24 ? `${reason.slice(0, 24)}…` : reason}，`
                  + `${Math.round((step.waitMs ?? 0) / 1000)} 秒后自动再问（已问 ${step.attempt} 次）· ${units}`
                : step.phase === 'loading'
                  ? `${where || `${normalizedRoot} `}已生成，正在显示 · ${units}`
                  : whole
                    ? `正在自动生成 ${normalizedRoot} 模型...（${units}）`
                    : `正在生成${where} · ${units}`;
              totalCount.value = step.chunkCount;
              currentIndex.value = step.chunkIndex + 1;
              currentRefno.value = step.chunk.name && step.chunk.name !== step.chunk.refno
                ? `${step.chunk.name} · ${step.chunk.refno}`
                : step.chunk.refno;
              progress.value = Math.min(95, 5 + Math.floor((step.unitsDone / Math.max(1, step.unitsTotal)) * 90));
              syncGlobalLoadStatus();
            },
            shouldStop: () => {
              // 这个节点被隐藏了 = 人不要它了：和叫停一样处理
              if (!session.stopped && hidden()) session.stop();
              return session.stopped;
            },
            sleep,
          });
        } catch (e) {
          // 叫停时在飞的那一发被取消会从这里抛出来；别的错原样往外抛
          if (!session.stopped) throw e;
        } finally {
          fillRunning = false;
          fill.end();
        }
        if (session.stopped || !summary) {
          const remaining = summary ? remainingGenerationChunks(summary) : plan.chunks.slice(chunkIndexNow);
          if (remaining.length > 0) {
            notePendingGenerationFill({
              root: normalizedRoot,
              dbnum: dbno,
              chunks: remaining.length,
              units: remaining.reduce((sum, chunk) => sum + chunk.units, 0),
              exact: plan.exact,
              reason: 'stopped',
            });
          }
          throw new ModelLoadStoppedError(normalizedRoot);
        }
        return summary;
      };

      /** 按祖先查这个节点的范围；叫停时当场取消那次共用的记录读取 */
      const queryScopeStoppable = async (): ReturnType<typeof queryLoadScopeRefnos> => {
        const off = session.onStop(() => { getModelSource().records.cancelCollect?.(normalizedRoot); });
        try {
          return await queryLoadScopeRefnos(normalizedRoot, { isStopped: () => session.stopped });
        } finally {
          off();
        }
      };

      /** 分块生成之后记账：哪些范围有了定论、这个节点还剩什么没补齐（行上的「生成」据此出现 / 消失） */
      const settleFill = (plan: GenerationPlan, summary: GenerationFillSummary): void => {
        for (const outcome of summary.outcomes) {
          if (outcome.state === 'empty' || outcome.state === 'failed') fillScopeStates.set(outcome.chunk.refno, outcome.state);
          else fillScopeStates.delete(outcome.chunk.refno);
        }
        if (summary.outcomes.some((outcome) => outcome.refnos.length > 0)) noteDbnumModelGenerated(dbno);
        if (summary.outcomes.some((outcome) => outcome.state === 'pending')) scheduleDbnumModelReprobe(dbno);
        const remaining = remainingGenerationChunks(summary);
        if (remaining.length === 0) {
          clearPendingGenerationFill(normalizedRoot);
          return;
        }
        notePendingGenerationFill({
          root: normalizedRoot,
          dbnum: dbno,
          chunks: remaining.length,
          units: remaining.reduce((sum, chunk) => sum + chunk.units, 0),
          exact: plan.exact,
          reason: summary.stopped ? 'stopped' : 'pending',
        });
      };

      /**
       * 一个模型都没有的节点：补齐。`ready` = 有东西可装了（`visibleRefnos` 已换成重查的结果，接着走装载）；
       * 否则 `hint` 是要告诉人的原因（没有就用通用的那一句）。
       */
      const fillWhenNothingExists = async (why: string): Promise<{ ready: boolean; hint: string | null }> => {
        try {
          const plan = await prepareFill(false);
          session.throwIfStopped();
          if (!plan) return { ready: false, hint: nothingToGenerateHint() };
          const whole = isWholeNodePlan(plan);
          const confirmed = await confirmFill(plan, false);
          session.throwIfStopped();
          if (!confirmed) {
            notePendingGenerationFill({
              root: normalizedRoot, dbnum: dbno, chunks: plan.chunks.length, units: plan.units, exact: plan.exact, reason: 'declined',
            });
            consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 有${unitsLabel(plan)}要生成，用户取消`);
            return { ready: false, hint: `还没有模型（${unitsLabel(plan).trim()}要生成），已取消；再点眼睛或行上的「生成」可以再来` };
          }
          statusMessage.value = `正在自动生成 ${normalizedRoot} 模型...`;
          progress.value = 5;
          syncGlobalLoadStatus();
          consoleStore.addLog(
            'info',
            `[model-load] refno=${normalizedRoot} ${why}，自动补齐模型（不带 force）` + (whole ? '' : `：分 ${plan.chunks.length} 块，${unitsLabel(plan).trim()}`),
          );
          emitToast({
            message: whole
              ? `[提示] ${normalizedRoot} 尚未生成模型，正在自动生成...`
              : `[提示] ${normalizedRoot} 尚未生成模型，正在分 ${plan.chunks.length} 块生成（${unitsLabel(plan).trim()}），做完一块显示一块`,
            level: 'info',
          });
          const summary = await runFill(plan, false, null);
          settleFill(plan, summary);
          if (summary.outcomes.some((outcome) => outcome.refnos.length > 0)) {
            // 生成出东西了，重新查询 records（generateThenCollect 清了备忘并把新记录收进了缓存）
            const retry = await queryScopeStoppable();
            visibleRefnos = uniqStrings(retry.refnos.map((r) => normalizeRefnoString(r))).filter(Boolean);
            visibleSource = retry.source;
            scopeIncomplete = retry.incomplete;
            emptyScopes = retry.emptyScopes;
            visibleOk = true;
            visibleErr = null;
            // 分块时已经装进场景的构件交给收尾路径对账（同边取边画）：收尾只装剩下的
            if (fillLoaded.size > 0) {
              earlyLoad = {
                loadedRefnos: new Set([...(earlyLoad?.loadedRefnos ?? []), ...fillLoaded]),
                totals: mergeLoadTotals(earlyLoad?.totals ?? emptyLoadTotals(), fillTotals),
              };
            }
            consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 自动生成成功，取得 ${visibleRefnos.length} 个构件`);
            if (visibleRefnos.length === 0) return { ready: false, hint: null };
            const report = describeGenerationFillSummary(summary);
            emitToast(whole && report.level === 'success'
              ? { message: `[成功] ${normalizedRoot} 模型已自动生成并加载`, level: 'success' }
              : { message: `[${levelTag[report.level]}] ${normalizedRoot}：${report.message}`, level: report.level });
            return { ready: true, hint: null };
          }
          const timedOut = summary.outcomes.some((outcome) => outcome.state === 'pending');
          const failed = summary.outcomes
            .flatMap((outcome) => outcome.failedRoots)
            .map((item) => `${item.root}: ${item.error}`)
            .join('; ');
          const groupHint = whole ? summary.outcomes[0]?.hint ?? null : null;
          if (groupHint) autoGenerateHints.set(normalizedRoot, groupHint);
          const hint = timedOut ? '服务端后台继续生成，完成后再点眼睛' : (failed || groupHint || '生成未产出可显示模型');
          consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 自动生成未产出：${hint}`);
          emitToast({ message: `[提示] ${normalizedRoot} 自动生成未完成：${hint}`, level: 'info' });
          return { ready: false, hint: timedOut ? '后端还在后台生成，稍后再点眼睛会接着问（不重算已有的）' : null };
        } catch (e) {
          // 被叫停的不是生成失败：到显示流程的收尾那里统一收回去
          if (session.stopped) throw e;
          const em = e instanceof Error ? e.message : String(e);
          consoleStore.addLog('error', `[model-load] refno=${normalizedRoot} 自动生成异常：${em}`);
          emitToast({ message: `[警告] ${normalizedRoot} 自动生成失败：${em}`, level: 'warning' });
          return { ready: false, hint: null };
        }
      };

      /**
       * 已有的模型显示出来之后：把没有模型的那几块补上（先显示已有的，再补没有的）。补不补得成都不影响这次显示的成败。
       * `probeRefno`：已经显示出来的一个构件。
       */
      const fillAfterShown = async (probeRefno: string | null): Promise<void> => {
        // 重载 / 重新生成不补齐；它们换完之后也不再看「停」（来不及了，换上去的不拿掉）
        if (fillRan || regenerate || refresh) return;
        try {
          // 问预检的这一会儿不给「停」：模型已经全画出来了，这时点停会把刚装好的收回去。真要补齐（确认 / 开始生成）时再放开。
          // 人点的「生成」本来就是为了补齐，一直能停。
          if (!explicitFill) session.setStoppable(false);
          const plan = await prepareFill(true);
          session.throwIfStopped();
          if (plan) session.setStoppable(true);
          if (!plan) {
            // 后端说这个节点已经没有要生成的单元（上次停下之后它在后台做完了、或别处生成过了）：行上那颗「生成」撤掉
            if (explicitFill || (rootFacts && rootFacts.unitsToGenerate === 0)) clearPendingGenerationFill(normalizedRoot);
            const awaiting = awaitingUpdateHint();
            if (awaiting) {
              // 已有的显示出来了；缺的那几个等「更新到最新」，不在这里按需生成
              consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} ${awaiting}`);
              emitToast({ message: `[提示] ${normalizedRoot}：已显示已有的模型；${awaiting}`, level: 'info' });
              statusMessage.value = '加载完成 (gen-model)；部分单元等更新到最新';
              syncGlobalLoadStatus();
            } else if (explicitFill) {
              emitToast({ message: `[提示] ${normalizedRoot}：没有需要生成的部分`, level: 'info' });
            }
            return;
          }
          const confirmed = await confirmFill(plan, true);
          session.throwIfStopped();
          if (!confirmed) {
            notePendingGenerationFill({
              root: normalizedRoot, dbnum: dbno, chunks: plan.chunks.length, units: plan.units, exact: plan.exact, reason: 'declined',
            });
            consoleStore.addLog('info', `[model-load] refno=${normalizedRoot} 还有${unitsLabel(plan)}没有模型，用户选了只显示已有的`);
            emitToast({
              message: `[提示] ${normalizedRoot}：只显示了已有的模型，还有${unitsLabel(plan)}没有模型；行上点「生成」可以补齐`,
              level: 'info',
            });
            statusMessage.value = '加载完成 (gen-model)；部分节点没有模型';
            syncGlobalLoadStatus();
            return;
          }
          consoleStore.addLog(
            'info',
            `[model-load] refno=${normalizedRoot} 下有 ${plan.chunks.length} 块没有模型（${unitsLabel(plan).trim()}），分块补齐（不带 force）`,
          );
          emitToast({
            message: `[提示] ${normalizedRoot} 下还有${unitsLabel(plan)}没有模型，正在分 ${plan.chunks.length} 块生成，做完一块显示一块`,
            level: 'info',
          });
          const summary = await runFill(plan, true, probeRefno);
          settleFill(plan, summary);
          // 补出来的构件也算这个节点装过的（重载时比对用）
          const known = loadedRefnosByRoot.get(normalizedRoot);
          if (known) for (const key of fillLoaded) known.add(key);
          // 生成不动库的水位，行上的状态不会自己重问：补完叫一次（部分生成 → 最新）
          recheckLoadedNode(normalizedRoot);
          const report = describeGenerationFillSummary(summary);
          consoleStore.addLog(report.level === 'warning' ? 'warning' : 'info', `[model-load] refno=${normalizedRoot} 补齐结束：${report.message}`);
          emitToast({ message: `[${levelTag[report.level]}] ${normalizedRoot}：${report.message}`, level: report.level });
          statusMessage.value = report.level === 'success' ? '加载完成 (gen-model)' : `加载完成 (gen-model)；${report.message}`;
          progress.value = 100;
          syncGlobalLoadStatus();
        } catch (e) {
          // 被叫停的不是补齐失败：到显示流程的收尾那里统一收回去
          if (session.stopped) throw e;
          const em = e instanceof Error ? e.message : String(e);
          consoleStore.addLog('error', `[model-load] refno=${normalizedRoot} 补齐异常：${em}`);
          emitToast({ message: `[警告] ${normalizedRoot} 补齐没有完成：${em}`, level: 'warning' });
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

      if (!visibleOk) {
        // 记录查询失败（连退路的子树查询也没通）：只报错，**不生成**。2026-11-10 之前这里在「库级预检查说没有模型」时
        // 会自动发带 force 的生成——一次瞬时读失败就可能把这个节点在库里的模型清掉重算（方案 B1）。
        const failure = visibleErr || '记录查询未应答';
        consoleStore.addLog('warning', `[model-load] 查询加载范围失败：${failure}`);
        emitToast({
          message: `[警告] 查询加载范围失败：${failure}`,
          level: 'warning',
        });
      } else if (visibleRefnos.length === 0) {
        if (refresh) {
          // 取最新的护栏：收齐的查空才会走到「撤下」（没收齐的下面本来就保持原样，不为它白问一次）。
          // 动手之前先确认后端是真的没有它的几何了，而不是没有它的模型
          const notCollected = !!scopeIncomplete && (
            scopeIncomplete.pending.length > 0
            || scopeIncomplete.truncated_roots.length > 0
            || Object.keys(scopeIncomplete.errors).length > 0
          );
          if (loadOptions?.confirmEmpty === true && !notCollected) {
            const confirmed = await emptyRefreshMeansRemoved(normalizedRoot);
            if (!confirmed.removed) {
              statusMessage.value = `refno=${normalizedRoot} 记录查空，没有当成已删除，场景保持原样`;
              progress.value = 100;
              syncGlobalLoadStatus();
              consoleStore.addLog('warning', `[model-load] 重载 ${normalizedRoot}：记录查空，但${confirmed.why}——不当成已删除，场景保持原样`);
              return false;
            }
          }
          return finishRefreshOfEmptyRoot(dbno, normalizedRoot, previousLeaves, scopeIncomplete, visibleSource);
        }
        if (visibleSource !== 'visible-insts') {
          // 记录查询失败后退到子树查询、子树也是空：这不是「查空」，同样不生成
          const noAnswer = `${normalizedRoot}：记录查询没有应答（退到子树查询也是空），未加载；稍后再点眼睛`;
          consoleStore.addLog('warning', `[model-load] ${noAnswer}`);
          emitToast({ message: `[警告] ${noAnswer}`, level: 'warning' });
          statusMessage.value = `refno=${normalizedRoot} 未加载`;
          progress.value = 100;
          syncGlobalLoadStatus();
          return false;
        }
        // 没收齐（409 库正被整库任务占用 / 部分节点出错 / 预算外）时不发：不知道是不是真空，generate 也多半撞锁
        const caveat = scopeIncomplete ? null : dbnumEmptyQueryCaveat(peekDbnumRow(dbno));
        const filled = !scopeIncomplete && !caveat
          ? await fillWhenNothingExists(dbnumRowLacksModel(peekDbnumRow(dbno)) === true ? `dbnum=${dbno} 库里没有成套模型` : 'records 查空')
          : { ready: false, hint: null };
        if (!filled.ready) {
          const tail = scopeIncomplete ? describeVisibleInstsIncomplete(scopeIncomplete) : '';
          const emptyHint = scopeIncomplete
            ? `${normalizedRoot} 尚未取得可见实例（${tail}）`
            : caveat
              ? `${normalizedRoot}：${caveat}`
              : `${normalizedRoot}：${filled.hint ?? autoGenerateHints.get(normalizedRoot) ?? '范围内没有已生成的模型；右键「重新生成模型」可生成'}`;
          consoleStore.addLog('info', `[model-load] ${emptyHint}`);
          emitToast({ message: `[提示] ${emptyHint}`, level: 'info' });
          statusMessage.value = scopeIncomplete
            ? `refno=${normalizedRoot} 模型尚未就绪（${tail}）`
            : `refno=${normalizedRoot} 未加载`;
          progress.value = 100;
          syncGlobalLoadStatus();
          // 点过、但没有模型可显示：行上照样说得出它「未生成 / 部分生成 / 没有生成单元」（后端的节点模型状态问得到时）
          if (rootFacts) noteNodeWithoutModel(normalizedRoot, dbno);
          return false;
        }
        // 补齐出东西了，继续往下走装载流程
      }
      // 查询真拿到了记录：行尾库状态圆点的提示里补一句「本页面已查到模型记录」
      if (visibleOk && visibleRefnos.length > 0) reconcileDbnumModelStatus(dbno);

      const loadScope = await resolveActualModelLoadScope(normalizedRoot, visibleRefnos, rootTypeInfo);
      session.throwIfStopped();
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
          objects?: Record<string, { visible?: boolean } | undefined>
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
      // 边取边画已经装过的构件不再过一遍：它们在装的那一批之前已置为可见，装载器也会跳过，再过一遍只是白跑回放钩子
      const shownEarlyRefnos = earlyLoad && earlyLoad.loadedRefnos.size > 0 ? earlyLoad.loadedRefnos : null;
      const remainingRefnos = shownEarlyRefnos ? loadRefnos.filter((r) => !shownEarlyRefnos.has(r)) : loadRefnos;
      // 「显示」= 保证可见：先把本次范围的 refno 级可见态拉回 true（权威在 scene.objects 状态表）。
      // 否则先前「隐藏」写过 false 的 refno，装完会被 __dtxAfterInstancesLoaded 的 applyStateToRefnos 立刻再藏掉；
      // 已在层里、被 loader 跳过的旧对象也一并恢复可见。
      if (remainingRefnos.length > 0 || !shownEarlyRefnos) {
        showRefnosTracked(anyViewer.scene, uniqStrings([normalizedRoot, ...remainingRefnos]), undo);
      }
      statusMessage.value = regenerate
        ? `正在重新生成 ${normalizedRoot}（gen-model）...`
        : shownEarlyRefnos
          ? `从 gen-model 加载剩下的 ${remainingRefnos.length} 个 refno（已显示 ${shownEarlyRefnos.size} 个）...`
          : `从 gen-model 加载 ${loadRefnos.length} 个 refno...`;
      progress.value = 30;
      syncGlobalLoadStatus();
      const v1Result = shownEarlyRefnos && remainingRefnos.length === 0
        ? emptyLoadTotals()
        : await loadGenModelV1Refnos(
          dtxLayer,
          dbno,
          remainingRefnos,
          anyViewer,
          {
            replace: regenerate || refresh,
            singleBatch: shownEarlyRefnos !== null,
            // 重载 / 重新生成：范围查询回来的构件，记录都是刚查的那一份（根自己也是：没有记录的根在缓存里记的是空）
            ...(regenerate || refresh ? { freshRefnos: new Set([normalizedRoot, ...visibleRefnos]) } : {}),
          },
          [30, 95],
          `从 gen-model 加载 ${normalizedRoot}`,
          regenerate ? null : undo,
        );
      // 整套替换已经换完的（重载 / 重新生成）到这里就停不了了；普通显示在记成「已加载」之前再看一眼
      if (regenerate || refresh) session.setStoppable(false);
      else session.throwIfStopped();
      if (earlyLoad) {
        // 对账按整次显示算：边取边画装的 + 收尾装的
        v1Result.loadedRefnos += earlyLoad.totals.loadedRefnos;
        v1Result.skippedRefnos += earlyLoad.totals.skippedRefnos;
        v1Result.loadedObjects += earlyLoad.totals.loadedObjects;
        v1Result.invalidTubi += earlyLoad.totals.invalidTubi;
        v1Result.mesh404 += earlyLoad.totals.mesh404;
        v1Result.noGeo += earlyLoad.totals.noGeo;
        v1Result.noGeoRefnos.push(...earlyLoad.totals.noGeoRefnos);
      }
      if (refresh && !scopeIncomplete) evictMembersMissingFromRefresh(dbno, normalizedRoot, previousLeaves, loadRefnos);
      if (typeof anyViewer.scene?.ensureRefnos === 'function') {
        anyViewer.scene.ensureRefnos(loadRefnos, { computeAabb: false });
      }
      // 边取边画时第一批到就飞过一次；收齐后再对整体对一次焦——除非用户在这期间自己动过视口
      if (loadOptions?.flyTo && !progressiveLoad?.cameraTakenOverByUser()) {
        try {
          const flyTargets = loadRefnos.length > 5000 ? loadRefnos.slice(0, 5000) : loadRefnos;
          const aabb = anyViewer.scene?.getAABB?.(flyTargets) ?? null;
          if (aabb && isCameraIntentCurrent(cameraStamp)) {
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
      // 记下这个节点这一次装了哪些构件（收齐了才记）：下一次重载拿它和最新记录比，找出数据批次删掉的
      if (!collectionIncomplete && (v1Result.loadedObjects > 0 || v1Result.skippedRefnos > 0)) {
        loadedRefnosByRoot.set(normalizedRoot, new Set(loadRefnos));
      }
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
        // 重新登记：行上的状态跟着重问一次（节点一级的更新做完，落后 → 最新）；「本页装的不是后端现在的那一版」那一笔也随之清掉
        noteLoadedNode(normalizedRoot, dbno, loadWatermark);
        markedLoadedHere = true;
        statusMessage.value = regenerate ? '重新生成完成 (gen-model)' : update ? '更新完成 (gen-model)' : '加载完成 (gen-model)';
        syncGlobalLoadStatus();
        if (update && updateReport) {
          // 节点一级的更新：后端做了什么、屏幕上换了多少，一句话说完
          const report: { level: 'success' | 'info' | 'warning'; message: string } = updateReport;
          consoleStore.addLog(report.level === 'warning' ? 'warning' : 'info', `[model-load] 更新 ${normalizedRoot} 结束：${report.message}`);
          emitToast({
            message: `[${levelTag[report.level]}] ${normalizedRoot}：${report.message}；屏幕上已换成最新的 ${v1Result.loadedObjects} 个几何实例`,
            level: report.level,
          });
        } else {
          emitToast({ message: `[成功] 已从 gen-model 加载 ${v1Result.loadedObjects} 个几何实例`, level: 'success' });
        }
        // 已有的显示出来了，再把这个节点下没有模型的那几块补上（方案 B3）
        await fillAfterShown(loadRefnos[0] ?? null);
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
          noteLoadedNode(normalizedRoot, dbno, loadWatermark);
          markedLoadedHere = true;
          consoleStore.addLog('info', `[model-load] gen-model-v1 refno=${normalizedRoot} 成员已在场景中，根自身无几何，按已加载收口`);
        }
        // 已有的都在场景里了（行上的「生成」走到这里）：把没有模型的那几块补上
        if (!collectionIncomplete) await fillAfterShown(loadRefnos[0] ?? null);
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
      if (session.stopped) {
        // 加载中被叫停（或生成到一半这个节点被隐藏了）：不是失败。停 = 回到点之前的样子——
        // 这一次新装的构件从场景里拿掉、这一次从隐藏改成显示的藏回去；已经取到的记录和网格留在缓存里。
        try {
          // 在装的那一批让它自己收尾（装载器见到取消信号就收手），免得和收回去撞在一起
          await progressiveLoad?.finish();
        } catch {
          // 那一批出不出错都要收回去
        }
        const withdrawn = withdrawStoppedLoad(undo);
        // 这一次才记成「已加载」的（先显示已有的、再补齐时被叫停）一起撤掉；点之前就已加载的节点照旧算已加载
        if (markedLoadedHere && !genuinelyLoaded) {
          loadedRoots.delete(normalizedRoot);
          loadedRefnosByRoot.delete(normalizedRoot);
          forgetLoadedNode(normalizedRoot);
        }
        // 生成到一半被叫停：已经生成的留在后端，行上的状态跟着重问一次（未生成 → 部分生成）。
        // 这个节点点之前就装着的，重问它那一行；这一次才装的已经收回去了，按「没有模型可显示的节点」登记
        if (rootFacts && undo.dbno > 0) {
          if (isModelActuallyLoaded(normalizedRoot)) recheckLoadedNode(normalizedRoot);
          else noteNodeWithoutModel(normalizedRoot, undo.dbno);
          // 叫停时在飞的那一块后端照常算完：过一会儿再问两次，行上的数跟上来
          recheckLoadedNodeLater(normalizedRoot, STOPPED_FILL_RECHECK_DELAYS_MS);
        }
        // 节点一级的更新做到一半被叫停：没发的块不再发，已经发出去的后端照常算完。屏幕上的不动——但后端那边可能
        // 已经换了一部分（甚至全部），它自己看不出本页装的是哪一版：记一笔，后端说「最新」时行上给「重载」；
        // 后端说还落后时行上照旧是「更新」，再点接着做（已是最新的会跳过）。
        if (update && updateSentToBackend) {
          markLoadedNodeStale(normalizedRoot, '更新到一半停了：后端已经重新生成了一部分，屏幕上还是原来的');
          recheckLoadedNode(normalizedRoot);
          recheckLoadedNodeLater(normalizedRoot, STOPPED_FILL_RECHECK_DELAYS_MS);
        }
        session.markWithdrawn();
        statusMessage.value = update ? '已停止更新，场景保持原样' : refresh ? '已停止重载，场景保持原样' : '已停止加载';
        progress.value = 100;
        syncGlobalLoadStatus();
        consoleStore.addLog(
          'info',
          `[model-load] refno=${normalizedRoot} 加载被叫停：收回 ${withdrawn} 个构件；已取到的记录和网格留在缓存里`,
        );
        emitToast({
          message: update
            ? `[提示] ${normalizedRoot}：已停止更新，屏幕上的没有动`
              + (updateSentToBackend ? '；后端已经重新生成的留在后端，行上会给「更新」（接着做）或「重载」（换到屏幕上）' : '')
            : refresh
              ? `[提示] ${normalizedRoot}：已停止重载，场景保持原样`
              : `[提示] ${normalizedRoot}：已停止加载，这次画出来的已收起；已取到的数据留着，再点眼睛会接着装`,
          level: 'info',
        });
        return false;
      }
      const msg = e instanceof Error ? e.message : String(e);
      error.value = msg;
      statusMessage.value = '加载失败';
      syncGlobalLoadStatus();
      emitToast({ message: `[错误] 模型加载失败：${msg}`, level: 'error' });
      return false;
    } finally {
      progressiveLoad?.dispose();
      stopRecordPageListener?.();
      unsubscribeProgress();
      releaseLod1Backfill();
      isGenerating.value = false;
      showProgressModal.value = false;
      modelLoadStatus.finish({
        message: statusMessage.value,
        error: error.value,
      });
      session.end();
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
    // 整库装载要飞的话，装载前盖一次意图戳；落地时核对，期间用户点了别处就不动相机。
    const cameraStamp = loadOptions?.flyTo ? beginCameraIntent() : 0;
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
    // 「取最新」要知道整库显示装了哪些 SITE、各装了什么、装的时候库在哪个会话（开始取数之前读，取早不取晚）
    const rowAtStart = peekDbnumRow(dbno);
    const getWorkMark: GetWorkWatermark = {
      modelSesno: typeof rowAtStart?.model_sesno === 'number' ? rowAtStart.model_sesno : null,
      fileLatestSesno: typeof rowAtStart?.file_latest_sesno === 'number' ? rowAtStart.file_latest_sesno : null,
    };
    const siteBatches: { site: string; refnos: string[]; complete: boolean }[] = [];
    const noteShownForGetWork = (result: { skippedSites: string[]; budgetLimited: boolean; siteSummaryAvailable: boolean }) => {
      const managed: string[] = [];
      for (const batch of siteBatches) {
        if (batch.complete && batch.refnos.length > 0) {
          // 收齐的 SITE：记下它装了哪些构件（重载时比得出谁被删了），登记成取最新要核对的节点
          loadedRefnosByRoot.set(batch.site, new Set(batch.refnos));
          noteGetWorkRoot(batch.site, dbno, getWorkMark, 'show_dbnum');
          managed.push(batch.site);
        } else if (!batch.complete) {
          // 没收齐的 SITE：不知道它完整的样子，不归取最新管（也不当成新出现的）
          managed.push(batch.site);
        }
        // 收齐而没有几何的 SITE 不记：以后它有了东西，取最新当成新出现的装进来
      }
      for (const site of result.skippedSites ?? []) managed.push(normalizeRefnoString(site));
      noteGetWorkDbnumScope(dbno, {
        sites: managed,
        // 按预算只显示了一部分、或 SITE 名单没取到：没轮到的不是「新增的」，不去找
        discover: result.budgetLimited !== true && result.siteSummaryAvailable !== false,
        fileLatestSesno: getWorkMark.fileLatestSesno,
      });
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
      onRefnosReady: async ({ refnos, rootsDone, rootsTotal, site, complete }) => {
        loadedRootCount = rootsDone;
        if (site) siteBatches.push({ site: normalizeRefnoString(site.refno), refnos: [...refnos], complete: complete === true });
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
      // 整库都是空的也登记：以后这个库有了模型，取最新能把新出现的 SITE 装进来
      noteShownForGetWork(collected);
      return { loaded: true, instanceCount: 0, refnoCount: 0, refnos: [] };
    }

    // 整库真收到了记录 → 行尾圆点的提示里记一笔
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
        if (aabb && isCameraIntentCurrent(cameraStamp)) {
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
    noteShownForGetWork(collected);
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
    // 整库是一批批到的：粗网格等整库装完再补一次，不在批与批之间插进来抢请求、反复 recompile
    const releaseLod1Backfill = holdDtxLod1Backfill();
    // 「取最新」看得到整库显示正在进行（它没有按节点的加载会话）：等它结束再对账，不和它抢着装
    const endWholeLibraryLoad = beginWholeLibraryLoad();

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
      endWholeLibraryLoad();
      releaseLod1Backfill();
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
    listLoadedRoots: () => [...loadedRoots],
    // 「取最新」用的几个出口（见 `useModelGetWork`）
    withdrawRemovedRoot,
    loadedRefnosOf,
    isRootInScene,
    /** 地址栏直装的节点：查看器替它记下这一次装了哪些构件 */
    rememberLoadedRefnos: rememberLoadedRefnosOfRoot,
  };
}
