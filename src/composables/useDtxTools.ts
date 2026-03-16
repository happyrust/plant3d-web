import { computed, ref, watch, type Ref } from 'vue';

import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
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

import { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import { findNounByRefnoAcrossAllDbnos, findOwnerRefnoByTubi } from '@/composables/useDbnoInstancesDtxLoader';
import { dockActivatePanelIfExists, dockPanelExists } from '@/composables/useDockApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore, type AngleMeasurementRecord, type AnnotationRecord, type CloudAnnotationRecord, type DistanceMeasurementRecord, type MeasurementPoint, type Obb, type ObbAnnotationRecord, type RectAnnotationRecord, type Vec3, type LinearDistanceDimensionRecord, type AngleDimensionRecord as AngleDimensionRecord2 } from '@/composables/useToolStore';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { emitCommand } from '@/ribbon/commandBus';
import { AngleDimension3D, LinearDimension3D } from '@/utils/three/annotation';
import { computeDimensionOffsetDir } from '@/utils/three/annotation/utils/computeDimensionOffsetDir';
import { worldPerPixelAt } from '@/utils/three/annotation/utils/solvespaceLike';

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

type TextAnnotationDragState = {
  annotationId: string | null
  pointerId: number | null
  anchorWorldPos: Vector3 | null
  anchorNdcZ: number
  moved: boolean
};

type InlineTextAnnotationDraft = {
  title: string
  description: string
};

type InlineOverlayAnnotationDragState = {
  annotationId: string | null
  annotationKind: 'cloud' | 'rect' | 'obb' | null
  pointerId: number | null
  anchorWorldPos: Vector3 | null
  anchorNdcZ: number
  moved: boolean
};

type CloudOverlayEl = {
  id: string
  worldPos: Vector3
  labelWorldPos: Vector3
  leader: AnnotationLeaderVisual
  outline: Line
  record: CloudAnnotationRecord
}

type CloudAnnotationVisual = {
  pin: LineSegments
  leader: AnnotationLeaderVisual
  outline: Line
  labelWorldPos: Vector3
}

type RectAnnotationVisual = {
  box: LineSegments
  pin: LineSegments
  leader: AnnotationLeaderVisual
  labelWorldPos: Vector3
}

type RectOverlayEl = {
  id: string
  worldPos: Vector3
  labelWorldPos: Vector3
  leader: AnnotationLeaderVisual
}

type ObbOverlayEl = {
  id: string
  worldPos: Vector3
  labelWorldPos: Vector3
  leader: AnnotationLeaderVisual
}

type ScreenPoint = {
  x: number
  y: number
  visible: boolean
  ndcZ: number
}

type PendingCloudAnchor = {
  worldPos: Vec3
  refno?: string
  entityId?: string
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

export type AnnotationOverlayKind = 'text' | 'cloud' | 'rect' | 'obb';
export type AnnotationLeaderKind = AnnotationOverlayKind;

export type AnnotationLabelClickState = {
  annotationId: string
  annotationType: AnnotationOverlayKind
  timestamp: number
};

export type AnnotationLabelClickResult = {
  action: 'activate' | 'edit'
  nextState: AnnotationLabelClickState | null
};

type AnnotationLeaderStyle = {
  color: number
  haloColor: number
  linewidth: number
  haloLinewidth: number
  opacity: number
  haloOpacity: number
}

type AnnotationLeaderVisual = {
  root: Group
  core: MeshLine
  halo: MeshLine
  coreGeometry: MeshLineGeometry
  haloGeometry: MeshLineGeometry
  coreMaterial: MeshLineMaterial
  haloMaterial: MeshLineMaterial
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function escapeAnnotationLabelText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
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

export function buildCloudBillboardPolyline(
  anchor: Vector3,
  right: Vector3,
  up: Vector3,
  width: number,
  height: number,
  segments = 18,
): number[] {
  const rx = Math.max(width * 0.5, 1e-4);
  const ry = Math.max(height * 0.5, 1e-4);
  const safeRight = right.clone().normalize();
  const safeUp = up.clone().normalize();
  const pts: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const wobble = 1 + 0.12 * Math.sin(t * 6);
    const p = anchor.clone()
      .addScaledVector(safeRight, Math.cos(t) * rx * wobble)
      .addScaledVector(safeUp, Math.sin(t) * ry * wobble);
    pts.push(p.x, p.y, p.z);
  }

  return pts;
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

export function createCloudAnnotationRecordFromAnchorAndMarquee(params: {
  id?: string
  objectIds: string[]
  refnos?: string[]
  anchorWorldPos: Vec3
  anchorRefno?: string
  anchorScreen: ScreenPoint
  rect: { x1: number; y1: number; x2: number; y2: number }
  title: string
  description?: string
  createdAt?: number
  projectOverlayToWorld: (x: number, y: number, ndcZ: number) => Vec3
}): CloudAnnotationRecord {
  const marqueeCenter = {
    x: (params.rect.x1 + params.rect.x2) * 0.5,
    y: (params.rect.y1 + params.rect.y2) * 0.5,
  };
  const cloudSize = {
    width: clamp(params.rect.x2 - params.rect.x1, 72, 220),
    height: clamp(params.rect.y2 - params.rect.y1, 48, 180),
  };
  const screenOffset = {
    x: marqueeCenter.x - params.anchorScreen.x,
    y: marqueeCenter.y - params.anchorScreen.y,
  };
  const cloudLayout = computeCloudLayout(params.anchorScreen, screenOffset, cloudSize);
  const leaderEndWorldPos = params.projectOverlayToWorld(
    cloudLayout.labelX,
    cloudLayout.labelY,
    params.anchorScreen.ndcZ,
  );

  return {
    id: params.id ?? nowId('cloud'),
    objectIds: [...params.objectIds],
    anchorWorldPos: [...params.anchorWorldPos],
    anchorRefno: params.anchorRefno,
    leaderEndWorldPos,
    screenOffset,
    cloudSize,
    visible: true,
    title: params.title,
    description: params.description ?? '',
    createdAt: params.createdAt ?? Date.now(),
    refnos: params.refnos ? [...params.refnos] : [...params.objectIds],
  };
}

export function getDefaultTextAnnotationLabelWorldPos(worldPos: Vec3): Vec3 {
  return [
    worldPos[0] + 0.9,
    worldPos[1] + 0.6,
    worldPos[2] + 0.7,
  ];
}

export function shouldRenderTextAnnotationCard(collapsed?: boolean): boolean {
  return collapsed !== true;
}

export function toggleTextAnnotationCollapsed(collapsed?: boolean): boolean {
  return collapsed !== true;
}

export function isDtxInteractionReady(
  layer: Pick<DTXLayer, 'getStats' | 'getVisibleObjectIds' | 'objectCount'> | null | undefined,
): boolean {
  if (!layer) return false;
  try {
    const stats = layer.getStats();
    if (stats.compiled === true) return true;
    if (layer.objectCount > 0) return true;
    return layer.getVisibleObjectIds().length > 0;
  } catch {
    return false;
  }
}

export function buildAnnotationLeaderStyle(kind: AnnotationLeaderKind): AnnotationLeaderStyle {
  const { style } = useAnnotationStyleStore();
  const leaderStyle = style[kind];
  return {
    color: leaderStyle.color,
    haloColor: leaderStyle.haloColor,
    linewidth: leaderStyle.lineWidth,
    haloLinewidth: leaderStyle.haloLineWidth,
    opacity: leaderStyle.opacity,
    haloOpacity: leaderStyle.haloOpacity,
  };
}

function buildAnnotationLeaderPositions(anchorWorldPos: Vector3, labelWorldPos: Vector3): number[] {
  return [
    anchorWorldPos.x, anchorWorldPos.y, anchorWorldPos.z,
    labelWorldPos.x, labelWorldPos.y, labelWorldPos.z,
  ];
}

function setAnnotationLeaderResolution(
  leader: AnnotationLeaderVisual,
  width: number,
  height: number,
): void {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  leader.coreMaterial.resolution.set(safeWidth, safeHeight);
  leader.haloMaterial.resolution.set(safeWidth, safeHeight);
}

function createAnnotationLeader(
  kind: AnnotationLeaderKind,
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
  resolution?: { width: number; height: number },
): AnnotationLeaderVisual {
  const style = buildAnnotationLeaderStyle(kind);
  const positions = buildAnnotationLeaderPositions(anchorWorldPos, labelWorldPos);
  const haloGeometry = new MeshLineGeometry();
  haloGeometry.setPoints(positions);
  const coreGeometry = new MeshLineGeometry();
  coreGeometry.setPoints(positions);
  const haloMaterial = new MeshLineMaterial({
    color: style.haloColor,
    lineWidth: style.haloLinewidth,
    transparent: true,
    opacity: style.haloOpacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const coreMaterial = new MeshLineMaterial({
    color: style.color,
    lineWidth: style.linewidth,
    transparent: true,
    opacity: style.opacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(1, 1),
  });
  const halo = new MeshLine(haloGeometry, haloMaterial);
  const core = new MeshLine(coreGeometry, coreMaterial);
  halo.renderOrder = 900;
  core.renderOrder = 901;
  halo.frustumCulled = false;
  core.frustumCulled = false;
  halo.raycast = () => {};
  core.raycast = () => {};
  const root = new Group();
  root.renderOrder = 901;
  root.add(halo, core);
  const leader = {
    root,
    core,
    halo,
    coreGeometry,
    haloGeometry,
    coreMaterial,
    haloMaterial,
  };
  setAnnotationLeaderResolution(leader, resolution?.width ?? 1, resolution?.height ?? 1);
  return leader;
}

function createTextAnnotationLeader(
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
  resolution?: { width: number; height: number },
): AnnotationLeaderVisual {
  return createAnnotationLeader('text', anchorWorldPos, labelWorldPos, resolution);
}

function updateLeaderGeometry(
  leader: AnnotationLeaderVisual,
  anchorWorldPos: Vector3,
  labelWorldPos: Vector3,
): void {
  const positions = buildAnnotationLeaderPositions(anchorWorldPos, labelWorldPos);
  leader.haloGeometry.setPoints(positions);
  leader.coreGeometry.setPoints(positions);
}

export function buildAnnotationLabelStyleText(): string {
  return [
    'position:absolute',
    'transform:translate(-50%,-110%)',
    'pointer-events:auto',
    'cursor:pointer',
    'user-select:none',
    'z-index:910',
    'max-width:280px',
    'padding:10px 12px',
    'border-radius:14px',
    'border:1px solid rgba(148,163,184,0.45)',
    'background:rgba(15,23,42,0.92)',
    'color:#e2e8f0',
    'box-shadow:0 14px 32px rgba(15,23,42,0.35)',
    'backdrop-filter:blur(10px)',
    'white-space:pre-wrap',
    'font-family:\'Segoe UI\',\'PingFang SC\',sans-serif',
    'line-height:1.45',
  ].join(';');
}

export function buildAnnotationLabelHtml(title: string, description: string): string {
  const safeTitle = escapeAnnotationLabelText(title);
  const safeDescription = escapeAnnotationLabelText(description || '');
  const descriptionHtml = safeDescription
    ? `<div data-role="annotation-description" style="margin-top:6px;font-size:12px;line-height:1.5;color:rgba(226,232,240,0.9);">${safeDescription}</div>`
    : '';
  return [
    `<div data-role="annotation-title" style="font-weight:700;font-size:13px;line-height:1.3;color:#f8fafc;">${safeTitle}</div>`,
    descriptionHtml,
  ].join('');
}

export function buildTextAnnotationMarkerStyleText(collapsed: boolean, color = '#2563eb'): string {
  if (collapsed) {
    return [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'cursor:pointer',
      'z-index:920',
      'width:22px',
      'height:28px',
      'filter:drop-shadow(0 4px 8px rgba(15,23,42,0.28))',
      `color:${color}`,
    ].join(';');
  }
  return [
    'position:absolute',
    'transform:translate(-50%,-100%)',
    'pointer-events:auto',
    'user-select:none',
    'cursor:pointer',
    'z-index:920',
    'width:18px',
    'height:24px',
    'filter:drop-shadow(0 4px 8px rgba(15,23,42,0.24))',
    `color:${color}`,
  ].join(';');
}

export function buildTextAnnotationMarkerHtml(glyph: string, collapsed: boolean): string {
  if (collapsed) {
    return [
      '<div data-marker-kind="location-pin" style="position:relative;width:22px;height:28px;">',
      '<svg viewBox="0 0 24 32" width="22" height="28" aria-hidden="true">',
      '<path d="M12 1.5C6.2 1.5 1.5 6.2 1.5 12c0 7.6 8.5 16.1 9.6 17.1a1.3 1.3 0 0 0 1.8 0c1.1-1 9.6-9.5 9.6-17.1C22.5 6.2 17.8 1.5 12 1.5Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.4"/>',
      '<circle cx="12" cy="12" r="4.2" fill="#ffffff"/>',
      '</svg>',
      '</div>',
    ].join('');
  }
  return [
    '<div data-marker-kind="push-pin" style="position:relative;width:18px;height:24px;">',
    '<svg viewBox="0 0 18 24" width="18" height="24" aria-hidden="true">',
    '<path d="M6 2.5h6l-.8 4.2 2.5 2.5v1.5H4.3V9.2l2.5-2.5L6 2.5Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"/>',
    '<path d="M9 10.8V21.8" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>',
    '<circle cx="9" cy="22.4" r="1.2" fill="#2563eb"/>',
    '</svg>',
    `<div data-role="annotation-glyph" style="position:absolute;right:-10px;top:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#0f172a;color:#f8fafc;font:700 10px/16px 'Segoe UI',sans-serif;text-align:center;">${escapeAnnotationLabelText(glyph)}</div>`,
    '</div>',
  ].join('');
}

export function buildInlineAnnotationCardHtml(kindLabel: string, title: string, description: string): string {
  const safeTitle = escapeAnnotationLabelText(title);
  const safeDescription = escapeAnnotationLabelText(description || '');
  const safeKindLabel = escapeAnnotationLabelText(kindLabel);
  return [
    '<div data-role="annotation-card-shell" style="display:flex;flex-direction:column;gap:8px;">',
    '<div data-role="annotation-drag-handle" style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:grab;color:rgba(226,232,240,0.8);font-size:11px;letter-spacing:0.04em;text-transform:uppercase;">',
    `<span>${safeKindLabel}</span>`,
    '<span style="display:inline-flex;gap:3px;"><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span><span style="width:4px;height:4px;border-radius:999px;background:rgba(226,232,240,0.55);"></span></span>',
    '</div>',
    `<input data-role="annotation-title-input" value="${safeTitle}" placeholder="输入批注标题" style="height:28px;border:none;outline:none;background:transparent;color:#f8fafc;font:700 13px/1.3 'Segoe UI','PingFang SC',sans-serif;padding:0;" />`,
    `<textarea data-role="annotation-description-input" placeholder="输入批注描述（可选）" style="min-height:52px;border:none;outline:none;resize:none;background:transparent;color:rgba(226,232,240,0.92);font:400 12px/1.5 'Segoe UI','PingFang SC',sans-serif;padding:0;">${safeDescription}</textarea>`,
    '</div>',
  ].join('');
}

export function buildTextAnnotationCardHtml(title: string, description: string): string {
  return buildInlineAnnotationCardHtml('批注', title, description);
}

export function resolveAnnotationLabelClickAction(
  prevState: AnnotationLabelClickState | null,
  annotationType: AnnotationOverlayKind,
  annotationId: string,
  timestamp: number,
  thresholdMs = 400,
): AnnotationLabelClickResult {
  const isDoubleClick = !!prevState
    && prevState.annotationId === annotationId
    && prevState.annotationType === annotationType
    && timestamp - prevState.timestamp < thresholdMs;

  if (isDoubleClick) {
    return {
      action: 'edit',
      nextState: null,
    };
  }

  return {
    action: 'activate',
    nextState: {
      annotationId,
      annotationType,
      timestamp,
    },
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
  obj.traverse?.((node: any) => {
    try {
      node.geometry?.dispose?.();
    } catch {
      // ignore
    }
    try {
      if (node.material) {
        if (Array.isArray(node.material)) {
          for (const m of node.material) m?.dispose?.();
        } else {
          node.material.dispose?.();
        }
      }
    } catch {
      // ignore
    }
  });
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

function buildPinMarkerGeometry(anchor: Vector3, size: number): BufferGeometry {
  const headZ = anchor.z + Math.max(size * 0.24, 0.02);
  const radius = Math.max(size * 0.12, 0.02);
  const positions = new Float32Array([
    anchor.x, anchor.y, anchor.z,
    anchor.x, anchor.y, headZ,

    anchor.x - radius, anchor.y, headZ,
    anchor.x, anchor.y + radius, headZ,

    anchor.x, anchor.y + radius, headZ,
    anchor.x + radius, anchor.y, headZ,

    anchor.x + radius, anchor.y, headZ,
    anchor.x, anchor.y - radius, headZ,

    anchor.x, anchor.y - radius, headZ,
    anchor.x - radius, anchor.y, headZ,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  return g;
}

function getCanvasResolution(canvas?: HTMLCanvasElement | null): { width: number; height: number } {
  return {
    width: canvas?.clientWidth || canvas?.width || 1,
    height: canvas?.clientHeight || canvas?.height || 1,
  };
}

function createCloudAnnotationVisual(
  record: CloudAnnotationRecord,
  resolution?: { width: number; height: number },
): CloudAnnotationVisual {
  const anchor = new Vector3(...record.anchorWorldPos);
  const labelWorldPos = record.leaderEndWorldPos
    ? new Vector3(...record.leaderEndWorldPos)
    : anchor.clone().add(new Vector3(0.4, 0.4, 0.3));
  const distance = Math.max(anchor.distanceTo(labelWorldPos), 0.12);
  const pinGeometry = buildPinMarkerGeometry(anchor, distance);

  const pinMaterial = new LineBasicMaterial({ color: 0xdc2626 });
  const outlineMaterial = new LineBasicMaterial({ color: 0xdc2626 });
  (pinMaterial as any).depthTest = false;
  (outlineMaterial as any).depthTest = false;

  const pin = new LineSegments(pinGeometry, pinMaterial);
  const leader = createAnnotationLeader('cloud', anchor, labelWorldPos, resolution);
  const outline = new Line(new BufferGeometry(), outlineMaterial);
  pin.renderOrder = 901;
  outline.renderOrder = 901;
  return { pin, leader, outline, labelWorldPos };
}

function createRectAnnotationVisual(
  obb: Obb,
  anchorWorldPos: Vec3,
  resolution?: { width: number; height: number },
): RectAnnotationVisual | null {
  const boxGeometry = buildWireBoxGeometryFromCorners(obb.corners as unknown as Vec3[]);
  if (!boxGeometry) return null;

  const anchor = new Vector3(...anchorWorldPos);
  const halfSize = new Vector3(...obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildPinMarkerGeometry(anchor, boxRadius);

  const labelAnchor = anchor.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));

  const boxMaterial = new LineBasicMaterial({ color: 0x111827 });
  const pinMaterial = new LineBasicMaterial({ color: 0x111827 });
  (boxMaterial as any).depthTest = false;
  (pinMaterial as any).depthTest = false;

  const box = new LineSegments(boxGeometry, boxMaterial);
  const pin = new LineSegments(pinGeometry, pinMaterial);
  const leader = createAnnotationLeader('rect', anchor, labelAnchor, resolution);
  box.renderOrder = 900;
  pin.renderOrder = 901;

  return { box, pin, leader, labelWorldPos: labelAnchor };
}

function resolveObbAnnotationAnchorWorldPos(record: ObbAnnotationRecord): Vector3 {
  if (record.anchor.kind === 'corner') {
    const corner = record.obb.corners[record.anchor.cornerIndex];
    if (corner) {
      return new Vector3(...corner);
    }
  }
  const box = new Box3();
  for (const corner of record.obb.corners) {
    box.expandByPoint(new Vector3(...corner));
  }
  return topCenterFromBox3(box);
}

function createObbAnnotationVisual(
  record: ObbAnnotationRecord,
  resolution?: { width: number; height: number },
): RectAnnotationVisual | null {
  const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(record);
  const boxGeometry = buildWireBoxGeometryFromCorners(record.obb.corners as unknown as Vec3[]);
  if (!boxGeometry) return null;
  const halfSize = new Vector3(...record.obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildPinMarkerGeometry(anchorWorldPos, boxRadius);
  const labelWorldPos = new Vector3(...record.labelWorldPos);

  const boxMaterial = new LineBasicMaterial({ color: 0x0f766e });
  const pinMaterial = new LineBasicMaterial({ color: 0x0f766e });
  (boxMaterial as any).depthTest = false;
  (pinMaterial as any).depthTest = false;

  const box = new LineSegments(boxGeometry, boxMaterial);
  const pin = new LineSegments(pinGeometry, pinMaterial);
  const leader = createAnnotationLeader('obb', anchorWorldPos, labelWorldPos, resolution);
  box.renderOrder = 900;
  pin.renderOrder = 901;

  return { box, pin, leader, labelWorldPos };
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

function makeTextAnnotationMarkerEl(parent: HTMLElement, glyph: string, collapsed: boolean): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    buildTextAnnotationMarkerStyleText(collapsed),
  );
  el.innerHTML = buildTextAnnotationMarkerHtml(glyph, collapsed);
  if (collapsed) {
    el.dataset.markerKind = 'location-pin';
  } else {
    el.dataset.markerKind = 'push-pin';
  }
  return el;
}

function makeLabelEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    buildAnnotationLabelStyleText()
  );
  el.innerHTML = buildAnnotationLabelHtml(title, description);
  return el;
}

function makeTextAnnotationCardEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  return makeInlineAnnotationCardEl(parent, '批注', title, description);
}

function makeInlineAnnotationCardEl(
  parent: HTMLElement,
  kindLabel: string,
  title: string,
  description: string,
): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    buildAnnotationLabelStyleText(),
  );
  el.innerHTML = buildInlineAnnotationCardHtml(kindLabel, title, description);
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

  let lastAnnotationLabelClick: AnnotationLabelClickState | null = null;
  let lastTextMarkerClick: { annotationId: string; timestamp: number } | null = null;

  // pick_refno：仅在拾取会话内维护，不写入 store
  const pickedHighlightByBran = new Map<string, string>();
  const pickedHighlightPinned = new Set<string>(); // 已在外部选中的对象，不应被拾取会话取消选中
  let lastAppliedPickHighlights: string[] = [];

  const ready = computed(() => {
    return isDtxInteractionReady(dtxLayerRef.value);
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

  function activateAnnotation(kind: AnnotationOverlayKind, id: string) {
    store.activeAnnotationId.value = kind === 'text' ? id : null;
    store.activeCloudAnnotationId.value = kind === 'cloud' ? id : null;
    store.activeRectAnnotationId.value = kind === 'rect' ? id : null;
    store.activeObbAnnotationId.value = kind === 'obb' ? id : null;
  }

  function openAnnotationEditor(kind: AnnotationOverlayKind, id: string) {
    if (kind === 'text') {
      focusInlineAnnotationEditor('text', id);
      return;
    }
    if (kind === 'cloud') {
      focusInlineAnnotationEditor('cloud', id);
      return;
    }
    if (kind === 'rect') {
      focusInlineAnnotationEditor('rect', id);
      return;
    }
    focusInlineAnnotationEditor('obb', id);
  }

  function getInlineAnnotationLabelKey(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string): string {
    if (kind === 'text') return `anno:${annotationId}`;
    if (kind === 'cloud') return `cloud:${annotationId}`;
    if (kind === 'rect') return `rect:${annotationId}`;
    return `obb:${annotationId}`;
  }

  function getInlineAnnotationDraftKey(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string): string {
    return `${kind}:${annotationId}`;
  }

  function setInlineAnnotationDraft(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    draft: InlineTextAnnotationDraft,
  ) {
    inlineTextAnnotationDrafts.set(getInlineAnnotationDraftKey(kind, annotationId), draft);
  }

  function getInlineTextAnnotationDraft(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    fallback: Pick<AnnotationRecord, 'title' | 'description'>,
  ): InlineTextAnnotationDraft {
    return inlineTextAnnotationDrafts.get(getInlineAnnotationDraftKey(kind, annotationId)) ?? {
      title: fallback.title || '批注',
      description: fallback.description || '',
    };
  }

  function pruneInlineTextAnnotationDrafts() {
    const existingKeys = new Set<string>([
      ...store.annotations.value.map((annotation) => getInlineAnnotationDraftKey('text', annotation.id)),
      ...store.cloudAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('cloud', annotation.id)),
      ...store.rectAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('rect', annotation.id)),
      ...store.obbAnnotations.value.map((annotation) => getInlineAnnotationDraftKey('obb', annotation.id)),
    ]);
    for (const draftKey of inlineTextAnnotationDrafts.keys()) {
      if (!existingKeys.has(draftKey)) {
        inlineTextAnnotationDrafts.delete(draftKey);
      }
    }
  }

  function clearPendingInlineAnnotationEdit(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    if (kind === 'text' && store.pendingTextAnnotationEditId.value === annotationId) {
      store.pendingTextAnnotationEditId.value = null;
    }
    if (kind === 'cloud' && store.pendingCloudAnnotationEditId.value === annotationId) {
      store.pendingCloudAnnotationEditId.value = null;
    }
    if (kind === 'rect' && store.pendingRectAnnotationEditId.value === annotationId) {
      store.pendingRectAnnotationEditId.value = null;
    }
    if (kind === 'obb' && store.pendingObbEditId.value === annotationId) {
      store.pendingObbEditId.value = null;
    }
  }

  function focusInlineAnnotationEditor(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const label = labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    if (!label) {
      if (kind === 'text') store.pendingTextAnnotationEditId.value = annotationId;
      if (kind === 'cloud') store.pendingCloudAnnotationEditId.value = annotationId;
      if (kind === 'rect') store.pendingRectAnnotationEditId.value = annotationId;
      if (kind === 'obb') store.pendingObbEditId.value = annotationId;
      return;
    }
    const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    if (titleInput) {
      titleInput.focus();
      titleInput.select();
    }
    clearPendingInlineAnnotationEdit(kind, annotationId);
  }

  function handleAnnotationOverlayClick(kind: AnnotationOverlayKind, id: string) {
    const result = resolveAnnotationLabelClickAction(lastAnnotationLabelClick, kind, id, Date.now());
    lastAnnotationLabelClick = result.nextState;
    if (result.action === 'edit') {
      openAnnotationEditor(kind, id);
      return;
    }
    activateAnnotation(kind, id);
  }

  function handleTextAnnotationMarkerClick(id: string) {
    commitInlineAnnotationDraft('text', id);
    const now = Date.now();
    const isDoubleClick = !!lastTextMarkerClick
      && lastTextMarkerClick.annotationId === id
      && now - lastTextMarkerClick.timestamp < 400;

    if (isDoubleClick) {
      const rec = store.annotations.value.find((item) => item.id === id);
      if (rec) {
        store.updateAnnotation(id, { collapsed: toggleTextAnnotationCollapsed(rec.collapsed) });
      }
      lastTextMarkerClick = null;
      return;
    }

    activateAnnotation('text', id);
    lastTextMarkerClick = { annotationId: id, timestamp: now };
  }

  function commitDraggedTextAnnotation(annotationId: string, labelWorldPos: Vector3) {
    store.updateAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function commitDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    labelWorldPos: Vector3,
  ) {
    const patch = { leaderEndWorldPos: vec3ToTuple(labelWorldPos) };
    if (kind === 'cloud') {
      store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      store.updateRectAnnotation(annotationId, patch);
      return;
    }
    store.updateObbAnnotation(annotationId, { labelWorldPos: vec3ToTuple(labelWorldPos) });
  }

  function getInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
  ): Pick<AnnotationRecord, 'title' | 'description'> | null {
    if (kind === 'text') {
      return store.annotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'cloud') {
      return store.cloudAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    if (kind === 'rect') {
      return store.rectAnnotations.value.find((item) => item.id === annotationId) ?? null;
    }
    return store.obbAnnotations.value.find((item) => item.id === annotationId) ?? null;
  }

  function updateInlineAnnotationRecord(
    kind: 'text' | 'cloud' | 'rect' | 'obb',
    annotationId: string,
    patch: { title?: string; description?: string },
  ) {
    if (kind === 'text') {
      store.updateAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'cloud') {
      store.updateCloudAnnotation(annotationId, patch);
      return;
    }
    if (kind === 'rect') {
      store.updateRectAnnotation(annotationId, patch);
      return;
    }
    store.updateObbAnnotation(annotationId, patch);
  }

  function commitInlineAnnotationDraft(kind: 'text' | 'cloud' | 'rect' | 'obb', annotationId: string) {
    const rec = getInlineAnnotationRecord(kind, annotationId);
    if (!rec) return;
    const label = labels.get(getInlineAnnotationLabelKey(kind, annotationId))?.el;
    const titleInput = label?.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
    const descriptionInput = label?.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
    const draft = inlineTextAnnotationDrafts.get(getInlineAnnotationDraftKey(kind, annotationId));
    const nextTitle = titleInput
      ? (titleInput.value.trim() || '批注')
      : (draft ? (draft.title.trim() || '批注') : rec.title);
    const nextDescription = descriptionInput
      ? descriptionInput.value
      : (draft ? draft.description : rec.description);
    const patch: Partial<AnnotationRecord> = {};
    if (nextTitle !== rec.title) {
      patch.title = nextTitle;
    }
    if (nextDescription !== rec.description) {
      patch.description = nextDescription;
    }
    if (Object.keys(patch).length > 0) {
      updateInlineAnnotationRecord(kind, annotationId, patch);
    }
    inlineTextAnnotationDrafts.delete(getInlineAnnotationDraftKey(kind, annotationId));
  }

  function resetTextAnnotationDrag() {
    textAnnotationDrag.value = {
      annotationId: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
    };
  }

  function updateDraggedTextAnnotation(annotationId: string, nextLabelWorldPos: Vector3) {
    const labelEntry = labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    const leader = textLeaders.get(`anno:${annotationId}`);
    const dragAnchor = textAnnotationDrag.value.anchorWorldPos;
    if (leader && dragAnchor) {
      updateLeaderGeometry(leader, dragAnchor, nextLabelWorldPos);
    }
    updateOverlayPositions();
    requestRender?.();
  }

  function beginTextAnnotationDrag(
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = labels.get(`anno:${annotationId}`);
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    textAnnotationDrag.value = {
      annotationId,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
    };
  }

  function continueTextAnnotationDrag(event: PointerEvent) {
    const dragState = textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    const nextLabelWorldPos = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      event.clientX - overlayRect.left,
      event.clientY - overlayRect.top,
      dragState.anchorNdcZ,
    );
    dragState.moved = true;
    updateDraggedTextAnnotation(dragState.annotationId, nextLabelWorldPos);
  }

  function endTextAnnotationDrag(event: PointerEvent) {
    const dragState = textAnnotationDrag.value;
    if (!dragState.annotationId || dragState.pointerId !== event.pointerId) return;
    const labelEntry = labels.get(`anno:${dragState.annotationId}`);
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const shouldCommit = dragState.moved && finalLabelWorldPos;
    resetTextAnnotationDrag();
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedTextAnnotation(annotationId, finalLabelWorldPos);
    } else {
      updateOverlayPositions();
      requestRender?.();
    }
  }

  function resetInlineOverlayAnnotationDrag() {
    inlineOverlayAnnotationDrag.value = {
      annotationId: null,
      annotationKind: null,
      pointerId: null,
      anchorWorldPos: null,
      anchorNdcZ: 0,
      moved: false,
    };
  }

  function updateDraggedOverlayAnnotation(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    nextLabelWorldPos: Vector3,
  ) {
    const labelEntry = labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = nextLabelWorldPos.clone();
    }
    if (kind === 'cloud') {
      const cloud = cloudShapes.get(`cloud:${annotationId}`);
      if (cloud) {
        cloud.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(cloud.leader, cloud.worldPos, nextLabelWorldPos);
      }
    } else if (kind === 'rect') {
      const rect = rectShapes.get(`rect:${annotationId}`);
      if (rect) {
        rect.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(rect.leader, rect.worldPos, nextLabelWorldPos);
      }
    } else {
      const obb = obbShapes.get(`obb:${annotationId}`);
      if (obb) {
        obb.labelWorldPos = nextLabelWorldPos.clone();
        updateLeaderGeometry(obb.leader, obb.worldPos, nextLabelWorldPos);
      }
    }
    updateOverlayPositions();
    requestRender?.();
  }

  function beginInlineOverlayAnnotationDrag(
    kind: 'cloud' | 'rect' | 'obb',
    annotationId: string,
    event: PointerEvent,
    labelWorldPos: Vector3,
    anchorWorldPos: Vector3,
  ) {
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchorWorldPos);
    const labelEntry = labels.get(getInlineAnnotationLabelKey(kind, annotationId));
    if (labelEntry) {
      labelEntry.worldPos = labelWorldPos.clone();
    }
    inlineOverlayAnnotationDrag.value = {
      annotationId,
      annotationKind: kind,
      pointerId: event.pointerId,
      anchorWorldPos: anchorWorldPos.clone(),
      anchorNdcZ: anchorScreen.ndcZ,
      moved: false,
    };
  }

  function continueInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId || !dragState.anchorWorldPos) return;
    const viewer = dtxViewerRef.value;
    const overlay = overlayContainerRef.value;
    const canvas = viewer?.canvas;
    if (!viewer || !overlay || !canvas) return;
    const overlayRect = overlay.getBoundingClientRect();
    const nextLabelWorldPos = overlayToWorld(
      viewer.camera,
      canvas,
      overlay,
      event.clientX - overlayRect.left,
      event.clientY - overlayRect.top,
      dragState.anchorNdcZ,
    );
    dragState.moved = true;
    updateDraggedOverlayAnnotation(dragState.annotationKind, dragState.annotationId, nextLabelWorldPos);
  }

  function endInlineOverlayAnnotationDrag(event: PointerEvent) {
    const dragState = inlineOverlayAnnotationDrag.value;
    if (!dragState.annotationId || !dragState.annotationKind || dragState.pointerId !== event.pointerId) return;
    const labelEntry = labels.get(getInlineAnnotationLabelKey(dragState.annotationKind, dragState.annotationId));
    const finalLabelWorldPos = labelEntry?.worldPos?.clone() ?? null;
    const annotationId = dragState.annotationId;
    const annotationKind = dragState.annotationKind;
    const shouldCommit = dragState.moved && finalLabelWorldPos;
    resetInlineOverlayAnnotationDrag();
    if (shouldCommit && finalLabelWorldPos) {
      commitDraggedOverlayAnnotation(annotationKind, annotationId, finalLabelWorldPos);
    } else {
      updateOverlayPositions();
      requestRender?.();
    }
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
    if (!dtxViewerRef.value) return '3D Viewer 未初始化';
    if (!dtxLayerRef.value) return 'DTX 图层未初始化';
    if (!selectionRef.value) return '拾取控制器未就绪';
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
      return pendingCloudAnchor.value
        ? '云线批注：锚点已就绪，请拖拽框选关联构件并生成屏幕云线'
        : '云线批注：请先点击模型选择锚点，再拖拽框选关联构件';
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
  const rectShapes = new Map<string, RectOverlayEl>();
  const obbShapes = new Map<string, ObbOverlayEl>();
  const textLeaders = new Map<string, AnnotationLeaderVisual>();
  const inlineTextAnnotationDrafts = new Map<string, InlineTextAnnotationDraft>();
  const textAnnotationDrag = ref<TextAnnotationDragState>({
    annotationId: null,
    pointerId: null,
    anchorWorldPos: null,
    anchorNdcZ: 0,
    moved: false,
  });
  const inlineOverlayAnnotationDrag = ref<InlineOverlayAnnotationDragState>({
    annotationId: null,
    annotationKind: null,
    pointerId: null,
    anchorWorldPos: null,
    anchorNdcZ: 0,
    moved: false,
  });

  const marqueeState = ref<DragRect>({ active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null });
  const marqueeDiv = ref<HTMLDivElement | null>(null);
  const pendingCloudAnchor = ref<PendingCloudAnchor | null>(null);

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

  function clearPendingCloudAnchor() {
    pendingCloudAnchor.value = null;
  }

  function setPendingCloudAnchor(anchor: PendingCloudAnchor) {
    pendingCloudAnchor.value = {
      worldPos: [...anchor.worldPos],
      refno: anchor.refno,
      entityId: anchor.entityId,
    };
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
    cloudShapes.clear();
    rectShapes.clear();
    obbShapes.clear();
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
    const resolution = getCanvasResolution(viewer.canvas);

    ensureToolsGroupAttached();
    clearGroup(toolsGroup);
    clearOverlayEls();
    textLeaders.clear();
    pruneInlineTextAnnotationDrafts();

    // ---------------- Text annotations ----------------
    for (const a of store.annotations.value) {
      if (!a.visible) continue;

      const wp = new Vector3(...a.worldPos);
      const labelWorldPos = new Vector3(...(a.labelWorldPos ?? getDefaultTextAnnotationLabelWorldPos(a.worldPos)));
      const marker = makeTextAnnotationMarkerEl(overlay, a.glyph || 'A', a.collapsed === true);
      markers.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: wp, el: marker });
      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handleTextAnnotationMarkerClick(a.id);
      });

      if (shouldRenderTextAnnotationCard(a.collapsed)) {
        const leader = createTextAnnotationLeader(wp, labelWorldPos, resolution);
        toolsGroup.add(leader.root);
        textLeaders.set(`anno:${a.id}`, leader);

        const draft = getInlineTextAnnotationDraft('text', a.id, a);
        const label = makeTextAnnotationCardEl(overlay, draft.title, draft.description);
        labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: labelWorldPos, el: label });

        const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
        const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
        const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

        label.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        label.addEventListener('focusout', () => {
          queueMicrotask(() => {
            const activeElement = label.ownerDocument?.activeElement;
            if (activeElement && label.contains(activeElement)) return;
            commitInlineAnnotationDraft('text', a.id);
          });
        });

        dragHandle?.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          commitInlineAnnotationDraft('text', a.id);
          dragHandle.style.cursor = 'grabbing';
          beginTextAnnotationDrag(a.id, ev, labelWorldPos, wp);
          try {
            dragHandle.setPointerCapture(ev.pointerId);
          } catch {
            // ignore
          }
        });
        dragHandle?.addEventListener('pointermove', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          continueTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointerup', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          endTextAnnotationDrag(ev);
        });
        dragHandle?.addEventListener('pointercancel', (ev) => {
          if (textAnnotationDrag.value.annotationId !== a.id) return;
          dragHandle.style.cursor = 'grab';
          endTextAnnotationDrag(ev);
        });

        titleInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        titleInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('text', a.id, {
            title: titleInput.value,
            description: descriptionInput?.value ?? draft.description,
          });
        });

        descriptionInput?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          activateAnnotation('text', a.id);
        });
        descriptionInput?.addEventListener('input', () => {
          setInlineAnnotationDraft('text', a.id, {
            title: titleInput?.value ?? draft.title,
            description: descriptionInput.value,
          });
        });

        if (store.pendingTextAnnotationEditId.value === a.id) {
          queueMicrotask(() => focusInlineAnnotationEditor('text', a.id));
        }
      }
    }

    // ---------------- Cloud annotations (screen-space cloud + world anchor) ----------------
    for (const c of store.cloudAnnotations.value) {
      if (!c.visible) continue;
      const anchor = new Vector3(...c.anchorWorldPos);
      const visual = createCloudAnnotationVisual(c, resolution);
      toolsGroup.add(visual.pin, visual.leader.root, visual.outline);
      cloudShapes.set(`cloud:${c.id}`, {
        id: `cloud:${c.id}`,
        worldPos: anchor,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
        outline: visual.outline,
        record: c,
      });

      const draft = getInlineTextAnnotationDraft('cloud', c.id, c);
      const label = makeInlineAnnotationCardEl(overlay, '云线批注', draft.title, draft.description);
      label.style.transform = 'translate(-50%,-50%)';
      labels.set(`cloud:${c.id}`, { id: `cloud:${c.id}`, worldPos: visual.labelWorldPos, el: label });
      const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
      const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
      const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

      label.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('cloud', c.id);
      });
      label.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        focusInlineAnnotationEditor('cloud', c.id);
      });
      label.addEventListener('focusout', () => {
        queueMicrotask(() => {
          const activeElement = label.ownerDocument?.activeElement;
          if (activeElement && label.contains(activeElement)) return;
          commitInlineAnnotationDraft('cloud', c.id);
        });
      });

      dragHandle?.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        commitInlineAnnotationDraft('cloud', c.id);
        dragHandle.style.cursor = 'grabbing';
        beginInlineOverlayAnnotationDrag('cloud', c.id, ev, visual.labelWorldPos, anchor);
        try {
          dragHandle.setPointerCapture(ev.pointerId);
        } catch {
          // ignore
        }
      });
      dragHandle?.addEventListener('pointermove', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
        continueInlineOverlayAnnotationDrag(ev);
      });
      dragHandle?.addEventListener('pointerup', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
        dragHandle.style.cursor = 'grab';
        endInlineOverlayAnnotationDrag(ev);
      });
      dragHandle?.addEventListener('pointercancel', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== c.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'cloud') return;
        dragHandle.style.cursor = 'grab';
        endInlineOverlayAnnotationDrag(ev);
      });

      titleInput?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('cloud', c.id);
      });
      titleInput?.addEventListener('input', () => {
        setInlineAnnotationDraft('cloud', c.id, {
          title: titleInput.value,
          description: descriptionInput?.value ?? draft.description,
        });
      });
      descriptionInput?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('cloud', c.id);
      });
      descriptionInput?.addEventListener('input', () => {
        setInlineAnnotationDraft('cloud', c.id, {
          title: titleInput?.value ?? draft.title,
          description: descriptionInput.value,
        });
      });

      if (store.pendingCloudAnnotationEditId.value === c.id) {
        queueMicrotask(() => focusInlineAnnotationEditor('cloud', c.id));
      }
    }

    // ---------------- Rect annotations (OBB rectangle) ----------------
    for (const r of store.rectAnnotations.value) {
      if (!r.visible) continue;

      const visual = createRectAnnotationVisual(r.obb, r.anchorWorldPos, resolution);
      if (!visual) continue;
      toolsGroup.add(visual.box, visual.pin, visual.leader.root);

      const draft = getInlineTextAnnotationDraft('rect', r.id, r);
      const label = makeInlineAnnotationCardEl(overlay, '矩形批注', draft.title, draft.description);
      const labelWorldPos = r.leaderEndWorldPos ? new Vector3(...r.leaderEndWorldPos) : visual.labelWorldPos;
      labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: labelWorldPos, el: label });
      rectShapes.set(`rect:${r.id}`, {
        id: `rect:${r.id}`,
        worldPos: new Vector3(...r.anchorWorldPos),
        labelWorldPos: labelWorldPos.clone(),
        leader: visual.leader,
      });
      const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
      const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
      const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;
      label.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('rect', r.id);
      });
      label.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        focusInlineAnnotationEditor('rect', r.id);
      });
      label.addEventListener('focusout', () => {
        queueMicrotask(() => {
          const activeElement = label.ownerDocument?.activeElement;
          if (activeElement && label.contains(activeElement)) return;
          commitInlineAnnotationDraft('rect', r.id);
        });
      });
      dragHandle?.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        commitInlineAnnotationDraft('rect', r.id);
        dragHandle.style.cursor = 'grabbing';
        beginInlineOverlayAnnotationDrag('rect', r.id, ev, labelWorldPos, new Vector3(...r.anchorWorldPos));
        try {
          dragHandle.setPointerCapture(ev.pointerId);
        } catch {
          // ignore
        }
      });
      dragHandle?.addEventListener('pointermove', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
        continueInlineOverlayAnnotationDrag(ev);
      });
      dragHandle?.addEventListener('pointerup', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
        dragHandle.style.cursor = 'grab';
        endInlineOverlayAnnotationDrag(ev);
      });
      dragHandle?.addEventListener('pointercancel', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== r.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'rect') return;
        dragHandle.style.cursor = 'grab';
        endInlineOverlayAnnotationDrag(ev);
      });
      titleInput?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('rect', r.id);
      });
      titleInput?.addEventListener('input', () => {
        setInlineAnnotationDraft('rect', r.id, {
          title: titleInput.value,
          description: descriptionInput?.value ?? draft.description,
        });
      });
      descriptionInput?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('rect', r.id);
      });
      descriptionInput?.addEventListener('input', () => {
        setInlineAnnotationDraft('rect', r.id, {
          title: titleInput?.value ?? draft.title,
          description: descriptionInput.value,
        });
      });

      if (store.pendingRectAnnotationEditId.value === r.id) {
        queueMicrotask(() => focusInlineAnnotationEditor('rect', r.id));
      }
    }

    // ---------------- OBB annotations ----------------
    for (const o of store.obbAnnotations.value) {
      if (!o.visible) continue;
      const visual = createObbAnnotationVisual(o, resolution);
      if (!visual) continue;
      toolsGroup.add(visual.box, visual.pin, visual.leader.root);

      const draft = getInlineTextAnnotationDraft('obb', o.id, o);
      const label = makeInlineAnnotationCardEl(overlay, 'OBB 批注', draft.title, draft.description);
      const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(o);
      labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: visual.labelWorldPos.clone(), el: label });
      obbShapes.set(`obb:${o.id}`, {
        id: `obb:${o.id}`,
        worldPos: anchorWorldPos,
        labelWorldPos: visual.labelWorldPos.clone(),
        leader: visual.leader,
      });
      const dragHandle = label.querySelector('[data-role="annotation-drag-handle"]') as HTMLDivElement | null;
      const titleInput = label.querySelector('[data-role="annotation-title-input"]') as HTMLInputElement | null;
      const descriptionInput = label.querySelector('[data-role="annotation-description-input"]') as HTMLTextAreaElement | null;

      label.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('obb', o.id);
      });
      label.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        focusInlineAnnotationEditor('obb', o.id);
      });
      label.addEventListener('focusout', () => {
        queueMicrotask(() => {
          const activeElement = label.ownerDocument?.activeElement;
          if (activeElement && label.contains(activeElement)) return;
          commitInlineAnnotationDraft('obb', o.id);
        });
      });
      dragHandle?.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        commitInlineAnnotationDraft('obb', o.id);
        dragHandle.style.cursor = 'grabbing';
        beginInlineOverlayAnnotationDrag('obb', o.id, ev, visual.labelWorldPos.clone(), anchorWorldPos);
        try {
          dragHandle.setPointerCapture(ev.pointerId);
        } catch {
          // ignore
        }
      });
      dragHandle?.addEventListener('pointermove', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
        continueInlineOverlayAnnotationDrag(ev);
      });
      dragHandle?.addEventListener('pointerup', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
        dragHandle.style.cursor = 'grab';
        endInlineOverlayAnnotationDrag(ev);
      });
      dragHandle?.addEventListener('pointercancel', (ev) => {
        if (inlineOverlayAnnotationDrag.value.annotationId !== o.id || inlineOverlayAnnotationDrag.value.annotationKind !== 'obb') return;
        dragHandle.style.cursor = 'grab';
        endInlineOverlayAnnotationDrag(ev);
      });
      titleInput?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('obb', o.id);
      });
      titleInput?.addEventListener('input', () => {
        setInlineAnnotationDraft('obb', o.id, {
          title: titleInput.value,
          description: descriptionInput?.value ?? draft.description,
        });
      });
      descriptionInput?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        activateAnnotation('obb', o.id);
      });
      descriptionInput?.addEventListener('input', () => {
        setInlineAnnotationDraft('obb', o.id, {
          title: titleInput?.value ?? draft.title,
          description: descriptionInput.value,
        });
      });

      if (store.pendingObbEditId.value === o.id) {
        queueMicrotask(() => focusInlineAnnotationEditor('obb', o.id));
      }
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
    const resolution = getCanvasResolution(canvas);

    for (const leader of textLeaders.values()) {
      setAnnotationLeaderResolution(leader, resolution.width, resolution.height);
    }
    for (const cloud of cloudShapes.values()) {
      setAnnotationLeaderResolution(cloud.leader, resolution.width, resolution.height);
    }
    for (const rect of rectShapes.values()) {
      setAnnotationLeaderResolution(rect.leader, resolution.width, resolution.height);
    }
    for (const obb of obbShapes.values()) {
      setAnnotationLeaderResolution(obb.leader, resolution.width, resolution.height);
    }

    for (const [id, cloud] of cloudShapes.entries()) {
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.worldPos);
      const labelScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, cloud.labelWorldPos);
      const widthPx = clamp(cloud.record.cloudSize?.width ?? 120, 72, 220);
      const heightPx = clamp(cloud.record.cloudSize?.height ?? 72, 48, 180);
      const worldPerPixel = worldPerPixelAt(
        viewer.camera,
        cloud.labelWorldPos,
        Math.max(1, canvas.clientWidth),
        Math.max(1, canvas.clientHeight),
      );
      const cameraDir = viewer.camera.getWorldDirection(new Vector3()).normalize();
      let right = new Vector3().crossVectors(cameraDir, viewer.camera.up).normalize();
      if (!Number.isFinite(right.lengthSq()) || right.lengthSq() < 1e-8) {
        right = new Vector3(1, 0, 0);
      }
      const up = new Vector3().crossVectors(right, cameraDir).normalize();
      const positions = buildCloudBillboardPolyline(
        cloud.labelWorldPos,
        right,
        up,
        widthPx * worldPerPixel,
        heightPx * worldPerPixel,
        18,
      );
      cloud.outline.geometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(positions), 3),
      );
      cloud.outline.geometry.computeBoundingSphere();
      cloud.outline.visible = anchorScreen.visible && labelScreen.visible;
      void id;
    }

    for (const it of markers.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
    }

    for (const it of labels.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos);
      it.el.style.left = `${p.x}px`;
      it.el.style.top = `${p.y}px`;
      it.el.style.opacity = p.visible ? '1' : '0';
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
    clearPendingCloudAnchor();
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
    if (mode === 'annotation_cloud' && !pendingCloudAnchor.value) return;
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
      if (mode === 'annotation_cloud') {
        const hit = pickSurfacePoint(canvas, e);
        if (hit) {
          setPendingCloudAnchor({
            worldPos: vec3ToTuple(hit.worldPos),
            refno: hit.entityId,
            entityId: hit.entityId,
          });
        }
      }
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
      const viewer = dtxViewerRef.value;
      const overlay = overlayContainerRef.value;
      const anchorState = pendingCloudAnchor.value;
      if (!viewer || !overlay || !anchorState) return;
      const n = store.cloudAnnotations.value.length + 1;
      const anchor = new Vector3(...anchorState.worldPos);
      const anchorScreen = worldToOverlayPoint(viewer.camera, canvas, overlay, anchor);
      const rec = createCloudAnnotationRecordFromAnchorAndMarquee({
        id: nowId('cloud'),
        objectIds: [...selectedRefnos],
        refnos: [...selectedRefnos],
        anchorWorldPos: anchorState.worldPos,
        anchorRefno: anchorState.refno,
        anchorScreen,
        rect,
        title: `云线批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        projectOverlayToWorld: (x, y, ndcZ) => vec3ToTuple(
          overlayToWorld(viewer.camera, canvas, overlay, x, y, ndcZ),
        ),
      });
      store.addCloudAnnotation(rec);
      clearPendingCloudAnchor();
      return;
    }

    const obb = computeAabbObbFromBox3(box);
    if (mode === 'annotation_obb') {
      const n = store.obbAnnotations.value.length + 1;
      const anchorWorldPos = topCenterFromBox3(box);
      const halfSize = new Vector3(...obb.halfSize);
      const boxRadius = Math.max(halfSize.length(), 0.1);
      const labelWorldPos = anchorWorldPos.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));
      const rec: ObbAnnotationRecord = {
        id: nowId('obb'),
        objectIds: selectedRefnos,
        obb,
        labelWorldPos: vec3ToTuple(labelWorldPos),
        anchor: { kind: 'top_center' },
        visible: true,
        title: `OBB 批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refnos: selectedRefnos,
      };
      store.addObbAnnotation(rec);
      return;
    }

    const n = store.rectAnnotations.value.length + 1;
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
    if (mode === 'annotation_obb') {
      beginMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (pendingCloudAnchor.value) {
        beginMarquee(canvas, e, mode);
      }
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
    if (mode === 'annotation_cloud' || mode === 'annotation_obb') {
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
    if (mode === 'annotation_obb') {
      endMarquee(canvas, e, mode);
      return;
    }
    if (mode === 'annotation_cloud') {
      if (marqueeState.value.active) {
        endMarquee(canvas, e, mode);
        return;
      }
      if (clickTracker.value.moved) {
        clickTracker.value = { down: null, moved: false };
        return;
      }
      clickTracker.value = { down: null, moved: false };
      const hit = pickSurfacePoint(canvas, e);
      if (!hit) return;
      setPendingCloudAnchor({
        worldPos: vec3ToTuple(hit.worldPos),
        refno: hit.entityId,
        entityId: hit.entityId,
      });
      ensurePanelActivated('annotation');
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
        labelWorldPos: getDefaultTextAnnotationLabelWorldPos(vec3ToTuple(hit.worldPos)),
        collapsed: false,
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
      if (mode !== 'annotation_cloud' && prev === 'annotation_cloud') {
        clearPendingCloudAnchor();
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
