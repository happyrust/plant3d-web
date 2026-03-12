import { describe, it, expect } from 'vitest';

import * as THREE from 'three';

import { computeDimensionOffsetDir } from './computeDimensionOffsetDir';
import { computeDimensionOffsetDirInLocal } from './computeDimensionOffsetDirInLocal';

function parallel(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const aa = a.clone().normalize();
  const bb = b.clone().normalize();
  const d = Math.abs(aa.dot(bb));
  return Number.isFinite(d) && d > 1 - 1e-6;
}

describe('computeDimensionOffsetDirInLocal', () => {
  it('returns local direction whose world transform is parallel to world direction', () => {
    const startL = new THREE.Vector3(0, 0, 0);
    const endL = new THREE.Vector3(1, 0, 0);

    const m = new THREE.Matrix4()
      .makeRotationZ(Math.PI / 2)
      .setPosition(new THREE.Vector3(10, 20, 30));

    const cam = new THREE.PerspectiveCamera();
    cam.position.set(11, 19, 40);

    const startW = startL.clone().applyMatrix4(m);
    const endW = endL.clone().applyMatrix4(m);

    const dirW = computeDimensionOffsetDir(startW, endW, cam);
    expect(dirW).not.toBeNull();

    const dirL = computeDimensionOffsetDirInLocal(startL, endL, cam, m);
    expect(dirL).not.toBeNull();

    // localDir -> worldDir should match (up to sign) the directly computed world direction
    const m3 = new THREE.Matrix3().setFromMatrix4(m);
    const dirWFromL = (dirL as THREE.Vector3).clone().applyMatrix3(m3).normalize();
    expect(parallel(dirWFromL, dirW as THREE.Vector3)).toBe(true);
  });
});

