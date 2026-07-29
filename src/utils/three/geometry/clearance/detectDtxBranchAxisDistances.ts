import {
  Matrix4,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
} from 'three';

import type { Vec3 } from '@/types/vec3';

export type DtxBranchAxisDistanceLayer = {
  hasObject?: (objectId: string) => boolean;
  isObjectVisible?: (objectId: string) => boolean;
  getAllObjectIds?: () => string[];
  getObjectGeometryData: (objectId: string) => {
    geometry: BufferGeometry;
    matrix: Matrix4;
  } | null;
};

export type DtxBranchAxisDistanceResult = {
  id: string;
  distance: number;
  pipeA: string;
  pipeB: string;
  start: Vec3;
  end: Vec3;
  pipeAStart: Vec3;
  pipeAEnd: Vec3;
  pipeBStart: Vec3;
  pipeBEnd: Vec3;
};

export type DtxBranchAxisDistanceOptions = {
  refnos: string[];
  maxAngleDeg?: number;
  maxDistanceMm?: number;
  includeBeyondMaxDistanceForSinglePair?: boolean;
  resolveObjectIdsByRefno?: (refno: string) => string[];
  maxVerticesPerObject?: number;
};

type BranchAxisFit = {
  refno: string;
  start: Vector3;
  end: Vector3;
  center: Vector3;
  axis: Vector3;
};

type PositionAttribute = BufferAttribute | InterleavedBufferAttribute;

const SCENE_UNITS_TO_MM = 1000;

function normalizeRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

function vec3(point: Vector3): Vec3 {
  return [point.x, point.y, point.z];
}

function parseDbnum(refno: string): number | null {
  const value = Number(normalizeRefno(refno).split('_')[0]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function isVisibleObject(layer: DtxBranchAxisDistanceLayer, objectId: string): boolean {
  if (layer.hasObject && !layer.hasObject(objectId)) return false;
  return layer.isObjectVisible ? layer.isObjectVisible(objectId) : true;
}

function resolveObjectIds(layer: DtxBranchAxisDistanceLayer, refno: string, options: DtxBranchAxisDistanceOptions): string[] {
  const directObjectIds = isVisibleObject(layer, refno) ? [refno] : [];
  const cacheObjectIds = options.resolveObjectIdsByRefno?.(refno) ?? [];
  const prefixObjectIds = layer.getAllObjectIds?.().filter((objectId) =>
    objectId === refno || objectId.startsWith(`o:${refno}:`),
  ) ?? [];

  return [...directObjectIds, ...cacheObjectIds, ...prefixObjectIds]
    .map(String)
    .filter((objectId, index, array) =>
      objectId.length > 0
      && array.indexOf(objectId) === index
      && isVisibleObject(layer, objectId),
    );
}

function collectObjectPoints(
  layer: DtxBranchAxisDistanceLayer,
  objectId: string,
  maxVertices: number,
): Vector3[] {
  const data = layer.getObjectGeometryData(objectId);
  const position = data?.geometry.getAttribute('position') as PositionAttribute | undefined;
  if (!data || !position || position.count <= 0) return [];

  const out: Vector3[] = [];
  const budget = Math.max(2, Math.floor(maxVertices));
  const step = Math.max(1, Math.floor(position.count / budget));
  const point = new Vector3();

  for (let i = 0; i < position.count; i += step) {
    point.fromBufferAttribute(position, i).applyMatrix4(data.matrix);
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      out.push(point.clone());
    }
  }

  if (out.length < budget && position.count > 0) {
    point.fromBufferAttribute(position, position.count - 1).applyMatrix4(data.matrix);
    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      out.push(point.clone());
    }
  }

  return out;
}

function multiplyCovariance(covariance: number[], vector: Vector3): Vector3 {
  return new Vector3(
    covariance[0]! * vector.x + covariance[1]! * vector.y + covariance[2]! * vector.z,
    covariance[1]! * vector.x + covariance[3]! * vector.y + covariance[4]! * vector.z,
    covariance[2]! * vector.x + covariance[4]! * vector.y + covariance[5]! * vector.z,
  );
}

function fallbackAxisFromExtents(points: Vector3[]): Vector3 {
  const min = points[0]!.clone();
  const max = points[0]!.clone();
  for (const point of points) {
    min.min(point);
    max.max(point);
  }
  const extents = max.sub(min);
  if (extents.x >= extents.y && extents.x >= extents.z) return new Vector3(1, 0, 0);
  if (extents.y >= extents.z) return new Vector3(0, 1, 0);
  return new Vector3(0, 0, 1);
}

function fitBranchAxis(refno: string, points: Vector3[]): BranchAxisFit | null {
  if (points.length < 2) return null;

  const center = new Vector3();
  for (const point of points) {
    center.add(point);
  }
  center.multiplyScalar(1 / points.length);

  const covariance = [0, 0, 0, 0, 0, 0];
  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    const z = point.z - center.z;
    covariance[0]! += x * x;
    covariance[1]! += x * y;
    covariance[2]! += x * z;
    covariance[3]! += y * y;
    covariance[4]! += y * z;
    covariance[5]! += z * z;
  }

  let axis = fallbackAxisFromExtents(points);
  for (let i = 0; i < 18; i++) {
    const next = multiplyCovariance(covariance, axis);
    if (next.lengthSq() < 1e-18) break;
    axis = next.normalize();
  }
  if (axis.lengthSq() < 1e-12) return null;

  let minProjection = Infinity;
  let maxProjection = -Infinity;
  for (const point of points) {
    const projection = point.clone().sub(center).dot(axis);
    minProjection = Math.min(minProjection, projection);
    maxProjection = Math.max(maxProjection, projection);
  }
  if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) return null;
  if (maxProjection - minProjection < 1e-6) return null;

  return {
    refno,
    start: center.clone().addScaledVector(axis, minProjection),
    end: center.clone().addScaledVector(axis, maxProjection),
    center,
    axis,
  };
}

function closestPointsBetweenSegments(
  p1: Vector3,
  q1: Vector3,
  p2: Vector3,
  q2: Vector3,
): { point1: Vector3; point2: Vector3 } | null {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const eps = 1e-12;
  let s = 0;
  let t = 0;

  if (a <= eps && e <= eps) {
    return { point1: p1.clone(), point2: p2.clone() };
  }
  if (a <= eps) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= eps) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (Math.abs(denom) > eps) {
        s = Math.min(1, Math.max(0, (b * f - c * e) / denom));
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }

  return {
    point1: p1.clone().addScaledVector(d1, s),
    point2: p2.clone().addScaledVector(d2, t),
  };
}

function areParallel(axis1: Vector3, axis2: Vector3, maxAngleDeg: number): boolean {
  const angleRad = Math.max(0, Math.min(180, maxAngleDeg)) * Math.PI / 180;
  return Math.abs(axis1.dot(axis2)) >= Math.cos(angleRad);
}

function fitBranchFromDtxGeometry(
  layer: DtxBranchAxisDistanceLayer,
  refno: string,
  options: DtxBranchAxisDistanceOptions,
): BranchAxisFit | null {
  const objectIds = resolveObjectIds(layer, refno, options);
  if (objectIds.length === 0) return null;

  const maxVertices = Math.max(64, Math.floor(options.maxVerticesPerObject ?? 2048));
  const points = objectIds.flatMap((objectId) => collectObjectPoints(layer, objectId, maxVertices));
  return fitBranchAxis(refno, points);
}

export function detectDtxBranchAxisDistances(
  layer: DtxBranchAxisDistanceLayer | null | undefined,
  options: DtxBranchAxisDistanceOptions,
): DtxBranchAxisDistanceResult[] {
  if (!layer) return [];

  const refnos = [...new Set(options.refnos.map(normalizeRefno).filter(Boolean))];
  if (refnos.length < 2) return [];

  const fits = refnos
    .map((refno) => fitBranchFromDtxGeometry(layer, refno, options))
    .filter((fit): fit is BranchAxisFit => !!fit);
  if (fits.length < 2) return [];

  const maxAngleDeg = Number.isFinite(options.maxAngleDeg) ? Number(options.maxAngleDeg) : 5;
  const maxDistanceMm = Number.isFinite(options.maxDistanceMm) ? Number(options.maxDistanceMm) : 500;
  const includeBeyondMaxDistance = options.includeBeyondMaxDistanceForSinglePair && refnos.length === 2;
  const out: DtxBranchAxisDistanceResult[] = [];

  for (let i = 0; i < fits.length; i++) {
    for (let j = i + 1; j < fits.length; j++) {
      const pipeA = fits[i]!;
      const pipeB = fits[j]!;
      if (!areParallel(pipeA.axis, pipeB.axis, maxAngleDeg)) continue;

      const closest = closestPointsBetweenSegments(pipeA.start, pipeA.end, pipeB.start, pipeB.end);
      if (!closest) continue;

      const distance = closest.point1.distanceTo(closest.point2) * SCENE_UNITS_TO_MM;
      if (!includeBeyondMaxDistance && distance > maxDistanceMm) continue;

      out.push({
        id: `dtx_axis_${pipeA.refno}_${pipeB.refno}`,
        distance: Math.round(distance),
        pipeA: pipeA.refno,
        pipeB: pipeB.refno,
        start: vec3(closest.point1),
        end: vec3(closest.point2),
        pipeAStart: vec3(pipeA.start),
        pipeAEnd: vec3(pipeA.end),
        pipeBStart: vec3(pipeB.start),
        pipeBEnd: vec3(pipeB.end),
      });
    }
  }

  return out.sort((a, b) => a.distance - b.distance);
}

export function resolveDtxAxisDistanceDbnum(refno: string): number | null {
  return parseDbnum(refno);
}
