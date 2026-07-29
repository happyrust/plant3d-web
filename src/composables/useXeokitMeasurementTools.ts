import { computed, ref, watch, type Ref } from 'vue';

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

import { getDtxRefnoTransform } from './useDbnoInstancesDtxLoader';
import {
  useDbnoInstancesParquetLoader,
  type PrimitiveKeyPointCandidate,
} from './useDbnoInstancesParquetLoader';
import {
  MEASUREMENT_PICK_SOURCE_IDS,
  MEASUREMENT_PICK_SOURCE_LABELS,
  buildPositionPickCandidate,
  resolveMeasurementPickCandidates,
  sourceNeedsHoverData,
  type MeasurementPickCandidate,
  type MeasurementPickSourceId,
  type MeasurementPickSourceSettings,
  type ProjectedMeasurementPickCandidate,
} from './useMeasurementPickSources';
import { queryPtsetWithRuntimeFallback } from './usePtsetRuntimeLookup';
import { projectToCanvas, usePtsetSnap } from './usePtsetSnap';
import { usePtsetVisualizationThree } from './usePtsetVisualizationThree';
import { useUnitSettingsStore } from './useUnitSettingsStore';
import { useXeokitMeasurementStyleStore } from './useXeokitMeasurementStyleStore';
import { getXeokitOverlayPalette } from './xeokitMeasurementUi';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';
import type { DimensionSystem, ExternalDimensionRecord } from '@/dimension';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { getDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  useToolStore,
  type MeasurementPoint,
  type Vec3,
  type XeokitAngleDraft,
  type XeokitAngleMeasurementRecord,
  type XeokitDistanceDraft,
  type XeokitDistanceMeasurementRecord,
  type XeokitElevationDeltaDraft,
  type XeokitElevationDeltaMeasurementRecord,
  type XeokitElevationPointMeasurementRecord,
  type XeokitMarkerRole,
  type XeokitMeasurementRecord,
} from '@/composables/useToolStore';
import { getMeasurementPointElevation } from '@/utils/xeokitMeasurementFormat';

type ClickTracker = {
  down: { x: number; y: number } | null;
  moved: boolean;
};

type PickHit = {
  entityId: string;
  worldPos: Vector3;
  objectId: string;
  source: MeasurementPickSourceId;
  candidateId?: string;
  refno?: string | null;
  label?: string | null;
  pixelDistance?: number;
  sourcePriority?: number;
};
export type MeasurementViewerSnapCandidate = Readonly<{
  id: string;
  source: MeasurementPickSourceId;
  sceneWorld: Vec3;
  refno?: string;
  label?: string;
  distancePx: number;
  direction?: Vec3;
  circle?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
  arc?: Readonly<{ center: Vec3; rim: Vec3; normal: Vec3 }>;
}>;
type PtsetPickResult = {
  hit: PickHit | null;
  preview: PickHit | null;
  surfaceRefno: string | null;
  source: MeasurementPickSourceId | null;
  reason: string | null;
};
type PtsetLoadState = 'debouncing' | 'loading' | 'ready' | 'empty' | 'error';

const XEOKIT_PREFIX = 'xmeas_';
export const DIMENSION_XEOKIT_PREFIX = 'xeokit-measurement:';
const CLICK_TOLERANCE = 20;

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function vec3ToTuple(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function tupleToVector(v: Vec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

function sceneWorldToDesignMeters(world: Vector3, dtxLayerRef: Ref<DTXLayer | null>): Vector3 {
  const globalModelMatrix = dtxLayerRef.value?.getGlobalModelMatrix?.();
  if (!globalModelMatrix) return world.clone();

  const inverse = globalModelMatrix.clone();
  if (Math.abs(inverse.determinant()) <= 1e-12) return world.clone();

  const raw = world.clone().applyMatrix4(inverse.invert());
  return raw.multiply(new Vector3().setFromMatrixScale(globalModelMatrix));
}

function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(e.clientX - rect.left, e.clientY - rect.top);
}

function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  if (points.length === 0) return null;
  const box = new Box3();
  for (const point of points) {
    box.expandByPoint(tupleToVector(point));
  }
  if (box.isEmpty()) return null;
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

function isAngleDraft(record: XeokitMeasurementRecord): record is XeokitAngleDraft {
  return record.kind === 'angle' && 'stage' in record;
}

function formatDistance(meters: number, unit: string, precision: number): string {
  if (unit === 'mm') return `${(meters * 1000).toFixed(precision)} mm`;
  if (unit === 'cm') return `${(meters * 100).toFixed(precision)} cm`;
  if (unit === 'ft') return `${(meters * 3.28084).toFixed(precision)} ft`;
  if (unit === 'in') return `${(meters * 39.3701).toFixed(precision)} in`;
  return `${meters.toFixed(precision)} m`;
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function toDesignPoint(
  point: MeasurementPoint,
  fallback?: (point: Vec3) => readonly [number, number, number],
): readonly [number, number, number] {
  return point.designWorldPos ?? fallback?.(point.worldPos) ?? point.worldPos;
}

function xeokitMeasurementToExternalRecord(
  rec: XeokitMeasurementRecord,
  unit: string,
  precision: number,
  sceneWorldToDesignMetres?: (point: Vec3) => readonly [number, number, number],
  isDraft = false,
): ExternalDimensionRecord | null {
  const visible = isDraft || rec.visible !== false;
  if (!visible) return null;
  const id = `${DIMENSION_XEOKIT_PREFIX}${rec.id}`;
  const sourceLabel = isDraft ? 'Xeokit Measurement Draft' : 'Xeokit Measurement';

  if (rec.kind === 'distance') {
    const a = toDesignPoint(rec.origin, sceneWorldToDesignMetres);
    const b = toDesignPoint(rec.target, sceneWorldToDesignMetres);
    return {
      id,
      source: 'xeokit-measurement',
      sourceLabel,
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: formatDistance(distance(a, b), unit, precision),
        a,
        b,
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };
  }

  if (rec.kind === 'angle') {
    return {
      id,
      source: 'xeokit-measurement',
      sourceLabel,
      role: 'external',
      layout: {
        id,
        kind: 'angular',
        role: 'external',
        labelPinned: false,
        vertex: toDesignPoint(rec.corner, sceneWorldToDesignMetres),
        rayA: toDesignPoint(rec.origin, sceneWorldToDesignMetres),
        rayB: toDesignPoint(rec.target, sceneWorldToDesignMetres),
        placement: { radiusM: 0.5, labelT: 0.5, arcChoice: 'minor' },
      },
    };
  }

  if (rec.kind === 'elevation_delta') {
    const a = toDesignPoint(rec.origin, sceneWorldToDesignMetres);
    const b = toDesignPoint(rec.target, sceneWorldToDesignMetres);
    return {
      id,
      source: 'xeokit-measurement',
      sourceLabel,
      role: 'external',
      layout: {
        id,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        authoritativeText: formatDistance(rec.deltaElevation, unit, precision),
        a,
        b,
        placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
      },
    };
  }

  const at = toDesignPoint(rec.point, sceneWorldToDesignMetres);
  return {
    id,
    source: 'xeokit-measurement',
    sourceLabel,
    role: 'external',
    category: 'annotation',
    layout: {
      id,
      role: 'external',
      labelPinned: false,
      formattedLabel: formatDistance(rec.absoluteElevation, unit, precision),
      lines: [],
      labelAnchor: at,
      arrowLines: [],
      markers: [{ at, shape: 'circle', radiusPx: 4 }],
      texts: [{
        text: `REL ${formatDistance(rec.relativeElevation, unit, precision)}`,
        anchor: at,
        stackIndex: 1,
      }],
    },
  };
}

export function useXeokitMeasurementTools(options: {
  dtxViewerRef: Ref<DtxViewer | null>;
  dtxLayerRef: Ref<DTXLayer | null>;
  selectionRef: Ref<DTXSelectionController | null>;
  overlayContainerRef: Ref<HTMLElement | null>;
  annotationSystemRef?: Ref<UseAnnotationThreeReturn | null>;
  getDimensionSystem?: () => DimensionSystem | null | undefined;
  sceneWorldToDesignMetres?: (point: Vec3) => readonly [number, number, number];
  store: ReturnType<typeof useToolStore>;
  compatViewerRef: Ref<DtxCompatViewer | null>;
  requestRender?: (() => void) | null;
  suppressStoreMeasurements?: boolean;
}) {
  const {
    dtxViewerRef,
    dtxLayerRef,
    selectionRef,
    overlayContainerRef,
    compatViewerRef,
    store,
  } = options;
  const requestRender = options.requestRender ?? null;
  const suppressStoreMeasurements = options.suppressStoreMeasurements === true;
  const measurementStyle = useXeokitMeasurementStyleStore();
  const unitSettings = useUnitSettingsStore();
  const parquetLoader = useDbnoInstancesParquetLoader();

  const readyRevision = ref(0);
  const clickTracker = ref<ClickTracker>({ down: null, moved: false });
  let hoverMarkerEl: HTMLDivElement | null = null;
  let pointerLensEl: HTMLDivElement | null = null;
  const hoverPickCandidateGroup = new Group();
  hoverPickCandidateGroup.name = 'measurement-hover-pick-candidates';
  hoverPickCandidateGroup.renderOrder = 985;
  hoverPickCandidateGroup.matrixAutoUpdate = false;

  // ── 关键点(ptset) hover 显示 + 吸附 ───────────────────────────────────
  // hover 构件时按 refno 防抖拉取其关键点：候选用于吸附，并以轻量十字显示；
  // 取点时把表面交点吸附到最近关键点。
  const ptsetSnap = usePtsetSnap({
    getGlobalModelMatrix: () => dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null,
  });
  // 复用 ptset 渲染器作为测量态轻量显示层：仅显示十字，关闭标签/箭头。
  const ptsetHoverViz = usePtsetVisualizationThree(dtxViewerRef, overlayContainerRef, {
    requestRender,
    getGlobalModelMatrix: () => dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null,
  });
  ptsetHoverViz.setLabelsVisible(false);
  ptsetHoverViz.setArrowsVisible(false);

  const requestedPtsetRefnos = new Set<string>();
  const ptsetResponseByRefno = new Map<string, PtsetResponse>();
  const ptsetErrorByRefno = new Map<string, string>();
  const ptsetLoadStateByRefno = new Map<string, PtsetLoadState>();
  const requestedPrimitiveKeypointRefnos = new Set<string>();
  const primitiveKeypointsByRefno = new Map<string, PrimitiveKeyPointCandidate[]>();
  const primitiveKeypointErrorByRefno = new Map<string, string>();
  const pickPointMessage = ref<string | null>(null);
  let hoverFetchTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingHoverRefno: string | null = null;
  let currentHoverRefno: string | null = null;
  let shownPtsetKey: string | null = null;
  const lockedMeasurementRefnos = new Set<string>();
  const lockedMeasurementXrayRefnos = new Set<string>();
  const temporaryXrayRefnos = new Set<string>();

  function ensureHoverPickCandidateGroupAttached(): void {
    const viewer = dtxViewerRef.value;
    if (!viewer?.scene) return;
    if (hoverPickCandidateGroup.parent !== viewer.scene) {
      try { hoverPickCandidateGroup.parent?.remove(hoverPickCandidateGroup); } catch { /* ignore */ }
      viewer.scene.add(hoverPickCandidateGroup);
    }
  }

  function clearHoverPickCandidates(): void {
    for (const child of [...hoverPickCandidateGroup.children]) {
      hoverPickCandidateGroup.remove(child);
      const line = child as LineSegments;
      try { line.geometry?.dispose(); } catch { /* ignore */ }
      try {
        const material = line.material;
        if (Array.isArray(material)) {
          for (const item of material) item.dispose();
        } else {
          material?.dispose();
        }
      } catch { /* ignore */ }
    }
    requestRender?.();
  }

  function sourceCandidateColor(source: MeasurementPickSourceId): number {
    if (source === 'position') return 0xa855f7;
    if (source === 'mesh_pick_point') return 0x38bdf8;
    if (source === 'primitive_key_point') return 0xf97316;
    return 0x22c55e;
  }

  function createCandidateCross(pos: Vector3, source: MeasurementPickSourceId): LineSegments {
    const size = source === 'mesh_pick_point' ? 0.18 : 0.38;
    const positions = [
      pos.x - size, pos.y, pos.z, pos.x + size, pos.y, pos.z,
      pos.x, pos.y - size, pos.z, pos.x, pos.y + size, pos.z,
      pos.x, pos.y, pos.z - size, pos.x, pos.y, pos.z + size,
    ];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 3, 4, 5]), 1));
    const material = new LineBasicMaterial({ color: sourceCandidateColor(source) });
    (material as any).depthTest = false;
    const line = new LineSegments(geometry, material);
    line.renderOrder = hoverPickCandidateGroup.renderOrder;
    line.userData.noPick = true;
    return line;
  }

  function showHoverPickCandidates(candidates: readonly ProjectedMeasurementPickCandidate[]): void {
    clearHoverPickCandidates();
    ensureHoverPickCandidateGroupAttached();
    if (!hoverPickCandidateGroup.parent) return;
    for (const candidate of candidates) {
      if (candidate.source === 'ptset') continue;
      hoverPickCandidateGroup.add(createCandidateCross(candidate.worldPos, candidate.source));
    }
    requestRender?.();
  }

  function refnoFromObjectId(objectId: string | null | undefined): string | null {
    if (!objectId || !objectId.startsWith('o:')) return null;
    const parts = objectId.split(':');
    return parts.length >= 3 ? (parts[1] ?? null) : null;
  }

  function renderMeasurementPtsets(hoverRefno: string | null): void {
    if (!measurementStyle.state.measurementPickSources.ptset.show) {
      if (shownPtsetKey !== null) {
        ptsetHoverViz.clearVisualization();
        shownPtsetKey = null;
      }
      return;
    }

    const refnos = Array.from(new Set([
      ...lockedMeasurementRefnos,
      ...(hoverRefno ? [hoverRefno] : []),
    ]));
    const entries = refnos
      .map((refno) => ({ refno, resp: ptsetResponseByRefno.get(refno) }))
      .filter((entry): entry is { refno: string; resp: PtsetResponse } =>
        !!entry.resp?.success && entry.resp.ptset.length > 0,
      );
    const key = entries.map((entry) => entry.refno).join('|');
    if (key === shownPtsetKey) return;
    if (entries.length === 0) {
      ptsetHoverViz.clearVisualization();
      shownPtsetKey = null;
      return;
    }
    ptsetHoverViz.renderPtset(entries[0].refno, entries[0].resp);
    for (const entry of entries.slice(1)) {
      ptsetHoverViz.appendPtset(entry.refno, entry.resp, { setCurrent: false });
    }
    ptsetHoverViz.setVisible(true);
    shownPtsetKey = key;
  }

  function showHoverPtset(refno: string | null): void {
    renderMeasurementPtsets(refno);
  }

  function clearHoverPtset(): void {
    if (hoverFetchTimer !== null) {
      clearTimeout(hoverFetchTimer);
      hoverFetchTimer = null;
    }
    if (pendingHoverRefno && ptsetLoadStateByRefno.get(pendingHoverRefno) === 'debouncing') {
      ptsetLoadStateByRefno.delete(pendingHoverRefno);
    }
    pendingHoverRefno = null;
    currentHoverRefno = null;
    pickPointMessage.value = null;
    if (shownPtsetKey !== null) {
      ptsetHoverViz.clearVisualization();
      shownPtsetKey = null;
    }
  }

  function scheduleHoverPtsetFetch(refno: string | null): void {
    if (!sourceNeedsHoverData(measurementStyle.state.measurementPickSources.ptset) || !refno) return;
    if (requestedPtsetRefnos.has(refno) || ptsetSnap.hasCandidates(refno)) return;
    if (
      pendingHoverRefno
      && pendingHoverRefno !== refno
      && ptsetLoadStateByRefno.get(pendingHoverRefno) === 'debouncing'
    ) {
      ptsetLoadStateByRefno.delete(pendingHoverRefno);
    }
    pendingHoverRefno = refno;
    ptsetLoadStateByRefno.set(refno, 'debouncing');
    if (hoverFetchTimer !== null) clearTimeout(hoverFetchTimer);
    hoverFetchTimer = setTimeout(() => {
      hoverFetchTimer = null;
      const r = pendingHoverRefno;
      pendingHoverRefno = null;
      if (!r || requestedPtsetRefnos.has(r)) return;
      if (ptsetSnap.hasCandidates(r)) {
        ptsetLoadStateByRefno.set(r, 'ready');
        return;
      }
      requestedPtsetRefnos.add(r);
      ptsetLoadStateByRefno.set(r, 'loading');
      let dbno: number;
      try {
        dbno = getDbnumByRefno(r);
      } catch (error) {
        ptsetErrorByRefno.set(r, error instanceof Error ? error.message : String(error));
        ptsetLoadStateByRefno.set(r, 'error');
        return;
      }
      queryPtsetForMeasurement(dbno, r)
        .then((resp) => {
          if (resp?.success && resp.ptset.length > 0) {
            ptsetResponseByRefno.set(r, resp);
            ptsetErrorByRefno.delete(r);
            ptsetSnap.upsertCandidates(r, resp);
            ptsetLoadStateByRefno.set(r, 'ready');
            if (currentHoverRefno === r || lockedMeasurementRefnos.has(r)) {
              showHoverPtset(currentHoverRefno);
            }
            requestRender?.();
            return;
          }
          ptsetErrorByRefno.set(r, resp?.error_message || '当前构件没有可用 ptset');
          ptsetLoadStateByRefno.set(r, 'empty');
          requestRender?.();
        })
        .catch((error) => {
          ptsetErrorByRefno.set(r, error instanceof Error ? error.message : String(error));
          ptsetLoadStateByRefno.set(r, 'error');
          requestRender?.();
        });
    }, 80);
  }

  async function queryPtsetForMeasurement(dbno: number, refno: string): Promise<PtsetResponse> {
    return await queryPtsetWithRuntimeFallback(parquetLoader, dbno, refno);
  }

  function isPtsetPickPending(refno: string | null): boolean {
    if (!refno || !measurementStyle.state.measurementPickSources.ptset.snap) return false;
    // 仅 E3D 模式拦截 pending：自由表面模式允许直接落表面点。
    if (measurementStyle.state.measurementPickMode !== 'e3d') return false;
    const state = ptsetLoadStateByRefno.get(refno);
    return state === 'debouncing' || state === 'loading';
  }

  function refnoFromMeasurementPoint(point: MeasurementPoint | null | undefined): string | null {
    const sourceRefno = String(point?.sourceInfo?.refno ?? '').trim();
    if (sourceRefno) return sourceRefno.replace(/\//g, '_');
    return refnoFromObjectId(point?.entityId);
  }

  function xrayRefnoFromMeasurementPoint(point: MeasurementPoint | null | undefined): string | null {
    if (point?.sourceInfo?.source !== 'ptset') return null;
    return refnoFromMeasurementPoint(point);
  }

  function xrayRefnoFromPickHit(hit: PickHit | null | undefined): string | null {
    if (hit?.source !== 'ptset') return null;
    return String(hit.refno || refnoFromObjectId(hit.objectId) || '').trim() || null;
  }

  function addLockedMeasurementPoint(point: MeasurementPoint): void {
    const refno = refnoFromMeasurementPoint(point);
    if (!refno) return;
    lockedMeasurementRefnos.add(refno);
    const xrayRefno = xrayRefnoFromMeasurementPoint(point);
    if (xrayRefno) lockedMeasurementXrayRefnos.add(xrayRefno);
    scheduleHoverPtsetFetch(refno);
    renderMeasurementPtsets(currentHoverRefno);
  }

  function updateTemporaryXray(refnos: (string | null | undefined)[]): void {
    const compat = compatViewerRef.value;
    if (!compat?.scene) return;

    const next = new Set(refnos.map((refno) => String(refno || '').trim()).filter(Boolean));
    for (const refno of Array.from(temporaryXrayRefnos)) {
      if (next.has(refno)) continue;
      compat.scene.setObjectsXRayed([refno], false);
      temporaryXrayRefnos.delete(refno);
    }

    for (const refno of next) {
      const wasXRayed = compat.scene.objects?.[refno]?.xrayed === true;
      if (!wasXRayed) {
        temporaryXrayRefnos.add(refno);
      }
      compat.scene.setObjectsXRayed([refno], true);
    }
    requestRender?.();
  }

  function syncMeasurementVisualAssists(hoverRefno: string | null, hit: PickHit | null = null): void {
    updateTemporaryXray([...lockedMeasurementXrayRefnos, xrayRefnoFromPickHit(hit)]);
    renderMeasurementPtsets(hoverRefno);
  }

  function clearMeasurementVisualAssists(): void {
    const compat = compatViewerRef.value;
    if (compat?.scene && temporaryXrayRefnos.size > 0) {
      compat.scene.setObjectsXRayed(Array.from(temporaryXrayRefnos), false);
    }
    temporaryXrayRefnos.clear();
    lockedMeasurementRefnos.clear();
    lockedMeasurementXrayRefnos.clear();
    clearHoverPtset();
    requestRender?.();
  }

  /**
   * 连续测量链节点保持：只清掉与下一段起点无关的锁定/X-ray 辅助态，
   * 避免「全清再重锁」导致 P-Point 十字与构件透明态闪断。
   */
  function retainMeasurementVisualAssistsFor(point: MeasurementPoint): void {
    const keepRefno = refnoFromMeasurementPoint(point);
    const keepXrayRefno = xrayRefnoFromMeasurementPoint(point);
    for (const refno of Array.from(lockedMeasurementRefnos)) {
      if (refno !== keepRefno) lockedMeasurementRefnos.delete(refno);
    }
    for (const refno of Array.from(lockedMeasurementXrayRefnos)) {
      if (refno !== keepXrayRefno) lockedMeasurementXrayRefnos.delete(refno);
    }
    updateTemporaryXray([...lockedMeasurementXrayRefnos]);
    renderMeasurementPtsets(currentHoverRefno);
  }

  function ensurePrimitiveKeypointsForRefno(refno: string | null): void {
    if (!sourceNeedsHoverData(measurementStyle.state.measurementPickSources.primitive_key_point) || !refno) return;
    if (requestedPrimitiveKeypointRefnos.has(refno) || primitiveKeypointsByRefno.has(refno)) return;

    requestedPrimitiveKeypointRefnos.add(refno);
    let dbno: number;
    try {
      dbno = getDbnumByRefno(refno);
    } catch (error) {
      primitiveKeypointErrorByRefno.set(refno, error instanceof Error ? error.message : String(error));
      return;
    }

    parquetLoader.queryPrimitiveKeypointsByRefnoFromParquet(dbno, refno)
      .then((items) => {
        primitiveKeypointsByRefno.set(refno, items);
        if (items.length > 0) {
          primitiveKeypointErrorByRefno.delete(refno);
        } else {
          primitiveKeypointErrorByRefno.set(refno, '当前构件没有 Primitive Key Point 候选');
        }
        requestRender?.();
      })
      .catch((error) => {
        primitiveKeypointErrorByRefno.set(refno, error instanceof Error ? error.message : String(error));
      });
  }

  function ptsetMissReason(refno: string | null): string {
    if (!measurementStyle.state.measurementPickSources.ptset.snap) {
      return 'P-Point 捕捉已关闭';
    }
    if (!refno) return '当前未命中模型实例，无法确定 P-Point 来源';
    const error = ptsetErrorByRefno.get(refno);
    if (error) return error;
    if (!requestedPtsetRefnos.has(refno)) return '正在准备读取 ptsets.parquet，请稍候再靠近关键点';
    if (!ptsetSnap.hasCandidates(refno)) return '当前模型包未提供该构件的 P-Point，无法登记测量点';
    return '请将光标靠近构件 P-Point 后再点击';
  }

  function primitiveKeypointMissReason(refno: string | null): string {
    if (!measurementStyle.state.measurementPickSources.primitive_key_point.snap) {
      return 'Primitive Key Point 捕捉已关闭';
    }
    if (!refno) return '当前未命中模型实例，无法确定 Primitive Key Point 来源';
    const error = primitiveKeypointErrorByRefno.get(refno);
    if (error) return error;
    if (!requestedPrimitiveKeypointRefnos.has(refno)) {
      return '正在准备读取 primitive_keypoints.parquet，请稍候再靠近关键点';
    }
    if ((primitiveKeypointsByRefno.get(refno)?.length ?? 0) === 0) {
      return '当前模型包未提供该构件的 Primitive Key Point，无法登记测量点';
    }
    return '请将光标靠近 Primitive Key Point 后再点击';
  }

  function enabledSnapSources(): MeasurementPickSourceId[] {
    return MEASUREMENT_PICK_SOURCE_IDS.filter((id) => (
      measurementStyle.state.measurementPickSources[id]?.snap
    ));
  }

  function sourceLabels(sources: readonly MeasurementPickSourceId[]): string {
    return sources.map((id) => MEASUREMENT_PICK_SOURCE_LABELS[id]).join(' / ');
  }

  function activeSnapSourceText(): string {
    const sources = enabledSnapSources();
    return sources.length > 0 ? sourceLabels(sources) : '未启用捕捉点源';
  }

  function buildMissReason(refno: string | null): string {
    const sources = enabledSnapSources();
    if (sources.length === 0) return '未启用任何测量点源捕捉';
    if (sources.includes('ptset')) return ptsetMissReason(refno);
    if (sources.includes('primitive_key_point')) return primitiveKeypointMissReason(refno);

    const unavailable = sources.filter((source) => (
      source === 'position' || source === 'primitive_key_point'
    ));
    if (unavailable.length > 0) {
      return `已启用的点源当前没有可用候选：${sourceLabels(unavailable)}`;
    }

    return `当前未捕捉到已启用点源：${sourceLabels(sources)}`;
  }

  function buildPtsetCandidates(): MeasurementPickCandidate[] {
    const setting = measurementStyle.state.measurementPickSources.ptset;
    if (!sourceNeedsHoverData(setting)) return [];
    // ponytail: scan only the hover-loaded cache; add a screen-space index if profiling shows this grows large.
    return ptsetSnap.getCandidates().map((candidate) => ({
      id: `ptset:${candidate.refno}#${candidate.number}`,
      source: 'ptset',
      entityId: `ptset:${candidate.refno}#${candidate.number}`,
      objectId: `o:${candidate.refno}:ptset`,
      worldPos: new Vector3(candidate.worldPos[0], candidate.worldPos[1], candidate.worldPos[2]),
      label: `P-Point #${candidate.number}`,
    }));
  }

  function buildMeshPickCandidate(base: PickHit | null): MeasurementPickCandidate[] {
    if (!base) return [];
    const setting = measurementStyle.state.measurementPickSources.mesh_pick_point;
    if (!sourceNeedsHoverData(setting)) return [];
    return [{
      id: `mesh:${base.objectId}`,
      source: 'mesh_pick_point',
      entityId: base.entityId,
      objectId: base.objectId,
      worldPos: base.worldPos.clone(),
      label: MEASUREMENT_PICK_SOURCE_LABELS.mesh_pick_point,
    }];
  }

  function buildPositionCandidates(base: PickHit | null, refno: string | null): MeasurementPickCandidate[] {
    if (!base || !refno) return [];
    const setting = measurementStyle.state.measurementPickSources.position;
    if (!sourceNeedsHoverData(setting)) return [];

    let transform: number[] | undefined;
    try {
      const dbno = getDbnumByRefno(refno);
      transform = getDtxRefnoTransform(dbno, refno);
    } catch {
      return [];
    }

    const candidate = buildPositionPickCandidate({
      refno,
      objectId: base.objectId,
      transform,
      globalModelMatrix: dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null,
    });
    return candidate ? [candidate] : [];
  }

  function primitiveKeyPointCandidates(
    refno: string,
    objectId: string,
  ): MeasurementPickCandidate[] {
    const globalModelMatrix = dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null;
    return (primitiveKeypointsByRefno.get(refno) ?? []).map((candidate) => {
      const worldPos = new Vector3(candidate.world[0], candidate.world[1], candidate.world[2]);
      if (globalModelMatrix) worldPos.applyMatrix4(globalModelMatrix);
      const direction = candidate.dir
        ? new Vector3(...candidate.dir)
        : null;
      if (direction && globalModelMatrix) {
        direction.transformDirection(globalModelMatrix);
      }
      const circularGeometry = (
        geometry: PrimitiveKeyPointCandidate['circle'],
      ) => {
        if (!geometry) return null;
        const center = new Vector3(...geometry.center);
        const rim = new Vector3(...geometry.rim);
        const normal = new Vector3(...geometry.normal);
        if (globalModelMatrix) {
          center.applyMatrix4(globalModelMatrix);
          rim.applyMatrix4(globalModelMatrix);
          normal.transformDirection(globalModelMatrix);
        }
        return { center, rim, normal };
      };
      const circle = circularGeometry(candidate.circle);
      const arc = circularGeometry(candidate.arc);
      return {
        id: candidate.id,
        source: 'primitive_key_point' as const,
        entityId: candidate.id,
        objectId,
        worldPos,
        label: `${MEASUREMENT_PICK_SOURCE_LABELS.primitive_key_point} #${candidate.keypointIndex}`,
        ...(direction ? { direction } : {}),
        ...(circle ? { circle } : {}),
        ...(arc ? { arc } : {}),
      };
    });
  }

  function buildPrimitiveKeyPointCandidates(
    base: PickHit | null,
    refno: string | null,
  ): MeasurementPickCandidate[] {
    if (!base || !refno) return [];
    const setting = measurementStyle.state.measurementPickSources.primitive_key_point;
    if (!sourceNeedsHoverData(setting)) return [];
    return primitiveKeyPointCandidates(refno, base.objectId);
  }

  function candidateToPickHit(candidate: MeasurementPickCandidate | ProjectedMeasurementPickCandidate): PickHit {
    const pixelDistance =
      'pixelDistance' in candidate && Number.isFinite(candidate.pixelDistance)
        ? candidate.pixelDistance
        : undefined;
    return {
      entityId: candidate.entityId,
      objectId: candidate.objectId,
      worldPos: candidate.worldPos.clone(),
      source: candidate.source,
      candidateId: candidate.id,
      refno: refnoFromObjectId(candidate.objectId),
      label: candidate.label,
      pixelDistance,
      sourcePriority: measurementStyle.state.measurementPickSources[candidate.source]?.priority,
    };
  }

  function measurementPointFromHit(hit: PickHit): MeasurementPoint {
    return {
      entityId: hit.entityId,
      worldPos: vec3ToTuple(hit.worldPos),
      designWorldPos: vec3ToTuple(sceneWorldToDesignMeters(hit.worldPos, dtxLayerRef)),
      sourceInfo: {
        source: hit.source,
        candidateId: hit.candidateId,
        refno: hit.refno ?? refnoFromObjectId(hit.objectId),
        label: hit.label ?? null,
      },
    };
  }

  function hasApproximatePoint(...points: MeasurementPoint[]): boolean {
    return points.some((point) => point.sourceInfo?.source === 'mesh_pick_point');
  }

  /** 以已有测量点为起点创建新的距离草稿（连续测量 / Repeat 共用）。 */
  function startDistanceDraftFrom(point: MeasurementPoint): void {
    addLockedMeasurementPoint(point);
    store.setCurrentXeokitDistanceDraft({
      id: nowId('xdist'),
      kind: 'distance',
      origin: point,
      target: point,
      visible: true,
      approximate: true,
      createdAt: Date.now(),
    });
  }

  /**
   * E3D Repeat Measure：以「选中优先」的距离测量终点为起点继续下一段；
   * 未选中（或选中的不是距离测量）时回落到 createdAt 最新一条。
   */
  function repeatLastDistanceMeasurement(): boolean {
    if (suppressStoreMeasurements) return false;
    if (store.toolMode.value !== 'xeokit_measure_distance') return false;
    if (store.currentXeokitDistanceDraft.value) return false;
    const records = store.xeokitDistanceMeasurements.value;
    if (records.length === 0) return false;
    const activeId = store.activeXeokitMeasurementId.value;
    const active = activeId
      ? records.find((record) => record.id === activeId) ?? null
      : null;
    const source = active
      ?? records.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
    startDistanceDraftFrom(source.target);
    syncFromStore();
    requestRender?.();
    return true;
  }

  const currentMeasurement = computed(() => {
    return store.currentXeokitDistanceDraft.value
      ?? store.currentXeokitAngleDraft.value
      ?? store.currentXeokitElevationPointDraft.value
      ?? store.currentXeokitElevationDeltaDraft.value
      ?? null;
  });
  const selectedMeasurement = computed(() => {
    const id = store.activeXeokitMeasurementId.value;
    if (!id) return null;
    return store.allXeokitMeasurements.value.find((item) => item.id === id) ?? null;
  });
  const hasVisibleMeasurements = computed(() => {
    return store.allXeokitMeasurements.value.some((item) => item.visible);
  });
  const hasHiddenMeasurements = computed(() => {
    return store.allXeokitMeasurements.value.some((item) => !item.visible);
  });

  const ready = computed(() => {
    const revision = readyRevision.value;
    void revision;
    if (!dtxViewerRef.value || !dtxLayerRef.value || !selectionRef.value) return false;
    const layer = dtxLayerRef.value as any;
    const totalObjects = Number(layer?._totalObjects ?? layer?.objectCount ?? layer?.getStats?.()?.totalObjects ?? 0);
    return totalObjects > 0;
  });

  const statusText = computed(() => {
    const mode = store.toolMode.value;
    if (
      mode !== 'xeokit_measure_distance' &&
      mode !== 'xeokit_measure_angle' &&
      mode !== 'xeokit_measure_elevation_point' &&
      mode !== 'xeokit_measure_elevation_delta'
    ) {
      return '当前非测量模式';
    }
    if (!dtxViewerRef.value) return '三维查看器未初始化';
    if (!dtxLayerRef.value) return 'DTX 图层未初始化';
    if (!selectionRef.value) return '拾取控制器未就绪';
    if (!ready.value) return '等待测量所需模型就绪…';

    const sourceText = activeSnapSourceText();
    if (enabledSnapSources().length === 0) {
      return '测量模式：未启用任何测量点源捕捉';
    }

    if (mode === 'xeokit_measure_distance') {
      return store.currentXeokitDistanceDraft.value
        ? `距离测量：捕捉终点（${sourceText}）；点空白取消当前点选`
        : `距离测量：捕捉起点（${sourceText}）`;
    }

    if (mode === 'xeokit_measure_angle') {
      const draft = store.currentXeokitAngleDraft.value;
      if (!draft) return `角度测量：捕捉角度顶点（${sourceText}）`;
      if (draft.stage === 'finding_first_arm') return `角度测量：捕捉第一边点（${sourceText}）；点空白取消当前点选`;
      return `角度测量：捕捉第二边点（${sourceText}）；点空白取消当前点选`;
    }

    if (mode === 'xeokit_measure_elevation_point') {
      return `位置/标高：捕捉测量点（${sourceText}），单击完成；点空白取消当前点选`;
    }

    return store.currentXeokitElevationDeltaDraft.value
      ? `高差测量：捕捉终点（${sourceText}）；点空白取消当前点选`
      : `高差测量：捕捉起点（${sourceText}），第二点 hover 预览`;
  });

  function refreshReadyState() {
    readyRevision.value += 1;
  }

  function isActiveMode() {
    return store.toolMode.value === 'xeokit_measure_distance'
      || store.toolMode.value === 'xeokit_measure_angle'
      || store.toolMode.value === 'xeokit_measure_elevation_point'
      || store.toolMode.value === 'xeokit_measure_elevation_delta';
  }

  function pickModelSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): PickHit | null {
    const selection = selectionRef.value;
    if (selection) {
      const hit = selection.pickPoint(getCanvasPos(canvas, e));
      if (hit) {
        return {
          entityId: hit.objectId,
          objectId: hit.objectId,
          worldPos: hit.point.clone(),
          source: 'mesh_pick_point',
        };
      }
    }

    return null;
  }

  function pickAnnotationPoint(canvas: HTMLCanvasElement, e: PointerEvent): PickHit | null {
    const annotationSystem = options.annotationSystemRef?.value ?? null;
    const viewer = dtxViewerRef.value;
    const annotationsMap = annotationSystem?.annotations?.value;
    if (!viewer?.camera || !(annotationsMap instanceof Map) || annotationsMap.size === 0) return null;

    const canvasPos = getCanvasPos(canvas, e);
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2((canvasPos.x / rect.width) * 2 - 1, -(canvasPos.y / rect.height) * 2 + 1);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, viewer.camera);

    const prevThreshold = raycaster.params.Line?.threshold;
    if (raycaster.params.Line) {
      raycaster.params.Line.threshold = 0.1;
    }

    let closest: { entityId: string; worldPos: Vector3; objectId: string; distance: number } | null = null;

    for (const [id, annotation] of annotationsMap.entries()) {
      if (!annotation?.visible) continue;
      if (id.startsWith(XEOKIT_PREFIX)) continue;

      const annotationUserData = (annotation as any).userData as Record<string, unknown> | undefined;
      if (annotationUserData?.pickable === false || annotationUserData?.noPick === true) continue;

      let intersects: { object: { userData?: Record<string, unknown> }; point: Vector3; distance: number }[] = [];
      try {
        intersects = raycaster.intersectObject(annotation as any, true) as {
          object: { userData?: Record<string, unknown> };
          point: Vector3;
          distance: number;
        }[];
      } catch {
        continue;
      }

      for (const hit of intersects) {
        const hitUserData = hit.object?.userData;
        if (hitUserData?.pickable === false || hitUserData?.noPick === true) continue;

        if (!closest || hit.distance < closest.distance) {
          closest = {
            entityId: `annotation:${id}`,
            objectId: id,
            worldPos: hit.point.clone(),
            distance: hit.distance,
          };
        }
        break;
      }
    }

    if (raycaster.params.Line && prevThreshold !== undefined) {
      raycaster.params.Line.threshold = prevThreshold;
    }

    return closest
      ? {
        entityId: closest.entityId,
        objectId: closest.objectId,
        worldPos: closest.worldPos,
        source: 'mesh_pick_point',
        candidateId: `annotation:${closest.objectId}`,
        refno: null,
        label: 'Annotation Pick Point',
      }
      : null;
  }

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): PtsetPickResult {
    const base = pickModelSurfacePoint(canvas, e) ?? pickAnnotationPoint(canvas, e);
    const surfaceRefno = base ? refnoFromObjectId(base.objectId) : null;
    const ptsetSetting = measurementStyle.state.measurementPickSources.ptset;

    if (sourceNeedsHoverData(ptsetSetting) && surfaceRefno) {
      currentHoverRefno = surfaceRefno;
      scheduleHoverPtsetFetch(surfaceRefno);
      showHoverPtset(ptsetSetting.show ? surfaceRefno : null);
    } else {
      showHoverPtset(null);
    }
    ensurePrimitiveKeypointsForRefno(surfaceRefno);

    if (base?.entityId.startsWith('annotation:')) {
      showHoverPickCandidates([]);
      pickPointMessage.value = null;
      return {
        hit: base,
        preview: null,
        surfaceRefno,
        source: base.source,
        reason: null,
      };
    }

    const camera = dtxViewerRef.value?.camera;
    if (!camera) {
      showHoverPickCandidates([]);
      pickPointMessage.value = '测量相机未就绪';
      return { hit: null, preview: null, surfaceRefno, source: null, reason: pickPointMessage.value };
    }

    const cursor = getCanvasPos(canvas, e);
    const rect = canvas.getBoundingClientRect();
    const candidates: MeasurementPickCandidate[] = [
      ...buildPtsetCandidates(),
      ...buildMeshPickCandidate(base),
      ...buildPositionCandidates(base, surfaceRefno),
      ...buildPrimitiveKeyPointCandidates(base, surfaceRefno),
    ];
    const resolution = resolveMeasurementPickCandidates({
      cursor: { x: cursor.x, y: cursor.y },
      camera,
      rect: { width: rect.width, height: rect.height },
      settings: measurementStyle.state.measurementPickSources,
      candidates,
    });
    showHoverPickCandidates(resolution.visibleCandidates);

    const ptsetPending = isPtsetPickPending(surfaceRefno);
    if (ptsetPending) {
      pickPointMessage.value = 'P-Point 正在加载，加载完成后再确认测量点';
      return {
        hit: null,
        preview: base,
        surfaceRefno,
        source: null,
        reason: pickPointMessage.value,
      };
    }

    if (resolution.hit) {
      pickPointMessage.value = null;
      return {
        hit: candidateToPickHit(resolution.hit),
        preview: null,
        surfaceRefno,
        source: resolution.hit.source,
        reason: null,
      };
    }

    if (!base) {
      pickPointMessage.value = '当前未命中模型实例，无法捕捉测量点';
      return { hit: null, preview: null, surfaceRefno: null, source: null, reason: pickPointMessage.value };
    }

    const preview = resolution.visibleCandidates.find((candidate) => (
      candidate.source !== 'ptset'
    ));
    pickPointMessage.value = buildMissReason(surfaceRefno);
    return {
      hit: null,
      preview: preview ? candidateToPickHit(preview) : null,
      surfaceRefno,
      source: null,
      reason: pickPointMessage.value,
    };
  }

  function toDimensionViewerSnapCandidate(
    candidate: MeasurementPickCandidate,
    distancePx: number,
  ): MeasurementViewerSnapCandidate {
    const refno = refnoFromObjectId(candidate.objectId);
    return {
      id: candidate.id,
      source: candidate.source,
      sceneWorld: vec3ToTuple(candidate.worldPos),
      ...(refno ? { refno } : {}),
      ...(candidate.label ? { label: candidate.label } : {}),
      distancePx,
      ...(candidate.direction
        ? { direction: vec3ToTuple(candidate.direction) }
        : {}),
      ...(candidate.circle
        ? {
          circle: {
            center: vec3ToTuple(candidate.circle.center),
            rim: vec3ToTuple(candidate.circle.rim),
            normal: vec3ToTuple(candidate.circle.normal),
          },
        }
        : {}),
      ...(candidate.arc
        ? {
          arc: {
            center: vec3ToTuple(candidate.arc.center),
            rim: vec3ToTuple(candidate.arc.rim),
            normal: vec3ToTuple(candidate.arc.normal),
          },
        }
        : {}),
    };
  }

  async function loadDimensionAnchorCandidates(
    refno: string,
  ): Promise<readonly MeasurementViewerSnapCandidate[]> {
    const normalizedRefno = String(refno || '').trim().replace(/\//g, '_');
    if (!normalizedRefno) return [];
    const dbno = getDbnumByRefno(normalizedRefno);
    const response = ptsetResponseByRefno.get(normalizedRefno)
      ?? await queryPtsetForMeasurement(dbno, normalizedRefno);
    if (response.success && response.ptset.length > 0) {
      ptsetResponseByRefno.set(normalizedRefno, response);
      ptsetSnap.upsertCandidates(normalizedRefno, response);
    }
    if (!primitiveKeypointsByRefno.has(normalizedRefno)) {
      try {
        primitiveKeypointsByRefno.set(
          normalizedRefno,
          await parquetLoader.queryPrimitiveKeypointsByRefnoFromParquet(
            dbno,
            normalizedRefno,
          ),
        );
      } catch {
        primitiveKeypointsByRefno.set(normalizedRefno, []);
      }
    }
    const objectId = `o:${normalizedRefno}:0`;
    const ptsetCandidates: MeasurementPickCandidate[] = ptsetSnap
      .getCandidates([normalizedRefno])
      .map(candidate => ({
        id: `ptset:${candidate.refno}#${candidate.number}`,
        source: 'ptset',
        entityId: `ptset:${candidate.refno}#${candidate.number}`,
        objectId,
        worldPos: new Vector3(...candidate.worldPos),
        label: `P-Point #${candidate.number}`,
      }));
    const transform = getDtxRefnoTransform(dbno, normalizedRefno);
    const position = buildPositionPickCandidate({
      refno: normalizedRefno,
      objectId,
      transform,
      globalModelMatrix: dtxLayerRef.value?.getGlobalModelMatrix?.() ?? null,
    });
    return [
      ...ptsetCandidates,
      ...(position ? [position] : []),
      ...primitiveKeyPointCandidates(normalizedRefno, objectId),
    ].map(candidate => toDimensionViewerSnapCandidate(candidate, 0));
  }

  function queryDimensionSnapCandidates(
    canvas: HTMLCanvasElement,
    screen: Readonly<{ x: number; y: number }>,
  ): readonly MeasurementViewerSnapCandidate[] {
    const selection = selectionRef.value;
    const picked = selection?.pickPoint({ x: screen.x, y: screen.y }) ?? null;
    const base: PickHit | null = picked
      ? {
        entityId: picked.objectId,
        objectId: picked.objectId,
        worldPos: picked.point.clone(),
        source: 'mesh_pick_point',
      }
      : null;
    const surfaceRefno = base ? refnoFromObjectId(base.objectId) : null;
    if (surfaceRefno) {
      currentHoverRefno = surfaceRefno;
      scheduleHoverPtsetFetch(surfaceRefno);
      ensurePrimitiveKeypointsForRefno(surfaceRefno);
    }
    const camera = dtxViewerRef.value?.camera;
    if (!camera) return [];
    const candidates: MeasurementPickCandidate[] = [
      ...buildPtsetCandidates(),
      ...buildMeshPickCandidate(base),
      ...buildPositionCandidates(base, surfaceRefno),
      ...buildPrimitiveKeyPointCandidates(base, surfaceRefno),
    ];
    const settings = Object.fromEntries(
      MEASUREMENT_PICK_SOURCE_IDS.map(id => [
        id,
        {
          ...measurementStyle.state.measurementPickSources[id],
          show: true,
        },
      ]),
    ) as MeasurementPickSourceSettings;
    const rect = canvas.getBoundingClientRect();
    const resolution = resolveMeasurementPickCandidates({
      cursor: screen,
      camera,
      rect: { width: rect.width, height: rect.height },
      settings,
      candidates,
    });
    return resolution.visibleCandidates.map(candidate =>
      toDimensionViewerSnapCandidate(candidate, candidate.pixelDistance));
  }

  function ensureOverlayElements(): void {
    const container = overlayContainerRef.value;
    if (!container) return;

    if (!hoverMarkerEl) {
      hoverMarkerEl = document.createElement('div');
      hoverMarkerEl.style.position = 'absolute';
      hoverMarkerEl.style.width = '12px';
      hoverMarkerEl.style.height = '12px';
      hoverMarkerEl.style.borderRadius = '999px';
      hoverMarkerEl.style.transform = 'translate(-50%, -50%)';
      hoverMarkerEl.style.pointerEvents = 'none';
      hoverMarkerEl.style.zIndex = '26';
      hoverMarkerEl.style.display = 'none';
      container.appendChild(hoverMarkerEl);
    }

    if (!pointerLensEl) {
      pointerLensEl = document.createElement('div');
      pointerLensEl.style.position = 'absolute';
      pointerLensEl.style.pointerEvents = 'none';
      pointerLensEl.style.zIndex = '27';
      pointerLensEl.style.display = 'none';
      pointerLensEl.style.padding = '4px 6px';
      pointerLensEl.style.borderRadius = '10px';
      pointerLensEl.style.background = 'rgba(15, 23, 42, 0.88)';
      pointerLensEl.style.color = '#f8fafc';
      pointerLensEl.style.fontSize = '10px';
      pointerLensEl.style.lineHeight = '1.35';
      pointerLensEl.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.24)';
      pointerLensEl.style.maxWidth = '160px';
      container.appendChild(pointerLensEl);
    }
  }

  function updateOverlayElements(): void {
    ensureOverlayElements();

    const hoverEntityId = store.xeokitHoverState.value?.entityId ?? null;
    const isKeypointSnap = typeof hoverEntityId === 'string' && hoverEntityId.startsWith('ptset:');

    if (hoverMarkerEl) {
      const marker = store.xeokitMarkerState.value;
      if (!marker.visible || !marker.canvasPos) {
        hoverMarkerEl.style.display = 'none';
      } else {
        const palette = getXeokitOverlayPalette(marker.role, marker.snapped, isKeypointSnap);
        hoverMarkerEl.style.display = 'block';
        hoverMarkerEl.style.left = `${marker.canvasPos.x}px`;
        hoverMarkerEl.style.top = `${marker.canvasPos.y}px`;
        hoverMarkerEl.style.border = `2px solid ${palette.markerBorder}`;
        hoverMarkerEl.style.background = palette.markerFill;
      }
    }

    if (pointerLensEl) {
      const lens = store.xeokitPointerLensState.value;
      if (!lens.visible || !lens.canvasPos) {
        pointerLensEl.style.display = 'none';
      } else {
        const palette = getXeokitOverlayPalette(store.xeokitMarkerState.value.role, lens.snapped, isKeypointSnap);
        const overlay = overlayContainerRef.value;
        const rect = overlay?.getBoundingClientRect();
        const flipX = rect ? lens.canvasPos.x > rect.width - 180 : false;
        const flipY = rect ? lens.canvasPos.y > rect.height - 80 : false;
        pointerLensEl.style.display = 'block';
        pointerLensEl.style.left = `${lens.canvasPos.x}px`;
        pointerLensEl.style.top = `${lens.canvasPos.y}px`;
        pointerLensEl.style.transform = `translate(${flipX ? 'calc(-100% - 18px)' : '18px'}, ${flipY ? 'calc(-100% - 18px)' : '18px'})`;
        pointerLensEl.style.border = `1px solid ${palette.lensBorder}`;
        pointerLensEl.innerHTML = `
          <div style="font-weight:700;margin-bottom:2px;color:${palette.lensAccent};">${lens.title}</div>
          <div style="opacity:0.82;">${lens.subtitle}</div>
        `;
      }
    }
  }

  function clearHoverFeedback() {
    clearHoverPickCandidates();
    store.setXeokitHoverState({
      visible: false,
      snapped: false,
      entityId: null,
      objectId: null,
      worldPos: null,
      canvasPos: null,
    });
    store.setXeokitMarkerState({
      visible: false,
      snapped: false,
      role: 'hover',
      worldPos: null,
      canvasPos: null,
    });
    store.setXeokitPointerLensState({
      visible: false,
      snapped: false,
      title: '',
      subtitle: '',
      canvasPos: null,
    });
    updateOverlayElements();
  }

  function getHoverMarkerRole(): XeokitMarkerRole {
    if (store.toolMode.value === 'xeokit_measure_elevation_point') {
      return 'target';
    }
    if (store.toolMode.value === 'xeokit_measure_elevation_delta') {
      return store.currentXeokitElevationDeltaDraft.value ? 'target' : 'origin';
    }
    if (store.toolMode.value === 'xeokit_measure_angle') {
      const stage = store.currentXeokitAngleDraft.value?.stage;
      if (!stage) return 'corner';
      return stage === 'finding_first_arm' ? 'origin' : 'target';
    }
    if (store.currentXeokitDistanceDraft.value) {
      return 'target';
    }
    return 'hover';
  }

  function getPointerLensText(
    snapped: boolean,
    markerRole: XeokitMarkerRole,
    hit: PickHit | null,
  ): { title: string; subtitle: string } {
    const mode = store.toolMode.value;
    if (!snapped) {
      const subtitle = pickPointMessage.value || `当前未捕捉到已启用点源：${activeSnapSourceText()}`;
      if (mode === 'xeokit_measure_elevation_point') {
        return { title: '等待标高点', subtitle };
      }
      if (mode === 'xeokit_measure_elevation_delta') {
        return {
          title: store.currentXeokitElevationDeltaDraft.value ? '等待终点' : '等待起点',
          subtitle,
        };
      }
      return {
        title: markerRole === 'corner' ? '等待拐点' : markerRole === 'target' ? '等待终点' : '等待测量点',
        subtitle,
      };
    }

    const source = hit?.source ?? null;
    const sourceLabel = source ? MEASUREMENT_PICK_SOURCE_LABELS[source] : '';
    const pickedLabel = hit?.label || sourceLabel;
    const subtitle = source === 'mesh_pick_point'
      ? `${pickedLabel}（近似）`
      : pickedLabel;
    if (mode === 'xeokit_measure_elevation_point') {
      return { title: '锁定标高点', subtitle };
    }
    if (mode === 'xeokit_measure_elevation_delta') {
      return {
        title: store.currentXeokitElevationDeltaDraft.value ? '更新终点' : '锁定起点',
        subtitle,
      };
    }
    return {
      title: markerRole === 'corner' ? '锁定拐点' : markerRole === 'target' ? '更新终点' : '可拾取点',
      subtitle,
    };
  }

  function updateHoverFeedback(
    canvas: HTMLCanvasElement,
    e: PointerEvent,
    hit: PickHit | null,
    preview: PickHit | null = null,
  ) {
    const canvasPos = getCanvasPos(canvas, e);
    const markerRole = getHoverMarkerRole();
    const displayHit = hit ?? preview;
    const lensText = getPointerLensText(Boolean(hit), markerRole, hit);
    const markerCanvasPos = (() => {
      if (!displayHit) return { x: canvasPos.x, y: canvasPos.y };
      const camera = dtxViewerRef.value?.camera;
      if (!camera) return { x: canvasPos.x, y: canvasPos.y };
      const rect = canvas.getBoundingClientRect();
      const projected = projectToCanvas(
        [displayHit.worldPos.x, displayHit.worldPos.y, displayHit.worldPos.z],
        camera,
        { width: rect.width, height: rect.height },
      );
      return projected.visible
        ? { x: projected.x, y: projected.y }
        : { x: canvasPos.x, y: canvasPos.y };
    })();

    if (!displayHit) {
      store.setXeokitHoverState({
        visible: false,
        snapped: false,
        entityId: null,
        objectId: null,
        worldPos: null,
        canvasPos: { x: canvasPos.x, y: canvasPos.y },
      });
      store.setXeokitMarkerState({
        visible: false,
        snapped: false,
        role: markerRole,
        worldPos: null,
        canvasPos: markerCanvasPos,
      });
      store.setXeokitPointerLensState({
        visible: false,
        snapped: false,
        title: lensText.title,
        subtitle: lensText.subtitle,
        canvasPos: { x: canvasPos.x, y: canvasPos.y },
      });
      updateOverlayElements();
      return;
    }

    store.setXeokitHoverState({
      visible: true,
      snapped: Boolean(hit),
      entityId: displayHit.entityId,
      objectId: displayHit.objectId,
      worldPos: vec3ToTuple(displayHit.worldPos),
      canvasPos: markerCanvasPos,
    });
    store.setXeokitMarkerState({
      visible: true,
      snapped: Boolean(hit),
      role: markerRole,
      worldPos: vec3ToTuple(displayHit.worldPos),
      canvasPos: markerCanvasPos,
    });
    store.setXeokitPointerLensState({
      visible: Boolean(hit),
      snapped: Boolean(hit),
      title: lensText.title,
      subtitle: lensText.subtitle || displayHit.entityId,
      canvasPos: { x: canvasPos.x, y: canvasPos.y },
    });
    updateOverlayElements();
  }

  function syncFromStore(): void {
    const dimensionSystem = options.getDimensionSystem?.() ?? null;
    if (!dimensionSystem) return;
    const records: ExternalDimensionRecord[] = [];
    const addRecord = (record: XeokitMeasurementRecord, isDraft = false) => {
      const external = xeokitMeasurementToExternalRecord(
        record,
        unitSettings.displayUnit.value,
        unitSettings.precision.value,
        options.sceneWorldToDesignMetres,
        isDraft,
      );
      if (external) records.push(external);
    };

    if (!suppressStoreMeasurements) {
      for (const record of store.xeokitDistanceMeasurements.value) addRecord(record);
      for (const record of store.xeokitAngleMeasurements.value) addRecord(record);
      for (const record of store.xeokitElevationPointMeasurements.value) addRecord(record);
      for (const record of store.xeokitElevationDeltaMeasurements.value) addRecord(record);

      if (isActiveMode()) {
        const draftDistance = store.currentXeokitDistanceDraft.value;
        const draftAngle = store.currentXeokitAngleDraft.value;
        const draftElevationPoint = store.currentXeokitElevationPointDraft.value;
        const draftElevationDelta = store.currentXeokitElevationDeltaDraft.value;
        if (draftDistance) addRecord(draftDistance, true);
        if (draftAngle) addRecord(draftAngle, true);
        if (draftElevationPoint) addRecord(draftElevationPoint, true);
        if (draftElevationDelta) addRecord(draftElevationDelta, true);
      }
    }

    dimensionSystem.replaceExternalSource('xeokit-measurement', records);
    requestRender?.();
  }

  function updateSelectionBinding(id: string | null): void {
    const dimensionSystem = options.getDimensionSystem?.() ?? null;
    if (!dimensionSystem) return;
    if (id) {
      dimensionSystem.viewport.setSelection(`${DIMENSION_XEOKIT_PREFIX}${id}`);
      return;
    }
    // 清空测量选中时不打断其他来源（用户尺寸 / 批注测量）的选中态。
    const current = dimensionSystem.viewport.getSelection();
    if (current && !current.startsWith(DIMENSION_XEOKIT_PREFIX)) return;
    dimensionSystem.viewport.setSelection(null);
  }

  /**
   * 反向选择绑定：dimension viewport 里点选尺寸图形后，把 xeokit 测量
   * id 回写到 store（P1-6 图形直接点选）。选中非 xeokit 尺寸或取消选中
   * 时清空当前测量选中态，保持视口与面板一致。
   */
  function handleDimensionSelectionChange(dimensionId: string | null): void {
    const id = dimensionId?.startsWith(DIMENSION_XEOKIT_PREFIX)
      ? dimensionId.slice(DIMENSION_XEOKIT_PREFIX.length)
      : null;
    if (store.activeXeokitMeasurementId.value === id) return;
    store.activeXeokitMeasurementId.value = id;
  }

  function flyToMeasurement(id: string): void {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const record = store.allXeokitMeasurements.value.find((item) => item.id === id);
    if (!record) return;
    const points =
      record.kind === 'distance'
        ? [record.origin.worldPos, record.target.worldPos]
        : record.kind === 'angle'
          ? [record.origin.worldPos, record.corner.worldPos, record.target.worldPos]
          : record.kind === 'elevation_point'
            ? [record.point.worldPos]
            : [record.origin.worldPos, record.target.worldPos];
    const aabb = aabbFromPoints(points);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function removeMeasurement(id: string): void {
    store.removeXeokitMeasurement(id);
    requestRender?.();
  }

  function clearMeasurements(): void {
    store.clearXeokitMeasurements();
    requestRender?.();
  }

  function setMeasurementVisible(id: string, visible: boolean): void {
    store.updateXeokitMeasurementVisible(id, visible);
    requestRender?.();
  }

  function setAllMeasurementsVisible(visible: boolean): void {
    for (const item of store.allXeokitMeasurements.value) {
      store.updateXeokitMeasurementVisible(item.id, visible);
    }
    requestRender?.();
  }

  function activate(mode: 'xeokit_measure_distance' | 'xeokit_measure_angle' | 'xeokit_measure_elevation_point' | 'xeokit_measure_elevation_delta') {
    if (suppressStoreMeasurements) return;
    clearMeasurementVisualAssists();
    store.setMeasurementDetailsDrawerOpen(false);
    store.setToolMode(mode);
  }

  function reset(): boolean {
    const hadDraft = currentMeasurement.value !== null;
    clickTracker.value = { down: null, moved: false };
    store.clearCurrentXeokitDraft();
    clearHoverFeedback();
    clearMeasurementVisualAssists();
    syncFromStore();
    requestRender?.();
    return hadDraft;
  }

  function deactivate() {
    reset();
    if (isActiveMode()) {
      store.setToolMode('none');
    }
  }

  function onCanvasPointerDown(_canvas: HTMLCanvasElement, e: PointerEvent) {
    if (suppressStoreMeasurements) return;
    if (!isActiveMode()) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (suppressStoreMeasurements) return;
    if (!isActiveMode()) return;

    const down = clickTracker.value.down;
    if (down) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (dx * dx + dy * dy > CLICK_TOLERANCE * CLICK_TOLERANCE) {
        clickTracker.value.moved = true;
      }
    }

    if (!ready.value) {
      clearHoverFeedback();
      syncMeasurementVisualAssists(null, null);
      return;
    }

    const pick = pickSurfacePoint(canvas, e);
    const hit = pick.hit;
    const hoverRefno = pick.surfaceRefno;
    currentHoverRefno = hoverRefno;
    syncMeasurementVisualAssists(hoverRefno, hit);
    updateHoverFeedback(canvas, e, hit, pick.preview);

    if (store.toolMode.value === 'xeokit_measure_elevation_point') {
      if (!hit) {
        store.setCurrentXeokitElevationPointDraft(null);
      } else {
        const point = measurementPointFromHit(hit);
        const absoluteElevation = getMeasurementPointElevation(point);
        const datumElevation = measurementStyle.state.elevationDatum;
        const currentDraft = store.currentXeokitElevationPointDraft.value;
        store.setCurrentXeokitElevationPointDraft({
          id: currentDraft?.id ?? nowId('xelevp'),
          kind: 'elevation_point',
          point,
          absoluteElevation,
          datumElevation,
          relativeElevation: absoluteElevation - datumElevation,
          visible: true,
          approximate: true,
          createdAt: currentDraft?.createdAt ?? Date.now(),
        });
      }
      syncFromStore();
      requestRender?.();
      return;
    }

    if (store.toolMode.value === 'xeokit_measure_distance' && store.currentXeokitDistanceDraft.value) {
      if (!hit) {
        store.setCurrentXeokitDistanceDraft({
          ...store.currentXeokitDistanceDraft.value,
          visible: false,
        });
      } else {
        const target = measurementPointFromHit(hit);
        store.setCurrentXeokitDistanceDraft({
          ...store.currentXeokitDistanceDraft.value,
          target,
          visible: true,
        });
      }
      syncFromStore();
      requestRender?.();
      return;
    }

    const elevationDeltaDraft = store.currentXeokitElevationDeltaDraft.value;
    if (store.toolMode.value === 'xeokit_measure_elevation_delta' && elevationDeltaDraft) {
      if (!hit) {
        store.setCurrentXeokitElevationDeltaDraft({
          ...elevationDeltaDraft,
          visible: false,
        });
      } else {
        const target = measurementPointFromHit(hit);
        const targetElevation = getMeasurementPointElevation(target);
        store.setCurrentXeokitElevationDeltaDraft({
          ...elevationDeltaDraft,
          target,
          targetElevation,
          deltaElevation: targetElevation - elevationDeltaDraft.originElevation,
          datumElevation: measurementStyle.state.elevationDatum,
          visible: true,
        });
      }
      syncFromStore();
      requestRender?.();
      return;
    }

    const angleDraft = store.currentXeokitAngleDraft.value;
    if (store.toolMode.value === 'xeokit_measure_angle' && angleDraft) {
      if (!hit) {
        store.setCurrentXeokitAngleDraft({
          ...angleDraft,
          visible: false,
        });
      } else if (angleDraft.stage === 'finding_first_arm') {
        const point = measurementPointFromHit(hit);
        store.setCurrentXeokitAngleDraft({
          ...angleDraft,
          origin: point,
          visible: true,
        });
      } else {
        const target = measurementPointFromHit(hit);
        store.setCurrentXeokitAngleDraft({
          ...angleDraft,
          target,
          visible: true,
        });
      }
      syncFromStore();
      requestRender?.();
    }
  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (suppressStoreMeasurements) return;
    if (!isActiveMode()) return;
    if (!ready.value) return;

    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    clickTracker.value = { down: null, moved: false };

    const pick = pickSurfacePoint(canvas, e);
    const hit = pick.hit;
    currentHoverRefno = pick.surfaceRefno;
    syncMeasurementVisualAssists(pick.surfaceRefno, hit);
    const missOnModelWithoutPick = !hit && !!pick.surfaceRefno;
    const toolMode = store.toolMode.value;
    const datumElevation = measurementStyle.state.elevationDatum;

    if (toolMode === 'xeokit_measure_elevation_point') {
      if (!hit) {
        if (missOnModelWithoutPick) {
          updateHoverFeedback(canvas, e, null);
          requestRender?.();
          return;
        }
        store.clearCurrentXeokitDraft();
        clearHoverFeedback();
        syncFromStore();
        requestRender?.();
        return;
      }

      const point = measurementPointFromHit(hit);
      const absoluteElevation = getMeasurementPointElevation(point);
      const draft = store.currentXeokitElevationPointDraft.value ?? {
        id: nowId('xelevp'),
        kind: 'elevation_point' as const,
        point,
        absoluteElevation,
        datumElevation,
        relativeElevation: absoluteElevation - datumElevation,
        visible: true,
        approximate: true as const,
        createdAt: Date.now(),
      };
      const rec: XeokitElevationPointMeasurementRecord = {
        id: draft.id,
        kind: 'elevation_point',
        point,
        absoluteElevation,
        datumElevation,
        relativeElevation: absoluteElevation - datumElevation,
        visible: true,
        approximate: hasApproximatePoint(point),
        createdAt: draft.createdAt,
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      store.addXeokitElevationPointMeasurement(rec);
      store.clearCurrentXeokitDraft();
      syncFromStore();
      updateSelectionBinding(rec.id);
      requestRender?.();
      return;
    }

    if (toolMode === 'xeokit_measure_distance') {
      const draft = store.currentXeokitDistanceDraft.value;
      if (!draft) {
        if (!hit) {
          if (missOnModelWithoutPick) {
            updateHoverFeedback(canvas, e, null);
            requestRender?.();
          }
          return;
        }
        const point = measurementPointFromHit(hit);
        addLockedMeasurementPoint(point);
        const nextDraft: XeokitDistanceDraft = {
          id: nowId('xdist'),
          kind: 'distance',
          origin: point,
          target: point,
          visible: true,
          approximate: true,
          createdAt: Date.now(),
        };
        store.setCurrentXeokitDistanceDraft(nextDraft);
        syncFromStore();
        requestRender?.();
        return;
      }

      if (!hit) {
        if (missOnModelWithoutPick) {
          updateHoverFeedback(canvas, e, null);
          requestRender?.();
          return;
        }
        store.clearCurrentXeokitDraft();
        clearHoverFeedback();
        syncFromStore();
        requestRender?.();
        return;
      }

      const target = measurementPointFromHit(hit);
      const rec: XeokitDistanceMeasurementRecord = {
        id: draft.id,
        kind: 'distance',
        origin: draft.origin,
        target,
        visible: true,
        approximate: hasApproximatePoint(draft.origin, target),
        createdAt: draft.createdAt,
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      if (!measurementStyle.state.distanceKeepDimensions) {
        for (const measurement of store.xeokitDistanceMeasurements.value) {
          store.updateXeokitMeasurementVisible(measurement.id, false);
        }
      }
      store.addXeokitDistanceMeasurement(rec);
      store.clearCurrentXeokitDraft();
      if (store.continuousDistanceMeasureEnabled.value) {
        // E3D 连续测量：以刚完成的终点作为下一段起点；链节点辅助态保持不闪断。
        retainMeasurementVisualAssistsFor(target);
        startDistanceDraftFrom(target);
      } else {
        clearMeasurementVisualAssists();
      }
      syncFromStore();
      updateSelectionBinding(rec.id);
      requestRender?.();
      return;
    }

    if (toolMode === 'xeokit_measure_elevation_delta') {
      const draft = store.currentXeokitElevationDeltaDraft.value;
      if (!draft) {
        if (!hit) {
          if (missOnModelWithoutPick) {
            updateHoverFeedback(canvas, e, null);
            requestRender?.();
          }
          return;
        }
        const point = measurementPointFromHit(hit);
        const absoluteElevation = getMeasurementPointElevation(point);
        const nextDraft: XeokitElevationDeltaDraft = {
          id: nowId('xelevd'),
          kind: 'elevation_delta',
          origin: point,
          target: point,
          originElevation: absoluteElevation,
          targetElevation: absoluteElevation,
          deltaElevation: 0,
          datumElevation,
          stage: 'finding_target',
          visible: true,
          approximate: true,
          createdAt: Date.now(),
        };
        store.setCurrentXeokitElevationDeltaDraft(nextDraft);
        syncFromStore();
        requestRender?.();
        return;
      }

      if (!hit) {
        if (missOnModelWithoutPick) {
          updateHoverFeedback(canvas, e, null);
          requestRender?.();
          return;
        }
        store.clearCurrentXeokitDraft();
        clearHoverFeedback();
        syncFromStore();
        requestRender?.();
        return;
      }

      const targetPoint = measurementPointFromHit(hit);
      const targetElevation = getMeasurementPointElevation(targetPoint);
      const rec: XeokitElevationDeltaMeasurementRecord = {
        id: draft.id,
        kind: 'elevation_delta',
        origin: draft.origin,
        target: targetPoint,
        originElevation: draft.originElevation,
        targetElevation,
        deltaElevation: targetElevation - draft.originElevation,
        datumElevation,
        visible: true,
        approximate: hasApproximatePoint(draft.origin, targetPoint),
        createdAt: draft.createdAt,
        sourceAnnotationId: store.activeAnnotationContext.value?.id,
        sourceAnnotationType: store.activeAnnotationContext.value?.type,
      };
      store.addXeokitElevationDeltaMeasurement(rec);
      store.clearCurrentXeokitDraft();
      syncFromStore();
      updateSelectionBinding(rec.id);
      requestRender?.();
      return;
    }

    if (toolMode !== 'xeokit_measure_angle') return;
    const draft = store.currentXeokitAngleDraft.value;
    if (!draft) {
      if (!hit) {
        if (missOnModelWithoutPick) {
          updateHoverFeedback(canvas, e, null);
          requestRender?.();
        }
        return;
      }
      const point = measurementPointFromHit(hit);
      const nextDraft: XeokitAngleDraft = {
        id: nowId('xang'),
        kind: 'angle',
        origin: point,
        corner: point,
        target: point,
        stage: 'finding_first_arm',
        visible: true,
        approximate: true,
        createdAt: Date.now(),
      };
      store.setCurrentXeokitAngleDraft(nextDraft);
      syncFromStore();
      requestRender?.();
      return;
    }

    if (!hit) {
      if (missOnModelWithoutPick) {
        updateHoverFeedback(canvas, e, null);
        requestRender?.();
        return;
      }
      store.clearCurrentXeokitDraft();
      clearHoverFeedback();
      syncFromStore();
      requestRender?.();
      return;
    }

    if (draft.stage === 'finding_first_arm') {
      const point = measurementPointFromHit(hit);
      store.setCurrentXeokitAngleDraft({
        ...draft,
        origin: point,
        stage: 'finding_second_arm',
        visible: true,
      });
      syncFromStore();
      requestRender?.();
      return;
    }

    const target = measurementPointFromHit(hit);
    const rec: XeokitAngleMeasurementRecord = {
      id: draft.id,
      kind: 'angle',
      origin: draft.origin,
      corner: draft.corner,
      target,
      visible: true,
      approximate: hasApproximatePoint(draft.origin, draft.corner, target),
      createdAt: draft.createdAt,
      sourceAnnotationId: store.activeAnnotationContext.value?.id,
      sourceAnnotationType: store.activeAnnotationContext.value?.type,
    };
    store.addXeokitAngleMeasurement(rec);
    store.clearCurrentXeokitDraft();
    syncFromStore();
    updateSelectionBinding(rec.id);
    requestRender?.();
  }

  function onCanvasPointerCancel(_canvas: HTMLCanvasElement, _e: PointerEvent) {
    clickTracker.value = { down: null, moved: false };
    if (store.toolMode.value === 'xeokit_measure_elevation_point') {
      store.setCurrentXeokitElevationPointDraft(null);
      syncFromStore();
      requestRender?.();
    }
    clearHoverFeedback();
    clearMeasurementVisualAssists();
  }

  function dispose() {
    clearHoverFeedback();
    clearMeasurementVisualAssists();
    clearHoverPickCandidates();
    try { hoverPickCandidateGroup.parent?.remove(hoverPickCandidateGroup); } catch { /* ignore */ }
    requestedPtsetRefnos.clear();
    ptsetResponseByRefno.clear();
    ptsetErrorByRefno.clear();
    ptsetLoadStateByRefno.clear();
    ptsetSnap.clear();
    ptsetHoverViz.clearAll();
    if (hoverMarkerEl) {
      hoverMarkerEl.remove();
      hoverMarkerEl = null;
    }
    if (pointerLensEl) {
      pointerLensEl.remove();
      pointerLensEl = null;
    }
  }

  watch(
    () => [
      store.xeokitDistanceMeasurements.value,
      store.xeokitAngleMeasurements.value,
      store.xeokitElevationPointMeasurements.value,
      store.xeokitElevationDeltaMeasurements.value,
      store.currentXeokitDistanceDraft.value,
      store.currentXeokitAngleDraft.value,
      store.currentXeokitElevationPointDraft.value,
      store.currentXeokitElevationDeltaDraft.value,
      options.annotationSystemRef?.value ?? null,
      options.getDimensionSystem?.() ?? null,
    ],
    () => {
      syncFromStore();
    },
    { deep: true, immediate: true },
  );

  watch(
    () => store.activeXeokitMeasurementId.value,
    (id) => {
      updateSelectionBinding(id);
    },
  );

  watch(
    () => overlayContainerRef.value,
    () => {
      ensureOverlayElements();
      updateOverlayElements();
    },
    { immediate: true },
  );

  watch(
    () => [store.xeokitMarkerState.value, store.xeokitPointerLensState.value],
    () => {
      updateOverlayElements();
    },
    { deep: true },
  );

  watch(
    () => measurementStyle.state.elevationDatum,
    (datumElevation) => {
      store.syncXeokitElevationDatum(datumElevation);
      syncFromStore();
      requestRender?.();
    },
    { immediate: true },
  );

  watch(
    () => ({
      displayUnit: unitSettings.displayUnit.value,
      precision: unitSettings.precision.value,
    }),
    () => {
      syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  watch(
    () => ({ ...measurementStyle.state }),
    () => {
      if (!measurementStyle.state.measurementPickSources.ptset.show) {
        showHoverPtset(null);
      }
      if (!isActiveMode()) {
        clearHoverPickCandidates();
      }
      syncFromStore();
      requestRender?.();
    },
    { deep: true },
  );

  return {
    ready,
    statusText,
    currentMeasurement,
    selectedMeasurement,
    hasVisibleMeasurements,
    hasHiddenMeasurements,
    refreshReadyState,
    syncFromStore,
    activate,
    deactivate,
    reset,
    flyToMeasurement,
    setMeasurementVisible,
    setAllMeasurementsVisible,
    removeMeasurement,
    clearMeasurements,
    repeatLastDistanceMeasurement,
    handleDimensionSelectionChange,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    queryDimensionSnapCandidates,
    loadDimensionAnchorCandidates,
    dispose,
  };
}
