export type LengthUnit = 'm' | 'cm' | 'mm'
export type Vec3 = [number, number, number]

const UNIT_TO_METERS: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
};

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const fromFactor = UNIT_TO_METERS[from] ?? 1;
  const toFactor = UNIT_TO_METERS[to] ?? 1;
  // value_m = value * fromFactor; value_to = value_m / toFactor
  return (v * fromFactor) / toFactor;
}

export function formatNumber(value: number, precision: number): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return '0';
  const p = Math.max(0, Math.min(6, Math.floor(Number(precision) || 0)));
  return v.toFixed(p);
}

export function formatLengthMeters(valueMeters: number, unit: LengthUnit, precision: number, opts?: { suffix?: boolean }): string {
  const v = convertLength(valueMeters, 'm', unit);
  const text = formatNumber(v, precision);
  return opts?.suffix === false ? text : `${text}${unit}`;
}

export function formatVec3Meters(v: Vec3, unit: LengthUnit, precision: number, opts?: { suffix?: boolean }): string {
  const x = convertLength(v[0], 'm', unit);
  const y = convertLength(v[1], 'm', unit);
  const z = convertLength(v[2], 'm', unit);
  const text = `(${formatNumber(x, precision)}, ${formatNumber(y, precision)}, ${formatNumber(z, precision)})`;
  return opts?.suffix === false ? text : `${text}${unit}`;
}

/**
 * PDMS/E3D 控制台位置字符串格式。
 *
 * 形如：`X 3341.63mm Y 8330.57mm Z 13301.33mm`
 * - X/Y/Z 作为轴前缀
 * - 单位内联在每个数值之后
 * - 不含括号、不含逗号分隔
 *
 * @param v_m        以米为单位的三维位置
 * @param unit       目标显示单位，默认 'mm'（E3D 默认）
 * @param precision  小数位数，默认 2（E3D 默认）
 */
export function formatPdmsPos(v_m: Vec3, unit: LengthUnit = 'mm', precision = 2): string {
  const x = convertLength(v_m[0], 'm', unit);
  const y = convertLength(v_m[1], 'm', unit);
  const z = convertLength(v_m[2], 'm', unit);
  const p = Math.max(0, Math.min(6, Math.floor(Number(precision) || 0)));
  return `X ${x.toFixed(p)}${unit} Y ${y.toFixed(p)}${unit} Z ${z.toFixed(p)}${unit}`;
}

