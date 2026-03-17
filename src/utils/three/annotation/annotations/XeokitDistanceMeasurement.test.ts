import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as THREE from 'three';

describe('XeokitDistanceMeasurement', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('应支持在草稿态仅保留已锁定起点，其余预览元素隐藏', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(2, 3, 4),
      visible: true,
    }) as any;

    measurement.setParams({
      originVisible: true,
      targetVisible: false,
      wireVisible: false,
      axisVisible: false,
      labelVisible: false,
    });

    expect(measurement.originMarker.visible).toBe(true);
    expect(measurement.targetMarker.visible).toBe(false);
    expect(measurement.mainLine.visible).toBe(false);
    expect(measurement.mainLabel.visible).toBe(false);
    expect(measurement.xLine.visible).toBe(false);
    expect(measurement.yLine.visible).toBe(false);
    expect(measurement.zLine.visible).toBe(false);
    expect(measurement.xLabel.visible).toBe(false);
    expect(measurement.yLabel.visible).toBe(false);
    expect(measurement.zLabel.visible).toBe(false);
  });

  it('单个零分量时仍应保留对应的 XYZ 分解标签', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(5, 7, 0),
      visible: true,
    }) as any;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    measurement.update(camera);

    expect(measurement.xLabel.visible).toBe(true);
    expect(measurement.yLabel.visible).toBe(true);
    expect(measurement.zLabel.visible).toBe(true);
    expect(measurement.xLabel.element.textContent).toContain('X');
    expect(measurement.yLabel.element.textContent).toContain('Y');
    expect(measurement.zLabel.element.textContent).toContain('0.00 m');
  });

  it('应基于显示变换后的世界尺度计算长度文案', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(1000, 2000, 3000),
      displayTransform: new THREE.Matrix4().makeScale(0.001, 0.001, 0.001),
      visible: true,
    }) as any;

    expect(measurement.mainLabel.element.textContent).toContain('3.74 m');
    expect(measurement.xLabel.element.textContent).toContain('1.00 m');
    expect(measurement.yLabel.element.textContent).toContain('2.00 m');
    expect(measurement.zLabel.element.textContent).toContain('3.00 m');
  });

  it('应使用 xeokit 风格的 2D 实线来绘制主线与分解线', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    materials.setResolution(1280, 720);
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(5, 7, 3),
      visible: true,
    }) as any;

    const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    measurement.update(camera);

    expect(measurement.mainLine.type).toBe('Line2');
    expect(measurement.xLine.type).toBe('Line2');
    expect(measurement.yLine.type).toBe('Line2');
    expect(measurement.zLine.type).toBe('Line2');
    expect((measurement.mainLine.material as any).dashed).toBe(false);
    expect((measurement.xLine.material as any).dashed).toBe(false);
    expect((measurement.mainLine.material as any).linewidth).toBeGreaterThan(1);
  });

  it('在模型缩放后仍应把标签与线段拉开，避免贴线难以阅读', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(1000, 0, 0),
      displayTransform: new THREE.Matrix4().makeScale(0.001, 0.001, 0.001),
      visible: true,
    }) as any;

    const parent = new THREE.Group();
    parent.matrixAutoUpdate = false;
    parent.matrix.makeScale(0.001, 0.001, 0.001);
    parent.updateMatrixWorld(true);
    parent.add(measurement);
    parent.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    measurement.update(camera);

    const labelWorld = measurement.mainLabel.getWorldPosition(new THREE.Vector3());
    const lineMidWorld = measurement.localToWorld(new THREE.Vector3(500, 0, 0));
    expect(labelWorld.distanceTo(lineMidWorld)).toBeGreaterThan(0.03);
  });

  it('零分量轴的标签也应单独避让，不能与其它标签重叠', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(1000, 0, 1200),
      displayTransform: new THREE.Matrix4().makeScale(0.001, 0.001, 0.001),
      visible: true,
    }) as any;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    measurement.update(camera);

    const yWorld = measurement.yLabel.getWorldPosition(new THREE.Vector3());
    const zWorld = measurement.zLabel.getWorldPosition(new THREE.Vector3());
    const mainWorld = measurement.mainLabel.getWorldPosition(new THREE.Vector3());

    expect(yWorld.distanceTo(zWorld)).toBeGreaterThan(0.03);
    expect(yWorld.distanceTo(mainWorld)).toBeGreaterThan(0.03);
  });

  it('纯单轴测量时也应保留零分量标签，保持 xeokit 的 XYZ 读数完整', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(1000, 0, 0),
      displayTransform: new THREE.Matrix4().makeScale(0.001, 0.001, 0.001),
      visible: true,
    }) as any;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    measurement.update(camera);

    expect(measurement.mainLabel.visible).toBe(true);
    expect(measurement.xLabel.visible).toBe(true);
    expect(measurement.yLabel.visible).toBe(true);
    expect(measurement.zLabel.visible).toBe(true);
    expect(measurement.yLabel.element.textContent).toContain('0.00 m');
    expect(measurement.zLabel.element.textContent).toContain('0.00 m');
  });

  it('即使屏幕投影很小，也应继续显示 XYZ 分解标签和分量线', async () => {
    const { AnnotationMaterials } = await import('../core/AnnotationMaterials');
    const { XeokitDistanceMeasurement } = await import('./XeokitDistanceMeasurement');

    const materials = new AnnotationMaterials();
    materials.setResolution(1280, 720);
    const measurement = new XeokitDistanceMeasurement(materials, {
      origin: new THREE.Vector3(0, 0, 0),
      target: new THREE.Vector3(0.2, 0.3, 0.4),
      visible: true,
    }) as any;

    const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.1, 5000);
    camera.position.set(0, 0, 1200);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    measurement.update(camera);

    expect(measurement.xLine.visible).toBe(true);
    expect(measurement.yLine.visible).toBe(true);
    expect(measurement.zLine.visible).toBe(true);
    expect(measurement.xLabel.visible).toBe(true);
    expect(measurement.yLabel.visible).toBe(true);
    expect(measurement.zLabel.visible).toBe(true);
  });
});
