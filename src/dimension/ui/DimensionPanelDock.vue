<script setup lang="ts">
import {
  computed,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { externalDimensionCategory } from '../adapters/normalizeExternalDimensions';
import { createRebindEditSession } from '../interaction/editSession';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';

import {
  isDimensionRebindAction,
  isExternalDimensionRecord,
  rebindActionSlot,
} from './dimensionBoundActions';
import DimensionSemanticList from './DimensionSemanticList.vue';
import DimensionToolbar from './DimensionToolbar.vue';
import PipeInformationPanel from './PipeInformationPanel.vue';

import type { DimensionBoundAction } from './dimensionBoundActions';
import type { MbdPrimitive } from '../adapters/mbdV2Contract';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';
import type { LayoutResult } from '../kernel/types';

import {
  useMbdDiagnosticsStore,
  type MbdDiagnosticsSnapshot,
} from '@/composables/useMbdDiagnosticsStore';
import { usePipeInformationStore } from '@/composables/usePipeInformationStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { emitToast } from '@/ribbon/toastBus';
import {
  appendMbdRefno,
  formatMbdRefnos,
  parseMbdRefnos,
  removeMbdRefno,
} from '@/utils/mbdRefnoParam';

type DimensionListItem = UserDimensionRecord | ExternalDimensionRecord;

/**
 * rs-mbd 自报的阶段性排版模式。契约还没有「本次交付覆盖哪些图元类别」的显式
 * 声明，在它出现之前，用已知的阶段模式名兜住「标注不完整」这个事实——未移植
 * 的类别不会产生任何 issue，光看诊断列表看不出缺了什么。
 *
 * `isodim_main` 是当前生产路径恒报的值（`plant-mbd/src/layout.rs` 的
 * `LAYOUT_MODE_ISODIM_MAIN`，两条产出路径都写它），它同样只产出 11 种图元里的 8 种
 * （`aid_arc` / `aid_circle` / `aid_point` 仍无 live 产出方；`angle_dim` 自
 * 2026-10-29 起已由 `plant-mbd` 的 `angle.rs` 产出），所以必须一起列进来；
 * `linear_mvp` 保留是因为仓内 fixture 仍用它。待契约 `meta.coverage`
 * （开发计划 T4.1）到位后整段退休。
 */
const PARTIAL_LAYOUT_MODES: readonly string[] = ['linear_mvp', 'isodim_main'];

defineProps<{
  params?: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const viewerContext = useViewerContext();
const userStore = useUserStore();
const documentState = shallowRef(
  viewerContext.dimensionSystem.value?.document.state ?? null,
);
const externalRecords = shallowRef<readonly ExternalDimensionRecord[]>(
  viewerContext.dimensionSystem.value?.externalRegistry.snapshot.records ?? [],
);
const hiddenExternalIds = shallowRef<readonly string[]>(
  [...(viewerContext.dimensionSystem.value?.externalRegistry.snapshot.hiddenIds ?? [])],
);
const selectedId = ref<string | null>(null);
/** 最近一次完整布局（`viewport.subscribeLayouts`），用来读 `derived.lodHidden` 这类逐帧结果。 */
const viewportLayouts = shallowRef<readonly LayoutResult[]>(
  viewerContext.dimensionSystem.value?.viewport.getLayouts() ?? [],
);

/** 显示模式（见下「显示模式」段）；先于订阅声明，viewport 一出现就按 URL 校准。 */
type MbdDisplayMode = 'engineering' | 'inspection';

function readMbdDisplayMode(): MbdDisplayMode {
  if (typeof window === 'undefined') return 'engineering';
  return new URLSearchParams(window.location.search).get('mbd_mode')?.trim() === 'inspection'
    ? 'inspection'
    : 'engineering';
}

const mbdDisplayMode = ref<MbdDisplayMode>(readMbdDisplayMode());

let unsubscribeDocument: (() => void) | null = null;
let unsubscribeSelection: (() => void) | null = null;
let unsubscribeExternal: (() => void) | null = null;
let unsubscribeLayouts: (() => void) | null = null;

watch(
  () => viewerContext.dimensionSystem.value,
  (system) => {
    unsubscribeDocument?.();
    unsubscribeDocument = null;
    unsubscribeSelection?.();
    unsubscribeSelection = null;
    unsubscribeExternal?.();
    unsubscribeExternal = null;
    unsubscribeLayouts?.();
    unsubscribeLayouts = null;
    documentState.value = system?.document.state ?? null;
    externalRecords.value = system?.externalRegistry.snapshot.records ?? [];
    hiddenExternalIds.value = [
      ...(system?.externalRegistry.snapshot.hiddenIds ?? []),
    ];
    selectedId.value = system?.viewport.getSelection() ?? null;
    viewportLayouts.value = system?.viewport.getLayouts() ?? [];
    if (system) {
      unsubscribeDocument = system.document.subscribe((state) => {
        documentState.value = state;
      });
      unsubscribeSelection = system.viewport.subscribeSelection((dimensionId) => {
        selectedId.value = dimensionId;
      });
      unsubscribeExternal = system.externalRegistry.subscribe((snapshot) => {
        externalRecords.value = snapshot.records;
        hiddenExternalIds.value = [...snapshot.hiddenIds];
      });
      unsubscribeLayouts = system.viewport.subscribeLayouts((layouts) => {
        viewportLayouts.value = layouts;
      });
      // The display mode lives in the URL; a (re)created viewport starts in
      // engineering and is brought in line here.
      system.viewport.setDisplayMode(mbdDisplayMode.value);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  unsubscribeDocument?.();
  unsubscribeDocument = null;
  unsubscribeSelection?.();
  unsubscribeSelection = null;
  unsubscribeExternal?.();
  unsubscribeExternal = null;
  unsubscribeLayouts?.();
  unsubscribeLayouts = null;
});

const mbdDiagnostics = useMbdDiagnosticsStore().snapshot;

/** 同一来源内尺寸在前、标注在后（ADR 0041 两分）。 */
function byCategory(
  records: readonly ExternalDimensionRecord[],
): readonly ExternalDimensionRecord[] {
  return [
    ...records.filter(record => externalDimensionCategory(record) === 'dimension'),
    ...records.filter(record => externalDimensionCategory(record) === 'annotation'),
  ];
}

/**
 * MBD 按直段分组（W3-6）：任一 MBD 记录带 `isolineIndex`，MBD 记录就按直段编号升序
 * 成组，没有归属的殿后归「未分段」；其它来源照旧按类别两分。`meta.isolines` 表只供
 * 组头取成员数 / 字高 / OD，本身不触发分组：producer 只发表、图元还没带下标（或
 * `mbd_kinds` 过滤后只剩无归属图元）时，全部记录落进唯一的「未分段」组只是多一层
 * 空组头，不如一行不变。今天的负载（两者都没有）列表一行不变。
 */
const mbdIsolineGrouping = computed(() => externalRecords.value.some(
  record => record.source === 'mbd' && record.isolineIndex !== undefined,
));

const items = computed<readonly DimensionListItem[]>(() => {
  const user = documentState.value?.records ?? [];
  if (!mbdIsolineGrouping.value) return [...user, ...byCategory(externalRecords.value)];
  const mbd = externalRecords.value.filter(record => record.source === 'mbd');
  const indices = [...new Set(mbd.flatMap(
    record => (record.isolineIndex === undefined ? [] : [record.isolineIndex]),
  ))].sort((a, b) => a - b);
  return [
    ...user,
    ...byCategory(externalRecords.value.filter(record => record.source !== 'mbd')),
    ...indices.flatMap(index => byCategory(mbd.filter(record => record.isolineIndex === index))),
    ...byCategory(mbd.filter(record => record.isolineIndex === undefined)),
  ];
});

const isolinesByIndex = computed(() => new Map(
  mbdDiagnostics.value.isolines.map(isoline => [isoline.index, isoline] as const),
));

/** 组头里的毫米值：最多两位小数、去尾零（27 →「27 mm」，60.3 →「60.3 mm」，27.0000001 →「27 mm」）。 */
function formatMm(value: number): string {
  return `${Number(value.toFixed(2))} mm`;
}

/** 组头：直段编号 + 表里的成员数 / 字高 / OD；表里没有这一行（悬空下标）就只报编号。 */
function isolineGroupLabel(index: number): string {
  const isoline = isolinesByIndex.value.get(index);
  if (!isoline) return `直段 ${index}`;
  return `直段 ${index} · 成员 ${isoline.members.length} · 字高 ${formatMm(isoline.cheight_mm)} · OD ${formatMm(isoline.od_mm)}`;
}

function listGroupLabel(item: DimensionListItem): string | null {
  if (!mbdIsolineGrouping.value || !isExternalDimensionRecord(item) || item.source !== 'mbd') {
    return null;
  }
  return item.isolineIndex === undefined ? '未分段' : isolineGroupLabel(item.isolineIndex);
}

/** 负载的数据时点（T4.5）：标题行徽标写 `dbnum@sesno`，悬停列出求解器读过的各库会话。 */
const sourceVersionBadge = computed(() => {
  const version = mbdDiagnostics.value.sourceVersion;
  return version ? `数据 ${version.dbnum}@${version.sesno}` : null;
});
const sourceVersionTitle = computed(() => {
  const version = mbdDiagnostics.value.sourceVersion;
  if (!version) return '';
  const databases = version.databases.map(
    database => `${database.dbnum}@${database.sesno} (${database.db_type})`,
  );
  return `求解器读取的数据库会话：${databases.length > 0 ? databases.join('、') : `${version.dbnum}@${version.sesno}`}`;
});
const diagnosticsBySeverity = computed(() => {
  const groups: Record<'error' | 'warning' | 'info', MbdDiagnosticsSnapshot['issues'][number][]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const issue of mbdDiagnostics.value.issues) {
    groups[issue.severity].push(issue);
  }
  return groups;
});
const diagnosticsCount = computed(() =>
  mbdDiagnostics.value.issues.length + mbdDiagnostics.value.skipped.length);
/**
 * 诊断列表承载：后端一次能回上百条 issue（`skipped` 同理），全量渲染意味着展开
 * 一次就要建几百个 DOM 节点，面板本身还会跟着重排。默认每组截断，留一个显式的
 * 「显示全部」口子；条数仍然按全量显示在标题里，不隐瞒规模。
 */
const DIAGNOSTICS_PAGE_SIZE = 50;
const diagnosticsExpanded = ref(false);
const visibleDiagnosticsBySeverity = computed(() => {
  const groups = diagnosticsBySeverity.value;
  const slice = (issues: MbdDiagnosticsSnapshot['issues']) =>
    diagnosticsExpanded.value ? issues : issues.slice(0, DIAGNOSTICS_PAGE_SIZE);
  return {
    error: slice(groups.error),
    warning: slice(groups.warning),
    info: slice(groups.info),
  };
});
const visibleSkippedDiagnostics = computed(() =>
  diagnosticsExpanded.value
    ? mbdDiagnostics.value.skipped
    : mbdDiagnostics.value.skipped.slice(0, DIAGNOSTICS_PAGE_SIZE));

type DiagnosticsSeverity = 'error' | 'warning' | 'info';
type DiagnosticsIssue = MbdDiagnosticsSnapshot['issues'][number];
type DiagnosticsSkipped = MbdDiagnosticsSnapshot['skipped'][number];

/**
 * 多 BRAN 同屏（2026-11-02）：`mbd_refno=A,B` 时后端逐包回诊断，同步层把每包的
 * `issues` / `skipped` 拆进 `sources[]`。聚合视图拍平后分不清哪条属于哪个包——
 * `issues[].refno` 指向的是构件不是包，所以只能按包分组展示。
 *
 * 单源（`sources.length <= 1`）返回 `null`，模板走原来的拍平路径，零变化：
 * 既有的 17 条面板用例、以及所有单 BRAN 链接的观感都不受影响。
 */
const diagnosticsSourceGroups = computed<readonly {
  refno: string;
  total: number;
  hidden: number;
  failed: boolean;
  loadError: string | null;
  bySeverity: Record<DiagnosticsSeverity, readonly DiagnosticsIssue[]>;
  visibleBySeverity: Record<DiagnosticsSeverity, readonly DiagnosticsIssue[]>;
  visibleSkipped: readonly DiagnosticsSkipped[];
}[] | null>(() => {
  const sources = mbdDiagnostics.value.sources;
  if (sources.length <= 1) return null;
  const slice = <T>(items: readonly T[]): readonly T[] =>
    diagnosticsExpanded.value ? items : items.slice(0, DIAGNOSTICS_PAGE_SIZE);
  return sources.map(source => {
    const bySeverity: Record<DiagnosticsSeverity, DiagnosticsIssue[]> = {
      error: [],
      warning: [],
      info: [],
    };
    for (const issue of source.issues) {
      bySeverity[issue.severity].push(issue);
    }
    const visibleBySeverity: Record<DiagnosticsSeverity, readonly DiagnosticsIssue[]> = {
      error: slice(bySeverity.error),
      warning: slice(bySeverity.warning),
      info: slice(bySeverity.info),
    };
    const visibleSkipped = slice(source.skipped);
    const total = source.issues.length + source.skipped.length;
    const shown = visibleBySeverity.error.length
      + visibleBySeverity.warning.length
      + visibleBySeverity.info.length
      + visibleSkipped.length;
    return {
      refno: source.refno,
      total,
      hidden: total - shown,
      failed: source.loadError !== null,
      loadError: source.loadError,
      bySeverity,
      visibleBySeverity,
      visibleSkipped,
    };
  });
});

const hiddenDiagnosticsCount = computed(() => {
  const groups = diagnosticsSourceGroups.value;
  if (groups) return groups.reduce((total, group) => total + group.hidden, 0);
  const shown = Object.values(visibleDiagnosticsBySeverity.value)
    .reduce((total, issues) => total + issues.length, 0)
    + visibleSkippedDiagnostics.value.length;
  return diagnosticsCount.value - shown;
});
const diagnosticsVisible = computed(() =>
  diagnosticsCount.value > 0
  || mbdDiagnostics.value.loadError !== null
  || mbdDiagnostics.value.layoutMode !== null);
const incompleteLayoutMode = computed(() => {
  const mode = mbdDiagnostics.value.layoutMode;
  return mode !== null && PARTIAL_LAYOUT_MODES.includes(mode) ? mode : null;
});

function locateIssueRefno(refno: string): void {
  window.dispatchEvent(new CustomEvent('showModelByRefnos', {
    detail: { refnos: [refno], flyTo: true },
  }));
}

/**
 * MBD 图元类别过滤（2026-09-12 长度尺寸显示优化 QW3）。真正的过滤在
 * `useMbdExternalSync` 读 URL `mbd_kinds`；这里只是把那个参数做成勾选框：
 * 改 URL → 派发 `popstate` → ViewerPanel 走同一条 `handleMbdLocationChange`
 * 重新同步。`Record` 钉住契约的全部 kind，契约新增 kind 时这里会编译失败。
 */
const MBD_KIND_LABELS: Readonly<Record<MbdPrimitive['kind'], string>> = {
  linear_dim: '长度尺寸',
  angle_dim: '安装角',
  slope_mark: '坡度',
  weld_mark: '焊缝',
  label: '位号标签',
  leader_line: '引线',
  aid_line: '辅助线',
  aid_arc: '辅助弧',
  aid_circle: '辅助圆',
  aid_point: '辅助点',
  aid_text: '辅助文字',
};
const MBD_KINDS = Object.keys(MBD_KIND_LABELS) as readonly MbdPrimitive['kind'][];

function readMbdKindFilter(): ReadonlySet<string> | null {
  if (typeof window === 'undefined') return null;
  const kinds = (new URLSearchParams(window.location.search).get('mbd_kinds') ?? '')
    .split(',')
    .map(kind => kind.trim().toLowerCase())
    .filter(kind => kind.length > 0);
  return kinds.length > 0 ? new Set(kinds) : null;
}

const mbdKindFilter = ref<ReadonlySet<string> | null>(readMbdKindFilter());
const mbdRecordCount = computed(() =>
  externalRecords.value.filter(record => record.source === 'mbd').length);
const shownMbdKindCount = computed(() =>
  MBD_KINDS.filter(kind => isMbdKindShown(kind)).length);

function isMbdKindShown(kind: string): boolean {
  return mbdKindFilter.value === null || mbdKindFilter.value.has(kind);
}

function writeMbdKinds(kinds: readonly string[] | null): void {
  const url = new URL(window.location.href);
  if (kinds === null) url.searchParams.delete('mbd_kinds');
  else url.searchParams.set('mbd_kinds', kinds.join(','));
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

function setMbdKindShown(kind: string, shown: boolean): void {
  const next = new Set(mbdKindFilter.value ?? MBD_KINDS);
  if (shown) next.add(kind);
  else next.delete(kind);
  if (next.size === 0) return;
  writeMbdKinds(
    next.size === MBD_KINDS.length ? null : MBD_KINDS.filter(item => next.has(item)),
  );
}

function showOnlyMbdKind(kind: MbdPrimitive['kind']): void {
  writeMbdKinds([kind]);
}

function showAllMbdKinds(): void {
  writeMbdKinds(null);
}

/**
 * B2：装载失败角标。视口空白的两种原因（「本分支没有标注」与「取数失败」）在
 * 界面上必须能区分，所以「一条 MBD 记录都没有 + 有 loadError」时在 BRAN 行上挂
 * 一个红色角标，点开直接展开下面的诊断面板。
 */
const mbdErrorBadgeVisible = computed(() =>
  mbdDiagnostics.value.loadError !== null && mbdRecordCount.value === 0);
const diagnosticsOpen = ref(false);

function openMbdDiagnostics(): void {
  diagnosticsOpen.value = true;
}

/**
 * B3：允许部分显示。真实开关在 `useMbdExternalSync`（读 URL `mbd_partial=1`）：
 * 关（缺省）= ADR 0046 的原子拒绝，一坏就整包不提交；开 = 跳过坏图元、其余照画，
 * 并在面板上常驻「已跳过 N 条」。开关同样只改 URL 再派发 `popstate` 触发重新同步；
 * 勾选框与横幅不自己记状态，`popstate` 时从 URL 回读（`syncDisplayModeFromLocation`），
 * 页内切换与浏览器前进 / 后退都与同步层实际用的模式一致。
 */
function readMbdPartialEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mbd_partial')?.trim() === '1';
}

const mbdPartialEnabled = ref(readMbdPartialEnabled());
const mbdSkippedCount = computed(() => mbdDiagnostics.value.skipped.length);

function setMbdPartialEnabled(enabled: boolean): void {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set('mbd_partial', '1');
  else url.searchParams.delete('mbd_partial');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

/**
 * BRAN 号（多值）：写 URL `mbd_refno`（`A/B` 与 `A_B` 两种写法都认，统一成下划线）
 * 并派发 `popstate` → ViewerPanel 走 `handleMbdLocationChange` 实时拉取；
 * 清空（隐藏）则删掉参数，来源被 `replaceExternalSource('mbd', [])` 清掉。
 *
 * 为什么是列表而不是单个字符串：同一视图要同时看几个 BRAN 的标注，而输入框只能
 * 表达「当前唯一值」——追加第二个必然覆盖第一个。编解码（逗号分隔、归一化、保序
 * 去重）收口在 `utils/mbdRefnoParam`，这里只做「面板 → URL」这一端，于是
 * `searchParams.set/delete` 的调用点与 `popstate` 链路都不必改。
 */
const mbdRefnos = ref<readonly string[]>(
  typeof window === 'undefined' ? [] : [...parseMbdRefnos(window.location.search)],
);

/** 草稿：待追加的单个 BRAN 号，追加成功后清空，避免误以为它仍在生效。 */
const mbdRefnoDraft = ref('');

/** 唯一的 URL 写入口：列表 → `mbd_refno`，空列表则删参数（= 不再显示任何标注）。 */
function writeMbdRefnos(refnos: readonly string[]): void {
  const url = new URL(window.location.href);
  const value = formatMbdRefnos(refnos);
  if (value === null) url.searchParams.delete('mbd_refno');
  else url.searchParams.set('mbd_refno', value);
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

/** 回车 / 点按钮：把草稿追加到列表末尾；已存在或空输入不写 URL（不触发重新取数）。 */
function applyMbdRefno(): void {
  const next = appendMbdRefno(mbdRefnos.value, mbdRefnoDraft.value);
  mbdRefnoDraft.value = '';
  if (next.length === mbdRefnos.value.length) return;
  writeMbdRefnos(next);
}

/** 关掉某一枚标签：只删这一项，其余顺序不变。 */
function dropMbdRefno(refno: string): void {
  writeMbdRefnos(removeMbdRefno(mbdRefnos.value, refno));
}

function hideMbdAnnotations(): void {
  mbdRefnoDraft.value = '';
  writeMbdRefnos([]);
}

/**
 * 分级显示（LOD，S3）的面板开关与统计。开关同样只改 URL（`mbd_lod=0` = 关）并派发
 * `popstate`，由同步层剥掉 `lod` 提示；统计读最近一次布局里 MBD 记录的 `derived.lodHidden`。
 */
function readMbdLodDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mbd_lod')?.trim() === '0';
}

const mbdLodDisabled = ref(readMbdLodDisabled());

function setMbdLodEnabled(enabled: boolean): void {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.delete('mbd_lod');
  else url.searchParams.set('mbd_lod', '0');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

const mbdLodHidden = computed(() => {
  const mbdIds = new Set(
    externalRecords.value.filter(record => record.source === 'mbd').map(record => record.id),
  );
  const summary = { total: 0, secondaryFar: 0, detailFar: 0, shortLine: 0, overlap: 0 };
  for (const layout of viewportLayouts.value) {
    if (!mbdIds.has(layout.dimensionId)) continue;
    const reason = layout.derived.lodHidden;
    if (!reason) continue;
    summary.total += 1;
    if (reason === 'secondary-far') summary.secondaryFar += 1;
    else if (reason === 'detail-far') summary.detailFar += 1;
    else if (reason === 'overlap') summary.overlap += 1;
    else summary.shortLine += 1;
  }
  return summary;
});

/**
 * 三维标注呈现（2026-09-12 参考图风格：尺寸线沿 dim_dir 外移、数字在三维平面里置于线上方、
 * 实心箭头；标签按卡片 / 方框 / 药丸式 billboard 带引线出图）的面板开关。同样只改 URL
 * （`mbd_3d=0` = 关）并派发 `popstate`，由同步层剥掉 mapper 打的 `dimension3d` / `tag`，
 * 内核回到求解器原位几何的平面呈现。
 */
function readMbd3dDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mbd_3d')?.trim() === '0';
}

const mbd3dDisabled = ref(readMbd3dDisabled());

function setMbd3dEnabled(enabled: boolean): void {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.delete('mbd_3d');
  else url.searchParams.set('mbd_3d', '0');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

/**
 * 显示模式（S4，2026-09-13）：`engineering`（默认）每条尺寸照工程图样全画；`inspection`
 * 让内核在每次完整布局后对每条尺寸的探测点（数字 / 标签锚点）向相机做一次射线求交，
 * 被模型挡住的整条淡化到 `theme.inspection.occludedAlpha`、其余 `visibleAlpha`（叠层在整帧
 * 之后直接画进 sRGB 画布，ADR 0064：0.35 / 0.65 就是约 35 % / 65 % 的对比），不隐藏。
 * 状态记在 URL `mbd_mode=inspection` 上（参数名沿用 MBD 时代），模式只关系到呈现，直接交给
 * `viewport.setDisplayMode`；浏览器前进 / 后退带来的 `popstate` 会把它同步回来。
 */
function setMbdDisplayMode(mode: MbdDisplayMode): void {
  const url = new URL(window.location.href);
  if (mode === 'engineering') url.searchParams.delete('mbd_mode');
  else url.searchParams.set('mbd_mode', mode);
  window.history.replaceState({}, '', url);
  mbdDisplayMode.value = mode;
  viewerContext.dimensionSystem.value?.viewport.setDisplayMode(mode);
}

/** 检视模式下最近一次布局里各条尺寸的遮挡统计（只数画出来的）。 */
const dimensionOcclusion = computed(() => {
  const summary = { occluded: 0, visible: 0 };
  for (const layout of viewportLayouts.value) {
    if (layout.primitives.length === 0) continue;
    if (layout.derived.occluded) summary.occluded += 1;
    else summary.visible += 1;
  }
  return summary;
});

function syncDisplayModeFromLocation(): void {
  mbdRefnos.value = typeof window === 'undefined'
    ? []
    : [...parseMbdRefnos(window.location.search)];
  // 后退 / 前进换了地址，草稿里那半个 BRAN 已经与任何来源无关，留着只会误导。
  mbdRefnoDraft.value = '';
  mbdKindFilter.value = readMbdKindFilter();
  mbdPartialEnabled.value = readMbdPartialEnabled();
  mbdLodDisabled.value = readMbdLodDisabled();
  mbd3dDisabled.value = readMbd3dDisabled();
  const mode = readMbdDisplayMode();
  if (mode !== mbdDisplayMode.value) {
    mbdDisplayMode.value = mode;
    viewerContext.dimensionSystem.value?.viewport.setDisplayMode(mode);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', syncDisplayModeFromLocation);
}
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', syncDisplayModeFromLocation);
  }
});
const recoveryPreview = computed(() => {
  void documentState.value;
  return viewerContext.dimensionSystem.value?.getRecoveryPreview() ?? null;
});
const currentUser = computed(() => {
  const user = userStore.currentUser.value;
  return user
    ? { id: user.id, role: String(user.role) }
    : null;
});

function commandId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `dimension-command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveRecovery(action: 'accept' | 'discard'): void {
  const system = viewerContext.dimensionSystem.value;
  if (!system) return;
  if (action === 'accept') {
    const preview = system.acceptRecovery();
    if (!preview) return;
    emitToast({
      message: `已恢复 ${preview.applied.length} 条尺寸修改`
        + (preview.rejected.length > 0
          ? `，${preview.rejected.length} 条无法恢复`
          : ''),
      level: preview.rejected.length > 0 ? 'warning' : 'success',
    });
    return;
  }
  system.discardRecovery();
  emitToast({ message: '已放弃未保存的尺寸修改', level: 'warning' });
}

function exportSvg(): void {
  const system = viewerContext.dimensionSystem.value;
  if (!system) {
    emitToast({ message: '尺寸系统尚未就绪', level: 'warning' });
    return;
  }
  try {
    const svg = system.exportSvg();
    const url = URL.createObjectURL(new Blob([svg], {
      type: 'image/svg+xml;charset=utf-8',
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dimensions-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    emitToast({ message: '尺寸 SVG 已导出', level: 'success' });
  } catch (error) {
    emitToast({
      message: `尺寸 SVG 导出失败：${
        error instanceof Error ? error.message : String(error)
      }`,
      level: 'error',
    });
  }
}

function select(item: DimensionListItem): void {
  selectedId.value = item.id;
  viewerContext.dimensionSystem.value?.viewport.setSelection(item.id);
}

function act(
  action: DimensionBoundAction,
  item: DimensionListItem,
): void {
  if (isExternalDimensionRecord(item)) {
    if (action === 'hide-external') {
      const registry = viewerContext.dimensionSystem.value?.externalRegistry;
      if (item.source === 'pipe-information') {
        const store = usePipeInformationStore();
        const refno = item.id.slice('pipe-information:'.length);
        store.setHidden(refno, !store.hiddenRefnos.value.includes(refno));
        return;
      }
      registry?.setHidden(item.id, !registry.isHidden(item.id));
    }
    return;
  }

  const session = viewerContext.dimensionSystem.value?.document;
  const system = viewerContext.dimensionSystem.value;
  const user = currentUser.value;
  if (!session || !system || !user) return;

  if (isDimensionRebindAction(action)) {
    if (!system.snapPort) {
      emitToast({ message: '尺寸捕捉数据尚未就绪', level: 'warning' });
      return;
    }
    const edit = createRebindEditSession({
      record: item,
      anchorSlot: rebindActionSlot(action),
      snapPort: system.snapPort,
      actor: { actorId: user.id, actorRole: user.role },
      createCommandId: commandId,
      now: Date.now,
      onPreview: preview => system.viewport.setPreview(preview),
    });
    if (!edit) {
      emitToast({ message: '该锚点不属于当前尺寸类型', level: 'warning' });
      return;
    }
    system.pointer.start(edit);
    emitToast({ message: '请在模型上选择新的锚点', level: 'info' });
    return;
  }

  const metadata = {
    commandId: commandId(),
    actorId: user.id,
    actorRole: user.role,
    at: Date.now(),
  };
  if (action === 'delete') {
    const result = session.apply({
      ...metadata,
      type: 'delete',
      dimensionId: item.id,
    });
    if (!result.ok) {
      emitToast({ message: `删除尺寸失败：${result.reason}`, level: 'warning' });
    }
    return;
  }
  if (action === 'restore-auto-layout') {
    const result = session.apply({
      ...metadata,
      type: 'set-label-pinned',
      dimensionId: item.id,
      labelPinned: false,
    });
    if (!result.ok) {
      emitToast({ message: `恢复自动布局失败：${result.reason}`, level: 'warning' });
    }
    return;
  }
  if (action === 'flip-angle' && item.kind === 'angular') {
    const result = session.apply({
      ...metadata,
      type: 'set-angle-arc',
      dimensionId: item.id,
      arcChoice: item.placement.arcChoice === 'minor' ? 'major' : 'minor',
    });
    if (!result.ok) {
      emitToast({ message: `翻转角度失败：${result.reason}`, level: 'warning' });
    }
    return;
  }
  if (action === 'toggle-radial-display' && item.kind === 'radial') {
    const result = session.apply({
      ...metadata,
      type: 'set-radial-display',
      dimensionId: item.id,
      display: item.display === 'radius' ? 'diameter' : 'radius',
    });
    if (!result.ok) {
      emitToast({ message: `切换半径/直径失败：${result.reason}`, level: 'warning' });
    }
  }
}
</script>

<template>
  <div class="flex h-full w-full flex-col overflow-hidden">
    <DimensionToolbar :disabled="!viewerContext.dimensionSystem.value"
      :can-undo="viewerContext.dimensionSystem.value?.document.canUndo ?? false"
      :can-redo="viewerContext.dimensionSystem.value?.document.canRedo ?? false"
      @export-svg="exportSvg" />
    <div class="max-h-[45%] shrink-0 overflow-auto"><PipeInformationPanel /></div>
    <div v-if="recoveryPreview"
      class="m-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      <div class="font-semibold">发现未保存的尺寸修改</div>
      <div class="mt-1">
        可恢复 {{ recoveryPreview.applied.length }} 条，
        无法恢复 {{ recoveryPreview.rejected.length }} 条。
      </div>
      <div class="mt-2 flex gap-2">
        <button type="button" class="rounded border px-2 py-1"
          @click="resolveRecovery('accept')">
          恢复
        </button>
        <button type="button" class="rounded border px-2 py-1"
          @click="resolveRecovery('discard')">
          放弃
        </button>
      </div>
    </div>
    <div class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-refno">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-semibold">BRAN 尺寸标注（MBD）</span>
        <span v-if="sourceVersionBadge"
          class="rounded border border-slate-300 bg-white px-1.5 py-0.5"
          data-testid="mbd-source-version"
          :title="sourceVersionTitle">
          {{ sourceVersionBadge }}
        </span>
        <button v-if="mbdErrorBadgeVisible"
          type="button"
          class="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-semibold text-red-700"
          data-testid="mbd-error-badge"
          :title="mbdDiagnostics.loadError ?? ''"
          @click="openMbdDiagnostics()">
          ! 装载失败
        </button>
        <input v-model="mbdRefnoDraft"
          class="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-0.5"
          data-testid="mbd-refno-draft"
          placeholder="例：24381/145018，回车追加"
          @keydown.enter="applyMbdRefno()" />
        <button type="button"
          class="rounded border px-1.5 py-0.5"
          data-testid="mbd-refno-append"
          @click="applyMbdRefno()">
          追加
        </button>
        <button type="button"
          class="rounded border px-1.5 py-0.5 disabled:opacity-40"
          data-testid="mbd-refno-hide"
          :disabled="mbdRefnos.length === 0"
          @click="hideMbdAnnotations()">
          隐藏
        </button>
      </div>
      <!--
        已生效的 BRAN 逐枚列出：单值时就只有一枚，与旧版「输入框里一个值」的观感接近；
        多值时必须能单独关掉某一枚，否则用户只能整组清空再重输。
      -->
      <div v-if="mbdRefnos.length > 0"
        class="mt-1 flex flex-wrap items-center gap-1"
        data-testid="mbd-refno-chips">
        <span v-for="refno in mbdRefnos"
          :key="refno"
          class="flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5"
          data-testid="mbd-refno-chip"
          :data-refno="refno">
          <span>{{ refno }}</span>
          <button type="button"
            class="rounded px-0.5 leading-none text-slate-500 hover:text-red-600"
            data-testid="mbd-refno-chip-remove"
            :title="`移除 ${refno}`"
            @click="dropMbdRefno(refno)">
            ×
          </button>
        </span>
      </div>
    </div>
    <div v-if="incompleteLayoutMode"
      class="m-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
      data-testid="mbd-incomplete-annotation">
      <div class="font-semibold">本分支标注不完整</div>
      <div class="mt-1">
        求解器以 {{ incompleteLayoutMode }} 模式产出，只覆盖部分标注类别。
        未产出的类别不会出现在下方诊断里，请勿据此判断标注已完整。
      </div>
    </div>
    <div v-if="mbdDiagnostics.channel"
      class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-partial-display">
      <label class="flex items-center gap-1">
        <input type="checkbox"
          data-testid="mbd-partial-toggle"
          :checked="mbdPartialEnabled"
          @change="setMbdPartialEnabled(($event.target as HTMLInputElement).checked)" />
        <span>允许部分显示（跳过坏图元，其余照常绘制）</span>
      </label>
      <div v-if="mbdPartialEnabled" class="mt-1">
        <span v-if="mbdSkippedCount > 0" data-testid="mbd-partial-banner">
          已跳过 {{ mbdSkippedCount }} 条，当前视图不代表完整标注。
        </span>
        <span v-else data-testid="mbd-partial-banner">当前没有需要跳过的图元。</span>
      </div>
      <div v-else class="mt-1 opacity-70">
        关闭时沿用原子拒绝（ADR 0046）：只要有一条图元无法映射，本分支不显示任何标注。
      </div>
    </div>
    <div v-if="mbdDiagnostics.channel"
      class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-kind-filter">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">MBD 图元类别（显示 {{ mbdRecordCount }} 条）</span>
        <span class="flex gap-1">
          <button type="button"
            class="rounded border px-1.5 py-0.5"
            data-testid="mbd-kind-only-linear"
            @click="showOnlyMbdKind('linear_dim')">
            只看长度
          </button>
          <button type="button"
            class="rounded border px-1.5 py-0.5 disabled:opacity-40"
            data-testid="mbd-kind-all"
            :disabled="mbdKindFilter === null"
            @click="showAllMbdKinds()">
            全部
          </button>
        </span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <label v-for="kind in MBD_KINDS"
          :key="kind"
          class="flex items-center gap-1">
          <input type="checkbox"
            :data-mbd-kind="kind"
            :checked="isMbdKindShown(kind)"
            :disabled="isMbdKindShown(kind) && shownMbdKindCount === 1"
            @change="setMbdKindShown(kind, ($event.target as HTMLInputElement).checked)" />
          <span>{{ MBD_KIND_LABELS[kind] }}</span>
        </label>
      </div>
      <div class="mt-1 flex flex-wrap items-center justify-between gap-2"
        data-testid="mbd-lod">
        <label class="flex items-center gap-1">
          <input type="checkbox"
            data-testid="mbd-lod-enabled"
            :checked="!mbdLodDisabled"
            @change="setMbdLodEnabled(($event.target as HTMLInputElement).checked)" />
          <span>分级显示（LOD）</span>
        </label>
        <span data-testid="mbd-lod-hidden">
          <template v-if="mbdLodDisabled">已关闭，每条尺寸照常出图</template>
          <template v-else>
            LOD 隐藏 {{ mbdLodHidden.total }} 条（atta 远景 {{ mbdLodHidden.secondaryFar }} / 短段 {{ mbdLodHidden.shortLine }} / 相压 {{ mbdLodHidden.overlap }} / 细节 {{ mbdLodHidden.detailFar }}）
          </template>
        </span>
      </div>
      <div class="mt-1 flex flex-wrap items-center justify-between gap-2"
        data-testid="mbd-3d">
        <label class="flex items-center gap-1">
          <input type="checkbox"
            data-testid="mbd-3d-enabled"
            :checked="!mbd3dDisabled"
            @change="setMbd3dEnabled(($event.target as HTMLInputElement).checked)" />
          <span>三维标注呈现（尺寸线外移 / 数字在线上方 / 实心箭头 / 标签卡片带引线）</span>
        </label>
        <span data-testid="mbd-3d-state">
          <template v-if="mbd3dDisabled">已关闭，按求解器原位几何平面出图</template>
          <template v-else>开</template>
        </span>
      </div>
    </div>
    <div class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-mode">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex flex-wrap items-center gap-2">
          <span>显示模式</span>
          <label class="flex items-center gap-1">
            <input type="radio"
              name="mbd-display-mode"
              value="engineering"
              data-testid="mbd-mode-engineering"
              :checked="mbdDisplayMode === 'engineering'"
              @change="setMbdDisplayMode('engineering')" />
            <span>Engineering（工程）</span>
          </label>
          <label class="flex items-center gap-1">
            <input type="radio"
              name="mbd-display-mode"
              value="inspection"
              data-testid="mbd-mode-inspection"
              :checked="mbdDisplayMode === 'inspection'"
              @change="setMbdDisplayMode('inspection')" />
            <span>Inspection（检视：被模型挡住的尺寸淡化）</span>
          </label>
        </span>
        <span data-testid="mbd-mode-state">
          <template v-if="mbdDisplayMode === 'inspection'">
            被遮挡 {{ dimensionOcclusion.occluded }} 条 / 可见 {{ dimensionOcclusion.visible }} 条
          </template>
          <template v-else>每条尺寸照工程图样全画</template>
        </span>
      </div>
    </div>
    <details v-if="diagnosticsVisible"
      :open="diagnosticsOpen"
      class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-diagnostics"
      @toggle="diagnosticsOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="cursor-pointer font-semibold">
        MBD 诊断（{{ diagnosticsCount }}）
        <span v-if="mbdDiagnostics.channel" class="font-normal opacity-70">
          实时
          · {{ mbdDiagnostics.sourceId }}
        </span>
      </summary>
      <div v-if="mbdDiagnostics.loadError"
        class="mt-2 font-semibold text-red-700"
        data-testid="mbd-load-error">
        装载失败：{{ mbdDiagnostics.loadError }}
      </div>
      <!--
        多 BRAN 同屏（2026-11-02）：逐包分组，组头写 `refno · N 条诊断 · 失败/正常`。
        单源走下面的原拍平路径，零变化。
      -->
      <template v-if="diagnosticsSourceGroups">
        <details v-for="group in diagnosticsSourceGroups"
          :key="group.refno"
          open
          class="mt-2 rounded border border-slate-200 bg-white p-1.5"
          data-testid="mbd-diagnostics-source"
          :data-refno="group.refno">
          <summary class="cursor-pointer font-semibold">
            {{ group.refno }} · {{ group.total }} 条诊断 ·
            <span :class="group.failed ? 'text-red-700' : 'text-emerald-700'">
              {{ group.failed ? '失败' : '正常' }}
            </span>
          </summary>
          <div v-if="group.loadError"
            class="mt-1 font-semibold text-red-700"
            :data-testid="`mbd-diagnostics-source-error-${group.refno}`">
            装载失败：{{ group.loadError }}
          </div>
          <div v-for="severity in (['error', 'warning', 'info'] as const)"
            :key="severity">
            <template v-if="group.bySeverity[severity].length > 0">
              <div class="mt-1 font-semibold"
                :class="{
                  'text-red-700': severity === 'error',
                  'text-amber-700': severity === 'warning',
                }">
                {{ severity }}（{{ group.bySeverity[severity].length }}）
              </div>
              <div v-for="issue in group.visibleBySeverity[severity]"
                :key="issue.id"
                class="mt-1 flex items-center justify-between gap-2"
                :data-issue-id="issue.id">
                <span class="min-w-0 break-all">
                  [{{ issue.category }}] {{ issue.message }}
                </span>
                <button v-if="issue.refno"
                  type="button"
                  class="shrink-0 rounded border px-1.5 py-0.5"
                  :data-locate-refno="issue.refno"
                  @click="locateIssueRefno(issue.refno)">
                  定位 {{ issue.refno }}
                </button>
              </div>
            </template>
          </div>
          <template v-if="group.visibleSkipped.length > 0">
            <div class="mt-1 font-semibold">
              跳过图元（{{ group.visibleSkipped.length }}）
            </div>
            <div v-for="entry in group.visibleSkipped"
              :key="entry.id"
              class="mt-1 break-all"
              :data-skipped-id="entry.id">
              {{ entry.id }}：{{ entry.reason }}
            </div>
          </template>
        </details>
      </template>
      <template v-else>
        <div v-for="severity in (['error', 'warning', 'info'] as const)"
          :key="severity">
          <template v-if="diagnosticsBySeverity[severity].length > 0">
            <div class="mt-2 font-semibold"
              :class="{
                'text-red-700': severity === 'error',
                'text-amber-700': severity === 'warning',
              }">
              {{ severity }}（{{ diagnosticsBySeverity[severity].length }}）
            </div>
            <div v-for="issue in visibleDiagnosticsBySeverity[severity]"
              :key="issue.id"
              class="mt-1 flex items-center justify-between gap-2"
              :data-issue-id="issue.id">
              <span class="min-w-0 break-all">
                [{{ issue.category }}] {{ issue.message }}
              </span>
              <button v-if="issue.refno"
                type="button"
                class="shrink-0 rounded border px-1.5 py-0.5"
                :data-locate-refno="issue.refno"
                @click="locateIssueRefno(issue.refno)">
                定位 {{ issue.refno }}
              </button>
            </div>
          </template>
        </div>
        <template v-if="mbdDiagnostics.skipped.length > 0">
          <div class="mt-2 font-semibold">
            跳过图元（{{ mbdDiagnostics.skipped.length }}）
          </div>
          <div v-for="entry in visibleSkippedDiagnostics"
            :key="entry.id"
            class="mt-1 break-all"
            :data-skipped-id="entry.id">
            {{ entry.id }}：{{ entry.reason }}
          </div>
        </template>
      </template>
      <template v-if="mbdDiagnostics.layoutMode || mbdDiagnostics.notes.length > 0">
        <div class="mt-2 font-semibold">求解器自报</div>
        <div v-if="mbdDiagnostics.layoutMode"
          class="mt-1"
          data-testid="mbd-layout-mode">
          排版模式：{{ mbdDiagnostics.layoutMode }}
        </div>
        <div v-for="note in mbdDiagnostics.notes"
          :key="note"
          class="mt-1 break-all">
          {{ note }}
        </div>
      </template>
      <div v-if="hiddenDiagnosticsCount > 0 || diagnosticsExpanded"
        class="mt-2">
        <button type="button"
          class="rounded border border-slate-300 px-1.5 py-0.5 hover:bg-slate-100"
          data-testid="mbd-diagnostics-toggle"
          @click="diagnosticsExpanded = !diagnosticsExpanded">
          <template v-if="diagnosticsExpanded">收起多余条目</template>
          <template v-else>显示全部（还有 {{ hiddenDiagnosticsCount }} 条）</template>
        </button>
      </div>
    </details>
    <div class="min-h-0 flex-1">
      <DimensionSemanticList :items="items"
        :selected-id="selectedId"
        :user="currentUser"
        :format-policy="DEFAULT_DIMENSION_FORMAT"
        :hidden-external-ids="hiddenExternalIds"
        :group-label="listGroupLabel"
        :on-select="select"
        :on-action="act" />
    </div>
  </div>
</template>
