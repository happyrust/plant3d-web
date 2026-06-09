<script setup lang="ts">
import { computed } from 'vue';

import type {
  MbdFittingDto,
  MbdPipeViewMode,
  MbdPipeEnvelopeDto,
  MbdStructureClearanceDto,
  Vec3,
} from '@/api/mbdPipeApi';
import type { MbdPipeUiTab, UseMbdPipeAnnotationThreeReturn } from '@/composables/useMbdPipeAnnotationThree';

import { isReviewDebugUiEnabled } from '@/components/review/debugUiGate';

const props = defineProps<{
  vis: UseMbdPipeAnnotationThreeReturn;
}>();

defineEmits<(e: 'close') => void>();

const tab = computed({
  get: () => props.vis.uiTab.value,
  set: (v) => {
    props.vis.uiTab.value = v as MbdPipeUiTab;
  },
});

const showDebugUi = isReviewDebugUiEnabled();

const mbdViewModeModel = computed({
  get: () => props.vis.mbdViewMode.value,
  set: (v) => {
    props.vis.mbdViewMode.value = v === 'inspection'
      ? 'inspection'
      : v === 'construction'
        ? 'construction'
        : 'layout_first';
  },
});

const data = computed(() => props.vis.currentData.value);
const stats = computed(() => data.value?.stats ?? null);
const layoutStats = computed(() => data.value?.layout_result?.stats ?? null);
const branchName = computed(() => data.value?.branch_name ?? '');
const branchRefno = computed(() => data.value?.branch_refno ?? '');
const inputRefno = computed(() => data.value?.input_refno ?? '');

const welds = computed(() => data.value?.welds ?? []);
const slopes = computed(() => data.value?.slopes ?? []);
const bends = computed(() => data.value?.bends ?? []);
const fittings = computed(() => data.value?.fittings ?? []);
const tags = computed(() => data.value?.tags ?? []);
const segments = computed(() => data.value?.segments ?? []);
const pipeClearances = computed(() => data.value?.pipe_clearances ?? []);
const structureClearances = computed(() => data.value?.structure_clearances ?? []);
const attrs = computed(() => data.value?.branch_attrs ?? null);
const elevationMarks = computed(() => props.vis.resolveElevationMarks(data.value));
const envelope = computed(() => props.vis.resolveEnvelopeData(data.value));
const linearDimCount = computed(() => (
  layoutStats.value?.linear_dims_count ??
  stats.value?.dims_count ??
  data.value?.dims?.length ??
  0
));
const cutTubiDimCount = computed(() => (
  layoutStats.value?.cut_tubis_count ??
  stats.value?.cut_tubis_count ??
  data.value?.cut_tubis?.length ??
  0
));

function formatNumber(value: unknown, digits = 0): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '--';
}

function formatLength(value: unknown, digits = 0): string {
  return `${formatNumber(value, digits)} mm`;
}

function formatPoint(point?: Vec3 | null): string {
  if (!point || point.length !== 3) return '--';
  return point.map((v) => formatNumber(v, 0)).join(', ');
}

function formatEnvelopeSize(source: MbdPipeEnvelopeDto | null): string {
  if (!source) return '--';
  return `X ${formatLength(source.size[0])} · Y ${formatLength(source.size[1])} · Z ${formatLength(source.size[2])}`;
}

function structureKindLabel(kind: MbdStructureClearanceDto['target_kind'] | string): string {
  if (kind === 'beam') return '梁';
  if (kind === 'slab') return '板';
  if (kind === 'column') return '柱';
  if (kind === 'wall') return '墙';
  return '结构';
}

function classifyFitting(
  fitting: Partial<MbdFittingDto> | null | undefined,
): 'elbow' | 'branch' | 'flange' {
  const raw = `${fitting?.kind ?? ''} ${fitting?.noun ?? ''}`.toUpperCase();
  if (
    raw.includes('TEE') ||
    raw.includes('BRANCH') ||
    raw.includes('OLET')
  ) {
    return 'branch';
  }
  if (raw.includes('FLAN')) return 'flange';
  return 'elbow';
}

function modeLabel(mode: MbdPipeViewMode): string {
  if (mode === 'layout_first') return '版面优先模式';
  return mode === 'inspection' ? '校核模式' : '施工模式';
}

function renderSourceLabel(source: 'layout_result' | 'fallback' | null): string {
  if (source === 'layout_result') return 'layout_result（后端版面）';
  if (source === 'fallback') return 'fallback（前端回退）';
  return '未生成';
}

const actualRenderSource = computed(() => (
  data.value ? props.vis.renderSource?.value ?? null : null
));

const isLayoutFallback = computed(() => (
  !!data.value &&
  props.vis.mbdViewMode.value === 'layout_first' &&
  props.vis.renderSource?.value === 'fallback'
));

const segmentTotalLength = computed(() =>
  segments.value.reduce((sum, segment) => sum + Number(segment.length ?? 0), 0)
);

const fittingSummary = computed(() => ({
  elbow: fittings.value.filter((f) => classifyFitting(f) === 'elbow').length,
  branch: fittings.value.filter((f) => classifyFitting(f) === 'branch').length,
  flange: fittings.value.filter((f) => classifyFitting(f) === 'flange').length,
}));

const minPipeClearance = computed(() => {
  const values = pipeClearances.value
    .map((item) => Number(item.distance))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.min(...values) : null;
});

const minStructureClearance = computed(() => {
  const values = structureClearances.value
    .map((item) => Number(item.distance))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.min(...values) : null;
});

const minClearance = computed(() => {
  const values = [minPipeClearance.value, minStructureClearance.value]
    .filter((value): value is number => value != null && Number.isFinite(value));
  return values.length > 0 ? Math.min(...values) : null;
});

const elevationRange = computed(() => {
  const values = elevationMarks.value
    .map((item) => Number(item.elevation_mm))
    .filter((value) => Number.isFinite(value));
  if (values.length <= 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
});

const diameterHighlights = computed(() => {
  const items: {
    id: string;
    segmentId: string;
    role: string;
    refno: string;
    outsideDiameter: number | null;
    bore: number | null;
    length: number;
  }[] = [];
  const segs = segments.value;
  for (let index = 0; index < segs.length; index += 1) {
    const segment = segs[index]!;
    const prev = index > 0 ? segs[index - 1] : null;
    const isStart = index === 0;
    const isEnd = index === segs.length - 1;
    const changed = !!prev && (
      Number(prev.outside_diameter ?? NaN) !== Number(segment.outside_diameter ?? NaN) ||
      Number(prev.bore ?? NaN) !== Number(segment.bore ?? NaN)
    );

    if (!isStart && !isEnd && !changed) continue;
    items.push({
      id: `diameter-${segment.id}-${isStart ? 'start' : isEnd ? 'end' : 'change'}`,
      segmentId: segment.id,
      role: isStart ? '起点' : isEnd ? '终点' : '变径',
      refno: segment.refno,
      outsideDiameter: segment.outside_diameter ?? null,
      bore: segment.bore ?? null,
      length: Number(segment.length ?? 0),
    });
  }
  return items;
});

const materialEntries = computed(() => {
  const source = attrs.value;
  if (!source) return [];
  return [
    { label: '介质', value: source.duty ?? '' },
    { label: '管道等级', value: source.pspec ?? '' },
    { label: 'FLUID', value: source.fluid ?? '' },
    { label: '保温', value: source.ispec ?? '' },
    { label: '保温厚度', value: source.insuthick ?? '' },
    { label: '伴热', value: source.tspec ?? '' },
    { label: '设计压力', value: source.pressure ?? '' },
    { label: '设计温度', value: source.temp ?? '' },
    { label: 'RCCM', value: source.rccm ?? '' },
    { label: '清洁度', value: source.clean ?? '' },
    { label: '图号', value: source.drawnum ?? '' },
    { label: '版本', value: source.rev ?? '' },
    { label: '状态', value: source.status ?? '' },
    { label: '室外', value: source.swgd ?? '' },
  ].filter((item) => String(item.value ?? '').trim().length > 0);
});

function setActive(id: string | null, nextTab?: MbdPipeUiTab): void {
  if (nextTab) tab.value = nextTab;
  props.vis.highlightItem(id);
}

function revealPipeClearance(id: string): void {
  props.vis.showPipeClearances.value = true;
  setActive(id, 'clearances');
}

function revealStructureClearance(id: string): void {
  props.vis.showStructureClearances.value = true;
  setActive(id, 'clearances');
}

function revealElevation(id: string): void {
  props.vis.showElevationMarks.value = true;
  setActive(id, 'clearances');
}

function revealEnvelope(id: string | undefined): void {
  if (!id) return;
  props.vis.showEnvelope.value = true;
  setActive(id, 'envelope');
}

function setBendDisplayMode(event: Event): void {
  const value = (event.target as HTMLSelectElement | null)?.value;
  props.vis.bendDisplayMode.value = value === 'angle' ? 'angle' : 'size';
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold">
          {{ branchName || "MBD 管道标注" }}
        </div>
        <div class="truncate text-xs text-muted-foreground">
          BRAN/HANG: {{ branchRefno || "（未生成）" }}
          <span v-if="inputRefno"> · input: {{ inputRefno }}</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button type="button"
          class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          @click="vis.renderDemoDims">
          测试标注
        </button>
        <button type="button"
          class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          @click="vis.flyTo">
          飞行
        </button>
        <button type="button"
          class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          @click="vis.clearAll">
          清除
        </button>
        <button type="button"
          class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          @click="$emit('close')">
          关闭
        </button>
      </div>
    </div>

    <div class="rounded-md border border-border p-2 text-xs">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="font-semibold">模式预设</div>
          <div class="text-muted-foreground">
            当前：{{ modeLabel(mbdViewModeModel) }}。切换模式只影响下次生成；点击重置可回到当前模式默认显示。
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>用户模式：{{ modeLabel(mbdViewModeModel) }}</span>
            <span>实际渲染：{{ renderSourceLabel(actualRenderSource) }}</span>
            <span v-if="isLayoutFallback" class="text-amber-600">
              后端未返回 `layout_result`，当前保持 layout_first 语义，仅回退为 fallback 渲染。
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <select v-model="mbdViewModeModel"
            data-testid="mbd-view-mode"
            class="rounded-md border border-border bg-background px-2 py-1 text-xs">
            <option value="layout_first">版面优先模式</option>
            <option value="construction">施工模式</option>
            <option value="inspection">校核模式</option>
          </select>
          <button data-testid="mbd-view-mode-reset"
            type="button"
            class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            @click="vis.resetToCurrentModeDefaults">
            重置当前模式默认
          </button>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.isVisible.value"
          @change="vis.isVisible.value = !vis.isVisible.value" />
        <span>显示</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showLabels.value"
          @change="vis.showLabels.value = !vis.showLabels.value" />
        <span>文字</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showWelds.value"
          @change="vis.showWelds.value = !vis.showWelds.value" />
        <span>焊缝</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showSlopes.value"
          @change="vis.showSlopes.value = !vis.showSlopes.value" />
        <span>坡度</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showBends.value"
          @change="vis.showBends.value = !vis.showBends.value" />
        <span>弯头</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showPipeClearances.value"
          data-testid="mbd-toggle-pipe-clearances"
          @change="vis.showPipeClearances.value = !vis.showPipeClearances.value" />
        <span>管间净距</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showStructureClearances.value"
          data-testid="mbd-toggle-structure-clearances"
          @change="vis.showStructureClearances.value = !vis.showStructureClearances.value" />
        <span>结构净距</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showElevationMarks.value"
          data-testid="mbd-toggle-elevations"
          @change="vis.showElevationMarks.value = !vis.showElevationMarks.value" />
        <span>标高</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showEnvelope.value"
          data-testid="mbd-toggle-envelope"
          @change="vis.showEnvelope.value = !vis.showEnvelope.value" />
        <span>包络</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showSegments.value"
          @change="vis.showSegments.value = !vis.showSegments.value" />
        <span>管段骨架</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showElbows.value"
          @change="vis.showElbows.value = !vis.showElbows.value" />
        <span>弯头件</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showBranches.value"
          @change="vis.showBranches.value = !vis.showBranches.value" />
        <span>支管件</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showFlanges.value"
          @change="vis.showFlanges.value = !vis.showFlanges.value" />
        <span>法兰件</span>
      </label>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        @click="setActive(null)">
        取消高亮
      </button>
      <label v-if="showDebugUi"
        class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showAnchorDebug.value"
          @change="vis.showAnchorDebug.value = !vis.showAnchorDebug.value" />
        <span>锚点调试</span>
      </label>
      <label v-if="showDebugUi"
        class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showOwnerSegmentDebug.value"
          @change="vis.showOwnerSegmentDebug.value = !vis.showOwnerSegmentDebug.value" />
        <span>所属段调试</span>
      </label>
    </div>

    <div class="grid grid-cols-4 gap-2 text-xs">
      <div class="rounded-md border border-border px-2 py-1">
        段: <span class="font-semibold">{{ stats?.segments_count ?? segments.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        焊缝: <span class="font-semibold">{{ stats?.welds_count ?? welds.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        坡度: <span class="font-semibold">{{ stats?.slopes_count ?? slopes.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        弯头: <span class="font-semibold">{{ stats?.bends_count ?? bends.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        管间净距: <span class="font-semibold">{{ pipeClearances.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        结构净距: <span class="font-semibold">{{ structureClearances.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        标高: <span class="font-semibold">{{ elevationMarks.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        包络: <span class="font-semibold">{{ envelope ? "1" : "0" }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        管件: <span class="font-semibold">{{ stats?.fittings_count ?? fittings.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        标签: <span class="font-semibold">{{ stats?.tags_count ?? tags.length }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        抑制: <span class="font-semibold">{{ vis.suppressedWrongLineCount.value }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        最小净空:
        <span class="font-semibold">
          {{ minClearance == null ? "--" : formatLength(minClearance) }}
        </span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'overview' ? 'bg-muted' : ''"
        @click="tab = 'overview'">
        总览
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'clearances' ? 'bg-muted' : ''"
        @click="tab = 'clearances'">
        净空
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'materials' ? 'bg-muted' : ''"
        @click="tab = 'materials'">
        材质
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'envelope' ? 'bg-muted' : ''"
        @click="tab = 'envelope'">
        包络
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'settings' ? 'bg-muted' : ''"
        @click="tab = 'settings'">
        尺寸设置
      </button>
    </div>

    <div v-if="tab === 'overview'" class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-md border border-border p-2">
          <div class="text-muted-foreground">总长</div>
          <div class="mt-1 text-sm font-semibold">{{ formatLength(segmentTotalLength) }}</div>
        </div>
        <div class="rounded-md border border-border p-2">
          <div class="text-muted-foreground">最小净空</div>
          <div class="mt-1 text-sm font-semibold">
            {{ minClearance == null ? "--" : formatLength(minClearance) }}
          </div>
        </div>
        <div class="rounded-md border border-border p-2">
          <div class="text-muted-foreground">标高范围</div>
          <div class="mt-1 text-sm font-semibold">
            {{
              elevationRange
                ? `${formatLength(elevationRange.min)} ~ ${formatLength(elevationRange.max)}`
                : "--"
            }}
          </div>
        </div>
        <div class="rounded-md border border-border p-2">
          <div class="text-muted-foreground">包络</div>
          <div class="mt-1 text-sm font-semibold">{{ formatEnvelopeSize(envelope) }}</div>
        </div>
      </div>

      <div class="rounded-md border border-border p-2 text-xs text-muted-foreground">
        fittings: elbow={{ fittingSummary.elbow }} · branch={{ fittingSummary.branch }} · flange={{ fittingSummary.flange }}
        · welds={{ welds.length }} · slopes={{ slopes.length }} · bends={{ bends.length }} · tags={{ tags.length }}
      </div>

      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 font-semibold">口径摘要</div>
        <div v-if="diameterHighlights.length > 0" class="flex flex-col gap-2">
          <button v-for="item in diameterHighlights"
            :key="item.id"
            type="button"
            class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
            :class="vis.activeItemId.value === item.segmentId ? 'bg-muted' : ''"
            @click="setActive(item.segmentId, 'overview')">
            <div class="flex items-center justify-between gap-2">
              <div class="truncate font-semibold">
                {{ item.role }} · {{ item.refno }}
              </div>
              <div class="text-muted-foreground">{{ formatLength(item.length) }}</div>
            </div>
            <div class="mt-1 text-muted-foreground">
              DN {{ item.bore ?? "--" }} · OD {{ item.outsideDiameter ?? "--" }}
            </div>
          </button>
        </div>
        <div v-else class="text-muted-foreground">（暂无口径摘要）</div>
      </div>

      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 font-semibold">标高摘要</div>
        <div v-if="elevationMarks.length > 0" class="flex flex-col gap-2">
          <button v-for="mark in elevationMarks"
            :key="mark.id"
            type="button"
            class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
            :class="vis.activeItemId.value === mark.id ? 'bg-muted' : ''"
            @click="revealElevation(mark.id)">
            <div class="flex items-center justify-between gap-2">
              <div class="truncate font-semibold">
                {{ mark.text }}
              </div>
              <div class="text-muted-foreground">{{ mark.role ?? "mark" }}</div>
            </div>
            <div class="mt-1 text-muted-foreground">
              point: {{ formatPoint(mark.point) }}
            </div>
          </button>
        </div>
        <div v-else class="text-muted-foreground">（暂无标高）</div>
      </div>
    </div>

    <div v-else-if="tab === 'clearances'" class="flex flex-col gap-2">
      <div class="grid grid-cols-3 gap-2">
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showPipeClearances.value"
            @change="vis.showPipeClearances.value = !vis.showPipeClearances.value" />
          <span>管间净距</span>
        </label>
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showStructureClearances.value"
            @change="vis.showStructureClearances.value = !vis.showStructureClearances.value" />
          <span>结构净距</span>
        </label>
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showElevationMarks.value"
            @change="vis.showElevationMarks.value = !vis.showElevationMarks.value" />
          <span>标高</span>
        </label>
      </div>

      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 font-semibold">结构净距</div>
        <div v-if="structureClearances.length > 0" class="flex flex-col gap-2">
          <button v-for="item in structureClearances"
            :key="item.id"
            type="button"
            class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
            :class="vis.activeItemId.value === item.id ? 'bg-muted' : ''"
            @click="revealStructureClearance(item.id)">
            <div class="flex items-center justify-between gap-2">
              <div class="truncate font-semibold">
                {{ item.text }}
              </div>
              <div class="text-muted-foreground">{{ structureKindLabel(item.target_kind) }}</div>
            </div>
            <div class="mt-1 text-muted-foreground">
              {{ item.target_noun || item.target_refno || "结构构件" }} · {{ formatLength(item.distance) }}
            </div>
          </button>
        </div>
        <div v-else class="text-muted-foreground">（暂无结构净距）</div>
      </div>

      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 font-semibold">管间净距</div>
        <div v-if="pipeClearances.length > 0" class="flex flex-col gap-2">
          <button v-for="item in pipeClearances"
            :key="item.id"
            type="button"
            class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
            :class="vis.activeItemId.value === item.id ? 'bg-muted' : ''"
            @click="revealPipeClearance(item.id)">
            <div class="flex items-center justify-between gap-2">
              <div class="truncate font-semibold">{{ item.text }}</div>
              <div class="text-muted-foreground">{{ formatLength(item.distance) }}</div>
            </div>
            <div class="mt-1 text-muted-foreground">
              {{ item.pipe1_refno }} ↔ {{ item.pipe2_refno }}
            </div>
          </button>
        </div>
        <div v-else class="text-muted-foreground">（暂无管间净距）</div>
      </div>

      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 font-semibold">标高</div>
        <div v-if="elevationMarks.length > 0" class="flex flex-col gap-2">
          <button v-for="mark in elevationMarks"
            :key="mark.id"
            type="button"
            class="w-full rounded-md border border-border p-2 text-left hover:bg-muted"
            :class="vis.activeItemId.value === mark.id ? 'bg-muted' : ''"
            @click="revealElevation(mark.id)">
            <div class="flex items-center justify-between gap-2">
              <div class="truncate font-semibold">{{ mark.text }}</div>
              <div class="text-muted-foreground">{{ mark.role ?? "mark" }}</div>
            </div>
            <div class="mt-1 text-muted-foreground">
              point: {{ formatPoint(mark.point) }}
            </div>
          </button>
        </div>
        <div v-else class="text-muted-foreground">（暂无标高）</div>
      </div>
    </div>

    <div v-else-if="tab === 'materials'" class="rounded-md border border-border p-2 text-xs">
      <div v-if="materialEntries.length > 0" class="grid grid-cols-2 gap-x-2 gap-y-1">
        <template v-for="item in materialEntries" :key="item.label">
          <div class="text-muted-foreground">{{ item.label }}</div>
          <div class="truncate">{{ item.value }}</div>
        </template>
      </div>
      <div v-else class="text-muted-foreground">（暂无材质属性）</div>
    </div>

    <div v-else-if="tab === 'envelope'" class="flex flex-col gap-2">
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showEnvelope.value"
          @change="vis.showEnvelope.value = !vis.showEnvelope.value" />
        <span>显示包络</span>
      </label>

      <button v-if="envelope"
        type="button"
        class="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
        :class="vis.activeItemId.value === envelope.id ? 'bg-muted' : ''"
        @click="revealEnvelope(envelope.id)">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate font-semibold">{{ envelope.kind }}</div>
          <div class="text-muted-foreground">{{ formatEnvelopeSize(envelope) }}</div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
          <div class="text-muted-foreground">center</div>
          <div>{{ formatPoint(envelope.center) }}</div>
          <div class="text-muted-foreground">min</div>
          <div>{{ formatPoint(envelope.min) }}</div>
          <div class="text-muted-foreground">max</div>
          <div>{{ formatPoint(envelope.max) }}</div>
        </div>
      </button>
      <div v-else class="rounded-md border border-border p-2 text-xs text-muted-foreground">
        （暂无包络）
      </div>
    </div>

    <div v-else-if="tab === 'settings'" class="flex flex-col gap-3">
      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 flex items-center justify-between gap-2">
          <div>
            <div class="font-semibold">尺寸显示</div>
            <div class="text-muted-foreground">
              V2 后端版面尺寸：linear={{ linearDimCount }} · cut-tubi={{ cutTubiDimCount }}
            </div>
          </div>
          <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <input data-testid="mbd-toggle-dimensions"
              type="checkbox"
              :checked="vis.showDims.value"
              @change="vis.showDims.value = !vis.showDims.value" />
            <span>全部尺寸</span>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <input data-testid="mbd-toggle-dim-segment"
              type="checkbox"
              :checked="vis.showDimSegment.value"
              @change="vis.showDimSegment.value = !vis.showDimSegment.value" />
            <span>段长尺寸</span>
          </label>
          <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <input data-testid="mbd-toggle-dim-chain"
              type="checkbox"
              :checked="vis.showDimChain.value"
              @change="vis.showDimChain.value = !vis.showDimChain.value" />
            <span>链式尺寸</span>
          </label>
          <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <input data-testid="mbd-toggle-dim-overall"
              type="checkbox"
              :checked="vis.showDimOverall.value"
              @change="vis.showDimOverall.value = !vis.showDimOverall.value" />
            <span>总长尺寸</span>
          </label>
          <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <input data-testid="mbd-toggle-dim-port"
              type="checkbox"
              :checked="vis.showDimPort.value"
              @change="vis.showDimPort.value = !vis.showDimPort.value" />
            <span>端口尺寸</span>
          </label>
          <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1">
            <input data-testid="mbd-toggle-cut-tubis"
              type="checkbox"
              :checked="vis.showCutTubis.value"
              @change="vis.showCutTubis.value = !vis.showCutTubis.value" />
            <span>cut-tubi 尺寸</span>
          </label>
        </div>
      </div>

      <div class="rounded-md border border-border p-2 text-xs">
        <div class="mb-2 font-semibold">弯头显示</div>
        <select data-testid="mbd-bend-display-mode"
          :value="vis.bendDisplayMode.value"
          class="rounded-md border border-border bg-background px-2 py-1 text-xs"
          @change="setBendDisplayMode">
          <option value="size">尺寸</option>
          <option value="angle">角度</option>
        </select>
      </div>
    </div>
  </div>
</template>
