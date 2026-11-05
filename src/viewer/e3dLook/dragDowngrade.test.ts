import { describe, expect, it } from 'vitest';

import {
  DRAG_DOWNGRADE_GRACE_MS,
  createDragDowngradeState,
  isDragDowngradeEnabled,
  stepDragDowngrade,
  type DragDowngradeInput,
  type DragDowngradeState,
} from './dragDowngrade';

const base: DragDowngradeInput = { enabled: true, pipelineActive: true, held: false, cameraMoving: false, now: 0 };

function run(frames: Partial<DragDowngradeInput>[], start: DragDowngradeState = createDragDowngradeState()) {
  let state = start;
  return frames.map((f) => {
    const step = stepDragDowngrade(state, { ...base, ...f });
    state = step.state;
    return step;
  });
}

describe('stepDragDowngrade', () => {
  it('一开始拖动就降级；只按着不动不降级', () => {
    const [press, move] = run([
      { held: true, now: 0 },
      { held: true, cameraMoving: true, now: 16 },
    ]);
    expect(press!.state.downgraded).toBe(false);
    expect(move!.state.downgraded).toBe(true);
    expect(move!.restored).toBe(false);
  });

  it('一直拖着保持降级，按着停顿超过宽限期也不恢复', () => {
    const steps = run([
      { held: true, cameraMoving: true, now: 0 },
      { held: true, cameraMoving: true, now: 100 },
      { held: true, now: 1000 },
      { held: true, cameraMoving: true, now: 1016 },
    ]);
    expect(steps.every((s) => s.state.downgraded)).toBe(true);
    expect(steps.some((s) => s.restored)).toBe(false);
  });

  it('松手后阻尼还在转，宽限期跟着延长', () => {
    const steps = run([
      { held: true, cameraMoving: true, now: 0 },
      { cameraMoving: true, now: 150 },
      { cameraMoving: true, now: 300 },
      { now: 450 },
    ]);
    expect(steps.map((s) => s.state.downgraded)).toEqual([true, true, true, true]);
    expect(steps[3]!.restoreAt).toBe(300 + DRAG_DOWNGRADE_GRACE_MS);
  });

  it('停稳 200ms 后恢复，并只报一次 restored', () => {
    const steps = run([
      { cameraMoving: true, now: 0 },
      { now: 199 },
      { now: 200 },
      { now: 400 },
    ]);
    expect(steps[1]!.state.downgraded).toBe(true);
    expect(steps[1]!.restoreAt).toBe(200);
    expect(steps[2]!.state.downgraded).toBe(false);
    expect(steps[2]!.restored).toBe(true);
    expect(steps[3]!.restored).toBe(false);
    expect(steps[3]!.restoreAt).toBeNull();
  });

  it('开关关闭时不降级；降级中关掉立刻恢复', () => {
    const [off] = run([{ enabled: false, held: true, cameraMoving: true, now: 0 }]);
    expect(off!.state.downgraded).toBe(false);
    const [, turnedOff] = run([
      { cameraMoving: true, now: 0 },
      { enabled: false, cameraMoving: true, now: 16 },
    ]);
    expect(turnedOff!.state.downgraded).toBe(false);
    expect(turnedOff!.restored).toBe(true);
  });

  it('非 E3D 样式（不走管线）不受影响', () => {
    const steps = run([
      { pipelineActive: false, held: true, cameraMoving: true, now: 0 },
      { pipelineActive: false, cameraMoving: true, now: 16 },
    ]);
    expect(steps.every((s) => !s.state.downgraded && !s.restored && s.restoreAt === null)).toBe(true);
  });
});

describe('isDragDowngradeEnabled', () => {
  it('默认开，URL 优先于 localStorage', () => {
    expect(isDragDowngradeEnabled(new URLSearchParams(''), null)).toBe(true);
    expect(isDragDowngradeEnabled(new URLSearchParams(''), '0')).toBe(false);
    expect(isDragDowngradeEnabled(new URLSearchParams('dtx_drag_downgrade=0'), null)).toBe(false);
    expect(isDragDowngradeEnabled(new URLSearchParams('dtx_drag_downgrade=1'), '0')).toBe(true);
  });
});
