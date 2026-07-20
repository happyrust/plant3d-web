import { describe, expect, it, vi } from 'vitest';

import { Matrix4, PerspectiveCamera } from 'three';

import { createDimensionViewerBindings } from './viewerBindings';

function createEventTargetCanvas() {
  const listeners = new Map<string, EventListener>();
  const canvas = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
  } as unknown as HTMLCanvasElement;
  return { canvas, listeners };
}

describe('createDimensionViewerBindings', () => {
  it('does not attach anything while the development flag is disabled', () => {
    const { canvas } = createEventTargetCanvas();

    const bindings = createDimensionViewerBindings({
      enabled: false,
      mainCanvas: canvas,
      viewport: { setProjector: vi.fn() },
      pointer: {
        pointerDown: vi.fn(),
        pointerMove: vi.fn(),
        pointerUp: vi.fn(),
        pointerCancel: vi.fn(),
      },
      getCamera: () => null,
      getDesignToWorld: () => new Matrix4(),
      getSize: () => ({ widthCssPx: 400, heightCssPx: 300, dpr: 2 }),
    });

    expect(bindings).toBeNull();
    expect(canvas.addEventListener).not.toHaveBeenCalled();
  });

  it('syncs a CSS-pixel projector and routes consumed pointer events first', () => {
    const { canvas, listeners } = createEventTargetCanvas();
    const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const setProjector = vi.fn();
    const pointerDown = vi.fn(() => ({
      consumed: true as const,
      requestRender: true as const,
    }));
    const bindings = createDimensionViewerBindings({
      enabled: true,
      mainCanvas: canvas,
      viewport: { setProjector },
      pointer: {
        pointerDown,
        pointerMove: vi.fn(() => ({ consumed: false as const })),
        pointerUp: vi.fn(() => ({ consumed: false as const })),
        pointerCancel: vi.fn(() => ({ consumed: false as const })),
      },
      getCamera: () => camera,
      getDesignToWorld: () => new Matrix4(),
      getSize: () => ({ widthCssPx: 400, heightCssPx: 300, dpr: 2 }),
    });

    bindings?.syncProjector();

    const projector = setProjector.mock.calls[0][0];
    expect(projector.widthCssPx).toBe(400);
    expect(projector.heightCssPx).toBe(300);
    expect(projector.dpr).toBe(2);
    expect(projector.project([0, 0, 0])).toMatchObject({ x: 200, y: 150 });

    const stopImmediatePropagation = vi.fn();
    const preventDefault = vi.fn();
    listeners.get('pointerdown')?.({
      clientX: 10,
      clientY: 20,
      stopImmediatePropagation,
      preventDefault,
    } as unknown as Event);
    expect(pointerDown).toHaveBeenCalledTimes(1);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('detaches all listeners and disposes the controller exactly once', () => {
    const { canvas } = createEventTargetCanvas();
    const dispose = vi.fn();
    const bindings = createDimensionViewerBindings({
      enabled: true,
      mainCanvas: canvas,
      viewport: { setProjector: vi.fn() },
      pointer: {
        pointerDown: vi.fn(() => ({ consumed: false as const })),
        pointerMove: vi.fn(() => ({ consumed: false as const })),
        pointerUp: vi.fn(() => ({ consumed: false as const })),
        pointerCancel: vi.fn(() => ({ consumed: false as const })),
        dispose,
      },
      getCamera: () => null,
      getDesignToWorld: () => new Matrix4(),
      getSize: () => ({ widthCssPx: 400, heightCssPx: 300, dpr: 2 }),
    });

    bindings?.dispose();
    bindings?.dispose();

    expect(canvas.removeEventListener).toHaveBeenCalledTimes(4);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
