
import { ThreeViewportProjector } from './threeViewportProjector';

import type { PointerDispatchResult } from '../interaction/pointerController';
import type { ViewportProjector } from '../kernel/projector';
import type { Camera, Matrix4 } from 'three';

type PointerHandler = (event: PointerEvent) => PointerDispatchResult;

export type DimensionViewerBindings = Readonly<{
  syncProjector(): void;
  dispose(): void;
}>;

export function createDimensionViewerBindings(input: Readonly<{
  enabled: boolean;
  mainCanvas: HTMLCanvasElement;
  viewport: Readonly<{
    setProjector(projector: ViewportProjector): void;
    setDesignToWorld(matrix: Matrix4): void;
  }>;
  pointer: Readonly<{
    pointerDown: PointerHandler;
    pointerMove: PointerHandler;
    pointerUp: PointerHandler;
    pointerCancel: () => PointerDispatchResult;
    dispose?: () => void;
  }>;
  getCamera: () => Camera | null;
  getDesignToWorld: () => Matrix4;
  getSize: () => Readonly<{
    widthCssPx: number;
    heightCssPx: number;
    dpr: number;
  }>;
}>): DimensionViewerBindings | null {
  if (!input.enabled) return null;

  let disposed = false;
  const consume = (
    result: PointerDispatchResult,
    event: PointerEvent,
  ): void => {
    if (!result.consumed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPointerDown = (event: PointerEvent): void => {
    consume(input.pointer.pointerDown(event), event);
  };
  const onPointerMove = (event: PointerEvent): void => {
    consume(input.pointer.pointerMove(event), event);
  };
  const onPointerUp = (event: PointerEvent): void => {
    consume(input.pointer.pointerUp(event), event);
  };
  const onPointerCancel = (event: PointerEvent): void => {
    consume(input.pointer.pointerCancel(), event);
  };

  input.mainCanvas.addEventListener('pointerdown', onPointerDown, true);
  input.mainCanvas.addEventListener('pointermove', onPointerMove, true);
  input.mainCanvas.addEventListener('pointerup', onPointerUp, true);
  input.mainCanvas.addEventListener('pointercancel', onPointerCancel, true);

  return {
    syncProjector(): void {
      if (disposed) return;
      const camera = input.getCamera();
      const size = input.getSize();
      if (
        !camera
        || size.widthCssPx <= 0
        || size.heightCssPx <= 0
        || size.dpr <= 0
      ) {
        return;
      }
      const designToWorld = input.getDesignToWorld();
      input.viewport.setDesignToWorld(designToWorld);
      input.viewport.setProjector(new ThreeViewportProjector({
        camera,
        designToWorld,
        widthCssPx: size.widthCssPx,
        heightCssPx: size.heightCssPx,
        dpr: size.dpr,
      }));
    },
    dispose(): void {
      if (disposed) return;
      input.mainCanvas.removeEventListener('pointerdown', onPointerDown, true);
      input.mainCanvas.removeEventListener('pointermove', onPointerMove, true);
      input.mainCanvas.removeEventListener('pointerup', onPointerUp, true);
      input.mainCanvas.removeEventListener('pointercancel', onPointerCancel, true);
      input.pointer.dispose?.();
      disposed = true;
    },
  };
}
