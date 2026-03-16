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
});
