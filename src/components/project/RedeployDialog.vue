<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-vue-next';

import type { DbnumRow } from '@/api/genModelV1Api';

import Dialog from '@/components/ui/Dialog.vue';
import {
  DBNUM_STATUS_LABEL,
  PIPELINE_STAGE_LABEL,
  dbnumPanelStatus,
  useModelGenerationAdmin,
  type AdminTaskView,
} from '@/composables/useModelGenerationAdmin';
import { useRedeployRvmFollowUp } from '@/composables/useRedeployRvmFollowUp';

/**
 * 「项目 → 一键完全重新部署」：探测 → 选库 → 二次确认（3 s）→ 提交 → 进度 → 结果。
 * 关掉弹窗任务在后台继续；再打开时探测到 `upgrade.state=running` 直接回进度视图。
 */
type Step = 'probing' | 'outdated' | 'probeError' | 'picking' | 'confirming' | 'conflict' | 'progress' | 'result';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; refreshModels: [] }>();

const admin = useModelGenerationAdmin();
const rvmFollowUp = useRedeployRvmFollowUp();
const autoRvm = rvmFollowUp.enabled;

const CONFIRM_SECONDS = 3;
const TASK_TERMINAL = new Set(['succeeded', 'partial', 'yielded', 'failed']);

const step = ref<Step>('probing');
const probeError = ref<string | null>(null);
const picked = ref<Set<number>>(new Set());
const countdown = ref(CONFIRM_SECONDS);
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const now = ref(Date.now());
/** 在结果页关掉过的那一趟（按 started_at 认），再打开时不再回它的结果页。 */
let acknowledgedRunStartedAt: string | null = null;

/** 可参与重新部署的库：排除不在本工程 / 被监听范围挡掉的行 */
const candidateRows = computed(() => admin.dbList.value.filter((row) => !row.excluded && !row.not_in_project));
const pickedRows = computed(() => candidateRows.value.filter((row) => picked.value.has(row.dbnum)));
const allPicked = computed(() => candidateRows.value.length > 0 && pickedRows.value.length === candidateRows.value.length);
const somePicked = computed(() => pickedRows.value.length > 0 && !allPicked.value);

const progress = computed(() => admin.upgradeProgress.value);
const requested = computed(() => progress.value?.requested ?? []);
const doneDbnums = computed(() => progress.value?.done_dbnums ?? []);
const failedList = computed(() => progress.value?.failed ?? []);
const upgradeRunning = computed(() => progress.value?.state === 'running');
/**
 * 只有「重试失败的库」那一趟按任务状态判断收尾；整趟部署以 upgrade.state 为准——后端重启后旧任务
 * 不在注册表里，任务卡会一直停在「排队中」，不能拿它挡结果页。
 */
const retryActive = ref(false);
const retryRunning = computed(() => retryActive.value && admin.redeployTasks.value.some((t) => !TASK_TERMINAL.has(t.state)));

const rowByDbnum = computed(() => new Map(admin.dbRows.value.map((row) => [row.dbnum, row])));

function rowName(dbnum: number): string {
  const row = rowByDbnum.value.get(dbnum);
  return row ? dbName(row) : '';
}

function dbName(row: DbnumRow): string {
  const raw = row.file_name ?? '';
  return typeof raw === 'string' ? raw : '';
}

const currentTask = computed<AdminTaskView | null>(
  () => admin.redeployTasks.value.find((t) => t.state === 'running') ?? null,
);

const elapsedText = computed(() => {
  const started = progress.value?.started_at ? Date.parse(progress.value.started_at) : NaN;
  if (Number.isNaN(started)) return '—';
  const finished = progress.value?.finished_at ? Date.parse(progress.value.finished_at) : NaN;
  const end = Number.isNaN(finished) ? now.value : finished;
  const secs = Math.max(0, Math.floor((end - started) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
});

const versionText = computed(() => {
  const info = admin.storageVersionInfo.value;
  if (!info || info.expected == null) return '—';
  return info.stored != null && info.stored !== info.expected ? `v${info.stored} → v${info.expected}` : `v${info.expected}`;
});

const taskStateLabel: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  partial: '部分完成',
  yielded: '已让出',
  failed: '失败',
};

function stageChipClass(task: AdminTaskView, index: number): string {
  if (task.state === 'succeeded') return 'bg-emerald-100 text-emerald-700';
  if (index < task.stageIndex) return 'bg-emerald-100 text-emerald-700';
  if (index === task.stageIndex) return task.state === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700';
  return 'bg-zinc-100 text-zinc-400';
}

function taskPercent(task: AdminTaskView): number {
  if (task.unitsDone == null || task.totalUnits == null || task.totalUnits <= 0) return 0;
  return Math.min(100, Math.round((task.unitsDone / task.totalUnits) * 100));
}

function togglePick(dbnum: number): void {
  const next = new Set(picked.value);
  if (next.has(dbnum)) next.delete(dbnum);
  else next.add(dbnum);
  picked.value = next;
}

function toggleAll(): void {
  picked.value = allPicked.value ? new Set() : new Set(candidateRows.value.map((row) => row.dbnum));
}

function stopCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function goConfirm(): void {
  if (pickedRows.value.length === 0) return;
  step.value = 'confirming';
  countdown.value = CONFIRM_SECONDS;
  stopCountdown();
  countdownTimer = setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 1);
    if (countdown.value === 0) stopCountdown();
  }, 1000);
}

function backToPicking(): void {
  stopCountdown();
  step.value = 'picking';
}

async function submit(): Promise<void> {
  if (countdown.value > 0 || admin.redeployBusy.value) return;
  const dbnums = pickedRows.value.map((row) => row.dbnum);
  retryActive.value = false;
  const outcome = await admin.redeploy(dbnums, { all: allPicked.value });
  if (outcome === 'accepted') step.value = 'progress';
  else if (outcome === 'conflict') step.value = 'conflict';
}

/** 409 只说明别人的升级在跑，不是这一趟的错误；转进度视图时把它清掉，免得留到结果页。 */
function viewRunningProgress(): void {
  admin.redeployError.value = null;
  step.value = 'progress';
}

async function retryFailed(): Promise<void> {
  const dbnums = failedList.value.map((f) => f.dbnum);
  if (dbnums.length === 0) return;
  retryActive.value = true;
  step.value = 'progress';
  await admin.retryDbnums(dbnums);
}

function refreshAndClose(): void {
  emit('refreshModels');
  emit('update:open', false);
}

async function probe(): Promise<void> {
  step.value = 'probing';
  probeError.value = null;
  try {
    const support = await admin.probeRedeploySupport();
    if (support === 'outdated') {
      step.value = 'outdated';
      return;
    }
    await admin.refreshDbnums();
    if (support === 'running') {
      step.value = 'progress';
      return;
    }
    // 上次在本会话跑完、结果还没看就关掉的，回结果页
    const finished = progress.value?.state === 'done' || progress.value?.state === 'failed';
    const unseen = (progress.value?.started_at ?? null) !== acknowledgedRunStartedAt;
    if (step.value === 'probing' && finished && unseen && admin.redeployTaskIds.value.length > 0) {
      step.value = 'result';
      return;
    }
    picked.value = new Set(candidateRows.value.map((row) => row.dbnum));
    step.value = 'picking';
  } catch (error) {
    probeError.value = error instanceof Error ? error.message : String(error);
    step.value = 'probeError';
  }
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // 剪贴板不可用时不打扰
  }
}

// 升级跑完 → 结果页；重试跑完（没有新的 upgrade 记录）同样落结果页
watch(
  () => [upgradeRunning.value, retryRunning.value, admin.redeployBusy.value] as const,
  ([running, retrying, busy]) => {
    if (step.value === 'progress' && !running && !retrying && !busy) step.value = 'result';
  },
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      void probe();
      clockTimer ??= setInterval(() => {
        now.value = Date.now();
      }, 1000);
    } else {
      if (step.value === 'result') acknowledgedRunStartedAt = progress.value?.started_at ?? null;
      stopCountdown();
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopCountdown();
  if (clockTimer) clearInterval(clockTimer);
});

const retryFailures = computed(() => admin.redeployTasks.value.filter((t) => t.state === 'failed' || t.state === 'partial'));
const resultFailed = computed(() => failedList.value.length > 0 || retryFailures.value.length > 0);
const resultDoneCount = computed(() => {
  const fromUpgrade = doneDbnums.value.length;
  const fromRetry = admin.redeployTasks.value.filter((t) => t.state === 'succeeded').length;
  return Math.max(fromUpgrade, fromRetry);
});
</script>

<template>
  <Dialog :open="open"
    :persistent="step === 'confirming' || admin.redeployBusy.value"
    panel-class="max-w-[600px]"
    body-class="max-h-[72vh] overflow-y-auto px-4 py-4 text-[11px] text-zinc-700"
    @update:open="emit('update:open', $event)">
    <template #title>
      <div class="min-w-0">
        <div class="font-ui text-sm font-semibold text-zinc-900">一键完全重新部署</div>
        <div class="mt-0.5 text-[11px] font-normal text-zinc-500">清空所选设计库的数据并从源文件重建：解析 → 生成 → 房间</div>
      </div>
    </template>

    <div class="flex flex-col gap-3" data-testid="redeploy-dialog">
      <!-- 探测 -->
      <div v-if="step === 'probing'" class="flex items-center justify-center gap-1.5 py-8 text-zinc-400">
        <Loader2 class="h-4 w-4 animate-spin" />
        正在检查后端…
      </div>

      <!-- ⑥B 后端过旧 -->
      <div v-else-if="step === 'outdated'" class="rounded-md border border-red-200 bg-red-50 p-3 text-red-800" data-testid="redeploy-outdated">
        <div class="flex items-center gap-1.5 font-medium">
          <ShieldAlert class="h-4 w-4" />
          后端版本过低，不支持一键重新部署
        </div>
        <p class="mt-1 leading-relaxed">
          当前 gen-model 未提供 storage-version 接口。请升级到包含 storage_upgrade 的版本后再使用；本功能不做降级兼容。
        </p>
        <button type="button" class="mt-2 rounded border border-red-200 bg-white px-2 py-1 text-red-700 hover:bg-red-100"
          @click="copyText(`gen-model version: ${admin.backendVersion.value ?? 'unknown'}`)">
          复制后端版本信息
        </button>
      </div>

      <div v-else-if="step === 'probeError'" class="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
        <div class="font-medium">连不上后端</div>
        <p class="mt-1">{{ probeError }}</p>
        <button type="button" class="mt-2 rounded border border-red-200 bg-white px-2 py-1 hover:bg-red-100" @click="probe">重试</button>
      </div>

      <!-- ⑥A 409 -->
      <div v-else-if="step === 'conflict'" class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800" data-testid="redeploy-conflict">
        <div class="flex items-center gap-1.5 font-medium">
          <AlertTriangle class="h-4 w-4" />
          已有重新部署任务正在运行
        </div>
        <p class="mt-1 leading-relaxed">{{ admin.redeployError.value }}。同一时间只能有一次重新部署，请等它完成后再试。</p>
        <button type="button" class="mt-2 rounded border border-amber-200 bg-white px-2 py-1 hover:bg-amber-100"
          data-testid="redeploy-view-progress"
          @click="viewRunningProgress">
          查看进度
        </button>
      </div>

      <!-- ② 选范围 -->
      <template v-else-if="step === 'picking'">
        <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 leading-relaxed text-amber-800">
          <div class="flex items-center gap-1 font-medium">
            <AlertTriangle class="h-3.5 w-3.5" />
            此操作会清空所选设计库的数据并从源文件重建
          </div>
          删除：PE 与属性、UDA、实例 / 几何关系、包围盒、房间归属、水位。保留：校审数据、任务历史、台账、源文件。重建期间模型不可用，请勿操作模型。
        </div>

        <div class="flex items-center justify-between">
          <label class="inline-flex items-center gap-1.5 text-zinc-600">
            <input type="checkbox" class="h-3 w-3 rounded border-zinc-300"
              :checked="allPicked"
              :indeterminate="somePicked"
              data-testid="redeploy-select-all"
              @change="toggleAll" />
            全选
            <span class="text-zinc-400">· 已选 {{ pickedRows.length }} / {{ candidateRows.length }} 个设计库</span>
          </label>
          <button type="button"
            class="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            :disabled="admin.dbLoading.value"
            @click="admin.refreshDbnums">
            <RefreshCw class="h-3 w-3" :class="admin.dbLoading.value ? 'animate-spin' : ''" />
            刷新
          </button>
        </div>

        <p v-if="admin.dbError.value" class="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-red-700">{{ admin.dbError.value }}</p>

        <section class="overflow-hidden rounded-lg border border-zinc-100">
          <div class="max-h-64 overflow-y-auto">
            <table class="w-full text-left">
              <thead class="sticky top-0 bg-zinc-50 text-zinc-500">
                <tr>
                  <th class="w-6 px-1.5 py-1.5" />
                  <th class="px-1.5 py-1.5 font-medium">dbnum</th>
                  <th class="px-1.5 py-1.5 font-medium">类型</th>
                  <th class="px-1.5 py-1.5 font-medium">库名</th>
                  <th class="px-1.5 py-1.5 font-medium">状态</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr v-for="row in candidateRows" :key="row.dbnum"
                  class="cursor-pointer hover:bg-zinc-50"
                  :class="picked.has(row.dbnum) ? 'bg-blue-50/40' : ''"
                  @click="togglePick(row.dbnum)">
                  <td class="px-1.5 py-1.5">
                    <input type="checkbox" class="h-3 w-3 rounded border-zinc-300"
                      :checked="picked.has(row.dbnum)"
                      :data-testid="`redeploy-db-${row.dbnum}`"
                      @click.stop
                      @change="togglePick(row.dbnum)" />
                  </td>
                  <td class="px-1.5 py-1.5 font-mono font-medium text-zinc-800">{{ row.dbnum }}</td>
                  <td class="px-1.5 py-1.5 font-mono text-zinc-500">{{ row.db_type || '—' }}</td>
                  <td class="max-w-[180px] truncate px-1.5 py-1.5 text-zinc-700" :title="dbName(row)">{{ dbName(row) || '—' }}</td>
                  <td class="px-1.5 py-1.5 text-zinc-500">{{ DBNUM_STATUS_LABEL[dbnumPanelStatus(row)] }}</td>
                </tr>
                <tr v-if="candidateRows.length === 0 && !admin.dbLoading.value">
                  <td colspan="5" class="px-2 py-4 text-center text-zinc-400">没有可重新部署的设计库</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p class="text-[10px] text-zinc-400">耗时取决于库大小，通常 15–40 分钟。全选时完成后会登记新的存储架构版本。</p>
        <label class="flex items-start gap-1.5 text-zinc-600">
          <input v-model="autoRvm" type="checkbox" class="mt-0.5 h-3 w-3 rounded border-zinc-300" data-testid="redeploy-auto-rvm" />
          <span>每个库重建完成后，自动对该库的 SITE 跑 RVM 校验（后台排队，需登录 E3D TTY）</span>
        </label>
      </template>

      <!-- ③ 二次确认 -->
      <template v-else-if="step === 'confirming'">
        <div class="rounded-md border border-red-200 bg-red-50 p-3 text-red-800" data-testid="redeploy-confirm">
          <div class="font-medium">确认重新部署？</div>
          <p class="mt-1 leading-relaxed">
            以下 {{ pickedRows.length }} 个设计库的数据将被清空并重建。此操作无法撤销，重建完成前这些库的模型、属性、房间查询均不可用。
          </p>
        </div>
        <ul class="max-h-40 overflow-y-auto rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 font-mono">
          <li v-for="row in pickedRows" :key="row.dbnum">{{ row.dbnum }} <span class="text-zinc-500">{{ dbName(row) }}</span></li>
        </ul>
        <div class="leading-relaxed text-zinc-500">
          <div>保留：校审批注 / 任务历史 / 数据中心台账 / 源文件</div>
          <div>删除：属性、PE、实例与几何关系、房间归属、水位</div>
          <div>几何文件（inst_geo / .mesh）按内容寻址原地覆盖，不单独清理</div>
        </div>
        <p v-if="admin.redeployError.value" class="text-red-600" data-testid="redeploy-error">{{ admin.redeployError.value }}</p>
      </template>

      <!-- ④ 进度 -->
      <template v-else-if="step === 'progress'">
        <div class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 leading-relaxed text-blue-800" data-testid="redeploy-progress">
          <div class="flex items-center gap-1 font-medium">
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            重建期间请勿操作模型
          </div>
          这些库的模型树、属性、空间查询会暂时为空或不完整。可以关闭本窗口，任务在后台继续；在「项目 → 部署状态」可重新打开。
        </div>

        <div class="grid grid-cols-4 gap-2">
          <div class="rounded-md border border-zinc-100 bg-zinc-50/60 px-2 py-1.5">
            <div class="text-[10px] text-zinc-400">已完成</div>
            <div class="font-mono text-sm text-zinc-900" data-testid="redeploy-done-count">{{ doneDbnums.length }} / {{ requested.length || admin.redeployTasks.value.length }}</div>
          </div>
          <div class="rounded-md border border-zinc-100 bg-zinc-50/60 px-2 py-1.5">
            <div class="text-[10px] text-zinc-400">当前</div>
            <div class="truncate font-mono text-zinc-900">
              {{ currentTask ? `${currentTask.dbnum ?? '—'} · ${PIPELINE_STAGE_LABEL[currentTask.stages[currentTask.stageIndex] ?? ''] ?? currentTask.currentStage ?? '—'}` : '—' }}
            </div>
          </div>
          <div class="rounded-md border border-zinc-100 bg-zinc-50/60 px-2 py-1.5">
            <div class="text-[10px] text-zinc-400">已用时</div>
            <div class="font-mono text-sm text-zinc-900">{{ elapsedText }}</div>
          </div>
          <div class="rounded-md border border-zinc-100 bg-zinc-50/60 px-2 py-1.5">
            <div class="text-[10px] text-zinc-400">storage_version</div>
            <div class="font-mono text-sm text-zinc-900">{{ versionText }}</div>
          </div>
        </div>

        <section v-if="admin.redeployTasks.value.length > 0" class="flex flex-col gap-1.5">
          <div v-for="task in admin.redeployTasks.value" :key="task.taskId"
            class="rounded-lg border border-zinc-100 bg-white p-2.5"
            :data-testid="`redeploy-task-${task.taskId}`">
            <div class="flex items-center gap-1.5">
              <CheckCircle2 v-if="task.state === 'succeeded'" class="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <XCircle v-else-if="task.state === 'failed'" class="h-3.5 w-3.5 shrink-0 text-red-600" />
              <Loader2 v-else-if="task.state === 'running'" class="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />
              <span v-else class="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-300" />
              <span class="min-w-0 flex-1 truncate font-mono text-zinc-800">
                {{ task.dbnum ?? '—' }} <span class="text-zinc-500">{{ task.dbnum != null ? rowName(task.dbnum) : '' }}</span>
              </span>
              <span class="shrink-0 text-[10px] text-zinc-500">{{ taskStateLabel[task.state] ?? task.state }}</span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <span v-for="(stage, index) in task.stages" :key="stage" class="rounded px-1 py-0.5 text-[9px]" :class="stageChipClass(task, index)">
                {{ PIPELINE_STAGE_LABEL[stage] ?? stage }}
              </span>
            </div>
            <div v-if="task.totalUnits != null && task.totalUnits > 0" class="mt-1.5">
              <div class="h-1 overflow-hidden rounded bg-zinc-200">
                <div class="h-full rounded bg-blue-500 transition-[width]" :style="{ width: `${taskPercent(task)}%` }" />
              </div>
            </div>
            <div class="mt-0.5 truncate font-mono text-[10px] text-zinc-400" :title="task.taskId">
              {{ task.stageHint ?? task.currentStage ?? '—' }}<template v-if="task.totalUnits"> · {{ task.unitsDone ?? 0 }} / {{ task.totalUnits }} units</template> · {{ task.taskId }}
            </div>
          </div>
        </section>
        <div v-else class="rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-zinc-500">
          任务由服务端逐库排队（{{ requested.join('、') || '—' }}），进度按 /health 每 5 秒刷新一次。
        </div>

        <div v-if="autoRvm && (rvmFollowUp.queuedDbnums.value.length > 0 || rvmFollowUp.error.value)"
          class="rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-zinc-600" data-testid="redeploy-rvm-followup">
          RVM 校验：已排入 {{ rvmFollowUp.queuedSites.value }} 个 SITE（库 {{ rvmFollowUp.queuedDbnums.value.join('、') || '—' }}），在 RVM 核对面板查看结论
          <div v-if="rvmFollowUp.error.value" class="text-red-600">{{ rvmFollowUp.error.value }}</div>
        </div>

        <div class="flex items-center gap-1 text-[10px] text-zinc-400">
          WS {{ admin.taskFeedStatus.value === 'live' ? '实时' : '未连接' }} · 2s 轮询兜底
          <button v-if="admin.redeployTaskIds.value.length > 0" type="button" class="ml-auto text-zinc-500 hover:text-zinc-700"
            @click="copyText(admin.redeployTaskIds.value.join('\n'))">
            复制任务 ID
          </button>
        </div>
      </template>

      <!-- ⑤ 结果 -->
      <template v-else-if="step === 'result'">
        <div v-if="resultDoneCount > 0" class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800" data-testid="redeploy-result-ok">
          <div class="flex items-center gap-1 font-medium">
            <CheckCircle2 class="h-3.5 w-3.5" />
            {{ resultDoneCount }} 个库已重建完成
          </div>
          <div class="mt-0.5">耗时 {{ elapsedText }} · 房间计算已刷新</div>
        </div>
        <div v-if="resultFailed" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800" data-testid="redeploy-result-failed">
          <div class="flex items-center gap-1 font-medium">
            <XCircle class="h-3.5 w-3.5" />
            {{ failedList.length || retryFailures.length }} 个库失败
          </div>
          <ul class="mt-1 space-y-0.5">
            <li v-for="item in failedList" :key="item.dbnum" class="leading-relaxed">
              <span class="font-mono">{{ item.dbnum }} {{ rowName(item.dbnum) }}</span>：{{ item.reason }}
            </li>
            <li v-for="task in retryFailures" :key="task.taskId" class="leading-relaxed">
              <span class="font-mono">{{ task.dbnum }}</span>：{{ task.lastUnitFailure ?? taskStateLabel[task.state] }}
            </li>
          </ul>
          <p class="mt-1 text-red-700/80">已完成的阶段数据已写入，可单独重试失败的库。</p>
        </div>
        <div v-if="autoRvm && (rvmFollowUp.queuedDbnums.value.length > 0 || rvmFollowUp.error.value)"
          class="rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-zinc-600" data-testid="redeploy-rvm-followup">
          RVM 校验：已排入 {{ rvmFollowUp.queuedSites.value }} 个 SITE（库 {{ rvmFollowUp.queuedDbnums.value.join('、') || '—' }}），在 RVM 核对面板查看结论
          <div v-if="rvmFollowUp.error.value" class="text-red-600">{{ rvmFollowUp.error.value }}</div>
        </div>
        <p v-if="admin.redeployError.value" class="text-red-600">{{ admin.redeployError.value }}</p>
      </template>
    </div>

    <template #footer>
      <template v-if="step === 'picking'">
        <button type="button" class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50" @click="emit('update:open', false)">取消</button>
        <button type="button"
          class="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="pickedRows.length === 0"
          data-testid="redeploy-next"
          @click="goConfirm">
          重新部署 {{ pickedRows.length }} 个库…
        </button>
      </template>
      <template v-else-if="step === 'confirming'">
        <button type="button" class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50"
          :disabled="admin.redeployBusy.value"
          @click="backToPicking">
          返回修改
        </button>
        <button type="button"
          class="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="countdown > 0 || admin.redeployBusy.value"
          data-testid="redeploy-submit"
          @click="submit">
          <Loader2 v-if="admin.redeployBusy.value" class="h-3.5 w-3.5 animate-spin" />
          {{ countdown > 0 ? `确认重新部署（${countdown}s）` : '确认重新部署' }}
        </button>
      </template>
      <template v-else-if="step === 'progress'">
        <button type="button" class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50"
          data-testid="redeploy-background"
          @click="emit('update:open', false)">
          后台运行
        </button>
      </template>
      <template v-else-if="step === 'result'">
        <button v-if="failedList.length > 0" type="button"
          class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          :disabled="admin.redeployBusy.value"
          data-testid="redeploy-retry"
          @click="retryFailed">
          重试失败的库
        </button>
        <button type="button" class="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
          data-testid="redeploy-refresh-close"
          @click="refreshAndClose">
          刷新模型并关闭
        </button>
      </template>
      <template v-else>
        <button type="button" class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50" @click="emit('update:open', false)">关闭</button>
      </template>
    </template>
  </Dialog>
</template>
