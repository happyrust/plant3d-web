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
});
