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

