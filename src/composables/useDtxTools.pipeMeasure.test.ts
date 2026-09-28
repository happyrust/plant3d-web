import { describe, expect, it } from 'vitest';

import {
  choosePipeMeasureBetterSeed,
  collectOrderedPipeReferencePointSeeds,
} from './useDtxTools';

describe('useDtxTools pipe measure helpers', () => {
  it('参考点顺序应为 arrive/leave -> refnoPosition -> aabbCenter', () => {
    const points = collectOrderedPipeReferencePointSeeds({
      sourceRefno: '24381_1001',
      segments: [
        { refno: '24381_9999', arrive: [1, 1, 1], leave: [2, 2, 2] },
        { refno: '24381/1001', arrive: [10, 11, 12], leave: [13, 14, 15] },
      ],
      refnoPosition: [20, 21, 22],
      aabbCenter: [30, 31, 32],
    });

    expect(points).toEqual([
      [10, 11, 12],
      [13, 14, 15],
      [20, 21, 22],
      [30, 31, 32],
    ]);
  });

  it('应去重并忽略非法点', () => {
    const points = collectOrderedPipeReferencePointSeeds({
      sourceRefno: '24381_1001',
      segments: [
        { refno: '24381_1001', arrive: [10, 11, 12], leave: [10, 11, 12] },
      ],
      refnoPosition: [10, 11, 12],
      aabbCenter: [40, 41, 42],
    });

    expect(points).toEqual([
      [10, 11, 12],
      [40, 41, 42],
    ]);
  });

  it('MBD 缺失时应退化为 refnoPosition + aabbCenter', () => {
    const points = collectOrderedPipeReferencePointSeeds({
      sourceRefno: '24381_1001',
      segments: [],
      refnoPosition: [20, 21, 22],
      aabbCenter: [30, 31, 32],
    });

    expect(points).toEqual([
      [20, 21, 22],
      [30, 31, 32],
    ]);
  });

  it('阶段B结果只在更短时替换阶段A', () => {
    const stageA = {
      distance: 2.5,
      sourcePoint: [0, 0, 0] as [number, number, number],
      targetPoint: [2.5, 0, 0] as [number, number, number],
    };
    const stageBBetter = {
      distance: 1.8,
      sourcePoint: [0, 0, 0] as [number, number, number],
      targetPoint: [1.8, 0, 0] as [number, number, number],
    };
    const stageBWorse = {
      distance: 3.2,
      sourcePoint: [0, 0, 0] as [number, number, number],
      targetPoint: [3.2, 0, 0] as [number, number, number],
    };

    expect(choosePipeMeasureBetterSeed(stageA, stageBBetter)).toBe(stageBBetter);
    expect(choosePipeMeasureBetterSeed(stageA, stageBWorse)).toBe(stageA);
  });
});
