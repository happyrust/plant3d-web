<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';

import { Box, Calendar, ChevronDown, Flag, Link, Paperclip, Send, UploadCloud, User, X } from 'lucide-vue-next';

import AssociatedFilesList from './AssociatedFilesList.vue';
import ExternalReviewViewer from './ExternalReviewViewer.vue';
import FileUploadSection from './FileUploadSection.vue';
import { buildReviewAttachments } from './reviewAttachmentFlow';

import type { UploadedFile } from './FileUploadSection.vue';
import type { ReviewComponent } from '@/types/auth';

import { pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useUserStore } from '@/composables/useUserStore';
import { getRoleDisplayName } from '@/types/auth';

const emit = defineEmits<{
  (e: 'created', taskId: string): void;
  (e: 'close'): void;
}>();

const userStore = useUserStore();
const selectionStore = useSelectionStore();

const formData = reactive({
  packageName: '',
  description: '',
  checkerId: '',
  approverId: '',
  priority: 'medium' as 'low' | 'medium' | 'high',
  dueDate: '',
});
const selectedComponents = ref<ReviewComponent[]>([]);
const addingComponent = ref(false);

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
  if (selectedComponents.value.some((c) => c.refNo === refno)) return;

  addingComponent.value = true;
  try {
    const resp = await pdmsGetUiAttr(refno);
    const name =
      (resp.full_name && resp.full_name.trim()) ||
      (resp.attrs?.NAME as string) ||
      (resp.attrs?.DESCRIPTION as string) ||
      refno;
    const type = (resp.attrs?.NOUN as string) || '构件';
    selectedComponents.value.push(buildReviewComponent({
      refNo: refno,
      name: String(name),
      type,
    }));
  } catch (_e) {
    // 网络失败时使用选中时的属性作为兜底
    const attrs = selectionStore.propertiesData.value;
    const name = (attrs?.NAME || attrs?.DESCRIPTION || refno) as string;
    const type = (attrs?.NOUN || '构件') as string;
    selectedComponents.value.push(buildReviewComponent({
      refNo: refno,
      name,
      type,
    }));
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

const embedLandingState = ref<{
  target?: string;
  formId?: string | null;
  primaryPanelId?: string;
  visiblePanelIds?: string[];
} | null>(null);

// 在组件挂载时读取嵌入模式参数
onMounted(() => {
  const storedParams = sessionStorage.getItem('embed_mode_params');
  if (storedParams) {
    try {
      embedModeParams.value = JSON.parse(storedParams);
      console.log('[InitiateReviewPanel] 嵌入模式参数:', embedModeParams.value);
    } catch (e) {
      console.warn('[InitiateReviewPanel] 无法解析嵌入模式参数');
    }
  }

  const storedLandingState = sessionStorage.getItem('embed_landing_state');
  if (storedLandingState) {
    try {
      embedLandingState.value = JSON.parse(storedLandingState);
    } catch {
      console.warn('[InitiateReviewPanel] 无法解析嵌入模式落点状态');
    }
  }
});

// 表单 ID：仅在嵌入模式展示/透传；正常模式由后端生成
const formId = computed(() => {
  return embedModeParams.value.isEmbedMode ? embedModeParams.value.formId : null;
});

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

const samePersonError = computed(() => {
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
    checkerId: formData.checkerId ? '' : '请选择审核人',
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
  return formData.packageName.trim()
    && formData.checkerId
    && formData.approverId
    && !samePersonError.value
    && selectedComponents.value.length > 0;
});

const missingFields = computed(() => {
  const fields: string[] = [];
  if (selectedComponents.value.length === 0) fields.push('选择模型构件');
  if (!formData.packageName.trim()) fields.push('数据包名称');
  if (!formData.checkerId) fields.push('校核人员');
  if (!formData.approverId) fields.push('审核人员');
  if (samePersonError.value) fields.push('校核人和审核人不能为同一人');
  return fields;
});

const selectedChecker = computed(() => {
  return reviewerOptions.value.find((user) => user.id === formData.checkerId) ?? null;
});

const selectedApprover = computed(() => {
  return reviewerOptions.value.find((user) => user.id === formData.approverId) ?? null;
});

function removeComponent(id: string) {
  selectedComponents.value = selectedComponents.value.filter((c) => c.id !== id);
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
    const attachments = getUploadedAttachments();

    const task = await userStore.createReviewTask({
      title: formData.packageName,
      description: formData.description || `模型数据包：${formData.packageName}`,
      modelName: formData.packageName,
      checkerId: formData.checkerId,
      approverId: formData.approverId,
      formId: embedModeParams.value.isEmbedMode ? (embedModeParams.value.formId || undefined) : undefined,
      priority: formData.priority,
      components: [...selectedComponents.value],
      dueDate: formData.dueDate ? new Date(formData.dueDate).getTime() : undefined,
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

    // 自动触发一次提交，令任务状态由 draft(sj) 转为 submitted(jd)
    await userStore.submitTaskToNextNode(task.id, '发起提资');

    const uploadedAttachmentCount = getUploadedAttachments().length;
    const failedAttachmentCount = uploadedFiles.value.filter((f) => f.status === 'error').length;

    const checker = availableCheckers.value.find((r) => r.id === formData.checkerId);
    const approver = availableApprovers.value.find((r) => r.id === formData.approverId);

    notification.value = {
      type: 'success',
      message: '提资单创建成功！',
      details: `数据包「${task.title}」已创建，包含 ${selectedComponents.value.length} 个构件。下一步：您可以在"我的提资单"或"任务监控"面板中查看流转进度。`,
    };
    emit('created', task.id);
    emit('close');

    // 重置表单
    formData.packageName = '';
    formData.description = '';
    formData.checkerId = '';
    formData.approverId = '';
    formData.priority = 'medium';
    formData.dueDate = '';
    selectedComponents.value = [];
    uploadedFiles.value = [];
    createdTaskId.value = null;
    createdTaskFormId.value = null;
  } catch (error) {
    notification.value = {
      type: 'error',
      message: '提资单创建失败',
      details: error instanceof Error ? error.message : '未知错误，请重试',
    };
  } finally {
    isSubmitting.value = false;
  }
}

function clearNotification() {
  notification.value = { type: null, message: '', details: '' };
}

function closePanel() {
  emit('close');
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto p-3" data-testid="designer-landing-workspace">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-base font-semibold text-[#111827]">发起提资单</h3>
        <p class="mt-1 text-xs text-[#6B7280]">根据设计稿填写提资信息并提交到校审流程</p>
      </div>
      <button type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#9CA3AF] transition hover:bg-[#F9FAFB] hover:text-[#6B7280]"
        aria-label="关闭发起提资单面板"
        @click="closePanel">
        <X class="h-5 w-5" />
      </button>
    </div>

    <div class="mt-4 space-y-4">
      <div v-if="embedLandingState?.target === 'designer'"
        data-testid="designer-landing-cta"
        class="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
        自动进入提资/编辑工作区
      </div>

      <div v-if="embedModeParams.isEmbedMode" class="flex flex-wrap gap-2 text-xs">
        <span class="rounded-full bg-blue-100 px-2 py-1 text-blue-800">表单 ID: {{ formId || '（由后端生成）' }}</span>
        <span class="rounded-full bg-green-100 px-2 py-1 text-green-800">项目: {{ currentProjectId }}</span>
        <span v-if="embedLandingState?.formId"
          data-testid="designer-lineage-form-id"
          class="rounded-full bg-indigo-100 px-2 py-1 text-indigo-800">
          Lineage: {{ embedLandingState.formId }}
        </span>
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
              class="flex items-start justify-between rounded-[8px] border border-[#F3F4F6] bg-white px-3 py-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-[#111827]">{{ comp.name }}</p>
                <p class="mt-1 text-xs text-[#6B7280]">RefNo: {{ comp.refNo }}</p>
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
          placeholder="输入提资数据包名称..."
          :error="!!formErrors.packageName" />
        <p v-if="formErrors.packageName" class="text-xs text-[#EF4444]">
          {{ formErrors.packageName }}
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-[13px] font-medium text-[#6B7280]">提资描述（可选）</label>
        <textarea v-model="formData.description"
          rows="4"
          placeholder="添加补充说明或设计注意事项..."
          class="min-h-20 w-full rounded-[6px] border border-[#E5E7EB] px-3 py-[9px] text-sm text-[#111827] outline-none transition placeholder:text-[#9CA3AF] focus:border-[#3B82F6]" />
      </div>

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

      <div class="space-y-2">
        <label class="flex items-center gap-1 text-[13px] font-medium text-[#6B7280]">
          <Paperclip class="h-4 w-4" />
          模型附件
        </label>
        <FileUploadSection ref="uploadSectionRef"
          v-model="uploadedFiles"
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
          当前将在创建提资单后自动上传附件，避免缺少 lineage 导致上传失败。
        </p>
      </div>

      <div class="space-y-2">
        <label class="flex items-center gap-1 text-[13px] font-medium text-[#6B7280]">
          <Link class="h-4 w-4" />
          自动关联文件
        </label>
        <AssociatedFilesList :selected-component-count="selectedComponents.length" />
      </div>

      <Button class="w-full" :disabled="!canSubmit || isSubmitting" @click="handleSubmit">
        <template v-if="isSubmitting">
          正在创建...
        </template>
        <template v-else>
          <Send class="h-3.5 w-3.5" />
          创建并提交提资单
        </template>
      </Button>

      <button type="button" class="sr-only" data-testid="initiate-submit-trigger" @click="handleSubmit">
        验证并提交提资单
      </button>

      <div v-if="notification.type"
        :class="[
          'rounded-[8px] border px-3 py-3 text-sm',
          notification.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800',
        ]">
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
