import { watch, type Ref } from 'vue';

import {
  Vector3,
  Matrix4,
} from 'three';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { PipeDistanceResult } from './usePipeDistanceStore';
import type {
  DimensionSystem,
  ExplicitLayoutInput,
  ExternalDimensionRecord,
} from '@/dimension';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

type PipeDistanceAnnotationViewer = DtxViewer | DtxCompatViewer;
type ViewerWithDtxLayerMatrix = {
  __dtxLayer?: {
    getGlobalModelMatrix?: () => Matrix4 | null;
  };
};

const PIPE_DISTANCE_ANNOTATION_PREFIX = 'pipe_distance:';

function requestViewerRender(viewer: PipeDistanceAnnotationViewer | null): void {
  const requestRender = (viewer as { requestRender?: (() => void) | null } | null)?.requestRender;
  requestRender?.();
}

function resolveSceneWorldToDesign(
  viewer: PipeDistanceAnnotationViewer | null,
): ((point: [number, number, number]) => [number, number, number]) | null {
  const matrix = (viewer as ViewerWithDtxLayerMatrix | null)
    ?.__dtxLayer?.getGlobalModelMatrix?.();
  if (!matrix || !matrix.elements.every(Number.isFinite) || matrix.determinant() === 0) return null;
  const inverse = matrix.clone().invert();
  return (point) => {
    const p = new Vector3(point[0], point[1], point[2]).applyMatrix4(inverse);
    return [p.x / 1000, p.y / 1000, p.z / 1000];
  };
}

function midpoint(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];
}

function pipeDistanceToExternalRecord(
  result: PipeDistanceResult,
  sceneWorldToDesign: ((point: [number, number, number]) => [number, number, number]) | null,
): ExternalDimensionRecord {
  const toDesign = result.designPoints
    ? (point: [number, number, number]): [number, number, number] => [point[0] / 1000, point[1] / 1000, point[2] / 1000]
    : sceneWorldToDesign ?? ((point: [number, number, number]) => point);
  const points = result.designPoints ?? result;
  const start = toDesign(points.start);
  const end = toDesign(points.end);
  const lines: ExplicitLayoutInput['lines'] = [
    ...(points.pipeAStart && points.pipeAEnd
      ? [{
        from: toDesign(points.pipeAStart),
        to: toDesign(points.pipeAEnd),
        part: 'projection' as const,
        style: 'dashed' as const,
      }]
      : []),
    ...(points.pipeBStart && points.pipeBEnd
      ? [{
        from: toDesign(points.pipeBStart),
        to: toDesign(points.pipeBEnd),
        part: 'projection' as const,
        style: 'dashed' as const,
      }]
      : []),
    { from: start, to: end, part: 'dimension' as const },
  ];
  const id = `pipe-distance:${result.id}`;
  return {
    id,
    source: 'pipe-distance',
    sourceLabel: 'Pipe Distance',
    role: 'external',
    layout: {
      id,
      role: 'external',
      labelPinned: false,
      formattedLabel: `${result.status === 'stale' ? '（过期）' : ''}${result.measurementKind === 'axis-estimate' ? '中心距估算 ' : ''}${result.distance} mm`,
      lines,
      labelAnchor: midpoint(start, end),
      arrowLines: [],
    },
  };
}

export function usePipeDistanceAnnotationThree(
  viewerRef: Ref<PipeDistanceAnnotationViewer | null>,
  results: Ref<PipeDistanceResult[]>,
  showAnnotations: Ref<boolean>,
  annotationSystemRef?: Ref<UseAnnotationThreeReturn | null>,
  dimensionSystemRef?: Ref<DimensionSystem | null>,
) {
  void annotationSystemRef;

  function renderAnnotations() {
    const dimensionSystem = dimensionSystemRef?.value ?? null;
    if (!dimensionSystem || !showAnnotations.value) {
      dimensionSystem?.replaceExternalSource('pipe-distance', []);
      return;
    }
    const sceneWorldToDesign = resolveSceneWorldToDesign(viewerRef.value);
    dimensionSystem.replaceExternalSource(
      'pipe-distance',
      results.value.map(result =>
        pipeDistanceToExternalRecord(result, sceneWorldToDesign)),
    );
    requestViewerRender(viewerRef.value);
  }

  function clearAnnotations() {
    dimensionSystemRef?.value?.replaceExternalSource('pipe-distance', []);
  }

  watch([viewerRef, results, showAnnotations], renderAnnotations, { deep: true });

  return { renderAnnotations, clearAnnotations };
}
