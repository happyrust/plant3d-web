<script setup lang="ts">
import { computed, ref } from 'vue';

import {
  ChevronDown,
  Download,
  ExternalLink,
  File,
  FileText,
} from 'lucide-vue-next';

import type { ReviewAttachment } from '@/types/auth';

const props = withDefaults(defineProps<{
  attachments?: ReviewAttachment[];
}>(), {
  attachments: () => [],
});

type FileGroup = {
  label: string;
  items: ReviewAttachment[];
};

const expandedGroups = ref<Set<string>>(new Set(['all']));

const groups = computed<FileGroup[]>(() => {
  if (props.attachments.length === 0) return [];

  const byType = new Map<string, ReviewAttachment[]>();
  for (const att of props.attachments) {
    const ext = att.name.split('.').pop()?.toLowerCase() || 'other';
    const group = ext === 'pdf' ? 'PDF 文件' :
      ext === 'dwg' || ext === 'dxf' ? 'CAD 图纸' :
        ext === 'xlsx' || ext === 'xls' || ext === 'csv' ? '表格文件' :
          ext === 'png' || ext === 'jpg' || ext === 'jpeg' ? '图片文件' :
            '其他文件';
    if (!byType.has(group)) byType.set(group, []);
    byType.get(group)!.push(att);
  }

  return Array.from(byType.entries()).map(([label, items]) => ({ label, items }));
});

function toggleGroup(label: string) {
  if (expandedGroups.value.has(label)) {
    expandedGroups.value.delete(label);
  } else {
    expandedGroups.value.add(label);
  }
  expandedGroups.value = new Set(expandedGroups.value);
}

function downloadFile(attachment: ReviewAttachment) {
  const link = document.createElement('a');
  link.href = attachment.url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' || ext === 'doc' || ext === 'docx') return FileText;
  return File;
}

function getSourceLabel(attachment: ReviewAttachment): string {
  const type = attachment.type || attachment.mimeType || '';
  if (type.includes('model')) return '模型';
  if (type.includes('drawing')) return '图纸';
  return '上传';
}
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white p-6">
    <!-- Header -->
    <div class="mb-4">
      <h3 class="text-base font-semibold text-slate-900">关联校验文件</h3>
      <p class="mt-1 text-xs text-slate-500">以下文件根据当前选择的模型构件自动关联</p>
    </div>

    <!-- Empty state -->
    <div v-if="attachments.length === 0"
      class="py-8 text-center text-sm text-slate-400">
      暂无关联文件
    </div>

    <!-- File groups -->
    <div v-else class="flex flex-col gap-3">
      <div v-for="group in groups" :key="group.label"
        class="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <!-- Group header -->
        <button type="button"
          class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
          @click="toggleGroup(group.label)">
          <ChevronDown class="h-4 w-4 shrink-0 text-slate-400 transition-transform"
            :class="{ '-rotate-90': !expandedGroups.has(group.label) }" />
          <span class="text-sm font-medium text-slate-700">{{ group.label }}</span>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {{ group.items.length }}
          </span>
        </button>

        <!-- Group body -->
        <div v-show="expandedGroups.has(group.label)"
          class="border-t border-slate-200 bg-slate-50">
          <div v-for="item in group.items" :key="item.id"
            class="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0 hover:bg-slate-100">
            <component :is="getFileIcon(item.name)" class="h-4 w-4 shrink-0 text-slate-400" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-slate-700">{{ item.name }}</div>
              <div class="text-[11px] text-slate-400">{{ formatFileSize(item.size) }}</div>
            </div>
            <span class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
              {{ getSourceLabel(item) }}
            </span>
            <button type="button"
              class="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              title="下载"
              @click="downloadFile(item)">
              <Download class="h-3.5 w-3.5" />
            </button>
            <button type="button"
              class="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              title="打开">
              <ExternalLink class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
