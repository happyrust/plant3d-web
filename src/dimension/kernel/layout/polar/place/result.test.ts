import { describe, expect, it } from 'vitest';

import { getResult, getZDir, polarArcFrame } from './result';

import type { PolarNeeds } from './types';
import type { Vec3 } from '../../../types';
import type { PolarReference } from '../reference/types';

/** 期望值按 `polarsystem.pmlobj:380-398` / `:2420-2539` 手工推导，依据写在断言旁。 */

const COS_30 = Math.sqrt(3) / 2;
const SIN_30 = 0.5;

/** 水平管：`dir = E`，`showDir` 在 30°（`:277-280`），`horiDir = N`。 */
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

/** 水平管但 `showDir === horiDir`（lookangle = 0）：命中 `:382` 的 `< 1°` 退化。 */
const HORIZONTAL_DEGENERATE: PolarReference = {
  ...HORIZONTAL,
  plane: { zero: [0, 1, 0], normal: [1, 0, 0] },
  showDir: [0, 1, 0],
};

/** 竖直管：`dir = U`，`:283` 令 `showdir = horidir = N`。 */
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

/** needs = [needdis, needangle, needradius]；getresult 只读 needradius（`:2515` needs[3]）。 */
const NEEDS: PolarNeeds = [1, 30, 0.4];

function expectVec(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe('polarArcFrame — `:289` + `:2421`', () => {
  it('uses origin / showDir / axis as centre / zero / normal', () => {
    const frame = polarArcFrame(HORIZONTAL);
    expect(frame.centre).toEqual([0, 0, 0]);
    expect(frame.xAxis).toEqual([0, COS_30, SIN_30]);
    expect(frame.zAxis).toEqual([1, 0, 0]);
  });
});

describe('getZDir — `:380-398`', () => {
  it('non-degenerate branch returns horiDir.orthogonal(showDir) (`:394`)', () => {
    // angle([0,1,0],[0,.866,.5]) = 30，不在 (0,1)∪(179,180) → :394。
    // [0,1,0]×[0,.866,.5] = (1*.5-0*.866, 0*0-0*.5, 0*.866-1*0) = (.5,0,0) → [1,0,0]。
    expectVec(getZDir(HORIZONTAL)!, [1, 0, 0]);
  });

  it('degenerate branch picks +dir when the cross points away from world down (`:387-391`)', () => {
    // angle(horiDir, showDir) = 0 < 1 → 退化。
    // dir.orthogonal(horidir) = [1,0,0]×[0,1,0] = [0,0,1]；angle([0,0,1], d=[0,0,-1]) = 180，
    // 不 < 90 → :390 zdir = dir = [1,0,0]。
    expectVec(getZDir(HORIZONTAL_DEGENERATE)!, [1, 0, 0]);
  });

  it('degenerate branch picks -dir when the cross points at world down (`:387-388`)', () => {
    // 取 axis = -E：orthogonal([-1,0,0],[0,1,0]) = [0,0,-1]；angle([0,0,-1],[0,0,-1]) = 0 < 90
    // → :388 zdir = -dir = [1,0,0]。
    const reference: PolarReference = {
      ...HORIZONTAL_DEGENERATE,
      axis: [-1, 0, 0],
      plane: { zero: [0, 1, 0], normal: [-1, 0, 0] },
    };
    expectVec(getZDir(reference)!, [1, 0, 0]);
  });

  it('returns null when horiDir is parallel to axis (`:387` has no handle any)', () => {
    // 退化需 angle(horiDir, showDir) < 1（:382）；此时若 horiDir ∥ axis，
    // :387 dir.orthogonal(horidir) 无解（:384-392 的 handle any 已被注释掉）。
    const reference: PolarReference = {
      ...HORIZONTAL_DEGENERATE,
      horiDir: [1, 0, 0],
      showDir: [1, 0, 0],
      plane: { zero: [1, 0, 0], normal: [1, 0, 0] },
    };
    expect(getZDir(reference)).toBeNull();
  });
});

describe('getResult — `:2420-2539`', () => {
  it('vertical pipe: charDir degenerate branch (`:2451-2457`) and textori degenerate branch (`:2499-2507`)', () => {
    // dir.angle(u) = 0 → :2426 不 > 10 → :2447 bestchardir = showdir.orthogonal(u)
    //   = [0,1,0]×[0,0,1] = [1,0,0]。
    // goodangle = 0 → outdir = arc.angledirection(0) = zero = [0,1,0]。
    // outdir.angle(bestchardir) = 90 → :2451 |90-90| < 5 成立；:2452 outdir.angle(showdir) = 0 < 90
    //   → :2454 chardir = -outdir = [0,-1,0]。
    // zdir = dir.orthogonal(chardir) = [0,0,1]×[0,-1,0] = (0*0-1*(-1), 1*0-0*0, 0) = [1,0,0]。
    // zdir.angle(showdir) = 90 → :2499 |90-90| < 1 成立；:2503 zdir.angle(bestchardir) = 0 < 90
    //   → :2504 xdir = dir = [0,0,1]。
    const placement = getResult(VERTICAL, 2, 0, 0.5, NEEDS);
    expectVec(placement.textOri.x, [0, 0, 1]);
    expectVec(placement.textOri.y, [0, -1, 0]);
    expectVec(placement.textOri.z, [1, 0, 0]);
    // goodpos = pos + dir*gooddis + outdir*goodradius + chardir*(-needs[3]/2)
    //        = [0,0,0] + [0,0,2] + [0,0.5,0] + [0,-1,0]*(-0.2) = [0, 0.7, 2]。
    expectVec(placement.pos, [0, 0.7, 2]);
  });

  it('vertical pipe: charDir > 90 branch (`:2458-2459`) and textori else branch (`:2511`)', () => {
    // goodangle = 90 → outdir = y = z×x = [0,0,1]×[0,1,0] = [-1,0,0]。
    // bestchardir 同上一例 = [1,0,0]；outdir.angle(bestchardir) = 180 > 90 → :2459 chardir = [1,0,0]。
    // zdir = [0,0,1]×[1,0,0] = (0*0-1*0, 1*1-0*0, 0-0) = [0,1,0]。
    // zdir.angle(showdir) = 0 → 既不 <1 也不 >90 → :2511 xdir = dir = [0,0,1]。
    const placement = getResult(VERTICAL, 1, 90, 0.3, NEEDS);
    expectVec(placement.textOri.x, [0, 0, 1]);
    expectVec(placement.textOri.y, [1, 0, 0]);
    expectVec(placement.textOri.z, [0, 1, 0]);
    // [0,0,0] + [0,0,1]*1 + [-1,0,0]*0.3 + [1,0,0]*(-0.2) = [-0.5, 0, 1]。
    expectVec(placement.pos, [-0.5, 0, 1]);
  });

  it('horizontal pipe: charDir else branch (`:2460-2461`) and textori > 90 branch (`:2508-2509`)', () => {
    // dir.angle(u) = 90 → :2426 > 10 → :2427 zdir = getzdir() = [1,0,0]；
    //   :2428 bestchardir = zdir.orthogonal(showdir) = [1,0,0]×[0,.866,.5] = (0,-.5,.866)。
    // goodangle = 90 → outdir = y = [1,0,0]×[0,.866,.5] = (0,-.5,.866) = bestchardir。
    // outdir.angle(bestchardir) = 0 → 不 >90、也不近 90 → :2461 chardir = outdir = (0,-.5,.866)。
    // zdir = dir.orthogonal(chardir) = [1,0,0]×(0,-.5,.866) = (0*.866-0*(-.5), 0*0-1*.866, 1*(-.5)-0) = (0,-.866,-.5)。
    // zdir.angle(showdir) = 180 > 90 → :2509 xdir = -dir = [-1,0,0]。
    const placement = getResult(HORIZONTAL, 0, 90, 0.2, NEEDS);
    expectVec(placement.textOri.x, [-1, 0, 0]);
    expectVec(placement.textOri.y, [0, -0.5, COS_30]);
    expectVec(placement.textOri.z, [0, -COS_30, -0.5]);
    // goodpos = [0,0,0] + [1,0,0]*0 + [0,-.5,.866]*0.2 + [0,-.5,.866]*(-0.2) = [0, -0.2, 0.2*COS_30*2-…]。
    // 逐项：outdir*0.2 = (0,-0.1,0.1732)；chardir*(-0.2) = (0,0.1,-0.1732) → 和 = (0,0,0)。
    expectVec(placement.pos, [0, 0, 0]);
  });

  it('horizontal pipe: charDir > 90 branch (`:2458-2459`)', () => {
    // goodangle = 270 → outdir = angledirection(-90) = -y = (0,.5,-.866)。
    // bestchardir 同上 = (0,-.5,.866)；outdir.angle(bestchardir) = 180 > 90 → chardir = -outdir = (0,-.5,.866)。
    // zdir = [1,0,0]×(0,-.5,.866) = (0,-.866,-.5)；textangle = 180 > 90 → xdir = [-1,0,0]。
    const placement = getResult(HORIZONTAL, 0, 270, 0.2, NEEDS);
    expectVec(placement.textOri.x, [-1, 0, 0]);
    expectVec(placement.textOri.y, [0, -0.5, COS_30]);
  });

  it('throws when charDir ends up parallel to the axis (`:2496` has no solution)', () => {
    // 竖直管 + goodangle 使 outdir = ±u 不可能（outdir 恒 ⟂ axis），
    // 这里改为让 showDir ∥ up 触发 :2447 的无解分支。
    const broken: PolarReference = { ...VERTICAL, showDir: [0, 0, 1] };
    expect(() => getResult(broken, 0, 0, 0, NEEDS)).toThrow(RangeError);
  });
});
