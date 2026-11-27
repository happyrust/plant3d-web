import { describe, expect, it, vi } from 'vitest';

import { createLinearEditSession } from './editSession';
import { DimensionPointerController } from './pointerController';

import type { DimensionSnapPort, SnapCandidate } from '../ports/snapPort';

import { present } from '@/testing/present';

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

function event(
  clientX: number,
  clientY: number,
  mouse: { button?: number; buttons?: number } = {},
) {
  return { clientX, clientY, ...mouse };
}

const RIGHT = 2;
const MIDDLE = 1;
/** `PointerEvent.buttons` 的位：主键 1、右键 2、中键 4 */
const HELD = { primary: 1, right: 2, middle: 4 };

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
    controller.pointerUp(event(120, 30));
    // 第二点之后进 place：抬起不提交，再点一下定放置才提交。
    expect(applyCommand).not.toHaveBeenCalled();
    expect(controller.sessionStatus).toMatchObject({ phase: 'place', step: 'place' });
    controller.pointerMove(event(130, 60));
    controller.pointerDown(event(130, 60));
    const result = controller.pointerUp(event(130, 60));

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
    controller.pointerDown(event(130, 60));

    controller.pointerUp(event(130, 60));

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
    expect(
      present(flushProjection.mock.invocationCallOrder[0], 'flushProjection call order'),
    ).toBeLessThan(
      present(viewport.hitTest.mock.invocationCallOrder[1], 'hitTest call order'),
    );
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
    controller.pointerDown(event(130, 60));

    controller.pointerUp(event(130, 60));

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

  it('#205 右键、中键按在尺寸图形上：不选中、不开编辑会话、不消费，留给相机', () => {
    const viewport = {
      hitTest: vi.fn(() => ({ dimensionId: 'existing', part: 'label', distancePx: 0 })),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const factory = vi.fn(() => null);
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand: vi.fn(),
    });
    controller.setEditSessionFactory(factory);

    for (const button of [RIGHT, MIDDLE]) {
      expect(controller.pointerDown(event(30, 50, { button }))).toEqual({ consumed: false });
      expect(controller.pointerUp(event(30, 50, { button }))).toEqual({ consumed: false });
    }
    expect(viewport.setSelection).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(controller.hasActiveSession).toBe(false);

    // 主键照旧：选中并消费
    expect(controller.pointerDown(event(30, 50, { button: 0 }))).toEqual({ consumed: true, requestRender: true });
    expect(viewport.setSelection).toHaveBeenCalledWith('existing');
  });

  it('#205 创建会话进行中：右键、中键单击不算拾点，抬起也不提交', () => {
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

    for (const button of [RIGHT, MIDDLE]) {
      expect(controller.pointerDown(event(20, 30, { button }))).toEqual({ consumed: false });
      expect(controller.pointerUp(event(20, 30, { button }))).toEqual({ consumed: false });
    }
    expect(controller.sessionStatus?.phase).toBe('pick-first');

    // 主键拾两点、按下定放置，会话就绪；这时右键抬起不能替主键提交
    controller.pointerDown(event(20, 30));
    controller.pointerDown(event(120, 30));
    controller.pointerUp(event(120, 30));
    controller.pointerDown(event(130, 60));
    expect(controller.sessionStatus?.phase).toBe('ready');
    expect(controller.pointerUp(event(130, 60, { button: RIGHT }))).toEqual({ consumed: false });
    expect(applyCommand).not.toHaveBeenCalled();
    expect(controller.hasActiveSession).toBe(true);

    expect(controller.pointerUp(event(130, 60))).toEqual({ consumed: true, requestRender: true });
    expect(applyCommand).toHaveBeenCalledTimes(1);
  });

  it('#205 没有尺寸会话时，有键按着的移动是别人的拖动：不做命中测试、不置悬停、不消费', () => {
    const viewport = {
      hitTest: vi.fn(() => ({ dimensionId: 'existing', part: 'label', distancePx: 0 })),
      setHover: vi.fn(),
      setSelection: vi.fn(),
      setPreview: vi.fn(),
    };
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport,
      applyCommand: vi.fn(),
    });

    for (const buttons of [HELD.primary, HELD.right, HELD.middle, HELD.primary | HELD.right]) {
      expect(controller.pointerMove(event(30, 50, { buttons }))).toEqual({ consumed: false });
    }
    expect(viewport.hitTest).not.toHaveBeenCalled();
    expect(viewport.setHover).not.toHaveBeenCalled();

    // 没有键按着的移动照旧：命中就置悬停并消费
    expect(controller.pointerMove(event(30, 50, { buttons: 0 }))).toEqual({ consumed: true, requestRender: true });
    expect(viewport.setHover).toHaveBeenCalledWith('existing');
  });

  it('#205 有尺寸会话时，只有右键或中键按着的移动是相机手势：不交给会话、不消费', () => {
    const session = {
      kind: 'linear',
      phase: 'pick-first',
      pointerMove: vi.fn(),
      pointerDown: vi.fn(),
      commit: vi.fn(() => null),
      cancel: vi.fn(),
      flip: vi.fn(),
      back: vi.fn(() => false),
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

    for (const buttons of [HELD.right, HELD.middle, HELD.right | HELD.middle]) {
      expect(controller.pointerMove(event(30, 50, { buttons }))).toEqual({ consumed: false });
    }
    expect(session.pointerMove).not.toHaveBeenCalled();

    // 没有键按着（创建中的预览）、主键按着（拖标签）、主键加别的键：都还是会话的
    for (const buttons of [0, HELD.primary, HELD.primary | HELD.right]) {
      expect(controller.pointerMove(event(30, 50, { buttons }))).toEqual({ consumed: true, requestRender: true });
    }
    expect(session.pointerMove).toHaveBeenCalledTimes(3);
  });

  it('Backspace 退回上一步并发布步骤；第一步时不消费', () => {
    const controller = new DimensionPointerController({
      canvas: createCanvas(),
      viewport: {
        hitTest: vi.fn(() => null),
        setHover: vi.fn(),
        setSelection: vi.fn(),
        setPreview: vi.fn(),
      },
      applyCommand: vi.fn(() => ({ ok: true as const })),
    });
    const statuses: (string | null)[] = [];
    const unsubscribe = controller.subscribeSessionStatus(status => statuses.push(status?.phase ?? null));
    controller.start(createSession());
    controller.pointerDown(event(20, 30));
    controller.pointerDown(event(120, 30));

    expect(controller.keyDown({ key: 'Backspace' })).toEqual({ consumed: true, requestRender: true });
    expect(controller.sessionStatus?.phase).toBe('pick-second');
    expect(controller.keyDown({ key: 'Backspace' })).toEqual({ consumed: true, requestRender: true });
    expect(controller.keyDown({ key: 'Backspace' })).toEqual({ consumed: false });
    expect(controller.hasActiveSession).toBe(true);
    controller.pointerCancel();
    unsubscribe();

    expect(statuses).toEqual([null, 'pick-first', 'pick-second', 'place', 'pick-second', 'pick-first', null]);
  });
});
