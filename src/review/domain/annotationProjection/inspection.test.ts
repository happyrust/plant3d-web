import { describe, expect, it } from 'vitest';

import { BoxGeometry, Matrix4, Vector3 } from 'three';

import { chooseInspectionProbeMembers, inspectionFactor, inspectionModeFromSearch } from './inspection';

import type { RegionV1 } from '@/review/domain/cloudRegion';

import { isWorldSegmentBlocked } from '@/dimension';
import { DTXLayer } from '@/utils/three/dtx';

const IDENTITY = new Matrix4().elements.slice();

function region(boxes: { refno: string | null; center: [number, number, number] }[], origin: RegionV1['origin'] = 'members'): RegionV1 {
  return {
    version: 1,
    space: 'world',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: IDENTITY, coordinateFrameId: null },
    origin,
    kind: 'obb-union',
    boxes: boxes.map((b, i) => ({ id: `b${i}`, memberRefno: b.refno, center: b.center, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [1, 1, 1] })),
  };
}

describe('inspectionFactor', () => {
  it('置顶模式一律 1，与探测结果无关', () => {
    expect(inspectionFactor('always-on-top', ['blocked', 'blocked'], false, false, 0.35)).toBe(1);
  });
  it('检视模式：全部 blocked 才淡到 occludedAlpha；有 clear / unknown 或没有样本保持 1', () => {
    expect(inspectionFactor('inspection', ['blocked', 'blocked'], false, false, 0.35)).toBe(0.35);
    expect(inspectionFactor('inspection', ['blocked', 'clear'], false, false, 0.35)).toBe(1);
    expect(inspectionFactor('inspection', ['blocked', 'unknown'], false, false, 0.35)).toBe(1);
    expect(inspectionFactor('inspection', [], false, false, 0.35)).toBe(1);
  });
  it('强调（激活 / 悬停 / 拖动）与快照失效（STALE / missing）保持 1；非法 α 回 1、越界夹紧', () => {
    expect(inspectionFactor('inspection', ['blocked'], true, false, 0.35)).toBe(1);
    expect(inspectionFactor('inspection', ['blocked'], false, true, 0.35)).toBe(1);
    expect(inspectionFactor('inspection', ['blocked'], false, false, Number.NaN)).toBe(1);
    expect(inspectionFactor('inspection', ['blocked'], false, false, 2)).toBe(1);
    expect(inspectionFactor('inspection', ['blocked'], false, false, -1)).toBe(0);
  });
});

describe('chooseInspectionProbeMembers', () => {
  it('members 范围体：每个成员 refno 取第一个盒中心，按 refno 排序后均匀挑 ≤ max（首 / 中 / 尾）', () => {
    const r = region([
      { refno: 'r5', center: [5, 0, 0] },
      { refno: 'r1', center: [1, 0, 0] },
      { refno: 'r1', center: [1.5, 0, 0] }, // 同一成员的第二个盒：忽略
      { refno: 'r3', center: [3, 0, 0] },
      { refno: 'r2', center: [2, 0, 0] },
      { refno: 'r4', center: [4, 0, 0] },
      { refno: null, center: [9, 9, 9] }, // 没有成员身份的盒不作样本
    ]);
    expect(chooseInspectionProbeMembers(r, ['r1', 'r2', 'r3', 'r4', 'r5'], null, 3)).toEqual([
      { refno: 'r1', point: [1, 0, 0] },
      { refno: 'r3', point: [3, 0, 0] },
      { refno: 'r5', point: [5, 0, 0] },
    ]);
    expect(chooseInspectionProbeMembers(r, [], null, 10)).toHaveLength(5);
    expect(chooseInspectionProbeMembers(r, [], null, 1)).toEqual([{ refno: 'r1', point: [1, 0, 0] }]);
  });

  it('legacy-snapshot 范围体不算成员证据：退回 fallbackPoint × 前 ≤ max 个成员；两者都没有 → 空', () => {
    const legacy = region([{ refno: null, center: [0, 0, 0] }], 'legacy-snapshot');
    expect(chooseInspectionProbeMembers(legacy, ['b', 'a', 'a', ''], [7, 8, 9], 3)).toEqual([
      { refno: 'a', point: [7, 8, 9] },
      { refno: 'b', point: [7, 8, 9] },
    ]);
    expect(chooseInspectionProbeMembers(legacy, ['a'], null)).toEqual([]);
    expect(chooseInspectionProbeMembers(undefined, [], [0, 0, 0])).toEqual([]);
  });
});

describe('inspectionModeFromSearch', () => {
  it('与尺寸面板同一口径：mbd_mode=inspection 才是检视，其它一律置顶', () => {
    expect(inspectionModeFromSearch('?mbd_mode=inspection')).toBe('inspection');
    expect(inspectionModeFromSearch('?a=1&mbd_mode=inspection&b=2')).toBe('inspection');
    expect(inspectionModeFromSearch('?mbd_mode=engineering')).toBe('always-on-top');
    expect(inspectionModeFromSearch('')).toBe('always-on-top');
    expect(inspectionModeFromSearch(null)).toBe('always-on-top');
  });
});

describe('isWorldSegmentBlocked（ADR-0061 缝的世界坐标内核，云线复用）', () => {
  function layerWith(objects: { id: string; at: [number, number, number]; size?: number }[]): DTXLayer {
    const layer = new DTXLayer({ maxVertices: 8192, maxIndices: 8192, maxObjects: 16 });
    layer.addGeometry('unit', new BoxGeometry(1, 1, 1));
    layer.addGeometry('big', new BoxGeometry(4, 4, 1));
    for (const o of objects) layer.addObject(o.id, o.size === 4 ? 'big' : 'unit', new Matrix4().makeTranslation(...o.at));
    return layer;
  }

  it('相机 → 目标表面之间有别的可见对象 = blocked；只有目标自己（subject 排除）= clear；对象挪开 = clear', () => {
    const layer = layerWith([
      { id: 'o:T:0', at: [0, 0, 0] },
      { id: 'o:B:0', at: [0, 0, 10], size: 4 },
    ]);
    const camera = new Vector3(0, 0, 20);
    const targetSurface = new Vector3(0, 0, 0.5);
    expect(isWorldSegmentBlocked(layer, camera, targetSurface, 0.01, { subject: 'T' })).toBe(true);
    // 挡板就是 subject 自己的另一片：不算遮挡
    expect(isWorldSegmentBlocked(layer, camera, targetSurface, 0.01, { subject: 'B' })).toBe(false);

    const clear = layerWith([{ id: 'o:T:0', at: [0, 0, 0] }, { id: 'o:B:0', at: [10, 0, 10], size: 4 }]);
    expect(isWorldSegmentBlocked(clear, camera, targetSurface, 0.01, { subject: 'T' })).toBe(false);
  });

  it('命中落在容差之内（目标自己的表面）不算遮挡；零长 / 容差吞掉全长 → false', () => {
    const layer = layerWith([{ id: 'o:T:0', at: [0, 0, 0] }]);
    const camera = new Vector3(0, 0, 20);
    // 不给 subject：目标自己的前脸在 z=0.5，目标点也在 0.5 → 命中距离 = reach + tolerance，不算
    expect(isWorldSegmentBlocked(layer, camera, new Vector3(0, 0, 0.5), 0.01)).toBe(false);
    // 目标点在盒内部（z=0）、不给 subject：前脸 0.5 比目标近 0.5 > 容差 → 被自己挡住（这就是为什么云线要带 subject）
    expect(isWorldSegmentBlocked(layer, camera, new Vector3(0, 0, 0), 0.01)).toBe(true);
    expect(isWorldSegmentBlocked(layer, camera, new Vector3(0, 0, 0), 0.01, { subject: 'T' })).toBe(false);
    expect(isWorldSegmentBlocked(layer, camera, camera.clone(), 0.01)).toBe(false);
    expect(isWorldSegmentBlocked(layer, camera, new Vector3(0, 0, 0.5), 100)).toBe(false);
  });
});
