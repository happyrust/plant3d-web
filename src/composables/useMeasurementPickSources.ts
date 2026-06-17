import { Matrix4, Vector3 } from 'three';

import {
  DEFAULT_PTSET_SNAP_PX,
  projectToCanvas,
  type CanvasPosLike,
  type CanvasRectLike,
} from './usePtsetSnap';

import type { Camera } from 'three';

export type MeasurementPickSourceId =
  | 'mesh_pick_point'
  | 'ptset'
  | 'position'
  | 'primitive_key_point';

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

export type MeasurementPickCandidate = {
  id: string;
  source: MeasurementPickSourceId;
  entityId: string;
  objectId: string;
  worldPos: Vector3;
  label?: string | null;
};

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
] as const;

export const MEASUREMENT_PICK_SOURCE_LABELS: Record<MeasurementPickSourceId, string> = {
  mesh_pick_point: 'Mesh Pick Point',
  ptset: 'PTSET',
  position: 'Position',
  primitive_key_point: 'Primitive Key Point',
};

export const DEFAULT_MEASUREMENT_PICK_SOURCE_SETTINGS: Readonly<MeasurementPickSourceSettings> = {
  primitive_key_point: {
    show: false,
    snap: false,
    priority: 10,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
  ptset: {
    show: false,
    snap: false,
    priority: 20,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
  position: {
    show: true,
    snap: false,
    priority: 30,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
  mesh_pick_point: {
    show: true,
    snap: true,
    priority: 40,
    thresholdPx: DEFAULT_PTSET_SNAP_PX,
  },
};

export function clampMeasurementPickThreshold(raw: unknown): number {
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
    show: ptsetEnabled,
    snap: ptsetEnabled,
    thresholdPx: clampMeasurementPickThreshold(input.keypointSnapPx),
  };
  return next;
}

export function sourceNeedsHoverData(setting: MeasurementPickSourceSetting | undefined): boolean {
  return Boolean(setting?.show || setting?.snap);
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
    label: `Position ${refno}`,
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
  return candidates.sort((a, b) => {
    const aSetting = settings[a.source];
    const bSetting = settings[b.source];
    const priorityDelta = (aSetting?.priority ?? 999) - (bSetting?.priority ?? 999);
    if (priorityDelta !== 0) return priorityDelta;

    const distanceDelta = a.pixelDistance - b.pixelDistance;
    if (distanceDelta !== 0) return distanceDelta;

    return a.id.localeCompare(b.id);
  });
}

export function resolveMeasurementPickCandidates(input: {
  cursor: CanvasPosLike;
  camera: Camera;
  rect: CanvasRectLike;
  settings: MeasurementPickSourceSettings;
  candidates: readonly MeasurementPickCandidate[];
}): MeasurementPickResolution {
  const visibleCandidates: ProjectedMeasurementPickCandidate[] = [];
  for (const candidate of input.candidates) {
    if (input.settings[candidate.source]?.show !== true) continue;
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
