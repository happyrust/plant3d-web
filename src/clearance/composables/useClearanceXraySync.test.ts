import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import {
  collectClearanceRelatedRefnos,
  useClearanceXraySync,
  type ClearanceXrayViewerSink,
} from './useClearanceXraySync';

import type { BranNearestClearanceAnnotationCandidate } from '@/composables/useSpatialCompute';

import { createClearanceRecord } from '@/clearance/domain/clearanceRecord';
import { createClearanceService } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import {
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';
import { accuracyClassForMethod, createComputationProvenance } from '@/measurement/domain/computationProvenance';

const AT = new Date('2026-11-24T05:00:00.000Z');

function createViewerSink() {
  const setMeasurementXrayKeepRefnos = vi.fn();
  const clearMeasurementXray = vi.fn();
  const viewer: ClearanceXrayViewerSink = {
    scene: { setMeasurementXrayKeepRefnos, clearMeasurementXray },
  };
  return { viewer, setMeasurementXrayKeepRefnos, clearMeasurementXray };
}

function createPipeRowRecord() {
  return createClearanceRecord({
    id: 'piperow:center:derived-gap:24381_1001~0_1:24381_1002~0_1@0.0-5000.0',
    kind: 'component-to-component',
    inputs: { sourceRefno: '24381_1001~0_1', targetRefno: '24381_1002~0_1', targetKind: 'any' },
    sourceNoun: 'BRAN',
    targetNoun: 'BRAN',
    provenance: createComputationProvenance({
      method: 'pipe-row-derived-gap',
      accuracyClass: accuracyClassForMethod('pipe-row-derived-gap'),
      coordinateSpace: 'design-world',
      source: { entityId: '24381_1001', refno: '24381_1001', segmentRefno: '24381_1001~0_1' },
      target: { entityId: '24381_1002', refno: '24381_1002', segmentRefno: '24381_1002~0_1' },
    }),
    snapshot: {
      distanceM: 0.25,
      intersects: false,
      sourcePoint: [0, 0, 0],
      targetPoint: [0, 0.25, 0],
      vector: [0, 0.25, 0],
      sourceLeafRefno: '24381_1001~0_1',
      targetLeafRefno: '24381_1002~0_1',
      targetLeafNoun: 'TUBI',
      targetFace: null,
      perpendicular: null,
      witness: 'closest-points',
    },
    pipeRow: {
      alignMode: 'center',
      metric: 'derived-gap',
      signedGapM: 0.25,
      section: { point: [0, 0.125, 0], normal: [1, 0, 0], axialStartM: 0, axialEndM: 5 },
      rowGroupId: 'row:24381_1001~0_1|24381_1002~0_1@0.0-5000.0:center',
      sourceOd: { odM: 0.1, evidence: 'catalogue' },
      targetOd: { odM: 0.1, evidence: 'catalogue' },
    },
    modelVersion: { sourceSesno: 1, targetSesno: 1 },
    computedAt: AT.toISOString(),
  });
}

function createBranCandidate(refno: string, noun = 'WALL'): BranNearestClearanceAnnotationCandidate {
  return {
    targetGroup: noun,
    index: 0,
    candidate: {
      refno,
      noun,
      distance_mm: 500,
      intersects: false,
      nearest: {
        source_segment_refno: '24381_145020',
        source_segment_order: 2,
        source_point: { x: 0, y: 0, z: 0 },
        target_point: { x: 500, y: 0, z: 0 },
        vector: { dx: 500, dy: 0, dz: 0 },
      },
      annotation: {
        start_point: { x: 0, y: 0, z: 0 },
        end_point: { x: 500, y: 0, z: 0 },
        label_mm: 500,
      },
    },
  };
}

describe('collectClearanceRelatedRefnos', () => {
  it('returns empty array when no clearance records or BRAN candidates are visible', () => {
    expect(collectClearanceRelatedRefnos({
      showClearanceAnnotations: true,
      clearanceRecords: [],
      branQueriedSourceRefno: '24381_145018',
      branAnnotationCandidates: [],
      expandCompanions: () => [],
    })).toEqual([]);

    expect(collectClearanceRelatedRefnos({
      showClearanceAnnotations: false,
      clearanceRecords: [createPipeRowRecord()],
      branQueriedSourceRefno: '',
      branAnnotationCandidates: [],
      expandCompanions: () => [],
    })).toEqual([]);
  });

  it('collects entity refnos from pipe-row, surface clearance, BRAN clearance, and expands companions while ignoring segment anchors', () => {
    const surfaceRecord = createClearanceRecord({
      kind: 'component-to-wall',
      inputs: { sourceRefno: '24384_22582', targetRefno: '17496_105912', targetKind: 'wall' },
      sourceNoun: 'ELBO',
      targetNoun: 'CWALL',
      provenance: createComputationProvenance({
        method: 'surface-to-surface',
        accuracyClass: 'exact-surface',
        coordinateSpace: 'design-world',
        source: { entityId: '24384_22582', refno: '24384_22582', segmentRefno: '24384_22582' },
        target: { entityId: '17496_105912', refno: '17496_105912', segmentRefno: '17496_105913' },
      }),
      snapshot: {
        distanceM: 0.12,
        intersects: false,
        sourcePoint: [0, 0, 0],
        targetPoint: [0.12, 0, 0],
        vector: [0.12, 0, 0],
        sourceLeafRefno: '24384_22582',
        targetLeafRefno: '17496_105913',
        targetLeafNoun: 'WALL',
        targetFace: null,
        perpendicular: null,
        witness: 'closest-points',
      },
      modelVersion: { sourceSesno: 1, targetSesno: 1 },
      computedAt: AT.toISOString(),
    });

    const related = collectClearanceRelatedRefnos({
      showClearanceAnnotations: true,
      clearanceRecords: [surfaceRecord, createPipeRowRecord()],
      branQueriedSourceRefno: '24381/145018',
      branAnnotationCandidates: [createBranCandidate('24381_67345', 'SCTN')],
      expandCompanions: (seeds) => (
        Array.from(seeds).includes('24381_145018') ? ['24381_145035'] : []
      ),
    });

    expect(related).toEqual([
      '17496_105912',
      '17496_105913',
      '24381_1001',
      '24381_1002',
      '24381_145018',
      '24381_145020',
      '24381_145035',
      '24381_67345',
      '24384_22582',
    ]);
  });
});

describe('useClearanceXraySync', () => {
  beforeEach(() => {
    const store = useClearanceStore();
    store.detachPersistence();
    store.clearRecords();
    store.showAnnotations.value = true;
    store.setXrayUnrelatedModels(false);
  });

  function serviceReturning(responses: unknown[]) {
    const queue = [...responses];
    return createClearanceService({
      fetchSurfaceClearance: vi.fn(async () => queue.shift() as never),
      now: () => AT,
    });
  }

  it('stays inactive when option is off or when no records exist, and applies/restores on toggle, remove, clear, and stop', async () => {
    const store = useClearanceStore();
    const { viewer, setMeasurementXrayKeepRefnos, clearMeasurementXray } = createViewerSink();
    const viewerRef = ref<ClearanceXrayViewerSink | null>(viewer);
    const branSource = ref('');
    const branCandidates = ref<BranNearestClearanceAnnotationCandidate[]>([]);
    const requestRender = vi.fn();

    const syncHandle = useClearanceXraySync(viewerRef, {
      clearanceStore: store,
      branClearance: {
        getQueriedSourceRefno: () => branSource.value,
        getAnnotationCandidates: () => branCandidates.value,
      },
      dimOpacity: 0.25,
      requestRender,
      expandCompanions: () => [],
    });

    // 开启开关但无任何测量结果 → 不应对场景施加半透明
    store.setXrayUnrelatedModels(true);
    await nextTick();
    expect(setMeasurementXrayKeepRefnos).not.toHaveBeenCalled();

    // 算出一条构件→墙净距 → 立刻以相关构件集合开启 X 光半透明
    const svc = serviceReturning([elboToCurvedWallResponse(), boxToStraightWallResponse()]);
    const rec = await store.compute(
      { sourceRefno: '24384_22582', targetRefno: '17496_105912' },
      { service: svc },
    );
    await nextTick();
    expect(setMeasurementXrayKeepRefnos).toHaveBeenLastCalledWith(
      ['17496_105912', '24384_22582'],
      { dimOpacity: 0.25 },
    );

    // 隐藏或删除该记录后结果为空 → 自动还原
    store.removeRecord(rec!.id);
    await nextTick();
    expect(clearMeasurementXray).toHaveBeenCalledTimes(1);

    // 中心线净距候选存在时同样生效，清空后自动还原
    branSource.value = '24381_145018';
    branCandidates.value = [createBranCandidate('24381_67345', 'SCTN')];
    await nextTick();
    expect(setMeasurementXrayKeepRefnos).toHaveBeenLastCalledWith(
      ['24381_145018', '24381_145020', '24381_67345'],
      { dimOpacity: 0.25 },
    );

    // 关闭开关 → 还原
    store.setXrayUnrelatedModels(false);
    await nextTick();
    expect(clearMeasurementXray).toHaveBeenCalledTimes(2);

    // 重新开启后 stop() → 还原
    store.setXrayUnrelatedModels(true);
    await nextTick();
    syncHandle.stop();
    expect(clearMeasurementXray).toHaveBeenCalledTimes(3);
  });

  it('auto-disables measurement X-ray when exiting interactive measurement mode without drawer or BRAN results', async () => {
    const store = useClearanceStore();
    const { viewer, clearMeasurementXray } = createViewerSink();
    const viewerRef = ref<ClearanceXrayViewerSink | null>(viewer);
    const toolMode = ref('measure_pipe_to_pipe');
    const pipeDrawerOpen = ref(false);

    const syncHandle = useClearanceXraySync(viewerRef, {
      clearanceStore: store,
      branClearance: {
        getQueriedSourceRefno: () => '',
        getAnnotationCandidates: () => [],
      },
      toolMode,
      pipeDrawerOpen,
      expandCompanions: () => [],
    });

    store.upsertRecord(createPipeRowRecord());
    store.setXrayUnrelatedModels(true);
    await nextTick();
    expect(store.xrayUnrelatedModels.value).toBe(true);

    // 退出交互式测量模式 → 自动关闭选项并还原场景
    toolMode.value = 'none';
    await nextTick();
    expect(store.xrayUnrelatedModels.value).toBe(false);
    expect(clearMeasurementXray).toHaveBeenCalled();

    syncHandle.stop();
  });

  it('clears measurement X-ray on previous viewer when viewer is replaced or unmounted', async () => {
    const store = useClearanceStore();
    const first = createViewerSink();
    const second = createViewerSink();
    const viewerRef = ref<ClearanceXrayViewerSink | null>(first.viewer);

    const syncHandle = useClearanceXraySync(viewerRef, {
      clearanceStore: store,
      branClearance: {
        getQueriedSourceRefno: () => '',
        getAnnotationCandidates: () => [],
      },
      expandCompanions: () => [],
    });

    store.upsertRecord(createPipeRowRecord());
    store.setXrayUnrelatedModels(true);
    await nextTick();
    expect(first.setMeasurementXrayKeepRefnos).toHaveBeenCalledTimes(1);

    viewerRef.value = second.viewer;
    await nextTick();
    expect(first.clearMeasurementXray).toHaveBeenCalledTimes(1);
    expect(second.setMeasurementXrayKeepRefnos).toHaveBeenCalledTimes(1);

    syncHandle.stop();
    expect(second.clearMeasurementXray).toHaveBeenCalledTimes(1);
  });
});
