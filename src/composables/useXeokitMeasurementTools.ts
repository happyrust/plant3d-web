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
  type Camera,
} from 'three';

import {
  formatMeasurementSnapLabel,
  getCachedNounForRefno,
  requestNounForRefno,
} from './measurementSnapLabel';
import {
  getDtxRefnoTransform,
  isDtxTubiObject,
  isDtxTubiObjectAcrossAllDbnos,
  listDtxTubiObjectIdsForRefno,
  resolveDtxNounByRefno,
  resolveDtxObjectIdsByRefno,
} from './useDbnoInstancesDtxLoader';
import {
  MEASUREMENT_PICK_SOURCE_IDS,
  MEASUREMENT_PICK_SOURCE_LABELS,
  attachPlineSegments,
  buildGraphicsPickCandidates,
  buildPlineLineCandidates,
  buildPositionPickCandidate,
  buildTubingAxisCandidate,
  resolveMeasurementPickCandidates,
  sourceNeedsHoverData,
  type MeasurementPickCandidate,
  type MeasurementPickPlane,
  type MeasurementPickSegment,
  type MeasurementPickSourceId,
  type MeasurementPickSourceSettings,
  type ProjectedMeasurementPickCandidate,
} from './useMeasurementPickSources';
import { projectToCanvas, usePtsetSnap } from './usePtsetSnap';
import { usePtsetVisualizationThree } from './usePtsetVisualizationThree';
import { useUnitSettingsStore } from './useUnitSettingsStore';
import { useXeokitMeasurementStyleStore } from './useXeokitMeasurementStyleStore';
import { getXeokitOverlayPalette } from './xeokitMeasurementUi';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { PrimitiveKeyPointCandidate } from './useDbnoInstancesParquetLoader';
import type { PtsetChildrenResponse, PtsetResponse } from '@/api/genModelPdmsAttrApi';
import type { DimensionSystem, ExternalDimensionRecord } from '@/dimension';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { getDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  useToolStore,
  type MeasurementPoint,
  type PerpendicularMeasurementInfo,
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
import {
  buildPerpendicularAidPlan,
  type PerpendicularAidLeg,
} from '@/measurement/aids/perpendicularAidPlan';
import {
  buildWorldDistanceAidPlan,
  type WorldDistanceAidPart,
} from '@/measurement/aids/worldDistanceAidPlan';
import {
  analyseMeshGraphics,
  type MeshGraphicsFeatures,
} from '@/measurement/graphics/meshFeatureGraphics';
import {
  elementHasE3dLine,
  elementLineAcceptsLocalBounds,
  elementLineBoundsRule,
  elementLineFromPPoints,
} from '@/measurement/kernel/elementLine';
import {
  EMPTY_INTERSECT_SESSION,
  advanceIntersectPick,
  intersectOperandFromGeometry,
  intersectPickOrdinal,
  type IntersectOperand,
  type IntersectPickSession,
} from '@/measurement/kernel/intersectPickSession';
import { computePerpendicularDistance } from '@/measurement/kernel/perpendicularDistance';
import { resolvePerpendicularTarget } from '@/measurement/kernel/perpendicularTargetProvider';
import {
  derivePickPosition,
  isWithinSegmentExtent,
  lineRayControlPoint,
  type PickDerivationType,
  type PickGeometry,
  type PickVec3,
} from '@/measurement/kernel/pickDerivation';
import {
  formatMeasurementPrompt,
  measurementPickFilterAdmits,
  measurementPickTypePromptToken,
  type MeasurementPickFeature,
  type MeasurementPickLayerConfig,
  type MeasurementPickTypeId,
} from '@/measurement/pick/pickLayerModel';
import {
  isTubingPassThroughPoint,
  mergeTubingAxisAcrossPassThrough,
  refineTubingAxisEnds,
  tubingAxisFromBounds,
  tubingEndTolerance,
  type TubingAxis,
  type TubingAxisEndPoint,
  type TubingAxisPiece,
  type TubingVec3,
} from '@/measurement/tubing/tubingAxis';
import { getModelSource } from '@/model-source';
import { DTXOverlayHighlighter } from '@/utils/three/dtx/selection/DTXOverlayHighlighter';
import {
  computeDistanceMeasurementResult,
  getMeasurementPointElevation,
} from '@/utils/xeokitMeasurementFormat';

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
  /** 点源自带的轴向 / 圆面几何（场景坐标），Perpendicular to 用来推导目标线 / 面。 */
  direction?: Vector3;
  circle?: Readonly<{ center: Vector3; rim: Vector3; normal: Vector3 }>;
  arc?: Readonly<{ center: Vector3; rim: Vector3; normal: Vector3 }>;
  /** 线 / 面候选自带的几何（场景坐标）：Graphics 边、PLINE 线；Graphics 面。 */
  segment?: MeasurementPickSegment;
  plane?: MeasurementPickPlane;
  /** 拾中元素作为 Intersect / Perpendicular 操作数时的线（E3D `edgTypes.attribute(noun).line()`：P1 → P2，场景坐标）。 */
  elementLine?: MeasurementPickSegment;
  /** 网格表面命中的三角形（场景坐标），Graphics 面候选由它派生。 */
  triangle?: readonly [Vector3, Vector3, Vector3];
  pixelDistance?: number;
  sourcePriority?: number;
  /**
   * E3D 拾取类型派生（Mid-Point / Fraction / Proportion / Distance / Cursor）改写了
   * 候选位置时记录：`from` 是候选原位置（场景坐标），`worldPos` 已是派生后的位置。
   */
  derived?: Readonly<{ pickType: MeasurementPickTypeId; from: Vector3 }>;
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

function tupleToVector(v: Vec3 | PickVec3): Vector3 {
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

/** `sceneWorldToDesignMeters` 的逆：设计 World（米）→ 场景坐标。 */
function designMetersToSceneWorld(design: Vector3, dtxLayerRef: Ref<DTXLayer | null>): Vector3 {
  const globalModelMatrix = dtxLayerRef.value?.getGlobalModelMatrix?.();
  if (!globalModelMatrix) return design.clone();
  if (Math.abs(globalModelMatrix.determinant()) <= 1e-12) return design.clone();
  const scale = new Vector3().setFromMatrixScale(globalModelMatrix);
  const raw = new Vector3(design.x / scale.x, design.y / scale.y, design.z / scale.z);
  return raw.applyMatrix4(globalModelMatrix);
}

/** 把场景坐标下的方向换到设计 World（米）：两点变换后相减，对任意仿射变换成立。 */
function sceneDirectionToDesign(
  origin: Vector3,
  direction: Vector3,
  dtxLayerRef: Ref<DTXLayer | null>,
): Vector3 {
  const from = sceneWorldToDesignMeters(origin, dtxLayerRef);
  const to = sceneWorldToDesignMeters(origin.clone().add(direction), dtxLayerRef);
  return to.sub(from);
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
  showDirectLinearDimension = true,
): ExternalDimensionRecord | null {
  const visible = isDraft || rec.visible !== false;
  if (!visible) return null;
  const id = `${DIMENSION_XEOKIT_PREFIX}${rec.id}`;
  const sourceLabel = isDraft ? 'Xeokit Measurement Draft' : 'Xeokit Measurement';

  if (rec.kind === 'distance') {
    // Picking keeps its rubber-band preview regardless of the completed-result
    // display option. For completed results this flag is the actual E3D
    // "Show linear dimension" behavior, not a persistence switch.
    if (!isDraft && !showDirectLinearDimension) return null;
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

function worldDistanceAidPartToExternalRecord(
  part: Extract<WorldDistanceAidPart, { kind: 'axis' }>,
  unit: string,
  precision: number,
): ExternalDimensionRecord {
  const labelAnchor: Vec3 = [
    (part.from[0] + part.to[0]) / 2,
    (part.from[1] + part.to[1]) / 2,
    (part.from[2] + part.to[2]) / 2,
  ];
  const labelAlong: Vec3 = [
    part.to[0] - part.from[0],
    part.to[1] - part.from[1],
    part.to[2] - part.from[2],
  ];
  const axisLabel = part.axis.toUpperCase();
  return {
    id: part.id,
    source: 'xeokit-measurement',
    sourceLabel: `Xeokit Measurement World ${axisLabel}`,
    role: 'external',
    category: 'annotation',
    layout: {
      id: part.id,
      role: 'external',
      labelPinned: false,
      formattedLabel: `${axisLabel} ${formatDistance(part.valueM, unit, precision)}`,
      lines: [{
        from: part.from,
        to: part.to,
        part: 'projection',
      }],
      labelAnchor,
      labelAlong,
      arrowLines: [],
    },
  };
}

/**
 * E3D 垂距尺寸的 Vertical / Horizontal 腿：`draw(REAL, ARC)` 只标长度，不带轴字母。
 */
function perpendicularAidLegToExternalRecord(
  leg: PerpendicularAidLeg,
  unit: string,
  precision: number,
): ExternalDimensionRecord {
  const labelAnchor: Vec3 = [
    (leg.from[0] + leg.to[0]) / 2,
    (leg.from[1] + leg.to[1]) / 2,
    (leg.from[2] + leg.to[2]) / 2,
  ];
  const labelAlong: Vec3 = [
    leg.to[0] - leg.from[0],
    leg.to[1] - leg.from[1],
    leg.to[2] - leg.from[2],
  ];
  return {
    id: leg.id,
    source: 'xeokit-measurement',
    sourceLabel: `Xeokit Measurement Perpendicular ${leg.kind}`,
    role: 'external',
    category: 'annotation',
    layout: {
      id: leg.id,
      role: 'external',
      labelPinned: false,
      formattedLabel: formatDistance(leg.valueM, unit, precision),
      lines: [{
        from: leg.from,
        to: leg.to,
        part: 'projection',
      }],
      labelAnchor,
      labelAlong,
      arrowLines: [],
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
  /**
   * 该 DTX 对象是否是直管（E3D TUBING）。默认查 `useDbnoInstancesDtxLoader` 的直管登记
   * （noun `TUBI` / gen-model `is_tubi`）；测试注入。
   */
  isTubingObject?: (objectId: string, refno: string | null) => boolean;
  /**
   * 同一构件（refno）下全部直管对象的 id。ATTA 处断开的两段直管要按 E3D `EDGTUBING.line`
   * 跳过 ATTA 合成一条轴线时用它找另一段。默认查 `useDbnoInstancesDtxLoader` 的直管登记；测试注入。
   */
  listTubingObjectIds?: (refno: string) => readonly string[];
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
  const isTubingObject = options.isTubingObject ?? ((objectId: string, refno: string | null): boolean => {
    try {
      if (refno && isDtxTubiObject(getDbnumByRefno(refno), objectId)) return true;
    } catch {
      // dbno 不可知（gen-model-v1 源）：走跨库查找。
    }
    try {
      return isDtxTubiObjectAcrossAllDbnos(objectId);
    } catch {
      return false;
    }
  });
  const listTubingObjectIds = options.listTubingObjectIds ?? ((refno: string): readonly string[] => {
    try {
      return listDtxTubiObjectIdsForRefno(refno);
    } catch {
      return [];
    }
  });
  const measurementStyle = useXeokitMeasurementStyleStore();
  const unitSettings = useUnitSettingsStore();
  /**
   * 测量关键点（P-Point / 成员 P-Point / 基本体关键点）一律经模型数据源端口取：
   * `legacy` 是 parquet + `:3100` API（与 2026-09-12 之前内联的取数逐字相同），`gen-model-v1` 是
   * `POST /api/v1/element/ptset`。每次调用时取当前源（同 `useDbnoInstancesDtxLoader`），改 URL 开关刷新即切。
   */
  const keypointSource = () => getModelSource().keypoints;

  const readyRevision = ref(0);
  const clickTracker = ref<ClickTracker>({ down: null, moved: false });
  /** 当前 hover 捕捉目标（命令条 Snap 目标名数据源）。 */
  const hoverSnapTarget = ref<{ label: string | null; refno: string | null } | null>(null);
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
  /** hover 根构件自身无 P-Point 时回落到直属子构件的映射（如 BRAN → 成员）。 */
  const ptsetChildRefnosByOwner = new Map<string, string[]>();
  const requestedPrimitiveKeypointRefnos = new Set<string>();
  const loadingPrimitiveKeypointRefnos = new Set<string>();
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
  /** 测量 hover 构件线框描边（E3D 捕捉时高亮元素的口径）。 */
  let hoverOutlineHighlighter: DTXOverlayHighlighter | null = null;
  let hoverOutlineRefno: string | null = null;

  function ensureHoverOutlineHighlighter(): DTXOverlayHighlighter | null {
    const viewer = dtxViewerRef.value;
    const layer = dtxLayerRef.value;
    if (!viewer?.scene || typeof layer?.getObjectGeometryData !== 'function') {
      return null;
    }
    if (!hoverOutlineHighlighter) {
      hoverOutlineHighlighter = new DTXOverlayHighlighter(viewer.scene, {
        showFill: false,
        edgeColor: 0x38bdf8,
        edgeOpacity: 0.95,
        edgeLineWidth: 1.5,
      });
      hoverOutlineHighlighter.setGeometryGetter(
        (objectId) => layer.getObjectGeometryData(objectId),
      );
    }
    const canvas = viewer.canvas as HTMLCanvasElement | undefined;
    if (canvas) {
      hoverOutlineHighlighter.setResolution(
        canvas.clientWidth || canvas.width,
        canvas.clientHeight || canvas.height,
      );
    }
    return hoverOutlineHighlighter;
  }

  function hoverOutlineObjectIds(refno: string): string[] {
    try {
      const dbno = getDbnumByRefno(refno);
      const ids = resolveDtxObjectIdsByRefno(dbno, refno);
      if (ids.length > 0) return ids;
    } catch {
      // dbnum 未知时回落前缀扫描
    }
    const layer = dtxLayerRef.value;
    if (typeof layer?.getAllObjectIds !== 'function') return [];
    const prefix = `o:${refno}:`;
    return layer.getAllObjectIds().filter((objectId: string) =>
      objectId === refno || objectId.startsWith(prefix));
  }

  function updateHoverOutline(refno: string | null): void {
    if (refno === hoverOutlineRefno) return;
    hoverOutlineRefno = refno;
    const outline = ensureHoverOutlineHighlighter();
    if (!outline) return;
    outline.setHighlightedObjects(refno ? hoverOutlineObjectIds(refno) : []);
    requestRender?.();
  }

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
    if (source === 'mesh_graphics') return 0xfacc15;
    if (source === 'tubing_axis') return 0x2dd4bf;
    return 0x22c55e;
  }

  /**
   * E3D `pickdetail` 高亮拾中的图形细节：Graphics 边画整条边，Graphics 面画共面片的轮廓；
   * TUBING 画整条管身轴线。只画当前胜出的候选（E3D 也只高亮拾中的那一个细节）。
   */
  function createGraphicsDetailHighlight(hit: ProjectedMeasurementPickCandidate): LineSegments | null {
    const segments: readonly MeasurementPickSegment[] = hit.plane?.outline?.length
      ? hit.plane.outline
      : hit.segment
        ? [hit.segment]
        : [];
    if (segments.length === 0) return null;
    const positions = new Float32Array(segments.length * 6);
    segments.forEach((segment, index) => {
      positions.set(
        [segment.start.x, segment.start.y, segment.start.z, segment.end.x, segment.end.y, segment.end.z],
        index * 6,
      );
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({ color: sourceCandidateColor(hit.source) });
    (material as any).depthTest = false;
    const line = new LineSegments(geometry, material);
    line.renderOrder = hoverPickCandidateGroup.renderOrder;
    line.userData.noPick = true;
    return line;
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

  function showHoverPickCandidates(
    candidates: readonly ProjectedMeasurementPickCandidate[],
    hit: ProjectedMeasurementPickCandidate | null = null,
  ): void {
    clearHoverPickCandidates();
    ensureHoverPickCandidateGroupAttached();
    if (!hoverPickCandidateGroup.parent) return;
    for (const candidate of candidates) {
      if (candidate.source === 'ptset') continue;
      hoverPickCandidateGroup.add(createCandidateCross(candidate.worldPos, candidate.source));
    }
    if (hit?.source === 'mesh_graphics' || hit?.source === 'tubing_axis') {
      const detail = createGraphicsDetailHighlight(hit);
      if (detail) hoverPickCandidateGroup.add(detail);
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

    const roots = Array.from(new Set([
      ...lockedMeasurementRefnos,
      ...(hoverRefno ? [hoverRefno] : []),
    ]));
    // 根构件（如 BRAN）本身无点时展开到其直属子构件的点集。
    const refnos = Array.from(new Set(roots.flatMap((refno) => [
      refno,
      ...(ptsetChildRefnosByOwner.get(refno) ?? []),
    ])));
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
      // dbnum 仅 legacy parquet 路径需要；db_meta 不可用（如未导出 db_meta_info.json）
      // 时回落 dbno=0 走后端 ptset API，不再静默放弃关键点显示。gen-model-v1 源不看它。
      let dbno = 0;
      try {
        dbno = getDbnumByRefno(r);
      } catch {
        dbno = 0;
      }
      queryPtsetForMeasurement(dbno, r)
        .then(async (resp) => {
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
          // 根级构件（如 BRAN）自身无 P-Point：回落直属子构件的点集，
          // hover 分支即显示成员关键点（E3D 元素级捕捉的等价口径）。
          const childRefnos = await fetchChildrenPtsets(r, dbno);
          if (childRefnos.length > 0) {
            ptsetChildRefnosByOwner.set(r, childRefnos);
            ptsetErrorByRefno.delete(r);
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

  /** 拉取直属子构件的 P-Point 并登记为吸附/显示候选；返回有点的子 refno。 */
  async function fetchChildrenPtsets(ownerRefno: string, dbno: number): Promise<string[]> {
    let response: PtsetChildrenResponse | null = null;
    try {
      response = await keypointSource().memberPtsets(dbno, ownerRefno);
    } catch {
      return [];
    }
    const childRefnos: string[] = [];
    for (const item of response?.results ?? []) {
      const childRefno = String(item.refno || item.input_refno || '').trim().replace(/\//g, '_');
      if (!childRefno || !item.success || item.ptset.length === 0) continue;
      const childResp: PtsetResponse = {
        success: true,
        refno: childRefno,
        noun: item.noun ?? null,
        ptset: item.ptset,
        world_transform: item.world_transform ?? null,
        unit_info: item.unit_info ?? null,
      };
      ptsetResponseByRefno.set(childRefno, childResp);
      ptsetSnap.upsertCandidates(childRefno, childResp);
      childRefnos.push(childRefno);
    }
    return childRefnos;
  }

  async function queryPtsetForMeasurement(dbno: number, refno: string): Promise<PtsetResponse> {
    return await keypointSource().ptset(dbno, refno);
  }

  /** 基本体 + PLINE 语义关键点：候选与失败原因一起回，调用方决定提示。 */
  async function queryPrimitiveKeypointsForMeasurement(
    dbno: number,
    refno: string,
  ): Promise<{ items: PrimitiveKeyPointCandidate[]; errors: string[] }> {
    return await keypointSource().primitiveKeypoints(dbno, refno);
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
    updateHoverOutline(hoverRefno);
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
    updateHoverOutline(null);
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
    loadingPrimitiveKeypointRefnos.add(refno);
    let dbno: number;
    try {
      dbno = getDbnumByRefno(refno);
    } catch (error) {
      primitiveKeypointErrorByRefno.set(refno, error instanceof Error ? error.message : String(error));
      loadingPrimitiveKeypointRefnos.delete(refno);
      return;
    }

    queryPrimitiveKeypointsForMeasurement(dbno, refno)
      .then(({ items, errors }) => {
        primitiveKeypointsByRefno.set(refno, items);
        if (items.length > 0) {
          primitiveKeypointErrorByRefno.delete(refno);
        } else {
          primitiveKeypointErrorByRefno.set(
            refno,
            errors.join('；') || '当前构件没有基本体或 PLINE 关键点候选',
          );
        }
        requestRender?.();
      })
      .catch((error) => {
        primitiveKeypointErrorByRefno.set(refno, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        loadingPrimitiveKeypointRefnos.delete(refno);
      });
  }

  function ptsetMissReason(refno: string | null): string {
    if (!measurementStyle.state.measurementPickSources.ptset.snap) {
      return 'P-Point 捕捉已关闭';
    }
    if (!refno) return '当前未命中模型实例，无法确定 P-Point 来源';
    const error = ptsetErrorByRefno.get(refno);
    if (error) return error;
    if (!requestedPtsetRefnos.has(refno)) return '正在读取该构件的 P-Point，请稍候再靠近关键点';
    if (!ptsetSnap.hasCandidates(refno)) return '当前数据源未提供该构件的 P-Point，无法登记测量点';
    return '请将光标靠近构件 P-Point 后再点击';
  }

  function primitiveKeypointMissReason(refno: string | null): string {
    if (!measurementStyle.state.measurementPickSources.primitive_key_point.snap) {
      return 'Primitive Key Point 捕捉已关闭';
    }
    if (!refno) return '当前未命中模型实例，无法确定 Primitive Key Point 来源';
    if (loadingPrimitiveKeypointRefnos.has(refno)) {
      return '正在读取基本体与 PLINE 关键点，请稍候';
    }
    const error = primitiveKeypointErrorByRefno.get(refno);
    if (error) return error;
    if (!requestedPrimitiveKeypointRefnos.has(refno)) {
      return '正在读取该构件的基本体与 PLINE 关键点，请稍候再靠近关键点';
    }
    if ((primitiveKeypointsByRefno.get(refno)?.length ?? 0) === 0) {
      return '当前数据源未提供该构件的 Primitive Key Point，无法登记测量点';
    }
    return '请将光标靠近 Primitive Key Point 后再点击';
  }

  /** E3D 特征类：每个点源可能给出的候选特征（拾取过滤器按它判断点源此刻能否参与）。 */
  const SOURCE_FEATURES: Readonly<Record<MeasurementPickSourceId, readonly MeasurementPickFeature[]>> = {
    ptset: ['ppoint'],
    position: ['element'],
    primitive_key_point: ['element', 'pline'],
    mesh_pick_point: ['surface'],
    mesh_graphics: ['graphics-line', 'graphics-plane'],
    tubing_axis: ['tubing'],
  };

  /** 已开捕捉、且当前拾取过滤器 × 拾取类型放行其特征的点源（E3D：过滤器不放行的点源等于没开）。 */
  function enabledSnapSources(): MeasurementPickSourceId[] {
    const layer = measurementStyle.state.measurementPickLayer;
    return MEASUREMENT_PICK_SOURCE_IDS.filter((id) => (
      measurementStyle.state.measurementPickSources[id]?.snap
      && SOURCE_FEATURES[id].some((feature) => measurementPickFilterAdmits(layer.filter, layer.pickType, feature))
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
      // P-point 方向 = E3D PPOINT 轴线（Perpendicular to 的 LINE provider）。
      ...(candidate.sceneDir ? { direction: new Vector3(...candidate.sceneDir) } : {}),
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
    const mapped: MeasurementPickCandidate[] = (primitiveKeypointsByRefno.get(refno) ?? []).map((candidate) => {
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
        label: candidate.label
          ?? `${MEASUREMENT_PICK_SOURCE_LABELS.primitive_key_point} #${candidate.keypointIndex}`,
        // E3D 拾取过滤器的特征类：PLINE 点是 Pline，其余基本体关键点是 Element 显著点。
        feature: candidate.kind.startsWith('pline') ? 'pline' as const : 'element' as const,
        ...(direction ? { direction } : {}),
        ...(circle ? { circle } : {}),
        ...(arc ? { arc } : {}),
      };
    });
    return attachPlineSegments(mapped);
  }

  /**
   * 基本体 / PLINE 关键点候选。PLINE 两端配成线后再加一条**线候选**（控制点 = p-line 上离光标射线最近处，
   * E3D `stdPline` 在 p-line 任意处都能拾中），Snap 由派生取近端、Mid-Point 等沿线。
   */
  function buildPrimitiveKeyPointCandidates(
    base: PickHit | null,
    refno: string | null,
    cursor: Readonly<{ x: number; y: number }>,
    camera: Camera,
    rect: Readonly<{ width: number; height: number }>,
  ): MeasurementPickCandidate[] {
    if (!base || !refno) return [];
    const setting = measurementStyle.state.measurementPickSources.primitive_key_point;
    if (!sourceNeedsHoverData(setting)) return [];
    const points = primitiveKeyPointCandidates(refno, base.objectId);
    if (!(rect.width > 0) || !(rect.height > 0) || !points.some((candidate) => candidate.segment)) return points;
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2((cursor.x / rect.width) * 2 - 1, -(cursor.y / rect.height) * 2 + 1),
      camera,
    );
    return [
      ...points,
      ...buildPlineLineCandidates(points, { origin: raycaster.ray.origin, direction: raycaster.ray.direction }),
    ];
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
      ...(candidate.direction ? { direction: candidate.direction.clone() } : {}),
      ...(candidate.circle ? { circle: candidate.circle } : {}),
      ...(candidate.arc ? { arc: candidate.arc } : {}),
      ...(candidate.segment ? { segment: candidate.segment } : {}),
      ...(candidate.plane ? { plane: candidate.plane } : {}),
      ...(candidate.elementLine ? { elementLine: candidate.elementLine } : {}),
      pixelDistance,
      sourcePriority: measurementStyle.state.measurementPickSources[candidate.source]?.priority,
    };
  }

  /**
   * E3D `EDGTYPES.attribute(fullType).line(item)`：拾中的元素作为 Intersect / Perpendicular-to 操作数时
   * 转成的线——CYLI / NCYL / SLCY / DISH / CONE / SNOU / NOZZ / PYRA 的 handler 都回 P1 → P2（World）。
   * 点从 ptset 缓存取（hover 已按 refno 拉过）；noun 不在表内或缺 P1 / P2 时为 null。
   * 它不改 Snap：E3D 的 ELEMENT `snap()` 对这些元素 `handle any` 回落元素原点。
   */
  function elementLineForRefno(refno: string | null, objectId: string): MeasurementPickSegment | null {
    if (!refno) return null;
    const noun = nounForRefno(refno);
    if (!elementHasE3dLine(noun)) return null;
    const line = elementLineFromPPoints(
      noun,
      ptsetSnap.getCandidates([refno]).map((candidate) => ({
        number: candidate.number,
        position: [candidate.worldPos[0], candidate.worldPos[1], candidate.worldPos[2]] as const,
      })),
    );
    if (line) return { start: new Vector3(...line.start), end: new Vector3(...line.end) };
    // gen-model-v1 的 element/ptset 只解目录 PTSE，设计基本体（CYLI / CONE / DISH / PYRA）没有点。它们在 DTX 里
    // 画在自己的局部帧（CYLI 是单位圆柱实例，其余是局部帧烘好的网格）× 放置矩阵，E3D 的 P1 / P2 就在两端面中心：
    // 截面对中于局部原点时，局部 z 向包围盒范围就是 P1 → P2（同 TUBING 的派生法）；带 XOFF / YOFF 的不对中，不派生。
    if (!elementLineBoundsRule(noun)) return null;
    const axis = tubingAxisForObject(objectId, { acceptBounds: (bounds) => elementLineAcceptsLocalBounds(noun, bounds) });
    return axis ? { start: new Vector3(...axis.start), end: new Vector3(...axis.end) } : null;
  }

  /**
   * 没有候选胜出时，把光标命中的元素当 E3D 的 ELEMENT 拾取转成线：只在要线的场合（Intersect 拾取类型，
   * 或 Perpendicular to 正在等第二点）、元素类过滤器（Any / Element）放行、且元素有 `line()` 时成立。
   * 命中点仍是表面点（Perpendicular 的 `picked`），`elementLine` 给操作数 / 目标线。
   */
  function elementPickAsLine(base: PickHit, refno: string | null): PickHit | null {
    const layer = measurementStyle.state.measurementPickLayer;
    if (layer.filter !== 'any' && layer.filter !== 'element') return null;
    const wantsLine = layer.pickType === 'intersect'
      || (measurementStyle.state.perpendicularTo && store.currentXeokitDistanceDraft.value !== null);
    if (!wantsLine) return null;
    const elementLine = elementLineForRefno(refno, base.objectId);
    if (!elementLine) return null;
    return {
      ...base,
      source: 'mesh_pick_point',
      candidateId: `element-line:${refno}`,
      refno,
      label: ELEMENT_LINE_LABEL,
      elementLine,
      sourcePriority: measurementStyle.state.measurementPickSources.position?.priority,
    };
  }

  /**
   * 给同一元素的表面点 / Item 原点候选挂上 `elementLine`。Element 过滤器 × Intersect 下表面点本不放行，
   * 但 E3D 在元素类拾取模式下拾中元素任意处都回 ELEMENT 再 `line()`，所以这时把表面点当元素拾取（特征类 `element`）。
   */
  function attachElementLine(candidates: MeasurementPickCandidate[], refno: string | null): MeasurementPickCandidate[] {
    if (candidates.length === 0) return candidates;
    const elementLine = elementLineForRefno(refno, candidates[0]!.objectId);
    if (!elementLine) return candidates;
    const layer = measurementStyle.state.measurementPickLayer;
    const asElementPick = layer.pickType === 'intersect' && layer.filter === 'element';
    return candidates.map((candidate) => ({
      ...candidate,
      elementLine,
      ...(asElementPick && candidate.source === 'mesh_pick_point' ? { feature: 'element' as const } : {}),
    }));
  }

  /**
   * E3D Graphics 拾取（`stdGraphics` / `pickdetail`）的候选：从光标命中构件的已加载
   * 网格派生绘制边（线候选）与面（平面候选）。网格特征按 objectId + 世界矩阵缓存；
   * 只有拾取过滤器放行 Graphics 特征时才分析（`Any` 按 E3D `stdAny` 不拾细节图形）。
   */
  const GRAPHICS_FEATURE_CACHE_LIMIT = 32;
  const graphicsFeatureCache = new Map<string, MeshGraphicsFeatures>();

  function meshGraphicsFeaturesFor(objectId: string): MeshGraphicsFeatures | null {
    const layer = dtxLayerRef.value;
    const data = layer?.getObjectGeometryData?.(objectId);
    if (!data) return null;
    const matrix = data.matrix.elements;
    const key = `${objectId}|${matrix.map((v) => v.toPrecision(9)).join(',')}`;
    const cached = graphicsFeatureCache.get(key);
    if (cached) {
      graphicsFeatureCache.delete(key);
      graphicsFeatureCache.set(key, cached);
      return cached;
    }
    const position = data.geometry.getAttribute('position');
    if (!position) return null;
    const index = data.geometry.getIndex();
    const features = analyseMeshGraphics({
      positions: position.array as ArrayLike<number>,
      indices: index ? (index.array as ArrayLike<number>) : null,
      matrix,
    });
    graphicsFeatureCache.set(key, features);
    if (graphicsFeatureCache.size > GRAPHICS_FEATURE_CACHE_LIMIT) {
      const oldest = graphicsFeatureCache.keys().next().value;
      if (oldest !== undefined) graphicsFeatureCache.delete(oldest);
    }
    return features;
  }

  function buildGraphicsCandidates(
    base: PickHit | null,
    cursor: Readonly<{ x: number; y: number }>,
    camera: Camera,
    rect: Readonly<{ width: number; height: number }>,
  ): MeasurementPickCandidate[] {
    if (!base || base.source !== 'mesh_pick_point') return [];
    const setting = measurementStyle.state.measurementPickSources.mesh_graphics;
    if (!sourceNeedsHoverData(setting)) return [];
    const layer = measurementStyle.state.measurementPickLayer;
    if (
      !measurementPickFilterAdmits(layer.filter, layer.pickType, 'graphics-line')
      && !measurementPickFilterAdmits(layer.filter, layer.pickType, 'graphics-plane')
    ) {
      return [];
    }
    const features = meshGraphicsFeaturesFor(base.objectId);
    if (!features) return [];
    if (!(rect.width > 0) || !(rect.height > 0)) return [];
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2((cursor.x / rect.width) * 2 - 1, -(cursor.y / rect.height) * 2 + 1),
      camera,
    );
    return buildGraphicsPickCandidates({
      objectId: base.objectId,
      entityId: base.entityId,
      features,
      hitPoint: base.worldPos,
      hitTriangle: base.triangle ?? null,
      ray: { origin: raycaster.ray.origin, direction: raycaster.ray.direction },
      cursor,
      camera,
      rect,
      edgeThresholdPx: setting.thresholdPx,
    });
  }

  /** 元素当 Intersect / Perpendicular 操作数时的线名（E3D `line()` = P1 → P2）；命令条前缀元素类型 → `CYLI 轴线（P1 → P2）`。 */
  const ELEMENT_LINE_LABEL = '轴线（P1 → P2）';

  /** 端点校正容差的下限：设计空间 2 mm，换成场景单位（全局模型矩阵可能带缩放）。 */
  const TUBING_END_TOLERANCE_DESIGN_M = 0.002;

  /**
   * E3D TUBING 拾取：光标射线命中直管对象（noun `TUBI` / gen-model `is_tubi`）时，从对象的
   * 局部包围盒 × 放置矩阵派生管身轴线（gen-model 单位圆柱：局部 z ∈ [0, 1]，缩放 (外径, 外径, 长度)），
   * 再把两端吸到 ptset 缓存里邻接构件的 P-Point 上（E3D `EDGTUBING.line` 以 leave / arrive 位置定义
   * 管线，而不是用隐含管长）。产出一条线候选：控制点 = 轴线上离射线最近处（`EDGTUBING.exact`），
   * `segment` = 整条轴线（Snap 取近端、Mid-Point / Fraction / Proportion / Distance 沿线派生、Intersect 转 LINE）。
   * 只在拾取过滤器放行 TUBING（Any / Element）时分析。
   *
   * E3D `EDGTUBING.line` 跳过 ATTA（管线从构件 leave 直到下一个非 ATTA 构件的 arrive），而 gen-model 在每个
   * ATTA 处把直管断成两段对象：拾中段的某一端校正到了 ATTA 的 P-Point 时，把同一构件下与之共线、
   * 端点相接的另一段（们）接上，合成 E3D 那一条线（`mergeTubingAxisAcrossPassThrough`）。
   */
  function buildTubingAxisCandidates(
    base: PickHit | null,
    cursor: Readonly<{ x: number; y: number }>,
    camera: Camera,
    rect: Readonly<{ width: number; height: number }>,
  ): MeasurementPickCandidate[] {
    if (!base || base.source !== 'mesh_pick_point') return [];
    const setting = measurementStyle.state.measurementPickSources.tubing_axis;
    if (!sourceNeedsHoverData(setting)) return [];
    const layer = measurementStyle.state.measurementPickLayer;
    if (!measurementPickFilterAdmits(layer.filter, layer.pickType, 'tubing')) return [];
    const refno = refnoFromObjectId(base.objectId);
    if (!isTubingObject(base.objectId, refno)) return [];
    const axis = tubingAxisForObject(base.objectId);
    if (!axis) return [];
    if (!(rect.width > 0) || !(rect.height > 0)) return [];

    // 邻接 P-Point：ptset 缓存里离轴线两端在容差内的点（hover 分支时成员点集已经在缓存里）。
    // noun 优先取点集响应带回的（ATTA 没有几何、不在 DTX 登记里），再回落 refno → noun 查找。
    const points: TubingAxisEndPoint[] = ptsetSnap.getCandidates().map((candidate) => {
      const noun = candidate.noun ?? nounForRefno(candidate.refno);
      return {
        position: [candidate.worldPos[0], candidate.worldPos[1], candidate.worldPos[2]] as TubingVec3,
        label: `${noun ? `${noun} ` : ''}P-Point #${candidate.number}`,
        noun,
      };
    });
    const origin = designMetersToSceneWorld(new Vector3(0, 0, 0), dtxLayerRef);
    const sceneUnitsPerDesignMetre = designMetersToSceneWorld(new Vector3(1, 0, 0), dtxLayerRef).distanceTo(origin) || 1;
    const minimumTolerance = TUBING_END_TOLERANCE_DESIGN_M * sceneUnitsPerDesignMetre;
    const tolerance = tubingEndTolerance(axis, minimumTolerance);
    const refined = refineTubingAxisEnds(axis, points, tolerance);

    // 某一端落在 ATTA 上才去找同一构件的其它直管段；其余情形不读别的对象的几何。
    const hit: TubingAxisPiece = { id: base.objectId, axis: refined };
    const others: TubingAxisPiece[] = isTubingPassThroughPoint(refined.startPoint) || isTubingPassThroughPoint(refined.endPoint)
      ? (refno ? listTubingObjectIds(refno) : [])
        .filter((objectId) => objectId !== base.objectId)
        .flatMap((objectId) => {
          const pieceAxis = tubingAxisForObject(objectId);
          if (!pieceAxis) return [];
          return [{ id: objectId, axis: refineTubingAxisEnds(pieceAxis, points, tubingEndTolerance(pieceAxis, minimumTolerance)) }];
        })
      : [];
    const merged = mergeTubingAxisAcrossPassThrough(hit, others, { tolerance });

    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2((cursor.x / rect.width) * 2 - 1, -(cursor.y / rect.height) * 2 + 1),
      camera,
    );
    const candidate = buildTubingAxisCandidate({
      objectId: base.objectId,
      entityId: base.entityId,
      axis: merged,
      ray: { origin: raycaster.ray.origin, direction: raycaster.ray.direction },
    });
    return candidate ? [candidate] : [];
  }

  /**
   * 直管 / 基本体对象的轴线：局部包围盒 × 放置矩阵（`tubingAxisFromBounds`）；不是已加载对象或几何退化时为 null。
   * `acceptBounds` 先审局部包围盒——不是基本体自己局部帧里的形状（例如烘在世界帧的实体）就不当轴线。
   */
  function tubingAxisForObject(
    objectId: string,
    options?: Readonly<{ acceptBounds?: (bounds: Readonly<{ min: TubingVec3; max: TubingVec3 }>) => boolean }>,
  ): TubingAxis | null {
    const data = dtxLayerRef.value?.getObjectGeometryData?.(objectId);
    if (!data) return null;
    if (!data.geometry.boundingBox) data.geometry.computeBoundingBox();
    const bounds = data.geometry.boundingBox;
    if (!bounds) return null;
    const localBounds = { min: bounds.min.toArray() as unknown as TubingVec3, max: bounds.max.toArray() as unknown as TubingVec3 };
    if (options?.acceptBounds && !options.acceptBounds(localBounds)) return null;
    return tubingAxisFromBounds({ bounds: localBounds, matrix: data.matrix.elements });
  }

  /** 当前 E3D 拾取层（过滤器 × 拾取类型），喂给候选解析做准入。 */
  function pickLayerGate(): Readonly<{ filter: MeasurementPickLayerConfig['filter']; pickType: MeasurementPickTypeId }> {
    const layer = measurementStyle.state.measurementPickLayer;
    return { filter: layer.filter, pickType: layer.pickType };
  }

  /** 光标处的拾取射线，换到设计 World（米）——内核的控制点 / 射线∩面都在这个系里算。 */
  function designPickRay(
    canvas: HTMLCanvasElement,
    cursor: Readonly<{ x: number; y: number }>,
  ): Readonly<{ origin: PickVec3; direction: PickVec3 }> | null {
    const camera = dtxViewerRef.value?.camera;
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const raycaster = new Raycaster();
    raycaster.setFromCamera(
      new Vector2((cursor.x / rect.width) * 2 - 1, -(cursor.y / rect.height) * 2 + 1),
      camera,
    );
    const origin = raycaster.ray.origin.clone();
    const direction = raycaster.ray.direction.clone();
    if (!Number.isFinite(origin.lengthSq()) || direction.lengthSq() <= 1e-24) return null;
    return {
      origin: vec3ToTuple(sceneWorldToDesignMeters(origin, dtxLayerRef)),
      direction: vec3ToTuple(sceneDirectionToDesign(origin, direction, dtxLayerRef)),
    };
  }

  /**
   * E3D 拾取类型派生（`EDGPICKTYPE.snap / exact / distance / proportion / fraction`，
   * 内核 `derivePickPosition`）：把拾中候选换到设计 World（米）交给内核，再把派生位置
   * 换回场景坐标。点候选只有 Distance 会动（沿 P-Point 方向偏移，E3D `pPosition.offset`）；
   * 线候选（PLINE / TUBING 轴 / 网格边）按拾取射线在线上的控制点派生；Significant Snaps
   * 开着且线带中间显著点时先取控制点所在的那一段（E3D `intermediates`）。
   * Intersect 要两次拾取，流程尚未接入，这里原样放行。派生失败（射线与线平行等）也原样放行。
   */
  function applyPickTypeDerivation(
    hit: PickHit,
    candidate: MeasurementPickCandidate,
    canvas: HTMLCanvasElement,
    cursor: Readonly<{ x: number; y: number }>,
  ): PickHit {
    const layer = measurementStyle.state.measurementPickLayer;
    if (layer.pickType === 'intersect') return hit;
    const kernelType: PickDerivationType = layer.pickType;
    const toDesign = (v: Vector3): PickVec3 => vec3ToTuple(sceneWorldToDesignMeters(v, dtxLayerRef));

    let geometry: PickGeometry;
    const ray = designPickRay(canvas, cursor);
    if (candidate.segment) {
      if (!ray) return hit;
      const segment = selectSignificantSubSegment(candidate.segment, layer.significantSnaps, ray, toDesign);
      geometry = { kind: 'segment', start: toDesign(segment.start), end: toDesign(segment.end) };
    } else if (candidate.plane) {
      // 面候选（Graphics facet）：所有单击拾取类型都回 射线 ∩ 平面（E3D `GRAPHICS` PLANE 分支）。
      if (!ray) return hit;
      geometry = {
        kind: 'plane',
        position: toDesign(candidate.plane.position),
        normal: vec3ToTuple(sceneDirectionToDesign(candidate.plane.position, candidate.plane.normal, dtxLayerRef)),
      };
    } else {
      // 点候选：除 Distance 外所有拾取类型都回它自己（E3D PPOINT / DPOINT / Aid POSITION 口径）。
      if (kernelType !== 'distance') return hit;
      geometry = {
        kind: 'point',
        position: toDesign(hit.worldPos),
        direction: hit.direction
          ? vec3ToTuple(sceneDirectionToDesign(hit.worldPos, hit.direction, dtxLayerRef))
          : null,
      };
    }

    const result = derivePickPosition({
      type: kernelType,
      geometry,
      ray,
      distance: layer.values.distanceMm / 1000,
      fraction: layer.values.fraction,
      proportion: layer.values.proportion,
    });
    if (!result.ok) return hit;

    const worldPos = designMetersToSceneWorld(tupleToVector(result.position), dtxLayerRef);
    if (worldPos.distanceToSquared(hit.worldPos) <= 1e-18) return hit;
    const token = measurementPickTypePromptToken(layer.pickType, layer.values);
    return {
      ...hit,
      worldPos,
      label: hit.label ? `${hit.label} · ${token}` : token,
      derived: { pickType: layer.pickType, from: hit.worldPos.clone() },
    };
  }

  /** 去掉 `applyPickTypeDerivation` 缀在标签后的 ` · <拾取类型>` 记号（当前拾取层的那一个）。 */
  function stripPickTypeToken(label: string): string {
    const layer = measurementStyle.state.measurementPickLayer;
    const suffix = ` · ${measurementPickTypePromptToken(layer.pickType, layer.values)}`;
    return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
  }

  // ── E3D Intersect 拾取类型：一个测量点 = 两（三）次子拾取求交 ──
  /** 当前求交会话（设计 World 几何）；`intersectOrdinal` 是 `Intersection[n]` 的 n，响应式给提示条用。 */
  let intersectSession: IntersectPickSession = EMPTY_INTERSECT_SESSION;
  const intersectOrdinal = ref(1);

  function setIntersectSession(next: IntersectPickSession): void {
    intersectSession = next;
    intersectOrdinal.value = intersectPickOrdinal(next);
  }

  function clearIntersectSession(): boolean {
    const hadPending = intersectSession.operands.length > 0;
    setIntersectSession(EMPTY_INTERSECT_SESSION);
    return hadPending;
  }

  function isIntersectPickType(): boolean {
    return measurementStyle.state.measurementPickLayer.pickType === 'intersect';
  }

  /**
   * 把拾中候选的几何换到设计 World，按 `EDGPICKTYPE.intersect` 的分型转成 LINE / PLANE 操作数。
   * 线候选自己的 `segment` 优先；没有时，拾中的元素按 E3D `edgTypes.attribute(noun).line(item)` 用它的
   * P1 → P2（`elementLine`）当 LINE——这就是 E3D 里 ELEMENT 类型的 `intersect()` 分支。
   */
  function intersectOperandFromHit(hit: PickHit): IntersectOperand | null {
    const toDesign = (v: Vector3): PickVec3 => vec3ToTuple(sceneWorldToDesignMeters(v, dtxLayerRef));
    const toDesignDir = (origin: Vector3, v: Vector3): PickVec3 => vec3ToTuple(sceneDirectionToDesign(origin, v, dtxLayerRef));
    const line = hit.segment ?? hit.elementLine ?? null;
    return intersectOperandFromGeometry({
      segment: line ? { start: toDesign(line.start), end: toDesign(line.end) } : null,
      plane: hit.plane
        ? { position: toDesign(hit.plane.position), normal: toDesignDir(hit.plane.position, hit.plane.normal) }
        : null,
      position: toDesign(hit.worldPos),
      direction: hit.direction ? toDesignDir(hit.worldPos, hit.direction) : null,
    });
  }

  /** 交点作为测量点：位置换回场景坐标，几何字段清空（E3D 回的是 POSITION，不再带线 / 面）。 */
  function intersectionHit(lastHit: PickHit, position: PickVec3): PickHit {
    const worldPos = designMetersToSceneWorld(tupleToVector(position), dtxLayerRef);
    const { direction: _d, circle: _c, arc: _a, segment: _s, plane: _p, triangle: _t, ...rest } = lastHit;
    return {
      ...rest,
      worldPos,
      label: '交点',
      derived: { pickType: 'intersect', from: lastHit.worldPos.clone() },
    };
  }

  function intersectPendingText(session: IntersectPickSession): string {
    const items = session.labels.map((label, index) => `${index + 1}. ${label || '拾中项'}（${session.operands[index]?.kind === 'plane' ? '面' : '线'}）`);
    return `求交已选 ${items.join('；')}，再选一项（Intersection[${intersectPickOrdinal(session)}]）`;
  }

  /**
   * Intersect 子拾取（点击）：把这一击转成操作数喂给会话。返回交点命中 = 这一击产生测量点；
   * 返回 null = 还在等下一次子拾取或这一击被拒（原因已写进 pickPointMessage）。
   */
  function consumeIntersectSubPick(hit: PickHit): PickHit | null {
    // 元素当线用时，操作数标签写成它的轴线而不是「模型表面点」（E3D 这一击拾的是元素本身）。
    const usesElementLine = !hit.segment && Boolean(hit.elementLine);
    const label = formatMeasurementSnapLabel({
      label: usesElementLine ? ELEMENT_LINE_LABEL : hit.label,
      noun: nounForRefno(hit.refno ?? null),
      refno: hit.refno,
    });
    const step = advanceIntersectPick(intersectSession, intersectOperandFromHit(hit), label);
    setIntersectSession(step.session);
    if (step.status === 'resolved') {
      pickPointMessage.value = null;
      return intersectionHit(hit, step.position);
    }
    pickPointMessage.value = step.status === 'need-more'
      ? intersectPendingText(step.session)
      : `${step.message}${step.session.operands.length > 0 ? `；${intersectPendingText(step.session)}` : ''}`;
    return null;
  }

  /** Intersect 悬停预览：已有操作数时，用当前悬停项试算交点，成了就把命中挪到交点上（不改会话）。 */
  function previewIntersectHit(hit: PickHit): PickHit {
    if (intersectSession.operands.length === 0) return hit;
    const step = advanceIntersectPick(intersectSession, intersectOperandFromHit(hit));
    if (step.status !== 'resolved') return hit;
    return { ...intersectionHit(hit, step.position), label: '交点（预览）' };
  }

  /**
   * E3D `intermediates`：线带中间显著点（如型材上的接头位置）且 Significant Snaps 开着时，
   * Snap / Distance / Proportion / Fraction 作用在控制点所在的那一小段上，而不是整条线。
   */
  function selectSignificantSubSegment(
    segment: NonNullable<MeasurementPickCandidate['segment']>,
    significantSnaps: boolean,
    ray: Readonly<{ origin: PickVec3; direction: PickVec3 }>,
    toDesign: (v: Vector3) => PickVec3,
  ): Readonly<{ start: Vector3; end: Vector3 }> {
    const intermediates = segment.intermediates ?? [];
    if (!significantSnaps || intermediates.length === 0) return segment;
    const whole = { start: toDesign(segment.start), end: toDesign(segment.end) };
    const control = lineRayControlPoint(whole, ray);
    if (!control) return segment;
    const chain = [segment.start, ...intermediates, segment.end];
    for (let index = 0; index + 1 < chain.length; index += 1) {
      const start = chain[index]!;
      const end = chain[index + 1]!;
      if (isWithinSegmentExtent({ start: toDesign(start), end: toDesign(end) }, control)) {
        return { start, end };
      }
    }
    return segment;
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

  /**
   * E3D「Perpendicular to」：按第二击点源自带的几何推导目标（轴向 → 无限线、
   * 圆面 → 无限面、否则退化为点），把起点投影到目标得到垂足作为记录的 target。
   * 垂距为 0（起点已在目标上）或几何退化时返回 null，对应 E3D 的
   * "Perpendicular distance is 0" 告警。
   */
  function resolvePerpendicularTargetFromHit(
    origin: MeasurementPoint,
    hit: PickHit,
    picked: MeasurementPoint,
  ): { target: MeasurementPoint; info: PerpendicularMeasurementInfo; exactTarget: boolean } | null {
    const sourceDesign = origin.designWorldPos;
    const pointDesign = picked.designWorldPos;
    if (!sourceDesign || !pointDesign) return null;
    const designDirection = (direction: Vector3): Vec3 => (
      vec3ToTuple(sceneDirectionToDesign(hit.worldPos, direction, dtxLayerRef))
    );
    const designPosition = (position: Vector3): Vec3 => (
      vec3ToTuple(sceneWorldToDesignMeters(position, dtxLayerRef))
    );
    const circular = hit.circle ?? hit.arc ?? null;
    // 拾中的是元素本身（表面点 / Item 原点）且元素有 E3D `line()` 时，目标线 = 它的 P1 → P2，
    // 过 P1 而不是过拾中点（`edgpositiondata.line()` 对 ELEMENT 就是 `edgTypes.attribute(noun).line(item)`）。
    const elementLine = !hit.direction && !hit.plane && !circular && hit.elementLine ? hit.elementLine : null;
    const resolved = resolvePerpendicularTarget({
      point: elementLine ? designPosition(elementLine.start) : pointDesign,
      direction: hit.direction
        ? designDirection(hit.direction)
        : elementLine
          ? designDirection(elementLine.end.clone().sub(elementLine.start))
          : null,
      circle: circular
        ? { center: designPosition(circular.center), normal: designDirection(circular.normal) }
        : null,
      plane: hit.plane
        ? { position: designPosition(hit.plane.position), normal: designDirection(hit.plane.normal) }
        : null,
    });
    const result = computePerpendicularDistance(sourceDesign, resolved.target);
    if (!result.ok) return null;

    const baseLabel = picked.sourceInfo?.label ?? null;
    if (resolved.provider === 'point') {
      return {
        target: picked,
        info: { targetKind: 'point', targetLabel: baseLabel },
        exactTarget: false,
      };
    }
    const providerLabel = resolved.provider === 'axis-line'
      ? '轴线'
      : resolved.provider === 'facet-plane'
        ? '所在平面'
        : '圆面';
    // 拾中的候选本身就是一条线（PLINE 线 / Graphics 边 / TUBING 轴线，带 `segment`）时，目标就是它：
    // 标签用候选自己的名字（去掉 Snap / Mid-Point 等派生记号），不再缀「轴线」——E3D `edgsctn.snap → this.line`
    // 的 Perpendicular 目标就是那条 p-line。
    const lineLabel = hit.segment && !elementLine && resolved.provider === 'axis-line'
      ? stripPickTypeToken(baseLabel ?? MEASUREMENT_PICK_SOURCE_LABELS[hit.source])
      : null;
    const targetLabel = elementLine
      ? formatMeasurementSnapLabel({ label: ELEMENT_LINE_LABEL, noun: nounForRefno(hit.refno ?? null), refno: hit.refno })
      : lineLabel ?? `${baseLabel ?? MEASUREMENT_PICK_SOURCE_LABELS[hit.source]} ${providerLabel}`;
    const footDesign: Vec3 = [result.value.foot[0], result.value.foot[1], result.value.foot[2]];
    const footScene = designMetersToSceneWorld(tupleToVector(footDesign), dtxLayerRef);
    return {
      target: {
        entityId: picked.entityId,
        worldPos: vec3ToTuple(footScene),
        designWorldPos: footDesign,
        sourceInfo: {
          source: picked.sourceInfo?.source ?? hit.source,
          candidateId: picked.sourceInfo?.candidateId,
          refno: picked.sourceInfo?.refno ?? null,
          label: `${targetLabel}垂足`,
        },
      },
      info: { targetKind: resolved.target.kind, targetLabel },
      // 垂足落在元素的 P1 → P2 上（ptset / 放置矩阵给的精确线）时，拾中它用的那个表面点不再决定「近似」。
      exactTarget: Boolean(elementLine),
    };
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
   * 未选中（或选中的不是距离测量）时优先取临时结果（S3 态，可能未落
   * 持久记录），再回落到 createdAt 最新一条持久记录。
   */
  function repeatLastDistanceMeasurement(): boolean {
    if (suppressStoreMeasurements) return false;
    if (store.toolMode.value !== 'xeokit_measure_distance') return false;
    if (store.currentXeokitDistanceDraft.value) return false;
    const records = store.xeokitDistanceMeasurements.value;
    const activeId = store.activeXeokitMeasurementId.value;
    const active = activeId
      ? records.find((record) => record.id === activeId) ?? null
      : null;
    const latestRecord = records.length > 0
      ? records.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a))
      : null;
    const draftResult = store.measurementDraftResult.value;
    const draftResultIsNewest = draftResult
      && (!latestRecord || draftResult.createdAt >= latestRecord.createdAt);
    const source = active ?? (draftResultIsNewest ? draftResult : latestRecord);
    if (!source) return false;
    startDistanceDraftFrom(source.target);
    syncFromStore();
    requestRender?.();
    return true;
  }

  /**
   * 把当前临时结果落地为持久测量记录（Result Inspector「落地标注」）。
   * keepMeasurementAnnotation 开启时第二击已自动保留，此函数是显式补入口。
   */
  function persistDraftResult(): boolean {
    if (suppressStoreMeasurements) return false;
    const result = store.measurementDraftResult.value;
    if (!result || result.persistedMeasurementId) return false;
    const rec: XeokitDistanceMeasurementRecord = {
      id: result.id,
      kind: 'distance',
      origin: result.origin,
      target: result.target,
      visible: true,
      approximate: result.approximate,
      createdAt: result.createdAt,
      sourceAnnotationId: store.activeAnnotationContext.value?.id,
      sourceAnnotationType: store.activeAnnotationContext.value?.type,
    };
    if (!measurementStyle.state.distanceKeepDimensions) {
      for (const measurement of store.xeokitDistanceMeasurements.value) {
        store.updateXeokitMeasurementVisible(measurement.id, false);
      }
    }
    store.addXeokitDistanceMeasurement(rec);
    store.setMeasurementDraftResult({ ...result, persistedMeasurementId: rec.id });
    syncFromStore();
    updateSelectionBinding(rec.id);
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

  /** 元素类型：优先取已加载 DTX 缓存（同步、离线可用），否则等异步 e3d 查询。 */
  function nounForRefno(refno: string | null): string | null {
    if (!refno) return null;
    try {
      const local = resolveDtxNounByRefno(getDbnumByRefno(refno), refno);
      if (local) return local;
    } catch {
      // dbnum 未知时只依赖异步缓存
    }
    // 点集响应随点带回的 noun：没有几何、不在 DTX 登记里的构件（ATTA）只有这里知道它是什么。
    const fromPtset = ptsetResponseByRefno.get(refno.replace(/\//g, '_'))?.noun?.trim();
    if (fromPtset) return fromPtset;
    return getCachedNounForRefno(refno);
  }

  /**
   * 命令条 Snap 目标名（E3D `Snap :VALVE` 口径）：
   * hover 命中时显示「元素类型 + 点源标签」；未命中时回落可捕捉点源列表。
   */
  function currentSnapTargetText(): string {
    const target = hoverSnapTarget.value;
    if (target) {
      const text = formatMeasurementSnapLabel({
        label: target.label,
        noun: nounForRefno(target.refno),
        refno: target.refno,
      });
      if (text) return text;
    }
    return `等待捕捉（${activeSnapSourceText()}）`;
  }

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

    if (enabledSnapSources().length === 0) {
      return '测量模式：未启用任何测量点源捕捉';
    }
    const snapText = currentSnapTargetText();

    // E3D `EDGSTATE.prompt()` 结构：`<命令> <步> (<拾取类型>) [Snap] : <目标>`——
    // 括号里是拾取类型（Snap / Cursor / Mid-Point / Distance[d] …），尾巴的 Snap 是
    // Significant Snaps 开着的标志；拾取过滤器不进提示（与 E3D 一致）。
    const layer = measurementStyle.state.measurementPickLayer;
    // Intersect 的 token 带子拾取序号（E3D `Intersection[minor]`）。
    const pickTypeToken = measurementPickTypePromptToken(layer.pickType, layer.values, intersectOrdinal.value);
    const CANCEL_TRAILER = '；点空白取消当前点选';
    const prompt = (
      command: string,
      stepIndex: number,
      stepTotal: number,
      stepHint: string,
      trailer: string | null = null,
    ): string => formatMeasurementPrompt({
      command,
      stepIndex,
      stepTotal,
      stepHint,
      pickTypeToken,
      significantSnaps: layer.significantSnaps,
      target: snapText,
      trailer,
    });

    if (mode === 'xeokit_measure_distance') {
      // E3D：Perpendicular to 时提示变为 "Measure perpendicular distance start / end"。
      const title = measurementStyle.state.perpendicularTo ? '垂距测量' : '距离测量';
      const endHint = measurementStyle.state.perpendicularTo ? '选择目标线 / 面上的点' : '选择终点';
      return store.currentXeokitDistanceDraft.value
        ? prompt(title, 2, 2, endHint, CANCEL_TRAILER)
        : prompt(title, 1, 2, '选择起点');
    }

    if (mode === 'xeokit_measure_angle') {
      const draft = store.currentXeokitAngleDraft.value;
      if (!draft) return prompt('角度测量', 1, 3, '选择角度顶点');
      if (draft.stage === 'finding_first_arm') {
        return prompt('角度测量', 2, 3, '选择第一边点', CANCEL_TRAILER);
      }
      return prompt('角度测量', 3, 3, '选择第二边点', CANCEL_TRAILER);
    }

    if (mode === 'xeokit_measure_elevation_point') {
      return prompt('位置/标高', 1, 1, '选择测量点', '，单击完成');
    }

    return store.currentXeokitElevationDeltaDraft.value
      ? prompt('高差测量', 2, 2, '选择终点', CANCEL_TRAILER)
      : prompt('高差测量', 1, 2, '选择起点');
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
          ...(hit.triangle ? { triangle: hit.triangle } : {}),
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
    const rectSize = { width: rect.width, height: rect.height };
    const candidates: MeasurementPickCandidate[] = [
      ...buildPtsetCandidates(),
      ...attachElementLine([...buildMeshPickCandidate(base), ...buildPositionCandidates(base, surfaceRefno)], surfaceRefno),
      ...buildPrimitiveKeyPointCandidates(base, surfaceRefno, { x: cursor.x, y: cursor.y }, camera, rectSize),
      ...buildGraphicsCandidates(base, { x: cursor.x, y: cursor.y }, camera, rectSize),
      ...buildTubingAxisCandidates(base, { x: cursor.x, y: cursor.y }, camera, rectSize),
    ];
    const resolution = resolveMeasurementPickCandidates({
      cursor: { x: cursor.x, y: cursor.y },
      camera,
      rect: rectSize,
      settings: measurementStyle.state.measurementPickSources,
      candidates,
      pickLayer: pickLayerGate(),
    });
    showHoverPickCandidates(resolution.visibleCandidates, resolution.hit);

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

    if (
      surfaceRefno
      && measurementStyle.state.measurementPickMode === 'e3d'
      && measurementStyle.state.measurementPickSources.primitive_key_point.snap
      && loadingPrimitiveKeypointRefnos.has(surfaceRefno)
    ) {
      pickPointMessage.value = '基本体与 PLINE 关键点正在加载，加载完成后再确认测量点';
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
        hit: applyPickTypeDerivation(
          candidateToPickHit(resolution.hit),
          resolution.hit,
          canvas,
          { x: cursor.x, y: cursor.y },
        ),
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

    // E3D 元素类拾取：光标落在元素任意处就是拾中元素本身；要它当线用（Intersect 操作数 / Perpendicular 目标）时，
    // 即便表面点源关着、也没有别的候选，拾中的元素仍按 `edgTypes.attribute(noun).line()` 给 P1 → P2。
    const elementLinePick = elementPickAsLine(base, surfaceRefno);
    if (elementLinePick) {
      pickPointMessage.value = null;
      return { hit: elementLinePick, preview: null, surfaceRefno, source: elementLinePick.source, reason: null };
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
          (await queryPrimitiveKeypointsForMeasurement(dbno, normalizedRefno)).items,
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
        ...(candidate.sceneDir ? { direction: new Vector3(...candidate.sceneDir) } : {}),
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
    const rect = canvas.getBoundingClientRect();
    const candidates: MeasurementPickCandidate[] = [
      ...buildPtsetCandidates(),
      ...buildMeshPickCandidate(base),
      ...buildPositionCandidates(base, surfaceRefno),
      ...buildPrimitiveKeyPointCandidates(base, surfaceRefno, screen, camera, { width: rect.width, height: rect.height }),
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
    const resolution = resolveMeasurementPickCandidates({
      cursor: screen,
      camera,
      rect: { width: rect.width, height: rect.height },
      settings,
      candidates,
      pickLayer: pickLayerGate(),
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
    hoverSnapTarget.value = null;
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
    // 表面点本身是近似的；拾中元素当线用（P1 → P2 由 ptset / 放置矩阵给出）时那条线是精确几何，不标近似。
    const subtitle = source === 'mesh_pick_point' && hit?.label !== ELEMENT_LINE_LABEL
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
    if (hit) {
      const refno = hit.refno ?? refnoFromObjectId(hit.objectId);
      hoverSnapTarget.value = { label: hit.label ?? null, refno };
      // 预取元素类型（VALVE/PIPE/…），命令条 Snap 目标名异步补全。
      requestNounForRefno(refno);
    } else {
      hoverSnapTarget.value = null;
    }
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
    const addRecord = (
      record: XeokitMeasurementRecord,
      isDraft = false,
      showDirectLinearDimension = true,
    ) => {
      const external = xeokitMeasurementToExternalRecord(
        record,
        unitSettings.displayUnit.value,
        unitSettings.precision.value,
        options.sceneWorldToDesignMetres,
        isDraft,
        showDirectLinearDimension,
      );
      if (external) records.push(external);
      if (
        record.kind === 'distance'
        && !isDraft
        && record.perpendicular
        && measurementStyle.state.distanceShowAxisBreakdown
      ) {
        // E3D 垂距尺寸：不画 World 分量，改画 Vertical / Horizontal 两条腿
        // （golden G4；Vertical 为 0 时只剩直接线）。
        const parentId = `${DIMENSION_XEOKIT_PREFIX}${record.id}`;
        const plan = buildPerpendicularAidPlan({
          parentId,
          foot: toDesignPoint(record.target, options.sceneWorldToDesignMetres),
          source: toDesignPoint(record.origin, options.sceneWorldToDesignMetres),
        });
        for (const leg of plan.legs) {
          records.push(perpendicularAidLegToExternalRecord(
            leg,
            unitSettings.displayUnit.value,
            unitSettings.precision.value,
          ));
        }
      } else if (
        record.kind === 'distance'
        && !isDraft
        && measurementStyle.state.distanceShowAxisBreakdown
      ) {
        const parentId = `${DIMENSION_XEOKIT_PREFIX}${record.id}`;
        const a = toDesignPoint(record.origin, options.sceneWorldToDesignMetres);
        const b = toDesignPoint(record.target, options.sceneWorldToDesignMetres);
        // 直接斜线由上面的 external 记录负责；这里传真实的 Show linear 只为驱动
        // E3D 的分解闸门（单一正向轴向 + 直线可见时不画分量，golden G2-03）。
        const plan = buildWorldDistanceAidPlan({
          parentId,
          origin: a,
          target: b,
          showDirect: showDirectLinearDimension,
          showOrthogonal: true,
        });
        for (const part of plan.parts) {
          if (part.kind === 'axis') {
            records.push(worldDistanceAidPartToExternalRecord(
              part,
              unitSettings.displayUnit.value,
              unitSettings.precision.value,
            ));
          }
        }
      }
    };

    if (!suppressStoreMeasurements) {
      for (const record of store.xeokitDistanceMeasurements.value) {
        addRecord(
          record,
          false,
          measurementStyle.state.showDirectLinearDimension,
        );
      }
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

      const result = store.measurementDraftResult.value;
      if (result && !result.persistedMeasurementId) {
        addRecord({
          id: result.id,
          kind: 'distance',
          origin: result.origin,
          target: result.target,
          visible: true,
          approximate: result.approximate,
          createdAt: result.createdAt,
          ...(result.perpendicular ? { perpendicular: result.perpendicular } : {}),
        }, false, measurementStyle.state.showDirectLinearDimension);
      }
    }

    dimensionSystem.replaceExternalSource('xeokit-measurement', records);
    requestRender?.();
  }

  function updateSelectionBinding(id: string | null): void {
    const dimensionSystem = options.getDimensionSystem?.() ?? null;
    if (!dimensionSystem) return;
    if (id) {
      const current = dimensionSystem.viewport.getSelection();
      if (resolveMeasurementIdFromDimensionId(current) === id) return;
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
  function resolveMeasurementIdFromDimensionId(
    dimensionId: string | null,
  ): string | null {
    if (!dimensionId?.startsWith(DIMENSION_XEOKIT_PREFIX)) return null;
    const id = dimensionId.slice(DIMENSION_XEOKIT_PREFIX.length);
    const child = id.match(/^(.*)::(?:world-axis-[xyz]|perpendicular-(?:vertical|horizontal))$/);
    return child?.[1] || id;
  }

  function handleDimensionSelectionChange(dimensionId: string | null): void {
    const id = resolveMeasurementIdFromDimensionId(dimensionId);
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
    clearIntersectSession();
    store.setMeasurementDetailsDrawerOpen(false);
    store.setToolMode(mode);
  }

  /**
   * ESC 语义分层（r5 §3）：Intersect 子拾取进行中 → 先只放弃已选的线 / 面（E3D
   * "escape to abort the operation"）；草稿进行中 → 取消草稿；无草稿但有临时结果
   * （S3）→ 丢弃临时结果；两者皆无返回 false，由调用方退出测量模式。
   */
  function reset(): boolean {
    if (clearIntersectSession()) {
      pickPointMessage.value = null;
      clearHoverFeedback();
      requestRender?.();
      return true;
    }
    const hadDraft = currentMeasurement.value !== null;
    clickTracker.value = { down: null, moved: false };
    store.clearCurrentXeokitDraft();
    clearHoverFeedback();
    clearMeasurementVisualAssists();
    syncFromStore();
    requestRender?.();
    if (hadDraft) return true;
    if (store.measurementDraftResult.value) {
      store.setMeasurementDraftResult(null);
      return true;
    }
    return false;
  }

  function deactivate() {
    reset();
    store.setMeasurementDraftResult(null);
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
    // Intersect：已有子拾取时悬停预览交点位置，否则照常显示候选。
    const hit = pick.hit && isIntersectPickType() ? previewIntersectHit(pick.hit) : pick.hit;
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
    let hit = pick.hit;
    currentHoverRefno = pick.surfaceRefno;
    if (hit && isIntersectPickType()) {
      // E3D Intersect：这一击是子拾取。凑齐线 / 面求出交点才往下走成测量点；否则停在这一步等下一击。
      const resolved = consumeIntersectSubPick(hit);
      if (!resolved) {
        syncMeasurementVisualAssists(pick.surfaceRefno, hit);
        updateHoverFeedback(canvas, e, hit, pick.preview);
        requestRender?.();
        return;
      }
      hit = resolved;
    }
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

      const pickedTarget = measurementPointFromHit(hit);
      let target = pickedTarget;
      let perpendicular: PerpendicularMeasurementInfo | undefined;
      let exactTarget = false;
      if (measurementStyle.state.perpendicularTo) {
        const resolved = resolvePerpendicularTargetFromHit(draft.origin, hit, pickedTarget);
        if (!resolved) {
          // E3D：垂距为 0 时 setPerpendicularMeasure 告警并回到 start 态。
          pickPointMessage.value = 'Perpendicular distance is 0：起点已落在目标线 / 面上，无法绘制垂距尺寸';
          store.clearCurrentXeokitDraft();
          clearMeasurementVisualAssists();
          syncFromStore();
          requestRender?.();
          return;
        }
        target = resolved.target;
        perpendicular = resolved.info;
        exactTarget = resolved.exactTarget;
      }
      const approximate = hasApproximatePoint(draft.origin) || (!exactTarget && hasApproximatePoint(pickedTarget));
      const resultValues = computeDistanceMeasurementResult(draft.origin, target);
      if (!resultValues) {
        pickPointMessage.value = '距离测量失败：起点或终点缺少有效的设计 World 坐标';
        requestRender?.();
        return;
      }
      const keepMeasurementAnnotation = measurementStyle.state.keepMeasurementAnnotation;
      // 第二击始终产出会话结果；是否显示直接斜线、是否保留为 Web 标注
      // 分别由两个独立选项控制。
      store.setMeasurementDraftResult({
        id: draft.id,
        kind: 'distance',
        origin: draft.origin,
        target,
        ...resultValues,
        approximate,
        createdAt: draft.createdAt,
        persistedMeasurementId: keepMeasurementAnnotation ? draft.id : null,
        ...(perpendicular ? { perpendicular } : {}),
      });
      if (keepMeasurementAnnotation) {
        const rec: XeokitDistanceMeasurementRecord = {
          id: draft.id,
          kind: 'distance',
          origin: draft.origin,
          target,
          visible: true,
          approximate,
          createdAt: draft.createdAt,
          sourceAnnotationId: store.activeAnnotationContext.value?.id,
          sourceAnnotationType: store.activeAnnotationContext.value?.type,
          ...(perpendicular ? { perpendicular } : {}),
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
      store.clearCurrentXeokitDraft();
      if (store.continuousDistanceMeasureEnabled.value) {
        retainMeasurementVisualAssistsFor(target);
        startDistanceDraftFrom(target);
      } else {
        clearMeasurementVisualAssists();
      }
      syncFromStore();
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
    try { hoverOutlineHighlighter?.dispose(); } catch { /* ignore */ }
    hoverOutlineHighlighter = null;
    hoverOutlineRefno = null;
    try { hoverPickCandidateGroup.parent?.remove(hoverPickCandidateGroup); } catch { /* ignore */ }
    requestedPtsetRefnos.clear();
    ptsetResponseByRefno.clear();
    ptsetErrorByRefno.clear();
    ptsetLoadStateByRefno.clear();
    ptsetChildRefnosByOwner.clear();
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
      store.measurementDraftResult.value,
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

  // 换拾取类型 / 拾取过滤器就放弃进行中的 Intersect 子拾取（E3D 切 pickType 会重置 numberOfPicks）。
  watch(
    () => [measurementStyle.state.measurementPickLayer.pickType, measurementStyle.state.measurementPickLayer.filter],
    () => {
      if (clearIntersectSession()) {
        pickPointMessage.value = null;
      }
    },
  );

  return {
    ready,
    statusText,
    /** 拾取失败 / Intersect 子拾取进度等提示（只读）。 */
    pickPointMessage: computed(() => pickPointMessage.value),
    /** 当前悬停捕捉目标（只读）。 */
    hoverSnapTarget: computed(() => hoverSnapTarget.value),
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
    persistDraftResult,
    handleDimensionSelectionChange,
    resolveMeasurementIdFromDimensionId,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    queryDimensionSnapCandidates,
    loadDimensionAnchorCandidates,
    dispose,
  };
}
