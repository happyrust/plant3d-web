/**
 * 版本时间轴的 A / B 钉（design.md §2.3，Requirement 5.1–5.3、5.10–5.12）。
 * 纯函数：无 Vue、无 DOM、无网络。
 *
 * 口径：先后只按 sesno（Chain_Order）比较，不看 Session_Time。
 * `orderedSesnos` 是当前范围版本表的 sesno 严格升序列（tickLayout.orderVersions 的结果取 sesno）。
 */

export type Pins = { a: number | null; b: number | null };

/** A 的 sesno 大于 B 时交换，使 A 在 Chain_Order 中位于 B 之前；任一侧为空时原样返回副本。 */
export function normalizePins(pins: Pins): Pins {
  const { a, b } = pins;
  if (a !== null && b !== null && a > b) return { a: b, b: a };
  return { a, b };
}

/**
 * 把 sesno 钉到 side 一侧，替换该侧原有的钉，再按 sesno 排序。
 * 另一侧已钉同一 sesno 时拒绝，返回原钉状态（副本）与 `same-version`。
 */
export function pinSide(pins: Pins, side: 'a' | 'b', sesno: number):
  { pins: Pins; rejected: null | 'same-version' } {
  const other = side === 'a' ? pins.b : pins.a;
  if (other !== null && other === sesno) {
    return { pins: { a: pins.a, b: pins.b }, rejected: 'same-version' };
  }
  const next: Pins = side === 'a' ? { a: sesno, b: pins.b } : { a: pins.a, b: sesno };
  return { pins: normalizePins(next), rejected: null };
}

/** 有序 sesno 表中 sesno 的下标，不在表中时为 -1 */
function indexOfSesno(orderedSesnos: readonly number[], sesno: number): number {
  let lo = 0;
  let hi = orderedSesnos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (orderedSesnos[mid]! < sesno) lo = mid + 1;
    else hi = mid;
  }
  return lo < orderedSesnos.length && orderedSesnos[lo] === sesno ? lo : -1;
}

/** 「与上一版比」：A = 游标前一项，B = 游标；游标是首版或不在表中时为 null（按钮禁用）。 */
export function pinsWithPrevious(orderedSesnos: readonly number[], cursor: number): Pins | null {
  const i = indexOfSesno(orderedSesnos, cursor);
  if (i <= 0) return null;
  return { a: orderedSesnos[i - 1]!, b: cursor };
}

/** 「与最新比」：A = 游标，B = 表中 sesno 最大的一版；游标是末版或不在表中时为 null（按钮禁用）。 */
export function pinsWithLatest(orderedSesnos: readonly number[], cursor: number): Pins | null {
  const i = indexOfSesno(orderedSesnos, cursor);
  if (i < 0 || i === orderedSesnos.length - 1) return null;
  return { a: cursor, b: orderedSesnos[orderedSesnos.length - 1]! };
}
