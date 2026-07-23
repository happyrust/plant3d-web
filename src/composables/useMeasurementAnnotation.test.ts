import { describe, expect, it, vi } from 'vitest';

import { MeasurementAnnotationManager } from './useMeasurementAnnotation';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { DistanceMeasurementRecord } from './useToolStore';

function createAnnotationSystem(): UseAnnotationThreeReturn {
  return {
    annotations: { value: new Map() },
    annotationGroup: {} as any,
    materials: {} as any,
    interactionController: {} as any,
    hoveredId: { value: null },
    selectedId: { value: null },
    createLeaderAnnotation: vi.fn() as any,
    addAnnotation: vi.fn(),
    removeAnnotation: vi.fn(),
    getAnnotation: vi.fn(),
    clearAll: vi.fn(),
    highlightAnnotation: vi.fn(),
    selectAnnotation: vi.fn(),
    registerExternalAnnotation: vi.fn(),
    unregisterExternalAnnotation: vi.fn(),
    onInteraction: vi.fn(() => () => undefined),
    update: vi.fn(),
    renderLabels: vi.fn(),
    setResolution: vi.fn(),
    initCSS2DRenderer: vi.fn() as any,
    enableInteraction: vi.fn(),
    disableInteraction: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('MeasurementAnnotationManager', () => {
  it('syncs visible measurements into the dimension external source', () => {
    const replaceExternalSource = vi.fn();
    const viewport = { setSelection: vi.fn() };
    const manager = new MeasurementAnnotationManager(createAnnotationSystem(), {
      getDimensionSystem: () => ({
        replaceExternalSource,
        viewport,
      } as any),
    });
    manager.setUnit('mm');
    manager.setPrecision(0);
    const measurement: DistanceMeasurementRecord = {
      id: 'm1',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 1,
    };

    manager.sync([measurement]);
    manager.highlight('m1');

    expect(replaceExternalSource).toHaveBeenCalledWith(
      'measurement',
      [expect.objectContaining({
        id: 'measurement:m1',
        source: 'measurement',
        layout: expect.objectContaining({
          kind: 'linear',
          authoritativeText: '1000 mm',
        }),
      })],
    );
    expect(viewport.setSelection).toHaveBeenCalledWith('measurement:m1');
  });
});
