import { describe, expect, it, vi } from 'vitest';

import {
  buildBranParallelSpacingRecord,
  commitBranParallelSpacing,
} from './branSpacingRecords';

import type { SpatialCenterlineSegment } from '@/api/genModelV1Api';
import type { ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type { BranParallelRunPair, BranStraightRun } from '@/composables/branParallelSpacing';

function segment(refno: string, noun = 'TUBI'): SpatialCenterlineSegment {
  return {
    refno,
    order: 0,
    noun,
    implicit: refno.includes('~'),
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1000, y: 0, z: 0 },
    length_mm: 1000,
    outside_diameter_mm: 114.3,
  };
}

function run(branRefno: string, firstSegRefno: string, extraNoun = 'TUBI'): BranStraightRun {
  return {
    branRefno,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1000, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    lengthMm: 1000,
    segments: [segment(firstSegRefno, extraNoun)],
    outsideDiameterMm: 114.3,
  };
}

function pair(
  source: BranStraightRun,
  target: BranStraightRun,
  axisDistanceMm = 600,
): BranParallelRunPair {
  return {
    source,
    target,
    angleDeg: 0,
    overlapStartMm: 0,
    overlapEndMm: 1000,
    overlapMm: 1000,
    axisDistanceMm,
    sourcePointMm: { x: 500, y: 0, z: 0 },
    targetPointMm: { x: 500, y: 0, z: axisDistanceMm },
    clearanceMm: axisDistanceMm - 114.3,
  };
}

describe('buildBranParallelSpacingRecord（#63）', () => {
  it('一对平行直段 → 一条 parallel-centerline / exact-centerline 记录，E3D mm 换 design-world m', () => {
    const record = buildBranParallelSpacingRecord({
      sourceBranRefno: '24381/1000',
      targetBranRefno: '24381_2000',
      pair: pair(run('24381_1000', 'Head~24381_1001'), run('24381_2000', '24381_1002')),
      sourceSesno: 12,
      targetSesno: 7,
      warnings: [{ code: 'implicit_diameter', message: '隐式直段外径取分支顶层值' }],
      sourceAnnotation: { id: 'anno-1', type: 'rect' },
      computedAt: new Date('2026-10-19T08:00:00Z'),
    });

    expect(record.id).toBe('clearance:Head~24381_1001:24381_1002');
    expect(record.inputs).toEqual({
      sourceRefno: 'Head~24381_1001',
      targetRefno: '24381_1002',
      targetKind: 'any',
    });
    expect(record.kind).toBe('component-to-component');
    expect(record.sourceNoun).toBe('BRAN');
    expect(record.provenance.method).toBe('parallel-centerline');
    expect(record.provenance.accuracyClass).toBe('exact-centerline');
    expect(record.provenance.source).toEqual({
      entityId: '24381_1000', refno: '24381_1000', segmentRefno: 'Head~24381_1001',
    });
    expect(record.provenance.target).toEqual({
      entityId: '24381_2000', refno: '24381_2000', segmentRefno: '24381_1002',
    });
    expect(record.provenance.warnings).toEqual([
      { code: 'implicit_diameter', message: '隐式直段外径取分支顶层值' },
    ]);
    expect(record.provenance.sourceModelVersion).toBe('sesno:12');
    expect(record.modelVersion).toEqual({ sourceSesno: 12, targetSesno: 7 });
    expect(record.snapshot?.distanceM).toBeCloseTo(0.6, 9);
    expect(record.snapshot?.sourcePoint).toEqual([0.5, 0, 0]);
    expect(record.snapshot?.targetPoint).toEqual([0.5, 0, 0.6]);
    expect(record.snapshot?.vector).toEqual([0, 0, 0.6]);
    expect(record.snapshot?.targetLeafNoun).toBe('TUBI');
    expect(record.snapshot?.witness).toBe('closest-points');
    expect(record.derivedDimensionId).toBeNull();
    expect(record.sourceAnnotation).toEqual({ id: 'anno-1', type: 'rect' });
    expect(record.computedAt).toBe('2026-10-19T08:00:00.000Z');
  });

  it('直段缺首段 refno → TypeError（类型化失败，不落半成品）', () => {
    const broken = pair(
      { ...run('24381_1000', 'x'), segments: [] },
      run('24381_2000', '24381_1002'),
    );
    expect(() => buildBranParallelSpacingRecord({
      sourceBranRefno: '24381_1000',
      targetBranRefno: '24381_2000',
      pair: broken,
      computedAt: new Date(),
    })).toThrow(TypeError);
  });
});

describe('commitBranParallelSpacing（#63 整组替换）', () => {
  function storeOf(initial: ClearanceRecord[] = []) {
    const records: ClearanceRecord[] = [...initial];
    return {
      records,
      upsertRecord: vi.fn((record: ClearanceRecord) => {
        const index = records.findIndex((item) => item.id === record.id);
        if (index < 0) records.push(record);
        else records[index] = record;
        return record;
      }),
      removeRecord: vi.fn((id: string) => {
        const index = records.findIndex((item) => item.id === id);
        if (index >= 0) records.splice(index, 1);
      }),
    };
  }

  it('同一对 BRAN 上一次那组摘掉再写（两个方向都认）；别对不动', () => {
    const store = storeOf();
    const first = commitBranParallelSpacing({
      sourceBranRefno: '24381_1000',
      targetBranRefno: '24381_2000',
      pairs: [
        pair(run('24381_1000', 'Head~24381_1001'), run('24381_2000', 'Head~24381_1002')),
        pair(run('24381_1000', '24381_1007'), run('24381_2000', '24381_1008')),
      ],
      computedAt: new Date('2026-10-19T08:00:00Z'),
      records: store.records,
      upsertRecord: store.upsertRecord,
      removeRecord: store.removeRecord,
    });
    expect(first).toHaveLength(2);
    expect(store.records).toHaveLength(2);

    // 反向再测同一对：旧两条摘掉，剩一条新方向的
    const second = commitBranParallelSpacing({
      sourceBranRefno: '24381_2000',
      targetBranRefno: '24381_1000',
      pairs: [pair(run('24381_2000', 'Head~24381_1002'), run('24381_1000', 'Head~24381_1001'))],
      computedAt: new Date('2026-10-19T08:05:00Z'),
      records: store.records,
      upsertRecord: store.upsertRecord,
      removeRecord: store.removeRecord,
    });
    expect(second).toHaveLength(1);
    expect(store.records).toHaveLength(1);
    expect(store.removeRecord).toHaveBeenCalledTimes(2);
    expect(store.records[0]!.provenance.source.refno).toBe('24381_2000');

    // 别对 BRAN 的记录不在摘除范围
    const other = buildBranParallelSpacingRecord({
      sourceBranRefno: '24381_9000',
      targetBranRefno: '24381_9001',
      pair: pair(run('24381_9000', 's1'), run('24381_9001', 't1')),
      computedAt: new Date(),
    });
    store.records.push(other);
    commitBranParallelSpacing({
      sourceBranRefno: '24381_1000',
      targetBranRefno: '24381_2000',
      pairs: [],
      computedAt: new Date(),
      records: store.records,
      upsertRecord: store.upsertRecord,
      removeRecord: store.removeRecord,
    });
    expect(store.records).toEqual([other]);
  });
});
