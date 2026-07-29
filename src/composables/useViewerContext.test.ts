import { describe, expect, it, vi } from 'vitest';

import {
  applyLoadedModelHighlight,
  showModelByRefnosWithAck,
} from './useViewerContext';

describe('showModelByRefnosWithAck', () => {
  it('forwards highlight and resolves the matching acknowledgement', async () => {
    const onRequest = vi.fn((event: Event) => {
      const detail = (event as CustomEvent).detail;
      window.dispatchEvent(new CustomEvent('showModelByRefnosDone', {
        detail: { requestId: detail.requestId, ok: ['REF_A'], fail: [], error: null },
      }));
    });
    window.addEventListener('showModelByRefnos', onRequest);

    const result = await showModelByRefnosWithAck({
      refnos: ['REF/A'],
      highlight: true,
      ensureViewerReady: false,
      requestId: 'cloud-highlight',
    });

    expect((onRequest.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      refnos: ['REF/A'],
      flyTo: true,
      highlight: true,
      requestId: 'cloud-highlight',
    });
    expect(result.ok).toEqual(['REF_A']);
    window.removeEventListener('showModelByRefnos', onRequest);
  });
});

describe('applyLoadedModelHighlight', () => {
  it('selects only loaded refnos and performs one combined camera flight', () => {
    const setObjectsSelected = vi.fn();
    const ensureRefnos = vi.fn();
    const getAABB = vi.fn(() => [0, 0, 0, 2, 2, 2]);
    const flyTo = vi.fn();
    const setSelectedRefnos = vi.fn();
    const viewer = {
      scene: {
        selectedObjectIds: ['OLD'],
        setObjectsSelected,
        ensureRefnos,
        getAABB,
      },
      cameraFlight: { flyTo },
    };

    expect(applyLoadedModelHighlight({
      viewer: viewer as never,
      refnos: ['REF_A', 'REF_B', 'REF_A'],
      flyTo: true,
      setSelectedRefnos,
    })).toBe(true);

    expect(setObjectsSelected).toHaveBeenNthCalledWith(1, ['OLD'], false);
    expect(setObjectsSelected).toHaveBeenNthCalledWith(2, ['REF_A', 'REF_B'], true);
    expect(setSelectedRefnos).toHaveBeenCalledWith(['REF_A', 'REF_B']);
    expect(getAABB).toHaveBeenCalledOnce();
    expect(flyTo).toHaveBeenCalledOnce();
  });

  it('keeps the current selection and camera when every load failed', () => {
    const setObjectsSelected = vi.fn();
    const flyTo = vi.fn();
    const viewer = {
      scene: {
        selectedObjectIds: ['OLD'],
        setObjectsSelected,
        ensureRefnos: vi.fn(),
        getAABB: vi.fn(),
      },
      cameraFlight: { flyTo },
    };

    expect(applyLoadedModelHighlight({
      viewer: viewer as never,
      refnos: [],
      flyTo: true,
      setSelectedRefnos: vi.fn(),
    })).toBe(false);
    expect(setObjectsSelected).not.toHaveBeenCalled();
    expect(flyTo).not.toHaveBeenCalled();
  });
});
