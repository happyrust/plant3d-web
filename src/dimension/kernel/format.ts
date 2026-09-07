import type { NormalizedDimensionInput } from './types';
import type { DerivedDimensionValue } from './value';

export type DimensionFormatPolicy = Readonly<{
  lengthUnit: 'm' | 'cm' | 'mm';
  lengthDecimals: number;
  angleDecimals: number;
  approximatePrefix: string;
  stalePrefix: string;
}>;

export const DEFAULT_DIMENSION_FORMAT: DimensionFormatPolicy = {
  lengthUnit: 'mm',
  lengthDecimals: 2,
  angleDecimals: 2,
  approximatePrefix: '~',
  stalePrefix: 'STALE ',
};

export type FormatDimensionLabelResult =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{
      ok: false;
      reason: 'authoritative-text-for-user-dimension' | 'invalid-value';
    }>;

const LENGTH_SCALE: Readonly<Record<DimensionFormatPolicy['lengthUnit'], number>> = {
  m: 1,
  cm: 100,
  mm: 1000,
};

export function formatDimensionLabel(
  input: NormalizedDimensionInput,
  value: DerivedDimensionValue,
  policy: DimensionFormatPolicy,
): FormatDimensionLabelResult {
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
    if (value.valueM !== undefined) {
      text = (value.valueM * LENGTH_SCALE[policy.lengthUnit]).toFixed(policy.lengthDecimals);
      if (input.kind === 'radial') {
        text = `${input.display === 'radius' ? 'R' : '⌀'}${text}`;
      }
    } else {
      text = `${((value.valueRad * 180) / Math.PI).toFixed(policy.angleDecimals)}°`;
    }
  }

  if (input.role === 'approximate') text = `${policy.approximatePrefix}${text}`;
  if (input.role === 'invalid') text = `${policy.stalePrefix}${text}`;
  if (input.role === 'external-reference') text = `${text} REF`;
  return { ok: true, text };
}
