<script setup lang="ts">
import { computed, ref } from 'vue';

import { FileText, Trash2, Upload, X, AlertCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-vue-next';

import { hasAttachmentLineage, shouldAutoUploadAttachments } from './reviewAttachmentFlow';

import { reviewAttachmentUploadWithProgress } from '@/api/reviewApi';

// 上传文件类型定义
export type UploadedFile = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
  serverAttachmentId?: string; // 服务器返回的附件ID
  serverUrl?: string; // 服务器返回的文件URL
}

// Props
type Props = {
  modelValue: UploadedFile[];
  maxFiles?: number;
  maxSize?: number; // MB
  acceptTypes?: string;
  disabled?: boolean;
  autoUpload?: boolean; // 是否自动上传
  taskId?: string | null; // 关联的任务ID（创建任务前可为空）
  formId?: string | null; // 可选的稳定单据号，创建任务前可先用于附件归档
}

const props = withDefaults(defineProps<Props>(), {
  maxFiles: 10,
  maxSize: 50,
  acceptTypes: '.pdf,.dwg,.dxf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg',
  disabled: false,
  autoUpload: true,
  taskId: null,
  formId: null,
});

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: UploadedFile[]): void;
  (e: 'uploadComplete', file: UploadedFile): void;
  (e: 'uploadError', file: UploadedFile, error: Error): void;
}>();

// 拖拽状态
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

// 计算属性
const canAddMore = computed(() => props.modelValue.length < props.maxFiles);

const totalSize = computed(() => {
  return props.modelValue.reduce((sum, f) => sum + f.size, 0);
});

const uploadingCount = computed(() => {
  return props.modelValue.filter((f) => f.status === 'uploading').length;
});

const pendingCount = computed(() => {
  return props.modelValue.filter((f) => f.status === 'pending').length;
});

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 生成唯一 ID
function generateId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// 验证文件
function validateFile(file: File): { valid: boolean; error?: string } {
  // 检查文件大小
  const maxBytes = props.maxSize * 1024 * 1024;
  if (file.size > maxBytes) {
    return { valid: false, error: `文件大小超过 ${props.maxSize}MB 限制` };
  }

  // 检查文件类型（简单验证）
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const acceptedTypes = props.acceptTypes.split(',').map((t) => t.trim().toLowerCase());
  if (!acceptedTypes.some((t) => ext === t || t === '.*')) {
    return { valid: false, error: `不支持的文件类型: ${ext}` };
  }

  return { valid: true };
}

// 更新单个文件状态
function updateFileStatus(id: string, updates: Partial<UploadedFile>) {
  const newList = props.modelValue.map((f) => {
    if (f.id === id) {
      return { ...f, ...updates };
    }
    return f;
  });
  emit('update:modelValue', newList);
}

// 上传单个文件
async function uploadFile(
  uploadedFile: UploadedFile,
  lineage: { taskId?: string | null; formId?: string | null } = {},
) {
  const taskId = lineage.taskId ?? props.taskId;
  const formId = lineage.formId ?? props.formId;

  if (!hasAttachmentLineage(taskId, formId)) {
    return;
  }

  // 更新状态为上传中
  updateFileStatus(uploadedFile.id, { status: 'uploading', progress: 0 });

  try {
    const result = await reviewAttachmentUploadWithProgress(
      taskId || null,
      uploadedFile.file,
      (percent) => {
        // 进度回调
        updateFileStatus(uploadedFile.id, { progress: percent });
      },
      formId ? { formId } : undefined,
    );

    if (result.success && result.attachment) {
      // 上传成功
      updateFileStatus(uploadedFile.id, {
        status: 'success',
        progress: 100,
        serverAttachmentId: result.attachment.id,
        serverUrl: result.attachment.url,
      });
      
      const updatedFile = props.modelValue.find((f) => f.id === uploadedFile.id);
      if (updatedFile) {
        emit('uploadComplete', updatedFile);
      }
    } else {
      throw new Error(result.error_message || '上传失败');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '上传失败';
    updateFileStatus(uploadedFile.id, {
      status: 'error',
      progress: 0,
      errorMessage,
    });
    
    const updatedFile = props.modelValue.find((f) => f.id === uploadedFile.id);
    if (updatedFile) {
      emit('uploadError', updatedFile, error instanceof Error ? error : new Error(errorMessage));
    }
  }
}

// 添加文件并可选自动上传
function addFiles(files: FileList | File[]) {
  if (props.disabled) return;

  const fileArray = Array.from(files);
  const newFiles: UploadedFile[] = [];

  for (const file of fileArray) {
    // 检查数量限制
    if (props.modelValue.length + newFiles.length >= props.maxFiles) {
      console.warn(`已达到最大文件数量限制: ${props.maxFiles}`);
      break;
    }

    // 检查是否已存在同名文件
    const exists = props.modelValue.some((f) => f.name === file.name && f.size === file.size);
    if (exists) {
      console.warn(`文件已存在: ${file.name}`);
      continue;
    }

    // 验证文件
    const validation = validateFile(file);
    const uploadedFile: UploadedFile = {
      id: generateId(),
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      status: validation.valid ? 'pending' : 'error',
      progress: 0,
      errorMessage: validation.error,
    };

    newFiles.push(uploadedFile);
  }

  if (newFiles.length > 0) {
    emit('update:modelValue', [...props.modelValue, ...newFiles]);
    
    // 如果开启自动上传，立即开始上传
    if (shouldAutoUploadAttachments(props.autoUpload, props.taskId, props.formId)) {
      // 使用 nextTick 确保状态已更新
      setTimeout(() => {
        newFiles
          .filter((f) => f.status === 'pending')
          .forEach((f) => uploadFile(f));
      }, 0);
    }
  }
}

// 手动触发上传（用于非自动上传模式）
async function startUpload(lineage: { taskId?: string | null; formId?: string | null } = {}) {
  const taskId = lineage.taskId ?? props.taskId;
  const formId = lineage.formId ?? props.formId;
  if (!hasAttachmentLineage(taskId, formId)) {
    return;
  }

  await Promise.all(
    props.modelValue
      .filter((f) => f.status === 'pending')
      .map((f) => uploadFile(f, { taskId, formId }))
  );
}

// 重试上传失败的文件
function retryUpload(id: string) {
  const file = props.modelValue.find((f) => f.id === id);
  if (file && file.status === 'error') {
    updateFileStatus(id, { status: 'pending', errorMessage: undefined });
    uploadFile(file);
  }
}

// 删除文件
function removeFile(id: string) {
  if (props.disabled) return;
  emit(
    'update:modelValue',
    props.modelValue.filter((f) => f.id !== id)
  );
}

// 清空所有文件
function clearAll() {
  if (props.disabled) return;
  emit('update:modelValue', []);
}

// 拖拽处理
function handleDragEnter(e: DragEvent) {
  e.preventDefault();
  if (!props.disabled) {
    isDragging.value = true;
  }
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;

  if (props.disabled || !e.dataTransfer?.files) return;
  addFiles(e.dataTransfer.files);
}

// 点击上传
function triggerFileInput() {
  if (!props.disabled && fileInputRef.value) {
    fileInputRef.value.click();
  }
}

function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    addFiles(input.files);
    input.value = ''; // 清空 input 以允许重复选择同一文件
  }
}

// 获取状态图标
function getStatusIcon(status: UploadedFile['status']) {
  switch (status) {
    case 'uploading':
      return Loader2;
    case 'success':
      return CheckCircle;
    case 'error':
      return AlertCircle;
    default:
      return FileText;
  }
}

function getStatusClass(status: UploadedFile['status']): string {
  switch (status) {
    case 'uploading':
      return 'text-blue-500 animate-spin';
    case 'success':
      return 'text-green-500';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}

// 暴露方法给父组件
defineExpose({
  startUpload,
  retryUpload,
});
</script>

<template>
  <div class="file-upload-section">
    <!-- 拖拽上传区域 -->
    <div :class="[
           'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
           isDragging
             ? 'border-blue-500 bg-blue-50'
             : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
           disabled && 'opacity-50 cursor-not-allowed',
           !canAddMore && 'opacity-50',
         ]"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @click="triggerFileInput">
      <Upload class="h-8 w-8 mx-auto mb-2 text-gray-400" />
      <p class="text-sm text-gray-600">
        <span v-if="canAddMore"> 拖拽文件到此处，或 <span class="text-blue-600">点击上传</span> </span>
        <span v-else class="text-orange-600"> 已达到最大文件数量 ({{ maxFiles }} 个) </span>
      </p>
      <p class="text-xs text-gray-400 mt-1">
        单文件最大 {{ maxSize }}MB，最多 {{ maxFiles }} 个文件
      </p>
    </div>

    <!-- 隐藏的文件输入 -->
    <input ref="fileInputRef"
      type="file"
      multiple
      :accept="acceptTypes"
      :disabled="disabled || !canAddMore"
      class="hidden"
      @change="handleFileInputChange" />

    <!-- 文件列表 -->
    <div v-if="modelValue.length > 0" class="mt-4 space-y-2">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">
          已添加 {{ modelValue.length }} 个文件 ({{ formatFileSize(totalSize) }})
          <span v-if="uploadingCount > 0" class="text-blue-500 ml-2">
            正在上传 {{ uploadingCount }} 个...
          </span>
        </span>
        <div class="flex gap-2">
          <button v-if="!autoUpload && pendingCount > 0"
            class="text-xs text-blue-500 hover:text-blue-700"
            @click.stop="startUpload">
            开始上传
          </button>
          <button v-if="!disabled"
            class="text-xs text-red-500 hover:text-red-700"
            @click.stop="clearAll">
            清空全部
          </button>
        </div>
      </div>

      <div v-for="file in modelValue"
        :key="file.id"
        :class="[
          'flex items-center gap-3 p-3 rounded-lg border',
          file.status === 'error' ? 'bg-red-50 border-red-200' : 
          file.status === 'success' ? 'bg-green-50 border-green-200' :
          file.status === 'uploading' ? 'bg-blue-50 border-blue-200' :
          'bg-gray-50 border-gray-200',
        ]">
        <!-- 文件图标/状态 -->
        <component :is="getStatusIcon(file.status)"
          class="h-5 w-5 flex-shrink-0"
          :class="getStatusClass(file.status)" />

        <!-- 文件信息 -->
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 truncate">{{ file.name }}</p>
          <p class="text-xs text-gray-500">
            {{ formatFileSize(file.size) }}
            <span v-if="file.status === 'uploading'" class="text-blue-500 ml-2">
              {{ file.progress }}%
            </span>
            <span v-if="file.status === 'success'" class="text-green-500 ml-2">
              已上传
            </span>
            <span v-if="file.errorMessage" class="text-red-500 ml-2">{{ file.errorMessage }}</span>
          </p>

          <!-- 上传进度条 -->
          <div v-if="file.status === 'uploading'" class="mt-1">
            <div class="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div class="h-full bg-blue-500 transition-all duration-300"
                :style="{ width: `${file.progress}%` }" />
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center gap-1">
          <!-- 重试按钮（失败时显示） -->
          <button v-if="file.status === 'error'"
            class="p-1 hover:bg-red-100 rounded text-red-400 hover:text-red-600"
            title="重试上传"
            @click.stop="retryUpload(file.id)">
            <RefreshCw class="h-4 w-4" />
          </button>
          
          <!-- 删除按钮 -->
          <button v-if="!disabled && file.status !== 'uploading'"
            class="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
            @click.stop="removeFile(file.id)">
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-upload-section {
  width: 100%;
}
</style>

