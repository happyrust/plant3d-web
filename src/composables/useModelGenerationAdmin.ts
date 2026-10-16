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
import { computed, reactive, ref } from 'vue';

import { genModelV1UpdateExecute, type UpdateExecuteReceipt } from '@/api/genModelV1AdminApi';
import {
  genModelV1ElementAttributes,
  genModelV1Dbnums,
  genModelV1TaskGet,
  isRefnoLike,
  type DbnumRow,
  type TaskEntryDto,
} from '@/api/genModelV1Api';
import { tryGetDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  noteDbnumModelGenerated,
  scheduleDbnumModelReprobe,
} from '@/composables/useGenModelV1DbnumStatus';
import { getOutputProjectFromUrl } from '@/lib/currentProject';
import { getGenModelV1ModelSource } from '@/model-source';

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

/** `/api/v1/dbnums` 行 → 面板状态徽标（实测字段见 DbnumRow）。 */
export function dbnumPanelStatus(row: DbnumRow): DbnumPanelStatus {
  if (row.excluded || row.not_in_project) return 'excluded';
  if (row.blocked) return 'blocked';
  if (row.write_state?.status === 'running') return 'running';
  if (!row.initialized) return row.awaiting_manual_initialization ? 'awaiting' : 'uninitialized';
  const applied = row.applied_sesno ?? 0;
  const file = row.file_latest_sesno ?? 0;
  return applied < file ? 'pending' : 'synced';
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

const tasks = ref<Map<string, AdminTaskView>>(new Map());
const taskPollBusy = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

async function pollTasksOnce(): Promise<void> {
  const active = [...tasks.value.values()].filter((t) => !TASK_TERMINAL.has(t.state));
  if (active.length === 0) {
    stopPolling();
    return;
  }
  taskPollBusy.value = true;
  await Promise.allSettled(
    active.map(async (t) => {
      try {
        const dto = await genModelV1TaskGet(t.taskId, { identity: requestIdentity() });
        const next = new Map(tasks.value);
        next.set(t.taskId, taskViewFromDto(t.taskId, t.dbnum, t.intent, dto));
        tasks.value = next;
      } catch {
        // 单拍失败不摘卡——下一轮再试（任务在服务端活得比前端久）
      }
    }),
  );
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
    });
    tasks.value = next;
  }
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
    for (const info of [...(receipt.enqueued ?? []), ...(receipt.merged ?? [])]) {
      registerTask(info.task_id, info.dbnum ?? null, info.intent ?? null);
    }
    if ((receipt.enqueued ?? []).length + (receipt.merged ?? []).length > 0) {
      ensurePolling();
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

function removeTarget(refno: string): void {
  targets.value = targets.value.filter((t) => t.refno !== refno);
}

function clearTargets(): void {
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
      target.status = 'running';
      target.detail = null;
      target.rootsDone = 0;
      target.rootsTotal = 1;
      target.instanceCount = null;
      try {
        const result = await source.records.generateThenCollect(target.refno, {
          onRootDone: ({ done, total }) => {
            target.rootsDone = done;
            target.rootsTotal = Math.max(total, done);
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
          target.detail = '服务端后台继续生成，完成后再加载';
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
    // 节点
    nodeInput,
    nodeError,
    targets,
    generateBusy,
    addTargetByRefno,
    removeTarget,
    clearTargets,
    generateTargets,
  };
}
