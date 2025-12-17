<script setup lang="ts">
import { computed, ref } from 'vue';

import { AlertCircle, ArrowRight, Calendar, FileText, Plus, Users, X } from 'lucide-vue-next';

import { useUserStore } from '@/composables/useUserStore';
import type { ReviewComponent } from '@/types/auth';
import { getRoleDisplayName } from '@/types/auth';

const userStore = useUserStore();

const packageName = ref('');
const description = ref('');
const reviewerId = ref('');
const priority = ref<'low' | 'medium' | 'high' | 'urgent'>('medium');
const dueDate = ref('');
const selectedComponents = ref<ReviewComponent[]>([
  { id: 'comp-001', name: '/1RCV0244', refNo: '24383_75021', type: '管道组件' },
]);

const isSubmitting = ref(false);
const notification = ref<{ type: 'success' | 'error' | null; message: string; details?: string }>({
  type: null,
  message: '',
  details: '',
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
    const task = userStore.createReviewTask({
      title: packageName.value,
      description: description.value || `模型数据包：${packageName.value}`,
      modelName: packageName.value,
      reviewerId: reviewerId.value,
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
    selectedComponents.value = [
      { id: 'comp-001', name: '/1RCV0244', refNo: '24383_75021', type: '管道组件' },
    ];
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
    <div class="border-b pb-3">
      <h3 class="text-lg font-semibold">创建提资单</h3>
      <p class="text-sm text-gray-500 mt-1">选择模型构件并指定审核人员</p>
    </div>

    <!-- 模型构件选择 -->
    <div class="space-y-2">
      <label class="text-sm font-medium">选择模型构件 *</label>
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
  </div>
</template>
