<script setup lang="ts">
import { computed } from 'vue';

import {
  formatMeasurementSnapLabel,
  getCachedNounForRefno,
  requestNounForRefno,
} from '@/composables/measurementSnapLabel';
import { useToolStore, type MeasurementPoint } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { useXeokitMeasurementStyleStore } from '@/composables/useXeokitMeasurementStyleStore';
import { formatPdmsRef } from '@/utils/pdmsRefno';
import { formatLengthMeters } from '@/utils/unitFormat';
import {
  DISTANCE_AXIS_LABELS,
  formatSignedLengthMeters,
} from '@/utils/xeokitMeasurementFormat';

const props = defineProps<{
  persistDraftResult?: () => boolean;
}>();

const store = useToolStore();
const unitSettings = useUnitSettingsStore();
const measurementStyle = useXeokitMeasurementStyleStore();

const result = computed(() => store.measurementDraftResult.value);

const distanceText = computed(() => {
  if (!result.value) return '';
  return formatLengthMeters(
    result.value.distance,
    unitSettings.displayUnit.value,
    unitSettings.precision.value,
  );
});

const offsetText = computed(() => {
  if (!result.value) return '';
  return result.value.offsets.components
    .map((component, index) => (
      `${DISTANCE_AXIS_LABELS[index]} ${formatSignedLengthMeters(
        component,
        unitSettings.displayUnit.value,
        unitSettings.precision.value,
      )}`
    ))
    .join(' · ');
});

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

function setPersistDimension(checked: boolean): void {
  measurementStyle.updateStyle({ persistDimension: checked });
}

function persistNow(): void {
  props.persistDraftResult?.();
}
</script>

<template>
  <div data-testid="measurement-result-inspector"
    class="rounded-md border border-border bg-background p-3">
    <div class="flex items-center justify-between gap-2">
      <div class="text-sm font-semibold">测量结果</div>
      <div class="text-xs text-muted-foreground">wrt: World</div>
    </div>

    <div v-if="!result" class="mt-2 text-xs text-muted-foreground">
      完成一次测量后在此显示 距离 / Offset / 起终点。
    </div>

    <template v-else>
      <div data-testid="measurement-result-distance"
        class="mt-2 text-2xl font-semibold tabular-nums">
        {{ distanceText }}
        <span v-if="result.approximate" class="ml-1 align-middle text-xs font-normal text-muted-foreground">近似</span>
      </div>

      <dl class="mt-2 flex flex-col gap-1 text-xs">
        <div class="flex items-start gap-2">
          <dt class="w-24 shrink-0 text-muted-foreground">Offset (wrt World)</dt>
          <dd data-testid="measurement-result-offset" class="tabular-nums">{{ offsetText }}</dd>
        </div>
        <div class="flex items-start gap-2">
          <dt class="w-24 shrink-0 text-muted-foreground">Direction</dt>
          <dd class="text-muted-foreground" title="显示格式待 E3D 实机验证，内部已存方向向量">—</dd>
        </div>
        <div class="flex items-start gap-2">
          <dt class="w-24 shrink-0 text-muted-foreground">起点 → 终点</dt>
          <dd data-testid="measurement-result-points" class="min-w-0 break-all">
            {{ originText }} → {{ targetText }}
          </dd>
        </div>
      </dl>

      <div class="mt-3 flex items-center justify-between gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox"
            data-testid="measurement-result-persist-toggle"
            class="h-3.5 w-3.5 accent-primary"
            :checked="measurementStyle.state.persistDimension"
            aria-label="测量完成后生成线性标注"
            @change="setPersistDimension(($event.target as HTMLInputElement).checked)" />
          <span>生成线性标注</span>
        </label>
        <button v-if="!persisted"
          type="button"
          data-testid="measurement-result-persist-now"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-muted"
          title="把当前临时结果落地为持久线性标注"
          @click="persistNow">
          落地标注
        </button>
        <span v-else class="text-xs text-muted-foreground">已生成标注</span>
      </div>
    </template>
  </div>
</template>
