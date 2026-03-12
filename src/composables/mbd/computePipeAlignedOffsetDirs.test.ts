import { describe, it, expect } from 'vitest';

import { Vector3 } from 'three';

import { computePipeAlignedOffsetDirs, findSegmentOffsetDir } from './computePipeAlignedOffsetDirs';

import type { MbdPipeSegmentDto } from '@/api/mbdPipeApi';

/** 快速构建管段 */
function seg(id: string, arrive: [number, number, number], leave: [number, number, number]): MbdPipeSegmentDto {
  return {
    id, refno: id, noun: 'STRA',
    arrive, leave,
    length: new Vector3(...arrive).distanceTo(new Vector3(...leave)),
    straight_length: new Vector3(...arrive).distanceTo(new Vector3(...leave)),
  };
}

describe('computePipeAlignedOffsetDirs', () => {
  it('空 segments 返回空数组', () => {
    expect(computePipeAlignedOffsetDirs([])).toEqual([]);
  });

  it('单段水平管道 → 重力对齐（向上偏移）', () => {
    const segments = [seg('s1', [0, 0, 0], [1000, 0, 0])];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(1);
    // 水平管段 dir=(1,0,0), worldUp=(0,1,0), offsetDir = up × dir = (0,0,-1)
    expect(Math.abs(dirs[0]!.z)).toBeCloseTo(1, 3);
    expect(Math.abs(dirs[0]!.x)).toBeCloseTo(0, 3);
    expect(Math.abs(dirs[0]!.y)).toBeCloseTo(0, 3);
  });

  it('单段竖直管道 → 主轴垂直', () => {
    const segments = [seg('s1', [0, 0, 0], [0, 1000, 0])];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(1);
    // 竖直管段 dir=(0,1,0), |dir.y|=1 > 0.5, 走主轴垂直
    // leastAlignedAxis: ax=0, ay=1, az=0 → axis=(1,0,0), cross=(1,0,0)×(0,1,0)=(0,0,1)
    const d = dirs[0]!;
    expect(d.length()).toBeCloseTo(1, 5);
    // 应该在 XZ 平面内
    expect(Math.abs(d.y)).toBeCloseTo(0, 3);
  });

  it('L 形管道（XY 平面 90° 弯头）→ offsetDir 在 Z 方向', () => {
    const segments = [
      seg('s1', [0, 0, 0], [1000, 0, 0]),
      seg('s2', [1000, 0, 0], [1000, 800, 0]),
    ];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(2);

    // 弯头法线 = dir1 × dir2 = (1,0,0) × (0,1,0) = (0,0,1)
    // seg1: offsetDir = bendNormal × dir1 = (0,0,1) × (1,0,0) = (0,1,0)
    // seg2: offsetDir = bendNormal × dir2 = (0,0,1) × (0,1,0) = (-1,0,0)
    for (const d of dirs) {
      expect(d.length()).toBeCloseTo(1, 5);
      // 两个 offsetDir 都在 XY 平面内（Z=0），因为弯头法线是 Z
      expect(Math.abs(d.z)).toBeCloseTo(0, 3);
    }
  });

  it('L 形管道（XZ 平面 90° 弯头）→ offsetDir 在 Y 方向', () => {
    const segments = [
      seg('s1', [0, 0, 0], [1000, 0, 0]),
      seg('s2', [1000, 0, 0], [1000, 0, 800]),
    ];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(2);

    // 弯头法线 = (1,0,0) × (0,0,1) = (0,-1,0)
    // offsetDir 都应该在 XZ 平面内或 Y 方向
    for (const d of dirs) {
      expect(d.length()).toBeCloseTo(1, 5);
    }
  });

  it('三段 L 形管道 → 一致性修正不翻面', () => {
    const segments = [
      seg('s1', [0, 0, 0], [1000, 0, 0]),
      seg('s2', [1000, 0, 0], [1000, 800, 0]),
      seg('s3', [1000, 800, 0], [2200, 800, 0]),
    ];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(3);

    // 一致性：相邻管段的 offsetDir 点积应 >= 0（不翻面）
    for (let i = 1; i < dirs.length; i++) {
      expect(dirs[i - 1]!.dot(dirs[i]!)).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it('直线管道（共线，无弯头）→ 不退化', () => {
    const segments = [
      seg('s1', [0, 0, 0], [1000, 0, 0]),
      seg('s2', [1000, 0, 0], [2000, 0, 0]),
    ];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(2);
    for (const d of dirs) {
      expect(d.length()).toBeCloseTo(1, 5);
    }
  });

  it('跳过 arrive/leave 为 null 的管段', () => {
    const segments: MbdPipeSegmentDto[] = [
      { id: 's1', refno: 'S:1', noun: 'ELBO', length: 0, straight_length: 0 },
      seg('s2', [0, 0, 0], [1000, 0, 0]),
    ];
    const dirs = computePipeAlignedOffsetDirs(segments);
    expect(dirs).toHaveLength(2);
    // s1 无效，保留默认值；s2 有效
    expect(dirs[1]!.length()).toBeCloseTo(1, 5);
  });
});

describe('findSegmentOffsetDir', () => {
  const segments = [
    seg('s1', [0, 0, 0], [1000, 0, 0]),
    seg('s2', [1000, 0, 0], [1000, 800, 0]),
    seg('s3', [1000, 800, 0], [2200, 800, 0]),
  ];
  const precomputed = computePipeAlignedOffsetDirs(segments);

  it('精确匹配 segment dim', () => {
    const dir = findSegmentOffsetDir(segments, [0, 0, 0], [1000, 0, 0], precomputed);
    expect(dir).not.toBeNull();
    expect(dir!.length()).toBeCloseTo(1, 5);
  });

  it('精确匹配第二段', () => {
    const dir = findSegmentOffsetDir(segments, [1000, 0, 0], [1000, 800, 0], precomputed);
    expect(dir).not.toBeNull();
  });

  it('包含匹配 overall dim（start 在 seg1 arrive）', () => {
    const dir = findSegmentOffsetDir(segments, [0, 0, 0], [2200, 800, 0], precomputed);
    expect(dir).not.toBeNull();
  });

  it('无匹配返回 null', () => {
    const dir = findSegmentOffsetDir(segments, [999, 999, 999], [888, 888, 888], precomputed);
    expect(dir).toBeNull();
  });
});
