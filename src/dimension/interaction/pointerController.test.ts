import { describe, expect, it, vi } from 'vitest';

import { createLinearEditSession } from './editSession';
import { DimensionPointerController } from './pointerController';

import type { DimensionSnapPort, SnapCandidate } from '../ports/snapPort';

function createCanvas(): HTMLCanvasElement {
  return {
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement;
}

function createSession(onPreview = vi.fn()) {
  const candidate = (x: number): SnapCandidate => ({
    id: x < 100 ? 'a' : 'b',
    capability: 'point',
    anchor: {
      snapshot: x < 100 ? [0, 0, 0] : [1, 0, 0],
      accuracy: 'exact',
      semanticRef: { source: 'p-point', candidateId: String(x) },
    },
    label: 'Point',
    distancePx: 1,
  });
  const snapPort: DimensionSnapPort = {
    query: input => [candidate(input.screen.x)],
  };
  return createLinearEditSession({
    snapPort,
    actor: { actorId: 'owner', actorRole: 'designer' },
    createDimensionId: () => 'new-dimension',
    createCommandId: () => 'new-command',
    now: () => 10,
    onPreview,
  });
}

function event(clientX: number, clientY: number) {
  return { clientX, clientY };
}

describe('DimensionPointerController', () => {
  it('keeps pointer moves preview-only and applies exactly once on pointer-up', () => {
    const applyCommand = vi.fn(() => ({ ok: true as const }));
    const viewport = {
      hitTest: vi.fn(() => null),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand,
    });
    controller.start(createSession(viewport.setPreview));
    controller.pointerDown(event(20, 30));

    for (let index = 0; index < 100; index += 1) {
      controller.pointerMove(event(120, 30 + index));
    }

    expect(applyCommand).not.toHaveBeenCalled();
    controller.pointerDown(event(120, 30));
    const result = controller.pointerUp(event(120, 30));

    expect(result).toEqual({ consumed: true, requestRender: true });
    expect(applyCommand).toHaveBeenCalledTimes(1);
    expect(controller.getLastCommitResult()).toEqual({ ok: true });
  });

  it('cancels on Escape without applying a command', () => {
    const applyCommand = vi.fn(() => ({ ok: true as const }));
    const viewport = {
      hitTest: vi.fn(() => null),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand,
    });
    controller.start(createSession(viewport.setPreview));
    controller.pointerDown(event(20, 30));

    expect(controller.keyDown({ key: 'Escape' })).toEqual({
      consumed: true,
      requestRender: true,
    });
    expect(applyCommand).not.toHaveBeenCalled();
    expect(controller.hasActiveSession).toBe(false);
  });

  it('preserves a typed document rejection instead of silently ignoring it', () => {
    const applyCommand = vi.fn(() => ({
      ok: false as const,
      reason: 'forbidden' as const,
    }));
    const viewport = {
      hitTest: vi.fn(() => null),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand,
    });
    controller.start(createSession(viewport.setPreview));
    controller.pointerDown(event(20, 30));
    controller.pointerDown(event(120, 30));

    controller.pointerUp(event(120, 30));

    expect(controller.getLastCommitResult()).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('hit-tests existing dimensions before any model snap query', () => {
    const flushProjection = vi.fn();
    const viewport = {
      hitTest: vi.fn(() => ({
        dimensionId: 'existing',
        part: 'label',
        distancePx: 0,
      })),
      flushProjection,
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand: vi.fn(),
    });

    expect(controller.pointerMove(event(30, 50))).toEqual({
      consumed: true,
      requestRender: true,
    });
    expect(viewport.hitTest).toHaveBeenCalledWith([20, 30], 6);
    expect(viewport.setHover).toHaveBeenCalledWith('existing');
    controller.pointerDown(event(30, 50));
    expect(flushProjection).toHaveBeenCalledTimes(1);
    expect(flushProjection.mock.invocationCallOrder[0])
      .toBeLessThan(viewport.hitTest.mock.invocationCallOrder[1]);
    expect(viewport.setSelection).toHaveBeenCalledWith('existing');
  });

  it('starts a typed edit session when an editable hit target is pressed', () => {
    const target = {
      dimensionId: 'existing',
      part: 'label',
      distancePx: 0,
    };
    const session = {
      kind: 'linear',
      phase: 'ready',
      pointerMove: vi.fn(),
      pointerDown: vi.fn(),
      commit: vi.fn(() => null),
      cancel: vi.fn(),
      flip: vi.fn(),
    } as any;
    const factory = vi.fn(() => session);
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport: {
        hitTest: vi.fn(() => target),
        setHover: vi.fn(),
        setSelection: vi.fn(),
        setPreview: vi.fn(),
      },
      applyCommand: vi.fn(),
    });
    controller.setEditSessionFactory(factory);

    controller.pointerDown(event(30, 50));

    expect(factory).toHaveBeenCalledWith(target, { x: 20, y: 30 });
    expect(controller.hasActiveSession).toBe(true);
  });

  it('reports journal exceptions and always ends the active edit session', () => {
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport: {
        hitTest: vi.fn(() => null),
        setHover: vi.fn(),
        setSelection: vi.fn(),
        setPreview: vi.fn(),
      },
      applyCommand: vi.fn(() => {
        throw new Error('journal unavailable');
      }),
    });
    const handler = vi.fn();
    controller.setCommitResultHandler(handler);
    controller.start(createSession());
    controller.pointerDown(event(20, 30));
    controller.pointerDown(event(120, 30));

    controller.pointerUp(event(120, 30));

    expect(controller.hasActiveSession).toBe(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      reason: 'exception',
      error: expect.objectContaining({ message: 'journal unavailable' }),
    }));
  });

  it('routes toolbar flip and design-axis actions to the active session', () => {
    const flip = vi.fn();
    const selectDesignAxis = vi.fn();
    const session = {
      kind: 'projected',
      phase: 'pick-axis',
      pointerMove: vi.fn(),
      pointerDown: vi.fn(),
      commit: vi.fn(() => null),
      cancel: vi.fn(),
      flip,
      selectDesignAxis,
    } as any;
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport: {
        hitTest: vi.fn(() => null),
        setHover: vi.fn(),
        setSelection: vi.fn(),
        setPreview: vi.fn(),
      },
      applyCommand: vi.fn(),
    });
    controller.start(session);

    expect(controller.flipActiveSession()).toEqual({
      consumed: true,
      requestRender: true,
    });
    expect(controller.selectDesignAxis('y')).toEqual({
      consumed: true,
      requestRender: true,
    });
    expect(flip).toHaveBeenCalledTimes(1);
    expect(selectDesignAxis).toHaveBeenCalledWith('y');
  });

  it('interaction gate suppresses hover/selection while closed and restores them when open', () => {
    const target = {
      dimensionId: 'xeokit-measurement:m1',
      part: 'label',
      distancePx: 0,
    };
    const viewport = {
      hitTest: vi.fn(() => target),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand: vi.fn(() => ({ ok: true as const })),
    });
    let gateOpen = false;
    controller.setInteractionGate(() => gateOpen);

    expect(controller.pointerMove(event(20, 30))).toEqual({ consumed: false });
    expect(controller.pointerDown(event(20, 30))).toEqual({ consumed: false });
    expect(viewport.hitTest).not.toHaveBeenCalled();
    expect(viewport.setSelection).not.toHaveBeenCalled();

    gateOpen = true;
    expect(controller.pointerMove(event(20, 30))).toEqual({
      consumed: true,
      requestRender: true,
    });
    expect(viewport.setHover).toHaveBeenCalledWith('xeokit-measurement:m1');
    expect(controller.pointerDown(event(20, 30))).toEqual({
      consumed: true,
      requestRender: true,
    });
    expect(viewport.setSelection).toHaveBeenCalledWith('xeokit-measurement:m1');
  });
});
