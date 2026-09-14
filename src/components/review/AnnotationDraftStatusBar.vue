<script setup lang="ts">
import { computed } from 'vue';

import { CircleAlert, CircleCheck, CircleDashed, Cloud, HardDrive } from 'lucide-vue-next';

import { buildAnnotationDraftStatusRows, type DraftStatusRow, type DraftStatusTone } from './annotationDraftStatusRows';

import type { DraftSaveStatus } from '@/composables/useAnnotationDraftSession';

/**
 * U0 三行状态条（方案 2026-09-14 §3.6，决策 d-565 #4）：「本机草稿 / 云端草稿 / 已确认」分开显示，
 * 取代「localStorage 写了就打绿勾」。文案与语气在 `annotationDraftStatusRows.ts`（纯函数，可单测）。
 */

const props = defineProps<{
  status: DraftSaveStatus;
  draftCount: number;
  hasUnconfirmedChanges: boolean;
  confirmedRecordCount: number;
  lastConfirmedAt: number | null;
  localWriteError?: string | null;
}>();

const rows = computed<DraftStatusRow[]>(() => buildAnnotationDraftStatusRows({
  status: props.status,
  draftCount: props.draftCount,
  hasUnconfirmedChanges: props.hasUnconfirmedChanges,
  confirmedRecordCount: props.confirmedRecordCount,
  lastConfirmedAt: props.lastConfirmedAt,
  localWriteError: props.localWriteError ?? null,
}));

const TONE_CLASS: Record<DraftStatusTone, string> = {
  neutral: 'text-muted-foreground',
  ok: 'text-success',
  warn: 'text-warning',
  danger: 'text-danger',
};

function iconFor(row: DraftStatusRow) {
  if (row.tone === 'danger') return CircleAlert;
  if (row.id === 'local') return HardDrive;
  if (row.id === 'remote') return Cloud;
  return row.tone === 'ok' ? CircleCheck : CircleDashed;
}
</script>

<template>
  <div class="mt-3 grid gap-1 border-t border-slate-200 pt-3 text-xs"
    data-testid="annotation-draft-status-bar">
    <div v-for="row in rows"
      :key="row.id"
      class="flex items-start gap-1.5"
      :class="TONE_CLASS[row.tone]"
      :data-testid="`annotation-draft-status-${row.id}`"
      :data-state="row.state">
      <component :is="iconFor(row)" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span class="font-medium">{{ row.label }}</span>
        <span v-if="row.detail" class="ml-1 text-muted-foreground">{{ row.detail }}</span>
      </span>
    </div>
  </div>
</template>
