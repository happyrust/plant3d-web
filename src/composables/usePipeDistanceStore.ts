/**
 * 管道间距离检测 状态管理（#64：结果真相收敛到 ClearanceStore）
 *
 * 本 store 只管批量入口与抽屉设置：已选 BRAN、检测参数、进行状态、UI 筛选。
 * 检测产物一律是 `component-to-component` 的 `ClearanceRecord`（`isPipeClearanceRecord` 界定本域），
 * 与交互式管-管 / 管-墙净距同一身份、同一隐藏 / 选择 / stale / 持久化语义。
 *
 * 参数口径（一处定义，抽屉文案照此写）：
 * - `maxDistance`（mm，50–2000）：**检测上限**——`surface-clearance` 的 `maxDistanceMm` 与
 *   「周边检测」的搜索半径共用这一个值；它不是结果过滤器（结果筛选看 `resultMinDistance`）。
 * - `maxAngle`（°，1–15）：**本地轴线估算兜底**的平行容差角，只喂 `detectDtxBranchAxisDistances`，
 *   服务端精算路径不消费它。
 */
import { computed, ref } from 'vue';

import type { Vec3 } from '@/types/vec3';

import {
  genModelV1ModelBounds,
  genModelV1SpatialCenterline,
  genModelV1SpatialNearbyBranches,
  genModelV1SurfaceClearance,
  isGenModelV1ApiError,
  type SpatialCenterlineResponse,
} from '@/api/genModelV1Api';
import {
  isPipeClearanceRecord,
  pipeDistanceInputs,
  pipeDistanceResultToClearanceRecord,
} from '@/clearance/adapters/pipeDistanceRecords';
import { commitPipeRowDetection, confirmPipeRowGroup, isPipeRowRecord } from '@/clearance/adapters/pipeRowRecords';
import { clearanceRecordId, withClearanceStatus, type ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import {
  PIPE_CONNECTED_CLEARANCE_MM,
  pipeConnection,
  pipeConnectivityLine,
  type PipeConnectionKind,
} from '@/clearance/domain/pipeConnectivity';
import {
  detectPipeRows,
  isFormalPipeRowGroup,
  runAnchorRefno,
  type PipeRowDetection,
  type PipeRowRunInput,
} from '@/clearance/domain/pipeRowGeometry';
import { PIPE_ROW_ALIGN_MODES, type PipeRowAlignMode } from '@/clearance/domain/pipeRowTypes';
import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import { cloneResultSnapshot } from '@/clearance/services/resultSnapshot';
import { createScopedResultPersistence } from '@/clearance/services/scopedResultPersistence';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import {
  buildStraightRuns,
  centerlineTubeSegmentRefno,
  splitRunBySegments,
  type Vec3Mm,
} from '@/composables/branParallelSpacing';
import { parseTubeKey, tubeKey } from '@/composables/spatialTree';

/**
 * 旧结果模型的输入形状——检测兜底（`detectDtxBranchAxisDistances` 的输出经抽屉补上 designPoints）、
 * 开发/E2E 注入和 `pipe` 快照段里的 legacy 结果仍然用它表达；进记录走
 * `pipeDistanceResultToClearanceRecord` 一次换完。
 */
export type PipeDistanceResult = {
  /** 与当前场景矩阵无关的 E3D 世界毫米坐标。 */
  designPoints?: { start: Vec3; end: Vec3; pipeAStart?: Vec3; pipeAEnd?: Vec3; pipeBStart?: Vec3; pipeBEnd?: Vec3 };
  status?: 'current' | 'stale';
  modelVersion?: { sourceSesno: number | null; targetSesno: number | null };
  id: string;
  distance: number; // mm
  measurementKind?: 'surface' | 'axis-estimate';
  pipeA: string;
  pipeB: string;
  start: Vec3;
  end: Vec3;
  pipeAStart?: Vec3;
  pipeAEnd?: Vec3;
  pipeBStart?: Vec3;
  pipeBEnd?: Vec3;
};

export type PipeDistanceDetectionOptions = {
  refnos?: string[];
  pairMode?: 'source-to-targets' | 'all-pairs';
  withinMaxDistance?: boolean;
};

const clearanceStore = useClearanceStore();

const maxDistance = ref(500); // mm，检测上限（range: 50-2000，见文件头口径）
const maxAngle = ref(5); // degree，本地轴线估算的平行容差（range: 1-15）
const selectedBranRefnos = ref<string[]>([]);
/**
 * 连排按直段测量时选中的直段（`tubeKey` 身份键）：有直段的 BRAN 只在这些直段上归排，其余照整根量；所有管对模式不看它
 * （外表面净距按整根 BRAN 算）。直段所属的 BRAN 一定也在 `selectedBranRefnos` 里。
 */
const selectedTubeKeys = ref<string[]>([]);
const isDetecting = ref(false);
const detectError = ref<string | null>(null);

const resultMinDistance = ref<number | null>(null);
/** 最近一次检测实际落库的记录数（0 = 本轮一条没算出来）。 */
const lastRunSettledCount = ref(0);
/** 一轮所有管对 / 周边检测里各管对的去向：抽屉据此给汇总提示，并判断要不要兜底。 */
export type PipeDetectionOutcome = Readonly<{ total: number; settled: number; beyond: number; connected: number; failed: number }>;
const lastRunOutcome = ref<PipeDetectionOutcome | null>(null);
/** 所有管对 / 周边检测的进度（已有结论的管对数 / 总管对数）；不在检测时为 null。 */
const detectProgress = ref<Readonly<{ done: number; total: number }> | null>(null);

/** 只在服务端把每一对都算失败时才用网格拟合兜底：超限、相连都是服务端给出的结论，不拿估算顶替。 */
export function needsAxisEstimateFallback(outcome: PipeDetectionOutcome | null): boolean {
  return !!outcome && outcome.failed > 0 && outcome.failed === outcome.total;
}
/** 计算失败的管对多于这么多条时，红字只列前几条，全部收进可展开的明细。 */
const FAILURE_LINES_SHOWN = 5;
/** 服务端支不支持周边检测（`nearby/branches`）；遇到这条路由不存在的 404 就置 false，本次会话收起入口。 */
const nearbySupported = ref(true);
/** 检测模式：`all-pairs` 外表面净距全对；`pipe-row` 连排相邻（真实中心线归排，见 plan §7）。 */
const detectionMode = ref<'all-pairs' | 'pipe-row'>('all-pairs');
/** 连排归排方式：`center` 管中心成排；`bottom` 管底对齐（缺省世界向上作支承法向）。 */
const pipeRowAlignMode = ref<PipeRowAlignMode>('center');
/** 最近一次连排检测的原始几何结果（逐截面扫描明细 + 排），供抽屉如实展示分组与诊断。 */
const lastRowDetection = ref<PipeRowDetection | null>(null);
/** 管底对齐时竖管组（世界向上在截面内退化）的支承法向：须人工指定，不按视图猜（§3.3 / R11）。 */
const PIPE_ROW_FALLBACK_NORMALS = Object.freeze({
  '+x': { x: 1, y: 0, z: 0 },
  '-x': { x: -1, y: 0, z: 0 },
  '+y': { x: 0, y: 1, z: 0 },
  '-y': { x: 0, y: -1, z: 0 },
});
export type PipeRowFallbackNormal = 'none' | keyof typeof PIPE_ROW_FALLBACK_NORMALS;
const PIPE_ROW_FALLBACK_NORMAL_KEYS: readonly string[] = ['none', ...Object.keys(PIPE_ROW_FALLBACK_NORMALS)];
const pipeRowFallbackNormal = ref<PipeRowFallbackNormal>('none');
/** 连排排内相邻中心距上限的缺省（mm）。 */
export const PIPE_ROW_DEFAULT_MAX_ADJACENT_MM = 1000;
/** 连排最短共同区段的缺省（mm）：拐角处两根管只并排一小截，不出尺寸。 */
export const PIPE_ROW_DEFAULT_MIN_COMMON_MM = 300;
/**
 * 连排排内相邻中心距上限（mm）：相距超过它的两根管不算排管——两组管廊之间、上下层之间的空档不量。
 * 归排规则，不是结果筛选；没有「不限」。
 */
const pipeRowMaxAdjacentMm = ref(PIPE_ROW_DEFAULT_MAX_ADJACENT_MM);
/** 连排最短共同区段（mm）：两根管共同的直段短于它就不归排；选了直段时不限（所选直段就是要量的地方）。 */
const pipeRowMinCommonMm = ref(PIPE_ROW_DEFAULT_MIN_COMMON_MM);
/** 连排同时显示中心距（列表与三维）；缺省只显示名义间隔（推导间隔），中心距在它的悬停说明里。 */
const pipeRowBothMetrics = ref(false);
/** 三维画连排关键点：截面上的两管中心、推导间隔两端的外表面点、管底对齐的管底点与支承线。缺省不画。 */
const pipeRowKeyPoints = ref(false);
/** 连排检测成功时的提示与诊断明细：提示要用户留意（待确认、缺口、旧服务端外径估算），诊断（穿过件、没有共同区段的管向组）收进详情。 */
const detectReport = ref<Readonly<{ notice: string | null; diagnostics: readonly string[] }>>({ notice: null, diagnostics: [] });
/** 不是失败，不写进 `detectError`；清掉提示连诊断一起清。 */
const detectNotice = computed<string | null>({
  get: () => detectReport.value.notice,
  set: notice => { detectReport.value = { notice, diagnostics: notice === null ? [] : detectReport.value.diagnostics }; },
});
const detectDiagnostics = computed(() => detectReport.value.diagnostics);
/** 预览里已人工确认的排键（只对 `lastRowDetection` 有意义）。 */
const confirmedRowKeys = ref<ReadonlySet<string>>(new Set());
/** 最近一次连排检测的提交上下文；`sequence` 与当前不符 = 之后有新检测 / 清空 / 换上下文，预览确认作废。 */
let lastRowContext: Readonly<{
  sequence: number;
  sesnoByBran: Readonly<Record<string, number | null>>;
  sourceAnnotation: Readonly<{ id: string; type: string }> | null;
}> | null = null;
let detectionSequence = 0;
/** 正在跑的所有管对检测：取消时把已有结论的管对按管对序落库。 */
let activeRun: Readonly<{ sequence: number; commit: () => void }> | null = null;
let calculationsAllowed = true;

/** 本抽屉的结果域：ClearanceStore 里 BRAN↔BRAN 的 component-to-component 记录。 */
const pipeResults = computed(() => clearanceStore.records.value.filter(isPipeClearanceRecord));

const showAnnotations = clearanceStore.showAnnotations;
const hiddenResultIds = clearanceStore.hiddenIds;

function recordDistanceMm(record: ClearanceRecord): number | null {
  const distanceM = record.snapshot?.distanceM;
  return Number.isFinite(distanceM) ? distanceM! * 1000 : null;
}

/** 当前抽屉模式的结果：所有管对 = 非连排记录；连排 = 当前归排方式的连排记录（三套结果不混在一个列表里）。 */
const modeResults = computed(() => pipeResults.value.filter(record => (detectionMode.value === 'pipe-row'
  ? record.pipeRow?.alignMode === pipeRowAlignMode.value
  : !record.pipeRow)));

/** 连排记录缺省只显示名义间隔（推导间隔），勾了「同时显示中心距」才把中心距也列出、画出。 */
function isMetricShown(record: ClearanceRecord): boolean {
  return !record.pipeRow || pipeRowBothMetrics.value || record.pipeRow.metric === 'derived-gap';
}

/** 列表列出的记录：当前模式里按口径显示的那些（清空、重置筛选等动作仍对整个模式）。 */
const listedResults = computed(() => modeResults.value.filter(isMetricShown));

/** 其他模式留下、不在当前列表里却仍按全局开关画在三维里的记录数（抽屉据此提示，可一键隐藏）。 */
const otherModeVisibleCount = computed(() => {
  const inMode = new Set(modeResults.value.map(record => record.id));
  return pipeResults.value.filter(record => !inMode.has(record.id) && !hiddenResultIds.value.has(record.id) && isMetricShown(record)).length;
});

/** 列表可见集：列出的记录里没隐藏 + 过距离阈值（无快照的记录没有距离可比，阈值不滤它，行显示「—」）。 */
const visibleResults = computed(() => listedResults.value.filter(record => {
  if (hiddenResultIds.value.has(record.id)) return false;
  const distanceMm = recordDistanceMm(record);
  return distanceMm === null || resultMinDistance.value === null || distanceMm >= resultMinDistance.value;
}));

function preparePipeSnapshot(value: unknown): () => void {
  if (value === null) return () => resetPipeSnapshot();
  // 脱离响应及实时 store，校验期间不改变任何显示或本机草稿。
  value = cloneResultSnapshot(value);
  const data = value as Record<string, unknown>;
  const apply = validatePipeSnapshot(data);
  return () => { resetPipeSnapshot(); apply(); };
}

function resetPipeSnapshot() {
  selectedBranRefnos.value = [];
  selectedTubeKeys.value = [];
  resultMinDistance.value = null;
  showAnnotations.value = true;
  maxDistance.value = 500;
  maxAngle.value = 5;
  detectionMode.value = 'all-pairs';
  pipeRowAlignMode.value = 'center';
  pipeRowFallbackNormal.value = 'none';
  pipeRowMaxAdjacentMm.value = PIPE_ROW_DEFAULT_MAX_ADJACENT_MM;
  pipeRowMinCommonMm.value = PIPE_ROW_DEFAULT_MIN_COMMON_MM;
  pipeRowBothMetrics.value = false;
  pipeRowKeyPoints.value = false;
  lastRowDetection.value = null;
  confirmedRowKeys.value = new Set();
  lastRowContext = null;
  detectError.value = null;
  detectNotice.value = null;
}

/**
 * `pipe` 快照段：#64 起只承载抽屉设置，`results`/`hiddenIds`/`activeIndex` 恒空——
 * 结果真相在 `component`（ClearanceStore）段。旧快照里若有 legacy `results`，
 * 恢复时逐条迁成 ClearanceRecord 写进 ClearanceStore（stale 态，语义与 component 恢复一致）。
 */
function validatePipeSnapshot(data: Record<string, unknown>): () => void {
  if (!data || data.coordinateSpace !== 'e3d-world-mm' || !Array.isArray(data.results) || !Array.isArray(data.selectedBranRefnos)
    || !data.selectedBranRefnos.every(item => typeof item === 'string') || !Array.isArray(data.hiddenIds)
    || !data.hiddenIds.every(item => typeof item === 'string') || typeof data.showAnnotations !== 'boolean'
    || typeof data.maxDistance !== 'number' || !Number.isFinite(data.maxDistance) || data.maxDistance <= 0
    || typeof data.maxAngle !== 'number' || !Number.isFinite(data.maxAngle) || data.maxAngle < 0 || data.maxAngle > 90
    || (data.detectionMode !== undefined && !['all-pairs', 'pipe-row'].includes(data.detectionMode as string))
    || (data.pipeRowAlignMode !== undefined && !PIPE_ROW_ALIGN_MODES.includes(data.pipeRowAlignMode as PipeRowAlignMode))
    || (data.pipeRowFallbackNormal !== undefined && !PIPE_ROW_FALLBACK_NORMAL_KEYS.includes(data.pipeRowFallbackNormal as string))
    || (data.pipeRowMaxAdjacentMm !== undefined && data.pipeRowMaxAdjacentMm !== null
      && (typeof data.pipeRowMaxAdjacentMm !== 'number' || !Number.isFinite(data.pipeRowMaxAdjacentMm) || data.pipeRowMaxAdjacentMm <= 0))
    || (data.selectedTubeKeys !== undefined && (!Array.isArray(data.selectedTubeKeys)
      || !data.selectedTubeKeys.every(item => typeof item === 'string' && parseTubeKey(item) !== null)))
    || (data.pipeRowMinCommonMm !== undefined
      && (typeof data.pipeRowMinCommonMm !== 'number' || !Number.isFinite(data.pipeRowMinCommonMm) || data.pipeRowMinCommonMm <= 0))
    || (data.pipeRowBothMetrics !== undefined && typeof data.pipeRowBothMetrics !== 'boolean')
    || (data.pipeRowShowKeyPoints !== undefined && typeof data.pipeRowShowKeyPoints !== 'boolean')
    || (data.minDistance !== null && (typeof data.minDistance !== 'number' || !Number.isFinite(data.minDistance) || data.minDistance < 0))) throw new Error('管间结果格式无效');
  const legacyResults = (data.results as PipeDistanceResult[]).map(result => {
    if (!result || typeof result.id !== 'string' || typeof result.pipeA !== 'string' || typeof result.pipeB !== 'string'
      || !result.pipeA || !result.pipeB || result.pipeA === result.pipeB || !Number.isFinite(result.distance) || result.distance < 0
      || !['surface', 'axis-estimate'].includes(result.measurementKind ?? '') || !result.designPoints
      || !optionalVec3(result.designPoints.start) || !optionalVec3(result.designPoints.end)
      || ['pipeAStart', 'pipeAEnd', 'pipeBStart', 'pipeBEnd'].some(key => {
        const point = result.designPoints?.[key as keyof NonNullable<PipeDistanceResult['designPoints']>];
        return point !== undefined && !optionalVec3(point);
      })) throw new Error('管间结果缺少可靠的世界毫米坐标');
    if (result.modelVersion && [result.modelVersion.sourceSesno, result.modelVersion.targetSesno].some(sesno => sesno !== null && (!Number.isInteger(sesno) || sesno < 0))) throw new Error('管间模型版本无效');
    return { ...result, status: 'stale' as const };
  });
  const migrated = legacyResults.map(result => pipeDistanceResultToClearanceRecord(result, new Date(0)));
  if (new Set(migrated.map(record => record.id)).size !== migrated.length) throw new Error('管间结果标识重复');
  const legacyHidden = new Set(data.hiddenIds as string[]);
  const activeIndex = typeof data.activeIndex === 'number' && Number.isInteger(data.activeIndex) ? data.activeIndex : null;
  const minDistance = data.minDistance as number | null;
  const annotations = data.showAnnotations;
  const distanceLimit = data.maxDistance;
  const angleLimit = data.maxAngle;
  const fallbackNormal = (data.pipeRowFallbackNormal ?? 'none') as PipeRowFallbackNormal;
  // 早先的快照可能没有这一格，或存的是当时的「不限」（null）：都按缺省上限——超过一定距离的就不是排管
  const adjacentLimit = typeof data.pipeRowMaxAdjacentMm === 'number' ? data.pipeRowMaxAdjacentMm : PIPE_ROW_DEFAULT_MAX_ADJACENT_MM;
  const minCommon = typeof data.pipeRowMinCommonMm === 'number' ? data.pipeRowMinCommonMm : PIPE_ROW_DEFAULT_MIN_COMMON_MM;
  const bothMetrics = data.pipeRowBothMetrics === true;
  const keyPoints = data.pipeRowShowKeyPoints === true;
  const branRefnos = data.selectedBranRefnos as string[];
  // 直段是后加的（可选）；所属 BRAN 不在选择里的直段丢掉，不让它把 BRAN 悄悄带回来
  const tubeKeys = ((data.selectedTubeKeys ?? []) as string[]).filter(key => branRefnos.includes(parseTubeKey(key)!.unitRefno));
  return () => {
    // 旧快照的结果先进 ClearanceStore（顺序在 component apply 之后，同 id 的记录按快照口径覆盖）
    const migratedIds: string[] = [];
    for (const [index, record] of migrated.entries()) {
      clearanceStore.upsertRecord(record);
      migratedIds.push(record.id);
      if (legacyHidden.has(legacyResults[index]!.id)) clearanceStore.setHidden(record.id, true);
    }
    if (activeIndex !== null && activeIndex >= 0 && activeIndex < migratedIds.length) {
      clearanceStore.setActive(migratedIds[activeIndex]!);
    }
    selectedBranRefnos.value = branRefnos;
    selectedTubeKeys.value = tubeKeys;
    resultMinDistance.value = minDistance;
    showAnnotations.value = annotations;
    maxDistance.value = distanceLimit;
    maxAngle.value = angleLimit;
    // 连排字段是后加的（可选）：旧快照没这两格就退回默认模式，不拿缺省值当格式错误。
    detectionMode.value = data.detectionMode === 'pipe-row' ? 'pipe-row' : 'all-pairs';
    pipeRowAlignMode.value = PIPE_ROW_ALIGN_MODES.includes(data.pipeRowAlignMode as PipeRowAlignMode)
      ? data.pipeRowAlignMode as PipeRowAlignMode
      : 'center';
    pipeRowFallbackNormal.value = fallbackNormal;
    pipeRowMaxAdjacentMm.value = adjacentLimit;
    pipeRowMinCommonMm.value = minCommon;
    pipeRowBothMetrics.value = bothMetrics;
    pipeRowKeyPoints.value = keyPoints;
  };
}

function restorePipeSnapshot(value: unknown) { preparePipeSnapshot(value)(); }

function capturePipeSnapshot() {
  return cloneResultSnapshot({ coordinateSpace: 'e3d-world-mm',
    // 结果真相在 component 段；保留字段形状让旧校验 / `hasReviewClearanceResults` 不破。
    results: [],
    selectedBranRefnos: selectedBranRefnos.value, selectedTubeKeys: selectedTubeKeys.value, hiddenIds: [],
    activeIndex: null, minDistance: resultMinDistance.value, showAnnotations: showAnnotations.value,
    maxDistance: maxDistance.value, maxAngle: maxAngle.value,
    detectionMode: detectionMode.value, pipeRowAlignMode: pipeRowAlignMode.value,
    pipeRowFallbackNormal: pipeRowFallbackNormal.value, pipeRowMaxAdjacentMm: pipeRowMaxAdjacentMm.value,
    pipeRowMinCommonMm: pipeRowMinCommonMm.value, pipeRowBothMetrics: pipeRowBothMetrics.value, pipeRowShowKeyPoints: pipeRowKeyPoints.value });
}

const persistence = createScopedResultPersistence({
  prefix: 'plant3d-pipe-distance-v1',
  sources: [selectedBranRefnos, selectedTubeKeys, resultMinDistance, showAnnotations, maxDistance, maxAngle, detectionMode, pipeRowAlignMode,
    pipeRowFallbackNormal, pipeRowMaxAdjacentMm, pipeRowMinCommonMm, pipeRowBothMetrics, pipeRowKeyPoints],
  capture: capturePipeSnapshot,
  restore: restorePipeSnapshot,
  invalidate: allowed => {
    calculationsAllowed = allowed;
    detectionSequence += 1;
    isDetecting.value = false;
    detectProgress.value = null;
    activeRun = null;
  },
});

function normalizeBranRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

/** 无序管对键：同一对 BRAN 不管谁先点都算同一对（与记录 id 的 inputs 语义一致）。 */
function pipePairKey(a: string, b: string): string {
  return [normalizeBranRefno(a), normalizeBranRefno(b)].sort().join('|');
}

/** 有序管对：所有管对按 refno 定方向（小的作源），反序重选还是同一条记录；周边检测保持「选中的管 → 周边的管」。 */
function orderedPair(first: string, second: string, canonical: boolean): [string, string] {
  return canonical && second < first ? [second, first] : [first, second];
}

/** 同一对 BRAN 两个方向各有一条记录（旧版反序重选留下的）：只留较新的一条，任一条隐藏过就继续隐藏。 */
function dedupeReversePipeRecords() {
  const kept = new Map<string, ClearanceRecord>();
  for (const record of pipeResults.value) {
    if (record.pipeRow) continue;
    const key = pipePairKey(record.inputs.sourceRefno, record.inputs.targetRefno);
    const other = kept.get(key);
    if (!other) {
      kept.set(key, record);
      continue;
    }
    const [newer, older] = record.computedAt > other.computedAt ? [record, other] : [other, record];
    if (hiddenResultIds.value.has(older.id)) clearanceStore.setHidden(newer.id, true);
    clearanceStore.removeRecord(older.id);
    kept.set(key, newer);
  }
}

/** 每根 BRAN 发一个请求（最多 4 个同时在飞）；取不到的不进结果，调用方照常发净距请求。新检测 / 清空 / 换上下文后不再发。 */
async function fetchPerBran<T>(refnos: readonly string[], sequence: number, fetchOne: (refno: string) => Promise<T | null>): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < refnos.length && sequence === detectionSequence) {
      const refno = refnos[cursor++]!;
      const value = await fetchOne(refno).catch(() => null);
      if (value !== null) found.set(refno, value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, refnos.length) }, worker));
  return found;
}

type ModelBox = Readonly<{ min: readonly number[]; max: readonly number[] }>;

function modelBox(bounds: Readonly<{ min_mm?: unknown; max_mm?: unknown }> | null | undefined): ModelBox | null {
  const corner = (value: unknown) => (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value as number[] : null);
  const min = corner(bounds?.min_mm);
  const max = corner(bounds?.max_mm);
  return min && max ? { min, max } : null;
}

/** 两个模型包围盒之间的距离（mm）：不大于两侧网格的真实最近距离，大于上限的管对一定超限。 */
function modelBoxDistanceMm(a: ModelBox, b: ModelBox): number {
  return Math.hypot(...[0, 1, 2].map(axis => Math.max(0, a.min[axis]! - b.max[axis]!, b.min[axis]! - a.max[axis]!)));
}

/** 直段身份键规范化（所属 BRAN 与两端都换成 `a_b`）；不是直段键回空串。 */
function normalizeTubeKey(key: string): string {
  const tube = parseTubeKey(key);
  return tube
    ? tubeKey(normalizeBranRefno(tube.unitRefno), { from: normalizeBranRefno(tube.from), to: normalizeBranRefno(tube.to), ordinal: tube.ordinal })
    : '';
}

function tubeOwner(key: string): string {
  return parseTubeKey(key)?.unitRefno ?? '';
}

/** 按直段量的 BRAN → 所选直段对应的中心线管段 refno（只收 `branRefnos` 里的 BRAN）。 */
function tubeSegmentsByBran(tubeKeys: readonly string[], branRefnos: readonly string[]): Map<string, Set<string>> {
  const segments = new Map<string, Set<string>>();
  for (const key of tubeKeys) {
    const tube = parseTubeKey(key);
    if (!tube || !branRefnos.includes(tube.unitRefno)) continue;
    const set = segments.get(tube.unitRefno) ?? new Set<string>();
    set.add(centerlineTubeSegmentRefno(tube.unitRefno, tube));
    segments.set(tube.unitRefno, set);
  }
  return segments;
}

function optionalVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  return value.every(item => typeof item === 'number' && Number.isFinite(item)) ? [...value] as Vec3 : undefined;
}

export function usePipeDistanceStore() {
  function includeBran(normalized: string) {
    if (normalized && !selectedBranRefnos.value.includes(normalized)) {
      selectedBranRefnos.value.push(normalized);
    }
  }

  function dropTubesOf(isDropped: (branRefno: string) => boolean) {
    if (selectedTubeKeys.value.some(key => isDropped(tubeOwner(key)))) {
      selectedTubeKeys.value = selectedTubeKeys.value.filter(key => !isDropped(tubeOwner(key)));
    }
  }

  /** 整根选一根 BRAN：它先前若只选了直段，改回整根量。 */
  function addBranRefno(refno: string) {
    const normalized = normalizeBranRefno(refno);
    includeBran(normalized);
    dropTubesOf(owner => owner === normalized);
  }

  function setBranRefnos(refnos: string[]) {
    const seen = new Set<string>();
    selectedBranRefnos.value = refnos
      .map(normalizeBranRefno)
      .filter((refno) => {
        if (!refno || seen.has(refno)) return false;
        seen.add(refno);
        return true;
      });
    dropTubesOf(owner => !seen.has(owner));
  }

  function removeBranRefno(refno: string) {
    const normalized = normalizeBranRefno(refno);
    const idx = selectedBranRefnos.value.indexOf(normalized);
    if (idx >= 0) selectedBranRefnos.value.splice(idx, 1);
    dropTubesOf(owner => owner === normalized);
  }

  function clearBranRefnos() {
    selectedBranRefnos.value = [];
    selectedTubeKeys.value = [];
  }

  /** 选一段直段（`tubeKey`）：所属 BRAN 一并进选择，此后这根 BRAN 只在所选直段上归排。 */
  function addTubeKey(key: string) {
    const normalized = normalizeTubeKey(key);
    if (!normalized) return;
    includeBran(tubeOwner(normalized));
    if (!selectedTubeKeys.value.includes(normalized)) selectedTubeKeys.value = [...selectedTubeKeys.value, normalized];
  }

  /** 去掉一段直段；那根 BRAN 的直段去光了它也移出选择——它是跟着直段进来的，不悄悄改成整根量。 */
  function removeTubeKey(key: string) {
    const normalized = normalizeTubeKey(key);
    const owner = tubeOwner(normalized);
    selectedTubeKeys.value = selectedTubeKeys.value.filter(item => item !== normalized);
    if (owner && !selectedTubeKeys.value.some(item => tubeOwner(item) === owner)) removeBranRefno(owner);
  }

  /** 整组换成这些直段，选择即它们所属的 BRAN。 */
  function setTubeKeys(keys: string[]) {
    const normalized = [...new Set(keys.map(normalizeTubeKey).filter(Boolean))];
    selectedTubeKeys.value = normalized;
    selectedBranRefnos.value = [...new Set(normalized.map(tubeOwner))];
  }

  /** 全部 BRAN 改回整根量（选择不变）。 */
  function clearTubeKeys() {
    selectedTubeKeys.value = [];
  }

  function setActiveResult(id: string | null) {
    clearanceStore.setActive(id);
  }

  function toggleResultHidden(id: string) {
    clearanceStore.toggleHidden(id);
  }

  function setResultMinDistance(min: number | null) {
    if (min === null || !Number.isFinite(min) || min <= 0) {
      resultMinDistance.value = null;
      return;
    }
    resultMinDistance.value = min;
  }

  /** 重置当前列表的筛选：只放出当前模式里隐藏的记录（其他模式被一键隐藏的结果不在这个列表里）。 */
  function resetResultFilters() {
    for (const record of modeResults.value) {
      if (hiddenResultIds.value.has(record.id)) clearanceStore.setHidden(record.id, false);
    }
    resultMinDistance.value = null;
  }

  function hideOtherModeResults() {
    const inMode = new Set(modeResults.value.map(record => record.id));
    for (const record of pipeResults.value) {
      if (!inMode.has(record.id) && !hiddenResultIds.value.has(record.id)) clearanceStore.setHidden(record.id, true);
    }
  }

  /** 某一排（`pipeRow.rowGroupId`）现存的连排记录。 */
  function pipeRowGroupRecords(rowKey: string): ClearanceRecord[] {
    return pipeResults.value.filter(record => record.pipeRow?.rowGroupId === rowKey);
  }

  /** 单排开关（R15）：只动这一排的记录；列表与三维用同一隐藏集，不碰其他排与其他来源的净距。 */
  function setPipeRowGroupHidden(rowKey: string, hidden: boolean) {
    for (const record of pipeRowGroupRecords(rowKey)) clearanceStore.setHidden(record.id, hidden);
  }

  /** 一对 BRAN 现存的净距记录，两个方向都查（反序选过留下的旧记录也是同一对）。 */
  function pairRecords(sourceRefno: string, targetRefno: string): ClearanceRecord[] {
    return [pipeDistanceInputs(sourceRefno, targetRefno), pipeDistanceInputs(targetRefno, sourceRefno)]
      .map(inputs => clearanceStore.findRecord(clearanceRecordId(inputs)))
      .filter((record): record is ClearanceRecord => record !== null);
  }

  /**
   * `PipeDistanceResult` 形状的一批结果（轴线估算兜底、开发 / E2E 注入、legacy 数据）整组落 ClearanceStore：
   * 只替换这批覆盖到的管对的既有记录，其他记录的真相不动；返回落库后的记录。
   */
  function commitPipeDistanceResults(results: PipeDistanceResult[]): ClearanceRecord[] {
    const pairs = new Set(results.map(result => pipePairKey(result.pipeA, result.pipeB)));
    for (const record of pipeResults.value) {
      if (pairs.has(pipePairKey(record.inputs.sourceRefno, record.inputs.targetRefno))) {
        clearanceStore.removeRecord(record.id);
      }
    }
    const created = results.map(result => clearanceStore.upsertRecord(pipeDistanceResultToClearanceRecord(result, new Date())));
    if (created.length > 0) clearanceStore.setActive(created[0]!.id);
    return created;
  }

  async function runDetection(options: PipeDistanceDetectionOptions = {}) {
    const sequence = ++detectionSequence;
    detectProgress.value = null;
    activeRun = null;
    if (!calculationsAllowed) { detectError.value = '历史版本对比中不能使用当前模型检测管间净距，请退出对比后重算。'; return false; }
    if (options.refnos) {
      setBranRefnos(options.refnos);
    }

    const branRefnos = [...selectedBranRefnos.value];
    if (branRefnos.length < 2) {
      isDetecting.value = false;
      lastRunSettledCount.value = 0;
      lastRunOutcome.value = null;
      detectError.value = '请至少选择 2 个构件';
      return false;
    }

    isDetecting.value = true;
    detectError.value = null;
    detectNotice.value = null;
    lastRunOutcome.value = null;

    // 工作台批量检测所有唯一管对（按 refno 定方向）；保留源→目标模式供周边检测与既有调用使用。
    const allPairs = options.pairMode === 'all-pairs';
    const pairs: [string, string][] = [];
    for (let i = 0; i < branRefnos.length - 1; i += 1) {
      if (i > 0 && !allPairs) break;
      for (let j = i + 1; j < branRefnos.length; j += 1) pairs.push(orderedPair(branRefnos[i]!, branRefnos[j]!, allPairs));
    }
    const distanceLimit = Number.isFinite(maxDistance.value) && maxDistance.value > 0 ? maxDistance.value : 500;
    const limited = allPairs || options.withinMaxDistance === true;

    // 本轮各管对的结论先收在这里，正常结束或取消时按管对序统一落库。
    // 超限（没靠近）是服务端给的结论，不是失败：只计数，收尾时汇总成一句提示；红字只留真正算失败的管对
    const failures: string[] = [];
    let beyond = 0;
    // 相连的管（首尾或支管相接）外表面本来就贴着，不计净距：确定相连的不发请求，疑似的回来不超过 1 mm 才算相连
    const connected: { pair: [string, string]; kind: PipeConnectionKind }[] = [];
    const settled: (ClearanceRecord | null)[] = Array(pairs.length).fill(null);
    // 现存记录要改的状态先记下，等回包到齐、本轮仍有效时再改：迟到的回包不许把已清空、已换上下文的记录写回去
    const invalidated = new Map<number, 'stale' | 'failed'>();
    const unlined: string[] = [];
    let done = 0;
    const progress = () => {
      if (sequence === detectionSequence) detectProgress.value = { done, total: pairs.length };
    };
    const commit = (cancelled: boolean) => {
      for (const [index, status] of invalidated) {
        const [sourceRefno, targetRefno] = pairs[index]!;
        for (const record of pairRecords(sourceRefno, targetRefno)) {
          if (status === 'failed' ? record.status !== 'failed' : record.status === 'current') {
            clearanceStore.upsertRecord(withClearanceStatus(record, status));
          }
        }
      }
      // 相连不计净距：之前按净距存下的（0 mm、相交）一并撤掉
      for (const { pair: [sourceRefno, targetRefno] } of connected) {
        for (const record of pairRecords(sourceRefno, targetRefno)) clearanceStore.removeRecord(record.id);
      }
      lastRunSettledCount.value = 0;
      let first: ClearanceRecord | null = null;
      for (const [index, record] of settled.entries()) {
        if (!record) continue;
        // 反序选过留下的另一方向旧记录由这一条接替，隐藏状态跟过来
        const [sourceRefno, targetRefno] = pairs[index]!;
        const previous = pairRecords(sourceRefno, targetRefno);
        const hidden = previous.some(old => hiddenResultIds.value.has(old.id));
        for (const old of previous) {
          if (old.id !== record.id) clearanceStore.removeRecord(old.id);
        }
        const saved = clearanceStore.upsertRecord(record);
        if (hidden) clearanceStore.setHidden(saved.id, true);
        lastRunSettledCount.value += 1;
        first ??= saved;
      }
      clearanceStore.setActive(first?.id ?? null);
      lastRunOutcome.value = {
        total: pairs.length, settled: lastRunSettledCount.value, beyond, connected: connected.length, failed: failures.length,
      };

      const limitText = limited ? `在 ${distanceLimit} mm 内` : '在服务端最大距离内';
      const notes: string[] = [];
      if (cancelled) notes.push(`已取消：${done} / ${pairs.length} 对已有结论，算出的结果已保留`);
      if (beyond === pairs.length) notes.push(`所选 ${pairs.length} 对管道${limitText}都没有靠近，未出结果`);
      else if (beyond > 0) notes.push(`另有 ${beyond} 对${limitText}没有靠近，未出结果`);
      if (connected.length > 0) notes.push(`${connected.length} 对相连（首尾或支管相接），不计净距`);
      // 有几对没算出来就如实列出（两侧都写），别让「N 条结果」盖住缺的那几对；太多时红字只列前几条，全部进明细
      const folded = failures.length > FAILURE_LINES_SHOWN;
      detectReport.value = {
        notice: notes.length > 0 ? notes.join('；') : null,
        diagnostics: [
          ...connected.map(({ pair: [sourceRefno, targetRefno], kind }) => `相连：${sourceRefno} ↔ ${targetRefno}（${kind === 'ends' ? '首尾相接' : '支管相接'}）`),
          ...(unlined.length > 0 ? [`${unlined.length} 根管道取不到中心线，没判断它们与别的管道是否相连：${unlined.join('、')}`] : []),
          ...(folded ? failures.map(line => `计算失败：${line}`) : []),
        ],
      };
      if (failures.length > 0) {
        detectError.value = folded
          ? `${failures.length} 对计算失败：${failures.slice(0, FAILURE_LINES_SHOWN).join('；')}；其余见明细`
          : failures.join('；');
      }
    };
    activeRun = { sequence, commit: () => commit(true) };
    progress();

    try {
      // 先取中心线判相连；管对比管道多时再取模型边界预筛（盒距不大于真实距离，筛掉的一定超限）
      const [lines, boxes] = await Promise.all([
        fetchPerBran(branRefnos, sequence, async refno => pipeConnectivityLine(refno, await genModelV1SpatialCenterline(refno))),
        limited && pairs.length > branRefnos.length
          ? fetchPerBran(branRefnos, sequence, async refno => modelBox(await genModelV1ModelBounds(refno)))
          : new Map<string, ModelBox>(),
      ]);
      if (sequence !== detectionSequence) return false;
      unlined.push(...branRefnos.filter(refno => !lines.has(refno)));
      const jobs: { index: number; suspected: boolean }[] = [];
      for (const [index, [sourceRefno, targetRefno]] of pairs.entries()) {
        const sourceLine = lines.get(sourceRefno);
        const targetLine = lines.get(targetRefno);
        const connection = sourceLine && targetLine ? pipeConnection(sourceLine, targetLine) : null;
        const sourceBox = boxes.get(sourceRefno);
        const targetBox = boxes.get(targetRefno);
        if (connection === 'ends') {
          connected.push({ pair: [sourceRefno, targetRefno], kind: 'ends' });
          done += 1;
        } else if (sourceBox && targetBox && modelBoxDistanceMm(sourceBox, targetBox) > distanceLimit) {
          beyond += 1;
          invalidated.set(index, 'stale');
          done += 1;
        } else {
          jobs.push({ index, suspected: connection === 'branch' });
        }
      }
      progress();
      let cursor = 0;
      // 最多 4 个净距请求同时在飞
      const worker = async () => {
        while (cursor < jobs.length && sequence === detectionSequence) {
          const { index, suspected } = jobs[cursor++]!;
          const [sourceRefno, targetRefno] = pairs[index]!;
          const inputs = { ...pipeDistanceInputs(sourceRefno, targetRefno), maxDistanceMm: distanceLimit };
          try {
            const resp = await genModelV1SurfaceClearance({
              sourceRefno,
              targetRefno,
              targetKind: 'any',
              perpendicular: false,
              ...(limited ? { maxDistanceMm: distanceLimit } : {}),
            });
            if (sequence !== detectionSequence) return;
            if (!resp.success || resp.unit !== 'mm' || resp.method !== 'surface_to_surface' || resp.accuracy_class !== 'exact-surface'
              || !Number.isFinite(resp.error_bound_mm) || resp.error_bound_mm < 0 || resp.error_bound_mm > 10) {
              failures.push(`${sourceRefno} ↔ ${targetRefno}：净距口径或误差界无效`);
              invalidated.set(index, 'stale');
              continue;
            }
            if (!resp.result || (limited && resp.result.distance_mm > distanceLimit)) {
              beyond += 1;
              // 重算说「没有靠近」：现存记录口径已不成立，标 stale 而不是装没看见。
              invalidated.set(index, 'stale');
              continue;
            }
            if (!Number.isFinite(resp.result.distance_mm) || resp.result.distance_mm < 0
            || ![resp.result.source_point, resp.result.target_point].every(point =>
              [point.x, point.y, point.z].every(Number.isFinite))) {
              failures.push(`${sourceRefno} ↔ ${targetRefno}：距离或最近点无效`);
              invalidated.set(index, 'stale');
              continue;
            }
            if (suspected && resp.result.distance_mm <= PIPE_CONNECTED_CLEARANCE_MM) {
              connected.push({ pair: [sourceRefno, targetRefno], kind: 'branch' });
              continue;
            }
            // 先收进按管对序的 settled，worker 全部结束后统一 upsert——记录顺序不随请求完成先后漂。
            settled[index] = surfaceClearanceToRecord(resp, inputs, new Date());
          } catch (error) {
            if (sequence !== detectionSequence) return;
            const message = isGenModelV1ApiError(error) ? error.message : error instanceof Error ? error.message : String(error);
            failures.push(`${sourceRefno} ↔ ${targetRefno}：${message}`);
            // 计算出错：已有记录标 failed 留住旧快照（与 store.compute 的语义一致）。
            invalidated.set(index, 'failed');
          } finally {
            done += 1;
            progress();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
      if (sequence !== detectionSequence) return false;
      commit(false);
    } catch (e) {
      if (sequence !== detectionSequence) return false;
      const msg = e instanceof Error ? e.message : String(e);
      detectError.value = `检测失败: ${msg}`;
      console.error('[PipeDistance] runDetection failed:', e);
    } finally {
      if (sequence === detectionSequence) {
        isDetecting.value = false;
        detectProgress.value = null;
        activeRun = null;
      }
    }
    return true;
  }

  /** 取消所有管对检测：已有结论的管对按管对序落库，之后到的回包丢掉。 */
  function cancelDetection() {
    const run = activeRun;
    if (!run || run.sequence !== detectionSequence) return;
    run.commit();
    detectionSequence += 1;
    isDetecting.value = false;
    detectProgress.value = null;
    activeRun = null;
  }

  /**
   * 连排相邻检测（plan §7）：已选 BRAN 的真实中心线 → 直段 → `detectPipeRows` 归排 →
   * 每对相邻管两条记录（`piperow` 命名空间：截面中心距 + 外径推导间隔）。
   *
   * - 只认真实中心线：任一已选 BRAN 拉不到中心线，本次就不归排、不写新结果（R13 / §5.7：缺了它，
   *   隔着它的两根管会被当成相邻）；它参与过的旧连排记录标 `failed` 留旧快照，其余记录不动。
   *   不挂 `detectDtxBranchAxisDistances` 的网格拟合兜底——拟合轴线的归排没有意义（§1 决策）。
   * - 摘除范围 = 本次全部 BRAN 的直段锚点 ∪ 旧记录里两侧都属本次 BRAN 的锚点
   *   （同一 BRAN 重算后锚点漂移的旧记录也能被收走）。多解 / 分组不完整的排不出正式记录，见 `commitPipeRowDetection`。
   * - 选了直段的 BRAN 只在所选直段上归排（`selectedTubeKeys`；成员序连续的选中段合成子直段）。摘除范围对它只含这次
   *   重量的整条直段上的段，别的直段上已有的连排结果不动。
   * - `sequence` 防护与 `runDetection` 同口径：新检测 / 清空 / 换上下文后迟到的结果不写库。
   */
  async function runPipeRowDetection(options: {
    alignMode?: PipeRowAlignMode;
    supportNormal?: Vec3Mm;
    sourceAnnotation?: Readonly<{ id: string; type: string }> | null;
  } = {}): Promise<boolean> {
    const sequence = ++detectionSequence;
    detectProgress.value = null;
    activeRun = null;
    if (!calculationsAllowed) { detectError.value = '历史版本对比中不能使用当前模型检测管道连排，请退出对比后重算。'; return false; }
    const alignMode = options.alignMode ?? pipeRowAlignMode.value;
    const branRefnos = [...selectedBranRefnos.value];
    const tubeSegments = tubeSegmentsByBran(selectedTubeKeys.value, branRefnos);
    if (branRefnos.length < 2) {
      isDetecting.value = false;
      lastRunSettledCount.value = 0;
      detectError.value = '连排相邻检测请至少选择 2 根管道';
      return false;
    }
    isDetecting.value = true;
    detectError.value = null;
    detectNotice.value = null;
    confirmedRowKeys.value = new Set();
    lastRowContext = null;
    try {
      const warnings: string[] = [];
      const lines = new Map<string, SpatialCenterlineResponse>();
      const failed = new Map<string, string>();
      let cursor = 0;
      const worker = async () => {
        while (cursor < branRefnos.length && sequence === detectionSequence) {
          const refno = branRefnos[cursor]!; cursor += 1;
          try {
            const resp = await genModelV1SpatialCenterline(refno);
            if (!resp || !Array.isArray(resp.segments)
              || resp.segments.some(s => !s || typeof s.refno !== 'string'
                || ![s.start?.x, s.start?.y, s.start?.z, s.end?.x, s.end?.y, s.end?.z].every(Number.isFinite))) {
              throw new Error('中心线响应无效');
            }
            lines.set(refno, resp);
          } catch (error) {
            failed.set(refno, isGenModelV1ApiError(error) ? error.message : error instanceof Error ? error.message : String(error));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, branRefnos.length) }, worker));
      if (sequence !== detectionSequence) return false;

      const inputs: PipeRowRunInput[] = [];
      const sesnoByBran: Record<string, number | null> = {};
      const legacyOdBrans: string[] = [];
      const diagnostics: string[] = [];
      /** 按直段量的 BRAN 上这次重量的整条直段的全部段：之前锚在这些段上的结果（整段量的或别的直段选择）由这次替换。 */
      const remeasuredAnchors = new Set<string>();
      for (const refno of branRefnos) {
        const line = lines.get(refno);
        sesnoByBran[refno] = line?.source_version?.sesno ?? null;
        if (!line) continue;
        for (const text of line.warnings ?? []) diagnostics.push(`${refno}：${text}`);
        // 缺口不许跨接（§5.6）：中心线断档两侧的段哪怕共线也分成两条直段，缺口如实上报。
        // 旧服务端不给逐段外径来源：按服务端同一规则取成员外径、记估算档（推导间隔带 ≈，管底归排待确认）。
        const fullRuns = buildStraightRuns(line, {
          maxJointGapMm: 1,
          inferLegacyMemberOd: true,
          onDiagnostic: (diagnostic) => {
            if (diagnostic.kind === 'chain-break' && diagnostic.reason === 'joint-gap') {
              warnings.push(`${refno}：${diagnostic.refno} 前有约 ${Math.round(diagnostic.gapMm ?? 0)}mm 中心线缺口，缺口两侧分开成排`);
            }
          },
        });
        const keep = tubeSegments.get(refno);
        const runs = keep ? fullRuns.flatMap(run => splitRunBySegments(run, segment => keep.has(segment.refno))) : fullRuns;
        if (keep) {
          for (const run of fullRuns) {
            if (!run.segments.some(segment => keep.has(segment.refno))) continue;
            for (const segment of run.segments) remeasuredAnchors.add(segment.refno);
          }
          const placed = new Set(runs.flatMap(run => run.segments.map(segment => segment.refno)));
          const missing = [...keep].filter(segmentRefno => !placed.has(segmentRefno)).length;
          if (missing > 0) warnings.push(`${refno}：${missing} 段所选直段不在可归排的直段上（中心线里没有这一段，或它太短），不参与`);
        }
        for (const run of runs) {
          inputs.push({ branRefno: refno, run });
        }
        if (runs.some(run => run.odEvidence === 'legacy-member')) legacyOdBrans.push(refno);
      }
      for (const [refno, message] of failed) warnings.push(`${refno}：中心线获取失败：${message}`);

      const operandBrans = (record: ClearanceRecord) =>
        [record.provenance.source.refno, record.provenance.target.refno]
          .filter((refno): refno is string => typeof refno === 'string' && refno.length > 0);
      if (failed.size > 0) {
        for (const record of pipeResults.value) {
          if (!isPipeRowRecord(record) || record.pipeRow?.alignMode !== alignMode || record.status === 'failed') continue;
          if (operandBrans(record).some(bran => failed.has(bran))) {
            clearanceStore.upsertRecord(withClearanceStatus(record, 'failed'));
          }
        }
        lastRowDetection.value = null;
        lastRunSettledCount.value = 0;
        warnings.push(`${failed.size} 根管道中心线获取失败，本次不生成连排结果（缺了它们，隔着它们的两根管会被误当成相邻）；可稍后重试，或确认不需要它们后从选择中移除再检测`);
        detectError.value = warnings.join('；');
        return false;
      }

      const fetched = new Set(lines.keys());
      // 摘除范围：本次 BRAN 的新直段锚点 ∪ 旧记录两侧都属本次 BRAN 的锚点——
      // 重算后锚点 refno 漂移（管身段重排）的旧记录也进范围，不会留下孤儿。
      // 按直段量的 BRAN 只换这次重量的那几条直段：它别的直段这次没量，旧结果不动。
      const anchorScope = new Set<string>([...inputs.map(input => runAnchorRefno(input.run)), ...remeasuredAnchors]);
      for (const record of pipeResults.value) {
        if (!isPipeRowRecord(record) || record.pipeRow?.alignMode !== alignMode) continue;
        const brans = operandBrans(record);
        if (brans.length === 2 && brans.every(bran => fetched.has(bran) && !tubeSegments.has(bran))) {
          anchorScope.add(record.inputs.sourceRefno);
          anchorScope.add(record.inputs.targetRefno);
        }
      }

      const fallbackNormal = pipeRowFallbackNormal.value;
      const detection = detectPipeRows(inputs, {
        alignMode,
        supportNormal: options.supportNormal,
        fallbackSupportNormal: fallbackNormal === 'none' ? undefined : PIPE_ROW_FALLBACK_NORMALS[fallbackNormal],
        maxAdjacentCenterDistanceMm: pipeRowMaxAdjacentMm.value,
        // 选了直段就不限最短共同区段：用户亲手选的直段哪怕只并排一小截也要量
        minCommonLengthMm: tubeSegments.size > 0 ? undefined : pipeRowMinCommonMm.value,
      });
      lastRowDetection.value = detection;
      if (legacyOdBrans.length > 0) {
        warnings.push(`中心线接口未提供逐段外径来源（旧服务端），${legacyOdBrans.length} 根管道按成员外径估算：推导间隔带 ≈，管底对齐的排需确认后生成`);
      }
      if (detection.supportNormalDegenerate) warnings.push('有主管向近铅直的管组没法按世界向上找管底，请指定竖管支承法向后重新检测');
      diagnostics.push(...detection.diagnostics);

      const created = commitPipeRowDetection({
        groups: detection.groups,
        anchorScope: [...anchorScope],
        alignMode,
        records: clearanceStore.records.value,
        upsertRecord: clearanceStore.upsertRecord,
        removeRecord: clearanceStore.removeRecord,
        options: { sesnoByBran, sourceAnnotation: options.sourceAnnotation ?? null, computedAt: new Date() },
      });
      lastRunSettledCount.value = created.length;
      lastRowContext = { sequence, sesnoByBran, sourceAnnotation: options.sourceAnnotation ?? null };
      clearanceStore.setActive((created.find(isMetricShown) ?? created[0])?.id ?? null);
      if (detection.groups.length === 0) warnings.push('没有检测到成排的相邻管道');
      detectReport.value = { notice: warnings.length > 0 ? warnings.join('；') : null, diagnostics };
      return true;
    } catch (e) {
      if (sequence !== detectionSequence) return false;
      detectError.value = `连排检测失败: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[PipeDistance] runPipeRowDetection failed:', e);
      return false;
    } finally {
      if (sequence === detectionSequence) isDetecting.value = false;
    }
  }

  /**
   * 预览里人工确认待定的排（§8 第 4 点）：只认最近一次连排检测，且之后没有新检测 / 清空 / 换上下文；
   * 记录按检测时的同一构造与版本证据生成，保留识别时的判定警告。返回新生成的记录数。
   */
  function confirmPipeRowGroups(rowKeys: readonly string[]): number {
    if (!calculationsAllowed) {
      detectError.value = '历史版本对比中不能使用当前模型生成连排结果，请退出对比后重算。';
      return 0;
    }
    const detection = lastRowDetection.value;
    const context = lastRowContext;
    if (!detection || !context || context.sequence !== detectionSequence) {
      detectError.value = '识别预览已过期（之后有新的检测、清空或上下文切换），请重新检测后再确认';
      return 0;
    }
    const confirmed = new Set(confirmedRowKeys.value);
    let created = 0;
    for (const key of rowKeys) {
      const group = detection.groups.find(candidate => candidate.key === key);
      if (!group || isFormalPipeRowGroup(group) || confirmed.has(key)) continue;
      created += confirmPipeRowGroup({
        group,
        records: clearanceStore.records.value,
        upsertRecord: clearanceStore.upsertRecord,
        removeRecord: clearanceStore.removeRecord,
        options: { sesnoByBran: context.sesnoByBran, sourceAnnotation: context.sourceAnnotation, computedAt: new Date() },
      }).length;
      confirmed.add(key);
    }
    confirmedRowKeys.value = confirmed;
    return created;
  }

  async function autoDetectBrans(refnos: string[], options: Omit<PipeDistanceDetectionOptions, 'refnos'> = {}) {
    return runDetection({
      ...options,
      refnos,
    });
  }

  async function detectNearbyBrans(sourceRefno: string) {
    const sequence = ++detectionSequence;
    const source = normalizeBranRefno(sourceRefno);
    const originalSelection = selectedBranRefnos.value.join('|');
    if (!calculationsAllowed) { detectError.value = '历史版本对比中不能使用当前模型检测管间净距，请退出对比后重算。'; return false; }
    if (!source) { detectError.value = '请先选择一根 BRAN 管道'; return false; }
    isDetecting.value = true;
    detectError.value = null;
    detectNotice.value = null;
    const radius = Number.isFinite(maxDistance.value) && maxDistance.value > 0 ? maxDistance.value : 500;
    const originalLimit = maxDistance.value;
    try {
      // Aggregate model bounds cover the full finite branch, including its outer surface.
      // A center-point sphere would miss neighbours near the ends of a long branch.
      const targetSet = new Set<string>();
      const warnings = new Set<string>();
      let total: number | null = null;
      let truncated = false;
      for (let page = 1; ; page += 1) {
        const response = await genModelV1SpatialNearbyBranches({ refno: source, radius, page, perPage: 1000 });
        if (sequence !== detectionSequence || selectedBranRefnos.value.join('|') !== originalSelection) return false;
        if (maxDistance.value !== originalLimit) throw new Error('检测范围已变化，请重新检测');
        if (!Array.isArray(response.results) || !Number.isSafeInteger(response.total_count) || response.total_count < 0
          || typeof response.truncated_candidates !== 'boolean' || typeof response.has_more !== 'boolean'
          || response.radius !== radius || response.center?.source !== 'refno_aabb_center'
          || response.results.some(item => item.noun !== 'BRAN' || !normalizeBranRefno(item.refno) || !Number.isFinite(item.distance) || item.distance < 0))
          throw new Error('周边查询响应无效，请更新服务后重试');
        if (total !== null && total !== response.total_count) throw new Error('周边集合在分页期间发生变化，请重新检测');
        total = response.total_count;
        let added = 0;
        for (const item of response.results) {
          const refno = normalizeBranRefno(item.refno);
          if (refno !== source && !targetSet.has(refno)) { targetSet.add(refno); added += 1; }
        }
        for (const warning of response.warnings ?? []) warnings.add(warning);
        truncated ||= response.truncated_candidates;
        if (!response.has_more) break;
        if (!added || targetSet.size >= total) throw new Error('周边分页没有进展，请重新检测');
      }
      const targets = [...targetSet];
      const incomplete = truncated || total !== targets.length;
      const coverage = incomplete ? '周边候选未全部计算（空间索引候选被截断或集合不完整），请缩小最大距离后重算。' : '';
      if (!targets.length) {
        detectError.value = [coverage, '已加载模型范围内没有找到周边 BRAN 管道；原有结果已保留。'].filter(Boolean).join('；');
        return true;
      }
      const applied = await runDetection({ refnos: [source, ...targets], pairMode: 'source-to-targets', withinMaxDistance: true });
      if (applied && sequence + 1 === detectionSequence) {
        detectError.value = [coverage, ...warnings, detectError.value].filter(Boolean).join('；') || null;
      }
      return applied;
    } catch (error) {
      if (sequence !== detectionSequence) return false;
      // 路由不存在的 404 没有错误信封（消息就是「HTTP 404 …」）；查无此管的 404 带信封消息，照常报错
      if (isGenModelV1ApiError(error) && error.status === 404 && error.message.startsWith('HTTP 404')) {
        nearbySupported.value = false;
        detectError.value = '当前服务端版本不支持周边检测（需要更新 gen-model 后端），原有结果已保留';
        return false;
      }
      detectError.value = `周边检测失败，原有结果已保留：${error instanceof Error ? error.message : String(error)}`;
      return false;
    } finally {
      if (sequence === detectionSequence) isDetecting.value = false;
    }
  }

  /** 清空本域的全部净距记录（显式用户动作；记录平时跨抽屉开合保留在 ClearanceStore）。 */
  function clearResults() {
    detectionSequence += 1;
    isDetecting.value = false;
    detectProgress.value = null;
    activeRun = null;
    for (const record of pipeResults.value) {
      clearanceStore.removeRecord(record.id);
    }
    detectError.value = null;
    detectNotice.value = null;
    lastRowDetection.value = null;
    resetResultFilters();
  }

  /** 列表上的「清空」：只清当前模式的记录——其他模式的结果不在这个列表里，不该被看不见的按钮清掉。 */
  function clearModeResults() {
    detectionSequence += 1;
    isDetecting.value = false;
    detectProgress.value = null;
    activeRun = null;
    for (const record of modeResults.value) {
      clearanceStore.removeRecord(record.id);
    }
    detectError.value = null;
    detectNotice.value = null;
    lastRowDetection.value = null;
    resultMinDistance.value = null;
  }

  return {
    ...persistence,
    // ClearanceStore 先绑好、记录已载入（ViewerPanel 先绑它再绑本 store），再收拾旧版反序重选留下的双向重复记录
    bindPersistence: (...args: Parameters<typeof persistence.bindPersistence>) => {
      persistence.bindPersistence(...args);
      dedupeReversePipeRecords();
    },
    captureSnapshot: capturePipeSnapshot,
    prepareSnapshotRestore: (value: unknown) => {
      const apply = preparePipeSnapshot(value);
      return () => {
        persistence.applyPreparedRestore(apply);
        dedupeReversePipeRecords();
      };
    },
    showAnnotations,
    maxDistance,
    maxAngle,
    selectedBranRefnos,
    /** 本域净距记录（ClearanceRecord，BRAN↔BRAN）；旧 `results` 不再持有自己的结果数组。 */
    pipeResults,
    results: pipeResults,
    activeResultId: clearanceStore.activeId,
    isDetecting,
    lastRunSettledCount,
    lastRunOutcome,
    nearbySupported,
    detectProgress,
    detectError,
    hiddenResultIds,
    resultMinDistance,
    visibleResults,
    listedResults,
    detectNotice,
    detectDiagnostics,
    modeResults,
    otherModeVisibleCount,
    detectionMode,
    pipeRowAlignMode,
    pipeRowFallbackNormal,
    pipeRowMaxAdjacentMm,
    pipeRowMinCommonMm,
    pipeRowBothMetrics,
    pipeRowKeyPoints,
    lastRowDetection,
    confirmedRowKeys,
    selectedTubeKeys,
    addBranRefno,
    setBranRefnos,
    removeBranRefno,
    clearBranRefnos,
    addTubeKey,
    removeTubeKey,
    setTubeKeys,
    clearTubeKeys,
    setActiveResult,
    runDetection,
    cancelDetection,
    runPipeRowDetection,
    autoDetectBrans,
    detectNearbyBrans,
    commitPipeDistanceResults,
    confirmPipeRowGroups,
    clearResults,
    clearModeResults,
    toggleResultHidden,
    setResultMinDistance,
    resetResultFilters,
    hideOtherModeResults,
    pipeRowGroupRecords,
    setPipeRowGroupHidden,
  };
}
