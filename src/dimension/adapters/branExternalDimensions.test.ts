import { describe, expect, it } from 'vitest';

import { branClearanceToExternalDimensions } from './branExternalDimensions';

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
      id: 'bran-clearance:wall:24381_145018:0',
      source: 'bran-clearance',
      role: 'external',
      layout: {
        kind: 'linear',
        role: 'external',
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
      id: 'bran-clearance:wall:24381_900:2',
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
      ['bran-clearance:bran:24381_144924:0', 'BRAN: 24381_144924（平行直段中心距）', 'BRAN 1584mm'],
      ['bran-clearance:bran:24381_144924:1', 'BRAN: 24381_144924（平行直段中心距）', 'BRAN 1920mm'],
    ]);
  });

  it('marks refined mesh measurements as surface clearance and keeps exact text', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'beam', index: 0,
      provenance: { method: 'surface-to-surface', accuracyClass: 'exact-surface' },
      candidate: { refno: '24381_901', noun: 'SCTN', distance_mm: 600,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 600, z: 0 }, label_mm: 600 } },
    }], point => point);
    expect(result.records[0]?.sourceLabel).toBe('beam: 24381_901（实体外表面净距）');
    expect(result.records[0]?.layout).toMatchObject({ authoritativeText: 'beam 600mm' });
  });

  it('prefixes stale records with the out-of-date marker in the dimension text', () => {
    const result = branClearanceToExternalDimensions([{
      targetGroup: 'WALL', index: 0,
      provenance: { method: 'centerline-to-aabb', accuracyClass: 'approximate-bounds', status: 'stale' },
      candidate: { refno: '24381_902', noun: 'WALL', distance_mm: 300,
        annotation: { start_point: { x: 0, y: 0, z: 0 }, end_point: { x: 0, y: 300, z: 0 }, label_mm: 300 } },
    }], point => point);
    expect(result.records[0]?.layout).toMatchObject({ authoritativeText: 'WALL （过期）≈300mm' });
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
      expect.objectContaining({ id: 'bran-clearance:column:bad:1' }),
    ]);
  });
});
