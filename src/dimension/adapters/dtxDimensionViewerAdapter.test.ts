import { describe, expect, it, vi } from 'vitest';

import { Box3, Matrix4, PerspectiveCamera, Vector3 } from 'three';

import {
  createDtxDimensionViewerAdapter,
  refnoOfDtxObject,
  type DtxObjectBoundsSource,
} from './dtxDimensionViewerAdapter';

function elementAt(rect: Readonly<{ left: number; top: number; width: number; height: number }>): Element {
  return {
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
  } as unknown as Element;
}

function baseInput(container: Element | null) {
  return {
    getCamera: () => new PerspectiveCamera(),
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

  it('casts the inspection ray in scene world against the objects around the segment', () => {
    // designToWorld = mmToScene · scale(1000) with mmToScene = scale(0.001):
    // scene world equals Design Space here, shifted by +1 in X.
    const millimetresToScene = new Matrix4().makeScale(0.001, 0.001, 0.001).setPosition(1, 0, 0);
    const layer: DtxObjectBoundsSource = {
      collectObjectBoundsIntersecting: vi.fn(() => [
        { objectId: 'near', boundingBox: new Box3() },
        { objectId: 'far', boundingBox: new Box3() },
      ]),
      raycastObject: vi.fn((objectId: string) => (
        objectId === 'near' ? { distance: 4 } : { distance: 9.99 }
      )),
    };
    const adapter = createDtxDimensionViewerAdapter({
      ...baseInput(elementAt({ left: 0, top: 0, width: 100, height: 100 })),
      getMillimetresToScene: () => millimetresToScene,
      getDtxLayer: () => layer,
    });

    // 10 m segment along +X; a hit 4 m in blocks it.
    expect(adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0.02)).toBe(true);
    const [segmentBox, options] = (layer.collectObjectBoundsIntersecting as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(options).toEqual({ visibleOnly: true });
    expect(segmentBox.min.x).toBeCloseTo(1, 9);
    expect(segmentBox.max.x).toBeCloseTo(11, 9);
    const [id, origin, direction] = (layer.raycastObject as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe('near');
    expect([origin.x, origin.y, origin.z]).toEqual([1, 0, 0]);
    expect([direction.x, direction.y, direction.z]).toEqual([1, 0, 0]);

    // Only the far object: its hit at 9.99 is within the 0.02 tolerance of the
    // 10 m end, i.e. the geometry the probe itself sits on — not a blocker.
    (layer.collectObjectBoundsIntersecting as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { objectId: 'far', boundingBox: new Box3() },
    ]);
    expect(adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0.02)).toBe(false);
    // … but with no tolerance it counts.
    (layer.collectObjectBoundsIntersecting as ReturnType<typeof vi.fn>).mockReturnValueOnce([
      { objectId: 'far', boundingBox: new Box3() },
    ]);
    expect(adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0)).toBe(true);

    // A degenerate segment never blocks; a layer without a ray cast neither.
    expect(adapter.isSegmentBlocked!([2, 2, 2], [2, 2, 2], 0.02)).toBe(false);
    const boundsOnly = createDtxDimensionViewerAdapter({
      ...baseInput(elementAt({ left: 0, top: 0, width: 100, height: 100 })),
      getDtxLayer: () => ({ collectObjectBoundsIntersecting: () => [] }),
    });
    expect(boundsOnly.isSegmentBlocked!([0, 0, 0], [1, 0, 0], 0.02)).toBe(false);
    expect(createDtxDimensionViewerAdapter(baseInput(null)).isSegmentBlocked).toBeUndefined();
  });

  it('leaves a tag\'s own element and the bodies around its anchor out of the cast', () => {
    // Scene world = Design Space (mmToScene = scale(0.001)). The probe is a
    // tag anchor at x = 10 inside the valve `24381_145035` (two pieces); the
    // tube `24381_145036` meets the valve there and its wall is crossed at
    // x = 9.9; a rack beam `24381_140000` stands at x = 4 in front of it all.
    const millimetresToScene = new Matrix4().makeScale(0.001, 0.001, 0.001);
    const hits: Record<string, (originX: number) => number | null> = {
      'o:24381_145035:0': () => 9.5,
      'o:24381_145035:1': () => 9.7,
      // The tube: entered at 9.9 from the camera side; a cast onward from just
      // before the anchor still leaves through its far wall (two-sided test).
      'o:24381_145036:0': originX => (originX < 9.9 ? 9.9 : 0.05),
      // The beam: crossed at 4, nothing of it beyond the anchor.
      'o:24381_140000:0': originX => (originX < 4 ? 4 : null),
    };
    let objects = Object.keys(hits);
    const layer: DtxObjectBoundsSource = {
      collectObjectBoundsIntersecting: vi.fn(() => objects.map(objectId => ({ objectId, boundingBox: new Box3() }))),
      raycastObject: vi.fn((objectId: string, origin: Vector3) => {
        const distance = hits[objectId]!(origin.x);
        return distance === null ? null : { distance };
      }),
    };
    const adapter = createDtxDimensionViewerAdapter({
      ...baseInput(elementAt({ left: 0, top: 0, width: 100, height: 100 })),
      getMillimetresToScene: () => millimetresToScene,
      getDtxLayer: () => layer,
    });
    const cast = () => adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0.02, { subject: '24381_145035' });

    // Beam in front: hidden.
    expect(cast()).toBe(true);
    // Without the beam only the valve's own pieces and the enclosing tube remain: visible.
    objects = objects.filter(objectId => !objectId.startsWith('o:24381_140000'));
    expect(cast()).toBe(false);
    // The valve's pieces were never cast at; the tube was probed onward from 0.02 before the anchor.
    const calls = (layer.raycastObject as ReturnType<typeof vi.fn>).mock.calls as [string, Vector3, Vector3][];
    expect(calls.some(([id]) => id.startsWith('o:24381_145035'))).toBe(false);
    const onward = calls.find(([id, origin]) => id === 'o:24381_145036:0' && origin.x > 9);
    expect(onward).toBeDefined();
    expect(onward![1].x).toBeCloseTo(9.98, 9);
    expect([onward![2].x, onward![2].y, onward![2].z]).toEqual([1, 0, 0]);

    // The same tube in front of a dimension's value text (no subject) does block it.
    expect(adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0.02)).toBe(true);
  });

  it('leaves only the bodies around the anchor out of the cast for a point on the model without an element', () => {
    // A branch head card: the anchor is the pipe-end point inside the tube
    // `24381_145036` (crossed at 9.9, left through its far wall) — no refno
    // to skip, so the valve pieces that stand in front (9.5 / 9.7) count.
    const millimetresToScene = new Matrix4().makeScale(0.001, 0.001, 0.001);
    const hits: Record<string, (originX: number) => number | null> = {
      'o:24381_145035:0': originX => (originX < 9.5 ? 9.5 : null),
      'o:24381_145036:0': originX => (originX < 9.9 ? 9.9 : 0.05),
    };
    let objects = Object.keys(hits);
    const layer: DtxObjectBoundsSource = {
      collectObjectBoundsIntersecting: vi.fn(() => objects.map(objectId => ({ objectId, boundingBox: new Box3() }))),
      raycastObject: vi.fn((objectId: string, origin: Vector3) => {
        const distance = hits[objectId]!(origin.x);
        return distance === null ? null : { distance };
      }),
    };
    const adapter = createDtxDimensionViewerAdapter({
      ...baseInput(elementAt({ left: 0, top: 0, width: 100, height: 100 })),
      getMillimetresToScene: () => millimetresToScene,
      getDtxLayer: () => layer,
    });
    const cast = () => adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0.02, { onModel: true });

    // Valve piece in front, not enclosing the anchor: hidden.
    expect(cast()).toBe(true);
    // Only the enclosing tube left: visible — the plain cast (no hints) still says blocked.
    objects = objects.filter(objectId => objectId === 'o:24381_145036:0');
    expect(cast()).toBe(false);
    expect(adapter.isSegmentBlocked!([0, 0, 0], [10, 0, 0], 0.02)).toBe(true);
  });
});

describe('refnoOfDtxObject', () => {
  it('reads the element out of a piece id and leaves other ids alone', () => {
    expect(refnoOfDtxObject('o:24381_145035:21')).toBe('24381_145035');
    expect(refnoOfDtxObject('o:24381_145035:0')).toBe('24381_145035');
    expect(refnoOfDtxObject('demo:0')).toBe('demo:0');
    expect(refnoOfDtxObject('o::1')).toBe('o::1');
  });
});
