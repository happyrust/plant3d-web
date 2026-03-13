import { computed, ref, watch, type Ref } from 'vue';

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

import type { UseAnnotationThreeReturn } from './useAnnotationThree';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { findNounByRefnoAcrossAllDbnos, findOwnerRefnoByTubi } from '@/composables/useDbnoInstancesDtxLoader';
import { dockActivatePanelIfExists, dockPanelExists } from '@/composables/useDockApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore, type AngleMeasurementRecord, type AnnotationRecord, type CloudAnnotationRecord, type DistanceMeasurementRecord, type MeasurementPoint, type Obb, type ObbAnnotationRecord, type RectAnnotationRecord, type Vec3, type LinearDistanceDimensionRecord, type AngleDimensionRecord as AngleDimensionRecord2 } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { emitCommand } from '@/ribbon/commandBus';
import { AngleDimension3D, LinearDimension3D } from '@/utils/three/annotation';
import { computeDimensionOffsetDir } from '@/utils/three/annotation/utils/computeDimensionOffsetDir';

type DragRect = {
  active: boolean
  pointerId: number | null
  startClient: { x: number; y: number } | null
  startCanvas: { x: number; y: number } | null
  currentCanvas: { x: number; y: number } | null
}

type RectPlaneDrag = {
  active: boolean
  pointerId: number | null
  startCanvas: { x: number; y: number } | null
  plane: Plane | null
  basisU: Vector3 | null
  basisV: Vector3 | null
  startWorld: Vector3 | null
  startEntityId: string | null
}

type LabelEl = {
  id: string
  worldPos: Vector3
  el: HTMLDivElement
}

type CloudOverlayEl = {
  id: string
  worldPos: Vector3
  svg: SVGSVGElement
  path: SVGPathElement
  leaderPath: SVGPathElement
  record: CloudAnnotationRecord
}

type RectAnnotationVisual = {
  box: LineSegments
  pin: LineSegments
  leader: LineSegments
  labelWorldPos: Vector3
}

type ScreenPoint = {
  x: number
  y: number
  visible: boolean
  ndcZ: number
}

type CloudLayout = {
  cloudPath: string
  markerX: number
  markerY: number
  labelX: number
  cloudCenterX: number
  cloudCenterY: number
  labelY: number
  labelAlign: 'left' | 'right'
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function formatAngleDegrees(deg: number, precision: number): string {
  const p = Math.max(0, Math.min(6, Math.floor(Number(precision) || 0)));
  return `${deg.toFixed(p)}°`;
}

function computeDimensionOffsetDirectionByCamera(start: Vector3, end: Vector3, camera: any): Vector3 | null {
  // 保持原语义：优先按相机“屏幕直觉”计算；退化时返回 null 交由调用方 fallback。
  return computeDimensionOffsetDir(start, end, camera as any);
}

function vec3ToTuple(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const p of points) {
    const x = p[0];
    const y = p[1];
    const z = p[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) return null;
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

function parseRefnoFromDtxObjectId(objectId: string): string | null {
  if (!objectId || !objectId.startsWith('o:')) return null;
  const parts = objectId.split(':');
  return parts.length >= 3 ? (parts[1] ?? null) : null;
}

export function resolvePickedRefnoForFilter(
  pickedRefno: string,
  filter: string[],
  findNoun: (refno: string) => string | null = findNounByRefnoAcrossAllDbnos,
  findOwner: (refno: string) => string | null = findOwnerRefnoByTubi,
): string | null {
  let targetRefno = pickedRefno;
  let resolvedNoun: string | null = null;

  if (filter.includes('BRAN')) {
    const noun = findNoun(targetRefno);
    if (noun !== 'BRAN') {
      const branRefno = findOwner(targetRefno);
      if (branRefno) {
        targetRefno = branRefno;
        // 关键：owner 由 loader 侧保证为 BRAN，但 BRAN 本体可能未加载导致 findNoun 为空；
        // 在 BRAN 过滤下，这里直接视为满足过滤。
        resolvedNoun = 'BRAN';
      }
    }
  }

  if (filter.length > 0) {
    const noun = resolvedNoun || findNoun(targetRefno);
    if (!noun || !filter.includes(noun.toUpperCase())) {
      return null;
    }
  }

  return targetRefno;
}

function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new Vector2(e.clientX - rect.left, e.clientY - rect.top);
}

function worldToOverlay(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): { x: number; y: number; visible: boolean } {
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  const visible = v.z >= -1 && v.z <= 1;

  const overlayRect = overlay.getBoundingClientRect();
  return { x: x + (rect.left - overlayRect.left), y: y + (rect.top - overlayRect.top), visible };
}

function worldToOverlayPoint(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): ScreenPoint {
  const rect = canvas.getBoundingClientRect();
  const v = worldPos.clone();
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * rect.width;
  const y = (-v.y * 0.5 + 0.5) * rect.height;
  const overlayRect = overlay.getBoundingClientRect();
  return {
    x: x + (rect.left - overlayRect.left),
    y: y + (rect.top - overlayRect.top),
    visible: v.z >= -1 && v.z <= 1,
    ndcZ: v.z,
  };
}

function overlayToWorld(camera: any, canvas: HTMLCanvasElement, overlay: HTMLElement, x: number, y: number, ndcZ: number): Vector3 {
  const rect = canvas.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const localX = x - (rect.left - overlayRect.left);
  const localY = y - (rect.top - overlayRect.top);
  const ndc = new Vector3(
    (localX / rect.width) * 2 - 1,
    -((localY / rect.height) * 2 - 1),
    ndcZ,
  );
  return ndc.unproject(camera);
}

function createCloudPath(cx: number, cy: number, width: number, height: number): string {
  const rx = width * 0.5;
  const ry = height * 0.5;
  const segments = 10;
  const points: string[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const wobble = 1 + 0.12 * Math.sin(t * 6);
    const x = cx + Math.cos(t) * rx * wobble;
    const y = cy + Math.sin(t) * ry * wobble;
    points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  points.push('Z');
  return points.join(' ');
}

export function computeCloudLayout(anchorScreen: ScreenPoint, screenOffset?: { x: number; y: number }, cloudSize?: { width: number; height: number }): CloudLayout {
  const width = clamp(cloudSize?.width ?? 120, 72, 220);
  const height = clamp(cloudSize?.height ?? 72, 48, 180);
  const offsetX = screenOffset?.x ?? width * 0.5 + 26;
  const offsetY = screenOffset?.y ?? -(height * 0.5 + 18);
  const cloudCenterX = anchorScreen.x + offsetX;
  const cloudCenterY = anchorScreen.y + offsetY;
  const markerX = cloudCenterX;
  const markerY = cloudCenterY;
  const labelAlign = offsetX >= 0 ? 'left' : 'right';
  const labelOffsetX = offsetX >= 0 ? width * 0.5 + 18 : -(width * 0.5 + 18);
  return {
    cloudPath: createCloudPath(cloudCenterX, cloudCenterY, width, height),
    markerX,
    markerY,
    cloudCenterX,
    cloudCenterY,
    labelX: cloudCenterX + labelOffsetX,
    labelY: cloudCenterY,
    labelAlign,
  };
}

function resolveCloudAnchorFromMarqueeCenter(
  viewer: DtxViewer | null,
  canvas: HTMLCanvasElement,
  centerCanvas: { x: number; y: number },
  selectedRefnos: string[],
  selection: DTXSelectionController | null,
  layer: DTXLayer | null,
): Vector3 | null {
  if (!viewer || !selection || !layer || selectedRefnos.length === 0) return null;
  const hit = selection.pickPoint(new Vector2(centerCanvas.x, centerCanvas.y));
  if (!hit) return null;

  const hitRefno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId;
  if (selectedRefnos.includes(hitRefno)) {
    return hit.point.clone();
  }

  const rect = canvas.getBoundingClientRect();
  const ndc = new Vector2((centerCanvas.x / rect.width) * 2 - 1, -(centerCanvas.y / rect.height) * 2 + 1);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, viewer.camera);
  const origin = raycaster.ray.origin;
  const direction = raycaster.ray.direction;

  let closest: { point: Vector3; distance: number } | null = null;
  for (const refno of selectedRefnos) {
    const objectId = refno.startsWith('o:') ? refno : `o:${refno}:0`;
    const picked = layer.raycastObject(objectId, origin, direction);
    if (!picked) continue;
    if (!closest || picked.distance < closest.distance) {
      closest = { point: picked.point.clone(), distance: picked.distance };
    }
  }
  return closest?.point ?? null;
}

function disposeObject3d(obj: any) {
  if (!obj) return;
  try {
    if (obj.geometry) obj.geometry.dispose?.();
  } catch {
    // ignore
  }
  try {
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) m?.dispose?.();
      } else {
        obj.material.dispose?.();
      }
    }
  } catch {
    // ignore
  }
}

function clearGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3d(child as any);
  }
}

function buildWireBoxGeometryFromBox3(box: Box3): BufferGeometry {
  const min = box.min;
  const max = box.max;

  const corners = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ];

  const edgePairs = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];

  const positions: number[] = [];
  for (let i = 0; i < edgePairs.length; i += 2) {
    const a = corners[edgePairs[i]!]!;
    const b = corners[edgePairs[i + 1]!]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

function buildWireBoxGeometryFromCorners(corners: Vec3[]): BufferGeometry | null {
  if (corners.length !== 8) return null;
  const vs = corners.map((c) => new Vector3(c[0], c[1], c[2]));
  const edgePairs = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ];
  const positions: number[] = [];
  for (let i = 0; i < edgePairs.length; i += 2) {
    const a = vs[edgePairs[i]!]!;
    const b = vs[edgePairs[i + 1]!]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

function buildCrossMarkerGeometry(center: Vector3, size: number): BufferGeometry {
  const half = Math.max(size * 0.5, 1e-4);
  const positions = new Float32Array([
    center.x - half, center.y, center.z,
    center.x + half, center.y, center.z,
    center.x, center.y - half, center.z,
    center.x, center.y + half, center.z,
    center.x, center.y, center.z - half,
    center.x, center.y, center.z + half,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  return g;
}

function createRectAnnotationVisual(obb: Obb, anchorWorldPos: Vec3): RectAnnotationVisual | null {
  const boxGeometry = buildWireBoxGeometryFromCorners(obb.corners as unknown as Vec3[]);
  if (!boxGeometry) return null;

  const anchor = new Vector3(...anchorWorldPos);
  const halfSize = new Vector3(...obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildCrossMarkerGeometry(anchor, boxRadius * 0.16);

  const labelAnchor = anchor.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));
  const leaderGeometry = new BufferGeometry();
  leaderGeometry.setAttribute('position', new BufferAttribute(new Float32Array([
    anchor.x, anchor.y, anchor.z,
    labelAnchor.x, labelAnchor.y, labelAnchor.z,
  ]), 3));

  const boxMaterial = new LineBasicMaterial({ color: 0x111827 });
  const pinMaterial = new LineBasicMaterial({ color: 0x111827 });
  const leaderMaterial = new LineBasicMaterial({ color: 0x111827 });
  (boxMaterial as any).depthTest = false;
  (pinMaterial as any).depthTest = false;
  (leaderMaterial as any).depthTest = false;

  const box = new LineSegments(boxGeometry, boxMaterial);
  const pin = new LineSegments(pinGeometry, pinMaterial);
  const leader = new LineSegments(leaderGeometry, leaderMaterial);
  box.renderOrder = 900;
  pin.renderOrder = 901;
  leader.renderOrder = 901;

  return { box, pin, leader, labelWorldPos: labelAnchor };
}

export function createRectAnnotationRecordFromObb(params: {
  id?: string
  objectIds: string[]
  refnos?: string[]
  obb: Obb
  title: string
  description?: string
  createdAt?: number
}): RectAnnotationRecord {
  const center = new Vector3(...params.obb.center);
  const halfSize = new Vector3(...params.obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const leaderEnd = center.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));

  return {
    id: params.id ?? nowId('rect'),
    objectIds: [...params.objectIds],
    obb: params.obb,
    anchorWorldPos: [...params.obb.center] as Vec3,
    leaderEndWorldPos: vec3ToTuple(leaderEnd),
    visible: true,
    title: params.title,
    description: params.description ?? '',
    createdAt: params.createdAt ?? Date.now(),
    refnos: params.refnos ? [...params.refnos] : [...params.objectIds],
  };
}

function computeAabbObbFromBox3(box: Box3): Obb {
  const center = new Vector3();
  box.getCenter(center);
  const size = new Vector3();
  box.getSize(size);
  const half = size.multiplyScalar(0.5);

  const corners: Vec3[] = [
    [box.min.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.max.z],
    [box.min.x, box.max.y, box.max.z],
  ];

  return {
    center: [center.x, center.y, center.z],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfSize: [half.x, half.y, half.z],
    corners: corners as any,
  };
}

function topCenterFromBox3(box: Box3): Vector3 {
  const center = new Vector3();
  box.getCenter(center);
  return new Vector3(center.x, center.y, box.max.z);
}

function ensureDiv(parent: HTMLElement, className: string, styleText: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.style.cssText = styleText;
  parent.appendChild(el);
  return el;
}

function makeMarkerEl(parent: HTMLElement, text: string, color: string): HTMLDivElement {
  // SolveSpace 风格：透明背景、纯文本+描边、无圆形气泡
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'z-index:920',
      `color:${color}`,
      'font-family:\'Roboto Mono\',\'Consolas\',monospace',
      'font-size:12px',
      'font-weight:700',
      'background:transparent',
      'box-shadow:none',
      'border:none',
      'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000',
    ].join(';')
  );
  el.textContent = text;
  return el;
}

function makeLabelEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  // SolveSpace 风格：透明背景、纯文本
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    [
      'position:absolute',
      'transform:translate(-50%,-110%)',
      'pointer-events:auto',
      'z-index:910',
      'max-width:260px',
      'padding:2px 4px',
      'border-radius:0',
      'background:transparent',
      'color:#fff',
      'box-shadow:none',
      'white-space:pre-wrap',
      'font-family:\'Roboto Mono\',\'Consolas\',monospace',
      'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000',
    ].join(';')
  );
  el.innerHTML = `<div style="font-weight:700;line-height:1.2;">${title}</div><div style="margin-top:2px;font-size:12px;opacity:0.95;">${description || ''}</div>`;
  return el;
}

function makeCloudSvgEl(parent: HTMLElement): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('width', '100%');
  el.setAttribute('height', '100%');
  el.setAttribute('viewBox', '0 0 1 1');
  el.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'overflow:visible',
    'z-index:905',
  ].join(';');
  return el;
}

function makeCloudPathEl(parent: SVGSVGElement): SVGPathElement {
  const ns = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'rgba(220, 38, 38, 0.08)');
  path.setAttribute('stroke', '#dc2626');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  parent.appendChild(path);
  return path;
}

function makeCloudLeaderPathEl(parent: SVGSVGElement): SVGPathElement {
  const ns = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#111827');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  parent.appendChild(path);
  return path;
}

function ensurePanelActivated(panelId: string) {
  if (dockPanelExists(panelId)) {
    dockActivatePanelIfExists(panelId);
    return;
  }
  emitCommand(`panel.${panelId === 'modelTree' ? 'tree' : panelId}`);
}

export function useDtxTools(options: {
  dtxViewerRef: Ref<DtxViewer | null>
  dtxLayerRef: Ref<DTXLayer | null>
  selectionRef: Ref<DTXSelectionController | null>
  overlayContainerRef: Ref<HTMLElement | null>
  annotationSystemRef?: Ref<UseAnnotationThreeReturn | null>
  store: ReturnType<typeof useToolStore>
  compatViewerRef: Ref<DtxCompatViewer | null>
  requestRender?: (() => void) | null
}) {
  const { dtxViewerRef, dtxLayerRef, selectionRef, overlayContainerRef, store, compatViewerRef } = options;
  const requestRender = options.requestRender ?? null;

  const selectionStore = useSelectionStore();
  const unitSettings = useUnitSettingsStore();

  let lastTextMarkerClickTime = 0;
  let lastTextMarkerClickId: string | null = null;

  // pick_refno：仅在拾取会话内维护，不写入 store
  const pickedHighlightByBran = new Map<string, string>();
  const pickedHighlightPinned = new Set<string>(); // 已在外部选中的对象，不应被拾取会话取消选中
  let lastAppliedPickHighlights: string[] = [];

  const ready = computed(() => {
    const layer = dtxLayerRef.value;
    if (!layer) return false;
    try {
      return layer.getStats().compiled === true;
    } catch {
      return false;
    }
  });

  const progressPoints = ref<MeasurementPoint[]>([]);
  const pointToObjectStart = ref<MeasurementPoint | null>(null);

  // dimensions (独立于测量)
  const dimensionPoints = ref<MeasurementPoint[]>([]);

  const DIMENSION_PREVIEW_ID = 'dim_preview';

  function clearDimensionPreview(): void {
    const sys = options.annotationSystemRef?.value ?? null;
    if (!sys) return;
    try {
      sys.removeAnnotation(DIMENSION_PREVIEW_ID);
    } catch {
      // ignore
    }
  }

  function ensureLinearPreview(sys: UseAnnotationThreeReturn): LinearDimension3D {
    const existing = sys.getAnnotation(DIMENSION_PREVIEW_ID);
    if (existing instanceof LinearDimension3D) return existing;
    if (existing) sys.removeAnnotation(DIMENSION_PREVIEW_ID);

    const dim = new LinearDimension3D(sys.materials, {
      start: new Vector3(),
      end: new Vector3(1, 0, 0),
      offset: 0.5,
      labelT: 0.5,
      text: '',
    });
    dim.userData.pickable = false;
    dim.userData.draggable = false;
    sys.addAnnotation(DIMENSION_PREVIEW_ID, dim);
    return dim;
  }

  function ensureAnglePreview(sys: UseAnnotationThreeReturn): AngleDimension3D {
    const existing = sys.getAnnotation(DIMENSION_PREVIEW_ID);
    if (existing instanceof AngleDimension3D) return existing;
    if (existing) sys.removeAnnotation(DIMENSION_PREVIEW_ID);

    const dim = new AngleDimension3D(sys.materials, {
      vertex: new Vector3(),
      point1: new Vector3(1, 0, 0),
      point2: new Vector3(0, 1, 0),
      arcRadius: 0.8,
      labelT: 0.5,
      text: '',
      decimals: 1,
    });
    dim.userData.pickable = false;
    dim.userData.draggable = false;
    sys.addAnnotation(DIMENSION_PREVIEW_ID, dim);
    return dim;
  }

  function updateDimensionPreview(canvas: HTMLCanvasElement, e: PointerEvent): void {
    const sys = options.annotationSystemRef?.value ?? null;
    if (!sys) return;

    const mode = store.toolMode.value;
    if (mode !== 'dimension_linear' && mode !== 'dimension_angle') {
      clearDimensionPreview();
      return;
    }

    const hit = pickSurfacePoint(canvas, e);
    if (!hit) {
      clearDimensionPreview();
      return;
    }

    if (mode === 'dimension_linear') {
      if (dimensionPoints.value.length !== 1) {
        clearDimensionPreview();
        return;
      }
      const p0 = dimensionPoints.value[0]!;
      const start = new Vector3(...p0.worldPos);
      const end = hit.worldPos.clone();
      const dist = start.distanceTo(end);
      if (dist < 1e-9) {
        clearDimensionPreview();
        return;
      }

      const viewer = dtxViewerRef.value;
      const dir = viewer ? computeDimensionOffsetDirectionByCamera(start, end, viewer.camera as any) : null;
      const offset = Math.max(0.2, Math.min(2, dist * 0.15));
      const text = formatLengthMeters(dist, unitSettings.displayUnit.value, unitSettings.precision.value);

      const dim = ensureLinearPreview(sys);
      dim.setParams({
        start,
        end,
        offset,
        labelT: 0.5,
        direction: dir ?? undefined,
        text,
      });
      dim.visible = true;
      return;
    }

    // angle
    if (dimensionPoints.value.length !== 2) {
      clearDimensionPreview();
      return;
    }
    const p0 = dimensionPoints.value[0]!;
    const p1 = dimensionPoints.value[1]!;
    const origin = new Vector3(...p0.worldPos);
    const corner = new Vector3(...p1.worldPos);
    const target = hit.worldPos.clone();

    const arm1 = origin.distanceTo(corner);
    const arm2 = target.distanceTo(corner);
    const arcRadius = clamp(Math.min(arm1, arm2) * 0.3, 0.3, 1.2);

    const dim = ensureAnglePreview(sys);
    dim.setParams({
      vertex: corner,
      point1: origin,
      point2: target,
      arcRadius,
      labelT: 0.5,
      decimals: Math.max(0, Math.min(6, Math.floor(Number(unitSettings.precision.value) || 0))),
    });
    const deg = dim.getAngleDegrees();
    dim.setParams({ text: formatAngleDegrees(deg, unitSettings.precision.value) });
    dim.visible = true;
  }

  function applyPickHighlights(): void {
    const viewer = compatViewerRef.value;
    if (!viewer) return;

    const next = Array.from(new Set(pickedHighlightByBran.values())).filter(Boolean);

    if (lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    if (next.length > 0) {
      // 若对象在进入/拾取前已被外部选中，则“取消拾取/删除候选”不应取消其高亮
      const selectedNow = new Set<string>(viewer.scene.selectedObjectIds);
      for (const id of next) {
        if (selectedNow.has(id) && !lastAppliedPickHighlights.includes(id)) {
          pickedHighlightPinned.add(id);
        }
      }
      viewer.scene.setObjectsSelected(next, true);
    }
    lastAppliedPickHighlights = next;
  }

  function clearPickHighlights(): void {
    const viewer = compatViewerRef.value;
    if (viewer && lastAppliedPickHighlights.length > 0) {
      const toDeselect = lastAppliedPickHighlights.filter((id) => !pickedHighlightPinned.has(id));
      if (toDeselect.length > 0) {
        viewer.scene.setObjectsSelected(toDeselect, false);
      }
    }
    pickedHighlightByBran.clear();
    pickedHighlightPinned.clear();
    lastAppliedPickHighlights = [];
  }

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
    if (mode === 'measure_point_to_object') {
      return pointToObjectStart.value ? '点到面测量：请点击选择目标对象（自动计算最近距离）' : '点到面测量：请点击选择起始点';
    }
    if (mode === 'dimension_linear') {
      return dimensionPoints.value.length === 0 ? '尺寸标注（距离）：请选择起点' : '尺寸标注（距离）：请选择终点';
    }
    if (mode === 'dimension_angle') {
      if (dimensionPoints.value.length === 0) return '尺寸标注（角度）：请选择起点';
      if (dimensionPoints.value.length === 1) return '尺寸标注（角度）：请选择拐点';
      return '尺寸标注（角度）：请选择终点';
    }
    if (mode === 'pick_query_center') {
      return '请点击模型拾取查询中心点';
    }
    if (mode === 'pick_refno') {
      const filter = store.pickRefnoFilter.value;
      const count = store.pickedRefnos.value.length;
      const filterText = filter.length > 0 ? ` (类型: ${filter.join(', ')})` : '';
      return `拾取模式${filterText}：点击选择构件 [已选 ${count}] — Enter 确认 / ESC 取消`;
    }
    if (mode === 'annotation_cloud') {
      return '云线批注：按下拖拽框选，松开后以框选中心最近可见命中创建屏幕空间云线';
    }
    if (mode === 'annotation_rect') {
      return '矩形批注：点击对象生成 OBB 包围框批注';
    }
    return '批注：点击模型表面创建';
  });

  const toolsGroup = new Group();
  toolsGroup.name = 'dtx-tools';

  const labels = new Map<string, LabelEl>();
  const markers = new Map<string, LabelEl>();
  const cloudShapes = new Map<string, CloudOverlayEl>();

  const marqueeState = ref<DragRect>({ active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null });
  const marqueeDiv = ref<HTMLDivElement | null>(null);

  const rectDrag = ref<RectPlaneDrag>({
    active: false,
    pointerId: null,
    startCanvas: null,
    plane: null,
    basisU: null,
    basisV: null,
    startWorld: null,
    startEntityId: null,
  });
  const rectPreviewLine = ref<Line | null>(null);

  function resetProgress() {
    progressPoints.value = [];
    pointToObjectStart.value = null;
    dimensionPoints.value = [];
    clearDimensionPreview();
  }

  function ensureToolsGroupAttached() {
    const viewer = dtxViewerRef.value;
    if (!viewer) return;
    if (toolsGroup.parent !== viewer.scene) {
      try {
        toolsGroup.parent?.remove(toolsGroup);
      } catch {
        // ignore
      }
      viewer.scene.add(toolsGroup);
    }
  }

  function clearOverlayEls() {
    for (const it of labels.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    labels.clear();
    for (const it of markers.values()) {
      try { it.el.remove(); } catch { /* ignore */ }
    }
    markers.clear();
    for (const it of cloudShapes.values()) {
      try { it.svg.remove(); } catch { /* ignore */ }
    }
    cloudShapes.clear();
  }

  function ensureMarqueeDiv() {
    const overlay = overlayContainerRef.value;
    if (!overlay) return null;
    if (marqueeDiv.value && marqueeDiv.value.parentElement === overlay) return marqueeDiv.value;

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove(); } catch { /* ignore */ }
    }

    marqueeDiv.value = ensureDiv(
      overlay,
      'dtx-marquee',
      [
        'position:absolute',
        'display:none',
        'left:0',
        'top:0',
        'width:0',
        'height:0',
        'pointer-events:none',
        'z-index:930',
      ].join(';')
    );
    return marqueeDiv.value;
  }

  function hideMarquee() {
    marqueeState.value = { active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null };
    const div = marqueeDiv.value;
    if (div) div.style.display = 'none';
  }

  function updateMarqueeStyle(mode: 'annotation_cloud' | 'annotation_obb', dx: number) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    div.style.display = 'block';
    if (mode === 'annotation_cloud') {
      div.style.border = '3px solid #dc2626';
      div.style.borderRadius = '8px';
      div.style.background = 'rgba(220, 38, 38, 0.08)';
      div.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)';
    } else {
      div.style.border = dx >= 0 ? '2px dashed #333' : '2px solid #333';
      div.style.borderRadius = '0';
      div.style.background = 'rgba(0,0,0,0.06)';
      div.style.boxShadow = 'none';
    }
  }

  function updateMarqueeRect(start: { x: number; y: number }, end: { x: number; y: number }) {
    const div = ensureMarqueeDiv();
    if (!div) return;
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    div.style.left = `${x1}px`;
    div.style.top = `${y1}px`;
    div.style.width = `${x2 - x1}px`;
    div.style.height = `${y2 - y1}px`;
  }

  function syncFromStore() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    if (!viewer || !overlay) return;

    ensureToolsGroupAttached();
    clearGroup(toolsGroup);
    clearOverlayEls();

    // ---------------- Text annotations ----------------
    for (const a of store.annotations.value) {
      if (!a.visible) continue;

      const wp = new Vector3(...a.worldPos);
      const marker = makeMarkerEl(overlay, a.glyph || 'A', '#2563eb');
      const label = makeLabelEl(overlay, a.title || '批注', a.description || '');
      markers.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: wp, el: marker });
      labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: wp, el: label });

      const onClick = () => {
        const now = Date.now();
        const isDouble = lastTextMarkerClickId === a.id && now - lastTextMarkerClickTime < 400;
        if (isDouble) {
          store.pendingTextAnnotationEditId.value = a.id;
          lastTextMarkerClickId = null;
          lastTextMarkerClickTime = 0;
        } else {
          store.activeAnnotationId.value = a.id;
          store.activeCloudAnnotationId.value = null;
          store.activeRectAnnotationId.value = null;
          store.activeObbAnnotationId.value = null;
          lastTextMarkerClickId = a.id;
          lastTextMarkerClickTime = now;
        }
      };

      marker.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
      label.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    }

    // ---------------- Cloud annotations (screen-space cloud + world anchor) ----------------
    for (const c of store.cloudAnnotations.value) {
      if (!c.visible) continue;
      const anchor = new Vector3(...c.anchorWorldPos);
      const marker = makeMarkerEl(overlay, 'C', '#dc2626');
      markers.set(`cloud:${c.id}`, { id: `cloud:${c.id}`, worldPos: anchor, el: marker });
      marker.style.transform = 'translate(-50%,-50%)';

      const cloudSvg = makeCloudSvgEl(overlay);
      const cloudPath = makeCloudPathEl(cloudSvg);
      const leaderPath = makeCloudLeaderPathEl(cloudSvg);
      cloudShapes.set(`cloud:${c.id}`, {
        id: `cloud:${c.id}`,
        worldPos: anchor,
        svg: cloudSvg,
        path: cloudPath,
        leaderPath,
        record: c,
      });

      const label = makeLabelEl(overlay, c.title || '云线批注', c.description || '');
      label.style.transform = 'translate(0,-50%)';
      labels.set(`cloud:${c.id}`, { id: `cloud:${c.id}`, worldPos: anchor, el: label });

      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        store.activeCloudAnnotationId.value = c.id;
        store.activeAnnotationId.value = null;
        store.activeRectAnnotationId.value = null;
        store.activeObbAnnotationId.value = null;
      });
    }

    // ---------------- Rect annotations (OBB rectangle) ----------------
    for (const r of store.rectAnnotations.value) {
      if (!r.visible) continue;

      const visual = createRectAnnotationVisual(r.obb, r.anchorWorldPos);
      if (!visual) continue;
      toolsGroup.add(visual.box, visual.pin, visual.leader);

      const center = new Vector3(...r.anchorWorldPos);
      const marker = makeMarkerEl(overlay, 'R', '#111827');
      markers.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: center, el: marker });

      const isActive = store.activeRectAnnotationId.value === r.id;
      if (isActive) {
        const label = makeLabelEl(overlay, r.title || '矩形批注', r.description || '');
        const labelWorldPos = r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos;
        labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: labelWorldPos, el: label });
      }

      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        store.activeRectAnnotationId.value = r.id;
        store.activeAnnotationId.value = null;
        store.activeCloudAnnotationId.value = null;
        store.activeObbAnnotationId.value = null;
      });
    }

    // ---------------- OBB annotations ----------------
    for (const o of store.obbAnnotations.value) {
      if (!o.visible) continue;
      const g = buildWireBoxGeometryFromCorners(o.obb.corners as unknown as Vec3[]);
      if (!g) continue;
      const mat = new LineBasicMaterial({ color: 0x0f766e })
        ; (mat as any).depthTest = false;
      const wire = new LineSegments(g, mat);
      wire.renderOrder = 900;
      toolsGroup.add(wire);

      const anchor = new Vector3(...o.labelWorldPos);
      const marker = makeMarkerEl(overlay, 'O', '#0f766e');
      markers.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: anchor, el: marker });

      const isActive = store.activeObbAnnotationId.value === o.id;
      if (isActive) {
        const label = makeLabelEl(overlay, o.title || 'OBB 批注', o.description || '');
        labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: anchor, el: label });
      }

      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        store.activeObbAnnotationId.value = o.id;
        store.activeAnnotationId.value = null;
        store.activeCloudAnnotationId.value = null;
        store.activeRectAnnotationId.value = null;
      });
    }

    // preview rect line (if exists)
    if (rectPreviewLine.value) {
      toolsGroup.add(rectPreviewLine.value);
    }

    updateOverlayPositions();
    requestRender?.();
  }

  function updateOverlayPositions() {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;

    const cloudScreenLayouts = new Map<string, CloudLayout>();
    for (const [id, cloud] of cloudShapes.entries()) {
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos);
      const layout = computeCloudLayout(anchorScreen, cloud.record.screenOffset, cloud.record.cloudSize);
      cloud.path.setAttribute('d', layout.cloudPath);
      const leaderStartX = anchorScreen.x;
      const leaderStartY = anchorScreen.y;
      const elbowX = layout.labelAlign === 'left'
        ? layout.cloudCenterX + Math.min(16, Math.abs(layout.labelX - layout.cloudCenterX) * 0.35)
        : layout.cloudCenterX - Math.min(16, Math.abs(layout.labelX - layout.cloudCenterX) * 0.35);
      cloud.leaderPath.setAttribute(
        'd',
        `M ${leaderStartX.toFixed(1)} ${leaderStartY.toFixed(1)} L ${layout.cloudCenterX.toFixed(1)} ${layout.cloudCenterY.toFixed(1)} L ${elbowX.toFixed(1)} ${layout.labelY.toFixed(1)}`,
      );
      cloud.svg.style.opacity = anchorScreen.visible ? '1' : '0';
      cloudScreenLayouts.set(id, layout);
    }

    for (const it of markers.values()) {
      const cloudLayout = cloudScreenLayouts.get(it.id);
      const p = cloudLayout
        ? { x: cloudLayout.markerX, y: cloudLayout.markerY, visible: true }
        : worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
    }

    for (const it of labels.values()) {
      const cloudLayout = cloudScreenLayouts.get(it.id);
      const p = cloudLayout
        ? { x: cloudLayout.labelX, y: cloudLayout.labelY, visible: true }
        : worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
      if (cloudLayout) {
        it.el.style.transform = cloudLayout.labelAlign === 'left' ? 'translate(0,-50%)' : 'translate(-100%,-50%)';
      }
    }
  }

  function flyToMeasurement(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.measurements.value.find((m) => m.id === id);
    if (!rec) return;
    const pts: Vec3[] = [];
    if (rec.kind === 'distance') {
      pts.push(rec.origin.worldPos, rec.target.worldPos);
    } else {
      pts.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos);
    }
    const aabb = aabbFromPoints(pts);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToDimension(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.dimensions.value.find((d) => d.id === id) as any;
    if (!rec) return;
    const pts: Vec3[] = [];
    if (rec.kind === 'linear_distance') {
      pts.push(rec.origin.worldPos, rec.target.worldPos);
    } else {
      pts.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos);
    }
    const aabb = aabbFromPoints(pts);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.annotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints([rec.worldPos]);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToCloudAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.cloudAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const refnos = (rec.refnos && rec.refnos.length > 0) ? rec.refnos : rec.objectIds;
    const aabb = viewer.scene.getAABB(refnos);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToRectAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.rectAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints(rec.obb.corners as any);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function flyToObbAnnotation(id: string) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;
    const rec = store.obbAnnotations.value.find((a) => a.id === id);
    if (!rec) return;
    const aabb = aabbFromPoints(rec.obb.corners as any);
    if (!aabb) return;
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
  }

  function removeMeasurement(id: string) {
    store.removeMeasurement(id);
  }

  function removeDimension(id: string) {
    store.removeDimension(id);
  }

  function removeAnnotation(id: string) {
    store.removeAnnotation(id);
  }

  function removeCloudAnnotation(id: string) {
    store.removeCloudAnnotation(id);
  }

  function removeRectAnnotation(id: string) {
    store.removeRectAnnotation(id);
  }

  function removeObbAnnotation(id: string) {
    store.removeObbAnnotation(id);
  }

  function highlightAnnotationTargets(refnos: string[]) {
    const viewer = compatViewerRef.value;
    if (!viewer) return;

    if (refnos.length > 0) {
      window.dispatchEvent(new CustomEvent('showModelByRefnos', { detail: { refnos, regenModel: false } }));
    }

    const prev = viewer.scene.selectedObjectIds;
    if (prev.length > 0) {
      viewer.scene.setObjectsSelected(prev, false);
    }

    viewer.scene.ensureRefnos(refnos);
    viewer.scene.setObjectsSelected(refnos, true);

    const aabb = viewer.scene.getAABB(refnos);
    if (aabb) {
      viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
    }
  }

  function highlightAnnotationTarget(refno: string) {
    highlightAnnotationTargets([refno]);
  }

  function clearAllInScene() {
    clearGroup(toolsGroup);
    clearOverlayEls();
    hideMarquee();
    clearDimensionPreview();
    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    resetProgress();
    store.clearAll();
  }

  function dispose() {
    const viewer = dtxViewerRef.value;
    if (viewer && toolsGroup.parent === viewer.scene) {
      try { viewer.scene.remove(toolsGroup); } catch { /* ignore */ }
    }
    clearGroup(toolsGroup);
    clearOverlayEls();
    hideMarquee();
    clearDimensionPreview();

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove(); } catch { /* ignore */ }
      marqueeDiv.value = null;
    }

    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
  }

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const sel = selectionRef.value;
    if (!sel) return null;
    const pos = getCanvasPos(canvas, e);
    const hit = sel.pickPoint(pos);
    if (!hit) return null;
    const refno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId;
    return { entityId: refno, worldPos: hit.point.clone(), objectId: hit.objectId };
  }

  function computeRectPlaneBasis(camera: any, normal: Vector3): { u: Vector3; v: Vector3 } {
    const camUp = camera.up ? (camera.up as Vector3) : new Vector3(0, 0, 1);
    const u = new Vector3().crossVectors(normal, camUp);
    if (u.lengthSq() < 1e-8) {
      u.set(1, 0, 0);
    } else {
      u.normalize();
    }
    const v = new Vector3().crossVectors(u, normal).normalize();
    return { u, v };
  }

  function intersectPlaneFromPointer(canvas: HTMLCanvasElement, e: PointerEvent, plane: Plane): Vector3 | null {
    const viewer = dtxViewerRef.value;
    if (!viewer) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const ndc = new Vector3(x, y, 0.5);
    ndc.unproject(viewer.camera);
    const dir = ndc.sub(viewer.camera.position).normalize();
    const rayOrigin = viewer.camera.position.clone();
    const hit = new Vector3();
    // Plane.intersectLine expects Line3; use analytic ray-plane intersection
    const denom = plane.normal.dot(dir);
    if (Math.abs(denom) < 1e-8) return null;
    const t = -(rayOrigin.dot(plane.normal) + plane.constant) / denom;
    if (!Number.isFinite(t)) return null;
    hit.copy(dir).multiplyScalar(t).add(rayOrigin);
    return hit;
  }

  function updateRectPreview(worldCorners: Vector3[]) {
    if (worldCorners.length !== 4) return;
    const pts = [...worldCorners, worldCorners[0]!];
    const arr: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      arr.push(p.x, p.y, p.z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    const mat = new LineBasicMaterial({ color: 0x111827 })
      ; (mat as any).depthTest = false;
    const line = new Line(g, mat);
    line.renderOrder = 950;

    if (rectPreviewLine.value) {
      try {
        toolsGroup.remove(rectPreviewLine.value);
        rectPreviewLine.value.geometry.dispose()
        ; (rectPreviewLine.value.material as any)?.dispose?.();
      } catch { /* ignore */ }
    }
    rectPreviewLine.value = line;
    toolsGroup.add(line);
  }

  function collectRefnosInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, mode: 'annotation_cloud' | 'annotation_obb', dx: number): string[] {
    const viewer = compatViewerRef.value;
    const overlay = overlayContainerRef.value;
    const dtxViewer = dtxViewerRef.value;
    if (!viewer || !overlay || !dtxViewer) return [];
    const refnos = viewer.scene.getLoadedRefnos();
    if (!refnos || refnos.length === 0) return [];

    const sel: string[] = [];
    const containMode = mode === 'annotation_obb' && dx < 0;

    for (const refno of refnos) {
      const aabb = viewer.scene.getAABB([refno]);
      if (!aabb) continue;
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));
      const corners = [
        new Vector3(box.min.x, box.min.y, box.min.z),
        new Vector3(box.max.x, box.min.y, box.min.z),
        new Vector3(box.max.x, box.max.y, box.min.z),
        new Vector3(box.min.x, box.max.y, box.min.z),
        new Vector3(box.min.x, box.min.y, box.max.z),
        new Vector3(box.max.x, box.min.y, box.max.z),
        new Vector3(box.max.x, box.max.y, box.max.z),
        new Vector3(box.min.x, box.max.y, box.max.z),
      ];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let anyVisible = false;
      for (const c of corners) {
        const p = worldToOverlay(dtxViewer.camera, canvas, overlay, c);
        if (!p.visible) continue;
        anyVisible = true;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (!anyVisible) continue;

      const intersects = !(maxX < rect.x1 || minX > rect.x2 || maxY < rect.y1 || minY > rect.y2);
      const contained = minX >= rect.x1 && maxX <= rect.x2 && minY >= rect.y1 && maxY <= rect.y2;

      if (containMode ? contained : intersects) {
        sel.push(refno);
      }
    }

    return sel;
  }

  function beginMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb') {
    if (!ready.value) return;
    if (e.button !== 0) return;
    const start = getCanvasPos(canvas, e);
    marqueeState.value = {
      active: true,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startCanvas: { x: start.x, y: start.y },
      currentCanvas: { x: start.x, y: start.y },
    };
    updateMarqueeStyle(mode, 0);
    updateMarqueeRect(marqueeState.value.startCanvas!, marqueeState.value.currentCanvas!);

    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function moveMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb') {
    if (!marqueeState.value.active) return;
    if (marqueeState.value.pointerId !== e.pointerId) return;
    const cur = getCanvasPos(canvas, e);
    marqueeState.value.currentCanvas = { x: cur.x, y: cur.y };
    const start = marqueeState.value.startCanvas!;
    const dx = (cur.x - start.x);
    updateMarqueeStyle(mode, dx);
    updateMarqueeRect(start, marqueeState.value.currentCanvas);
  }

  function endMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb') {
    if (!marqueeState.value.active) return;
    if (marqueeState.value.pointerId !== e.pointerId) return;

    const start = marqueeState.value.startCanvas;
    const end = marqueeState.value.currentCanvas;
    if (!start || !end) {
      hideMarquee();
      return;
    }

    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    const rect = {
      x1: Math.min(start.x, end.x),
      y1: Math.min(start.y, end.y),
      x2: Math.max(start.x, end.x),
      y2: Math.max(start.y, end.y),
    };
    if (rect.x2 - rect.x1 < 6 || rect.y2 - rect.y1 < 6) {
      hideMarquee();
      return;
    }
    const dx = end.x - start.x;
    const selectedRefnos = collectRefnosInScreenRect(canvas, rect, mode, dx);
    hideMarquee();

    if (selectedRefnos.length === 0) return;

    // 打开批注面板，便于用户立即看到新建条目
    ensurePanelActivated('annotation');

    // 计算 combined bbox
    const compat = compatViewerRef.value;
    if (!compat) return;
    const aabb = compat.scene.getAABB(selectedRefnos);
    if (!aabb) return;
    const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));

    if (mode === 'annotation_cloud') {
      const n = store.cloudAnnotations.value.length + 1;
      const marqueeCenter = {
        x: (rect.x1 + rect.x2) * 0.5,
        y: (rect.y1 + rect.y2) * 0.5,
      };
      const viewer = dtxViewerRef.value;
      const overlay = overlayContainerRef.value;
      if (!viewer || !overlay) return;
      const anchor = resolveCloudAnchorFromMarqueeCenter(
        viewer,
        canvas,
        marqueeCenter,
        selectedRefnos,
        selectionRef.value,
        dtxLayerRef.value,
      ) ?? topCenterFromBox3(box);
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchor);
      const cloudCenterX = marqueeCenter.x;
      const cloudCenterY = marqueeCenter.y;
      const cloudSize = {
        width: clamp(rect.x2 - rect.x1, 72, 220),
        height: clamp(rect.y2 - rect.y1, 48, 180),
      };
      const cloudLayout = computeCloudLayout(anchorScreen, {
        x: cloudCenterX - anchorScreen.x,
        y: cloudCenterY - anchorScreen.y,
      }, cloudSize);
      const leaderEnd = overlayToWorld(
        viewer.camera,
        canvas,
        overlay,
        cloudLayout.labelX,
        cloudLayout.labelY,
        anchorScreen.ndcZ,
      );
      const rec: CloudAnnotationRecord = {
        id: nowId('cloud'),
        objectIds: [...selectedRefnos],
        anchorWorldPos: vec3ToTuple(anchor),
        leaderEndWorldPos: vec3ToTuple(leaderEnd),
        screenOffset: {
          x: cloudCenterX - anchorScreen.x,
          y: cloudCenterY - anchorScreen.y,
        },
        cloudSize,
        visible: true,
        title: `云线批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refnos: [...selectedRefnos],
      };
      store.addCloudAnnotation(rec);
      return;
    }

    const n = store.rectAnnotations.value.length + 1;
    const obb = computeAabbObbFromBox3(box);
    const rec = createRectAnnotationRecordFromObb({
      objectIds: selectedRefnos,
      refnos: selectedRefnos,
      obb,
      title: `矩形批注 ${n}`,
    });
    store.addRectAnnotation(rec);
  }

  // click-based tools
  const clickTracker = ref<{ down: { x: number; y: number } | null; moved: boolean }>({ down: null, moved: false });
  const boxSelectState = ref<{ active: boolean; startX: number; startY: number; endX: number; endY: number } | null>(null);

  function onCanvasPointerDown(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return;
    if (e.button !== 0) return;
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false };

    const mode = store.toolMode.value;
    if (mode === 'annotation_cloud') {
      beginMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_rect') {
      return;
    }
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    const down = clickTracker.value.down;
    if (down) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (dx * dx + dy * dy > 9) clickTracker.value.moved = true;
    }

    const mode = store.toolMode.value;
    if (mode === 'annotation_cloud') {
      moveMarquee(canvas, e, mode);
      return;
    }

    if (mode === 'dimension_linear' || mode === 'dimension_angle') {
      // 仅在“已选中部分点”的情况下才做 preview，避免每帧 pick 带来额外开销
      if (
        (mode === 'dimension_linear' && dimensionPoints.value.length >= 1) ||
        (mode === 'dimension_angle' && dimensionPoints.value.length >= 2)
      ) {
        updateDimensionPreview(canvas, e);
        requestRender?.();
      }
    }
  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return;

    const mode = store.toolMode.value;
    if (mode === 'annotation_cloud') {
      endMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_rect') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const compat = compatViewerRef.value;
      if (!compat) return;
      const pickedRefno = parseRefnoFromDtxObjectId(hit.objectId) || hit.entityId;
      const aabb = compat.scene.getAABB([pickedRefno]);
      if (!aabb) return;
      ensurePanelActivated('annotation');
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]));
      const obb = computeAabbObbFromBox3(box);
      const n = store.rectAnnotations.value.length + 1;
      const rec = createRectAnnotationRecordFromObb({
        objectIds: [pickedRefno],
        refnos: [pickedRefno],
        obb,
        title: `矩形批注 ${n}`,
      });
      store.addRectAnnotation(rec);
      return;
    }

    // 防止相机拖拽结束误触发
    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false };
      return;
    }
    clickTracker.value = { down: null, moved: false };

    if (mode === 'none') {
      // 普通模式下的点击选择，支持 Shift 多选
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) {
        // 点击空白处，清除选择（除非按住 Shift）
        if (!e.shiftKey) {
          const viewer = compatViewerRef.value;
          if (viewer) {
            const prev = viewer.scene.selectedObjectIds;
            if (prev.length > 0) {
              viewer.scene.setObjectsSelected(prev, false);
            }
          }
        }
        return;
      }

      const refno = hit.entityId;
      const viewer = compatViewerRef.value;
      if (!viewer) return;

      viewer.scene.ensureRefnos([refno]);

      if (e.shiftKey) {
        // Shift 多选：切换选中状态
        const isSelected = viewer.scene.selectedObjectIds.includes(refno);
        viewer.scene.setObjectsSelected([refno], !isSelected);
      } else {
        // 单选：清除之前的选择，选中当前对象
        const prev = viewer.scene.selectedObjectIds;
        if (prev.length > 0) {
          viewer.scene.setObjectsSelected(prev, false);
        }
        viewer.scene.setObjectsSelected([refno], true);
      }
      return;
    }

    if (mode === 'pick_query_center') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      store.setPickedQueryCenter({ entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) });
      store.setToolMode('none');
      return;
    }

    if (mode === 'pick_refno') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const filter = store.pickRefnoFilter.value;
      const targetRefno = resolvePickedRefnoForFilter(hit.entityId, filter);
      if (!targetRefno) return;
      store.addPickedRefno(targetRefno);

      // 拾取后立即高亮（优先 BRAN 本体；若 BRAN 无几何则回退到当前命中的 TUBI）
      const viewer = compatViewerRef.value;
      if (viewer) {
        const hasAabb = !!viewer.scene.getAABB([targetRefno]);
        const highlightId = hasAabb ? targetRefno : hit.entityId;
        pickedHighlightByBran.set(targetRefno, highlightId);
        applyPickHighlights();
      }
      return;
    }

    if (mode === 'measure_distance') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      progressPoints.value = [...progressPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }];
      if (progressPoints.value.length >= 2) {
        const [p0, p1] = progressPoints.value as [MeasurementPoint, MeasurementPoint];
        const rec: DistanceMeasurementRecord = {
          id: nowId('dist'),
          kind: 'distance',
          origin: p0,
          target: p1,
          visible: true,
          createdAt: Date.now(),
        };
        store.addMeasurement(rec);
        progressPoints.value = [];
      }
      return;
    }

    if (mode === 'measure_angle') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      progressPoints.value = [...progressPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }];
      if (progressPoints.value.length >= 3) {
        const [p0, p1, p2] = progressPoints.value as [MeasurementPoint, MeasurementPoint, MeasurementPoint];
        const rec: AngleMeasurementRecord = {
          id: nowId('angle'),
          kind: 'angle',
          origin: p0,
          corner: p1,
          target: p2,
          visible: true,
          createdAt: Date.now(),
        };
        store.addMeasurement(rec);
        progressPoints.value = [];
      }
      return;
    }

    if (mode === 'dimension_linear') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      dimensionPoints.value = [...dimensionPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }];
      if (dimensionPoints.value.length >= 2) {
        const [p0, p1] = dimensionPoints.value as [MeasurementPoint, MeasurementPoint];
        const a = new Vector3(...p0.worldPos);
        const b = new Vector3(...p1.worldPos);
        const dist = a.distanceTo(b);
        const viewer = dtxViewerRef.value;
        const dir = viewer ? computeDimensionOffsetDirectionByCamera(a, b, viewer.camera as any) : null;
        const offset = Math.max(0.2, Math.min(2, dist * 0.15));

        const rec: LinearDistanceDimensionRecord = {
          id: nowId('dim'),
          kind: 'linear_distance',
          origin: p0,
          target: p1,
          offset,
          direction: dir ? vec3ToTuple(dir) : null,
          labelT: 0.5,
          visible: true,
          createdAt: Date.now(),
        };
        store.addDimension(rec);
        dimensionPoints.value = [];
        clearDimensionPreview();
      }
      return;
    }

    if (mode === 'dimension_angle') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      dimensionPoints.value = [...dimensionPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }];
      if (dimensionPoints.value.length >= 3) {
        const [p0, p1, p2] = dimensionPoints.value as [MeasurementPoint, MeasurementPoint, MeasurementPoint];
        const rec: AngleDimensionRecord2 = {
          id: nowId('dimang'),
          kind: 'angle',
          origin: p0,
          corner: p1,
          target: p2,
          offset: 0.8,
          direction: null,
          labelT: 0.5,
          visible: true,
          createdAt: Date.now(),
        };
        store.addDimension(rec as any);
        dimensionPoints.value = [];
        clearDimensionPreview();
      }
      return;
    }

    if (mode === 'measure_point_to_object') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;

      if (!pointToObjectStart.value) {
        pointToObjectStart.value = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) };
        return;
      }

      const layer = dtxLayerRef.value;
      if (!layer) return;
      const start = new Vector3(...pointToObjectStart.value.worldPos);
      const closest = layer.closestPointToObject(hit.objectId, start);
      if (!closest) return;

      const rec: DistanceMeasurementRecord = {
        id: nowId('pto'),
        kind: 'distance',
        origin: pointToObjectStart.value,
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(closest.point) },
        visible: true,
        createdAt: Date.now(),
      };
      store.addMeasurement(rec);
      pointToObjectStart.value = null;
      return;
    }

    // annotation: click to create text annotation
    if (mode === 'annotation') {
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      const n = store.annotations.value.length + 1;
      // 优先绑定当前点击命中的构件，避免沿用全局旧选中导致误绑。
      const boundRefno = String(hit.entityId || '').trim() || selectionStore.selectedRefno.value || undefined;
      const rec: AnnotationRecord = {
        id: nowId('anno'),
        entityId: hit.entityId,
        worldPos: vec3ToTuple(hit.worldPos),
        visible: true,
        glyph: `A${n}`,
        title: `批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refno: boundRefno,
      };
      store.addAnnotation(rec);
      ensurePanelActivated('annotation');
      return;
    }

    // 点击其它批注模式时，保持不误创建文字批注
  }

  function onCanvasPointerCancel(canvas: HTMLCanvasElement, e: PointerEvent) {
    void e;
    const viewer = dtxViewerRef.value;
    if (viewer) viewer.controls.enabled = true;
    hideMarquee();
    clearDimensionPreview();
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null };
    try {
      rectPreviewLine.value?.geometry.dispose()
      ; (rectPreviewLine.value?.material as any)?.dispose?.();
    } catch { /* ignore */ }
    rectPreviewLine.value = null;
    clickTracker.value = { down: null, moved: false };
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  watch(
    () => ({
      measurements: store.measurements.value,
      annotations: store.annotations.value,
      cloudAnnotations: store.cloudAnnotations.value,
      rectAnnotations: store.rectAnnotations.value,
      obbAnnotations: store.obbAnnotations.value,
      activeAnnotationId: store.activeAnnotationId.value,
      activeCloudAnnotationId: store.activeCloudAnnotationId.value,
      activeRectAnnotationId: store.activeRectAnnotationId.value,
      activeObbAnnotationId: store.activeObbAnnotationId.value,
    }),
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
    },
    { deep: true }
  );

  // pick_refno：候选变化与取消拾取时同步高亮
  watch(
    () => ({
      mode: store.toolMode.value,
      picked: store.pickedRefnos.value,
    }),
    (next, prev) => {
      const mode = next.mode;
      const picked = next.picked ?? [];

      if (mode === 'pick_refno') {
        // 进入拾取模式：重置会话状态（不清除外部高亮）
        if (prev?.mode !== 'pick_refno') {
          pickedHighlightByBran.clear();
          pickedHighlightPinned.clear();
          lastAppliedPickHighlights = [];
        }

        // pickedRefnos 为空：视为取消/重置，撤销本会话高亮
        if (!picked || picked.length === 0) {
          clearPickHighlights();
          return;
        }

        // 同步删除的候选
        const pickedSet = new Set<string>(picked);
        for (const k of Array.from(pickedHighlightByBran.keys())) {
          if (!pickedSet.has(k)) {
            pickedHighlightByBran.delete(k);
          }
        }
        applyPickHighlights();
        return;
      }

      // 退出拾取模式：确认场景保持当前高亮；仅清理会话内状态，避免后续误同步
      if (prev?.mode === 'pick_refno') {
        pickedHighlightByBran.clear();
        lastAppliedPickHighlights = [];
      }
    },
    { deep: true }
  );

  // 显示单位变化：刷新测量标签等 overlay 文本
  watch(
    () => [unitSettings.displayUnit.value, unitSettings.precision.value],
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return;
      syncFromStore();
      requestRender?.();
    }
  );

  watch(
    () => store.toolMode.value,
    (mode, prev) => {
      if (mode !== prev) {
        resetProgress();
      }
      if (mode === 'none' && prev !== 'none') {
        hideMarquee();
      }
    }
  );

  watch(
    () => dtxViewerRef.value,
    (viewer, prev) => {
      if (prev && toolsGroup.parent === prev.scene) {
        prev.scene.remove(toolsGroup);
      }
      if (viewer) {
        ensureToolsGroupAttached();
        syncFromStore();
      } else {
        clearGroup(toolsGroup);
        clearOverlayEls();
      }
    },
    { immediate: true }
  );

  return {
    ready,
    statusText,

    syncFromStore,
    updateOverlayPositions,

    // actions used by panels
    flyToMeasurement,
    flyToDimension,
    flyToAnnotation,
    flyToCloudAnnotation,
    flyToRectAnnotation,
    flyToObbAnnotation,

    removeMeasurement,
    removeDimension,
    removeAnnotation,
    removeCloudAnnotation,
    removeRectAnnotation,
    removeObbAnnotation,

    highlightAnnotationTarget,
    highlightAnnotationTargets,

    clearAllInScene,
    dispose,

    // input hook (ViewerPanel 使用)
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,

    // 兼容：selectionStore 在 none 模式下由 ViewerPanel 处理
    selectionStore,
  };
}
