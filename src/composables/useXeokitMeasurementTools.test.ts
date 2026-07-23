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

  it('有 dimension system 时把 xeokit 测量写入外部尺寸快照，不再创建旧 Object3D', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { AnnotationMaterials }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/utils/three/annotation/core/AnnotationMaterials'),
    ]);

    const store = useToolStore();
    store.clearXeokitMeasurements();
    store.clearCurrentXeokitDraft();

    const annotationGroup = new THREE.Group();
    const dimensionSystem = {
      replaceExternalSource: vi.fn(),
      viewport: { setSelection: vi.fn() },
    } as any;
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
      getDimensionSystem: () => dimensionSystem,
      sceneWorldToDesignMetres: (point) => [point[0] + 10, point[1], point[2]],
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

    expect(dimensionSystem.replaceExternalSource).toHaveBeenLastCalledWith('xeokit-measurement', [
      expect.objectContaining({
        id: 'xeokit-measurement:dist-1',
        source: 'xeokit-measurement',
        layout: expect.objectContaining({
          kind: 'linear',
          a: [10, 0, 0],
          b: [11, 2, 3],
        }),
      }),
    ]);
    expect(annotationGroup.children).toHaveLength(0);
    expect(annotationSystem.registerExternalAnnotation).not.toHaveBeenCalled();

    store.clearXeokitMeasurements();
    tools.syncFromStore();
    await nextTick();

    expect(dimensionSystem.replaceExternalSource).toHaveBeenLastCalledWith('xeokit-measurement', []);
  });

  it('创建测量点时应记录排除 recenter 后的工程 World 米制坐标', async () => {
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
    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 40 });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(2, 4, 7);
    camera.lookAt(2, 4, 6);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const globalModelMatrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
    globalModelMatrix.setPosition(-10, -20, -30);
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => globalModelMatrix.clone(),
      } as any),
      selectionRef: ref({
        pickPoint: vi.fn(() => ({
          objectId: 'o:24381_145018:0',
          point: new THREE.Vector3(2, 4, 6),
        })),
      } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', {
      clientX: 100,
      clientY: 100,
      button: 0,
    }));

    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos).toEqual([2, 4, 6]);
    expect(store.currentXeokitDistanceDraft.value?.origin.designWorldPos?.[0]).toBeCloseTo(12);
    expect(store.currentXeokitDistanceDraft.value?.origin.designWorldPos?.[1]).toBeCloseTo(24);
    expect(store.currentXeokitDistanceDraft.value?.origin.designWorldPos?.[2]).toBeCloseTo(36);
  });

  it('为尺寸 SnapPort 暴露 source-neutral 模型表面候选', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('primitive_key_point', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: false });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas } as any),
      dtxLayerRef: ref(null),
      selectionRef: ref({
        pickPoint: vi.fn(() => ({
          objectId: 'o:24381_145018:0',
          point: new THREE.Vector3(0, 0, 0),
        })),
      } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store: useToolStore(),
      compatViewerRef: ref(null),
      requestRender: null,
    });

    expect(tools.queryDimensionSnapCandidates(canvas, { x: 100, y: 100 })).toEqual([
      expect.objectContaining({
        id: 'mesh:o:24381_145018:0',
        source: 'mesh_pick_point',
        sceneWorld: [0, 0, 0],
        refno: '24381_145018',
        distancePx: 0,
      }),
    ]);
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

  it('角度测量应按顶点、第一边点、第二边点的 E3D 顺序完成', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_angle');
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 40 });

    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ];
    const selectionPick = vi.fn(() => ({
      objectId: 'o:24381_145018:0',
      point: points[selectionPick.mock.calls.length - 1]!.clone(),
    }));
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({ pickPoint: selectionPick } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });
    const click = (clientX: number, clientY: number) => tools.onCanvasPointerUp(
      canvas,
      new PointerEvent('pointerup', { clientX, clientY, button: 0 }),
    );

    click(100, 100);
    expect(store.currentXeokitAngleDraft.value?.stage).toBe('finding_first_arm');
    expect(store.currentXeokitAngleDraft.value?.corner.worldPos).toEqual([0, 0, 0]);

    click(150, 100);
    expect(store.currentXeokitAngleDraft.value?.stage).toBe('finding_second_arm');
    expect(store.currentXeokitAngleDraft.value?.origin.worldPos).toEqual([1, 0, 0]);

    click(100, 50);
    expect(store.xeokitAngleMeasurements.value).toHaveLength(1);
    expect(store.xeokitAngleMeasurements.value[0]?.corner.worldPos).toEqual([0, 0, 0]);
    expect(store.xeokitAngleMeasurements.value[0]?.origin.worldPos).toEqual([1, 0, 0]);
    expect(store.xeokitAngleMeasurements.value[0]?.target.worldPos).toEqual([0, 1, 0]);
  });

  it('重置当前草稿时保持测量命令，第二次重置才表示没有可取消步骤', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');
    store.setCurrentXeokitDistanceDraft({
      id: 'draft-reset',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'a', worldPos: [0, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    expect(tools.reset()).toBe(true);
    expect(store.currentXeokitDistanceDraft.value).toBeNull();
    expect(store.toolMode.value).toBe('xeokit_measure_distance');
    expect(tools.reset()).toBe(false);
  });

  it('已缓存 P-Point 应按光标距离吸附，不依赖当前射线仍命中原构件', async () => {
    vi.useFakeTimers();
    vi.doMock('@/composables/useDbMetaInfo', () => ({
      getDbnumByRefno: vi.fn(() => 250160),
    }));
    vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
      getDtxRefnoTransform: vi.fn(() => null),
    }));
    vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
      useDbnoInstancesParquetLoader: () => ({
        queryPtsetByRefnoFromParquet: vi.fn(async (_dbno: number, refno: string) => ({
          success: true,
          refno,
          ptset: [{
            number: 1,
            pt: [0, 0, 0],
            dir: null,
            dir_flag: 0,
            ref_dir: null,
            pbore: 100,
            pwidth: 0,
            pheight: 0,
            pconnect: '',
          }],
          world_transform: null,
          unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
          error_message: null,
        })),
      }),
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
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: false, snap: false });

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
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({ pickPoint: selectionPick } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });
    const event = new PointerEvent('pointermove', { clientX: 100, clientY: 100, button: 0 });

    tools.onCanvasPointerMove(canvas, event);
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    selectionPick.mockReturnValue(null as any);
    tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', {
      clientX: 100,
      clientY: 100,
      button: 0,
    }));

    expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo).toMatchObject({
      source: 'ptset',
      refno: '24381_145018',
    });
    vi.useRealTimers();
  });

  it('关闭 Keep Dimensions 后只隐藏旧距离图形，不删除历史记录', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');
    store.addXeokitDistanceMeasurement({
      id: 'old-distance',
      kind: 'distance',
      origin: { entityId: 'old-a', worldPos: [0, 0, 0] },
      target: { entityId: 'old-b', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateStyle({ distanceKeepDimensions: false });
    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 40 });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 0, 0)];
    const selectionPick = vi.fn(() => ({
      objectId: 'o:24381_145018:0',
      point: points[selectionPick.mock.calls.length - 1]!.clone(),
    }));
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({ pickPoint: selectionPick } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: 100, clientY: 100, button: 0 }));
    tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: 150, clientY: 100, button: 0 }));

    expect(store.xeokitDistanceMeasurements.value).toHaveLength(2);
    expect(store.xeokitDistanceMeasurements.value[0]?.visible).toBe(false);
    expect(store.xeokitDistanceMeasurements.value[1]?.visible).toBe(true);
  });

  it('P-Point 候选未加载完成前不应登记当前构件测量点', async () => {
    vi.useFakeTimers();
    let resolvePtset!: (value: any) => void;
    const ptsetResponse = new Promise((resolve) => {
      resolvePtset = resolve;
    });
    vi.doMock('@/composables/useDbMetaInfo', () => ({
      getDbnumByRefno: vi.fn(() => 250160),
    }));
    vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
      getDtxRefnoTransform: vi.fn(() => null),
    }));
    vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
      useDbnoInstancesParquetLoader: () => ({
        queryPtsetByRefnoFromParquet: vi.fn(() => ptsetResponse),
      }),
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
    measurementStyle.updateMeasurementPickSource('ptset', { show: true, snap: true, thresholdPx: 40 });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 40 });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({
        pickPoint: vi.fn(() => ({
          objectId: 'o:24381_145018:0',
          point: new THREE.Vector3(0, 0, 0),
        })),
      } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });
    const event = new PointerEvent('pointerup', {
      clientX: 100,
      clientY: 100,
      button: 0,
    });

    tools.onCanvasPointerMove(canvas, event);
    tools.onCanvasPointerUp(canvas, event);
    expect(store.currentXeokitDistanceDraft.value).toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    tools.onCanvasPointerUp(canvas, event);
    expect(store.currentXeokitDistanceDraft.value).toBeNull();

    resolvePtset({
      success: true,
      refno: '24381_145018',
      ptset: [{
        number: 1,
        pt: [0, 0, 0],
        dir: null,
        dir_flag: 0,
        ref_dir: null,
        pbore: 100,
        pwidth: 0,
        pheight: 0,
        pconnect: '',
      }],
      world_transform: null,
      unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
      error_message: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    tools.onCanvasPointerMove(canvas, event);
    tools.onCanvasPointerUp(canvas, event);

    expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo?.source).toBe('ptset');
    vi.useRealTimers();
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
      subtitle: 'P-Point #1',
    });
    expect(compat.scene.setObjectsXRayed).toHaveBeenCalledWith(['24381_145018'], true);

    tools.onCanvasPointerUp(canvas, event);

    expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo).toEqual({
      source: 'ptset',
      candidateId: 'ptset:24381_145018#1',
      refno: '24381_145018',
      label: 'P-Point #1',
    });

    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true });
    tools.onCanvasPointerUp(canvas, event);

    expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
    const record = store.xeokitDistanceMeasurements.value[0];
    expect(record.origin.sourceInfo).toEqual({
      source: 'ptset',
      candidateId: 'ptset:24381_145018#1',
      refno: '24381_145018',
      label: 'P-Point #1',
    });
    expect(record.target.sourceInfo).toMatchObject({
      source: 'mesh_pick_point',
      candidateId: 'mesh:o:24381_145018:0',
      refno: '24381_145018',
      label: '模型表面点',
    });
    expect(record.target.sourceInfo?.candidateId?.startsWith('ptset:')).toBe(false);
    expect(record.approximate).toBe(true);
    expect(compat.scene.setObjectsXRayed).toHaveBeenCalledWith(['24381_145018'], false);

    tools.dispose();
    vi.useRealTimers();
  });
});
