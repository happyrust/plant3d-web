import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { useGetWorkMeasurementSync } from './useGetWorkMeasurementSync';

import { clearanceDimensionText } from '@/clearance/adapters/clearanceExternalDimensions';
import { createClearanceService } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import { boxToStraightWallResponse } from '@/clearance/testing/surfaceClearanceFixtures';
import { dtxLoaderRevision } from '@/composables/useDbnoInstancesDtxLoader';
import { usePipeDistanceStore } from '@/composables/usePipeDistanceStore';
import { resetSpatialComputeStore, useSpatialCompute } from '@/composables/useSpatialCompute';
import { useToolStore } from '@/composables/useToolStore';

function translationMmMatrix(txMm: number, tyMm: number, tzMm: number): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    txMm, tyMm, tzMm, 1,
  ];
}

function signatureOf(geoHash: string, mat: readonly number[]): string {
  return `${geoHash}:${mat.join(',')}`;
}

describe('useGetWorkMeasurementSync（#159 取最新后测量与净距核对与一键重测）', () => {
  const sync = useGetWorkMeasurementSync();

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
    useToolStore().clearAll();
    useClearanceStore().detachPersistence();
    useClearanceStore().clearRecords();
    const pipeStore = usePipeDistanceStore();
    pipeStore.detachPersistence();
    pipeStore.clearResults();
    pipeStore.clearBranRefnos();
    resetSpatialComputeStore();
    sync.resetForTests();
  });

  afterEach(() => {
    useToolStore().clearAll();
    useClearanceStore().detachPersistence();
    useClearanceStore().clearRecords();
    const pipeStore = usePipeDistanceStore();
    pipeStore.detachPersistence();
    pipeStore.clearResults();
    pipeStore.clearBranRefnos();
    resetSpatialComputeStore();
    sync.resetForTests();
  });

  it('构件上抬 300mm 标过期、同库重载但未变构件保持有效、点「重测」更新读数与连线恢复有效', async () => {
    const toolStore = useToolStore();
    const clearanceStore = useClearanceStore();

    const movedEquip = '24382_1913';
    const steadyEquip = '24382_1920';
    const wall = '17496_105912';

    const sceneState = new Map<string, { loaded: boolean; geoHash: string; matrix: number[] }>([
      [movedEquip, { loaded: true, geoHash: 'g-eq-1', matrix: translationMmMatrix(0, 0, 1000) }],
      [steadyEquip, { loaded: true, geoHash: 'g-eq-2', matrix: translationMmMatrix(5000, 0, 1000) }],
      [wall, { loaded: true, geoHash: 'g-wall', matrix: translationMmMatrix(0, 0, 0) }],
    ]);

    const probe = {
      isLoaded: (refno: string) => sceneState.get(refno)?.loaded === true,
      getSignature: (refno: string) => {
        const entry = sceneState.get(refno);
        return entry?.loaded ? `${refno}@${signatureOf(entry.geoHash, entry.matrix)}` : null;
      },
      getMatrix: (refno: string) => {
        const entry = sceneState.get(refno);
        return entry?.loaded ? [...entry.matrix] : null;
      },
    };

    // 1. 两条点对点距离测量：m-moved 挂在平移设备上（初始距离 1.0m），m-steady 挂在同库未变动设备上（距离 1.0m）
    toolStore.addXeokitDistanceMeasurement({
      id: 'm-moved',
      kind: 'distance',
      origin: {
        entityId: `o:${movedEquip}:0`,
        worldPos: [0, 0, 1.0],
        designWorldPos: [0, 0, 1.0],
        sourceInfo: { source: 'position', refno: movedEquip },
      },
      target: {
        entityId: `o:${wall}:0`,
        worldPos: [0, 0, 0],
        designWorldPos: [0, 0, 0],
        sourceInfo: { source: 'mesh_pick_point', refno: wall },
      },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    toolStore.addXeokitDistanceMeasurement({
      id: 'm-steady',
      kind: 'distance',
      origin: {
        entityId: `o:${steadyEquip}:0`,
        worldPos: [5, 0, 1.0],
        designWorldPos: [5, 0, 1.0],
        sourceInfo: { source: 'position', refno: steadyEquip },
      },
      target: {
        entityId: `o:${wall}:0`,
        worldPos: [5, 0, 0],
        designWorldPos: [5, 0, 0],
        sourceInfo: { source: 'mesh_pick_point', refno: wall },
      },
      visible: true,
      approximate: false,
      createdAt: 2,
    });

    // 2. 两条最近点外表面净距：一条挂在 24382_1913 ↔ 墙（初始 1000mm），一条挂在未变动 24382_1920 ↔ 墙（1000mm）
    const makeSurfaceResp = (src: string, dst: string, zMm: number) => {
      const base = boxToStraightWallResponse();
      return {
        ...base,
        source: { ...base.source, refno: src },
        target: { ...base.target, refno: dst },
        result: base.result
          ? {
            ...base.result,
            distance_mm: zMm,
            source_point: { x: 0, y: 0, z: zMm },
            target_point: { x: 0, y: 0, z: 0 },
            vector: { dx: 0, dy: 0, dz: -zMm },
            source_leaf_refno: src,
            target_leaf_refno: dst,
          }
          : null,
      };
    };
    const fetchSurfaceClearance = vi.fn()
      .mockResolvedValueOnce(makeSurfaceResp(movedEquip, wall, 1000))
      .mockResolvedValueOnce(makeSurfaceResp(steadyEquip, wall, 1000))
      .mockResolvedValueOnce(makeSurfaceResp(movedEquip, wall, 1300));
    const service = createClearanceService({ fetchSurfaceClearance });

    const cMoved = await clearanceStore.compute({ sourceRefno: movedEquip, targetRefno: wall, targetKind: 'wall' }, { service });
    const cSteady = await clearanceStore.compute({ sourceRefno: steadyEquip, targetRefno: wall, targetKind: 'wall' }, { service });
    expect(cMoved?.status).toBe('current');
    expect(cSteady?.status).toBe('current');

    // 3. 取最新前拍快照 → 后台把 24382_1913 上抬 300mm（z: 1000 → 1300），24382_1920 虽同库重载但矩阵未变
    sync.captureBeforeGetWork(probe);
    sceneState.set(movedEquip, { loaded: true, geoHash: 'g-eq-1', matrix: translationMmMatrix(0, 0, 1300) });

    const report = await sync.reconcileAfterGetWork(probe);

    expect(report.fates.get(movedEquip)).toBe('changed');
    expect(report.fates.get(steadyEquip)).toBe('unchanged');
    expect(report.fates.get(wall)).toBe('unchanged');

    // 受影响的测量与净距立即标过期，可一键重测；未变动构件上的测量与净距保持有效
    expect(sync.getMeasurementStale('m-moved')).toMatchObject({
      state: 'changed',
      reason: '模型已变更，结果已过期',
      canRemeasure: true,
    });
    expect(sync.getMeasurementStale('m-steady')).toBeNull();

    expect(clearanceStore.findRecord(cMoved!.id)?.status).toBe('stale');
    expect(clearanceDimensionText(clearanceStore.findRecord(cMoved!.id)!)).toContain('（过期）');
    expect(clearanceStore.findRecord(cSteady!.id)?.status).toBe('current');

    // 4. 点「重测」：测量端点与读数更新到上抬 300mm 后的真实距离（1.3m），净距重算到 1300mm，状态恢复有效
    const mRes = sync.remeasureMeasurement('m-moved', probe);
    expect(mRes).toEqual({ ok: true });
    expect(sync.getMeasurementStale('m-moved')).toBeNull();
    const updatedMeas = toolStore.allXeokitMeasurements.value.find(item => item.id === 'm-moved');
    expect(updatedMeas && updatedMeas.kind === 'distance' ? updatedMeas.origin.worldPos[2] : null).toBeCloseTo(1.3, 6);
    expect(updatedMeas && updatedMeas.kind === 'distance' ? updatedMeas.origin.designWorldPos?.[2] : null).toBeCloseTo(1.3, 6);

    const cRes = await sync.remeasureClearance(cMoved!.id, { service, isLoaded: probe.isLoaded });
    expect(cRes).toEqual({ ok: true });
    const refreshedClearance = clearanceStore.findRecord(cMoved!.id)!;
    expect(refreshedClearance.status).toBe('current');
    expect(refreshedClearance.snapshot?.distanceM).toBeCloseTo(1.3, 6);
    expect(refreshedClearance.snapshot?.sourcePoint[2]).toBeCloseTo(1.3, 6);
    expect(clearanceDimensionText(refreshedClearance)).not.toContain('（过期）');
  });

  it('被测构件之一在后台被删除：保留记录、标明「所测构件已不在场景中」、禁止发起无效重测请求，装回后恢复可重测', async () => {
    const toolStore = useToolStore();
    const clearanceStore = useClearanceStore();

    const deletedBran = '24384_47574';
    const wall = '17496_105912';
    const loadedSet = new Set<string>([deletedBran, wall]);

    const probe = {
      isLoaded: (refno: string) => loadedSet.has(refno),
      getSignature: (refno: string) => (loadedSet.has(refno) ? `${refno}@g:1` : null),
      getMatrix: (refno: string) => (loadedSet.has(refno) ? translationMmMatrix(0, 0, 0) : null),
    };

    toolStore.addMeasurement({
      id: 'm-del',
      kind: 'distance',
      origin: { entityId: deletedBran, worldPos: [1, 2, 3], sourceInfo: { source: 'position', refno: deletedBran } },
      target: { entityId: wall, worldPos: [1, 2, 0], sourceInfo: { source: 'mesh_pick_point', refno: wall } },
      visible: true,
      createdAt: 10,
    });

    const fetchSurfaceClearance = vi.fn().mockResolvedValueOnce({
      ...boxToStraightWallResponse(),
      source_refno: deletedBran,
      target_refno: wall,
      source_leaf_refno: deletedBran,
      target_leaf_refno: wall,
    });
    const service = createClearanceService({ fetchSurfaceClearance });
    const cDel = await clearanceStore.compute({ sourceRefno: deletedBran, targetRefno: wall, targetKind: 'wall' }, { service });
    expect(cDel?.status).toBe('current');
    fetchSurfaceClearance.mockClear();

    // 取最新：deletedBran 从场景撤下
    sync.captureBeforeGetWork(probe);
    loadedSet.delete(deletedBran);
    await sync.reconcileAfterGetWork(probe);

    // 记录完整保留，绝不自动删除
    expect(toolStore.measurements.value).toHaveLength(1);
    expect(clearanceStore.records.value).toHaveLength(1);

    // 标明构件已不在场景中，不可重测
    expect(sync.getMeasurementStale('m-del')).toMatchObject({
      state: 'missing',
      reason: '所测构件已不在场景中',
      canRemeasure: false,
      missingRefnos: [deletedBran],
    });
    expect(clearanceStore.findRecord(cDel!.id)?.status).toBe('stale');
    expect(clearanceStore.getMissingReason(cDel!.id)).toBe('所测构件已不在场景中');

    // 尝试触发重测：直接拦截返回原因，绝不发起无效后端请求，也不抛异常
    expect(sync.remeasureMeasurement('m-del', probe)).toEqual({
      ok: false,
      reason: '所测构件已不在场景中',
    });
    expect(await sync.remeasureClearance(cDel!.id, { service, isLoaded: probe.isLoaded })).toEqual({
      ok: false,
      reason: '所测构件已不在场景中',
    });
    expect(await clearanceStore.recompute(cDel!.id, { service })).toBeNull();
    expect(fetchSurfaceClearance).not.toHaveBeenCalled();

    // 若后续重新装回场景：解除「已不在场景中」限制，恢复可重测
    loadedSet.add(deletedBran);
    sync.captureBeforeGetWork(probe);
    await sync.reconcileAfterGetWork(probe);
    expect(clearanceStore.getMissingReason(cDel!.id)).toBeNull();
    expect(sync.getMeasurementStale('m-del')?.canRemeasure).toBe(true);
    void dtxLoaderRevision;
    await nextTick();
  });

  it('自动周边净距（BRAN 周边结构净距候选）感知构件位移与删除并标记 stale', async () => {
    const spatialCompute = useSpatialCompute({
      selection: { selectedRefno: ref<string | null>(null) },
    });
    const state = spatialCompute.scenarios.branNearestClearance;
    state.queriedSourceRefno = '24384_22582';
    state.branGroups = [
      {
        group: 'WALL',
        candidates: [
          {
            refno: '17496_105912',
            noun: 'GWALL',
            distance_mm: 312,
            intersects: false,
          },
          {
            refno: '17496_105999',
            noun: 'GWALL',
            distance_mm: 800,
            intersects: false,
          },
        ],
      },
    ];
    state.nounFacets = [{ noun: 'WALL', count: 2, selected: true }];
    state.drawnCandidateKeys = ['WALL:17496_105912'];

    const sigs = new Map<string, string | null>([
      ['24384_22582', 's1'],
      ['17496_105912', 'w1'],
      ['17496_105999', 'w2'],
    ]);
    const probe = {
      isLoaded: (refno: string) => sigs.get(refno) !== null && sigs.has(refno),
      getSignature: (refno: string) => sigs.get(refno) ?? null,
      getMatrix: () => translationMmMatrix(0, 0, 0),
    };

    sync.captureBeforeGetWork(probe);
    // 只移动了 17496_105912，源管与另一面墙 17496_105999 未动
    sigs.set('17496_105912', 'w1-moved');
    const report = await sync.reconcileAfterGetWork(probe);

    expect(report.staleBranCandidateKeys).toEqual(['WALL:17496_105912']);
    expect(state.candidateProvenance['WALL:17496_105912']?.status).toBe('stale');
    expect(state.candidateProvenance['WALL:17496_105999']?.status).toBeUndefined();

    // 下一轮 17496_105999 被撤下：记入缺失集合
    sync.captureBeforeGetWork(probe);
    sigs.set('17496_105999', null);
    await sync.reconcileAfterGetWork(probe);
    expect(sync.isSpatialComputeRefnoMissing('17496_105999')).toBe(true);
    expect(sync.isSpatialComputeRefnoMissing('17496_105912')).toBe(false);
  });
});
