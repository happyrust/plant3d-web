<script setup lang="ts">
import { computed } from 'vue';

import type {
  MbdDimKind,
  MbdFittingDto,
  MbdPipeViewMode,
} from '@/api/mbdPipeApi';
import type { UseMbdPipeAnnotationThreeReturn } from '@/composables/useMbdPipeAnnotationThree';

import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';

const props = defineProps<{
    vis: UseMbdPipeAnnotationThreeReturn;
}>();

defineEmits<(e: 'close') => void>();

const tab = computed({
  get: () => props.vis.uiTab.value,
  set: (v) => {
    props.vis.uiTab.value = v as any;
  },
});

const unitSettings = useUnitSettingsStore();
const displayUnitModel = computed({
  get: () => unitSettings.displayUnit.value,
  set: (v) => unitSettings.setDisplayUnit(v as any),
});
const precisionModel = computed({
  get: () => unitSettings.precision.value,
  set: (v) => unitSettings.setPrecision(Number(v)),
});

const dimTextModeModel = computed({
  get: () => props.vis.dimTextMode.value,
  set: (v) => {
    props.vis.dimTextMode.value = v === 'auto' ? 'auto' : 'backend';
  },
});
const mbdViewModeModel = computed({
  get: () => props.vis.mbdViewMode.value,
  set: (v) => {
    props.vis.mbdViewMode.value = v === 'inspection'
      ? 'inspection'
      : 'construction';
  },
});
const dimModeModel = computed({
  get: () => props.vis.dimMode.value,
  set: (v) => {
    props.vis.dimMode.value = v === 'rebarviz' ? 'rebarviz' : 'classic';
  },
});
const bendDisplayModeModel = computed({
  get: () => props.vis.bendDisplayMode.value,
  set: (v) => {
    props.vis.bendDisplayMode.value = v === 'angle' ? 'angle' : 'size';
  },
});
const dimOffsetScaleModel = computed({
  get: () => props.vis.dimOffsetScale.value,
  set: (v) => {
    const n = Number(v);
    props.vis.dimOffsetScale.value = Number.isFinite(n)
      ? Math.max(0.05, Math.min(50, n))
      : 1;
  },
});
const dimLabelTModel = computed({
  get: () => props.vis.dimLabelT.value,
  set: (v) => {
    const n = Number(v);
    props.vis.dimLabelT.value = Number.isFinite(n)
      ? Math.max(0, Math.min(1, n))
      : 0.5;
  },
});
const rebarvizArrowSizeModel = computed({
  get: () => props.vis.rebarvizArrowSizePx.value,
  set: (v) => {
    const n = Number(v);
    props.vis.rebarvizArrowSizePx.value = Number.isFinite(n)
      ? Math.max(6, Math.min(40, n))
      : 16;
  },
});
const rebarvizArrowStyleModel = computed({
  get: () => props.vis.rebarvizArrowStyle.value,
  set: (v) => {
    props.vis.rebarvizArrowStyle.value = v === 'filled' || v === 'tick'
      ? v
      : 'open';
  },
});
const rebarvizArrowAngleModel = computed({
  get: () => props.vis.rebarvizArrowAngleDeg.value,
  set: (v) => {
    const n = Number(v);
    props.vis.rebarvizArrowAngleDeg.value = Number.isFinite(n)
      ? Math.max(8, Math.min(40, n))
      : 18;
  },
});
const rebarvizLineWidthModel = computed({
  get: () => props.vis.rebarvizLineWidthPx.value,
  set: (v) => {
    const n = Number(v);
    props.vis.rebarvizLineWidthPx.value = Number.isFinite(n)
      ? Math.max(1, Math.min(6, n))
      : 2.2;
  },
});

const data = computed(() => props.vis.currentData.value);
const stats = computed(() => data.value?.stats ?? null);
const branchName = computed(() => data.value?.branch_name ?? '');
const branchRefno = computed(() => data.value?.branch_refno ?? '');
const inputRefno = computed(() => data.value?.input_refno ?? '');

const dims = computed(() => data.value?.dims ?? []);
const welds = computed(() => data.value?.welds ?? []);
const slopes = computed(() => data.value?.slopes ?? []);
const bends = computed(() => data.value?.bends ?? []);
const cutTubis = computed(() => data.value?.cut_tubis ?? []);
const fittings = computed(() => data.value?.fittings ?? []);
const tags = computed(() => data.value?.tags ?? []);
const segments = computed(() => data.value?.segments ?? []);
const attrs = computed(() => data.value?.branch_attrs ?? null);

function classifyFitting(fitting: Partial<MbdFittingDto> | null | undefined):
    | 'elbow'
    | 'branch'
    | 'flange' {
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

const elbowCount = computed(() =>
  fittings.value.filter((f: any) => classifyFitting(f) === 'elbow').length
);
const branchCount = computed(() =>
  fittings.value.filter((f: any) => classifyFitting(f) === 'branch').length
);
const flangeCount = computed(() =>
  fittings.value.filter((f: any) => classifyFitting(f) === 'flange').length
);

function normalizeDimKind(kind: unknown): MbdDimKind {
  return kind === 'chain' ||
        kind === 'overall' ||
        kind === 'port' ||
        kind === 'segment'
    ? kind
    : 'segment';
}

function dimKindLabel(kind: MbdDimKind): string {
  if (kind === 'segment') return '段长';
  if (kind === 'chain') return '链式';
  if (kind === 'overall') return '总长';
  return '端口';
}

const filteredDims = computed(() => {
  const showSeg = props.vis.showDimSegment.value;
  const showChain = props.vis.showDimChain.value;
  const showOverall = props.vis.showDimOverall.value;
  const showPort = props.vis.showDimPort.value;

  const kindOrder: Record<MbdDimKind, number> = {
    segment: 10,
    chain: 20,
    overall: 30,
    port: 40,
  };

  return (dims.value || [])
    .filter((d: any) => {
      const k = normalizeDimKind(d?.kind);
      return (
        (k === 'segment' && showSeg) ||
                (k === 'chain' && showChain) ||
                (k === 'overall' && showOverall) ||
                (k === 'port' && showPort)
      );
    })
    .slice()
    .sort((a: any, b: any) => {
      const ka = normalizeDimKind(a?.kind);
      const kb = normalizeDimKind(b?.kind);
      const ok = (kindOrder[ka] ?? 99) - (kindOrder[kb] ?? 99);
      if (ok !== 0) return ok;

      const ga = typeof a?.group_id === 'string' ? a.group_id : '';
      const gb = typeof b?.group_id === 'string' ? b.group_id : '';
      if (ga !== gb) return ga.localeCompare(gb);

      const sa = Number.isFinite(a?.seq)
        ? Number(a.seq)
        : Number.POSITIVE_INFINITY;
      const sb = Number.isFinite(b?.seq)
        ? Number(b.seq)
        : Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;

      const ta = String(a?.text ?? '');
      const tb = String(b?.text ?? '');
      return ta.localeCompare(tb);
    });
});

function setActive(id: string | null) {
  props.vis.highlightItem(id);
}

function modeLabel(mode: MbdPipeViewMode): string {
  return mode === 'inspection' ? '校核模式' : '施工模式';
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
        </div>
        <div class="flex items-center gap-2">
          <select v-model="mbdViewModeModel"
            data-testid="mbd-view-mode"
            class="rounded-md border border-border bg-background px-2 py-1 text-xs">
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
          :checked="vis.showDims.value"
          @change="vis.showDims.value = !vis.showDims.value" />
        <span>尺寸</span>
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
          :checked="vis.showSegments.value"
          @change="vis.showSegments.value = !vis.showSegments.value" />
        <span>管段</span>
      </label>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        @click="setActive(null)">
        取消高亮
      </button>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showCutTubis.value"
          @change="vis.showCutTubis.value = !vis.showCutTubis.value" />
        <span>切管段</span>
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
        <span>三通/支管件</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showFlanges.value"
          @change="vis.showFlanges.value = !vis.showFlanges.value" />
        <span>法兰件</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showAnchorDebug.value"
          @change="vis.showAnchorDebug.value = !vis.showAnchorDebug.value" />
        <span>锚点调试</span>
      </label>
      <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox"
          :checked="vis.showOwnerSegmentDebug.value"
          @change="
            vis.showOwnerSegmentDebug.value =
              !vis.showOwnerSegmentDebug.value
          " />
        <span>所属段调试</span>
      </label>
    </div>

    <div v-if="stats" class="grid grid-cols-4 gap-2 text-xs">
      <div class="rounded-md border border-border px-2 py-1">
        段:
        <span class="font-semibold">{{ stats.segments_count }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        尺寸: <span class="font-semibold">{{ stats.dims_count }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        焊缝: <span class="font-semibold">{{ stats.welds_count }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        坡度:
        <span class="font-semibold">{{ stats.slopes_count }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        弯头: <span class="font-semibold">{{ stats.bends_count }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        切管:
        <span class="font-semibold">{{
          stats.cut_tubis_count ?? cutTubis.length
        }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        管件:
        <span class="font-semibold">{{
          stats.fittings_count ?? fittings.length
        }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        标签:
        <span class="font-semibold">{{
          stats.tags_count ?? tags.length
        }}</span>
      </div>
      <div class="rounded-md border border-border px-2 py-1">
        抑制:
        <span class="font-semibold">{{
          vis.suppressedWrongLineCount.value
        }}</span>
      </div>
    </div>

    <div class="rounded-md border border-border p-2 text-xs text-muted-foreground">
      cut_tubis={{ cutTubis.length }} · elbows={{ elbowCount }} ·
      branches={{ branchCount }} · flanges={{ flangeCount }} ·
      tags={{ tags.length }} · anchor_debug={{
        vis.showAnchorDebug.value ? "on" : "off"
      }} · owner_segment_debug={{
        vis.showOwnerSegmentDebug.value ? "on" : "off"
      }}
    </div>

    <div class="flex items-center gap-2">
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'dims' ? 'bg-muted' : ''"
        @click="tab = 'dims'">
        尺寸
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'welds' ? 'bg-muted' : ''"
        @click="tab = 'welds'">
        焊缝
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'slopes' ? 'bg-muted' : ''"
        @click="tab = 'slopes'">
        坡度
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'bends' ? 'bg-muted' : ''"
        @click="tab = 'bends'">
        弯头
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'attrs' ? 'bg-muted' : ''"
        @click="tab = 'attrs'">
        图纸属性
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'segments' ? 'bg-muted' : ''"
        @click="tab = 'segments'">
        段
      </button>
      <button type="button"
        class="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        :class="tab === 'settings' ? 'bg-muted' : ''"
        @click="tab = 'settings'">
        设置
      </button>
    </div>

    <div v-if="tab === 'dims'" class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2">
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showDimSegment.value"
            @change="
              vis.showDimSegment.value = !vis.showDimSegment.value
            " />
          <span>段长</span>
        </label>
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showDimChain.value"
            @change="
              vis.showDimChain.value = !vis.showDimChain.value
            " />
          <span>链式(含两端)</span>
        </label>
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showDimOverall.value"
            @change="
              vis.showDimOverall.value = !vis.showDimOverall.value
            " />
          <span>总长</span>
        </label>
        <label class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <input type="checkbox"
            :checked="vis.showDimPort.value"
            @change="vis.showDimPort.value = !vis.showDimPort.value" />
          <span>端口</span>
        </label>
      </div>

      <button v-for="d in filteredDims"
        :key="d.id"
        type="button"
        class="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
        :class="vis.activeItemId.value === d.id ? 'bg-muted' : ''"
        @click="setActive(d.id)">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate font-semibold">
            <span class="text-muted-foreground">[{{
              dimKindLabel(normalizeDimKind(d.kind))
            }}]</span>
            {{ " " }}{{ d.text }}
          </div>
          <div class="text-muted-foreground">
            {{ d.length.toFixed(1) }}
          </div>
        </div>
        <div class="mt-1 text-muted-foreground truncate">
          start: {{ d.start.join(",") }} · end: {{ d.end.join(",") }}
        </div>
      </button>
      <div v-if="filteredDims.length === 0"
        class="text-xs text-muted-foreground">
        （暂无尺寸）
      </div>
    </div>

    <div v-else-if="tab === 'welds'" class="flex flex-col gap-2">
      <button v-for="w in welds"
        :key="w.id"
        type="button"
        class="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
        :class="vis.activeItemId.value === w.id ? 'bg-muted' : ''"
        @click="setActive(w.id)">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate font-semibold">{{ w.label }}</div>
          <div class="text-muted-foreground">
            {{ w.is_shop ? "车间焊" : "现场焊" }}
          </div>
        </div>
        <div class="mt-1 text-muted-foreground truncate">
          pos: {{ w.position.join(",") }}
        </div>
      </button>
      <div v-if="welds.length === 0"
        class="text-xs text-muted-foreground">
        （暂无焊缝）
      </div>
    </div>

    <div v-else-if="tab === 'slopes'" class="flex flex-col gap-2">
      <button v-for="s in slopes"
        :key="s.id"
        type="button"
        class="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
        :class="vis.activeItemId.value === s.id ? 'bg-muted' : ''"
        @click="setActive(s.id)">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate font-semibold">{{ s.text }}</div>
          <div class="text-muted-foreground">
            {{ s.slope.toFixed(4) }}
          </div>
        </div>
        <div class="mt-1 text-muted-foreground truncate">
          start: {{ s.start.join(",") }} · end: {{ s.end.join(",") }}
        </div>
      </button>
      <div v-if="slopes.length === 0"
        class="text-xs text-muted-foreground">
        （暂无坡度）
      </div>
    </div>

    <div v-else-if="tab === 'bends'" class="flex flex-col gap-2">
      <button v-for="b in bends"
        :key="b.id"
        type="button"
        class="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
        :class="vis.activeItemId.value === b.id ? 'bg-muted' : ''"
        @click="setActive(b.id)">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate font-semibold">
            {{ b.noun }} · {{ b.refno }}
          </div>
          <div class="text-muted-foreground">
            <span v-if="b.angle != null">{{ b.angle.toFixed(1) }}°</span>
            <span v-if="b.radius != null">
              R{{ b.radius.toFixed(0) }}</span>
          </div>
        </div>
      </button>
      <div v-if="bends.length === 0"
        class="text-xs text-muted-foreground">
        （暂无弯头）
      </div>
    </div>

    <div v-else-if="tab === 'segments'" class="flex flex-col gap-2">
      <button v-for="s in segments"
        :key="s.id"
        type="button"
        class="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
        :class="vis.activeItemId.value === s.id ? 'bg-muted' : ''"
        @click="setActive(s.id)">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate font-semibold">{{ s.noun }}</div>
          <div class="text-muted-foreground">
            {{ s.length.toFixed(1) }}
          </div>
        </div>
        <div class="mt-1 text-muted-foreground truncate">
          refno: {{ s.refno }}
          <span v-if="s.name">· {{ s.name }}</span>
        </div>
      </button>
      <div v-if="segments.length === 0"
        class="text-xs text-muted-foreground">
        （暂无管段）
      </div>
    </div>

    <div v-else-if="tab === 'settings'" class="flex flex-col gap-2">
      <div class="rounded-md border border-border p-2 text-xs">
        <div class="text-sm font-semibold">尺寸显示</div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">单位</span>
            <select v-model="displayUnitModel"
              class="rounded-md border border-border bg-background px-2 py-1 text-xs">
              <option value="m">m</option>
              <option value="cm">cm</option>
              <option value="mm">mm</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">精度</span>
            <input v-model.number="precisionModel"
              type="number"
              min="0"
              max="6"
              step="1"
              class="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs" />
          </label>

          <label class="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">文字来源</span>
            <select v-model="dimTextModeModel"
              class="rounded-md border border-border bg-background px-2 py-1 text-xs">
              <option value="backend">后端</option>
              <option value="auto">自动</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">标注模式</span>
            <select v-model="dimModeModel"
              class="rounded-md border border-border bg-background px-2 py-1 text-xs">
              <option value="classic">Classic</option>
              <option value="rebarviz">RebarViz</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">弯头显示</span>
            <select v-model="bendDisplayModeModel"
              data-testid="mbd-bend-display-mode"
              class="rounded-md border border-border bg-background px-2 py-1 text-xs">
              <option value="size">尺寸</option>
              <option value="angle">角度</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">偏移倍率</span>
            <input v-model.number="dimOffsetScaleModel"
              type="number"
              min="0.05"
              max="50"
              step="0.1"
              class="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs" />
          </label>

          <label class="col-span-2 flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">标签位置</span>
            <input v-model.number="dimLabelTModel"
              type="range"
              min="0"
              max="1"
              step="0.05"
              class="flex-1" />
            <span class="w-12 text-right tabular-nums">{{
              Number(dimLabelTModel).toFixed(2)
            }}</span>
          </label>

          <label class="col-span-2 flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">箭头样式</span>
            <select v-model="rebarvizArrowStyleModel"
              class="rounded-md border border-border bg-background px-2 py-1 text-xs"
              :disabled="dimModeModel !== 'rebarviz'">
              <option value="open">开口箭头（Open）</option>
              <option value="filled">实心三角（Filled）</option>
              <option value="tick">斜杠刻度（Tick）</option>
            </select>
          </label>
          <label class="col-span-2 flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">箭头长度(px)</span>
            <input v-model.number="rebarvizArrowSizeModel"
              type="range"
              min="6"
              max="40"
              step="1"
              class="flex-1"
              :disabled="dimModeModel !== 'rebarviz'" />
            <span class="w-12 text-right tabular-nums">{{
              Number(rebarvizArrowSizeModel).toFixed(0)
            }}</span>
          </label>
          <label class="col-span-2 flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">箭头角度(°)</span>
            <input v-model.number="rebarvizArrowAngleModel"
              type="range"
              min="8"
              max="40"
              step="1"
              class="flex-1"
              :disabled="dimModeModel !== 'rebarviz'" />
            <span class="w-12 text-right tabular-nums">{{
              Number(rebarvizArrowAngleModel).toFixed(0)
            }}</span>
          </label>
          <label class="col-span-2 flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
            <span class="text-muted-foreground">线宽(px)</span>
            <input v-model.number="rebarvizLineWidthModel"
              type="range"
              min="1"
              max="6"
              step="0.1"
              class="flex-1"
              :disabled="dimModeModel !== 'rebarviz'" />
            <span class="w-12 text-right tabular-nums">{{
              Number(rebarvizLineWidthModel).toFixed(1)
            }}</span>
          </label>
        </div>

        <div class="mt-2 text-muted-foreground">
          说明：偏移倍率/标签位置只影响未手动拖拽覆盖的尺寸；手动调整后以会话内覆盖为准。
        </div>
      </div>
    </div>

    <div v-else class="rounded-md border border-border p-2 text-xs">
      <div v-if="attrs" class="grid grid-cols-2 gap-x-2 gap-y-1">
        <div class="text-muted-foreground">介质</div>
        <div class="truncate">{{ attrs.duty ?? "" }}</div>
        <div class="text-muted-foreground">管道等级</div>
        <div class="truncate">{{ attrs.pspec ?? "" }}</div>
        <div class="text-muted-foreground">RCCM</div>
        <div class="truncate">{{ attrs.rccm ?? "" }}</div>
        <div class="text-muted-foreground">清洁度</div>
        <div class="truncate">{{ attrs.clean ?? "" }}</div>
        <div class="text-muted-foreground">设计温度</div>
        <div class="truncate">{{ attrs.temp ?? "" }}</div>
        <div class="text-muted-foreground">设计压力</div>
        <div class="truncate">{{ attrs.pressure ?? "" }}</div>
        <div class="text-muted-foreground">保温</div>
        <div class="truncate">{{ attrs.ispec ?? "" }}</div>
        <div class="text-muted-foreground">保温厚度</div>
        <div class="truncate">{{ attrs.insuthick ?? "" }}</div>
        <div class="text-muted-foreground">伴热</div>
        <div class="truncate">{{ attrs.tspec ?? "" }}</div>
        <div class="text-muted-foreground">室外</div>
        <div class="truncate">{{ attrs.swgd ?? "" }}</div>
        <div class="text-muted-foreground">图号</div>
        <div class="truncate">{{ attrs.drawnum ?? "" }}</div>
        <div class="text-muted-foreground">版本</div>
        <div class="truncate">{{ attrs.rev ?? "" }}</div>
        <div class="text-muted-foreground">状态</div>
        <div class="truncate">{{ attrs.status ?? "" }}</div>
        <div class="text-muted-foreground">介质(FLUID)</div>
        <div class="truncate">{{ attrs.fluid ?? "" }}</div>
      </div>
      <div v-else class="text-muted-foreground">（暂无图纸属性）</div>
    </div>
  </div>
</template>
