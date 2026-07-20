import { Matrix4, type Camera } from 'three';

import type { DimensionViewerAdapter } from '../facade/createDimensionSystem';

/**
 * DTX viewer adapter for the dimension system. Owns the source-specific
 * knowledge that the DTX global model matrix maps millimetres to scene world
 * while dimension geometry lives in Design Space metres (ADR 0008), so
 * designToWorld = millimetresToScene x scale(1000).
 */
export function createDtxDimensionViewerAdapter(input: Readonly<{
  getCamera: () => Camera | null | undefined;
  getMillimetresToScene: () => Matrix4 | null | undefined;
  getContainer: () => HTMLElement | null | undefined;
  getDpr?: () => number;
}>): DimensionViewerAdapter {
  return {
    getCamera: () => input.getCamera() ?? null,
    getDesignToWorld: () => {
      const millimetresToScene =
        input.getMillimetresToScene()?.clone() ?? new Matrix4();
      return millimetresToScene.multiply(
        new Matrix4().makeScale(1000, 1000, 1000),
      );
    },
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
  };
}
