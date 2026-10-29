<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { impactLabel } from './nodeVersionPanelFormat';

import type { VersionScrubberState } from '@/composables/useVersionScrubber';
import type { ModelNodeDiffScope, ModelVersionImpactKind } from '@/model-source';
import type { LaidTick, TickCluster } from '@/utils/versionScrub/tickLayout';

import { formatModelUnitVersionTime } from '@/utils/modelUnitVersionCompare';
import { isGeometryChange } from '@/utils/versionScrub/cursorNav';

/**
 * 版本时间轴（spec `model-version-timeline-scrub`，tasks.md 15.1）。
 *
 * 只画与发事件：游标吸附 / 方向键 / 点击簇 / 缩放 / 钉 / 时间点解析都在 `useVersionScrubber`，
 * 这里负责把它算好的 `layout` 画成 SVG，并把指针、键盘、滚轮翻译成那几个方法。
 *
 * 「与上一版比 / 与最新比 / 复制链接 / 只看几何变的」仍留在 `NodeVersionTimeline.vue`（它们与纵向列表同排），
 * 这里只放轴自己的按钮：浏览 / 退出浏览 / 钉为 A / 钉为 B / 对比 A / B / 清除钉。
 */

const props = defineProps<{
  scrubber: VersionScrubberState;
  /** 轴宽（像素）；父组件用 `ResizeObserver` 喂 `useVersionScrubber` 的 `width`，这里只画 */
  width: number;
  /** 本范围版数（与列表表头同一个数）与「仅属性」数 */
  counts: { versions: number; attributeOnly: number };
  scope: ModelNodeDiffScope;
  /** 版本表请求失败：轴区域显示错误码与消息 + 「重试」（Requirement 1.12） */
  tableError: { code: string; message: string } | null;
  /** 每个刻度的加载 / 失败标记（Requirement 3.12、4.9） */
  tickStatus: ReadonlyMap<number, 'loading' | 'failed'>;
  /** 「只看几何变的」：勾上后没有几何变化版本时轴要报「没有可浏览的版本」（Requirement 2.11） */
  geometryOnly: boolean;
  browsing: boolean;
  /** 服务端没有实时历史查询：底部提示条（Requirement 10.1） */
  legacyFallback: boolean;
  shareStatus: 'idle' | 'copied' | 'address';
}>();

const emit = defineEmits<{
  retryTable: [];
  retryTick: [sesno: number];
  enterBrowse: [];
  exitBrowse: [];
  compare: [];
  copyLink: [];
  /** 轴容器宽度变化：父组件写进传给 `useVersionScrubber` 的 `width` */
  resize: [width: number];
}>();

const rootEl = ref<HTMLElement | null>(null);
const trackEl = ref<HTMLElement | null>(null);
const hover = ref<{ x: number; lines: string[] } | null>(null);
const dragging = ref<'cursor' | 'a' | 'b' | null>(null);

/** `impact_kind` → 刻度颜色（Requirement 1.4：每种取值一种互不相同的颜色） */
const IMPACT_COLOR: Record<ModelVersionImpactKind, string> = {
  mesh: '#f59e0b',
  placement: '#3b82f6',
  delivery: '#10b981',
  tombstone: '#f43f5e',
  noop: '#94a3b8',
};
const UNKNOWN_COLOR = '#cbd5e1';

function colorOf(impact: ModelVersionImpactKind | null): string {
  return impact === null ? UNKNOWN_COLOR : IMPACT_COLOR[impact];
}

/** 几何有变化 = 实心刻度；「仅属性」= 空心刻度（Requirement 1.4） */
function filledOf(impact: ModelVersionImpactKind | null): boolean {
  return isGeometryChange(impact);
}

const versions = computed(() => props.scrubber.versions.value);
const layout = computed(() => props.scrubber.layout.value);
const cursor = computed(() => props.scrubber.cursor.value);
const pins = computed(() => props.scrubber.pins.value);

/** 轴上出现过的 `impact_kind`，按首次出现的顺序做图例 */
const legend = computed(() => {
  const seen = new Map<ModelVersionImpactKind | null, number>();
  for (const version of versions.value) {
    seen.set(version.impactKind, (seen.get(version.impactKind) ?? 0) + 1);
  }
  return [...seen.entries()].map(([impact, count]) => ({ impact, count }));
});

/** 勾了「只看几何变的」时，轴上没有几何变化版本 = 无可浏览的版本（Requirement 2.11） */
const noNavigable = computed(() => {
  if (versions.value.length === 0) return true;
  if (!props.geometryOnly) return false;
  return !versions.value.some((v) => isGeometryChange(v.impactKind));
});

const emptyText = computed(() => {
  if (props.tableError) return null;
  if (versions.value.length === 0) return '该范围没有版本记录';
  if (noNavigable.value) return '当前范围没有可浏览的版本';
  return null;
});

/** 序号窗口文案：可见刻度的序号区间 / 总版数 */
const windowText = computed(() => {
  const ticks = layout.value.ticks;
  if (ticks.length === 0) return '0 / 0';
  const all = versions.value;
  const first = all.findIndex((v) => v.sesno === ticks[0]!.sesno);
  const last = all.findIndex((v) => v.sesno === ticks[ticks.length - 1]!.sesno);
  const from = first < 0 ? 1 : first + 1;
  const to = last < 0 ? all.length : last + 1;
  return `${from}–${to} / ${all.length}`;
});

function xOfOrdinal(ordinal: number): number {
  const { start, end } = props.scrubber.viewport.value;
  const span = end - start;
  if (!(span > 0)) return 0;
  return ((ordinal - start) / span) * props.width;
}

const cursorX = computed(() => (cursor.value === null ? null : xOfOrdinal(ordinalOf(cursor.value))));
const pinAX = computed(() => (pins.value.a === null ? null : xOfOrdinal(ordinalOf(pins.value.a))));
const pinBX = computed(() => (pins.value.b === null ? null : xOfOrdinal(ordinalOf(pins.value.b))));

function ordinalOf(sesno: number): number {
  const ghost = props.scrubber.ghosts.value.find((item) => item.sesno === sesno && item.role !== 'cursor');
  const index = versions.value.findIndex((v) => v.sesno === sesno);
  if (index >= 0) return index;
  return ghost ? ghost.ordinal : -0.5;
}

const cursorVersion = computed(() => versions.value.find((v) => v.sesno === cursor.value) ?? null);
const cursorGhost = computed(() => props.scrubber.ghosts.value.find((item) => item.role === 'cursor') ?? null);
const cursorAnomaly = computed(() => (cursor.value === null ? false : props.scrubber.anomalies.value.has(cursor.value)));

/** 游标标注：sesno + 时间（缺时间显示「无时间」）+ 「时间异常」（Requirement 2.7） */
const cursorLabel = computed(() => {
  const value = cursor.value;
  if (value === null) return null;
  const time = cursorVersion.value?.sessionTime
    ? formatModelUnitVersionTime(cursorVersion.value.sessionTime)
    : '无时间';
  const anomaly = cursorAnomaly.value ? ' · 时间异常' : '';
  return `sesno ${value} · ${time}${anomaly}`;
});

function tickTitle(sesno: number): string[] {
  const version = versions.value.find((v) => v.sesno === sesno);
  if (!version) return [`sesno ${sesno}`, '本范围无变化'];
  const lines = [
    `sesno ${sesno}`,
    version.sessionTime ? formatModelUnitVersionTime(version.sessionTime) : '无时间',
    `影响：${impactLabel(version.impactKind)}`,
    `保存人：${version.author ?? '—'}`,
    `备注：${version.note ?? '—'}`,
  ];
  if (props.scope === 'subtree') lines.push(`单元：${version.changedUnits ?? '—'}`);
  const anomalyFrom = props.scrubber.anomalies.value.get(sesno);
  if (anomalyFrom !== undefined) {
    const prev = versions.value.find((v) => v.sesno === anomalyFrom);
    lines.push(`时间异常：早于 sesno ${anomalyFrom}（${prev?.sessionTime ? formatModelUnitVersionTime(prev.sessionTime) : '无时间'}）`);
  }
  const status = props.tickStatus.get(sesno);
  if (status === 'failed') lines.push('查询失败 · 点「重试」重新查询');
  else if (status === 'loading') lines.push('正在加载');
  return lines;
}

function clusterTitle(cluster: TickCluster): string[] {
  const first = versions.value.find((v) => v.sesno === cluster.first);
  const last = versions.value.find((v) => v.sesno === cluster.last);
  const text = (value: string | null | undefined): string => (value ? formatModelUnitVersionTime(value) : '无时间');
  return [
    `${cluster.sesnos.length} 个版本（sesno ${cluster.first} – ${cluster.last}）`,
    `最早：sesno ${cluster.first} · ${text(first?.sessionTime)}`,
    `最晚：sesno ${cluster.last} · ${text(last?.sessionTime)}`,
    ...(cluster.anomaly ? ['簇内含时间异常'] : []),
    '点击放大到这一簇',
  ];
}

// ---------------------------------------------------------------------------
// 指针：拖动游标 / 拖动钉；按 rAF 合帧，每帧最多吸附一次
// ---------------------------------------------------------------------------

let frame = 0;
let pendingX: number | null = null;

function trackX(event: PointerEvent): number {
  const rect = trackEl.value?.getBoundingClientRect();
  if (!rect) return 0;
  return event.clientX - rect.left;
}

function onPointerDown(event: PointerEvent, role: 'cursor' | 'a' | 'b' = 'cursor'): void {
  if (emptyText.value !== null || props.tableError) return;
  dragging.value = role;
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  if (role === 'cursor') snapTo(trackX(event));
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  if (dragging.value === null) return;
  pendingX = trackX(event);
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const x = pendingX;
    pendingX = null;
    if (x === null) return;
    snapTo(x);
  });
}

function snapTo(x: number): void {
  const role = dragging.value;
  if (role === 'cursor' || role === null) {
    props.scrubber.pointerSnap(x);
    return;
  }
  // 拖钉：吸附到最近的刻度后写回该侧（Requirement 5.8）
  const nearest = nearestSesno(x);
  if (nearest !== null) props.scrubber.dragPin(role, nearest);
}

function nearestSesno(x: number): number | null {
  const ticks = layout.value.ticks;
  if (ticks.length === 0) return null;
  let best: LaidTick | null = null;
  for (const tick of ticks) {
    if (!best || Math.abs(tick.x - x) < Math.abs(best.x - x)) best = tick;
  }
  return best?.sesno ?? null;
}

function onPointerUp(): void {
  if (dragging.value === null) return;
  const role = dragging.value;
  dragging.value = null;
  if (role === 'cursor') props.scrubber.pointerRelease();
}

// ---------------------------------------------------------------------------
// 键盘 / 滚轮 / 点击
// ---------------------------------------------------------------------------

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    props.scrubber.step(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    props.scrubber.step(1);
  }
}

function onWheel(event: WheelEvent): void {
  if (emptyText.value !== null) return;
  event.preventDefault();
  const rect = trackEl.value?.getBoundingClientRect();
  const x = rect ? event.clientX - rect.left : 0;
  props.scrubber.zoom(x, event.deltaY > 0 ? 1.25 : 0.8);
}

function onTickClick(sesno: number): void {
  if (emptyText.value !== null) return;
  // 点击刻度 = 把游标放到该版；不可导航（「仅属性」）时 `clickTick` 不动它（Requirement 2.9）
  const cluster = layout.value.clusters.find((item) => item.sesnos.includes(sesno));
  if (cluster && cluster.sesnos.length > 1) {
    props.scrubber.clickCluster(cluster);
    return;
  }
  const x = xOfOrdinal(versions.value.findIndex((v) => v.sesno === sesno));
  props.scrubber.pointerSnap(x);
  props.scrubber.pointerRelease();
}

const dateText = ref('');

async function submitDate(): Promise<void> {
  await props.scrubber.resolveDate(dateText.value);
}

// ---------------------------------------------------------------------------
// 宽度
// ---------------------------------------------------------------------------

let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!trackEl.value) return;
  observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width > 0 && Math.abs(width - props.width) > 0.5) emit('resize', width);
  });
  observer.observe(trackEl.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  if (frame !== 0) cancelAnimationFrame(frame);
});
</script>

<template>
  <div ref="rootEl" class="select-none" data-testid="version-timeline-scrubber">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold text-foreground" data-testid="version-timeline-scrubber-head">
        版本时间轴 · {{ scope === 'subtree' ? '子树' : '本范围' }} {{ counts.versions }} 版<template v-if="counts.attributeOnly"> · 仅属性 {{ counts.attributeOnly }}</template>
      </h3>
      <span class="text-[10px] tabular-nums text-muted-foreground" data-testid="version-timeline-scrubber-window">{{ windowText }}</span>
    </div>

    <!-- 版本表错误（Requirement 1.12）：显示错误码与消息 + 重试 -->
    <div v-if="tableError" class="mt-2 flex items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700"
      data-testid="version-timeline-scrubber-error">
      <span class="font-mono">{{ tableError.code }}</span>
      <span class="min-w-0 flex-1 truncate" :title="tableError.message">{{ tableError.message }}</span>
      <button type="button" class="rounded border border-rose-300 px-1.5 py-0.5 hover:bg-rose-100"
        data-testid="version-timeline-scrubber-retry-table" @click="emit('retryTable')">
        重试
      </button>
    </div>

    <!-- 空态（Requirement 1.11、2.11） -->
    <p v-else-if="emptyText" class="mt-2 rounded border border-dashed border-border px-2 py-3 text-center text-[10px] text-muted-foreground"
      data-testid="version-timeline-scrubber-empty">
      {{ emptyText }}
    </p>

    <template v-else>
      <div ref="trackEl" class="relative mt-2 h-14 w-full touch-none rounded border border-border bg-muted/20"
        tabindex="0" role="slider" aria-label="版本时间轴"
        :aria-valuenow="cursor ?? undefined" :aria-valuetext="cursorLabel ?? undefined"
        data-testid="version-timeline-scrubber-track"
        @keydown="onKeydown"
        @wheel="onWheel"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp">
        <svg class="absolute inset-0 h-full w-full" :viewBox="`0 0 ${Math.max(1, width)} 56`" preserveAspectRatio="none"
          data-testid="version-timeline-scrubber-svg">
          <!-- 基线 -->
          <line :x1="0" :x2="Math.max(1, width)" y1="36" y2="36" stroke="#cbd5e1" stroke-width="1" />

          <!-- 簇刻度（Requirement 1.7）：带数量，悬停显示首尾 -->
          <g v-for="cluster in layout.clusters" :key="`c-${cluster.first}-${cluster.last}`"
            :data-testid="`version-timeline-scrubber-cluster-${cluster.first}`">
            <rect v-if="cluster.sesnos.length > 1" :x="cluster.x - 3" y="26" width="6" height="20" rx="2"
              :fill="cluster.anomaly ? '#fb7185' : '#94a3b8'" opacity="0.55" class="cursor-pointer"
              @click.stop="onTickClick(cluster.last)"
              @mouseenter="hover = { x: cluster.x, lines: clusterTitle(cluster) }"
              @mouseleave="hover = null" />
            <text v-if="cluster.sesnos.length > 1" :x="cluster.x" y="20" text-anchor="middle" font-size="9"
              fill="#475569" class="pointer-events-none">{{ cluster.sesnos.length }}</text>
          </g>

          <!-- 刻度（Requirement 1.4、1.7）：几何变化实心、仅属性空心；失败红点、加载脉冲 -->
          <g v-for="tick in layout.ticks" :key="`t-${tick.sesno}`" :data-testid="`version-timeline-scrubber-tick-${tick.sesno}`">
            <line :x1="tick.x" :x2="tick.x" y1="30" y2="42" :stroke="colorOf(versions.find((v) => v.sesno === tick.sesno)?.impactKind ?? null)"
              stroke-width="1" opacity="0.5" />
            <circle :cx="tick.x" cy="36" :r="tickStatus.get(tick.sesno) === 'failed' ? 3.5 : 2.5"
              :fill="filledOf(versions.find((v) => v.sesno === tick.sesno)?.impactKind ?? null)
                ? colorOf(versions.find((v) => v.sesno === tick.sesno)?.impactKind ?? null)
                : '#ffffff'"
              :stroke="tickStatus.get(tick.sesno) === 'failed'
                ? '#e11d48'
                : colorOf(versions.find((v) => v.sesno === tick.sesno)?.impactKind ?? null)"
              stroke-width="1.2" class="cursor-pointer"
              :data-status="tickStatus.get(tick.sesno) ?? ''"
              @click.stop="onTickClick(tick.sesno)"
              @mouseenter="hover = { x: tick.x, lines: tickTitle(tick.sesno) }"
              @mouseleave="hover = null" />
            <!-- Time_Anomaly_Marker（Requirement 1.3） -->
            <circle v-if="scrubber.anomalies.value.has(tick.sesno)" :cx="tick.x" cy="28" r="2"
              fill="#f43f5e" class="pointer-events-none"
              :data-testid="`version-timeline-scrubber-anomaly-${tick.sesno}`" />
          </g>

          <!-- 次级时间标注（Requirement 1.2） -->
          <text v-for="label in layout.labels" :key="`l-${label.sesno}`" :x="label.x" y="52" text-anchor="middle"
            font-size="8" fill="#94a3b8" class="pointer-events-none">{{ label.text }}</text>

          <!-- 灰标「本范围无变化」（Requirement 1.10） -->
          <g v-for="ghost in scrubber.ghosts.value" :key="`g-${ghost.role}-${ghost.sesno}`"
            :data-testid="`version-timeline-scrubber-ghost-${ghost.role}`">
            <circle :cx="xOfOrdinal(ghost.ordinal)" cy="36" r="3" fill="none" stroke="#cbd5e1" stroke-dasharray="2 2" />
            <text :x="xOfOrdinal(ghost.ordinal)" y="20" text-anchor="middle" font-size="8" fill="#94a3b8"
              class="pointer-events-none">本范围无变化</text>
          </g>

          <!-- 钉标记（Requirement 5.1） -->
          <g v-if="pinAX !== null" data-testid="version-timeline-scrubber-pin-a">
            <path :d="`M ${pinAX} 6 l -4 6 l 8 0 z`" fill="#3b82f6" class="cursor-grab"
              @pointerdown.stop="onPointerDown($event, 'a')" />
            <text :x="pinAX" y="22" text-anchor="middle" font-size="8" fill="#1d4ed8" class="pointer-events-none">A</text>
          </g>
          <g v-if="pinBX !== null" data-testid="version-timeline-scrubber-pin-b">
            <path :d="`M ${pinBX} 6 l -4 6 l 8 0 z`" fill="#10b981" class="cursor-grab"
              @pointerdown.stop="onPointerDown($event, 'b')" />
            <text :x="pinBX" y="22" text-anchor="middle" font-size="8" fill="#047857" class="pointer-events-none">B</text>
          </g>

          <!-- 游标（Requirement 2.1）：只改 transform -->
          <g v-if="cursorX !== null" :transform="`translate(${cursorX} 0)`" class="cursor-ew-resize"
            data-testid="version-timeline-scrubber-cursor"
            :data-sesno="cursor ?? ''"
            @pointerdown.stop="onPointerDown($event, 'cursor')">
            <line x1="0" x2="0" y1="8" y2="44" stroke="#0f172a" stroke-width="1.5" />
            <circle cx="0" cy="36" r="4.5" fill="#0f172a" />
          </g>
        </svg>

        <!-- 悬停提示（Requirement 1.5、1.7） -->
        <div v-if="hover" class="pointer-events-none absolute bottom-full z-20 mb-1 w-max max-w-[16rem] -translate-x-1/2 rounded border border-border bg-popover px-2 py-1 text-[10px] leading-4 text-popover-foreground shadow"
          :style="{ left: `${hover.x}px` }" data-testid="version-timeline-scrubber-tooltip">
          <div v-for="(line, i) in hover.lines" :key="i" :class="i === 0 ? 'font-semibold' : ''">{{ line }}</div>
        </div>
      </div>

      <!-- 游标标注（Requirement 2.7） -->
      <p class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span class="font-medium text-foreground" data-testid="version-timeline-scrubber-cursor-label">{{ cursorLabel ?? '—' }}</span>
        <span v-if="cursorGhost" class="text-amber-600" data-testid="version-timeline-scrubber-cursor-ghost">
          游标 sesno {{ cursorGhost.sesno }} 不在本范围
        </span>
        <span v-if="tickStatus.get(cursor ?? -1) === 'failed'" class="text-rose-600">
          查询失败
          <button type="button" class="ml-1 underline" data-testid="version-timeline-scrubber-retry-tick"
            @click="emit('retryTick', cursor!)">
            重试
          </button>
        </span>
        <span v-else-if="tickStatus.get(cursor ?? -1) === 'loading'" class="text-sky-600" data-testid="version-timeline-scrubber-loading">
          正在加载
        </span>
      </p>

      <!-- 图例（Requirement 1.4） -->
      <div class="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground" data-testid="version-timeline-scrubber-legend">
        <span v-for="item in legend" :key="`legend-${item.impact ?? 'none'}`" class="flex items-center gap-1">
          <svg width="8" height="8" viewBox="0 0 8 8">
            <circle cx="4" cy="4" r="3" :fill="filledOf(item.impact) ? colorOf(item.impact) : '#ffffff'"
              :stroke="colorOf(item.impact)" stroke-width="1" />
          </svg>
          {{ impactLabel(item.impact) }}
        </span>
        <span class="ml-auto flex items-center gap-1">
          <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2" fill="#ffffff" stroke="#94a3b8" stroke-width="1" /></svg>
          仅属性（空心）
        </span>
        <span class="flex items-center gap-1">
          <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2" fill="#f43f5e" /></svg>
          时间异常
        </span>
      </div>
    </template>

    <!-- 日期输入（Requirement 8.8、8.9） -->
    <div class="mt-2 flex items-center gap-1.5">
      <input v-model="dateText" type="text" placeholder="跳到某一时刻，回车定位"
        class="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
        data-testid="version-timeline-scrubber-date" @keydown.enter="submitDate" />
      <span v-if="scrubber.dateError.value" class="text-[10px] text-rose-600" data-testid="version-timeline-scrubber-date-error">
        {{ scrubber.dateError.value }}
      </span>
    </div>
    <p v-if="scrubber.legacyResolve.value" class="mt-1 text-[10px] text-amber-600" data-testid="version-timeline-scrubber-legacy-resolve">
      服务端没有时间点解析，已在本地按版本表解析
    </p>
    <p v-if="scrubber.notice.value" class="mt-1 text-[10px] text-amber-600" data-testid="version-timeline-scrubber-notice">
      {{ scrubber.notice.value }}
    </p>

    <!-- 轴自己的按钮 -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <button v-if="!browsing" type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50 disabled:opacity-40"
        :disabled="cursor === null || emptyText !== null"
        data-testid="version-timeline-scrubber-browse" @click="emit('enterBrowse')">
        浏览
      </button>
      <button v-else type="button" class="rounded-md border border-foreground bg-foreground px-2 py-1 text-background hover:opacity-90"
        data-testid="version-timeline-scrubber-exit-browse" @click="emit('exitBrowse')">
        退出浏览
      </button>
      <button type="button" class="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-blue-800 hover:bg-blue-100 disabled:opacity-40"
        :disabled="cursor === null || pins.b === cursor"
        data-testid="version-timeline-scrubber-pin-a-button" @click="scrubber.pin('a')">
        钉为 A
      </button>
      <button type="button" class="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
        :disabled="cursor === null || pins.a === cursor"
        data-testid="version-timeline-scrubber-pin-b-button" @click="scrubber.pin('b')">
        钉为 B
      </button>
      <button type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50 disabled:opacity-40"
        :disabled="pins.a === null || pins.b === null"
        data-testid="version-timeline-scrubber-compare" @click="emit('compare')">
        对比 A / B
      </button>
      <button type="button" class="rounded-md border border-border bg-background px-2 py-1 text-foreground hover:bg-muted/50 disabled:opacity-40"
        :disabled="pins.a === null && pins.b === null"
        data-testid="version-timeline-scrubber-clear-pins" @click="scrubber.clearPins()">
        清除钉
      </button>
      <button type="button"
        class="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-[10px] text-foreground hover:bg-muted/50"
        :aria-label="shareStatus === 'copied' ? '链接已复制' : '复制链接'"
        data-testid="version-timeline-scrubber-copy-link" @click="emit('copyLink')">
        {{ shareStatus === 'copied' ? '✓' : '链' }}
      </button>
    </div>

    <p v-if="legacyFallback" class="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700"
      data-testid="version-timeline-scrubber-legacy">
      服务端没有实时历史查询，改用逐版生成
    </p>
  </div>
</template>
