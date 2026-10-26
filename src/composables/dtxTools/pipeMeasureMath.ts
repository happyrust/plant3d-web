/**
 * 管道测量纯算法：参考点种子、对象–对象近似最近距。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { BufferAttribute, Vector3 } from 'three';

import { vec3ToTuple } from './geometry';

import type { Vec3 } from '@/composables/useToolStore';
import type { DTXLayer } from '@/utils/three/dtx';

import { resolveDtxObjectIdsByRefno } from '@/composables/useDbnoInstancesDtxLoader';

export const PIPE_STRUCTURE_BACKEND_MAX_CANDIDATES = 20;
export const PIPE_STRUCTURE_FRONTEND_TOP_CANDIDATES = 5;
export const PIPE_STRUCTURE_SOURCE_SAMPLE_LIMIT = 128;
export const PIPE_STRUCTURE_DEFAULT_NOUNS = ['WALL', 'COLUMN'];

/** 管-墙/柱候选的最小形状（退役前 `/api/space/wall-distance` 的候选行，现由 v1 `nearest-clearance` 的候选折出来）。 */
export type PipeWallDistanceCandidate = {
  refno: string;
  noun: string;
  distance_mm: number;
};
const OBJECT_TO_OBJECT_VERTEX_SAMPLE_LIMIT = 64;

export type PipeMeasureResult = {
  sourcePoint: Vector3
  targetPoint: Vector3
  distance: number
  targetObjectId: string
  targetRefno: string
}

export type PipeMeasureSeed = {
  distance: number
  sourcePoint: Vec3
  targetPoint: Vec3
}

type PipeReferencePointInput = {
  sourceRefno: string
  segments?: {
    refno?: string | null
    arrive?: Vec3 | null
    leave?: Vec3 | null
  }[]
  refnoPosition?: Vec3 | null
  aabbCenter?: Vec3 | null
}

export type ObjectMeasureCandidate = {
  refno: string
  objectId: string
  entityId: string
  hitPoint?: Vec3 | null
}

/**
 * 「管-管间距」里点选的一根管：它所属的 BRAN 才是量距的对象（两条 BRAN 平行直段的中心距，plan 2026-09-16 §3.3 ④），
 * 点到的构件只留作提示。
 */
export type PipeToPipeBranCandidate = {
  branRefno: string
  pickedRefno: string
  objectId: string
}

export type ApproxNearestBetweenObjectsInput = {
  sourceObjectId: string
  targetObjectId: string
  sourceHitPoint?: Vec3 | null
  targetHitPoint?: Vec3 | null
}

export type ApproxNearestBetweenObjectsResult = {
  sourcePoint: Vec3
  targetPoint: Vec3
  distance: number
}

export function normalizeRefnoKey(raw: string): string {
  return String(raw || '').trim().replace(/\//g, '_');
}

export function parseDbnumFromRefno(raw: string): number | null {
  const normalized = normalizeRefnoKey(raw);
  const head = normalized.split('_')[0] || '';
  const value = Number(head);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

export function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function pushVec3Unique(target: Vec3[], candidate: Vec3 | null | undefined): void {
  const next = asVec3(candidate);
  if (!next) return;
  for (const existing of target) {
    const dx = existing[0] - next[0];
    const dy = existing[1] - next[1];
    const dz = existing[2] - next[2];
    if (dx * dx + dy * dy + dz * dz < 1e-12) return;
  }
  target.push(next);
}

function pushVector3Unique(target: Vector3[], candidate: Vector3 | null | undefined): void {
  if (!candidate) return;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.z)) return;
  for (const existing of target) {
    if (existing.distanceToSquared(candidate) < 1e-12) return;
  }
  target.push(candidate.clone());
}

export function collectOrderedPipeReferencePointSeeds(input: PipeReferencePointInput): Vec3[] {
  const out: Vec3[] = [];
  const sourceRefno = normalizeRefnoKey(input.sourceRefno);
  if (sourceRefno && Array.isArray(input.segments)) {
    for (const segment of input.segments) {
      const segmentRefno = normalizeRefnoKey(String(segment?.refno || ''));
      if (!segmentRefno || segmentRefno !== sourceRefno) continue;
      pushVec3Unique(out, segment?.arrive ?? null);
      pushVec3Unique(out, segment?.leave ?? null);
    }
  }
  pushVec3Unique(out, input.refnoPosition ?? null);
  pushVec3Unique(out, input.aabbCenter ?? null);
  return out;
}

export function choosePipeMeasureBetterSeed(
  current: PipeMeasureSeed | null,
  candidate: PipeMeasureSeed | null,
): PipeMeasureSeed | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.distance < current.distance ? candidate : current;
}

function collectApproxNearestSeedPoints(
  layer: DTXLayer,
  objectId: string,
  options?: {
    hitPoint?: Vec3 | null
    vertexLimit?: number
  },
): Vector3[] {
  const out: Vector3[] = [];
  const hitPoint = asVec3(options?.hitPoint ?? null);
  if (hitPoint) {
    pushVector3Unique(out, new Vector3(hitPoint[0], hitPoint[1], hitPoint[2]));
  }

  const bbox = layer.getObjectBoundingBox(objectId);
  if (bbox && !bbox.isEmpty()) {
    const center = bbox.getCenter(new Vector3());
    pushVector3Unique(out, center);
    for (const x of [bbox.min.x, bbox.max.x]) {
      for (const y of [bbox.min.y, bbox.max.y]) {
        for (const z of [bbox.min.z, bbox.max.z]) {
          pushVector3Unique(out, new Vector3(x, y, z));
        }
      }
    }
  }

  const data = layer.getObjectGeometryData(objectId);
  if (!data) return out;

  const posAttr = data.geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!posAttr || posAttr.count <= 0) return out;

  const matrix = data.matrix;
  const maxVertices = Math.max(1, Math.floor(options?.vertexLimit ?? OBJECT_TO_OBJECT_VERTEX_SAMPLE_LIMIT));
  const vertexStep = Math.max(1, Math.floor(posAttr.count / maxVertices));
  const tmp = new Vector3();
  let sampled = 0;

  for (let index = 0; index < posAttr.count && sampled < maxVertices; index += vertexStep) {
    tmp.fromBufferAttribute(posAttr, index).applyMatrix4(matrix);
    pushVector3Unique(out, tmp);
    sampled += 1;
  }

  if (sampled < maxVertices && posAttr.count > 0) {
    tmp.fromBufferAttribute(posAttr, posAttr.count - 1).applyMatrix4(matrix);
    pushVector3Unique(out, tmp);
  }

  return out;
}

export function buildObjectMeasurePairKey(sourceRefno: string, targetRefno: string): string {
  return [normalizeRefnoKey(sourceRefno), normalizeRefnoKey(targetRefno)].sort().join('::');
}

export function resolveLoadedVisibleObjectCandidateByRefno(
  layer: DTXLayer,
  refno: string,
): ObjectMeasureCandidate | null {
  const normalizedRefno = normalizeRefnoKey(refno);
  if (!normalizedRefno) return null;

  const directObjectIds = layer.hasObject(normalizedRefno) ? [normalizedRefno] : [];
  const dbnum = parseDbnumFromRefno(normalizedRefno);
  const cachedObjectIds = dbnum ? resolveDtxObjectIdsByRefno(dbnum, normalizedRefno) : [];
  const fallbackObjectIds = layer.getAllObjectIds().filter((objectId) => {
    if (!objectId) return false;
    if (objectId === normalizedRefno) return true;
    return objectId.startsWith(`o:${normalizedRefno}:`);
  });
  const objectIds = [...directObjectIds, ...cachedObjectIds, ...fallbackObjectIds]
    .filter((objectId, index, array) => !!objectId && array.indexOf(objectId) === index);
  const visibleObjectId = objectIds.find((objectId) => layer.hasObject(objectId) && layer.isObjectVisible(objectId));
  if (!visibleObjectId) return null;

  return {
    refno: normalizedRefno,
    objectId: visibleObjectId,
    entityId: normalizedRefno,
    hitPoint: null,
  };
}

export function computeApproxNearestBetweenObjects(
  layer: DTXLayer,
  input: ApproxNearestBetweenObjectsInput,
): ApproxNearestBetweenObjectsResult | null {
  if (!layer) return null;
  if (!input.sourceObjectId || !input.targetObjectId) return null;
  if (input.sourceObjectId === input.targetObjectId) return null;

  const sourceSeeds = collectApproxNearestSeedPoints(layer, input.sourceObjectId, {
    hitPoint: input.sourceHitPoint ?? null,
  });
  const targetSeeds = collectApproxNearestSeedPoints(layer, input.targetObjectId, {
    hitPoint: input.targetHitPoint ?? null,
  });
  if (sourceSeeds.length === 0 || targetSeeds.length === 0) return null;

  let best: ApproxNearestBetweenObjectsResult | null = null;

  for (const sourceSeed of sourceSeeds) {
    const closest = layer.closestPointToObject(input.targetObjectId, sourceSeed);
    if (!closest) continue;
    const candidate: ApproxNearestBetweenObjectsResult = {
      sourcePoint: vec3ToTuple(sourceSeed),
      targetPoint: vec3ToTuple(closest.point),
      distance: closest.distance,
    };
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }

  for (const targetSeed of targetSeeds) {
    const closest = layer.closestPointToObject(input.sourceObjectId, targetSeed);
    if (!closest) continue;
    const candidate: ApproxNearestBetweenObjectsResult = {
      sourcePoint: vec3ToTuple(closest.point),
      targetPoint: vec3ToTuple(targetSeed),
      distance: closest.distance,
    };
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }

  return best;
}

export function fromSeed(seed: PipeMeasureSeed, targetObjectId: string, targetRefno: string): PipeMeasureResult {
  return {
    distance: seed.distance,
    sourcePoint: new Vector3(...seed.sourcePoint),
    targetPoint: new Vector3(...seed.targetPoint),
    targetObjectId,
    targetRefno,
  };
}

export function vec3ByMatrix(vec: Vec3, matrix: any): Vec3 {
  const p = new Vector3(vec[0], vec[1], vec[2]).applyMatrix4(matrix);
  return [p.x, p.y, p.z];
}
