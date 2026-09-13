<script setup lang="ts">
import { computed, onMounted } from 'vue';

import {
  formatMeasurementSnapLabel,
  getCachedNounForRefno,
  requestNounForRefno,
} from '@/composables/measurementSnapLabel';
import {
  useMeasurementReferenceFrameStore,
  type MeasurementReferenceFrameMode,
} from '@/composables/useMeasurementReferenceFrameStore';
import { useToolStore, type MeasurementPoint } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';
import { formatPdmsRef } from '@/utils/pdmsRefno';
import {
  buildDistanceMeasurementResultRows,
  buildPerpendicularMeasurementResultRows,
  computeDistanceMeasurementResultInFrame,
} from '@/utils/xeokitMeasurementFormat';

const props = defineProps<{
  persistDraftResult?: () => boolean;
}>();

const store = useToolStore();
const unitSettings = useUnitSettingsStore();
const measurementStyle = useXeokitMeasurementStyleStore();
const referenceFrame = useMeasurementReferenceFrameStore();

const result = computed(() => store.measurementDraftResult.value);
const interpretedResult = computed(() => {
  if (!result.value) return null;
  return computeDistanceMeasurementResultInFrame(
    result.value.origin,
    result.value.target,
    referenceFrame.resolvedFrame.value,
  ) ?? result.value;
});
// E3D Perpendicular to：结果表换成 Distance / Vertical / Horizontal / Direction，
// 且不随 WRT 重解释（垂距模式下 E3D 的 wrt 控件禁用、方向按 World，golden G4-06）。
const perpendicularInfo = computed(() => result.value?.perpendicular ?? null);
const resultRows = computed(() => {
  if (!result.value) return [];
  if (perpendicularInfo.value) {
    return buildPerpendicularMeasurementResultRows(
      result.value.origin,
      result.value.target,
      unitSettings.displayUnit.value,
      unitSettings.precision.value,
    );
  }
  return interpretedResult.value
    ? buildDistanceMeasurementResultRows(
      interpretedResult.value,
      unitSettings.displayUnit.value,
      unitSettings.precision.value,
    )
    : [];
});

function rowTestId(key: string): string {
  return `measurement-result-row-${key}`;
}

function setShowDirectLinearDimension(checked: boolean): void {
  measurementStyle.updateStyle({ showDirectLinearDimension: checked });
}

function setPerpendicularTo(checked: boolean): void {
  measurementStyle.updateStyle({ perpendicularTo: checked });
}

function setKeepMeasurementAnnotation(checked: boolean): void {
  measurementStyle.updateStyle({ keepMeasurementAnnotation: checked });
}

function persistNow(): void {
  props.persistDraftResult?.();
}

function setWrtMode(event: Event): void {
  const mode = (event.target as HTMLSelectElement).value as MeasurementReferenceFrameMode;
  void referenceFrame.setMode(mode);
}

function setExplicitWrt(event: Event): void {
  referenceFrame.setExplicitRefno((event.target as HTMLInputElement).value);
}

function resolveWrt(): void {
  void referenceFrame.resolveCurrent();
}

function pointText(point: MeasurementPoint): string {
  const refno = point.sourceInfo?.refno ?? null;
  if (refno) requestNounForRefno(refno);
  const text = formatMeasurementSnapLabel({
    label: point.sourceInfo?.label,
    noun: getCachedNounForRefno(refno),
    refno,
  });
  return text || formatPdmsRef(point.entityId);
}

const originText = computed(() => (result.value ? pointText(result.value.origin) : ''));
const targetText = computed(() => (result.value ? pointText(result.value.target) : ''));
const persisted = computed(() => Boolean(result.value?.persistedMeasurementId));

onMounted(() => {
  void referenceFrame.resolveCurrent();
});
</script>

<template>
  <div data-testid="measurement-result-inspector"
    class="rounded-md border border-border bg-background p-3">
    <div class="flex items-center justify-between gap-2">
      <div class="text-sm font-semibold">测量结果</div>
      <div data-testid="measurement-wrt-active"
        class="text-xs text-muted-foreground">
        wrt: {{ perpendicularInfo ? 'World（垂距模式固定）' : referenceFrame.resolvedLabel.value }}
      </div>
    </div>

    <div v-if="perpendicularInfo"
      data-testid="measurement-perpendicular-info"
      class="mt-2 rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
      Perpendicular to ·
      {{ perpendicularInfo.targetKind === 'line' ? '点→无限线'
        : perpendicularInfo.targetKind === 'plane' ? '点→无限面' : '点→点（目标无轴向/面几何）' }}
      <template v-if="perpendicularInfo.targetLabel">· {{ perpendicularInfo.targetLabel }}</template>
    </div>

    <div data-testid="measurement-wrt-controls"
      class="mt-2 rounded-md border border-border bg-muted/20 p-2"
      :class="perpendicularInfo ? 'pointer-events-none opacity-50' : ''"
      :aria-disabled="perpendicularInfo ? 'true' : undefined">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-muted-foreground" for="measurement-wrt-mode">
          参考系
        </label>
        <select id="measurement-wrt-mode"
          data-testid="measurement-wrt-mode"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs"
          :value="referenceFrame.mode.value"
          @change="setWrtMode">
          <option value="world">World</option>
          <option value="current-element">当前元素 (CE)</option>
          <option value="owner">Owner</option>
          <option value="explicit-refno">refno / DBREF</option>
        </select>
        <input v-if="referenceFrame.mode.value === 'explicit-refno'"
          data-testid="measurement-wrt-refno"
          class="h-8 min-w-44 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          type="text"
          placeholder="例如 24381/145018 或 DBREF =24381/145018"
          :value="referenceFrame.explicitRefno.value"
          @input="setExplicitWrt"
          @keydown.enter.prevent="resolveWrt" />
        <button type="button"
          data-testid="measurement-wrt-apply"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted disabled:opacity-50"
          :disabled="referenceFrame.isResolving.value"
          @click="resolveWrt">
          {{ referenceFrame.isResolving.value ? '解析中…' : '重算' }}
        </button>
      </div>
      <div data-testid="measurement-wrt-status"
        class="mt-1 text-xs text-muted-foreground">
        当前 {{ referenceFrame.resolvedLabel.value }} ·
        {{ referenceFrame.axisLabels.value.join('/') }}
      </div>
      <div v-if="referenceFrame.resolutionError.value"
        data-testid="measurement-wrt-error"
        class="mt-1 text-xs text-destructive">
        WRT 未应用（{{ referenceFrame.resolutionError.value.code }}）：
        {{ referenceFrame.resolutionError.value.message }}；结果仍按
        {{ referenceFrame.resolvedLabel.value }} 显示。
      </div>
    </div>

    <div v-if="!result" class="mt-2 text-xs text-muted-foreground">
      完成一次测量后在此显示 距离 / Offset / 起终点。
    </div>

    <template v-else>
      <dl class="mt-2 flex flex-col gap-1 text-xs">
        <div v-for="row in resultRows"
          :key="row.key"
          :data-testid="rowTestId(row.key)"
          class="flex items-start gap-2"
          :class="row.key === 'distance' ? 'text-sm font-semibold' : ''">
          <dt class="w-24 shrink-0 text-muted-foreground">{{ row.label }}</dt>
          <dd class="tabular-nums">
            {{ row.valueText }}
            <span v-if="row.key === 'distance' && result.approximate"
              class="ml-1 text-xs font-normal text-muted-foreground">近似</span>
          </dd>
        </div>
        <div class="flex items-start gap-2">
          <dt class="w-24 shrink-0 text-muted-foreground">起点 → 终点</dt>
          <dd data-testid="measurement-result-points" class="min-w-0 break-all">
            {{ originText }} → {{ targetText }}
          </dd>
        </div>
      </dl>
    </template>

    <div class="mt-3 flex flex-col gap-2 border-t border-border pt-2">
      <label class="flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox"
          data-testid="measurement-result-show-direct-toggle"
          class="h-3.5 w-3.5 accent-primary"
          :checked="measurementStyle.state.showDirectLinearDimension"
          aria-label="显示直接斜线尺寸"
          @change="setShowDirectLinearDimension(($event.target as HTMLInputElement).checked)" />
        <span>显示直接斜线尺寸</span>
      </label>

      <label class="flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox"
          data-testid="measurement-result-perpendicular-toggle"
          class="h-3.5 w-3.5 accent-primary"
          :checked="measurementStyle.state.perpendicularTo"
          aria-label="Perpendicular to：测到目标线/面的垂距"
          @change="setPerpendicularTo(($event.target as HTMLInputElement).checked)" />
        <span>Perpendicular to（第二点取轴线 / 圆面时测垂距）</span>
      </label>

      <div class="flex items-center justify-between gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox"
            data-testid="measurement-result-keep-toggle"
            class="h-3.5 w-3.5 accent-primary"
            :checked="measurementStyle.state.keepMeasurementAnnotation"
            aria-label="测量后保留为标注"
            @change="setKeepMeasurementAnnotation(($event.target as HTMLInputElement).checked)" />
          <span>测量后保留为标注</span>
        </label>
        <button v-if="result && !persisted"
          type="button"
          data-testid="measurement-result-persist-now"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
          title="把当前临时结果保留为可管理的测量标注"
          @click="persistNow">
          保留本次
        </button>
        <span v-else-if="result" class="text-xs text-muted-foreground">已保留</span>
      </div>
    </div>
  </div>
</template>
