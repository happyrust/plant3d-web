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

  describe('E3D 拾取层 · Graphics 过滤器 × Intersect 拾取类型（Phase A）', () => {
    /**
     * 场景：单位立方体，中心 (2, 4, 6)，正交相机在 (2, 4, 7) 朝 -Z 看，画布 200px ↔ 2 世界单位
     * （100 px / 单位）。+Z 面 z = 6.5 朝向相机；其四条棱是绘制边。`pickPoint` 返回 +Z 面上的命中点。
     */
    async function setupGraphicsTools() {
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
      measurementStyle.updateStyle({ keepMeasurementAnnotation: true });

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(2, 4, 7);
      camera.lookAt(2, 4, 6);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();

      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });

      // 单位立方体（6 面 × 2 三角形），顶点不焊接；场景坐标直接给，矩阵取单位阵。
      const positions: number[] = [];
      const indices: number[] = [];
      const quad = (a: number[], b: number[], c: number[], d: number[]) => {
        const base = positions.length / 3;
        positions.push(...a, ...b, ...c, ...d);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      const [x0, x1, y0, y1, z0, z1] = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
      quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
      quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
      quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      const topTriangle: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
        new THREE.Vector3(x0, y0, z1), new THREE.Vector3(x1, y0, z1), new THREE.Vector3(x1, y1, z1),
      ];

      const pickPoint = vi.fn((pos: { x: number; y: number }) => ({
        objectId: 'o:24381_145018:0',
        // 正交相机：画布 (px, py) ↔ 世界 (2 + (px-100)/100, 4 - (py-100)/100)，命中 +Z 面。
        point: new THREE.Vector3(2 + (pos.x - 100) / 100, 4 - (pos.y - 100) / 100, z1),
        distance: 0.5,
        triangle: topTriangle,
      }));
      const dimensionSystem = {
        replaceExternalSource: vi.fn(),
        viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
      } as any;
      const globalModelMatrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
      globalModelMatrix.setPosition(-10, -20, -30);
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas } as any),
        dtxLayerRef: ref({
          _totalObjects: 1,
          getGlobalModelMatrix: () => globalModelMatrix.clone(),
          getObjectGeometryData: () => ({ geometry, matrix: new THREE.Matrix4() }),
        } as any),
        selectionRef: ref({ pickPoint } as any),
        overlayContainerRef: ref(document.createElement('div')),
        getDimensionSystem: () => dimensionSystem,
        store,
        compatViewerRef: ref(null),
        requestRender: null,
      });

      const clickAt = (x: number, y: number) => tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', {
        clientX: x,
        clientY: y,
        button: 0,
      }));
      const hoverAt = (x: number, y: number) => tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', {
        clientX: x,
        clientY: y,
      }));
      return { store, measurementStyle, tools, clickAt, hoverAt };
    }

    it('Graphics 过滤器：靠近棱吸到边（Snap 取近端），面中央取面；Any 过滤器下 Graphics 细节一个都不参与', async () => {
      const { store, measurementStyle, tools, clickAt } = await setupGraphicsTools();
      measurementStyle.updateMeasurementPickLayer({ filter: 'graphics', pickType: 'exact' });
      await nextTick();
      expect(tools.statusText.value).toMatch(/\(Cursor\) Snap : 等待捕捉（网格边 \/ 面（Graphics））$/);

      // 画布 (148, 100) ↔ 世界 (2.48, 4) → 距棱 x = 2.5 仅 2 px：边候选，Cursor 取射线在边上的控制点。
      clickAt(148, 100);
      const draft = store.currentXeokitDistanceDraft.value!;
      expect(draft).not.toBeNull();
      expect(draft.origin.sourceInfo?.source).toBe('mesh_graphics');
      expect(draft.origin.sourceInfo?.candidateId).toMatch(/^graphics:o:24381_145018:0:edge:/);
      expect(draft.origin.worldPos[0]).toBeCloseTo(2.5, 6);
      expect(draft.origin.worldPos[1]).toBeCloseTo(4, 6);
      expect(draft.origin.worldPos[2]).toBeCloseTo(6.5, 6);

      // 面中央 (100, 100) ↔ (2, 4)：离所有棱 50 px，落到面候选，位置 = 射线 ∩ 平面 = 命中点。
      clickAt(100, 100);
      const record = store.xeokitDistanceMeasurements.value.at(-1)!;
      expect(record.target.sourceInfo?.candidateId).toMatch(/^graphics:o:24381_145018:0:facet:/);
      expect(record.target.worldPos).toEqual([2, 4, 6.5]);

      // Any 过滤器（E3D stdAny）：Graphics 细节不放行，同一击只剩没开捕捉的表面点 → 不落点。
      store.clearCurrentXeokitDraft();
      measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'snap' });
      await nextTick();
      clickAt(148, 100);
      expect(store.currentXeokitDistanceDraft.value).toBeNull();
      expect(tools.pickPointMessage.value).toBeTruthy();

      tools.dispose();
    });

    it('Intersect：两条棱（线 × 线）两次子拾取求出角点作为测量点；提示 Intersection[1]→[2]，Esc 先放弃子拾取', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAt } = await setupGraphicsTools();
      measurementStyle.updateMeasurementPickLayer({ filter: 'graphics', pickType: 'intersect' });
      await nextTick();
      expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');

      // 子拾取 1：棱 x = 2.5（沿 Y）。不落测量点，只记下这条线。
      clickAt(148, 100);
      expect(store.currentXeokitDistanceDraft.value).toBeNull();
      expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
      expect(tools.pickPointMessage.value).toContain('求交已选 1.');
      expect(tools.pickPointMessage.value).toContain('Intersection[2]');

      // 悬停到棱 y = 4.5（沿 X）：预览交点 (2.5, 4.5, 6.5)。
      hoverAt(100, 52);
      expect(tools.hoverSnapTarget.value?.label).toBe('交点（预览）');

      // 平行棱（x = 1.5，沿 Y）→ E3D (2,870)，第一条线保留。
      clickAt(52, 100);
      expect(store.currentXeokitDistanceDraft.value).toBeNull();
      expect(tools.pickPointMessage.value).toContain('2,870');
      expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');

      // 子拾取 2：棱 y = 4.5 → 交点 = 角点 (2.5, 4.5, 6.5) 成为起点。
      clickAt(100, 52);
      const draft = store.currentXeokitDistanceDraft.value!;
      expect(draft).not.toBeNull();
      expect(draft.origin.worldPos[0]).toBeCloseTo(2.5, 6);
      expect(draft.origin.worldPos[1]).toBeCloseTo(4.5, 6);
      expect(draft.origin.worldPos[2]).toBeCloseTo(6.5, 6);
      expect(draft.origin.sourceInfo?.label).toBe('交点');
      expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');

      // 第二个测量点也走求交：先选一条棱，Esc 只放弃这次子拾取（草稿保留），再 Esc 才取消草稿。
      clickAt(148, 100);
      expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
      expect(tools.reset()).toBe(true);
      expect(store.currentXeokitDistanceDraft.value).not.toBeNull();
      expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');
      expect(tools.reset()).toBe(true);
      expect(store.currentXeokitDistanceDraft.value).toBeNull();

      tools.dispose();
    });

    it('Intersect：面 × 面要第三次子拾取（Intersection[3]）；面中的线与面平行被拒且不消耗', async () => {
      const { store, measurementStyle, tools, clickAt } = await setupGraphicsTools();
      measurementStyle.updateMeasurementPickLayer({ filter: 'graphics', pickType: 'intersect' });
      await nextTick();

      // 只有 +Z 面可见：面 × 面 = 同一平面重复两次 → 需要第三项。
      clickAt(100, 100);
      expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
      clickAt(110, 110);
      expect(tools.statusText.value).toContain('(Intersection[3]) Snap :');
      // 第三项选 +Z 面上的棱：线在两个面里 → 无唯一交点（E3D 2,874），整个会话清空。
      clickAt(148, 100);
      expect(store.currentXeokitDistanceDraft.value).toBeNull();
      expect(tools.pickPointMessage.value).toContain('2,874');
      expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');

      // 换拾取类型即放弃进行中的子拾取。
      clickAt(100, 100);
      expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
      measurementStyle.updateMeasurementPickLayer({ pickType: 'snap' });
      await nextTick();
      expect(tools.statusText.value).toContain('(Snap) Snap :');
      measurementStyle.updateMeasurementPickLayer({ pickType: 'intersect' });
      await nextTick();
      expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');

      tools.dispose();
    });
  });

  describe('E3D 拾取层 · TUBING 轴线（Phase A，前端从直管放置矩阵派生）', () => {
    /**
     * 场景：gen-model 单位直管（局部 z ∈ [0, 1]，半径 ½）经放置矩阵 T·R·S 摆到场景里：
     * 轴线从 (1.4, 4, 6) 沿 +X 到 (2.6, 4, 6)，外径 0.4。正交相机在 (2, 4, 7) 朝 −Z 看，
     * 画布 200 px ↔ 2 世界单位（100 px / 单位）：轴线落在 py = 100、px ∈ [40, 160]。
     * `pickPoint` 返回管顶面上的命中点（z = 6.2）；`isTubingObject` 只认这个对象。
     */
    async function setupTubingTools() {
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
      measurementStyle.updateStyle({ keepMeasurementAnnotation: true });

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(2, 4, 7);
      camera.lookAt(2, 4, 6);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();

      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });

      // 单位直管的局部几何只用到包围盒：min (−½, −½, 0) / max (½, ½, 1)。
      const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
      const placement = new THREE.Matrix4().compose(
        new THREE.Vector3(1.4, 4, 6),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
        new THREE.Vector3(0.4, 0.4, 1.2),
      );
      const tubeObjectId = 'o:24381_145018:3';

      const pickPoint = vi.fn((pos: { x: number; y: number }) => ({
        objectId: tubeObjectId,
        point: new THREE.Vector3(2 + (pos.x - 100) / 100, 4 - (pos.y - 100) / 100, 6.2),
        distance: 0.8,
      }));
      const dimensionSystem = {
        replaceExternalSource: vi.fn(),
        viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
      } as any;
      const globalModelMatrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
      globalModelMatrix.setPosition(-10, -20, -30);
      const getObjectGeometryData = vi.fn((objectId: string) => (
        objectId === tubeObjectId ? { geometry, matrix: placement.clone() } : null
      ));
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas } as any),
        dtxLayerRef: ref({
          _totalObjects: 1,
          getGlobalModelMatrix: () => globalModelMatrix.clone(),
          getObjectGeometryData,
        } as any),
        selectionRef: ref({ pickPoint } as any),
        overlayContainerRef: ref(document.createElement('div')),
        getDimensionSystem: () => dimensionSystem,
        store,
        compatViewerRef: ref(null),
        requestRender: null,
        isTubingObject: (objectId) => objectId === tubeObjectId,
      });

      const clickAt = (x: number, y: number) => tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', {
        clientX: x,
        clientY: y,
        button: 0,
      }));
      const hoverAt = (x: number, y: number) => tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', {
        clientX: x,
        clientY: y,
      }));
      return { store, measurementStyle, tools, clickAt, hoverAt, getObjectGeometryData };
    }

    it('Any × Snap：光标落在直管上即拾到轴线（EDGTUBING.snap 取近端）；Cursor 取轴线上离射线最近处；Mid-Point 取中点', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAt } = await setupTubingTools();
      expect(tools.statusText.value).toMatch(/\(Snap\) Snap : 等待捕捉（管身轴线（TUBING））$/);

      // 画布 (140, 92) ↔ 管面 (2.4, 4.08)：离轴线 8 px，射线命中直管 → 轴线候选；标签裸给「轴线」，noun 由命令条补。
      hoverAt(140, 92);
      expect(tools.hoverSnapTarget.value?.label).toBe('轴线 · Snap');

      // Snap：控制点 (2.4, 4, 6) 更靠近终点 (2.6, 4, 6) → 落终点。
      clickAt(140, 92);
      const draft = store.currentXeokitDistanceDraft.value!;
      expect(draft).not.toBeNull();
      expect(draft.origin.sourceInfo?.source).toBe('tubing_axis');
      expect(draft.origin.sourceInfo?.candidateId).toBe('tubing:o:24381_145018:3');
      expect(draft.origin.worldPos[0]).toBeCloseTo(2.6, 6);
      expect(draft.origin.worldPos[1]).toBeCloseTo(4, 6);
      expect(draft.origin.worldPos[2]).toBeCloseTo(6, 6);
      store.clearCurrentXeokitDraft();

      // Cursor（EDGTUBING.exact）：轴线上离射线最近处 (2.4, 4, 6)，不是管面命中点。
      measurementStyle.updateMeasurementPickLayer({ pickType: 'exact' });
      await nextTick();
      clickAt(140, 92);
      const exact = store.currentXeokitDistanceDraft.value!;
      expect(exact.origin.worldPos[0]).toBeCloseTo(2.4, 6);
      expect(exact.origin.worldPos[1]).toBeCloseTo(4, 6);
      expect(exact.origin.worldPos[2]).toBeCloseTo(6, 6);
      store.clearCurrentXeokitDraft();

      // Mid-Point（GMFLINE.proportion 0.5）：轴线中点 (2, 4, 6)。
      measurementStyle.updateMeasurementPickLayer({ pickType: 'midpoint' });
      await nextTick();
      clickAt(140, 92);
      const mid = store.currentXeokitDistanceDraft.value!;
      expect(mid.origin.worldPos[0]).toBeCloseTo(2, 6);
      expect(mid.origin.worldPos[1]).toBeCloseTo(4, 6);
      expect(mid.origin.worldPos[2]).toBeCloseTo(6, 6);

      tools.dispose();
    });

    it('Pline / Ppoint / Graphics 过滤器不放行 TUBING（E3D 只在 Element 类拾取模式回 TUBING）；Element 放行', async () => {
      const { store, measurementStyle, tools, clickAt, getObjectGeometryData } = await setupTubingTools();

      for (const filter of ['pline', 'ppoint', 'graphics'] as const) {
        store.clearCurrentXeokitDraft();
        measurementStyle.updateMeasurementPickLayer({ filter, pickType: 'snap' });
        await nextTick();
        getObjectGeometryData.mockClear();
        clickAt(140, 92);
        expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo?.source ?? null, filter).not.toBe('tubing_axis');
        // 不放行时连轴线都不派生（过滤器管准入，先于几何分析）；Graphics 过滤器下读几何的是网格边 / 面分析，不在此列。
        if (filter !== 'graphics') expect(getObjectGeometryData, filter).not.toHaveBeenCalled();
      }

      measurementStyle.updateMeasurementPickLayer({ filter: 'element', pickType: 'snap' });
      await nextTick();
      clickAt(140, 92);
      expect(store.currentXeokitDistanceDraft.value?.origin.sourceInfo?.source).toBe('tubing_axis');

      tools.dispose();
    });

    /**
     * ATTA 处断开的两段直管：A 从 (1.4, 4, 6) 到 (2.0, 4, 6)，B 从 (2.0, 4, 6) 到 (2.6, 4, 6)，同一 BRAN、共线、
     * 在 (2.0, 4, 6) 端点相接。BRAN 自身无 P-Point，成员点集（legacy 源 `/api/pdms/ptset/children` 形状）给
     * ELBO 145019 P2 = A 起点、结点构件 145020（ATTA 或 OLET）P1 = P2 = 相接点、ELBO 145021 P1 = B 终点。
     * 相机 / 画布同 `setupTubingTools`：px = 100 + (x − 2) × 100。
     */
    async function setupSplitTubingTools(junctionNoun: 'ATTA' | 'OLET') {
      vi.useFakeTimers();
      const branRefno = '24381_145018';
      // 场景 = 0.001 × 设计(mm) + (−10, −20, −30)：设计 mm = (场景 − 平移) / 0.001。
      const designMm = (scene: readonly [number, number, number]): [number, number, number] => [
        (scene[0] + 10) / 0.001,
        (scene[1] + 20) / 0.001,
        (scene[2] + 30) / 0.001,
      ];
      const ptsetPoint = (number: number, scene: readonly [number, number, number]) => ({
        number,
        pt: designMm(scene),
        dir: null,
        dir_flag: 0,
        ref_dir: null,
        pbore: 114.3,
        pwidth: 0,
        pheight: 0,
        pconnect: '',
      });
      const unitInfo = { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 };
      const noPoints = (refno: string) => ({
        success: false,
        refno,
        ptset: [],
        world_transform: null,
        unit_info: unitInfo,
        error_code: 'PTSET_POINTS_MISSING',
        error_message: 'BRAN 自身无 P-Point',
      });
      vi.doMock('@/composables/useDbMetaInfo', () => ({
        getDbnumByRefno: vi.fn(() => 7997),
      }));
      vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
        getDtxRefnoTransform: vi.fn(() => null),
      }));
      vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
        useDbnoInstancesParquetLoader: () => ({
          queryPtsetByRefnoFromParquet: vi.fn(async (_dbno: number, refno: string) => noPoints(refno)),
        }),
      }));
      vi.doMock('@/api/genModelPdmsAttrApi', () => ({
        pdmsGetPtsetWithContext: vi.fn(async (refno: string) => noPoints(refno)),
        pdmsGetPtsetChildrenWithContext: vi.fn(async () => {
          const results = [
            { refno: '24381_145019', noun: 'ELBO', ptset: [ptsetPoint(1, [1.4, 3.7, 6]), ptsetPoint(2, [1.4, 4, 6])] },
            { refno: '24381_145020', noun: junctionNoun, ptset: [ptsetPoint(3, [2.0, 4, 6.0457]), ptsetPoint(2, [2.0, 4, 6]), ptsetPoint(1, [2.0, 4, 6])] },
            { refno: '24381_145021', noun: 'ELBO', ptset: [ptsetPoint(1, [2.6, 4, 6]), ptsetPoint(2, [2.6, 4.3, 6])] },
          ].map((item) => ({
            input_refno: item.refno,
            refno: item.refno,
            noun: item.noun,
            success: true,
            ptset: item.ptset,
            world_transform: null,
            unit_info: unitInfo,
            error_message: null,
          }));
          return {
            success: true,
            refno: branRefno,
            results,
            total_count: results.length,
            success_count: results.length,
            failed_count: 0,
            error_message: null,
          };
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
      // 要拉成员点集（端点校正 / 认 ATTA），但 1 px 孔径让 P-Point 不在悬停处抢吸附。
      measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: true, thresholdPx: 1 });
      measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
      measurementStyle.updateStyle({ keepMeasurementAnnotation: true });

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(2, 4, 7);
      camera.lookAt(2, 4, 6);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });

      const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
      const alongX = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
      const pieceA = `o:${branRefno}:3`;
      const pieceB = `o:${branRefno}:4`;
      const placements: Record<string, THREE.Matrix4> = {
        [pieceA]: new THREE.Matrix4().compose(new THREE.Vector3(1.4, 4, 6), alongX, new THREE.Vector3(0.4, 0.4, 0.6)),
        [pieceB]: new THREE.Matrix4().compose(new THREE.Vector3(2.0, 4, 6), alongX, new THREE.Vector3(0.4, 0.4, 0.6)),
      };
      const pickPoint = vi.fn((pos: { x: number; y: number }) => {
        const x = 2 + (pos.x - 100) / 100;
        return { objectId: x < 2 ? pieceA : pieceB, point: new THREE.Vector3(x, 4 - (pos.y - 100) / 100, 6.2), distance: 0.8 };
      });
      const globalModelMatrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
      globalModelMatrix.setPosition(-10, -20, -30);
      const getObjectGeometryData = vi.fn((objectId: string) => (
        placements[objectId] ? { geometry, matrix: placements[objectId]!.clone() } : null
      ));
      const listTubingObjectIds = vi.fn((refno: string) => (refno === branRefno ? [pieceA, pieceB] : []));
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
        dtxLayerRef: ref({
          _totalObjects: 2,
          getGlobalModelMatrix: () => globalModelMatrix.clone(),
          getObjectGeometryData,
        } as any),
        selectionRef: ref({ pickPoint } as any),
        overlayContainerRef: ref(document.createElement('div')),
        getDimensionSystem: () => ({
          replaceExternalSource: vi.fn(),
          viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
        }) as any,
        store,
        compatViewerRef: ref(null),
        requestRender: null,
        isTubingObject: (objectId) => objectId === pieceA || objectId === pieceB,
        listTubingObjectIds,
      });

      const hoverAt = (x: number, y: number) => tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', { clientX: x, clientY: y }));
      const clickAt = (x: number, y: number) => tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
      // 悬停一次触发 BRAN 点集拉取（80 ms 防抖 → BRAN 无点 → 成员点集落缓存）。
      hoverAt(125, 92);
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      return { store, measurementStyle, tools, hoverAt, clickAt, getObjectGeometryData, listTubingObjectIds, pieceA, pieceB };
    }

    it('ATTA 处断开的两段直管合成一条轴线（EDGTUBING.line 跳 ATTA）：Snap 近端越过 ATTA 取远端 ELBO，Mid-Point 是合并后的中点，标签两端都是 ELBO', async () => {
      const { store, measurementStyle, tools, hoverAt, clickAt, getObjectGeometryData, listTubingObjectIds, pieceA, pieceB } = await setupSplitTubingTools('ATTA');
      try {
        // 悬停 B 段 x = 2.25：只看 B 段时近端是 ATTA (2.0)；合并后轴线 1.4 → 2.6，近端是 2.6 的 ELBO。
        hoverAt(125, 92);
        expect(tools.hoverSnapTarget.value?.label).toBe('轴线（ELBO P-Point #2 → ELBO P-Point #1） · Snap');
        expect(listTubingObjectIds).toHaveBeenCalledWith('24381_145018');
        // 两段的几何都读过（拾中段 + 同构件另一段）。
        expect(getObjectGeometryData).toHaveBeenCalledWith(pieceA);
        expect(getObjectGeometryData).toHaveBeenCalledWith(pieceB);

        clickAt(125, 92);
        const snap = store.currentXeokitDistanceDraft.value!;
        expect(snap.origin.sourceInfo?.source).toBe('tubing_axis');
        expect(snap.origin.sourceInfo?.candidateId).toBe(`tubing:${pieceB}`);
        expect(snap.origin.worldPos[0]).toBeCloseTo(2.6, 6);
        expect(snap.origin.worldPos[1]).toBeCloseTo(4, 6);
        store.clearCurrentXeokitDraft();

        // Mid-Point：合并后中点 x = 2.0（恰是 ATTA 位置），不是 B 段自己的中点 2.3。
        measurementStyle.updateMeasurementPickLayer({ pickType: 'midpoint' });
        await nextTick();
        clickAt(125, 92);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(2.0, 6);
        store.clearCurrentXeokitDraft();

        // 从 A 段进来也是同一条线：Mid-Point 仍是 2.0；Snap 在 x = 1.75 取 1.4 的 ELBO。
        clickAt(75, 92);
        expect(store.currentXeokitDistanceDraft.value!.origin.sourceInfo?.candidateId).toBe(`tubing:${pieceA}`);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(2.0, 6);
        store.clearCurrentXeokitDraft();
        measurementStyle.updateMeasurementPickLayer({ pickType: 'snap' });
        await nextTick();
        clickAt(75, 92);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(1.4, 6);
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });

    /**
     * 元素当 Intersect / Perpendicular 操作数（E3D `edgTypes.attribute(noun).line()` = P1 → P2）：
     * CYLI A 轴 P1 (1, 4, 6) → P2 (3, 4, 6)（沿 +X），CYLI B 轴 P1 (2, 3, 6) → P2 (2, 5, 6)（沿 +Y），ELBO C 只有 arc、无 line()。
     * 表面命中点都不在轴上（A：y = 4.15、B：x = 2.15，z = 6.2）。相机 / 画布同 `setupTubingTools`。
     */
    async function setupElementLineTools() {
      vi.useFakeTimers();
      const refnoA = '24381_200001';
      const refnoB = '24381_200002';
      const refnoC = '24381_200003';
      // D：gen-model-v1 下的 CYLI 设计基本体——element/ptset 无点，只有单位圆柱实例几何；轴 (2.6, 3, 6) → (2.6, 5, 6)。
      const refnoD = '24381_200004';
      // E：CONE 设计基本体——无点，局部帧烘好的网格（截面对中、z ∓ HEIG/2）× 放置矩阵；轴 (1.4, 3, 6) → (1.4, 5, 6)。
      const refnoE = '24381_200005';
      // F：noun 也是 CONE，但几何烘在世界帧（包围盒不对中、矩阵单位）——不是基本体局部帧，不派生。
      const refnoF = '24381_200006';
      const nounByRefno: Record<string, string> = {
        [refnoA]: 'CYLI', [refnoB]: 'CYLI', [refnoC]: 'ELBO', [refnoD]: 'CYLI', [refnoE]: 'CONE', [refnoF]: 'CONE',
      };
      const designMm = (scene: readonly [number, number, number]): [number, number, number] => [
        (scene[0] + 10) / 0.001,
        (scene[1] + 20) / 0.001,
        (scene[2] + 30) / 0.001,
      ];
      const ptsetPoint = (number: number, scene: readonly [number, number, number]) => ({
        number,
        pt: designMm(scene),
        dir: null,
        dir_flag: 0,
        ref_dir: null,
        pbore: 100,
        pwidth: 0,
        pheight: 0,
        pconnect: '',
      });
      const ptsetByRefno: Record<string, ReturnType<typeof ptsetPoint>[]> = {
        [refnoA]: [ptsetPoint(1, [1, 4, 6]), ptsetPoint(2, [3, 4, 6])],
        [refnoB]: [ptsetPoint(1, [2, 3, 6]), ptsetPoint(2, [2, 5, 6])],
        [refnoC]: [ptsetPoint(1, [1.2, 3.4, 6]), ptsetPoint(2, [1.4, 3.2, 6])],
        [refnoD]: [],
        [refnoE]: [],
        [refnoF]: [],
      };
      vi.doMock('@/composables/useDbMetaInfo', () => ({
        getDbnumByRefno: vi.fn(() => 7997),
      }));
      vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
        getDtxRefnoTransform: vi.fn(() => null),
        resolveDtxNounByRefno: vi.fn((_dbno: number, refno: string) => nounByRefno[refno] ?? null),
      }));
      vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
        useDbnoInstancesParquetLoader: () => ({
          queryPtsetByRefnoFromParquet: vi.fn(async (_dbno: number, refno: string) => {
            const ptset = ptsetByRefno[refno] ?? [];
            return {
              success: ptset.length > 0,
              refno,
              noun: nounByRefno[refno] ?? null,
              ptset,
              world_transform: null,
              unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
              error_code: ptset.length > 0 ? null : 'PTSET_POINTS_MISSING',
              error_message: ptset.length > 0 ? null : '设计基本体没有目录 P 点',
            };
          }),
        }),
      }));
      vi.doMock('@/api/genModelPdmsAttrApi', () => ({
        pdmsGetPtsetWithContext: vi.fn(async (refno: string) => ({
          success: false, refno, ptset: [], world_transform: null, unit_info: null, error_code: 'PTSET_POINTS_MISSING', error_message: '无点',
        })),
        pdmsGetPtsetChildrenWithContext: vi.fn(async (refno: string) => ({
          success: false, refno, results: [], total_count: 0, success_count: 0, failed_count: 0, error_message: '无子构件点集',
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
      measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: true, thresholdPx: 1 });
      measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
      // 表面点是「拾元素本身」在 Web 的替身，要开着才有元素拾取可转成 line()。
      measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: true, snap: true, thresholdPx: 20 });
      measurementStyle.updateStyle({ keepMeasurementAnnotation: true });

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(2, 4, 7);
      camera.lookAt(2, 4, 6);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });
      // 画布 → 场景：x = 2 + (px − 100) / 100，y = 4 − (py − 100) / 100。
      // A 占 y ≈ 4 的横带，B 占 x ≈ 2 的竖带，D 占 x ≈ 2.6 的竖带，E 占 x ≈ 1.4 的竖带，F 占 x ≈ 2.85 的竖带，C 在左下。
      const pickPoint = vi.fn((pos: { x: number; y: number }) => {
        const x = 2 + (pos.x - 100) / 100;
        const y = 4 - (pos.y - 100) / 100;
        if (Math.abs(pos.y - 100) <= 20 && pos.x > 105 && pos.x < 150) return { objectId: `o:${refnoA}:0`, point: new THREE.Vector3(x, 4.15, 6.2), distance: 0.8 };
        if (Math.abs(pos.x - 100) <= 20 && pos.y < 95) return { objectId: `o:${refnoB}:0`, point: new THREE.Vector3(2.15, y, 6.2), distance: 0.8 };
        if (Math.abs(pos.x - 160) <= 15 && pos.y < 95) return { objectId: `o:${refnoD}:0`, point: new THREE.Vector3(2.75, y, 6.2), distance: 0.8 };
        if (Math.abs(pos.x - 40) <= 15 && pos.y < 95) return { objectId: `o:${refnoE}:0`, point: new THREE.Vector3(1.45, y, 6.2), distance: 0.8 };
        if (Math.abs(pos.x - 185) <= 10 && pos.y < 95) return { objectId: `o:${refnoF}:0`, point: new THREE.Vector3(2.85, y, 6.2), distance: 0.8 };
        if (pos.x < 60 && pos.y > 140) return { objectId: `o:${refnoC}:0`, point: new THREE.Vector3(x, y, 6.2), distance: 0.8 };
        return null;
      });
      const globalModelMatrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
      globalModelMatrix.setPosition(-10, -20, -30);
      // D 的 DTX 几何：gen-model 单位圆柱（半径 1、z ∈ [0, 1]）× 放置矩阵 T(2.6, 3, 6)·R(z→+y)·S(0.15, 0.15, 2)。
      const unitCylinder = new THREE.BoxGeometry(2, 2, 1).translate(0, 0, 0.5);
      const placementD = new THREE.Matrix4().compose(
        new THREE.Vector3(2.6, 3, 6),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)),
        new THREE.Vector3(0.15, 0.15, 2),
      );
      // E 的 DTX 几何：gen_snout 局部帧（截面对中、z ∈ ∓0.1）× 放置矩阵 T(1.4, 4, 6)·R(z→+y)·S(1, 1, 10) → 轴 y ∈ [3, 5]。
      const localCone = new THREE.BoxGeometry(0.1, 0.1, 0.2);
      const placementE = new THREE.Matrix4().compose(
        new THREE.Vector3(1.4, 4, 6),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)),
        new THREE.Vector3(1, 1, 10),
      );
      // F 的 DTX 几何：烘在世界帧的实体（包围盒 [5, 5, 5] → [6, 6, 7]）、单位矩阵。
      const worldBaked = new THREE.BoxGeometry(1, 1, 2).translate(5.5, 5.5, 6);
      const getObjectGeometryData = vi.fn((objectId: string) => {
        if (objectId === `o:${refnoD}:0`) return { geometry: unitCylinder, matrix: placementD.clone() };
        if (objectId === `o:${refnoE}:0`) return { geometry: localCone, matrix: placementE.clone() };
        if (objectId === `o:${refnoF}:0`) return { geometry: worldBaked, matrix: new THREE.Matrix4() };
        return null;
      });
      const dimensionSystem = {
        replaceExternalSource: vi.fn(),
        viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
      } as any;
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
        dtxLayerRef: ref({
          _totalObjects: 4,
          getGlobalModelMatrix: () => globalModelMatrix.clone(),
          getObjectGeometryData,
        } as any),
        selectionRef: ref({ pickPoint } as any),
        overlayContainerRef: ref(document.createElement('div')),
        getDimensionSystem: () => dimensionSystem,
        store,
        compatViewerRef: ref(null),
        requestRender: null,
        isTubingObject: () => false,
      });
      const hoverAt = (x: number, y: number) => tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', { clientX: x, clientY: y }));
      const clickAt = (x: number, y: number) => tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
      /** 悬停到某元素并等它的点集落缓存（80 ms 防抖）。 */
      const hoverAndLoad = async (x: number, y: number) => {
        hoverAt(x, y);
        await vi.advanceTimersByTimeAsync(200);
        await Promise.resolve();
        hoverAt(x, y);
      };
      return { store, measurementStyle, tools, hoverAt, clickAt, hoverAndLoad, getObjectGeometryData, refnoA, refnoB, refnoC, refnoD, refnoE, refnoF };
    }

    it('Intersect：拾中 CYLI 元素（表面点）按 E3D line() 当 P1 → P2 线求交，Any 与 Element 过滤器都成；ELBO 无 line() 被拒不消耗；无点的 CYLI / CONE 用局部几何', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAndLoad, getObjectGeometryData, refnoD, refnoE, refnoF } = await setupElementLineTools();
      try {
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'intersect' });
        await nextTick();
        expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');

        // 子拾取 1：CYLI A 表面 (2.4, 4.15, 6.2) → 操作数 = A 的轴 (1,4,6) → (3,4,6)，标签是元素轴线而不是表面点。
        await hoverAndLoad(140, 100);
        clickAt(140, 100);
        expect(store.currentXeokitDistanceDraft.value).toBeNull();
        expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
        expect(tools.pickPointMessage.value).toContain('1. CYLI 轴线（P1 → P2）（线）');

        // 子拾取 2：CYLI B 表面 (2.15, 4.6, 6.2) → B 的轴 x = 2、z = 6 沿 +Y；交点 (2, 4, 6)，不是两个表面点。
        await hoverAndLoad(100, 40);
        expect(tools.hoverSnapTarget.value?.label).toBe('交点（预览）');
        clickAt(100, 40);
        const draft = store.currentXeokitDistanceDraft.value!;
        expect(draft).not.toBeNull();
        expect(draft.origin.worldPos[0]).toBeCloseTo(2, 6);
        expect(draft.origin.worldPos[1]).toBeCloseTo(4, 6);
        expect(draft.origin.worldPos[2]).toBeCloseTo(6, 6);
        expect(draft.origin.sourceInfo?.label).toBe('交点');
        expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');
        store.clearCurrentXeokitDraft();

        // ELBO 只有 arc()：E3D「Unable to convert item into a line or plane」，拒收且不消耗这一击。
        await hoverAndLoad(40, 160);
        clickAt(40, 160);
        expect(store.currentXeokitDistanceDraft.value).toBeNull();
        expect(tools.pickPointMessage.value).toContain('无法转成线 / 面');
        expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');

        // Element 过滤器 × Intersect：表面点本不放行，但元素有 line() 时这一击就是元素拾取 → 同样求出 (2, 4, 6)。
        measurementStyle.updateMeasurementPickLayer({ filter: 'element', pickType: 'intersect' });
        await nextTick();
        clickAt(140, 100);
        expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
        clickAt(100, 40);
        const elementDraft = store.currentXeokitDistanceDraft.value!;
        expect(elementDraft.origin.worldPos[0]).toBeCloseTo(2, 6);
        expect(elementDraft.origin.worldPos[1]).toBeCloseTo(4, 6);
        expect(elementDraft.origin.worldPos[2]).toBeCloseTo(6, 6);
        store.clearCurrentXeokitDraft();

        // Snap 不受影响：Element × Snap 拾 CYLI 表面既不落轴线端点也不成线（E3D 回落元素原点；这里无原点候选 → 无捕捉）。
        measurementStyle.updateMeasurementPickLayer({ filter: 'element', pickType: 'snap' });
        await nextTick();
        clickAt(140, 100);
        expect(store.currentXeokitDistanceDraft.value).toBeNull();

        // gen-model-v1 的 CYLI 设计基本体没有 ptset 点：用它在 DTX 里的单位圆柱实例轴线（局部包围盒 × 放置矩阵）当 P1 → P2。
        // A（ptset 线）× D（几何线 x = 2.6，沿 +Y）→ (2.6, 4, 6)。
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'intersect' });
        await nextTick();
        clickAt(140, 100);
        expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
        await hoverAndLoad(160, 40);
        clickAt(160, 40);
        const geometryDraft = store.currentXeokitDistanceDraft.value!;
        expect(geometryDraft).not.toBeNull();
        expect(getObjectGeometryData).toHaveBeenCalledWith(`o:${refnoD}:0`);
        expect(geometryDraft.origin.worldPos[0]).toBeCloseTo(2.6, 6);
        expect(geometryDraft.origin.worldPos[1]).toBeCloseTo(4, 6);
        expect(geometryDraft.origin.worldPos[2]).toBeCloseTo(6, 6);
        store.clearCurrentXeokitDraft();

        // CONE 设计基本体（局部帧烘好的网格，截面对中、z ∓ HEIG/2）同样用局部 z 向包围盒当 P1 → P2：A × E（x = 1.4，沿 +Y）→ (1.4, 4, 6)。
        clickAt(140, 100);
        expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
        await hoverAndLoad(40, 40);
        expect(tools.hoverSnapTarget.value?.label).toBe('交点（预览）');
        clickAt(40, 40);
        const coneDraft = store.currentXeokitDistanceDraft.value!;
        expect(coneDraft).not.toBeNull();
        expect(getObjectGeometryData).toHaveBeenCalledWith(`o:${refnoE}:0`);
        expect(coneDraft.origin.worldPos[0]).toBeCloseTo(1.4, 6);
        expect(coneDraft.origin.worldPos[1]).toBeCloseTo(4, 6);
        expect(coneDraft.origin.worldPos[2]).toBeCloseTo(6, 6);
        store.clearCurrentXeokitDraft();

        // noun 是 CONE 但几何烘在世界帧（包围盒不对中）：不是基本体局部帧，不派生 → 拒收不消耗。
        clickAt(140, 100);
        expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
        await hoverAndLoad(185, 40);
        clickAt(185, 40);
        expect(store.currentXeokitDistanceDraft.value).toBeNull();
        expect(getObjectGeometryData).toHaveBeenCalledWith(`o:${refnoF}:0`);
        expect(tools.pickPointMessage.value).toContain('无法转成线 / 面');
        expect(tools.statusText.value).toContain('(Intersection[2]) Snap :');
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });

    it('表面点源关着（无任何候选）时，Intersect / Perpendicular 下拾中元素仍按 E3D ELEMENT 拾取转成 P1 → P2 线；Snap 下不会', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAndLoad } = await setupElementLineTools();
      try {
        measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: false, snap: false });
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'snap' });
        await nextTick();
        // Snap：没有候选 → 没有测量点（E3D 回落元素原点，这里原点源也关着）。
        await hoverAndLoad(140, 100);
        clickAt(140, 100);
        expect(store.currentXeokitDistanceDraft.value).toBeNull();

        // Intersect：光标落在 CYLI 上就是元素拾取 → line()。
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'intersect' });
        await nextTick();
        await hoverAndLoad(140, 100);
        expect(tools.hoverSnapTarget.value?.label).toBe('轴线（P1 → P2）');
        clickAt(140, 100);
        expect(tools.pickPointMessage.value).toContain('1. CYLI 轴线（P1 → P2）（线）');
        await hoverAndLoad(100, 40);
        clickAt(100, 40);
        const draft = store.currentXeokitDistanceDraft.value!;
        expect(draft.origin.worldPos[0]).toBeCloseTo(2, 6);
        expect(draft.origin.worldPos[1]).toBeCloseTo(4, 6);
        store.clearCurrentXeokitDraft();

        // Ppoint 过滤器不是元素类拾取：不转线，照旧拒收。
        measurementStyle.updateMeasurementPickLayer({ filter: 'ppoint', pickType: 'intersect' });
        await nextTick();
        clickAt(140, 100);
        expect(tools.statusText.value).toContain('(Intersection[1]) Snap :');
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });

    it('Perpendicular to：第二点拾中 CYLI 元素（表面点）时目标线是它的 P1 → P2（过 P1，不过表面点），垂足落在轴上', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAndLoad } = await setupElementLineTools();
      try {
        measurementStyle.updateStyle({ perpendicularTo: true });
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'snap' });
        await nextTick();

        // 起点：ELBO C 表面 (1.4, 3.4, 6.2)（无 line()，普通表面点）。
        await hoverAndLoad(40, 160);
        clickAt(40, 160);
        const origin = store.currentXeokitDistanceDraft.value!.origin;
        expect(origin.sourceInfo?.source).toBe('mesh_pick_point');
        expect(origin.worldPos[0]).toBeCloseTo(1.4, 6);
        expect(origin.worldPos[1]).toBeCloseTo(3.4, 6);

        // 终点：CYLI A 表面 (2.4, 4.15, 6.2) → 目标线 = A 的轴 (y = 4, z = 6，沿 X) → 垂足 (1.4, 4, 6)。
        await hoverAndLoad(140, 100);
        clickAt(140, 100);
        const record = store.xeokitDistanceMeasurements.value[0]!;
        expect(record.perpendicular).toEqual({ targetKind: 'line', targetLabel: 'CYLI 轴线（P1 → P2）' });
        expect(record.target.worldPos[0]).toBeCloseTo(1.4, 6);
        expect(record.target.worldPos[1]).toBeCloseTo(4, 6);
        expect(record.target.worldPos[2]).toBeCloseTo(6, 6);
        expect(record.target.sourceInfo?.label).toBe('CYLI 轴线（P1 → P2）垂足');
        // 垂距 = |(1.4,3.4,6.2) − (1.4,4,6)| = √(0.6² + 0.2²)，设计米（gm 缩放 0.001 → 场景 1 单位 = 1 m）。
        expect(store.measurementDraftResult.value!.distance).toBeCloseTo(Math.hypot(0.6, 0.2), 6);
        // 起点是表面点 → 会话结果仍标近似（记录本身的 approximate 由 provenance 决定，与此无关）。
        expect(store.measurementDraftResult.value!.approximate).toBe(true);
        store.clearAll();
        store.setToolMode('xeokit_measure_distance');
        await nextTick();

        // 起点吸到 ELBO C 的 P-Point #1 (1.2, 3.4, 6)（精确点），终点仍拾 CYLI A 表面：垂足在 A 的 P1 → P2 上是精确几何，
        // 拾中它用的表面点不再让记录标「近似」。
        await hoverAndLoad(20, 160);
        clickAt(20, 160);
        const exactOrigin = store.currentXeokitDistanceDraft.value!.origin;
        expect(exactOrigin.sourceInfo?.source).toBe('ptset');
        expect(exactOrigin.worldPos[0]).toBeCloseTo(1.2, 6);
        await hoverAndLoad(140, 100);
        clickAt(140, 100);
        const exactRecord = store.xeokitDistanceMeasurements.value[0]!;
        expect(exactRecord.perpendicular).toEqual({ targetKind: 'line', targetLabel: 'CYLI 轴线（P1 → P2）' });
        expect(exactRecord.target.worldPos[0]).toBeCloseTo(1.2, 6);
        expect(exactRecord.target.worldPos[1]).toBeCloseTo(4, 6);
        expect(store.measurementDraftResult.value!.approximate).toBe(false);
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });

    it('结点不是 ATTA（OLET arrive = leave）时不合并：轴线到 OLET 就停，Mid-Point 是本段中点，标签带 OLET', async () => {
      const { store, measurementStyle, tools, hoverAt, clickAt, getObjectGeometryData, listTubingObjectIds, pieceA } = await setupSplitTubingTools('OLET');
      try {
        getObjectGeometryData.mockClear();
        hoverAt(125, 92);
        expect(tools.hoverSnapTarget.value?.label).toBe('轴线（OLET P-Point #2 → ELBO P-Point #1） · Snap');
        // 两端都不是穿过点：不找别的段、不读别的对象的几何。
        expect(listTubingObjectIds).not.toHaveBeenCalled();
        expect(getObjectGeometryData).not.toHaveBeenCalledWith(pieceA);

        clickAt(125, 92);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(2.0, 6);
        store.clearCurrentXeokitDraft();

        measurementStyle.updateMeasurementPickLayer({ pickType: 'midpoint' });
        await nextTick();
        clickAt(125, 92);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(2.3, 6);
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });
  });

  describe('E3D 拾取层 · Pline 过滤器（PLINE 线候选：legacy semantic_snap_points / gen-model-v1 element/plines 同一形状）', () => {
    /**
     * SCTN S 的 p-line：NA 从 (1, 4, 6) 到 (3, 4, 6)（沿 +X），TOS 在其上方 0.1（y = 4.1）。关键点源按 legacy
     * `semantic_snap_points` 的形状给「起点 / 终点」两个候选（`elementPlinesToKeypointCandidates` 产出的也是这个形状）。
     * ELBO C 有 P-Point #1 (1.2, 3.4, 6)，给 Perpendicular 起点。相机 / 画布同 `setupTubingTools`：
     * px = 100 + (x − 2) × 100，py = 100 − (y − 4) × 100。
     */
    async function setupPlineTools() {
      vi.useFakeTimers();
      const refnoS = '24381_300001';
      const refnoC = '24381_300002';
      const designMm = (scene: readonly [number, number, number]): [number, number, number] => [
        (scene[0] + 10) / 0.001,
        (scene[1] + 20) / 0.001,
        (scene[2] + 30) / 0.001,
      ];
      const plineEnd = (key: string, which: '起点' | '终点', scene: readonly [number, number, number], index: number) => ({
        id: `plines:${refnoS}:${key}:${which === '起点' ? 'pline_start' : 'pline_end'}`,
        refno: refnoS,
        objectId: `o:${refnoS}:0`,
        geoHash: '',
        geoIndex: -1,
        keypointIndex: index,
        kind: which === '起点' ? 'pline_start' : 'pline_end',
        source: 'semantic_snap_points',
        label: `PLINE ${key} ${which}`,
        local: designMm(scene),
        world: designMm(scene),
        hasDir: true,
        dir: [1, 0, 0] as [number, number, number],
      });
      const plineCandidates = [
        plineEnd('NA', '起点', [1, 4, 6], 0), plineEnd('NA', '终点', [3, 4, 6], 0),
        plineEnd('TOS', '起点', [1, 4.1, 6], 1), plineEnd('TOS', '终点', [3, 4.1, 6], 1),
      ];
      const ptsetC = [{
        number: 1, pt: designMm([1.2, 3.4, 6]), dir: null, dir_flag: 0, ref_dir: null, pbore: 100, pwidth: 0, pheight: 0, pconnect: '',
      }];
      vi.doMock('@/composables/useDbMetaInfo', () => ({
        getDbnumByRefno: vi.fn(() => 7997),
      }));
      vi.doMock('@/composables/useDbnoInstancesDtxLoader', () => ({
        getDtxRefnoTransform: vi.fn(() => null),
        resolveDtxNounByRefno: vi.fn((_dbno: number, refno: string) => (refno === refnoS ? 'SCTN' : 'ELBO')),
      }));
      vi.doMock('@/composables/useDbnoInstancesParquetLoader', () => ({
        useDbnoInstancesParquetLoader: () => ({
          queryPtsetByRefnoFromParquet: vi.fn(async (_dbno: number, refno: string) => {
            const ptset = refno === refnoC ? ptsetC : [];
            return {
              success: ptset.length > 0,
              refno,
              noun: refno === refnoS ? 'SCTN' : 'ELBO',
              ptset,
              world_transform: null,
              unit_info: { source_unit: 'mm', target_unit: 'mm', conversion_factor: 1 },
              error_code: ptset.length > 0 ? null : 'PTSET_POINTS_MISSING',
              error_message: ptset.length > 0 ? null : '型材没有目录 P 点',
            };
          }),
          queryPrimitiveKeypointsByRefnoFromParquet: vi.fn(async () => []),
          querySemanticSnapPointsByRefnoFromParquet: vi.fn(async (_dbno: number, refno: string) => (refno === refnoS ? plineCandidates : [])),
        }),
      }));
      vi.doMock('@/api/genModelPdmsAttrApi', () => ({
        pdmsGetPtsetWithContext: vi.fn(async (refno: string) => ({
          success: false, refno, ptset: [], world_transform: null, unit_info: null, error_code: 'PTSET_POINTS_MISSING', error_message: '无点',
        })),
        pdmsGetPtsetChildrenWithContext: vi.fn(async (refno: string) => ({
          success: false, refno, results: [], total_count: 0, success_count: 0, failed_count: 0, error_message: '无子构件点集',
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
      measurementStyle.updateMeasurementPickSource('ptset', { show: false, snap: true, thresholdPx: 3 });
      measurementStyle.updateMeasurementPickSource('position', { show: false, snap: false });
      measurementStyle.updateMeasurementPickSource('mesh_pick_point', { show: false, snap: false });
      measurementStyle.updateMeasurementPickSource('primitive_key_point', { show: true, snap: true, thresholdPx: 6 });
      measurementStyle.updateStyle({ keepMeasurementAnnotation: true, perpendicularTo: false });

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.set(2, 4, 7);
      camera.lookAt(2, 4, 6);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 200 }),
      });
      // S 占 y ≈ 4 ± 0.15 的横带（腹板 + 翼缘），C 在左下。
      const pickPoint = vi.fn((pos: { x: number; y: number }) => {
        const x = 2 + (pos.x - 100) / 100;
        const y = 4 - (pos.y - 100) / 100;
        if (Math.abs(pos.y - 100) <= 15 && pos.x > 0 && pos.x < 200) return { objectId: `o:${refnoS}:0`, point: new THREE.Vector3(x, 4.02, 6.2), distance: 0.8 };
        if (pos.x < 60 && pos.y > 140) return { objectId: `o:${refnoC}:0`, point: new THREE.Vector3(x, y, 6.2), distance: 0.8 };
        return null;
      });
      const globalModelMatrix = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
      globalModelMatrix.setPosition(-10, -20, -30);
      const dimensionSystem = {
        replaceExternalSource: vi.fn(),
        viewport: { setSelection: vi.fn(), getSelection: vi.fn(() => null) },
      } as any;
      const tools = useXeokitMeasurementTools({
        dtxViewerRef: ref({ camera, canvas, scene: new THREE.Scene() } as any),
        dtxLayerRef: ref({
          _totalObjects: 2,
          getGlobalModelMatrix: () => globalModelMatrix.clone(),
          getObjectGeometryData: vi.fn(() => null),
        } as any),
        selectionRef: ref({ pickPoint } as any),
        overlayContainerRef: ref(document.createElement('div')),
        getDimensionSystem: () => dimensionSystem,
        store,
        compatViewerRef: ref(null),
        requestRender: null,
        isTubingObject: () => false,
      });
      const hoverAt = (x: number, y: number) => tools.onCanvasPointerMove(canvas, new PointerEvent('pointermove', { clientX: x, clientY: y }));
      const clickAt = (x: number, y: number) => tools.onCanvasPointerUp(canvas, new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0 }));
      /** 悬停到某元素并等它的 P-Point / PLINE 关键点落缓存（80 ms 防抖 + 异步源）。 */
      const hoverAndLoad = async (x: number, y: number) => {
        hoverAt(x, y);
        await vi.advanceTimersByTimeAsync(200);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(50);
        hoverAt(x, y);
      };
      return { store, measurementStyle, tools, hoverAt, clickAt, hoverAndLoad, refnoS, refnoC };
    }

    it('Pline × Snap：光标落在 p-line 中段就拾中整条 PLINE 线（近端），Mid-Point 取中点；Any 放行、Ppoint 不放行', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAndLoad } = await setupPlineTools();
      try {
        measurementStyle.updateMeasurementPickLayer({ filter: 'pline', pickType: 'snap' });
        await nextTick();

        // 光标 (140, 100) = 场景 (2.4, 4)：NA 线 0 px、TOS 线 10 px、两端各 ≥ 60 px → 线候选胜出，Snap 落近端 (3, 4, 6)。
        await hoverAndLoad(140, 100);
        expect(tools.hoverSnapTarget.value?.label).toBe('PLINE NA · Snap');
        clickAt(140, 100);
        const draft = store.currentXeokitDistanceDraft.value!;
        expect(draft).not.toBeNull();
        expect(draft.origin.sourceInfo?.source).toBe('primitive_key_point');
        expect(draft.origin.worldPos[0]).toBeCloseTo(3, 6);
        expect(draft.origin.worldPos[1]).toBeCloseTo(4, 6);
        expect(draft.origin.worldPos[2]).toBeCloseTo(6, 6);
        store.clearCurrentXeokitDraft();

        // Mid-Point：线中点 (2, 4, 6)，与光标位置无关。
        measurementStyle.updateMeasurementPickLayer({ pickType: 'midpoint' });
        await nextTick();
        clickAt(140, 100);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(2, 6);
        expect(store.currentXeokitDistanceDraft.value!.origin.sourceInfo?.label).toBe('PLINE NA · Mid-Point');
        store.clearCurrentXeokitDraft();

        // Any 放行 Pline（E3D stdAny = Element / Ppoint / Pline）。
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'snap' });
        await nextTick();
        clickAt(140, 100);
        expect(store.currentXeokitDistanceDraft.value!.origin.worldPos[0]).toBeCloseTo(3, 6);
        store.clearCurrentXeokitDraft();

        // Ppoint 不放行：同一位置无捕捉。
        measurementStyle.updateMeasurementPickLayer({ filter: 'ppoint', pickType: 'snap' });
        await nextTick();
        clickAt(140, 100);
        expect(store.currentXeokitDistanceDraft.value).toBeNull();
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });

    it('Perpendicular to PLINE：目标就是那条 p-line（标签用它自己的名字，不缀「轴线」，不带派生记号），垂足落在线上', async () => {
      const { store, measurementStyle, tools, clickAt, hoverAndLoad } = await setupPlineTools();
      try {
        measurementStyle.updateStyle({ perpendicularTo: true });
        measurementStyle.updateMeasurementPickLayer({ filter: 'any', pickType: 'snap' });
        await nextTick();

        // 起点：ELBO C 的 P-Point #1 (1.2, 3.4, 6)。
        await hoverAndLoad(20, 160);
        clickAt(20, 160);
        const origin = store.currentXeokitDistanceDraft.value!.origin;
        expect(origin.sourceInfo?.source).toBe('ptset');
        expect(origin.worldPos[0]).toBeCloseTo(1.2, 6);

        // 目标：SCTN S 的 PLINE NA（y = 4, z = 6，沿 X）→ 垂足 (1.2, 4, 6)，垂距 0.6。
        await hoverAndLoad(140, 100);
        expect(tools.hoverSnapTarget.value?.label).toBe('PLINE NA · Snap');
        clickAt(140, 100);
        const record = store.xeokitDistanceMeasurements.value[0]!;
        expect(record.perpendicular).toEqual({ targetKind: 'line', targetLabel: 'PLINE NA' });
        expect(record.target.sourceInfo?.label).toBe('PLINE NA垂足');
        expect(record.target.worldPos[0]).toBeCloseTo(1.2, 6);
        expect(record.target.worldPos[1]).toBeCloseTo(4, 6);
        expect(record.target.worldPos[2]).toBeCloseTo(6, 6);
        expect(store.measurementDraftResult.value!.distance).toBeCloseTo(0.6, 6);
        expect(store.measurementDraftResult.value!.approximate).toBe(false);
      } finally {
        tools.dispose();
        vi.useRealTimers();
      }
    });
  });
});
