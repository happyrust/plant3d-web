import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as THREE from 'three';

import { computePipeToWallClearance, computePipeToColumnClearance } from '@/utils/three/geometry/clearance/pipeClearance';

describe('Pipe clearance dimension scenarios', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('pipe-to-wall: should create a linear dimension with expected text', async () => {
    vi.mock('troika-three-text', () => {
      class FakeText extends THREE.Mesh {
        text = '';
        color: any;
        outlineColor: any;
        outlineWidth = 0;
        font = '';
        fontSize = 1;
        anchorX: any;
        anchorY: any;
        maxWidth: any;
         
        sync() {}
      }
      return { Text: FakeText };
    });

    const { AnnotationMaterials } = await import('@/utils/three/annotation/core/AnnotationMaterials');
    const { LinearDimension3D } = await import('@/utils/three/annotation/annotations/LinearDimension3D');

    // wall: plane x=0 (normal +X), pipe axis parallel to wall
    const pipeRadius = 1;
    const gap = 0.5;
    const clearance = computePipeToWallClearance({
      pipeCenter: new THREE.Vector3(pipeRadius + gap, 0, 0),
      pipeRadius,
      wallPoint: new THREE.Vector3(0, 0, 0),
      wallNormal: new THREE.Vector3(1, 0, 0),
    });
    expect(clearance).not.toBeNull();

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: clearance!.otherSurfacePoint,
      end: clearance!.pipeSurfacePoint,
      offset: 0.4,
      decimals: 2,
    });

    expect(dim.getDistance()).toBeCloseTo(gap, 8);
    expect(dim.getDisplayText()).toBe(gap.toFixed(2));
  });

  it('pipe-to-column: should create a linear dimension with expected text', async () => {
    vi.mock('troika-three-text', () => {
      class FakeText extends THREE.Mesh {
        text = '';
        color: any;
        outlineColor: any;
        outlineWidth = 0;
        font = '';
        fontSize = 1;
        anchorX: any;
        anchorY: any;
        maxWidth: any;
         
        sync() {}
      }
      return { Text: FakeText };
    });

    const { AnnotationMaterials } = await import('@/utils/three/annotation/core/AnnotationMaterials');
    const { LinearDimension3D } = await import('@/utils/three/annotation/annotations/LinearDimension3D');

    const pipeRadius = 1;
    const columnRadius = 2;
    const gap = 0.5;

    const clearance = computePipeToColumnClearance({
      pipeCenter: new THREE.Vector3(0, 0, 0),
      pipeRadius,
      columnCenter: new THREE.Vector3(pipeRadius + columnRadius + gap, 0, 0),
      columnRadius,
      axis: new THREE.Vector3(0, 1, 0),
    });
    expect(clearance).not.toBeNull();

    const materials = new AnnotationMaterials();
    const dim = new LinearDimension3D(materials, {
      start: clearance!.otherSurfacePoint,
      end: clearance!.pipeSurfacePoint,
      offset: 0.6,
      decimals: 2,
    });

    expect(dim.getDistance()).toBeCloseTo(gap, 8);
    expect(dim.getDisplayText()).toBe(gap.toFixed(2));
  });
});

