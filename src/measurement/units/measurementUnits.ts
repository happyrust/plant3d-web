import type { LengthUnit } from '@/composables/useUnitSettingsStore';

/**
 * E3D Measure Distance 窗体的 Units 契约（`gphmeasure.pmlfrm` 56–58 / 719–799 +
 * `comformats.pmlobj` 1301–1356，E3D 3.1 静态源）。
 *
 * - `Unit type`（`.unitSystem`）三档：Default / Metric / Imperial，缺省 Default。
 *   Default 下 `measureFormat = !!distanceFmt`（工程当前距离格式），`Display Unit` 控件禁用。
 * - `Display Unit`（`.unitDisplay`）按 Unit type 换一组：
 *   Metric = Millimetres / Centimetres / Metres（rText MM / CM / METRE），
 *   Imperial = Inch / Feet & Inches / Feet（rText IN / FINC / FT）。
 * - 两套各记一次上次选择（`.lastMetricSelection` / `.lastImperialSelection`），
 *   来回切 Unit type 时各自回到自己的上一次。
 */
export type MeasurementUnitSystem = 'default' | 'metric' | 'imperial';

export type MeasurementMetricUnit = 'MM' | 'CM' | 'METRE';
export type MeasurementImperialUnit = 'IN' | 'FINC' | 'FT';
export type MeasurementDisplayUnit = MeasurementMetricUnit | MeasurementImperialUnit;

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

export const MEASUREMENT_IMPERIAL_DISPLAY_UNITS: readonly MeasurementDisplayUnitOption[] = [
  { token: 'IN', label: 'Inch' },
  { token: 'FINC', label: 'Feet & Inches' },
  { token: 'FT', label: 'Feet' },
];

/**
 * `COMFORMATS.distanceFormat(STRING)` 造出来的 FORMAT 里测量用得到的那几格。
 * 字段名与 PML 的 FORMAT 成员同名，方便与 `comformats.pmlobj` 逐行对照。
 */
export type MeasurementDistanceFormat = Readonly<{
  units: 'MM' | 'CM' | 'METRE' | 'INCH' | 'FINCH' | 'FT';
  /** `'UNITS'` = 用单位自己的短标签；否则原样附在数值后面。 */
  label: string;
  dp: number;
  trailZeros: boolean;
  fraction: boolean;
  denominator: number;
  inchSeparator: string;
  ftLabel: string;
  /** FINCH 下 `false` = 零英尺不出 `0'-` 段。 */
  zeros: boolean;
}>;

export type MeasurementUnitSelection = Readonly<{
  unitSystem: MeasurementUnitSystem;
  /** `lastMetricSelection` */
  metricUnit: MeasurementMetricUnit;
  /** `lastImperialSelection` */
  imperialUnit: MeasurementImperialUnit;
}>;

/** E3D 构造时 unitSystem 停在第 1 档，两套 Display Unit 的记忆都是第 1 项。 */
export const DEFAULT_MEASUREMENT_UNIT_SELECTION: MeasurementUnitSelection = {
  unitSystem: 'default',
  metricUnit: 'MM',
  imperialUnit: 'IN',
};

const METRES_PER_UNIT: Record<MeasurementDistanceFormat['units'], number> = {
  MM: 0.001,
  CM: 0.01,
  METRE: 1,
  INCH: 0.0254,
  FINCH: 0.0254,
  FT: 0.3048,
};

const UNIT_SHORT_LABELS: Record<MeasurementDistanceFormat['units'], string> = {
  MM: 'mm',
  CM: 'cm',
  METRE: 'm',
  INCH: 'in',
  FINCH: 'in',
  FT: 'ft',
};

const GLOBAL_UNIT_TO_FORMAT_UNITS: Record<LengthUnit, MeasurementDistanceFormat['units']> = {
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

function isImperialUnit(token: unknown): token is MeasurementImperialUnit {
  return token === 'IN' || token === 'FINC' || token === 'FT';
}

export function normalizeMeasurementUnitSelection(input: unknown): MeasurementUnitSelection {
  if (!input || typeof input !== 'object') return DEFAULT_MEASUREMENT_UNIT_SELECTION;
  const raw = input as Partial<MeasurementUnitSelection>;
  const unitSystem: MeasurementUnitSystem = raw.unitSystem === 'metric' || raw.unitSystem === 'imperial'
    ? raw.unitSystem
    : 'default';
  return {
    unitSystem,
    metricUnit: isMetricUnit(raw.metricUnit)
      ? raw.metricUnit
      : DEFAULT_MEASUREMENT_UNIT_SELECTION.metricUnit,
    imperialUnit: isImperialUnit(raw.imperialUnit)
      ? raw.imperialUnit
      : DEFAULT_MEASUREMENT_UNIT_SELECTION.imperialUnit,
  };
}

/**
 * 换 Unit type / Display Unit 的一步（E3D `changeUnitType` + `selectUnitType`）：
 * 选中的那一档写进对应那一套的记忆，另一套原样留着；不属于当前那一套的
 * Display Unit 一律忽略（E3D 里那个下拉此刻根本没有这个选项）。
 */
export function applyMeasurementUnitSelection(
  current: MeasurementUnitSelection,
  patch: Readonly<{ unitSystem?: MeasurementUnitSystem; displayUnit?: MeasurementDisplayUnit }>,
): MeasurementUnitSelection {
  const unitSystem = patch.unitSystem ?? current.unitSystem;
  let { metricUnit, imperialUnit } = current;
  if (patch.displayUnit) {
    if (unitSystem === 'metric' && isMetricUnit(patch.displayUnit)) metricUnit = patch.displayUnit;
    if (unitSystem === 'imperial' && isImperialUnit(patch.displayUnit)) imperialUnit = patch.displayUnit;
  }
  return { unitSystem, metricUnit, imperialUnit };
}

/** 当前 Unit type 下 Display Unit 下拉里的那一组；Default 档下拉禁用（空组）。 */
export function measurementDisplayUnitOptions(
  unitSystem: MeasurementUnitSystem,
): readonly MeasurementDisplayUnitOption[] {
  if (unitSystem === 'metric') return MEASUREMENT_METRIC_DISPLAY_UNITS;
  if (unitSystem === 'imperial') return MEASUREMENT_IMPERIAL_DISPLAY_UNITS;
  return [];
}

/** 当前 Unit type 下 Display Unit 的选中项；Default 档没有选中项。 */
export function measurementSelectedDisplayUnit(
  selection: MeasurementUnitSelection,
): MeasurementDisplayUnit | null {
  if (selection.unitSystem === 'metric') return selection.metricUnit;
  if (selection.unitSystem === 'imperial') return selection.imperialUnit;
  return null;
}

/** `COMFORMATS.distanceFormat(!unit)`（`comformats.pmlobj` 1301–1356）。 */
export function measurementDistanceFormatForUnit(
  unit: MeasurementDisplayUnit,
): MeasurementDistanceFormat {
  switch (unit) {
    case 'IN':
      return {
        units: 'INCH',
        label: 'in',
        dp: 0,
        trailZeros: false,
        fraction: true,
        denominator: 32,
        inchSeparator: '.',
        ftLabel: '',
        zeros: true,
      };
    case 'FINC':
      return {
        units: 'FINCH',
        label: '"',
        dp: 0,
        trailZeros: false,
        fraction: true,
        denominator: 32,
        inchSeparator: '.',
        ftLabel: '\'-',
        zeros: false,
      };
    case 'FT':
      return {
        units: 'FT',
        label: 'UNITS',
        dp: 3,
        trailZeros: true,
        fraction: false,
        denominator: 0,
        inchSeparator: '',
        ftLabel: '',
        zeros: true,
      };
    case 'METRE':
      return {
        units: 'METRE',
        label: 'UNITS',
        dp: 3,
        trailZeros: false,
        fraction: false,
        denominator: 0,
        inchSeparator: '',
        ftLabel: '',
        zeros: true,
      };
    case 'CM':
      return {
        units: 'CM',
        label: 'UNITS',
        dp: 3,
        trailZeros: false,
        fraction: false,
        denominator: 0,
        inchSeparator: '',
        ftLabel: '',
        zeros: true,
      };
    case 'MM':
    default:
      // `else` 分支（公制）：dp 2、不留尾零 —— 与 `!!distanceFmt` 实机一致（golden G1-04）。
      return {
        units: 'MM',
        label: 'UNITS',
        dp: 2,
        trailZeros: false,
        fraction: false,
        denominator: 0,
        inchSeparator: '',
        ftLabel: '',
        zeros: true,
      };
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
    fraction: false,
    denominator: 0,
    inchSeparator: '',
    ftLabel: '',
    zeros: true,
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

/** 把 n/denominator 约到最简；分子为 0 时回 null。 */
function reduceFraction(numerator: number, denominator: number): [number, number] | null {
  if (numerator === 0) return null;
  let a = numerator;
  let b = denominator;
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return [numerator / a, denominator / a];
}

function formatInches(
  inches: number,
  format: MeasurementDistanceFormat,
): string {
  const denominator = format.denominator > 0 ? format.denominator : 32;
  const ticks = Math.round(inches * denominator);
  const whole = Math.floor(ticks / denominator);
  const fraction = reduceFraction(ticks - whole * denominator, denominator);
  if (!fraction) return `${whole}`;
  return `${whole}${format.inchSeparator}${fraction[0]}/${fraction[1]}`;
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
 * 按 FORMAT 渲染一个长度（入参米）。
 *
 * 公制：转到目标单位 → `dp` 位四舍五入 → `trailZeros` 决定去不去尾零 → 附单位标签；
 * 四舍五入后为 0 一律出不带号的 `0`（E3D 无负零，golden G1-04）。
 *
 * 英制（`fraction`）：按 1/`denominator` 英寸取整 → 整数英寸 + 约分后的分数，
 * `inchSeparator` 隔开；`FINCH` 再按 12 英寸拆出英尺段（`ftLabel`），
 * `zeros = false` 时零英尺不出段。英制串型取自 `comformats.pmlobj` 的 FORMAT 参数，
 * 渲染细节是 static_expectation（E3D 的 FORMAT 渲染在内核、PML 里看不到）。
 */
export function formatMeasurementLengthMeters(
  valueMeters: number,
  format: MeasurementDistanceFormat,
  options?: MeasurementLengthFormatOptions,
): string {
  const raw = Number(valueMeters);
  const meters = Number.isFinite(raw) ? raw : 0;
  const separator = options?.separator ?? '';
  const suffix = options?.suffix !== false;
  const value = meters / METRES_PER_UNIT[format.units];
  const magnitude = Math.abs(value);

  let body: string;
  let isZero: boolean;
  if (format.fraction) {
    const denominator = format.denominator > 0 ? format.denominator : 32;
    const totalInches = Math.round(magnitude * denominator) / denominator;
    isZero = totalInches === 0;
    if (format.units === 'FINCH') {
      const feet = Math.floor(totalInches / 12);
      const inches = totalInches - feet * 12;
      const inchText = formatInches(inches, format);
      body = feet === 0 && !format.zeros
        ? inchText
        : `${feet}${format.ftLabel}${inchText}`;
    } else {
      body = formatInches(totalInches, format);
    }
  } else {
    const dp = clampDecimals(format.dp);
    const fixed = magnitude.toFixed(dp);
    isZero = Number(fixed) === 0;
    body = format.trailZeros ? fixed : stripTrailingZeros(fixed);
  }

  const label = suffix ? `${separator}${unitLabel(format)}` : '';
  if (isZero) return `${body}${label}`;
  const sign = value < 0 ? '-' : (options?.signed ? '+' : '');
  return `${sign}${body}${label}`;
}
