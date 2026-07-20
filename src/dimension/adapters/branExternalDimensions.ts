import type {
  ExternalDimensionMappingResult,
  ExternalDimensionRecord,
} from './normalizeExternalDimensions';
import type { Vec3 } from '../domain/types';
import type { BranNearestClearanceAnnotationCandidate } from '@/composables/useSpatialCompute';

function idPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function point(value: unknown): Vec3 | null {
  const candidate = value as { x?: unknown; y?: unknown; z?: unknown } | null;
  const values = [
    Number(candidate?.x),
    Number(candidate?.y),
    Number(candidate?.z),
  ];
  return values.every(Number.isFinite) ? values as unknown as Vec3 : null;
}

export function branClearanceToExternalDimensions(
  candidates: readonly BranNearestClearanceAnnotationCandidate[],
  sceneWorldToDesignMetres: (point: Vec3) => Vec3,
): ExternalDimensionMappingResult {
  const records: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const item of candidates) {
    const id = `bran-clearance:${idPart(item.targetGroup)}:${idPart(item.candidate.refno)}:${Math.max(0, item.index)}`;
    const start = point(item.candidate.annotation?.start_point);
    const end = point(item.candidate.annotation?.end_point);
    if (!start || !end) {
      skipped.push({ id, reason: 'Missing finite annotation start/end point' });
      continue;
    }
    const labelMm = Number(item.candidate.annotation?.label_mm);
    records.push({
      id,
      source: 'bran-clearance',
      sourceLabel: `${item.targetGroup}: ${item.candidate.refno}`,
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        ...(Number.isFinite(labelMm)
          ? { authoritativeText: `${Math.round(labelMm)}mm` }
          : {}),
        a: sceneWorldToDesignMetres(start),
        b: sceneWorldToDesignMetres(end),
        placement: { offsetM: 0.5, labelT: 0.5, side: 1 },
      },
    });
  }
  return { records, skipped };
}
