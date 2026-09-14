import { describe, expect, it } from 'vitest';

import {
  ALL_CLOUD_DIRTY,
  computeCloudDirty,
  createArrayVersionTracker,
  createValueVersionTracker,
  isAnyCloudDirty,
  type CloudRenderStamp,
} from './dirty';

const base: CloudRenderStamp = {
  cameraWorld: 1,
  projection: 1,
  viewportCss: 1,
  overlayTransform: 1,
  dpr: 1,
  globalModelMatrix: 1,
  modelEpoch: 1,
  targetBounds: 1,
  bindings: 1,
  effectiveRegion: 1,
  shapeStyle: 1,
  paintStyle: 1,
  labelMetrics: 1,
  labelPreference: 1,
  presentation: 1,
};

describe('computeCloudDirty', () => {
  it('首帧全脏；戳完全相同时全干净', () => {
    expect(computeCloudDirty(null, base)).toEqual(ALL_CLOUD_DIRTY);
    const clean = computeCloudDirty(base, { ...base });
    expect(isAnyCloudDirty(clean)).toBe(false);
  });

  it('只改颜色 / 透明度：只有 paint 脏，几何与文字框都不重建', () => {
    const flags = computeCloudDirty(base, { ...base, paintStyle: 2 });
    expect(flags).toEqual({ resolve: false, project: false, shape: false, label: false, paint: true });
  });

  it('相机动了：project → shape → label 级联，paint 不动', () => {
    const flags = computeCloudDirty(base, { ...base, cameraWorld: 2 });
    expect(flags).toEqual({ resolve: false, project: true, shape: true, label: true, paint: false });
  });

  it('全局模型矩阵（单位 / 重心）变化也算投影输入（§15 ④）', () => {
    expect(computeCloudDirty(base, { ...base, globalModelMatrix: 2 }).project).toBe(true);
  });

  it('只改文字尺寸或标签意图：只有 label 脏', () => {
    expect(computeCloudDirty(base, { ...base, labelMetrics: 2 })).toEqual({ resolve: false, project: false, shape: false, label: true, paint: false });
    expect(computeCloudDirty(base, { ...base, labelPreference: 2 }).shape).toBe(false);
  });

  it('模型 epoch / 目标包围盒 / bindings 变化：resolve 脏；目标包围盒本身不直接算 project（有效范围变化才推进 effectiveRegion）', () => {
    const flags = computeCloudDirty(base, { ...base, modelEpoch: 2 });
    expect(flags.resolve).toBe(true);
    expect(flags.project).toBe(false);
    expect(computeCloudDirty(base, { ...base, effectiveRegion: 2 }).shape).toBe(true);
  });

  it('DPR 变化只影响 paint（材质 resolution），不重建几何', () => {
    expect(computeCloudDirty(base, { ...base, dpr: 2 })).toEqual({ resolve: false, project: false, shape: false, label: false, paint: true });
  });
});

describe('version trackers', () => {
  it('数组版本：值逐元素相同不推进，任一元素变了 +1，长度变了 +1', () => {
    const tracker = createArrayVersionTracker();
    expect(tracker.version).toBe(0);
    expect(tracker.update([1, 2, 3])).toBe(1);
    expect(tracker.update([1, 2, 3])).toBe(1);
    expect(tracker.update(new Float64Array([1, 2, 3]))).toBe(1);
    expect(tracker.update([1, 2, 4])).toBe(2);
    expect(tracker.update([1, 2])).toBe(3);
    expect(tracker.update([])).toBe(4);
    expect(tracker.update([])).toBe(4);
  });

  it('值版本：引用 / 原始值相等不推进', () => {
    const tracker = createValueVersionTracker<object | string>();
    const a = {};
    expect(tracker.update(a)).toBe(1);
    expect(tracker.update(a)).toBe(1);
    expect(tracker.update({})).toBe(2);
    expect(tracker.update('x')).toBe(3);
    expect(tracker.update('x')).toBe(3);
  });
});
