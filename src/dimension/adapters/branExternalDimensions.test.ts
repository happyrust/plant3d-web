import { describe, expect, it } from 'vitest';

import { branClearanceTargetRefno, branClearanceToExternalDimensions } from './branExternalDimensions';

import type { Vec3 } from '../domain/types';

const mmToM = (point: Vec3): Vec3 => [point[0] * 0.001, point[1] * 0.001, point[2] * 0.001];

describe('branClearanceToExternalDimensions', () => {
  it('maps valid backend points to one measurement-style linear dimension per candidate', () => {
    const result = branClearanceToExternalDimensions([
      {
        targetGroup: 'wall',
        index: 0,
        candidate: {
          refno: '24381_145018',
          noun: 'WALL',
          distance_mm: 1200,
          annotation: {
            start_point: { x: 1000, y: 2000, z: 3000 },
            end_point: { x: 2200, y: 2000, z: 3000 },
            label_mm: 1200,
          },
        },
      },
    ], point => mmToM(point));

    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: 'bran-clearance:wall:24381_145018',
      source: 'bran-clearance',
      role: 'approximate',
      layout: {
        kind: 'linear',
        role: 'approximate',
        textHalo: true,
        authoritativeText: 'wall ≈1200mm',
        a: [1, 2, 3],
        b: [2.2, 2, 3],
        placement: { offsetM: 0.5, labelT: 0.5, side: 1 },
      },
    });
  });

  it('marks a sampled (interactive pipe-to-structure) estimate as approximate in both the dimension text and the source label', () => {
    const result = branClearanceToExternalDimensions([
      {
        targetGroup: 'WALL',
        index: 2,
        provenance: { method: 'sampled-object', accuracyClass: 'approximate-sampled' },
        candidate: {
          refno: '24381_900',
          noun: 'WALL',
          distance_mm: 600.4,
          annotation: {
            start_point: { x: 1000, y: 2000, z: 3000 },
            end_point: { x: 1000, y: 2000, z: 3600 },
            label_mm: 600.4,
          },
        },
      },
    ], point => mmToM(point));

    expect(result.records[0]).toMatchObject({
      id: 'bran-clearance:wall:24381_900',
      sourceLabel: 'WALL: 24381_900（估算）',
      layout: { authoritativeText: 'WALL ≈600mm' },
    });
  });

  it('keeps a parallel-run axis spacing exact (no ≈), names the metric in the source label, and keeps ids apart for two pairs on the same target BRAN', () => {
    const candidate = (variant: string, labelMm: number) => ({
      refno: '24381_144924',
      noun: 'BRAN',
      distance_mm: labelMm,
      variant,
      annotation: {
        start_point: { x: 1000, y: 0, z: 0 },
        end_point: { x: 1000, y: labelMm, z: 0 },
        label_mm: labelMm,
      },
    });
    const result = branClearanceToExternalDimensions([
      { targetGroup: 'BRAN', index: 0, provenance: { method: 'parallel-centerline', accuracyClass: 'exact-centerline' }, candidate: candidate('parallel:a~b:0', 1583.7) },
      { targetGroup: 'BRAN', index: 1, provenance: { method: 'parallel-centerline', accuracyClass: 'exact-centerline' }, candidate: candidate('parallel:a~b:1', 1919.7) },
    ], point => mmToM(point));

    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records.map(record => [record.id, record.sourceLabel, (record.layout as { authoritativeText: string }).authoritativeText])).toEqual([
      ['bran-clearance:bran:24381_144924:parallel_a_b_0', 'BRAN: 24381_144924（平行直段中心距）', 'BRAN 1584mm'],
      ['bran-clearance:bran:24381_144924:parallel_a_b_1', 'BRAN: 24381_144924（平行直段中心距）', 'BRAN 1920mm'],
    ]);
    // 同屏多条候选的标签按序号交错 side/offsetM，不压字
    expect(result.records.map(record => (record.layout as { placement: { side: number } }).placement.side)).toEqual([1, -1]);
  });

  it('精算后重排数组下标不影响 external 尺寸 ID 稳定性', () => {
    const item = {
      targetGroup: 'WALL',
      candidate: {
        refno: '24381_44322',
        noun: 'WALL',
        distance_mm: 12725,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 12725, z: 0 }, label_mm: 12725 },
      },
    };
    const beforeSort = branClearanceToExternalDimensions([{ ...item, index: 0 }], point => mmToM(point));
    const afterSort = branClearanceToExternalDimensions([{ ...item, index: 2 }], point => mmToM(point));
    expect(beforeSort.records[0]?.id).toBe('bran-clearance:wall:24381_44322');
    expect(afterSort.records[0]?.id).toBe(beforeSort.records[0]?.id);
  });

  it('marks refined mesh measurements as surface clearance and keeps exact text', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'beam', index: 0,
      provenance: { method: 'surface-to-surface', accuracyClass: 'exact-surface' },
      candidate: { refno: '24381_901', noun: 'SCTN', distance_mm: 600,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 600, z: 0 }, label_mm: 600 } },
    }], point => point);
    expect(result.records[0]?.sourceLabel).toBe('beam: 24381_901（实体外表面净距）');
    expect(result.records[0]?.role).toBe('external');
    expect(result.records[0]?.layout).toMatchObject({ role: 'external', textHalo: true, authoritativeText: 'beam 600mm' });
  });

  it('prefixes stale records with the out-of-date marker and maps role to invalid', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'WALL', index: 0,
      provenance: { method: 'centerline-to-aabb', accuracyClass: 'approximate-bounds', status: 'stale' },
      candidate: { refno: '24381_902', noun: 'WALL', distance_mm: 300,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 300, z: 0 }, label_mm: 300 } },
    }], point => point);
    expect(result.records[0]?.role).toBe('invalid');
    expect(result.records[0]?.layout).toMatchObject({ role: 'invalid', textHalo: true, authoritativeText: 'WALL （过期）≈300mm' });
  });

  it('skips incomplete coordinates without creating a user record', () => {
    const result = branClearanceToExternalDimensions([
      {
        targetGroup: 'column',
        index: 1,
        candidate: {
          refno: 'bad',
          noun: 'COLU',
          distance_mm: 0,
          annotation: {
            start_point: undefined as any,
            end_point: { x: 0, y: 0, z: 0 },
            label_mm: 0,
          },
        },
      },
    ], point => point);

    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: 'bran-clearance:column:bad' }),
    ]);
  });

  it('精算确认的真相交不画净距线（进 skipped，由列表的「相交?」徽标表达）', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'WALL', index: 0,
      provenance: { method: 'surface-to-surface', accuracyClass: 'exact-surface' },
      candidate: { refno: '24381_903', noun: 'WALL', distance_mm: 0, intersects: true,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 0, z: 0 }, label_mm: 0 } },
    }], point => point);

    // 线上写 0 会被读成「净距 0mm」而不是「相交」→ 不出三维尺寸线
    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ id: 'bran-clearance:wall:24381_903' }),
    ]);
  });

  it('未精算的包围盒假相交（零长度端点）改为显式交点十字标记 + 「相交?」标签呈现', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'WALL', index: 0,
      candidate: { refno: '24381_904', noun: 'WALL', distance_mm: 0, intersects: true,
        annotation: { start_point: { x: 1000, y: 2000, z: 3000 }, end_point: { x: 1000, y: 2000, z: 3000 }, label_mm: 0 } },
    }], point => mmToM(point));

    expect(result.records).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.records[0]).toMatchObject({
      id: 'bran-clearance:wall:24381_904',
      role: 'approximate',
      category: 'annotation',
      layout: {
        role: 'approximate',
        textHalo: true,
        labelPresentation: 'above',
        formattedLabel: 'WALL ≈相交?',
        labelAnchor: [1, 2, 3],
        markers: [{ at: [1, 2, 3], shape: 'cross' }],
      },
    });
  });

  it('开启 showConfirmedIntersectionMarkers 时精算确认的真相交输出碰撞靶心标记 ⊗ 与抬升标签', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'WALL', index: 0,
      provenance: { method: 'surface-to-surface', accuracyClass: 'exact-surface' },
      candidate: { refno: '24381_903', noun: 'WALL', distance_mm: 0, intersects: true,
        annotation: { start_point: { x: 1000, y: 2000, z: 3000 }, end_point: { x: 1000, y: 2000, z: 3000 }, label_mm: 0 } },
    }], point => mmToM(point), { showConfirmedIntersectionMarkers: true });

    expect(result.skipped).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: 'bran-clearance:wall:24381_903',
      role: 'invalid',
      category: 'annotation',
      layout: {
        role: 'invalid',
        textHalo: true,
        labelPresentation: 'above',
        formattedLabel: 'WALL 相交',
        labelAnchor: [1, 2, 3],
        markers: [
          { at: [1, 2, 3], shape: 'cross' },
          { at: [1, 2, 3], shape: 'circle', radiusPx: 6 },
        ],
      },
    });
  });
});

describe('branClearanceTargetRefno', () => {
  it('unwraps the target refno from a bran-clearance dimension id', () => {
    expect(branClearanceTargetRefno('bran-clearance:wall:24381_1776')).toBe('24381_1776');
    expect(branClearanceTargetRefno('bran-clearance:wall:24381_1776:0')).toBe('24381_1776');
    expect(branClearanceTargetRefno('bran-clearance:bran:24384_22726:parallel_a_b_0')).toBe('24384_22726');
  });

  it('returns null for non-bran ids and malformed payloads', () => {
    expect(branClearanceTargetRefno('measurement:abc')).toBeNull();
    expect(branClearanceTargetRefno('bran-clearance:wall')).toBeNull();
    expect(branClearanceTargetRefno('bran-clearance:wall:unknown:0')).toBeNull();
    expect(branClearanceTargetRefno(null)).toBeNull();
    expect(branClearanceTargetRefno('')).toBeNull();
  });
});
