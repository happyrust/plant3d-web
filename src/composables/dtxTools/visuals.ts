/**
 * 三维可视件工厂：云线 / 矩形 / OBB 的线框几何与材质，及 dispose。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { Box3, BufferAttribute, BufferGeometry, Group, LineDashedMaterial, LineSegments, Raycaster, Vector2, Vector3 } from 'three';

import { topCenterFromBox3 } from './annotationRecords';
import { CLOUD_BBOX_EDGE_INDEX_PAIRS, dashSizeFromLineSegments } from './cloudGeometry';
import { parseRefnoFromDtxObjectId } from './geometry';
import { buildAnnotationLeaderStyle, createAnnotationLeader } from './leaderVisual';

import type { BoxOverlayEl, CloudAnnotationVisual, RectAnnotationVisual } from './types';
import type { CloudAnnotationRecord, ObbAnnotationRecord, RectAnnotationRecord, Vec3 } from '@/composables/useToolStore';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import { applyDashedLineDegrade, applyLeaderDegrade, pinDashSizeFromDistance } from '@/composables/annotationDegradeViewport';
import { isCloudRenderFlagEnabled } from '@/composables/useCloudRenderFlags';
import { obbSnapshotCorners } from '@/review/domain/annotationProjection/annotationProjection';
import { regionCoversMembers } from '@/review/domain/cloudRegion';

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

export function disposeObject3d(obj: any) {
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

export function clearGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3d(child as any);
  }
}

export function buildWireBoxGeometryFromBox3(box: Box3): BufferGeometry {
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

/**
 * rect / obb 线框的几何来源（方案 §7，开关 `annotationSharedRegion`）：
 * 记录带 `origin:'members'` 的 `obb-union` 范围体且覆盖全部成员 → 每个成员对象一个真实放置盒（多成员多盒，不合并）；
 * 否则（旧记录 legacy-snapshot / 开关关 / 范围与绑定不一致）→ 照旧画 `obb.corners` 的单个盒。
 */
function buildBoxAnnotationWireGeometry(record: RectAnnotationRecord | ObbAnnotationRecord): BufferGeometry | null {
  const region = record.regionV1;
  const memberRefnos = record.bindings
    ? record.bindings.filter((binding) => binding.role === 'member').map((binding) => binding.refno)
    : (record.refnos ?? record.objectIds);
  if (
    isCloudRenderFlagEnabled('annotationSharedRegion')
    && region
    && region.origin === 'members'
    && region.kind === 'obb-union'
    && region.boxes.length > 0
    && regionCoversMembers(region, memberRefnos)
  ) {
    const positions: number[] = [];
    for (const box of region.boxes) {
      const corners = obbSnapshotCorners(box);
      for (const [a, b] of CLOUD_BBOX_EDGE_INDEX_PAIRS) {
        const p = corners[a]!;
        const q = corners[b]!;
        positions.push(p[0], p[1], p[2], q[0], q[1], q[2]);
      }
    }
    if (positions.length >= 6 && positions.every(Number.isFinite)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      return g;
    }
  }
  return buildWireBoxGeometryFromCorners(record.obb.corners as unknown as Vec3[]);
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

export function getCanvasResolution(canvas?: HTMLCanvasElement | null): { width: number; height: number } {
  return {
    width: canvas?.clientWidth || canvas?.width || 1,
    height: canvas?.clientHeight || canvas?.height || 1,
  };
}

export function createCloudAnnotationVisual(
  record: CloudAnnotationRecord,
  resolution?: { width: number; height: number },
): CloudAnnotationVisual {
  const anchor = new Vector3(...record.anchorWorldPos);
  const labelWorldPos = record.leaderEndWorldPos
    ? new Vector3(...record.leaderEndWorldPos)
    : anchor.clone().add(new Vector3(0.4, 0.4, 0.3));
  const distance = Math.max(anchor.distanceTo(labelWorldPos), 0.12);
  const pinGeometry = buildPinMarkerGeometry(anchor, distance);

  const cloudSt = buildAnnotationLeaderStyle('cloud');
  // 小针与盒边用 LineDashedMaterial：正常态 gapSize 0 等价实线，记录降级（ADR-0050）时只改 dash / gap 就是虚线，不必换材质
  const pinMaterial = new LineDashedMaterial({ color: cloudSt.color, dashSize: 1, gapSize: 0 });
  const outlineGeometry = new MeshLineGeometry();
  const outlineMaterial = new MeshLineMaterial({
    color: cloudSt.color,
    lineWidth: cloudSt.linewidth,
    transparent: true,
    opacity: cloudSt.opacity,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    resolution: new Vector2(resolution?.width ?? 1, resolution?.height ?? 1),
  });
  (pinMaterial as any).depthTest = false;
  const outline = new MeshLine(outlineGeometry, outlineMaterial);
  outline.frustumCulled = false;
  outline.renderOrder = 901;

  const bboxGeom = new BufferGeometry();
  bboxGeom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3));
  // 与 billboard 云线保持同一套遮挡语义：批注必须确定性地指认目标，被前景管道挡住
  // 的云线等于没有批注；空间纵深由 bbox3d 自身的透视形变表达，不依赖深度遮挡。
  const bboxMat = new LineDashedMaterial({
    color: cloudSt.color,
    transparent: true,
    opacity: cloudSt.opacity,
    depthTest: false,
    depthWrite: false,
    dashSize: 1,
    gapSize: 0,
  });
  const bboxEdges = new LineSegments(bboxGeom, bboxMat);
  bboxEdges.renderOrder = 902;
  bboxEdges.frustumCulled = false;
  bboxEdges.computeLineDistances();

  const pin = new LineSegments(pinGeometry, pinMaterial);
  pin.computeLineDistances();
  const leader = createAnnotationLeader('cloud', anchor, labelWorldPos, resolution);
  pin.renderOrder = 901;

  outlineGeometry.setPoints([0, 0, 0, 0, 0, 0]);

  return { pin, pinDashSize: pinDashSizeFromDistance(distance), leader, outline, bboxEdges, labelWorldPos };
}

const RECT_ANNOTATION_LINE_COLOR = 0x111827;
const OBB_ANNOTATION_LINE_COLOR = 0x0f766e;

/**
 * rect / obb 的线框 + 小针：LineDashedMaterial（正常态 gapSize 0 等价实线），记录降级（ADR-0050）时只改 dash / gap 就是虚线，不必换材质。
 * 与云线 / 尺寸系统同一套遮挡语义：批注线不参与深度测试。
 */
function createBoxAnnotationLines(
  boxGeometry: BufferGeometry,
  pinGeometry: BufferGeometry,
  color: number,
): { box: LineSegments; pin: LineSegments } {
  const boxMaterial = new LineDashedMaterial({ color, dashSize: 1, gapSize: 0, depthTest: false });
  const pinMaterial = new LineDashedMaterial({ color, dashSize: 1, gapSize: 0, depthTest: false });
  const box = new LineSegments(boxGeometry, boxMaterial);
  const pin = new LineSegments(pinGeometry, pinMaterial);
  box.computeLineDistances();
  pin.computeLineDistances();
  box.geometry.computeBoundingSphere();
  box.renderOrder = 900;
  pin.renderOrder = 901;
  return { box, pin };
}

/** rect / obb 一条记录的降级外观：线框 / 小针灰虚线 + 引线灰虚线；恢复回各自的正常线色 */
export function applyBoxOverlayDegrade(entry: BoxOverlayEl, kind: 'rect' | 'obb', degrade: AnnotationDegrade | null): void {
  entry.degrade = degrade;
  applyDashedLineDegrade(entry.box.material as LineDashedMaterial, entry.lineColor, degrade, entry.boxDashSize);
  applyDashedLineDegrade(entry.pin.material as LineDashedMaterial, entry.lineColor, degrade, entry.pinDashSize);
  applyLeaderDegrade(entry.leader, buildAnnotationLeaderStyle(kind).color, degrade);
}

export function createRectAnnotationVisual(
  record: RectAnnotationRecord,
  resolution?: { width: number; height: number },
): RectAnnotationVisual | null {
  const { obb, anchorWorldPos } = record;
  // 线框来源：共享范围体的真实放置盒（P3）或旧 `obb.corners`
  const boxGeometry = buildBoxAnnotationWireGeometry(record);
  if (!boxGeometry) return null;

  const anchor = new Vector3(...anchorWorldPos);
  const halfSize = new Vector3(...obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildPinMarkerGeometry(anchor, boxRadius);

  const labelAnchor = anchor.clone().add(new Vector3(boxRadius * 0.65, boxRadius * 0.65, boxRadius * 0.45));

  const { box, pin } = createBoxAnnotationLines(boxGeometry, pinGeometry, RECT_ANNOTATION_LINE_COLOR);
  const leader = createAnnotationLeader('rect', anchor, labelAnchor, resolution);

  return {
    box,
    pin,
    lineColor: RECT_ANNOTATION_LINE_COLOR,
    boxDashSize: dashSizeFromLineSegments(box),
    pinDashSize: pinDashSizeFromDistance(boxRadius),
    leader,
    labelWorldPos: labelAnchor,
  };
}

export function resolveObbAnnotationAnchorWorldPos(record: ObbAnnotationRecord): Vector3 {
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

export function createObbAnnotationVisual(
  record: ObbAnnotationRecord,
  resolution?: { width: number; height: number },
): RectAnnotationVisual | null {
  const anchorWorldPos = resolveObbAnnotationAnchorWorldPos(record);
  // 线框来源：共享范围体的真实放置盒（P3）或旧 `obb.corners`
  const boxGeometry = buildBoxAnnotationWireGeometry(record);
  if (!boxGeometry) return null;
  const halfSize = new Vector3(...record.obb.halfSize);
  const boxRadius = Math.max(halfSize.length(), 0.1);
  const pinGeometry = buildPinMarkerGeometry(anchorWorldPos, boxRadius);
  const labelWorldPos = new Vector3(...record.labelWorldPos);

  const { box, pin } = createBoxAnnotationLines(boxGeometry, pinGeometry, OBB_ANNOTATION_LINE_COLOR);
  const leader = createAnnotationLeader('obb', anchorWorldPos, labelWorldPos, resolution);

  return {
    box,
    pin,
    lineColor: OBB_ANNOTATION_LINE_COLOR,
    boxDashSize: dashSizeFromLineSegments(box),
    pinDashSize: pinDashSizeFromDistance(boxRadius),
    leader,
    labelWorldPos,
  };
}
