<script setup lang="ts">
import { computed, ref } from 'vue';

import { Box, ExternalLink, Home, Loader2, RefreshCw, Search } from 'lucide-vue-next';

import { useRoomInfoPanel } from '@/composables/useRoomInfoPanel';

const roomInfo = useRoomInfoPanel();
const inputRefno = ref('');

const primaryRows = computed(() => {
  const info = roomInfo.current.value;
  if (!info) return [];
  const attrs = info.attrs;
  return [
    ['房间名称', roomInfo.displayName.value],
    ['房间 Refno', info.roomRefno],
    ['房型 / TYPE', roomInfo.roomType.value],
    ['描述', roomInfo.description.value],
    ['Owner', roomInfo.ownerName.value],
    ['来源构件', info.sourceRefno],
  ].filter(([, value]) => String(value || '').trim());
});

const detailRows = computed(() => {
  const info = roomInfo.current.value;
  if (!info) return [];
  const priority = new Set(['NAME', 'REFNO', 'TYPE', 'DESC', 'DESCRIPTION', 'OWNER']);
  return Object.entries(info.attrs)
    .filter(([key]) => !priority.has(key.toUpperCase()))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, formatValue(value)] as const);
});

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function loadInput() {
  const refno = inputRefno.value.trim();
  if (!refno) return;
  void roomInfo.loadForRefno(refno);
}

function refreshCurrent() {
  const refno = roomInfo.current.value?.sourceRefno || roomInfo.current.value?.roomRefno || inputRefno.value.trim();
  if (!refno) return;
  void roomInfo.loadForRefno(refno);
}
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <div class="shrink-0 border-b border-border px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-sm font-semibold text-foreground">房型房间信息</div>
          <div class="mt-0.5 text-[11px] text-muted-foreground">按构件或房间 Refno 查看所在房间</div>
        </div>
        <button type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
          title="刷新"
          :disabled="roomInfo.loading.value"
          @click="refreshCurrent">
          <Loader2 v-if="roomInfo.loading.value" class="h-4 w-4 animate-spin" />
          <RefreshCw v-else class="h-4 w-4" />
        </button>
      </div>

      <div class="mt-2 flex gap-1.5">
        <input v-model="inputRefno"
          type="text"
          class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:border-brand"
          placeholder="构件或房间 Refno，例如 24381_145018"
          @keydown.enter="loadInput" />
        <button type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          :disabled="roomInfo.loading.value || !inputRefno.trim()"
          @click="loadInput">
          <Search class="h-3.5 w-3.5" />
          查询
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-3">
      <div v-if="roomInfo.error.value" class="rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs text-danger">
        {{ roomInfo.error.value }}
      </div>

      <div v-if="!roomInfo.current.value && !roomInfo.loading.value && !roomInfo.error.value"
        class="flex h-full items-center justify-center text-center text-xs text-muted-foreground">
        选择模型后右键“查看所在房间信息”，或在上方输入 Refno。
      </div>

      <div v-if="roomInfo.current.value" class="space-y-3">
        <section class="rounded-md border border-border bg-card">
          <div class="flex items-center gap-2 border-b border-border px-3 py-2">
            <Home class="h-4 w-4 text-brand" />
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-foreground">{{ roomInfo.displayName.value }}</div>
              <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">{{ roomInfo.current.value.roomRefno }}</div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 p-3">
            <div class="rounded-md bg-muted/60 px-2 py-1.5">
              <div class="text-[10px] uppercase text-muted-foreground">房型</div>
              <div class="mt-0.5 truncate text-sm font-semibold text-foreground">{{ roomInfo.roomType.value }}</div>
            </div>
            <div class="rounded-md bg-muted/60 px-2 py-1.5">
              <div class="text-[10px] uppercase text-muted-foreground">描述</div>
              <div class="mt-0.5 truncate text-sm font-semibold text-foreground">{{ roomInfo.description.value || '-' }}</div>
            </div>
          </div>
        </section>

        <section class="rounded-md border border-border bg-card">
          <div class="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">核心信息</div>
          <table class="w-full text-xs">
            <tbody>
              <tr v-for="[key, value] in primaryRows" :key="key" class="border-b border-border/40 last:border-b-0">
                <td class="w-28 px-3 py-2 text-muted-foreground">{{ key }}</td>
                <td class="px-3 py-2 font-mono text-foreground">{{ value }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="grid grid-cols-2 gap-2">
          <button type="button"
            class="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs text-foreground hover:bg-muted"
            @click="roomInfo.viewRoomProperties">
            <ExternalLink class="h-3.5 w-3.5" />
            属性面板
          </button>
          <button type="button"
            class="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-input bg-background text-xs text-foreground hover:bg-muted disabled:opacity-50"
            :disabled="roomInfo.modelLoading.value"
            @click="roomInfo.showRoomModel()">
            <Loader2 v-if="roomInfo.modelLoading.value" class="h-3.5 w-3.5 animate-spin" />
            <Box v-else class="h-3.5 w-3.5" />
            显示房间模型
          </button>
        </div>

        <div v-if="roomInfo.modelError.value" class="rounded-md border border-warning/25 bg-warning-subtle px-2.5 py-2 text-xs text-warning">
          {{ roomInfo.modelError.value }}
        </div>

        <section class="rounded-md border border-border bg-card">
          <div class="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">全部属性</div>
          <div class="max-h-80 overflow-auto">
            <table class="w-full text-xs">
              <tbody>
                <tr v-for="[key, value] in detailRows" :key="key" class="border-b border-border/40 last:border-b-0">
                  <td class="w-32 px-3 py-1.5 text-muted-foreground">{{ key }}</td>
                  <td class="px-3 py-1.5 font-mono text-foreground">{{ value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
