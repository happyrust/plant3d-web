import type { NormalizedDimensionInput } from './types';
import type { DerivedDimensionValue } from './value';

/**
 * 尺寸文字的唯一策略（#73）。几何记录只存米和弧度，场景、列表、悬停和 SVG 都走这里。
 *
 * `locale` 目前只接受 `en-US`：小数点是 `.`，不加千分位。不读运行环境的区域设置。
 * 英制换算用国际英寸 25.4 mm。这些字符串是策略表，不是 E3D 实机金样；#70 采集后再替换。
 */
export type DimensionFormatPolicy = Readonly<{
  lengthUnit: 'm' | 'cm' | 'mm' | 'in' | 'ft';
  lengthDecimals: number;
  angleDecimals: number;
  approximatePrefix: string;
  stalePrefix: string;
  /** 缺省 `deg`。`rad` 用弧度数值加 ` rad`。 */
  angleUnit?: 'deg' | 'rad';
  /** 缺省保留 `toFixed` 的尾零，和原来的 `1000.00` 一致。 */
  trailingZeros?: boolean;
  /** 缺省 `en-US`。其它值直接拒绝，避免悄悄换成运行环境的小数点。 */
  locale?: string;
  radiusPrefix?: string;
  diameterPrefix?: string;
  /** 缺省 ` REF`，含前导空格。 */
  referenceSuffix?: string;
}>;

export const DEFAULT_DIMENSION_FORMAT: DimensionFormatPolicy = {
  lengthUnit: 'mm',
  lengthDecimals: 2,
  angleDecimals: 2,
  approximatePrefix: '~',
  stalePrefix: 'STALE ',
  angleUnit: 'deg',
  trailingZeros: true,
  locale: 'en-US',
  radiusPrefix: 'R',
  diameterPrefix: '⌀',
  referenceSuffix: ' REF',
};

export type FormatDimensionLabelResult =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{
      ok: false;
      reason: 'authoritative-text-for-user-dimension' | 'invalid-value' | 'unsupported-locale';
    }>;

/** 1 设计米换成该单位的倍数。英寸 = 1000/25.4，英尺 = 1000/304.8。 */
const LENGTH_SCALE: Readonly<Record<DimensionFormatPolicy['lengthUnit'], number>> = {
  m: 1,
  cm: 100,
  mm: 1000,
  in: 1000 / 25.4,
  ft: 1000 / 304.8,
};

function stripTrailingZeros(fixed: string): string {
  if (!fixed.includes('.')) return fixed;
  const stripped = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return stripped.length === 0 ? '0' : stripped;
}

function formatMagnitude(value: number, decimals: number, trailingZeros: boolean): string {
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const body = trailingZeros ? fixed : stripTrailingZeros(fixed);
  return negative ? `-${body}` : body;
}

export function formatDimensionLabel(
  input: NormalizedDimensionInput,
  value: DerivedDimensionValue,
  policy: DimensionFormatPolicy,
): FormatDimensionLabelResult {
  if (policy.locale !== undefined && policy.locale !== 'en-US') {
    return { ok: false, reason: 'unsupported-locale' };
  }
  if (
    input.authoritativeText !== undefined &&
    input.role !== 'external' &&
    input.role !== 'external-reference'
  ) {
    return { ok: false, reason: 'authoritative-text-for-user-dimension' };
  }

  let text: string;
  if (input.authoritativeText !== undefined) {
    text = input.authoritativeText;
  } else {
    if (!value.ok) return { ok: false, reason: 'invalid-value' };
    const trailingZeros = policy.trailingZeros !== false;
    if (value.valueM !== undefined) {
      text = formatMagnitude(
        value.valueM * LENGTH_SCALE[policy.lengthUnit],
        policy.lengthDecimals,
        trailingZeros,
      );
      if (input.kind === 'radial') {
        const prefix = input.display === 'radius'
          ? policy.radiusPrefix ?? 'R'
          : policy.diameterPrefix ?? '⌀';
        text = `${prefix}${text}`;
      }
    } else if (policy.angleUnit === 'rad') {
      text = `${formatMagnitude(value.valueRad, policy.angleDecimals, trailingZeros)} rad`;
    } else {
      text = `${formatMagnitude((value.valueRad * 180) / Math.PI, policy.angleDecimals, trailingZeros)}°`;
    }
  }

  if (input.role === 'approximate') text = `${policy.approximatePrefix}${text}`;
  if (input.role === 'invalid') text = `${policy.stalePrefix}${text}`;
  if (input.role === 'external-reference') text = `${text}${policy.referenceSuffix ?? ' REF'}`;
  return { ok: true, text };
}
