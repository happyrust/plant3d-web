import { shallowRef, type ShallowRef } from 'vue';

import type { useToolStore } from './useToolStore';
import type { useXeokitTools } from './useXeokitTools';
import type { Viewer } from '@xeokit/xeokit-sdk';

export type ViewerContext = {
  viewerRef: ShallowRef<Viewer | null>;
  overlayContainerRef: ShallowRef<HTMLElement | null>;
  tools: ShallowRef<ReturnType<typeof useXeokitTools> | null>;
  store: ShallowRef<ReturnType<typeof useToolStore> | null>;
};

const globalViewerContext: ViewerContext = {
  viewerRef: shallowRef(null),
  overlayContainerRef: shallowRef(null),
  tools: shallowRef(null),
  store: shallowRef(null),
};

export function useViewerContext(): ViewerContext {
  return globalViewerContext;
}
