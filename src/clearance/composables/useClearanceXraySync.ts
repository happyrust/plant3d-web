import { watch, type Ref, type WatchStopHandle } from 'vue';

import type { ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import type { BranNearestClearanceAnnotationCandidate } from '@/composables/useSpatialCompute';

import { normalizeClearanceRefno } from '@/clearance/domain/clearanceRecord';
import { sceneCompanionsOf } from '@/composables/deliveryUnitScene';

const PLAIN_REFNO_RE = /^\d+_\d+$/;

const INTERACTIVE_MEASURE_MODES: ReadonlySet<string> = new Set([
  'measure_distance',
  'measure_angle',
  'measure_point_to_object',
  'measure_object_to_object',
  'measure_pipe_to_structure',
  'measure_pipe_to_pipe',
  'xeokit_measure_distance',
  'xeokit_measure_angle',
  'xeokit_measure_elevation_point',
  'xeokit_measure_elevation_delta',
]);

export const DEFAULT_CLEARANCE_XRAY_DIM_OPACITY = 0.2;

export type ClearanceXraySceneSink = Readonly<{
  setMeasurementXrayKeepRefnos(keepRefnos: string[] | null, options?: { dimOpacity?: number }): void;
  clearMeasurementXray(): void;
}>;

export type ClearanceXrayViewerSink = Readonly<{
  scene: ClearanceXraySceneSink;
}>;

export type CollectClearanceRelatedInput = Readonly<{
  showClearanceAnnotations: boolean;
  clearanceRecords: readonly ClearanceRecord[];
  branQueriedSourceRefno?: string | null;
  branAnnotationCandidates?: readonly BranNearestClearanceAnnotationCandidate[];
  /** 可注入用于单测；缺省走 `sceneCompanionsOf` 把 BRAN 及其已加载直管/管件一并留作实体。 */
  expandCompanions?: (refnos: Iterable<string>) => string[];
}>;

function addPlainRefno(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  const normalized = normalizeClearanceRefno(raw);
  if (PLAIN_REFNO_RE.test(normalized)) {
    target.add(normalized);
  }
}

/**
 * 汇总当前屏上可见净距测量涉及的全部相关构件 refno（去重、排序）：
 * 1. `ClearanceStore` 可见记录（管-管全对/周边/连排、构件→墙、交互式最近点/管-管/管-墙柱）：
 *    取 `provenance.{source,target}.refno`、`inputs.{source,target}Refno` 及 `snapshot.{source,target}LeafRefno`；
 * 2. 中心线净距（`branNearestClearance`）：当有已标注候选时，取 `queriedSourceRefno` 与每条已标注候选的 `refno`；
 * 3. 通过 `sceneCompanionsOf` 自动补齐 BRAN 所属直管与下属管件叶子，避免管件实体而直管被半透明化（或反之）。
 * 没有任何正在显示的净距结果时返回空数组，确保不会把整个场景误变半透明。
 */
export function collectClearanceRelatedRefnos(input: CollectClearanceRelatedInput): string[] {
  const seeds = new Set<string>();

  if (input.showClearanceAnnotations) {
    for (const record of input.clearanceRecords) {
      addPlainRefno(seeds, record.provenance.source.refno);
      addPlainRefno(seeds, record.provenance.target.refno);
      addPlainRefno(seeds, record.inputs.sourceRefno);
      addPlainRefno(seeds, record.inputs.targetRefno);
      if (record.snapshot) {
        addPlainRefno(seeds, record.snapshot.sourceLeafRefno);
        addPlainRefno(seeds, record.snapshot.targetLeafRefno);
      }
    }
  }

  const branCandidates = input.branAnnotationCandidates ?? [];
  if (branCandidates.length > 0) {
    addPlainRefno(seeds, input.branQueriedSourceRefno);
    for (const item of branCandidates) {
      addPlainRefno(seeds, item.candidate.refno);
      addPlainRefno(seeds, item.candidate.nearest?.source_segment_refno);
    }
  }

  if (seeds.size === 0) return [];

  const expand = input.expandCompanions ?? ((refnos: Iterable<string>) => sceneCompanionsOf(refnos));
  for (const companion of expand(seeds)) {
    addPlainRefno(seeds, companion);
  }

  return Array.from(seeds).sort();
}

export type ClearanceXraySyncDeps = Readonly<{
  clearanceStore: Pick<
    ReturnType<typeof useClearanceStore>,
    'xrayUnrelatedModels' | 'setXrayUnrelatedModels' | 'showAnnotations' | 'visibleRecords'
  >;
  branClearance: Readonly<{
    getQueriedSourceRefno: () => string;
    getAnnotationCandidates: () => readonly BranNearestClearanceAnnotationCandidate[];
  }>;
  toolMode?: Ref<string>;
  pipeDrawerOpen?: Ref<boolean>;
  dimOpacity?: Ref<number> | number;
  requestRender?: () => void;
  expandCompanions?: (refnos: Iterable<string>) => string[];
}>;

/**
 * 将「测量时无关模型 X 光半透明」共享选项同步到 DtxCompatScene：
 * - 开启且存在可见净距结果 → 相关构件（含子树与伴随管段）保持实体，其余已加载构件降为半透明；
 * - 关闭、清空净距、删除/隐藏全部记录、退出交互式测量模式、切换项目或卸载查看器 → 完整还原外观。
 */
export function useClearanceXraySync(
  viewerRef: Ref<ClearanceXrayViewerSink | null>,
  deps: ClearanceXraySyncDeps,
) {
  const { clearanceStore, branClearance } = deps;
  let appliedViewer: ClearanceXrayViewerSink | null = null;
  let appliedActive = false;

  function resolveDimOpacity(): number {
    if (typeof deps.dimOpacity === 'number') return deps.dimOpacity;
    if (deps.dimOpacity && Number.isFinite(deps.dimOpacity.value)) {
      return deps.dimOpacity.value;
    }
    return DEFAULT_CLEARANCE_XRAY_DIM_OPACITY;
  }

  function clearOn(viewer: ClearanceXrayViewerSink | null): void {
    if (!viewer) return;
    viewer.scene.clearMeasurementXray();
    deps.requestRender?.();
  }

  function clear(): void {
    const target = viewerRef.value ?? appliedViewer;
    appliedActive = false;
    appliedViewer = null;
    clearOn(target);
  }

  function sync(): void {
    const viewer = viewerRef.value;
    if (appliedViewer && appliedViewer !== viewer && appliedActive) {
      clearOn(appliedViewer);
      appliedActive = false;
    }
    appliedViewer = viewer;
    if (!viewer) return;

    if (!clearanceStore.xrayUnrelatedModels.value) {
      if (appliedActive) {
        appliedActive = false;
        clearOn(viewer);
      }
      return;
    }

    const related = collectClearanceRelatedRefnos({
      showClearanceAnnotations: clearanceStore.showAnnotations.value,
      clearanceRecords: clearanceStore.visibleRecords.value,
      branQueriedSourceRefno: branClearance.getQueriedSourceRefno(),
      branAnnotationCandidates: branClearance.getAnnotationCandidates(),
      expandCompanions: deps.expandCompanions,
    });

    if (related.length === 0) {
      if (appliedActive) {
        appliedActive = false;
        clearOn(viewer);
      }
      return;
    }

    appliedActive = true;
    viewer.scene.setMeasurementXrayKeepRefnos(related, { dimOpacity: resolveDimOpacity() });
    deps.requestRender?.();
  }

  const stopMain: WatchStopHandle = watch(
    [
      viewerRef,
      clearanceStore.xrayUnrelatedModels,
      clearanceStore.showAnnotations,
      clearanceStore.visibleRecords,
      () => branClearance.getQueriedSourceRefno(),
      () => branClearance.getAnnotationCandidates(),
      () => resolveDimOpacity(),
    ],
    sync,
    { deep: true, immediate: true },
  );

  // 退出交互式测量模式（未打开管道距离抽屉且无中心线净距结果时）自动关闭 X 光并还原场景，避免残留半透明。
  const stopModeWatch: WatchStopHandle | null = deps.toolMode
    ? watch(deps.toolMode, (next, prev) => {
      if (!clearanceStore.xrayUnrelatedModels.value) return;
      if (!prev || !INTERACTIVE_MEASURE_MODES.has(prev) || INTERACTIVE_MEASURE_MODES.has(next)) return;
      if (deps.pipeDrawerOpen?.value) return;
      if (branClearance.getAnnotationCandidates().length > 0) return;
      clearanceStore.setXrayUnrelatedModels(false);
    })
    : null;

  return {
    sync,
    clear,
    stop: () => {
      stopMain();
      stopModeWatch?.();
      clear();
    },
  };
}
