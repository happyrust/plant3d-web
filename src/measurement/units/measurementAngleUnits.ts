/**
 * E3D Measure Angle 窗体的 Units 契约（`gphanglemeasure.pmlfrm` 45–54 / 95–101 / 318–410 +
 * `comformats.pmlobj` 1240–1259，E3D 3.1 静态源）。
 *
 * - `Units` 框两格：`Unit` 下拉（Default / Degrees / Radians / Gradians，构造时停在第 1 档）
 *   与 `Decimal Places` 文本框（构造时 `setValue('2')`）。
 * - `Decimal Places` 只收 **0–8**：越界或填了非数字都会被打回 `2` 并弹
 *   `alert.error('Value must be between 0 and 8')`（328–333 / 431–434）。
 * - 角度格式是 `!!angleFmt`（= `angleFormat(UNIT('degree'))`：`dp 2`、degree 档 `label ''`、
 *   **`trailZeros false`**）复制一份，再把 `dp` 换成 Decimal Places、`units` 换成下拉里那个词；
 *   Default 档取工程当前角度单位名 + `s` 并首字母大写。单元格文本是
 *   `!angle.string(!formAngleFormat) & ' ' & !formAngleFormat.units` —— 数值、一个空格、单位词。
 * - 结果表**四行**：`Decimal Angle` / `DMS` / `Direction1` / `Direction2`（334–342）。
 *   `DMS` 由十进制度截断出度 / 分 / 秒（360–363），与 Unit 选了什么无关。
 * - 两条 Direction 的每个数字也按 Decimal Places 重新格式化（376–404，`!!realFmt`）。
 */
export type MeasurementAngleUnit = 'default' | 'degrees' | 'radians' | 'gradians';

export type MeasurementAngleUnitOption = Readonly<{
  value: MeasurementAngleUnit;
  /** E3D 下拉里的原词，同时也是数值后面缀的那个单位词。 */
  label: string;
}>;

export const MEASUREMENT_ANGLE_UNITS: readonly MeasurementAngleUnitOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'degrees', label: 'Degrees' },
  { value: 'radians', label: 'Radians' },
  { value: 'gradians', label: 'Gradians' },
];

export const MEASUREMENT_ANGLE_DECIMALS_MIN = 0;
export const MEASUREMENT_ANGLE_DECIMALS_MAX = 8;
export const DEFAULT_MEASUREMENT_ANGLE_DECIMALS = 2;

export type MeasurementAngleUnitSelection = Readonly<{
  unit: MeasurementAngleUnit;
  decimalPlaces: number;
}>;

export const DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION: MeasurementAngleUnitSelection = {
  unit: 'default',
  decimalPlaces: DEFAULT_MEASUREMENT_ANGLE_DECIMALS,
};

/**
 * Web 没有「工程当前角度单位」这一层，Default 档就是度（E3D 那边 `!!angleFmt` 的缺省也是
 * `UNIT('degree')`，单位词 `degree` + `s` 首字母大写 = `Degrees`）。
 */
const DEFAULT_UNIT_WORD = 'Degrees';

const DEGREES_PER: Record<Exclude<MeasurementAngleUnit, 'default'>, number> = {
  degrees: 1,
  radians: Math.PI / 180,
  gradians: 10 / 9,
};

function isAngleUnit(value: unknown): value is MeasurementAngleUnit {
  return value === 'default' || value === 'degrees' || value === 'radians' || value === 'gradians';
}

/** Decimal Places 收不收这个值（E3D：0–8 的整数，别的都打回 2 并报错）。 */
export function isMeasurementAngleDecimalsValid(raw: unknown): boolean {
  if (typeof raw === 'string' && raw.trim() === '') return false;
  if (raw === null || raw === undefined || typeof raw === 'boolean') return false;
  const value = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  return Number.isInteger(value)
    && value >= MEASUREMENT_ANGLE_DECIMALS_MIN
    && value <= MEASUREMENT_ANGLE_DECIMALS_MAX;
}

export function normalizeMeasurementAngleUnitSelection(input: unknown): MeasurementAngleUnitSelection {
  if (!input || typeof input !== 'object') return DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION;
  const raw = input as Partial<MeasurementAngleUnitSelection>;
  return {
    unit: isAngleUnit(raw.unit) ? raw.unit : DEFAULT_MEASUREMENT_ANGLE_UNIT_SELECTION.unit,
    decimalPlaces: isMeasurementAngleDecimalsValid(raw.decimalPlaces)
      ? Number(raw.decimalPlaces)
      : DEFAULT_MEASUREMENT_ANGLE_DECIMALS,
  };
}

/** 数值后面缀的那个单位词（Default 档是 `Degrees`）。 */
export function measurementAngleUnitWord(unit: MeasurementAngleUnit): string {
  if (unit === 'default') return DEFAULT_UNIT_WORD;
  return MEASUREMENT_ANGLE_UNITS.find((option) => option.value === unit)!.label;
}

/** 把十进制度换算到选中的单位。 */
export function convertAngleFromDegrees(angleDeg: number, unit: MeasurementAngleUnit): number {
  const value = Number(angleDeg);
  if (!Number.isFinite(value)) return 0;
  return value * DEGREES_PER[unit === 'default' ? 'degrees' : unit];
}

function clampDecimals(value: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_MEASUREMENT_ANGLE_DECIMALS;
  return Math.max(MEASUREMENT_ANGLE_DECIMALS_MIN, Math.min(MEASUREMENT_ANGLE_DECIMALS_MAX, n));
}

function stripTrailingZeros(text: string): string {
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 按 Decimal Places 出一个数。四舍五入到 0 不带负号。
 *
 * `trailZeros` 缺省**留**尾零 —— 两条 Direction 走的是 `!!realFmt`（只设了 `dp`，
 * `trailZeros` 是 FORMAT 的缺省）；角度值那一格走 `!!angleFmt` 的 degree 档，
 * 它显式 `trailZeros = false`，所以由调用方传 `false`。
 */
export function formatMeasurementAngleScalar(
  value: number,
  decimalPlaces: number,
  options?: Readonly<{ trailZeros?: boolean }>,
): string {
  const raw = Number(value);
  const magnitude = Math.abs(Number.isFinite(raw) ? raw : 0);
  const fixed = magnitude.toFixed(clampDecimals(decimalPlaces));
  const body = options?.trailZeros === false ? stripTrailingZeros(fixed) : fixed;
  return Number(fixed) === 0 ? body : `${raw < 0 ? '-' : ''}${body}`;
}

/** 结果表 `Decimal Angle` 行：`<数值> <单位词>`（`gphanglemeasure` 407）。 */
export function formatMeasurementAngle(
  angleDeg: number,
  selection: MeasurementAngleUnitSelection,
): string {
  const value = convertAngleFromDegrees(angleDeg, selection.unit);
  const text = formatMeasurementAngleScalar(value, selection.decimalPlaces, { trailZeros: false });
  return `${text} ${measurementAngleUnitWord(selection.unit)}`;
}

/**
 * 结果表 `DMS` 行（`gphanglemeasure` 360–363）：度 / 分 / 秒都由**十进制度截断**得到，
 * 与 Unit 选了什么无关；格式 `<deg>° <min>' <sec>''`。
 */
export function formatMeasurementAngleDms(angleDeg: number): string {
  const raw = Number(angleDeg);
  const value = Number.isFinite(raw) ? raw : 0;
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const degrees = Math.trunc(magnitude);
  const minutes = Math.trunc((magnitude - degrees) * 60);
  const seconds = Math.trunc((magnitude - degrees - minutes / 60) * 3600);
  return `${sign}${degrees}° ${minutes}' ${seconds}''`;
}
