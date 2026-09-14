import type { LengthUnit } from '@/composables/useUnitSettingsStore';

/**
 * E3D Measure Distance 窗体的 Units 契约（`gphmeasure.pmlfrm` 56–58 / 719–799 +
 * `comformats.pmlobj` 1301–1356，E3D 3.1 静态源）。
 *
 * - `Unit type`（`.unitSystem`）E3D 有三档 Default / Metric / Imperial，缺省 Default。
 *   Default 下 `measureFormat = !!distanceFmt`（工程当前距离格式），`Display Unit` 控件禁用。
 * - `Display Unit`（`.unitDisplay`）按 Unit type 换一组，公制那一组是
 *   Millimetres / Centimetres / Metres（rText MM / CM / METRE），选中项记在 `.lastMetricSelection`。
 *
 * **英制不做**（方案 §7 Q4，用户 2026-09-14 拍板）：E3D 的 Imperial 档（Inch / Feet & Inches / Feet
 * → INCH / FINCH / FT 三个 FORMAT，1/32 英寸分数）本项目用不上，Unit type 只留 Default / Metric。
 * 要加回来的话，E3D 那三个 FORMAT 的逐格参数记在 golden MD §21。
 */
export type MeasurementUnitSystem = 'default' | 'metric';

export type MeasurementMetricUnit = 'MM' | 'CM' | 'METRE';
export type MeasurementDisplayUnit = MeasurementMetricUnit;

export type MeasurementDisplayUnitOption = Readonly<{
  /** E3D `unitDisplay.rText` 的取值（`selectUnitType` 拿它去要 FORMAT）。 */
  token: MeasurementDisplayUnit;
  /** E3D `unitDisplay.dText` 的显示名。 */
  label: string;
}>;

export const MEASUREMENT_METRIC_DISPLAY_UNITS: readonly MeasurementDisplayUnitOption[] = [
  { token: 'MM', label: 'Millimetres' },
  { token: 'CM', label: 'Centimetres' },
  { token: 'METRE', label: 'Metres' },
];

/**
 * `COMFORMATS.distanceFormat(STRING)` 造出来的 FORMAT 里公制用得到的那几格。
 * 字段名与 PML 的 FORMAT 成员同名，方便与 `comformats.pmlobj` 逐行对照。
 */
export type MeasurementDistanceFormat = Readonly<{
  units: MeasurementMetricUnit;
  /** `'UNITS'` = 用单位自己的短标签；否则原样附在数值后面。 */
  label: string;
  dp: number;
  trailZeros: boolean;
}>;

export type MeasurementUnitSelection = Readonly<{
  unitSystem: MeasurementUnitSystem;
  /** `lastMetricSelection` */
  metricUnit: MeasurementMetricUnit;
}>;

/** E3D 构造时 unitSystem 停在第 1 档，Display Unit 的记忆是第 1 项。 */
export const DEFAULT_MEASUREMENT_UNIT_SELECTION: MeasurementUnitSelection = {
  unitSystem: 'default',
  metricUnit: 'MM',
};

const METRES_PER_UNIT: Record<MeasurementMetricUnit, number> = {
  MM: 0.001,
  CM: 0.01,
  METRE: 1,
};

const UNIT_SHORT_LABELS: Record<MeasurementMetricUnit, string> = {
  MM: 'mm',
  CM: 'cm',
  METRE: 'm',
};

const GLOBAL_UNIT_TO_FORMAT_UNITS: Record<LengthUnit, MeasurementMetricUnit> = {
  mm: 'MM',
  cm: 'CM',
  m: 'METRE',
};

function clampDecimals(value: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(6, n));
}

function isMetricUnit(token: unknown): token is MeasurementMetricUnit {
  return token === 'MM' || token === 'CM' || token === 'METRE';
}

export function normalizeMeasurementUnitSelection(input: unknown): MeasurementUnitSelection {
  if (!input || typeof input !== 'object') return DEFAULT_MEASUREMENT_UNIT_SELECTION;
  const raw = input as Partial<MeasurementUnitSelection>;
  return {
    // 未知档（含旧配置里存过的 'imperial'）一律回 Default。
    unitSystem: raw.unitSystem === 'metric' ? 'metric' : 'default',
    metricUnit: isMetricUnit(raw.metricUnit)
      ? raw.metricUnit
      : DEFAULT_MEASUREMENT_UNIT_SELECTION.metricUnit,
  };
}

/**
 * 换 Unit type / Display Unit 的一步（E3D `changeUnitType` + `selectUnitType`）：
 * 选中的那一档写进公制那一套的记忆；Default 档下拉禁用，此刻传进来的 Display Unit 一律忽略
 * （E3D 里那个下拉此刻是灰的）。
 */
export function applyMeasurementUnitSelection(
  current: MeasurementUnitSelection,
  patch: Readonly<{ unitSystem?: MeasurementUnitSystem; displayUnit?: MeasurementDisplayUnit }>,
): MeasurementUnitSelection {
  const unitSystem = patch.unitSystem ?? current.unitSystem;
  const metricUnit = unitSystem === 'metric' && isMetricUnit(patch.displayUnit)
    ? patch.displayUnit
    : current.metricUnit;
  return { unitSystem, metricUnit };
}

/** 当前 Unit type 下 Display Unit 下拉里的那一组；Default 档下拉禁用（空组）。 */
export function measurementDisplayUnitOptions(
  unitSystem: MeasurementUnitSystem,
): readonly MeasurementDisplayUnitOption[] {
  return unitSystem === 'metric' ? MEASUREMENT_METRIC_DISPLAY_UNITS : [];
}

/** 当前 Unit type 下 Display Unit 的选中项；Default 档没有选中项。 */
export function measurementSelectedDisplayUnit(
  selection: MeasurementUnitSelection,
): MeasurementDisplayUnit | null {
  return selection.unitSystem === 'metric' ? selection.metricUnit : null;
}

/** `COMFORMATS.distanceFormat(!unit)` 的公制三档（`comformats.pmlobj` 1326–1353）。 */
export function measurementDistanceFormatForUnit(
  unit: MeasurementDisplayUnit,
): MeasurementDistanceFormat {
  switch (unit) {
    case 'METRE':
      return { units: 'METRE', label: 'UNITS', dp: 3, trailZeros: false };
    case 'CM':
      return { units: 'CM', label: 'UNITS', dp: 3, trailZeros: false };
    case 'MM':
    default:
      // `else` 分支（公制）：dp 2、不留尾零 —— 与 `!!distanceFmt` 实机一致（golden G1-04）。
      return { units: 'MM', label: 'UNITS', dp: 2, trailZeros: false };
  }
}

/**
 * Default 档 = E3D 的 `!!distanceFmt`（工程当前距离格式）。Web 这一侧对应的是
 * 全局单位设置（显示单位 + 小数位），所以留尾零、按用户设的位数走。
 */
export function measurementDefaultDistanceFormat(
  fallback: Readonly<{ unit: LengthUnit; precision: number }>,
): MeasurementDistanceFormat {
  return {
    units: GLOBAL_UNIT_TO_FORMAT_UNITS[fallback.unit] ?? 'MM',
    label: 'UNITS',
    dp: clampDecimals(fallback.precision),
    trailZeros: true,
  };
}

/** 当前测量会话实际生效的 FORMAT（E3D `gphMeasure.measureFormat`）。 */
export function resolveMeasurementDistanceFormat(
  selection: MeasurementUnitSelection,
  fallback: Readonly<{ unit: LengthUnit; precision: number }>,
): MeasurementDistanceFormat {
  const unit = measurementSelectedDisplayUnit(selection);
  return unit ? measurementDistanceFormatForUnit(unit) : measurementDefaultDistanceFormat(fallback);
}

function unitLabel(format: MeasurementDistanceFormat): string {
  return format.label === 'UNITS' ? UNIT_SHORT_LABELS[format.units] : format.label;
}

function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

export type MeasurementLengthFormatOptions = Readonly<{
  /** `true` 时按 E3D 结果表的 Offset 行加 `+` / `-` 前缀（值为 0 时不加号）。 */
  signed?: boolean;
  /** 数值与单位标签之间的分隔；画布尺寸标签沿用一个空格。 */
  separator?: string;
  /** `false` 时只出数值、不带单位标签。 */
  suffix?: boolean;
}>;

/**
 * 按 FORMAT 渲染一个长度（入参米）：转到目标单位 → `dp` 位四舍五入 → `trailZeros`
 * 决定去不去尾零 → 附单位标签；四舍五入后为 0 一律出不带号的 `0`
 * （E3D 无负零，golden G1-04）。
 */
export function formatMeasurementLengthMeters(
  valueMeters: number,
  format: MeasurementDistanceFormat,
  options?: MeasurementLengthFormatOptions,
): string {
  const raw = Number(valueMeters);
  const meters = Number.isFinite(raw) ? raw : 0;
  const value = meters / METRES_PER_UNIT[format.units];
  const fixed = Math.abs(value).toFixed(clampDecimals(format.dp));
  const body = format.trailZeros ? fixed : stripTrailingZeros(fixed);

  const label = options?.suffix === false ? '' : `${options?.separator ?? ''}${unitLabel(format)}`;
  if (Number(fixed) === 0) return `${body}${label}`;
  const sign = value < 0 ? '-' : (options?.signed ? '+' : '');
  return `${sign}${body}${label}`;
}
