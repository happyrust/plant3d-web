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

  it('长度测量默认应只显示总长，不显示 XYZ 分解线与分量标签', async () => {
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
      id: 'dist-style-default',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 2, 3] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });

    tools.syncFromStore();
    await nextTick();

    const measurement = annotationGroup.children[0] as any;
    expect(measurement.mainLine.visible).toBe(true);
    expect(measurement.mainLabel.visible).toBe(true);
    expect(measurement.xLine.visible).toBe(false);
    expect(measurement.yLine.visible).toBe(false);
    expect(measurement.zLine.visible).toBe(false);
    expect(measurement.xLabel.visible).toBe(false);
    expect(measurement.yLabel.visible).toBe(false);
    expect(measurement.zLabel.visible).toBe(false);
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

  it('进入测量模式时，详情抽屉应默认关闭', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { AnnotationMaterials }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/utils/three/annotation/core/AnnotationMaterials'),
    ]);

    const store = useToolStore();
    store.clearXeokitMeasurements();
    store.clearCurrentXeokitDraft();
    store.setMeasurementDetailsDrawerOpen(true);

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

    tools.activate('xeokit_measure_distance');

    expect(store.toolMode.value).toBe('xeokit_measure_distance');
    expect(store.measurementDetailsDrawerOpen.value).toBe(false);
  });

  it('当 DTX 未命中但 annotation 命中时，仍应允许创建测量草稿', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { AnnotationMaterials }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/utils/three/annotation/core/AnnotationMaterials'),
    ]);

    const store = useToolStore();
    store.clearXeokitMeasurements();
    store.clearCurrentXeokitDraft();
    store.setToolMode('xeokit_measure_distance');

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });

    const auxMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    auxMesh.userData.pickable = true;
    auxMesh.updateMatrixWorld(true);

    const annotationSystem = {
      materials: new AnnotationMaterials(),
      annotationGroup: new THREE.Group(),
      registerExternalAnnotation: vi.fn(),
      unregisterExternalAnnotation: vi.fn(),
      selectedId: ref<string | null>(null),
      selectAnnotation: vi.fn(),
      annotations: shallowRef(new Map([['mbd_aux_1', auxMesh as any]])),
    } as any;

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({
        pickPoint: vi.fn(() => null),
      } as any),
      overlayContainerRef: ref(document.createElement('div')),
      annotationSystemRef: shallowRef(annotationSystem),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    const event = new PointerEvent('pointerup', {
      clientX: 100,
      clientY: 100,
      button: 0,
    });

    tools.onCanvasPointerUp(canvas, event);

    expect(store.currentXeokitDistanceDraft.value).not.toBeNull();
    expect(store.currentXeokitDistanceDraft.value?.origin.entityId).toBe('annotation:mbd_aux_1');
    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos[2]).toBeCloseTo(0.5, 3);
  });
});
