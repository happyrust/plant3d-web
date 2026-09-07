<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, watch } from 'vue';

import { FileText, Upload, X, AlertCircle, CheckCircle, Loader2, RefreshCw, Ban } from 'lucide-vue-next';

import {
  ATTACHMENT_UPLOAD_CONCURRENCY,
  formatAttachmentSize,
  formatAttachmentUploadError,
  hasAttachmentLineage,
  runWithConcurrency,
  shouldAutoUploadAttachments,
} from './reviewAttachmentFlow';

import {
  isAttachmentUploadAborted,
  reviewAttachmentDelete,
  reviewAttachmentUploadWithProgress,
} from '@/api/reviewApi';

// 上传文件类型定义
// `file` 仅本地待上传条目必有；后端恢复的历史附件没有本地 File 对象。
export type UploadedFile = {
  id: string;
  file?: File;
  name: string;
  size: number;
  type: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  errorMessage?: string;
  serverAttachmentId?: string; // 服务器返回的附件ID
  serverUrl?: string; // 服务器返回的文件URL
  uploadedAt?: number; // 恢复附件的上传时间（毫秒）
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

defineOptions({
  inheritAttrs: false,
});

// Emits
const emit = defineEmits<{
  (e: 'update:modelValue', value: UploadedFile[]): void;
  (e: 'uploadComplete', file: UploadedFile): void;
  (e: 'uploadError', file: UploadedFile, error: Error): void;
  (e: 'uploadCancel', file: UploadedFile): void;
}>();

// 进行中的上传，用于取消；仅在上传期间持有，settle 后立即清理
const uploadControllers = new Map<string, AbortController>();

/**
 * 同一 tick 内可能连续更新多次（例如刚置为「上传中」，进度回调立刻又来一次），
 * 而 props.modelValue 要等父组件回流后才刷新。若每次都以 props 为基准计算新列表，
 * 后一次更新会把前一次覆盖掉——典型症状是上传中状态被进度回调抹平，取消按钮不出现。
 * 这里以「最近一次提交的列表」为基准，父组件回流后再交还给 props。
 */
let pendingFiles: UploadedFile[] | null = null;

function currentFiles(): UploadedFile[] {
  return pendingFiles ?? props.modelValue;
}

function commitFiles(next: UploadedFile[]) {
  pendingFiles = next;
  emit('update:modelValue', next);
}

watch(() => props.modelValue, () => {
  pendingFiles = null;
});

// 拖拽状态
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const rootAttrs = useAttrs();

// 被拒绝加入列表的文件提示（重复、超出数量等），不再只写控制台
const rejectionNotices = ref<string[]>([]);

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
  commitFiles(currentFiles().map((f) => {
    if (f.id === id) {
      return { ...f, ...updates };
    }
    return f;
  }));
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

  // 恢复的历史附件没有本地 File 对象，无法（也不需要）重新上传
  const localFile = uploadedFile.file;
  if (!localFile) {
    updateFileStatus(uploadedFile.id, {
      status: 'error',
      progress: 0,
      errorMessage: '本地文件已失效，请移除后重新选择',
    });
    return;
  }

  // 更新状态为上传中
  updateFileStatus(uploadedFile.id, { status: 'uploading', progress: 0 });

  const controller = new AbortController();
  uploadControllers.set(uploadedFile.id, controller);

  try {
    const result = await reviewAttachmentUploadWithProgress(
      taskId || null,
      localFile,
      (percent) => {
        // 进度回调
        updateFileStatus(uploadedFile.id, { progress: percent });
      },
      { ...(formId ? { formId } : {}), signal: controller.signal },
    );

    if (result.success && result.attachment) {
      // 上传成功
      updateFileStatus(uploadedFile.id, {
        status: 'success',
        progress: 100,
        serverAttachmentId: result.attachment.id,
        serverUrl: result.attachment.url,
      });
      
      const updatedFile = currentFiles().find((f) => f.id === uploadedFile.id);
      if (updatedFile) {
        emit('uploadComplete', updatedFile);
      }
    } else {
      throw new Error(result.error_message || '上传失败');
    }
  } catch (error) {
    // 取消不是失败：只标记可重试，并让父级有机会刷新任务
    // （请求体可能已发完，服务端仍会落一条附件）
    if (isAttachmentUploadAborted(error)) {
      updateFileStatus(uploadedFile.id, {
        status: 'error',
        progress: 0,
        errorMessage: '已取消上传，可重试或移除',
      });
      const cancelledFile = currentFiles().find((f) => f.id === uploadedFile.id);
      if (cancelledFile) {
        emit('uploadCancel', cancelledFile);
      }
      return;
    }

    const status = (error as { status?: number } | null)?.status;
    const rawMessage = error instanceof Error ? error.message : '上传失败';
    const errorMessage = formatAttachmentUploadError(status ?? null, rawMessage);
    updateFileStatus(uploadedFile.id, {
      status: 'error',
      progress: 0,
      errorMessage,
    });
    
    const updatedFile = currentFiles().find((f) => f.id === uploadedFile.id);
    if (updatedFile) {
      emit('uploadError', updatedFile, error instanceof Error ? error : new Error(errorMessage));
    }
  } finally {
    uploadControllers.delete(uploadedFile.id);
  }
}

/** 取消单个进行中的上传 */
function cancelUpload(id: string) {
  uploadControllers.get(id)?.abort();
}

// 组件卸载时中止所有在途上传，避免回调写进已销毁的组件
onBeforeUnmount(() => {
  for (const controller of uploadControllers.values()) {
    controller.abort();
  }
  uploadControllers.clear();
});

// 添加文件并可选自动上传
function addFiles(files: FileList | File[]) {
  if (props.disabled) return;

  rejectionNotices.value = [];
  const fileArray = Array.from(files);
  const newFiles: UploadedFile[] = [];

  for (const file of fileArray) {
    // 检查数量限制
    if (currentFiles().length + newFiles.length >= props.maxFiles) {
      rejectionNotices.value = [
        ...rejectionNotices.value,
        `已达到最大文件数量限制（${props.maxFiles} 个），「${file.name}」及后续文件未加入`,
      ];
      break;
    }

    // 按“文件名 + 大小”阻止重复文件加入，并在界面提示
    const exists = currentFiles().some((f) => f.name === file.name && f.size === file.size);
    if (exists) {
      rejectionNotices.value = [
        ...rejectionNotices.value,
        `文件已存在，未重复加入：${file.name}`,
      ];
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
    commitFiles([...currentFiles(), ...newFiles]);
    
    // 如果开启自动上传，立即开始上传
    if (shouldAutoUploadAttachments(props.autoUpload, props.taskId, props.formId)) {
      // 使用 nextTick 确保状态已更新
      setTimeout(() => {
        void runWithConcurrency(
          newFiles.filter((f) => f.status === 'pending'),
          ATTACHMENT_UPLOAD_CONCURRENCY,
          (f) => uploadFile(f),
        );
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

  await runWithConcurrency(
    currentFiles().filter((f) => f.status === 'pending'),
    ATTACHMENT_UPLOAD_CONCURRENCY,
    (f) => uploadFile(f, { taskId, formId }),
  );
}

// 重试上传失败的文件
function retryUpload(id: string) {
  const file = currentFiles().find((f) => f.id === id);
  if (file && file.status === 'error') {
    updateFileStatus(id, { status: 'pending', errorMessage: undefined });
    uploadFile(file);
  }
}

// 删除文件：已上传到服务器的条目先删除服务端附件（记录 + 磁盘文件），
// 否则任务恢复时会把仅在本地移除的附件重新合并回来。
async function removeFile(id: string) {
  if (props.disabled) return;
  const target = currentFiles().find((f) => f.id === id);
  if (!target) return;

  cancelUpload(id);

  const serverAttachmentId = target.serverAttachmentId?.trim();
  if (serverAttachmentId) {
    try {
      const result = await reviewAttachmentDelete(serverAttachmentId);
      if (!result.success) {
        throw new Error(result.error_message || result.message || '删除失败');
      }
    } catch (error) {
      updateFileStatus(id, {
        errorMessage: `删除失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      });
      return;
    }
  }

  commitFiles(currentFiles().filter((f) => f.id !== id));
}

// 清空所有文件
function clearAll() {
  if (props.disabled) return;
  for (const file of currentFiles()) {
    cancelUpload(file.id);
  }
  commitFiles([]);
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

  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as Node | null;
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
    return;
  }

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

// 拖拽区是 div，键盘用户拿不到原生按钮语义，这里补上 Enter / Space
function handleDropzoneKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  triggerFileInput();
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
      return 'text-brand animate-spin';
    case 'success':
      return 'text-success';
    case 'error':
      return 'text-danger';
    default:
      return 'text-muted-foreground';
  }
}

// 暴露方法给父组件
defineExpose({
  startUpload,
  retryUpload,
  cancelUpload,
});
</script>

<template>
  <div class="file-upload-section" v-bind="rootAttrs">
    <!-- 拖拽上传区域 -->
    <div :class="[
           'rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer',
           'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
           isDragging
             ? 'border-brand bg-brand-subtle'
             : 'border-input hover:border-muted-foreground/50 hover:bg-muted/60',
           disabled && 'opacity-60 cursor-not-allowed',
           !canAddMore && 'opacity-60',
         ]"
      data-testid="file-upload-dropzone"
      role="button"
      :tabindex="disabled || !canAddMore ? -1 : 0"
      :aria-disabled="disabled || !canAddMore ? 'true' : 'false'"
      aria-label="选择或拖拽文件上传"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
      @keydown="handleDropzoneKeydown"
      @click="triggerFileInput">
      <Upload class="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm text-foreground">
        <span v-if="canAddMore">拖拽文件到此处，或 <span class="font-medium text-brand">点击上传</span></span>
        <span v-else class="text-warning">已达到最大文件数量（{{ maxFiles }} 个）</span>
      </p>
      <p class="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
        单文件最大 {{ maxSize }}MB · 最多 {{ maxFiles }} 个
      </p>
    </div>

    <!-- 隐藏的文件输入 -->
    <input ref="fileInputRef"
      type="file"
      multiple
      :accept="acceptTypes"
      :disabled="disabled || !canAddMore"
      data-testid="file-upload-input"
      class="hidden"
      @change="handleFileInputChange" />

    <!-- 拒绝加入提示（重复文件 / 超出数量） -->
    <div v-if="rejectionNotices.length > 0"
      class="mt-2 space-y-1"
      data-testid="file-upload-rejection-notices">
      <p v-for="(notice, index) in rejectionNotices"
        :key="`${index}-${notice}`"
        class="flex items-center gap-1.5 text-xs text-warning">
        <AlertCircle class="h-3.5 w-3.5 shrink-0" />
        {{ notice }}
      </p>
    </div>

    <!-- 文件列表 -->
    <div v-if="modelValue.length > 0" class="mt-4 space-y-2">
      <div class="mb-2 flex items-center justify-between gap-3">
        <span class="text-sm text-muted-foreground">
          已添加 <span class="font-mono tabular-nums text-foreground">{{ modelValue.length }}</span> 个文件
          <span class="font-mono tabular-nums">({{ formatAttachmentSize(totalSize) }})</span>
          <span v-if="uploadingCount > 0" class="ml-2 text-brand">
            正在上传 <span class="font-mono tabular-nums">{{ uploadingCount }}</span> 个…
          </span>
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <button v-if="!autoUpload && pendingCount > 0"
            type="button"
            class="h-7 rounded-md px-2 text-xs font-medium text-brand transition-colors hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            data-testid="file-upload-start-button"
            @click.stop="startUpload">
            开始上传
          </button>
          <button v-if="!disabled"
            type="button"
            class="h-7 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
            @click.stop="clearAll">
            清空全部
          </button>
        </div>
      </div>

      <div v-for="file in modelValue"
        :key="file.id"
        :class="[
          'flex items-center gap-3 rounded-lg border p-3 transition-colors',
          file.status === 'error' ? 'border-danger/40 bg-danger-subtle' :
          file.status === 'success' ? 'border-success/40 bg-success-subtle' :
          file.status === 'uploading' ? 'border-brand/40 bg-brand-subtle' :
          'border-border bg-muted/50',
        ]">
        <!-- 文件图标/状态 -->
        <component :is="getStatusIcon(file.status)"
          class="h-5 w-5 shrink-0"
          :class="getStatusClass(file.status)"
          aria-hidden="true" />

        <!-- 文件信息 -->
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-foreground">{{ file.name }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            <span class="font-mono tabular-nums">{{ formatAttachmentSize(file.size) }}</span>
            <span v-if="file.status === 'uploading'" class="ml-2 font-mono tabular-nums text-brand">
              {{ file.progress }}%
            </span>
            <span v-if="file.status === 'success'" class="ml-2 text-success">
              已上传
            </span>
            <span v-if="file.errorMessage" class="ml-2 text-danger">{{ file.errorMessage }}</span>
          </p>

          <!-- 上传进度条 -->
          <div v-if="file.status === 'uploading'" class="mt-1.5">
            <div class="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              :aria-valuenow="file.progress"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`${file.name} 上传进度`">
              <div class="h-full rounded-full bg-brand transition-[width] duration-300 ease-out motion-reduce:transition-none"
                data-testid="file-upload-progress-bar"
                :style="{ width: `${Math.max(file.progress, 2)}%` }" />
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex shrink-0 items-center gap-1">
          <!-- 取消按钮（上传中显示；大文件误传时不必干等） -->
          <button v-if="file.status === 'uploading'"
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
            title="取消上传"
            aria-label="取消上传"
            data-testid="file-upload-cancel-button"
            @click.stop="cancelUpload(file.id)">
            <Ban class="h-4 w-4" aria-hidden="true" />
          </button>

          <!-- 重试按钮（失败时显示） -->
          <button v-if="file.status === 'error'"
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-danger transition-colors hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
            title="重试上传"
            aria-label="重试上传"
            data-testid="file-upload-retry-button"
            @click.stop="retryUpload(file.id)">
            <RefreshCw class="h-4 w-4" aria-hidden="true" />
          </button>

          <!-- 删除按钮 -->
          <button v-if="!disabled && file.status !== 'uploading'"
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            title="移除"
            :aria-label="`移除 ${file.name}`"
            data-testid="file-upload-remove-button"
            @click.stop="removeFile(file.id)">
            <X class="h-4 w-4" aria-hidden="true" />
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

