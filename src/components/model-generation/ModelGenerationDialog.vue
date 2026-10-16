<script setup lang="ts">
import { computed, watch } from 'vue';

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MousePointerClick,
  Play,
  Plus,
  RefreshCw,
  X,
} from 'lucide-vue-next';

import type { DbnumRow } from '@/api/genModelV1Api';

import Dialog from '@/components/ui/Dialog.vue';
import {
  DBNUM_STATUS_LABEL,
  PIPELINE_STAGE_LABEL,
  dbnumLagReason,
  dbnumPanelStatus,
  useModelGenerationAdmin,
  type AdminTaskView,
  type DbnumPanelStatus,
  type DbnumRefreshWatch,
  type ModelGenTarget,
} from '@/composables/useModelGenerationAdmin';
import { getGlobalSelectedRefno, useSelectionStore } from '@/composables/useSelectionStore';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const admin = useModelGenerationAdmin();
const selectionStore = useSelectionStore();

const statusBadgeClass: Record<DbnumPanelStatus, string> = {
  synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
  awaiting: 'bg-orange-50 text-orange-700 border-orange-200',
  uninitialized: 'bg-gray-100 text-gray-600 border-gray-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  excluded: 'bg-gray-50 text-gray-400 border-gray-200',
};

const taskStateBadgeClass = computed(() => (state: string) => {
  switch (state) {
    case 'succeeded':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'failed':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'partial':
    case 'yielded':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'running':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
});

const taskStateLabel: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  partial: '部分完成',
  yielded: '已让出',
  failed: '失败',
};

const selectedCount = computed(() => admin.selectedDbnums.value.size);
const executeSummary = computed(() => {
  const receipt = admin.lastReceipt.value;
  if (!receipt) return null;
  const parts: string[] = [];
  const enqueued = (receipt.enqueued ?? []).length;
  const merged = (receipt.merged ?? []).length;
  if (enqueued > 0) parts.push(`入队 ${enqueued}`);
  if (merged > 0) parts.push(`并入 ${merged}`);
  if ((receipt.already_covered ?? []).length > 0) parts.push(`已覆盖 ${receipt.already_covered!.length}`);
  if ((receipt.up_to_date ?? 0) > 0) parts.push(`最新 ${receipt.up_to_date}`);
  if ((receipt.blocked ?? []).length > 0) parts.push(`阻断 ${receipt.blocked!.length}`);
  if (parts.length > 0) return parts.join(' · ');
  // 读透 / kv-mem 回执：没有批次任务，按模型水位追平文件水位判完成（下方刷新跟踪卡）
  if (receipt.status === 'model_refresh_queued') return '已排队模型刷新（无批次任务，按水位自动跟踪）';
  if (typeof receipt.status === 'string' && receipt.status) return `回执：${receipt.status}`;
  return '没有可入队的批次';
});

const watchStateBadgeClass: Record<DbnumRefreshWatch['state'], string> = {
  watching: 'bg-blue-50 text-blue-700 border-blue-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  timeout: 'bg-amber-50 text-amber-700 border-amber-200',
};

const watchStateLabel: Record<DbnumRefreshWatch['state'], string> = {
  watching: '刷新中',
  done: '已刷新',
  timeout: '超时未确认',
};

function statusBadgeTitle(row: DbnumRow): string {
  const lag = dbnumLagReason(row);
  if (lag === 'data') return '数据水位滞后于文件（待摄入）';
  if (lag === 'model') return '模型水位滞后于已应用数据（待生成）';
  return '';
}

const allSitesPicked = computed(
  () =>
    admin.sitePickerRows.value.length > 0 &&
    admin.sitePickerSelected.value.size === admin.sitePickerRows.value.length,
);

function watermarkText(row: DbnumRow): string {
  return `${row.applied_sesno ?? 0}/${row.model_sesno ?? 0}/${row.file_latest_sesno ?? 0}`;
}

function dbnumOptionLabel(row: DbnumRow): string {
  return `${row.dbnum} · ${row.db_type || '—'} · ${DBNUM_STATUS_LABEL[dbnumPanelStatus(row)]}`;
}

function targetStatusLabel(target: ModelGenTarget): string {
  switch (target.status) {
    case 'running':
      return `生成中 ${target.rootsDone}/${Math.max(1, target.rootsTotal)}`;
    case 'done':
      return target.instanceCount != null ? `${target.instanceCount} 实例` : '完成';
    case 'pending':
      return '后台生成中';
    case 'failed':
      return '失败';
    default:
      return '待生成';
  }
}

function targetStatusClass(target: ModelGenTarget): string {
  switch (target.status) {
    case 'running':
      return 'text-blue-600';
    case 'done':
      return 'text-emerald-600';
    case 'pending':
      return 'text-amber-600';
    case 'failed':
      return 'text-red-600';
    default:
      return 'text-gray-400';
  }
}

async function addInputTarget() {
  const value = admin.nodeInput.value;
  const added = await admin.addTargetByRefno(value);
  if (added) admin.nodeInput.value = '';
}

function addSelectedTargets() {
  const refnos = selectionStore.selectedRefnos.value.length > 0
    ? selectionStore.selectedRefnos.value
    : [getGlobalSelectedRefno()].filter((r): r is string => !!r);
  if (refnos.length === 0) {
    admin.nodeError.value = '查看器当前没有选中构件';
    return;
  }
  for (const refno of refnos) void admin.addTargetByRefno(refno);
}

function onSiteDbnumChange(event: Event) {
  const raw = (event.target as HTMLSelectElement).value;
  const dbnum = Number(raw);
  if (Number.isFinite(dbnum)) void admin.loadSitePickerSites(dbnum);
}

function onToggleAllSites(event: Event) {
  admin.setAllSitePicks((event.target as HTMLInputElement).checked);
}

function refreshSitePicker() {
  const dbnum = admin.sitePickerDbnum.value;
  if (dbnum != null) void admin.loadSitePickerSites(dbnum, { force: true });
}

function stageChipClass(task: AdminTaskView, index: number): string {
  if (task.state === 'succeeded' || task.state === 'partial') {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (index < task.stageIndex) return 'bg-emerald-100 text-emerald-700';
  if (index === task.stageIndex) return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-400';
}

function taskProgressPercent(task: AdminTaskView): number {
  if (task.unitsDone == null || task.totalUnits == null || task.totalUnits <= 0) return 0;
  return Math.min(100, Math.round((task.unitsDone / task.totalUnits) * 100));
}

watch(
  () => props.open,
  (open) => {
    if (open && admin.dbRows.value.length === 0 && !admin.dbLoading.value) {
      void admin.refreshDbnums();
    }
  },
);
</script>

<template>
  <Dialog :open="open"
    panel-class="max-w-[560px]"
    body-class="max-h-[70vh] overflow-y-auto px-4 py-4"
    @update:open="emit('update:open', $event)">
    <template #title>
      <div class="min-w-0">
        <div class="font-ui text-sm font-semibold text-gray-900">模型生成</div>
        <div class="mt-0.5 text-[11px] font-normal text-gray-500">按节点 / SITE 重新生成，或按库初始化更新</div>
      </div>
    </template>

    <div class="flex flex-col gap-3" data-testid="model-generation-dialog">
      <div class="flex rounded-md bg-gray-100 p-1">
        <button type="button"
          class="flex-1 rounded py-1.5 text-xs font-medium transition-colors"
          :class="admin.mode.value === 'node' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          data-testid="model-generation-tab-node"
          @click="admin.mode.value = 'node'">
          按节点 / SITE
        </button>
        <button type="button"
          class="flex-1 rounded py-1.5 text-xs font-medium transition-colors"
          :class="admin.mode.value === 'dbnum' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
          data-testid="model-generation-tab-dbnum"
          @click="admin.mode.value = 'dbnum'">
          按库
        </button>
      </div>

      <!-- ================= 按节点 / SITE ================= -->
      <template v-if="admin.mode.value === 'node'">
        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">生成目标</div>
          <div class="mt-2 flex gap-1.5">
            <input v-model="admin.nodeInput.value" type="text" placeholder="refno，如 24381_145018"
              class="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 font-mono text-xs text-gray-800 placeholder:text-gray-400 focus:border-brand focus:outline-none"
              data-testid="model-generation-refno-input"
              @keydown.enter.prevent="addInputTarget" />
            <button type="button"
              class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              title="加入输入的 refno"
              data-testid="model-generation-add-refno"
              @click="addInputTarget">
              <Plus class="h-3.5 w-3.5" />
            </button>
          </div>
          <button type="button"
            class="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            data-testid="model-generation-use-selection"
            @click="addSelectedTargets">
            <MousePointerClick class="h-3.5 w-3.5" />
            使用当前选中（可多选）
          </button>
          <p v-if="admin.nodeError.value" class="mt-2 text-[11px] text-red-600" data-testid="model-generation-node-error">
            {{ admin.nodeError.value }}
          </p>
        </section>

        <!-- 按库选 SITE：dbnum → tree/roots 列 SITE → 勾选入目标队列 -->
        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">按库选 SITE</div>
            <label v-if="admin.sitePickerRows.value.length > 0"
              class="inline-flex items-center gap-1 text-[11px] text-gray-500">
              <input type="checkbox" class="h-3 w-3 rounded border-gray-300"
                :checked="allSitesPicked"
                data-testid="model-generation-site-select-all"
                @change="onToggleAllSites" />
              全选
            </label>
          </div>
          <div class="mt-2 flex gap-1.5">
            <select class="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 font-mono text-xs text-gray-800 focus:border-brand focus:outline-none disabled:text-gray-400"
              :value="admin.sitePickerDbnum.value ?? ''"
              :disabled="admin.dbLoading.value"
              data-testid="model-generation-site-dbnum"
              @change="onSiteDbnumChange">
              <option value="" disabled>{{ admin.dbLoading.value ? '加载库列表…' : '选择库…' }}</option>
              <option v-for="row in admin.dbList.value" :key="row.dbnum" :value="row.dbnum">
                {{ dbnumOptionLabel(row) }}
              </option>
            </select>
            <button type="button"
              class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              title="重新加载该库 SITE 清单"
              :disabled="admin.sitePickerDbnum.value == null || admin.sitePickerLoading.value"
              data-testid="model-generation-site-refresh"
              @click="refreshSitePicker">
              <RefreshCw class="h-3.5 w-3.5" :class="admin.sitePickerLoading.value ? 'animate-spin' : ''" />
            </button>
          </div>
          <p v-if="admin.sitePickerError.value" class="mt-2 text-[11px] text-red-600"
            data-testid="model-generation-site-error">
            {{ admin.sitePickerError.value }}
          </p>
          <div v-else-if="admin.sitePickerDbnum.value != null"
            class="mt-2 overflow-hidden rounded-md border border-gray-100 bg-white">
            <div class="max-h-44 overflow-y-auto">
              <ul class="divide-y divide-gray-100">
                <li v-for="site in admin.sitePickerRows.value" :key="site.refno"
                  class="flex items-center gap-2 px-2 py-1.5"
                  :class="admin.sitePickerSelected.value.has(site.refno) ? 'bg-brand-subtle/40' : ''">
                  <input type="checkbox" class="h-3 w-3 shrink-0 rounded border-gray-300"
                    :checked="admin.sitePickerSelected.value.has(site.refno)"
                    :data-testid="`model-generation-site-${site.refno}`"
                    @change="admin.toggleSitePick(site.refno)" />
                  <span class="shrink-0 rounded border border-blue-200 bg-blue-50 px-1 py-0.5 font-mono text-[10px] font-semibold text-blue-700">
                    SITE
                  </span>
                  <span class="min-w-0 flex-1 truncate text-xs text-gray-800" :title="site.refno">
                    {{ site.name }}
                  </span>
                  <span class="shrink-0 font-mono text-[10px] text-gray-400">{{ site.refno }}</span>
                </li>
              </ul>
              <div v-if="admin.sitePickerRows.value.length === 0 && !admin.sitePickerLoading.value"
                class="px-2 py-4 text-center text-[11px] text-gray-400">
                该库下没有 SITE
              </div>
              <div v-if="admin.sitePickerLoading.value"
                class="flex items-center justify-center gap-1.5 px-2 py-4 text-[11px] text-gray-400">
                <Loader2 class="h-3.5 w-3.5 animate-spin" />
                加载 SITE 清单…
              </div>
            </div>
            <div class="border-t border-gray-100 px-2 py-1.5">
              <button type="button"
                class="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-brand/30 bg-brand-subtle/60 px-2 py-1.5 text-xs font-medium text-brand hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="admin.sitePickerCount.value === 0 || admin.sitePickerBusy.value"
                data-testid="model-generation-site-add"
                @click="admin.addPickedSites">
                <Plus class="h-3.5 w-3.5" />
                加入目标（{{ admin.sitePickerCount.value }}）
              </button>
            </div>
          </div>
        </section>

        <section v-if="admin.targets.value.length > 0" class="rounded-lg border border-gray-100 bg-white p-2.5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
              目标 {{ admin.targets.value.length }} 个
            </div>
            <button type="button" class="text-[11px] text-gray-400 hover:text-gray-600"
              data-testid="model-generation-clear-targets"
              @click="admin.clearTargets">
              清空
            </button>
          </div>
          <ul class="mt-2 flex flex-col gap-1.5">
            <li v-for="target in admin.targets.value" :key="target.refno"
              class="rounded-md border border-gray-100 bg-gray-50/60 px-2 py-1.5">
              <div class="flex items-center gap-1.5">
                <span v-if="target.noun"
                  class="shrink-0 rounded border border-blue-200 bg-blue-50 px-1 py-0.5 font-mono text-[10px] font-semibold text-blue-700">
                  {{ target.noun }}
                </span>
                <span class="min-w-0 flex-1 truncate font-mono text-xs text-gray-800" :title="target.refno">
                  {{ target.name || target.refno }}
                </span>
                <span class="shrink-0 text-[10px]" :class="targetStatusClass(target)">
                  {{ targetStatusLabel(target) }}
                </span>
                <button type="button" class="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                  :disabled="target.status === 'running'"
                  @click="admin.removeTarget(target.refno)">
                  <X class="h-3 w-3" />
                </button>
              </div>
              <div class="mt-0.5 truncate font-mono text-[10px] text-gray-400">{{ target.refno }}</div>
              <div v-if="target.status === 'running'" class="mt-1.5 h-1 overflow-hidden rounded bg-gray-200">
                <div class="h-full rounded bg-blue-500 transition-[width]"
                  :style="{ width: `${Math.round((target.rootsDone / Math.max(1, target.rootsTotal)) * 100)}%` }" />
              </div>
              <p v-if="target.detail" class="mt-1 text-[10px] leading-relaxed text-gray-500">{{ target.detail }}</p>
            </li>
          </ul>
          <button type="button"
            class="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="admin.generateBusy.value || admin.targets.value.every((t) => t.status === 'running')"
            data-testid="model-generation-run"
            @click="admin.generateTargets">
            <Loader2 v-if="admin.generateBusy.value" class="h-3.5 w-3.5 animate-spin" />
            <Play v-else class="h-3.5 w-3.5" />
            {{ admin.generateBusy.value ? '生成中…' : '重新生成选中目标' }}
          </button>
          <p class="mt-1.5 text-[10px] leading-relaxed text-gray-400">
            SITE / ZONE 会按契约逐层展开到生成根；生成完成后在三维里点眼睛加载。
          </p>
        </section>
      </template>

      <!-- ================= 按库 ================= -->
      <template v-else>
        <section class="rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">数据库</div>
            <button type="button"
              class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              :disabled="admin.dbLoading.value"
              data-testid="model-generation-refresh-dbnums"
              @click="admin.refreshDbnums">
              <RefreshCw class="h-3 w-3" :class="admin.dbLoading.value ? 'animate-spin' : ''" />
              刷新
            </button>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <label class="inline-flex items-center gap-1 text-[11px] text-gray-600">
              <input v-model="admin.onlyUnfinished.value" type="checkbox" class="h-3 w-3 rounded border-gray-300"
                data-testid="model-generation-only-unfinished" />
              只看未完成
            </label>
            <button type="button" class="text-[11px] text-brand hover:underline"
              data-testid="model-generation-select-awaiting"
              @click="admin.selectAllAwaiting">
              全选待初始化（{{ admin.awaitingDbnums.value.length }}）
            </button>
            <button v-if="selectedCount > 0" type="button" class="text-[11px] text-gray-400 hover:text-gray-600"
              @click="admin.clearDbSelection">
              清空选择
            </button>
          </div>
        </section>

        <div v-if="admin.combinedWarnings.value.length > 0"
          class="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800"
          data-testid="model-generation-warnings">
          <div class="flex items-center gap-1 font-medium">
            <AlertTriangle class="h-3.5 w-3.5" />
            服务端告警
          </div>
          <ul class="mt-1 list-inside list-disc">
            <li v-for="(warning, index) in admin.combinedWarnings.value" :key="index">{{ warning }}</li>
          </ul>
        </div>

        <div v-if="admin.dbError.value" class="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700"
          data-testid="model-generation-db-error">
          {{ admin.dbError.value }}
        </div>

        <section class="overflow-hidden rounded-lg border border-gray-100">
          <div class="max-h-64 overflow-y-auto">
            <table class="w-full text-left text-[11px]">
              <thead class="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th class="w-6 px-1.5 py-1.5" />
                  <th class="px-1.5 py-1.5 font-medium">库</th>
                  <th class="px-1.5 py-1.5 font-medium">类型</th>
                  <th class="px-1.5 py-1.5 font-medium" title="应用 / 模型 / 文件">水位 A/M/F</th>
                  <th class="px-1.5 py-1.5 font-medium">状态</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="row in admin.filteredDbRows.value" :key="row.dbnum"
                  class="hover:bg-gray-50"
                  :class="admin.selectedDbnums.value.has(row.dbnum) ? 'bg-brand-subtle/40' : ''">
                  <td class="px-1.5 py-1.5">
                    <input type="checkbox" class="h-3 w-3 rounded border-gray-300"
                      :checked="admin.selectedDbnums.value.has(row.dbnum)"
                      :data-testid="`model-generation-db-${row.dbnum}`"
                      @change="admin.toggleDbnum(row.dbnum)" />
                  </td>
                  <td class="px-1.5 py-1.5 font-mono font-medium text-gray-800">{{ row.dbnum }}</td>
                  <td class="px-1.5 py-1.5">
                    <span class="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[10px] text-gray-600">
                      {{ row.db_type || '—' }}
                    </span>
                  </td>
                  <td class="px-1.5 py-1.5 font-mono text-gray-500">{{ watermarkText(row) }}</td>
                  <td class="px-1.5 py-1.5">
                    <span class="inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px]"
                      :class="statusBadgeClass[dbnumPanelStatus(row)]"
                      :title="statusBadgeTitle(row)">
                      {{ DBNUM_STATUS_LABEL[dbnumPanelStatus(row)] }}
                    </span>
                  </td>
                </tr>
                <tr v-if="admin.filteredDbRows.value.length === 0 && !admin.dbLoading.value">
                  <td colspan="5" class="px-2 py-4 text-center text-gray-400">
                    {{ admin.dbRows.value.length === 0 ? '尚未加载库列表' : '没有符合过滤条件的库' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="border-t border-gray-100 px-2.5 py-2">
            <button type="button"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="admin.executeBusy.value || selectedCount === 0"
              data-testid="model-generation-execute"
              @click="admin.executeSelected">
              <Loader2 v-if="admin.executeBusy.value" class="h-3.5 w-3.5 animate-spin" />
              <Play v-else class="h-3.5 w-3.5" />
              {{ admin.executeBusy.value ? '执行中…' : `初始化 / 更新所选（${selectedCount}）` }}
            </button>
            <p v-if="admin.executeError.value" class="mt-1.5 text-[11px] text-red-600"
              data-testid="model-generation-execute-error">
              {{ admin.executeError.value }}
            </p>
            <p v-else-if="executeSummary" class="mt-1.5 text-[11px] text-gray-500" data-testid="model-generation-execute-summary">
              上次执行：{{ executeSummary }}
            </p>
            <p class="mt-1 text-[10px] leading-relaxed text-gray-400">
              走完整摄入管线：数据 → 生成 → 发布 → 空间树 → 房间归属。监听范围（watch_dbnums）外的库会被服务端跳过并回告警。
            </p>
          </div>
        </section>

        <!-- 刷新跟踪：读透形态 update/execute 无 task_id，按模型水位追平文件水位判完成 -->
        <section v-if="admin.refreshWatchList.value.length > 0" class="flex flex-col gap-1.5">
          <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">刷新跟踪</div>
          <div v-for="entry in admin.refreshWatchList.value" :key="entry.dbnum"
            class="rounded-lg border border-gray-100 bg-white p-2.5"
            :data-testid="`model-generation-watch-${entry.dbnum}`">
            <div class="flex items-center gap-1.5">
              <CheckCircle2 v-if="entry.state === 'done'" class="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <AlertTriangle v-else-if="entry.state === 'timeout'" class="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <Loader2 v-else class="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />
              <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700">库 {{ entry.dbnum }}</span>
              <span class="shrink-0 rounded border px-1 py-0.5 text-[10px]" :class="watchStateBadgeClass[entry.state]">
                {{ watchStateLabel[entry.state] }}
              </span>
            </div>
            <div class="mt-1 font-mono text-[10px] text-gray-400">
              模型水位 {{ entry.modelSesno }}/{{ entry.targetSesno > 0 ? entry.targetSesno : '?' }}
            </div>
          </div>
        </section>

        <!-- 任务卡：只跟踪本会话发起的 task_id -->
        <section v-if="admin.taskList.value.length > 0" class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
              任务 {{ admin.taskList.value.length }}
              <Loader2 v-if="admin.taskPollBusy.value" class="ml-1 inline h-3 w-3 animate-spin text-gray-400" />
            </div>
          </div>
          <div v-for="task in admin.taskList.value" :key="task.taskId"
            class="rounded-lg border border-gray-100 bg-white p-2.5"
            :data-testid="`model-generation-task-${task.taskId}`">
            <div class="flex items-center gap-1.5">
              <CheckCircle2 v-if="task.state === 'succeeded'" class="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <AlertTriangle v-else-if="task.state === 'failed' || task.state === 'partial'" class="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <Loader2 v-else class="h-3.5 w-3.5 shrink-0 animate-spin text-blue-600" />
              <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700" :title="task.taskId">
                {{ task.dbnum != null ? `库 ${task.dbnum}` : task.taskId }}
              </span>
              <span class="shrink-0 rounded border px-1 py-0.5 text-[10px]" :class="taskStateBadgeClass(task.state)">
                {{ taskStateLabel[task.state] ?? task.state }}
              </span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              <span v-for="(stage, index) in task.stages" :key="stage"
                class="rounded px-1 py-0.5 text-[9px]"
                :class="stageChipClass(task, index)">
                {{ PIPELINE_STAGE_LABEL[stage] ?? stage }}
              </span>
            </div>
            <div v-if="task.totalUnits != null && task.totalUnits > 0" class="mt-1.5">
              <div class="h-1 overflow-hidden rounded bg-gray-200">
                <div class="h-full rounded bg-blue-500 transition-[width]" :style="{ width: `${taskProgressPercent(task)}%` }" />
              </div>
              <div class="mt-0.5 flex justify-between font-mono text-[10px] text-gray-400">
                <span>{{ task.currentStage ?? '—' }}</span>
                <span>{{ task.unitsDone ?? 0 }}/{{ task.totalUnits }}</span>
              </div>
            </div>
            <div v-else class="mt-1 font-mono text-[10px] text-gray-400">
              {{ task.currentStage ?? task.taskId }}
            </div>
          </div>
        </section>
      </template>
    </div>
  </Dialog>
</template>
