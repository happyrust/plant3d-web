import { Matrix4, Vector3 } from 'three';

import {
  DEFAULT_PTSET_SNAP_PX,
  projectToCanvas,
  type CanvasPosLike,
  type CanvasRectLike,
} from './usePtsetSnap';

import type { Camera } from 'three';

import {
  nearestPointOnSegmentToRay,
  type GraphicsVec3,
  type MeshGraphicsFeatures,
} from '@/measurement/graphics/meshFeatureGraphics';
import {
  measurementPickFilterAdmits,
  type MeasurementPickFeature,
  type MeasurementPickFilterId,
  type MeasurementPickTypeId,
} from '@/measurement/pick/pickLayerModel';

export const DEFAULT_POSITION_SNAP_PX = 18;
export const MEASUREMENT_SNAP_TIE_PX = 4;

export type MeasurementPickSourceId =
  | 'mesh_pick_point'
  | 'ptset'
  | 'position'
  | 'primitive_key_point'
  /** E3D Graphics detail derived from the loaded mesh: drawn edges (lines) and facets (planes). */
  | 'mesh_graphics';

export type MeasurementPickSourceSetting = {
  show: boolean;
  snap: boolean;
  priority: number;
  thresholdPx: number;
};

export type MeasurementPickSourceSettings = Record<
  MeasurementPickSourceId,
  MeasurementPickSourceSetting
>;

/**
 * Line-bearing geometry a candidate lends to the E3D pick-type kernel
 * (`GMFLINE`): PLINE, TUBING axis, Graphics edge. `intermediates` are the
 * significant split points along the line that E3D's `intermediates` flag
 * (Significant Snaps) makes Snap / Distance / Proportion / Fraction work on.
 */
export type MeasurementPickSegment = Readonly<{
  start: Vector3;
  end: Vector3;
  intermediates?: readonly Vector3[];
}>;

export type MeasurementPickCandidate = {
  id: string;
  source: MeasurementPickSourceId;
  entityId: string;
  objectId: string;
  worldPos: Vector3;
  label?: string | null;
  direction?: Vector3;
  circle?: Readonly<{ center: Vector3; rim: Vector3; normal: Vector3 }>;
  arc?: Readonly<{ center: Vector3; rim: Vector3; normal: Vector3 }>;
  /** E3D pick-filter feature class; when absent, the source default applies. */
  feature?: MeasurementPickFeature;
  /** Present when the candidate is a line (pick types other than Snap / Cursor act on it). */
  segment?: MeasurementPickSegment;
  /** Present when the candidate is a facet (E3D Graphics PLANE): every single-pick type returns ray ∩ plane. */
  plane?: MeasurementPickPlane;
};

/**
 * Plane-bearing geometry (E3D `GMFPLANE` from a Graphics facet, `getPlane()`).
 * `outline` is the boundary of the coplanar patch for highlighting only.
 */
export type MeasurementPickPlane = Readonly<{
  position: Vector3;
  normal: Vector3;
  outline?: readonly MeasurementPickSegment[];
}>;

/**
 * Default E3D feature class per Web point source (`EDGPOSITIONDATA.type`):
 * `ptset` is PPOINT, Item origin / primitive key points are ELEMENT significant
 * points, the mesh surface point is the exact cursor position (Screen / Element+Cursor),
 * mesh graphics are GRAPHICS details (edge by default; facet candidates set `graphics-plane`).
 */
export const MEASUREMENT_PICK_SOURCE_DEFAULT_FEATURE: Readonly<
  Record<MeasurementPickSourceId, MeasurementPickFeature>
> = {
  ptset: 'ppoint',
  position: 'element',
  primitive_key_point: 'element',
  mesh_pick_point: 'surface',
  mesh_graphics: 'graphics-line',
};

export function measurementPickCandidateFeature(
  candidate: Pick<MeasurementPickCandidate, 'source' | 'feature'>,
): MeasurementPickFeature {
  return candidate.feature ?? MEASUREMENT_PICK_SOURCE_DEFAULT_FEATURE[candidate.source];
}

/** The active E3D pick filter × pick type; `null` admits everything (legacy behaviour). */
export type MeasurementPickLayerGate = Readonly<{
  filter: MeasurementPickFilterId;
  pickType: MeasurementPickTypeId;
}>;

export function measurementPickLayerAdmits(
  gate: MeasurementPickLayerGate | null | undefined,
  candidate: Pick<MeasurementPickCandidate, 'source' | 'feature'>,
): boolean {
  if (!gate) return true;
  return measurementPickFilterAdmits(gate.filter, gate.pickType, measurementPickCandidateFeature(candidate));
}

export type ProjectedMeasurementPickCandidate =
  MeasurementPickCandidate & { pixelDistance: number };

export type MeasurementPickResolution = {
  hit: ProjectedMeasurementPickCandidate | null;
  visibleCandidates: ProjectedMeasurementPickCandidate[];
  snapCandidates: ProjectedMeasurementPickCandidate[];
};

export const MEASUREMENT_PICK_SOURCE_IDS: readonly MeasurementPickSourceId[] = [
  'ptset',
  'mesh_pick_point',
  'position',
  'primitive_key_point',
  'mesh_graphics',
] as const;

export const MEASUREMENT_PICK_SOURCE_LABELS: Record<MeasurementPickSourceId, string> = {
  mesh_pick_point: '模型表面点',
  ptset: 'P-Point',
  position: 'Item 原点',
  primitive_key_point: '基本体 / PLINE 关键点',
  mesh_graphics: '网格边 / 面（Graphics）',
};

/** Screen aperture inside which a drawn edge wins over the facet under the cursor (E3D `pickdetail`). */
export const DEFAULT_GRAPHICS_EDGE_SNAP_PX = 12;

export const DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS: Readonly<MeasurementPickSourceSettings> = {
  primitive_key_point: {
    show: false,
    snap: false,
    priority: 10,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
  ptset: {
    show: true,
    snap: true,
    priority: 20,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
  position: {
    show: true,
    snap: true,
    priority: 30,
    thresholdPx: DEFAULT_POSITION_SNAP_PX,
  },
  mesh_pick_point: {
    show: true,
    snap: false,
    priority: 40,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
  // Only reachable through the Graphics pick filter (E3D `stdAny` never picks detail
  // graphics), so snapping on by default does not change Any / Element behaviour.
  // Candidate crosses stay hidden: the picked edge / facet is highlighted instead.
  mesh_graphics: {
    show: false,
    snap: true,
    priority: 35,
    thresholdPx: DEFAULT_GRAPHICS_EDGE_SNAP_PX,
  },
};

export function clampMeasurementPickThreshold(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') {
    return DEFAULT_PTSET_SNAP_PX;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.min(40, Math.max(4, Math.round(parsed)))
    : DEFAULT_PTSET_SNAP_PX;
}

export function cloneMeasurementPickSourceSettings(
  input: Partial<Record<MeasurementPickSourceId, Partial<MeasurementPickSourceSetting>>> =
  DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS,
): MeasurementPickSourceSettings {
  const out = {} as MeasurementPickSourceSettings;
  for (const id of MEASUREMENT_PICK_SOURCE_IDS) {
    const fallback = DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS[id];
    const source = input[id] ?? {};
    out[id] = {
      show: source.show ?? fallback.show,
      snap: source.snap ?? fallback.snap,
      priority: Number.isFinite(source.priority)
        ? Number(source.priority)
        : fallback.priority,
      thresholdPx: clampMeasurementPickThreshold(source.thresholdPx ?? fallback.thresholdPx),
    };
  }
  return out;
}

export function measurementPickSettingsFromLegacy(input: {
  keypointSnapEnabled?: boolean;
  keypointSnapPx?: number;
}): MeasurementPickSourceSettings {
  const next = cloneMeasurementPickSourceSettings();
  if (typeof input.keypointSnapEnabled !== 'boolean' && input.keypointSnapPx === undefined) {
    return next;
  }

  const ptsetEnabled = input.keypointSnapEnabled ?? next.ptset.snap;
  next.ptset = {
    ...next.ptset,
    show: true,
    snap: ptsetEnabled,
    thresholdPx: clampMeasurementPickThreshold(input.keypointSnapPx),
  };
  return next;
}

export function sourceNeedsHoverData(setting: MeasurementPickSourceSetting | undefined): boolean {
  return Boolean(setting?.show || setting?.snap);
}

const PLINE_ENDPOINT_LABEL = /^PLINE (.+) (起点|终点)$/;

/**
 * legacy `semantic_snap_points` 把一条 PLINE 给成「起点 / 终点」两个点候选。E3D 的
 * PLINE 拾取是线：Snap 吸最近端、Mid-Point / Fraction / Proportion / Distance 沿线派生。
 * 这里把同一构件同一 PLINE 的两端配成一条 `segment` 挂回两端候选上（两端共用同一条线），
 * 并把它们的 feature 标成 `pline`，让拾取过滤器 Pline 与拾取类型内核都认得。配不上对的
 * 端点只标 feature，不造线。
 */
export function attachPlineSegments(
  candidates: readonly MeasurementPickCandidate[],
): MeasurementPickCandidate[] {
  const ends = new Map<string, { start?: MeasurementPickCandidate; end?: MeasurementPickCandidate }>();
  for (const candidate of candidates) {
    if (candidate.source !== 'primitive_key_point') continue;
    const match = PLINE_ENDPOINT_LABEL.exec(candidate.label ?? '');
    if (!match) continue;
    candidate.feature = 'pline';
    const key = `${candidate.objectId}|${match[1]}`;
    const entry = ends.get(key) ?? {};
    if (match[2] === '起点') entry.start = candidate;
    else entry.end = candidate;
    ends.set(key, entry);
  }
  for (const { start, end } of ends.values()) {
    if (!start || !end) continue;
    if (start.worldPos.distanceToSquared(end.worldPos) <= 1e-18) continue;
    const segment: MeasurementPickSegment = {
      start: start.worldPos.clone(),
      end: end.worldPos.clone(),
    };
    start.segment = segment;
    end.segment = segment;
  }
  return [...candidates];
}

export const GRAPHICS_EDGE_LABEL = '边';
export const GRAPHICS_FACET_LABEL = '面';
/** Most drawn edges offered around the cursor per hover (nearest first). */
const GRAPHICS_EDGE_CANDIDATE_LIMIT = 6;

function tupleToVector(v: GraphicsVec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

/**
 * E3D Graphics filter (`stdGraphics`, `inMode = 'pickdetail'`) on a mesh hit: the
 * drawn edges the cursor ray passes within `edgeThresholdPx` become **line**
 * candidates (`3D_LINE`, snapped at the point nearest the ray so the pick-type
 * kernel's control point lands on the edge); when no edge is that close, the
 * facet under the cursor becomes one **plane** candidate (`PLANE`) positioned at
 * the hit point, carrying the coplanar patch outline for highlighting.
 *
 * All geometry is in the frame of `features` (scene world).
 */
export function buildGraphicsPickCandidates(input: {
  objectId: string;
  entityId: string;
  features: MeshGraphicsFeatures;
  hitPoint: Vector3;
  hitTriangle: readonly [Vector3, Vector3, Vector3] | null;
  ray: Readonly<{ origin: Vector3; direction: Vector3 }>;
  cursor: CanvasPosLike;
  camera: Camera;
  rect: CanvasRectLike;
  edgeThresholdPx: number;
}): MeasurementPickCandidate[] {
  const ray = {
    origin: [input.ray.origin.x, input.ray.origin.y, input.ray.origin.z] as GraphicsVec3,
    direction: [input.ray.direction.x, input.ray.direction.y, input.ray.direction.z] as GraphicsVec3,
  };

  const edges: { candidate: MeasurementPickCandidate; pixelDistance: number }[] = [];
  input.features.edges.forEach((edge, index) => {
    const nearest = nearestPointOnSegmentToRay(edge, ray);
    if (!nearest) return;
    const projected = projectToCanvas([nearest.point[0], nearest.point[1], nearest.point[2]], input.camera, input.rect);
    if (!projected.visible) return;
    const pixelDistance = Math.hypot(projected.x - input.cursor.x, projected.y - input.cursor.y);
    if (pixelDistance > input.edgeThresholdPx) return;
    const start = tupleToVector(edge.start);
    const end = tupleToVector(edge.end);
    edges.push({
      pixelDistance,
      candidate: {
        id: `graphics:${input.objectId}:edge:${index}`,
        source: 'mesh_graphics',
        entityId: input.entityId,
        objectId: input.objectId,
        worldPos: tupleToVector(nearest.point),
        label: GRAPHICS_EDGE_LABEL,
        feature: 'graphics-line',
        segment: { start, end },
        // The infinite line through the edge is the Perpendicular-to LINE provider (E3D `getLine()`).
        direction: end.clone().sub(start),
      },
    });
  });
  if (edges.length > 0) {
    edges.sort((a, b) => a.pixelDistance - b.pixelDistance || a.candidate.id.localeCompare(b.candidate.id));
    return edges.slice(0, GRAPHICS_EDGE_CANDIDATE_LIMIT).map((entry) => entry.candidate);
  }

  if (!input.hitTriangle) return [];
  const [a, b, c] = input.hitTriangle;
  const triangle = input.features.findTriangle([a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]);
  if (triangle < 0) return [];
  const patch = input.features.coplanarPatch(triangle);
  if (!patch) return [];
  return [{
    id: `graphics:${input.objectId}:facet:${patch.triangles[0] ?? triangle}`,
    source: 'mesh_graphics',
    entityId: input.entityId,
    objectId: input.objectId,
    worldPos: input.hitPoint.clone(),
    label: GRAPHICS_FACET_LABEL,
    feature: 'graphics-plane',
    plane: {
      position: input.hitPoint.clone(),
      normal: tupleToVector(patch.plane.normal),
      outline: patch.outline.map((segment) => ({
        start: tupleToVector(segment.start),
        end: tupleToVector(segment.end),
      })),
    },
  }];
}

function matrixFromColsArray(raw: unknown): Matrix4 | null {
  if (!Array.isArray(raw) || raw.length !== 16) return null;
  const values = raw.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return new Matrix4().fromArray(values);
}

export function scenePositionFromTransform(input: {
  transform: unknown;
  globalModelMatrix?: Matrix4 | null;
}): Vector3 | null {
  const matrix = matrixFromColsArray(input.transform);
  if (!matrix) return null;

  const position = new Vector3(0, 0, 0).applyMatrix4(matrix);
  if (input.globalModelMatrix) {
    position.applyMatrix4(input.globalModelMatrix);
  }
  return position;
}

export function buildPositionPickCandidate(input: {
  refno: string | null;
  objectId: string;
  transform: unknown;
  globalModelMatrix?: Matrix4 | null;
}): MeasurementPickCandidate | null {
  const refno = String(input.refno || '').trim();
  if (!refno) return null;

  const position = scenePositionFromTransform({
    transform: input.transform,
    globalModelMatrix: input.globalModelMatrix ?? null,
  });
  if (!position) return null;

  return {
    id: `position:${refno}`,
    source: 'position',
    entityId: `position:${refno}`,
    objectId: input.objectId,
    worldPos: position,
    label: `Item 原点 ${refno}`,
  };
}

function projectCandidate(input: {
  candidate: MeasurementPickCandidate;
  cursor: CanvasPosLike;
  camera: Camera;
  rect: CanvasRectLike;
}): ProjectedMeasurementPickCandidate | null {
  const projected = projectToCanvas(
    [input.candidate.worldPos.x, input.candidate.worldPos.y, input.candidate.worldPos.z],
    input.camera,
    input.rect,
  );
  if (!projected.visible) return null;

  const pixelDistance = Math.hypot(
    projected.x - input.cursor.x,
    projected.y - input.cursor.y,
  );
  return {
    ...input.candidate,
    pixelDistance,
  };
}

function sortProjectedCandidates(
  candidates: ProjectedMeasurementPickCandidate[],
  settings: MeasurementPickSourceSettings,
): ProjectedMeasurementPickCandidate[] {
  candidates.sort((a, b) => (
    a.pixelDistance - b.pixelDistance || a.id.localeCompare(b.id)
  ));

  const sorted: ProjectedMeasurementPickCandidate[] = [];
  for (let start = 0; start < candidates.length;) {
    const first = candidates[start];
    if (!first) break;
    const minimumDistance = first.pixelDistance;
    let end = start + 1;
    while (end < candidates.length) {
      const candidate = candidates[end];
      if (
        !candidate
        || candidate.pixelDistance - minimumDistance > MEASUREMENT_SNAP_TIE_PX
      ) {
        break;
      }
      end += 1;
    }

    const cohort = candidates.slice(start, end).sort((a, b) => {
      const priorityDelta =
        (settings[a.source]?.priority ?? 999) - (settings[b.source]?.priority ?? 999);
      return (
        priorityDelta
        || a.pixelDistance - b.pixelDistance
        || a.id.localeCompare(b.id)
      );
    });
    sorted.push(...cohort);
    start = end;
  }

  candidates.splice(0, candidates.length, ...sorted);
  return candidates;
}

export function resolveMeasurementPickCandidates(input: {
  cursor: CanvasPosLike;
  camera: Camera;
  rect: CanvasRectLike;
  settings: MeasurementPickSourceSettings;
  candidates: readonly MeasurementPickCandidate[];
  /**
   * E3D Positioning Control gate (pick filter × pick type). Candidates the
   * filter does not admit are neither shown nor snapped — what you see is
   * what you can pick, as in E3D where only admitted items highlight.
   */
  pickLayer?: MeasurementPickLayerGate | null;
}): MeasurementPickResolution {
  const visibleCandidates: ProjectedMeasurementPickCandidate[] = [];
  for (const candidate of input.candidates) {
    if (input.settings[candidate.source]?.show !== true) continue;
    if (!measurementPickLayerAdmits(input.pickLayer, candidate)) continue;
    const projected = projectCandidate({
      candidate,
      cursor: input.cursor,
      camera: input.camera,
      rect: input.rect,
    });
    if (projected) visibleCandidates.push(projected);
  }

  const snapCandidates: ProjectedMeasurementPickCandidate[] = [];
  for (const candidate of input.candidates) {
    const setting = input.settings[candidate.source];
    if (!setting?.snap) continue;
    if (!measurementPickLayerAdmits(input.pickLayer, candidate)) continue;
    const projected = projectCandidate({
      candidate,
      cursor: input.cursor,
      camera: input.camera,
      rect: input.rect,
    });
    if (!projected || projected.pixelDistance > setting.thresholdPx) continue;
    snapCandidates.push(projected);
  }

  sortProjectedCandidates(visibleCandidates, input.settings);
  sortProjectedCandidates(snapCandidates, input.settings);

  return {
    hit: snapCandidates[0] ?? null,
    visibleCandidates,
    snapCandidates,
  };
}
