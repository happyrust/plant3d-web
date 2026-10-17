import { sub3, tryNormalize3 } from '../kernel/vec';

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
    case 'surface-to-surface':
      return '（实体外表面净距）';
    default:
      return '（管表面到包围盒估算）';
  }
}

/**
 * BRAN 净距候选 → 每条候选两条只读 external 记录：
 *
 * - `${id}`：**pill 引线标签**（explicit + tag）。锚点在目标表面点 `b`，画圆点 + 引线 + 白底药丸
 *   「NOUN ≈587mm」；tag 摆放走 billboard 求解——十角 × 四环候选位、避让其他标签与尺寸，密集场景不再互相压字。
 * - `${id}:seg`：**净距段**（annotation 类）。管表面点 `a` → 目标点 `b` 的细直线 + `a` 端圆点，
 *   直观标出被量的那一段空隙；`formattedLabel` 为空（值字全交给 pill），只画几何。
 *
 * `annotation` 两端点是 **E3D 世界 mm**（两个后端、三维点选写进来的估算候选都是），调用方给 mm →
 * Design Space 米的换算。网格采样估算的候选（`provenance.accuracyClass = approximate-sampled`）
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
    const a = millimetresToDesignMetres(start);
    const b = millimetresToDesignMetres(end);
    const approximate = !item.provenance || item.provenance.accuracyClass.startsWith('approximate-');
    const labelMm = Number(item.candidate.annotation?.label_mm);
    const valueText = Number.isFinite(labelMm)
      ? `${item.provenance?.status === 'stale' ? '（过期）' : ''}${approximate ? '≈' : ''}${Math.round(labelMm)}mm`
      : '';
    const tagText = valueText ? `${item.targetGroup} ${valueText}` : String(item.targetGroup);
    const away = tryNormalize3(sub3(b, a));
    const sourceLabel = `${item.targetGroup}: ${item.candidate.refno}${sourceLabelSuffix(item)}`;
    records.push({
      id,
      source: 'bran-clearance',
      sourceLabel,
      role: 'external',
      layout: {
        id,
        role: 'external',
        labelPinned: true,
        formattedLabel: tagText,
        lines: [],
        labelAnchor: b,
        arrowLines: [],
        tag: {
          style: 'pill',
          lines: [{ text: tagText }],
          target: b,
          ...(away ? { away } : {}),
          dot: true,
          subject: item.candidate.refno,
        },
      },
    });
    records.push({
      id: `${id}:seg`,
      source: 'bran-clearance',
      sourceLabel: `${sourceLabel}（净距段）`,
      role: 'external',
      category: 'annotation',
      layout: {
        id: `${id}:seg`,
        role: 'external',
        labelPinned: true,
        formattedLabel: '',
        lines: [{ from: a, to: b, part: 'dimension' }],
        labelAnchor: a,
        arrowLines: [],
        markers: [{ at: a, shape: 'circle', radiusPx: 2.4 }],
      },
    });
  }
  return { records, skipped };
}
