import { describe, expect, it } from 'vitest';

import {
  AXIS_ESTIMATE_WARNING,
  isPipeClearanceRecord,
  mmPointToM,
  pipeClearanceLeavesText,
  pipeDistanceInputs,
  pipeDistanceResultToClearanceRecord,
} from './pipeDistanceRecords';

import type { SurfaceClearanceResponse } from '@/api/genModelV1Api';
import type { ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type { PipeDistanceResult } from '@/composables/usePipeDistanceStore';

import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import { elboToCurvedWallResponse } from '@/clearance/testing/surfaceClearanceFixtures';

function surfaceResult(overrides: Partial<PipeDistanceResult> = {}): PipeDistanceResult {
  return {
    id: 'fixture-1',
    distance: 320,
    measurementKind: 'surface',
    pipeA: '24381_1001',
    pipeB: '24381_1002',
    start: [0, 0, 0],
    end: [0, 0, 320],
    designPoints: { start: [1, 2, 3], end: [1, 2, 323] },
    modelVersion: { sourceSesno: 1, targetSesno: 1 },
    ...overrides,
  };
}

describe('pipeDistanceRecords · PipeDistanceResult → ClearanceRecord', () => {
  it('surface 结果：mm 点换算 design 米，方法与版本如实落库', () => {
    const record = pipeDistanceResultToClearanceRecord(surfaceResult(), new Date(0));
    expect(record.id).toBe('clearance:24381_1001:24381_1002');
    expect(record.kind).toBe('component-to-component');
    expect(record.inputs).toEqual({ sourceRefno: '24381_1001', targetRefno: '24381_1002', targetKind: 'any' });
    expect(record.snapshot).toMatchObject({
      distanceM: 0.32,
      sourcePoint: [0.001, 0.002, 0.003],
      targetPoint: [0.001, 0.002, 0.323],
    });
    expect(record.provenance.method).toBe('surface-to-surface');
    expect(record.provenance.accuracyClass).toBe('exact-surface');
    expect(record.provenance.warnings).toEqual([]);
    expect(record.modelVersion).toEqual({ sourceSesno: 1, targetSesno: 1 });
    expect(record.status).toBe('current');
    expect(isPipeClearanceRecord(record)).toBe(true);
  });

  it('axis-estimate 结果：pca-axis + approximate-axis + axis_fit_estimate 警告——永远不当外表面净距', () => {
    const record = pipeDistanceResultToClearanceRecord(
      surfaceResult({ measurementKind: 'axis-estimate' }),
      new Date(0),
    );
    expect(record.provenance.method).toBe('pca-axis');
    expect(record.provenance.accuracyClass).toBe('approximate-axis');
    expect(record.provenance.warnings).toEqual([AXIS_ESTIMATE_WARNING]);
    expect(record.provenance.warnings[0]!.code).toBe('axis_fit_estimate');
  });

  it('缺 designPoints 的旧结果拒收（没有世界坐标的结果不该进持久层）', () => {
    const bad = { ...surfaceResult(), designPoints: undefined } as PipeDistanceResult;
    expect(() => pipeDistanceResultToClearanceRecord(bad, new Date())).toThrow(/design points/);
  });

  it('status 透传：stale 的旧快照恢复出来还是 stale', () => {
    const stale = pipeDistanceResultToClearanceRecord(surfaceResult({ status: 'stale' }), new Date(0));
    expect(stale.status).toBe('stale');
    const fresh = pipeDistanceResultToClearanceRecord(surfaceResult(), new Date(0));
    expect(fresh.status).toBe('current');
  });

  it('refno 归一化进 inputs/id（斜杠与下划线混用得到同一记录身份）', () => {
    const a = pipeDistanceResultToClearanceRecord(surfaceResult({ pipeA: '24381/1001' }), new Date(0));
    const b = pipeDistanceResultToClearanceRecord(surfaceResult({ pipeA: '24381_1001' }), new Date(0));
    expect(a.id).toBe(b.id);
    expect(pipeDistanceInputs('24381/1001', '24381_1002')).toEqual({
      sourceRefno: '24381_1001', targetRefno: '24381_1002', targetKind: 'any',
    });
  });

  it('isPipeClearanceRecord 只认 BRAN↔BRAN/any 的 component 记录，排除交互式 parallel-centerline', () => {
    const record = pipeDistanceResultToClearanceRecord(surfaceResult(), new Date(0));
    expect(isPipeClearanceRecord({ ...record, sourceNoun: 'EQUI' })).toBe(false);
    expect(isPipeClearanceRecord({ ...record, inputs: { ...record.inputs, targetKind: 'wall' } })).toBe(false);
    expect(isPipeClearanceRecord({
      ...record,
      provenance: { ...record.provenance, method: 'parallel-centerline' },
    })).toBe(false);
  });

  it('mmPointToM 单次换算', () => {
    expect(mmPointToM([1000, -2500, 0])).toEqual([1, -2.5, 0]);
  });
});

/** 146830 × 145018 的一条外表面精算记录；叶子按用例覆盖。 */
function branPairRecord(result: Partial<NonNullable<SurfaceClearanceResponse['result']>>): ClearanceRecord {
  const base = elboToCurvedWallResponse().result!;
  return surfaceClearanceToRecord(elboToCurvedWallResponse({
    target_kind: 'any',
    source: { refno: '24381/146830', noun: 'BRAN', leaf_count: 15, triangle_count: 1884 },
    target: { refno: '24381/145018', noun: 'BRAN', leaf_count: 22, triangle_count: 2364 },
    result: { ...base, target_face: null, perpendicular: null, ...result },
  }), pipeDistanceInputs('24381_146830', '24381_145018'), new Date(0));
}

describe('pipeClearanceLeavesText · 最近处落在哪两个构件上', () => {
  it('直管叶子就是 BRAN 本身，写「直管」；目标侧用服务端给的类型', () => {
    const record = branPairRecord({ source_leaf_refno: '24381/146830', target_leaf_refno: '24381/145011', target_leaf_noun: 'ELBO' });
    expect(pipeClearanceLeavesText(record, () => null)).toBe('最近处：直管 ↔ 弯头 24381_145011');
  });

  it('源侧类型按 refno 查；相交时写「相交处」', () => {
    const nounOf = (refno: string) => (refno === '24381_146832' ? 'VALV' : null);
    const record = branPairRecord({
      intersects: true, distance_mm: 0, witness: 'aabb-overlap-center',
      source_leaf_refno: '24381/146832', target_leaf_refno: '24381/145013', target_leaf_noun: 'WELD',
    });
    expect(pipeClearanceLeavesText(record, nounOf)).toBe('相交处：阀门 24381_146832 ↔ 焊缝 24381_145013');
  });

  it('没有服务端叶子的记录（网格拟合估算、旧快照迁来的）不写', () => {
    expect(pipeClearanceLeavesText(pipeDistanceResultToClearanceRecord(surfaceResult(), new Date(0)), () => 'TUBI')).toBe('');
    expect(pipeClearanceLeavesText(
      pipeDistanceResultToClearanceRecord(surfaceResult({ measurementKind: 'axis-estimate' }), new Date(0)),
      () => 'TUBI',
    )).toBe('');
  });
});
