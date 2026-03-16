import { shallowRef, type ShallowRef } from 'vue';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { useDtxTools } from './useDtxTools';
import type { UseMbdPipeAnnotationThreeReturn } from './useMbdPipeAnnotationThree';
import type { UsePtsetVisualizationThreeReturn } from './usePtsetVisualizationThree';
import type { useToolStore } from './useToolStore';
import type { useXeokitMeasurementTools } from './useXeokitMeasurementTools';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

export type ViewerContext = {
  viewerRef: ShallowRef<DtxCompatViewer | null>;
  overlayContainerRef: ShallowRef<HTMLElement | null>;
  tools: ShallowRef<ReturnType<typeof useDtxTools> | null>;
  xeokitMeasurementTools: ShallowRef<ReturnType<typeof useXeokitMeasurementTools> | null>;
  store: ShallowRef<ReturnType<typeof useToolStore> | null>;
  viewerError: ShallowRef<string | null>;
  ptsetVis: ShallowRef<UsePtsetVisualizationThreeReturn | null>;
  mbdPipeVis: ShallowRef<UseMbdPipeAnnotationThreeReturn | null>;
  annotationSystem: ShallowRef<UseAnnotationThreeReturn | null>;
};

const globalViewerContext: ViewerContext = {
  viewerRef: shallowRef(null),
  overlayContainerRef: shallowRef(null),
  tools: shallowRef(null),
  xeokitMeasurementTools: shallowRef(null),
  store: shallowRef(null),
  viewerError: shallowRef(null),
  ptsetVis: shallowRef(null),
  mbdPipeVis: shallowRef(null),
  annotationSystem: shallowRef(null),
};

export function useViewerContext(): ViewerContext {
  return globalViewerContext;
}
