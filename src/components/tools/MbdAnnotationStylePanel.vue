<script setup lang="ts">
import { computed } from 'vue';

import {
  DEFAULT_MBD_DRAWING_STYLE_PROFILE,
  type MbdDrawingStylePreset,
  useMbdDrawingStyleStore,
} from '@/composables/mbd/mbdDrawingStyleProfile';

const { profile, resetToDefaults, applyPreset } = useMbdDrawingStyleStore();

const presetOptions: {
  id: MbdDrawingStylePreset
  label: string
  dimensionColor: number
  pipeColor: number
  edgeColor: number
}[] = [
  {
    id: 'drawing',
    label: '图纸增强',
    dimensionColor: DEFAULT_MBD_DRAWING_STYLE_PROFILE.dimension.lineColor,
    pipeColor: DEFAULT_MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyColor,
    edgeColor: DEFAULT_MBD_DRAWING_STYLE_PROFILE.modelEdges.color,
  },
  {
    id: 'dark',
    label: '深色轮廓',
    dimensionColor: 0xe11d48,
    pipeColor: 0x11b7dd,
    edgeColor: 0x0f172a,
  },
  {
    id: 'light',
    label: '轻量审核',
    dimensionColor: 0xb91c1c,
    pipeColor: DEFAULT_MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyColor,
    edgeColor: DEFAULT_MBD_DRAWING_STYLE_PROFILE.modelEdges.color,
  },
];

const isModified = computed(() => JSON.stringify(profile) !== JSON.stringify(DEFAULT_MBD_DRAWING_STYLE_PROFILE));

function toHex(value: number): string {
  return `#${Math.max(0, Math.min(0xffffff, Math.floor(Number(value) || 0)))
    .toString(16)
    .padStart(6, '0')}`;
}

function updateColor(
  section: keyof typeof profile,
  field: string,
  value: string,
): void {
  const next = Number.parseInt(value.replace('#', ''), 16);
  if (!Number.isFinite(next)) return;
  (profile[section] as Record<string, number>)[field] = next;
}

function previewStyle(color: number, width = 4, opacity = 1): Record<string, string> {
  return {
    background: toHex(color),
    height: `${width}px`,
    opacity: `${opacity}`,
  };
}
</script>

<template>
  <div class="mbd-annotation-style-panel space-y-4">
    <h3 class="mb-2 border-b pb-1 text-sm font-semibold">MBD 管道标注样式</h3>

    <div class="space-y-2 rounded-md border border-border p-3">
      <div class="text-xs font-medium uppercase text-gray-500">快速预设</div>
      <div class="grid gap-2 md:grid-cols-3">
        <button v-for="preset in presetOptions"
          :key="preset.id"
          type="button"
          :data-testid="`mbd-style-preset-${preset.id}`"
          class="rounded-md border border-border bg-gray-50 p-2 text-left text-xs transition hover:border-gray-400 hover:bg-white"
          @click="applyPreset(preset.id)">
          <div class="font-semibold text-foreground">{{ preset.label }}</div>
          <div class="mt-2 flex h-8 items-center gap-2 rounded border border-dashed border-border bg-white px-2">
            <span class="h-3 w-3 rounded-full border border-white shadow-sm"
              :style="{ background: toHex(preset.pipeColor) }" />
            <span class="h-3 flex-1 rounded-full"
              :style="previewStyle(preset.dimensionColor, 4)" />
            <span class="h-3 flex-1 rounded-full"
              :style="previewStyle(preset.edgeColor, 3)" />
          </div>
        </button>
      </div>
    </div>

    <fieldset class="space-y-3 rounded-md border border-border p-3">
      <legend class="px-1 text-xs font-medium uppercase text-gray-500">尺寸标注</legend>

      <label class="flex items-center justify-between gap-3 text-sm">
        <span>尺寸线颜色</span>
        <input :value="toHex(profile.dimension.lineColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('dimension', 'lineColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>悬停颜色</span>
        <input :value="toHex(profile.dimension.lineHoverColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('dimension', 'lineHoverColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>选中颜色</span>
        <input :value="toHex(profile.dimension.lineSelectedColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('dimension', 'lineSelectedColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="flex items-center justify-between">
          <span>线宽 (px)</span>
          <input v-model.number="profile.dimension.lineWidthPx"
            type="number"
            min="1"
            max="12"
            step="0.1"
            class="w-20 rounded border px-1 text-right" />
        </span>
        <input v-model.number="profile.dimension.lineWidthPx"
          type="range"
          min="1"
          max="12"
          step="0.1" />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="flex items-center justify-between">
          <span>箭头大小 (px)</span>
          <input v-model.number="profile.dimension.arrowSizePx"
            type="number"
            min="6"
            max="40"
            step="1"
            class="w-20 rounded border px-1 text-right" />
        </span>
        <input v-model.number="profile.dimension.arrowSizePx"
          type="range"
          min="6"
          max="40"
          step="1" />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="flex items-center justify-between">
          <span>界线透明度</span>
          <input v-model.number="profile.dimension.extensionLineOpacity"
            type="number"
            min="0"
            max="1"
            step="0.05"
            class="w-20 rounded border px-1 text-right" />
        </span>
        <input v-model.number="profile.dimension.extensionLineOpacity"
          type="range"
          min="0"
          max="1"
          step="0.05" />
      </label>

      <div class="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2">
        <div class="relative flex h-10 items-center">
          <div class="absolute left-4 right-4 rounded-full"
            :style="previewStyle(profile.dimension.lineColor, profile.dimension.lineWidthPx, profile.dimension.lineOpacity)" />
          <div class="relative z-10 h-3 w-3 rotate-45 border-b border-l"
            :style="{ borderColor: toHex(profile.dimension.lineColor) }" />
          <div class="relative z-10 ml-auto h-3 w-3 rotate-45 border-r border-t"
            :style="{ borderColor: toHex(profile.dimension.lineColor) }" />
        </div>
      </div>
    </fieldset>

    <fieldset class="space-y-3 rounded-md border border-border p-3">
      <legend class="px-1 text-xs font-medium uppercase text-gray-500">引线</legend>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>引线颜色</span>
        <input :value="toHex(profile.leader.lineColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('leader', 'lineColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="flex items-center justify-between">
          <span>引线透明度</span>
          <input v-model.number="profile.leader.lineOpacity"
            type="number"
            min="0"
            max="1"
            step="0.05"
            class="w-20 rounded border px-1 text-right" />
        </span>
        <input v-model.number="profile.leader.lineOpacity"
          type="range"
          min="0"
          max="1"
          step="0.05" />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="flex items-center justify-between">
          <span>引线管透明度</span>
          <input v-model.number="profile.leader.tubeOpacity"
            type="number"
            min="0"
            max="1"
            step="0.05"
            class="w-20 rounded border px-1 text-right" />
        </span>
        <input v-model.number="profile.leader.tubeOpacity"
          type="range"
          min="0"
          max="1"
          step="0.05" />
      </label>
    </fieldset>

    <fieldset class="space-y-3 rounded-md border border-border p-3">
      <legend class="px-1 text-xs font-medium uppercase text-gray-500">管道轮廓</legend>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>管道主体</span>
        <input :value="toHex(profile.pipeEmphasis.bodyColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('pipeEmphasis', 'bodyColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>管道环线</span>
        <input :value="toHex(profile.pipeEmphasis.ringColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('pipeEmphasis', 'ringColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>外轮廓线</span>
        <input :value="toHex(profile.pipeEmphasis.outlineColor)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('pipeEmphasis', 'outlineColor', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span>模型边线</span>
        <input :value="toHex(profile.modelEdges.color)"
          type="color"
          class="h-8 w-14 rounded border px-1"
          @input="updateColor('modelEdges', 'color', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="flex items-center justify-between">
          <span>边线宽度 (px)</span>
          <input v-model.number="profile.modelEdges.lineWidthPx"
            type="number"
            min="1"
            max="8"
            step="0.1"
            class="w-20 rounded border px-1 text-right" />
        </span>
        <input v-model.number="profile.modelEdges.lineWidthPx"
          type="range"
          min="1"
          max="8"
          step="0.1" />
      </label>
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
