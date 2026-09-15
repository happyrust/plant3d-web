<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

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
import {
  useXeokitMeasurementStyleStore,
  type AngleMeasureVariant,
  type DistanceMeasureVariant,
} from '@/composables/useXeokitMeasurementStyleStore';
import {
  DEFAULT_MEASUREMENT_ANGLE_DECIMALS,
  MEASUREMENT_ANGLE_UNITS,
  isMeasurementAngleDecimalsValid,
  type MeasurementAngleUnit,
} from '@/measurement/units/measurementAngleUnits';
import {
  measurementDisplayUnitOptions,
  measurementSelectedDisplayUnit,
  resolveMeasurementDistanceFormat,
  type MeasurementDisplayUnit,
  type MeasurementUnitSystem,
} from '@/measurement/units/measurementUnits';
import { formatPdmsRef } from '@/utils/pdmsRefno';
import {
  buildAngleMeasurementResultRows,
  buildDistanceMeasurementResultRows,
  buildPerpendicularMeasurementResultRows,
  computeDistanceMeasurementResultInFrame,
  formatShortestMeasurementInfo,
} from '@/utils/xeokitMeasurementFormat';

const props = defineProps<{
  persistDraftResult?: () => boolean;
}>();

const store = useToolStore();
const unitSettings = useUnitSettingsStore();
const measurementStyle = useXeokitMeasurementStyleStore();
const referenceFrame = useMeasurementReferenceFrameStore();

const result = computed(() => store.measurementDraftResult.value);

/**
 * E3D 的 Measure Angle 是另一张窗体（`gphAngleMeasure`），结果表三行 Angle /
 * Direction1 / Direction2，测完一次就停在最后那一条上等下一次。Web 这边角度没有
 * 「草稿结果」这一层，第三击直接落成记录，所以角度模式下取最新那条记录来显示。
 */
const isAngleMode = computed(() => store.toolMode.value === 'xeokit_measure_angle');
const latestAngleMeasurement = computed(() => {
  if (!isAngleMode.value) return null;
  const list = store.xeokitAngleMeasurements.value;
  if (list.length === 0) return null;
  return list.reduce((latest, item) => (item.createdAt >= latest.createdAt ? item : latest));
});
const angleUnits = computed(() => measurementStyle.state.measurementAngleUnits);
const angleRows = computed(() => {
  const record = latestAngleMeasurement.value;
  if (!record) return [];
  return buildAngleMeasurementResultRows(
    record.corner,
    record.origin,
    record.target,
    referenceFrame.resolvedFrame.value,
    angleUnits.value,
    record.lineAngle ?? null,
  );
});

// E3D Design 功能区「Measure」下拉里角度有两个按钮：Angle 3 Points / Angle 2 Lines，同一张结果表。
const angleVariant = computed(() => measurementStyle.state.angleMeasureVariant);
const angleVariantOptions: readonly { value: AngleMeasureVariant; label: string }[] = [
  { value: 'three-point', label: 'Angle 3 Points' },
  { value: 'two-line', label: 'Angle 2 Lines' },
];
function setAngleVariant(event: Event): void {
  const variant = (event.target as HTMLSelectElement).value as AngleMeasureVariant;
  measurementStyle.updateStyle({ angleMeasureVariant: variant });
}
/** 两线夹角记录的来源摘要：线 × 线 / 线 × 面、两项标签、弧心是交点还是异面最近点。 */
const lineAngleInfo = computed(() => latestAngleMeasurement.value?.lineAngle ?? null);
const lineAngleText = computed(() => {
  const info = lineAngleInfo.value;
  if (!info) return '';
  const pair = info.kind === 'line-plane' ? '线 × 面' : '线 × 线';
  const root = info.kind === 'line-plane'
    ? (info.inPlane ? '线在面内（0°）' : '弧心 = 线与面的交点')
    : (info.skew ? '异面：弧心取第一条线上离第二条最近的点' : '弧心 = 两线交点');
  return `${pair} · ${info.firstLabel || '第一条线'} × ${info.secondLabel || '第二项'} · ${root}`;
});

// E3D Measure Angle 的 Units 框：Unit 四档 + Decimal Places（0–8，越界打回 2 并报错）。
const angleDecimalsDraft = ref(String(measurementStyle.state.measurementAngleUnits.decimalPlaces));
const angleDecimalsError = ref<string | null>(null);
watch(
  () => measurementStyle.state.measurementAngleUnits.decimalPlaces,
  (value) => { angleDecimalsDraft.value = String(value); },
);

function setAngleUnit(event: Event): void {
  const unit = (event.target as HTMLSelectElement).value as MeasurementAngleUnit;
  measurementStyle.updateMeasurementAngleUnits({ unit });
}

function setAngleDecimals(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  angleDecimalsDraft.value = raw;
  if (!isMeasurementAngleDecimalsValid(raw)) {
    angleDecimalsError.value = 'Value must be between 0 and 8';
    measurementStyle.updateMeasurementAngleUnits({ decimalPlaces: DEFAULT_MEASUREMENT_ANGLE_DECIMALS });
    angleDecimalsDraft.value = String(DEFAULT_MEASUREMENT_ANGLE_DECIMALS);
    return;
  }
  angleDecimalsError.value = null;
  measurementStyle.updateMeasurementAngleUnits({ decimalPlaces: Number(raw) });
}
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

/**
 * Web 增强「最短距离」（决策 `d-619`）：距离入口的第二档，两击拾点 / 线 / 面，结果表照旧，
 * 只多一行说明两端 witness 是怎么来的。E3D 没有这个入口——它的 Measure Shortest 永远是
 * 两拾中点距离（golden MD §32 / §33），所以下拉里不写成 E3D 的按钮名。
 */
const distanceVariant = computed(() => measurementStyle.state.distanceMeasureVariant);
const distanceVariantOptions: readonly { value: DistanceMeasureVariant; label: string }[] = [
  { value: 'point-to-point', label: 'Point to Point' },
  { value: 'shortest', label: 'Shortest（Web 增强）' },
];
function setDistanceVariant(event: Event): void {
  const variant = (event.target as HTMLSelectElement).value as DistanceMeasureVariant;
  measurementStyle.updateStyle({ distanceMeasureVariant: variant });
}
const shortestInfo = computed(() => result.value?.shortest ?? null);
const shortestText = computed(() => {
  const info = shortestInfo.value;
  return info ? formatShortestMeasurementInfo(info) : '';
});

// E3D Units 框：Unit type × Display Unit 决定这一窗体的 measureFormat；
// Default 档回落到全局单位设置（= E3D 的 !!distanceFmt）。
const unitSelection = computed(() => measurementStyle.state.measurementUnits);
// E3D 还有一档 Imperial，本项目不做（方案 §7 Q4，用户 2026-09-14 拍板）。
const unitSystemOptions: readonly { value: MeasurementUnitSystem; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'metric', label: 'Metric' },
];
const displayUnitOptions = computed(() => measurementDisplayUnitOptions(unitSelection.value.unitSystem));
const selectedDisplayUnit = computed(() => measurementSelectedDisplayUnit(unitSelection.value));
const distanceFormat = computed(() => resolveMeasurementDistanceFormat(unitSelection.value, {
  unit: unitSettings.displayUnit.value,
  precision: unitSettings.precision.value,
}));

function setUnitSystem(event: Event): void {
  const unitSystem = (event.target as HTMLSelectElement).value as MeasurementUnitSystem;
  measurementStyle.updateMeasurementUnits({ unitSystem });
}

function setDisplayUnit(event: Event): void {
  const displayUnit = (event.target as HTMLSelectElement).value as MeasurementDisplayUnit;
  measurementStyle.updateMeasurementUnits({ displayUnit });
}

const resultRows = computed(() => {
  if (!result.value) return [];
  if (perpendicularInfo.value) {
    return buildPerpendicularMeasurementResultRows(
      result.value.origin,
      result.value.target,
      unitSettings.displayUnit.value,
      unitSettings.precision.value,
      distanceFormat.value,
    );
  }
  return interpretedResult.value
    ? buildDistanceMeasurementResultRows(
      interpretedResult.value,
      unitSettings.displayUnit.value,
      unitSettings.precision.value,
      distanceFormat.value,
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
const angleRootText = computed(() => {
  const record = latestAngleMeasurement.value;
  return record ? pointText(record.corner) : '';
});
const angleFirstText = computed(() => {
  const record = latestAngleMeasurement.value;
  return record ? pointText(record.origin) : '';
});
const angleSecondText = computed(() => {
  const record = latestAngleMeasurement.value;
  return record ? pointText(record.target) : '';
});
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

    <div v-if="!isAngleMode"
      data-testid="measurement-units-controls"
      class="mt-2 rounded-md border border-border bg-muted/20 p-2">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-muted-foreground" for="measurement-distance-variant">Distance</label>
        <select id="measurement-distance-variant"
          data-testid="measurement-distance-variant"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="距离测量入口：Point to Point（两点）/ Shortest（两组几何的最短距离，Web 增强）"
          :value="distanceVariant"
          @change="setDistanceVariant">
          <option v-for="option in distanceVariantOptions"
            :key="option.value"
            :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <label class="text-xs text-muted-foreground" for="measurement-unit-system">
          Unit type
        </label>
        <select id="measurement-unit-system"
          data-testid="measurement-unit-system"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs"
          :value="unitSelection.unitSystem"
          @change="setUnitSystem">
          <option v-for="option in unitSystemOptions"
            :key="option.value"
            :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <label class="text-xs text-muted-foreground" for="measurement-display-unit">
          Display Unit
        </label>
        <select id="measurement-display-unit"
          data-testid="measurement-display-unit"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
          :disabled="displayUnitOptions.length === 0"
          :value="selectedDisplayUnit ?? ''"
          @change="setDisplayUnit">
          <option v-if="displayUnitOptions.length === 0" value="">
            （随全局单位设置）
          </option>
          <option v-for="option in displayUnitOptions"
            :key="option.token"
            :value="option.token">
            {{ option.label }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="isAngleMode"
      data-testid="measurement-angle-units-controls"
      class="mt-2 rounded-md border border-border bg-muted/20 p-2">
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-muted-foreground" for="measurement-angle-variant">Angle</label>
        <select id="measurement-angle-variant"
          data-testid="measurement-angle-variant"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs"
          aria-label="角度测量入口：Angle 3 Points（三点）/ Angle 2 Lines（两线）"
          :value="angleVariant"
          @change="setAngleVariant">
          <option v-for="option in angleVariantOptions"
            :key="option.value"
            :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <label class="text-xs text-muted-foreground" for="measurement-angle-unit">Unit</label>
        <select id="measurement-angle-unit"
          data-testid="measurement-angle-unit"
          class="h-8 rounded-md border border-input bg-background px-2 text-xs"
          :value="angleUnits.unit"
          @change="setAngleUnit">
          <option v-for="option in MEASUREMENT_ANGLE_UNITS"
            :key="option.value"
            :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <label class="text-xs text-muted-foreground" for="measurement-angle-decimals">
          Decimal Places
        </label>
        <input id="measurement-angle-decimals"
          data-testid="measurement-angle-decimals"
          class="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs"
          type="text"
          inputmode="numeric"
          :value="angleDecimalsDraft"
          @change="setAngleDecimals" />
      </div>
      <div v-if="angleDecimalsError"
        data-testid="measurement-angle-decimals-error"
        class="mt-1 text-xs text-destructive">
        {{ angleDecimalsError }}
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

    <div v-if="shortestInfo"
      data-testid="measurement-shortest-info"
      class="mt-2 rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
      最短距离 · {{ shortestText }}
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

    <template v-if="isAngleMode">
      <div v-if="angleRows.length === 0" class="mt-2 text-xs text-muted-foreground">
        {{ angleVariant === 'two-line'
          ? '先拾一条线，再拾一条线或一个面，在此显示 Decimal Angle / DMS / Direction1 / Direction2。'
          : '完成一次三点角度测量后在此显示 Angle / Direction1 / Direction2。' }}
      </div>
      <dl v-else data-testid="measurement-angle-result" class="mt-2 flex flex-col gap-1 text-xs">
        <div v-for="row in angleRows"
          :key="row.key"
          :data-testid="rowTestId(row.key)"
          class="flex items-start gap-2"
          :class="row.key === 'angle' ? 'text-sm font-semibold' : ''">
          <dt class="w-24 shrink-0 text-muted-foreground">{{ row.label }}</dt>
          <dd class="tabular-nums">
            {{ row.valueText }}
            <span v-if="row.key === 'angle' && latestAngleMeasurement?.approximate"
              class="ml-1 text-xs font-normal text-muted-foreground">近似</span>
          </dd>
        </div>
        <div v-if="lineAngleInfo" class="flex items-start gap-2">
          <dt class="w-24 shrink-0 text-muted-foreground">两线夹角</dt>
          <dd data-testid="measurement-angle-line-info" class="min-w-0 break-all">
            {{ lineAngleText }}
          </dd>
        </div>
        <div v-else class="flex items-start gap-2">
          <dt class="w-24 shrink-0 text-muted-foreground">顶点 → 两臂</dt>
          <dd data-testid="measurement-angle-points" class="min-w-0 break-all">
            {{ angleRootText }} → {{ angleFirstText }} / {{ angleSecondText }}
          </dd>
        </div>
      </dl>
    </template>

    <div v-else-if="!result" class="mt-2 text-xs text-muted-foreground">
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

      <label class="flex cursor-pointer items-center gap-2 text-xs"
        :class="distanceVariant === 'shortest' ? 'cursor-not-allowed opacity-50' : ''">
        <input type="checkbox"
          data-testid="measurement-result-perpendicular-toggle"
          class="h-3.5 w-3.5 accent-primary"
          :checked="measurementStyle.state.perpendicularTo"
          :disabled="distanceVariant === 'shortest'"
          aria-label="Perpendicular to：测到目标线/面的垂距"
          @change="setPerpendicularTo(($event.target as HTMLInputElement).checked)" />
        <span>Perpendicular to（第二点取轴线 / 圆面时测垂距{{ distanceVariant === 'shortest' ? '；Shortest 下不适用' : '' }}）</span>
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
