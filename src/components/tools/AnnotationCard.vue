<script setup lang="ts">
import { computed } from 'vue';

import {
  Eye,
  EyeOff,
  Focus,
  MessageSquare,
  Trash2,
} from 'lucide-vue-next';

import type { AnyAnnotationRecord, AnnotationType } from '@/composables/useToolStore';
import { getRoleTheme, type UserRole } from '@/types/auth';

const props = defineProps<{
  record: AnyAnnotationRecord;
  type: AnnotationType;
  isActive: boolean;
  commentCount?: number;
  authorRole?: UserRole;
  authorName?: string;
  thumbnailUrl?: string;
}>();

const emit = defineEmits<{
  (e: 'select'): void;
  (e: 'fly'): void;
  (e: 'toggle-visible'): void;
  (e: 'remove'): void;
}>();

const title = computed(() => {
  const rec = props.record as Record<string, unknown>;
  const t = rec.title as string | undefined;
  return t?.trim() || '未命名批注';
});

const description = computed(() => {
  const rec = props.record as Record<string, unknown>;
  const d = rec.description as string | undefined;
  return d?.trim() || '';
});

const roleTheme = computed(() => {
  if (!props.authorRole) return null;
  return getRoleTheme(props.authorRole);
});

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  const dayDiff = Math.floor(diff / 86_400_000);
  if (dayDiff === 1) {
    return '昨天 ' + new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
    ' ' +
    new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="cursor-pointer rounded-md border p-3 transition-colors"
    :class="isActive
      ? 'border-[#FDBA74] bg-[#FFF7ED] shadow-sm'
      : 'border-[#E5E7EB] bg-[#F9FAFB] hover:border-[#D1D5DB] hover:bg-white'"
    @click="emit('select')">
    <!-- Header: title + time -->
    <div class="flex items-start justify-between gap-2">
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-[#111827]">{{ title }}</span>
      <span class="shrink-0 text-[11px] text-[#9CA3AF]">{{ formatTime(record.createdAt) }}</span>
    </div>

    <!-- Thumbnail area (optional) -->
    <div v-if="thumbnailUrl"
      class="mt-2 flex items-center justify-center overflow-hidden rounded bg-[#E5E7EB]"
      style="height: 140px;">
      <img :src="thumbnailUrl" alt="批注截图" class="h-full w-full object-cover" />
    </div>

    <!-- Description -->
    <p v-if="description && !thumbnailUrl" class="mt-1 text-xs text-[#4B5563]">{{ description }}</p>

    <!-- Footer: author dot + name + actions -->
    <div class="mt-2 flex items-center justify-between">
      <div class="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
        <div v-if="roleTheme"
          class="h-2 w-2 shrink-0 rounded-full"
          :style="{ backgroundColor: roleTheme.dotColor }" />
        <span v-if="authorName">{{ authorName }}</span>
      </div>
      <div class="flex items-center gap-0.5">
        <button type="button"
          class="rounded p-1 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#3B82F6]"
          title="定位"
          @click.stop="emit('fly')">
          <Focus class="h-3.5 w-3.5" />
        </button>
        <button type="button"
          class="rounded p-1 text-[#9CA3AF] hover:bg-[#F3F4F6]"
          :title="record.visible ? '隐藏' : '显示'"
          @click.stop="emit('toggle-visible')">
          <component :is="record.visible ? EyeOff : Eye" class="h-3.5 w-3.5" />
        </button>
        <div v-if="(commentCount ?? 0) > 0" class="flex items-center gap-0.5 px-1 text-[11px] text-[#9CA3AF]">
          <MessageSquare class="h-3 w-3" />
          <span>{{ commentCount }}</span>
        </div>
        <button type="button"
          class="rounded p-1 text-[#9CA3AF] hover:bg-[#FEF2F2] hover:text-[#EF4444]"
          title="删除"
          @click.stop="emit('remove')">
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
