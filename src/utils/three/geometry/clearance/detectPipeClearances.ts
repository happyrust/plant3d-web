import * as THREE from 'three';

import { computePipeToPipeClearance } from './pipeClearance';

import type { MbdPipeSegmentDto, MbdPipeClearanceDto, Vec3 } from '@/api/mbdPipeApi';

export type PipePair = {
  pipe1: MbdPipeSegmentDto
  pipe2: MbdPipeSegmentDto
  bran1: string
  bran2: string
}

/**
 * 检测不同 BRAN 之间平行且距离较近的管道对
 * 
 * @param branches - 多个 BRAN 的管段数据，格式：{ branRefno: segments[] }
 * @param maxDistance - 最大距离阈值（mm），默认 500
 * @param maxAngleDeg - 最大夹角（度），默认 5
 */
export function detectPipeClearances(
  branches: Record<string, MbdPipeSegmentDto[]>,
  maxDistance = 500,
  maxAngleDeg = 5,
): MbdPipeClearanceDto[] {
  const clearances: MbdPipeClearanceDto[] = [];
  const branKeys = Object.keys(branches);

  for (let i = 0; i < branKeys.length; i++) {
    for (let j = i + 1; j < branKeys.length; j++) {
      const bran1 = branKeys[i]!;
      const bran2 = branKeys[j]!;
      const segs1 = branches[bran1]!;
      const segs2 = branches[bran2]!;

      for (const seg1 of segs1) {
        if (!seg1.arrive || !seg1.leave || !seg1.outside_diameter) continue;
        
        for (const seg2 of segs2) {
          if (!seg2.arrive || !seg2.leave || !seg2.outside_diameter) continue;

          const center1 = new THREE.Vector3(
            (seg1.arrive[0] + seg1.leave[0]) / 2,
            (seg1.arrive[1] + seg1.leave[1]) / 2,
            (seg1.arrive[2] + seg1.leave[2]) / 2,
          );
          const axis1 = new THREE.Vector3(
            seg1.leave[0] - seg1.arrive[0],
            seg1.leave[1] - seg1.arrive[1],
            seg1.leave[2] - seg1.arrive[2],
          );
          
          const center2 = new THREE.Vector3(
            (seg2.arrive[0] + seg2.leave[0]) / 2,
            (seg2.arrive[1] + seg2.leave[1]) / 2,
            (seg2.arrive[2] + seg2.leave[2]) / 2,
          );
          const axis2 = new THREE.Vector3(
            seg2.leave[0] - seg2.arrive[0],
            seg2.leave[1] - seg2.arrive[1],
            seg2.leave[2] - seg2.arrive[2],
          );

          const result = computePipeToPipeClearance({
            pipe1Center: center1,
            pipe1Radius: seg1.outside_diameter / 2,
            pipe1Axis: axis1,
            pipe2Center: center2,
            pipe2Radius: seg2.outside_diameter / 2,
            pipe2Axis: axis2,
          });

          if (result && result.distance > 0 && result.distance <= maxDistance) {
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
            });
          }
        }
      }
    }
  }

  return clearances;
}
