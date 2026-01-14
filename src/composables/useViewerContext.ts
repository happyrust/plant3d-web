import { shallowRef, type ShallowRef } from 'vue';

import type { useToolStore } from './useToolStore';
import type { UsePtsetVisualizationThreeReturn } from './usePtsetVisualizationThree';
import type { useXeokitTools } from './useXeokitTools';
import type { Viewer } from '@xeokit/xeokit-sdk';

export type ViewerContext = {
  viewerRef: ShallowRef<Viewer | null>;
  overlayContainerRef: ShallowRef<HTMLElement | null>;
  tools: ShallowRef<ReturnType<typeof useXeokitTools> | null>;
  store: ShallowRef<ReturnType<typeof useToolStore> | null>;
  ptsetVis: ShallowRef<UsePtsetVisualizationThreeReturn | null>;
};

const globalViewerContext: ViewerContext = {
  viewerRef: shallowRef(null),
  overlayContainerRef: shallowRef(null),
  tools: shallowRef(null),
  store: shallowRef(null),
  ptsetVis: shallowRef(null),
};

export function useViewerContext(): ViewerContext {
  return globalViewerContext;
}
