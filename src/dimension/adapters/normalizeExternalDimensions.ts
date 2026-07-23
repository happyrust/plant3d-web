import type {
  ExplicitLayoutInput,
  NormalizedDimensionInput,
} from '../kernel/types';

/**
 * 外部尺寸（dimension）与外部标注图元（annotation）的领域区分（ADR 0041）：
 * 前者是 LinearDim/AngleDim 等真正的尺寸，后者是标签、引线、辅助几何、
 * 焊缝/坡度符号等非尺寸图元。两类都只读、共用呈现内核。
 */
export type ExternalDimensionCategory = 'dimension' | 'annotation';
export type ExternalDimensionSource =
  | 'bran-clearance'
  | 'mbd'
  | 'measurement'
  | 'pipe-distance'
  | 'xeokit-measurement';

export type ExternalDimensionRecord = Readonly<{
  id: string;
  source: ExternalDimensionSource;
  sourceLabel: string;
  role: 'external' | 'external-reference';
  /** Omitted means 'dimension' (pre-existing records are all dimensions). */
  category?: ExternalDimensionCategory;
  layout: NormalizedDimensionInput | ExplicitLayoutInput;
}>;

export function externalDimensionCategory(
  record: ExternalDimensionRecord,
): ExternalDimensionCategory {
  return record.category ?? 'dimension';
}

export type ExternalDimensionMappingResult = Readonly<{
  records: readonly ExternalDimensionRecord[];
  skipped: readonly Readonly<{ id: string; reason: string }>[];
}>;

export function normalizeExternalDimension(
  record: ExternalDimensionRecord,
): NormalizedDimensionInput | ExplicitLayoutInput {
  return {
    ...record.layout,
    id: record.id,
    role: record.role,
  } as NormalizedDimensionInput | ExplicitLayoutInput;
}
