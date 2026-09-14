import { Box3, Matrix4, Vector3, type Camera, type Object3D } from 'three';

import type { DimensionViewerAdapter } from '../facade/createDimensionSystem';
import type {
  DesignBox,
  LayoutObstacle,
  OcclusionProbeHints,
  ScreenRect,
  Vec3,
} from '../kernel/types';

/**
 * The part of the DTX layer the adapter reads component boxes from: objects
 * whose local (millimetre) bounding box meets a scene-world box — and, for
 * the inspection display mode, a per-object ray cast in scene world (the
 * layer applies its global model matrix itself; hidden objects miss).
 */
export type DtxObjectBoundsSource = Readonly<{
  collectObjectBoundsIntersecting(
    worldBox: Box3,
    options?: { visibleOnly?: boolean },
  ): readonly Readonly<{ objectId: string; boundingBox: Box3 }>[];
  raycastObject?(
    objectId: string,
    origin: Vector3,
    direction: Vector3,
  ): Readonly<{ distance: number }> | null;
}>;

/**
 * The model element a DTX object belongs to: object ids are minted as
 * `o:<refno>:<piece>` (one element may load as several pieces); anything
 * else is its own element.
 */
export function refnoOfDtxObject(objectId: string): string {
  if (!objectId.startsWith('o:')) return objectId;
  const parts = objectId.split(':');
  return parts.length >= 3 && parts[1] ? parts[1] : objectId;
}

/** The eight corners of an axis-aligned box, as fresh vectors. */
function boxCorners(min: Vec3, max: Vec3): Vector3[] {
  const corners: Vector3[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push(new Vector3(x, y, z));
      }
    }
  }
  return corners;
}

function tuple(vector: Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

/**
 * DTX viewer adapter for the dimension system. Owns the source-specific
 * knowledge that the DTX global model matrix maps millimetres to scene world
 * while dimension geometry lives in Design Space metres (ADR 0008), so
 * designToWorld = millimetresToScene x scale(1000).
 *
 * With `getDtxLayer` it also answers `queryLayoutObstacles`: the Design Space
 * region is taken to scene world, the layer returns the visible objects whose
 * box meets it, and each box's eight local (millimetre) corners come back in
 * Design Space — through the same two matrices, so a rotated model matrix
 * yields the box's true corners rather than a re-fitted, looser AABB.
 *
 * With `getOverlayElements` it answers `getLayoutOverlays`: each element's
 * client rectangle, re-based on the container's top-left so it lives in the
 * same CSS px space as the projector (elements missing or without an area
 * are skipped).
 *
 * With a layer that can `raycastObject` it also answers `isSegmentBlocked`
 * for the inspection display mode: the Design Space segment goes to scene
 * world, the visible objects whose box meets the segment's box are ray-cast
 * one by one, and the first hit nearer than the segment end (less the
 * tolerance, scaled the same way) blocks it. With a `subject` hint (a tag's
 * anchor on the element it names, a weld mark's weld point inside its WELD
 * component) that element's pieces and any body the anchor lies inside are
 * left out — only other geometry hides the record.
 */
export function createDtxDimensionViewerAdapter(input: Readonly<{
  getCamera: () => Camera | null | undefined;
  getScene: () => Object3D | null | undefined;
  getMillimetresToScene: () => Matrix4 | null | undefined;
  getContainer: () => HTMLElement | null | undefined;
  requestRender: () => void;
  getDpr?: () => number;
  /** Loaded model objects; omitted = billboard tags do not know about component boxes. */
  getDtxLayer?: () => DtxObjectBoundsSource | null | undefined;
  /** DOM overlays fixed on the viewport (axis gizmo …); omitted = none. */
  getOverlayElements?: () => readonly (Element | null | undefined)[];
}>): DimensionViewerAdapter {
  const getMillimetresToScene = (): Matrix4 =>
    input.getMillimetresToScene()?.clone() ?? new Matrix4();
  const getDesignToWorld = (): Matrix4 => getMillimetresToScene().multiply(
    new Matrix4().makeScale(1000, 1000, 1000),
  );
  const queryLayoutObstacles = (region: DesignBox): readonly LayoutObstacle[] => {
    const layer = input.getDtxLayer?.();
    if (!layer) return [];
    const designToWorld = getDesignToWorld();
    if (designToWorld.determinant() === 0) return [];
    const worldBox = new Box3();
    for (const corner of boxCorners(region.min, region.max)) {
      worldBox.expandByPoint(corner.applyMatrix4(designToWorld));
    }
    if (worldBox.isEmpty()) return [];
    const millimetresToDesign = new Matrix4().multiplyMatrices(
      designToWorld.clone().invert(),
      getMillimetresToScene(),
    );
    return layer.collectObjectBoundsIntersecting(worldBox, { visibleOnly: true })
      .map(({ boundingBox }) => ({
        corners: boxCorners(tuple(boundingBox.min), tuple(boundingBox.max))
          .map(corner => tuple(corner.applyMatrix4(millimetresToDesign))),
      }));
  };
  const isSegmentBlocked = (
    from: Vec3,
    to: Vec3,
    toleranceM: number,
    hints?: OcclusionProbeHints,
  ): boolean => {
    const layer = input.getDtxLayer?.();
    if (!layer?.raycastObject) return false;
    const raycastObject = layer.raycastObject.bind(layer);
    const designToWorld = getDesignToWorld();
    if (designToWorld.determinant() === 0) return false;
    const origin = new Vector3(...from).applyMatrix4(designToWorld);
    const target = new Vector3(...to).applyMatrix4(designToWorld);
    const segment = new Vector3().subVectors(target, origin);
    const lengthWorld = segment.length();
    const lengthDesign = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    if (lengthWorld <= 0 || lengthDesign <= 0) return false;
    // A hit has to fall short of the target by the tolerance, expressed in
    // scene units through the same segment (uniform scale assumed, as for
    // every other length the adapter converts).
    const toleranceWorld = toleranceM * (lengthWorld / lengthDesign);
    const reach = lengthWorld - toleranceWorld;
    if (reach <= 0) return false;
    const direction = segment.divideScalar(lengthWorld);
    const subject = hints?.subject;
    // The probe is a record's anchor on / inside the object it names — a
    // tag's anchor, a weld mark's weld point on the bore axis: that object's
    // own pieces (the WELD's bead), and any body the anchor lies inside (the
    // tube and the fitting meeting at a connection, the valve around its
    // origin, the pipe wall around a weld point), are what the record points
    // at, not what hides it. A body encloses the anchor when a ray cast
    // onward from just before the anchor still leaves through it — the
    // layer's triangle test is two-sided, so the exit wall counts; starting
    // the tolerance short of the anchor keeps a body whose face the anchor
    // sits on (an open pipe end) in the test.
    const encloses = subject
      ? (objectId: string): boolean => raycastObject(
        objectId,
        target.clone().addScaledVector(direction, -toleranceWorld),
        direction,
      ) !== null
      : (): boolean => false;
    const segmentBox = new Box3().setFromPoints([origin, target]);
    for (const { objectId } of layer.collectObjectBoundsIntersecting(segmentBox, { visibleOnly: true })) {
      if (subject && refnoOfDtxObject(objectId) === subject) continue;
      const hit = raycastObject(objectId, origin, direction);
      if (!hit || hit.distance >= reach) continue;
      if (encloses(objectId)) continue;
      return true;
    }
    return false;
  };
  const getLayoutOverlays = (): readonly ScreenRect[] => {
    const origin = input.getContainer()?.getBoundingClientRect();
    if (!origin) return [];
    const rects: ScreenRect[] = [];
    for (const element of input.getOverlayElements?.() ?? []) {
      const rect = element?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      rects.push({
        x: rect.left - origin.left,
        y: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      });
    }
    return rects;
  };
  return {
    getCamera: () => input.getCamera() ?? null,
    getScene: () => input.getScene() ?? null,
    getDesignToWorld,
    getSize: () => {
      const rect = input.getContainer()?.getBoundingClientRect();
      const dpr = input.getDpr?.()
        ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      return {
        widthCssPx: rect?.width ?? 0,
        heightCssPx: rect?.height ?? 0,
        dpr,
      };
    },
    requestRender: input.requestRender,
    ...(input.getDtxLayer ? { queryLayoutObstacles, isSegmentBlocked } : {}),
    ...(input.getOverlayElements ? { getLayoutOverlays } : {}),
  };
}
