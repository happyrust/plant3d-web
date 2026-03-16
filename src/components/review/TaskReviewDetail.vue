<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  Calendar,
  CheckCircle2,
  Clock3,
  FileText,
  GitBranch,
  Info,
  Package,
  Paperclip,
  RefreshCw,
  User,
  XCircle,
} from 'lucide-vue-next';

import type { ReviewTask, WorkflowNode, WorkflowStep } from '@/types/auth';

import { reviewTaskGetWorkflow } from '@/api/reviewApi';
import Dialog from '@/components/ui/Dialog.vue';
import {
  WORKFLOW_NODE_NAMES,
  getPriorityDisplayName,
  getTaskStatusDisplayName,
} from '@/types/auth';

const props = defineProps<{
  task: ReviewTask;
}>();

const emit = defineEmits<{
  close: [];
}>();

const isLoadingHistory = ref(false);
const workflowHistory = ref<WorkflowStep[]>([]);
const workflowError = ref<string | null>(null);

const open = computed({
  get: () => true,
  set: (value: boolean) => {
    if (!value) emit('close');
  },
});

const taskStatus = computed(() => getTaskStatusDisplayName(props.task.status));
const priorityDisplay = computed(() => getPriorityDisplayName(props.task.priority));
const componentCount = computed(() => props.task.components.length);
const attachmentCount = computed(() => props.task.attachments?.length ?? 0);
const latestReturnStep = computed<WorkflowStep | null>(() => {
  const latestFromHistory = [...workflowHistory.value]
    .reverse()
    .find((step) => step.action === 'return');

  if (latestFromHistory) return latestFromHistory;

  if (!props.task.returnReason) return null;

  return {
    node: props.task.currentNode ?? 'sj',
    action: 'return',
    operatorId: '',
    operatorName: props.task.approverName || props.task.checkerName || props.task.reviewerName || '系统',
    comment: props.task.returnReason,
    timestamp: props.task.updatedAt,
  };
});

const detailRows = computed(() => [
  {
    label: '模型名称',
    value: props.task.modelName || '未提供',
    icon: Package,
  },
  {
    label: '发起人',
    value: props.task.requesterName || '-',
    icon: User,
  },
  {
    label: '校核人',
    value: props.task.checkerName || props.task.reviewerName || '-',
    icon: User,
  },
  {
    label: '审核人',
    value: props.task.approverName || '-',
    icon: User,
  },
  {
    label: '当前节点',
    value: formatWorkflowNode(props.task.currentNode),
    icon: GitBranch,
  },
  {
    label: '创建时间',
    value: formatDateTime(props.task.createdAt),
    icon: Calendar,
  },
  {
    label: '更新时间',
    value: formatDateTime(props.task.updatedAt),
    icon: Clock3,
  },
  {
    label: '截止时间',
    value: props.task.dueDate ? formatDateTime(props.task.dueDate) : '未设置',
    icon: Calendar,
  },
]);

const taskSummary = computed(() => `${componentCount.value} 个构件 · ${attachmentCount.value} 个附件`);

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function formatWorkflowNode(node?: WorkflowNode): string {
  if (!node) return '未开始';
  return WORKFLOW_NODE_NAMES[node] || node;
}

function getHistoryActionLabel(action: WorkflowStep['action'] | string): string {
  switch (action) {
    case 'submit':
      return '提交';
    case 'return':
      return '驳回';
    case 'approve':
      return '批准';
    case 'reject':
      return '拒绝';
    default:
      return action;
  }
}

function getHistoryActionClass(action: WorkflowStep['action'] | string): string {
  switch (action) {
    case 'submit':
      return 'bg-blue-100 text-blue-700';
    case 'return':
      return 'bg-rose-100 text-rose-700';
    case 'approve':
      return 'bg-emerald-100 text-emerald-700';
    case 'reject':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function getHistoryMarkerClass(action: WorkflowStep['action'] | string): string {
  switch (action) {
    case 'submit':
      return 'border-blue-500 bg-blue-100';
    case 'return':
      return 'border-rose-500 bg-rose-100';
    case 'approve':
      return 'border-emerald-500 bg-emerald-100';
    case 'reject':
      return 'border-amber-500 bg-amber-100';
    default:
      return 'border-slate-300 bg-slate-100';
  }
}

async function loadWorkflowHistory() {
  isLoadingHistory.value = true;
  workflowError.value = null;
  try {
    const response = await reviewTaskGetWorkflow(props.task.id);
    if (!response.success) {
      throw new Error(response.error_message || '加载工作流历史失败');
    }
    workflowHistory.value = response.history || [];
  } catch (error) {
    workflowHistory.value = props.task.workflowHistory || [];
    workflowError.value = error instanceof Error ? error.message : '加载工作流历史失败';
  } finally {
    isLoadingHistory.value = false;
  }
}

watch(
  () => props.task.id,
  () => {
    workflowHistory.value = [];
    void loadWorkflowHistory();
  }
);

onMounted(() => {
  void loadWorkflowHistory();
});
</script>

<template>
  <Dialog v-model:open="open"
    title="任务详情"
    panel-class="max-w-[64rem]"
    body-class="space-y-6 max-h-[78vh] overflow-y-auto px-6 py-5"
    @close="emit('close')">
    <template #title="{ titleId }">
      <div class="flex min-w-0 items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Task detail</p>
          <h2 :id="titleId" class="mt-2 truncate text-xl font-semibold text-slate-900">{{ task.title }}</h2>
          <p class="mt-2 text-sm text-slate-500">{{ taskSummary }}</p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span :class="['inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', taskStatus.color]">
            {{ taskStatus.label }}
          </span>
          <span :class="['inline-flex items-center rounded-full px-3 py-1 text-xs font-medium', priorityDisplay.color]">
            {{ priorityDisplay.label }}
          </span>
        </div>
      </div>
    </template>

    <div v-if="props.task.status === 'rejected' || latestReturnStep" class="rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <div class="flex items-start gap-3">
        <XCircle class="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        <div class="space-y-2 text-sm text-rose-900">
          <p class="font-semibold">退回信息</p>
          <p>
            <span class="font-medium text-rose-700">退回节点：</span>
            {{ formatWorkflowNode(latestReturnStep?.node || props.task.currentNode) }}
          </p>
          <p>
            <span class="font-medium text-rose-700">退回原因：</span>
            {{ latestReturnStep?.comment || props.task.returnReason || props.task.reviewComment || '未填写' }}
          </p>
        </div>
      </div>
    </div>

    <section class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div class="space-y-6">
        <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <div class="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Info class="h-4 w-4 text-slate-500" />
            完整任务信息
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div v-for="row in detailRows" :key="row.label" class="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
              <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                <component :is="row.icon" class="h-3.5 w-3.5" />
                <span>{{ row.label }}</span>
              </div>
              <p class="mt-2 break-words text-sm font-medium text-slate-800">{{ row.value }}</p>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileText class="h-4 w-4 text-slate-500" />
            描述
          </div>
          <p class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{{ task.description || '暂无描述' }}</p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Package class="h-4 w-4 text-slate-500" />
            构件列表
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{{ componentCount }}</span>
          </div>
          <div v-if="task.components.length" class="space-y-2">
            <div v-for="component in task.components"
              :key="component.id"
              class="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span class="font-medium text-slate-900">{{ component.name }}</span>
              <span class="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{{ component.refNo }}</span>
              <span v-if="component.type" class="text-xs text-slate-400">{{ component.type }}</span>
            </div>
          </div>
          <p v-else class="text-sm text-slate-500">暂无构件信息</p>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Paperclip class="h-4 w-4 text-slate-500" />
            附件
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{{ attachmentCount }}</span>
          </div>
          <div v-if="task.attachments?.length" class="space-y-2">
            <div v-for="attachment in task.attachments"
              :key="attachment.id"
              class="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-slate-900">{{ attachment.name }}</p>
                <p class="text-xs text-slate-500">{{ attachment.mimeType || attachment.type || '未知类型' }}</p>
              </div>
              <span class="shrink-0 text-xs text-slate-400">{{ formatDateTime(attachment.uploadedAt) }}</span>
            </div>
          </div>
          <p v-else class="text-sm text-slate-500">暂无附件</p>
        </div>
      </div>

      <div class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <GitBranch class="h-4 w-4 text-slate-500" />
            工作流历史时间线
          </div>
          <button type="button"
            class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            :disabled="isLoadingHistory"
            @click="loadWorkflowHistory">
            <RefreshCw :class="['h-4 w-4', isLoadingHistory && 'animate-spin']" />
            刷新
          </button>
        </div>

        <div v-if="workflowError" class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {{ workflowError }}
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div v-if="isLoadingHistory" class="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <RefreshCw class="h-4 w-4 animate-spin" />
            <span>正在加载工作流历史...</span>
          </div>
          <div v-else-if="workflowHistory.length === 0" class="py-10 text-center text-sm text-slate-500">
            暂无工作流历史记录
          </div>
          <ol v-else class="relative space-y-4 before:absolute before:bottom-2 before:left-[0.55rem] before:top-2 before:w-px before:bg-slate-200">
            <li v-for="(step, index) in workflowHistory"
              :key="`${step.action}-${step.timestamp}-${index}`"
              class="relative pl-8">
              <span class="absolute left-0 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border-2"
                :class="getHistoryMarkerClass(step.action)" />
              <div class="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span :class="['inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', getHistoryActionClass(step.action)]">
                      {{ getHistoryActionLabel(step.action) }}
                    </span>
                    <span class="text-sm font-medium text-slate-900">{{ formatWorkflowNode(step.node) }}</span>
                  </div>
                  <span class="text-xs text-slate-400">{{ formatDateTime(step.timestamp) }}</span>
                </div>
                <p class="mt-2 text-sm text-slate-700">操作人：{{ step.operatorName || step.operatorId || '系统' }}</p>
                <p v-if="step.comment" class="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-600">备注：{{ step.comment }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>
  </Dialog>
</template>
