import { describe, expect, it } from 'vitest';

import { branClearanceToExternalDimensions } from './branExternalDimensions';

describe('branClearanceToExternalDimensions', () => {
  it('maps valid backend points to a read-only authoritative linear dimension', () => {
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
    ], point => [point[0] * 0.001, point[1] * 0.001, point[2] * 0.001]);

    expect(result.skipped).toEqual([]);
    expect(result.records).toEqual([
      expect.objectContaining({
        id: 'bran-clearance:wall:24381_145018:0',
        source: 'bran-clearance',
        role: 'external',
        layout: expect.objectContaining({
          kind: 'linear',
          a: [1, 2, 3],
          b: [2.2, 2, 3],
          authoritativeText: '1200mm',
        }),
      }),
    ]);
  });

  it('marks a sampled (interactive pipe-to-structure) estimate as approximate in both the label text and the source label', () => {
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
    ], point => [point[0] * 0.001, point[1] * 0.001, point[2] * 0.001]);

    expect(result.records).toEqual([
      expect.objectContaining({
        id: 'bran-clearance:wall:24381_900:2',
        sourceLabel: 'WALL: 24381_900（估算）',
        layout: expect.objectContaining({ authoritativeText: '≈600mm', a: [1, 2, 3], b: [1, 2, 3.6] }),
      }),
    ]);
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
    ], point => [point[0] * 0.001, point[1] * 0.001, point[2] * 0.001]);

    expect(result.skipped).toEqual([]);
    expect(result.records.map((record) => [record.id, record.sourceLabel, (record.layout as { authoritativeText?: string }).authoritativeText])).toEqual([
      ['bran-clearance:bran:24381_144924:0', 'BRAN: 24381_144924（平行直段中心距）', '1584mm'],
      ['bran-clearance:bran:24381_144924:1', 'BRAN: 24381_144924（平行直段中心距）', '1920mm'],
    ]);
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
