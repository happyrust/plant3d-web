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

/**
 * 一条 BRAN 净距候选画出来的 external 尺寸 id——面板行 ↔ 三维标注联动要拿同一个 id
 * （行悬停高亮尺寸、点击行飞向净距段），规则必须只此一处。
 */
export function branClearanceDimensionId(targetGroup: string, refno: string, index: number): string {
  return `bran-clearance:${idPart(targetGroup)}:${idPart(refno)}:${Math.max(0, index)}`;
}

/**
 * 同屏多条净距尺寸若全用同一偏移位会互相压字（密集 BRAN 下一批目标的净距方向本来就差不多）——
 * 按候选序号交错 side/offsetM/labelT 把标签错开，每 8 条一轮。
 */
const STAGGERED_PLACEMENTS: readonly Readonly<{ offsetM: number; labelT: number; side: 1 | -1 }>[] = [
  { side: 1, offsetM: 0.5, labelT: 0.5 },
  { side: -1, offsetM: 0.5, labelT: 0.5 },
  { side: 1, offsetM: 0.9, labelT: 0.35 },
  { side: -1, offsetM: 0.9, labelT: 0.65 },
  { side: 1, offsetM: 1.3, labelT: 0.65 },
  { side: -1, offsetM: 1.3, labelT: 0.35 },
  { side: 1, offsetM: 1.7, labelT: 0.5 },
  { side: -1, offsetM: 1.7, labelT: 0.5 },
];

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
 * BRAN 净距候选 → 只读 external 线性尺寸（与「测量」工具同一形态：a→b 尺寸线 + 线上值字）。
 * `annotation` 两端点是 **E3D 世界 mm**（两个后端、三维点选写进来的估算候选都是），
 * 调用方给 mm → Design Space 米的换算。尺寸文字带目标 noun（「WALL ≈465mm」）——
 * 自动标注的意义就是「距离哪些类型最近」，类型必须在线上直接可读。
 * 网格采样估算的候选（`provenance.accuracyClass = approximate-sampled`）值前带「≈」，
 * 来源标签带「估算」——近似值不得以精确净距的样子呈现（2026-09-11 收敛计划 D2）；
 * 平行直段中心距（`parallel-centerline / exact-centerline`）精确到中心线本身，文字不带「≈」，来源标签注明口径。
 */
export function branClearanceToExternalDimensions(
  candidates: readonly BranNearestClearanceAnnotationCandidate[],
  millimetresToDesignMetres: (point: Vec3) => Vec3,
): ExternalDimensionMappingResult {
  const records: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const item of candidates) {
    const id = branClearanceDimensionId(item.targetGroup, item.candidate.refno, item.index);
    const start = point(item.candidate.annotation?.start_point);
    const end = point(item.candidate.annotation?.end_point);
    if (!start || !end) {
      skipped.push({ id, reason: 'Missing finite annotation start/end point' });
      continue;
    }
    const approximate = !item.provenance || item.provenance.accuracyClass.startsWith('approximate-');
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
          ? { authoritativeText: `${item.targetGroup} ${item.provenance?.status === 'stale' ? '（过期）' : ''}${approximate ? '≈' : ''}${Math.round(labelMm)}mm` }
          : {}),
        a: millimetresToDesignMetres(start),
        b: millimetresToDesignMetres(end),
        placement: STAGGERED_PLACEMENTS[records.length % STAGGERED_PLACEMENTS.length]!,
      },
    });
  }
  return { records, skipped };
}
