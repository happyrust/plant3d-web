import { Box3, Matrix4, Vector3, type Camera, type Object3D } from 'three';

import type { DimensionViewerAdapter } from '../facade/createDimensionSystem';
import type { DesignBox, LayoutObstacle, Vec3 } from '../kernel/types';

/**
 * The part of the DTX layer the adapter reads component boxes from: objects
 * whose local (millimetre) bounding box meets a scene-world box.
 */
export type DtxObjectBoundsSource = Readonly<{
  collectObjectBoundsIntersecting(
    worldBox: Box3,
    options?: { visibleOnly?: boolean },
  ): readonly Readonly<{ objectId: string; boundingBox: Box3 }>[];
}>;

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
    ...(input.getDtxLayer ? { queryLayoutObstacles } : {}),
  };
}
