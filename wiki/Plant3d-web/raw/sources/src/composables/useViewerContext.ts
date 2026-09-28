import { shallowRef, type Ref, type ShallowRef } from 'vue';

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

export type WaitForViewerReadyOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  viewerRef?: Ref<unknown | null>;
};

export async function waitForViewerReady(options: WaitForViewerReadyOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const intervalMs = options.intervalMs ?? 50;
  const viewerRef = options.viewerRef ?? globalViewerContext.viewerRef;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (viewerRef.value) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

export type ShowModelByRefnosFailItem = {
  refno: string;
  error: string | null;
};

export type ShowModelByRefnosResult = {
  ok: string[];
  fail: ShowModelByRefnosFailItem[];
  error: string | null;
};

export type ShowModelByRefnosOptions = {
  refnos: string[];
  flyTo?: boolean;
  requestId?: string;
  timeoutMs?: number;
  ensureViewerReady?: boolean;
  readyTimeoutMs?: number;
  viewerRef?: Ref<unknown | null>;
};

function createRequestId(prefix: string): string {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${randomSuffix}`;
}

export async function showModelByRefnosWithAck(options: ShowModelByRefnosOptions): Promise<ShowModelByRefnosResult> {
  const {
    refnos,
    flyTo = true,
    timeoutMs = 10_000,
    requestId = createRequestId('show-model-by-refnos'),
    ensureViewerReady = true,
    readyTimeoutMs = 4_000,
    viewerRef,
  } = options;

  if (!Array.isArray(refnos) || refnos.length === 0) {
    return { ok: [], fail: [], error: '缺少 refnos' };
  }

  if (ensureViewerReady) {
    const ready = await waitForViewerReady({ timeoutMs: readyTimeoutMs, viewerRef });
    if (!ready) {
      return { ok: [], fail: [], error: 'Viewer panel did not become ready in time' };
    }
  }

  if (typeof window === 'undefined') {
    return { ok: [], fail: [], error: 'window is unavailable' };
  }

  return await new Promise<ShowModelByRefnosResult>((resolve) => {
    const onDone = (event: Event) => {
      const detail = (event as CustomEvent<{
        requestId?: string;
        ok?: string[];
        fail?: ShowModelByRefnosFailItem[];
        error?: string | null;
      }>).detail;
      if (detail?.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('showModelByRefnosDone', onDone as EventListener);
      resolve({
        ok: Array.isArray(detail?.ok) ? detail.ok : [],
        fail: Array.isArray(detail?.fail) ? detail.fail : [],
        error: detail?.error ?? null,
      });
    };

    const timeout = window.setTimeout(() => {
      window.removeEventListener('showModelByRefnosDone', onDone as EventListener);
      resolve({ ok: [], fail: [], error: 'Viewer load timed out' });
    }, timeoutMs);

    window.addEventListener('showModelByRefnosDone', onDone as EventListener);
    window.dispatchEvent(new CustomEvent('showModelByRefnos', {
      detail: {
        refnos,
        flyTo,
        requestId,
      },
    }));
  });
}
