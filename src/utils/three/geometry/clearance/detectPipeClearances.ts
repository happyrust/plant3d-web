import * as THREE from 'three';

import { computePipeSegmentToPipeSegmentClearance } from './pipeClearance';

import type { PipeClearanceDto, PipeSegmentDto } from '@/types/pipeGeometry';
import type { Vec3 } from '@/types/vec3';

export type PipePair = {
  pipe1: PipeSegmentDto
  pipe2: PipeSegmentDto
  bran1: string
  bran2: string
}

const DEFAULT_PIPE_OUTSIDE_DIAMETER_MM = 229;

function areAxesWithinAngle(axis1: THREE.Vector3, axis2: THREE.Vector3, maxAngleDeg: number): boolean {
  if (axis1.lengthSq() < 1e-12 || axis2.lengthSq() < 1e-12) return false;
  const maxAngleRad = (Math.max(0, Math.min(180, maxAngleDeg)) * Math.PI) / 180;
  return Math.abs(axis1.clone().normalize().dot(axis2.clone().normalize())) >= Math.cos(maxAngleRad);
}

function resolveOutsideDiameter(segment: PipeSegmentDto): number {
  const outsideDiameter = Number(segment.outside_diameter ?? NaN);
  if (Number.isFinite(outsideDiameter) && outsideDiameter > 0) return outsideDiameter;
  return DEFAULT_PIPE_OUTSIDE_DIAMETER_MM;
}

/**
 * 检测不同 BRAN 之间平行且距离较近的管道对
 * 
 * @param branches - 多个 BRAN 的管段数据，格式：{ branRefno: segments[] }
 * @param maxDistance - 最大距离阈值（mm），默认 500
 * @param maxAngleDeg - 最大夹角（度），默认 5
 */
export function detectPipeClearances(
  branches: Record<string, PipeSegmentDto[]>,
  maxDistance = 500,
  maxAngleDeg = 5,
): PipeClearanceDto[] {
  const clearances: PipeClearanceDto[] = [];
  const branKeys = Object.keys(branches);

  for (let i = 0; i < branKeys.length; i++) {
    for (let j = i + 1; j < branKeys.length; j++) {
      const bran1 = branKeys[i]!;
      const bran2 = branKeys[j]!;
      const segs1 = branches[bran1]!;
      const segs2 = branches[bran2]!;

      for (const seg1 of segs1) {
        if (!seg1.arrive || !seg1.leave) continue;
        const outsideDiameter1 = resolveOutsideDiameter(seg1);
        
        for (const seg2 of segs2) {
          if (!seg2.arrive || !seg2.leave) continue;
          const outsideDiameter2 = resolveOutsideDiameter(seg2);

          const start1 = new THREE.Vector3(seg1.arrive[0], seg1.arrive[1], seg1.arrive[2]);
          const end1 = new THREE.Vector3(seg1.leave[0], seg1.leave[1], seg1.leave[2]);
          const center1 = start1.clone().add(end1).multiplyScalar(0.5);
          const axis1 = new THREE.Vector3(
            seg1.leave[0] - seg1.arrive[0],
            seg1.leave[1] - seg1.arrive[1],
            seg1.leave[2] - seg1.arrive[2],
          );
          
          const start2 = new THREE.Vector3(seg2.arrive[0], seg2.arrive[1], seg2.arrive[2]);
          const end2 = new THREE.Vector3(seg2.leave[0], seg2.leave[1], seg2.leave[2]);
          const center2 = start2.clone().add(end2).multiplyScalar(0.5);
          const axis2 = new THREE.Vector3(
            seg2.leave[0] - seg2.arrive[0],
            seg2.leave[1] - seg2.arrive[1],
            seg2.leave[2] - seg2.arrive[2],
          );
          if (!areAxesWithinAngle(axis1, axis2, maxAngleDeg)) continue;

          const result = computePipeSegmentToPipeSegmentClearance({
            pipe1Center: center1,
            pipe1Start: start1,
            pipe1End: end1,
            pipe1Radius: outsideDiameter1 / 2,
            pipe1Axis: axis1,
            pipe2Center: center2,
            pipe2Radius: outsideDiameter2 / 2,
            pipe2Axis: axis2,
            pipe2Start: start2,
            pipe2End: end2,
            maxAngleDeg,
          });

          if (result && result.distance >= -1e-9 && result.distance <= maxDistance) {
            clearances.push({
              id: `clearance_${seg1.id}_${seg2.id}`,
              pipe1_refno: seg1.refno,
              pipe2_refno: seg2.refno,
              start: [
                result.pipeSurfacePoint.x,
                result.pipeSurfacePoint.y,
                result.pipeSurfacePoint.z,
              ] as Vec3,
              end: [
                result.otherSurfacePoint.x,
                result.otherSurfacePoint.y,
                result.otherSurfacePoint.z,
              ] as Vec3,
              distance: result.distance,
              text: `${Math.round(result.distance)}`,
              layout_hint: {
                pipe1_start: seg1.arrive,
                pipe1_end: seg1.leave,
                pipe2_start: seg2.arrive,
                pipe2_end: seg2.leave,
              },
            });
          }
        }
      }
    }
  }

  return clearances;
}
