<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { GitCompare, RefreshCw, X } from 'lucide-vue-next';

import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { dispatchTreeDiffContext, type TreeDiffAttributesAt } from '@/composables/useTreeVersionDiff';
import {
  getModelSource,
  ModelVersionRouteUnavailableError,
  type ModelAttributeHistory,
  type ModelElementVersionTimeline,
  type ModelNodeDiffGroup,
  type ModelNodeDiffScope,
  type ModelNodeDiffStatus,
  type ModelNodeDiffSummary,
  type ModelNodeVersionTimeline,
  type ModelSource,
  type ModelVersion,
  type ModelVersionGeometry,
  type ModelVersionImpactKind,
} from '@/model-source';
import {
  buildTreeDiffModels,
  type TreeDiffDispatchInput,
  compareModelUnitGeometry,
  countGroupProjections,
  formatModelUnitVersionTime,
  geometrySnapshotsFromInstanceEntries,
  mergeModelUnitVersionSides,
  modelUnitGroupSideImpactKinds,
  modelUnitVersionAbsentNote,
  MODEL_UNIT_COMPARE_MAX_UNITS,
  MODEL_UNIT_VERSION_COMPARE_EVENT,
  MODEL_UNIT_VERSION_COMPARE_STATE_EVENT,
  MODEL_VERSION_INSPECT_EVENT,
  orderModelUnitVersionPair,
  pickMostChangedGroups,
  readModelUnitVersionCompareUrl,
  takePendingModelVersionInspect,
  type ModelUnitCompareSide,
  type ModelUnitCompareViewMode,
  type ModelUnitGeometryDiff,
  type ModelUnitGeometryStatus,
  type ModelUnitVersionCompareEventDetail,
  type ModelUnitVersionCompareRuntimeState,
  type ModelUnitVersionCompareUnit,
  type ModelUnitVersionSide,
} from '@/utils/modelUnitVersionCompare';
import {
  buildNodeTimelineRows,
  countNodeTimeline,
  defaultNodeScope,
  defaultNodeVersionPair,
  emptyNetDiffText,
  filterNodeTimelineRows,
  foldAttributeChanges,
  NODE_TIMELINE_INITIAL_ROWS,
  pairWithLatest,
  pairWithPrevious,
  pickNodeVersionSide,
  sliceNodeTimelineRows,
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
/** 查的那个节点的两列版本时间线（`listElementVersions`）：它自己变没变、所属单元变没变 */
const elementTimeline = ref<ModelElementVersionTimeline | null>(null);
/** 属性变化时间线（`attributeHistory`）；旧服务端没有这条路由时为 null，`historyUnavailable` 说明原因 */
const attributeHistory = ref<ModelAttributeHistory | null>(null);
const historyUnavailable = ref<string | null>(null);
/**
 * 节点版本表（`listNodeVersions` scope=subtree，CONTEXT「节点版本表」）：只在节点是容器（不在任何单元下）时去取——
 * 单元及以下的子树 ≈ 所属单元，单元表已经给了。旧服务端没有这条路由时为 null，`nodeVersionsUnavailable` 说明原因，
 * 面板退回「手填会话号」。
 */
const nodeVersions = ref<ModelNodeVersionTimeline | null>(null);
const nodeVersionsUnavailable = ref<string | null>(null);
/** 节点有没有成员：null = 没问到（模型来源没给树口），false = 叶子（「所有子节点」置灰） */
const hasMembers = ref<boolean | null>(null);
const scope = ref<ModelNodeDiffScope>('subtree');
/** 本次对比持有的版本几何，关闭 / 重查时 `release()`（gen-model-v1 下是服务端快照） */
let heldGeometries: ModelVersionGeometry[] = [];
const beforeSesno = ref<number | null>(null);
const afterSesno = ref<number | null>(null);
const loadingVersions = ref(false);
const comparing = ref(false);
const error = ref<string | null>(null);
/** 非致命的说明（没有几何可比、旧服务端缺路由等），与 `error` 分开显示 */
const notice = ref<string | null>(null);
const rows = ref<ModelUnitGeometryDiff[]>([]);
const statusFilter = ref<'all' | Exclude<ModelUnitGeometryStatus, 'unchanged'>>('all');
const includeUnchanged = ref(false);
const geometryOnly = ref(false);
/** 「只看自身变的」（设计稿 S2，`所有子节点` 下才露出）：子树动了、节点自身没动的会话不列；自身列未知（旧服务端）时置灰不筛 */
const selfOnly = ref(false);
/** 时间线「加载更早 n 版…」点开了没（设计稿 S1）：缺省只画最近 `NODE_TIMELINE_INITIAL_ROWS` 行；换节点重载时折回去，切范围 / 勾选不折 */
const timelineExpanded = ref(false);
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
/** 查的那个节点自己就是单元根时，两列说的是同一件事，界面上不再多说一遍 */
const queriedIsUnitRoot = computed(() => {
  const timeline = elementTimeline.value;
  return !timeline || timeline.unitRefno === null || timeline.unitRefno === timeline.refno;
});
/** 对比按这个单元跑（几何只按单元生成）；查的是构件时它是解出来的所属单元根 */
const comparedUnitRefno = computed(() => elementTimeline.value?.unitRefno ?? normalizedRefno.value);
/** 查的那个构件（不是单元根时才有）：对比结果与三维定位都收窄到它 */
const queriedElementRefno = computed(() => (queriedIsUnitRoot.value ? null : elementTimeline.value?.refno ?? null));
const nodeNoun = computed(() => elementTimeline.value?.noun || attributeHistory.value?.noun || '');
const hasUnit = computed(() => !!elementTimeline.value?.unitRefno);
/** 旧服务端只给得出单元那一列：自身那一列是未知，不是「没变」 */
const selfColumnUnknown = computed(() => elementTimeline.value?.unitColumnOnly === true);

const timelineRows = computed<NodeTimelineRow[]>(() => buildNodeTimelineRows({
  timeline: elementTimeline.value,
  history: attributeHistory.value,
  nodeVersions: nodeVersions.value,
  scope: scope.value,
}));
/** 「本范围 n 版 · 仅属性 m」：n 与服务端版本表的行数对得上，m 是只在属性变化时间线里的会话（UDA 之类） */
const timelineCounts = computed(() => countNodeTimeline(timelineRows.value, scope.value));
/** 范围内的行 + 被选为 A/B 但已不在范围内的行（灰掉、标「本范围无变化」，Q9 a）；两个勾选各筛一维（`filterNodeTimelineRows`） */
const visibleTimelineRows = computed(() => filterNodeTimelineRows(timelineRows.value, {
  scope: scope.value,
  selected: [beforeSesno.value, afterSesno.value],
  geometryOnly: geometryOnly.value,
  selfOnly: selfOnly.value,
  selfColumnUnknown: selfColumnUnknown.value,
}));
/** 实际画出来的那一段 + 折起的更早版数（`sliceNodeTimelineRows`）：被选为 A / B 的行一定在画出来的那段里 */
const timelineSlice = computed(() => sliceNodeTimelineRows(visibleTimelineRows.value, {
  expanded: timelineExpanded.value,
  selected: [beforeSesno.value, afterSesno.value],
}));
const selectedBefore = computed(() => versionFor(beforeSesno.value));
const selectedAfter = computed(() => versionFor(afterSesno.value));
/** 两个版本几何相同的承诺（`ModelVersion.geometryKey` 相等）；键缺失时不承诺 */
const sameGeometry = computed(() => sameGeometryKey(selectedBefore.value, selectedAfter.value));
const pairReady = computed(() => beforeSesno.value !== null && afterSesno.value !== null && beforeSesno.value < afterSesno.value);

/** 属性对比（仅自身）表里实际列出的行：戳（`CACHID` 一类）缺省不列，勾「含戳」才列 */
const selfDiffVisible = computed(() => (selfDiff.value?.changes ?? []).filter((change) => includeUnchanged.value || !change.stamp));
/** 「n 项变化」只数属性行（不含戳）；成员 / owner 另说一句 */
const selfDiffCount = computed(() => (selfDiff.value?.changes ?? []).filter((change) => !change.stamp).length);
/** `所有子节点` 下属性对比的构件清单：差异摘要里有变的行，节点自身置顶（Q12 a） */
const changedElementRows = computed(() => {
  const summary = diffSummary.value;
  if (!summary) return [];
  const list = summary.groups.flatMap((group) => group.rows.map((row) => ({ ...row, unitRefno: group.unitRefno, unitNoun: group.unitNoun })));
  list.sort((x, y) => Number(y.isNode) - Number(x.isNode));
  return list;
});
/** `所有子节点` 下有几何要重算的组，每组一个「在三维中对比」 */
const geometryGroups = computed(() => (diffSummary.value?.groups ?? []).filter((group) => group.unitRefno && group.geometryChanged));

function sameGeometryKey(a: ModelVersion | null, b: ModelVersion | null): boolean {
  return !!a && !!b && a.geometryKey !== undefined && a.geometryKey === b.geometryKey;
}

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

const summary = computed(() => {
  const counts: Record<ModelUnitGeometryStatus, number> = { added: 0, deleted: 0, modified: 0, unchanged: 0 };
  for (const row of rows.value) counts[row.status] += 1;
  return counts;
});
const noGeometryDifference = computed(() => compareCompleted.value
  && summary.value.added === 0
  && summary.value.deleted === 0
  && summary.value.modified === 0);

const visibleRows = computed(() => rows.value.filter((row) => {
  if (!includeUnchanged.value && row.status === 'unchanged') return false;
  return statusFilter.value === 'all' || row.status === statusFilter.value;
}));

function dispatch(detail: ModelUnitVersionCompareEventDetail): void {
  window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_EVENT, { detail }));
}

/**
 * 把本次模型几何差异送进模型树的差异模式（徽章 / 幽灵节点 / 筛选）。本面板是该通道唯一的派发方（ADR 0065 §1.4）；
 * 模型列表怎么折（`unchanged` 不进、`ownerRefno` 从哪侧取、tombstone 补单元根）见 `buildTreeDiffModels`。
 */
type TreeDiffUnit = { input: TreeDiffDispatchInput; geometries: { before: ModelVersionGeometry; after: ModelVersionGeometry } };

/**
 * 「哪一侧、哪个 refno」→ 该去哪份版本几何里取属性：多单元一次装载时每个单元一对句柄，按 refno 在那一侧的 `refnos` 里找它属于哪份；
 * 找不到（单元根自己 / 幽灵）就退到第一份。单单元就只有一份。
 */
function attributesAtFor(units: readonly TreeDiffUnit[]): TreeDiffAttributesAt {
  const pick = (side: ModelUnitCompareSide, refno: string): ModelVersionGeometry => {
    const hit = units.length > 1 ? units.find((unit) => unit.geometries[side].refnos.includes(refno)) : undefined;
    return (hit ?? units[0]!).geometries[side];
  };
  return (side, refno, signal) => getModelSource().versions.attributesAt(pick(side, refno), refno, { signal });
}

/** 模型树差异模式：每个单元各折一份模型列表（B 侧 tombstone 的单元根也进树）拼起来；`attributesAt` 闭包住本次持有的全部版本几何 */
function dispatchTreeDiff(units: readonly TreeDiffUnit[]): void {
  const first = units[0];
  if (!first) return;
  const models = units.flatMap((unit) => buildTreeDiffModels(unit.input));
  dispatchTreeDiffContext({
    dbnum: first.input.dbnum,
    fromSesno: first.input.before.sesno,
    toSesno: first.input.after.sesno,
    mode: 'compare',
    refnos: models.map((model) => model.refno),
    models,
    attributesAt: attributesAtFor(units),
  });
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function impactLabel(impact: ModelVersionImpactKind | null): string {
  return impact ?? '未变';
}

/** 行上那颗徽章显示哪一列：`仅自身` 看自身列；自身列未知（旧服务端）时只剩单元那一列可显示，别谎报「未变」 */
function rowImpact(row: NodeTimelineRow): ModelVersionImpactKind | null {
  if (scope.value === 'self' && !selfColumnUnknown.value) return row.selfImpact;
  return row.unitImpact ?? row.selfImpact;
}

/** 单元根 / 容器的那一颗徽章要不要画成「仅属性」：显示的是自身列、且版本表没把这一会话算成一版 */
function attributeOnlyShown(row: NodeTimelineRow): boolean {
  if (!row.attributeOnly) return false;
  return scope.value === 'self' ? !selfColumnUnknown.value : row.unitImpact === null;
}

function impactClass(impact: ModelVersionImpactKind | null): string {
  switch (impact) {
    case 'mesh': return 'bg-amber-100 text-amber-700';
    case 'placement': return 'bg-blue-100 text-blue-700';
    case 'delivery': return 'bg-emerald-100 text-emerald-700';
    case 'tombstone': return 'bg-rose-100 text-rose-700';
    case 'noop': return 'bg-slate-100 text-slate-600';
    default: return 'bg-slate-100 text-slate-500';
  }
}

const STATUS_LABEL: Record<string, string> = { added: '新增', deleted: '删除', modified: '修改', unchanged: '未变', noop: 'noop' };
const STATUS_CLASS: Record<string, string> = {
  added: 'bg-emerald-100 text-emerald-700',
  deleted: 'bg-rose-100 text-rose-700',
  modified: 'bg-amber-100 text-amber-700',
  unchanged: 'bg-slate-100 text-slate-600',
  noop: 'bg-slate-100 text-slate-600',
};
/** 属性净差的去向（服务端 `kind`）：created = A 侧不存在，deleted = B 侧不存在 */
const DIFF_KIND_LABEL: Record<string, string> = { created: 'A 侧不存在 · 新建', modified: '修改', deleted: 'B 侧不存在 · 已删', unchanged: '两端一字没差' };
const DIFF_KIND_CLASS: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-700',
  modified: 'bg-amber-100 text-amber-700',
  deleted: 'bg-rose-100 text-rose-700',
  unchanged: 'bg-slate-100 text-slate-600',
};

/** 成员表两端真差的一句话：`新增 n · 移除 m · 重排` */
function membersText(members: NonNullable<AttributeNetDiffView['members']>): string {
  const parts: string[] = [];
  if (members.added.length) parts.push(`新增 ${members.added.length}（${members.added.slice(0, 3).join('、')}${members.added.length > 3 ? '…' : ''}）`);
  if (members.removed.length) parts.push(`移除 ${members.removed.length}（${members.removed.slice(0, 3).join('、')}${members.removed.length > 3 ? '…' : ''}）`);
  if (members.reordered) parts.push('重排');
  return parts.join(' · ');
}

/** 一格净差的取数口径，写在表底：服务端两端直接读终态，还是旧服务端下折出来的 */
function diffSourceText(view: AttributeNetDiffView): string {
  return view.source === 'server'
    ? '取数：服务端 element/attribute-diff——A / B 各钉一个会话、同一个属性渲染器两端各出一次字，直接读终态；未变的属性不列。'
    : '取数：服务端还没有 element/attribute-diff，这里把 (A, B] 里逐会话的 before / after 折成净差；成员 / owner 只能说「动过」。';
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
  elementTimeline.value = null;
  attributeHistory.value = null;
  historyUnavailable.value = null;
  nodeVersions.value = null;
  nodeVersionsUnavailable.value = null;
  hasMembers.value = null;
  diffSummary.value = null;
  diffSummaryError.value = null;
  diffSummaryUnavailable.value = false;
  selfDiff.value = null;
  selfDiffError.value = null;
  attributeDiffUnavailable.value = false;
  elementDiffs.value = new Map();
  expandedElement.value = null;
  timelineExpanded.value = false;
  pendingGroupsConfirm.value = null;
  dbnum.value = null;
  beforeSesno.value = null;
  afterSesno.value = null;
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
    elementTimeline.value = timeline;
    attributeHistory.value = history;
    nodeVersions.value = subtree;
    hasMembers.value = members;
    versions.value = unitVersions;
    scope.value = defaultNodeScope({ unitRefno: timeline.unitRefno, hasMembers: members });
    const pair = defaultNodeVersionPair(timelineRows.value);
    beforeSesno.value = pair.a;
    afterSesno.value = pair.b;
    if (timelineRows.value.length === 0) {
      notice.value = [notice.value, `${refno} 在整条会话链上没有任何一版变化`].filter(Boolean).join(' ');
    }
  } catch (cause) {
    if (run === requestId) {
      versions.value = [];
      elementTimeline.value = null;
      attributeHistory.value = null;
      nodeVersions.value = null;
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

function setScope(next: ModelNodeDiffScope): void {
  if (next === scope.value) return;
  if (next === 'subtree' && hasMembers.value === false) return;
  scope.value = next;
  // 切范围不重选 A/B（Q9 a）：两端保留，越界的行灰掉；只有一端还没选时才补缺省
  if (beforeSesno.value === null || afterSesno.value === null) {
    const pair = defaultNodeVersionPair(timelineRows.value);
    beforeSesno.value = beforeSesno.value ?? pair.a;
    afterSesno.value = afterSesno.value ?? pair.b;
  }
  expandedElement.value = null;
}

function pickSide(side: 'a' | 'b', sesno: number): void {
  const pair = pickNodeVersionSide(timelineRows.value, { a: beforeSesno.value, b: afterSesno.value }, side, sesno);
  beforeSesno.value = pair.a;
  afterSesno.value = pair.b;
}

function compareWithPrevious(): void {
  const pair = pairWithPrevious(timelineRows.value, { a: beforeSesno.value, b: afterSesno.value });
  beforeSesno.value = pair.a;
  afterSesno.value = pair.b;
}

function compareWithLatest(): void {
  const pair = pairWithLatest(timelineRows.value, { a: beforeSesno.value, b: afterSesno.value });
  beforeSesno.value = pair.a;
  afterSesno.value = pair.b;
}

/**
 * 手填 A / B（容器节点撞上旧服务端时的兜底）：子树的时间线要 `node/versions?scope=subtree`，没有这条路由的服务端上容器
 * 只列得出它自己变过的那几版；差异摘要与分组三维对比却能吃任意两个会话号，所以这里让人直接填。填完按新旧摆正。
 * 节点版本表取到了就不再露出这一栏。
 */
const manualA = ref('');
const manualB = ref('');
function applyManualPair(): void {
  const a = Number.parseInt(manualA.value, 10);
  const b = Number.parseInt(manualB.value, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) {
    error.value = '手填的 A / B 要是两个不同的会话号';
    return;
  }
  error.value = null;
  beforeSesno.value = Math.min(a, b);
  afterSesno.value = Math.max(a, b);
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
    diffSummary.value = result;
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

/** 展开的构件那一格已经算出来的净差；还在算 / 失败（字串）时为 null */
function elementDiffView(refno: string): AttributeNetDiffView | null {
  const entry = elementDiffs.value.get(refno);
  return entry && typeof entry === 'object' ? entry : null;
}

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

type LoadedSide = {
  snapshots: ReturnType<typeof geometrySnapshotsFromInstanceEntries>
  refnos: string[]
  geometry: ModelVersionGeometry
}

/** 经模型来源端口取一个版本的几何；tombstone 由适配器回空集（「已删除单元版本」）。 */
async function loadSide(version: ModelVersion): Promise<LoadedSide> {
  const geometry = await getModelSource().versions.loadVersion(version);
  return { snapshots: geometrySnapshotsFromInstanceEntries(geometry.entries), refnos: geometry.refnos, geometry };
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
    sessionTime: timelineRows.value.find((row) => row.sesno === sesno)?.sessionTime ?? null,
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

/** 总按钮 / 确认框上的「N 个单元 · 约 M 份历史投影」 */
const groupsProjectionText = computed(() => `${geometryGroups.value.length} 个单元 · 约 ${countGroupProjections(geometryGroups.value)} 份历史投影`);

/** 节点自己所属的那个单元（旧面板同一条路）/ 单独一组：与多单元同一条装载路，只是 detail 不带 `units` */
async function runCompareVersions(before: ModelVersion, after: ModelVersion, unit: string): Promise<void> {
  await runCompareUnits([{ unitRefno: unit, unitNoun: after.unitNoun, before, after }]);
}

type UnitPair = { unitRefno: string; unitNoun: string; before: ModelVersion; after: ModelVersion };

/**
 * 装载路（单单元与多单元同一条）：按份取几何（并发 ≤ 2，进度进 `compareProgress`）→ 每单元各比一份差异 → 树差异模式 → 一发 `open`。
 * 多单元时 `open` 的 `before` / `after` 是各单元并起来的一侧、`rows` 拼起来、`units` 各自一份、`unitRefno` 是查的那个容器；
 * 单单元 detail 与从前逐字相同（不带 `units`）。几何相同的承诺（同一 geometryKey）→ 那个单元只取一次、两侧共用。
 */
async function runCompareUnits(pairs: readonly UnitPair[]): Promise<void> {
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
  const loaded = new Map<string, { before: LoadedSide; after: LoadedSide }>();
  const taken: LoadedSide[] = [];
  try {
    // 一份 = 一次 loadSide；同 geometryKey 只取 B 那一份两侧共用。tombstone 侧适配器回空集、不去服务端，不算进度里的份
    type Task = { label: string; counts: boolean; run: () => Promise<void> };
    const tasks: Task[] = [];
    const partial = new Map<string, { before?: LoadedSide; after?: LoadedSide }>();
    for (const pair of pairs) {
      const slot: { before?: LoadedSide; after?: LoadedSide } = {};
      partial.set(pair.unitRefno, slot);
      const label = (version: ModelVersion) => `${pair.unitNoun || '单元'} ${pair.unitRefno}@${version.sesno}`;
      if (sameGeometryKey(pair.before, pair.after)) {
        tasks.push({ label: label(pair.after), counts: true, run: async () => { const data = await loadSide(pair.after); taken.push(data); slot.before = data; slot.after = data; } });
      } else {
        tasks.push({ label: label(pair.before), counts: pair.before.impactKind !== 'tombstone', run: async () => { const data = await loadSide(pair.before); taken.push(data); slot.before = data; } });
        tasks.push({ label: label(pair.after), counts: pair.after.impactKind !== 'tombstone', run: async () => { const data = await loadSide(pair.after); taken.push(data); slot.after = data; } });
      }
    }
    const total = tasks.filter((task) => task.counts).length;
    compareProgress.value = { done: 0, total, current: [] };
    const queue = tasks.slice();
    // 并发 ≤ 2 的小工位：一份失败 / 本次被更新的请求作废，就不再开新的份；正在飞的那份等它落地再一起还回去（不然那份快照漏掉）
    const failure: { current: { cause: unknown } | null } = { current: null };
    const worker = async (): Promise<void> => {
      for (let task = queue.shift(); task && !failure.current && run === requestId; task = queue.shift()) {
        if (task.counts) compareProgress.value = { ...compareProgress.value!, current: [...compareProgress.value!.current, task.label] };
        try {
          await task.run();
        } catch (cause) {
          failure.current ??= { cause };
          return;
        }
        if (task.counts && run === requestId) {
          const progress = compareProgress.value!;
          compareProgress.value = { done: progress.done + 1, total, current: progress.current.filter((item) => item !== task.label) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, () => worker()));
    if (failure.current) throw failure.current.cause;
    if (run !== requestId) {
      // 本次比较已被更新的请求作废：几何拿到了也不留，直接还给来源
      releaseTaken();
      return;
    }
    for (const [unitRefno, slot] of partial) loaded.set(unitRefno, { before: slot.before!, after: slot.after! });
    heldGeometries = [...new Set(taken.map((data) => data.geometry))];

    const units: ModelUnitVersionCompareUnit[] = pairs.map((pair) => {
      const data = loaded.get(pair.unitRefno)!;
      const side = (version: ModelVersion, item: LoadedSide): ModelUnitVersionSide => ({
        version, sesno: version.sesno, refnos: item.refnos, entries: markRaw(item.geometry.entries),
      });
      return {
        unitRefno: pair.unitRefno,
        unitNoun: pair.unitNoun,
        before: side(pair.before, data.before),
        after: side(pair.after, data.after),
        rows: compareModelUnitGeometry(data.before.snapshots, data.after.snapshots),
      };
    });
    rows.value = units.flatMap((unit) => unit.rows);
    compareCompleted.value = true;
    compareActive.value = true;
    comparedInViewer.value = units.map((unit) => unit.unitRefno);
    const treeUnits: TreeDiffUnit[] = units.map((unit) => {
      const data = loaded.get(unit.unitRefno)!;
      return {
        input: {
          dbnum: dbnum.value!,
          before: unit.before.version,
          after: unit.after.version,
          rows: unit.rows,
          beforeOwners: data.before.geometry.ownerByRefno,
          afterOwners: data.after.geometry.ownerByRefno,
        },
        geometries: { before: data.before.geometry, after: data.after.geometry },
      };
    });
    dispatchTreeDiff(treeUnits);
    const single = units.length === 1 ? units[0]! : null;
    const container = { dbnum: dbnum.value, unitRefno: normalizedRefno.value, unitNoun: nodeNoun.value };
    dispatch({
      action: 'open',
      dbnum: dbnum.value,
      unitRefno: single ? single.unitRefno : normalizedRefno.value,
      before: single ? single.before : mergeModelUnitVersionSides(units, 'before', container),
      after: single ? single.after : mergeModelUnitVersionSides(units, 'after', container),
      refnos: rows.value.map((row) => row.refno),
      rows: rows.value,
      // 三维里点到 A / B 隔离图层的构件时，属性面板钉到那一版：与树差异模式底部那块同一个取数口（句柄闭包在几何里）
      attributesAt: attributesAtFor(treeUnits),
      ...(keepViewMode ? { viewMode: keepViewMode } : {}),
      ...(single ? {} : { units }),
    });
    focusQueriedElement();
  } catch (cause) {
    if (run === requestId) error.value = messageOf(cause);
    // 半路失败（或作废后才失败）：本次已取到的几份还回去，别留着快照
    releaseTaken();
  } finally {
    if (run === requestId) {
      comparing.value = false;
      compareProgress.value = null;
    }
  }

  /** 把本次取到的几份几何还给来源（只动本次的，别的请求持有的不碰） */
  function releaseTaken(): void {
    const mine = new Set(taken.map((data) => data.geometry));
    heldGeometries = heldGeometries.filter((geometry) => !mine.has(geometry));
    taken.length = 0;
    for (const geometry of mine) {
      void geometry.release().catch((reason) => {
        console.warn('[ModelUnitVersionComparePanel] release version geometry failed', reason);
      });
    }
  }
}

function focusRow(refno: string): void {
  dispatch({ action: 'focus', refno });
}

/**
 * 属性对比 tab（`所有子节点`）每行的「定位」（设计稿 S3）：走版本对比事件的 `focus`——三维里装着 A / B 时飞到隔离图层里的它
 * （幽灵也找得到），没装时 ViewerPanel 回落到主图层（环境模型）里的同一 refno；哪儿都没有就不动相机。
 * B 侧已删且三维里没装 A / B 时按钮置灰：当前会话里已经没有它，环境模型里找不到。
 */
function canLocateElement(row: { status: ModelNodeDiffStatus }): boolean {
  return compareActive.value || row.status !== 'deleted';
}

function locateElementTitle(row: { status: ModelNodeDiffStatus }): string {
  if (!canLocateElement(row)) return 'B 版已删除，当前模型里没有它；先「在三维中对比」再定位';
  return compareActive.value ? '飞到三维里 A / B 那一版的它' : '飞到当前模型里的它（已加载时）';
}

function locateElement(row: { refno: string; status: ModelNodeDiffStatus }): void {
  if (!canLocateElement(row)) return;
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

/** 多单元一次装载时，这一侧不存在（tombstone）的那几个单元根：A / B 卡上列出来（并起来的那一侧只有全空才标 tombstone） */
function absentUnits(detail: ModelUnitVersionCompareRuntimeState['detail'], side: ModelUnitCompareSide): string[] {
  return (detail.units ?? []).filter((unit) => unit[side].version.impactKind === 'tombstone').map((unit) => unit.unitRefno);
}

function setCompareViewMode(viewMode: ModelUnitCompareViewMode): void {
  dispatch({ action: 'set-view-mode', viewMode });
}

/** 「三维只看差异」：与列表的「包含未变化」同一口径、各自开关（列表缺省只列差异，三维缺省整单元都在、留着环境看位置） */
function setCompareDiffOnly(diffOnly: boolean): void {
  dispatch({ action: 'set-diff-only', diffOnly });
}

/** 视口那边正在对比的那份 `rows` 里有没有非 unchanged 的行（没有就把「三维只看差异」置灰） */
const compareRuntimeHasGeometryDifference = computed(() => (
  (compareRuntime.value?.detail.rows ?? []).some((row) => row.status !== 'unchanged')
));

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
        <div class="mt-1 flex items-center justify-between gap-2">
          <h3 class="text-xs font-semibold text-foreground" data-testid="model-unit-compare-timeline-head">
            版本时间线 · 本范围 {{ timelineCounts.versions }} 版<template v-if="timelineCounts.attributeOnly"> · 仅属性 {{ timelineCounts.attributeOnly }}</template>
          </h3>
          <span class="flex items-center gap-2 text-[10px] text-muted-foreground">
            <label v-if="scope === 'subtree'" class="flex items-center gap-1" :class="selfColumnUnknown ? 'opacity-50' : ''"
              :title="selfColumnUnknown ? '服务端没给出节点自身那一列，分不出哪些会话是它自己变的' : '只列节点自身记录变过的会话（含只改了属性的）；子树里别的构件动了、它自己没动的不列'">
              <input v-model="selfOnly" type="checkbox" :disabled="selfColumnUnknown" data-testid="model-unit-compare-self-only" />只看自身变的
            </label>
            <label class="flex items-center gap-1">
              <input v-model="geometryOnly" type="checkbox" data-testid="model-unit-compare-geometry-only" />只看几何变的
            </label>
          </span>
        </div>
        <p v-if="historyUnavailable" class="mt-1 text-[10px] text-amber-600" data-testid="model-unit-compare-history-missing">{{ historyUnavailable }}</p>

        <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <button type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50"
            data-testid="model-unit-compare-with-previous" @click="compareWithPrevious">
            与上一版比
          </button>
          <button type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50"
            data-testid="model-unit-compare-with-latest" @click="compareWithLatest">
            与最新比
          </button>
          <span class="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            <span class="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700" data-testid="model-unit-compare-a" :data-sesno="beforeSesno ?? ''">
              A · {{ beforeSesno ?? '—' }}
            </span>
            <span class="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700" data-testid="model-unit-compare-b" :data-sesno="afterSesno ?? ''">
              B · {{ afterSesno ?? '—' }}
            </span>
          </span>
        </div>

        <form v-if="!hasUnit && !nodeVersions" class="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground" data-testid="model-unit-compare-manual-pair" @submit.prevent="applyManualPair">
          <span>手填会话号</span>
          <input v-model="manualA" class="w-14 rounded border border-input bg-background px-1 py-0.5 font-mono text-[10px]" placeholder="A" inputmode="numeric" data-testid="model-unit-compare-manual-a" />
          <span>→</span>
          <input v-model="manualB" class="w-14 rounded border border-input bg-background px-1 py-0.5 font-mono text-[10px]" placeholder="B" inputmode="numeric" data-testid="model-unit-compare-manual-b" />
          <button type="submit" class="rounded border border-border bg-background px-1.5 py-0.5 text-foreground hover:bg-muted/50" data-testid="model-unit-compare-manual-apply">应用</button>
          <span class="truncate">（容器的子树时间线要新版 node/versions，先手填）</span>
        </form>

        <ul class="mt-2 space-y-1" data-testid="model-unit-compare-timeline">
          <li v-for="row in timelineSlice.rows"
            :key="row.sesno"
            class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
            :class="[
              row.sesno === afterSesno ? 'border-emerald-300 bg-emerald-50/60' : row.sesno === beforeSesno ? 'border-blue-300 bg-blue-50/60' : 'border-border',
              row.inScope ? '' : 'opacity-50',
            ]"
            :data-sesno="row.sesno"
            :data-in-scope="row.inScope ? 'true' : 'false'">
            <span class="flex shrink-0 flex-col gap-0.5">
              <button type="button"
                class="rounded px-1 text-[9px] font-bold leading-4"
                :class="row.sesno === beforeSesno ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:bg-blue-100 hover:text-blue-700'"
                :title="`把 sesno ${row.sesno} 设为 A`"
                :data-testid="`model-unit-compare-pick-a-${row.sesno}`"
                @click="pickSide('a', row.sesno)">A</button>
              <button type="button"
                class="rounded px-1 text-[9px] font-bold leading-4"
                :class="row.sesno === afterSesno ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700'"
                :title="`把 sesno ${row.sesno} 设为 B`"
                :data-testid="`model-unit-compare-pick-b-${row.sesno}`"
                @click="pickSide('b', row.sesno)">B</button>
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="font-mono font-semibold text-foreground">sesno {{ row.sesno }}</span>
                <span class="text-[10px] text-muted-foreground">{{ formatModelUnitVersionTime(row.sessionTime ?? '') }}</span>
                <span v-if="row.user" class="text-[10px] text-foreground/80">{{ row.user }}</span>
              </div>
              <div v-if="row.comment" class="truncate text-[10px] text-muted-foreground" :title="row.comment">{{ row.comment }}</div>
            </div>
            <span class="flex shrink-0 flex-wrap justify-end gap-1">
              <span v-if="!row.inScope" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">本范围无变化</span>
              <span v-if="row.changedCount" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">属性 {{ row.changedCount }}</span>
              <span v-if="scope === 'subtree' && row.unitsChanged !== null && row.unitsChanged > 0"
                class="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700"
                :title="`这一会话有几何要重算的最小交付单元数`"
                data-testid="model-unit-compare-units-changed">单元 {{ row.unitsChanged }}</span>
              <template v-if="queriedIsUnitRoot">
                <span v-if="attributeOnlyShown(row)" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                  title="这一会话只改了不进模型提取的属性（UDA 之类）：版本表不算它一版，属性变化时间线照列"
                  data-testid="model-unit-compare-attribute-only">仅属性</span>
                <span v-else class="rounded px-1.5 py-0.5 text-[10px]" :class="impactClass(rowImpact(row))">
                  {{ impactLabel(rowImpact(row)) }}
                </span>
              </template>
              <template v-else>
                <span v-if="scope === 'subtree'" class="rounded px-1.5 py-0.5 text-[10px]" :class="impactClass(row.unitImpact)">单元 {{ impactLabel(row.unitImpact) }}</span>
                <span v-if="row.attributeOnly" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                  title="这一会话本构件只改了不进模型提取的属性（UDA 之类）：版本表不算它一版，属性变化时间线照列"
                  data-testid="model-unit-compare-attribute-only">本构件 仅属性</span>
                <span v-else class="rounded px-1.5 py-0.5 text-[10px]" :class="impactClass(row.selfImpact)">
                  本构件 {{ selfColumnUnknown ? '?' : impactLabel(row.selfImpact) }}
                </span>
              </template>
            </span>
          </li>
        </ul>
        <button v-if="timelineSlice.hidden > 0" type="button"
          class="mt-1 w-full rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          :title="`缺省只列最近 ${NODE_TIMELINE_INITIAL_ROWS} 版；点开列全（版本表早已取回，不再请求服务端）`"
          data-testid="model-unit-compare-timeline-more"
          :data-hidden="timelineSlice.hidden"
          @click="timelineExpanded = true">
          加载更早 {{ timelineSlice.hidden }} 版…
        </button>

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
        <section v-if="activeTab === 'attributes'" class="mt-2" data-testid="model-unit-compare-attributes">
          <p v-if="!pairReady" class="py-3 text-center text-xs text-muted-foreground">先在时间线上选好 A / B（A 早于 B）</p>
          <template v-else-if="scope === 'self'">
            <p v-if="loadingSelfDiff" class="py-3 text-center text-xs text-muted-foreground" data-testid="model-unit-compare-attr-loading">正在算属性净差…</p>
            <div v-else-if="selfDiffError" class="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="model-unit-compare-attr-error">
              {{ selfDiffError }}。跑一次「在三维中对比」后，模型树差异模式底部仍有 A / B 两版的属性逐项对比。
            </div>
            <template v-else-if="selfDiff">
              <div class="flex items-center justify-between gap-2 text-[11px]">
                <span class="font-semibold text-foreground">
                  A {{ beforeSesno }} → B {{ afterSesno }} · {{ selfDiffCount }} 项变化
                  <span v-if="selfDiff.kind" class="ml-1 rounded px-1.5 py-0.5 text-[10px] font-normal" :class="DIFF_KIND_CLASS[selfDiff.kind]" data-testid="model-unit-compare-attr-kind">
                    {{ DIFF_KIND_LABEL[selfDiff.kind] }}<template v-if="selfDiff.impact"> · {{ selfDiff.impact }}</template>
                  </span>
                </span>
                <label class="flex items-center gap-1 text-muted-foreground">
                  <input v-model="includeUnchanged" type="checkbox" />含戳
                </label>
              </div>
              <p v-if="selfDiff.kind === 'created' && selfDiff.source === 'server'" class="mt-1 text-[10px] text-amber-700">
                该节点在 A（sesno {{ beforeSesno }}）侧不存在：列的是 B 侧全部已设的属性，before 为空。
              </p>
              <p v-else-if="selfDiff.kind === 'deleted' && selfDiff.source === 'server'" class="mt-1 text-[10px] text-amber-700">
                该节点在 B（sesno {{ afterSesno }}）侧已删除：列的是 A 侧全部已设的属性，after 为空。
              </p>
              <p v-else-if="selfDiff.createdAt !== null || selfDiff.deletedAt !== null" class="mt-1 text-[10px] text-amber-700">
                <template v-if="selfDiff.createdAt !== null">该节点在 sesno {{ selfDiff.createdAt }} 被创建；</template>
                <template v-if="selfDiff.deletedAt !== null">在 sesno {{ selfDiff.deletedAt }} 被删除；</template>
                A 侧不存在的属性 before 为空。
              </p>
              <p v-if="selfDiff.members || selfDiff.owner" class="mt-1 text-[10px] text-muted-foreground" data-testid="model-unit-compare-attr-members">
                <template v-if="selfDiff.members">成员 {{ membersText(selfDiff.members) }}</template>
                <template v-if="selfDiff.members && selfDiff.owner">；</template>
                <template v-if="selfDiff.owner">owner {{ selfDiff.owner[0] }} → {{ selfDiff.owner[1] }}</template>
              </p>
              <p v-else-if="selfDiff.membersTouched || selfDiff.ownerTouched" class="mt-1 text-[10px] text-muted-foreground">
                这段区间里<template v-if="selfDiff.membersTouched">成员表动过</template><template v-if="selfDiff.membersTouched && selfDiff.ownerTouched">、</template><template v-if="selfDiff.ownerTouched">owner 改挂过</template>（折出来的净差看不出来，看时间线逐行）。
              </p>
              <p v-if="selfDiff.attributesUnavailable" class="mt-1 text-[10px] text-amber-700">属性行渲染不出来：{{ selfDiff.attributesUnavailable }}（去向与影响档仍成立）</p>
              <div class="mt-2 overflow-hidden rounded-md border border-border" data-testid="model-unit-compare-attr-table" :data-source="selfDiff.source">
                <div class="grid grid-cols-[76px_1fr_1fr] gap-2 bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                  <span>属性</span><span class="font-semibold text-blue-700">A · {{ beforeSesno }}</span><span class="font-semibold text-emerald-700">B · {{ afterSesno }}</span>
                </div>
                <div v-for="change in selfDiffVisible" :key="change.name"
                  class="grid grid-cols-[76px_1fr_1fr] gap-2 border-t border-border px-2 py-1 text-[10px]"
                  :class="change.stamp ? 'bg-slate-50 text-slate-500' : 'bg-amber-50/60'">
                  <span class="font-mono font-semibold">{{ change.name }}<span v-if="change.stamp" class="ml-1 rounded bg-slate-200 px-1 text-[9px] font-normal">戳</span><span v-if="change.hops > 1" class="ml-1 text-[9px] font-normal text-muted-foreground">×{{ change.hops }}</span></span>
                  <span class="break-all font-mono text-muted-foreground">{{ change.before ?? '—' }}</span>
                  <span class="break-all font-mono font-semibold text-foreground">{{ change.after ?? '—' }}</span>
                </div>
                <p v-if="selfDiffVisible.length === 0" class="border-t border-border px-2 py-2 text-center text-[10px] text-muted-foreground">
                  {{ emptyNetDiffText(selfDiff, 0) }}
                </p>
              </div>
              <p v-if="selfDiff.warnings.length" class="mt-1 text-[10px] text-muted-foreground">{{ selfDiff.warnings[0] }}</p>
              <p class="mt-1 text-[10px] text-muted-foreground" data-testid="model-unit-compare-attr-source">{{ diffSourceText(selfDiff) }}</p>
            </template>
          </template>
          <template v-else>
            <div v-if="diffSummaryUnavailable" class="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground" data-testid="model-unit-compare-summary-missing">
              服务端还没有 <code>node/diff-summary</code>：「所有子节点」下有变的构件清单要新版服务端；先跑「在三维中对比」看几何差异。
            </div>
            <p v-else-if="loadingSummary" class="py-3 text-center text-xs text-muted-foreground">正在算差异摘要…</p>
            <p v-else-if="diffSummaryError" class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{{ diffSummaryError }}</p>
            <template v-else-if="diffSummary">
              <div class="text-[11px] font-semibold text-foreground">A {{ beforeSesno }} → B {{ afterSesno }} · 有变的构件 {{ changedElementRows.length }} 个</div>
              <ul class="mt-2 space-y-1" data-testid="model-unit-compare-changed-elements">
                <li v-for="row in changedElementRows" :key="row.refno" class="rounded-md border" :class="row.isNode ? 'border-primary bg-primary/5' : 'border-border'">
                  <div class="flex items-stretch">
                    <button type="button" class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/40"
                      :data-testid="`model-unit-compare-element-${row.refno}`"
                      @click="toggleElementDiff(row.refno)">
                      <span class="text-[10px] text-muted-foreground">{{ expandedElement === row.refno ? '▾' : '▸' }}</span>
                      <span class="font-mono font-semibold">{{ row.noun }} {{ row.refno }}</span>
                      <span v-if="row.isNode" class="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">本节点</span>
                      <span v-if="row.unitRefno && row.unitRefno !== row.refno" class="truncate text-[10px] text-muted-foreground">{{ row.unitNoun }} {{ row.unitRefno }} 下</span>
                      <span class="ml-auto rounded px-1.5 py-0.5 text-[10px]" :class="STATUS_CLASS[row.status]">{{ STATUS_LABEL[row.status] }} · {{ row.impact }}</span>
                    </button>
                    <button type="button" class="shrink-0 border-l border-border px-2 text-[10px] text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      :data-testid="`model-unit-compare-element-locate-${row.refno}`"
                      :disabled="!canLocateElement(row)"
                      :title="locateElementTitle(row)"
                      @click.stop="locateElement(row)">
                      定位
                    </button>
                  </div>
                  <div v-if="expandedElement === row.refno" class="border-t border-border px-2 py-1.5 text-[10px]" :data-testid="`model-unit-compare-element-diff-${row.refno}`">
                    <template v-if="elementDiffs.get(row.refno) === 'loading'">正在算它的属性净差…</template>
                    <template v-else-if="typeof elementDiffs.get(row.refno) === 'string'">
                      <span class="text-amber-700">{{ elementDiffs.get(row.refno) }}</span>
                    </template>
                    <template v-else-if="elementDiffView(row.refno)">
                      <p v-if="elementDiffView(row.refno)!.kind === 'created' && elementDiffView(row.refno)!.source === 'server'" class="text-amber-700">A 侧不存在：列的是 B 侧全部已设的属性</p>
                      <p v-else-if="elementDiffView(row.refno)!.kind === 'deleted' && elementDiffView(row.refno)!.source === 'server'" class="text-amber-700">B 侧已删除：列的是 A 侧全部已设的属性</p>
                      <div v-for="change in elementDiffView(row.refno)!.changes" :key="change.name"
                        class="grid grid-cols-[76px_1fr_1fr] gap-2 py-0.5" :class="change.stamp ? 'text-slate-500' : ''">
                        <span class="font-mono font-semibold">{{ change.name }}<span v-if="change.stamp" class="ml-1 rounded bg-slate-200 px-1 text-[9px] font-normal">戳</span></span>
                        <span class="break-all font-mono text-muted-foreground">{{ change.before ?? '—' }}</span>
                        <span class="break-all font-mono font-semibold">{{ change.after ?? '—' }}</span>
                      </div>
                      <p v-if="elementDiffView(row.refno)!.changes.length === 0" class="text-muted-foreground">{{ emptyNetDiffText(elementDiffView(row.refno)!, 0) }}</p>
                      <p v-if="elementDiffView(row.refno)!.members" class="text-muted-foreground">成员 {{ membersText(elementDiffView(row.refno)!.members!) }}</p>
                      <p v-else-if="elementDiffView(row.refno)!.membersTouched" class="text-muted-foreground">成员表动过（增删或重排）</p>
                      <p v-if="elementDiffView(row.refno)!.owner" class="text-muted-foreground">owner {{ elementDiffView(row.refno)!.owner![0] }} → {{ elementDiffView(row.refno)!.owner![1] }}</p>
                      <p v-if="elementDiffView(row.refno)!.source === 'folded'" class="text-muted-foreground">服务端还没有 element/attribute-diff：这是把它的时间线在 (A, B] 里折出来的</p>
                    </template>
                  </div>
                </li>
                <li v-if="changedElementRows.length === 0" class="py-3 text-center text-xs text-muted-foreground">这段区间里子树内没有任何记录变过</li>
              </ul>
            </template>
          </template>
        </section>

        <!-- 模型对比 -->
        <section v-if="activeTab === 'model'" class="mt-2" data-testid="model-unit-compare-model">
          <div v-if="diffSummary && pairReady" class="rounded-md border border-border bg-muted/20 p-2" data-testid="model-unit-compare-diff-summary">
            <div class="text-[11px] font-semibold text-foreground">A {{ beforeSesno }} → B {{ afterSesno }} · 差异摘要（未生成几何）</div>
            <div class="mt-1 flex flex-wrap gap-1 text-[10px]">
              <span class="rounded bg-primary/10 px-1.5 py-0.5 text-primary">变了的单元 {{ diffSummary.units.changed }}</span>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">未变单元 {{ diffSummary.units.unchanged }}<template v-if="!diffSummary.units.complete">+</template></span>
              <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">新增 {{ diffSummary.elements.added }}</span>
              <span class="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">删除 {{ diffSummary.elements.deleted }}</span>
              <span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">修改 {{ diffSummary.elements.modified }}</span>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">noop {{ diffSummary.elements.noop }}</span>
            </div>
            <p v-if="diffSummary.needsConfirm" class="mt-1 text-[10px] text-amber-700" data-testid="model-unit-compare-needs-confirm">
              变了的单元超过阈值 {{ diffSummary.confirmThresholdUnits }} 个（服务端估约 {{ diffSummary.estimatedProjections }} 份历史投影）：一起进三维前会先问一句，也可以逐组点开看。
            </p>
            <p v-if="diffSummary.warnings.length" class="mt-1 text-[10px] text-muted-foreground">{{ diffSummary.warnings[0] }}</p>
          </div>
          <p v-else-if="loadingSummary" class="text-[10px] text-muted-foreground">正在算差异摘要…</p>
          <p v-else-if="diffSummaryUnavailable && pairReady" class="text-[10px] text-amber-600" data-testid="model-unit-compare-summary-missing">
            服务端还没有 <code>node/diff-summary</code>：差异摘要要新版服务端，直接「在三维中对比」也能拿到几何差异。
          </p>

          <div class="mt-2 flex gap-2">
            <button class="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              data-testid="model-unit-compare-run"
              :disabled="comparing || loadingVersions || !hasUnit"
              :title="hasUnit ? `装载 ${comparedUnitRefno} 的 A / B 两版` : '不在任何最小交付单元下，没有几何'"
              @click="runCompare">
              {{ comparing ? '正在比较…' : (scope === 'subtree' && geometryGroups.length > 1 ? `在三维中对比 · ${comparedUnitRefno}` : '在三维中对比') }}
            </button>
          </div>

          <!-- 多单元一次装载的进度（P2-a，设计稿 S2b「正在生成历史投影 3 / 4」）：份 = 要去 history/generate 的单元@sesno；单单元（≤ 2 份）不露 -->
          <div v-if="compareProgress && compareProgress.total > 2"
            class="mt-2 rounded-md border border-indigo-200 bg-indigo-50/40 p-2 text-[11px] text-indigo-900"
            data-testid="model-unit-compare-progress"
            :data-done="compareProgress.done"
            :data-total="compareProgress.total">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold">正在生成历史投影 {{ compareProgress.done }} / {{ compareProgress.total }}</span>
              <span class="truncate font-mono text-[10px] opacity-75">{{ compareProgress.current.join(' · ') }}</span>
            </div>
            <div class="mt-1 h-1.5 overflow-hidden rounded bg-indigo-100">
              <div class="h-full rounded bg-indigo-500 transition-[width]" :style="{ width: `${Math.round((compareProgress.done / Math.max(1, compareProgress.total)) * 100)}%` }" />
            </div>
          </div>

          <!-- 阈值确认（P2-b，设计稿 S2b ②）：超过一次装载上限或服务端说要确认时先问；「先装变化最大的 N 个」按组内变更数排 -->
          <div v-if="pendingGroupsConfirm"
            class="mt-2 rounded-md border border-amber-300 bg-amber-50/70 p-2 text-[11px] text-amber-900"
            data-testid="model-unit-compare-confirm"
            role="alertdialog">
            <div class="font-semibold">
              一次要装 {{ pendingGroupsConfirm.length }} 个单元、约 {{ countGroupProjections(pendingGroupsConfirm) }} 份历史投影
              <template v-if="pendingGroupsConfirm.length > MODEL_UNIT_COMPARE_MAX_UNITS">，超过一次装载上限 {{ MODEL_UNIT_COMPARE_MAX_UNITS }} 个</template>
              <template v-else-if="diffSummary?.needsConfirm">，服务端提示超过阈值 {{ diffSummary.confirmThresholdUnits }} 个</template>
            </div>
            <div class="mt-0.5 opacity-80">每份都要服务端按会话重算一遍几何，多的话要等一会儿；装进来的单元越多，三维里越挤。</div>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button"
                class="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
                data-testid="model-unit-compare-confirm-all"
                @click="confirmGroups('all')">
                全部生成
              </button>
              <button v-if="pendingGroupsConfirm.length > MODEL_UNIT_COMPARE_MAX_UNITS"
                type="button"
                class="rounded-md border border-amber-400 bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted/50"
                data-testid="model-unit-compare-confirm-top"
                @click="confirmGroups('top')">
                先装变化最大的 {{ MODEL_UNIT_COMPARE_MAX_UNITS }} 个
              </button>
              <button type="button"
                class="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                data-testid="model-unit-compare-confirm-cancel"
                @click="confirmGroups('cancel')">
                取消
              </button>
            </div>
          </div>

          <!-- 设计稿 S2 那一颗总按钮：变了的单元一起进三维（P2-a）；只有一组时没必要，组里那颗就是。放在分组列表外（e2e 数的是列表里的 div） -->
          <div v-if="scope === 'subtree' && geometryGroups.length > 1"
            class="mt-2 flex items-center gap-2 rounded-md border border-dashed border-indigo-300 bg-indigo-50/30 px-2 py-1.5 text-xs"
            data-testid="model-unit-compare-run-groups-row">
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-foreground">全部变了的单元一起进三维</div>
              <div class="text-[10px] text-muted-foreground">{{ groupsProjectionText }}<template v-if="geometryGroups.length > MODEL_UNIT_COMPARE_MAX_UNITS">（超过一次装载上限 {{ MODEL_UNIT_COMPARE_MAX_UNITS }}，会先问）</template></div>
            </div>
            <button type="button"
              class="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
              :disabled="comparing || pendingGroupsConfirm !== null"
              :title="`把这 ${geometryGroups.length} 个单元的 A / B 一起装进三维（每份历史投影都要服务端按会话重算）`"
              data-testid="model-unit-compare-run-groups"
              @click="runCompareGroups(geometryGroups)">
              {{ comparedInViewer.length > 1 && comparedInViewer.length === geometryGroups.length ? '三维中' : '在三维中对比' }}
            </button>
          </div>
          <div v-if="scope === 'subtree' && geometryGroups.length > 0" class="mt-2 space-y-1" data-testid="model-unit-compare-groups">
            <div v-for="group in geometryGroups" :key="group.unitRefno ?? 'orphan'"
              class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
              :class="group.unitRefno && comparedInViewer.includes(group.unitRefno) ? 'border-indigo-300 bg-indigo-50/50' : 'border-border'">
              <div class="min-w-0 flex-1">
                <div class="truncate font-mono font-semibold">{{ group.unitNoun }} {{ group.unitRefno }}<span v-if="group.unitName" class="ml-1 font-sans text-[10px] font-normal text-muted-foreground">{{ group.unitName }}</span></div>
                <div class="flex flex-wrap gap-1 text-[10px]">
                  <span v-if="group.counts.added" class="rounded bg-emerald-100 px-1 text-emerald-700">新增 {{ group.counts.added }}</span>
                  <span v-if="group.counts.deleted" class="rounded bg-rose-100 px-1 text-rose-700">删除 {{ group.counts.deleted }}</span>
                  <span v-if="group.counts.modified" class="rounded bg-amber-100 px-1 text-amber-700">修改 {{ group.counts.modified }}</span>
                  <span v-if="group.counts.noop" class="rounded bg-slate-100 px-1 text-slate-600">noop {{ group.counts.noop }}</span>
                </div>
              </div>
              <button type="button"
                class="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted/50 disabled:opacity-50"
                :disabled="comparing"
                :data-testid="`model-unit-compare-run-group-${group.unitRefno}`"
                @click="runCompareGroup(group)">
                {{ group.unitRefno && comparedInViewer.includes(group.unitRefno) ? (comparedInViewer.length > 1 ? '三维中 · 只看这组' : '三维中') : '在三维中对比' }}
              </button>
            </div>
          </div>

          <section v-if="compareRuntime"
            class="mt-3 rounded-md border border-indigo-200 bg-indigo-50/30 p-2.5"
            data-testid="model-unit-compare-runtime">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs font-semibold text-foreground">三维查看</div>
                <div class="truncate font-mono text-[10px] text-muted-foreground" data-testid="model-unit-compare-runtime-title">
                  <template v-if="compareRuntime.detail.units?.length">{{ compareRuntime.detail.units.length }} 个单元 · {{ compareRuntime.detail.unitRefno }} 下 · </template>
                  <template v-else>{{ compareRuntime.detail.unitRefno }} · </template>DB {{ compareRuntime.detail.dbnum }}
                </div>
              </div>
              <button type="button"
                class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                data-testid="model-unit-compare-close"
                @click="closeCompare">
                <X class="h-3 w-3" />退出
              </button>
            </div>

            <div v-if="compareRuntime.status === 'loading'" class="mt-2 text-xs text-muted-foreground">
              正在加载两个精确版本…
            </div>
            <div v-else-if="compareRuntime.status === 'error'"
              class="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {{ compareRuntime.error }}
            </div>
            <template v-else>
              <div class="mt-2 grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-xs">
                <button type="button"
                  class="rounded px-2 py-1.5"
                  :class="compareRuntime.viewMode === 'single' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                  :aria-pressed="compareRuntime.viewMode === 'single'"
                  data-testid="model-unit-compare-single-mode"
                  @click="setCompareViewMode('single')">
                  单视口切换
                </button>
                <button type="button"
                  class="rounded px-2 py-1.5"
                  :class="compareRuntime.viewMode === 'split' ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                  :aria-pressed="compareRuntime.viewMode === 'split'"
                  data-testid="model-unit-compare-split-mode"
                  @click="setCompareViewMode('split')">
                  双视口分屏
                </button>
              </div>

              <div v-if="compareRuntime.viewMode === 'single'" class="mt-2 grid grid-cols-2 gap-2 text-xs">
                <button type="button"
                  class="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-left text-blue-700 transition-opacity"
                  :class="compareRuntime.activeSide === 'before' ? 'ring-2 ring-blue-500' : 'opacity-60'"
                  data-testid="model-unit-compare-show-before"
                  @click="setCompareSide('before')">
                  <div class="font-semibold">A · sesno {{ compareRuntime.detail.before.sesno }}</div>
                  <div class="mt-0.5 text-[10px] opacity-75">{{ formatModelUnitVersionTime(compareRuntime.detail.before.version.sessionTime ?? '') }}</div>
                  <div v-if="compareRuntime.detail.before.version.impactKind === 'tombstone'" class="mt-0.5 text-[10px] opacity-75">{{ modelUnitVersionAbsentNote('before') }}</div>
                  <div v-else-if="absentUnits(compareRuntime.detail, 'before').length" class="mt-0.5 text-[10px] opacity-75" data-testid="model-unit-compare-absent-before">
                    {{ absentUnits(compareRuntime.detail, 'before').length }} 个单元{{ modelUnitVersionAbsentNote('before') }}：{{ absentUnits(compareRuntime.detail, 'before').join('、') }}
                  </div>
                </button>
                <button type="button"
                  class="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-left text-emerald-700 transition-opacity"
                  :class="compareRuntime.activeSide === 'after' ? 'ring-2 ring-emerald-500' : 'opacity-60'"
                  data-testid="model-unit-compare-show-after"
                  @click="setCompareSide('after')">
                  <div class="font-semibold">B · sesno {{ compareRuntime.detail.after.sesno }}</div>
                  <div class="mt-0.5 text-[10px] opacity-75">{{ formatModelUnitVersionTime(compareRuntime.detail.after.version.sessionTime ?? '') }}</div>
                  <div v-if="compareRuntime.detail.after.version.impactKind === 'tombstone'" class="mt-0.5 text-[10px] opacity-75">{{ modelUnitVersionAbsentNote('after') }}</div>
                  <div v-else-if="absentUnits(compareRuntime.detail, 'after').length" class="mt-0.5 text-[10px] opacity-75" data-testid="model-unit-compare-absent-after">
                    {{ absentUnits(compareRuntime.detail, 'after').length }} 个单元{{ modelUnitVersionAbsentNote('after') }}：{{ absentUnits(compareRuntime.detail, 'after').join('、') }}
                  </div>
                </button>
              </div>
              <div v-else
                class="mt-2 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground"
                data-testid="model-unit-compare-split-summary">
                左 A · sesno {{ compareRuntime.detail.before.sesno }}
                <span class="px-1">·</span>
                右 B · sesno {{ compareRuntime.detail.after.sesno }}
                <!-- P3-c：软渲染（远程桌面 / 虚拟机 / 无显卡驱动）下分屏不走描边合成器，照实说 -->
                <div v-if="compareRuntime.splitOutline && !compareRuntime.splitOutline.compositor"
                  class="mt-1 text-[10px] text-amber-700"
                  :title="compareRuntime.splitOutline.renderer ?? ''"
                  data-testid="model-unit-compare-split-direct-render">
                  这台机子是软渲染（{{ compareRuntime.splitOutline.renderer ?? '显卡串未知' }}）：分屏走直接渲染、不走描边合成器——选中的环境构件按选中色显示、没有描边，帧率优先。
                </div>
              </div>
              <label class="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                :class="compareRuntimeHasGeometryDifference ? '' : 'opacity-60'"
                :title="compareRuntimeHasGeometryDifference
                  ? '三维里藏掉两版都没变的构件，只剩新增 / 删除 / 修改；着色与下方徽章同一套'
                  : '本次对比没有几何差异，三维里没有可单看的构件'">
                <input type="checkbox"
                  :checked="compareRuntime.diffOnly === true"
                  :disabled="!compareRuntimeHasGeometryDifference"
                  data-testid="model-unit-compare-diff-only"
                  @change="setCompareDiffOnly(($event.target as HTMLInputElement).checked)" />
                三维只看差异
              </label>
            </template>

            <div v-if="compareRuntime.environment"
              class="mt-2 rounded-md border border-amber-200 bg-amber-50/80 p-2 text-[10px] text-amber-900"
              data-testid="model-unit-compare-environment">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="font-semibold">
                    {{ compareRuntime.environment.error ? '当前环境（刷新失败）' : '最新环境' }}
                  </div>
                  <div class="mt-0.5 opacity-80">已固定当前加载范围：{{ compareRuntime.environment.loadedRefnos }} 个 refno</div>
                </div>
                <button type="button"
                  class="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-background px-1.5 py-1 font-medium disabled:opacity-50"
                  data-testid="model-unit-compare-refresh-environment"
                  :disabled="compareRuntime.environment.refreshing"
                  @click="refreshCompareEnvironment">
                  <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': compareRuntime.environment.refreshing }" />
                  刷新
                </button>
              </div>
              <div class="mt-1 border-t border-amber-200 pt-1">
                {{ compareRuntime.environment.error
                  ? '整库最新环境不可用；当前仅显示两个所选最小交付单元。'
                  : '混合时间视图：环境始终取 dbnum 最新模型，目标单元取所选 sesno。' }}
              </div>
              <div v-if="compareRuntime.environment.error" class="mt-1 text-destructive">
                {{ compareRuntime.environment.error }}
              </div>
            </div>
          </section>

          <template v-if="compareCompleted">
            <div class="mt-3 rounded-md border border-border bg-muted/20 p-2" data-testid="model-unit-compare-summary">
              <div v-if="comparedInViewer.length" class="mb-1 font-mono text-[10px] text-muted-foreground" data-testid="model-unit-compare-summary-title">
                <template v-if="comparedInViewer.length === 1">{{ comparedInViewer[0] }} · 几何差异</template>
                <template v-else>{{ comparedInViewer.length }} 个单元 · 几何差异（{{ comparedInViewer.join('、') }}）</template>
              </div>
              <div class="flex flex-wrap gap-1.5 text-[11px]">
                <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">新增 {{ summary.added }}</span>
                <span class="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">删除 {{ summary.deleted }}</span>
                <span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">修改 {{ summary.modified }}</span>
                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">未变 {{ summary.unchanged }}</span>
              </div>
              <p v-if="noGeometryDifference" class="mt-2 text-xs font-medium text-emerald-700" data-testid="model-unit-compare-noop">
                无几何差异<span v-if="sameGeometry">；A/B 几何相同，只加载了一次</span>
              </p>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-1" data-testid="model-unit-compare-filters">
              <button v-for="filter in ['all', 'added', 'deleted', 'modified'] as const"
                :key="filter"
                class="rounded border px-2 py-1 text-[11px]"
                :class="statusFilter === filter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'"
                @click="statusFilter = filter">
                {{ { all: '全部差异', added: '新增', deleted: '删除', modified: '修改' }[filter] }}
              </button>
              <label class="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                <input v-model="includeUnchanged" type="checkbox" />包含未变化
              </label>
            </div>

            <div class="mt-2 space-y-1" data-testid="model-unit-compare-list">
              <button v-for="row in visibleRows"
                :key="row.refno"
                class="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                :class="row.refno === queriedElementRefno ? 'border-primary bg-primary/5' : 'border-border'"
                :data-queried-element="row.refno === queriedElementRefno ? 'true' : undefined"
                @click="focusRow(row.refno)">
                <span class="rounded px-1.5 py-0.5 text-[10px]" :class="STATUS_CLASS[row.status]">
                  {{ STATUS_LABEL[row.status] }}
                </span>
                <span class="min-w-0 flex-1 truncate font-mono">{{ row.refno }}</span>
                <span v-if="row.refno === queriedElementRefno" class="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">本构件</span>
                <span class="text-[10px] text-muted-foreground">{{ row.noun }}</span>
              </button>
              <p v-if="visibleRows.length === 0" class="py-4 text-center text-xs text-muted-foreground">当前筛选没有差异项</p>
            </div>
          </template>
        </section>
      </template>
    </div>
  </section>
</template>
