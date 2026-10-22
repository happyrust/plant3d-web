/** 正整数毫米输入：留空或不合法回到缺省，小数取整。 */
export function positiveMmInput(raw: string, fallback: number): number {
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback;
}

/** 有上下限的数值输入：留空或不合法回到缺省，超出范围夹到边界。 */
export function clampedNumberInput(raw: string, range: Readonly<{ min: number; max: number; fallback: number }>): number {
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? Math.min(range.max, Math.max(range.min, n)) : range.fallback;
}
