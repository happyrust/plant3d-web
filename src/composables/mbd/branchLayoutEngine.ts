import { Vector3 } from 'three';

import type { MbdDimKind, MbdLayoutHint, MbdPipeSegmentDto, Vec3 } from '@/api/mbdPipeApi';

import { computeMbdDimOffset } from '@/composables/mbd/computeMbdDimOffset';
import { findSegmentOffsetDir } from '@/composables/mbd/computePipeAlignedOffsetDirs';

export type LayoutRole = MbdDimKind | 'cut_tubi';

export type NormalizedLayoutHint = {
  anchorPoint?: Vector3;
  primaryAxis?: Vector3;
  offsetDir?: Vector3;
  charDir?: Vector3;
  labelRole?: string;
  avoidLineOfSight?: boolean;
  ownerSegmentId?: string | null;
  offsetLevel: number;
  suppressReason?: string | null;
  layoutGroupId?: string | null;
  placementLane?: number | null;
  sideLocked?: boolean;
  declutterPriority?: number | null;
  raw?: MbdLayoutHint | null;
};

export type BranchLayoutResolution = {
  direction: Vector3 | null;
  offset: number;
  lane: number;
  source: 'hint' | 'branch' | 'camera-fallback' | 'none';
  normalizedHint: NormalizedLayoutHint;
};

const SEMANTIC_LANE_ORDER: Record<LayoutRole, number> = {
  segment: 0,
  port: 1,
  chain: 2,
  cut_tubi: 3,
  overall: 4,
};

function toVector3(vec?: Vec3 | null): Vector3 | null {
  if (!vec || vec.length !== 3) return null;
  const [x, y, z] = vec;
  if (![x, y, z].every((value) => Number.isFinite(value))) return null;
  return new Vector3(x, y, z);
}

function normalizeDirection(vec?: Vec3 | null): Vector3 | undefined {
  const resolved = toVector3(vec);
  if (!resolved || resolved.lengthSq() < 1e-9) return undefined;
  return resolved.normalize();
}

function normalizeOffsetLevel(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function normalizeOptionalNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeMbdLayoutHint(
  hint?: MbdLayoutHint | null,
): NormalizedLayoutHint {
  const raw = hint ?? null;
  return {
    anchorPoint: toVector3(raw?.anchor_point ?? null) ?? undefined,
    primaryAxis: normalizeDirection(raw?.primary_axis ?? null),
    offsetDir: normalizeDirection(raw?.offset_dir ?? null),
    charDir: normalizeDirection(raw?.char_dir ?? null),
    labelRole: typeof raw?.label_role === 'string' ? raw.label_role : undefined,
    avoidLineOfSight:
      typeof raw?.avoid_line_of_sight === 'boolean' ? raw.avoid_line_of_sight : undefined,
    ownerSegmentId:
      typeof raw?.owner_segment_id === 'string' || raw?.owner_segment_id === null
        ? raw.owner_segment_id
        : undefined,
    offsetLevel: normalizeOffsetLevel(raw?.offset_level),
    suppressReason:
      typeof raw?.suppress_reason === 'string' || raw?.suppress_reason === null
        ? raw.suppress_reason
        : undefined,
    layoutGroupId:
      typeof raw?.layout_group_id === 'string' || raw?.layout_group_id === null
        ? (raw.layout_group_id as string | null)
        : undefined,
    placementLane: normalizeOptionalNumber(raw?.placement_lane),
    sideLocked: typeof raw?.side_locked === 'boolean' ? raw.side_locked : undefined,
    declutterPriority: normalizeOptionalNumber(raw?.declutter_priority),
    raw,
  };
}

export function resolveLayeredDimOffset(
  baseOffset: number,
  hint?: NormalizedLayoutHint | MbdLayoutHint | null,
): number {
  const normalized = 'offsetLevel' in (hint ?? {}) ? (hint as NormalizedLayoutHint) : normalizeMbdLayoutHint(hint as MbdLayoutHint | null | undefined);
  const safeBase = Number.isFinite(baseOffset) ? Math.max(1, Math.min(5000, baseOffset)) : 100;
  if (normalized.offsetLevel <= 0) return safeBase;
  const layerGap = Math.max(safeBase * 0.85, 60);
  return safeBase + normalized.offsetLevel * layerGap;
}

export function resolveSemanticDimOffset(
  baseOffset: number,
  role: LayoutRole,
  hint?: NormalizedLayoutHint | MbdLayoutHint | null,
): number {
  const normalized = 'offsetLevel' in (hint ?? {})
    ? (hint as NormalizedLayoutHint)
    : normalizeMbdLayoutHint(hint as MbdLayoutHint | null | undefined);
  const lane = resolveSemanticLane(role, normalized);
  return resolveSemanticOffsetFromLane(baseOffset, lane, normalized);
}

export function resolveSemanticLane(
  role: LayoutRole,
  hint?: NormalizedLayoutHint | MbdLayoutHint | null,
): number {
  const normalized = 'offsetLevel' in (hint ?? {})
    ? (hint as NormalizedLayoutHint)
    : normalizeMbdLayoutHint(hint as MbdLayoutHint | null | undefined);
  const semanticLane = SEMANTIC_LANE_ORDER[role] ?? 0;
  const explicitLane = normalized.placementLane;
  const lane = Number.isFinite(explicitLane)
    ? Math.max(semanticLane, Math.floor(explicitLane as number))
    : semanticLane;
  return Math.max(0, lane);
}

export function resolveSemanticOffsetFromLane(
  baseOffset: number,
  lane: number,
  hint?: NormalizedLayoutHint | MbdLayoutHint | null,
): number {
  const normalized = 'offsetLevel' in (hint ?? {})
    ? (hint as NormalizedLayoutHint)
    : normalizeMbdLayoutHint(hint as MbdLayoutHint | null | undefined);
  const safeBase = Number.isFinite(baseOffset) ? Math.max(1, Math.min(5000, baseOffset)) : 100;
  const normalizedLane = Math.max(0, Math.floor(Number.isFinite(lane) ? lane : 0));
  const layerGap = Math.max(safeBase * 0.85, 60);
  const totalLane = normalizedLane + normalized.offsetLevel;
  return safeBase + totalLane * layerGap;
}

export function resolveBranchLayout(
  args: {
    start: Vector3;
    end: Vector3;
    role: LayoutRole;
    hint?: MbdLayoutHint | null;
    segments?: MbdPipeSegmentDto[];
    pipeOffsetDirs?: Vector3[];
    baseOffsetScale?: number;
  },
): BranchLayoutResolution {
  const normalizedHint = normalizeMbdLayoutHint(args.hint);
  const scaledBaseOffset =
    computeMbdDimOffset(args.start.distanceTo(args.end)) *
    (Number.isFinite(args.baseOffsetScale) ? Math.max(0.05, Math.min(50, args.baseOffsetScale!)) : 1);
  const branchDirection =
    args.segments && args.pipeOffsetDirs
      ? findSegmentOffsetDir(
        args.segments,
        [args.start.x, args.start.y, args.start.z],
        [args.end.x, args.end.y, args.end.z],
        args.pipeOffsetDirs,
      )
      : null;
  const direction = normalizedHint.offsetDir ?? branchDirection ?? null;
  const source = normalizedHint.offsetDir
    ? 'hint'
    : branchDirection
      ? 'branch'
      : 'none';
  const lane = resolveSemanticLane(args.role, normalizedHint);

  return {
    direction: direction ? direction.clone().normalize() : null,
    offset: resolveSemanticOffsetFromLane(scaledBaseOffset, lane, normalizedHint),
    lane,
    source,
    normalizedHint,
  };
}
