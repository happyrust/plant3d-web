import { describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: ref<string | null>(null),
    selectedRefnos: ref<string[]>([]),
    propertiesLoading: ref(false),
    propertiesError: ref(null),
    propertiesData: ref(null),
    fullName: ref(null),
    loadProperties: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedRefno: vi.fn(),
    setSelectedRefnos: vi.fn(),
  }),
}));

import * as moduleExports from './useDtxTools';
import { useDtxTools } from './useDtxTools';
import { useToolStore } from './useToolStore';

import { DTXLayer } from '@/utils/three/dtx';

/**
 * `useDtxTools()` 的返回形状与模块的运行时导出（拆分计划 docs/plans/2026-10-26-usedtxtools-split-plan.md 第 0 步）：
 * 拆分期间两份清单都必须一字不差——ViewerPanel / useViewerContext / 12 个测试文件靠它们进来。
 * 故意改 API 时连同调用方一起改这里。
 */
const RETURN_KEYS = [
  'applyBindingDegrade', 'beginInlineOverlayAnnotationDrag', 'canDrawCloudAnnotation', 'cancelCloudCreation',
  'cancelMeasurementInteraction', 'clearAllInScene', 'clearPendingCloudAnchor', 'closeClusterPopover', 'cloudGateBlock',
  'continueInlineOverlayAnnotationDrag', 'cyclePickCandidate', 'debugAnnotationDegrades', 'debugCloudClusters',
  'debugCloudInspection', 'debugCloudLabelLayouts', 'debugCloudLod', 'debugCloudOutlines', 'debugCloudRegionRender',
  'debugCloudRenderStats', 'dispose', 'endInlineOverlayAnnotationDrag', 'flyToAnnotation', 'flyToCloudAnnotation',
  'flyToCloudAnnotations', 'flyToMeasurement', 'flyToObbAnnotation', 'flyToRectAnnotation', 'highlightAnnotationTarget',
  'highlightAnnotationTargets', 'objectToObjectUiState', 'onCanvasPointerCancel', 'onCanvasPointerDown', 'onCanvasPointerMove',
  'onCanvasPointerUp', 'openClusterPopover', 'pendingCloudAnchor', 'pickCandidateIndex', 'pickCandidates', 'ready',
  'refreshReadyState', 'removeAnnotation', 'removeCloudAnnotation', 'removeMeasurement', 'removeObbAnnotation',
  'removeRectAnnotation', 'resetCloudRenderStats', 'rollbackCloudCreationStep', 'runCloudInspectionNow', 'selectionStore',
  'setCloudInspectionMode', 'setHoveredCloudAnnotation', 'statusText', 'suspendCloudCreation', 'syncFromStore',
  'updateOverlayPositions',
];

const MODULE_EXPORTS = [
  'CLOUD_FIT_PADDING_PX', 'CLOUD_REGION_MAX_BOXES', 'CLOUD_TARGET_BBOX_TTL_MS', 'buildAnnotationLabelHtml',
  'buildAnnotationLabelStyleText', 'buildAnnotationLeaderStyle', 'buildCloudBillboardPolyline', 'buildInlineAnnotationCardHtml',
  'buildMembersRegionV1', 'buildPickRefnoCandidates', 'buildPickTubeCandidates', 'buildTextAnnotationCardHtml',
  'buildTextAnnotationMarkerHtml', 'buildTextAnnotationMarkerStyleText', 'choosePipeMeasureBetterSeed', 'cloudWavesPerEdgeForSizePx',
  'collectOrderedPipeReferencePointSeeds', 'computeApproxNearestBetweenObjects', 'computeCloudLayout',
  'computeFittedCloudRectFromCorners', 'createCloudAnnotationRecordFromAnchorAndMarquee', 'createDefaultCloudLabelLayoutV1',
  'createRectAnnotationRecordFromObb', 'getDefaultTextAnnotationLabelWorldPos', 'isDtxInteractionReady', 'isSamePickAnchor',
  'isSamePickCandidateSequence', 'isTubePickFilter', 'nextPickCandidateIndex', 'resolveAnnotationLabelClickAction',
  'resolveBoxPickRefnos', 'resolvePickedRefnoForFilter', 'resolveTextAnnotationMarkerClickAction',
  'resolveTextAnnotationMarkerDoubleClickAction', 'resolveTextAnnotationMarkerSingleClickAction', 'shouldRenderTextAnnotationCard',
  'toggleTextAnnotationCollapsed', 'useDtxTools',
];

describe('useDtxTools API 形状', () => {
  it('返回对象的成员清单不变', () => {
    const tools = useDtxTools({
      dtxViewerRef: ref({ scene: { add: vi.fn(), remove: vi.fn() }, controls: { enabled: true }, camera: null } as any),
      dtxLayerRef: shallowRef<DTXLayer | null>(null),
      selectionRef: ref({} as any),
      overlayContainerRef: ref(null),
      store: useToolStore(),
      compatViewerRef: ref({ scene: { getAABB: vi.fn(() => null) } } as any),
      requestRender: null,
    });
    try {
      expect(Object.keys(tools).sort()).toEqual([...RETURN_KEYS].sort());
    } finally {
      tools.dispose();
    }
  });

  it('模块的运行时导出清单不变', () => {
    expect(Object.keys(moduleExports).sort()).toEqual([...MODULE_EXPORTS].sort());
  });
});