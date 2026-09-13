import { describe, expect, it, vi } from 'vitest';

import { Box3, Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three';

import { createDtxDimensionViewerAdapter, type DtxObjectBoundsSource } from './dtxDimensionViewerAdapter';

function elementAt(rect: Readonly<{ left: number; top: number; width: number; height: number }>): Element {
  return {
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
  } as unknown as Element;
}

function baseInput(container: Element | null) {
  return {
    getCamera: () => new PerspectiveCamera(),
    getScene: () => new Scene(),
    getMillimetresToScene: () => new Matrix4(),
    getContainer: () => container as HTMLElement | null,
    requestRender: vi.fn(),
    getDpr: () => 1,
  };
}

describe('createDtxDimensionViewerAdapter', () => {
  it('re-bases overlay elements on the container origin and skips missing or flat ones', () => {
    const container = elementAt({ left: 40, top: 20, width: 1210, height: 800 });
    const gizmo = elementAt({ left: 1150, top: 20, width: 100, height: 100 });
    const adapter = createDtxDimensionViewerAdapter({
      ...baseInput(container),
      getOverlayElements: () => [gizmo, null, elementAt({ left: 0, top: 0, width: 0, height: 30 })],
    });
    expect(adapter.getLayoutOverlays!()).toEqual([{ x: 1110, y: 0, width: 100, height: 100 }]);

    // No container yet: nothing to re-base on.
    expect(createDtxDimensionViewerAdapter({
      ...baseInput(null),
      getOverlayElements: () => [gizmo],
    }).getLayoutOverlays!()).toEqual([]);

    // Not configured: the seam is absent, so the tags know of no overlays.
    expect(createDtxDimensionViewerAdapter(baseInput(container)).getLayoutOverlays).toBeUndefined();
    expect(createDtxDimensionViewerAdapter(baseInput(container)).queryLayoutObstacles).toBeUndefined();
  });

  it('answers component boxes as Design Space corners through the millimetre and design matrices', () => {
    // Model matrix: millimetres scaled to metres and shifted by +1 m in X.
    const millimetresToScene = new Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(1, 0, 0);
    const layer: DtxObjectBoundsSource = {
      collectObjectBoundsIntersecting: vi.fn(() => [
        { objectId: 'a', boundingBox: new Box3(new Vector3(0, 0, 0), new Vector3(2000, 1000, 500)) },
      ]),
    };
    const adapter = createDtxDimensionViewerAdapter({
      ...baseInput(elementAt({ left: 0, top: 0, width: 100, height: 100 })),
      getMillimetresToScene: () => millimetresToScene,
      getDtxLayer: () => layer,
    });
    const obstacles = adapter.queryLayoutObstacles!({ min: [-5, -5, -5], max: [5, 5, 5] });
    expect(obstacles).toHaveLength(1);
    const corners = obstacles[0]!.corners;
    expect(corners).toHaveLength(8);
    // designToWorld = mmToScene · scale(1000): 1 design metre = 1000 mm, so the
    // box is 2 × 1 × 0.5 design metres, and the translation cancels out.
    const xs = corners.map(corner => corner[0]);
    const ys = corners.map(corner => corner[1]);
    const zs = corners.map(corner => corner[2]);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
    expect(Math.max(...zs)).toBeCloseTo(0.5, 9);
    // The layer was asked in scene world: the design region, taken through
    // designToWorld, spans ±5 m around the +1 m shift.
    const [worldBox, options] = (layer.collectObjectBoundsIntersecting as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(options).toEqual({ visibleOnly: true });
    expect(worldBox.min.x).toBeCloseTo(-4, 9);
    expect(worldBox.max.x).toBeCloseTo(6, 9);
    expect(worldBox.max.y).toBeCloseTo(5, 9);
  });
});
