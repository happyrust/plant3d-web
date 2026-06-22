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

  it('测量未命中时不显示鼠标旁遮挡提示', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.updateMatrixWorld(true);

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
      dtxLayerRef: ref({ _totalObjects: 1 } as any),
      selectionRef: ref({ pickPoint: vi.fn(() => null) } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', {
      clientX: 100,
      clientY: 100,
    }));

    expect(store.xeokitPointerLensState.value.visible).toBe(false);
    tools.dispose();
  });

  it('普通 mesh hover 不应触发测量态临时半透明', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const picks = [
      { objectId: 'o:tubi_refno:0', point: new THREE.Vector3(0, 0, 0) },
      { objectId: 'o:tubi_refno:0', point: new THREE.Vector3(0, 0, 0) },
    ];
    const compat = {
      scene: {
        objects: {
          tubi_refno: { xrayed: false },
        } as Record<string, { xrayed: boolean }>,
        setObjectsXRayed: vi.fn((refnos: string[], xrayed: boolean) => {
          for (const refno of refnos) {
            compat.scene.objects[refno] ??= { xrayed: false };
            compat.scene.objects[refno].xrayed = xrayed;
          }
        }),
      },
    };

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({
        pickPoint: vi.fn(() => picks.shift() ?? null),
      } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(compat as any),
      requestRender: null,
    });

    const event = new PointerEvent('pointermove', { clientX: 100, clientY: 100 });
    tools.onCanvasPointerMove(canvas, event);
    tools.onCanvasPointerMove(canvas, event);
    tools.deactivate();

    expect(compat.scene.setObjectsXRayed).not.toHaveBeenCalled();
    tools.dispose();
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

  it('完成混合 PTSET 到 Mesh 距离测量时应保留两个端点各自的 sourceInfo', async () => {
    vi.useFakeTimers();
    vi.doMock('@/composables/useDbMetaInfo', () => ({
      getDbnumByRefno: vi.fn(() => 250160),
    }));
    vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
      getDtxRefnoTransform: vi.fn(() => null),
    }));
    vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
      useDbnoInstancesParquetLoader: () => ({
        queryPtsetByRefnoFromParquet: vi.fn(async () => ({
          success: false,
          refno: '24381_145018',
          ptset: [],
          world_transform: null,
          unit_info: null,
          error_code: 'PTSET_POINTS_MISSING',
          error_message: 'cata_hash=elbo-a 未找到 ptset 点',
        })),
      }),
    }));
    vi.doMock('@/api/genModelPdmsAttrApi', () => ({
      pdmsGetPtsetWithContext: vi.fn(async () => ({
        success: true,
        refno: '24381_145018',
        ptset: [
          {
            number: 1,
            pt: [0, 0, 0],
            dir: null,
            dir_flag: 0,
            ref_dir: null,
            pbore: 100,
            pwidth: 0,
            pheight: 0,
            pconnect: '',
          },
        ],
        world_transform: null,
        unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
        error_message: null,
      })),
    }));

    const [{ useToolStore }, { useXeokitMeasurementTools }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateMeasurementPickSource('ptset', {
      show: true,
      snap: true,
      thresholdPx: 40,
      priority: 20,
    });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', {
      show: true,
      snap: false,
      thresholdPx: 40,
      priority: 40,
    });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const selectionPick = vi.fn(() => ({
      objectId: 'o:24381_145018:0',
      point: new THREE.Vector3(0, 0, 0),
    }));
    const compat = {
      scene: {
        objects: {
          '24381_145018': { xrayed: false },
        } as Record<string, { xrayed: boolean }>,
        setObjectsXRayed: vi.fn((refnos: string[], xrayed: boolean) => {
          for (const refno of refnos) {
            compat.scene.objects[refno] ??= { xrayed: false };
            compat.scene.objects[refno].xrayed = xrayed;
          }
        }),
      },
    };

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({
        camera,
        canvas,
        scene: new THREE.Scene(),
      } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({
        pickPoint: selectionPick,
      } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(compat as any),
      requestRender: null,
    });
    const event = new PointerEvent('pointerup', {
      clientX: 100,
      clientY: 100,
      button: 0,
    });

    tools.onCanvasPointerMove(canvas, event);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    tools.onCanvasPointerMove(canvas, event);

    expect(store.xeokitPointerLensState.value).toMatchObject({
      visible: true,
      snapped: true,
    });
    expect(compat.scene.setObjectsXRayed).toHaveBeenCalledWith(['24381_145018'], true);

    tools.onCanvasPointerUp(canvas, event);

    expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo).toEqual({
      source: 'ptset',
      candidateId: 'ptset:24381_145018#1',
      refno: '24381_145018',
      label: 'PTSET #1',
    });

    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true });
    tools.onCanvasPointerUp(canvas, event);

    expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
    const record = store.xeokitDistanceMeasurements.value[0];
    expect(record.origin.sourceInfo).toEqual({
      source: 'ptset',
      candidateId: 'ptset:24381_145018#1',
      refno: '24381_145018',
      label: 'PTSET #1',
    });
    expect(record.target.sourceInfo).toMatchObject({
      source: 'mesh_pick_point',
      candidateId: 'mesh:o:24381_145018:0',
      refno: '24381_145018',
      label: 'Mesh Pick Point',
    });
    expect(record.target.sourceInfo?.candidateId?.startsWith('ptset:')).toBe(false);
    expect(compat.scene.setObjectsXRayed).toHaveBeenCalledWith(['24381_145018'], false);

    tools.dispose();
    vi.useRealTimers();
  });
});
