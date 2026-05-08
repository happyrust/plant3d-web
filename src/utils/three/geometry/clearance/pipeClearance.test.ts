import { describe, it, expect } from 'vitest';

import * as THREE from 'three';

import { computePipeToWallClearance, computePipeToColumnClearance, computePipeToPipeClearance } from './pipeClearance';

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

  it('pipe-to-pipe: respects the configured max angle', () => {
    const eightDeg = (8 * Math.PI) / 180;
    const pipe2Axis = new THREE.Vector3(Math.sin(eightDeg), Math.cos(eightDeg), 0);

    const rejected = computePipeToPipeClearance({
      pipe1Center: new THREE.Vector3(0, 0, 0),
      pipe1Radius: 1,
      pipe1Axis: new THREE.Vector3(0, 1, 0),
      pipe2Center: new THREE.Vector3(4, 0, 0),
      pipe2Radius: 1,
      pipe2Axis,
      maxAngleDeg: 5,
    });
    const accepted = computePipeToPipeClearance({
      pipe1Center: new THREE.Vector3(0, 0, 0),
      pipe1Radius: 1,
      pipe1Axis: new THREE.Vector3(0, 1, 0),
      pipe2Center: new THREE.Vector3(4, 0, 0),
      pipe2Radius: 1,
      pipe2Axis,
      maxAngleDeg: 10,
    });

    expect(rejected).toBeNull();
    expect(accepted).not.toBeNull();
  });

  it('pipe-to-pipe: uses finite segment endpoints instead of infinite axes', () => {
    const res = computePipeToPipeClearance({
      pipe1Center: new THREE.Vector3(0, 0, 0),
      pipe1Radius: 1,
      pipe1Axis: new THREE.Vector3(0, 10, 0),
      pipe2Center: new THREE.Vector3(3, 100, 0),
      pipe2Radius: 1,
      pipe2Axis: new THREE.Vector3(0, 10, 0),
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(0, 10, 0),
      pipe2Start: new THREE.Vector3(3, 100, 0),
      pipe2End: new THREE.Vector3(3, 110, 0),
    });

    expect(res).not.toBeNull();
    expect(res!.distance).toBeGreaterThan(80);
  });

  it('pipe-to-pipe: keeps touching pipes as zero clearance', () => {
    const res = computePipeToPipeClearance({
      pipe1Center: new THREE.Vector3(0, 0, 0),
      pipe1Radius: 1,
      pipe1Axis: new THREE.Vector3(0, 10, 0),
      pipe2Center: new THREE.Vector3(2, 0, 0),
      pipe2Radius: 1,
      pipe2Axis: new THREE.Vector3(0, 10, 0),
      pipe1Start: new THREE.Vector3(0, 0, 0),
      pipe1End: new THREE.Vector3(0, 10, 0),
      pipe2Start: new THREE.Vector3(2, 0, 0),
      pipe2End: new THREE.Vector3(2, 10, 0),
    });

    expect(res).not.toBeNull();
    expect(res!.distance).toBeCloseTo(0, 8);
  });
});

