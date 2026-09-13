import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import * as THREE from 'three';

import { worldDistanceAidChildId } from '@/measurement/aids/worldDistanceAidPlan';

// 本文件的 P-Point / 基本体关键点用例 mock 的是 parquet loader 与 `:3100` ptset API，
// 那是 `legacy` 数据源的取数（2026-09-12 起测量关键点经 `getModelSource().keypoints` 端口）；
// 缺省源是 gen-model-v1，这里钉回 legacy 让这些 mock 继续生效（同 useDbnoInstancesDtxLoader.test.ts）。
beforeAll(() => window.history.replaceState({}, '', '?model_source=legacy'));

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
      viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
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

    const records = dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1];
    expect(records).toHaveLength(4);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'xeokit-measurement:dist-1',
        source: 'xeokit-measurement',
        layout: expect.objectContaining({
          kind: 'linear',
          a: [10, 0, 0],
          b: [11, 2, 3],
        }),
      }),
      expect.objectContaining({
        id: worldDistanceAidChildId('xeokit-measurement:dist-1', 'x'),
        category: 'annotation',
        layout: expect.objectContaining({
          lines: [
            expect.objectContaining({
              from: [10, 0, 0],
              to: [11, 0, 0],
            }),
          ],
        }),
      }),
      expect.objectContaining({
        id: worldDistanceAidChildId('xeokit-measurement:dist-1', 'y'),
        category: 'annotation',
        layout: expect.objectContaining({
          lines: [
            expect.objectContaining({
              from: [11, 0, 0],
              to: [11, 2, 0],
            }),
          ],
        }),
      }),
      expect.objectContaining({
        id: worldDistanceAidChildId('xeokit-measurement:dist-1', 'z'),
        category: 'annotation',
        layout: expect.objectContaining({
          lines: [
            expect.objectContaining({
              from: [11, 2, 0],
              to: [11, 2, 3],
            }),
          ],
        }),
      }),
    ]));
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

  it('Perpendicular to：第二点吸到带方向的 P-Point 时按其轴线取垂足（golden G4-01 LINE provider）', async () => {
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
            // P-point 轴线沿 +Z：E3D PPOINT 的 getLine()。
            dir: [0, 0, 1],
            dir_flag: 1,
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
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 20 });
    measurementStyle.updateStyle({ perpendicularTo: true, keepMeasurementAnnotation: true });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    // 源点：模型表面点 (0.5, 0, 0.5)，投影到画布 (150, 100)。
    const selectionPick = vi.fn(() => ({
      objectId: 'o:24381_145018:0',
      point: new THREE.Vector3(0.5, 0, 0.5),
    }));
    const dimensionSystem = {
      replaceExternalSource: vi.fn(),
      viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
    } as any;
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({ pickPoint: selectionPick } as any),
      overlayContainerRef: ref(document.createElement('div')),
      getDimensionSystem: () => dimensionSystem,
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', { clientX: 150, clientY: 100, button: 0 }));
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: 150, clientY: 100, button: 0 }));
    expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo?.source).toBe('mesh_pick_point');

    // 第二击：光标落在 P-Point (0,0,0) 的投影 (100, 100) 上，且不再命中表面。
    selectionPick.mockReturnValue(null as any);
    tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: 100, clientY: 100, button: 0 }));

    const record = store.xeokitDistanceMeasurements.value[0]!;
    expect(record.perpendicular).toEqual({
      targetKind: 'line',
      targetLabel: 'P-Point #1 轴线',
    });
    // 垂足 = 源点 (0.5, 0, 0.5) 投影到过 (0,0,0)、沿 +Z 的无限线 → (0, 0, 0.5)。
    expect(record.target.designWorldPos![0]).toBeCloseTo(0, 9);
    expect(record.target.designWorldPos![1]).toBeCloseTo(0, 9);
    expect(record.target.designWorldPos![2]).toBeCloseTo(0.5, 9);
    expect(record.target.sourceInfo).toMatchObject({
      source: 'ptset',
      refno: '24381_145018',
      label: 'P-Point #1 轴线垂足',
    });
    const result = store.measurementDraftResult.value!;
    expect(result.perpendicular?.targetKind).toBe('line');
    expect(result.distance).toBeCloseTo(0.5, 9);

    // 垂距记录只出直接线：Vertical 0 → 不画 Vertical / Horizontal 腿，也不画 World 分量。
    const records = dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1];
    expect(records.map((item: { id: string }) => item.id)).toEqual([
      `xeokit-measurement:${record.id}`,
    ]);

    tools.dispose();
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

  it('自由表面模式下 P-Point 加载中应允许直接落模型表面点', async () => {
    vi.useFakeTimers();
    const pendingPtset = new Promise(() => {
      // 永不 resolve，模拟 P-Point 数据仍在加载。
    });
    vi.doMock('@/composables/useDbMetaInfo', () => ({
      getDbnumByRefno: vi.fn(() => 250160),
    }));
    vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
      getDtxRefnoTransform: vi.fn(() => null),
    }));
    vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
      useDbnoInstancesParquetLoader: () => ({
        queryPtsetByRefnoFromParquet: vi.fn(() => pendingPtset),
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
    measurementStyle.setMeasurementPickMode('free_surface');

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

    expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo?.source).toBe('mesh_pick_point');

    tools.dispose();
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

  it('连续测量开启时完成 A-B 应立即以 B 为起点创建下一段草稿', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');
    store.continuousDistanceMeasureEnabled.value = true;
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
    measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 40 });

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 7);
    camera.lookAt(0, 0, 6);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    });
    const pickPoint = vi.fn()
      .mockReturnValueOnce({ objectId: 'o:24381_145018:0', point: new THREE.Vector3(0, 0, 6) })
      .mockReturnValueOnce({ objectId: 'o:24381_145018:0', point: new THREE.Vector3(0.5, 0, 6) })
      .mockReturnValueOnce({ objectId: 'o:24381_145018:0', point: new THREE.Vector3(0.5, 0.5, 6) });

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref({ camera, canvas } as any),
      dtxLayerRef: ref({
        _totalObjects: 1,
        getGlobalModelMatrix: () => new THREE.Matrix4(),
      } as any),
      selectionRef: ref({ pickPoint } as any),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    const clickAt = (x: number, y: number) => {
      tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', {
        clientX: x,
        clientY: y,
        button: 0,
      }));
    };

    clickAt(100, 100);
    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos).toEqual([0, 0, 6]);

    clickAt(150, 100);
    expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
    expect(store.xeokitDistanceMeasurements.value[0].origin.worldPos).toEqual([0, 0, 6]);
    expect(store.xeokitDistanceMeasurements.value[0].target.worldPos).toEqual([0.5, 0, 6]);
    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos).toEqual([0.5, 0, 6]);

    clickAt(150, 50);
    expect(store.xeokitDistanceMeasurements.value).toHaveLength(2);
    expect(store.xeokitDistanceMeasurements.value[1].origin.worldPos).toEqual([0.5, 0, 6]);
    expect(store.xeokitDistanceMeasurements.value[1].target.worldPos).toEqual([0.5, 0.5, 6]);
    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos).toEqual([0.5, 0.5, 6]);

    tools.dispose();
  });

  it('repeatLastDistanceMeasurement 应以最近距离终点重启草稿，且非距离模式不生效', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);

    const store = useToolStore();
    store.clearAll();

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    store.setToolMode('xeokit_measure_angle');
    expect(tools.repeatLastDistanceMeasurement()).toBe(false);
    expect(store.currentXeokitDistanceDraft.value).toBeNull();

    store.setToolMode('xeokit_measure_distance');
    expect(tools.repeatLastDistanceMeasurement()).toBe(false);

    store.addXeokitDistanceMeasurement({
      id: 'dist-old',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 5,
    });
    store.addXeokitDistanceMeasurement({
      id: 'dist-new',
      kind: 'distance',
      origin: { entityId: 'c', worldPos: [2, 0, 0] },
      target: { entityId: 'd', worldPos: [3, 4, 5] },
      visible: true,
      approximate: false,
      createdAt: 9,
    });

    expect(tools.repeatLastDistanceMeasurement()).toBe(true);
    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos).toEqual([3, 4, 5]);
    expect(store.currentXeokitDistanceDraft.value?.origin.entityId).toBe('d');
    expect(store.xeokitDistanceMeasurements.value).toHaveLength(2);

    expect(tools.repeatLastDistanceMeasurement()).toBe(false);

    tools.dispose();
  });

  it('repeatLastDistanceMeasurement 选中优先：active 测量的终点优先于 createdAt 最新', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);

    const store = useToolStore();
    store.clearAll();
    store.setToolMode('xeokit_measure_distance');

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    store.addXeokitDistanceMeasurement({
      id: 'dist-old',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      approximate: false,
      createdAt: 5,
    });
    store.addXeokitDistanceMeasurement({
      id: 'dist-new',
      kind: 'distance',
      origin: { entityId: 'c', worldPos: [2, 0, 0] },
      target: { entityId: 'd', worldPos: [3, 4, 5] },
      visible: true,
      approximate: false,
      createdAt: 9,
    });

    // 用户在列表/图形中选中旧测量后 Repeat，应从旧测量的终点续测。
    store.activeXeokitMeasurementId.value = 'dist-old';
    expect(tools.repeatLastDistanceMeasurement()).toBe(true);
    expect(store.currentXeokitDistanceDraft.value?.origin.entityId).toBe('b');
    expect(store.currentXeokitDistanceDraft.value?.origin.worldPos).toEqual([1, 0, 0]);

    // 选中的不是距离测量（或 id 不存在）时回落到 createdAt 最新。
    store.clearCurrentXeokitDraft();
    store.activeXeokitMeasurementId.value = 'not-a-distance';
    expect(tools.repeatLastDistanceMeasurement()).toBe(true);
    expect(store.currentXeokitDistanceDraft.value?.origin.entityId).toBe('d');

    tools.dispose();
  });

  it('handleDimensionSelectionChange 把尺寸图形选中回写为 xeokit 测量选中', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);

    const store = useToolStore();
    store.clearAll();

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.handleDimensionSelectionChange('xeokit-measurement:m1');
    expect(store.activeXeokitMeasurementId.value).toBe('m1');

    // 选中非 xeokit 尺寸（用户尺寸/批注测量）时清空测量选中，保持视口一致。
    tools.handleDimensionSelectionChange('dimension-user-9');
    expect(store.activeXeokitMeasurementId.value).toBeNull();

    tools.handleDimensionSelectionChange('xeokit-measurement:m2');
    expect(store.activeXeokitMeasurementId.value).toBe('m2');

    tools.handleDimensionSelectionChange(null);
    expect(store.activeXeokitMeasurementId.value).toBeNull();

    tools.dispose();
  });

  it('把 World 正交子图形选择和右键命中解析回同一个父测量', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }, { useXeokitMeasurementStyleStore }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
      import('@/composables/useXeokitMeasurementStyleStore'),
    ]);

    const store = useToolStore();
    store.clearAll();
    const measurementStyle = useXeokitMeasurementStyleStore();
    measurementStyle.resetStyle();
    measurementStyle.updateStyle({
      distanceShowAxisBreakdown: true,
      showDirectLinearDimension: false,
    });

    let selection: string | null = null;
    const dimensionSystem = {
      replaceExternalSource: vi.fn(),
      viewport: {
        setSelection: vi.fn((id: string | null) => {
          selection = id;
        }),
        getSelection: vi.fn(() => selection),
      },
    } as any;
    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      getDimensionSystem: () => dimensionSystem,
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });
    store.addXeokitDistanceMeasurement({
      id: 'm-parent',
      kind: 'distance',
      origin: {
        entityId: 'a',
        worldPos: [0, 0, 0],
        designWorldPos: [0, 0, 0],
      },
      target: {
        entityId: 'b',
        worldPos: [1, 2, 0],
        designWorldPos: [1, 2, 0],
      },
      visible: true,
      approximate: false,
      createdAt: 1,
    });
    tools.syncFromStore();

    const parentDimensionId = 'xeokit-measurement:m-parent';
    const xChildId = worldDistanceAidChildId(parentDimensionId, 'x');
    const yChildId = worldDistanceAidChildId(parentDimensionId, 'y');
    expect(dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1]
      .map((record: { id: string }) => record.id)).toEqual([xChildId, yChildId]);

    selection = yChildId;
    tools.handleDimensionSelectionChange(yChildId);
    expect(store.activeXeokitMeasurementId.value).toBe('m-parent');
    expect(tools.resolveMeasurementIdFromDimensionId(yChildId)).toBe('m-parent');

    // 前向同步发现当前已选中同一父测量的子图形时，应保留用户点中的子图形。
    await nextTick();
    expect(dimensionSystem.viewport.setSelection).not.toHaveBeenCalled();
    expect(selection).toBe(yChildId);

    tools.dispose();
  });

  it('清空测量选中时不打断非 xeokit 来源的尺寸选中态', async () => {
    const [{ useToolStore }, { useXeokitMeasurementTools }] = await Promise.all([
      import('@/composables/useToolStore'),
      import('@/composables/useXeokitMeasurementTools'),
    ]);

    const store = useToolStore();
    store.clearAll();

    const setSelection = vi.fn();
    let currentSelection: string | null = null;
    const dimensionSystem = {
      replaceExternalSource: vi.fn(),
      viewport: {
        setSelection: setSelection.mockImplementation((id: string | null) => {
          currentSelection = id;
        }),
        getSelection: vi.fn(() => currentSelection),
      },
    } as any;

    const tools = useXeokitMeasurementTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(null),
      selectionRef: ref(null),
      overlayContainerRef: ref(document.createElement('div')),
      getDimensionSystem: () => dimensionSystem,
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    // xeokit 测量被选中：正常前向同步。
    store.activeXeokitMeasurementId.value = 'm1';
    await nextTick();
    expect(setSelection).toHaveBeenLastCalledWith('xeokit-measurement:m1');

    // 视口选中被其他来源接管（如用户尺寸）后，清空测量选中不应覆盖它。
    currentSelection = 'dimension-user-9';
    store.activeXeokitMeasurementId.value = null;
    await nextTick();
    expect(setSelection).not.toHaveBeenLastCalledWith(null);
    expect(currentSelection).toBe('dimension-user-9');

    tools.dispose();
  });

  describe('测量 hover 线框描边', () => {
    it('hover 命中构件时用 Edges 覆层描边整个构件，移出后清除', async () => {
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
      camera.position.set(0, 0, 2);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });
      Object.defineProperty(canvas, 'clientWidth', { value: 200 });
      Object.defineProperty(canvas, 'clientHeight', { value: 200 });

      const scene = new THREE.Scene();
      const triangle = new THREE.BufferGeometry();
      triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
      ]), 3));
      triangle.setIndex([0, 1, 2]);

      let surfaceHit: { objectId: string; point: THREE.Vector3 } | null = {
        objectId: 'o:24381_145018:0',
        point: new THREE.Vector3(0, 0, 0),
      };
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas, scene } as any),
        dtxLayerRef: ref({
          _totalObjects: 1,
          getGlobalModelMatrix: () => null,
          getObjectGeometryData: (objectId: string) => (
            objectId === 'o:24381_145018:0'
              ? { geometry: triangle, matrix: new THREE.Matrix4() }
              : null
          ),
          getAllObjectIds: () => ['o:24381_145018:0', 'o:24381_9:0'],
        } as any),
        selectionRef: ref({ pickPoint: vi.fn(() => surfaceHit) } as any),
        overlayContainerRef: ref(document.createElement('div')),
        store,
        compatViewerRef: ref(null),
        requestRender: null,
      });

      const overlayGroup = () => scene.children.find(
        (child) => child.name === 'DTXSelectionOverlay',
      );

      tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', {
        clientX: 100,
        clientY: 100,
      }));
      expect(overlayGroup()).toBeTruthy();
      expect(overlayGroup()!.children.length).toBe(1);
      expect(overlayGroup()!.children[0]!.name).toBe('sel_edge_o:24381_145018:0');

      // 移出模型（拾取不到表面）→ 描边清空。
      surfaceHit = null;
      tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', {
        clientX: 20,
        clientY: 20,
      }));
      expect(overlayGroup()!.children.length).toBe(0);

      tools.dispose();
    });
  });

  describe('测量 hover 关键点显示', () => {
    it('根构件自身无 P-Point 时回落直属子构件点集并渲染标记', async () => {
      vi.doMock('@/api/genModelPdmsAttrApi', () => ({
        pdmsGetPtsetWithContext: vi.fn(async (refno: string) => ({
          success: false,
          refno,
          ptset: [],
          world_transform: null,
          unit_info: null,
          error_message: 'BRAN 无 ptset',
        })),
        pdmsGetPtsetChildrenWithContext: vi.fn(async (refno: string) => ({
          success: true,
          refno,
          results: [
            {
              input_refno: '24381_145019',
              refno: '24381_145019',
              success: true,
              ptset: [
                {
                  number: 1,
                  pt: [0, 0, 0],
                  dir: [0, 0, 1],
                  dir_flag: 1,
                  ref_dir: [1, 0, 0],
                  pbore: 100,
                  pwidth: 0,
                  pheight: 0,
                  pconnect: 'BWD',
                },
              ],
              world_transform: null,
              unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
            },
          ],
          total_count: 1,
          success_count: 1,
          failed_count: 0,
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

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(0, 0, 2);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });
      const scene = new THREE.Scene();

      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas, scene } as any),
        dtxLayerRef: ref({
          _totalObjects: 1,
          getGlobalModelMatrix: () => null,
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

      tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', {
        clientX: 100,
        clientY: 100,
      }));

      const ptsetGroup = () => scene.children.find((child) => child.name === 'dtx-ptset');
      await vi.waitFor(() => {
        expect((ptsetGroup()?.children.length ?? 0)).toBeGreaterThan(0);
      }, { timeout: 3000 });

      tools.dispose();
      vi.doUnmock('@/api/genModelPdmsAttrApi');
    });
  });

  describe('E3D Measure Session（r5 P0）', () => {
    async function setupDistanceTools(input: {
      keepMeasurementAnnotation: boolean;
      showDirectLinearDimension?: boolean;
    }) {
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
      measurementStyle.updateStyle({
        keepMeasurementAnnotation: input.keepMeasurementAnnotation,
        showDirectLinearDimension: input.showDirectLinearDimension ?? true,
      });

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
      const pickPoint = vi.fn()
        .mockReturnValueOnce({ objectId: 'o:24381_145018:0', point: new THREE.Vector3(2, 4, 6) })
        .mockReturnValue({ objectId: 'o:24381_145018:0', point: new THREE.Vector3(2, 4, 6.5) });
      const dimensionSystem = {
        replaceExternalSource: vi.fn(),
        viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
      } as any;
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas } as any),
        dtxLayerRef: ref({
          _totalObjects: 1,
          getGlobalModelMatrix: () => globalModelMatrix.clone(),
        } as any),
        selectionRef: ref({ pickPoint } as any),
        overlayContainerRef: ref(document.createElement('div')),
        getDimensionSystem: () => dimensionSystem,
        store,
        compatViewerRef: ref(null),
        requestRender: null,
      });

      const click = () => tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', {
        clientX: 100,
        clientY: 100,
        button: 0,
      }));
      return { store, measurementStyle, dimensionSystem, tools, click };
    }

    it('statusText 分步命令提示：第 1/2 步 → 第 2/2 步（E3D `<命令> <步> (<拾取类型>) Snap :` 结构）', async () => {
      const { store, tools, click } = await setupDistanceTools({
        keepMeasurementAnnotation: true,
      });
      // E3D `EDGSTATE.prompt()`：括号里是拾取类型（缺省 Snap），尾巴的 Snap 是 Significant Snaps
      // 开着的标志，冒号后是当前 Snap 目标；拾取过滤器不进提示。
      expect(tools.statusText.value).toMatch(/^距离测量 · 第 1\/2 步 选择起点 \(Snap\) Snap : /);

      click();
      expect(store.currentXeokitDistanceDraft.value).not.toBeNull();
      expect(tools.statusText.value).toMatch(/^距离测量 · 第 2\/2 步 选择终点 \(Snap\) Snap : /);
      expect(tools.statusText.value).toContain('点空白取消当前点选');

      tools.dispose();
    });

    it('keepMeasurementAnnotation=false：第二击只产出临时结果，不落持久记录；空格 Repeat 以临时结果终点续测', async () => {
      const { store, dimensionSystem, tools, click } = await setupDistanceTools({
        keepMeasurementAnnotation: false,
      });
      click();
      click();

      expect(store.xeokitDistanceMeasurements.value).toHaveLength(0);
      const result = store.measurementDraftResult.value;
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('distance');
      expect(result!.persistedMeasurementId).toBeNull();
      expect(result!.wrt).toBe('world');
      // 设计坐标 delta = (0, 0, 0.5m)。
      expect(result!.distance).toBeCloseTo(0.5);
      expect(result!.offsets.components[2]).toBeCloseTo(0.5);
      expect(result!.direction!.vector[2]).toBeCloseTo(1);
      expect(result!.id).toBeTruthy();
      const records = dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1];
      // 单一正向轴向样本 + Show linear 开启：按 E3D golden G2-03 的
      // int(sum) ne int(length) 闸门只画直接斜线，不再叠一条重合的 U 分量。
      expect(records).toEqual([
        expect.objectContaining({
          id: `xeokit-measurement:${result!.id}`,
          layout: expect.objectContaining({ kind: 'linear' }),
        }),
      ]);

      // E3D Repeat：临时结果态下以 draftResult.target 为起点开新草稿。
      expect(tools.repeatLastDistanceMeasurement()).toBe(true);
      expect(store.currentXeokitDistanceDraft.value?.origin.worldPos)
        .toEqual(result!.target.worldPos);

      tools.dispose();
    });

    it('persistDraftResult 把临时结果落地为持久记录', async () => {
      const { store, tools, click } = await setupDistanceTools({
        keepMeasurementAnnotation: false,
      });
      click();
      click();
      expect(store.xeokitDistanceMeasurements.value).toHaveLength(0);

      expect(tools.persistDraftResult()).toBe(true);
      expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
      expect(store.measurementDraftResult.value?.persistedMeasurementId)
        .toBe(store.xeokitDistanceMeasurements.value[0]!.id);
      // 已落地后再次调用是 no-op。
      expect(tools.persistDraftResult()).toBe(false);

      tools.dispose();
    });

    it('keepMeasurementAnnotation=true（默认）：第二击保留记录且临时结果携带记录 id', async () => {
      const { store, tools, click } = await setupDistanceTools({
        keepMeasurementAnnotation: true,
      });
      click();
      click();

      expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
      const record = store.xeokitDistanceMeasurements.value[0]!;
      expect(store.measurementDraftResult.value?.persistedMeasurementId).toBe(record.id);
      expect(store.measurementDraftResult.value?.distance).toBeCloseTo(0.5);

      tools.dispose();
    });

    it('Show linear dimension 只切换直接斜线与 E3D 分解闸门，不改变结果或持久记录', async () => {
      const {
        store,
        measurementStyle,
        dimensionSystem,
        tools,
        click,
      } = await setupDistanceTools({
        keepMeasurementAnnotation: false,
        showDirectLinearDimension: true,
      });
      click();
      click();

      const result = store.measurementDraftResult.value!;
      expect(store.xeokitDistanceMeasurements.value).toHaveLength(0);
      // 样本 delta = (0, 0, +0.5m) 是单一正向轴向：Show linear 开启时 E3D
      // （golden G2-03，int(sum) eq int(length)）只画直接斜线。
      expect(dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1])
        .toEqual([
          expect.objectContaining({ id: `xeokit-measurement:${result.id}` }),
        ]);

      // Show linear 关闭 = E3D orthogonalOnly：直接斜线消失，正交分解必画（golden G2-02）。
      measurementStyle.updateStyle({ showDirectLinearDimension: false });
      tools.syncFromStore();
      expect(store.measurementDraftResult.value).toEqual(result);
      expect(store.xeokitDistanceMeasurements.value).toHaveLength(0);
      expect(dimensionSystem.replaceExternalSource)
        .toHaveBeenLastCalledWith('xeokit-measurement', [
          expect.objectContaining({
            id: worldDistanceAidChildId(`xeokit-measurement:${result.id}`, 'z'),
          }),
        ]);

      expect(tools.persistDraftResult()).toBe(true);
      expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
      tools.syncFromStore();
      expect(dimensionSystem.replaceExternalSource)
        .toHaveBeenLastCalledWith('xeokit-measurement', [
          expect.objectContaining({
            id: worldDistanceAidChildId(`xeokit-measurement:${result.id}`, 'z'),
          }),
        ]);

      measurementStyle.updateStyle({ showDirectLinearDimension: true });
      tools.syncFromStore();
      expect(store.xeokitDistanceMeasurements.value).toHaveLength(1);
      expect(dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1])
        .toEqual([
          expect.objectContaining({ id: `xeokit-measurement:${result.id}` }),
        ]);

      tools.dispose();
    });

    it('Perpendicular to：第二点无轴向/面几何时退化为点到点，结果表改读 Vertical / Horizontal（golden G4-03）', async () => {
      const { store, measurementStyle, dimensionSystem, tools, click } = await setupDistanceTools({
        keepMeasurementAnnotation: true,
      });
      measurementStyle.updateStyle({ perpendicularTo: true });
      click();
      click();

      const record = store.xeokitDistanceMeasurements.value[0]!;
      expect(record.perpendicular).toEqual({
        targetKind: 'point',
        targetLabel: '模型表面点',
      });
      // 点退化：target 就是第二个拾取点本身（design (12, 24, 36.5)，delta = (0, 0, +0.5m)）。
      expect(record.target.sourceInfo?.source).toBe('mesh_pick_point');
      expect(record.target.designWorldPos![0]).toBeCloseTo(12);
      expect(record.target.designWorldPos![1]).toBeCloseTo(24);
      expect(record.target.designWorldPos![2]).toBeCloseTo(36.5);
      const result = store.measurementDraftResult.value!;
      expect(result.perpendicular?.targetKind).toBe('point');
      expect(result.distance).toBeCloseTo(0.5);

      // 垂距记录不画 World 分量；Vertical 0.5 / Horizontal 0 → 腿也不画，只剩直接线。
      const records = dimensionSystem.replaceExternalSource.mock.calls.at(-1)?.[1];
      expect(records.map((item: { id: string }) => item.id)).toEqual([
        `xeokit-measurement:${record.id}`,
      ]);

      tools.dispose();
    });

    it('ESC 语义分层：草稿 → 临时结果 → 退出（reset 两段返回 true 后才 false）', async () => {
      const { store, tools, click } = await setupDistanceTools({
        keepMeasurementAnnotation: false,
      });
      click();
      // 第一段：取消进行中的草稿。
      expect(tools.reset()).toBe(true);
      expect(store.currentXeokitDistanceDraft.value).toBeNull();

      click();
      click();
      expect(store.measurementDraftResult.value).not.toBeNull();
      // 第二段：丢弃临时结果。
      expect(tools.reset()).toBe(true);
      expect(store.measurementDraftResult.value).toBeNull();
      // 第三段：无可清理，返回 false 由调用方退出模式。
      expect(tools.reset()).toBe(false);

      tools.dispose();
    });
  });
});
