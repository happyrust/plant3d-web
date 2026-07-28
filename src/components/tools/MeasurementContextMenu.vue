<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';

import {
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Repeat2,
  Trash2,
} from 'lucide-vue-next';

import type { XeokitMeasurementRecord } from '@/composables/useToolStore';
import type { LengthUnit } from '@/composables/useUnitSettingsStore';

import { formatMeasurementKindLabel } from '@/utils/xeokitMeasurementFormat';

const props = defineProps<{
  x: number;
  y: number;
  record: XeokitMeasurementRecord;
  axisBreakdownEnabled: boolean;
  displayUnit: LengthUnit;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'toggle-axis'): void;
  (e: 'change-unit', unit: LengthUnit): void;
  (e: 'copy-value'): void;
  (e: 'copy-components'): void;
  (e: 'repeat'): void;
  (e: 'locate'): void;
  (e: 'toggle-visible'): void;
  (e: 'remove'): void;
}>();

const UNIT_OPTIONS: readonly LengthUnit[] = ['mm', 'cm', 'm'];

const isDistance = computed(() => props.record.kind === 'distance');
/** 角度不用长度单位，其余三类跟随全局显示单位。 */
const supportsUnit = computed(() => props.record.kind !== 'angle');
const kindLabel = computed(() => formatMeasurementKindLabel(props.record.kind));
const copyValueLabel = computed(() => {
  switch (props.record.kind) {
    case 'distance':
      return '复制距离值';
    case 'angle':
      return '复制角度值';
    case 'elevation_point':
      return '复制标高值';
    case 'elevation_delta':
      return '复制高差值';
  }
  return '复制值';
});
const visibilityLabel = computed(() => (props.record.visible ? '隐藏当前测量' : '显示当前测量'));

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true);
});
</script>

<template>
  <div class="absolute inset-0" style="z-index: 960" data-testid="measurement-context-menu-root">
    <div class="absolute inset-0"
      data-testid="measurement-context-menu-backdrop"
      @pointerdown.stop="emit('close')"
      @contextmenu.prevent.stop="emit('close')" />
    <div class="absolute min-w-48 rounded-xl border border-border bg-background/95 py-1 text-sm shadow-xl backdrop-blur"
      data-testid="measurement-context-menu"
      :style="{ left: `${x}px`, top: `${y}px` }"
      @pointerdown.stop
      @contextmenu.prevent.stop>
      <div class="px-3 py-1.5 text-xs text-muted-foreground">
        {{ kindLabel }}
      </div>

      <button v-if="isDistance"
        type="button"
        data-testid="measurement-menu-display-axis"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="emit('toggle-axis')">
        <span class="inline-block w-4 text-center">{{ axisBreakdownEnabled ? '✓' : '' }}</span>
        <span>Display Axis（轴向分量）</span>
      </button>

      <div v-if="supportsUnit"
        class="flex items-center gap-1 px-3 py-1.5"
        data-testid="measurement-menu-change-unit">
        <span class="mr-1 inline-block w-4" />
        <span class="mr-1 text-muted-foreground">单位</span>
        <button v-for="unit in UNIT_OPTIONS"
          :key="unit"
          type="button"
          :data-testid="`measurement-menu-unit-${unit}`"
          class="rounded-md border px-2 py-0.5 text-xs"
          :class="displayUnit === unit
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'"
          @click="emit('change-unit', unit)">
          {{ unit }}
        </button>
        <span class="ml-1 text-xs text-muted-foreground">（全局）</span>
      </div>

      <div class="my-1 h-px bg-border/80" />

      <button type="button"
        data-testid="measurement-menu-copy-value"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="emit('copy-value')">
        <Copy class="h-3.5 w-3.5" />
        <span>{{ copyValueLabel }}</span>
      </button>

      <button v-if="isDistance"
        type="button"
        data-testid="measurement-menu-copy-components"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="emit('copy-components')">
        <Copy class="h-3.5 w-3.5" />
        <span>复制轴向分量</span>
      </button>

      <div class="my-1 h-px bg-border/80" />

      <button v-if="isDistance"
        type="button"
        data-testid="measurement-menu-repeat"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="emit('repeat')">
        <Repeat2 class="h-3.5 w-3.5" />
        <span>Repeat（以终点继续测量）</span>
      </button>

      <button type="button"
        data-testid="measurement-menu-locate"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="emit('locate')">
        <Crosshair class="h-3.5 w-3.5" />
        <span>定位到测量</span>
      </button>

      <button type="button"
        data-testid="measurement-menu-toggle-visible"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        @click="emit('toggle-visible')">
        <component :is="record.visible ? EyeOff : Eye" class="h-3.5 w-3.5" />
        <span>{{ visibilityLabel }}</span>
      </button>

      <button type="button"
        data-testid="measurement-menu-remove"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-destructive hover:bg-muted"
        @click="emit('remove')">
        <Trash2 class="h-3.5 w-3.5" />
        <span>删除测量</span>
      </button>
    </div>
  </div>
</template>
