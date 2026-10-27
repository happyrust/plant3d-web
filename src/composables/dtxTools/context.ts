/**
 * useDtxTools 各控制器共享的状态（docs/plans/2026-10-26-usedtxtools-split-plan.md §3）。
 *
 * 规则：只被一个控制器读写的状态留在该控制器闭包里；被两个以上控制器碰的放这里并注明所有者，其他读者只读。
 * ctx 是普通对象，里面放 Ref；**不要 reactive(ctx)**（会把 Ref 解包）。
 */
import type { ComputedRef, Ref } from 'vue';

import type { CloudOverlayEl, CloudRenderStats } from './cloudRegion';
import type { PickRefnoCandidate } from './pickCandidates';
import type { AnnotationLeaderVisual, DragRect, InlineOverlayAnnotationDragState, LabelEl, ObbOverlayEl, PendingCloudAnchor, RectOverlayEl, RectPlaneDrag, TextAnnotationDragState } from './types';
import type { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import type { useAnnotationBindingResolve } from '@/composables/useAnnotationBindingResolve';
import type { useAnnotationStyleStore } from '@/composables/useAnnotationStyleStore';
import type { useReviewStore } from '@/composables/useReviewStore';
import type { useSelectionStore } from '@/composables/useSelectionStore';
import type { useToolStore } from '@/composables/useToolStore';
import type { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import type { useUserStore } from '@/composables/useUserStore';
import type { PinCluster } from '@/review/domain/annotationProjection/cluster';
import type { ArrayVersionTracker, ValueVersionTracker } from '@/review/domain/annotationProjection/dirty';
import type { CloudInspectionMode } from '@/review/domain/annotationProjection/inspection';
import type { CloudLodLevel } from '@/review/domain/annotationProjection/lod';
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';
import type { Group, Line } from 'three';

/** 场景 / DOM 里的 overlay 实体，按记录 id 索引。所有者：overlaySync（重建 / 卸载）；交互改位置、LOD 改显隐、面板动作只读。 */
export type DtxToolsOverlays = {
  labels: Map<string, LabelEl>;
  markers: Map<string, LabelEl>;
  cloudShapes: Map<string, CloudOverlayEl>;
  rectShapes: Map<string, RectOverlayEl>;
  obbShapes: Map<string, ObbOverlayEl>;
  textLeaders: Map<string, AnnotationLeaderVisual>;
};

export type ClusterPopover = {
  seedId: string;
  el: HTMLDivElement;
  onDocPointerDown: (ev: PointerEvent) => void;
  onKeyDown: (ev: KeyboardEvent) => void;
};

/**
 * P4 LOD / pin 图钉聚合 / P4 inspection 的帧间状态（原闭包里的一组 let）。所有者：cloudLod 与 cloudInspection 控制器；
 * overlaySync 每帧读，panelActions.dispose 清零，debug* 只读。
 */
export type CloudLodState = {
  /** inspection 显示模式的外部覆盖（null = 跟随 URL mbd_mode） */
  inspectionModeOverride: CloudInspectionMode | null;
  inspectionSearchCache: { search: string; mode: CloudInspectionMode };
  inspectionTimer: ReturnType<typeof setTimeout> | null;
  inspectionPending: boolean;
  /** 上一次计划的等级按 `cloud:${id}` 记；跨 syncFromStore 重建保留 */
  levels: Map<string, CloudLodLevel>;
  /** 上次规划的输入指纹，没变就不重算 */
  planKey: string;
  planSummary: { overBudget: boolean; fullCount: number; pinCount: number };
  setVersion: number;
  /** 悬停在图钉上的云线：LOD 固定高档 */
  hoveredId: string | null;
  clusterBadges: Map<string, HTMLDivElement>;
  /** 上一帧的成员 → 种子（滞回依据） */
  clusterSeedOf: Map<string, string>;
  clusterCurrent: PinCluster[];
  clusterHiddenMarkerIds: Set<string>;
  clusterPopover: ClusterPopover | null;
};

/** 云线渲染分阶段脏标记的帧级版本戳（所有云线共用）：相机 / 投影 / 视口 / overlay / DPR / 全局矩阵 / 样式。所有者：overlaySync；cloudInspection 读版本号 */
export type CloudFrameTrackers = {
  cameraWorld: ArrayVersionTracker;
  projection: ArrayVersionTracker;
  viewportCss: ArrayVersionTracker;
  overlayTransform: ArrayVersionTracker;
  dpr: ArrayVersionTracker;
  globalModelMatrix: ArrayVersionTracker;
  shapeStyle: ValueVersionTracker<string>;
  paintStyle: ValueVersionTracker<string>;
};

export type DtxToolsContext = {
  dtxViewerRef: Ref<DtxViewer | null>;
  dtxLayerRef: Ref<DTXLayer | null>;
  selectionRef: Ref<DTXSelectionController | null>;
  overlayContainerRef: Ref<HTMLElement | null>;
  compatViewerRef: Ref<DtxCompatViewer | null>;
  store: ReturnType<typeof useToolStore>;
  /** 构件选中态（none 模式的点选由 ViewerPanel 处理；这里给对象–对象测量的树选择与文字批注的回退绑定读）。只读 */
  selectionStore: ReturnType<typeof useSelectionStore>;
  requestRender: (() => void) | null;
  /** 只画测量等自己的东西、不渲染 store 里的批注 overlay（嵌入小视口用）。装配选项，只读 */
  suppressStoreOverlays: boolean;
  unitSettings: ReturnType<typeof useUnitSettingsStore>;
  clearanceStore: ReturnType<typeof useClearanceStore>;
  /** 审查任务 / 当前用户（批注处理页路由、自动截图回执用）。只读 */
  reviewStore: ReturnType<typeof useReviewStore>;
  userStore: ReturnType<typeof useUserStore>;
  /** 批注样式（云线画法 bbox3d / screen2d、云线外观等）。只读 */
  annotationStyleStore: ReturnType<typeof useAnnotationStyleStore>;
  /** ADR-0050 批注关联的失效解析表（missing / stale → 视口降级）。只读 */
  bindingResolve: ReturnType<typeof useAnnotationBindingResolve>;
  /** 交互就绪（图层 + 选择器 + overlay 容器都在）。所有者：组装器 */
  ready: ComputedRef<boolean>;
  /** pick_refno 候选轮换。所有者：pickCandidateController；测量只读 */
  pickCandidates: Ref<PickRefnoCandidate[]>;
  pickCandidateIndex: Ref<number>;
  /** 文字框拖动态（文字批注 / 云线·矩形·OBB 的内联文字框）。所有者：annotationInteraction；overlaySync 和 cloudLod 只读 */
  textAnnotationDrag: Ref<TextAnnotationDragState>;
  inlineOverlayAnnotationDrag: Ref<InlineOverlayAnnotationDragState>;
  /** 云线创建「目标先行」的锚点。所有者：cloudCreationFlow；测量取消时清 */
  pendingCloudAnchor: Ref<PendingCloudAnchor | null>;
  /** 工具层的三维父节点，挂在 dtxViewer.scene 下。所有者：overlayHost */
  toolsGroup: Group;
  overlays: DtxToolsOverlays;
  /** 云线渲染计数（静止零重建验收）。所有者：overlaySync；panelActions 读 / 清零 */
  cloudFrameTrackers: CloudFrameTrackers;
  cloudRenderStats: CloudRenderStats;
  cloudLod: CloudLodState;
  /** 拖框交互态（起点 / 当前点 / 指针）。所有者：cloudCreationFlow；overlayHost.hideMarquee 复位，pointerDispatcher 读 */
  marqueeState: Ref<DragRect>;
  /** 拖框 DOM。所有者：overlayHost；panelActions.dispose 摘掉 */
  marqueeDiv: Ref<HTMLDivElement | null>;
  /** OBB 矩形拖拽态与预览线。所有者：cloudCreationFlow（框选几何）；panelActions 清理 */
  rectDrag: Ref<RectPlaneDrag>;
  rectPreviewLine: Ref<Line | null>;
};
