import { markRaw, watch, type Ref } from 'vue';

import { Vector3 } from 'three';

import {
  resolvePipeDistanceSeverity,
  resolvePipeDistanceSeverityVisuals,
} from './pipeDistanceSeverity';

import type { PipeDistanceResult } from './usePipeDistanceStore';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import {
  AnnotationMaterials,
  LinearDimension3D,
} from '@/utils/three/annotation';

export function usePipeDistanceAnnotationThree(
  viewerRef: Ref<DtxViewer | null>,
  results: Ref<PipeDistanceResult[]>,
  showAnnotations: Ref<boolean>,
) {
  const materials = markRaw(new AnnotationMaterials());
  const annotations = new Map<string, LinearDimension3D>();

  function renderAnnotations() {
    clearAnnotations();

    const viewer = viewerRef.value;
    if (!viewer || !showAnnotations.value) return;

    for (const result of results.value) {
      const dim = new LinearDimension3D(materials, {
        start: new Vector3(...result.start),
        end: new Vector3(...result.end),
        text: `${result.distance} mm`,
        decimals: 0,
        unit: 'mm',
      });
      const severity = resolvePipeDistanceSeverity(result.distance);
      const visuals = resolvePipeDistanceSeverityVisuals(severity, materials);
      dim.setBackgroundColor(visuals.backgroundColor);
      dim.setMaterialSet(visuals.materialSet);

      viewer.scene.add(dim);
      annotations.set(result.id, dim);
    }
  }

  function clearAnnotations() {
    const viewer = viewerRef.value;

    for (const dim of annotations.values()) {
      viewer?.scene.remove(dim);
      dim.dispose();
    }
    annotations.clear();
  }

  watch([viewerRef, results, showAnnotations], renderAnnotations, { deep: true });

  return { renderAnnotations, clearAnnotations };
}
