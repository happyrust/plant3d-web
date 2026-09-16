import { describe, expect, it } from 'vitest';

import {
  buildStraightRuns,
  describeStraightRun,
  findParallelRunPairs,
  type BranCenterlineInput,
} from './branParallelSpacing';

import type { SpatialCenterlineSegment } from '@/api/genModelV1Api';

type P = [number, number, number];

function seg(
  refno: string,
  order: number,
  start: P,
  end: P,
  extra: Partial<Pick<SpatialCenterlineSegment, 'noun' | 'implicit' | 'outside_diameter_mm'>> = {},
): SpatialCenterlineSegment {
  const implicit = extra.implicit ?? refno.includes('~');
  return {
    refno,
    order,
    noun: extra.noun ?? (implicit ? 'TUBI' : 'UNKNOWN'),
    implicit,
    start: { x: start[0], y: start[1], z: start[2] },
    end: { x: end[0], y: end[1], z: end[2] },
    length_mm: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
    outside_diameter_mm: extra.outside_diameter_mm ?? null,
  };
}

function centerline(refno: string, segments: SpatialCenterlineSegment[], od: number | null = 114.3): BranCenterlineInput {
  return { refno, outside_diameter_mm: od, segments };
}

/** 一条 L 形 BRAN：沿 x 直跑 2000（隐式管身 + 同轴阀），90° 弯头，再沿 y 直跑 1000。 */
function lShapedBran(refno: string, y = 0, z = 0): BranCenterlineInput {
  return centerline(refno, [
    seg(`${refno}_1~${refno}_2`, 0, [0, y, z], [800, y, z]),
    seg(`${refno}_2`, 1, [800, y, z], [1000, y, z], { noun: 'VALV', outside_diameter_mm: 168.3 }),
    seg(`${refno}_2~${refno}_3`, 2, [1000, y, z], [2000, y, z]),
    seg(`${refno}_3`, 3, [2000, y, z], [2100, y + 100, z], { noun: 'ELBO' }),
    seg(`${refno}_3~${refno}_4`, 4, [2100, y + 100, z], [2100, y + 1100, z]),
  ]);
}

describe('buildStraightRuns：连续共线的段合成直段', () => {
  it('隐式管身 + 同轴阀合成一条直段；弯头断链且不成直段；弯头后的一截另成一条', () => {
    const runs = buildStraightRuns(lShapedBran('1'));
    expect(runs).toHaveLength(2);
    const [first, second] = runs;
    expect(first!.segments.map((s) => s.refno)).toEqual(['1_1~1_2', '1_2', '1_2~1_3']);
    expect(first!.start).toEqual({ x: 0, y: 0, z: 0 });
    expect(first!.end).toEqual({ x: 2000, y: 0, z: 0 });
    expect(first!.lengthMm).toBeCloseTo(2000, 9);
    expect(first!.direction).toEqual({ x: 1, y: 0, z: 0 });
    // 直段外径取段上首个成员外径（阀 168.3），不是 BRAN 顶层的 114.3
    expect(first!.outsideDiameterMm).toBe(168.3);
    expect(second!.segments.map((s) => s.refno)).toEqual(['1_3~1_4']);
    expect(second!.direction).toEqual({ x: 0, y: 1, z: 0 });
    // 只有隐式管身的直段用 BRAN 顶层外径
    expect(second!.outsideDiameterMm).toBe(114.3);
    expect(describeStraightRun(first!)).toBe('1_1~1_2（3 段）');
    expect(describeStraightRun(second!)).toBe('1_3~1_4');
  });

  it('横向偏差超过容差就另起一条；写反的到达 / 离开点不把直段量短；零长与非有限端点的段跳过', () => {
    const runs = buildStraightRuns(centerline('2', [
      seg('2_1~2_2', 0, [0, 0, 0], [500, 0, 0]),
      // 写反了（离开→到达），仍共线：并入并把直段延到 1000
      seg('2_2', 1, [1000, 0, 0], [500, 0, 0], { noun: 'FLAN' }),
      // 零长：跳过、不断链
      seg('2_9', 2, [1000, 0, 0], [1000, 0, 0], { noun: 'WELD' }),
      seg('2_2~2_3', 3, [1000, 0, 0], [1500, 0, 0]),
      // 偏出 5mm（> 1mm 容差）：另起
      seg('2_3~2_4', 4, [1500, 5, 0], [2500, 5, 0]),
      // 端点非有限：跳过
      seg('2_4~2_5', 5, [2500, 5, 0], [Number.NaN, 5, 0]),
    ]));
    expect(runs.map((run) => run.segments.map((s) => s.refno))).toEqual([
      ['2_1~2_2', '2_2', '2_2~2_3'],
      ['2_3~2_4'],
    ]);
    expect(runs[0]!.lengthMm).toBeCloseTo(1500, 9);
    expect(runs[0]!.end).toEqual({ x: 1500, y: 0, z: 0 });
    expect(runs[1]!.start).toEqual({ x: 1500, y: 5, z: 0 });
  });

  it('段按 order 重排后再扫；没有一段成直段（全是弯头）返回空', () => {
    const shuffled = centerline('3', [
      seg('3_2~3_3', 1, [100, 0, 0], [200, 0, 0]),
      seg('3_1~3_2', 0, [0, 0, 0], [100, 0, 0]),
    ]);
    expect(buildStraightRuns(shuffled)[0]!.segments.map((s) => s.order)).toEqual([0, 1]);
    expect(buildStraightRuns(centerline('4', [seg('4_1', 0, [0, 0, 0], [10, 10, 0], { noun: 'BEND' })]))).toEqual([]);
    // 顶层外径也没有 → null
    expect(buildStraightRuns(centerline('5', [seg('5_1~5_2', 0, [0, 0, 0], [10, 0, 0])], null))[0]!.outsideDiameterMm).toBeNull();
  });
});

describe('findParallelRunPairs：两条 BRAN 的直段配平行对', () => {
  it('并排的两截各成一对：中心距是轴线垂距、落在重叠区中点、两端都在轴线上；净距扣两侧半径；不并排的不配', () => {
    // 第二条 BRAN 与第一条同形、整体抬高 600（z）：x 向两截并排（重叠 [0,2000]），y 向两截也并排（重叠 [100,1100]），
    // 两对的中心距都是 600；x 向那一对只挑一条 BRAN 的 x 向直段（y 向直段与它垂直，配不上）。
    const a = buildStraightRuns(lShapedBran('1'));
    const b = buildStraightRuns(lShapedBran('9', 0, 600));
    const pairs = findParallelRunPairs(a, b);
    expect(pairs).toHaveLength(2);

    const [alongX, alongY] = pairs;
    expect(alongX!.angleDeg).toBeCloseTo(0, 9);
    expect(alongX!.overlapStartMm).toBeCloseTo(0, 9);
    expect(alongX!.overlapEndMm).toBeCloseTo(2000, 9);
    expect(alongX!.overlapMm).toBeCloseTo(2000, 9);
    expect(alongX!.axisDistanceMm).toBeCloseTo(600, 9);
    expect(alongX!.sourcePointMm).toEqual({ x: 1000, y: 0, z: 0 });
    expect(alongX!.targetPointMm).toEqual({ x: 1000, y: 0, z: 600 });
    // 两侧直段外径都是 168.3（阀）→ 净距 600 − 168.3
    expect(alongX!.clearanceMm).toBeCloseTo(600 - 168.3, 9);

    expect(alongY!.source.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(alongY!.axisDistanceMm).toBeCloseTo(600, 9);
    // 两条 y 向直段都是 y∈[100,1100]：重叠 1000，中点 y=600
    expect(alongY!.overlapMm).toBeCloseTo(1000, 9);
    expect(alongY!.sourcePointMm.x).toBeCloseTo(2100, 9);
    expect(alongY!.sourcePointMm.y).toBeCloseTo(600, 9);
    expect(alongY!.sourcePointMm.z).toBeCloseTo(0, 9);
    expect(alongY!.targetPointMm.x).toBeCloseTo(2100, 9);
    expect(alongY!.targetPointMm.y).toBeCloseTo(600, 9);
    expect(alongY!.targetPointMm.z).toBeCloseTo(600, 9);
    // 两条 y 向直段都只有隐式管身 → 用 BRAN 顶层外径 114.3
    expect(alongY!.clearanceMm).toBeCloseTo(600 - 114.3, 9);
  });

  it('同一条 BRAN 平移到与自己共线的位置：共线段中心距 0、重叠只取真正并排的那一截', () => {
    // 沿 y 平移 600：x 向两截并排（中心距 600）；y 向两截共线（x=2100，z=0），源 y∈[100,1100]、目标 y∈[700,1700]，重叠 [700,1100]
    const pairs = findParallelRunPairs(buildStraightRuns(lShapedBran('1')), buildStraightRuns(lShapedBran('9', 600)));
    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.axisDistanceMm).toBeCloseTo(600, 9);
    expect(pairs[1]!.axisDistanceMm).toBeCloseTo(0, 9);
    expect(pairs[1]!.overlapMm).toBeCloseTo(400, 9);
    expect(pairs[1]!.sourcePointMm.y).toBeCloseTo(900, 9);
  });

  it('反向平行也算平行；夹角超容差、或投影区间不重叠（前后错开）都不配', () => {
    const source = buildStraightRuns(centerline('1', [seg('1_1~1_2', 0, [0, 0, 0], [1000, 0, 0])]));
    const reversed = buildStraightRuns(centerline('2', [seg('2_1~2_2', 0, [900, 300, 0], [-100, 300, 0])]));
    const reversedPairs = findParallelRunPairs(source, reversed);
    expect(reversedPairs).toHaveLength(1);
    expect(reversedPairs[0]!.axisDistanceMm).toBeCloseTo(300, 9);
    expect(reversedPairs[0]!.overlapMm).toBeCloseTo(900, 9);

    // 斜 2°：不平行
    const skew = buildStraightRuns(centerline('3', [seg('3_1~3_2', 0, [0, 300, 0], [1000, 300 + 1000 * Math.tan((2 * Math.PI) / 180), 0])]));
    expect(findParallelRunPairs(source, skew)).toEqual([]);
    // 放宽容差到 3° 就配上
    expect(findParallelRunPairs(source, skew, { angleToleranceDeg: 3 })).toHaveLength(1);

    // 同轴平行但错开在前方（x∈[1500,2500]）：不并排
    const ahead = buildStraightRuns(centerline('4', [seg('4_1~4_2', 0, [1500, 300, 0], [2500, 300, 0])]));
    expect(findParallelRunPairs(source, ahead)).toEqual([]);
    // 只重叠 0.5mm：低于缺省 1mm
    const grazing = buildStraightRuns(centerline('5', [seg('5_1~5_2', 0, [999.5, 300, 0], [2000, 300, 0])]));
    expect(findParallelRunPairs(source, grazing)).toEqual([]);
    expect(findParallelRunPairs(source, grazing, { minOverlapMm: 0.1 })).toHaveLength(1);
  });

  it('任一侧外径未知时净距为 null；共线重合的两条中心距 0', () => {
    const source = buildStraightRuns(centerline('1', [seg('1_1~1_2', 0, [0, 0, 0], [1000, 0, 0])], null));
    const target = buildStraightRuns(centerline('2', [seg('2_1~2_2', 0, [0, 0, 0], [1000, 0, 0])]));
    const [pair] = findParallelRunPairs(source, target);
    expect(pair!.axisDistanceMm).toBe(0);
    expect(pair!.clearanceMm).toBeNull();
    expect(pair!.sourcePointMm).toEqual(pair!.targetPointMm);
  });
});
