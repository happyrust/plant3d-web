<script setup lang="ts">
import { computed } from 'vue';

import {
  RENDER_LOOK_EFFECT_TOGGLES,
  useRenderLookStore,
  type RenderLookEffectToggle,
  type RenderLookMode,
} from '@/composables/useRenderLookStore';
import { SGL_LOOK_PRESETS, type SglLookPresetId } from '@/viewer/e3dLook/sglLookPresets';

const store = useRenderLookStore();

const modeOptions: {
  id: RenderLookMode;
  label: string;
  tagline: string;
  description: string;
  swatch: string;
}[] = [
  {
    id: 'pbr',
    label: 'web 标准',
    tagline: '默认 · 专业配色',
    description: 'three.js 物理材质，按显示主题给管道 / 设备 / 结构上专业色；选中品红整体染色 + 粉色描边。',
    swatch: 'linear-gradient(135deg, #38bdf8 0%, #f472b6 55%, #facc15 100%)',
  },
  {
    id: 'sgl',
    label: 'E3D 外观',
    tagline: 'AVEVA E3D 3.1 · SGL 复刻',
    description: '复刻 E3D 三维视图的画法：单头灯 + 灰度环境反射、黑色边线、HBAO 伪阴影、灰→白渐变背景、4× 抗锯齿；元素一色 lightgrey，选中按 E3D 染色（CE yellow、其余 white，无描边）。',
    swatch: 'linear-gradient(180deg, #9f9f9f 0%, #f2f2f2 100%)',
  },
];

const presetOptions = computed(() => Object.values(SGL_LOOK_PRESETS));

const isSgl = computed(() => store.enabled.value);

function onModeChange(mode: RenderLookMode): void {
  if (store.mode.value === mode) return;
  store.setMode(mode);
}

function onPresetChange(id: SglLookPresetId): void {
  if (store.preset.value === id) return;
  store.setPreset(id);
}

function presetEffectDefault(key: RenderLookEffectToggle['key']): boolean {
  const p = store.currentPreset.value;
  return key === 'aa' ? p.antiAlias : p[key];
}

function isEffectModified(key: RenderLookEffectToggle['key']): boolean {
  return store.getEffect(key) !== presetEffectDefault(key);
}

const presetSummary = computed(() => {
  const p = store.currentPreset.value;
  const on = [p.hlr && '边线', p.ao && '伪阴影', p.gradient && '背景渐变', p.antiAlias && '4× 抗锯齿'].filter(Boolean);
  return on.length > 0 ? `出厂位：${on.join(' / ')} 开` : '出厂位：四项全关';
});

const urlHint = computed(() => {
  if (!isSgl.value) return '?dtx_look=pbr';
  const preset = store.preset.value === 'e3d31-factory' ? 'factory' : 'machine';
  const parts = ['?dtx_look=sgl', `dtx_look_preset=${preset}`];
  const p = store.currentPreset.value;
  if (store.hlr.value !== p.hlr) parts.push(`dtx_look_hlr=${store.hlr.value ? 1 : 0}`);
  if (store.ao.value !== p.ao) parts.push(`dtx_look_ao=${store.ao.value ? 1 : 0}`);
  if (store.gradient.value !== p.gradient) parts.push(`dtx_look_gradient=${store.gradient.value ? 1 : 0}`);
  if (store.aa.value !== p.antiAlias) parts.push(`dtx_look_aa=${store.aa.value ? 1 : 0}`);
  return parts.join('&');
});
</script>

<template>
  <div class="render-mode-settings-panel space-y-4" data-testid="render-mode-settings-panel">
    <h3 class="mb-2 border-b pb-1 text-sm font-semibold">渲染模式</h3>

    <!-- 模式 -->
    <div class="space-y-2 rounded-md border border-border p-3">
      <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">三维查看器外观</div>
      <p class="text-xs leading-5 text-muted-foreground">
        切换后立即生效并记住选择（同一浏览器下次打开沿用）；版本分屏对比时暂不套用 E3D 外观。
      </p>
      <div class="grid gap-3">
        <button v-for="opt in modeOptions"
          :key="opt.id"
          type="button"
          role="radio"
          :aria-checked="store.mode.value === opt.id"
          :data-testid="`render-mode-option-${opt.id}`"
          class="rounded-lg border p-3 text-left transition hover:border-slate-400 hover:bg-white"
          :class="store.mode.value === opt.id
            ? 'border-ring bg-muted ring-1 ring-ring'
            : 'border-border bg-slate-50'"
          @click="onModeChange(opt.id)">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-foreground">{{ opt.label }}</div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">{{ opt.tagline }}</div>
            </div>
            <span class="inline-block h-6 w-10 shrink-0 rounded-sm border border-border"
              :style="{ background: opt.swatch }" />
          </div>
          <div class="mt-2 text-xs leading-5 text-muted-foreground">{{ opt.description }}</div>
          <div v-if="store.mode.value === opt.id"
            class="mt-2 inline-block rounded-full border border-border bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            当前
          </div>
        </button>
      </div>
    </div>

    <!-- 预设 -->
    <fieldset class="space-y-2 rounded-md border border-border p-3"
      :disabled="!isSgl"
      :class="isSgl ? '' : 'opacity-60'">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">E3D 预设</legend>
      <p class="text-xs leading-5 text-muted-foreground">
        两台不同口径的 E3D 3.1。切预设会把光照常量与下面四个开关一起换到该预设的出厂位。
      </p>
      <div class="grid gap-2">
        <label v-for="preset in presetOptions"
          :key="preset.id"
          class="flex items-start gap-2 rounded border px-2 py-1.5 text-sm transition"
          :class="[
            store.preset.value === preset.id ? 'border-ring bg-muted' : 'border-transparent hover:bg-muted/40',
            isSgl ? 'cursor-pointer' : 'cursor-not-allowed',
          ]">
          <input type="radio"
            name="render-look-preset"
            class="mt-1"
            :data-testid="`render-mode-preset-${preset.id}`"
            :checked="store.preset.value === preset.id"
            :disabled="!isSgl"
            @change="onPresetChange(preset.id)" />
          <span>
            <span class="font-medium">{{ preset.label }}</span>
            <span class="block text-xs leading-5 text-muted-foreground">{{ preset.description }}</span>
          </span>
        </label>
      </div>
    </fieldset>

    <!-- 子开关 -->
    <fieldset class="space-y-2 rounded-md border border-border p-3"
      :disabled="!isSgl"
      :class="isSgl ? '' : 'opacity-60'">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">后处理效果</legend>
      <p class="text-xs leading-5 text-muted-foreground">
        对应 sglDx11 的四个视图开关，可在预设之上单独覆盖。{{ presetSummary }}。
      </p>
      <div class="grid gap-2">
        <label v-for="toggle in RENDER_LOOK_EFFECT_TOGGLES"
          :key="toggle.key"
          class="flex items-start gap-2 rounded border border-transparent px-2 py-1.5 text-sm hover:bg-muted/40"
          :class="isSgl ? 'cursor-pointer' : 'cursor-not-allowed'">
          <input type="checkbox"
            class="mt-1"
            :data-testid="`render-mode-effect-${toggle.key}`"
            :checked="store.getEffect(toggle.key)"
            :disabled="!isSgl"
            @change="store.setEffect(toggle.key, ($event.target as HTMLInputElement).checked)" />
          <span>
            <span class="font-medium">{{ toggle.label }}</span>
            <span v-if="isEffectModified(toggle.key)"
              class="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">已改</span>
            <span class="block text-xs leading-5 text-muted-foreground">{{ toggle.description }}</span>
          </span>
        </label>
      </div>
      <div class="flex gap-2 border-t pt-2">
        <button type="button"
          data-testid="render-mode-reset-preset"
          :disabled="!isSgl || !store.isModifiedFromPreset.value"
          class="flex-1 rounded border bg-slate-50 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          @click="store.resetToPresetDefaults()">
          恢复预设出厂位
        </button>
      </div>
    </fieldset>

    <!-- 说明 -->
    <div class="space-y-1 rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
      <div>
        开 E3D 外观时显示主题自动切到「E3D 出厂」（全 lightgrey）并记住之前的主题，关掉时切回；开着时手动换主题不受影响。
      </div>
      <div>
        当前设置对应的 URL 参数（贴到地址栏可复现，仅本次生效、不落盘）：
        <code class="rounded bg-background px-1" data-testid="render-mode-url-hint">{{ urlHint }}</code>
      </div>
      <div>
        技术细节见 <code class="rounded bg-background px-1">docs/rendering/e3d-sgl-look-prototype.md</code>。
      </div>
    </div>
  </div>
</template>
