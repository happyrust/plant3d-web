/**
 * 「模型生成」面板的状态与动作（2026-10-15 设计稿 `docs/design/model-generation-panel.mock.html`）。
 *
 * 两条粒度：
 * - 按节点 / SITE：`generateThenCollect`（与模型树右键「重新生成模型」同一条路，容器逐层展开到生成根）；
 * - 按库：`POST /api/v1/update/execute { dbnums }`（与 setup.html 第⑤步同一条摄入管线，
 *   数据 → 生成 → 发布 → 空间 → 房间），任务轮询只跟踪回执里的 `task_id`（d-195，不列表全量任务）。
 *
 * 单例：抽屉关了再开，库列表 / 目标 / 在飞任务不丢（与 useSelectionStore 同一模式）。
 */
import { computed, reactive, ref, watch } from 'vue';

import { genModelV1UpdateExecute, type UpdateExecuteReceipt } from '@/api/genModelV1AdminApi';
import {
  fromV1Refno,
  genModelV1ElementAttributes,
  genModelV1Dbnums,
  genModelV1ModelBounds,
  genModelV1ModelRecords,
  genModelV1TaskGet,
  isRefnoLike,
  type DbnumRow,
  type TaskEntryDto,
} from '@/api/genModelV1Api';
import { tryGetDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  invalidateDbnumModelStatus,
  noteDbnumModelGenerated,
  scheduleDbnumModelReprobe,
} from '@/composables/useGenModelV1DbnumStatus';
import {
  connectGenModelV1TaskFeed,
  subscribeGenModelV1TaskEvents,
  useGenModelV1TaskFeed,
  type GenModelV1TaskEnvelope,
  type GenModelV1TaskProgress,
} from '@/composables/useGenModelV1TaskFeed';
import { getOutputProjectFromUrl } from '@/lib/currentProject';
import { getGenModelV1ModelSource } from '@/model-source';
import { listSitesOfDbnum, type CollectDbnumSite } from '@/model-source/genModelV1/collectDbnum';

// ---------------------------------------------------------------------------
// 库状态
// ---------------------------------------------------------------------------

export type DbnumPanelStatus = 'synced' | 'pending' | 'running' | 'awaiting' | 'uninitialized' | 'blocked' | 'excluded';

export const DBNUM_STATUS_LABEL: Record<DbnumPanelStatus, string> = {
  synced: '已同步',
  pending: '待更新',
  running: '进行中',
  awaiting: '待初始化',
  uninitialized: '未初始化',
  blocked: '阻断',
  excluded: '不参与',
};

/**
 * `/api/v1/dbnums` 行 → 面板状态徽标（实测字段见 DbnumRow）。
 *
 * 模型段的判据就是「模型最近更新时间的对比」：`model_sesno`（模型最后一次生成对到的数据会话）对比
 * `applied_sesno`（数据已应用会话）。服务端 `model_verdict` 已做过同一比较，表态了直接用（
 * `in_sync`/`lagging`），`not_judged` / 读透形态缺省时退回两个水位自己比。非 DESI 行不生成模型，
 * 只比数据段，免得目录库永远「待更新」。
 */
export function dbnumPanelStatus(row: DbnumRow): DbnumPanelStatus {
  if (row.excluded || row.not_in_project) return 'excluded';
  if (row.blocked) return 'blocked';
  if (row.write_state?.status === 'running') return 'running';
  if (!row.initialized) return row.awaiting_manual_initialization ? 'awaiting' : 'uninitialized';
  const applied = row.applied_sesno ?? 0;
  const file = row.file_latest_sesno ?? 0;
  if (applied < file) return 'pending';
  if (String(row.db_type ?? '').toUpperCase() !== 'DESI') return 'synced';
  const verdict = String(row.model_verdict ?? '').toLowerCase();
  if (verdict === 'lagging') return 'pending';
  if (verdict === 'in_sync') return 'synced';
  return (row.model_sesno ?? 0) < applied ? 'pending' : 'synced';
}

/** `pending` 行是哪一段滞后：`data` = 数据还没应用完；`model` = 模型水位落后于已应用数据。 */
export function dbnumLagReason(row: DbnumRow): 'data' | 'model' | null {
  if (dbnumPanelStatus(row) !== 'pending') return null;
  return (row.applied_sesno ?? 0) < (row.file_latest_sesno ?? 0) ? 'data' : 'model';
}

// ---------------------------------------------------------------------------
// 节点生成目标
// ---------------------------------------------------------------------------

export type ModelGenTargetStatus = 'idle' | 'running' | 'done' | 'pending' | 'failed';

export type ModelGenTarget = {
  /** `a_b` */
  refno: string;
  noun: string;
  name: string;
  status: ModelGenTargetStatus;
  detail: string | null;
  /** 生成+收集到的记录条数（构件实例粒度） */
  instanceCount: number | null;
  rootsDone: number;
  rootsTotal: number;
};

// ---------------------------------------------------------------------------
// 本会话发起的库任务（只轮询这些 task_id）
// ---------------------------------------------------------------------------

export type AdminTaskView = {
  taskId: string;
  dbnum: number | null;
  intent: string | null;
  state: string;
  currentStage: string | null;
  unitsDone: number | null;
  totalUnits: number | null;
  /** `detail.stages`：["data","generation","publication","spatial","rooms"] */
  stages: string[];
  /** 当前阶段在五段里的下标（0..4）；-1 = 映射不出 */
  stageIndex: number;
  /** 在飞的模型交付单元（WS `model_unit_started − finished` 差集，REST 拿不到的明细；`a_b`） */
  activeUnits: { refno: string; noun: string }[];
  /** 本任务内已确认失败的单元数（WS `model_unit_finished` 实时累计） */
  failedUnits: number;
  /** 最近一次单元失败的服务端 message */
  lastUnitFailure: string | null;
  /** 数据批次提示（WS `data_batch_started/finished`）；终态清空 */
  stageHint: string | null;
};

const TASK_TERMINAL = new Set(['succeeded', 'partial', 'yielded', 'failed']);

/** `detail.stages` 的五段展示顺序（batch_scheduler.rs 入队时写死的那本账）。 */
export const PIPELINE_STAGES = ['data', 'generation', 'publication', 'spatial', 'rooms'] as const;

export const PIPELINE_STAGE_LABEL: Record<string, string> = {
  data: '数据摄入',
  generation: '模型生成',
  publication: '发布',
  spatial: '空间树',
  rooms: '房间归属',
};

/**
 * `current_stage` 是细粒度阶段名（`data_parse` / `collect_window` / `model_generate` / `commit` …），
 * 映射到五段的展示桶；映射不出回 -1（面板退化为只显示原文）。
 */
export function pipelineStageIndex(currentStage: string | null | undefined): number {
  if (!currentStage) return -1;
  const s = currentStage.toLowerCase();
  if (s === 'rooms' || s.startsWith('room_')) return 4;
  if (s === 'spatial' || s.startsWith('spatial_')) return 3;
  if (s === 'publication' || s === 'publish' || s.startsWith('publish_')) return 2;
  if (s.includes('generat')) return 1;
  if (s === 'task_end') return 4;
  // data_parse / identity_check / wipe_reinit / initial_load / resolve_window / collect_window /
  // stage_apply / dependency_* / finalize / commit / write_marker / ref0_snapshot / durable_pending …
  return 0;
}

function taskViewFromDto(taskId: string, dbnum: number | null, intent: string | null, dto: TaskEntryDto): AdminTaskView {
  const stages = Array.isArray(dto.detail?.stages)
    ? (dto.detail!.stages as unknown[]).filter((s): s is string => typeof s === 'string')
    : [...PIPELINE_STAGES];
  return {
    taskId,
    dbnum: dbnum ?? (typeof dto.dbnum === 'number' ? dto.dbnum : null),
    intent: intent ?? (typeof dto.detail?.intent === 'string' ? dto.detail.intent : null),
    state: dto.state,
    currentStage: dto.current_stage ?? null,
    unitsDone: dto.units_done ?? null,
    totalUnits: dto.total_units ?? null,
    stages,
    stageIndex: pipelineStageIndex(dto.current_stage),
    activeUnits: [],
    failedUnits: 0,
    lastUnitFailure: null,
    stageHint: null,
  };
}

// ---------------------------------------------------------------------------
// 单例状态
// ---------------------------------------------------------------------------

const mode = ref<'node' | 'dbnum'>('node');

const dbRows = ref<DbnumRow[]>([]);
const dbLoading = ref(false);
const dbError = ref<string | null>(null);
const dbWarnings = ref<string[]>([]);
const onlyUnfinished = ref(false);
const selectedDbnums = ref<Set<number>>(new Set());

const executeBusy = ref(false);
const executeError = ref<string | null>(null);
const lastReceipt = ref<UpdateExecuteReceipt | null>(null);

const nodeInput = ref('');
const targets = ref<ModelGenTarget[]>([]);
const generateBusy = ref(false);
const nodeError = ref<string | null>(null);

// 「按库选 SITE」挑选器：dbnum → listSitesOfDbnum(tree/roots) → 勾 SITE 入目标队列
const sitePickerDbnum = ref<number | null>(null);
const sitePickerRows = ref<CollectDbnumSite[]>([]);
const sitePickerLoading = ref(false);
const sitePickerError = ref<string | null>(null);
const sitePickerSelected = ref<Set<string>>(new Set());
const sitePickerBusy = ref(false);
const sitePickerCache = new Map<number, CollectDbnumSite[]>();

const tasks = ref<Map<string, AdminTaskView>>(new Map());
const taskPollBusy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

// WS 任务事件（`/api/v1/ws`，tasks 主题）：逐单元进度是 REST 拿不到的明细，只在有订阅者时在飞。
const { feedStatus: taskFeedStatus, missedEvents: taskFeedMissed } = useGenModelV1TaskFeed();
let taskFeedStarted = false;
// 对话框请求过 /dbnums 之后，别的客户端 / 后端自己跑完的任务也要让水位行跟着变（2026-10-26 轻量联动）
let dbnumsRequestedOnce = false;
let foreignRefreshTimer: ReturnType<typeof setTimeout> | null = null;

// seq 空洞 = 有信封没送到；漏掉的若是 model_unit_finished，在飞清单会永远挂着一根已完的单元。
// 不知道漏的是哪个任务，索性清空全部在飞项——后续 model_unit_started 会重建它（ADR-0005：断线不编造状态）。
watch(taskFeedMissed, () => {
  for (const t of tasks.value.values()) {
    if (t.activeUnits.length > 0) t.activeUnits = [];
  }
});

// ---------------------------------------------------------------------------
// 模型刷新水位跟踪 + pending 目标复查（模型最近更新时间的对比判据）
// ---------------------------------------------------------------------------

/**
 * 读透 / kv-mem 形态的 `update/execute` 不回 task_id（`status: model_refresh_queued`），完成信号
 * 只能看水位：入队时记下 `file_latest_sesno`（数据最新时刻），轮询 `/dbnums` 直到
 * `model_sesno`（模型最近更新）追平它——追平 = 模型刷新落账。
 */
export type DbnumRefreshWatch = {
  dbnum: number;
  /** 入队时刻的目标水位（file_latest_sesno；0 = 行还没见到，等首拍重估） */
  targetSesno: number;
  modelSesno: number;
  appliedSesno: number;
  state: 'watching' | 'done' | 'timeout';
  startedAt: number;
};

const refreshWatches = ref<Map<number, DbnumRefreshWatch>>(new Map());
const refreshWatchList = computed(() => [...refreshWatches.value.values()]);
const REFRESH_WATCH_INTERVAL_MS = 4_000;
const REFRESH_WATCH_TIMEOUT_MS = 5 * 60_000;
let watchTimer: ReturnType<typeof setInterval> | null = null;

/** pending 目标的后台复查节奏与上限：轮 `model.spatial.bounds` 看模型水位追没追上最新数据。 */
const PENDING_PROBE_INTERVAL_MS = 5_000;
const PENDING_PROBE_TIMEOUT_MS = 10 * 60_000;
const pendingProbes = new Map<string, number>(); // refno → deadline
let pendingTimer: ReturnType<typeof setInterval> | null = null;

const dbList = computed(() =>
  [...dbRows.value].sort((a, b) => {
    const rank = (row: DbnumRow) => {
      const s = dbnumPanelStatus(row);
      return s === 'excluded' ? 2 : s === 'blocked' ? 1 : 0;
    };
    return rank(a) - rank(b) || a.dbnum - b.dbnum;
  }),
);

const filteredDbRows = computed(() => {
  if (!onlyUnfinished.value) return dbList.value;
  return dbList.value.filter((row) => {
    const s = dbnumPanelStatus(row);
    return s === 'uninitialized' || s === 'awaiting' || s === 'pending' || s === 'running' || s === 'blocked';
  });
});

const awaitingDbnums = computed(() =>
  dbList.value.filter((row) => dbnumPanelStatus(row) === 'awaiting' || dbnumPanelStatus(row) === 'uninitialized')
    .map((row) => row.dbnum),
);

const taskList = computed(() => [...tasks.value.values()].reverse());

/** 面板告警 = /dbnums 扫描告警 ∪ 上次 update/execute 回执告警；回执那份留在 lastReceipt 上派生，不被刷新列表覆盖。 */
const combinedWarnings = computed(() => {
  const receiptWarnings = (lastReceipt.value?.warnings ?? []).filter(Boolean);
  return [...new Set([...dbWarnings.value, ...receiptWarnings])];
});
const hasActiveTasks = computed(() => taskList.value.some((t) => !TASK_TERMINAL.has(t.state)));

// ---------------------------------------------------------------------------
// 库列表
// ---------------------------------------------------------------------------

/**
 * `/dbnums` 不带任何身份参数时是 bootstrap 骨架形态（只回 dbnum/文件/水位外的稀疏行）。
 * 传当前 `output_project` 进身份才拿全量行（initialized / applied_sesno / model_verdict…）；
 * 拿得到才传——拿不到让服务端用配置默认工程，也保持骨架语义可预测。
 */
function requestIdentity(): { project: string } | undefined {
  const project = getOutputProjectFromUrl();
  return project ? { project } : undefined;
}

async function refreshDbnums(): Promise<void> {
  dbnumsRequestedOnce = true;
  ensureTaskFeed(); // 水位表打开就听任务流，不等本会话登记第一个任务
  dbLoading.value = true;
  dbError.value = null;
  try {
    const resp = await genModelV1Dbnums({ identity: requestIdentity(), timeoutMs: 60_000 });
    dbRows.value = Array.isArray(resp?.dbnums) ? resp.dbnums : [];
    dbWarnings.value = (resp?.warnings ?? [])
      .map((w) => (typeof w === 'string' ? w : JSON.stringify(w)))
      .filter(Boolean);
  } catch (error) {
    dbError.value = error instanceof Error ? error.message : String(error);
  } finally {
    dbLoading.value = false;
  }
}

function toggleDbnum(dbnum: number): void {
  const next = new Set(selectedDbnums.value);
  if (next.has(dbnum)) next.delete(dbnum);
  else next.add(dbnum);
  selectedDbnums.value = next;
}

function selectAllAwaiting(): void {
  selectedDbnums.value = new Set(awaitingDbnums.value);
}

function clearDbSelection(): void {
  selectedDbnums.value = new Set();
}

// ---------------------------------------------------------------------------
// 库执行 + 任务轮询
// ---------------------------------------------------------------------------

/** 拉一次单个任务的 REST 快照覆盖视图；非终态时保留 WS 在飞明细。 */
async function refreshTaskSnapshot(t: AdminTaskView): Promise<void> {
  const dto = await genModelV1TaskGet(t.taskId, { identity: requestIdentity() });
  const view = taskViewFromDto(t.taskId, t.dbnum, t.intent, dto);
  if (!TASK_TERMINAL.has(view.state)) {
    // WS 明细（在飞单元/失败计数）REST 拿不到，轮询覆盖其它字段时保留
    view.activeUnits = t.activeUnits;
    view.failedUnits = t.failedUnits;
    view.lastUnitFailure = t.lastUnitFailure;
    view.stageHint = t.stageHint;
  }
  const next = new Map(tasks.value);
  next.set(t.taskId, view);
  tasks.value = next;
}

async function pollTasksOnce(): Promise<void> {
  const active = [...tasks.value.values()].filter((t) => !TASK_TERMINAL.has(t.state));
  if (active.length === 0) {
    stopPolling();
    return;
  }
  taskPollBusy.value = true;
  // 单拍失败不摘卡——下一轮再试（任务在服务端活得比前端久）
  await Promise.allSettled(active.map((t) => refreshTaskSnapshot(t)));
  taskPollBusy.value = false;
}

function ensurePolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void pollTasksOnce();
  }, 2000);
  void pollTasksOnce();
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// 刷新水位跟踪 / pending 复查实现
// ---------------------------------------------------------------------------

function evaluateRefreshWatches(): void {
  let changed = false;
  const next = new Map(refreshWatches.value);
  for (const [dbnum, watch] of next) {
    if (watch.state !== 'watching') continue;
    const row = dbRows.value.find((r) => r.dbnum === dbnum);
    if (row) {
      // 入队时还没拿到水位行的，首拍按现值重估目标
      if (watch.targetSesno <= 0) {
        watch.targetSesno = Math.max(row.file_latest_sesno ?? 0, row.applied_sesno ?? 0);
      }
      watch.modelSesno = row.model_sesno ?? 0;
      watch.appliedSesno = row.applied_sesno ?? 0;
      // 模型最近更新水位追平数据最新水位 → 刷新落账
      if (watch.targetSesno > 0 && watch.modelSesno >= watch.targetSesno) {
        watch.state = 'done';
        invalidateDbnumModelStatus(dbnum);
        changed = true;
        continue;
      }
      changed = true;
    }
    if (Date.now() - watch.startedAt > REFRESH_WATCH_TIMEOUT_MS) {
      watch.state = 'timeout';
      changed = true;
    }
  }
  if (changed) refreshWatches.value = next;
}

async function pollRefreshWatchesOnce(): Promise<void> {
  const watching = [...refreshWatches.value.values()].some((w) => w.state === 'watching');
  if (!watching) {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
    return;
  }
  // 不经过 refreshDbnums 的 dbLoading——跟踪节拍 4 s 会让「刷新」按钮的转圈常闪
  try {
    const resp = await genModelV1Dbnums({ identity: requestIdentity(), timeoutMs: 60_000 });
    dbRows.value = Array.isArray(resp?.dbnums) ? resp.dbnums : [];
    dbWarnings.value = (resp?.warnings ?? [])
      .map((w) => (typeof w === 'string' ? w : JSON.stringify(w)))
      .filter(Boolean);
  } catch {
    // 单拍失败不摘跟踪，下一轮再试
  }
  evaluateRefreshWatches();
}

function ensureWatchPolling(): void {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    void pollRefreshWatchesOnce();
  }, REFRESH_WATCH_INTERVAL_MS);
  void pollRefreshWatchesOnce();
}

/** `update/execute` 回执是读透形态（无 task_id）时启用：逐库记目标水位，按「模型最近更新追平文件最新」判完成。 */
function armRefreshWatches(dbnums: number[]): void {
  const next = new Map(refreshWatches.value);
  for (const dbnum of dbnums) {
    const row = dbRows.value.find((r) => r.dbnum === dbnum);
    next.set(dbnum, {
      dbnum,
      targetSesno: Math.max(row?.file_latest_sesno ?? 0, row?.applied_sesno ?? 0),
      modelSesno: row?.model_sesno ?? 0,
      appliedSesno: row?.applied_sesno ?? 0,
      state: 'watching',
      startedAt: Date.now(),
    });
  }
  refreshWatches.value = next;
  ensureWatchPolling();
}

/**
 * pending（服务端后台继续生成）目标的复查：每拍问一次 `model.spatial.bounds`——
 * `stale === false` 且 `publication_status === 'current'` 且 `model_count > 0` 就是
 * 「模型最近更新已追上最新数据」；bounds 不可用的老服务端退回 `model/records` 条数兜底。
 */
async function probePendingTarget(target: ModelGenTarget, deadline: number): Promise<void> {
  const dbnum = tryGetDbnumByRefno(target.refno);
  try {
    const bounds = await genModelV1ModelBounds(target.refno, { identity: requestIdentity(), timeoutMs: 30_000 });
    if (bounds.model_count > 0 && bounds.stale === false && bounds.publication_status === 'current') {
      target.status = 'done';
      target.instanceCount = bounds.model_count;
      target.detail = '后台生成完成，可点眼睛加载';
      pendingProbes.delete(target.refno);
      if (dbnum !== null) noteDbnumModelGenerated(dbnum);
      return;
    }
    target.detail = `后台生成中（已见 ${bounds.model_count} 实例${bounds.stale === true ? '，模型水位仍滞后' : ''}）`;
  } catch {
    try {
      const resp = await genModelV1ModelRecords({ generationRoot: target.refno, limit: 1 }, { identity: requestIdentity() });
      if (resp.total > 0) {
        target.status = 'done';
        target.instanceCount = resp.total;
        target.detail = '后台生成完成，可点眼睛加载';
        pendingProbes.delete(target.refno);
        if (dbnum !== null) noteDbnumModelGenerated(dbnum);
        return;
      }
      target.detail = '后台生成中（尚无记录落账）';
    } catch {
      // 单拍失败不摘状态，下一轮再探
    }
  }
  if (Date.now() > deadline) {
    pendingProbes.delete(target.refno);
    target.detail = '后台仍在生成（超时未确认，稍后可重新加载查看）';
    if (dbnum !== null) scheduleDbnumModelReprobe(dbnum);
  }
}

async function pollPendingTargetsOnce(): Promise<void> {
  const pending = targets.value.filter((t) => t.status === 'pending' && pendingProbes.has(t.refno));
  if (pending.length === 0) {
    if (pendingTimer) {
      clearInterval(pendingTimer);
      pendingTimer = null;
    }
    return;
  }
  await Promise.allSettled(pending.map((t) => probePendingTarget(t, pendingProbes.get(t.refno)!)));
  if (pendingProbes.size === 0 && pendingTimer) {
    clearInterval(pendingTimer);
    pendingTimer = null;
  }
}

/** 目标转 pending 时登记复查：生成落账后 chip 自己翻绿。 */
function trackPendingTarget(target: ModelGenTarget): void {
  pendingProbes.set(target.refno, Date.now() + PENDING_PROBE_TIMEOUT_MS);
  if (!pendingTimer) {
    pendingTimer = setInterval(() => {
      void pollPendingTargetsOnce();
    }, PENDING_PROBE_INTERVAL_MS);
    void pollPendingTargetsOnce();
  }
}

function dropPendingProbe(refno: string): void {
  pendingProbes.delete(refno);
}

// ---------------------------------------------------------------------------
// WS 任务事件（ADR-0005：明细走 WS，REST 轮询兜底对齐终态）
// ---------------------------------------------------------------------------

/**
 * 处理一条 `tasks` 主题信封。逐单元明细只关心本会话登记过的 task_id（d-195）；别的客户端 / 后端自己
 * 发起的任务只在 `task_finished` 时刷一拍库水位行（对话框请求过 /dbnums 才刷，800 ms 内连发合并），malformed 信封静默忽略。
 * 丢帧由 `task_finished`/2s 轮询的 REST 对齐兜底。
 */
function applyTaskEnvelope(envelope: GenModelV1TaskEnvelope): void {
  const taskId = typeof envelope.task_id === 'string' && envelope.task_id ? envelope.task_id : null;
  const task = taskId ? tasks.value.get(taskId) : undefined;
  if (!task) {
    if (envelope.type === 'task_finished' && dbnumsRequestedOnce) scheduleForeignDbnumsRefresh();
    return;
  }
  switch (envelope.type) {
    case 'task_started': {
      task.state = 'running';
      const payload = envelope.payload as { total_units?: unknown } | undefined;
      if (typeof payload?.total_units === 'number' && payload.total_units >= 0) {
        task.totalUnits = payload.total_units;
        if (task.unitsDone == null) task.unitsDone = 0;
      }
      ensurePolling();
      break;
    }
    case 'task_progress': {
      const payload = envelope.payload as GenModelV1TaskProgress | undefined;
      if (!payload || typeof payload !== 'object' || typeof (payload as { kind?: unknown }).kind !== 'string') return;
      switch (payload.kind) {
        case 'data_batch_started':
          task.stageHint = `应用数据 sesno ${payload.start_sesno}→${payload.end_sesno}`;
          break;
        case 'data_batch_finished':
          task.stageHint = null;
          void pollTasksOnce(); // 数据段收口多半翻过阶段，拉一拍对齐 currentStage/总数
          break;
        case 'model_unit_started': {
          const refno = fromV1Refno(String(payload.root_refno ?? ''));
          if (refno && !task.activeUnits.some((unit) => unit.refno === refno)) {
            task.activeUnits = [...task.activeUnits, { refno, noun: String(payload.noun ?? '') }];
          }
          break;
        }
        case 'model_unit_finished': {
          const refno = fromV1Refno(String(payload.root_refno ?? ''));
          task.activeUnits = task.activeUnits.filter((unit) => unit.refno !== refno);
          // 下一拍 REST 把 units_done 对齐成权威值；这里先即时反映
          task.unitsDone = task.totalUnits != null
            ? Math.min(task.totalUnits, (task.unitsDone ?? 0) + 1)
            : (task.unitsDone ?? 0) + 1;
          if (payload.success === false) {
            task.failedUnits += 1;
            task.lastUnitFailure = typeof payload.message === 'string' ? payload.message : null;
          }
          break;
        }
      }
      break;
    }
    case 'task_finished': {
      const payload = envelope.payload as { state?: unknown } | undefined;
      if (typeof payload?.state === 'string' && payload.state) task.state = payload.state;
      task.activeUnits = [];
      task.stageHint = null;
      // 终态明细（result.units / 告警）以 REST 快照为准——pollTasksOnce 只轮非终态，这里单独拉；
      // 顺手刷库水位行
      void (async () => {
        try {
          await refreshTaskSnapshot(task);
        } catch {
          // 拉不动就停在 WS 给的终态；「刷新」按钮可手动补
        }
        void refreshDbnums();
      })();
      break;
    }
  }
}

function scheduleForeignDbnumsRefresh(): void {
  if (foreignRefreshTimer) return;
  foreignRefreshTimer = setTimeout(() => {
    foreignRefreshTimer = null;
    void refreshDbnums();
  }, 800);
}

/** WS 实时事件在水位表第一次打开或第一次登记任务时拉起；连不上停在 `down`，2s REST 轮询本来就在兜底。 */
function ensureTaskFeed(): void {
  if (!taskFeedStarted) {
    taskFeedStarted = true;
    subscribeGenModelV1TaskEvents(applyTaskEnvelope); // 会话级常驻，不退订
  }
  connectGenModelV1TaskFeed(); // 已连上是 no-op；失败封顶后借新任务重试一次
}

function registerTask(taskId: string, dbnum: number | null, intent: string | null): void {
  if (!taskId) return;
  const next = new Map(tasks.value);
  if (!next.has(taskId)) {
    next.set(taskId, {
      taskId,
      dbnum,
      intent,
      state: 'queued',
      currentStage: null,
      unitsDone: null,
      totalUnits: null,
      stages: [...PIPELINE_STAGES],
      stageIndex: -1,
      activeUnits: [],
      failedUnits: 0,
      lastUnitFailure: null,
      stageHint: null,
    });
    tasks.value = next;
  }
  ensureTaskFeed();
}

/** `update/execute`：勾选库 → 摄入管线。回执里的 enqueued+merged task_id 全部登记轮询。 */
async function executeSelected(): Promise<void> {
  const dbnums = [...selectedDbnums.value].sort((a, b) => a - b);
  if (dbnums.length === 0 || executeBusy.value) return;
  executeBusy.value = true;
  executeError.value = null;
  try {
    const receipt = await genModelV1UpdateExecute(dbnums, { identity: requestIdentity() });
    lastReceipt.value = receipt;
    const batches = [...(receipt.enqueued ?? []), ...(receipt.merged ?? [])];
    for (const info of batches) {
      registerTask(info.task_id, info.dbnum ?? null, info.intent ?? null);
    }
    if (batches.length > 0) {
      ensurePolling();
    } else if (typeof receipt.status === 'string' && receipt.status !== '') {
      // 读透 / kv-mem 回执没有 task_id（`model_refresh_queued` 等）：改按模型水位追平文件水位判完成
      armRefreshWatches(dbnums);
    }
    // 执行后库水位会动；等一拍再刷列表，让 running 行先立起来
    void pollTasksOnce().then(() => refreshDbnums());
  } catch (error) {
    executeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    executeBusy.value = false;
  }
}

// ---------------------------------------------------------------------------
// 节点生成目标
// ---------------------------------------------------------------------------

function findTarget(refno: string): ModelGenTarget | undefined {
  return targets.value.find((t) => t.refno === refno);
}

/**
 * 加一个目标（refno `a_b` / `a_b` 两种写法都收）。identity 点查失败不挡——chip 照样进，
 * noun 留空，生成时才见真章（服务端拿不到的 refno 会在 generate 时报错）。
 */
async function addTargetByRefno(raw: string): Promise<ModelGenTarget | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!isRefnoLike(trimmed)) {
    nodeError.value = `不是合法 refno：${trimmed}`;
    return null;
  }
  const refno = trimmed.replace(/\//g, '_');
  const existing = findTarget(refno);
  if (existing) return existing;

  // 必须 reactive()：后面异步回填 noun/name 时，改原始对象会绕过 ref 数组的代理、DOM 不更新
  const target = reactive<ModelGenTarget>({
    refno,
    noun: '',
    name: '',
    status: 'idle',
    detail: null,
    instanceCount: null,
    rootsDone: 0,
    rootsTotal: 0,
  });
  targets.value = [...targets.value, target];
  nodeError.value = null;
  try {
    // 用 attributes（元素属性直读）取 noun/name——`e3d.element.identity` 依赖本机 E3D TTY，未必装得起
    const attrs = await genModelV1ElementAttributes(refno, { identity: requestIdentity() });
    target.noun = attrs.noun ?? '';
    const nameAttr = attrs.attributes?.find((a) => a.name === 'NAME');
    target.name = nameAttr && !nameAttr.is_unset ? String(nameAttr.display ?? nameAttr.value ?? '').trim() : '';
  } catch {
    target.detail = '节点信息点查失败（仍可尝试生成）';
  }
  return target;
}

/** SITE 挑选器直接入目标：noun/name 由 tree/roots 给出，省掉逐个 `element/attributes` 点查。 */
function addTargetEntry(entry: { refno: string; noun?: string; name?: string }): ModelGenTarget {
  const refno = entry.refno.trim().replace(/\//g, '_');
  const existing = findTarget(refno);
  if (existing) return existing;
  const target = reactive<ModelGenTarget>({
    refno,
    noun: entry.noun ?? '',
    name: entry.name ?? '',
    status: 'idle',
    detail: null,
    instanceCount: null,
    rootsDone: 0,
    rootsTotal: 0,
  });
  targets.value = [...targets.value, target];
  return target;
}

function removeTarget(refno: string): void {
  dropPendingProbe(refno);
  targets.value = targets.value.filter((t) => t.refno !== refno);
}

function clearTargets(): void {
  for (const t of targets.value) {
    if (t.status !== 'running') dropPendingProbe(t.refno);
  }
  targets.value = targets.value.filter((t) => t.status === 'running');
}

/** 逐个目标跑 `generateThenCollect`（容器按契约展开）。串行：避免一口气把服务端生成队列塞满。 */
async function generateTargets(): Promise<void> {
  if (generateBusy.value) return;
  const queue = targets.value.filter((t) => t.status !== 'running');
  if (queue.length === 0) return;
  generateBusy.value = true;
  nodeError.value = null;
  const source = getGenModelV1ModelSource();
  try {
    for (const target of queue) {
      dropPendingProbe(target.refno);
      target.status = 'running';
      target.detail = null;
      target.rootsDone = 0;
      target.rootsTotal = 1;
      target.instanceCount = null;
      try {
        const result = await source.records.generateThenCollect(target.refno, {
          onRootStart: ({ done, total, root }) => {
            target.detail = `正在生成 ${root}（${done + 1}/${total}）…`;
          },
          onRootDone: ({ done, total, root }) => {
            target.rootsDone = done;
            target.rootsTotal = Math.max(total, done);
            target.detail = `已生成 ${root}（${done}/${Math.max(total, done)}）`;
          },
        });
        target.instanceCount = result.items.length;
        const failedMessages = Object.entries(result.errors).map(([root, msg]) => `${root}: ${msg}`);
        // 行尾库状态圆点：生成出了记录记绿；还在后台生成排延迟补探
        const dbnum = tryGetDbnumByRefno(target.refno);
        if (dbnum !== null) {
          if (result.items.length > 0) noteDbnumModelGenerated(dbnum);
          else if (result.pending.length > 0) scheduleDbnumModelReprobe(dbnum);
        }
        if (result.items.length > 0) {
          target.status = 'done';
          const tails: string[] = [];
          if (result.pending.length > 0) tails.push(`${result.pending.length} 根仍在后台生成`);
          if (result.truncatedRoots.length > 0) tails.push(`${result.truncatedRoots.length} 根超出展开上限`);
          if (failedMessages.length > 0) tails.push(failedMessages[0]!);
          target.detail = tails.length > 0 ? tails.join('；') : '已生成，可点眼睛加载';
        } else if (result.pending.length > 0) {
          target.status = 'pending';
          target.detail = '服务端后台继续生成，按模型水位自动复查';
          trackPendingTarget(target);
        } else if (failedMessages.length > 0) {
          target.status = 'failed';
          target.detail = failedMessages.join('；');
        } else {
          target.status = 'done';
          target.detail = '无可渲染几何';
        }
      } catch (error) {
        target.status = 'failed';
        target.detail = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    generateBusy.value = false;
  }
}

// ---------------------------------------------------------------------------
// 「按库选 SITE」挑选器
// ---------------------------------------------------------------------------

const sitePickerCount = computed(() => sitePickerSelected.value.size);

/** 换库 / 首次选库时拉该库 SITE 清单；命中缓存不打第二次，勾选态随库切换清空。 */
async function loadSitePickerSites(dbnum: number, options?: { force?: boolean }): Promise<void> {
  sitePickerDbnum.value = dbnum;
  sitePickerSelected.value = new Set();
  sitePickerError.value = null;
  const cached = sitePickerCache.get(dbnum);
  if (cached && !options?.force) {
    sitePickerRows.value = cached;
    return;
  }
  sitePickerLoading.value = true;
  try {
    const rows = await listSitesOfDbnum(getGenModelV1ModelSource().tree, dbnum);
    sitePickerCache.set(dbnum, rows);
    sitePickerRows.value = rows;
  } catch (error) {
    sitePickerRows.value = [];
    sitePickerError.value = error instanceof Error ? error.message : String(error);
  } finally {
    sitePickerLoading.value = false;
  }
}

function toggleSitePick(refno: string): void {
  const next = new Set(sitePickerSelected.value);
  if (next.has(refno)) next.delete(refno);
  else next.add(refno);
  sitePickerSelected.value = next;
}

function setAllSitePicks(checked: boolean): void {
  sitePickerSelected.value = checked ? new Set(sitePickerRows.value.map((s) => s.refno)) : new Set();
}

/** 勾选的 SITE 全部进目标队列（已在队列里的跳过），完了清勾选。 */
function addPickedSites(): void {
  if (sitePickerBusy.value || sitePickerSelected.value.size === 0) return;
  sitePickerBusy.value = true;
  try {
    const picked = new Set(sitePickerSelected.value);
    for (const site of sitePickerRows.value) {
      if (!picked.has(site.refno)) continue;
      addTargetEntry({ refno: site.refno, noun: 'SITE', name: site.name });
    }
    sitePickerSelected.value = new Set();
    nodeError.value = null;
  } finally {
    sitePickerBusy.value = false;
  }
}

export function useModelGenerationAdmin() {
  return {
    mode,
    // 库
    dbRows,
    dbList,
    filteredDbRows,
    dbLoading,
    dbError,
    dbWarnings,
    combinedWarnings,
    onlyUnfinished,
    selectedDbnums,
    awaitingDbnums,
    refreshDbnums,
    toggleDbnum,
    selectAllAwaiting,
    clearDbSelection,
    // 执行 + 任务
    executeBusy,
    executeError,
    lastReceipt,
    executeSelected,
    tasks,
    taskList,
    hasActiveTasks,
    taskPollBusy,
    stopPolling,
    refreshWatchList,
    // WS 任务事件状态（`live` 实时；其余为 REST 轮询兜底）
    taskFeedStatus,
    taskFeedMissed,
    // 节点
    nodeInput,
    nodeError,
    targets,
    generateBusy,
    addTargetByRefno,
    addTargetEntry,
    removeTarget,
    clearTargets,
    generateTargets,
    // 「按库选 SITE」挑选器
    sitePickerDbnum,
    sitePickerRows,
    sitePickerLoading,
    sitePickerError,
    sitePickerSelected,
    sitePickerCount,
    sitePickerBusy,
    loadSitePickerSites,
    toggleSitePick,
    setAllSitePicks,
    addPickedSites,
  };
}
