<script setup lang="ts">
import { computed } from 'vue';

import {
  DEFAULT_ANNOTATION_STYLE,
  type AnnotationStylePreset,
  type AnnotationStyleConfig,
  useAnnotationStyleStore,
} from '@/composables/useAnnotationStyleStore';

const { style, resetToDefaults, applyPreset } = useAnnotationStyleStore();

const styleKinds: (keyof AnnotationStyleConfig)[] = ['text', 'cloud', 'rect', 'obb'];

const kindLabels: Record<keyof AnnotationStyleConfig, string> = {
  text: '文字批注',
  cloud: '云线批注',
  rect: '矩形批注',
  obb: 'OBB 批注',
};

const presetOptions: {
  id: AnnotationStylePreset
  label: string
  description: string
  lineWidth: number
  haloLineWidth: number
  color: string
  haloColor: string
}[] = [
  {
    id: 'soft',
    label: '柔和',
    description: '更轻更淡，适合默认浏览',
    lineWidth: 4,
    haloLineWidth: 6.5,
    color: '#60a5fa',
    haloColor: '#dbeafe',
  },
  {
    id: 'clear',
    label: '清晰',
    description: '平衡清楚与克制，适合常规批注',
    lineWidth: 4.75,
    haloLineWidth: 8,
    color: '#3b82f6',
    haloColor: '#bfdbfe',
  },
  {
    id: 'bold',
    label: '强强调',
    description: '更粗更亮，适合重点标注',
    lineWidth: 6.8,
    haloLineWidth: 11.5,
    color: '#dc2626',
    haloColor: '#fecaca',
  },
];

const isModified = computed(() => {
  return styleKinds.some((kind) => {
    const current = style[kind];
    const defaults = DEFAULT_ANNOTATION_STYLE[kind];
    return current.color !== defaults.color
      || current.haloColor !== defaults.haloColor
      || current.lineWidth !== defaults.lineWidth
      || current.haloLineWidth !== defaults.haloLineWidth
      || current.opacity !== defaults.opacity
      || current.haloOpacity !== defaults.haloOpacity;
  });
});

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function updateHex(kind: keyof AnnotationStyleConfig, field: 'color' | 'haloColor', value: string) {
  const next = Number.parseInt(value.replace('#', ''), 16);
  if (Number.isFinite(next)) {
    style[kind][field] = next;
  }
}

function previewLineStyle(kind: keyof AnnotationStyleConfig): Record<string, string> {
  return {
    height: `${style[kind].lineWidth}px`,
    background: toHex(style[kind].color),
  };
}

function previewHaloStyle(kind: keyof AnnotationStyleConfig): Record<string, string> {
  return {
    height: `${style[kind].haloLineWidth}px`,
    background: toHex(style[kind].haloColor),
    opacity: `${style[kind].haloOpacity}`,
  };
}
</script>

<template>
  <div class="annotation-style-panel space-y-4">
    <h3 class="mb-2 border-b pb-1 text-sm font-semibold">批注引线样式</h3>

    <div class="space-y-2 rounded-md border border-border p-3">
      <div class="text-xs font-medium uppercase tracking-wide text-gray-500">快速预设</div>
      <div class="grid gap-3 md:grid-cols-3">
        <button v-for="preset in presetOptions"
          :key="preset.id"
          type="button"
          :data-testid="`annotation-style-preset-${preset.id}`"
          class="rounded-lg border border-border bg-gray-50 p-3 text-left transition hover:border-gray-400 hover:bg-white"
          @click="applyPreset(preset.id)">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-foreground">{{ preset.label }}</div>
              <div class="mt-1 text-xs leading-5 text-muted-foreground">{{ preset.description }}</div>
            </div>
            <div class="rounded-full border border-border bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
              预设
            </div>
          </div>

          <div class="mt-3 rounded-md border border-dashed border-border bg-white/80 px-3 py-2">
            <div class="relative flex h-8 items-center">
              <div class="absolute left-4 right-2 rounded-full"
                :style="{
                  height: `${preset.haloLineWidth}px`,
                  background: preset.haloColor,
                  opacity: '0.55',
                }" />
              <div class="absolute left-4 right-2 rounded-full"
                :style="{
                  height: `${preset.lineWidth}px`,
                  background: preset.color,
                }" />
              <div class="relative z-10 h-3 w-3 rounded-full border border-white shadow-sm"
                :style="{ background: preset.color }" />
            </div>
          </div>
        </button>
      </div>
    </div>

    <fieldset v-for="kind in styleKinds"
      :key="kind"
      class="space-y-2 rounded-md border border-border p-3">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-gray-500">
        {{ kindLabels[kind] }}
      </legend>

      <label class="flex items-center justify-between text-sm">
        <span>主线宽度 (px)</span>
        <input v-model.number="style[kind].lineWidth"
          type="number"
          min="1"
          max="20"
          step="0.25"
          class="w-20 rounded border px-1 text-right" />
      </label>

      <label class="flex items-center justify-between text-sm">
        <span>Halo 宽度 (px)</span>
        <input v-model.number="style[kind].haloLineWidth"
          type="number"
          min="1"
          max="30"
          step="0.25"
          class="w-20 rounded border px-1 text-right" />
      </label>

      <label class="flex items-center justify-between text-sm">
        <span>主线颜色</span>
        <input :value="toHex(style[kind].color)"
          type="color"
          class="h-8 w-16 rounded border px-1"
          @input="updateHex(kind, 'color', ($event.target as HTMLInputElement).value)" />
      </label>

      <label class="flex items-center justify-between text-sm">
        <span>Halo 透明度</span>
        <input v-model.number="style[kind].haloOpacity"
          type="number"
          min="0"
          max="1"
          step="0.05"
          class="w-20 rounded border px-1 text-right" />
      </label>

      <div :data-testid="`annotation-style-preview-${kind}`"
        class="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
        <div class="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          预览
        </div>
        <div class="relative flex h-10 items-center">
          <div class="absolute left-5 right-3 rounded-full"
            :data-testid="`annotation-style-preview-halo-${kind}`"
            :style="previewHaloStyle(kind)" />
          <div class="absolute left-5 right-3 rounded-full"
            :data-testid="`annotation-style-preview-line-${kind}`"
            :style="previewLineStyle(kind)" />
          <div class="relative z-10 h-3 w-3 rounded-full border border-white shadow-sm"
            :style="{ background: toHex(style[kind].color) }" />
          <div class="ml-auto rounded bg-background px-2 py-1 text-xs text-muted-foreground shadow-sm">
            {{ kindLabels[kind] }}
          </div>
        </div>
      </div>
    </fieldset>

    <div class="flex gap-2 border-t pt-2">
      <button type="button"
        :disabled="!isModified"
        class="flex-1 rounded border bg-gray-50 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        @click="resetToDefaults()">
        恢复默认
      </button>
    </div>
  </div>
</template>
