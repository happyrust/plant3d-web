import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';

import { usePipeDistanceAnnotationThree } from './usePipeDistanceAnnotationThree';

import type { PipeDistanceResult } from './usePipeDistanceStore';

function pipeDistanceResult(): PipeDistanceResult {
  return {
    id: '24381_105996-24381_145854',
    distance: 141,
    pipeA: '24381_105996',
    pipeB: '24381_145854',
    start: [14.563, 4.503, 14.763],
    end: [14.568, 4.37, 14.716],
  };
}

function createCompatViewerMock() {
  const compatSceneAdd = vi.fn();
  const compatSceneRemove = vi.fn();
  const realSceneAdd = vi.fn();
  const realSceneRemove = vi.fn();
  const requestRender = vi.fn();
  const viewerRef = shallowRef({
    scene: {
      add: compatSceneAdd,
      remove: compatSceneRemove,
    },
    __dtxViewer: {
      canvas: { clientWidth: 1200, clientHeight: 800 },
      scene: {
        add: realSceneAdd,
        remove: realSceneRemove,
      },
    },
    requestRender,
  } as any);

  return {
    viewerRef,
    compatSceneAdd,
    compatSceneRemove,
    realSceneAdd,
    realSceneRemove,
    requestRender,
  };
}

describe('usePipeDistanceAnnotationThree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the dimension external source when the dimension system is available', () => {
    const { viewerRef, realSceneAdd, requestRender } = createCompatViewerMock();
    const replaceExternalSource = vi.fn();
    const adapter = usePipeDistanceAnnotationThree(
      viewerRef,
      shallowRef([pipeDistanceResult()]),
      shallowRef(true),
      undefined,
      shallowRef({ replaceExternalSource } as any),
    );

    adapter.renderAnnotations();

    expect(realSceneAdd).not.toHaveBeenCalled();
    expect(replaceExternalSource).toHaveBeenCalledWith(
      'pipe-distance',
      [expect.objectContaining({
        id: 'pipe-distance:24381_105996-24381_145854',
        source: 'pipe-distance',
      })],
    );
    expect(requestRender).toHaveBeenCalled();
  });
});
