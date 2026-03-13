<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

import { AlertCircle, ArrowRight, Calendar, FileText, Link, Paperclip, Plus, Users, X } from 'lucide-vue-next';

import AssociatedFilesList from './AssociatedFilesList.vue';
import ExternalReviewViewer from './ExternalReviewViewer.vue';
import FileUploadSection from './FileUploadSection.vue';
import { buildReviewAttachments } from './reviewAttachmentFlow';

import type { UploadedFile } from './FileUploadSection.vue';
import type { ReviewComponent } from '@/types/auth';

import { pdmsGetUiAttr } from '@/api/genModelPdmsAttrApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useUserStore } from '@/composables/useUserStore';
import { getRoleDisplayName } from '@/types/auth';

const userStore = useUserStore();
const selectionStore = useSelectionStore();

const packageName = ref('');
const description = ref('');
const checkerId = ref('');
const approverId = ref('');
const priority = ref<'low' | 'medium' | 'high' | 'urgent'>('medium');
const dueDate = ref('');
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

const availableCheckers = computed(() => {
  const checkers = userStore.availableCheckers.value;
  return checkers.length > 0 ? checkers : userStore.availableReviewers.value;
});
const availableApprovers = computed(() => {
  const approvers = userStore.availableApprovers.value;
  return approvers.length > 0 ? approvers : userStore.availableReviewers.value;
});

const samePersonError = computed(() => {
  return checkerId.value && approverId.value && checkerId.value === approverId.value;
});

const canSubmit = computed(() => {
  return packageName.value.trim()
    && checkerId.value
    && approverId.value
    && !samePersonError.value
    && selectedComponents.value.length > 0;
});

const missingFields = computed(() => {
  const fields: string[] = [];
  if (selectedComponents.value.length === 0) fields.push('选择模型构件');
  if (!packageName.value.trim()) fields.push('数据包名称');
  if (!checkerId.value) fields.push('校核人员');
  if (!approverId.value) fields.push('审核人员');
  if (samePersonError.value) fields.push('校核人和审核人不能为同一人');
  return fields;
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
  if (!canSubmit.value) return;

  notification.value = { type: null, message: '', details: '' };
  isSubmitting.value = true;

  try {
    const attachments = getUploadedAttachments();

    const task = await userStore.createReviewTask({
      title: packageName.value,
      description: description.value || `模型数据包：${packageName.value}`,
      modelName: packageName.value,
      checkerId: checkerId.value,
      approverId: approverId.value,
      formId: embedModeParams.value.isEmbedMode ? (embedModeParams.value.formId || undefined) : undefined,
      priority: priority.value,
      components: [...selectedComponents.value],
      dueDate: dueDate.value ? new Date(dueDate.value).getTime() : undefined,
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

    const uploadedAttachmentCount = getUploadedAttachments().length;
    const failedAttachmentCount = uploadedFiles.value.filter((f) => f.status === 'error').length;

    const checker = availableCheckers.value.find((r) => r.id === checkerId.value);
    const approver = availableApprovers.value.find((r) => r.id === approverId.value);

    notification.value = {
      type: 'success',
      message: '提资单创建成功！',
      details: `数据包「${task.title}」已创建，校核人：${checker?.name}，审核人：${approver?.name}，包含 ${selectedComponents.value.length} 个构件，附件成功 ${uploadedAttachmentCount} 个${failedAttachmentCount > 0 ? `，失败 ${failedAttachmentCount} 个` : ''}`,
    };

    // 重置表单
    packageName.value = '';
    description.value = '';
    checkerId.value = '';
    approverId.value = '';
    priority.value = 'medium';
    dueDate.value = '';
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
</script>

<template>
  <div class="p-4 space-y-4 overflow-auto h-full">
    <div class="border-b pb-3 flex justify-between items-start" data-testid="designer-landing-workspace">
      <div>
        <h3 class="text-lg font-semibold">创建提资单</h3>
        <p class="text-sm text-gray-500 mt-1">选择模型构件并手动指定校核/审核人员</p>
        <div v-if="embedLandingState?.target === 'designer'"
          data-testid="designer-landing-cta"
          class="mt-2 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
          自动进入提资/编辑工作区
        </div>
        <!-- 嵌入模式显示 form_id -->
        <div v-if="embedModeParams.isEmbedMode" class="mt-2 flex items-center gap-2">
          <span class="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
            📋 表单 ID: {{ formId || '（由后端生成）' }}
          </span>
          <span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            🏭 项目: {{ currentProjectId }}
          </span>
          <span v-if="embedLandingState?.formId"
            data-testid="designer-lineage-form-id"
            class="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">
            Lineage: {{ embedLandingState.formId }}
          </span>
        </div>
      </div>
      <button class="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
        @click="showExternalReview = true">
        <Link class="h-4 w-4" />
        三维校审
      </button>
    </div>

    <!-- 模型构件选择 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">选择模型构件 *</label>
      <p class="text-xs text-gray-400 mt-0.5">在三维视图中选择构件后，点击下方按钮追加到列表</p>
      <div class="border rounded-lg p-3">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm text-gray-600">已选择 {{ selectedComponents.length }} 个构件</span>
          <button class="inline-flex items-center gap-1 px-2 py-1 text-sm border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!selectionStore.selectedRefno || addingComponent"
            :title="selectionStore.selectedRefno ? '将选中的构件添加到列表' : '请先在三维视图中点击选中一个构件'"
            @click="addSelectedComponent">
            <Plus class="h-3 w-3" />
            {{ addingComponent ? '获取中...' : '添加构件' }}
          </button>
        </div>
        <div class="space-y-2 max-h-40 overflow-y-auto">
          <div v-for="comp in selectedComponents"
            :key="comp.id"
            class="flex items-center justify-between p-2 rounded bg-gray-50 hover:bg-gray-100">
            <div class="flex items-center gap-2">
              <FileText class="h-4 w-4 text-blue-600" />
              <div>
                <div class="text-sm font-medium">{{ comp.name }}</div>
                <div class="text-xs text-gray-500">RefNo: {{ comp.refNo }}</div>
              </div>
            </div>
            <button class="p-1 hover:bg-gray-200 rounded" @click="removeComponent(comp.id)">
              <X class="h-4 w-4 text-gray-500" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 数据包名称 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">模型数据包名称 *</label>
      <input v-model="packageName"
        type="text"
        placeholder="输入模型数据包名称"
        class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>

    <!-- 描述 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">描述</label>
      <textarea v-model="description"
        rows="2"
        placeholder="输入提资单描述（可选）"
        class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
    </div>

    <!-- 附件文件上传 -->
    <div class="space-y-2">
      <label class="text-sm font-medium flex items-center gap-1">
        <Paperclip class="h-4 w-4" />
        附件文件
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
      <p class="text-xs text-gray-500">
        支持上传 PDF、DWG、DXF、Excel、Word、图片等格式，单文件最大 50MB
      </p>
      <p v-if="!canAutoUploadAttachments" class="text-xs text-amber-600">
        当前将在创建提资单后自动上传附件，避免缺少 lineage 导致上传失败。
      </p>
    </div>

    <!-- 自动关联文件 -->
    <div class="space-y-2">
      <label class="text-sm font-medium flex items-center gap-1">
        <Link class="h-4 w-4" />
        自动关联文件
      </label>
      <AssociatedFilesList />
    </div>

    <!-- 校核/审核人员和优先级 -->
    <div class="grid grid-cols-3 gap-4">
      <div class="space-y-2">
        <label class="text-sm font-medium">校核人员 *</label>
        <select v-model="checkerId"
          class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">选择校核人员</option>
          <option v-for="r in availableCheckers" :key="r.id" :value="r.id">
            {{ r.name }} ({{ getRoleDisplayName(r.role) }})
          </option>
        </select>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">审核人员 *</label>
        <select v-model="approverId"
          class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">选择审核人员</option>
          <option v-for="r in availableApprovers" :key="r.id" :value="r.id">
            {{ r.name }} ({{ getRoleDisplayName(r.role) }})
          </option>
        </select>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">优先级</label>
        <select v-model="priority"
          class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
          <option value="urgent">紧急</option>
        </select>
      </div>
    </div>

    <!-- 截止日期 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">截止时间（可选）</label>
      <div class="relative">
        <Calendar class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input v-model="dueDate"
          type="date"
          class="w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>

    <!-- 提交按钮 -->
    <button :disabled="!canSubmit || isSubmitting"
      class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      @click="handleSubmit">
      <template v-if="isSubmitting">
        <div class="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
        正在创建...
      </template>
      <template v-else>
        <ArrowRight class="h-4 w-4" />
        创建提资单
      </template>
    </button>

    <!-- 通知 -->
    <div v-if="notification.type"
      :class="[
        'flex items-start gap-3 p-3 rounded-lg',
        notification.type === 'success'
          ? 'bg-green-50 text-green-800 border border-green-200'
          : 'bg-red-50 text-red-800 border border-red-200',
      ]">
      <div class="flex-1">
        <div class="font-medium text-sm">{{ notification.message }}</div>
        <div v-if="notification.details" class="text-sm mt-1 opacity-90">
          {{ notification.details }}
        </div>
      </div>
      <button class="text-gray-400 hover:text-gray-600" @click="clearNotification">
        <X class="h-4 w-4" />
      </button>
    </div>

    <!-- 验证提示 -->
    <div v-if="!notification.type && missingFields.length > 0"
      class="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 p-2 rounded-lg">
      <AlertCircle class="h-4 w-4" />
      <span>请填写必填字段：{{ missingFields.join('、') }}</span>
    </div>

    <!-- 外部校审浏览器 -->
    <ExternalReviewViewer v-model="showExternalReview"
      :project-id="currentProjectId" />
  </div>
</template>
