<script setup lang="ts">
import { computed } from 'vue';

import {
  DEFAULT_DIMENSION_STYLE,
  useDimensionStyleStore,
} from '@/composables/useDimensionStyleStore';

const { style, resetToDefaults } = useDimensionStyleStore();

const isModified = computed(() => {
  const keys = Object.keys(DEFAULT_DIMENSION_STYLE) as (keyof typeof DEFAULT_DIMENSION_STYLE)[];
  return keys.some((k) => style[k] !== DEFAULT_DIMENSION_STYLE[k]);
});
</script>

<template>
  <div class="dimension-style-panel space-y-4">
    <h3 class="text-sm font-semibold border-b pb-1 mb-2">尺寸标注样式</h3>

    <!-- 颜色 -->
    <fieldset class="space-y-2">
      <legend class="text-xs font-medium text-gray-500 uppercase tracking-wide">颜色</legend>
      <label class="flex items-center justify-between text-sm">
        <span>线条颜色</span>
        <input v-model="style.lineColor" type="color" class="w-8 h-6 border rounded cursor-pointer" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>悬停颜色</span>
        <input v-model="style.lineColorHover" type="color" class="w-8 h-6 border rounded cursor-pointer" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>选中颜色</span>
        <input v-model="style.lineColorSelected" type="color" class="w-8 h-6 border rounded cursor-pointer" />
      </label>
    </fieldset>

    <!-- 线条 -->
    <fieldset class="space-y-2">
      <legend class="text-xs font-medium text-gray-500 uppercase tracking-wide">线条</legend>
      <label class="flex items-center justify-between text-sm">
        <span>线宽 (px)</span>
        <input v-model.number="style.lineWidth" type="number" min="1" max="10" step="0.5" class="w-16 border rounded px-1 text-right" />
      </label>
    </fieldset>

    <!-- 箭头 -->
    <fieldset class="space-y-2">
      <legend class="text-xs font-medium text-gray-500 uppercase tracking-wide">箭头</legend>
      <label class="flex items-center justify-between text-sm">
        <span>样式</span>
        <select v-model="style.arrowStyle" class="border rounded px-1 text-sm">
          <option value="filled">实心三角</option>
          <option value="open">V 形线段</option>
        </select>
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>大小 (px)</span>
        <input v-model.number="style.arrowSizePx" type="number" min="4" max="30" step="1" class="w-16 border rounded px-1 text-right" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>半角 (°)</span>
        <input v-model.number="style.arrowAngleDeg" type="number" min="5" max="45" step="1" class="w-16 border rounded px-1 text-right" />
      </label>
    </fieldset>

    <!-- 界线 -->
    <fieldset class="space-y-2">
      <legend class="text-xs font-medium text-gray-500 uppercase tracking-wide">界线</legend>
      <label class="flex items-center justify-between text-sm">
        <span>超出 (px)</span>
        <input v-model.number="style.extensionOvershootPx" type="number" min="0" max="30" step="1" class="w-16 border rounded px-1 text-right" />
      </label>
    </fieldset>

    <!-- 文字 -->
    <fieldset class="space-y-2">
      <legend class="text-xs font-medium text-gray-500 uppercase tracking-wide">文字</legend>
      <label class="flex items-center justify-between text-sm">
        <span>字高 (px)</span>
        <input v-model.number="style.textCapHeightPx" type="number" min="6" max="30" step="0.5" class="w-16 border rounded px-1 text-right" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>小数位</span>
        <input v-model.number="style.decimals" type="number" min="0" max="6" step="1" class="w-16 border rounded px-1 text-right" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>单位后缀</span>
        <input v-model="style.unit" type="text" placeholder="mm / m / 无" class="w-20 border rounded px-1 text-right" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>背景遮挡</span>
        <input v-model="style.showBackground" type="checkbox" class="w-4 h-4" />
      </label>
    </fieldset>

    <!-- 虚线 -->
    <fieldset class="space-y-2">
      <legend class="text-xs font-medium text-gray-500 uppercase tracking-wide">参考虚线</legend>
      <label class="flex items-center justify-between text-sm">
        <span>线段 (px)</span>
        <input v-model.number="style.dashSizePx" type="number" min="1" max="20" step="1" class="w-16 border rounded px-1 text-right" />
      </label>
      <label class="flex items-center justify-between text-sm">
        <span>间隔 (px)</span>
        <input v-model.number="style.gapSizePx" type="number" min="1" max="20" step="1" class="w-16 border rounded px-1 text-right" />
      </label>
    </fieldset>

    <!-- 操作 -->
    <div class="flex gap-2 pt-2 border-t">
      <button :disabled="!isModified" class="flex-1 text-sm px-3 py-1.5 rounded border bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed" @click="resetToDefaults">
        恢复默认
      </button>
    </div>

    <!-- 预览色条 -->
    <div class="flex items-center gap-2 text-xs text-gray-400 pt-1">
      <span class="inline-block w-4 h-4 rounded" :style="{ background: style.lineColor }" />
      <span>{{ style.lineColor }}</span>
      <span class="inline-block w-4 h-4 rounded" :style="{ background: style.lineColorHover }" />
      <span>hover</span>
      <span class="inline-block w-4 h-4 rounded" :style="{ background: style.lineColorSelected }" />
      <span>selected</span>
    </div>
  </div>
</template>
