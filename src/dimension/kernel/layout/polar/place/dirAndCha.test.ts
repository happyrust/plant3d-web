import { describe, expect, it } from 'vitest';

import { getDirAndCha, DEFAULT_MIN_GAP_DIVISOR, SHOWDIR_SAME_SIDE_FACTOR } from './dirAndCha';

import type { Vec3 } from '../../../types';
import type { AngleRange } from '../numeric/angleRanges';
import type { PolarElement, PolarReference } from '../reference/types';

/**
 * 期望值按 `polarsystem.pmlobj:1608-1770` 手工推导。参考系统一用竖直管：
 * `dir = u`，`showDir = horiDir = N`，`plane = {zero: N, normal: U}`，
 * 于是极坐标角 0° = 北，90° = 东（y = z×x = U×N = E），180° = 南。
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

/**
 * 与极坐标角对应的单位方向。弧基：`x = plane.zero = N`，`y = z × x = U × N = -E = W`，
 * 所以角 0° = 北、90° = 西、180° = 南、270° = 东。
 */
function dirAt(angle: number): Vec3 {
  const radians = (angle * Math.PI) / 180;
  return [-Math.sin(radians), Math.cos(radians), 0];
}

function element(angle: readonly [number, number]): PolarElement {
  return { id: 'e', type: 'AIDTEX', dis: [0, 1], angle, radius: [0, 1], basic: false };
}

function expectVec(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

describe('getDirAndCha — `:1613-1617` 无已用角度', () => {
  it('returns the first bestdir with zero cha', () => {
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(0), dirAt(90)], [[0, 360]], {});
    expect(result).not.toBeNull();
    expect(result!.angleCha).toBe(0);
    expectVec(result!.dir, [0, 1, 0]);
  });

  it('returns null when bestdirs is empty (PML would index out of range at `:1614`)', () => {
    expect(getDirAndCha(VERTICAL, [], 30, [], [[0, 360]], {})).toBeNull();
  });
});

describe('getDirAndCha — 段 1 优选方向（`:1625-1652`）', () => {
  it('takes the first bestdir whose angle clears every used range by minGapAngle', () => {
    // used = [60,120]（东向扇区），needangle = 30 → minGapAngle = 15。
    // bestdirs = [0°, 180°]：0° 不在 [60,120]，与两端 60/120 距离都 >= 15 → 命中，cha = 0。
    const used: AngleRange[] = [[60, 120]];
    const result = getDirAndCha(VERTICAL, [element([60, 120])], 30, [dirAt(0), dirAt(180)], [], {}, used);
    expect(result!.angleCha).toBe(0);
    expectVec(result!.dir, dirAt(0));
  });

  it('rejects a bestdir inside a used range and falls to the next one', () => {
    // bestdirs = [90°, 0°]，90° 落在 [60,120] 内 → 换 0°，cha = 0。
    const used: AngleRange[] = [[60, 120]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(90), dirAt(0)], [], {}, used);
    expectVec(result!.dir, dirAt(0));
    expect(result!.angleCha).toBe(0);
  });

  it('rejects a bestdir within minGapAngle of a range endpoint (`:1633`)', () => {
    // bestdirs = [130°, 0°]，130° 与端点 120 差 10 < 15 → 拒；落到 0°。
    const used: AngleRange[] = [[60, 120]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(130), dirAt(0)], [], {}, used);
    expectVec(result!.dir, dirAt(0));
  });

  it('adds notBestPlusAngle when bestdirs has >= 3 entries and the hit is not the first (`:1643-1649`)', () => {
    // bestdirs = [90°(被占), 0°, 180°] → 命中下标 1，cha = 30。
    const used: AngleRange[] = [[60, 120]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(90), dirAt(0), dirAt(180)], [], {}, used);
    expect(result!.angleCha).toBe(30);
    expectVec(result!.dir, dirAt(0));
  });

  it('keeps cha = 0 for the first bestdir even with >= 3 entries', () => {
    const used: AngleRange[] = [[60, 120]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(0), dirAt(90), dirAt(180)], [], {}, used);
    expect(result!.angleCha).toBe(0);
  });
});

describe('getDirAndCha — 段 2 全圆特例（`:1654-1660`）', () => {
  it('returns bestdirs[1] with cha = 360 when the only used range is [0,360]', () => {
    const used: AngleRange[] = [[0, 360]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(0)], [], {}, used);
    expect(result!.angleCha).toBe(360);
    expectVec(result!.dir, dirAt(0));
  });
});

describe('getDirAndCha — 段 3 最近方向（`:1662-1760`）', () => {
  it('picks the gap endpoint offset by minGapAngle and reports the angular error', () => {
    // used = [300, 60]（跨界，占 300→360→60），空闲跨度为 60→300 = 240 ≥ needangle 30。
    // 候选角 = 60+15 = 75、300-15 = 285。
    // bestdir = 10°：angle(10°,75°) = 65，angle(10°,285°) = min(275, 85) = 85 → 取 75，cha = 65。
    // （bestdir 10° 不在 [300,60] 内，也不在端点 15° 内 → 段 1 会直接命中，故先把 bestdir 放进区间。）
    const used: AngleRange[] = [[300, 60]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(10)], [], {}, used);
    expect(result!.angleCha).toBeCloseTo(65, 6);
    expectVec(result!.dir, dirAt(75));
  });

  it('applies the 0.9 factor when the two directions are on the same side of the view (`:1700`)', () => {
    // used = [60, 240] → 空闲跨度 240→60 = 180 ≥ 30，候选角 = 240+15 = 255 与 60-15 = 45。
    // bestdir = 100°（在 [60,240] 内 → 段 1 拒，进段 3）。
    // 与 255° 的角差 155：cross(dirAt(100), showDir=N) 与 cross(dirAt(100), dirAt(255)) 异号 → 不降权。
    // 与 45° 的角差 55：两者同号（同侧）→ tempangle = min(0.9*55, 360) = 49.5 < 155 → 取 45°。
    const used: AngleRange[] = [[60, 240]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(100)], [], {}, used);
    expect(result!.angleCha).toBeCloseTo(0.9 * 55, 6);
    expectVec(result!.dir, dirAt(45));
  });

  it('falls back to the middle direction of the widest short gap (`:1744-1755`)', () => {
    // 两段已用区间把圆切碎，剩余跨度都不足 needangle = 200：
    //   [0,100] 与 [110,350] → 间隙 1 = [100,110]（10°）、间隙 2 = [350, 0]（10°）。
    // 两段都 < 200，取跨度最大者（并列取先出现，即 [100,110]）→ middir = bisect(dirAt(100), dirAt(110))。
    // cha = min over bestdirs of angle(bestdir, middir)；bestdir = dirAt(105) → cha = 0。
    const used: AngleRange[] = [
      [0, 100],
      [110, 350],
    ];
    const result = getDirAndCha(VERTICAL, [], 200, [dirAt(105)], [], {}, used);
    expect(result).not.toBeNull();
    expect(result!.angleCha).toBeCloseTo(0, 6);
    expectVec(result!.dir, dirAt(105), 6);
  });

  it('uses dir1 directly when the two gap ends coincide within 0.1° (`:1717`)', () => {
    // 唯一已用区间 [100.05, 100]（跨界，实际只占 0.05°），空闲跨度 = 100 - 100.05 → 360-0.05 = 359.95？
    // 不对：:1990-1991 的 start = used[0][1] = 100、end = used[0][0] = 100.05，span = 0.05 < 200 → else 分支。
    // dir1.angle(dir2) = 0.05 < 0.1 → middir = dir1 = dirAt(100)。
    const used: AngleRange[] = [[100.05, 100]];
    const result = getDirAndCha(VERTICAL, [], 200, [dirAt(100)], [], {}, used);
    expectVec(result!.dir, dirAt(100), 6);
  });

  it('honours the notBestPlusAngle and minGapDivisor overrides', () => {
    // used = [300, 60]；bestdirs = [20°(被占), 90°] → 段 1 命中下标 1，size 2 不罚 → cha = 0。
    // 改用 3 个 bestdirs 触发罚值：bestdirs = [20°, 90°, 180°] → cha = notBestPlusAngle(自定义 12)。
    const used: AngleRange[] = [[300, 60]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(20), dirAt(90), dirAt(180)], [], {
      notBestPlusAngleDeg: 12,
    }, used);
    expect(result!.angleCha).toBe(12);
    expectVec(result!.dir, dirAt(90));
  });

  it('honours minGapDivisor when picking gap endpoints', () => {
    // used = [60, 240] → 空闲跨度 180；minGapDivisor = 3 → minGapAngle = 10。
    // 候选角 = 240+10 = 250 与 60-10 = 50。bestdir = 100°（被占）：
    // 与 50° 角差 50，同侧降权 → 45；与 250° 角差 150，异侧不降 → 取 50°，cha = 45。
    const used: AngleRange[] = [[60, 240]];
    const result = getDirAndCha(VERTICAL, [], 30, [dirAt(100)], [], { minGapDivisor: 3 }, used);
    expectVec(result!.dir, dirAt(50));
    expect(result!.angleCha).toBeCloseTo(0.9 * 50, 6);
  });

  it('throws when needAngle is not positive', () => {
    expect(() => getDirAndCha(VERTICAL, [], 0, [dirAt(0)], [], {})).toThrow(RangeError);
  });
});

describe('getDirAndCha — 常量', () => {
  it('exposes the PML defaults as named constants', () => {
    // `:1621` needangle/2、`:1700` 0.9。
    expect(DEFAULT_MIN_GAP_DIVISOR).toBe(2);
    expect(SHOWDIR_SAME_SIDE_FACTOR).toBe(0.9);
  });
});
