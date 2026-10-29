import { describe, expect, it } from 'vitest';

import { isoSheetReference } from './isoSheet';

import type { IsoSheetParams } from './isoSheet';
import type { Vec3 } from '../../../types';

const U: Vec3 = [0, 0, 1];
const E: Vec3 = [1, 0, 0];
const SIN_30 = 0.5;
const COS_30 = Math.sqrt(3) / 2;
const SIN_20 = 0.3420201433256687;
const COS_20 = 0.9396926207859084;
const SIN_45 = Math.SQRT1_2;

function expectVec(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function params(overrides: Partial<IsoSheetParams> = {}): IsoSheetParams {
  return {
    origin: [0, 0, 0],
    axis: E,
    disRange: [0, 1],
    basicRadius: 0.1,
    isInstPipe: false,
    lookAngleDeg: 30,
    referenceDirs: [],
    preHoriDir: null,
    branchLookDirection: null,
    fromLeftToRight: null,
    centrePos: [0, 0, 0],
    midPos: [0.5, 0, 0],
    ...overrides,
  };
}

describe('isoSheetReference — 水平管（polarsystem.pmlobj:157-196 / :258-284）', () => {
  it('east pipe, lookangle 30: showdir is the arc tangent, plane.zero follows it', () => {
    // 推导（axis = E = [1,0,0]，u = [0,0,1]）：
    // :185 horidir = E.orthogonal(u) = cross(E,u) = [0,-1,0]
    // :258 tempangle = 90 -> 走弧分支
    // :265 tempdir = horidir.orthogonal(u) = cross([0,-1,0],u) = [-1,0,0]
    // :269 angle([-1,0,0], [1,0,0]) = 180 > 90 -> tempdir = -dir = [-1,0,0]
    // :277 ori = X is [0,-1,0], z is [-1,0,0] -> y = z × x = [0,0,1]
    // :280 angledirection(30) = -x·sin30 + y·cos30 = [0,0.5,√3/2]
    const reference = isoSheetReference(params());

    expectVec(reference.showDir, [0, SIN_30, COS_30]);
    expectVec(reference.plane.zero, [0, SIN_30, COS_30]);
    expectVec(reference.plane.normal, E);
    expect(reference.mainDimDir).toBeNull();
    expect(reference.kind).toBe('iso-sheet');
    expect(reference.disRange).toEqual([0, 1]);
    expect(reference.basicRadius).toBe(0.1);
    expect(reference.isInstPipe).toBe(false);
  });

  it('lookangle 0 yields the arc y axis, lookangle 90 yields -horidir', () => {
    // angledirection(0) = y = z × x = [0,0,1]；angledirection(90) = -x = [0,1,0]
    expectVec(isoSheetReference(params({ lookAngleDeg: 0 })).showDir, U);
    expectVec(isoSheetReference(params({ lookAngleDeg: 90 })).showDir, [0, 1, 0]);
  });
});

describe('isoSheetReference — 竖直管（polarsystem.pmlobj:282-283）', () => {
  it('tempangle = 0 falls to showdir = horidir', () => {
    // axis ∥ u -> dir.orthogonal(u) 无解；按本文件兜底改用 n：
    // cross(u, n) = cross([0,0,1],[0,1,0]) = [-1,0,0]
    const reference = isoSheetReference(params({ axis: U, midPos: [0, 0, 0.5] }));

    expectVec(reference.showDir, [-1, 0, 0]);
    expectVec(reference.plane.zero, [-1, 0, 0]);
    expectVec(reference.plane.normal, U);
  });
});

describe('isoSheetReference — prehoridir 滞后（polarsystem.pmlobj:227-238）', () => {
  // 竖直管让 showdir === horidir，从而能直接观察 horidir 是否被翻转。
  // 基准 horidir = [-1,0,0]。
  const base = { axis: U, midPos: [0, 0, 0.5] } as const;

  it('30° (< 45) keeps horidir and skips the fromltor branch via /sethoridirok', () => {
    // 若没有 :236 的 golabel，fromltor = false 会把 horidir 翻成 [1,0,0]
    const reference = isoSheetReference(params({
      ...base,
      preHoriDir: [-COS_30, SIN_30, 0],
      fromLeftToRight: false,
    }));

    expectVec(reference.showDir, [-1, 0, 0]);
  });

  it('90° (inside 45..135) falls through to the fromltor branch and flips', () => {
    const reference = isoSheetReference(params({
      ...base,
      preHoriDir: [0, 1, 0],
      fromLeftToRight: false,
    }));

    expectVec(reference.showDir, [1, 0, 0]);
  });

  it('90° with fromLeftToRight = true falls through and does not flip', () => {
    const reference = isoSheetReference(params({
      ...base,
      preHoriDir: [0, 1, 0],
      fromLeftToRight: true,
    }));

    expectVec(reference.showDir, [-1, 0, 0]);
  });

  it('150° (> 135) flips then skips the fromltor branch via /sethoridirok', () => {
    // 若没有 :236 的 golabel，fromltor = true 会保持 [-1,0,0]
    const reference = isoSheetReference(params({
      ...base,
      preHoriDir: [COS_30, SIN_30, 0],
      fromLeftToRight: true,
    }));

    expectVec(reference.showDir, [1, 0, 0]);
  });
});

describe('isoSheetReference — referencedirs 命中（polarsystem.pmlobj:157-182）', () => {
  // 用竖直管让 showdir === horidir，直接观察 referencedirs 决定的 horidir。
  // hit：与 u 夹角 60° -> abs(60-90) = 30 < 60，方位角 45°
  //   = [sin60·cos45, sin60·sin45, cos60]
  const HIT: Vec3 = [COS_30 * SIN_45, COS_30 * SIN_45, SIN_30];
  // miss：与 u 夹角 20° -> abs(20-90) = 70，不满足 < 60
  const MISS: Vec3 = [SIN_20, 0, COS_20];

  it('takes the first direction whose angle to u is inside (30°, 150°)', () => {
    const reference = isoSheetReference(params({
      axis: U,
      referenceDirs: [MISS, HIT],
    }));

    // HIT.orthogonal(u) = normalize(cross(HIT,u))
    //   = normalize([0.61237244, -0.61237244, 0]) = [√2/2, -√2/2, 0]
    expectVec(reference.showDir, [SIN_45, -SIN_45, 0]);
  });

  it('skips a direction closer than 30° to u', () => {
    const reference = isoSheetReference(params({
      axis: U,
      referenceDirs: [MISS],
    }));

    // 无命中 -> 竖直管兜底 cross(u, n) = [-1,0,0]
    expectVec(reference.showDir, [-1, 0, 0]);
  });
});

describe('isoSheetReference — fromLeftToRight 与 branlookdirection（polarsystem.pmlobj:240-248）', () => {
  const base = { axis: U, midPos: [0, 0, 0.5] } as const;

  it('fromLeftToRight = false flips horidir', () => {
    const reference = isoSheetReference(params({ ...base, fromLeftToRight: false }));

    expectVec(reference.showDir, [1, 0, 0]);
  });

  it('fromLeftToRight = true leaves horidir untouched', () => {
    const reference = isoSheetReference(params({ ...base, fromLeftToRight: true }));

    expectVec(reference.showDir, [-1, 0, 0]);
  });

  it('branlookdirection wins over fromltor', () => {
    // angle(horidir, bran) = 90 -> 不 < 90 -> 不翻；fromltor = false 应被 elseif 跳过
    const reference = isoSheetReference(params({
      ...base,
      branchLookDirection: [0, 1, 0],
      fromLeftToRight: false,
    }));

    expectVec(reference.showDir, [-1, 0, 0]);
  });

  it('branlookdirection inside 90° flips even when fromltor would not', () => {
    const reference = isoSheetReference(params({
      ...base,
      branchLookDirection: [-1, 0, 0],
      fromLeftToRight: true,
    }));

    expectVec(reference.showDir, [1, 0, 0]);
  });
});

describe('isoSheetReference — plane 一致性', () => {
  const cases: readonly [string, IsoSheetParams][] = [
    ['水平管', params()],
    ['水平管 lookangle 90', params({ lookAngleDeg: 90 })],
    ['竖直管', params({ axis: U })],
    ['倒立管', params({ axis: [0, 0, -1] })],
    ['斜管', params({ axis: [SIN_45, 0, SIN_45] })],
    ['北向管', params({ axis: [0, 1, 0] })],
    ['referencedirs 命中', params({ axis: U, referenceDirs: [[COS_30 * SIN_45, COS_30 * SIN_45, SIN_30]] })],
  ];

  it.each(cases)('%s: zero ⟂ normal, both unit length', (_name, input) => {
    const reference = isoSheetReference(input);

    const dot = reference.plane.zero[0] * reference.plane.normal[0]
      + reference.plane.zero[1] * reference.plane.normal[1]
      + reference.plane.zero[2] * reference.plane.normal[2];
    expect(dot).toBeCloseTo(0, 9);
    expect(Math.hypot(...reference.plane.zero)).toBeCloseTo(1, 9);
    expect(Math.hypot(...reference.plane.normal)).toBeCloseTo(1, 9);
    expectVec(reference.plane.zero, reference.showDir);
    expectVec(reference.plane.normal, reference.axis);
  });
});
