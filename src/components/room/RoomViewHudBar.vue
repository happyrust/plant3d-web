<script setup lang="ts">
/**
 * 房间视图视口顶部 HUD 横幅芯片（1:1 对齐 `plant-ui/crates/plant-ui/src/workbench/canvas.rs` `room_view_badge`）：
 * 仅当 `useRoomClip().active.value === true` 时显示于三维视口上方中央：
 * - 左段：门图标 + `房间视图 · <roomNum> · 成员 <memberCount>`
 * - 中段：「截断直段」四态可点芯片：
 *   1. 开启就绪（青色强调态）：`截断直段 开 · 截断 N 段`，悬停展示完整账本，点击切关；
 *   2. 加载 / 计算中（进度态）：`截断直段 done/total…`，点击仍可随时切关；
 *   3. 关闭态（中性灰态）：`截断直段 关`，悬停提示点击开启；
 *   4. 不可用态（琥珀告警态）：`截断直段 不可用`，悬停显示原因（如缺面板模型）。
 * - 右段：`× 退出` 按钮，一键恢复常规视图。
 */
import { computed } from 'vue';

import { AlertTriangle, DoorOpen, LoaderCircle, Scissors, X } from 'lucide-vue-next';

import { useRoomClip } from '@/composables/useRoomClip';
import { cn } from '@/lib/utils';

const roomClip = useRoomClip();

const phase = computed(() => roomClip.phase.value);
const truncateOn = computed(() => roomClip.truncateEnabled.value);

const chipState = computed<'ready-on' | 'busy' | 'off' | 'unavailable'>(() => {
  const p = phase.value;
  if (p.kind === 'unavailable') return 'unavailable';
  if (!truncateOn.value) return 'off';
  if (p.kind === 'loading' || p.kind === 'computing') return 'busy';
  return 'ready-on';
});

const chipText = computed(() => {
  const p = phase.value;
  if (p.kind === 'unavailable') return '截断直段 不可用';
  if (!truncateOn.value) return '截断直段 关';
  if (p.kind === 'loading' || p.kind === 'computing') {
    return p.total > 0 ? `截断直段 ${p.done}/${p.total}…` : '截断直段…';
  }
  if (p.kind === 'ready') {
    return `截断直段 开 · 截断 ${p.cut} 段`;
  }
  return '截断直段 开';
});

const chipTitle = computed(() => {
  const p = phase.value;
  if (p.kind === 'unavailable') {
    return `${p.reason}；点击可切换直段截断开关`;
  }
  if (!truncateOn.value) {
    return '直段按整根分支显示；点击只保留房间体内的那一截';
  }
  if (p.kind === 'loading') {
    return '正在加载房间面板与成员模型（点击可关掉截断）';
  }
  if (p.kind === 'computing') {
    return '正在按房间体截断穿墙直段（点击可关掉）';
  }
  if (p.kind === 'ready') {
    return `${roomClip.truncationSummaryText.value}（点击显示整根分支）`;
  }
  return '点击切换直段截断';
});
</script>

<template>
  <div v-if="roomClip.active.value"
    data-testid="room-view-hud-bar"
    class="pointer-events-auto absolute left-1/2 top-3 z-[942] flex -translate-x-1/2 items-center gap-2 rounded-full border border-sky-500/35 bg-slate-900/90 px-3 py-1 text-xs text-slate-100 shadow-lg backdrop-blur"
    @pointerdown.stop
    @wheel.stop>
    <div class="flex items-center gap-1.5"
      :title="roomClip.roomName.value ? `${roomClip.roomNum.value} · ${roomClip.roomName.value}（${roomClip.roomRefno.value}）` : (roomClip.roomRefno.value ?? '')">
      <DoorOpen class="h-3.5 w-3.5 shrink-0 text-sky-400" />
      <span class="font-medium text-sky-300">房间视图</span>
      <span class="text-slate-400">·</span>
      <span class="font-semibold text-white" data-testid="room-view-hud-room-num">{{ roomClip.roomNum.value }}</span>
      <span class="text-slate-400">·</span>
      <span class="tabular-nums text-slate-300">成员 {{ roomClip.memberCount.value }}</span>
    </div>

    <button type="button"
      data-testid="room-view-truncate-chip"
      :data-state="chipState"
      :title="chipTitle"
      :class="cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
        chipState === 'ready-on' && 'border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200 hover:bg-fuchsia-500/30',
        chipState === 'busy' && 'border-sky-400/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30',
        chipState === 'off' && 'border-slate-600 bg-slate-800/90 text-slate-300 hover:bg-slate-700',
        chipState === 'unavailable' && 'border-amber-400/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30',
      )"
      @click="roomClip.toggleRoomTubeTruncation()">
      <LoaderCircle v-if="chipState === 'busy'" class="h-3 w-3 animate-spin text-sky-300" />
      <AlertTriangle v-else-if="chipState === 'unavailable'" class="h-3 w-3 text-amber-300" />
      <Scissors v-else class="h-3 w-3" />
      <span>{{ chipText }}</span>
    </button>

    <button type="button"
      data-testid="room-view-hud-exit"
      title="退出房间视图并复原全部直段与隔离（Esc）"
      class="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-slate-300 transition-colors hover:bg-slate-700/80 hover:text-white"
      @click="roomClip.exitRoomView()">
      <X class="h-3.5 w-3.5" />
      <span>退出</span>
    </button>
  </div>
</template>