<script setup lang="ts">
/**
 * 「关联房间」浮窗（plant-ui「房间」页签的对应物，2026-10-16）：
 * 上半 = 选中构件的全部房间归属（`e3d.room.lookup`，按归属强度排，首条「主归属」）；
 * 点一间房 = 下半的房间详情 + 扁平成员预览（`rooms/{refno}/tree`，按 refno 去重、距离升序、封顶
 * `MEMBER_PREVIEW_LIMIT`）+「加载房间模型 / 聚焦飞行 / 隔离成员 / 在『房间』页签查看全部」四枚动作。
 *
 * 非模态卡片（不挡画布），标题栏可拖；状态在 `useRoomInfo`，打开入口：PDMS 树 / 房间树 / 三维视口
 * 右键「查看关联房间」、属性面板「房间」钮。
 */
import { computed, ref } from 'vue';

import { DoorOpen, ListTree, LoaderCircle, X } from 'lucide-vue-next';

import { useRoomClip } from '@/composables/useRoomClip';
import { MEMBER_PREVIEW_LIMIT, useRoomInfo } from '@/composables/useRoomInfo';
import { cn } from '@/lib/utils';

const roomInfo = useRoomInfo();
const roomClip = useRoomClip();

/** `center_dist` / 成员 `distance` 都是 mm；米级以上换米报一位小数（plant-ui `format_dist` 同款）。 */
function formatDist(mm: number | null): string {
  if (mm === null || !Number.isFinite(mm)) return '—';
  return mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm)} mm`;
}

const memberships = computed(() => roomInfo.memberships.value);

/** 归属空态的一句话（`calculation_status` 的措辞，见 useRoomInfo）。 */
const emptyText = computed(() => {
  const result = roomInfo.lookup.value;
  if (!result) return '';
  return roomInfo.emptyStatusText(result.calculationStatus, result.roomMembership);
});

const focusedRoom = computed(() => roomInfo.focusedRoom.value);
const focusedNode = computed(() => roomInfo.focusedRoomNode.value);
const memberPreview = computed(() => roomInfo.memberPreview.value);
const memberTotal = computed(() => roomInfo.focusedRoomNode.value?.count ?? roomInfo.memberRows.value.length);

/** 聚焦房间那一格归属的强度（切元素过渡期对不上就不显示，与 plant-ui 同一取法）。 */
const focusedStrength = computed(() => {
  const room = focusedRoom.value;
  if (!room) return null;
  return memberships.value.find((m) => m.roomRefno === room)?.insideCount ?? null;
});

/** 聚焦房间的面板数：树接口没有这一格，在册清单（`SpatialRoomOption.panel_count`）里补。 */
const focusedPanelCount = computed(() => roomInfo.roomOptionOf(focusedRoom.value)?.panel_count ?? null);

// ---- 拖拽：标题栏按下后按 pointer 位移改 left/top，限制在窗口内 ----
const cardPos = ref<{ left: number; top: number } | null>(null);
const cardEl = ref<HTMLElement | null>(null);

function onHeaderPointerDown(e: PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
  const el = cardEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const start = cardPos.value ?? { left: rect.left, top: rect.top };
  const startX = e.clientX;
  const startY = e.clientY;
  const header = e.currentTarget as HTMLElement;
  header.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    cardPos.value = {
      left: Math.min(Math.max(0, start.left + ev.clientX - startX), Math.max(0, window.innerWidth - 120)),
      top: Math.min(Math.max(0, start.top + ev.clientY - startY), Math.max(0, window.innerHeight - 60)),
    };
  };
  const stop = (ev: PointerEvent) => {
    header.removeEventListener('pointermove', move);
    header.removeEventListener('pointerup', stop);
    header.removeEventListener('pointercancel', stop);
    try { header.releasePointerCapture(ev.pointerId); } catch { /* 已释放 */ }
  };
  header.addEventListener('pointermove', move);
  header.addEventListener('pointerup', stop);
  header.addEventListener('pointercancel', stop);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="roomInfo.open.value"
      ref="cardEl"
      data-testid="room-info-dialog"
      class="fixed z-[9998] flex w-[380px] flex-col overflow-hidden rounded-md border border-border bg-background shadow-lg"
      :style="cardPos
        ? { left: `${cardPos.left}px`, top: `${cardPos.top}px`, right: 'auto' }
        : { right: '16px', top: '140px' }">
      <!-- 标题栏（拖拽把手） -->
      <div class="flex cursor-move select-none items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2"
        @pointerdown="onHeaderPointerDown">
        <DoorOpen class="h-3.5 w-3.5 text-muted-foreground" />
        <span class="text-xs font-medium text-foreground">关联房间</span>
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" :title="roomInfo.elementRefno.value ?? ''">
          {{ roomInfo.elementRefno.value }}
        </span>
        <button type="button"
          class="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          title="关闭"
          @click="roomInfo.close">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="max-h-[70vh] min-h-0 overflow-y-auto">
        <!-- 归属查询四态 -->
        <div v-if="roomInfo.phase.value === 'loading'" class="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <LoaderCircle class="h-3.5 w-3.5 animate-spin" /> 归属加载中…
        </div>
        <div v-else-if="roomInfo.phase.value === 'error'" class="px-3 py-3">
          <div class="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            房间归属查询失败：{{ roomInfo.errorMessage.value }}
          </div>
          <button type="button" class="mt-2 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted" @click="roomInfo.retry">重试</button>
        </div>
        <template v-else-if="roomInfo.phase.value === 'ready'">
          <div v-if="memberships.length === 0" class="px-3 py-4 text-xs text-muted-foreground">
            {{ emptyText }}
          </div>
          <template v-else>
            <div class="flex items-center justify-between px-3 pt-2 text-[11px] font-medium text-muted-foreground">
              <span>全部归属</span>
              <span>{{ memberships.length }}</span>
            </div>
            <div class="px-1.5 pb-1 pt-1">
              <button v-for="(m, i) in memberships" :key="m.panelRefno + i"
                type="button"
                :disabled="!m.roomRefno"
                :class="cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs',
                  m.roomRefno ? 'hover:bg-muted' : 'cursor-default opacity-60',
                  focusedRoom === m.roomRefno && 'bg-accent/60',
                )"
                :title="m.roomRefno ? `${m.roomRefno} · 面板 ${m.panelRefno}` : `面板 ${m.panelRefno} 不在在册房间名下`"
                @click="m.roomRefno && roomInfo.focusRoom(m.roomRefno)">
                <DoorOpen :class="cn('h-3.5 w-3.5 shrink-0', focusedRoom === m.roomRefno ? 'text-primary' : 'text-muted-foreground')" />
                <span class="shrink-0 font-medium text-foreground">{{ m.roomNum ?? '—' }}</span>
                <span v-if="i === 0" class="shrink-0 rounded bg-success-subtle px-1 text-[10px] text-success">主归属</span>
                <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {{ m.roomRefno ? (roomInfo.roomOptionOf(m.roomRefno)?.name ?? '') : '面板不在册（陈旧边）' }}
                </span>
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {{ m.insideCount !== null ? `顶点 ${m.insideCount}/8` : '' }}{{ m.centerDist !== null ? ` · ${formatDist(m.centerDist)}` : '' }}
                </span>
              </button>
            </div>
          </template>
        </template>

        <!-- 聚焦房间：概要 + 动作 + 成员预览 -->
        <div v-if="focusedRoom" class="border-t border-border">
          <div v-if="roomInfo.detailPhase.value === 'loading'" class="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <LoaderCircle class="h-3.5 w-3.5 animate-spin" /> 房间详情加载中…
          </div>
          <div v-else-if="roomInfo.detailPhase.value === 'error'" class="px-3 py-3">
            <div class="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{{ roomInfo.detailError.value }}</div>
            <button type="button" class="mt-2 rounded border border-border px-2 py-0.5 text-xs hover:bg-muted" @click="roomInfo.focusRoom(focusedRoom)">重试</button>
          </div>
          <template v-else-if="roomInfo.detailPhase.value === 'ready' && focusedNode">
            <div class="mx-3 mt-2 rounded-md border border-border bg-muted/30 px-2.5 py-2">
              <div class="flex items-baseline gap-2">
                <span class="text-sm font-semibold text-foreground">{{ focusedNode.room_num || '—' }}</span>
                <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" :title="focusedNode.name ?? ''">
                  {{ focusedNode.name ?? roomInfo.roomOptionOf(focusedRoom)?.name ?? focusedRoom }}
                </span>
              </div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">
                {{ focusedPanelCount !== null ? `面板 ${focusedPanelCount} · ` : '' }}成员 {{ focusedNode.count
                }}{{ focusedNode.tube_count ? ` · ${focusedNode.tube_count} 段直管` : ''
                }}{{ focusedStrength !== null ? ` · 强度 ${focusedStrength}/8` : '' }}
              </div>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <button type="button"
                  class="rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                  data-testid="room-info-load-models"
                  @click="roomInfo.loadRoomModels">
                  加载房间模型
                </button>
                <button type="button"
                  class="rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                  data-testid="room-info-fly-to"
                  @click="roomInfo.flyToRoom">
                  聚焦飞行
                </button>
                <button type="button"
                  class="rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                  data-testid="room-info-isolate"
                  @click="roomInfo.isolateRoom">
                  隔离成员
                </button>
                <button type="button"
                  :class="cn(
                    'rounded border px-2 py-0.5 text-[11px] transition-colors',
                    roomClip.truncateEnabled.value
                      ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 hover:bg-fuchsia-500/20 dark:text-fuchsia-300'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )"
                  data-testid="room-info-truncate-toggle"
                  title="切换房间视图穿墙直段截断（开启时穿墙直段在墙面截断并贴洋红断口）"
                  @click="roomClip.toggleRoomTubeTruncation()">
                  截断直段：{{ roomClip.truncateEnabled.value ? '开' : '关' }}
                </button>
                <button type="button"
                  class="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] hover:bg-muted"
                  data-testid="room-info-view-in-tree"
                  @click="roomInfo.viewInRoomTab(focusedRoom)">
                  <ListTree class="h-3 w-3" />在「房间」页签查看全部
                </button>
              </div>
            </div>

            <div class="flex items-center justify-between px-3 pt-2 text-[11px] font-medium text-muted-foreground">
              <span>成员预览</span>
              <span>{{ memberPreview.length }}/{{ memberTotal }}</span>
            </div>
            <div class="px-1.5 pb-2 pt-1">
              <button v-for="member in memberPreview" :key="member.refno"
                type="button"
                class="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs hover:bg-muted"
                :title="`${member.refno} · ${member.noun} · 距 ${formatDist(member.distance)}`"
                @click="roomInfo.locateMember(member.refno)">
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ member.noun }}</span>
                <span class="min-w-0 flex-1 truncate text-foreground">{{ member.refno }}</span>
                <span v-if="member.sharedRooms && member.sharedRooms > 1"
                  class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">跨 {{ member.sharedRooms }} 房</span>
                <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ formatDist(member.distance) }}</span>
              </button>
              <div v-if="memberTotal > memberPreview.length" class="px-1.5 py-1 text-[11px] text-muted-foreground">
                共 {{ memberTotal }} 个成员，此处预览前 {{ MEMBER_PREVIEW_LIMIT }} 个——全量层级去「房间」页签
              </div>
              <div v-else-if="memberPreview.length === 0" class="px-1.5 py-1 text-[11px] text-muted-foreground">
                这间房没有成员
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
