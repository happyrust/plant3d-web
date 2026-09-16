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

/** 来源标签的后缀：估算候选标「估算」，两条 BRAN 平行直段的中心距标明它量的是轴线间距、不是到包围盒的净距。 */
function sourceLabelSuffix(item: BranNearestClearanceAnnotationCandidate): string {
  switch (item.provenance?.method) {
    case 'sampled-object':
      return '（估算）';
    case 'parallel-centerline':
      return '（平行直段中心距）';
    default:
      return '';
  }
}

/**
 * BRAN 净距候选 → 只读 external 线性尺寸。`annotation` 两端点是 **E3D 世界 mm**（两个后端、三维点选写进来的估算候选都是），
 * 调用方给 mm → Design Space 米的换算。网格采样估算的候选（`provenance.accuracyClass = approximate-sampled`）
 * 尺寸文字前带「≈」，来源标签带「估算」——近似值不得以精确净距的样子呈现（2026-09-11 收敛计划 D2）；
 * 平行直段中心距（`parallel-centerline / exact-centerline`）精确到中心线本身，文字不带「≈」，来源标签注明口径。
 */
export function branClearanceToExternalDimensions(
  candidates: readonly BranNearestClearanceAnnotationCandidate[],
  millimetresToDesignMetres: (point: Vec3) => Vec3,
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
    const approximate = item.provenance?.accuracyClass === 'approximate-sampled';
    const labelMm = Number(item.candidate.annotation?.label_mm);
    records.push({
      id,
      source: 'bran-clearance',
      sourceLabel: `${item.targetGroup}: ${item.candidate.refno}${sourceLabelSuffix(item)}`,
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        ...(Number.isFinite(labelMm)
          ? { authoritativeText: `${approximate ? '≈' : ''}${Math.round(labelMm)}mm` }
          : {}),
        a: millimetresToDesignMetres(start),
        b: millimetresToDesignMetres(end),
        placement: { offsetM: 0.5, labelT: 0.5, side: 1 },
      },
    });
  }
  return { records, skipped };
}
