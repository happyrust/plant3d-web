/**
 * 三维工具层（useDtxTools）共用的纯类型：拖框 / overlay 元素 / 标注可视件结构。
 * 从 useDtxTools.ts 拆出（docs/plans/2026-10-26-usedtxtools-split-plan.md 第 1 步），实现未改。
 */
import { MeshLine, MeshLineGeometry, MeshLineMaterial } from '@lume/three-meshline';
import { Group, LineSegments, Plane, Vector3 } from 'three';

import type { Vec3 } from '@/composables/useToolStore';
import type { AnnotationDegrade } from '@/review/domain/bindingResolve';

export type DragRect = {
  active: boolean
  pointerId: number | null
  startClient: { x: number; y: number } | null
  startCanvas: { x: number; y: number } | null
  currentCanvas: { x: number; y: number } | null
}

export type RectPlaneDrag = {
  active: boolean
  pointerId: number | null
  startCanvas: { x: number; y: number } | null
  plane: Plane | null
  basisU: Vector3 | null
  basisV: Vector3 | null
  startWorld: Vector3 | null
  startEntityId: string | null
}

/** DOM 图钉的重绘依据：解析表变化时按这些参数原地重画 SVG（ADR-0050 视口降级），不重建元素、不丢事件监听 */
type MarkerMeta = {
  kind: AnnotationOverlayKind
  annotationId: string
  glyph: string
  collapsed: boolean
  /** 上次画进 SVG 的降级态 */
  degrade: AnnotationDegrade | null
}

export type LabelEl = {
  id: string
  worldPos: Vector3
  el: HTMLDivElement
  /**
   * `v1` = 该文字框由云线屏幕布局（`cloudLabelLayoutV1`）直接定位，通用「按 worldPos 投影」循环要跳过它；
   * 缺省 / `legacy` = 旧的世界点布局。
   */
  layoutMode?: 'legacy' | 'v1'
  /** 只有图钉（markers）带 */
  marker?: MarkerMeta
}

export type TextAnnotationDragState = {
  annotationId: string | null
  pointerId: number | null
  anchorWorldPos: Vector3 | null
  anchorNdcZ: number
  moved: boolean
};

export type InlineTextAnnotationDraft = {
  title: string
  description: string
};

export type InlineOverlayAnnotationDragState = {
  annotationId: string | null
  annotationKind: 'cloud' | 'rect' | 'obb' | null
  pointerId: number | null
  anchorWorldPos: Vector3 | null
  anchorNdcZ: number
  moved: boolean
  /**
   * 云线 V1 标签拖动：按住点相对文字框左上角的偏移（overlay 像素）。有值 = 本次拖动走屏幕像素布局，
   * 松手时提交 `labelLayoutV1.offsetPx`；null = 旧的世界点拖动。
   */
  labelGrabOffsetPx: { x: number; y: number } | null
};

export type CloudAnnotationVisual = {
  pin: LineSegments
  pinDashSize: number
  leader: AnnotationLeaderVisual
  outline: MeshLine
  bboxEdges: LineSegments
  labelWorldPos: Vector3
}

export type RectAnnotationVisual = {
  /** 线框与小针都是 LineDashedMaterial（正常态 gapSize 0 等价实线），记录降级时改灰虚线 */
  box: LineSegments
  pin: LineSegments
  /** 正常态线色（rect 深灰、obb 青绿），降级恢复时回它 */
  lineColor: number
  /** 虚线节拍（世界单位）：线框按盒对角线、小针按针长 */
  boxDashSize: number
  pinDashSize: number
  leader: AnnotationLeaderVisual
  labelWorldPos: Vector3
}

/** rect / obb 在视口里的一条：与 CloudOverlayEl 一样带降级态，供 applyBindingDegrade 就地换外观 */
export type BoxOverlayEl = {
  id: string
  worldPos: Vector3
  labelWorldPos: Vector3
  leader: AnnotationLeaderVisual
  box: LineSegments
  pin: LineSegments
  lineColor: number
  boxDashSize: number
  pinDashSize: number
  degrade: AnnotationDegrade | null
}

export type RectOverlayEl = BoxOverlayEl
export type ObbOverlayEl = BoxOverlayEl

export type ScreenPoint = {
  x: number
  y: number
  visible: boolean
  ndcZ: number
}

export type PendingCloudAnchor = {
  worldPos: Vec3
  refno?: string
  entityId?: string
}

export type CloudLayout = {
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

export type TextAnnotationMarkerClickState = {
  annotationId: string
  timestamp: number
};

export type TextAnnotationMarkerClickResult = {
  activate: boolean
  nextCollapsed: boolean | null
  nextState: TextAnnotationMarkerClickState | null
};

export type AnnotationLeaderStyle = {
  color: number
  haloColor: number
  linewidth: number
  haloLinewidth: number
  opacity: number
  haloOpacity: number
}

export type AnnotationLeaderVisual = {
  root: Group
  core: MeshLine
  halo: MeshLine
  coreGeometry: MeshLineGeometry
  haloGeometry: MeshLineGeometry
  coreMaterial: MeshLineMaterial
  haloMaterial: MeshLineMaterial
  /** ADR-0050 视口降级：上次应用到材质的降级态（applyLeaderDegrade 维护） */
  degrade?: AnnotationDegrade | null
}
