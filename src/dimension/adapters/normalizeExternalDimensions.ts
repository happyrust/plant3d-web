import type {
  ExplicitLayoutInput,
  NormalizedDimensionInput,
} from '../kernel/types';

export type ExternalDimensionRecord = Readonly<{
  id: string;
  source: 'bran-clearance' | 'mbd';
  sourceLabel: string;
  role: 'external' | 'external-reference';
  layout: NormalizedDimensionInput | ExplicitLayoutInput;
}>;

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
