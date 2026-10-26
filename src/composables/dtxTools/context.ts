/**
 * useDtxTools 各控制器共享的状态（docs/plans/2026-10-26-usedtxtools-split-plan.md §3）。
 *
 * 规则：只被一个控制器读写的状态留在该控制器闭包里；被两个以上控制器碰的放这里并注明所有者，其他读者只读。
 * ctx 是普通对象，里面放 Ref；**不要 reactive(ctx)**（会把 Ref 解包）。
 */
import type { Ref } from 'vue';

import type { CloudOverlayEl, CloudRenderStats } from './cloudRegion';
import type { AnnotationLeaderVisual, LabelEl, ObbOverlayEl, RectOverlayEl, RectPlaneDrag } from './types';
import type { useToolStore } from '@/composables/useToolStore';
import type { PinCluster } from '@/review/domain/annotationProjection/cluster';
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

export type DtxToolsContext = {
  dtxViewerRef: Ref<DtxViewer | null>;
  dtxLayerRef: Ref<DTXLayer | null>;
  selectionRef: Ref<DTXSelectionController | null>;
  overlayContainerRef: Ref<HTMLElement | null>;
  compatViewerRef: Ref<DtxCompatViewer | null>;
  store: ReturnType<typeof useToolStore>;
  requestRender: (() => void) | null;
  /** 工具层的三维父节点，挂在 dtxViewer.scene 下。所有者：overlayHost */
  toolsGroup: Group;
  overlays: DtxToolsOverlays;
  /** 云线渲染计数（静止零重建验收）。所有者：overlaySync；panelActions 读 / 清零 */
  cloudRenderStats: CloudRenderStats;
  cloudLod: CloudLodState;
  /** 拖框 DOM。所有者：overlayHost；panelActions.dispose 摘掉 */
  marqueeDiv: Ref<HTMLDivElement | null>;
  /** OBB 矩形拖拽态与预览线。所有者：cloudCreationFlow（框选几何）；panelActions 清理 */
  rectDrag: Ref<RectPlaneDrag>;
  rectPreviewLine: Ref<Line | null>;
};
