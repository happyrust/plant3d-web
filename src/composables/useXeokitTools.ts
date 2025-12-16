import { computed, ref, watch, type Ref } from 'vue';

import {
  AngleMeasurementsPlugin,
  AngleMeasurementsMouseControl,
  AnnotationsPlugin,
  DistanceMeasurementsPlugin,
  DistanceMeasurementsMouseControl,
  LineSet,
  MarqueePicker,
  Mesh,
  ObjectsKdTree3,
  PhongMaterial,
  PointerLens,
  ReadableGeometry,
  type Viewer,
} from '@xeokit/xeokit-sdk';

import { dockActivatePanelIfExists, dockPanelExists } from '@/composables/useDockApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import {
  useToolStore,
  type AngleMeasurementRecord,
  type AnnotationRecord,
  type DistanceMeasurementRecord,
  type MeasurementPoint,
  type Obb,
  type ObbAnnotationRecord,
  type Vec3,
} from '@/composables/useToolStore';

type PickRecordLike = {
  entity?: { id?: string };
  worldPos?: number[];
};

type XeokitAnnotationLike = {
  worldPos?: number[];
  setValues?: (v: Record<string, unknown>) => void;
  setMarkerShown?: (s: boolean) => void;
  setLabelShown?: (s: boolean) => void;
};

function getSceneCanvas(viewer: Viewer): HTMLCanvasElement {
  return (viewer.scene as unknown as { canvas: { canvas: HTMLCanvasElement } }).canvas.canvas;
}

function cameraProjectWorldPos(camera: unknown, worldPos: Vec3): [number, number] {
  return (camera as unknown as { projectWorldPos: (p: number[]) => number[] }).projectWorldPos(worldPos) as unknown as [
    number,
    number,
  ];
}

function nowId(prefix: string) {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
}

function vec3From(arr: number[] | undefined | null): Vec3 | null {
  if (!arr || arr.length < 3) return null;
  const x = Number(arr[0]);
  const y = Number(arr[1]);
  const z = Number(arr[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  const first = points[0];
  if (!first) return null;
  let xmin = first[0];
  let ymin = first[1];
  let zmin = first[2];
  let xmax = first[0];
  let ymax = first[1];
  let zmax = first[2];
  for (const p of points) {
    xmin = Math.min(xmin, p[0]);
    ymin = Math.min(ymin, p[1]);
    zmin = Math.min(zmin, p[2]);
    xmax = Math.max(xmax, p[0]);
    ymax = Math.max(ymax, p[1]);
    zmax = Math.max(zmax, p[2]);
  }
  const dx = xmax - xmin;
  const dy = ymax - ymin;
  const dz = zmax - zmin;
  const pad = Math.max(0.2, (dx + dy + dz) * 0.05);
  return [xmin - pad, ymin - pad, zmin - pad, xmax + pad, ymax + pad, zmax + pad];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul3s(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function len3(a: Vec3): number {
  return Math.sqrt(dot3(a, a));
}

function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  if (l <= 0) return [0, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function mat4MulVec4(m: number[], v: [number, number, number, number]): [number, number, number, number] {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const w = v[3];
  const m0 = m[0] ?? 0;
  const m1 = m[1] ?? 0;
  const m2 = m[2] ?? 0;
  const m3 = m[3] ?? 0;
  const m4 = m[4] ?? 0;
  const m5 = m[5] ?? 0;
  const m6 = m[6] ?? 0;
  const m7 = m[7] ?? 0;
  const m8 = m[8] ?? 0;
  const m9 = m[9] ?? 0;
  const m10 = m[10] ?? 0;
  const m11 = m[11] ?? 0;
  const m12 = m[12] ?? 0;
  const m13 = m[13] ?? 0;
  const m14 = m[14] ?? 0;
  const m15 = m[15] ?? 0;
  return [
    m0 * x + m4 * y + m8 * z + m12 * w,
    m1 * x + m5 * y + m9 * z + m13 * w,
    m2 * x + m6 * y + m10 * z + m14 * w,
    m3 * x + m7 * y + m11 * z + m15 * w,
  ];
}

function worldPosToScreenZ(viewMat: number[], projMat: number[], worldPos: Vec3): number {
  const v = mat4MulVec4(viewMat, [worldPos[0], worldPos[1], worldPos[2], 1]);
  const c = mat4MulVec4(projMat, v);
  const w = c[3] || 1;
  return c[2] / w;
}

function aabbCorners(aabb: [number, number, number, number, number, number]): Vec3[] {
  const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb;
  return [
    [xmin, ymin, zmin],
    [xmax, ymin, zmin],
    [xmax, ymax, zmin],
    [xmin, ymax, zmin],
    [xmin, ymin, zmax],
    [xmax, ymin, zmax],
    [xmax, ymax, zmax],
    [xmin, ymax, zmax],
  ];
}

function symmetricEigenDecomposition3(
  a00: number,
  a01: number,
  a02: number,
  a11: number,
  a12: number,
  a22: number
): { values: [number, number, number]; vectors: [Vec3, Vec3, Vec3] } {
  const A = new Float64Array([
    a00, a01, a02,
    a01, a11, a12,
    a02, a12, a22,
  ]);
  const V = new Float64Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);

  const at = (r: number, c: number): number => A[r * 3 + c] ?? 0;
  const setA = (r: number, c: number, v: number) => {
    A[r * 3 + c] = v;
  };
  const vt = (r: number, c: number): number => V[r * 3 + c] ?? 0;
  const setV = (r: number, c: number, v: number) => {
    V[r * 3 + c] = v;
  };

  const maxIter = 24;
  for (let iter = 0; iter < maxIter; iter++) {
    let p = 0;
    let q = 1;
    let max = Math.abs(at(0, 1));
    const a02abs = Math.abs(at(0, 2));
    const a12abs = Math.abs(at(1, 2));
    if (a02abs > max) {
      max = a02abs;
      p = 0;
      q = 2;
    }
    if (a12abs > max) {
      max = a12abs;
      p = 1;
      q = 2;
    }
    if (max < 1e-12) break;

    const app = at(p, p);
    const aqq = at(q, q);
    const apq = at(p, q);
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let k = 0; k < 3; k++) {
      const aik = at(p, k);
      const aqk = at(q, k);
      setA(p, k, c * aik - s * aqk);
      setA(q, k, s * aik + c * aqk);
    }
    for (let k = 0; k < 3; k++) {
      const akp = at(k, p);
      const akq = at(k, q);
      setA(k, p, c * akp - s * akq);
      setA(k, q, s * akp + c * akq);
    }

    for (let k = 0; k < 3; k++) {
      const vkp = vt(k, p);
      const vkq = vt(k, q);
      setV(k, p, c * vkp - s * vkq);
      setV(k, q, s * vkp + c * vkq);
    }
  }

  const values: [number, number, number] = [at(0, 0), at(1, 1), at(2, 2)];
  const vectors: [Vec3, Vec3, Vec3] = [
    norm3([vt(0, 0), vt(1, 0), vt(2, 0)]),
    norm3([vt(0, 1), vt(1, 1), vt(2, 1)]),
    norm3([vt(0, 2), vt(1, 2), vt(2, 2)]),
  ];

  const order = [0, 1, 2].sort((i, j) => values[j]! - values[i]!);
  const i0 = order[0] ?? 0;
  const i1 = order[1] ?? 1;
  const i2 = order[2] ?? 2;
  const sortedValues: [number, number, number] = [values[i0]!, values[i1]!, values[i2]!];
  const sortedVectors: [Vec3, Vec3, Vec3] = [vectors[i0]!, vectors[i1]!, vectors[i2]!];

  const c01 = cross3(sortedVectors[0], sortedVectors[1]);
  if (dot3(c01, sortedVectors[2]) < 0) {
    sortedVectors[2] = mul3s(sortedVectors[2], -1);
  }

  return { values: sortedValues, vectors: sortedVectors };
}

function fitPcaObb(points: Vec3[]): Obb | null {
  if (points.length === 0) return null;

  let mean: Vec3 = [0, 0, 0];
  for (const p of points) {
    mean = add3(mean, p);
  }
  mean = mul3s(mean, 1 / points.length);

  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;

  for (const p of points) {
    const d = sub3(p, mean);
    c00 += d[0] * d[0];
    c01 += d[0] * d[1];
    c02 += d[0] * d[2];
    c11 += d[1] * d[1];
    c12 += d[1] * d[2];
    c22 += d[2] * d[2];
  }

  const n = points.length;
  c00 /= n;
  c01 /= n;
  c02 /= n;
  c11 /= n;
  c12 /= n;
  c22 /= n;

  const { vectors } = symmetricEigenDecomposition3(c00, c01, c02, c11, c12, c22);
  const axes: [Vec3, Vec3, Vec3] = [vectors[0], vectors[1], vectors[2]];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    const x = dot3(p, axes[0]);
    const y = dot3(p, axes[1]);
    const z = dot3(p, axes[2]);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const midX = (minX + maxX) * 0.5;
  const midY = (minY + maxY) * 0.5;
  const midZ = (minZ + maxZ) * 0.5;
  const center = add3(add3(mul3s(axes[0], midX), mul3s(axes[1], midY)), mul3s(axes[2], midZ));
  const halfSize: Vec3 = [(maxX - minX) * 0.5, (maxY - minY) * 0.5, (maxZ - minZ) * 0.5];

  const hx = halfSize[0];
  const hy = halfSize[1];
  const hz = halfSize[2];
  const corners = [
    add3(add3(add3(center, mul3s(axes[0], -hx)), mul3s(axes[1], -hy)), mul3s(axes[2], -hz)),
    add3(add3(add3(center, mul3s(axes[0], hx)), mul3s(axes[1], -hy)), mul3s(axes[2], -hz)),
    add3(add3(add3(center, mul3s(axes[0], hx)), mul3s(axes[1], hy)), mul3s(axes[2], -hz)),
    add3(add3(add3(center, mul3s(axes[0], -hx)), mul3s(axes[1], hy)), mul3s(axes[2], -hz)),
    add3(add3(add3(center, mul3s(axes[0], -hx)), mul3s(axes[1], -hy)), mul3s(axes[2], hz)),
    add3(add3(add3(center, mul3s(axes[0], hx)), mul3s(axes[1], -hy)), mul3s(axes[2], hz)),
    add3(add3(add3(center, mul3s(axes[0], hx)), mul3s(axes[1], hy)), mul3s(axes[2], hz)),
    add3(add3(add3(center, mul3s(axes[0], -hx)), mul3s(axes[1], hy)), mul3s(axes[2], hz)),
  ] as unknown as Obb['corners'];

  return {
    center,
    axes,
    halfSize,
    corners,
  };
}

function topCenterFromCorners(corners: Obb['corners'], worldUp: Vec3): Vec3 {
  const scored = corners
    .map((c) => ({ c, s: dot3(c, worldUp) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  let sum: Vec3 = [0, 0, 0];
  for (const it of scored) {
    sum = add3(sum, it.c);
  }
  return mul3s(sum, 1 / Math.max(1, scored.length));
}

export function useXeokitTools(
  viewerRef: Ref<Viewer | null>,
  overlayContainerRef: Ref<HTMLElement | null>,
  store: ReturnType<typeof useToolStore>
) {
  const ready = ref(false);

  const selection = useSelectionStore();
  let selectionMaterialConfigured = false;

  const distancePlugin = ref<DistanceMeasurementsPlugin | null>(null);
  const anglePlugin = ref<AngleMeasurementsPlugin | null>(null);
  const annotationsPlugin = ref<AnnotationsPlugin | null>(null);

  const pointerLens = ref<PointerLens | null>(null);
  const distanceMouseControl = ref<DistanceMeasurementsMouseControl | null>(null);
  const angleMouseControl = ref<AngleMeasurementsMouseControl | null>(null);

  const progressPoints = ref<MeasurementPoint[]>([]);

  const statusText = computed(() => {
    const mode = store.toolMode.value;
    if (mode === 'none') return '未启用工具';
    if (!ready.value) return '等待模型加载完成…';

    if (mode === 'measure_distance') {
      return progressPoints.value.length === 0 ? '距离测量：请选择起点' : '距离测量：请选择终点';
    }

    if (mode === 'measure_angle') {
      if (progressPoints.value.length === 0) return '角度测量：请选择起点';
      if (progressPoints.value.length === 1) return '角度测量：请选择拐点';
      return '角度测量：请选择终点';
    }

    if (mode === 'pick_query_center') {
      return '请点击模型拾取查询中心点';
    }

    if (mode === 'annotation_obb') {
      return 'OBB 批注：拖拽框选生成（左→右=相交，右→左=包含）';
    }

    return '批注：点击模型表面创建';
  });

  function resetProgress() {
    progressPoints.value = [];
  }

  function isRefnoLike(id: string): boolean {
    return /^\d+[_/]\d+(,\d+)?$/.test(id);
  }

  function resolveRefnoFromSceneId(viewer: Viewer, id: string): string | null {
    if (isRefnoLike(id)) return id;
    const map = (viewer.scene as unknown as { __aiosMeshIdToRefno?: Record<string, string> }).__aiosMeshIdToRefno;
    const refno = map?.[id];
    if (!refno || !isRefnoLike(refno)) return null;
    return refno;
  }

  function resolveSceneObjectId(viewer: Viewer, id: string): string {
    const refno = resolveRefnoFromSceneId(viewer, id);
    if (refno && viewer.scene.objects[refno]) return refno;
    return id;
  }

  function clearSceneSelection(viewer: Viewer) {
    const selectedObjectIds = viewer.scene.selectedObjectIds;
    if (selectedObjectIds && selectedObjectIds.length > 0) {
      viewer.scene.setObjectsSelected(selectedObjectIds, false);
    }
  }

  function syncSelectionStoreFromScene(viewer: Viewer) {
    const selectedObjectIds = viewer.scene.selectedObjectIds;
    if (!selectedObjectIds || selectedObjectIds.length !== 1) {
      selection.clearSelection();
      return;
    }

    const only = selectedObjectIds[0];
    if (!only) {
      selection.clearSelection();
      return;
    }

    const refno = resolveRefnoFromSceneId(viewer, String(only));
    if (!refno) {
      selection.clearSelection();
      return;
    }

    void selection.loadProperties(refno);

    if (dockPanelExists('properties')) {
      dockActivatePanelIfExists('properties');
    }
  }

  function configureSelectionMaterial(viewer: Viewer) {
    if (selectionMaterialConfigured) return;
    selectionMaterialConfigured = true;

    try {
      const mat = viewer.scene.selectedMaterial;
      mat.fill = true;
      mat.fillColor = [1.0, 1.0, 0.0]; // 黄色填充
      mat.fillAlpha = 0.3; // 半透明
      mat.edges = true;
      mat.edgeColor = [1.0, 0.5, 0.0]; // 橙色边缘
      mat.edgeAlpha = 1.0;
      mat.edgeWidth = 3;
      mat.glowThrough = true;
    } catch {
      // ignore
    }
  }

  function ensurePlugins(viewer: Viewer) {
    const container = overlayContainerRef.value ?? document.body;

    if (!pointerLens.value) {
      pointerLens.value = new PointerLens(viewer, {
        zoomFactor: 2,
      });
    }

    if (!distancePlugin.value) {
      distancePlugin.value = new DistanceMeasurementsPlugin(
        viewer,
        { container } as ConstructorParameters<typeof DistanceMeasurementsPlugin>[1]
      );
    }

    if (!distanceMouseControl.value && distancePlugin.value) {
      distanceMouseControl.value = new DistanceMeasurementsMouseControl(
        distancePlugin.value as unknown as DistanceMeasurementsPlugin,
        {
          pointerLens: pointerLens.value ?? undefined,
          snapping: true,
        }
      );

      (distancePlugin.value as unknown as { on: (event: string, cb: (m: unknown) => void) => void }).on('measurementEnd', (measurement: unknown) => {
        const m = measurement as {
          id: string;
          origin: { entity?: { id?: string }; worldPos?: number[] };
          target: { entity?: { id?: string }; worldPos?: number[] };
        };
        const originEntityId = m.origin?.entity?.id ? String(m.origin.entity.id) : null;
        const targetEntityId = m.target?.entity?.id ? String(m.target.entity.id) : null;
        const originWorldPos = vec3From(m.origin?.worldPos);
        const targetWorldPos = vec3From(m.target?.worldPos);

        if (!originEntityId || !targetEntityId || !originWorldPos || !targetWorldPos) return;

        const record: DistanceMeasurementRecord = {
          id: m.id,
          kind: 'distance',
          origin: { entityId: originEntityId, worldPos: originWorldPos },
          target: { entityId: targetEntityId, worldPos: targetWorldPos },
          visible: true,
          createdAt: Date.now(),
        };
        store.addMeasurement(record);
      });
    }

    if (!anglePlugin.value) {
      anglePlugin.value = new AngleMeasurementsPlugin(
        viewer,
        { container } as ConstructorParameters<typeof AngleMeasurementsPlugin>[1]
      );
    }

    if (!angleMouseControl.value && anglePlugin.value) {
      angleMouseControl.value = new AngleMeasurementsMouseControl(
        anglePlugin.value as unknown as AngleMeasurementsPlugin,
        {
          pointerLens: pointerLens.value ?? undefined,
          snapping: true,
        }
      );

      (anglePlugin.value as unknown as { on: (event: string, cb: (m: unknown) => void) => void }).on('measurementEnd', (measurement: unknown) => {
        const m = measurement as {
          id: string;
          origin: { entity?: { id?: string }; worldPos?: number[] };
          corner: { entity?: { id?: string }; worldPos?: number[] };
          target: { entity?: { id?: string }; worldPos?: number[] };
        };
        const originEntityId = m.origin?.entity?.id ? String(m.origin.entity.id) : null;
        const cornerEntityId = m.corner?.entity?.id ? String(m.corner.entity.id) : null;
        const targetEntityId = m.target?.entity?.id ? String(m.target.entity.id) : null;
        const originWorldPos = vec3From(m.origin?.worldPos);
        const cornerWorldPos = vec3From(m.corner?.worldPos);
        const targetWorldPos = vec3From(m.target?.worldPos);

        if (!originEntityId || !cornerEntityId || !targetEntityId || !originWorldPos || !cornerWorldPos || !targetWorldPos) return;

        const record: AngleMeasurementRecord = {
          id: m.id,
          kind: 'angle',
          origin: { entityId: originEntityId, worldPos: originWorldPos },
          corner: { entityId: cornerEntityId, worldPos: cornerWorldPos },
          target: { entityId: targetEntityId, worldPos: targetWorldPos },
          visible: true,
          createdAt: Date.now(),
        };
        store.addMeasurement(record);
      });
    }
    if (!annotationsPlugin.value) {
      const labelHTML = [
        '<div style="max-width:260px;padding:8px 10px;border-radius:8px;background:rgba(20,20,20,0.85);color:#fff;box-shadow:0 8px 18px rgba(0,0,0,0.35);">',
        '  <div style="font-weight:700;line-height:1.2;">{{title}}</div>',
        '  <div style="margin-top:4px;font-size:12px;opacity:0.95;white-space:pre-wrap;">{{description}}</div>',
        '</div>',
      ].join('');

      const markerHTML = [
        '<div style="width:20px;height:20px;border-radius:999px;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 6px 14px rgba(0,0,0,0.35);">',
        '{{glyph}}',
        '</div>',
      ].join('');

      annotationsPlugin.value = new AnnotationsPlugin(viewer, {
        container,
        markerHTML,
        labelHTML,
        values: {
          glyph: 'A',
          title: '批注',
          description: '',
        },
      } as ConstructorParameters<typeof AnnotationsPlugin>[1]);
    }
  }

  const obbWireframes = new Map<string, LineSet>();
  const obbLeaders = new Map<string, LineSet>();
  const obbPickMeshes = new Map<
    string,
    {
      mesh: Mesh;
      geometry: ReadableGeometry;
      material: PhongMaterial;
    }
  >();
  const obbLabels = new Map<string, string>();

  const objectsKdTree3 = ref<ObjectsKdTree3 | null>(null);
  const marqueePicker = ref<MarqueePicker | null>(null);

  let canvasPointerDown: ((e: PointerEvent) => void) | null = null;
  let canvasPointerMove: ((e: PointerEvent) => void) | null = null;
  let canvasPointerUp: ((e: PointerEvent) => void) | null = null;
  let overlayPointerDown: ((e: PointerEvent) => void) | null = null;
  let overlayPointerMove: ((e: PointerEvent) => void) | null = null;
  let overlayPointerUp: ((e: PointerEvent) => void) | null = null;
  let suppressNextClick = false;

  function destroyObbSceneObjects() {
    for (const obj of obbWireframes.values()) {
      try {
        obj.destroy();
      } catch {
        // ignore
      }
    }
    for (const obj of obbLeaders.values()) {
      try {
        obj.destroy();
      } catch {
        // ignore
      }
    }
    for (const obj of obbPickMeshes.values()) {
      try {
        obj.mesh.destroy();
      } catch {
        // ignore
      }
      try {
        obj.geometry.destroy();
      } catch {
        // ignore
      }
      try {
        obj.material.destroy();
      } catch {
        // ignore
      }
    }
    obbWireframes.clear();
    obbLeaders.clear();
    obbPickMeshes.clear();
    obbLabels.clear();
  }

  function ensureMarqueeSystems(viewer: Viewer) {
    if (!objectsKdTree3.value) {
      objectsKdTree3.value = new ObjectsKdTree3({ viewer } as ConstructorParameters<typeof ObjectsKdTree3>[0]);
    }
    if (!marqueePicker.value) {
      marqueePicker.value = new MarqueePicker({
        viewer,
        objectsKdTree3: objectsKdTree3.value,
      } as ConstructorParameters<typeof MarqueePicker>[0]);
    }
  }

  function attachObbDomControls(viewer: Viewer) {
    const canvas = getSceneCanvas(viewer);
    const overlay = overlayContainerRef.value;
    if (!canvas || !overlay) return;

    if (!canvasPointerDown) {
      let dragging = false;
      let start: [number, number] | null = null;
      let lastPicked: string[] = [];

      const getCanvasPos = (e: PointerEvent): [number, number] => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return [x * scaleX, y * scaleY];
      };

      canvasPointerDown = (e: PointerEvent) => {
        if (store.toolMode.value !== 'annotation_obb') return;
        if (e.button !== 0) return;
        if (!ready.value) return;

        ensureMarqueeSystems(viewer);
        if (!marqueePicker.value) return;

        dragging = true;
        start = getCanvasPos(e);
        lastPicked = [];
        suppressNextClick = true;

        try {
          viewer.cameraControl.active = false;
        } catch {
          // ignore
        }
        try {
          viewer.scene.input.setEnabled(false);
        } catch {
          // ignore
        }
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        marqueePicker.value.setMarqueeCorner1(start);
        marqueePicker.value.setMarqueeCorner2(start);
        marqueePicker.value.setMarqueeVisible(true);
      };

      canvasPointerMove = (e: PointerEvent) => {
        if (!dragging) return;
        if (!start) return;
        if (!marqueePicker.value) return;
        const cur = getCanvasPos(e);
        marqueePicker.value.setMarqueeCorner2(cur);

        const dx = cur[0] - start[0];
        if (dx >= 0) {
          marqueePicker.value.setPickMode(MarqueePicker.PICK_MODE_INTERSECTS);
        } else {
          marqueePicker.value.setPickMode(MarqueePicker.PICK_MODE_INSIDE);
        }
      };

      canvasPointerUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        const picker = marqueePicker.value;
        const startPos = start;
        start = null;
        if (picker) {
          picker.setMarqueeVisible(false);
          try {
            const picked = picker.pick() || [];
            const additive = e.ctrlKey || e.metaKey;
            lastPicked = additive ? Array.from(new Set([...lastPicked, ...picked])) : picked;

            if (lastPicked.length > 0) {
              const points: Vec3[] = [];
              for (const id of lastPicked) {
                const ent = viewer.scene.objects[id];
                const aabb = ent?.aabb as unknown as [number, number, number, number, number, number] | undefined;
                if (!aabb) continue;
                points.push(...aabbCorners(aabb));
              }

              const obb = fitPcaObb(points);
              if (obb) {
                const n = store.obbAnnotations.value.length + 1;
                const worldUp = (viewer.scene.camera.worldUp as unknown as number[] | undefined);
                const up: Vec3 = worldUp && worldUp.length >= 3 ? [worldUp[0]!, worldUp[1]!, worldUp[2]!] : [0, 0, 1];
                const topCenter = topCenterFromCorners(obb.corners, up);
                const diag = len3([
                  obb.halfSize[0] * 2,
                  obb.halfSize[1] * 2,
                  obb.halfSize[2] * 2,
                ]);
                const offset = Math.max(0.5, diag * 0.12);
                const labelWorldPos = add3(topCenter, add3(mul3s(up, offset), [offset, 0, 0]));

                const rec: ObbAnnotationRecord = {
                  id: nowId('obb'),
                  objectIds: lastPicked,
                  obb,
                  labelWorldPos,
                  anchor: { kind: 'top_center' },
                  visible: true,
                  title: `OBB 批注 ${n}`,
                  description: '',
                  createdAt: Date.now(),
                };
                store.addObbAnnotation(rec);
              }
            }
          } catch {
            // ignore
          }
        }

        try {
          viewer.cameraControl.active = true;
        } catch {
          // ignore
        }
        try {
          viewer.scene.input.setEnabled(true);
        } catch {
          // ignore
        }
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }

        if (startPos) {
          suppressNextClick = true;
        }
      };

      canvas.addEventListener('pointerdown', canvasPointerDown);
      canvas.addEventListener('pointermove', canvasPointerMove);
      canvas.addEventListener('pointerup', canvasPointerUp);
      canvas.addEventListener('pointercancel', canvasPointerUp);
    }

    if (!overlayPointerDown) {
      const screenPos = [0, 0, 0, 1];
      const viewPos = [0, 0, 0, 1];
      const worldPos = [0, 0, 0, 1];
      let draggingLabel: {
        obbId: string;
        screenZ: number;
        offset: [number, number];
      } | null = null;

      const getCanvasPos = (e: PointerEvent): [number, number] => {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      };

      const findObbId = (target: EventTarget | null): string | null => {
        const el = target instanceof Element ? target.closest('[data-obb-id]') : null;
        if (!el) return null;
        const v = el.getAttribute('data-obb-id');
        return v ? String(v) : null;
      };

      let rafId: number | null = null;
      const pending = new Map<string, Vec3>();

      const scheduleLeaderUpdate = () => {
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          const viewer = viewerRef.value;
          if (!viewer) return;
          for (const [id, pos] of pending.entries()) {
            pending.delete(id);
            const rec = store.obbAnnotations.value.find((r) => r.id === id);
            if (!rec) continue;
            const worldUp = (viewer.scene.camera.worldUp as unknown as number[] | undefined);
            const up: Vec3 = worldUp && worldUp.length >= 3 ? [worldUp[0]!, worldUp[1]!, worldUp[2]!] : [0, 0, 1];
            const start = topCenterFromCorners(rec.obb.corners, up);

            const leaderId = `obb_leader_${id}`;
            const old = obbLeaders.get(id);
            if (old) {
              try {
                old.destroy();
              } catch {
                // ignore
              }
              obbLeaders.delete(id);
            }

            const leader = new LineSet(viewer.scene, {
              id: leaderId,
              positions: [
                start[0], start[1], start[2],
                pos[0], pos[1], pos[2],
              ],
              indices: [0, 1],
              color: [1, 1, 0],
              opacity: 1.0,
              visible: rec.visible,
            } as ConstructorParameters<typeof LineSet>[1]);
            obbLeaders.set(id, leader);
          }
        });
      };

      overlayPointerDown = (e: PointerEvent) => {
        const obbId = findObbId(e.target);
        if (!obbId) return;
        const viewer = viewerRef.value;
        if (!viewer) return;

        const labelAnnoId = `obb_label_${obbId}`;
        const anno = (annotationsPlugin.value?.annotations || ({} as Record<string, unknown>))[labelAnnoId] as XeokitAnnotationLike | undefined;
        if (!anno || !anno.worldPos) return;
        const annoWorldPos = vec3From(anno.worldPos);
        if (!annoWorldPos) return;

        store.activeObbAnnotationId.value = obbId;
        suppressNextClick = true;

        const canvasPos = getCanvasPos(e);
        const markerCanvasPos = cameraProjectWorldPos(viewer.scene.camera, annoWorldPos);
        const offset: [number, number] = [canvasPos[0] - markerCanvasPos[0], canvasPos[1] - markerCanvasPos[1]];
        const screenZ = worldPosToScreenZ(viewer.scene.camera.viewMatrix, viewer.scene.camera.projMatrix, annoWorldPos);
        draggingLabel = { obbId, screenZ, offset };
        try {
          viewer.scene.input.setEnabled(false);
        } catch {
          // ignore
        }
        try {
          overlay.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      };

      overlayPointerMove = (e: PointerEvent) => {
        if (!draggingLabel) return;
        const viewer = viewerRef.value;
        if (!viewer) return;

        const { obbId, screenZ, offset } = draggingLabel;
        const labelAnnoId = `obb_label_${obbId}`;
        const anno = (annotationsPlugin.value?.annotations || ({} as Record<string, unknown>))[labelAnnoId] as XeokitAnnotationLike | undefined;
        if (!anno) return;

        const canvasPos = getCanvasPos(e);
        const targetCanvasPos: [number, number] = [canvasPos[0] - offset[0], canvasPos[1] - offset[1]];
        const wp = viewer.scene.camera.project.unproject(
          targetCanvasPos,
          screenZ,
          screenPos,
          viewPos,
          worldPos
        ) as unknown as number[];
        const next: Vec3 = [wp[0]!, wp[1]!, wp[2]!];
        anno.worldPos = next;
        pending.set(obbId, next);
        scheduleLeaderUpdate();
      };

      overlayPointerUp = (e: PointerEvent) => {
        if (!draggingLabel) return;
        const viewer = viewerRef.value;
        const { obbId } = draggingLabel;
        draggingLabel = null;
        if (viewer) {
          try {
            viewer.scene.input.setEnabled(true);
          } catch {
            // ignore
          }
        }
        try {
          overlay.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        suppressNextClick = true;

        const labelAnnoId = `obb_label_${obbId}`;
        const anno = (annotationsPlugin.value?.annotations || ({} as Record<string, unknown>))[labelAnnoId] as XeokitAnnotationLike | undefined;
        if (anno && anno.worldPos) {
          const wp = vec3From(anno.worldPos);
          if (wp) {
            store.updateObbAnnotation(obbId, { labelWorldPos: wp });
          }
        }
      };

      overlay.addEventListener('pointerdown', overlayPointerDown);
      overlay.addEventListener('pointermove', overlayPointerMove);
      overlay.addEventListener('pointerup', overlayPointerUp);
      overlay.addEventListener('pointercancel', overlayPointerUp);
    }
  }

  function detachObbDomControls(viewer: Viewer) {
    const canvas = getSceneCanvas(viewer);
    if (canvasPointerDown && canvasPointerMove && canvasPointerUp) {
      canvas.removeEventListener('pointerdown', canvasPointerDown);
      canvas.removeEventListener('pointermove', canvasPointerMove);
      canvas.removeEventListener('pointerup', canvasPointerUp);
      canvas.removeEventListener('pointercancel', canvasPointerUp);
      canvasPointerDown = null;
      canvasPointerMove = null;
      canvasPointerUp = null;
    }

    const overlay = overlayContainerRef.value;
    if (overlay && overlayPointerDown && overlayPointerMove && overlayPointerUp) {
      overlay.removeEventListener('pointerdown', overlayPointerDown);
      overlay.removeEventListener('pointermove', overlayPointerMove);
      overlay.removeEventListener('pointerup', overlayPointerUp);
      overlay.removeEventListener('pointercancel', overlayPointerUp);
      overlayPointerDown = null;
      overlayPointerMove = null;
      overlayPointerUp = null;
    }
  }

  function disposePlugins() {
    try {
      distanceMouseControl.value?.destroy();
    } catch {
      // ignore
    }
    try {
      angleMouseControl.value?.destroy();
    } catch {
      // ignore
    }
    distanceMouseControl.value = null;
    angleMouseControl.value = null;

    try {
      distancePlugin.value?.destroy();
    } catch {
      // ignore
    }
    try {
      anglePlugin.value?.destroy();
    } catch {
      // ignore
    }
    try {
      annotationsPlugin.value?.destroy();
    } catch {
      // ignore
    }

    distancePlugin.value = null;
    anglePlugin.value = null;
    annotationsPlugin.value = null;

    try {
      pointerLens.value?.destroy();
    } catch {
      // ignore
    }
    pointerLens.value = null;

    try {
      marqueePicker.value?.destroy();
    } catch {
      // ignore
    }
    try {
      objectsKdTree3.value?.destroy();
    } catch {
      // ignore
    }
    marqueePicker.value = null;
    objectsKdTree3.value = null;

    destroyObbSceneObjects();

    ready.value = false;
    resetProgress();
  }

  function pickSurface(viewer: Viewer, canvasPos: number[]): MeasurementPoint | null {
    const pickRecord = viewer.scene.pick({
      canvasPos,
      pickSurface: true,
    }) as unknown as PickRecordLike | null;

    if (!pickRecord) return null;
    const worldPos = vec3From(pickRecord.worldPos);
    const entityId = pickRecord.entity?.id ? String(pickRecord.entity.id) : null;

    if (!worldPos || !entityId) return null;
    return { entityId, worldPos };
  }

  function createDistanceMeasurement(viewer: Viewer, origin: MeasurementPoint, target: MeasurementPoint, visible: boolean): DistanceMeasurementRecord | null {
    const plugin = distancePlugin.value;
    if (!plugin) return null;

    const originEntity = viewer.scene.objects[origin.entityId];
    const targetEntity = viewer.scene.objects[target.entityId];
    if (!originEntity || !targetEntity) return null;

    const id = nowId('dist');

    const params: Parameters<DistanceMeasurementsPlugin['createMeasurement']>[0] = {
      id,
      origin: { entity: originEntity, worldPos: origin.worldPos },
      target: { entity: targetEntity, worldPos: target.worldPos },
      visible,
      wireVisible: true,
    };

    plugin.createMeasurement(params);

    return {
      id,
      kind: 'distance',
      origin,
      target,
      visible,
      createdAt: Date.now(),
    };
  }

  function createAngleMeasurement(
    viewer: Viewer,
    origin: MeasurementPoint,
    corner: MeasurementPoint,
    target: MeasurementPoint,
    visible: boolean
  ): AngleMeasurementRecord | null {
    const plugin = anglePlugin.value;
    if (!plugin) return null;

    const originEntity = viewer.scene.objects[origin.entityId];
    const cornerEntity = viewer.scene.objects[corner.entityId];
    const targetEntity = viewer.scene.objects[target.entityId];
    if (!originEntity || !cornerEntity || !targetEntity) return null;

    const id = nowId('angle');

    const params: Parameters<AngleMeasurementsPlugin['createMeasurement']>[0] = {
      id,
      origin: { entity: originEntity, worldPos: origin.worldPos },
      corner: { entity: cornerEntity, worldPos: corner.worldPos },
      target: { entity: targetEntity, worldPos: target.worldPos },
      visible,
    };

    plugin.createMeasurement(params);

    return {
      id,
      kind: 'angle',
      origin,
      corner,
      target,
      visible,
      createdAt: Date.now(),
    };
  }

  function createAnnotation(viewer: Viewer, point: MeasurementPoint): AnnotationRecord | null {
    const plugin = annotationsPlugin.value;
    if (!plugin) return null;

    const id = nowId('anno');
    const n = store.annotations.value.length + 1;

    const entity = viewer.scene.objects[point.entityId] || undefined;

    const params: Parameters<AnnotationsPlugin['createAnnotation']>[0] = {
      id,
      entity,
      worldPos: point.worldPos,
      occludable: true,
      markerShown: true,
      labelShown: true,
      values: {
        glyph: `A${n}`,
        title: `批注 ${n}`,
        description: '',
      },
    };

    plugin.createAnnotation(params);

    return {
      id,
      entityId: point.entityId,
      worldPos: point.worldPos,
      visible: true,
      glyph: `A${n}`,
      title: `批注 ${n}`,
      description: '',
      createdAt: Date.now(),
    };
  }

  function syncFromStore(viewer: Viewer) {
    if (!ready.value) return;

    ensurePlugins(viewer);
    ensureMarqueeSystems(viewer);
    attachObbDomControls(viewer);

    const dpMeasurements = (distancePlugin.value?.measurements || {}) as Record<string, { visible: boolean }>;
    const apMeasurements = (anglePlugin.value?.measurements || {}) as Record<string, { visible: boolean }>;
    const anAnnotations = (annotationsPlugin.value?.annotations || {}) as unknown as Record<string, XeokitAnnotationLike>;

    const distanceIds = new Set<string>();
    const angleIds = new Set<string>();
    const annotationIds = new Set<string>();

    for (const m of store.measurements.value) {
      if (m.kind === 'distance') {
        distanceIds.add(m.id);
        const existing = dpMeasurements[m.id];
        if (existing) {
          existing.visible = m.visible;
        } else {
          const created = createDistanceMeasurement(viewer, m.origin, m.target, m.visible);
          if (!created) {
            // ignore
          }
        }
      } else {
        angleIds.add(m.id);
        const existing = apMeasurements[m.id];
        if (existing) {
          existing.visible = m.visible;
        } else {
          const created = createAngleMeasurement(viewer, m.origin, m.corner, m.target, m.visible);
          if (!created) {
            // ignore
          }
        }
      }
    }

    const dpKeys = Object.keys(dpMeasurements);
    for (const id of dpKeys) {
      if (!distanceIds.has(id)) {
        try {
          distancePlugin.value?.destroyMeasurement(id);
        } catch {
          // ignore
        }
      }
    }

    const apKeys = Object.keys(apMeasurements);
    for (const id of apKeys) {
      if (!angleIds.has(id)) {
        try {
          anglePlugin.value?.destroyMeasurement(id);
        } catch {
          // ignore
        }
      }
    }

    for (const a of store.annotations.value) {
      annotationIds.add(a.id);
      const existing = anAnnotations[a.id];
      if (existing) {
        existing.setValues?.({ glyph: a.glyph, title: a.title, description: a.description });
        existing.setMarkerShown?.(a.visible);
        existing.setLabelShown?.(a.visible);
      } else {
        const entity = viewer.scene.objects[a.entityId] || undefined;
        try {
          const params: Parameters<AnnotationsPlugin['createAnnotation']>[0] = {
            id: a.id,
            entity,
            worldPos: a.worldPos,
            occludable: true,
            markerShown: a.visible,
            labelShown: a.visible,
            values: {
              glyph: a.glyph,
              title: a.title,
              description: a.description,
            },
          };
          annotationsPlugin.value?.createAnnotation(params);
        } catch {
          // ignore
        }
      }
    }

    const worldUp = viewer.scene.camera.worldUp as unknown as number[] | undefined;
    const up: Vec3 = worldUp && worldUp.length >= 3 ? [worldUp[0]!, worldUp[1]!, worldUp[2]!] : [0, 0, 1];

    const obbIds = new Set<string>();
    for (const o of store.obbAnnotations.value) {
      obbIds.add(o.id);

      const corners = o.obb.corners;
      const wireId = `obb_wire_${o.id}`;
      const pickId = `obb_pick_${o.id}`;
      const labelId = `obb_label_${o.id}`;
      const leaderId = `obb_leader_${o.id}`;
      obbLabels.set(o.id, labelId);
      annotationIds.add(labelId);

      const positions: number[] = [];
      for (const c of corners) {
        positions.push(c[0], c[1], c[2]);
      }
      const edgeIndices = [
        0, 1,
        1, 2,
        2, 3,
        3, 0,
        4, 5,
        5, 6,
        6, 7,
        7, 4,
        0, 4,
        1, 5,
        2, 6,
        3, 7,
      ];

      const oldWire = obbWireframes.get(o.id);
      if (oldWire) {
        try {
          oldWire.destroy();
        } catch {
          // ignore
        }
        obbWireframes.delete(o.id);
      }
      try {
        const ls = new LineSet(viewer.scene, {
          id: wireId,
          positions,
          indices: edgeIndices,
          color: [0.1, 0.9, 1.0],
          opacity: 1.0,
          visible: o.visible,
        } as ConstructorParameters<typeof LineSet>[1]);
        obbWireframes.set(o.id, ls);
      } catch {
        // ignore
      }

      const pickObj = obbPickMeshes.get(o.id);
      if (!pickObj) {
        try {
          const triIndices = [
            0, 1, 2, 0, 2, 3,
            4, 5, 6, 4, 6, 7,
            0, 1, 5, 0, 5, 4,
            1, 2, 6, 1, 6, 5,
            2, 3, 7, 2, 7, 6,
            3, 0, 4, 3, 4, 7,
          ];
          const geom = new ReadableGeometry(viewer.scene, {
            primitive: 'triangles',
            positions,
            indices: triIndices,
          } as ConstructorParameters<typeof ReadableGeometry>[1]);
          const mat = new PhongMaterial(viewer.scene, {
            diffuse: [1, 1, 1],
          } as ConstructorParameters<typeof PhongMaterial>[1]);
          const mesh = new Mesh(viewer.scene, {
            id: pickId,
            geometry: geom,
            material: mat,
            visible: o.visible,
            pickable: o.visible,
            collidable: false,
            clippable: false,
            opacity: 0.01,
            isUI: true,
          } as ConstructorParameters<typeof Mesh>[1]);
          obbPickMeshes.set(o.id, { mesh, geometry: geom, material: mat });
        } catch {
          // ignore
        }
      } else {
        try {
          pickObj.mesh.visible = o.visible;
          pickObj.mesh.pickable = o.visible;
          pickObj.geometry.positions = positions;
        } catch {
          // ignore
        }
      }

      const existingLabel = anAnnotations[labelId];
      const labelHTML = [
        '<div data-obb-id="{{obbId}}" style="max-width:260px;padding:8px 10px;border-radius:8px;background:rgba(20,20,20,0.85);color:#fff;box-shadow:0 8px 18px rgba(0,0,0,0.35);cursor:grab;">',
        '  <div style="font-weight:700;line-height:1.2;">{{title}}</div>',
        '  <div style="margin-top:4px;font-size:12px;opacity:0.95;white-space:pre-wrap;">{{description}}</div>',
        '</div>',
      ].join('');
      const markerHTML = '<div style="width:1px;height:1px;opacity:0;"></div>';
      const labelWorldPos = o.labelWorldPos;

      if (existingLabel) {
        existingLabel.setValues?.({ obbId: o.id, title: o.title, description: o.description });
        existingLabel.setMarkerShown?.(o.visible);
        existingLabel.setLabelShown?.(o.visible);
        try {
          existingLabel.worldPos = labelWorldPos;
        } catch {
          // ignore
        }
      } else {
        try {
          const params: Parameters<AnnotationsPlugin['createAnnotation']>[0] = {
            id: labelId,
            occludable: true,
            markerShown: o.visible,
            labelShown: o.visible,
            markerHTML,
            labelHTML,
            worldPos: labelWorldPos,
            values: {
              obbId: o.id,
              title: o.title,
              description: o.description,
            },
          };
          annotationsPlugin.value?.createAnnotation(params);
        } catch {
          // ignore
        }
      }

      const oldLeader = obbLeaders.get(o.id);
      if (oldLeader) {
        try {
          oldLeader.destroy();
        } catch {
          // ignore
        }
        obbLeaders.delete(o.id);
      }
      try {
        const leaderStart = topCenterFromCorners(corners, up);
        const leader = new LineSet(viewer.scene, {
          id: leaderId,
          positions: [
            leaderStart[0], leaderStart[1], leaderStart[2],
            labelWorldPos[0], labelWorldPos[1], labelWorldPos[2],
          ],
          indices: [0, 1],
          color: [1, 1, 0],
          opacity: 1.0,
          visible: o.visible,
        } as ConstructorParameters<typeof LineSet>[1]);
        obbLeaders.set(o.id, leader);
      } catch {
        // ignore
      }
    }

    for (const [id, obj] of obbWireframes.entries()) {
      if (!obbIds.has(id)) {
        try {
          obj.destroy();
        } catch {
          // ignore
        }
        obbWireframes.delete(id);
      }
    }
    for (const [id, obj] of obbLeaders.entries()) {
      if (!obbIds.has(id)) {
        try {
          obj.destroy();
        } catch {
          // ignore
        }
        obbLeaders.delete(id);
      }
    }
    for (const [id, obj] of obbPickMeshes.entries()) {
      if (!obbIds.has(id)) {
        try {
          obj.mesh.destroy();
        } catch {
          // ignore
        }
        try {
          obj.geometry.destroy();
        } catch {
          // ignore
        }
        try {
          obj.material.destroy();
        } catch {
          // ignore
        }
        obbPickMeshes.delete(id);
      }
    }

    const anKeys = Object.keys(anAnnotations);
    for (const id of anKeys) {
      if (!annotationIds.has(id)) {
        try {
          annotationsPlugin.value?.destroyAnnotation(id);
        } catch {
          // ignore
        }
      }
    }
  }

  function onClick(canvasPos: number[]) {
    const viewer = viewerRef.value;
    if (!viewer) return;
    if (!ready.value) return;

    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    let pickedId: string | null = null;
    try {
      const pick = viewer.scene.pick({ canvasPos }) as unknown as { entity?: { id?: string } } | null;
      pickedId = pick?.entity?.id ? String(pick.entity.id) : null;
      if (pickedId && pickedId.startsWith('obb_pick_')) {
        const obbId = pickedId.replace(/^obb_pick_/, '');
        store.activeObbAnnotationId.value = obbId;
        return;
      }
    } catch {
      // ignore
    }

    const mode = store.toolMode.value;

    if (mode === 'none') {
      const inputAny = viewer.scene.input as unknown as { shiftDown?: boolean; ctrlDown?: boolean };
      const additive = !!inputAny.shiftDown || !!inputAny.ctrlDown;
      const objectId = pickedId ? resolveSceneObjectId(viewer, pickedId) : null;
      const pickedObject = objectId ? viewer.scene.objects[objectId] : null;

      if (!objectId || !pickedObject) {
        clearSceneSelection(viewer);
        selection.clearSelection();
        return;
      }

      if (!additive) {
        clearSceneSelection(viewer);
        viewer.scene.setObjectsSelected([objectId], true);
      } else {
        const curSelected = new Set(viewer.scene.selectedObjectIds || []);
        viewer.scene.setObjectsSelected([objectId], !curSelected.has(objectId));
      }

      syncSelectionStoreFromScene(viewer);
      return;
    }

    if (mode === 'annotation_obb') {
      return;
    }

    if (mode === 'pick_query_center') {
      const p = pickSurface(viewer, canvasPos);
      if (p) {
        store.setPickedQueryCenter({
          worldPos: p.worldPos,
          entityId: p.entityId,
        });
        store.setToolMode('none');
      }
      return;
    }

    // 测量模式下不手动处理点击，由 MouseControl 接管
    if (mode === 'measure_distance' || mode === 'measure_angle') {
      return;
    }

    const p = pickSurface(viewer, canvasPos);
    if (!p) return;

    const created = createAnnotation(viewer, p);
    if (created) {
      store.addAnnotation(created);
    }
  }

  function flyToMeasurement(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const rec = store.measurements.value.find((m) => m.id === id);
    if (!rec) return;

    const points: Vec3[] = [];
    if (rec.kind === 'distance') {
      points.push(rec.origin.worldPos, rec.target.worldPos);
    } else {
      points.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos);
    }

    const aabb = aabbFromPoints(points);
    if (!aabb) return;

    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 } as unknown as Record<string, unknown>);
  }

  function flyToAnnotation(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const rec = store.annotations.value.find((a) => a.id === id);
    if (!rec) return;

    const aabb = aabbFromPoints([rec.worldPos]);
    if (!aabb) return;

    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 } as unknown as Record<string, unknown>);
  }

  function flyToObbAnnotation(id: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    const rec = store.obbAnnotations.value.find((a) => a.id === id);
    if (!rec) return;

    const aabb = aabbFromPoints(rec.obb.corners as unknown as Vec3[]);
    if (!aabb) return;

    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 } as unknown as Record<string, unknown>);
  }

  function removeMeasurement(id: string) {
    try {
      distancePlugin.value?.destroyMeasurement(id);
    } catch {
      // ignore
    }
    try {
      anglePlugin.value?.destroyMeasurement(id);
    } catch {
      // ignore
    }
    store.removeMeasurement(id);
  }

  function removeAnnotation(id: string) {
    try {
      annotationsPlugin.value?.destroyAnnotation(id);
    } catch {
      // ignore
    }
    store.removeAnnotation(id);
  }

  function removeObbAnnotation(id: string) {
    const labelId = `obb_label_${id}`;
    try {
      annotationsPlugin.value?.destroyAnnotation(labelId);
    } catch {
      // ignore
    }

    const wire = obbWireframes.get(id);
    if (wire) {
      try {
        wire.destroy();
      } catch {
        // ignore
      }
      obbWireframes.delete(id);
    }

    const leader = obbLeaders.get(id);
    if (leader) {
      try {
        leader.destroy();
      } catch {
        // ignore
      }
      obbLeaders.delete(id);
    }

    const pickObj = obbPickMeshes.get(id);
    if (pickObj) {
      try {
        pickObj.mesh.destroy();
      } catch {
        // ignore
      }
      try {
        pickObj.geometry.destroy();
      } catch {
        // ignore
      }
      try {
        pickObj.material.destroy();
      } catch {
        // ignore
      }
      obbPickMeshes.delete(id);
    }

    obbLabels.delete(id);
    store.removeObbAnnotation(id);
  }

  function clearAllInScene() {
    try {
      distancePlugin.value?.clear();
    } catch {
      // ignore
    }
    try {
      anglePlugin.value?.clear();
    } catch {
      // ignore
    }
    try {
      annotationsPlugin.value?.clear();
    } catch {
      // ignore
    }

    destroyObbSceneObjects();
    store.clearAll();
    resetProgress();
  }

  let mouseClickedSubId: string | null = null;
  let modelLoadedSubId: string | null = null;

  function attachInput(viewer: Viewer) {
    if (mouseClickedSubId) return;
    mouseClickedSubId = viewer.scene.input.on('mouseclicked', (coords: number[]) => {
      onClick(coords);
    });
  }

  function detachInput(viewer: Viewer) {
    if (!mouseClickedSubId) return;
    try {
      viewer.scene.input.off(mouseClickedSubId);
    } catch {
      // ignore
    }
    mouseClickedSubId = null;
    resetProgress();
  }

  function attachModelLoaded(viewer: Viewer) {
    if (modelLoadedSubId) return;
    ready.value = false;
    modelLoadedSubId = viewer.scene.on('modelLoaded', () => {
      if (ready.value) return;
      ready.value = true;
      configureSelectionMaterial(viewer);
      syncFromStore(viewer);
    });
  }

  function detachModelLoaded(viewer: Viewer) {
    if (!modelLoadedSubId) return;
    try {
      viewer.scene.off(modelLoadedSubId);
    } catch {
      // ignore
    }
    modelLoadedSubId = null;
    ready.value = false;
  }

  watch(
    () => viewerRef.value,
    (viewer, prev) => {
      if (prev) {
        detachInput(prev);
        detachModelLoaded(prev);
        detachObbDomControls(prev);
      }
      disposePlugins();

      selectionMaterialConfigured = false;

      if (!viewer) return;
      ensurePlugins(viewer);
      attachModelLoaded(viewer);

      attachInput(viewer);
    },
    { immediate: true }
  );

  watch(
    () => store.toolMode.value,
    (mode, prevMode) => {
      resetProgress();

      // 停用之前的 MouseControl
      if (prevMode === 'measure_distance') {
        try {
          distanceMouseControl.value?.deactivate();
        } catch {
          // ignore
        }
      } else if (prevMode === 'measure_angle') {
        try {
          angleMouseControl.value?.deactivate();
        } catch {
          // ignore
        }
      }

      // 激活当前的 MouseControl
      if (mode === 'measure_distance') {
        try {
          distanceMouseControl.value?.activate();
        } catch {
          // ignore
        }
      } else if (mode === 'measure_angle') {
        try {
          angleMouseControl.value?.activate();
        } catch {
          // ignore
        }
      }
    },
    { immediate: true }
  );

  watch(
    () => ({ measurements: store.measurements.value, annotations: store.annotations.value, obbAnnotations: store.obbAnnotations.value }),
    () => {
      const viewer = viewerRef.value;
      if (!viewer) return;
      if (!ready.value) return;
      syncFromStore(viewer);
    },
    { deep: true }
  );

  return {
    ready,
    statusText,

    syncFromStore: () => {
      const viewer = viewerRef.value;
      if (!viewer) return;
      syncFromStore(viewer);
    },

    flyToMeasurement,
    flyToAnnotation,
    flyToObbAnnotation,

    removeMeasurement,
    removeAnnotation,
    removeObbAnnotation,

    clearAllInScene,
  };
}
