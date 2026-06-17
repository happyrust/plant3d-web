import { Vector3 } from 'three';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { BranNearestClearanceAnnotationCandidate } from './useSpatialCompute';

import { LinearDimension3D } from '@/utils/three/annotation';

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

function toFiniteVector3(point: unknown): Vector3 | null {
  const p = point as { x?: unknown; y?: unknown; z?: unknown } | null | undefined;
  const x = Number(p?.x);
  const y = Number(p?.y);
  const z = Number(p?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return new Vector3(x, y, z);
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

    const drawnIds: string[] = [];
    const skipped: BranClearanceRenderWarning[] = [];

    for (const item of candidates) {
      const annotation = item.candidate.annotation;
      const start = toFiniteVector3(annotation?.start_point);
      const end = toFiniteVector3(annotation?.end_point);
      const id = makeBranClearanceAnnotationId(
        item.targetGroup,
        item.candidate.refno,
        item.index,
      );
      if (!annotation || !start || !end) {
        skipped.push({ id, reason: 'Missing annotation start_point or end_point' });
        continue;
      }

      const label = formatBranClearanceDistanceLabel(annotation.label_mm);
      const direction = start.distanceToSquared(end) <= 1e-12
        ? new Vector3(0, 1, 0)
        : undefined;
      const dim = new LinearDimension3D(annotationSystem.materials, {
        start,
        end,
        text: label,
        decimals: 0,
        unit: 'mm',
        offset: 0.5,
        direction,
      });
      dim.setMaterialSet(annotationSystem.materials.yellow);
      dim.setBackgroundColor(0x111827);

      annotationSystem.addAnnotation(id, dim);
      currentIds.add(id);
      drawnIds.push(id);
    }

    lastWarnings = skipped;
    requestRender?.();
    return { drawnIds, skipped };
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
