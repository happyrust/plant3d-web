import { describe, expect, it } from 'vitest';

import { orthogonal } from '../numeric/isoDirections';

import { cameraReference, cameraShowDir, DEFAULT_ENTER_DEG, DEFAULT_EXIT_DEG, hysteresisShowDir } from './camera';

import type { PolarReference } from './types';
import type { ViewportProjector } from '../../../projector';
import type { Vec3 } from '../../../types';

/**
 * 最小投影器：本层只读 `forward`，其余成员按契约补齐但不参与计算
 * （`createTestProjector` 的 `forward` 固定为 `[0,0,-1]`，构不出多角度用例）。
 */
function makeProjector(forward: Vec3): ViewportProjector {
  const notUsed = (): never => {
    throw new Error('camera.ts must only read projector.forward');
  };
  return {
    widthCssPx: 400,
    heightCssPx: 400,
    dpr: 2,
    right: [1, 0, 0],
    up: [0, 1, 0],
    forward,
    project: notUsed,
    unproject: notUsed,
    worldPerPixelAt: notUsed,
  };
}

/** 绕 x 轴把 `[0,0,-1]` 转 `deg` 度：与 `[0,0,-1]` 的无向夹角恰好是 `deg`。 */
function rotateAboutX(deg: number): Vec3 {
  const radians = (deg * Math.PI) / 180;
  return [0, Math.sin(radians), -Math.cos(radians)];
}

function expectVec(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function makePrevious(showDir: Vec3): PolarReference {
  return {
    origin: [1, 2, 3],
    axis: [1, 0, 0],
    plane: { zero: showDir, normal: [1, 0, 0] },
    showDir,
    // 与 cameraReference 对 axis = [1,0,0] 的取值一致：orthogonal(axis, u) = [0,-1,0]。
    horiDir: [0, -1, 0],
    up: [0, 0, 1],
    mainDimDir: null,
    disRange: [0, 10] as const,
    basicRadius: 0.5,
    isInstPipe: false,
    kind: 'camera',
  };
}

const X_AXIS: Vec3 = [1, 0, 0];

describe('cameraShowDir', () => {
  it('case 1: forward already lies in the plane normal to the axis is returned as-is', () => {
    const showDir = cameraShowDir(makeProjector([0, 0, -1]), X_AXIS);
    expect(showDir).toEqual([0, 0, -1]);
  });

  it('case 2: an oblique forward is projected onto the plane and renormalized', () => {
    const forward: Vec3 = [-Math.SQRT1_2, 0, -Math.SQRT1_2];
    const showDir = cameraShowDir(makeProjector(forward), X_AXIS);
    expect(showDir).not.toBeNull();
    expectVec(showDir!, [0, 0, -1]);
    expect(Math.abs(showDir![0])).toBeLessThan(1e-15);
  });

  it('case 3: looking straight down the axis has no in-plane direction', () => {
    expect(cameraShowDir(makeProjector([1, 0, 0]), X_AXIS)).toBeNull();
    expect(cameraShowDir(makeProjector([-2, 0, 0]), X_AXIS)).toBeNull();
    // 0.01° 的偏心仍在 PARALLEL_SIN_EPSILON (≈0.057°) 以内 → 视为沿轴看。
    const nearlyParallel: Vec3 = [1, Math.tan((0.01 * Math.PI) / 180), 0];
    expect(cameraShowDir(makeProjector(nearlyParallel), X_AXIS)).toBeNull();
  });

  it('is null for degenerate axis or forward inputs', () => {
    expect(cameraShowDir(makeProjector([0, 0, -1]), [0, 0, 0])).toBeNull();
    expect(cameraShowDir(makeProjector([0, 0, 0]), X_AXIS)).toBeNull();
  });

  it('keeps the sign of forward (no flip): looking from -z gives showDir -z', () => {
    const forward: Vec3 = [0, 0, 1];
    expect(cameraShowDir(makeProjector(forward), [0, 1, 0])).toEqual([0, 0, 1]);
  });
});

describe('hysteresisShowDir', () => {
  const previous: Vec3 = [0, 0, -1];

  it('case 4: three bands — adopt below enter, hold inside, switch at or above exit', () => {
    expect(hysteresisShowDir(previous, rotateAboutX(0.5), 1, 3)).toEqual(rotateAboutX(0.5));
    expect(hysteresisShowDir(previous, rotateAboutX(2), 1, 3)).toEqual(previous);
    expect(hysteresisShowDir(previous, rotateAboutX(5), 1, 3)).toEqual(rotateAboutX(5));
    // 带内取靠近两侧的值（比较是严格的 `< enterDeg` / `>= exitDeg`，精确边界靠 acos
    // 噪声决定，所以这里不踩边界）。
    expect(hysteresisShowDir(previous, rotateAboutX(0.1), 1, 3)).toEqual(rotateAboutX(0.1));
    expect(hysteresisShowDir(previous, rotateAboutX(2.9), 1, 3)).toEqual(previous);
    expect(hysteresisShowDir(previous, rotateAboutX(3.1), 1, 3)).toEqual(rotateAboutX(3.1));
  });

  it('case 5: no history adopts the candidate directly', () => {
    expect(hysteresisShowDir(null, rotateAboutX(5), 1, 3)).toEqual(rotateAboutX(5));
    expect(hysteresisShowDir(null, null, 1, 3)).toBeNull();
  });

  it('holds the previous direction when the candidate is null (camera along the axis)', () => {
    expect(hysteresisShowDir(previous, null, 1, 3)).toEqual(previous);
    expect(hysteresisShowDir(previous, null, 1, 3)).toBe(previous);
  });

  it('treats near-antiparallel candidates as a definite change (returns the candidate)', () => {
    const antiparallel = rotateAboutX(179.5);
    expect(hysteresisShowDir(previous, antiparallel, 1, 3)).toEqual(antiparallel);
    expect(hysteresisShowDir(previous, [0, 0, 1], 1, 3)).toEqual([0, 0, 1]);
  });

  it('case 8: rejects inverted or non-finite bands with RangeError', () => {
    expect(() => hysteresisShowDir(previous, previous, 4, 3)).toThrow(RangeError);
    expect(() => hysteresisShowDir(previous, previous, Number.NaN, 3)).toThrow(RangeError);
    expect(() => hysteresisShowDir(previous, previous, 1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => hysteresisShowDir(previous, previous, -1, 3)).toThrow(RangeError);
  });
});

describe('cameraReference', () => {
  const base = {
    origin: [1, 2, 3] as Vec3,
    axis: X_AXIS,
    disRange: [0, 10] as const,
    basicRadius: 0.5,
    isInstPipe: false,
  };

  it('assembles a legal camera reference from the projector', () => {
    const reference = cameraReference({
      ...base,
      projector: makeProjector([0, 0, -1]),
      previous: null,
    });
    expect(reference.kind).toBe('camera');
    expect(reference.mainDimDir).toBeNull();
    expect(reference.showDir).toEqual([0, 0, -1]);
    expect(reference.axis).toEqual([1, 0, 0]);
    expect(reference.plane.zero).toEqual(reference.showDir);
    expect(reference.plane.normal).toEqual([1, 0, 0]);
    expect(reference.disRange).toEqual([0, 10]);
    expect(reference.basicRadius).toBe(0.5);
    expect(reference.isInstPipe).toBe(false);
  });

  it('case 6: degenerate fallback still yields a unit showDir orthogonal to the axis', () => {
    const reference = cameraReference({
      ...base,
      projector: makeProjector([1, 0, 0]),
      previous: null,
    });
    // axis = [1,0,0] → orthogonal(axis, u) = [0,-1,0]（世界上方叉积，第一选择）。
    expectVec(reference.showDir, orthogonal(X_AXIS, [0, 0, 1])!);
    expect(reference.showDir[0]).toBe(0);
    const dot = reference.plane.zero[0] * reference.plane.normal[0]
      + reference.plane.zero[1] * reference.plane.normal[1]
      + reference.plane.zero[2] * reference.plane.normal[2];
    expect(Math.abs(dot)).toBeLessThan(1e-12);
    expect(Math.hypot(...reference.plane.zero)).toBeCloseTo(1, 12);
  });

  it('falls back to the north direction when the axis is world-up', () => {
    const reference = cameraReference({
      ...base,
      axis: [0, 0, 1],
      projector: makeProjector([0, 0, 1]),
      previous: null,
    });
    // axis ∥ u → 第一选择失效，换 n：normalize(axis × n) = normalize([0,0,1]×[0,1,0]) = [-1,0,0]。
    expectVec(reference.showDir, orthogonal([0, 0, 1], [0, 1, 0])!);
    expect(Math.abs(reference.showDir[2])).toBeLessThan(1e-15);
  });

  it('case 6b: keeps the previous showDir when the camera looks along the axis', () => {
    const previous = makePrevious([0, 0, -1]);
    const reference = cameraReference({
      ...base,
      projector: makeProjector([1, 0, 0]),
      previous,
    });
    expect(reference.showDir).toEqual([0, 0, -1]);
  });

  it('case 7: never mutates previous and always returns a fresh object', () => {
    const previous = makePrevious([0, 0, -1]);
    const snapshot = {
      origin: [...previous.origin] as Vec3,
      axis: [...previous.axis] as Vec3,
      zero: [...previous.plane.zero] as Vec3,
      normal: [...previous.plane.normal] as Vec3,
      showDir: [...previous.showDir] as Vec3,
      horiDir: [...previous.horiDir] as Vec3,
      up: [...previous.up] as Vec3,
      mainDimDir: previous.mainDimDir,
      disRange: [...previous.disRange] as [number, number],
      basicRadius: previous.basicRadius,
      isInstPipe: previous.isInstPipe,
      kind: previous.kind,
    };

    const reference = cameraReference({
      ...base,
      projector: makeProjector([0, 0, 1]),
      previous,
      enterDeg: 1,
      exitDeg: 3,
    });

    expect(reference).not.toBe(previous);
    expect(reference.plane).not.toBe(previous.plane);
    expect(reference.showDir).not.toBe(previous.showDir);
    expect(reference.axis).not.toBe(previous.axis);
    expect(reference.disRange).not.toBe(previous.disRange);

    expect(previous.origin).toEqual(snapshot.origin);
    expect(previous.axis).toEqual(snapshot.axis);
    expect(previous.plane.zero).toEqual(snapshot.zero);
    expect(previous.plane.normal).toEqual(snapshot.normal);
    expect(previous.showDir).toEqual(snapshot.showDir);
    expect(previous.horiDir).toEqual(snapshot.horiDir);
    expect(previous.up).toEqual(snapshot.up);
    expect(previous.mainDimDir).toBe(snapshot.mainDimDir);
    expect(previous.disRange).toEqual(snapshot.disRange);
    expect(previous.basicRadius).toBe(snapshot.basicRadius);
    expect(previous.isInstPipe).toBe(snapshot.isInstPipe);
    expect(previous.kind).toBe(snapshot.kind);
  });

  it('holds the previous direction inside the hysteresis band and follows outside it', () => {
    const previous = makePrevious([0, 0, -1]);
    const inside = cameraReference({
      ...base,
      projector: makeProjector(rotateAboutX(2)),
      previous,
    });
    expect(inside.showDir).toEqual([0, 0, -1]);

    const outside = cameraReference({
      ...base,
      projector: makeProjector(rotateAboutX(5)),
      previous,
    });
    expectVec(outside.showDir, rotateAboutX(5));
  });

  it('honours explicit enter/exit thresholds and their defaults', () => {
    expect(DEFAULT_ENTER_DEG).toBe(1);
    expect(DEFAULT_EXIT_DEG).toBe(3);
    const previous = makePrevious([0, 0, -1]);
    const wide = cameraReference({
      ...base,
      projector: makeProjector(rotateAboutX(5)),
      previous,
      enterDeg: 2,
      exitDeg: 10,
    });
    expect(wide.showDir).toEqual([0, 0, -1]);
    expect(() => cameraReference({
      ...base,
      projector: makeProjector([0, 0, -1]),
      previous,
      enterDeg: 5,
      exitDeg: 1,
    })).toThrow(RangeError);
  });

  it('re-projects a held direction that is no longer orthogonal to a drifted axis', () => {
    const previous = makePrevious([0, 0, -1]);
    const driftedAxis: Vec3 = [0, 0, 1];
    const reference = cameraReference({
      ...base,
      axis: driftedAxis,
      // 相机沿漂移后的轴看 → 候选为 null，沿用上一帧的 [0,0,-1]。
      projector: makeProjector([0, 0, 1]),
      previous,
    });
    const dot = reference.showDir[0] * reference.axis[0]
      + reference.showDir[1] * reference.axis[1]
      + reference.showDir[2] * reference.axis[2];
    expect(Math.abs(dot)).toBeLessThan(1e-12);
    expect(Math.hypot(...reference.showDir)).toBeCloseTo(1, 12);
    // [0,0,-1] 与新轴 [0,0,1] 反平行 → 投影为零，退到 degenerate 兜底（正交于新轴）。
    expectVec(reference.showDir, orthogonal(driftedAxis, [0, 1, 0])!);
  });

  it('keeps a held direction that is still orthogonal to an unchanged axis', () => {
    const previous = makePrevious([0, 0, -1]);
    const reference = cameraReference({
      ...base,
      projector: makeProjector([1, 0, 0]),
      previous,
    });
    expect(reference.showDir).toEqual([0, 0, -1]);
  });

  it('normalizes the axis and keeps plane.normal === axis', () => {
    const reference = cameraReference({
      ...base,
      axis: [3, 0, 0],
      projector: makeProjector([0, 0, -1]),
      previous: null,
    });
    expect(reference.axis).toEqual([1, 0, 0]);
    expect(reference.plane.normal).toBe(reference.axis);
    expect(reference.showDir).toEqual([0, 0, -1]);
  });

  it('throws RangeError for a degenerate axis', () => {
    expect(() => cameraReference({
      ...base,
      axis: [0, 0, 0],
      projector: makeProjector([0, 0, -1]),
      previous: null,
    })).toThrow(RangeError);
  });
});

describe('cameraReference — up 与 horiDir', () => {
  const base = {
    origin: [1, 2, 3] as Vec3,
    disRange: [0, 10] as const,
    basicRadius: 0.5,
    isInstPipe: false,
    previous: null,
  };

  it('fills up with world vertical for a horizontal pipe', () => {
    const reference = cameraReference({
      ...base,
      axis: X_AXIS,
      projector: makeProjector([0, 0, -1]),
    });

    expect(reference.up).toEqual([0, 0, 1]);
    // horiDir 与图纸排版无关，只走兜底链：orthogonal([1,0,0], u) = [0,-1,0]。
    expectVec(reference.horiDir, [0, -1, 0]);
    // horiDir 与 showDir 是两回事（水平管下二者不相等）。
    expectVec(reference.showDir, [0, 0, -1]);
  });

  it('falls back to n for a vertical pipe and keeps up = world vertical', () => {
    const reference = cameraReference({
      ...base,
      axis: [0, 0, 1],
      projector: makeProjector([0, 0, 1]),
    });

    expect(reference.up).toEqual([0, 0, 1]);
    // orthogonal(u, u) 无解 → 换 n：cross(u, n) = [-1,0,0]。
    expectVec(reference.horiDir, [-1, 0, 0]);
    // 退化 showDir 与 horiDir 取同一条链，二者一致（对应 polarsystem.pmlobj:283）。
    expectVec(reference.showDir, reference.horiDir);
  });

  it('keeps horiDir horizontal and unit for an oblique pipe', () => {
    const axis: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2];
    const reference = cameraReference({
      ...base,
      axis,
      projector: makeProjector([0, 0, -1]),
    });

    expect(Math.hypot(...reference.horiDir)).toBeCloseTo(1, 12);
    const dotUp = reference.horiDir[2];
    expect(Math.abs(dotUp)).toBeLessThan(1e-12);
    // 与 degenerateShowDir 同链，但这里是正常路径，showDir 来自相机投影。
    expectVec(reference.horiDir, [0, -1, 0]);
  });
});
