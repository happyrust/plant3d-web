<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { GitCompare, RefreshCw } from 'lucide-vue-next';

import NodeVersionAttributesTab from './NodeVersionAttributesTab.vue';
import NodeVersionModelTab from './NodeVersionModelTab.vue';
import NodeVersionTimeline from './NodeVersionTimeline.vue';

import type { ChangedElementRow } from './nodeVersionPanelFormat';

import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useNodeVersionTimeline } from '@/composables/useNodeVersionTimeline';
import { dispatchTreeDiffContext } from '@/composables/useTreeVersionDiff';
import {
  getModelSource,
  ModelVersionRouteUnavailableError,
  type ModelAttributeHistory,
  type ModelNodeDiffGroup,
  type ModelNodeDiffStatus,
  type ModelNodeDiffSummary,
  type ModelNodeVersionTimeline,
  type ModelSource,
  type ModelVersion,
  type ModelVersionGeometry,
  type ModelVersionImpactKind,
} from '@/model-source';
import {
  buildModelUnitCompareView,
  loadModelUnitComparePairs,
  pickModelUnitCompareGeometry,
  sameModelUnitGeometryKey,
  type ModelUnitCompareLoad,
  type ModelUnitComparePair,
} from '@/utils/modelUnitCompareLoader';
import {
  buildModelUnitVersionCompareUrl,
  modelUnitGroupSideImpactKinds,
  MODEL_UNIT_COMPARE_MAX_UNITS,
  MODEL_UNIT_VERSION_COMPARE_EVENT,
  MODEL_UNIT_VERSION_COMPARE_STATE_EVENT,
  MODEL_VERSION_INSPECT_EVENT,
  orderModelUnitVersionPair,
  pickMostChangedGroups,
  readModelUnitVersionCompareUrl,
  takePendingModelVersionInspect,
  type ModelUnitCompareAttributesAt,
  type ModelUnitCompareSide,
  type ModelUnitCompareViewMode,
  type ModelUnitGeometryDiff,
  type ModelUnitGeometryStatus,
  type ModelUnitVersionCompareEventDetail,
  type ModelUnitVersionCompareRuntimeState,
} from '@/utils/modelUnitVersionCompare';
import {
  buildNodeTimelineRows,
  foldAttributeChanges,
  viewFromAttributeDiff,
  viewFromFold,
  type AttributeNetDiffView,
  type NodeTimelineRow,
} from '@/utils/nodeVersionTimeline';

/**
 * 节点版本视图（ADR 0066；CONTEXT「节点版本视图 / 对比范围 / 属性变化时间线 / 属性净差 / 差异摘要」）。
 *
 * 任意节点一个面板：上半是属性变化时间线（谁在哪一版改了什么），下半两个 tab（属性对比 / 模型对比），三块受同一个
 * **对比范围**开关约束（`仅自身` / `所有子节点`）。取数经 `ModelVersionSource`：
 * - 现有路由：`listElementVersions`（两列五态）+ `listVersions`（所属单元的版本表）+ `loadVersion`（A/B 历史投影）；
 * - 新路由（旧服务端没有时回落、照实说）：`attributeHistory`（user / comment / 逐属性 before-after）、`attributeDiff`
 *   （A / B 两版的属性净差，服务端两端直接读终态；没有时回落到把时间线在 (A, B] 里折）与 `diffSummary`
 *   （A→B 不生成几何的差异摘要，按单元分组）。
 * 三维对比是单元级的（几何只按单元生成）：`所有子节点` 下差异摘要按单元分组，每组一个「在三维中对比」装那一个单元；不止一组时
 * 还有一颗总按钮把变了的单元**一起**进三维（`runCompareGroups`，按份并发 ≤ 2、进度「n / m 份」、一发 `open` 带 `units[]`；
 * 超过 `MODEL_UNIT_COMPARE_MAX_UNITS` 或服务端 `needsConfirm` 先弹确认：全部 / 先装变化最大的 N 个 / 取消，见 ADR 0066、收口计划 P2-a / P2-b）。
 */

// URL 入口（Q16）见 `readModelUnitVersionCompareUrl`；面板本身由 `DockLayout` 按同一个开关打开。
const urlConfig = readModelUnitVersionCompareUrl(window.location.search);
const unitRefno = ref(urlConfig.unitRefno);
const dbnum = ref<number | null>(null);
/** 所属单元的版本表（几何只按单元生成，A/B 历史投影要拿它的 `ModelVersion` 去 `loadVersion`） */
const versions = ref<ModelVersion[]>([]);
/** 属性变化时间线取不到的原因（旧服务端没有这条路由等）；取到了为 null */
const historyUnavailable = ref<string | null>(null);
/**
 * 节点版本表（`listNodeVersions` scope=subtree，CONTEXT「节点版本表」）只在节点是容器（不在任何单元下）时去取——
 * 单元及以下的子树 ≈ 所属单元，单元表已经给了。旧服务端没有这条路由时 `nodeVersionsUnavailable` 说明原因，面板退回「手填会话号」。
 */
const nodeVersionsUnavailable = ref<string | null>(null);
/** 本次对比持有的版本几何，关闭 / 重查时 `release()`（gen-model-v1 下是服务端快照） */
let heldGeometries: ModelVersionGeometry[] = [];
const loadingVersions = ref(false);
const comparing = ref(false);
const error = ref<string | null>(null);
/** 非致命的说明（没有几何可比、旧服务端缺路由等），与 `error` 分开显示 */
const notice = ref<string | null>(null);
const rows = ref<ModelUnitGeometryDiff[]>([]);
const statusFilter = ref<'all' | Exclude<ModelUnitGeometryStatus, 'unchanged'>>('all');
const includeUnchanged = ref(false);
const activeTab = ref<'attributes' | 'model'>('attributes');
const compareActive = ref(false);
const compareRuntime = ref<ModelUnitVersionCompareRuntimeState | null>(null);
const compareCompleted = ref(false);
/** 三维里当前装的是哪几个单元（`所有子节点` 下可能不是节点自己所属的那个；多单元一次装载时是一串） */
const comparedInViewer = ref<string[]>([]);
/**
 * 多单元一次装载（P2-a）的进度卡「正在生成历史投影 n / m」：份 = 要去 `history/generate` 的「单元@sesno」（tombstone 侧不算、
 * 同 geometryKey 的两侧算一份）；`current` 是正在装的那几份。单单元也走这条（m ≤ 2），卡只在 m > 2 时露出。
 */
const compareProgress = ref<{ done: number; total: number; current: string[] } | null>(null);
/** P2-b 阈值确认（设计稿 S2b ②）：待确认的那批组；null = 没在问 */
const pendingGroupsConfirm = ref<ModelNodeDiffGroup[] | null>(null);
const diffSummary = ref<ModelNodeDiffSummary | null>(null);
const diffSummaryError = ref<string | null>(null);
const diffSummaryUnavailable = ref(false);
const loadingSummary = ref(false);
/**
 * `仅自身` 下属性对比的那一格净差（CONTEXT「属性净差」）：服务端 `attributeDiff` 直接给；旧服务端没有这条路由时回落到把
 * 属性变化时间线在 (A, B] 里折（`source: 'folded'`，界面照实说）。`attributeDiffUnavailable` 记一次，不再反复打。
 */
const selfDiff = ref<AttributeNetDiffView | null>(null);
const selfDiffError = ref<string | null>(null);
const loadingSelfDiff = ref(false);
const attributeDiffUnavailable = ref(false);
/** `所有子节点` 下属性对比展开的构件 → 它的净差（同一条取数路：先 `attributeDiff`，没有再拉它的时间线折） */
const expandedElement = ref<string | null>(null);
const elementDiffs = ref(new Map<string, AttributeNetDiffView | 'loading' | string>());
let requestId = 0;
let summaryRequestId = 0;
let selfDiffRequestId = 0;

const normalizedRefno = computed(() => unitRefno.value.trim().replace(/\//g, '_'));

/**
 * 时间线那一半（`useNodeVersionTimeline`，P2-2 抽出）：三条时间线并成一条、对比范围、A / B、两个勾选、折叠、手填。
 * 用户换 A / B 之前先收掉上一轮的三维对比；换范围后收起「所有子节点」下展开的构件那一格。
 */
const nodeTimeline = useNodeVersionTimeline({
  beforePairChange: () => closeCompare(),
  afterScopeChange: () => { expandedElement.value = null; },
});
const {
  elementTimeline,
  attributeHistory,
  nodeVersions,
  hasMembers,
  scope,
  beforeSesno,
  afterSesno,
  geometryOnly,
  selfOnly,
  timelineExpanded,
  manualA,
  manualB,
  selfColumnUnknown,
  hasUnit,
  queriedIsUnitRoot,
  queriedElementRefno,
  nodeNoun,
  pairReady,
  setScope,
  pickSide,
  compareWithPrevious,
  compareWithLatest,
} = nodeTimeline;
const timelineRows = nodeTimeline.rows;
const timelineCounts = nodeTimeline.counts;
const timelineSlice = nodeTimeline.slice;
/** 对比按这个单元跑（几何只按单元生成）；查的是构件时它是解出来的所属单元根 */
const comparedUnitRefno = computed(() => elementTimeline.value?.unitRefno ?? normalizedRefno.value);

const selectedBefore = computed(() => versionFor(beforeSesno.value));
const selectedAfter = computed(() => versionFor(afterSesno.value));
/** 两个版本几何相同的承诺（`ModelVersion.geometryKey` 相等）；键缺失时不承诺 */
const sameGeometry = computed(() => sameModelUnitGeometryKey(selectedBefore.value, selectedAfter.value));
const shareStatus = ref<'idle' | 'copied' | 'address'>('idle');

/** `所有子节点` 下属性对比的构件清单：差异摘要里有变的行，节点自身置顶（Q12 a） */
const changedElementRows = computed<ChangedElementRow[]>(() => {
  const summary = diffSummary.value;
  if (!summary) return [];
  const list = summary.groups.flatMap((group) => group.rows.map((row) => ({ ...row, unitRefno: group.unitRefno, unitNoun: group.unitNoun })));
  list.sort((x, y) => Number(y.isNode) - Number(x.isNode));
  return list;
});
/** `所有子节点` 下有几何要重算的组，每组一个「在三维中对比」 */
const geometryGroups = computed(() => (diffSummary.value?.groups ?? []).filter((group) => group.unitRefno && group.geometryChanged));

/** 单元版本表里的那一版；A/B 选在只有节点自己变过的会话上时（单元表没这一行）合成一版，`loadVersion` 照 sesno 生成 */
function versionFor(sesno: number | null): ModelVersion | null {
  if (sesno === null || dbnum.value === null) return null;
  const found = versions.value.find((item) => item.sesno === sesno);
  if (found) return found;
  const timeline = elementTimeline.value;
  if (!timeline?.unitRefno) return null;
  const row = timelineRows.value.find((item) => item.sesno === sesno);
  return {
    dbnum: dbnum.value,
    unitRefno: timeline.unitRefno,
    unitNoun: timeline.unitNoun ?? '',
    sesno,
    sessionTime: row?.sessionTime ?? null,
    impactKind: row?.unitImpact ?? row?.selfImpact ?? 'mesh',
  };
}

function dispatch(detail: ModelUnitVersionCompareEventDetail): void {
  window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_EVENT, { detail }));
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function releaseHeldGeometries(): void {
  const held = heldGeometries;
  heldGeometries = [];
  for (const geometry of held) {
    void geometry.release().catch((cause) => {
      console.warn('[ModelUnitVersionComparePanel] release version geometry failed', cause);
    });
  }
}

/** 模型来源的可选口（测试里的最小桩没有 `tree`；旧适配器没有新方法），都当「没给」处理 */
function optionalSource(): Partial<ModelSource> & { versions?: Partial<ModelSource['versions']> } {
  return getModelSource() as Partial<ModelSource> & { versions?: Partial<ModelSource['versions']> };
}

/** 属性变化时间线：新路由，旧服务端没有就照实说、只给版本表那一半 */
async function loadAttributeHistory(resolvedDbnum: number, refno: string): Promise<ModelAttributeHistory | null> {
  const fetcher = optionalSource().versions?.attributeHistory;
  if (typeof fetcher !== 'function') {
    historyUnavailable.value = '当前模型来源没有属性变化时间线';
    return null;
  }
  try {
    const history = await fetcher.call(getModelSource().versions, resolvedDbnum, refno);
    historyUnavailable.value = null;
    return history;
  } catch (cause) {
    historyUnavailable.value = cause instanceof ModelVersionRouteUnavailableError
      ? '服务端还没有 element/attribute-history：时间线上没有保存人 / 备注与逐属性变化，只有版本表那一半'
      : `属性变化时间线取不到：${messageOf(cause)}`;
    return null;
  }
}

/** 节点版本表（容器的子树时间线）：新路由，旧服务端没有就照实说、退回手填会话号 */
async function loadNodeVersions(resolvedDbnum: number, refno: string): Promise<ModelNodeVersionTimeline | null> {
  const fetcher = optionalSource().versions?.listNodeVersions;
  if (typeof fetcher !== 'function') {
    nodeVersionsUnavailable.value = '当前模型来源没有节点版本表';
    return null;
  }
  try {
    const table = await fetcher.call(getModelSource().versions, resolvedDbnum, refno, 'subtree');
    nodeVersionsUnavailable.value = null;
    return table;
  } catch (cause) {
    nodeVersionsUnavailable.value = cause instanceof ModelVersionRouteUnavailableError
      ? '服务端还没有 node/versions：容器的子树时间线列不出来，这里只列它自己，A / B 可手填会话号'
      : `子树时间线取不到：${messageOf(cause)}`;
    return null;
  }
}

/** 叶子判定：问一下树口有没有成员；没有树口（或问失败）就不判，开关照常可用 */
async function probeMembers(refno: string): Promise<boolean | null> {
  const tree = optionalSource().tree;
  if (!tree || typeof tree.children !== 'function') return null;
  try {
    const response = await tree.children(refno, 1);
    return (response?.children?.length ?? 0) > 0;
  } catch {
    return null;
  }
}

async function loadVersions(): Promise<void> {
  closeCompare();
  const run = ++requestId;
  error.value = null;
  notice.value = null;
  rows.value = [];
  versions.value = [];
  // 时间线那一半（三条时间线、成员、A / B、折叠）一并清掉
  nodeTimeline.reset();
  historyUnavailable.value = null;
  nodeVersionsUnavailable.value = null;
  diffSummary.value = null;
  diffSummaryError.value = null;
  diffSummaryUnavailable.value = false;
  selfDiff.value = null;
  selfDiffError.value = null;
  attributeDiffUnavailable.value = false;
  elementDiffs.value = new Map();
  expandedElement.value = null;
  pendingGroupsConfirm.value = null;
  dbnum.value = null;
  compareCompleted.value = false;
  const refno = normalizedRefno.value;
  if (!/^\d+_\d+$/.test(refno)) {
    error.value = '请输入节点参考号（构件 / 单元根 / 容器），例如 24384_23262';
    return;
  }
  loadingVersions.value = true;
  try {
    await ensureDbMetaInfoLoaded();
    const resolvedDbnum = getDbnumByRefno(refno);
    // 先问这个节点的两列时间线：它自己哪几版变过，以及它属于哪个交付单元（几何只按单元生成，对比得拿它去取）
    const timeline = await getModelSource().versions.listElementVersions(resolvedDbnum, refno);
    if (run !== requestId) return;
    // 容器（不在任何单元下）的子树时间线只有 node/versions 能列；单元及以下的子树 ≈ 所属单元，单元表已经给了
    const [history, members, subtree] = await Promise.all([
      loadAttributeHistory(resolvedDbnum, refno),
      probeMembers(refno),
      timeline.unitRefno ? Promise.resolve(null) : loadNodeVersions(resolvedDbnum, refno),
    ]);
    if (run !== requestId) return;
    let unitVersions: ModelVersion[] = [];
    if (timeline.unitRefno) {
      unitVersions = await getModelSource().versions.listVersions(resolvedDbnum, timeline.unitRefno);
      if (run !== requestId) return;
    } else if (subtree) {
      notice.value = `${refno}（${timeline.noun || '类型未知'}）不在任何最小交付单元下：几何按其下的单元分组对比（模型对比 tab），`
        + `子树时间线 ${subtree.versions.length} 版来自 node/versions。`;
    } else {
      notice.value = `${refno}（${timeline.noun || '类型未知'}）不在任何最小交付单元下：没有可对比的几何，`
        + `属性变化时间线照常可看；${nodeVersionsUnavailable.value ?? '子树时间线取不到'}。`;
    }
    dbnum.value = resolvedDbnum;
    versions.value = unitVersions;
    // 缺省范围（Q10 c）与缺省 A / B（范围内最近两版）由时间线那一半定
    nodeTimeline.setNode({ timeline, history, nodeVersions: subtree, hasMembers: members });
    if (timelineRows.value.length === 0) {
      notice.value = [notice.value, `${refno} 在整条会话链上没有任何一版变化`].filter(Boolean).join(' ');
    }
  } catch (cause) {
    if (run === requestId) {
      versions.value = [];
      nodeTimeline.reset();
      dbnum.value = null;
      // 旧构建（ADR-081 之前）连 `model/versions` 都没有：版本表本身取不到，整块都没法用；照实说要新版服务端，别露裸 404
      error.value = cause instanceof ModelVersionRouteUnavailableError
        ? `服务端还没有 ${cause.route}：版本查询 / 对比要带该路由的新版服务端，当前站点接的后端还是旧构建；后端升级前这里查不出任何版本。`
        : messageOf(cause);
    }
  } finally {
    if (run === requestId) loadingVersions.value = false;
  }
}

async function copyCompareLink(): Promise<void> {
  if (!pairReady.value || beforeSesno.value === null || afterSesno.value === null) return;
  const link = buildModelUnitVersionCompareUrl(
    window.location.href,
    elementTimeline.value?.refno ?? normalizedRefno.value,
    beforeSesno.value,
    afterSesno.value,
  );
  window.history.replaceState(window.history.state, '', link);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(link);
    shareStatus.value = 'copied';
  } catch {
    shareStatus.value = 'address';
  }
}

watch([elementTimeline, beforeSesno, afterSesno], () => {
  shareStatus.value = 'idle';
});

/**
 * 手填 A / B（容器节点撞上旧服务端时的兜底）：子树的时间线要 `node/versions?scope=subtree`，没有这条路由的服务端上容器
 * 只列得出它自己变过的那几版；差异摘要与分组三维对比却能吃任意两个会话号，所以这里让人直接填。填完按新旧摆正。
 * 节点版本表取到了就不再露出这一栏。填错了的文案进 `error`。
 */
function applyManualPair(): void {
  error.value = nodeTimeline.applyManualPair();
}

function normalizeSelectedPair(): void {
  const first = selectedBefore.value;
  const second = selectedAfter.value;
  if (!first || !second || first.sesno === second.sesno) return;
  const [before, after] = orderModelUnitVersionPair(first, second);
  beforeSesno.value = before.sesno;
  afterSesno.value = after.sesno;
}

/**
 * 一格净差的取数路（`仅自身` 的节点自己与 `所有子节点` 下点开的构件同一条）：先问服务端 `attributeDiff`（两端直接读终态、
 * 成员 / owner 是真差）；旧服务端没有这条路由就记一次、回落到把属性变化时间线在 (A, B] 里折——节点自己的时间线已在手上
 * （`knownHistory`），构件的现拉。两条都没有就抛，界面照实说。
 */
async function netDiffOf(refno: string, a: number, b: number, knownHistory: ModelAttributeHistory | null): Promise<AttributeNetDiffView> {
  const source = optionalSource().versions;
  const diffFetcher = source?.attributeDiff;
  if (!attributeDiffUnavailable.value && typeof diffFetcher === 'function') {
    try {
      return viewFromAttributeDiff(await diffFetcher.call(getModelSource().versions, dbnum.value!, refno, a, b));
    } catch (cause) {
      if (!(cause instanceof ModelVersionRouteUnavailableError)) throw cause;
      attributeDiffUnavailable.value = true;
    }
  } else {
    attributeDiffUnavailable.value = true;
  }
  let history = knownHistory;
  if (!history) {
    const historyFetcher = source?.attributeHistory;
    if (typeof historyFetcher !== 'function') throw new Error('当前模型来源既没有属性净差也没有属性变化时间线');
    history = await historyFetcher.call(getModelSource().versions, dbnum.value!, refno);
  }
  return viewFromFold(foldAttributeChanges(history.entries, a, b));
}

/** `仅自身` 的属性对比：A/B 一变就重取；只在范围是 `仅自身` 时取（三块同进同出，`所有子节点` 下是构件清单） */
async function loadSelfDiff(): Promise<void> {
  const run = ++selfDiffRequestId;
  selfDiff.value = null;
  selfDiffError.value = null;
  if (dbnum.value === null || !pairReady.value || scope.value !== 'self' || !elementTimeline.value) return;
  const refno = elementTimeline.value.refno;
  const history = attributeHistory.value;
  loadingSelfDiff.value = true;
  try {
    const view = await netDiffOf(refno, beforeSesno.value!, afterSesno.value!, history);
    if (run !== selfDiffRequestId) return;
    selfDiff.value = view;
  } catch (cause) {
    if (run !== selfDiffRequestId) return;
    // 两条路都没有：服务端缺 attribute-diff、时间线也取不到（原因在 historyUnavailable）
    const routeMissing = cause instanceof ModelVersionRouteUnavailableError;
    selfDiffError.value = routeMissing && historyUnavailable.value
      ? `服务端既没有 element/attribute-diff，${historyUnavailable.value}`
      : messageOf(cause);
  } finally {
    if (run === selfDiffRequestId) loadingSelfDiff.value = false;
  }
}

watch([beforeSesno, afterSesno, scope, dbnum], () => {
  void loadSelfDiff();
});

/** 差异摘要（新路由）：A/B 或范围一变就重算；旧服务端没有这条路由只记一次，不再反复打 */
async function loadDiffSummary(): Promise<void> {
  const run = ++summaryRequestId;
  diffSummary.value = null;
  diffSummaryError.value = null;
  elementDiffs.value = new Map();
  expandedElement.value = null;
  // 摘要换了，还没答的阈值确认框问的是上一份摘要的组，一并收掉
  pendingGroupsConfirm.value = null;
  if (dbnum.value === null || !pairReady.value || diffSummaryUnavailable.value || !elementTimeline.value) return;
  const fetcher = optionalSource().versions?.diffSummary;
  if (typeof fetcher !== 'function') {
    diffSummaryUnavailable.value = true;
    return;
  }
  loadingSummary.value = true;
  try {
    const result = await fetcher.call(
      getModelSource().versions,
      dbnum.value,
      elementTimeline.value.refno,
      beforeSesno.value!,
      afterSesno.value!,
      scope.value,
    );
    if (run !== summaryRequestId) return;
    // 来源返回空（测试里的最小桩）当没有摘要，别把 undefined 交给子组件的 prop
    diffSummary.value = result ?? null;
  } catch (cause) {
    if (run !== summaryRequestId) return;
    if (cause instanceof ModelVersionRouteUnavailableError) diffSummaryUnavailable.value = true;
    else diffSummaryError.value = messageOf(cause);
  } finally {
    if (run === summaryRequestId) loadingSummary.value = false;
  }
}

watch([beforeSesno, afterSesno, scope, dbnum], () => {
  void loadDiffSummary();
});

/** `所有子节点` 下展开一个构件：取它 A / B 两版的属性净差（服务端直接给；旧服务端拉它的时间线折）。节点自己那一行复用手上的时间线。 */
async function toggleElementDiff(refno: string): Promise<void> {
  if (expandedElement.value === refno) {
    expandedElement.value = null;
    return;
  }
  expandedElement.value = refno;
  if (elementDiffs.value.has(refno) || dbnum.value === null || !pairReady.value) return;
  const next = new Map(elementDiffs.value);
  next.set(refno, 'loading');
  elementDiffs.value = next;
  const knownHistory = refno === elementTimeline.value?.refno ? attributeHistory.value : null;
  try {
    const view = await netDiffOf(refno, beforeSesno.value!, afterSesno.value!, knownHistory);
    const done = new Map(elementDiffs.value);
    done.set(refno, view);
    elementDiffs.value = done;
  } catch (cause) {
    const failed = new Map(elementDiffs.value);
    failed.set(refno, cause instanceof ModelVersionRouteUnavailableError ? `服务端既没有 element/attribute-diff 也没有 ${cause.route}` : messageOf(cause));
    elementDiffs.value = failed;
  }
}

/** 节点自己所属的那个单元：与旧面板同一条路 */
async function runCompare(): Promise<void> {
  normalizeSelectedPair();
  const before = selectedBefore.value;
  const after = selectedAfter.value;
  if (dbnum.value === null || !before || !after || before.sesno >= after.sesno) {
    error.value = hasUnit.value ? '请选择两个不同版本，A 必须早于 B' : '这个节点不在任何最小交付单元下，没有可对比的几何';
    return;
  }
  await runCompareVersions(before, after, comparedUnitRefno.value);
}

/**
 * `所有子节点` 下某一组（某个最小交付单元）的 A/B：合成该单元在 A / B 两版的 `ModelVersion`，同一条装载路。
 * A / B 是节点子树的会话、单元不一定两版都在：单元根那行 `deleted` / `added` 的那一侧标 `tombstone`（`modelUnitGroupSideImpactKinds`），
 * 不然去 `history/generate` 一个它不存在的会话会 404 进不了三维（README §8.4）。
 */
/** 某一组（某个最小交付单元）在 A / B 两个会话下的 `ModelVersion`：单元根那行 `deleted` / `added` 的那一侧标 `tombstone` */
function groupVersions(group: ModelNodeDiffGroup): { unitRefno: string; unitNoun: string; before: ModelVersion; after: ModelVersion } {
  const kinds = modelUnitGroupSideImpactKinds(group);
  const make = (sesno: number, impactKind: ModelVersionImpactKind): ModelVersion => ({
    dbnum: dbnum.value!,
    unitRefno: group.unitRefno!,
    unitNoun: group.unitNoun ?? '',
    sesno,
    sessionTime: nodeTimeline.sessionTimeOf(sesno),
    impactKind,
  });
  return { unitRefno: group.unitRefno!, unitNoun: group.unitNoun ?? '', before: make(beforeSesno.value!, kinds.before), after: make(afterSesno.value!, kinds.after) };
}

async function runCompareGroup(group: ModelNodeDiffGroup): Promise<void> {
  if (dbnum.value === null || !group.unitRefno || !pairReady.value) return;
  await runCompareUnits([groupVersions(group)]);
}

/**
 * 设计稿 S2 那一颗总按钮：差异摘要里变了的单元**一起**进三维（P2-a）。超过上限 `MODEL_UNIT_COMPARE_MAX_UNITS` 或服务端说要确认
 * （`needsConfirm`）就先问（P2-b，`pendingGroupsConfirm`）：全部生成 / 先装变化最大的 N 个 / 取消。
 */
function runCompareGroups(groups: readonly ModelNodeDiffGroup[]): void {
  const usable = groups.filter((group) => group.unitRefno);
  if (dbnum.value === null || !pairReady.value || usable.length === 0) return;
  if (usable.length > MODEL_UNIT_COMPARE_MAX_UNITS || diffSummary.value?.needsConfirm) {
    pendingGroupsConfirm.value = usable;
    return;
  }
  void runCompareUnits(usable.map(groupVersions));
}

/** 确认框的三个答案：全部 / 先装变化最大的 N 个 / 取消 */
function confirmGroups(choice: 'all' | 'top' | 'cancel'): void {
  const groups = pendingGroupsConfirm.value;
  pendingGroupsConfirm.value = null;
  if (!groups || choice === 'cancel') return;
  const picked = choice === 'all' ? groups : pickMostChangedGroups(groups, MODEL_UNIT_COMPARE_MAX_UNITS);
  void runCompareUnits(picked.map(groupVersions));
}

/** 节点自己所属的那个单元（旧面板同一条路）/ 单独一组：与多单元同一条装载路，只是 detail 不带 `units` */
async function runCompareVersions(before: ModelVersion, after: ModelVersion, unit: string): Promise<void> {
  await runCompareUnits([{ unitRefno: unit, unitNoun: after.unitNoun, before, after }]);
}

/**
 * 装载路（单单元与多单元同一条，与校审恢复共用 `modelUnitCompareLoader`）：按份取几何（并发 ≤ 2，进度进 `compareProgress`）→
 * 每单元各比一份差异 → 树差异模式 → 一发 `open`。多单元时 `open` 的两侧是各单元并起来的、`units` 各自一份、`unitRefno` 是查的那个容器。
 */
async function runCompareUnits(pairs: readonly ModelUnitComparePair[]): Promise<void> {
  // 换单元（容器逐组）/ 换版本重开：视口的单视口 / 分屏跟上一轮走，不用每组再点一次「双视口分屏」
  const keepViewMode = compareRuntime.value?.status === 'ready' ? compareRuntime.value.viewMode : undefined;
  closeCompare();
  rows.value = [];
  compareCompleted.value = false;
  if (dbnum.value === null || pairs.length === 0) return;
  const run = ++requestId;
  comparing.value = true;
  error.value = null;
  activeTab.value = 'model';
  let load: ModelUnitCompareLoad | null = null;
  let adopted = false;
  try {
    load = await loadModelUnitComparePairs(pairs, {
      loadVersion: (version) => getModelSource().versions.loadVersion(version),
      shouldApply: () => run === requestId,
      onProgress: (progress) => { compareProgress.value = progress; },
    });
    if (run !== requestId) return;
    const loaded = load.pairs;
    // 三维里点到 A / B 隔离图层的构件时，属性面板钉到那一版：与树差异模式底部那块同一个取数口（句柄闭包在几何里）
    const attributesAt: ModelUnitCompareAttributesAt = (side, refno, signal) => getModelSource().versions.attributesAt(
      pickModelUnitCompareGeometry(loaded, side, refno, 'lenient'), refno, { signal });
    const view = buildModelUnitCompareView(loaded, {
      dbnum: dbnum.value,
      container: { unitRefno: normalizedRefno.value, unitNoun: nodeNoun.value },
      attributesAt,
      viewMode: keepViewMode,
      rawEntries: markRaw,
    });
    heldGeometries = load.geometries;
    adopted = true;
    rows.value = view.detail.rows;
    compareCompleted.value = true;
    compareActive.value = true;
    comparedInViewer.value = view.units.map((unit) => unit.unitRefno);
    dispatchTreeDiffContext(view.treeContext);
    dispatch(view.detail);
    focusQueriedElement();
  } catch (cause) {
    if (run === requestId) error.value = messageOf(cause);
  } finally {
    // 作废或半路出错：本次已取到的几何不留，还给来源（装载器自己失败时已经还过）
    if (load && !adopted) void load.release();
    if (run === requestId) {
      comparing.value = false;
      compareProgress.value = null;
    }
  }
}

function focusRow(refno: string): void {
  dispatch({ action: 'focus', refno });
}

/**
 * 属性对比 tab（`所有子节点`）每行的「定位」（设计稿 S3）：走版本对比事件的 `focus`——三维里装着 A / B 时飞到隔离图层里的它
 * （幽灵也找得到；装着的单元根自己没有几何对象时退一步飞到那个单元在 A / B 层的整体包围盒），没装时 ViewerPanel 回落到主图层（环境模型）
 * 里的同一 refno；哪儿都没有就不动相机。
 * 能不能点（B 侧已删且三维里没装 A / B 时置灰）由 tab 子组件按 `compareActive` 判，这里只收能点的。
 */
function locateElement(row: { refno: string; status: ModelNodeDiffStatus }): void {
  ensurePanelAndActivate('viewer');
  focusRow(row.refno);
}

/**
 * 查的是单元里的某个构件时，对比一跑完就把结果收窄到它：它那一行如果是 `unchanged`（两版几何一样）
 * 就先把「包含未变化」打开，否则列表里根本看不见它，然后选中并在三维里定位过去。
 */
function focusQueriedElement(): void {
  const refno = queriedElementRefno.value;
  if (!refno) return;
  const row = rows.value.find((item) => item.refno === refno);
  if (!row) return;
  if (row.status === 'unchanged') includeUnchanged.value = true;
  if (statusFilter.value !== 'all' && statusFilter.value !== row.status) statusFilter.value = 'all';
  focusRow(refno);
}

function setCompareSide(side: ModelUnitCompareSide): void {
  dispatch({ action: 'set-side', side });
}

function setCompareViewMode(viewMode: ModelUnitCompareViewMode): void {
  dispatch({ action: 'set-view-mode', viewMode });
}

/** 「三维只看差异」：与列表的「包含未变化」同一口径、各自开关（列表缺省只列差异，三维缺省整单元都在、留着环境看位置） */
function setCompareDiffOnly(diffOnly: boolean): void {
  dispatch({ action: 'set-diff-only', diffOnly });
}

function refreshCompareEnvironment(): void {
  dispatch({ action: 'refresh-environment' });
}

function closeCompare(): void {
  const wasActive = compareActive.value || compareRuntime.value !== null;
  // 先落自己的状态再派发：`handleCompareLifecycle` 会同步收到这一发 close，看到已不活跃就不再重复处理
  compareActive.value = false;
  compareRuntime.value = null;
  comparedInViewer.value = [];
  releaseHeldGeometries();
  if (wasActive) {
    dispatch({ action: 'close' });
    dispatchTreeDiffContext(null);
  }
}

function handleCompareLifecycle(event: Event): void {
  const detail = (event as CustomEvent<ModelUnitVersionCompareEventDetail>).detail;
  if (detail?.action !== 'close') return;
  // 自己刚派出去的 close 已经在 closeCompare 里处理完
  if (!compareActive.value && compareRuntime.value === null) return;
  // 视口侧关掉对比（ViewerPanel 的关闭按钮）：树的差异模式一并退出，持有的版本几何一并释放
  compareActive.value = false;
  compareRuntime.value = null;
  comparedInViewer.value = [];
  releaseHeldGeometries();
  dispatchTreeDiffContext(null);
}

function handleCompareRuntime(event: Event): void {
  compareRuntime.value = (event as CustomEvent<ModelUnitVersionCompareRuntimeState | null>).detail ?? null;
  compareActive.value = compareRuntime.value !== null;
  // 三维装载失败：两侧几何已用不上，服务端快照现在就还；树差异模式的属性取数口随之失效，一并退出。错误卡留着，「退出」照旧收尾
  if (compareRuntime.value?.status === 'error' && heldGeometries.length > 0) {
    releaseHeldGeometries();
    dispatchTreeDiffContext(null);
  }
}

/**
 * URL `compare_autorun=1`：查版本 → 按 `compare_a` / `compare_b` 选（缺省最近两版）→ 跑对比。
 * 容器没有自己的几何可跑：把那对套到时间线上（本范围没有、子树有就切「所有子节点」），落到模型对比 tab 看分组即停。
 */
async function autorunFromUrl(): Promise<void> {
  if (!urlConfig.autorun || !urlConfig.unitRefno) return;
  const run = requestId + 1;
  await loadVersions();
  // loadVersions 内部会推进 requestId；期间用户手动改了输入就不接着跑
  if (requestId !== run || timelineRows.value.length < 2) return;
  const wantPair = urlConfig.compareA !== null && urlConfig.compareB !== null && urlConfig.compareA !== urlConfig.compareB;
  const fallbackText = `URL 指定的版本 compare_a=${urlConfig.compareA ?? '-'} / compare_b=${urlConfig.compareB ?? '-'} 不在该节点的时间线里，已回落到最近两版`;
  if (!hasUnit.value) {
    // 容器（几何按其下的单元分组对比）：面板已开、时间线已列；URL 那对要在本范围内才套，仅子树里有就切过去；没给就到此为止
    if (!wantPair) return;
    const pairIn = (rows: NodeTimelineRow[]): boolean =>
      [urlConfig.compareA, urlConfig.compareB].every((sesno) => rows.some((row) => row.sesno === sesno && row.inScope));
    if (!pairIn(timelineRows.value) && hasMembers.value !== false
      && pairIn(buildNodeTimelineRows({ timeline: elementTimeline.value, history: attributeHistory.value, nodeVersions: nodeVersions.value, scope: 'subtree' }))) {
      scope.value = 'subtree';
    }
    if (pairIn(timelineRows.value)) {
      beforeSesno.value = Math.min(urlConfig.compareA!, urlConfig.compareB!);
      afterSesno.value = Math.max(urlConfig.compareA!, urlConfig.compareB!);
      activeTab.value = 'model';
    } else {
      error.value = fallbackText;
    }
    return;
  }
  const has = (sesno: number | null): sesno is number => sesno !== null && timelineRows.value.some((item) => item.sesno === sesno);
  let fallbackNote: string | null = null;
  if (has(urlConfig.compareA) && has(urlConfig.compareB) && urlConfig.compareA !== urlConfig.compareB) {
    beforeSesno.value = urlConfig.compareA;
    afterSesno.value = urlConfig.compareB;
  } else if (urlConfig.compareA !== null || urlConfig.compareB !== null) {
    fallbackNote = fallbackText;
  }
  await runCompare();
  // runCompare 会先清 error；回落提示放在它之后，且不盖住真正的失败
  if (fallbackNote && requestId === run + 1 && !error.value) error.value = fallbackNote;
}

/** 模型树右键「查看历史版本」/ 属性面板「历史」：把输入框换成那个节点并直接查一次（面板已开 / 刚被这一笔打开都走这里）。 */
function inspectRefno(refno: string): void {
  const normalized = refno.trim().replace(/\//g, '_');
  if (!normalized) return;
  unitRefno.value = normalized;
  void loadVersions();
}

function handleInspectRequest(event: Event): void {
  const refno = (event as CustomEvent<{ refno?: string }>).detail?.refno;
  takePendingModelVersionInspect();
  if (typeof refno === 'string') inspectRefno(refno);
}

onMounted(() => {
  window.addEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleCompareLifecycle);
  window.addEventListener(MODEL_UNIT_VERSION_COMPARE_STATE_EVENT, handleCompareRuntime);
  window.addEventListener(MODEL_VERSION_INSPECT_EVENT, handleInspectRequest);
  dispatch({ action: 'request-state' });
  // 面板是被「查看历史版本」这一笔打开的：事件在挂载之前就过去了，这里把它认领回来
  const pending = takePendingModelVersionInspect();
  if (pending) {
    inspectRefno(pending);
    return;
  }
  void autorunFromUrl();
});
onBeforeUnmount(() => {
  requestId += 1;
  summaryRequestId += 1;
  closeCompare();
  window.removeEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleCompareLifecycle);
  window.removeEventListener(MODEL_UNIT_VERSION_COMPARE_STATE_EVENT, handleCompareRuntime);
  window.removeEventListener(MODEL_VERSION_INSPECT_EVENT, handleInspectRequest);
});
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background" data-testid="model-unit-version-compare-panel">
    <header class="border-b border-border px-3 py-3">
      <div class="flex items-center gap-2">
        <GitCompare class="h-4 w-4 text-primary" />
        <div>
          <h2 class="text-sm font-semibold text-foreground">节点版本</h2>
          <p class="text-[11px] text-muted-foreground">任意节点：属性变化时间线 + 其下模型的历史对比</p>
        </div>
      </div>

      <form class="mt-3 flex gap-2" @submit.prevent="loadVersions">
        <input v-model="unitRefno"
          class="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          data-testid="model-unit-compare-refno"
          placeholder="节点参考号（构件 / 单元根 / 容器），例如 24384_23262"
          autocomplete="off" />
        <button type="submit"
          class="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          data-testid="model-unit-compare-load"
          :disabled="loadingVersions">
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loadingVersions }" />
          查询
        </button>
      </form>
      <p v-if="dbnum !== null" class="mt-1.5 text-[11px] text-muted-foreground" data-testid="model-unit-compare-scope">
        DB {{ dbnum }} · {{ normalizedRefno }}<template v-if="nodeNoun">（{{ nodeNoun }}）</template>
        <template v-if="queriedElementRefno">
          · 所属单元 {{ comparedUnitRefno }}（{{ elementTimeline?.unitNoun }}）
        </template>
        <template v-else-if="hasUnit"> · 最小交付单元根</template>
        <template v-else> · 容器，不属于任何最小交付单元</template>
      </p>
      <p v-if="elementTimeline?.unitColumnOnly && queriedElementRefno" class="mt-1 text-[11px] text-amber-600" data-testid="model-unit-compare-element-column-missing">
        服务端还没有 <code>element/versions</code>：只列得出单元那一列，「本构件」那一格要新版服务端。
      </p>

      <div v-if="dbnum !== null" class="mt-2 flex items-center gap-2" data-testid="model-unit-compare-scope-toggle">
        <span class="text-[11px] font-medium text-muted-foreground">对比范围</span>
        <div class="flex flex-1 rounded-md bg-muted p-0.5 text-[11px]">
          <button type="button"
            class="flex-1 rounded px-2 py-1"
            :class="scope === 'self' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="scope === 'self'"
            data-testid="model-unit-compare-scope-self"
            @click="setScope('self')">
            仅自身
          </button>
          <button type="button"
            class="flex-1 rounded px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            :class="scope === 'subtree' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="scope === 'subtree'"
            :disabled="hasMembers === false"
            :title="hasMembers === false ? '叶子节点没有成员' : undefined"
            data-testid="model-unit-compare-scope-subtree"
            @click="setScope('subtree')">
            所有子节点
          </button>
        </div>
      </div>
      <p v-if="hasMembers === false && dbnum !== null" class="mt-1 text-[10px] text-muted-foreground">叶子节点没有成员：「所有子节点」置灰</p>
    </header>

    <div class="min-h-0 flex-1 overflow-auto p-3">
      <div v-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="model-unit-compare-error">
        {{ error }}
      </div>
      <div v-if="notice" class="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-800" data-testid="model-unit-compare-notice">
        {{ notice }}
      </div>

      <template v-if="timelineRows.length > 0">
        <NodeVersionTimeline v-model:self-only="selfOnly"
          v-model:geometry-only="geometryOnly"
          v-model:manual-a="manualA"
          v-model:manual-b="manualB"
          :rows="timelineRows"
          :slice="timelineSlice"
          :counts="timelineCounts"
          :scope="scope"
          :before-sesno="beforeSesno"
          :after-sesno="afterSesno"
          :pair-ready="pairReady"
          :self-column-unknown="selfColumnUnknown"
          :queried-is-unit-root="queriedIsUnitRoot"
          :history-unavailable="historyUnavailable"
          :show-manual-pair="!hasUnit && !nodeVersions"
          :share-status="shareStatus"
          @pick="pickSide"
          @with-previous="compareWithPrevious"
          @with-latest="compareWithLatest"
          @copy-link="copyCompareLink"
          @apply-manual-pair="applyManualPair"
          @expand="timelineExpanded = true" />

        <div class="mt-3 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-xs" data-testid="model-unit-compare-tabs">
          <button type="button" class="rounded px-2 py-1.5"
            :class="activeTab === 'attributes' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="activeTab === 'attributes'"
            data-testid="model-unit-compare-tab-attributes"
            @click="activeTab = 'attributes'">
            属性对比
          </button>
          <button type="button" class="rounded px-2 py-1.5"
            :class="activeTab === 'model' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="activeTab === 'model'"
            data-testid="model-unit-compare-tab-model"
            @click="activeTab = 'model'">
            模型对比
          </button>
        </div>

        <!-- 属性对比 -->
        <NodeVersionAttributesTab v-if="activeTab === 'attributes'"
          v-model:include-unchanged="includeUnchanged"
          :scope="scope"
          :pair-ready="pairReady"
          :before-sesno="beforeSesno"
          :after-sesno="afterSesno"
          :loading-self-diff="loadingSelfDiff"
          :self-diff-error="selfDiffError"
          :self-diff="selfDiff"
          :diff-summary-unavailable="diffSummaryUnavailable"
          :loading-summary="loadingSummary"
          :diff-summary-error="diffSummaryError"
          :diff-summary="diffSummary"
          :changed-element-rows="changedElementRows"
          :expanded-element="expandedElement"
          :element-diffs="elementDiffs"
          :compare-active="compareActive"
          @toggle-element="toggleElementDiff"
          @locate="locateElement" />

        <!-- 模型对比 -->
        <NodeVersionModelTab v-if="activeTab === 'model'"
          v-model:status-filter="statusFilter"
          v-model:include-unchanged="includeUnchanged"
          :scope="scope"
          :pair-ready="pairReady"
          :before-sesno="beforeSesno"
          :after-sesno="afterSesno"
          :has-unit="hasUnit"
          :compared-unit-refno="comparedUnitRefno"
          :queried-element-refno="queriedElementRefno"
          :diff-summary="diffSummary"
          :loading-summary="loadingSummary"
          :diff-summary-unavailable="diffSummaryUnavailable"
          :geometry-groups="geometryGroups"
          :comparing="comparing"
          :loading-versions="loadingVersions"
          :compare-progress="compareProgress"
          :pending-groups-confirm="pendingGroupsConfirm"
          :compared-in-viewer="comparedInViewer"
          :compare-runtime="compareRuntime"
          :compare-completed="compareCompleted"
          :rows="rows"
          :same-geometry="sameGeometry"
          @run="runCompare"
          @run-group="runCompareGroup"
          @run-groups="runCompareGroups"
          @confirm="confirmGroups"
          @close="closeCompare"
          @set-view-mode="setCompareViewMode"
          @set-side="setCompareSide"
          @set-diff-only="setCompareDiffOnly"
          @refresh-environment="refreshCompareEnvironment"
          @focus-row="focusRow" />
      </template>
    </div>
  </section>
</template>
