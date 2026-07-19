import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { BranNearestClearanceAnnotationCandidate } from './useSpatialCompute';

export const BRAN_CLEARANCE_ANNOTATION_PREFIX = 'bran_clearance_';

export type BranClearanceRenderWarning = {
  id: string;
  reason: string;
};

export type BranClearanceRenderResult = {
  drawnIds: string[];
  skipped: BranClearanceRenderWarning[];
};

export type UseBranClearanceAnnotationThreeOptions = {
  requestRender?: (() => void) | null;
};

function sanitizeIdPart(value: unknown, fallback: string): string {
  const sanitized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || fallback;
}

export function formatBranClearanceDistanceLabel(labelMm: unknown): string {
  const mm = Number(labelMm);
  if (!Number.isFinite(mm)) return '';
  return `${Math.round(mm)}mm`;
}

export function makeBranClearanceAnnotationId(
  targetGroup: unknown,
  refno: unknown,
  index: number,
): string {
  return [
    BRAN_CLEARANCE_ANNOTATION_PREFIX.replace(/_$/, ''),
    sanitizeIdPart(targetGroup, 'group'),
    sanitizeIdPart(refno, 'target'),
    String(Math.max(0, index)),
  ].join('_');
}

export function useBranClearanceAnnotationThree(
  annotationSystem: UseAnnotationThreeReturn,
  options: UseBranClearanceAnnotationThreeOptions = {},
) {
  const requestRender = options.requestRender ?? null;
  const currentIds = new Set<string>();
  let lastWarnings: BranClearanceRenderWarning[] = [];

  function clearAnnotations(): void {
    const ids = new Set<string>(currentIds);
    for (const id of annotationSystem.annotations.value.keys()) {
      if (id.startsWith(BRAN_CLEARANCE_ANNOTATION_PREFIX)) {
        ids.add(id);
      }
    }
    for (const id of ids) {
      annotationSystem.removeAnnotation(id);
    }
    currentIds.clear();
    lastWarnings = [];
    requestRender?.();
  }

  function renderAnnotations(
    candidates: BranNearestClearanceAnnotationCandidate[],
  ): BranClearanceRenderResult {
    clearAnnotations();
    const skipped = candidates.map((item) => ({
      id: makeBranClearanceAnnotationId(item.targetGroup, item.candidate.refno, item.index),
      reason: 'Dimension renderer unavailable during ADR-0038 rebuild',
    }));
    lastWarnings = skipped;
    requestRender?.();
    return { drawnIds: [], skipped };
  }

  function getDebugSnapshot() {
    return {
      ids: Array.from(currentIds),
      warnings: [...lastWarnings],
    };
  }

  return {
    renderAnnotations,
    clearAnnotations,
    getDebugSnapshot,
  };
}
