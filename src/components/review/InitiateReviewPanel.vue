<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch, type WatchStopHandle } from 'vue';

import { Box, Calendar, CheckCircle, ChevronDown, Flag, HelpCircle, Link, Paperclip, Plus, Send, UploadCloud, User, X } from 'lucide-vue-next';

import AssociatedFilesList from './AssociatedFilesList.vue';
import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';
import { isReviewDebugUiEnabled } from './debugUiGate';
import {
  EMBED_LANDING_STATE_STORAGE_KEY,
  EMBED_LANDING_STATE_UPDATED_EVENT,
  EMBED_MODE_PARAMS_STORAGE_KEY,
  type EmbedLandingState,
} from './embedRoleLanding';
import ExternalReviewViewer from './ExternalReviewViewer.vue';
import FileUploadSection from './FileUploadSection.vue';
import { buildReviewAttachments } from './reviewAttachmentFlow';
import { resolvePassiveWorkflowMode } from './workflowMode';

import type { UploadedFile } from './FileUploadSection.vue';
import type { ReviewComponent } from '@/types/auth';

import { pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useOnboardingGuide } from '@/composables/useOnboardingGuide';
import {
  normalizeReviewDeliveryRefno,
  resolveReviewDeliveryUnitRefno,
  type ReviewDeliveryTypeInfo,
} from '@/composables/useReviewDeliveryUnit';
import { useReviewStore } from '@/composables/useReviewStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { useUserStore } from '@/composables/useUserStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { getRoleDisplayName } from '@/types/auth';

const emit = defineEmits<{
  (e: 'created', taskId: string): void;
  (e: 'close'): void;
}>();

const userStore = useUserStore();
const reviewStore = useReviewStore();
const toolStore = useToolStore();
const viewerContext = useViewerContext();
const selectionStore = useSelectionStore();
const onboarding = useOnboardingGuide();

// 确认记录场景恢复：设计端重开退回任务时，回放审核侧已确认的批注/测量
const confirmedRecordsRestorer = createConfirmedRecordsRestorer({
  currentTaskId: () => reviewStore.currentTask.value?.id ?? null,
  confirmedRecords: () => reviewStore.sortedConfirmedRecords.value,
  toolStore,
  waitForViewerReady,
  getViewerTools: () => viewerContext.tools.value ?? null,
  skipClearOnEmpty: true,
});

const formData = reactive({
  packageName: '',
  description: '',
  checkerId: '',
  approverId: '',
  priority: 'medium' as 'low' | 'medium' | 'high',
  dueDate: '',
});
const selectedComponents = ref<ReviewComponent[]>([]);
const selectedComponentRefno = ref<string | null>(null);
const addingComponent = ref(false);

function normalizeComponentRefno(rawRefno?: string | null): string {
  const raw = String(rawRefno ?? '').trim();
  if (!raw) return '';
  const wrapped = raw.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? raw;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '').trim();
  return core.replace(/\//g, '_').replace(/,/g, '_');
}

function toSlashComponentRefno(refno: string): string {
  const normalized = normalizeComponentRefno(refno);
  const matched = normalized.match(/^(\d+)_(\d+)$/);
  if (matched) return `${matched[1]}/${matched[2]}`;
  return normalized;
}

function isComponentSelected(rawRefno?: string | null): boolean {
  const normalized = normalizeComponentRefno(rawRefno);
  return !!normalized && normalized === selectedComponentRefno.value;
}

async function handleComponentSelect(rawRefno?: string | null): Promise<void> {
  const normalized = normalizeComponentRefno(rawRefno);
  if (!normalized) return;

  if (selectedComponentRefno.value === normalized) {
    selectedComponentRefno.value = null;
    return;
  }

  selectedComponentRefno.value = normalized;
  ensurePanelAndActivate('modelTree');
  selectionStore.setSelectedRefno(normalized);

  const slashRefno = toSlashComponentRefno(normalized);
  const result = await showModelByRefnosWithAck({
    refnos: [slashRefno],
    flyTo: true,
    timeoutMs: 15_000,
  });

  window.dispatchEvent(new CustomEvent('autoLocateRefno', {
    detail: { refno: slashRefno },
  }));

  if (result.error && result.ok.length === 0) {
    notification.value = {
      type: 'error',
      message: '构件定位失败',
      details: result.error,
    };
  }
}
function extractTypeInfoFromSelection(refno: string): ReviewDeliveryTypeInfo {
  const attrs = selectionStore.propertiesData.value;
  if (!attrs) return {};
  const normalizedRefno = normalizeReviewDeliveryRefno(refno);
  const ownerRefno = normalizeReviewDeliveryRefno(
    (attrs.OWNER_REFNO || attrs.OWNERREFNO || attrs.owner_refno || attrs.OWNER) as string | null | undefined,
  );
  return {
    noun: (attrs.NOUN || attrs.noun) as string | null | undefined,
    owner_noun: (attrs.OWNER_NOUN || attrs.owner_noun) as string | null | undefined,
    owner_refno: ownerRefno && ownerRefno !== normalizedRefno ? ownerRefno : null,
  };
}

function buildStableComponentId(refNo: string): string {
  return `comp-${refNo}`;
}

function buildReviewComponent(params: {
  refNo: string;
  name: string;
  type?: string;
}): ReviewComponent {
  return {
    id: buildStableComponentId(params.refNo),
    refNo: params.refNo,
    name: params.name.trim() || params.refNo,
    type: params.type || '构件',
  };
}

function ensureComponentSelected(refNo: string, name?: string, type = 'BRAN') {
  if (selectedComponents.value.some((c) => c.refNo === refNo)) return;
  selectedComponents.value.push(buildReviewComponent({
    refNo,
    name: name || `BRAN/${refNo}`,
    type,
  }));
}

function inferProjectIdFromComponentName(name?: string): string | null {
  const parts = name?.split('/') ?? [];
  const project = parts.length > 1 ? parts[1]?.trim() : '';
  return project || null;
}

function resolveProjectId() {
  if (embedModeParams.value.projectId?.trim()) {
    return embedModeParams.value.projectId.trim();
  }

  for (const component of selectedComponents.value) {
    const inferredProjectId = inferProjectIdFromComponentName(component.name);
    if (inferredProjectId) {
      return inferredProjectId;
    }
  }

  return 'demo-project';
}

async function addSelectedComponent() {
  const refno = selectionStore.selectedRefno.value;
  if (!refno) return;

  await addComponentByRefno(refno);
}

async function addComponentByRefno(refno: string) {
  const normalizedRefno = normalizeReviewDeliveryRefno(refno);
  if (!normalizedRefno) return;

  addingComponent.value = true;
  try {
    const deliveryUnitRefno = await resolveReviewDeliveryUnitRefno(normalizedRefno, {
      getFallbackTypeInfo: extractTypeInfoFromSelection,
    });
    if (selectedComponents.value.some((c) => c.refNo === deliveryUnitRefno)) return;

    const resp = await pdmsGetUiAttr(deliveryUnitRefno);
    const name =
      (resp.full_name && resp.full_name.trim()) ||
      (resp.attrs?.NAME as string) ||
      (resp.attrs?.DESCRIPTION as string) ||
      deliveryUnitRefno;
    const type = (resp.attrs?.NOUN as string) || '构件';
    selectedComponents.value.push(buildReviewComponent({
      refNo: deliveryUnitRefno,
      name: String(name),
      type,
    }));
  } catch (error) {
    notification.value = {
      type: 'error',
      message: '添加构件失败',
      details: error instanceof Error ? error.message : '无法归并为最小交付单元，请重试',
    };
  } finally {
    addingComponent.value = false;
  }
}

const uploadedFiles = ref<UploadedFile[]>([]);
const uploadSectionRef = ref<{
  startUpload: (lineage?: { taskId?: string | null; formId?: string | null }) => Promise<void>;
    } | null>(null);
const showExternalReview = ref(false);
const createdTaskId = ref<string | null>(null);
const createdTaskFormId = ref<string | null>(null);

const isSubmitting = ref(false);
const submitted = ref(false);
const lastCreatedTask = ref<{ id: string; title: string; checkerName: string; approverName: string; componentCount: number } | null>(null);
const notification = ref<{ type: 'success' | 'error' | null; message: string; details?: string }>({
  type: null,
  message: '',
  details: '',
});
// 嵌入模式参数
const embedModeParams = ref<{
  formId: string | null;
  userToken: string | null;
  userId: string | null;
  projectId: string | null;
  isEmbedMode: boolean;
}>({
  formId: null,
  userToken: null,
  userId: null,
  projectId: null,
  isEmbedMode: false,
});

const embedLandingState = ref<EmbedLandingState | null>(null);
const externalWorkflowMode = ref(true);
const hydratedRestoreTaskId = ref<string | null>(null);
const showDebugUi = isReviewDebugUiEnabled();

function toUploadedFilesFromAttachments(
  attachments?: {
    id: string;
    name: string;
    url: string;
    size?: number;
    type?: string;
    mimeType?: string;
    uploadedAt: number;
  }[],
): UploadedFile[] {
  return (attachments ?? []).map((attachment) => ({
    ...(attachment as UploadedFile),
    status: 'uploaded' as const,
    progress: 100,
  }));
}

function applyRestoredTaskDraft() {
  const draft = embedLandingState.value?.restoredTaskDraft;
  if (!draft) return;

  const draftKey = draft.taskId || draft.formId || null;
  if (!draftKey || hydratedRestoreTaskId.value === draftKey) return;

  formData.packageName = draft.title || '';
  formData.description = draft.description || '';
  formData.checkerId = draft.checkerId || '';
  formData.approverId = draft.approverId || '';
  formData.priority = draft.priority || 'medium';
  formData.dueDate = draft.dueDate || '';
  selectedComponents.value = [...draft.components];
  selectedComponentRefno.value = null;
  uploadedFiles.value = toUploadedFilesFromAttachments(draft.attachments);
  createdTaskId.value = draft.taskId || null;
  createdTaskFormId.value = draft.formId || null;
  hydratedRestoreTaskId.value = draftKey;
}

function syncEmbedModeStateFromStorage() {
  const storedParams = sessionStorage.getItem(EMBED_MODE_PARAMS_STORAGE_KEY);
  if (storedParams) {
    try {
      embedModeParams.value = JSON.parse(storedParams);
    } catch {
      console.warn('[InitiateReviewPanel] 无法解析嵌入模式参数');
    }
  }

  const storedLandingState = sessionStorage.getItem(EMBED_LANDING_STATE_STORAGE_KEY);
  if (storedLandingState) {
    try {
      embedLandingState.value = JSON.parse(storedLandingState);
      applyRestoredTaskDraft();
    } catch {
      console.warn('[InitiateReviewPanel] 无法解析嵌入模式落点状态');
    }
  }
}

function handleEmbedLandingStateUpdated() {
  syncEmbedModeStateFromStorage();
}

// 在组件挂载时读取嵌入模式参数
onMounted(() => {
  syncEmbedModeStateFromStorage();
  console.log('[InitiateReviewPanel] 嵌入模式参数:', embedModeParams.value);
  window.addEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, handleEmbedLandingStateUpdated);

  externalWorkflowMode.value = resolvePassiveWorkflowMode({
    embedParams: embedModeParams.value,
  });

  // E2E / CDP：在显式开启时暴露 window 钩子，便于无三维选区时注入一条模拟构件（不替代真实校审流程）
  let automationReviewEnabled = false;
  try {
    const q = new URLSearchParams(window.location.search);
    automationReviewEnabled =
      q.get('automation_review') === '1' || localStorage.getItem('plant3d_automation_review') === '1';
  } catch {
    automationReviewEnabled = false;
  }
  if (automationReviewEnabled) {
    const w = window as Window & {
      __plant3dInitiateReviewE2E?: { addMockComponent: (refNo?: string, name?: string) => Promise<void> };
    };
    w.__plant3dInitiateReviewE2E = {
      async addMockComponent(refNo, name) {
        const ref = refNo || `E2E-AUTO-${Date.now()}`;
        notification.value = { type: null, message: '', details: '' };
        try {
          await addComponentByRefno(ref);
        } catch {
          if (name) {
            ensureComponentSelected(normalizeReviewDeliveryRefno(ref), name);
          }
        }
      },
    };
  }

  // 当 reviewStore.currentTask 和确认记录变化时，自动恢复批注到场景
  confirmedRecordsStopWatch = watch(
    () => ({
      taskId: reviewStore.currentTask.value?.id ?? null,
      recordKeys: confirmedRecordsRestorer.currentTaskRecords.value
        .map((r) => `${r.id}:${r.confirmedAt}`).join('|'),
      viewerReady: !!viewerContext.viewerRef.value,
      toolsReady: !!viewerContext.tools.value,
    }),
    async () => {
      await confirmedRecordsRestorer.restoreConfirmedRecordsIntoScene();
    },
    { immediate: true },
  );
});

let confirmedRecordsStopWatch: WatchStopHandle | null = null;

onUnmounted(() => {
  window.removeEventListener(EMBED_LANDING_STATE_UPDATED_EVENT, handleEmbedLandingStateUpdated);
  confirmedRecordsStopWatch?.();
});

// 表单 ID：仅在嵌入模式展示/透传；正常模式由后端生成
const formId = computed(() => {
  return embedModeParams.value.isEmbedMode ? embedModeParams.value.formId : null;
});
const restoredTaskSummary = computed(() => embedLandingState.value?.restoredTaskSummary ?? null);

const activeUploadTaskId = computed(() => createdTaskId.value);
const activeUploadFormId = computed(() => formId.value || createdTaskFormId.value);
const canAutoUploadAttachments = computed(() => !!(activeUploadTaskId.value || activeUploadFormId.value));

const currentProjectId = computed<string>(() => {
  return resolveProjectId();
});

const selectedComponentSummary = computed(() => {
  return `已选中 ${selectedComponents.value.length} 个 BRAN 管道构件`;
});

const reviewerOptions = computed(() => {
  const combined = [...availableCheckers.value, ...availableApprovers.value];
  const deduped = new Map(combined.map((user) => [user.id, user]));
  return Array.from(deduped.values());
});

const availableCheckers = computed(() => {
  const checkers = userStore.availableCheckers.value;
  return checkers.length > 0 ? checkers : userStore.availableReviewers.value;
});
const availableApprovers = computed(() => {
  const approvers = userStore.availableApprovers.value;
  return approvers.length > 0 ? approvers : userStore.availableReviewers.value;
});

const resolvedAssignees = computed(() => {
  if (!externalWorkflowMode.value) {
    const checkerId = formData.checkerId;
    const approverId = formData.approverId;
    return {
      checkerId,
      approverId,
      valid: !!checkerId && !!approverId && checkerId !== approverId,
    };
  }

  const checkerId = formData.checkerId || reviewerOptions.value[0]?.id || '';
  const approverPool = availableApprovers.value.length > 0 ? availableApprovers.value : reviewerOptions.value;
  const approverId =
    formData.approverId || approverPool.find((user) => user.id !== checkerId)?.id || approverPool[0]?.id || '';

  return {
    checkerId,
    approverId,
    valid: !!checkerId && !!approverId && checkerId !== approverId,
  };
});

const samePersonError = computed(() => {
  if (externalWorkflowMode.value) return false;
  return formData.checkerId && formData.approverId && formData.checkerId === formData.approverId;
});

type FormErrors = {
  packageName: string;
  checkerId: string;
};

const formErrors = ref<FormErrors>({
  packageName: '',
  checkerId: '',
});

const hasValidationErrors = computed(() => {
  return Object.values(formErrors.value).some((value) => value.length > 0);
});

function validateForm() {
  const nextErrors: FormErrors = {
    packageName: formData.packageName.trim() ? '' : '请输入数据包名称',
    checkerId: externalWorkflowMode.value ? '' : (formData.checkerId ? '' : '请选择审核人'),
  };
  formErrors.value = nextErrors;
  return !nextErrors.packageName && !nextErrors.checkerId;
}

watch(() => formData.packageName, (value) => {
  if (value.trim()) {
    formErrors.value.packageName = '';
  }
});

watch(() => formData.checkerId, (value) => {
  if (value) {
    formErrors.value.checkerId = '';
  }
});

const canSubmit = computed(() => {
  const hasName = !!formData.packageName.trim();
  const hasComponents = selectedComponents.value.length > 0;
  if (externalWorkflowMode.value) {
    return hasName && hasComponents;
  }
  return hasName && hasComponents && !!formData.checkerId && !!formData.approverId && !samePersonError.value;
});

const missingFields = computed(() => {
  const fields: string[] = [];
  if (selectedComponents.value.length === 0) fields.push('选择模型构件');
  if (!formData.packageName.trim()) fields.push('数据包名称');
  if (!externalWorkflowMode.value) {
    if (!formData.checkerId) fields.push('校核人员');
    if (!formData.approverId) fields.push('审核人员');
    if (samePersonError.value) fields.push('校核人和审核人不能为同一人');
  }
  return fields;
});

const submitButtonLabel = computed(() => (
  externalWorkflowMode.value ? '保存编校审单数据' : '创建并提交编校审单'
));
const submitLoadingLabel = computed(() => (
  externalWorkflowMode.value ? '正在保存...' : '正在创建...'
));
const attachmentUploadHint = computed(() => (
  externalWorkflowMode.value
    ? '当前将在保存编校审单后自动上传附件，避免缺少 lineage 导致上传失败。'
    : '当前将在创建编校审单后自动上传附件，避免缺少 lineage 导致上传失败。'
));
const submitSuccessTitle = computed(() => (
  externalWorkflowMode.value ? '编校审单保存成功' : '编校审单创建成功'
));
const submitSuccessDetails = computed(() => (
  externalWorkflowMode.value ? '已保存到编校审单，流程流转由外部系统继续处理。' : '已提交到校审流程。'
));
const submitButtonAriaLabel = computed(() => (
  externalWorkflowMode.value ? '验证并保存编校审单' : '验证并提交编校审单'
));
const panelSubTitle = computed(() => (
  externalWorkflowMode.value
    ? '根据设计稿填写编校审信息并保存到编校审单，流程流转由外部系统驱动'
    : '根据设计稿填写编校审信息并提交到校审流程'
));

const selectedChecker = computed(() => {
  return reviewerOptions.value.find((user) => user.id === resolvedAssignees.value.checkerId) ?? null;
});

const selectedApprover = computed(() => {
  return reviewerOptions.value.find((user) => user.id === resolvedAssignees.value.approverId) ?? null;
});

function removeComponent(id: string) {
  const removed = selectedComponents.value.find((c) => c.id === id);
  selectedComponents.value = selectedComponents.value.filter((c) => c.id !== id);
  if (removed && normalizeComponentRefno(removed.refNo) === selectedComponentRefno.value) {
    selectedComponentRefno.value = null;
  }
}

function getUploadedAttachments() {
  return buildReviewAttachments(uploadedFiles.value);
}

async function syncTaskAttachments(taskId: string) {
  await userStore.updateTaskAttachments(taskId, getUploadedAttachments());
}

async function handleAttachmentUploadComplete() {
  if (!createdTaskId.value) return;
  await nextTick();
  await syncTaskAttachments(createdTaskId.value);
}

async function handleSubmit() {
  if (!validateForm()) return;
  if (!canSubmit.value) return;

  notification.value = { type: null, message: '', details: '' };
  isSubmitting.value = true;

  try {
    const isExternal = externalWorkflowMode.value;
    const pageFormId = embedModeParams.value.launchInput?.formId || null;
    const persistedFormId = formId.value || null;
    const requestFormId = embedModeParams.value.isEmbedMode ? (persistedFormId || undefined) : undefined;

    if (embedModeParams.value.isEmbedMode && !requestFormId) {
      throw new Error('缺少业务单据号，请重新从编校审入口打开当前单据');
    }

    const checkerIdToSubmit = isExternal ? undefined : resolvedAssignees.value.checkerId;
    const approverIdToSubmit = isExternal ? undefined : resolvedAssignees.value.approverId;
    if (!isExternal && (!checkerIdToSubmit || !approverIdToSubmit || checkerIdToSubmit === approverIdToSubmit)) {
      throw new Error('校核人与审核人配置无效，请检查后重试');
    }

    const attachments = getUploadedAttachments();
    console.log('[InitiateReviewPanel] 编校审单保存上下文', {
      pageFormId,
      persistedFormId,
      requestFormId: requestFormId || null,
    });

    const task = await userStore.createReviewTask({
      title: formData.packageName,
      description: formData.description || `模型数据包：${formData.packageName}`,
      modelName: formData.packageName,
      checkerId: checkerIdToSubmit,
      approverId: approverIdToSubmit,
      formId: requestFormId,
      priority: isExternal ? undefined : formData.priority,
      components: [...selectedComponents.value],
      dueDate: !isExternal && formData.dueDate ? new Date(formData.dueDate).getTime() : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    createdTaskId.value = task.id;
    createdTaskFormId.value = task.formId || null;

    const hasPendingUploads = uploadedFiles.value.some((f) => f.status === 'pending');
    if (hasPendingUploads) {
      await nextTick();
      await uploadSectionRef.value?.startUpload({
        taskId: task.id,
        formId: task.formId || activeUploadFormId.value,
      });
      await nextTick();
    }

    await syncTaskAttachments(task.id);

    if (!isExternal) {
      await userStore.submitTaskToNextNode(task.id, '发起编校审');
    }

    const checker = checkerIdToSubmit ? reviewerOptions.value.find((r) => r.id === checkerIdToSubmit) : null;
    const approver = approverIdToSubmit ? reviewerOptions.value.find((r) => r.id === approverIdToSubmit) : null;

    lastCreatedTask.value = {
      id: task.id,
      title: task.title,
      checkerName: checker?.name ?? (isExternal ? '由外部系统指定' : ''),
      approverName: approver?.name ?? (isExternal ? '由外部系统指定' : ''),
      componentCount: selectedComponents.value.length,
    };
    submitted.value = true;
    emit('created', task.id);

    // 重置表单数据（为下次新建做准备）
    formData.packageName = '';
    formData.description = '';
    formData.checkerId = '';
    formData.approverId = '';
    formData.priority = 'medium';
    formData.dueDate = '';
    selectedComponents.value = [];
    selectedComponentRefno.value = null;
    uploadedFiles.value = [];
    createdTaskId.value = null;
    createdTaskFormId.value = null;
  } catch (error) {
    notification.value = {
      type: 'error',
      message: externalWorkflowMode.value ? '编校审单保存失败' : '编校审单创建失败',
      details: error instanceof Error ? error.message : '未知错误，请重试',
    };
  } finally {
    isSubmitting.value = false;
  }
}

function clearNotification() {
  notification.value = { type: null, message: '', details: '' };
}

function resetForNewTask() {
  submitted.value = false;
  lastCreatedTask.value = null;
  notification.value = { type: null, message: '', details: '' };
  hydratedRestoreTaskId.value = null;
  selectedComponentRefno.value = null;
  // 清除场景中的批注和测量，避免新建单据时显示上一个单据的批注
  toolStore.clearAll();
  viewerContext.tools.value?.syncFromStore();
  // 重置恢复器的场景键，确保下次不会跳过清除
  confirmedRecordsRestorer.lastRestoredSceneKey.value = null;
}

function goToTaskMonitor() {
  ensurePanelAndActivate('taskMonitor');
}

function goToReviewWorkbench() {
  ensurePanelAndActivate('review');
}

function closePanel() {
  emit('close');
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto p-3" data-testid="designer-landing-workspace" data-panel="initiateReview">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-base font-semibold text-[#111827]">发起编校审单</h3>
        <p class="mt-1 text-xs text-[#6B7280]">{{ panelSubTitle }}</p>
      </div>
      <div class="flex items-center gap-2">
        <button type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md border border-[#E5E7EB] px-2 text-xs text-[#6B7280] transition hover:bg-[#F9FAFB] hover:text-[#374151]"
          title="查看发起编校审操作指南"
          @click="onboarding.openGuideCenter('initiateReview')">
          <HelpCircle class="h-4 w-4" />
          操作指南
        </button>
        <button type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#9CA3AF] transition hover:bg-[#F9FAFB] hover:text-[#6B7280]"
          aria-label="关闭发起编校审单面板"
          @click="closePanel">
          <X class="h-5 w-5" />
        </button>
      </div>
    </div>

    <!-- 成功提交后的结果展示 -->
    <div v-if="submitted && lastCreatedTask" class="mt-4 space-y-4">
      <div class="rounded-xl border border-green-200 bg-green-50 p-4">
        <div class="flex items-center gap-2 text-green-700">
          <CheckCircle class="h-5 w-5 shrink-0" />
          <span class="text-sm font-semibold">{{ submitSuccessTitle }}</span>
        </div>
        <div class="mt-3 space-y-2 text-sm text-green-800">
          <p>数据包「<span class="font-medium">{{ lastCreatedTask.title }}</span>」{{ submitSuccessDetails }}</p>
          <div class="rounded-lg bg-white/60 px-3 py-2 text-xs text-green-700">
            <p>校核人：{{ lastCreatedTask.checkerName }}</p>
            <p>审核人：{{ lastCreatedTask.approverName }}</p>
            <p>构件数：{{ lastCreatedTask.componentCount }} 个</p>
          </div>
        </div>
      </div>

      <div v-if="externalWorkflowMode" class="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
        <p class="text-xs font-medium text-blue-700">流程提示</p>
        <p class="mt-1 text-xs text-blue-600">
          编校审单已保存，后续流转将由外部系统继续处理，无需在此继续操作。
        </p>
      </div>

      <div v-else class="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
        <p class="text-xs font-medium text-blue-700">下一步</p>
        <p class="mt-1 text-xs text-blue-600">
          可在「<button type="button" class="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900" @click="goToTaskMonitor">任务监控</button>」面板中查看流转进度，或在「<button type="button" class="font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900" @click="goToReviewWorkbench">审核工作台</button>」中查看校审详情。
        </p>
      </div>

      <div class="flex gap-2">
        <Button v-if="!externalWorkflowMode" class="flex-1" @click="resetForNewTask">
          <Plus class="h-3.5 w-3.5" />
          新建编校审单
        </Button>
        <Button variant="secondary" class="flex-1" @click="closePanel">
          关闭面板
        </Button>
      </div>
    </div>

    <!-- 表单区域（未提交或提交失败时显示） -->
    <div v-else class="mt-4 space-y-4">
      <div v-if="showDebugUi && embedLandingState?.target === 'designer'"
        data-testid="designer-landing-cta"
        class="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
        自动进入编校审/编辑工作区
      </div>

      <div v-if="showDebugUi && embedModeParams.isEmbedMode" class="flex flex-wrap gap-2 text-xs">
        <span class="rounded-full bg-blue-100 px-2 py-1 text-blue-800">表单 ID: {{ formId || '（由后端生成）' }}</span>
        <span class="rounded-full bg-green-100 px-2 py-1 text-green-800">项目: {{ currentProjectId }}</span>
        <span v-if="embedLandingState?.formId"
          data-testid="designer-lineage-form-id"
          class="rounded-full bg-indigo-100 px-2 py-1 text-indigo-800">
          Lineage: {{ embedLandingState.formId }}
        </span>
      </div>
      <div v-if="showDebugUi && embedModeParams.isEmbedMode && restoredTaskSummary"
        class="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        data-testid="designer-restored-task-summary">
        <p class="font-medium">当前绑定任务：{{ restoredTaskSummary.title }}</p>
        <p class="mt-1">状态：{{ restoredTaskSummary.status }} · 当前节点：{{ restoredTaskSummary.currentNode }}</p>
      </div>
      <div v-else-if="showDebugUi && embedModeParams.isEmbedMode && embedLandingState?.restoreStatus === 'missing'"
        class="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        data-testid="designer-restored-task-missing">
        当前 form_id 尚未绑定内部任务，可继续在此创建或补齐编校审数据。
      </div>
      <div v-if="showDebugUi && externalWorkflowMode" data-testid="external-workflow-mode-banner"
        class="rounded-[8px] border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
        外部流程模式 — 仅保存编校审数据，流程流转与审批由外部系统驱动。
      </div>

      <Card class="border border-[#F3F4F6] shadow-none" body-class="p-3">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFF0E6] text-[#FF6B00]">
            <Box class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <p class="text-[13px] font-medium text-[#111827]">{{ selectedComponentSummary }}</p>
            <p class="mt-1 text-xs text-[#6B7280]">在三维视图中选中构件后，这里会同步显示发起范围。</p>
          </div>
        </div>
      </Card>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-[13px] font-medium text-[#6B7280]">构件明细</label>
          <Button variant="secondary"
            size="sm"
            data-guide="add-component-btn"
            :disabled="!selectionStore.selectedRefno || addingComponent"
            :title="selectionStore.selectedRefno ? '将选中的构件添加到列表' : '请先在三维视图中点击选中一个构件'"
            @click="addSelectedComponent">
            {{ addingComponent ? '获取中...' : '添加构件' }}
          </Button>
        </div>
        <div class="rounded-[8px] border border-[#E5E7EB] bg-[#FCFCFD] p-3">
          <div v-if="selectedComponents.length === 0" class="text-xs text-[#9CA3AF]">
            暂无已加入的构件，请先在三维视图中选中构件后点击“添加构件”。
          </div>
          <div v-else class="max-h-40 space-y-2 overflow-y-auto">
            <div v-for="comp in selectedComponents"
              :key="comp.id"
              class="flex items-start justify-between rounded-[8px] border px-3 py-2 transition-colors"
              :class="isComponentSelected(comp.refNo)
                ? 'border-[#3B82F6] bg-[#EFF6FF]'
                : 'border-[#F3F4F6] bg-white hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'">
              <div class="min-w-0">
                <button type="button"
                  class="block min-w-0 text-left"
                  :aria-pressed="isComponentSelected(comp.refNo) ? 'true' : 'false'"
                  :title="isComponentSelected(comp.refNo) ? '再次点击取消选中' : '点击选中并定位到三维'"
                  @click="void handleComponentSelect(comp.refNo)">
                  <p class="truncate text-sm font-medium text-[#111827]">{{ comp.name }}</p>
                  <p class="mt-1 text-xs text-[#6B7280]">RefNo: {{ comp.refNo }}</p>
                </button>
              </div>
              <button type="button"
                class="ml-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#9CA3AF] transition hover:bg-[#F3F4F6] hover:text-[#6B7280]"
                :aria-label="`移除构件 ${comp.name}`"
                @click="removeComponent(comp.id)">
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-[13px] font-medium text-[#6B7280]">数据包名称</label>
        <Input v-model="formData.packageName"
          placeholder="输入编校审数据包名称..."
          :error="!!formErrors.packageName" />
        <p v-if="formErrors.packageName" class="text-xs text-[#EF4444]">
          {{ formErrors.packageName }}
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-[13px] font-medium text-[#6B7280]">编校审说明（可选）</label>
        <textarea v-model="formData.description"
          rows="4"
          placeholder="添加补充说明或设计注意事项..."
          class="min-h-20 w-full rounded-[6px] border border-[#E5E7EB] px-3 py-[9px] text-sm text-[#111827] outline-none transition placeholder:text-[#9CA3AF] focus:border-[#3B82F6]" />
      </div>

      <template v-if="!externalWorkflowMode">
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="text-[13px] font-medium text-[#6B7280]">审核人</label>
            <div :class="[
              'relative rounded-[6px] border transition',
              formErrors.checkerId ? 'border-[#EF4444]' : 'border-transparent',
            ]">
              <User class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
              <select v-model="formData.checkerId"
                :aria-invalid="formErrors.checkerId ? 'true' : 'false'"
                data-testid="initiate-checker-select"
                class="w-full appearance-none rounded-[6px] border border-[#E5E7EB] bg-white py-[9px] pl-9 pr-9 text-sm text-[#111827] outline-none transition focus:border-[#3B82F6]"
                :class="formErrors.checkerId ? 'border-[#EF4444] focus:border-[#EF4444]' : ''">
                <option value="">选择审核人</option>
                <option v-for="r in reviewerOptions" :key="r.id" :value="r.id">
                  {{ r.name }} ({{ getRoleDisplayName(r.role) }})
                </option>
              </select>
              <ChevronDown class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            </div>
            <p v-if="selectedChecker" class="text-xs text-[#6B7280]" data-testid="initiate-checker-value">
              已选择：{{ selectedChecker.name }}
            </p>
            <p v-if="formErrors.checkerId" class="text-xs text-[#EF4444]">
              {{ formErrors.checkerId }}
            </p>
          </div>

          <div class="space-y-2">
            <label class="text-[13px] font-medium text-[#6B7280]">优先级</label>
            <div class="relative">
              <Flag class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
              <select v-model="formData.priority"
                data-testid="initiate-priority-select"
                class="w-full appearance-none rounded-[6px] border border-[#E5E7EB] bg-white py-[9px] pl-9 pr-9 text-sm text-[#111827] outline-none transition focus:border-[#3B82F6]">
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
              <ChevronDown class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <label class="text-[13px] font-medium text-[#6B7280]">批准人</label>
          <div class="relative">
            <User class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
            <select v-model="formData.approverId"
              data-testid="initiate-approver-select"
              class="w-full appearance-none rounded-[6px] border border-[#E5E7EB] bg-white py-[9px] pl-9 pr-9 text-sm text-[#111827] outline-none transition focus:border-[#3B82F6]">
              <option value="">选择批准人</option>
              <option v-for="r in availableApprovers" :key="r.id" :value="r.id">
                {{ r.name }} ({{ getRoleDisplayName(r.role) }})
              </option>
            </select>
            <ChevronDown class="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
          </div>
          <p v-if="selectedApprover" class="text-xs text-[#6B7280]" data-testid="initiate-approver-value">
            已选择：{{ selectedApprover.name }}
          </p>
          <p v-if="samePersonError" class="text-xs text-[#EF4444]">
            校核人和审核人不能为同一人
          </p>
        </div>

        <div class="space-y-2">
          <label class="text-[13px] font-medium text-[#6B7280]">期望完成日期</label>
          <div class="relative">
            <Calendar class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
            <input v-model="formData.dueDate"
              type="date"
              data-testid="initiate-due-date"
              class="w-full rounded-[6px] border border-[#E5E7EB] bg-white py-[9px] pl-9 pr-3 text-sm text-[#111827] outline-none transition focus:border-[#3B82F6]" />
          </div>
          <p v-if="formData.dueDate" class="text-xs text-[#6B7280]" data-testid="initiate-due-date-value">
            已选择：{{ formData.dueDate }}
          </p>
        </div>
      </template>

      <div class="space-y-2">
        <label class="flex items-center gap-1 text-[13px] font-medium text-[#6B7280]">
          <Paperclip class="h-4 w-4" />
          模型附件
        </label>
        <FileUploadSection ref="uploadSectionRef" v-model="uploadedFiles"
          data-guide="upload-section"
          :max-files="10"
          :max-size="50"
          :task-id="activeUploadTaskId"
          :form-id="activeUploadFormId"
          :auto-upload="canAutoUploadAttachments"
          accept-types=".pdf,.dwg,.dxf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg"
          @upload-complete="handleAttachmentUploadComplete" />
        <div class="-mt-1 rounded-[8px] border border-dashed border-[#E5E7EB] bg-[#FCFCFD] px-4 py-6 text-center">
          <UploadCloud class="mx-auto h-6 w-6 text-[#9CA3AF]" />
          <p class="mt-2 text-xs text-[#6B7280]">点击或拖拽上传 PDF / CAD 文件</p>
        </div>
        <p class="text-xs text-[#6B7280]">支持上传 PDF、DWG、DXF、Excel、Word、图片等格式，单文件最大 50MB</p>
        <p v-if="!canAutoUploadAttachments" class="text-xs text-[#F59E0B]">
          {{ attachmentUploadHint }}
        </p>
      </div>

      <div class="space-y-2">
        <label class="flex items-center gap-1 text-[13px] font-medium text-[#6B7280]">
          <Link class="h-4 w-4" />
          自动关联文件
        </label>
        <AssociatedFilesList :attachments="[]" />
      </div>

      <Button class="w-full" data-guide="submit-btn" :disabled="!canSubmit || isSubmitting" @click="handleSubmit">
        <template v-if="isSubmitting">
          {{ submitLoadingLabel }}
        </template>
        <template v-else>
          <Send class="h-3.5 w-3.5" />
          {{ submitButtonLabel }}
        </template>
      </Button>

      <button type="button" class="sr-only" data-testid="initiate-submit-trigger" @click="handleSubmit">
        {{ submitButtonAriaLabel }}
      </button>

      <div v-if="notification.type === 'error'"
        class="rounded-[8px] border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-medium">{{ notification.message }}</div>
            <div v-if="notification.details" class="mt-1 text-xs opacity-90">
              {{ notification.details }}
            </div>
          </div>
          <button type="button" class="text-current/70 hover:text-current" @click="clearNotification">
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <p v-if="!notification.type && missingFields.length > 0 && !hasValidationErrors" class="text-xs text-[#F59E0B]">
        请补充：{{ missingFields.join('、') }}
      </p>

      <button type="button"
        class="w-full text-center text-xs font-medium text-[#3B82F6] hover:text-[#2563EB]"
        @click="showExternalReview = true">
        打开三维校审视图
      </button>
    </div>

    <ExternalReviewViewer v-model="showExternalReview" :project-id="currentProjectId" />
  </div>
</template>
