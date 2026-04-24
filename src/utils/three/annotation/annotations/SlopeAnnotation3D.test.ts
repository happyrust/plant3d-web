import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as THREE from 'three';

describe('SlopeAnnotation3D', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should construct and toggle label visibility', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { SlopeAnnotation3D } = await import('./SlopeAnnotation3D');

    const materials = new AnnotationMaterials();
    const ann = new SlopeAnnotation3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(10, 0, 0),
      text: '1:100',
      slope: 0.01,
    });

    expect(ann.getParams().text).toBe('1:100');
    ann.setLabelVisible(false);

    const textObj = (ann as any).textLabel?.object3d;
    expect(textObj).toBeTruthy();
    expect(textObj.visible).toBe(false);

    ann.dispose();
    materials.dispose();
  });

  it('should use camera annotation viewport for text scale', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { SlopeAnnotation3D } = await import('./SlopeAnnotation3D');

    const materials = new AnnotationMaterials();
    const ann = new SlopeAnnotation3D(materials, {
      start: new THREE.Vector3(0, 0, 0),
      end: new THREE.Vector3(20, 0, 0),
      text: '1:200',
      slope: 0.005,
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true)

    ;(camera as any).userData.annotationViewport = { width: 220, height: 220 };
    ann.update(camera);
    const smallViewportScale = ((ann as any).textLabel.object3d.scale as THREE.Vector3).x

    ;(camera as any).userData.annotationViewport = { width: 2200, height: 2200 };
    ann.update(camera);
    const largeViewportScale = ((ann as any).textLabel.object3d.scale as THREE.Vector3).x;

    expect(smallViewportScale).toBeGreaterThan(largeViewportScale);
  });
});

