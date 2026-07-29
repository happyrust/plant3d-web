/**
 * 版本时间线 store（specs/004-model-version-timeline T007）。
 *
 * 职责：releases/anchors 加载、按 dayKey 分组排序（data-model「时间线节点」规则）、
 * 粒度切换、diff 摘要懒加载缓存、A/B 钉选状态机（empty→onlyA→ready→comparing）、
 * 请求竞态防护（FR-034）。全部为会话级内存状态，不持久化。
 */

import { computed, reactive, ref, shallowRef } from 'vue';

import {
  getCompareReadiness,
  getReleaseDiff,
  listAnchors,
  listReleases,
  type ModelHistoryAnchor,
  type ModelReleaseDiffRow,
  type ModelReleasePairReadiness,
  type ModelReleaseRecord,
} from '@/api/modelVersionApi';

// ---------------------------------------------------------------------------
// 视图模型（data-model.md）
// ---------------------------------------------------------------------------

export type ReleaseView = {
  kind: 'release';
  key: string;
  releaseId: string;
  displayLabel: string;
  timestamp: number;
  dayKey: string;
  sesnoHint: string | null;
  lifecycle: string;
  quality: string;
  record: ModelReleaseRecord;
};

export type AnchorView = {
  kind: 'anchor';
  key: string;
  dbnum: number;
  sesno: number;
  timestamp: number;
  dayKey: string;
  source: string | null;
  anchor: ModelHistoryAnchor;
};

export type TimelineNode = ReleaseView | AnchorView;

export type TimelineDayGroup = {
  dayKey: string;
  nodes: TimelineNode[];
};

export type TimelineGranularity = 'releases' | 'with-anchors';

export type ComparePairStage = 'empty' | 'onlyA' | 'onlyB' | 'ready' | 'comparing';

export type DiffSummaryEntry = {
  status: 'loading' | 'ready' | 'error' | 'none';
  added?: number;
  changed?: number;
  deleted?: number;
  error?: string;
};

export type ReadinessEntry = {
  status: 'loading' | 'ready' | 'error';
  readiness?: ModelReleasePairReadiness;
  error?: string;
};

export type TimelineFilters = {
  project?: string;
  dbnum?: number;
  branchId?: string;
};

// ---------------------------------------------------------------------------
// 双轴徽章映射（data-model 徽章表；供面板与测试共用）
// ---------------------------------------------------------------------------

export type BadgeTone = 'green' | 'amber' | 'red' | 'gray';

export type Badge = { label: string; tone: BadgeTone; detail?: string };

const UNPUBLISHED_LIFECYCLES = new Set(['staged', 'validating', 'assets_materialized', 'indexed']);

export function lifecycleBadge(lifecycle?: string): Badge {
  const value = String(lifecycle ?? '').trim();
  if (value === 'published') return { label: '已发布', tone: 'green' };
  if (value === 'failed') return { label: '失败', tone: 'red' };
  if (UNPUBLISHED_LIFECYCLES.has(value)) return { label: '未发布', tone: 'gray', detail: value };
  return { label: '未发布', tone: 'gray', detail: value || 'unknown' };
}

export function qualityBadge(quality?: string): Badge {
  switch (String(quality ?? '').trim()) {
    case 'complete_visual':
      return { label: '完整', tone: 'green' };
    case 'degraded_visual':
      return { label: '降级', tone: 'amber' };
    case 'quarantined_visual':
      return { label: '隔离', tone: 'red' };
    case 'patch_only':
      return { label: '补丁', tone: 'gray' };
    case 'non_visual':
      return { label: '非可视', tone: 'gray' };
    default:
      return { label: String(quality ?? '').trim() || '未知', tone: 'gray' };
  }
}

// ---------------------------------------------------------------------------
// 派生辅助
// ---------------------------------------------------------------------------

export function releaseNodeKey(releaseId: string): string {
  return `release:${releaseId}`;
}

export function anchorNodeKey(dbnum: number, sesno: number): string {
  return `anchor:${dbnum}:${sesno}`;
}

function toTimestamp(raw: unknown): number {
  const parsed = Date.parse(String(raw ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 本地日期 yyyy-MM-dd（按天分组键） */
export function toDayKey(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未知日期';
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function sesnoHintFromReleaseId(releaseId: string): string | null {
  return releaseId.match(/physical-(\d+)/)?.[1] ?? null;
}

export function toReleaseView(record: ModelReleaseRecord): ReleaseView {
  const timestamp = toTimestamp(record.registered_at ?? record.created_at);
  const label = typeof record.release_label === 'string' && record.release_label.trim()
    ? record.release_label
    : record.release_id;
  return {
    kind: 'release',
    key: releaseNodeKey(record.release_id),
    releaseId: record.release_id,
    displayLabel: label,
    timestamp,
    dayKey: toDayKey(timestamp),
    sesnoHint: sesnoHintFromReleaseId(record.release_id),
    lifecycle: String(record.release_lifecycle ?? ''),
    quality: String(record.release_quality ?? ''),
    record,
  };
}

export function toAnchorView(anchor: ModelHistoryAnchor): AnchorView {
  const timestamp = toTimestamp(anchor.anchored_at);
  return {
    kind: 'anchor',
    key: anchorNodeKey(anchor.dbnum, anchor.sesno),
    dbnum: anchor.dbnum,
    sesno: anchor.sesno,
    timestamp,
    dayKey: toDayKey(timestamp),
    source: typeof anchor.source === 'string' ? anchor.source : null,
    anchor,
  };
}

function pairKeyOf(aKey: string, bKey: string): string {
  return `${aKey}->${bKey}`;
}

// ---------------------------------------------------------------------------
// 进入对比派发（T017·FR-009 主链路）：detail 契约与 ModelVersionComparePanel 组装
// 语义一致（contracts/version-timeline-ui-contract.md「只增不改」），新增可选
// source/pairKey 字段标识派发来源。
// ---------------------------------------------------------------------------

export const INCREMENTAL_COMPARE_EVENT = 'plant3d:incremental-version-compare';

export type CompareDispatchModel = {
  refno: string;
  componentKey: string;
  refnoU64?: number;
  category: string;
  status: string;
  beforeState: string;
  afterState: string;
  sourceChangeCount: number;
  sourceNouns: string;
};

export type CompareDispatchDetail = {
  project: string;
  dbnum: number;
  fromReleaseId: string;
  toReleaseId: string;
  fromSesno: number;
  toSesno: number;
  mode: 'dtx';
  compare: true;
  componentKey: string;
  refnos: string[];
  models: CompareDispatchModel[];
  source: 'versionTimeline';
  pairKey: string;
};

/** refno 归一化沿用 ModelVersionComparePanel.rowRefno：refno_str 的 `/`→`_`，缺省回退 component_key 尾段 */
export function diffRowRefno(row: ModelReleaseDiffRow): string {
  if (row.refno_str) return String(row.refno_str).replace(/\//g, '_');
  if (row.component_key) return String(row.component_key).split(':').pop() || '';
  return '';
}

function diffRowStatus(row: ModelReleaseDiffRow): string {
  if (row.change_type === 'changed') return 'modified';
  return row.change_type || 'modified';
}

function diffRowToModel(row: ModelReleaseDiffRow): CompareDispatchModel {
  return {
    refno: diffRowRefno(row),
    componentKey: row.component_key || '',
    refnoU64: row.refno_u64,
    category: row.noun || '',
    status: diffRowStatus(row),
    beforeState: row.change_type === 'added' ? 'missing' : 'present',
    afterState: row.change_type === 'deleted' ? 'missing' : 'present',
    sourceChangeCount: 1,
    sourceNouns: row.noun || '',
  };
}

// ---------------------------------------------------------------------------
// store 工厂（测试用独立实例；生产经 useVersionTimelineStore 单例）
// ---------------------------------------------------------------------------

export function createVersionTimelineStore() {
  const releases = shallowRef<ModelReleaseRecord[]>([]);
  const anchors = shallowRef<ModelHistoryAnchor[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const anchorsLoading = ref(false);
  const anchorsError = ref<string | null>(null);

  const filters = reactive<TimelineFilters>({});
  const granularity = ref<TimelineGranularity>('releases');

  const diffSummaries = ref(new Map<string, DiffSummaryEntry>());
  const readinessCache = ref(new Map<string, ReadinessEntry>());

  // A/B 钉选状态机（data-model ComparePair）
  const pinnedAKey = ref<string | null>(null);
  const pinnedBKey = ref<string | null>(null);
  const comparing = ref(false);

  // 竞态防护（FR-034）：requestId + AbortController
  let timelineRequestId = 0;
  let timelineAbort: AbortController | null = null;
  let anchorsRequestId = 0;
  let anchorsAbort: AbortController | null = null;
  const diffInFlight = new Set<string>();
  let readinessRequestId = 0;

  // ------- 时间线节点与分组 -------

  const releaseViews = computed<ReleaseView[]>(() => {
    let records = releases.value;
    if (filters.branchId) {
      records = records.filter((record) => String(record.branch_id ?? '') === filters.branchId);
    }
    return records.map(toReleaseView);
  });

  const anchorViews = computed<AnchorView[]>(() => anchors.value.map(toAnchorView));

  const timelineNodes = computed<TimelineNode[]>(() => {
    const nodes: TimelineNode[] = [...releaseViews.value];
    if (granularity.value === 'with-anchors') {
      // 已有 release 节点覆盖的 sesno 不重复渲染锚点（release 即该 sesno 的粗刻度）
      const releaseSesnos = new Set(
        releaseViews.value.map((view) => view.sesnoHint).filter(Boolean),
      );
      for (const anchor of anchorViews.value) {
        if (releaseSesnos.has(String(anchor.sesno))) continue;
        nodes.push(anchor);
      }
    }
    return nodes.sort((a, b) => b.timestamp - a.timestamp);
  });

  /** 组间按 dayKey 倒序；组内按 timestamp 倒序（data-model 排序规则） */
  const dayGroups = computed<TimelineDayGroup[]>(() => {
    const byDay = new Map<string, TimelineNode[]>();
    for (const node of timelineNodes.value) {
      const list = byDay.get(node.dayKey) ?? [];
      list.push(node);
      byDay.set(node.dayKey, list);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([dayKey, nodes]) => ({ dayKey, nodes }));
  });

  const nodeByKey = computed(() => {
    const map = new Map<string, TimelineNode>();
    for (const node of timelineNodes.value) map.set(node.key, node);
    return map;
  });

  // ------- 加载 -------

  async function loadTimeline(): Promise<void> {
    const requestId = ++timelineRequestId;
    timelineAbort?.abort();
    const controller = new AbortController();
    timelineAbort = controller;

    loading.value = true;
    error.value = null;
    try {
      const records = await listReleases(
        {
          project: filters.project,
          dbnum: filters.dbnum,
        },
        { signal: controller.signal },
      );
      if (requestId !== timelineRequestId) return;
      releases.value = records;
    } catch (err) {
      if (requestId !== timelineRequestId) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      releases.value = [];
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (requestId === timelineRequestId) loading.value = false;
    }
  }

  async function loadAnchors(): Promise<void> {
    const dbnum = filters.dbnum;
    if (!dbnum) {
      anchors.value = [];
      return;
    }
    const requestId = ++anchorsRequestId;
    anchorsAbort?.abort();
    const controller = new AbortController();
    anchorsAbort = controller;

    anchorsLoading.value = true;
    anchorsError.value = null;
    try {
      const result = await listAnchors(dbnum, undefined, { signal: controller.signal });
      if (requestId !== anchorsRequestId) return;
      anchors.value = result.anchors;
    } catch (err) {
      if (requestId !== anchorsRequestId) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      anchors.value = [];
      anchorsError.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (requestId === anchorsRequestId) anchorsLoading.value = false;
    }
  }

  function setFilters(next: TimelineFilters): void {
    filters.project = next.project;
    filters.dbnum = next.dbnum;
    filters.branchId = next.branchId;
  }

  async function setGranularity(next: TimelineGranularity): Promise<void> {
    granularity.value = next;
    if (next === 'with-anchors' && anchors.value.length === 0 && !anchorsLoading.value) {
      await loadAnchors();
    }
  }

  // ------- diff 摘要懒加载缓存 -------

  /** 相对上一版本（同 dbnum、时间上紧邻的更早 release）的差异摘要 */
  function previousReleaseOf(releaseId: string): ReleaseView | null {
    const ordered = releaseViews.value
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp);
    const index = ordered.findIndex((view) => view.releaseId === releaseId);
    if (index < 0) return null;
    const current = ordered[index]!;
    for (let i = index + 1; i < ordered.length; i += 1) {
      const candidate = ordered[i]!;
      if (candidate.record.dbnum === current.record.dbnum) return candidate;
    }
    return null;
  }

  async function ensureDiffSummary(releaseId: string): Promise<void> {
    const existing = diffSummaries.value.get(releaseId);
    if (existing && existing.status !== 'error') return;
    if (diffInFlight.has(releaseId)) return;

    const current = releaseViews.value.find((view) => view.releaseId === releaseId);
    if (!current) return;
    const previous = previousReleaseOf(releaseId);
    if (!previous) {
      diffSummaries.value.set(releaseId, { status: 'none' });
      diffSummaries.value = new Map(diffSummaries.value);
      return;
    }
    const project = String(current.record.project_name ?? filters.project ?? '');
    if (!project) {
      diffSummaries.value.set(releaseId, { status: 'error', error: '缺少 project，无法查询差异摘要' });
      diffSummaries.value = new Map(diffSummaries.value);
      return;
    }

    diffInFlight.add(releaseId);
    diffSummaries.value.set(releaseId, { status: 'loading' });
    diffSummaries.value = new Map(diffSummaries.value);
    try {
      // summary 为全量差异统计，与 limit 无关；limit=1 仅最小化 rows 载荷
      const diff = await getReleaseDiff({
        project,
        fromReleaseId: previous.releaseId,
        toReleaseId: releaseId,
        limit: 1,
      });
      diffSummaries.value.set(releaseId, {
        status: 'ready',
        added: diff.summary.added ?? 0,
        changed: diff.summary.changed ?? 0,
        deleted: diff.summary.deleted ?? 0,
      });
    } catch (err) {
      diffSummaries.value.set(releaseId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      diffInFlight.delete(releaseId);
      diffSummaries.value = new Map(diffSummaries.value);
    }
  }

  // ------- A/B 钉选状态机 -------

  const stage = computed<ComparePairStage>(() => {
    if (comparing.value) return 'comparing';
    if (pinnedAKey.value && pinnedBKey.value) return 'ready';
    if (pinnedAKey.value) return 'onlyA';
    if (pinnedBKey.value) return 'onlyB';
    return 'empty';
  });

  const pinnedA = computed<ReleaseView | null>(() => {
    const node = pinnedAKey.value ? nodeByKey.value.get(pinnedAKey.value) : null;
    return node?.kind === 'release' ? node : null;
  });

  const pinnedB = computed<ReleaseView | null>(() => {
    const node = pinnedBKey.value ? nodeByKey.value.get(pinnedBKey.value) : null;
    return node?.kind === 'release' ? node : null;
  });

  const currentPairKey = computed<string | null>(() => {
    if (!pinnedAKey.value || !pinnedBKey.value) return null;
    return pairKeyOf(pinnedAKey.value, pinnedBKey.value);
  });

  function isPinnable(nodeKey: string): boolean {
    return nodeByKey.value.get(nodeKey)?.kind === 'release';
  }

  /** 仅 release 可钉选（data-model）；替换钉选时 readiness 缓存失效重查；对比中替换自动退回 ready */
  function pinA(nodeKey: string): boolean {
    if (!isPinnable(nodeKey)) return false;
    if (pinnedBKey.value === nodeKey) pinnedBKey.value = null;
    invalidateReadiness();
    pinnedAKey.value = nodeKey;
    comparing.value = false;
    return true;
  }

  function pinB(nodeKey: string): boolean {
    if (!isPinnable(nodeKey)) return false;
    if (pinnedAKey.value === nodeKey) pinnedAKey.value = null;
    invalidateReadiness();
    pinnedBKey.value = nodeKey;
    comparing.value = false;
    return true;
  }

  function clearA(): void {
    pinnedAKey.value = null;
    comparing.value = false;
    invalidateReadiness();
  }

  function clearB(): void {
    pinnedBKey.value = null;
    comparing.value = false;
    invalidateReadiness();
  }

  function invalidateReadiness(): void {
    const key = currentPairKey.value;
    if (key) {
      readinessCache.value.delete(key);
      readinessCache.value = new Map(readinessCache.value);
    }
    readinessRequestId += 1;
  }

  /** ready → comparing 前必须完成 readiness 检查（FR-027 的 UI 确认由调用方负责） */
  function enterCompare(): boolean {
    if (stage.value !== 'ready') return false;
    comparing.value = true;
    return true;
  }

  function closeCompare(): void {
    comparing.value = false;
  }

  // ------- readiness 懒加载缓存 -------

  const currentReadiness = computed<ReadinessEntry | null>(() => {
    const key = currentPairKey.value;
    return key ? readinessCache.value.get(key) ?? null : null;
  });

  async function ensureReadiness(): Promise<ModelReleasePairReadiness | null> {
    const a = pinnedA.value;
    const b = pinnedB.value;
    const key = currentPairKey.value;
    if (!a || !b || !key) return null;

    const cached = readinessCache.value.get(key);
    if (cached?.status === 'ready') return cached.readiness ?? null;
    if (cached?.status === 'loading') return null;

    const project = String(a.record.project_name ?? filters.project ?? '');
    const requestId = ++readinessRequestId;
    readinessCache.value.set(key, { status: 'loading' });
    readinessCache.value = new Map(readinessCache.value);
    try {
      const readiness = await getCompareReadiness({
        project,
        fromReleaseId: a.releaseId,
        toReleaseId: b.releaseId,
      });
      if (requestId !== readinessRequestId) return null;
      readinessCache.value.set(key, { status: 'ready', readiness });
      return readiness;
    } catch (err) {
      if (requestId !== readinessRequestId) return null;
      readinessCache.value.set(key, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      readinessCache.value = new Map(readinessCache.value);
    }
  }

  function dispose(): void {
    timelineRequestId += 1;
    anchorsRequestId += 1;
    readinessRequestId += 1;
    timelineAbort?.abort();
    anchorsAbort?.abort();
  }

  return {
    // 状态
    releases,
    anchors,
    loading,
    error,
    anchorsLoading,
    anchorsError,
    filters,
    granularity,
    diffSummaries,
    // 派生
    releaseViews,
    anchorViews,
    timelineNodes,
    dayGroups,
    nodeByKey,
    // 加载
    loadTimeline,
    loadAnchors,
    setFilters,
    setGranularity,
    ensureDiffSummary,
    // A/B 钉选
    stage,
    pinnedA,
    pinnedB,
    currentPairKey,
    pinA,
    pinB,
    clearA,
    clearB,
    enterCompare,
    closeCompare,
    // readiness
    currentReadiness,
    ensureReadiness,
    // 生命周期
    dispose,
  };
}

export type VersionTimelineStore = ReturnType<typeof createVersionTimelineStore>;

let singleton: VersionTimelineStore | null = null;

export function useVersionTimelineStore(): VersionTimelineStore {
  if (!singleton) singleton = createVersionTimelineStore();
  return singleton;
}
