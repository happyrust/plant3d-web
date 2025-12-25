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
  math,
  type Viewer,
} from '@xeokit/xeokit-sdk';

import { dockActivatePanelIfExists, dockPanelExists } from '@/composables/useDockApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import {
  useToolStore,
  type AngleMeasurementRecord,
  type AnnotationRecord,
  type CloudAnnotationRecord,
  type DistanceMeasurementRecord,
  type MeasurementPoint,
  type Obb,
  type ObbAnnotationRecord,
  type Vec3,
} from '@/composables/useToolStore';

type PickRecordLike = {
  entity?: { id?: string };
  worldPos?: number[];
  worldNormal?: number[];
  primIndex?: number;
  bary?: number[];
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

function distSquared3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Result of closest point query
type ClosestPointResult = {
  worldPos: Vec3;
  distance: number;
};

function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): ClosestPointResult {
  // Edge vectors
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const ap = sub3(p, a);

  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);

  if (d1 <= 0 && d2 <= 0) {
    // Vertex A
    return { worldPos: a, distance: Math.sqrt(distSquared3(p, a)) };
  }

  const bp = sub3(p, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);

  if (d3 >= 0 && d4 <= d3) {
    // Vertex B
    return { worldPos: b, distance: Math.sqrt(distSquared3(p, b)) };
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    // Edge AB
    const v = d1 / (d1 - d3);
    const closest = add3(a, mul3s(ab, v));
    return { worldPos: closest, distance: Math.sqrt(distSquared3(p, closest)) };
  }

  const cp = sub3(p, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);

  if (d6 >= 0 && d5 <= d6) {
    // Vertex C
    return { worldPos: c, distance: Math.sqrt(distSquared3(p, c)) };
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    // Edge AC
    const w = d2 / (d2 - d6);
    const closest = add3(a, mul3s(ac, w));
    return { worldPos: closest, distance: Math.sqrt(distSquared3(p, closest)) };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    // Edge BC
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const closest = add3(b, mul3s(sub3(c, b), w));
    return { worldPos: closest, distance: Math.sqrt(distSquared3(p, closest)) };
  }

  // Face region
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const closest = add3(a, add3(mul3s(ab, v), mul3s(ac, w)));
  return { worldPos: closest, distance: Math.sqrt(distSquared3(p, closest)) };
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

function getClosestPointOnEntity(entity: any, p: Vec3): ClosestPointResult | null {
  if (!entity) return null;

  // Try to get geometry
  let geometry = entity.geometry;
  let worldMatrix = entity.worldMatrix;

  // If entity has mesh (common in some versions)
  if (!geometry && entity.mesh) {
    geometry = entity.mesh.geometry;
  }

  // Handle various geometry locations in xeokit objects
  if (!geometry && entity._mesh) {
    geometry = entity._mesh.geometry;
  }

  if (!geometry || !geometry.positions) {
    console.warn('Measurement: No geometry positions found for entity', entity.id);
    return null;
  }

  const positions = geometry.positions;
  const indices = geometry.indices;

  let closest: ClosestPointResult = { worldPos: [0, 0, 0], distance: Infinity };

  // Helper to get world pos of vertex i
  const getV = (i: number): Vec3 => {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    if (worldMatrix) {
      const w = worldMatrix;
      const wx = w[0] * x + w[4] * y + w[8] * z + w[12];
      const wy = w[1] * x + w[5] * y + w[9] * z + w[13];
      const wz = w[2] * x + w[6] * y + w[10] * z + w[14];
      return [wx, wy, wz];
    }
    return [x, y, z];
  };

  if (indices) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = getV(indices[i]);
      const b = getV(indices[i + 1]);
      const c = getV(indices[i + 2]);
      const res = closestPointOnTriangle(p, a, b, c);
      if (res.distance < closest.distance) {
        closest = res;
      }
    }
  } else {
    for (let i = 0; i < positions.length / 3; i += 3) {
      const a = getV(i * 3);
      const b = getV(i * 3 + 1);
      const c = getV(i * 3 + 2);
      const res = closestPointOnTriangle(p, a, b, c);
      if (res.distance < closest.distance) {
        closest = res;
      }
    }
  }

  return closest.distance === Infinity ? null : closest;
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

  // State for Point-to-Refno measurement
  const pointToRefnoStart = ref<{
    entityId: string;
    worldPos: Vec3;
  } | null>(null);

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


    if (mode === 'measure_point_to_object') {
      if (!pointToRefnoStart.value) {
        return '点到面测量：请点击选择起始点';
      }
      return '点到面测量：请点击选择目标对象（自动计算最近距离）';
    }

    return '批注：点击模型表面创建';
  });

  function resetProgress() {
    progressPoints.value = [];
    pointToRefnoStart.value = null; // Reset custom tool state
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

    selection.setSelectedRefno(refno);
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
        '<div style="position:absolute;max-width:260px;padding:8px 10px;border-radius:8px;background:rgba(20,20,20,0.85);color:#fff;box-shadow:0 8px 18px rgba(0,0,0,0.35);">',
        '  <div style="font-weight:700;line-height:1.2;">{{title}}</div>',
        '  <div style="margin-top:4px;font-size:12px;opacity:0.95;white-space:pre-wrap;">{{description}}</div>',
        '</div>',
      ].join('');

      const markerHTML = [
        '<div style="position:absolute;display:flex;flex-direction:column;align-items:center;transform:translate(-50%, -100%);cursor:pointer;">',
        '  <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);">',
        '    <span style="transform:rotate(45deg);color:#fff;font-size:11px;font-weight:700;">{{glyph}}</span>',
        '  </div>',
        '  <div style="width:3px;height:8px;background:linear-gradient(to bottom,#991b1b,#7f1d1d);margin-top:-2px;border-radius:0 0 2px 2px;"></div>',
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

      // 文字批注图钉点击事件：单击选中，双击编辑
      let lastMarkerClickTime = 0;
      let lastMarkerClickId: string | null = null;

      annotationsPlugin.value.on('markerClicked', (annotation: { id?: string }) => {
        console.log('[AnnotationClick] markerClicked event fired', annotation);
        const id = annotation.id;
        if (!id) {
          console.log('[AnnotationClick] No id in annotation, returning');
          return;
        }

        // 只处理文字批注（ID 以 anno_xxx 格式，不是 obb_label_ 开头的）
        if (id.startsWith('obb_label_')) {
          console.log('[AnnotationClick] OBB label clicked, skipping');
          return;
        }

        const now = Date.now();
        const isDoubleClick = lastMarkerClickId === id && (now - lastMarkerClickTime) < 300;
        console.log('[AnnotationClick] id:', id, 'isDoubleClick:', isDoubleClick);

        if (isDoubleClick) {
          // 双击 -> 弹出编辑框
          console.log('[AnnotationClick] Double click -> opening edit dialog');
          store.pendingTextAnnotationEditId.value = id;
          lastMarkerClickTime = 0;
          lastMarkerClickId = null;
        } else {
          // 单击 -> 选中批注
          console.log('[AnnotationClick] Single click -> selecting annotation');
          store.activeAnnotationId.value = id;
          store.activeCloudAnnotationId.value = null;
          store.activeRectAnnotationId.value = null;
          store.activeObbAnnotationId.value = null;
          lastMarkerClickTime = now;
          lastMarkerClickId = id;
        }

        // 阻止事件继续传播引发创建新批注
        suppressNextClick = true;
        console.log('[AnnotationClick] suppressNextClick set to true');
      });
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
  let obbMarqueeBox: HTMLDivElement | null = null;
  let suppressNextClick = false;
  let obbEditPopup: HTMLDivElement | null = null;
  let obbEditPopupId: string | null = null;

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
        return [e.clientX - rect.left, e.clientY - rect.top];
      };

      const ensureMarqueeBox = () => {
        if (obbMarqueeBox && obbMarqueeBox.parentElement !== overlay) {
          obbMarqueeBox.remove();
          obbMarqueeBox = null;
        }
        if (!obbMarqueeBox) {
          obbMarqueeBox = document.createElement('div');
          obbMarqueeBox.style.position = 'absolute';
          obbMarqueeBox.style.left = '0px';
          obbMarqueeBox.style.top = '0px';
          obbMarqueeBox.style.width = '0px';
          obbMarqueeBox.style.height = '0px';
          obbMarqueeBox.style.display = 'none';
          obbMarqueeBox.style.boxSizing = 'border-box';
          obbMarqueeBox.style.border = '2px dashed #333';
          obbMarqueeBox.style.background = 'rgba(0,0,0,0.06)';
          obbMarqueeBox.style.pointerEvents = 'none';
          overlay.appendChild(obbMarqueeBox);
        }
        return obbMarqueeBox;
      };

      canvasPointerDown = (e: PointerEvent) => {
        const mode = store.toolMode.value;
        if (mode !== 'annotation_obb' && mode !== 'annotation_cloud') return;
        // 允许左键和右键事件，左键用于拖拽创建批注，右键用于相机旋转
        if (e.button !== 0 && e.button !== 2) return;
        if (!ready.value) return;

        // 右键事件不处理拖拽逻辑，直接返回让相机控制处理
        if (e.button === 2) {
          return;
        }

        ensureMarqueeSystems(viewer);
        if (!marqueePicker.value) return;

        dragging = true;
        const startPos = getCanvasPos(e);
        start = startPos;
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
        marqueePicker.value.setMarqueeCorner1(startPos);
        marqueePicker.value.setMarqueeCorner2(startPos);
        marqueePicker.value.setMarqueeVisible(false);

        const box = ensureMarqueeBox();
        box.style.display = 'block';
        // 云线模式使用红色波浪边框
        if (mode === 'annotation_cloud') {
          box.style.border = '3px solid #dc2626';
          box.style.borderRadius = '8px';
          box.style.background = 'rgba(220, 38, 38, 0.08)';
          box.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)';
        } else {
          box.style.border = '2px dashed #333';
          box.style.borderRadius = '0';
          box.style.background = 'rgba(0,0,0,0.06)';
          box.style.boxShadow = 'none';
        }
        box.style.left = `${startPos[0]}px`;
        box.style.top = `${startPos[1]}px`;
        box.style.width = '0px';
        box.style.height = '0px';
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

        const box = ensureMarqueeBox();
        box.style.display = 'block';
        const isCloud = store.toolMode.value === 'annotation_cloud';
        if (isCloud) {
          box.style.border = '3px solid #dc2626';
          box.style.borderRadius = '8px';
          box.style.background = 'rgba(220, 38, 38, 0.08)';
          box.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)';
        } else {
          box.style.border = dx >= 0 ? '2px dashed #333' : '2px solid #333';
          box.style.borderRadius = '0';
          box.style.background = 'rgba(0,0,0,0.06)';
          box.style.boxShadow = 'none';
        }
        const left = Math.min(start[0], cur[0]);
        const top = Math.min(start[1], cur[1]);
        const width = Math.abs(cur[0] - start[0]);
        const height = Math.abs(cur[1] - start[1]);
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
      };

      canvasPointerUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;

        if (obbMarqueeBox) {
          obbMarqueeBox.style.display = 'none';
        }
        const picker = marqueePicker.value;
        const startPos = start;
        start = null;
        if (picker) {
          picker.setMarqueeVisible(false);
          try {
            const picked = picker.pick() || [];
            const additive = e.ctrlKey || e.metaKey;
            lastPicked = additive ? Array.from(new Set([...lastPicked, ...picked])) : picked;

            // 高亮被框选的模型
            if (!additive) {
              clearSceneSelection(viewer);
            }
            if (lastPicked.length > 0) {
              viewer.scene.setObjectsSelected(lastPicked, true);
            }

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
        downPos: [number, number];
        moved: boolean;
      } | null = null;

      // 双击检测变量
      let lastClickTime = 0;
      let lastClickObbId: string | null = null;

      const getCanvasPos = (e: PointerEvent): [number, number] => {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      };

      const findObbId = (target: EventTarget | null): string | null => {
        const el = target instanceof Element ? target.closest('[data-obb-id]') : null;
        if (!el) return null;
        if (target instanceof Element && target.closest('[data-obb-edit-popup]')) return null;
        const v = el.getAttribute('data-obb-id');
        return v ? String(v) : null;
      };

      const hideObbEditPopup = () => {
        if (obbEditPopup) {
          try {
            obbEditPopup.remove();
          } catch {
            // ignore
          }
        }
        obbEditPopup = null;
        obbEditPopupId = null;
      };

      const showObbEditPopup = (obbId: string) => {
        const viewer = viewerRef.value;
        if (!viewer) return;
        const rec = store.obbAnnotations.value.find((r) => r.id === obbId);
        if (!rec) return;

        const labelAnnoId = `obb_label_${obbId}`;
        const anno = (annotationsPlugin.value?.annotations || ({} as Record<string, unknown>))[labelAnnoId] as XeokitAnnotationLike | undefined;
        const annoWorldPos = anno?.worldPos ? vec3From(anno.worldPos) : null;
        if (!annoWorldPos) return;

        if (obbEditPopupId && obbEditPopupId !== obbId) {
          hideObbEditPopup();
        }

        if (!obbEditPopup) {
          const el = document.createElement('div');
          el.setAttribute('data-obb-edit-popup', '1');
          el.style.position = 'absolute';
          el.style.zIndex = '2200';
          el.style.minWidth = '260px';
          el.style.maxWidth = '320px';
          el.style.padding = '10px';
          el.style.borderRadius = '10px';
          el.style.border = '1px solid rgba(0,0,0,0.15)';
          el.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(245,245,245,0.98) 100%)';
          el.style.boxShadow = '0 10px 22px rgba(0,0,0,0.18), 0 1px 0 rgba(255,255,255,0.5) inset';
          el.style.backdropFilter = 'blur(6px)';
          el.style.pointerEvents = 'auto';

          const title = document.createElement('input');
          title.type = 'text';
          title.style.width = '100%';
          title.style.boxSizing = 'border-box';
          title.style.padding = '6px 8px';
          title.style.border = '1px solid rgba(0,0,0,0.18)';
          title.style.borderRadius = '8px';
          title.style.outline = 'none';
          title.style.fontSize = '13px';
          title.style.fontWeight = '600';

          const desc = document.createElement('textarea');
          desc.rows = 4;
          desc.style.width = '100%';
          desc.style.boxSizing = 'border-box';
          desc.style.marginTop = '8px';
          desc.style.padding = '6px 8px';
          desc.style.border = '1px solid rgba(0,0,0,0.18)';
          desc.style.borderRadius = '8px';
          desc.style.outline = 'none';
          desc.style.fontSize = '12px';
          desc.style.resize = 'vertical';

          const btnRow = document.createElement('div');
          btnRow.style.display = 'flex';
          btnRow.style.gap = '8px';
          btnRow.style.justifyContent = 'flex-end';
          btnRow.style.marginTop = '10px';

          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = '取消';
          cancel.style.padding = '6px 10px';
          cancel.style.borderRadius = '8px';
          cancel.style.border = '1px solid rgba(0,0,0,0.15)';
          cancel.style.background = 'rgba(255,255,255,0.9)';
          cancel.style.cursor = 'pointer';

          const save = document.createElement('button');
          save.type = 'button';
          save.textContent = '保存';
          save.style.padding = '6px 10px';
          save.style.borderRadius = '8px';
          save.style.border = '1px solid rgba(0,0,0,0.18)';
          save.style.background = 'linear-gradient(135deg,#f59e0b 0%,#d97706 100%)';
          save.style.color = '#fff';
          save.style.cursor = 'pointer';

          btnRow.appendChild(cancel);
          btnRow.appendChild(save);
          el.appendChild(title);
          el.appendChild(desc);
          el.appendChild(btnRow);

          cancel.addEventListener('click', (ev) => {
            ev.stopPropagation();
            hideObbEditPopup();
          });
          save.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (obbEditPopupId) {
              store.updateObbAnnotation(obbEditPopupId, {
                title: title.value || 'OBB 批注',
                description: desc.value || '',
              });
            }
            hideObbEditPopup();
          });
          el.addEventListener('pointerdown', (ev) => {
            ev.stopPropagation();
          });

          overlay.appendChild(el);
          obbEditPopup = el;

          (obbEditPopup as unknown as { _titleInput?: HTMLInputElement })._titleInput = title;
          (obbEditPopup as unknown as { _descInput?: HTMLTextAreaElement })._descInput = desc;
        }

        obbEditPopupId = obbId;
        const titleInput = (obbEditPopup as unknown as { _titleInput?: HTMLInputElement })._titleInput;
        const descInput = (obbEditPopup as unknown as { _descInput?: HTMLTextAreaElement })._descInput;
        if (titleInput) titleInput.value = rec.title || 'OBB 批注';
        if (descInput) descInput.value = rec.description || '';

        const p = cameraProjectWorldPos(viewer.scene.camera, annoWorldPos);
        obbEditPopup.style.left = `${Math.round(p[0] + 16)}px`;
        obbEditPopup.style.top = `${Math.round(p[1] - 10)}px`;
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
        if (!obbId) {
          if (obbEditPopup && !(e.target instanceof Element && e.target.closest('[data-obb-edit-popup]'))) {
            hideObbEditPopup();
          }
          return;
        }
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
        draggingLabel = { obbId, screenZ, offset, downPos: canvasPos, moved: false };
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

        const { obbId, screenZ, offset, downPos } = draggingLabel;
        const labelAnnoId = `obb_label_${obbId}`;
        const anno = (annotationsPlugin.value?.annotations || ({} as Record<string, unknown>))[labelAnnoId] as XeokitAnnotationLike | undefined;
        if (!anno) return;

        const canvasPos = getCanvasPos(e);
        const dx = canvasPos[0] - downPos[0];
        const dy = canvasPos[1] - downPos[1];
        if (!draggingLabel.moved && Math.hypot(dx, dy) < 4) {
          return;
        }
        draggingLabel.moved = true;
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
        const { obbId, moved } = draggingLabel;
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

        if (!moved) {
          // 双击检测：300ms 内对同一图钉的两次点击才会弹出编辑框
          const now = Date.now();
          const isDoubleClick = lastClickObbId === obbId && (now - lastClickTime) < 300;

          if (isDoubleClick) {
            // 双击 -> 弹出编辑框
            showObbEditPopup(obbId);
            lastClickTime = 0;
            lastClickObbId = null;
          } else {
            // 单击 -> 仅选中，记录时间用于双击检测
            lastClickTime = now;
            lastClickObbId = obbId;
          }
          return;
        }

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

    if (obbMarqueeBox) {
      obbMarqueeBox.remove();
      obbMarqueeBox = null;
    }
  }

  function disposePlugins() {
    if (obbMarqueeBox) {
      obbMarqueeBox.remove();
      obbMarqueeBox = null;
    }
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
    const pickRecord = pickSurfaceRecord(viewer, canvasPos);
    if (!pickRecord) return null;
    const worldPos = vec3From(pickRecord.worldPos);
    const entityId = pickRecord.entity?.id ? String(pickRecord.entity.id) : null;

    if (!worldPos || !entityId) return null;
    return { entityId, worldPos };
  }

  function pickSurfaceRecord(viewer: Viewer, canvasPos: number[]): PickRecordLike | null {
    const pickRecord = viewer.scene.pick({
      canvasPos,
      pickSurface: true,
    }) as unknown as PickRecordLike | null;

    return pickRecord;
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

  function createAnnotation(viewer: Viewer, pickRecord: PickRecordLike): AnnotationRecord | null {
    const plugin = annotationsPlugin.value;
    if (!plugin) return null;

    const entityId = pickRecord.entity?.id ? String(pickRecord.entity.id) : null;
    const worldPos = vec3From(pickRecord.worldPos);
    if (!entityId || !worldPos) return null;

    const id = nowId('anno');
    const n = store.annotations.value.length + 1;

    // 获取关联的 refno
    const refno = resolveRefnoFromSceneId(viewer, entityId);

    // 使用 pickRecord 参数让 xeokit 自动处理位置和表面偏移
    const params: Parameters<AnnotationsPlugin['createAnnotation']>[0] = {
      id,
      pickResult: pickRecord as unknown as Parameters<AnnotationsPlugin['createAnnotation']>[0]['pickResult'],
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
      entityId,
      worldPos,
      visible: true,
      glyph: `A${n}`,
      title: `批注 ${n}`,
      description: '',
      createdAt: Date.now(),
      refno: refno || undefined,
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

      const isActive = store.activeObbAnnotationId.value === o.id;

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
        '<div data-obb-id="{{obbId}}" style="position:absolute;max-width:320px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.25);background:linear-gradient(180deg, rgba(30,30,30,0.92) 0%, rgba(12,12,12,0.88) 100%);color:#fff;box-shadow:0 12px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.06) inset;backdrop-filter:blur(6px);cursor:pointer;">',
        '  <div style="font-weight:700;line-height:1.2;display:flex;align-items:center;gap:8px;">',
        '    <span style="display:inline-flex;width:18px;height:18px;border-radius:6px;background:rgba(245,158,11,0.22);align-items:center;justify-content:center;">📌</span>',
        '    <span style="flex:1;min-width:0;">{{title}}</span>',
        '  </div>',
        '  <div style="margin-top:6px;font-size:12px;opacity:0.95;white-space:pre-wrap;">{{description}}</div>',
        '  <div style="margin-top:6px;font-size:11px;opacity:0.72;">点击编辑，拖拽移动</div>',
        '</div>',
      ].join('');
      // 图钉样式的 marker
      const markerHTML = [
        '<div data-obb-id="{{obbId}}" style="position:absolute;display:flex;flex-direction:column;align-items:center;transform:translateY(-50%);cursor:pointer;">',
        '  <div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);">',
        '    <span style="transform:rotate(45deg);color:#fff;font-size:14px;">📌</span>',
        '  </div>',
        '  <div style="width:3px;height:8px;background:linear-gradient(to bottom,#92400e,#78350f);margin-top:-2px;border-radius:0 0 2px 2px;"></div>',
        '</div>',
      ].join('');
      const labelWorldPos = o.labelWorldPos;

      const labelValues = {
        obbId: o.id,
        title: o.title || 'OBB 批注',
        description: o.description ? o.description : '点击图钉添加文字描述…',
      };

      if (existingLabel) {
        const isV2 = (existingLabel as unknown as { _obbOverlayV2?: boolean })._obbOverlayV2 === true;
        if (!isV2) {
          try {
            (existingLabel as unknown as { destroy?: () => void }).destroy?.();
          } catch {
            // ignore
          }
          try {
            const params: Parameters<AnnotationsPlugin['createAnnotation']>[0] = {
              id: labelId,
              occludable: false,
              markerShown: o.visible,
              labelShown: isActive && o.visible,
              markerHTML,
              labelHTML,
              worldPos: labelWorldPos,
              values: labelValues,
            };
            const newLabel = annotationsPlugin.value?.createAnnotation(params);
            if (newLabel) {
              (newLabel as unknown as { _obbOverlayV2?: boolean })._obbOverlayV2 = true;
            }
          } catch {
            // ignore
          }
        } else {
          existingLabel.setValues?.(labelValues);
          existingLabel.setMarkerShown?.(o.visible);
          existingLabel.setLabelShown?.(isActive && o.visible);
          try {
            existingLabel.worldPos = labelWorldPos;
          } catch {
            // ignore
          }
        }
      } else {
        try {
          const params: Parameters<AnnotationsPlugin['createAnnotation']>[0] = {
            id: labelId,
            occludable: false,
            markerShown: o.visible,
            labelShown: isActive && o.visible,
            markerHTML,
            labelHTML,
            worldPos: labelWorldPos,
            values: labelValues,
          };
          const newLabel = annotationsPlugin.value?.createAnnotation(params);
          if (newLabel) {
            (newLabel as unknown as { _obbOverlayV2?: boolean })._obbOverlayV2 = true;
          }
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

  function handlePointToRefnoClick(input: { entityId?: string, worldPos?: Vec3, viewer: Viewer }) {
    if (!input.entityId || !input.worldPos) return;

    // Step 1: Pick start point
    if (!pointToRefnoStart.value) {
      pointToRefnoStart.value = {
        entityId: input.entityId,
        worldPos: input.worldPos
      };

      // Visual feedback: create a temporary marker at start point
      // (Optional: for now we rely on the wizard status text)
      return;
    }

    // Step 2: Pick target object
    const start = pointToRefnoStart.value;
    const targetEntityId = input.entityId;

    // Prevent picking same object if needed, but self-distance is valid (0)

    const scene = input.viewer.scene;
    const targetEntity = scene.objects[targetEntityId];
    if (!targetEntity) return;

    // Calculate distance
    const result = getClosestPointOnEntity(targetEntity, start.worldPos);

    if (result) {
      const p1 = start.worldPos;
      const p2 = result.worldPos;
      const dist = Math.sqrt(distSquared3(p1, p2));
      const mid = mul3s(add3(p1, p2), 0.5);

      const id = nowId('measure_ptr');

      // Draw Line using LineSet
      // We essentially "manually" draw the line, but to persist it we use the store.
      // However, the store relies on `createDistanceMeasurement` which uses the plugin.
      // The plugin draws a standard line.
      // If we want "CAD style", we might need to create a custom visual.
      // For this implementation, I will stick to the store management for persistence 
      // but I will ALSO create an annotation for the "CAD label" if the plugin doesn't look right.
      // But actually, `DistanceMeasurementRecord` in the store triggers `createDistanceMeasurement`.
      // `createDistanceMeasurement` uses `DistanceMeasurementsPlugin`.
      // `DistanceMeasurementsPlugin` draws the line and label.
      // So effectively, using the store IS the standard way.
      // The ONLY difference in "Point-to-Object" is HOW we calculate the endpoints.
      // Once calculated, it is just a distance measurement between two points.
      // CAD styling (arrows) is a visual requirement that `DistanceMeasurementsPlugin` might not satisfy by default,
      // but customizing the plugin is out of scope for just this function logic.
      // The requirement "CAD rendering" in the plan implies I should try to improve the look if possible.
      // But `xeokit` plugins are canvas based or mesh based.
      // Let's just create the measurement record. The "CAD style" might refer to the interaction or just standard engineering look.
      // If users strictly wanted custom arrows, I'd need to manually manage `LineSet` and `Mesh` for arrows.
      // Beacuse `useXeokitTools` handles `syncFromStore`, if I add to store, it will be drawn by `DistanceMeasurementsPlugin`.
      // So I will just add to store.

      const record: DistanceMeasurementRecord = {
        id: id,
        kind: 'distance',
        origin: { entityId: start.entityId, worldPos: start.worldPos },
        target: { entityId: targetEntityId, worldPos: result.worldPos },
        visible: true,
        createdAt: Date.now(),
      };
      store.addMeasurement(record);

      // Reset
      pointToRefnoStart.value = null;
      store.setToolMode('none');
    } else {
      console.warn('Measurement failed: could not calculate closest point');
    }
  }

  function onClick(canvasPos: number[]) {
    const viewer = viewerRef.value;
    if (!viewer) return;
    if (!ready.value) return;

    const mode = store.toolMode.value;

    if (mode === 'measure_point_to_object') {
      const pick = pickSurfaceRecord(viewer, canvasPos);
      if (pick && pick.entity?.id && pick.worldPos) {
        const p = vec3From(pick.worldPos);
        if (p) {
          handlePointToRefnoClick({
            entityId: String(pick.entity.id),
            worldPos: p,
            viewer
          });
        }
      }
      return;
    }

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

    // 批注模式：使用完整的 pickRecord 让 xeokit 正确处理位置
    const pickRecord = pickSurfaceRecord(viewer, canvasPos);
    if (!pickRecord) return;

    const created = createAnnotation(viewer, pickRecord);
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

  function highlightAnnotationTarget(refno: string) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    // 触发模型显示事件，确保关联的模型已加载
    window.dispatchEvent(
      new CustomEvent('showModelByRefnos', {
        detail: { refnos: [refno], regenModel: false }
      })
    );

    // 清除当前选择
    clearSceneSelection(viewer);

    // 高亮指定对象
    if (viewer.scene.objects[refno]) {
      viewer.scene.setObjectsSelected([refno], true);

      // 飞行到对象位置
      const object = viewer.scene.objects[refno];
      if (object?.aabb) {
        const aabb = object.aabb as unknown as number[];
        if (aabb.length >= 6) {
          viewer.cameraFlight.flyTo({
            aabb: [aabb[0], aabb[1], aabb[2], aabb[3], aabb[4], aabb[5]],
            fit: true,
            duration: 0.8
          } as unknown as Record<string, unknown>);
        }
      }
    }
  }

  function highlightAnnotationTargets(refnos: string[]) {
    const viewer = viewerRef.value;
    if (!viewer) return;

    // 触发模型显示事件，确保关联的模型已加载
    if (refnos.length > 0) {
      window.dispatchEvent(
        new CustomEvent('showModelByRefnos', {
          detail: { refnos, regenModel: false }
        })
      );
    }

    // 清除当前选择
    clearSceneSelection(viewer);

    // 过滤出存在的对象
    const existingIds = refnos.filter(refno => viewer.scene.objects[refno]);

    if (existingIds.length > 0) {
      viewer.scene.setObjectsSelected(existingIds, true);

      // 计算所有对象的包围盒并飞行
      const allCorners: Vec3[] = [];
      existingIds.forEach(refno => {
        const object = viewer.scene.objects[refno];
        if (object?.aabb) {
          const aabb = object.aabb as unknown as number[];
          if (aabb.length >= 6) {
            allCorners.push(
              [aabb[0]!, aabb[1]!, aabb[2]!],
              [aabb[3]!, aabb[4]!, aabb[5]!]
            );
          }
        }
      });

      if (allCorners.length > 0) {
        const combinedAabb = aabbFromPoints(allCorners);
        if (combinedAabb) {
          viewer.cameraFlight.flyTo({
            aabb: combinedAabb,
            fit: true,
            duration: 0.8
          } as unknown as Record<string, unknown>);
        }
      }
    }
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

    highlightAnnotationTarget,
    highlightAnnotationTargets,

    clearAllInScene,
  };
}
