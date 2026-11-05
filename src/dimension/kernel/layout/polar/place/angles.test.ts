import { describe, expect, it } from 'vitest';

import { getAngleRange, getNormalDirs, getUsedAngles, isVerticalAxis, normalAngleRange } from './angles';

import type { Vec3 } from '../../../types';
import type { PolarElement, PolarReference } from '../reference/types';

/**
 * 测试用参考系构造。期望值全部按 `polarsystem.pmlobj` 原文手工推导，推导依据写在
 * 每个断言旁。
 */

const COS_30 = Math.sqrt(3) / 2;
const SIN_30 = 0.5;

/** 水平管（`dir = E`），`horiDir = N`，`showDir` 由 `:277-280` 在 30° 处取到。 */
const HORIZONTAL: PolarReference = {
  origin: [0, 0, 0],
  axis: [1, 0, 0],
  plane: { zero: [0, COS_30, SIN_30], normal: [1, 0, 0] },
  showDir: [0, COS_30, SIN_30],
  horiDir: [0, 1, 0],
  up: [0, 0, 1],
  mainDimDir: null,
  disRange: [0, 10],
  basicRadius: 0.1,
  isInstPipe: false,
  kind: 'iso-sheet',
};

/** 水平管且 `showDir === horiDir`（lookangle = 0）：`getzdir` 走 `:382` 退化分支。 */
const HORIZONTAL_DEGENERATE: PolarReference = {
  ...HORIZONTAL,
  plane: { zero: [0, 1, 0], normal: [1, 0, 0] },
  showDir: [0, 1, 0],
};

/** 竖直管（`dir = U`），`:283` 竖直管直接令 `showdir = horidir`。 */
const VERTICAL: PolarReference = {
  origin: [0, 0, 0],
  axis: [0, 0, 1],
  plane: { zero: [0, 1, 0], normal: [0, 0, 1] },
  showDir: [0, 1, 0],
  horiDir: [0, 1, 0],
  up: [0, 0, 1],
  mainDimDir: null,
  disRange: [0, 10],
  basicRadius: 0.1,
  isInstPipe: false,
  kind: 'iso-sheet',
};

function element(angle: readonly [number, number]): PolarElement {
  return { id: 'e', type: 'AIDTEX', dis: [0, 1], angle, radius: [0, 1], basic: false };
}

function expectVec(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe('isVerticalAxis — `:2559` / `:1778` / `:2426` 的竖直判定', () => {
  it('treats dir ⟂ u as horizontal', () => {
    // angle([1,0,0],[0,0,1]) = 90 → 在 (10,170) 内 → 水平。
    expect(isVerticalAxis(HORIZONTAL)).toBe(false);
  });

  it('treats dir ∥ u as vertical', () => {
    // angle = 0 < 10 → 竖直。
    expect(isVerticalAxis(VERTICAL)).toBe(true);
  });

  it('treats the reversed vertical axis as vertical too', () => {
    // angle = 180 > 170 → 竖直（PML `gt 170`）。
    expect(isVerticalAxis({ ...VERTICAL, axis: [0, 0, -1] })).toBe(true);
  });
});

describe('getNormalDirs — `:2541-2574`', () => {
  it('vertical pipe adds ±showdir.orthogonal(u) (`:2560-2561`)', () => {
    // orthogonal([0,1,0],[0,0,1]) = normalize([0,1,0]×[0,0,1]) = [1,0,0]，再加反向。
    const dirs = getNormalDirs(VERTICAL);
    expect(dirs).toHaveLength(2);
    expectVec(dirs[0]!, [1, 0, 0]);
    expectVec(dirs[1]!, [-1, 0, 0]);
  });

  it('horizontal pipe takes ±90° on the arc `x is showdir and z is getzdir()` (`:2563-2569`)', () => {
    // getzdir(): angle(horiDir,showDir)=30 → orthogonal([0,1,0],[0,0.866,0.5]) = [1,0,0]。
    // 弧 y = z×x = [1,0,0]×[0,0.866,0.5] = [0,-0.5,0.866]。
    // :2568 = angledirection(90) = y；:2569 = angledirection(-90) = -y。
    const dirs = getNormalDirs(HORIZONTAL);
    expect(dirs).toHaveLength(2);
    expectVec(dirs[0]!, [0, -0.5, COS_30]);
    expectVec(dirs[1]!, [0, 0.5, -COS_30]);
  });

  it('prepends mainDimDir when the reference carries one (`:2555-2557`)', () => {
    const dirs = getNormalDirs({ ...VERTICAL, mainDimDir: [0, 1, 0] });
    expect(dirs).toHaveLength(3);
    expectVec(dirs[0]!, [0, 1, 0]);
  });

  it('dedupes identical candidates (`:2572` unique)', () => {
    // mainDimDir 与竖直分支的 +x 重合时只留一份。
    const dirs = getNormalDirs({ ...VERTICAL, mainDimDir: [1, 0, 0] });
    expect(dirs).toHaveLength(2);
  });
});

describe('normalAngleRange — `:1772-1812` 的空输入默认值', () => {
  it('vertical pipe returns the two fixed windows in +90, -90 order (`:1803-1809`)', () => {
    // tolerance = 45（:1776）→ [45,135] 与 [-135,-45]。
    expect(normalAngleRange(VERTICAL)).toEqual([
      [45, 135],
      [-135, -45],
    ]);
  });

  it('horizontal pipe keeps the +90 window first when zdir.angle(dir) < 90 (`:1781-1788`)', () => {
    // getzdir() = [1,0,0]，angle([1,0,0],[1,0,0]) = 0 < 90 → 正窗在前。
    expect(normalAngleRange(HORIZONTAL)).toEqual([
      [45, 135],
      [-135, -45],
    ]);
  });

  it('horizontal pipe flips the order when zdir.angle(dir) >= 90 (`:1789-1796`)', () => {
    // 退化参考系下 getzdir() 走 :387-391：orthogonal([1,0,0],[0,1,0]) = [0,0,1]，
    // 与 d=[0,0,-1] 夹角 180（不 < 90）→ zdir = dir = [1,0,0]，仍 < 90。
    // 这里直接把 axis 反成 [-1,0,0] 以命中原顺序，验证分支顺序可翻转。
    const flipped: PolarReference = {
      ...HORIZONTAL_DEGENERATE,
      axis: [-1, 0, 0],
      plane: { zero: [0, 1, 0], normal: [-1, 0, 0] },
    };
    expect(normalAngleRange(flipped)).toEqual([
      [-135, -45],
      [45, 135],
    ]);
  });

  it('honours a tolerance override', () => {
    expect(normalAngleRange(VERTICAL, 30)).toEqual([
      [60, 120],
      [-120, -60],
    ]);
  });
});

describe('getAngleRange — `:1813-1859`', () => {
  it('returns the input verbatim when non-empty (`:1854-1855`)', () => {
    const input = [[10, 20]] as const;
    expect(getAngleRange(input, 30, [], VERTICAL)).toEqual([[10, 20]]);
  });

  it('empty input with empty bestdirs falls through to normalAngleRange (`:1820` + `:1826-1827`)', () => {
    // usebest 恒 true、bestdirs 为空 → `bestdirs.unset() or usebest.not()` 成立。
    expect(getAngleRange([], 30, [], VERTICAL)).toEqual([
      [45, 135],
      [-135, -45],
    ]);
  });

  it('limit = true yields the whole circle (`:1849-1852`), unreachable from getBestPosAndOri', () => {
    expect(getAngleRange([], 30, [], VERTICAL, true, true)).toEqual([[0, 360]]);
  });

  it('expands each bestdir into ±needangle/2 around its rounded angle (`:1836-1842`)', () => {
    // angleOfDirection([0,1,0]) 在竖直参考系 = 0 → [0-15, 0+15]。
    expect(getAngleRange([], 30, [[0, 1, 0]], VERTICAL)).toEqual([[-15, 15]]);
  });
});

describe('getUsedAngles — `:1985-2043`', () => {
  it('turns the gap between allowed windows into an occupied range (`:1988-2013`)', () => {
    // 允许窗 [45,135] 与 [-135,-45]（后者归一为 225..315）。
    // :1989 startangle = anglerange[x][2]；:1993 endangle = anglerange[x+1][1]；
    // :1991 绕回第一个区间的 start。单次归一后：间隙 1 = [135, 225]、间隙 2 = [315, 45]。
    const used = getUsedAngles([], [
      [45, 135],
      [-135, -45],
    ]);
    expect(used).toEqual([
      [135, 225],
      [315, 45],
    ]);
  });

  it('keeps two disjoint gaps apart when the windows do not touch (`:2035` mergeangles)', () => {
    // 窗 [0,90] 与 [180,270] → 间隙 1 = [90,180]、间隙 2 = [270, anglerange[1][1]=0]。
    // 两段不接触，merge 后仍是两段，按 start 升序。
    const used = getUsedAngles([], [
      [0, 90],
      [180, 270],
    ]);
    expect(used).toEqual([
      [90, 180],
      [270, 0],
    ]);
  });

  it('drops the self-loop produced by a single [0,360] window (`:2007`)', () => {
    // startangle = 360 → 归一 0；endangle = 360 → 归一 0；相等即丢弃。
    expect(getUsedAngles([], [[0, 360]])).toEqual([]);
  });

  it('appends element angle ranges without normalising them (`:2017-2033`)', () => {
    expect(getUsedAngles([element([300, 30])], [])).toEqual([[300, 30]]);
  });

  it('merges an element range that crosses 0° with a wrapped window', () => {
    // 窗 [45,135] + 单元素 [0,360] 的间隙自环被丢弃，元素区间 [340,20] 自身跨界。
    const used = getUsedAngles([element([340, 20])], [[0, 360]]);
    expect(used).toEqual([[340, 20]]);
  });

  it('sorts merged ranges by start angle (`:2039-2040`)', () => {
    const used = getUsedAngles([element([200, 260]), element([10, 50])], []);
    expect(used).toEqual([
      [10, 50],
      [200, 260],
    ]);
  });

  it('joins touching ranges (`mergeangles.pmlfnc:65`)', () => {
    const used = getUsedAngles([element([10, 50]), element([50, 90])], []);
    expect(used).toEqual([[10, 90]]);
  });
});
