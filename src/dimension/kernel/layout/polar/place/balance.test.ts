import { describe, expect, it } from 'vitest';

import { getNormalDirs } from './angles';
import { balance } from './balance';

import type { Vec3 } from '../../../types';
import type { AngleRange } from '../numeric/angleRanges';
import type { PolarElement, PolarReference } from '../reference/types';

/**
 * 参考系与 `dirAndCha.test.ts` 同一夹具：竖直管，角度 0°=北、90°=西、180°=南、
 * 270°=东（`dirAt` 的推导见该文件头）。
 */
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

const DEFAULT_ANGLE_RANGE: readonly AngleRange[] = [[45, 135], [-135, -45]];
const EAST: Vec3 = [1, 0, 0];
const WEST: Vec3 = [-1, 0, 0];

function element(overrides: Partial<PolarElement> = {}): PolarElement {
  return {
    id: 'e',
    type: 'POLARBOX',
    dis: [0, 10],
    angle: [0, 10],
    radius: [0.05, 0.15],
    basic: false,
    ...overrides,
  };
}

describe('balance — 无障碍元素（`:540-582` 的空输入）', () => {
  it('keeps basicRadius as the only candidate radius and leaves bestDirs unchanged', () => {
    const normalDirs = getNormalDirs(VERTICAL);
    const result = balance(VERTICAL, [], [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, normalDirs, false, false);
    expect(result.radii).toEqual([0.1]);
    expect(result.bestDirs).toEqual(normalDirs);
    expect(result.elements).toEqual([]);
    expect(result.forcedMainDimDir).toBe(false);
    expect(result.angleRanges).toEqual(DEFAULT_ANGLE_RANGE);
  });
});

describe('balance — 候选半径收集与去重合并（`:542-582`）', () => {
  it('rounds endradius to the nearest millimetre, then merges clusters closer than basicRadius/20', () => {
    // basicRadius=0.1 -> 合并门槛 0.1/20=0.005。
    // 元素外半径（米）0.12 / 0.123 / 0.3 -> nint 到毫米后仍是 0.12 / 0.123 / 0.3。
    // 连同 basicRadius=0.1 排序去重 -> [0.1, 0.12, 0.123, 0.3]。
    // 从高到低合并：largeRadius=0.3；0.123: 0.3-0.123=0.177>=0.005 保留，largeRadius=0.123；
    // 0.12: 0.123-0.12=0.003<0.005 删除；0.1: 0.123-0.1=0.023>=0.005 保留。
    // 结果 [0.1, 0.123, 0.3]。
    const eles = [
      element({ id: 'a', angle: [0, 10], radius: [0.05, 0.12] }),
      element({ id: 'b', angle: [20, 30], radius: [0.05, 0.123] }),
      element({ id: 'c', angle: [40, 50], radius: [0.05, 0.3] }),
    ];
    const result = balance(VERTICAL, eles, [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, getNormalDirs(VERTICAL), false, false);
    expect(result.radii).toEqual([0.1, 0.123, 0.3]);
  });

  it('drops a candidate radius at or beyond basicRadius * 20 (non-inst pipe, `:561`)', () => {
    const farElement = element({ radius: [0.05, 2.0] }); // basicRadius*20 = 2.0, PML uses `lt`
    const result = balance(VERTICAL, [farElement], [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, getNormalDirs(VERTICAL), false, false);
    expect(result.radii).toEqual([0.1]);
  });

  it('uses basicRadius * 50 for an inst pipe (`:547`)', () => {
    const instReference: PolarReference = { ...VERTICAL, isInstPipe: true };
    const midElement = element({ radius: [0.05, 2.0] }); // rejected at factor 20, accepted at 50
    const result = balance(instReference, [midElement], [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, getNormalDirs(instReference), false, false);
    expect(result.radii).toEqual([0.1, 2.0]);
  });
});

describe('balance — `:586-595` isDim && mainDimDir 强制单窗口', () => {
  it('forces a single angle window centred on mainDimDir and ignores the input angleRange/newBestDirs', () => {
    // mainDimDir = East(270°) -> window [270-15, 270+15] = [255, 285]。
    const withMainDimDir: PolarReference = { ...VERTICAL, mainDimDir: EAST };
    const result = balance(
      withMainDimDir,
      [],
      [4.5, 5.5],
      DEFAULT_ANGLE_RANGE,
      30,
      getNormalDirs(withMainDimDir),
      true,
      false,
    );
    expect(result.forcedMainDimDir).toBe(true);
    expect(result.angleRanges).toEqual([[255, 285]]);
    expect(result.bestDirs).toEqual([EAST]);
  });

  it('does not force the window when isDim is false, even with mainDimDir set', () => {
    const withMainDimDir: PolarReference = { ...VERTICAL, mainDimDir: EAST };
    const result = balance(
      withMainDimDir,
      [],
      [4.5, 5.5],
      DEFAULT_ANGLE_RANGE,
      30,
      getNormalDirs(withMainDimDir),
      false,
      false,
    );
    expect(result.forcedMainDimDir).toBe(false);
    expect(result.angleRanges).toEqual(DEFAULT_ANGLE_RANGE);
  });
});

describe('balance — `:596-636` 加权质心重排 bestDirs', () => {
  it('reorders bestDirs by ascending angle to the weighted-centroid direction', () => {
    // 元素中点角 70°（在 [60,80] 的中点）-> wdir = dirAt(70)。
    // East(270°)/dirAt(70) 夹角较大；West(90°)/dirAt(70) 夹角约 20° 更近 -> West 排前。
    const weighted = element({ angle: [60, 80], radius: [0.11, 0.15], dis: [4, 6] });
    const result = balance(VERTICAL, [weighted], [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, getNormalDirs(VERTICAL), false, false);
    expect(result.bestDirs).toEqual([WEST, EAST]);
  });

  it('leaves bestDirs unchanged when no element overlaps the dis window', () => {
    const outside = element({ dis: [0, 1] });
    const normalDirs = getNormalDirs(VERTICAL);
    const result = balance(VERTICAL, [outside], [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, normalDirs, false, false);
    expect(result.bestDirs).toEqual(normalDirs);
  });

  it('does not produce NaN when a zero-weight element precedes a real-weight one (`:618-620` fix)', () => {
    // 第一个元素 startradius===endradius -> wr=0 -> weight=0 -> totalw 仍是 0，
    // 若不加 newTotalW===0 的守卫会在这一步出现 0/0。第二个元素权重非零，
    // 最终 wdir 应完全来自第二个元素（中点角 70°），与「无前置零权重元素」一致。
    const zeroWeightFirst = element({ id: 'z1', angle: [10, 20], radius: [0.11, 0.11], dis: [4, 6] });
    const realWeightSecond = element({ id: 'z2', angle: [60, 80], radius: [0.11, 0.15], dis: [4, 6] });
    const result = balance(
      VERTICAL,
      [zeroWeightFirst, realWeightSecond],
      [4.5, 5.5],
      DEFAULT_ANGLE_RANGE,
      30,
      getNormalDirs(VERTICAL),
      false,
      false,
    );
    expect(result.bestDirs).toEqual([WEST, EAST]);
    for (const dir of result.bestDirs) {
      expect(Number.isFinite(dir[0])).toBe(true);
      expect(Number.isFinite(dir[1])).toBe(true);
      expect(Number.isFinite(dir[2])).toBe(true);
    }
  });

  it('leaves bestDirs unchanged when every element has zero weight (totalW stays 0 throughout)', () => {
    const allZeroWeight = [
      element({ id: 'z1', angle: [10, 20], radius: [0.11, 0.11], dis: [4, 6] }),
      element({ id: 'z2', angle: [60, 80], radius: [0.12, 0.12], dis: [4, 6] }),
    ];
    const normalDirs = getNormalDirs(VERTICAL);
    const result = balance(VERTICAL, allZeroWeight, [4.5, 5.5], DEFAULT_ANGLE_RANGE, 30, normalDirs, false, false);
    expect(result.bestDirs).toEqual(normalDirs);
  });
});
