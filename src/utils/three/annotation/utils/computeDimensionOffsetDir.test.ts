import { describe, it, expect } from 'vitest';

import * as THREE from 'three';

import { computeDimensionOffsetDir } from './computeDimensionOffsetDir';

describe('computeDimensionOffsetDir', () => {
  it('returns a unit vector when camera is provided', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(1, 0, 0);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 0, 5);

    const d = computeDimensionOffsetDir(a, b, cam);
    expect(d).not.toBeNull();
    expect(Math.abs((d as THREE.Vector3).length() - 1)).toBeLessThan(1e-6);
  });

  it('returns null for near-zero segment', () => {
    const a = new THREE.Vector3(0, 0, 0);
    const b = new THREE.Vector3(0, 0, 0);
    const d = computeDimensionOffsetDir(a, b, null);
    expect(d).toBeNull();
  });
});

