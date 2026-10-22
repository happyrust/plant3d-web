<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';

import {
  BoxSelect,
  Check,
  Eye,
  EyeOff,
  MousePointerClick,
  RefreshCw,
  X,
  Locate,
  Trash2,
} from 'lucide-vue-next';
import { Vector3, type Matrix4 } from 'three';

import type { ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type { PipeRowSideOd } from '@/clearance/domain/pipeRowTypes';
import type { OutsideDiameterEvidence } from '@/composables/branParallelSpacing';
import type { Vec3 } from '@/types/vec3';

import { pipeClearanceLeavesText } from '@/clearance/adapters/pipeDistanceRecords';
import { pipeRowPairKey, pipeRowValueText } from '@/clearance/adapters/pipeRowRecords';
import { isFormalPipeRowGroup, type PipeRowGroup } from '@/clearance/domain/pipeRowGeometry';
import { clampedNumberInput, positiveMmInput } from '@/components/pipe-distance/numberInput';
import { computationMethodLabel, computationWarningsText } from '@/composables/measurementMethodLabel';
import { parseTubeKey } from '@/composables/spatialTree';
import {
  findNounByRefnoAcrossAllDbnos,
  findOwnerBranRefnoAcrossAllDbnos,
  resolveDtxObjectIdsByRefno,
} from '@/composables/useDbnoInstancesDtxLoader';
import {
  needsAxisEstimateFallback,
  PIPE_ROW_DEFAULT_MAX_ADJACENT_MM,
  PIPE_ROW_DEFAULT_MIN_COMMON_MM,
  usePipeDistanceStore,
  type PipeDistanceResult,
} from '@/composables/usePipeDistanceStore';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { showModelByRefnosWithAck, useViewerContext } from '@/composables/useViewerContext';
import {
  detectDtxBranchAxisDistances,
  resolveDtxAxisDistanceDbnum,
  type DtxBranchAxisDistanceLayer,
} from '@/utils/three/geometry/clearance/detectDtxBranchAxisDistances';

type ViewerWithDtxLayerMatrix = {
  __dtxLayer?: DtxBranchAxisDistanceLayer & {
    getGlobalModelMatrix?: () => Matrix4 | null;
  };
};

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const store = usePipeDistanceStore();
const toolStore = useToolStore();
const selectionStore = useSelectionStore();
const ctx = useViewerContext();

const isPicking = computed(() => toolStore.toolMode.value === 'pick_refno');
const isBoxPicking = computed(() => toolStore.toolMode.value === 'pick_refno_box');
const isAnyPicking = computed(() => isPicking.value || isBoxPicking.value);

// #64：结果真相是 ClearanceRecord，渲染统一走 `useClearanceDimensionSync` 的 `clearance`
// 外部源（ViewerPanel 全局挂着）——本抽屉不再持有 `pipe-distance` 外部源，也不复制记录。

onUnmounted(() => {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    delete (window as typeof window & { __plant3dPipeDistanceE2E?: unknown }).__plant3dPipeDistanceE2E;
  }
});

// --- detection ---
function createSceneTransformPoint(): ((point: Vec3) => Vec3) | undefined {
  const matrix = (ctx.viewerRef.value as ViewerWithDtxLayerMatrix | null)?.__dtxLayer?.getGlobalModelMatrix?.();
  if (!matrix) return undefined;
  return (point: Vec3): Vec3 => {
    const p = new Vector3(point[0], point[1], point[2]).applyMatrix4(matrix);
    return [p.x, p.y, p.z];
  };
}

function createDtxAxisDistanceFallback(refnos: string[]): PipeDistanceResult[] {
  const dtxLayer = (ctx.viewerRef.value as ViewerWithDtxLayerMatrix | null)?.__dtxLayer;
  if (!dtxLayer) return [];

  return detectDtxBranchAxisDistances(dtxLayer, {
    refnos,
    maxAngleDeg: store.maxAngle.value,
    maxDistanceMm: store.maxDistance.value,
    resolveObjectIdsByRefno: (refno) => {
      const dbnum = resolveDtxAxisDistanceDbnum(refno);
      return dbnum ? resolveDtxObjectIdsByRefno(dbnum, refno) : [];
    },
  });
}

/** 无序管对键（兜底结果与记录各自的方向不一定相同）。 */
function unorderedPairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function applyDetectionFallbackResults(refnos: string[], fallbackResults: PipeDistanceResult[]): boolean {
  // 已有外表面精算记录（哪怕过期或重算失败）的管对不拿估算顶替
  const exactPairs = new Set(store.pipeResults.value
    .filter(record => !record.pipeRow && record.provenance.method === 'surface-to-surface')
    .map(record => unorderedPairKey(record.inputs.sourceRefno, record.inputs.targetRefno)));
  const usable = fallbackResults.filter(result => !exactPairs.has(unorderedPairKey(result.pipeA, result.pipeB)));
  if (usable.length === 0) return false;
  const matrix = (ctx.viewerRef.value as ViewerWithDtxLayerMatrix | null)?.__dtxLayer?.getGlobalModelMatrix?.();
  const inverse = matrix && matrix.elements.every(Number.isFinite) && matrix.determinant() !== 0 ? matrix.clone().invert() : null;
  // 没有逆矩阵就解不出 design-world 坐标——记录拿不到可靠坐标不落库（旧模型硬写场景坐标，保存时才炸）。
  if (!inverse) return false;
  const toDesign = (point: Vec3): Vec3 => {
    const p = new Vector3(...point).applyMatrix4(inverse);
    return [p.x, p.y, p.z];
  };
  store.setBranRefnos(refnos);
  store.showAnnotations.value = true;
  store.commitPipeDistanceResults(usable.map(result => ({ ...result, measurementKind: 'axis-estimate', status: 'current',
    designPoints: { start: toDesign(result.start), end: toDesign(result.end) } })));
  store.detectError.value = ['服务端净距计算失败，下面是模型拟合的中心距估算，不能用作净距验收', store.detectError.value]
    .filter(Boolean).join('；');
  return true;
}

/** 后台补装尚未进场景的 BRAN 模型（已在场景里的由 showModelByRefno 直接短路；未生成的自动走 generateThenCollect）。 */
function ensureBransLoadedInScene(refnos: readonly string[], onLoaded?: () => void) {
  const unique = [...new Set(refnos.map(refno => refno.trim().replace(/\//g, '_')).filter(Boolean))];
  if (unique.length === 0) return;
  void showModelByRefnosWithAck({
    refnos: unique,
    flyTo: false,
    highlight: false,
    timeoutMs: 120_000,
    ensureViewerReady: true,
  }).then((result) => {
    if (result.ok.length > 0) onLoaded?.();
  }).catch(() => {
    // ignore background model load errors; centerline-based measurement still works
  });
}

async function detectBransWithDtxFallback(refnos: string[]) {
  ensureBransLoadedInScene(refnos);
  const applied = await store.autoDetectBrans(refnos, {
    pairMode: 'all-pairs',
  });
  if (!applied || !needsAxisEstimateFallback(store.lastRunOutcome.value)) return;
  applyDetectionFallbackResults(refnos, createDtxAxisDistanceFallback(refnos));
}

/** 连排模式：真实中心线归排，不走 PCA 网格拟合兜底（拟合轴线的归排没有意义）。 */
async function detectPipeRowsSelected(refnos: string[]) {
  store.setBranRefnos(refnos);
  ensureBransLoadedInScene(refnos);
  await store.runPipeRowDetection({ sourceAnnotation: toolStore.activeAnnotationContext.value });
}

const isRowMode = computed(() => store.detectionMode.value === 'pipe-row');

/** 明细的折叠标题：连排是归排诊断，所有管对是计算失败的管对。 */
const diagnosticsSummary = computed(() => {
  const count = store.detectDiagnostics.value.length;
  return isRowMode.value ? `诊断信息 ${count} 条（穿过件、没有共同区段的管向组等）` : `明细 ${count} 条（相连的管对、计算失败的管对等）`;
});

// 换检测模式 / 归排方式后，上一次检测的提示与错误说的是另一套结果，不留在当前模式下误导。
watch([() => store.detectionMode.value, () => store.pipeRowAlignMode.value], () => {
  store.detectNotice.value = null;
  store.detectError.value = null;
});

// --- pick BRAN pipe / TUBI segment ---
/** 拾取粒度：整根 BRAN，或（连排模式）直段 TUBI——选了直段的管道只在所选直段上归排。 */
const pickLevel = ref<'bran' | 'tube'>('bran');
const tubePicking = computed(() => isRowMode.value && pickLevel.value === 'tube');

/** 拾取确认后收进选择；连排模式下选够 2 根管道就直接检测（多选即出结果，不用再点「重新检测」）。 */
function acceptPicked(picked: string[], level: 'bran' | 'tube') {
  if (picked.length === 0) return;
  for (const item of picked) {
    if (level === 'tube') store.addTubeKey(item);
    else store.addBranRefno(item);
  }
  if (isRowMode.value && store.selectedBranRefnos.value.length >= 2) {
    void detectPipeRowsSelected(store.selectedBranRefnos.value);
  }
}

function startPickBran() {
  const level = tubePicking.value ? 'tube' : 'bran';
  toolStore.startPickRefno([level === 'tube' ? 'TUBI' : 'BRAN'], picked => acceptPicked(picked, level));
}

function startBoxPickBran() {
  const level = tubePicking.value ? 'tube' : 'bran';
  toolStore.startBoxPickRefno([level === 'tube' ? 'TUBI' : 'BRAN'], picked => acceptPicked(picked, level));
}

/** 直段标签：`所属 BRAN · 两端类型`，容器头 / 尾那一端写「头」/「尾」。 */
function tubeChipText(key: string): string {
  const tube = parseTubeKey(key);
  if (!tube) return key;
  const end = (refno: string, atContainer: string) =>
    refno === tube.unitRefno ? atContainer : (findNounByRefnoAcrossAllDbnos(refno) || refno);
  return `${tube.unitRefno} · ${end(tube.from, '头')}→${end(tube.to, '尾')}`;
}

function isTubeRestricted(refno: string): boolean {
  return store.selectedTubeKeys.value.some(key => parseTubeKey(key)?.unitRefno === refno);
}

async function handleDetect() {
  if (isRowMode.value) {
    await detectPipeRowsSelected(store.selectedBranRefnos.value);
    return;
  }
  await detectBransWithDtxFallback(store.selectedBranRefnos.value);
}

async function handleDetectNearby() {
  const source = store.selectedBranRefnos.value[0];
  if (source && store.selectedBranRefnos.value.length === 1)
    await store.detectNearbyBrans(source);
}

function getCurrentSelectedBrans(): string[] {
  const candidates = [
    ...selectionStore.selectedRefnos.value,
    selectionStore.selectedRefno.value,
  ].filter((refno): refno is string => !!refno);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const refno of candidates) {
    const normalized = refno.trim().replace(/\//g, '_');
    if (!normalized || seen.has(normalized)) continue;
    // 选中的是管件 / 直管时按所属 BRAN 算：在三维里点管道，点到的多半是它的构件
    const noun = (findNounByRefnoAcrossAllDbnos(normalized) || '').toUpperCase();
    const bran = noun === 'BRAN' ? normalized : findOwnerBranRefnoAcrossAllDbnos(normalized);
    if (!bran || seen.has(bran)) continue;
    seen.add(bran);
    out.push(bran);
  }
  return out;
}

/** 打开抽屉时自动检测所有管对的上限：管对数随管道数平方增长，选得多时只带入选择，等用户点「重新检测」。 */
const AUTO_DETECT_MAX_BRANS = 10;

async function detectCurrentSelectedBrans(options: { quiet?: boolean; auto?: boolean } = {}) {
  const refnos = getCurrentSelectedBrans();
  if (refnos.length < 2) {
    if (!options.quiet) {
      store.detectError.value = '当前选中不足 2 根管道（选中的管件按所属 BRAN 算）';
    }
    return;
  }
  // 导入的是整根管道：先前按直段选的改回整根量
  store.clearTubeKeys();
  if (isRowMode.value) {
    await detectPipeRowsSelected(refnos);
    return;
  }
  if (options.auto && refnos.length > AUTO_DETECT_MAX_BRANS) {
    store.setBranRefnos(refnos);
    store.detectNotice.value = `已带入当前选中的 ${refnos.length} 根管道；超过 ${AUTO_DETECT_MAX_BRANS} 根不自动检测，确认后点「重新检测」`;
    return;
  }
  await detectBransWithDtxFallback(refnos);
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as typeof window & {
    __plant3dPipeDistanceE2E?: {
      detectBrans: (refnos: string[]) => Promise<void>;
      detectPipeRows: (refnos: string[], alignMode?: 'center' | 'bottom') => Promise<boolean>;
      detectPipeRowTubes: (tubeKeys: string[], alignMode?: 'center' | 'bottom') => Promise<boolean>;
      setDebugResults: (results: PipeDistanceResult[]) => void;
      getSnapshot: () => {
        selectedBranRefnos: string[];
        selectedTubeKeys: string[];
        detectError: string | null;
        visibleResults: ClearanceRecord[];
        results: ClearanceRecord[];
      };
    };
  }).__plant3dPipeDistanceE2E = {
    detectBrans: detectBransWithDtxFallback,
    detectPipeRows: async (refnos: string[], alignMode?: 'center' | 'bottom') => {
      store.setBranRefnos(refnos);
      store.clearTubeKeys();
      ensureBransLoadedInScene(refnos);
      return store.runPipeRowDetection({
        alignMode,
        sourceAnnotation: toolStore.activeAnnotationContext.value,
      });
    },
    detectPipeRowTubes: async (tubeKeys: string[], alignMode?: 'center' | 'bottom') => {
      store.setTubeKeys(tubeKeys);
      ensureBransLoadedInScene(store.selectedBranRefnos.value);
      return store.runPipeRowDetection({
        alignMode,
        sourceAnnotation: toolStore.activeAnnotationContext.value,
      });
    },
    setDebugResults: (results: PipeDistanceResult[]) => {
      store.setBranRefnos([...new Set(results.flatMap((result) => [result.pipeA, result.pipeB]))]);
      const maxInjectedDistance = Math.max(0, ...results.map((result) => result.distance));
      if (Number.isFinite(maxInjectedDistance)) {
        store.maxDistance.value = Math.max(store.maxDistance.value, Math.ceil(maxInjectedDistance));
      }
      store.showAnnotations.value = true;
      store.commitPipeDistanceResults(results);
      store.detectError.value = null;
    },
    getSnapshot: () => ({
      selectedBranRefnos: [...store.selectedBranRefnos.value],
      selectedTubeKeys: [...store.selectedTubeKeys.value],
      detectError: store.detectError.value,
      visibleResults: [...store.visibleResults.value],
      results: [...store.pipeResults.value],
    }),
  };
}

// --- result click ---
/** 定位外扩余量（design mm）：两点连线或单点的包围盒是扁的甚至零体积，四周各放出一截再飞。 */
const FOCUS_MARGIN_MM = 500;

/** 一组 design 世界 mm 点外扩后的场景包围盒（8 个角点逐一换到场景系，场景矩阵带旋转也不失真）。 */
function paddedSceneAabb(points: readonly Vec3[], transform: (point: Vec3) => Vec3): [number, number, number, number, number, number] {
  const lo = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]!)) - FOCUS_MARGIN_MM);
  const hi = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]!)) + FOCUS_MARGIN_MM);
  const corners = [lo[0]!, hi[0]!].flatMap(x => [lo[1]!, hi[1]!].flatMap(y => [lo[2]!, hi[2]!].map(z => transform([x, y, z]))));
  const bound = (axis: 0 | 1 | 2, pick: (...values: number[]) => number) => pick(...corners.map(corner => corner[axis]));
  return [bound(0, Math.min), bound(1, Math.min), bound(2, Math.min), bound(0, Math.max), bound(1, Math.max), bound(2, Math.max)];
}

/** 高亮这些 BRAN 并飞到测量截面上的点（design 世界 mm）外扩后的包围盒；没有场景矩阵时退回构件包围盒。 */
function focusDesignPoints(points: readonly Vec3[], refnos: readonly string[]) {
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  try {
    const unique = [...new Set(refnos.filter(Boolean))];
    const applyFocus = () => {
      const prev = viewer.scene.selectedObjectIds;
      if (prev.length > 0) viewer.scene.setObjectsSelected(prev, false);
      viewer.scene.ensureRefnos(unique);
      viewer.scene.setObjectsSelected(unique, true);
      const transform = createSceneTransformPoint();
      const aabb = transform && points.length > 0 ? paddedSceneAabb(points, transform) : viewer.scene.getAABB(unique);
      if (aabb) {
        viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
      }
    };
    applyFocus();
    ensureBransLoadedInScene(unique, applyFocus);
  } catch {
    // ignore
  }
}

/** 行点击 / 定位：选中两侧构件（优先 provenance 实体 refno——平行直段记录的 inputs 是直段锚），飞到净距两端点的包围盒。 */
function onResultClick(record: ClearanceRecord) {
  store.setActiveResult(record.id);
  if (record.pipeRow) {
    // 连排记录定位到测量截面：两中心点（无快照时取截面点），不飞整条 BRAN 包围盒（§8）
    const points = record.snapshot ? [record.snapshot.sourcePoint, record.snapshot.targetPoint] : [record.pipeRow.section.point];
    focusDesignPoints(
      points.map(point => [point[0] * 1000, point[1] * 1000, point[2] * 1000] as Vec3),
      [record.provenance.source.refno || record.inputs.sourceRefno, record.provenance.target.refno || record.inputs.targetRefno],
    );
    return;
  }
  const viewer = ctx.viewerRef.value;
  if (!viewer) return;
  try {
    const refnos = [record.provenance.source.refno || record.inputs.sourceRefno,
      record.provenance.target.refno || record.inputs.targetRefno];
    const applyFocus = () => {
      // 取消之前的选中
      const prev = viewer.scene.selectedObjectIds;
      if (prev.length > 0) viewer.scene.setObjectsSelected(prev, false);
      // 高亮选中的管道对
      viewer.scene.ensureRefnos(refnos);
      viewer.scene.setObjectsSelected(refnos, true);
      // 飞行定位：优先飞到净距快照的两端点（design 米 → mm → 场景），没有快照退回构件包围盒
      const transform = createSceneTransformPoint();
      const [s, e] = record.snapshot
        ? [record.snapshot.sourcePoint, record.snapshot.targetPoint]
        : [null, null];
      const aabb = transform && s && e
        ? (() => {
          const sp = transform([s[0] * 1000, s[1] * 1000, s[2] * 1000] as Vec3);
          const ep = transform([e[0] * 1000, e[1] * 1000, e[2] * 1000] as Vec3);
          return [
            Math.min(sp[0], ep[0]), Math.min(sp[1], ep[1]), Math.min(sp[2], ep[2]),
            Math.max(sp[0], ep[0]), Math.max(sp[1], ep[1]), Math.max(sp[2], ep[2]),
          ] as [number, number, number, number, number, number];
        })()
        : viewer.scene.getAABB(refnos);
      if (aabb) {
        viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
      }
    };
    applyFocus();
    ensureBransLoadedInScene(refnos, applyFocus);
  } catch {
    // ignore
  }
}

function close() {
  if (isAnyPicking.value) {
    toolStore.cancelPickRefno();
  }
  emit('update:open', false);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    if (store.selectedBranRefnos.value.length > 0 || store.pipeResults.value.length > 0) return;
    void detectCurrentSelectedBrans({ quiet: true, auto: true });
  },
);

// --- validation helpers ---
const resultMinDistanceInput = computed({
  get: () => store.resultMinDistance.value ?? 0,
  set: (v: number) => {
    const n = Number(v);
    store.setResultMinDistance(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  },
});

const hiddenCount = computed(() => store.listedResults.value.filter((r) => store.hiddenResultIds.value.has(r.id)).length);

/** 记录行显示的距离（mm）：无快照的记录给 null——行显示「—」，阈值筛选跳过它（与旧 `results` 恒有距离的行为一致）。 */
function recordDistanceMm(record: ClearanceRecord): number | null {
  const distanceM = record.snapshot?.distanceM;
  return Number.isFinite(distanceM) ? distanceM! * 1000 : null;
}

/** 行内数值：连排记录自带口径与单位（名义接触 / 名义重叠 / 缺外径 / 估算 ≈），其余记录给整数毫米、单位另起一格，相交写「相交」。 */
function recordDistanceText(record: ClearanceRecord): string {
  if (record.pipeRow) return pipeRowValueText(record);
  if (record.snapshot?.intersects) return '相交';
  const mm = recordDistanceMm(record);
  return mm === null ? '—' : `${Math.round(mm)}`;
}

function recordStatusPrefix(record: ClearanceRecord): string {
  return record.status === 'stale' ? '过期，待重算 · ' : record.status === 'failed' ? '重算失败，旧值 · ' : '';
}

const OD_EVIDENCE_LABELS: Readonly<Record<OutsideDiameterEvidence, string>> = Object.freeze({
  catalogue: '目录外径',
  'bore-estimate': '通径估算',
  'legacy-member': '旧服务端成员外径，估算',
  unverified: '来源不可证',
  missing: '缺失',
});

function pointText(point: readonly number[]): string {
  return `(${point.map(v => v.toFixed(3)).join(', ')})`;
}

/**
 * 行悬停说明：连排记录给归排方式、截面位置、两侧外径与来源、关键点坐标；外表面净距记录给最近处（相交处）落在哪两个构件上；
 * 所有记录附计算警告。
 */
function recordDetailTitle(record: ClearanceRecord): string | undefined {
  const pipeRow = record.pipeRow;
  const warnings = computationWarningsText(record.provenance.warnings);
  if (!pipeRow) {
    return [
      computationMethodLabel(record.provenance.method),
      pipeClearanceLeavesText(record, findNounByRefnoAcrossAllDbnos),
      warnings,
    ].filter(Boolean).join('\n') || undefined;
  }
  const [x, y, z] = pipeRow.section.point;
  const od = (side: PipeRowSideOd) => `${side.odM === null ? '—' : `${Math.round(side.odM * 10000) / 10} mm`}（${OD_EVIDENCE_LABELS[side.evidence]}）`;
  const pairKey = pipeRowPairKey(record);
  const sibling = store.pipeResults.value.find(other => other.id !== record.id && pipeRowPairKey(other) === pairKey);
  const pair = sibling ? [record, sibling] : [record];
  const centers = pair.find(item => item.pipeRow?.metric === 'center-distance')?.snapshot;
  const surface = pair.find(item => item.pipeRow?.metric === 'derived-gap')?.snapshot;
  const bottom = pipeRow.bottomPoints;
  const currentMetricLabel = pipeRow.metric === 'center-distance' ? '中心距离（连排截面中心距）' : '名义距离（连排外径推导间隔）';
  return [
    `${currentMetricLabel}：${pipeRowValueText(record)}${sibling?.pipeRow ? ` · ${sibling.pipeRow.metric === 'center-distance' ? '中心距离' : '名义距离'}：${pipeRowValueText(sibling)}` : ''}`,
    `${pipeRow.alignMode === 'center' ? '管中心成排' : '管底对齐'} · 截面点 (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) m · 沿管向 ${pipeRow.section.axialStartM.toFixed(3)}–${pipeRow.section.axialEndM.toFixed(3)} m`,
    `外径：${od(pipeRow.sourceOd)} / ${od(pipeRow.targetOd)}`,
    centers ? `中心点：${pointText(centers.sourcePoint)} / ${pointText(centers.targetPoint)} m` : '',
    surface ? `外表面点：${pointText(surface.sourcePoint)} / ${pointText(surface.targetPoint)} m` : '',
    bottom ? `管底点：${pointText(bottom[0])} / ${pointText(bottom[1])} m` : '',
    warnings,
  ].filter(Boolean).join('\n');
}

function pipeRowSectionText(record: ClearanceRecord): string {
  const section = record.pipeRow?.section;
  return section ? `区段 ${(section.axialEndM - section.axialStartM).toFixed(2)} m` : '';
}

/** 识别预览：只展示与当前归排方式一致的最近一次连排检测（§8 第 3、4 点）。 */
const rowPreview = computed(() => {
  const detection = store.lastRowDetection.value;
  if (!detection || !isRowMode.value || detection.alignMode !== store.pipeRowAlignMode.value) return null;
  const generated = detection.groups.filter(group => isFormalPipeRowGroup(group) || store.confirmedRowKeys.value.has(group.key));
  const grouped = new Set(detection.groups.flatMap(group => group.members.map(member => member.anchorRefno)));
  return {
    groups: detection.groups,
    generatedRows: generated.length,
    generatedPairs: generated.reduce((n, group) => n + group.pairs.length, 0),
    held: detection.groups.filter(group => !isFormalPipeRowGroup(group) && !store.confirmedRowKeys.value.has(group.key)),
    unplaced: [...new Set(detection.sections.flatMap(section => section.unplacedAnchors))].filter(anchor => !grouped.has(anchor)),
    supportNormalDegenerate: detection.supportNormalDegenerate,
  };
});

function rowStatus(group: PipeRowGroup): Readonly<{ text: string; held: boolean }> {
  if (isFormalPipeRowGroup(group)) return { text: '已生成', held: false };
  if (store.confirmedRowKeys.value.has(group.key)) return { text: '已确认生成', held: false };
  const reasons = [
    group.ambiguous ? '多解' : '',
    group.incomplete ? '分组不完整' : '',
    group.estimatedGrouping ? '估算外径' : '',
  ].filter(Boolean);
  return { text: `待确认（${reasons.join('、')}）`, held: true };
}

function rowMembersText(group: PipeRowGroup): string {
  return group.members.map(member => member.branRefno).join(' · ');
}

/** 悬停看每对相邻：直段锚点与该对截面中心距。 */
function rowPairsTitle(group: PipeRowGroup): string {
  return group.pairs
    .map(pair => `${pair.source.anchorRefno} ↔ ${pair.target.anchorRefno}：中心距 ${Math.round(pair.centerDistanceMm)} mm`)
    .join('\n');
}

function rowLengthText(group: PipeRowGroup): string {
  return `${((group.section.axialEndMm - group.section.axialStartMm) / 1000).toFixed(2)} m`;
}

function isRowHidden(group: PipeRowGroup): boolean {
  const records = store.pipeRowGroupRecords(group.key);
  return records.length > 0 && records.every(record => store.hiddenResultIds.value.has(record.id));
}

function toggleRowHidden(group: PipeRowGroup) {
  store.setPipeRowGroupHidden(group.key, !isRowHidden(group));
}

function confirmRows(groups: readonly PipeRowGroup[]) {
  store.confirmPipeRowGroups(groups.map(group => group.key));
}

function locateRow(group: PipeRowGroup) {
  focusDesignPoints(
    group.members.map(member => [member.centerMm.x, member.centerMm.y, member.centerMm.z] as Vec3),
    group.members.map(member => member.branRefno),
  );
}

const PIPE_ROW_FALLBACK_NORMAL_OPTIONS = [
  ['none', '未指定'],
  ['+x', '+X'],
  ['-x', '−X'],
  ['+y', '+Y'],
  ['-y', '−Y'],
] as const;

/**
 * 数值输入框在失焦或回车时才提交（边打边夹会把 1500 的「1」先夹成 50）；换算后回写输入框——
 * 值没变时 Vue 不重画，留空或超界的框会一直那样留着。
 */
function commitNumberInput(event: Event, parse: (raw: string) => number): number {
  const input = event.target as HTMLInputElement;
  const value = parse(input.value);
  input.value = String(value);
  return value;
}

/** 「最大距离」（mm）与「中心距估算的最大夹角」（°）的取值范围和缺省。 */
const MAX_DISTANCE_INPUT = Object.freeze({ min: 50, max: 2000, fallback: 500 });
const MAX_ANGLE_INPUT = Object.freeze({ min: 1, max: 15, fallback: 5 });

function onMaxAdjacentChange(event: Event) {
  store.pipeRowMaxAdjacentMm.value = commitNumberInput(event, raw => positiveMmInput(raw, PIPE_ROW_DEFAULT_MAX_ADJACENT_MM));
}

function onMinCommonChange(event: Event) {
  store.pipeRowMinCommonMm.value = commitNumberInput(event, raw => positiveMmInput(raw, PIPE_ROW_DEFAULT_MIN_COMMON_MM));
}

function onMaxDistanceChange(event: Event) {
  store.maxDistance.value = commitNumberInput(event, raw => clampedNumberInput(raw, MAX_DISTANCE_INPUT));
}

function onMaxAngleChange(event: Event) {
  store.maxAngle.value = commitNumberInput(event, raw => clampedNumberInput(raw, MAX_ANGLE_INPUT));
}

function isResultHidden(id: string): boolean {
  return store.hiddenResultIds.value.has(id);
}

function onResultRowHover(id: string | null) {
  ctx.dimensionSystem.value?.viewport.setHover(id ? `clearance:${id}` : null);
}
</script>

<template>
  <div>
    <!-- drawer panel -->
    <Transition name="pd-drawer-slide">
      <div v-if="open"
        class="pointer-events-auto absolute bottom-0 right-0 top-0 flex w-80 flex-col border-l border-border bg-background/95 shadow-xl backdrop-blur"
        style="z-index: 942"
        @pointerdown.stop
        @wheel.stop
        @click.stop>
        <!-- header -->
        <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div class="text-sm font-semibold">距离标注控制</div>
          <button type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted"
            @click="close">
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- scrollable content -->
        <div class="flex-1 overflow-auto">
          <!-- 1. 显示控制 -->
          <div class="border-b border-border/60 px-4 py-3">
            <label class="flex cursor-pointer items-center gap-2">
              <span class="flex h-4 w-4 items-center justify-center rounded"
                :class="store.showAnnotations.value
                  ? 'bg-brand'
                  : 'border border-gray-300 bg-white'">
                <Check v-if="store.showAnnotations.value" class="h-3 w-3 text-white" />
              </span>
              <input v-model="store.showAnnotations.value" type="checkbox" class="sr-only" />
              <span class="text-sm">显示管道间距离标注</span>
            </label>
          </div>

          <!-- 2. 选择 BRAN 管道（点击 + 拖框 两种模式）；连排模式可细到直段 TUBI -->
          <div class="space-y-2 border-b border-border/60 px-4 py-3">
            <div v-if="isRowMode" class="grid grid-cols-2 gap-2" data-testid="pipe-row-pick-level">
              <button v-for="level in ([['bran', '整根管道'], ['tube', '直段 TUBI']] as const)" :key="level[0]"
                type="button"
                class="rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                :class="pickLevel === level[0]
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-input text-muted-foreground hover:bg-muted'"
                :disabled="isAnyPicking"
                @click="pickLevel = level[0]">
                {{ level[1] }}
              </button>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-md border-2 border-brand px-2 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
                :class="isPicking ? 'bg-brand/10' : ''"
                :title="isPicking ? '逐个点击 (Enter 确认 / ESC 取消)' : tubePicking ? '逐段点击直管 TUBI' : '逐根点击 BRAN'"
                @click="startPickBran">
                <MousePointerClick class="h-3.5 w-3.5" />
                <span>{{ isPicking ? '点击中...' : '点击选' }}</span>
              </button>
              <button type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-md border-2 border-brand px-2 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
                :class="isBoxPicking ? 'bg-brand/10' : ''"
                :title="tubePicking ? '在 3D 视图里拖框选择多段直管 TUBI' : '在 3D 视图里拖框选择多根 BRAN'"
                @click="startBoxPickBran">
                <BoxSelect class="h-3.5 w-3.5" />
                <span>{{ isBoxPicking ? '拖框中...' : '拖框选' }}</span>
              </button>
            </div>
            <button type="button"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              :disabled="store.isDetecting.value"
              title="导入当前选中的管道（选中管件按所属 BRAN）并立即检测，按整根量"
              @click="detectCurrentSelectedBrans()">
              <Check class="h-3.5 w-3.5" />
              当前选中并检测
            </button>
            <div v-if="isAnyPicking" class="text-[11px] text-muted-foreground">
              <template v-if="isPicking">{{ tubePicking ? '逐段点击直管 TUBI' : '逐根点击 BRAN' }}，按 Enter 确认 / ESC 取消{{ isRowMode ? '；确认后自动检测' : '' }}</template>
              <template v-else>在 3D 视图里按住左键拖出选择框（向左拖：完全包含；向右拖：相交即选）{{ isRowMode ? '；松开后自动检测' : '' }}</template>
            </div>
            <p v-else-if="tubePicking" class="text-[11px] text-muted-foreground">选了直段的管道只在所选直段上归排和测量，其余管道照整根量。</p>

            <!-- 已选管道列表 -->
            <div v-if="store.selectedBranRefnos.value.length > 0" class="space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">已选 {{ store.selectedBranRefnos.value.length }} 根管道{{ store.selectedTubeKeys.value.length > 0 ? `，其中直段 ${store.selectedTubeKeys.value.length} 段` : '' }}</span>
                <button type="button"
                  class="text-xs text-destructive hover:underline"
                  @click="store.clearBranRefnos()">
                  清空
                </button>
              </div>
              <div class="flex flex-wrap gap-1">
                <span v-for="refno in store.selectedBranRefnos.value" :key="refno"
                  class="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                  :title="isTubeRestricted(refno) ? '只量下面所选的直段' : undefined">
                  {{ refno }}{{ isTubeRestricted(refno) ? '（直段）' : '' }}
                  <button type="button"
                    class="hover:text-destructive"
                    @click="store.removeBranRefno(refno)">
                    <X class="h-3 w-3" />
                  </button>
                </span>
              </div>
              <div v-if="store.selectedTubeKeys.value.length > 0" class="flex flex-wrap gap-1" data-testid="pipe-row-selected-tubes">
                <span v-for="key in store.selectedTubeKeys.value" :key="key"
                  class="inline-flex items-center gap-1 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[11px] text-brand"
                  :title="key">
                  {{ tubeChipText(key) }}
                  <button type="button"
                    class="hover:text-destructive"
                    @click="store.removeTubeKey(key)">
                    <X class="h-3 w-3" />
                  </button>
                </span>
              </div>
              <p v-if="store.selectedTubeKeys.value.length > 0 && !isRowMode" class="text-[11px] text-muted-foreground">所有管对按整根管道检测，直段只用于连排相邻。</p>
            </div>
          </div>

          <!-- 3. 参数设置 -->
          <div class="space-y-3 border-b border-border/60 px-4 py-3">
            <!-- 检测模式 -->
            <div class="space-y-1">
              <label class="text-xs font-medium text-foreground">检测模式</label>
              <div class="grid grid-cols-2 gap-2">
                <button v-for="mode in ([['all-pairs', '所有管对'], ['pipe-row', '连排相邻']] as const)" :key="mode[0]"
                  type="button"
                  class="rounded-md border px-2 py-1.5 text-xs font-medium transition-colors"
                  :class="store.detectionMode.value === mode[0]
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-input text-muted-foreground hover:bg-muted'"
                  @click="store.detectionMode.value = mode[0]">
                  {{ mode[1] }}
                </button>
              </div>
            </div>

            <!-- 连排归排方式 -->
            <div v-if="isRowMode" class="space-y-1">
              <label class="text-xs font-medium text-foreground">归排方式</label>
              <div class="grid grid-cols-2 gap-2">
                <button v-for="align in ([['center', '管中心成排'], ['bottom', '管底对齐']] as const)" :key="align[0]"
                  type="button"
                  class="rounded-md border px-2 py-1.5 text-xs font-medium transition-colors"
                  :class="store.pipeRowAlignMode.value === align[0]
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-input text-muted-foreground hover:bg-muted'"
                  @click="store.pipeRowAlignMode.value = align[0]">
                  {{ align[1] }}
                </button>
              </div>
              <p class="text-[11px] text-muted-foreground">按真实中心线在共同区段内归排，只量排内相邻管；管底对齐以世界向上为支承法向，竖管组用下面指定的竖管支承法向。</p>
            </div>

            <!-- 竖管支承法向（管底对齐、主管向近铅直的组） -->
            <div v-if="isRowMode && store.pipeRowAlignMode.value === 'bottom'" class="space-y-1">
              <label class="text-xs font-medium text-foreground" for="pipe-row-fallback-normal">竖管支承法向</label>
              <select id="pipe-row-fallback-normal" v-model="store.pipeRowFallbackNormal.value"
                data-testid="pipe-row-fallback-normal"
                class="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <option v-for="option in PIPE_ROW_FALLBACK_NORMAL_OPTIONS" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
              </select>
              <p class="text-[11px]" :class="rowPreview?.supportNormalDegenerate ? 'text-amber-700' : 'text-muted-foreground'">
                {{ rowPreview?.supportNormalDegenerate
                  ? '有主管向近铅直的管组没法用世界向上归排：请指定管底贴靠的方向（如靠墙一侧）后重新检测。'
                  : '只用于主管向近铅直的管组；水平管组始终以世界向上为支承法向。' }}
              </p>
            </div>

            <!-- 排内相邻上限 -->
            <div v-if="isRowMode" class="space-y-1">
              <label class="text-xs font-medium text-foreground" for="pipe-row-max-adjacent">排内相邻上限</label>
              <div class="flex items-center gap-2">
                <input id="pipe-row-max-adjacent" :value="store.pipeRowMaxAdjacentMm.value"
                  type="number"
                  min="1"
                  data-testid="pipe-row-max-adjacent"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  @change="onMaxAdjacentChange" />
                <span class="text-xs text-muted-foreground">mm</span>
              </div>
              <p class="text-[11px] text-muted-foreground">相邻中心距超过它的两根管不算排管，在此断开，不量两组管廊之间、上下层之间的空档；缺省 1000 mm。</p>
            </div>

            <!-- 最短共同区段 -->
            <div v-if="isRowMode" class="space-y-1">
              <label class="text-xs font-medium text-foreground" for="pipe-row-min-common">最短共同区段</label>
              <div class="flex items-center gap-2">
                <input id="pipe-row-min-common" :value="store.pipeRowMinCommonMm.value"
                  type="number"
                  min="1"
                  data-testid="pipe-row-min-common"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  @change="onMinCommonChange" />
                <span class="text-xs text-muted-foreground">mm</span>
              </div>
              <p class="text-[11px] text-muted-foreground">两根管共同的直段短于它就不量，拐角处只并排一小截的不出尺寸；缺省 300 mm。选了直段时不限。</p>
            </div>

            <!-- 三维标注口径 -->
            <label v-if="isRowMode" class="flex cursor-pointer items-start gap-2" data-testid="pipe-row-both-metrics">
              <input v-model="store.pipeRowBothMetrics.value" type="checkbox" class="mt-0.5 h-3.5 w-3.5" />
              <span class="text-[11px] text-muted-foreground">同时显示中心距：列表多列「连排截面中心距」，三维每对再画一条中心距。不勾时只显示名义间隔，中心距在名义间隔的悬停说明里。</span>
            </label>

            <!-- 三维关键点 -->
            <label v-if="isRowMode" class="flex cursor-pointer items-start gap-2" data-testid="pipe-row-key-points">
              <input v-model="store.pipeRowKeyPoints.value" type="checkbox" class="mt-0.5 h-3.5 w-3.5" />
              <span class="text-[11px] text-muted-foreground">三维显示关键点（缺省不画）：截面上的管中心（×）、名义间隔两端的外表面点（○）；管底对齐时还有管底点（○）和支承线（虚线）。坐标在列表悬停说明里。</span>
            </label>

            <!-- 最大距离 -->
            <div v-if="!isRowMode" class="space-y-1">
              <label class="text-xs font-medium text-foreground" for="pipe-distance-max-distance">最大距离</label>
              <div class="flex items-center gap-2">
                <input id="pipe-distance-max-distance" :value="store.maxDistance.value"
                  type="number"
                  min="50" max="2000"
                  data-testid="pipe-distance-max-distance"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  @change="onMaxDistanceChange" />
                <span class="text-xs text-muted-foreground">mm</span>
              </div>
            </div>

            <!-- 最大夹角 -->
            <div v-if="!isRowMode" class="space-y-1">
              <label class="text-xs font-medium text-foreground" for="pipe-distance-max-angle">中心距估算的最大夹角</label>
              <div class="flex items-center gap-2">
                <input id="pipe-distance-max-angle" :value="store.maxAngle.value"
                  type="number"
                  min="1" max="15"
                  data-testid="pipe-distance-max-angle"
                  class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  @change="onMaxAngleChange" />
                <span class="text-xs text-muted-foreground">°</span>
              </div>
            </div>

            <p class="text-[11px] text-muted-foreground">{{ isRowMode ? '连排相邻按真实中心线归排，不用网格拟合兜底；每对相邻管出「截面中心距 + 外径推导间隔」两条记录，存疑的排进下方预览，确认后才生成。' : '批量检测所有管对的模型外表面净距，包含交叉和斜交；中心距估算会单独注明。' }}</p>

            <!-- 重新检测 -->
            <button v-if="!isRowMode && store.selectedBranRefnos.value.length === 1 && store.nearbySupported.value" type="button"
              :disabled="store.isDetecting.value"
              class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-primary px-3 text-xs text-primary disabled:opacity-50"
              @click="handleDetectNearby">
              检测这根管道的周边净距
            </button>
            <button type="button"
              :disabled="store.isDetecting.value || store.selectedBranRefnos.value.length < 2"
              class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              @click="handleDetect">
              <RefreshCw class="h-4 w-4" :class="store.isDetecting.value ? 'animate-spin' : ''" />
              <span>{{ store.isDetecting.value ? '检测中...' : '重新检测' }}</span>
            </button>
            <div v-if="!isRowMode && store.isDetecting.value && store.detectProgress.value"
              class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
              data-testid="pipe-distance-progress">
              <span>已算 {{ store.detectProgress.value.done }} / {{ store.detectProgress.value.total }} 对</span>
              <button type="button" class="text-brand hover:underline" @click="store.cancelDetection()">取消</button>
            </div>
            <!-- 连排识别预览：每排成员、区段、状态；存疑的排在这里确认后才生成结果 -->
            <div v-if="rowPreview && rowPreview.groups.length > 0" class="space-y-1.5" data-testid="pipe-row-preview">
              <div class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground" data-testid="pipe-row-summary">
                <span>识别 {{ rowPreview.groups.length }} 排：{{ rowPreview.generatedRows }} 排 / {{ rowPreview.generatedPairs }} 对已生成{{ rowPreview.held.length > 0 ? `，${rowPreview.held.length} 排待确认` : '' }}</span>
                <button v-if="rowPreview.held.length > 1" type="button" class="shrink-0 text-brand hover:underline" @click="confirmRows(rowPreview.held)">全部确认</button>
              </div>
              <div v-for="(group, index) in rowPreview.groups" :key="group.key"
                class="rounded-md border px-2 py-1.5 text-[11px]"
                :class="rowStatus(group).held ? 'border-amber-400/60 bg-amber-50/60' : 'border-border/60 bg-muted/30'"
                data-testid="pipe-row-preview-row">
                <div class="flex items-center gap-1.5">
                  <span class="font-medium text-foreground">排 {{ index + 1 }}</span>
                  <span class="text-muted-foreground">{{ group.members.length }} 根 · {{ group.pairs.length }} 对 · 区段 {{ rowLengthText(group) }}</span>
                  <span class="ml-auto shrink-0" :class="rowStatus(group).held ? 'text-amber-700' : 'text-muted-foreground'">{{ rowStatus(group).text }}</span>
                </div>
                <div class="truncate font-mono text-muted-foreground" :title="rowPairsTitle(group)">{{ rowMembersText(group) }}</div>
                <div v-for="line in group.diagnostics" :key="line" class="text-amber-700">{{ line }}</div>
                <div class="mt-1 flex items-center gap-3">
                  <button v-if="rowStatus(group).held" type="button" class="font-medium text-brand hover:underline" @click="confirmRows([group])">确认生成</button>
                  <button v-if="store.pipeRowGroupRecords(group.key).length > 0" type="button" class="text-muted-foreground hover:text-foreground" @click="toggleRowHidden(group)">{{ isRowHidden(group) ? '显示本排' : '隐藏本排' }}</button>
                  <button type="button" class="text-muted-foreground hover:text-foreground" @click="locateRow(group)">定位</button>
                </div>
              </div>
              <div v-if="rowPreview.unplaced.length > 0" class="text-[11px] text-muted-foreground">
                未归排：<span class="font-mono">{{ rowPreview.unplaced.join('、') }}</span>
              </div>
            </div>

            <div v-if="store.selectedBranRefnos.value.length < 2 && !store.isDetecting.value"
              class="text-xs text-muted-foreground">
              {{ isRowMode ? '选 2 根及以上可检测连排相邻管道'
                : store.nearbySupported.value ? '选 1 根可检测周边管道；选 2 根及以上可检测所有已选管对' : '选 2 根及以上可检测所有已选管对' }}
            </div>

            <!-- 错误提示 -->
            <div class="text-[11px] text-muted-foreground" data-testid="pipe-distance-persistence">
              {{ store.persistenceLabel.value }}
              <span v-if="store.persistenceError.value" class="text-danger">：{{ store.persistenceError.value }}</span>
              <button v-if="store.persistenceError.value || store.persistenceLabel.value.includes('未落盘')" type="button" class="ml-2 rounded border px-2 py-1" @click="store.persistRecords()">重试保存</button>
            </div>
            <div v-if="store.detectError.value"
              class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {{ store.detectError.value }}
            </div>
            <div v-if="store.detectNotice.value"
              class="rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-800"
              data-testid="pipe-distance-notice">
              {{ store.detectNotice.value }}
            </div>
            <details v-if="store.detectDiagnostics.value.length > 0"
              class="rounded-md border border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground"
              data-testid="pipe-distance-diagnostics">
              <summary class="cursor-pointer select-none">{{ diagnosticsSummary }}</summary>
              <ul class="mt-1 space-y-0.5">
                <li v-for="(line, index) in store.detectDiagnostics.value" :key="index">{{ line }}</li>
              </ul>
            </details>
          </div>

          <!-- 4. 检测结果 -->
          <div class="px-4 py-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-xs font-semibold text-foreground">
                检测结果 ({{ store.visibleResults.value.length }}
                <span v-if="store.visibleResults.value.length !== store.listedResults.value.length" class="text-muted-foreground">/ {{ store.listedResults.value.length }}</span>)
              </span>
              <button v-if="store.modeResults.value.length > 0" type="button"
                class="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                @click="store.clearModeResults()">
                <Trash2 class="h-3 w-3" />
                清空
              </button>
            </div>

            <!-- 距离阈值筛选 -->
            <div v-if="store.modeResults.value.length > 0" class="mb-2 flex items-center gap-2">
              <label class="text-[11px] text-muted-foreground whitespace-nowrap">仅看 ≥</label>
              <input v-model.number="resultMinDistanceInput"
                type="number"
                min="0" max="2000"
                placeholder="0"
                class="flex h-7 w-20 rounded-md border border-input bg-background px-2 py-0.5 font-mono text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <span class="text-[11px] text-muted-foreground">mm</span>
              <button v-if="store.resultMinDistance.value !== null || hiddenCount > 0"
                type="button"
                class="ml-auto text-[11px] text-brand hover:underline"
                @click="store.resetResultFilters()">
                重置筛选
              </button>
            </div>

            <div v-if="hiddenCount > 0" class="mb-2 text-[11px] text-muted-foreground">
              已隐藏 {{ hiddenCount }} 条
            </div>

            <div v-if="store.otherModeVisibleCount.value > 0" class="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground" data-testid="pipe-distance-other-mode">
              <span>另有 {{ store.otherModeVisibleCount.value }} 条其他模式的结果仍显示在三维中</span>
              <button type="button" class="text-brand hover:underline" @click="store.hideOtherModeResults()">隐藏它们</button>
            </div>

            <div v-if="store.listedResults.value.length === 0"
              class="py-4 text-center text-xs text-muted-foreground">
              暂无检测结果
            </div>

            <!-- result list (scrollable) -->
            <div v-else-if="store.visibleResults.value.length === 0"
              class="py-4 text-center text-xs text-muted-foreground">
              所有结果均被筛选 / 隐藏，<button type="button" class="text-brand hover:underline" @click="store.resetResultFilters()">点此重置</button>
            </div>
            <div v-else
              class="max-h-[200px] overflow-auto rounded-md border border-border">
              <div v-for="record in store.listedResults.value"
                v-show="!isResultHidden(record.id) && (store.resultMinDistance.value === null || recordDistanceMm(record) === null || recordDistanceMm(record)! >= store.resultMinDistance.value)"
                :key="record.id"
                class="group flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0"
                :class="store.activeResultId.value === record.id
                  ? 'bg-brand-subtle border-l-2 border-l-brand'
                  : 'hover:bg-muted'"
                :title="recordDetailTitle(record)"
                @mouseenter="onResultRowHover(record.id)"
                @mouseleave="onResultRowHover(null)"
                @click="onResultClick(record)">
                <span class="shrink-0 whitespace-nowrap font-mono text-sm font-semibold"
                  :class="store.activeResultId.value === record.id ? 'text-brand' : 'text-foreground'">
                  {{ recordDistanceText(record) }}
                </span>
                <span v-if="!record.pipeRow && !record.snapshot?.intersects && recordDistanceMm(record) !== null" class="text-xs text-muted-foreground">mm</span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-xs text-muted-foreground">
                    {{ record.provenance.source.refno || record.inputs.sourceRefno }} ↔ {{ record.provenance.target.refno || record.inputs.targetRefno }}
                  </span>
                  <span v-if="recordStatusPrefix(record) || record.pipeRow" class="truncate text-[11px] text-muted-foreground">
                    {{ recordStatusPrefix(record) }}{{ record.pipeRow ? pipeRowSectionText(record) : '' }}
                  </span>
                </span>
                <button type="button"
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-colors hover:bg-muted-foreground/20 hover:text-foreground group-hover:opacity-100"
                  :title="isResultHidden(record.id) ? '显示该条标注' : '隐藏该条标注'"
                  @click.stop="store.toggleResultHidden(record.id)">
                  <EyeOff v-if="isResultHidden(record.id)" class="h-3 w-3" />
                  <Eye v-else class="h-3 w-3" />
                </button>
                <button type="button"
                  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-muted-foreground/20 group-hover:opacity-100"
                  title="定位"
                  @click.stop="onResultClick(record)">
                  <Locate class="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pd-drawer-slide-enter-active,
.pd-drawer-slide-leave-active {
  transition: transform 0.25s ease;
}
.pd-drawer-slide-enter-from,
.pd-drawer-slide-leave-to {
  transform: translateX(100%);
}
.pd-drawer-fade-enter-active,
.pd-drawer-fade-leave-active {
  transition: opacity 0.25s ease;
}
.pd-drawer-fade-enter-from,
.pd-drawer-fade-leave-to {
  opacity: 0;
}
</style>
