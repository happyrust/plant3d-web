import { shallowRef, watch, type ShallowRef } from 'vue';

import { Matrix4, Vector3 } from 'three';

import type { ClearanceRecord } from '@/clearance/domain/clearanceRecord';

import { useClearanceStore, type ClearanceComputeOptions } from '@/clearance/stores/useClearanceStore';
import * as dtxLoader from '@/composables/useDbnoInstancesDtxLoader';
import { usePipeDistanceStore } from '@/composables/usePipeDistanceStore';
import { peekSpatialComputeStore } from '@/composables/useSpatialCompute';
import {
  useToolStore,
  type MeasurementPoint,
  type MeasurementRecord,
  type Vec3,
  type XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import { toRefnoKey } from '@/utils/refnoKey';

export type ComponentGetWorkFate = 'unchanged' | 'changed' | 'removed';

export type MeasurementStaleState = 'changed' | 'missing';

export type MeasurementStaleEntry = Readonly<{
  state: MeasurementStaleState;
  reason: string;
  canRemeasure: boolean;
  changedRefnos: readonly string[];
  missingRefnos: readonly string[];
}>;

export type NearbyGroupStaleEntry = Readonly<{
  state: MeasurementStaleState;
  reason: string;
  canRedetect: boolean;
}>;

export type GetWorkMeasurementProbe = {
  isLoaded?: (refno: string) => boolean;
  getSignature?: (refno: string) => string | null;
  getMatrix?: (refno: string) => number[] | null;
  getGlobalMatrix?: () => number[] | null;
  probeNodeGone?: (refno: string) => Promise<boolean | null>;
};

export type RemeasureResult =
  | { ok: true }
  | { ok: false; reason: string };

type PreGetWorkRefnoSnapshot = {
  loaded: boolean;
  signature: string | null;
  matrix: number[] | null;
};

type MeasurementPointBaseline = {
  byRefno: Map<string, number[]>;
  globalMatrix: number[] | null;
};

const STALE_CHANGED_REASON = '模型已变更，结果已过期';
const STALE_MISSING_REASON = '所测构件已不在场景中';

const MM_TO_METERS_MATRIX = new Matrix4().makeScale(0.001, 0.001, 0.001);

const measurementStaleById: ShallowRef<ReadonlyMap<string, MeasurementStaleEntry>> = shallowRef(new Map());
const nearbyGroupStale: ShallowRef<NearbyGroupStaleEntry | null> = shallowRef(null);
const spatialComputeMissingRefnos: ShallowRef<ReadonlySet<string>> = shallowRef(new Set());

/** 已知在模型中撤下/删除的构件键集合（装回场景后自动清除） */
const verifiedRemovedRefnos = new Set<string>();
/** 测量项首次标 stale 时的构件基准矩阵，支持连续多轮位移后再点「重测」仍按累计位移准确重算 */
const measurementBaselines = new Map<string, MeasurementPointBaseline>();

let preGetWorkSnapshots = new Map<string, PreGetWorkRefnoSnapshot>();
let preGetWorkGlobalMatrix: number[] | null = null;
let watcherInstalled = false;

export function extractRefnosFromToken(raw: string | null | undefined): string[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('o:')) {
    const parts = trimmed.split(':');
    const mid = toRefnoKey(String(parts[1] ?? '').replace(/^=/, ''));
    return /^\d+_\d+$/.test(mid) ? [mid] : [];
  }
  const tokens = trimmed.includes('~') ? trimmed.split('~') : [trimmed];
  const out: string[] = [];
  for (const token of tokens) {
    const key = toRefnoKey(token.trim().replace(/^=/, ''));
    if (/^\d+_\d+$/.test(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

export function extractMeasurementPointRefno(point: MeasurementPoint | null | undefined): string | null {
  if (!point) return null;
  const fromSource = extractRefnosFromToken(point.sourceInfo?.refno);
  if (fromSource.length > 0) return fromSource[0]!;
  const fromEntity = extractRefnosFromToken(point.entityId);
  return fromEntity[0] ?? null;
}

export function extractMeasurementRefnos(record: MeasurementRecord | XeokitMeasurementRecord): string[] {
  const points: MeasurementPoint[] = [];
  if (record.kind === 'elevation_point') {
    points.push(record.point);
  } else if (record.kind === 'angle') {
    points.push(record.origin, record.corner, record.target);
  } else {
    points.push(record.origin, record.target);
  }
  const out: string[] = [];
  for (const point of points) {
    const refno = extractMeasurementPointRefno(point);
    if (refno && !out.includes(refno)) out.push(refno);
  }
  return out;
}

export function extractClearanceRefnos(record: ClearanceRecord): {
  entityRefnos: string[];
  allRefnos: string[];
} {
  const entitySet = new Set<string>();
  for (const raw of [
    record.inputs.sourceRefno,
    record.inputs.targetRefno,
    record.provenance.source.refno,
    record.provenance.target.refno,
  ]) {
    for (const key of extractRefnosFromToken(raw)) entitySet.add(key);
  }
  const allSet = new Set<string>(entitySet);
  for (const leaf of [record.snapshot?.sourceLeafRefno, record.snapshot?.targetLeafRefno]) {
    for (const key of extractRefnosFromToken(leaf)) allSet.add(key);
  }
  return {
    entityRefnos: [...entitySet],
    allRefnos: [...allSet],
  };
}

function collectAllReferencedRefnos(): string[] {
  const set = new Set<string>();
  const toolStore = useToolStore();
  for (const rec of toolStore.measurements.value) {
    for (const refno of extractMeasurementRefnos(rec)) set.add(refno);
  }
  for (const rec of toolStore.allXeokitMeasurements.value) {
    for (const refno of extractMeasurementRefnos(rec)) set.add(refno);
  }
  const clearanceStore = useClearanceStore();
  for (const rec of clearanceStore.records.value) {
    for (const refno of extractClearanceRefnos(rec).allRefnos) set.add(refno);
  }
  const pipeStore = usePipeDistanceStore();
  if (pipeStore.nearbyGroup.value?.sourceRefno) {
    for (const refno of extractRefnosFromToken(pipeStore.nearbyGroup.value.sourceRefno)) set.add(refno);
  }
  const spatialCompute = peekSpatialComputeStore();
  if (spatialCompute) {
    const branState = spatialCompute.scenarios.branNearestClearance;
    if (branState.queriedSourceRefno) {
      for (const refno of extractRefnosFromToken(branState.queriedSourceRefno)) set.add(refno);
    }
    for (const group of branState.branGroups) {
      for (const candidate of group.candidates) {
        for (const refno of extractRefnosFromToken(candidate.refno)) set.add(refno);
      }
    }
  }
  return [...set];
}

function defaultIsLoaded(refno: string): boolean {
  try {
    return typeof dtxLoader.isDtxRefnoLoadedAcrossAllDbnos === 'function'
      ? dtxLoader.isDtxRefnoLoadedAcrossAllDbnos(refno)
      : false;
  } catch {
    return false;
  }
}

function defaultGetSignature(refno: string): string | null {
  try {
    return typeof dtxLoader.getDtxRefnoInstanceSignatureAcrossAllDbnos === 'function'
      ? dtxLoader.getDtxRefnoInstanceSignatureAcrossAllDbnos(refno)
      : null;
  } catch {
    return null;
  }
}

function defaultGetMatrix(refno: string): number[] | null {
  try {
    return typeof dtxLoader.getDtxRefnoPrimaryMatrixAcrossAllDbnos === 'function'
      ? dtxLoader.getDtxRefnoPrimaryMatrixAcrossAllDbnos(refno)
      : null;
  } catch {
    return null;
  }
}

function captureBeforeGetWork(probe: GetWorkMeasurementProbe = {}): void {
  const isLoaded = probe.isLoaded ?? defaultIsLoaded;
  const getSignature = probe.getSignature ?? defaultGetSignature;
  const getMatrix = probe.getMatrix ?? defaultGetMatrix;
  const next = new Map<string, PreGetWorkRefnoSnapshot>();
  for (const refno of collectAllReferencedRefnos()) {
    next.set(refno, {
      loaded: isLoaded(refno),
      signature: getSignature(refno),
      matrix: getMatrix(refno),
    });
  }
  preGetWorkSnapshots = next;
  preGetWorkGlobalMatrix = probe.getGlobalMatrix?.() ?? null;
}

function recoverLoadedMissingRefnos(isLoaded: (refno: string) => boolean = defaultIsLoaded): void {
  if (verifiedRemovedRefnos.size === 0) return;
  const recovered: string[] = [];
  for (const refno of [...verifiedRemovedRefnos]) {
    if (isLoaded(refno)) {
      verifiedRemovedRefnos.delete(refno);
      recovered.push(refno);
    }
  }
  if (recovered.length === 0) return;

  const clearanceStore = useClearanceStore();
  const clearIds: string[] = [];
  for (const [id] of clearanceStore.missingReasonById.value) {
    const rec = clearanceStore.findRecord(id);
    if (!rec) continue;
    const { entityRefnos } = extractClearanceRefnos(rec);
    if (entityRefnos.every(refno => !verifiedRemovedRefnos.has(refno))) {
      clearIds.push(id);
    }
  }
  if (clearIds.length > 0) clearanceStore.clearMissingInScene(clearIds);

  if (spatialComputeMissingRefnos.value.size > 0) {
    const nextSpatial = new Set(spatialComputeMissingRefnos.value);
    for (const refno of recovered) nextSpatial.delete(refno);
    spatialComputeMissingRefnos.value = nextSpatial;
  }

  const pipeGroup = usePipeDistanceStore().nearbyGroup.value;
  if (pipeGroup && nearbyGroupStale.value?.state === 'missing') {
    const srcRefnos = extractRefnosFromToken(pipeGroup.sourceRefno);
    if (srcRefnos.every(refno => !verifiedRemovedRefnos.has(refno))) {
      nearbyGroupStale.value = {
        state: 'changed',
        reason: STALE_CHANGED_REASON,
        canRedetect: true,
      };
    }
  }

  if (measurementStaleById.value.size > 0) {
    const nextMap = new Map(measurementStaleById.value);
    let mutated = false;
    for (const [id, entry] of nextMap) {
      if (entry.state !== 'missing') continue;
      const stillMissing = entry.missingRefnos.filter(refno => verifiedRemovedRefnos.has(refno));
      if (stillMissing.length === 0) {
        nextMap.set(id, {
          state: 'changed',
          reason: STALE_CHANGED_REASON,
          canRemeasure: true,
          changedRefnos: [...entry.changedRefnos, ...entry.missingRefnos],
          missingRefnos: [],
        });
        mutated = true;
      }
    }
    if (mutated) measurementStaleById.value = nextMap;
  }
}

export type ReconcileMeasurementsReport = {
  fates: ReadonlyMap<string, ComponentGetWorkFate>;
  staleMeasurementIds: string[];
  missingMeasurementIds: string[];
  staleClearanceIds: string[];
  missingClearanceIds: string[];
  staleBranCandidateKeys: string[];
};

/**
 * 「取最新」完成模型重载与撤下后，核对测量、净距抽屉、周边净距卡片与空间查询净距结果（#159）：
 * - 仅将本轮撤下或实例矩阵/几何发生变化的构件所关联的测量与净距标为过期，同库未变构件不误标；
 * - 仍在场景中的构件允许一键按最新模型重测，已被撤下/删除的构件标明「所测构件已不在场景中」并拦截无效重测。
 */
async function reconcileAfterGetWork(probe: GetWorkMeasurementProbe = {}): Promise<ReconcileMeasurementsReport> {
  const isLoaded = probe.isLoaded ?? defaultIsLoaded;
  const getSignature = probe.getSignature ?? defaultGetSignature;

  recoverLoadedMissingRefnos(isLoaded);

  const allRefnos = new Set<string>([
    ...preGetWorkSnapshots.keys(),
    ...collectAllReferencedRefnos(),
  ]);
  const fates = new Map<string, ComponentGetWorkFate>();
  const toProbeGone: string[] = [];

  for (const refno of allRefnos) {
    const before = preGetWorkSnapshots.get(refno);
    const nowLoaded = isLoaded(refno);
    const nowSig = getSignature(refno);
    if (nowLoaded) {
      verifiedRemovedRefnos.delete(refno);
      if (before?.loaded) {
        fates.set(refno, before.signature !== nowSig ? 'changed' : 'unchanged');
      } else {
        fates.set(refno, 'unchanged');
      }
      continue;
    }
    if (before?.loaded) {
      fates.set(refno, 'removed');
      verifiedRemovedRefnos.add(refno);
      continue;
    }
    if (verifiedRemovedRefnos.has(refno)) {
      fates.set(refno, 'removed');
      continue;
    }
    if (probe.probeNodeGone) {
      toProbeGone.push(refno);
    } else {
      fates.set(refno, 'unchanged');
    }
  }

  if (toProbeGone.length > 0 && probe.probeNodeGone) {
    const probeNodeGone = probe.probeNodeGone;
    await Promise.all(
      toProbeGone.map(async (refno) => {
        try {
          const gone = await probeNodeGone(refno);
          if (gone === true) {
            fates.set(refno, 'removed');
            verifiedRemovedRefnos.add(refno);
          } else {
            fates.set(refno, 'unchanged');
          }
        } catch {
          fates.set(refno, 'unchanged');
        }
      }),
    );
  }

  const staleClearanceIds: string[] = [];
  const missingClearanceIds: string[] = [];
  const clearanceStore = useClearanceStore();
  for (const record of clearanceStore.records.value) {
    const { entityRefnos, allRefnos: recordRefnos } = extractClearanceRefnos(record);
    const hasRemovedEntity = entityRefnos.some(refno => fates.get(refno) === 'removed');
    const hasRemovedLeafOnly = !hasRemovedEntity
      && recordRefnos.some(refno => fates.get(refno) === 'removed')
      && entityRefnos.every(refno => !isLoaded(refno));
    if (hasRemovedEntity || hasRemovedLeafOnly) {
      missingClearanceIds.push(record.id);
      staleClearanceIds.push(record.id);
      continue;
    }
    const hasChanged = recordRefnos.some(refno => fates.get(refno) === 'changed' || fates.get(refno) === 'removed');
    if (hasChanged) {
      staleClearanceIds.push(record.id);
    }
  }
  const changedOnlyClearanceIds = staleClearanceIds.filter(id => !missingClearanceIds.includes(id));
  if (changedOnlyClearanceIds.length > 0) {
    clearanceStore.markStale(changedOnlyClearanceIds);
    clearanceStore.clearMissingInScene(changedOnlyClearanceIds);
  }
  if (missingClearanceIds.length > 0) {
    clearanceStore.markMissingInScene(missingClearanceIds, STALE_MISSING_REASON);
  }

  const pipeStore = usePipeDistanceStore();
  const group = pipeStore.nearbyGroup.value;
  if (group) {
    const sourceKeys = extractRefnosFromToken(group.sourceRefno);
    const sourceRemoved = sourceKeys.some(refno => fates.get(refno) === 'removed');
    if (sourceRemoved) {
      nearbyGroupStale.value = {
        state: 'missing',
        reason: STALE_MISSING_REASON,
        canRedetect: false,
      };
    } else {
      const sourceChanged = sourceKeys.some(refno => fates.get(refno) === 'changed');
      const groupRecordTouched = group.records.some(rec => staleClearanceIds.includes(rec.id));
      if (sourceChanged || groupRecordTouched) {
        nearbyGroupStale.value = {
          state: 'changed',
          reason: STALE_CHANGED_REASON,
          canRedetect: true,
        };
      }
    }
  } else {
    nearbyGroupStale.value = null;
  }

  const spatialCompute = peekSpatialComputeStore();
  let staleBranCandidateKeys: string[] = [];
  if (spatialCompute) {
    const nextSpatialMissing = new Set(spatialComputeMissingRefnos.value);
    const branState = spatialCompute.scenarios.branNearestClearance;
    if (branState.queriedSourceRefno) {
      for (const key of extractRefnosFromToken(branState.queriedSourceRefno)) {
        if (fates.get(key) === 'removed') nextSpatialMissing.add(key);
      }
    }
    for (const g of branState.branGroups) {
      for (const c of g.candidates) {
        for (const key of extractRefnosFromToken(c.refno)) {
          if (fates.get(key) === 'removed') nextSpatialMissing.add(key);
        }
      }
    }
    spatialComputeMissingRefnos.value = nextSpatialMissing;

    staleBranCandidateKeys = spatialCompute.markBranCandidatesStale(({ sourceRefno, candidateRefno }) => {
      const refs = [
        ...extractRefnosFromToken(sourceRefno),
        ...extractRefnosFromToken(candidateRefno),
      ];
      return refs.some((refno) => {
        const fate = fates.get(refno);
        return fate === 'changed' || fate === 'removed';
      });
    });
  }

  const toolStore = useToolStore();
  const allMeasurements: (MeasurementRecord | XeokitMeasurementRecord)[] = [
    ...toolStore.measurements.value,
    ...toolStore.allXeokitMeasurements.value,
  ];
  const nextMeasurementStale = new Map(measurementStaleById.value);
  const staleMeasurementIds: string[] = [];
  const missingMeasurementIds: string[] = [];

  for (const rec of allMeasurements) {
    const refnos = extractMeasurementRefnos(rec);
    if (refnos.length === 0) continue;
    const missingRefnos = refnos.filter(refno => fates.get(refno) === 'removed' || verifiedRemovedRefnos.has(refno));
    const changedRefnos = refnos.filter(refno => fates.get(refno) === 'changed');
    if (missingRefnos.length === 0 && changedRefnos.length === 0) continue;

    if (!measurementBaselines.has(rec.id)) {
      const byRefno = new Map<string, number[]>();
      for (const refno of refnos) {
        const snapMat = preGetWorkSnapshots.get(refno)?.matrix;
        if (snapMat && snapMat.length === 16) byRefno.set(refno, [...snapMat]);
      }
      measurementBaselines.set(rec.id, {
        byRefno,
        globalMatrix: preGetWorkGlobalMatrix ? [...preGetWorkGlobalMatrix] : null,
      });
    }

    staleMeasurementIds.push(rec.id);
    if (missingRefnos.length > 0) {
      missingMeasurementIds.push(rec.id);
      nextMeasurementStale.set(rec.id, {
        state: 'missing',
        reason: STALE_MISSING_REASON,
        canRemeasure: false,
        changedRefnos,
        missingRefnos,
      });
    } else {
      nextMeasurementStale.set(rec.id, {
        state: 'changed',
        reason: STALE_CHANGED_REASON,
        canRemeasure: true,
        changedRefnos,
        missingRefnos: [],
      });
    }
  }
  measurementStaleById.value = nextMeasurementStale;
  preGetWorkSnapshots = new Map();
  preGetWorkGlobalMatrix = null;

  return {
    fates,
    staleMeasurementIds,
    missingMeasurementIds,
    staleClearanceIds,
    missingClearanceIds,
    staleBranCandidateKeys,
  };
}

function transformVec3ByMmDelta(
  point: Vec3,
  oldMmElements: readonly number[],
  newMmElements: readonly number[],
  oldSpaceFromMm: Matrix4,
  newSpaceFromMm: Matrix4,
): Vec3 | null {
  const mOld = new Matrix4().fromArray(oldMmElements);
  const mNew = new Matrix4().fromArray(newMmElements);
  if (Math.abs(mOld.determinant()) < 1e-18 || Math.abs(oldSpaceFromMm.determinant()) < 1e-18) {
    return null;
  }
  const delta = newSpaceFromMm
    .clone()
    .multiply(mNew)
    .multiply(mOld.invert())
    .multiply(oldSpaceFromMm.clone().invert());
  const transformed = new Vector3(point[0], point[1], point[2]).applyMatrix4(delta);
  if (![transformed.x, transformed.y, transformed.z].every(Number.isFinite)) return null;
  return [transformed.x, transformed.y, transformed.z];
}

function transformMeasurementPoint(
  point: MeasurementPoint,
  baseline: MeasurementPointBaseline | undefined,
  getMatrix: (refno: string) => number[] | null,
  currentGlobalMatrix: number[] | null,
): MeasurementPoint {
  const refno = extractMeasurementPointRefno(point);
  if (!refno) return point;
  const oldMm = baseline?.byRefno.get(refno);
  const newMm = getMatrix(refno);
  if (!oldMm || !newMm) return point;

  const oldSceneFromMm = baseline?.globalMatrix?.length === 16
    ? new Matrix4().fromArray(baseline.globalMatrix)
    : MM_TO_METERS_MATRIX;
  const newSceneFromMm = currentGlobalMatrix?.length === 16
    ? new Matrix4().fromArray(currentGlobalMatrix)
    : MM_TO_METERS_MATRIX;

  const nextWorldPos = transformVec3ByMmDelta(point.worldPos, oldMm, newMm, oldSceneFromMm, newSceneFromMm) ?? point.worldPos;
  const nextDesignPos = point.designWorldPos
    ? (transformVec3ByMmDelta(point.designWorldPos, oldMm, newMm, MM_TO_METERS_MATRIX, MM_TO_METERS_MATRIX) ?? point.designWorldPos)
    : undefined;

  return {
    ...point,
    worldPos: nextWorldPos,
    ...(nextDesignPos ? { designWorldPos: nextDesignPos } : {}),
  };
}

/**
 * 一键按最新模型重测单条测量记录（点对点距离 / 高程 / 高差 / 三点角）：
 * - 若任一端点所属构件已不在场景中，返回 `{ ok: false, reason: '所测构件已不在场景中' }`，不报错、不改坏旧记录；
 * - 若端点所属构件仍在场景中，按最新实例变换更新端点坐标与读数，清除过期标记。
 */
function remeasureMeasurement(
  id: string,
  probe: Omit<GetWorkMeasurementProbe, 'probeNodeGone'> = {},
): RemeasureResult {
  const isLoaded = probe.isLoaded ?? defaultIsLoaded;
  const getMatrix = probe.getMatrix ?? defaultGetMatrix;
  const currentGlobal = probe.getGlobalMatrix?.() ?? null;

  const toolStore = useToolStore();
  const xeokitRec = toolStore.allXeokitMeasurements.value.find(item => item.id === id);
  const classicRec = xeokitRec ? undefined : toolStore.measurements.value.find(item => item.id === id);
  const rec = xeokitRec ?? classicRec;
  if (!rec) return { ok: false, reason: '测量记录不存在' };

  const refnos = extractMeasurementRefnos(rec);
  const missing = refnos.filter(refno => verifiedRemovedRefnos.has(refno) || !isLoaded(refno));
  if (missing.length > 0) {
    const nextMap = new Map(measurementStaleById.value);
    const prev = nextMap.get(id);
    nextMap.set(id, {
      state: 'missing',
      reason: STALE_MISSING_REASON,
      canRemeasure: false,
      changedRefnos: prev?.changedRefnos ?? [],
      missingRefnos: missing,
    });
    measurementStaleById.value = nextMap;
    return { ok: false, reason: STALE_MISSING_REASON };
  }

  const baseline = measurementBaselines.get(id);
  if (xeokitRec) {
    if (xeokitRec.kind === 'distance') {
      const origin = transformMeasurementPoint(xeokitRec.origin, baseline, getMatrix, currentGlobal);
      const target = transformMeasurementPoint(xeokitRec.target, baseline, getMatrix, currentGlobal);
      toolStore.updateXeokitDistanceMeasurement(id, { origin, target });
    } else if (xeokitRec.kind === 'angle') {
      const origin = transformMeasurementPoint(xeokitRec.origin, baseline, getMatrix, currentGlobal);
      const corner = transformMeasurementPoint(xeokitRec.corner, baseline, getMatrix, currentGlobal);
      const target = transformMeasurementPoint(xeokitRec.target, baseline, getMatrix, currentGlobal);
      toolStore.updateXeokitAngleMeasurement(id, { origin, corner, target });
    } else if (xeokitRec.kind === 'elevation_point') {
      const point = transformMeasurementPoint(xeokitRec.point, baseline, getMatrix, currentGlobal);
      const z = (point.designWorldPos ?? point.worldPos)[2];
      toolStore.updateXeokitElevationPointMeasurement(id, {
        point,
        absoluteElevation: z,
        relativeElevation: z - xeokitRec.datumElevation,
      });
    } else {
      const origin = transformMeasurementPoint(xeokitRec.origin, baseline, getMatrix, currentGlobal);
      const target = transformMeasurementPoint(xeokitRec.target, baseline, getMatrix, currentGlobal);
      const oz = (origin.designWorldPos ?? origin.worldPos)[2];
      const tz = (target.designWorldPos ?? target.worldPos)[2];
      toolStore.updateXeokitElevationDeltaMeasurement(id, {
        origin,
        target,
        originElevation: oz,
        targetElevation: tz,
        deltaElevation: tz - oz,
      });
    }
  } else if (classicRec) {
    if (classicRec.kind === 'distance') {
      const origin = transformMeasurementPoint(classicRec.origin, baseline, getMatrix, currentGlobal);
      const target = transformMeasurementPoint(classicRec.target, baseline, getMatrix, currentGlobal);
      toolStore.replaceMeasurementRecord(id, { ...classicRec, origin, target });
    } else if (classicRec.kind === 'angle') {
      const origin = transformMeasurementPoint(classicRec.origin, baseline, getMatrix, currentGlobal);
      const corner = transformMeasurementPoint(classicRec.corner, baseline, getMatrix, currentGlobal);
      const target = transformMeasurementPoint(classicRec.target, baseline, getMatrix, currentGlobal);
      toolStore.replaceMeasurementRecord(id, { ...classicRec, origin, corner, target });
    } else if (classicRec.kind === 'elevation_point') {
      const point = transformMeasurementPoint(classicRec.point, baseline, getMatrix, currentGlobal);
      const z = (point.designWorldPos ?? point.worldPos)[2];
      toolStore.replaceMeasurementRecord(id, {
        ...classicRec,
        point,
        absoluteElevation: z,
        relativeElevation: z - classicRec.datumElevation,
      });
    } else {
      const origin = transformMeasurementPoint(classicRec.origin, baseline, getMatrix, currentGlobal);
      const target = transformMeasurementPoint(classicRec.target, baseline, getMatrix, currentGlobal);
      const oz = (origin.designWorldPos ?? origin.worldPos)[2];
      const tz = (target.designWorldPos ?? target.worldPos)[2];
      toolStore.replaceMeasurementRecord(id, {
        ...classicRec,
        origin,
        target,
        originElevation: oz,
        targetElevation: tz,
        deltaElevation: tz - oz,
      });
    }
  }

  measurementBaselines.delete(id);
  if (measurementStaleById.value.has(id)) {
    const nextMap = new Map(measurementStaleById.value);
    nextMap.delete(id);
    measurementStaleById.value = nextMap;
  }
  return { ok: true };
}

/**
 * 一键按最新模型重测单条净距记录：
 * - 若所测构件已撤下/不在场景中，写明「所测构件已不在场景中」并直接返回，不发起无效重测请求；
 * - 若仍在场景中，调用 `useClearanceStore().recompute` 更新最新距离与连线端点，恢复 `current`。
 */
async function remeasureClearance(
  id: string,
  options: ClearanceComputeOptions & { isLoaded?: (refno: string) => boolean } = {},
): Promise<RemeasureResult> {
  const clearanceStore = useClearanceStore();
  const record = clearanceStore.findRecord(id);
  if (!record) return { ok: false, reason: '净距记录不存在' };

  const missingReason = clearanceStore.getMissingReason(id);
  if (missingReason) {
    const isLoaded = options.isLoaded ?? defaultIsLoaded;
    const { entityRefnos } = extractClearanceRefnos(record);
    if (entityRefnos.some(refno => verifiedRemovedRefnos.has(refno) || !isLoaded(refno))) {
      clearanceStore.lastError.value = missingReason;
      return { ok: false, reason: missingReason };
    }
    clearanceStore.clearMissingInScene([id]);
  }

  const updated = await clearanceStore.recompute(id, options);
  if (!updated) {
    return { ok: false, reason: clearanceStore.lastError.value || '重测失败' };
  }
  return { ok: true };
}

function clearNearbyGroupStale(): void {
  nearbyGroupStale.value = null;
}

function getMeasurementStale(id: string): MeasurementStaleEntry | null {
  return measurementStaleById.value.get(id) ?? null;
}

function isSpatialComputeRefnoMissing(refno: string | null | undefined): boolean {
  const keys = extractRefnosFromToken(refno);
  return keys.some(key => spatialComputeMissingRefnos.value.has(key));
}

function installWatchers(): void {
  if (watcherInstalled) return;
  watcherInstalled = true;
  try {
    const rev = dtxLoader.dtxLoaderRevision;
    if (rev) {
      watch(rev, () => {
        recoverLoadedMissingRefnos();
      });
    }
  } catch {
    // 单测部分 mock useDbnoInstancesDtxLoader 未提供 dtxLoaderRevision 时安全跳过
  }
}

function resetForTests(): void {
  measurementStaleById.value = new Map();
  nearbyGroupStale.value = null;
  spatialComputeMissingRefnos.value = new Set();
  verifiedRemovedRefnos.clear();
  measurementBaselines.clear();
  preGetWorkSnapshots = new Map();
  preGetWorkGlobalMatrix = null;
  useClearanceStore().clearMissingInScene();
}

export function useGetWorkMeasurementSync() {
  installWatchers();
  return {
    measurementStaleById,
    nearbyGroupStale,
    spatialComputeMissingRefnos,
    captureBeforeGetWork,
    reconcileAfterGetWork,
    remeasureMeasurement,
    remeasureClearance,
    clearNearbyGroupStale,
    getMeasurementStale,
    isSpatialComputeRefnoMissing,
    resetForTests,
  };
}
