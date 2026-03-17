import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as THREE from 'three';

describe('XeokitAngleMeasurement', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('应支持在寻找终点时仅显示已锁定的起点、拐点与第一段连线', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitAngleMeasurement } = await import('./XeokitAngleMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitAngleMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      corner: new THREE.Vector3(1, 0, 0),
      target: new THREE.Vector3(1, 1, 0),
      visible: true,
    }) as any;

    measurement.setParams({
      originVisible: true,
      cornerVisible: true,
      targetVisible: false,
      originWireVisible: true,
      targetWireVisible: false,
      angleVisible: false,
    });

    expect(measurement.originMarker.visible).toBe(true);
    expect(measurement.cornerMarker.visible).toBe(true);
    expect(measurement.targetMarker.visible).toBe(false);
    expect(measurement.originLine.visible).toBe(true);
    expect(measurement.targetLine.visible).toBe(false);
    expect(measurement.angleLabel.visible).toBe(false);
  });

  it('应使用 xeokit 风格的 2D 实线来绘制角度测量连线', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitAngleMeasurement } = await import('./XeokitAngleMeasurement');

    const materials = new AnnotationMaterials();
    materials.setResolution(1280, 720);
    const measurement = new XeokitAngleMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      corner: new THREE.Vector3(1, 0, 0),
      target: new THREE.Vector3(1, 1, 0),
      visible: true,
    }) as any;

    const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    measurement.update(camera);

    expect(measurement.originLine.type).toBe('Line2');
    expect(measurement.targetLine.type).toBe('Line2');
    expect((measurement.originLine.material as any).dashed).toBe(false);
    expect((measurement.targetLine.material as any).dashed).toBe(false);
    expect((measurement.originLine.material as any).linewidth).toBeGreaterThan(1);
    expect((measurement.targetLine.material as any).linewidth).toBeGreaterThan(1);
  });

  it('在存在全局缩放时也应把角度标签沿角平分线拉开到可读距离', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitAngleMeasurement } = await import('./XeokitAngleMeasurement');

    const materials = new AnnotationMaterials();
    materials.setResolution(1280, 720);
    const measurement = new XeokitAngleMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      corner: new THREE.Vector3(1, 0, 0),
      target: new THREE.Vector3(1, 1, 0),
      visible: true,
    }) as any;

    const parent = new THREE.Group();
    parent.scale.setScalar(0.001);
    parent.add(measurement);

    const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.userData.annotationViewport = { width: 1280, height: 720 };
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    parent.updateMatrixWorld(true);
    measurement.update(camera);
    parent.updateMatrixWorld(true);

    const cornerWorld = measurement.cornerMarker.getWorldPosition(new THREE.Vector3());
    const labelWorld = measurement.angleLabel.getWorldPosition(new THREE.Vector3());

    expect(labelWorld.distanceTo(cornerWorld)).toBeGreaterThan(0.05);
  });
});
