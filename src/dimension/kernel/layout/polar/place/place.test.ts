import { describe, expect, it } from 'vitest';

import { polarPlace } from './place';

import type { PolarPlaceParams } from './types';
import type { Vec3 } from '../../../types';
import type { PolarElement, PolarReference } from '../reference/types';

/**
 * 参考系与 `dirAndCha.test.ts` / `angles.test.ts` 同一夹具：
 * - `VERTICAL`：竖直管，角度 0°=北、90°=西、180°=南、270°=东；
 *   `getNormalDirs` 恒给 `[East(270°), West(90°)]`，`normalAngleRange` 恒
 *   `[[45,135],[-135,-45]]`（不依赖 `getZDir`，推导最简单）。
 * - `HORIZONTAL`：水平管（`axis = E`），`showDir` 在 `lookangle = 30°` 处取到
 *   （与 `angles.test.ts` 的 `HORIZONTAL` 完全一致），用于覆盖
 *   `getNormalDirs` / `normalAngleRange` 的非竖直分支。
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

const COS_30 = Math.sqrt(3) / 2;
const SIN_30 = 0.5;

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

const EAST: Vec3 = [1, 0, 0];
const WEST: Vec3 = [-1, 0, 0];

const NEEDS: readonly [number, number, number] = [1, 30, 0.05];

function box(overrides: Partial<PolarElement> = {}): PolarElement {
  return {
    id: 'box',
    type: 'POLARBOX',
    dis: [0, 10],
    angle: [0, 10],
    radius: [0.1, 0.15],
    basic: false,
    ...overrides,
  };
}

function baseParams(overrides: Partial<PolarPlaceParams> = {}): PolarPlaceParams {
  return {
    reference: VERTICAL,
    elements: [],
    needs: NEEDS,
    isDim: false,
    ...overrides,
  };
}

describe('polarPlace — 空障碍，竖直管（Step 1-13 主流程）', () => {
  it('picks the first bestdir (East, 270°) with score 0 when nothing blocks it', () => {
    const result = polarPlace(baseParams());

    // Step 2：splitRange([[0,10]], needDis=1, [], false) 以中点 5 为起点向外走，
    // 第一个单元是 [4.5,5.5] -> gooddis = 5（`:1253`）。
    // Step 7：radii=[basicRadius=0.1] -> band=[0.1+0.005, 0.1+0.055]=[0.105,0.155]
    // -> goodradius = 中点 0.13（`:1256`）。
    // 无障碍 -> getDirAndCha 直接取 bestDirs[0] = East，angleCha=0 -> score=0。
    expect(result.best.score).toBe(0);
    expect(result.best.dis).toBe(5);
    expect(result.best.angle).toBe(270);
    expect(result.best.radius).toBeCloseTo(0.13, 9);
    expect(result.best.dir).toEqual(EAST);
    expect(result.best.source).toBe('solved');
    expect(result.diagnostics.usedFallback).toBe(false);
    expect(result.diagnostics.disRangeCount).toBe(9);
    expect(result.diagnostics.forcedMainDimDir).toBe(false);
  });

  it('places the anchor inside normalAngleRange (east, within [-135,-45] unnormalised) and mid-span on the axis', () => {
    // disRange 中点单元 dis=5 落在 [0,10] 中段；angle=270 等价于 -90，落在
    // normalAngleRange 的 [-135,-45] 窗内（`angles.test.ts` 已证 normalAngleRange
    // 对竖直管恒为 [[45,135],[-135,-45]]）。
    const result = polarPlace(baseParams());
    expect(result.best.dis).toBeGreaterThan(0);
    expect(result.best.dis).toBeLessThan(10);
    expect(result.best.angle === 270 || result.best.angle === -90).toBe(true);
  });
});

describe('polarPlace — 障碍挡住首选角后改选另一窗', () => {
  it('switches from East(270°) to West(90°) when an obstacle occupies the East window', () => {
    // 障碍覆盖角度 [255,285]（包住 270°），径向 [0.1,0.12]，沿轴覆盖整个 disRange，
    // 保证每个轴向单元都会把它分进候选径向带（[0.105,0.155] 与 [0.1,0.12] 重叠）。
    const blocker = box({ id: 'blocker', dis: [0, 10], angle: [255, 285], radius: [0.1, 0.12] });
    const result = polarPlace(baseParams({ elements: [blocker] }));

    expect(result.best.angle).toBe(90);
    expect(result.best.dir).toEqual(WEST);
    expect(result.best.score).toBe(0);
    expect(result.diagnostics.usedFallback).toBe(false);
  });
});

describe('polarPlace — 水平管分支（`getNormalDirs` / `normalAngleRange` 的非竖直分支）', () => {
  it('still finds a zero-score placement with no obstacles', () => {
    const result = polarPlace(baseParams({ reference: HORIZONTAL }));
    expect(result.best.score).toBe(0);
    expect(result.best.source).toBe('solved');
    expect(result.diagnostics.usedFallback).toBe(false);
    // pos / textOri 必须是有限数值（getResult 在这个参考系下走 `:2427` 的
    // getzdir() 分支，不应抛错）。
    for (const component of result.best.pos) expect(Number.isFinite(component)).toBe(true);
  });
});

describe('polarPlace — candidates 排序与 best 的关系', () => {
  it('sorts candidates ascending by score; best is candidates[0]', () => {
    // 两个窗口都在 dis∈[4,6] 内各留一条缝（East 缝 20°，West 缝 40°），半径覆盖
    // 到 1.9m（盖住所有径向带，不给「换个半径带绕开」的机会）：落在 [4,6] 内的
    // 3 个轴向单元必须在缝隙中间落脚，score=10；落在外面的 6 个单元两个方向都
    // 没有障碍，score=0。
    const blockEast = box({ id: 'blockEast', dis: [4, 6], angle: [250, 290], radius: [0.1, 1.9] });
    const blockWest = box({ id: 'blockWest', dis: [4, 6], angle: [70, 110], radius: [0.1, 1.9] });
    const result = polarPlace(baseParams({ elements: [blockEast, blockWest] }));

    expect(result.best).toBe(result.candidates[0]);
    for (let i = 1; i < result.candidates.length; i += 1) {
      expect(result.candidates[i]!.score).toBeGreaterThanOrEqual(result.candidates[i - 1]!.score);
    }
    const scores = result.candidates.map(c => c.score);
    expect(Math.min(...scores)).toBe(0);
    expect(Math.max(...scores)).toBe(10);
    expect(scores.filter(s => s === 0)).toHaveLength(6);
    expect(scores.filter(s => s === 10)).toHaveLength(3);
    expect(result.best.score).toBe(0);
  });

  it('respects maxCandidates by truncating the sorted list without changing best', () => {
    const blockEast = box({ id: 'blockEast', dis: [4, 6], angle: [250, 290], radius: [0.1, 1.9] });
    const blockWest = box({ id: 'blockWest', dis: [4, 6], angle: [70, 110], radius: [0.1, 1.9] });
    const full = polarPlace(baseParams({ elements: [blockEast, blockWest] }));
    const truncated = polarPlace(baseParams({ elements: [blockEast, blockWest], maxCandidates: 2 }));

    expect(truncated.candidates).toHaveLength(2);
    expect(truncated.best).toEqual(full.best);
    expect(truncated.candidates).toEqual(full.candidates.slice(0, 2));
  });
});

describe('polarPlace — totalw=0 不产生 NaN（balance 内部 `:618-620` 修正的集成校验）', () => {
  it('produces finite scores and positions when an element has zero radial weight', () => {
    const zeroWeight = box({ id: 'zero', dis: [4, 6], angle: [10, 20], radius: [0.11, 0.11] });
    const result = polarPlace(baseParams({ elements: [zeroWeight] }));

    for (const candidate of result.candidates) {
      expect(Number.isFinite(candidate.score)).toBe(true);
      for (const component of candidate.pos) expect(Number.isFinite(component)).toBe(true);
    }
  });
});

describe('polarPlace — 确定性', () => {
  it('returns deep-equal results for the same input called twice', () => {
    const blocker = box({ id: 'blocker', dis: [4, 6], angle: [255, 285], radius: [0.1, 0.12] });
    const params = baseParams({ elements: [blocker] });

    const first = polarPlace(params);
    const second = polarPlace(params);

    expect(second).toEqual(first);
  });
});

describe('polarPlace — Step 14 兜底：合法输入下不可达，退化参考系与 getResult 同时失败', () => {
  it('throws RangeError for a degenerate reference instead of silently falling back', () => {
    // showDir === up 且管轴竖直：getNormalDirs() 的竖直分支与 getResult 的竖直分支
    // 调的是同一个 orthogonal(showDir, up)，两者同时退化（见 place.ts 文件头
    // 「发现：Step 14 兜底在合法输入下不可达」）。
    const degenerate: PolarReference = {
      ...VERTICAL,
      showDir: [0, 0, 1],
      horiDir: [0, 0, 1],
    };
    expect(() => polarPlace(baseParams({ reference: degenerate }))).toThrow(RangeError);
    expect(() => polarPlace(baseParams({ reference: degenerate }))).toThrow(/bestchardir has no solution/);
  });

  it('never sets usedFallback for a wide range of saturated, non-degenerate inputs', () => {
    // 12 个几乎首尾相接的障碍（缝隙仅 1°）、以及一个覆盖整圈的障碍，都不会让
    // allCandidates 变空——getDirAndCha 在非空 bestDirs 时总能退到「最宽缝隙的
    // 中点方向」，angleCha 最差也只是 360（非 null）。
    const fullCircle = box({ id: 'full', dis: [0, 10], angle: [0, 360], radius: [0.1, 0.2] });
    const manyBlockers = Array.from({ length: 12 }, (_, i) =>
      box({ id: `m${i}`, dis: [0, 10], angle: [i * 30, i * 30 + 29], radius: [0.1, 0.2] }),
    );

    expect(polarPlace(baseParams({ elements: [fullCircle] })).diagnostics.usedFallback).toBe(false);
    expect(polarPlace(baseParams({ elements: manyBlockers })).diagnostics.usedFallback).toBe(false);
  });
});
