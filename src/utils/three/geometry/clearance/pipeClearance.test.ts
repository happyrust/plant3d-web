import { describe, it, expect } from 'vitest';

import * as THREE from 'three';

import {
  computePipeSegmentToPipeSegmentClearance,
  computePipeToWallClearance,
  computePipeToColumnClearance,
  computePipeToPipeClearance,
} from './pipeClearance';

describe('pipeClearance', () => {
  it('pipe-to-wall: should compute surface clearance', () => {
    const r = 1;
    const gap = 0.5;
    const res = computePipeToWallClearance({
      pipeCenter: new THREE.Vector3(r + gap, 0, 0),
      pipeRadius: r,
      wallPoint: new THREE.Vector3(0, 0, 0),
      wallNormal: new THREE.Vector3(1, 0, 0),
    });
    expect(res).not.toBeNull();
    expect(res!.distance).toBeCloseTo(gap, 8);
    expect(res!.otherSurfacePoint.x).toBeCloseTo(0, 8);
    expect(res!.pipeSurfacePoint.x).toBeCloseTo(gap, 8); // 管外壁到墙：x=gap
  });

  it('pipe-to-column: should compute surface clearance for parallel cylinders', () => {
    const pipeR = 1;
    const colR = 2;
    const gap = 0.5;
    const res = computePipeToColumnClearance({
      pipeCenter: new THREE.Vector3(0, 0, 0),
      pipeRadius: pipeR,
      columnCenter: new THREE.Vector3(pipeR + colR + gap, 0, 0),
      columnRadius: colR,
      axis: new THREE.Vector3(0, 1, 0),
    });
    expect(res).not.toBeNull();
    expect(res!.distance).toBeCloseTo(gap, 8);
  });

  it('pipe-to-column: degenerates when centers overlap laterally', () => {
    const res = computePipeToColumnClearance({
      pipeCenter: new THREE.Vector3(0, 0, 0),
      pipeRadius: 1,
      columnCenter: new THREE.Vector3(0, 10, 0),
      columnRadius: 1,
      axis: new THREE.Vector3(0, 1, 0),
    });
    expect(res).toBeNull();
  });

  it('pipe-segment-to-pipe-segment: should compute parallel pipe surface clearance', () => {
    const res = computePipeSegmentToPipeSegmentClearance({
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(0, 10, 0),
      pipe1Radius: 1,
      pipe2Start: new THREE.Vector3(4, 3, 0),
      pipe2End: new THREE.Vector3(4, 8, 0),
      pipe2Radius: 1.5,
    });

    expect(res).not.toBeNull();
    expect(res!.distance).toBeCloseTo(1.5, 8);
    expect(res!.pipeSurfacePoint.x).toBeCloseTo(1, 8);
    expect(res!.otherSurfacePoint.x).toBeCloseTo(2.5, 8);
  });

  it('pipe-segment-to-pipe-segment: should use segment endpoints for finite pipes', () => {
    const res = computePipeSegmentToPipeSegmentClearance({
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(0, 2, 0),
      pipe1Radius: 0.5,
      pipe2Start: new THREE.Vector3(0, 5, 0),
      pipe2End: new THREE.Vector3(0, 7, 0),
      pipe2Radius: 0.5,
    });

    expect(res).not.toBeNull();
    expect(res!.distance).toBeCloseTo(2, 8);
    expect(res!.pipeSurfacePoint.y).toBeCloseTo(2.5, 8);
    expect(res!.otherSurfacePoint.y).toBeCloseTo(4.5, 8);
  });

  it('pipe-segment-to-pipe-segment: should support skew pipe segments', () => {
    const res = computePipeSegmentToPipeSegmentClearance({
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(10, 0, 0),
      pipe1Radius: 1,
      pipe2Start: new THREE.Vector3(5, -2, 4),
      pipe2End: new THREE.Vector3(5, 2, 4),
      pipe2Radius: 1,
    });

    expect(res).not.toBeNull();
    expect(res!.distance).toBeCloseTo(2, 8);
    expect(res!.pipeSurfacePoint.z).toBeCloseTo(1, 8);
    expect(res!.otherSurfacePoint.z).toBeCloseTo(3, 8);
  });

  it('pipe-segment-to-pipe-segment: should clamp penetrating pipes to zero clearance', () => {
    const res = computePipeSegmentToPipeSegmentClearance({
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(10, 0, 0),
      pipe1Radius: 2,
      pipe2Start: new THREE.Vector3(5, -2, 3),
      pipe2End: new THREE.Vector3(5, 2, 3),
      pipe2Radius: 2,
    });

    expect(res).not.toBeNull();
    expect(res!.distance).toBe(0);
    expect(res!.pipeSurfacePoint.distanceTo(res!.otherSurfacePoint)).toBeCloseTo(0, 8);
  });

  it('pipe-segment-to-pipe-segment: should reject degenerate segments', () => {
    const res = computePipeSegmentToPipeSegmentClearance({
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(0, 0, 0),
      pipe1Radius: 1,
      pipe2Start: new THREE.Vector3(0, 5, 0),
      pipe2End: new THREE.Vector3(0, 10, 0),
      pipe2Radius: 1,
    });

    expect(res).toBeNull();
  });
});

