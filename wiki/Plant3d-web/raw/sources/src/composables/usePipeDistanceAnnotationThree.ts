import { ref, watch, type Ref } from 'vue';

import { Vector3 } from 'three';

import type { PipeDistanceResult } from './usePipeDistanceStore';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { LinearDimension3D } from '@/utils/three/annotation';

export function usePipeDistanceAnnotationThree(
  viewerRef: Ref<DtxViewer | null>,
  results: Ref<PipeDistanceResult[]>,
  showAnnotations: Ref<boolean>
) {
  const annotations = new Map<string, LinearDimension3D>();

  function renderAnnotations() {
    clearAnnotations();
    
    const viewer = viewerRef.value;
    if (!viewer || !showAnnotations.value) return;
    
    for (const result of results.value) {
      const dim = new LinearDimension3D({
        start: new Vector3(...result.start),
        end: new Vector3(...result.end),
        text: `${result.distance}`,
        color: 0xff6b00,
        textColor: 0xff6b00,
      });
      
      viewer.scene.add(dim);
      annotations.set(result.id, dim);
    }
  }

  function clearAnnotations() {
    const viewer = viewerRef.value;
    if (!viewer) return;
    
    for (const dim of annotations.values()) {
      viewer.scene.remove(dim);
      dim.dispose();
    }
    annotations.clear();
  }

  watch([results, showAnnotations], renderAnnotations, { deep: true });

  return { renderAnnotations, clearAnnotations };
}
