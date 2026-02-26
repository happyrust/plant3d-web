<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { AlertCircle, ArrowRight, Calendar, FileText, Link, Paperclip, Plus, Users, X } from 'lucide-vue-next';

import { useUserStore } from '@/composables/useUserStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import type { ReviewComponent } from '@/types/auth';
import { getRoleDisplayName } from '@/types/auth';
import FileUploadSection from './FileUploadSection.vue';
import type { UploadedFile } from './FileUploadSection.vue';
import AssociatedFilesList from './AssociatedFilesList.vue';
import ExternalReviewViewer from './ExternalReviewViewer.vue';

const userStore = useUserStore();
const selectionStore = useSelectionStore();

const packageName = ref('');
const description = ref('');
const reviewerId = ref('');
const priority = ref<'low' | 'medium' | 'high' | 'urgent'>('medium');
const dueDate = ref('');
const selectedComponents = ref<ReviewComponent[]>([]);

// 侦听三维视图中的构件选中，自动追加到构件列表
watch(
  () => selectionStore.selectedRefno.value,
  (refno) => {
    if (!refno) return;
    // 已存在则跳过
    if (selectedComponents.value.some((c) => c.refNo === refno)) return;
    // 从属性数据中获取名称和类型
    const attrs = selectionStore.propertiesData.value;
    const name = (attrs?.NAME || attrs?.DESCRIPTION || refno) as string;
    const type = (attrs?.NOUN || '构件') as string;
    selectedComponents.value.push({
      id: `comp-${Date.now()}`,
      refNo: refno,
      name,
      type,
    });
  }
);
const uploadedFiles = ref<UploadedFile[]>([]);
const showExternalReview = ref(false);

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
});

// 表单 ID：仅在嵌入模式展示/透传；正常模式由后端生成
const formId = computed(() => {
  return embedModeParams.value.isEmbedMode ? embedModeParams.value.formId : null;
});

const currentProjectId = computed<string>(() => {
  // 优先使用嵌入模式的 projectId
  if (embedModeParams.value.projectId) {
    return embedModeParams.value.projectId;
  }
  // Try to extract project from first component name (e.g. /1RCV0244/...)
  if (selectedComponents.value.length > 0) {
    const first = selectedComponents.value[0];
    const parts = first?.name?.split('/') ?? [];
    const project = parts.length > 1 ? parts[1] : undefined;
    if (project) return project;
  }
  return 'demo-project';
});

const availableReviewers = computed(() => userStore.availableReviewers.value);

const canSubmit = computed(() => {
  return packageName.value.trim() && reviewerId.value && selectedComponents.value.length > 0;
});

const missingFields = computed(() => {
  const fields: string[] = [];
  if (selectedComponents.value.length === 0) fields.push('选择模型构件');
  if (!packageName.value.trim()) fields.push('数据包名称');
  if (!reviewerId.value) fields.push('审核人员');
  return fields;
});

function addMockComponent() {
  const id = `comp-${Date.now()}`;
  selectedComponents.value.push({
    id,
    name: `/Component-${selectedComponents.value.length + 1}`,
    refNo: `${Math.floor(Math.random() * 99999)}_${Math.floor(Math.random() * 99999)}`,
    type: '管道组件',
  });
}

function removeComponent(id: string) {
  selectedComponents.value = selectedComponents.value.filter((c) => c.id !== id);
}

async function handleSubmit() {
  if (!canSubmit.value) return;

  notification.value = { type: null, message: '', details: '' };
  isSubmitting.value = true;

  try {
    const task = await userStore.createReviewTask({
      title: packageName.value,
      description: description.value || `模型数据包：${packageName.value}`,
      modelName: packageName.value,
      reviewerId: reviewerId.value,
      // 外部已创建单据时统一复用 formId；否则走正常创建逻辑（后端生成）
      formId: embedModeParams.value.isEmbedMode ? (embedModeParams.value.formId || undefined) : undefined,
      priority: priority.value,
      components: [...selectedComponents.value],
      dueDate: dueDate.value ? new Date(dueDate.value).getTime() : undefined,
    });

    const reviewer = availableReviewers.value.find((r) => r.id === reviewerId.value);

    notification.value = {
      type: 'success',
      message: '提资单创建成功！',
      details: `数据包「${task.title}」已创建并分配给 ${reviewer?.name}（${reviewer?.department}），包含 ${selectedComponents.value.length} 个构件`,
    };

    // 重置表单
    packageName.value = '';
    description.value = '';
    reviewerId.value = '';
    priority.value = 'medium';
    dueDate.value = '';
    selectedComponents.value = [];
    uploadedFiles.value = [];
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
    <div class="border-b pb-3 flex justify-between items-start">
      <div>
        <h3 class="text-lg font-semibold">创建提资单</h3>
        <p class="text-sm text-gray-500 mt-1">选择模型构件并指定审核人员</p>
        <!-- 嵌入模式显示 form_id -->
        <div v-if="embedModeParams.isEmbedMode" class="mt-2 flex items-center gap-2">
          <span class="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
            📋 表单 ID: {{ formId || '（由后端生成）' }}
          </span>
          <span class="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            🏭 项目: {{ currentProjectId }}
          </span>
        </div>
      </div>
      <button
        class="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
        @click="showExternalReview = true"
      >
        <Link class="h-4 w-4" />
        三维校审
      </button>
    </div>

    <!-- 模型构件选择 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">选择模型构件 *</label>
      <p class="text-xs text-gray-400 mt-0.5">在三维视图中点击构件可自动追加</p>
      <div class="border rounded-lg p-3">
        <div class="flex justify-between items-center mb-2">
          <span class="text-sm text-gray-600">已选择 {{ selectedComponents.length }} 个构件</span>
          <button
            class="inline-flex items-center gap-1 px-2 py-1 text-sm border rounded hover:bg-gray-50"
            @click="addMockComponent"
          >
            <Plus class="h-3 w-3" />
            添加构件
          </button>
        </div>
        <div class="space-y-2 max-h-40 overflow-y-auto">
          <div
            v-for="comp in selectedComponents"
            :key="comp.id"
            class="flex items-center justify-between p-2 rounded bg-gray-50 hover:bg-gray-100"
          >
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
      <input
        v-model="packageName"
        type="text"
        placeholder="输入模型数据包名称"
        class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>

    <!-- 描述 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">描述</label>
      <textarea
        v-model="description"
        rows="2"
        placeholder="输入提资单描述（可选）"
        class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
    </div>

    <!-- 附件文件上传 -->
    <div class="space-y-2">
      <label class="text-sm font-medium flex items-center gap-1">
        <Paperclip class="h-4 w-4" />
        附件文件
      </label>
      <FileUploadSection
        v-model="uploadedFiles"
        :max-files="10"
        :max-size="50"
        accept-types=".pdf,.dwg,.dxf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg"
      />
      <p class="text-xs text-gray-500">
              支持上传 PDF、DWG、DXF、Excel、Word、图片等格式，单文件最大 50MB
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

    <!-- 审核人员和优先级 -->
    <div class="grid grid-cols-2 gap-4">
      <div class="space-y-2">
        <label class="text-sm font-medium">审核人员 *</label>
        <select
          v-model="reviewerId"
          class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">选择审核人员</option>
          <option v-for="r in availableReviewers" :key="r.id" :value="r.id">
            {{ r.name }} ({{ getRoleDisplayName(r.role) }})
          </option>
        </select>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">优先级</label>
        <select
          v-model="priority"
          class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
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
        <input
          v-model="dueDate"
          type="date"
          class="w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>

    <!-- 提交按钮 -->
    <button
      :disabled="!canSubmit || isSubmitting"
      class="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      @click="handleSubmit"
    >
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
    <div
      v-if="notification.type"
      :class="[
        'flex items-start gap-3 p-3 rounded-lg',
        notification.type === 'success'
          ? 'bg-green-50 text-green-800 border border-green-200'
          : 'bg-red-50 text-red-800 border border-red-200',
      ]"
    >
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
    <div
      v-if="!notification.type && missingFields.length > 0"
      class="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 p-2 rounded-lg"
    >
      <AlertCircle class="h-4 w-4" />
      <span>请填写必填字段：{{ missingFields.join('、') }}</span>
    </div>

    <!-- 外部校审浏览器 -->
    <ExternalReviewViewer
      v-model="showExternalReview"
      :project-id="currentProjectId"
    />
  </div>
</template>
