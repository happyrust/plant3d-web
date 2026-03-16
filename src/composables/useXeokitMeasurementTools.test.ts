import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import * as THREE from 'three';

describe('useXeokitMeasurementTools', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    };
    localStorage.clear();
    vi.resetModules();
  });

  it('会把 xeokit 测量对象挂进 annotationGroup，并在清理时移除', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { AnnotationMaterials }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/utils/three/annotation/core/AnnotationMaterials'),
    ]);

    const store = useToolStore();
    store.clearXeokitMeasurements();
    store.clearCurrentXeokitDraft();

    const annotationGroup = new THREE.Group();
    const registerExternalAnnotation = vi.fn();
    const unregisterExternalAnnotation = vi.fn();
    const annotationSystem = {
      materials: new AnnotationMaterials(),
      annotationGroup,
      registerExternalAnnotation,
      unregisterExternalAnnotation,
      selectedId: ref<string | null>(null),
      selectAnnotation: vi.fn(),
    } as any;

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      annotationSystemRef: shallowRef(annotationSystem),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    store.addXeokitDistanceMeasurement({
      id: 'dist-1',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 2, 3] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });

    tools.syncFromStore();
    await nextTick();

    expect(registerExternalAnnotation).toHaveBeenCalledWith('xmeas_dist-1', expect.anything());
    expect(annotationGroup.children).toHaveLength(1);
    expect((annotationGroup.children[0] as THREE.Object3D).parent).toBe(annotationGroup);

    store.clearXeokitMeasurements();
    tools.syncFromStore();
    await nextTick();

    expect(unregisterExternalAnnotation).toHaveBeenCalledWith('xmeas_dist-1');
    expect(annotationGroup.children).toHaveLength(0);
  });

  it('会在存在 globalModelMatrix 时把世界坐标还原为 annotation local 坐标', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { AnnotationMaterials }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/utils/three/annotation/core/AnnotationMaterials'),
    ]);

    const store = useToolStore();
    store.clearXeokitMeasurements();
    store.clearCurrentXeokitDraft();

    const annotationGroup = new THREE.Group();
    const annotationSystem = {
      materials: new AnnotationMaterials(),
      annotationGroup,
      registerExternalAnnotation: vi.fn(),
      unregisterExternalAnnotation: vi.fn(),
      selectedId: ref<string | null>(null),
      selectAnnotation: vi.fn(),
    } as any;

    const dtxLayer = {
      getGlobalModelMatrix: () => new THREE.Matrix4().makeTranslation(10, 20, 30),
    } as any;

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(dtxLayer),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      annotationSystemRef: shallowRef(annotationSystem),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    store.addXeokitDistanceMeasurement({
      id: 'dist-world',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [10, 20, 30] },
      target: { entityId: 'b', worldPos: [11, 22, 33] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });

    tools.syncFromStore();
    await nextTick();

    const measurement = annotationGroup.children[0] as any;
    expect(measurement.originMarker.position.toArray()).toEqual([0, 0, 0]);
    expect(measurement.targetMarker.position.toArray()).toEqual([1, 2, 3]);
  });

  it('应提供 xeokit 测量的当前与全量显隐辅助能力', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { AnnotationMaterials }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/utils/three/annotation/core/AnnotationMaterials'),
    ]);

    const store = useToolStore();
    store.clearXeokitMeasurements();
    store.clearCurrentXeokitDraft();

    const annotationSystem = {
      materials: new AnnotationMaterials(),
      annotationGroup: new THREE.Group(),
      registerExternalAnnotation: vi.fn(),
      unregisterExternalAnnotation: vi.fn(),
      selectedId: ref<string | null>(null),
      selectAnnotation: vi.fn(),
    } as any;

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      annotationSystemRef: shallowRef(annotationSystem),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    store.addXeokitDistanceMeasurement({
      id: 'dist-visible',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    store.addXeokitAngleMeasurement({
      id: 'angle-hidden',
      kind: 'angle',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      corner: { entityId: 'b', worldPos: [1, 0, 0] },
      target: { entityId: 'c', worldPos: [1, 1, 0] },
      visible: false,
      approximate: false,
      createdAt: 2,
    });
    await nextTick();

    expect(tools.hasVisibleMeasurements.value).toBe(true);
    expect(tools.hasHiddenMeasurements.value).toBe(true);

    tools.setAllMeasurementsVisible(true);
    expect(store.allXeokitMeasurements.value.every((item: any) => item.visible)).toBe(true);

    tools.setMeasurementVisible('dist-visible', false);
    expect(store.allXeokitMeasurements.value.find((item: any) => item.id === 'dist-visible')?.visible).toBe(false);
    expect(tools.hasHiddenMeasurements.value).toBe(true);
  });
});
