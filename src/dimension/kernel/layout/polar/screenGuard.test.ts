import { describe, expect, it } from 'vitest';

import { LabelOccupancy } from '../../collision/occupancy';
import { createTestProjector } from '../../testUtils';

import { polarPlace } from './place/place';
import {
  DEFAULT_CLEARANCE_PX,
  registerChosen,
  screenGuard,
} from './screenGuard';

import type { PolarCandidate } from './place/types';
import type { ViewportProjector } from '../../projector';
import type { Vec3 } from '../../types';
import type { PolarReference } from './reference/types';

/**
 * `createTestProjector(100)`：400×400 画布，`project(p) = (200 + x*100, 200 - y*100)`，
 * `forward = [0,0,-1]`（见 `../../testUtils.ts`）。文字框朝 `+z`（`textOri.z = [0,0,1]`）
 * 时 `dot(z, forward) = -1 < 0`，即朝向相机——作为“正常候选”的基线。
 *
 * 文字框世界尺寸 0.2m × 0.1m → 像素半宽 10、半高 5；默认净空
 * `DEFAULT_CLEARANCE_PX = 4`，所以两个“互不相关”的候选中心像素距离只要
 * 大于 `2 * (10 + 4) = 28` 就能在默认净空下确定不重叠——测试里大多取
 * ≥200 的间距，是为了让断言的意图（“这两个候选完全不相关”）一眼可辨，
 * 不是因为默认净空需要这么大的间距。
 */
const PROJECTOR: ViewportProjector = createTestProjector(100);

const FRONT_ORI = { x: [1, 0, 0] as Vec3, y: [0, 1, 0] as Vec3, z: [0, 0, 1] as Vec3 };
const BACK_ORI = { x: [1, 0, 0] as Vec3, y: [0, 1, 0] as Vec3, z: [0, 0, -1] as Vec3 };

const TEXT_SIZE = { widthM: 0.2, heightM: 0.1 };

function candidate(overrides: Partial<PolarCandidate> = {}): PolarCandidate {
  return {
    score: 0,
    dis: 0,
    angle: 0,
    radius: 0,
    dir: [1, 0, 0],
    disIndex: 0,
    radiusIndex: 0,
    haveLead: false,
    pos: [0, 0, 0],
    textOri: FRONT_ORI,
    source: 'solved',
    ...overrides,
  };
}

/** `result.candidates` 必须含 `best` 本身（`best === candidates[0]`，类型契约）。 */
function resultOf(candidates: readonly PolarCandidate[]) {
  return {
    best: candidates[0]!,
    candidates,
    perDisBest: [],
    diagnostics: {
      usedFallback: false,
      disRangeCount: 1,
      radiusBandCounts: [1],
      forcedMainDimDir: false,
    },
  };
}

/** 候选中心投影到像素的位置：`createTestProjector(100)` 的逆向换算，仅用于搭测试夹具。 */
function worldPosForScreenCenter(px: number, py: number, z = 0): Vec3 {
  return [(px - 200) / 100, (200 - py) / 100, z];
}

describe('screenGuard', () => {
  it('picks best when nothing occupies the screen', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(100, 100) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([best, second]);
    const occupancy = new LabelOccupancy();

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.chosen).toBe(best);
    expect(guard.chosenIndex).toBe(0);
    expect(guard.allRejected).toBe(false);
    expect(guard.rejected).toEqual([]);
  });

  it('degrades to the second candidate when the best one is occupied', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(100, 100) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([best, second]);
    const occupancy = new LabelOccupancy();
    // best 的文字框像素范围约 x∈[90,110], y∈[95,105]；下面这块矩形覆盖它，
    // 且离 second（中心 300,300）远到默认净空 4px 下也够不到。
    occupancy.insert({ x: 50, y: 50, width: 100, height: 100 });

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.chosen).toBe(second);
    expect(guard.chosenIndex).toBe(1);
    expect(guard.allRejected).toBe(false);
    expect(guard.rejected).toEqual([{ index: 0, reason: 'overlap' }]);
  });

  it('degrades past two occupied candidates to the third', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(50, 50) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(50, 350) });
    const third = candidate({ score: 2, disIndex: 2, radiusIndex: 0, angle: 180, pos: worldPosForScreenCenter(350, 50) });
    const result = resultOf([best, second, third]);
    const occupancy = new LabelOccupancy();
    // 一条贯穿左半屏的竖带，挡住 best（x≈50）与 second（x≈50），不挡 third（x≈350）。
    occupancy.insert({ x: 0, y: 0, width: 150, height: 400 });

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.chosen).toBe(third);
    expect(guard.chosenIndex).toBe(2);
    expect(guard.rejected).toEqual([
      { index: 0, reason: 'overlap' },
      { index: 1, reason: 'overlap' },
    ]);
  });

  it('falls back to best, deterministically, when every candidate is rejected', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(100, 100) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([best, second]);
    const occupancy = new LabelOccupancy();
    occupancy.insert({ x: 0, y: 0, width: 400, height: 400 }); // 整个视口

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.allRejected).toBe(true);
    expect(guard.chosen).toBe(best);
    expect(guard.chosenIndex).toBe(0);
    expect(guard.rejected).toEqual([
      { index: 0, reason: 'overlap' },
      { index: 1, reason: 'overlap' },
    ]);

    // 确定性：同一输入再跑一次，结果深相等。
    const again = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    expect(again).toEqual(guard);
  });

  it('marks a candidate projecting behind the camera as degenerate', () => {
    // `createTestProjector` 的 `depth` 直接回传世界 z；forward = [0,0,-1] 时
    // 相机前方是 z<0。z=+5 远超 `[-1,1]` 的可绘制深度窗口，判定为相机后/裁剪。
    const behind = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: [0, 0, 5] });
    const visible = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(200, 200) });
    const result = resultOf([behind, visible]);
    const occupancy = new LabelOccupancy();

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.chosen).toBe(visible);
    expect(guard.rejected).toEqual([{ index: 0, reason: 'degenerate' }]);
  });

  it('marks a candidate entirely outside the viewport as offscreen', () => {
    // 画布 400×400；中心落在 (5000, 5000) 的候选完全在视口外。
    const offscreen = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(5000, 5000) });
    const visible = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(200, 200) });
    const result = resultOf([offscreen, visible]);
    const occupancy = new LabelOccupancy();

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.chosen).toBe(visible);
    expect(guard.rejected).toEqual([{ index: 0, reason: 'offscreen' }]);
  });

  it('marks a candidate whose text plane normal points away from the camera as backfacing', () => {
    const backfacing = candidate({
      score: 0, disIndex: 0, radiusIndex: 0, angle: 0,
      pos: worldPosForScreenCenter(100, 100), textOri: BACK_ORI,
    });
    const visible = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([backfacing, visible]);
    const occupancy = new LabelOccupancy();

    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guard.chosen).toBe(visible);
    expect(guard.rejected).toEqual([{ index: 0, reason: 'backfacing' }]);
  });

  it('keeps previous when it is still unrejected, instead of jumping to best', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(100, 100) });
    const previous = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([best, previous]);
    const occupancy = new LabelOccupancy(); // 两个都不被占用

    const guard = screenGuard({
      result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy, previous,
    });

    expect(guard.chosen).toBe(previous);
    expect(guard.chosenIndex).toBe(1);
    expect(guard.allRejected).toBe(false);
  });

  it('falls through to the ranked order when previous is itself rejected', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(100, 100) });
    const previous = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([best, previous]);
    const occupancy = new LabelOccupancy();
    // 挡住 previous 所在的区域（中心 300,300 附近），不挡 best（中心 100,100）。
    occupancy.insert({ x: 250, y: 250, width: 100, height: 100 });

    const guard = screenGuard({
      result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy, previous,
    });

    expect(guard.chosen).toBe(best);
    expect(guard.chosenIndex).toBe(0);
  });

  it('a larger clearancePx rejects a candidate that would otherwise not overlap', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(200, 200) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 200) });
    const result = resultOf([best, second]);
    const occupancy = new LabelOccupancy();
    // best 的文字框像素范围约 x∈[190,210]；紧贴其右侧放一块占用，净空 0 时不重叠。
    occupancy.insert({ x: 211, y: 150, width: 50, height: 100 });

    const tight = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy, clearancePx: 0 });
    expect(tight.chosen).toBe(best);

    const loose = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy, clearancePx: 20 });
    expect(loose.chosen).toBe(second);
    expect(loose.rejected).toEqual([{ index: 0, reason: 'overlap' }]);
  });

  it('does not throw Map maximum size exceeded for a candidate projected to 1e7 px', () => {
    const far = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(1e7, 1e7) });
    const visible = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(200, 200) });
    const result = resultOf([far, visible]);
    // 带 viewport 裁剪的 occupancy，与生产用法一致（见 occupancy.ts 文件头的事故记录）。
    const occupancy = new LabelOccupancy({ x: 0, y: 0, width: PROJECTOR.widthCssPx, height: PROJECTOR.heightCssPx });

    expect(() => screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy })).not.toThrow();
    const guard = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    expect(guard.chosen).toBe(visible);
    expect(guard.rejected).toEqual([{ index: 0, reason: 'offscreen' }]);
  });

  it('is deterministic: two runs on the same input are deeply equal', () => {
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(100, 100) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(300, 300) });
    const result = resultOf([best, second]);
    const occupancy = new LabelOccupancy();
    occupancy.insert({ x: 50, y: 50, width: 100, height: 100 });

    const first = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    const again = screenGuard({ result, projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    expect(again).toEqual(first);
  });

  it('registerChosen claims the chosen quad so a subsequent guard call avoids it', () => {
    // best 的文字框像素范围约 x∈[190,210], y∈[195,205]；second 紧邻其右侧
    // （中心 215,200 → 范围约 x∈[205,225]），与 best 的净空扩张（+4px→[186,214]）
    // 重叠，必须被 registerChosen 登记的占用挡住。
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(200, 200) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(215, 200) });
    const occupancy = new LabelOccupancy();

    const first = screenGuard({ result: resultOf([best]), projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    expect(first.chosen).toBe(best);
    registerChosen(occupancy, first);

    const guardForSecond = screenGuard({
      result: resultOf([second]), projector: PROJECTOR, textSize: TEXT_SIZE, occupancy,
    });
    expect(guardForSecond.allRejected).toBe(true);
    expect(guardForSecond.chosen).toBe(second);
  });

  it('registerChosen inserts the chosen quad bounds unexpanded (no double clearance)', () => {
    // best 的文字框像素范围正好是 x∈[190,210], y∈[195,205]（中心 200,200，
    // 半宽 10、半高 5）。`registerChosen` 若仍错误地把 `clearancePx` 套在
    // 登记侧，登记的矩形会多扩出 `DEFAULT_CLEARANCE_PX` 像素；按规范只登记
    // 未外扩的原始包围盒，所以紧贴右边界外一点的矩形（从 x=210.1 起）不应
    // 命中占用，紧贴右边界内一点的矩形（到 x=210 为止，覆盖 189-190.5）应命中。
    const best = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(200, 200) });
    const occupancy = new LabelOccupancy();

    const first = screenGuard({ result: resultOf([best]), projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    registerChosen(occupancy, first);

    expect(occupancy.overlaps({ x: 210.1, y: 195, width: 1, height: 10 })).toBe(false);
    expect(occupancy.overlaps({ x: 189, y: 195, width: 1.5, height: 10 })).toBe(true);
  });

  it('two labels with 10 px of screen gap between their boxes do not reject each other', () => {
    // 文字框像素半宽 10、半高 5：中心 (200,200) 的 box 是 x∈[190,210]；
    // 中心 (230,200) 的 box 是 x∈[220,240]——两个框边界之间净空 10 px。
    // `screenGuard` 的查询侧净空默认 4px，`220 - 210 = 10 > 4`，不应重叠；
    // 旧实现把 `clearancePx` 在登记侧也扩一次（等价于两个标签间要求
    // `2×clearancePx`），默认 64px 时这组 10px 间距会被错误否决。
    const first = candidate({ score: 0, disIndex: 0, radiusIndex: 0, angle: 0, pos: worldPosForScreenCenter(200, 200) });
    const second = candidate({ score: 1, disIndex: 1, radiusIndex: 0, angle: 90, pos: worldPosForScreenCenter(230, 200) });
    const occupancy = new LabelOccupancy();

    const guardFirst = screenGuard({ result: resultOf([first]), projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });
    registerChosen(occupancy, guardFirst);

    const guardSecond = screenGuard({ result: resultOf([second]), projector: PROJECTOR, textSize: TEXT_SIZE, occupancy });

    expect(guardSecond.allRejected).toBe(false);
    expect(guardSecond.chosen).toBe(second);
    expect(guardSecond.rejected).toEqual([]);
  });

  it('integration: screens the real candidates polarPlace returns for an empty reference', () => {
    // `disRange` 收在 ±0.4m 内，让沿轴方向（世界 z，管轴 `[0,0,1]`）的候选落在
    // `createTestProjector` 的可绘制深度窗口 `[-1,1]` 内——该测试投影器的
    // `depth` 直接回传世界 z，`disRange` 大到 10m 时 `dis` 会落在相机“后方”，
    // 这是测试夹具的局限，不是 `screenGuard` 的行为。
    const reference: PolarReference = {
      origin: [0, 0, 0],
      axis: [0, 0, 1],
      plane: { zero: [0, 1, 0], normal: [0, 0, 1] },
      showDir: [0, 1, 0],
      horiDir: [0, 1, 0],
      up: [0, 0, 1],
      mainDimDir: null,
      disRange: [-0.4, 0.4],
      basicRadius: 0.1,
      isInstPipe: false,
      kind: 'iso-sheet',
    };
    const placed = polarPlace({
      reference,
      elements: [],
      needs: [0.1, 30, 0.05],
      isDim: false,
    });
    const occupancy = new LabelOccupancy();

    const guard = screenGuard({
      result: placed, projector: PROJECTOR, textSize: { widthM: 0.05, heightM: 0.02 }, occupancy,
    });

    // 无障碍、无占用：直接用 best，不应该被任何判据否决。
    expect(guard.chosen).toBe(placed.best);
    expect(guard.allRejected).toBe(false);
    expect(guard.rejected).toEqual([]);
  });
});
