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

import { genModelV1SpatialNearbyBranches, genModelV1SurfaceClearance, isGenModelV1ApiError } from '@/api/genModelV1Api';
import {
  isPipeClearanceRecord,
  pipeDistanceInputs,
  pipeDistanceResultToClearanceRecord,
} from '@/clearance/adapters/pipeDistanceRecords';
import { clearanceRecordId, withClearanceStatus, type ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import { cloneResultSnapshot } from '@/clearance/services/resultSnapshot';
import { createScopedResultPersistence } from '@/clearance/services/scopedResultPersistence';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';

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
const isDetecting = ref(false);
const detectError = ref<string | null>(null);

const resultMinDistance = ref<number | null>(null);
/** 最近一次 `runDetection` 实际落库的记录数（0 = 本轮一条没算出来，兜底层据此决定要不要补估算）。 */
const lastRunSettledCount = ref(0);
let detectionSequence = 0;
let calculationsAllowed = true;

/** 本抽屉的结果域：ClearanceStore 里 BRAN↔BRAN 的 component-to-component 记录。 */
const pipeResults = computed(() => clearanceStore.records.value.filter(isPipeClearanceRecord));

const showAnnotations = clearanceStore.showAnnotations;
const hiddenResultIds = clearanceStore.hiddenIds;

function recordDistanceMm(record: ClearanceRecord): number | null {
  const distanceM = record.snapshot?.distanceM;
  return Number.isFinite(distanceM) ? distanceM! * 1000 : null;
}

/** 列表可见集：没隐藏 + 过距离阈值（无快照的记录没有距离可比，阈值不滤它，行显示「—」）。 */
const visibleResults = computed(() => pipeResults.value.filter(record => {
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
  resultMinDistance.value = null;
  showAnnotations.value = true;
  maxDistance.value = 500;
  maxAngle.value = 5;
  detectError.value = null;
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
    selectedBranRefnos.value = data.selectedBranRefnos as string[];
    resultMinDistance.value = minDistance;
    showAnnotations.value = annotations;
    maxDistance.value = distanceLimit;
    maxAngle.value = angleLimit;
  };
}

function restorePipeSnapshot(value: unknown) { preparePipeSnapshot(value)(); }

function capturePipeSnapshot() {
  return cloneResultSnapshot({ coordinateSpace: 'e3d-world-mm',
    // 结果真相在 component 段；保留字段形状让旧校验 / `hasReviewClearanceResults` 不破。
    results: [],
    selectedBranRefnos: selectedBranRefnos.value, hiddenIds: [],
    activeIndex: null, minDistance: resultMinDistance.value, showAnnotations: showAnnotations.value,
    maxDistance: maxDistance.value, maxAngle: maxAngle.value });
}

const persistence = createScopedResultPersistence({
  prefix: 'plant3d-pipe-distance-v1',
  sources: [selectedBranRefnos, resultMinDistance, showAnnotations, maxDistance, maxAngle],
  capture: capturePipeSnapshot,
  restore: restorePipeSnapshot,
  invalidate: allowed => { calculationsAllowed = allowed; detectionSequence += 1; isDetecting.value = false; },
});

function normalizeBranRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

/** 无序管对键：同一对 BRAN 不管谁先点都算同一对（与记录 id 的 inputs 语义一致）。 */
function pipePairKey(a: string, b: string): string {
  return [normalizeBranRefno(a), normalizeBranRefno(b)].sort().join('|');
}

function optionalVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  return value.every(item => typeof item === 'number' && Number.isFinite(item)) ? [...value] as Vec3 : undefined;
}

export function usePipeDistanceStore() {
  function addBranRefno(refno: string) {
    const normalized = normalizeBranRefno(refno);
    if (normalized && !selectedBranRefnos.value.includes(normalized)) {
      selectedBranRefnos.value.push(normalized);
    }
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
  }

  function removeBranRefno(refno: string) {
    const idx = selectedBranRefnos.value.indexOf(normalizeBranRefno(refno));
    if (idx >= 0) selectedBranRefnos.value.splice(idx, 1);
  }

  function clearBranRefnos() {
    selectedBranRefnos.value = [];
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

  function resetResultFilters() {
    for (const record of pipeResults.value) {
      if (hiddenResultIds.value.has(record.id)) clearanceStore.setHidden(record.id, false);
    }
    resultMinDistance.value = null;
  }

  /** 某一对 BRAN 现存的记录（重算覆盖 / 失败标 stale 都先查它）。 */
  function existingRecord(sourceRefno: string, targetRefno: string): ClearanceRecord | null {
    return clearanceStore.findRecord(clearanceRecordId(pipeDistanceInputs(sourceRefno, targetRefno)));
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
    if (!calculationsAllowed) { detectError.value = '历史版本对比中不能使用当前模型检测管间净距，请退出对比后重算。'; return false; }
    if (options.refnos) {
      setBranRefnos(options.refnos);
    }

    const branRefnos = [...selectedBranRefnos.value];
    if (branRefnos.length < 2) {
      isDetecting.value = false;
      lastRunSettledCount.value = 0;
      detectError.value = '请至少选择 2 个构件';
      return false;
    }

    isDetecting.value = true;
    detectError.value = null;

    // 工作台批量检测所有唯一管对；保留源→目标模式供既有调用使用。
    const pairs: [string, string][] = [];
    for (let i = 0; i < branRefnos.length - 1; i += 1) {
      if (i > 0 && options.pairMode !== 'all-pairs') break;
      for (let j = i + 1; j < branRefnos.length; j += 1) pairs.push([branRefnos[i]!, branRefnos[j]!]);
    }
    const distanceLimit = Number.isFinite(maxDistance.value) && maxDistance.value > 0 ? maxDistance.value : 500;

    try {
      const warnings: string[] = [];
      const settled: (ClearanceRecord | null)[] = Array(pairs.length).fill(null);
      let cursor = 0;
      // ponytail: O(n²) pairs; at most four mesh queries in flight, spatial candidate filtering can reduce large selections later.
      const worker = async () => {
        while (cursor < pairs.length && sequence === detectionSequence) {
          const index = cursor++;
          const [sourceRefno, targetRefno] = pairs[index]!;
          const inputs = { ...pipeDistanceInputs(sourceRefno, targetRefno), maxDistanceMm: distanceLimit };
          const previous = existingRecord(sourceRefno, targetRefno);
          try {
            const resp = await genModelV1SurfaceClearance({
              sourceRefno,
              targetRefno,
              targetKind: 'any',
              perpendicular: false,
              ...((options.pairMode === 'all-pairs' || options.withinMaxDistance) ? { maxDistanceMm: distanceLimit } : {}),
            });
            if (!resp.success || resp.unit !== 'mm' || resp.method !== 'surface_to_surface' || resp.accuracy_class !== 'exact-surface'
              || !Number.isFinite(resp.error_bound_mm) || resp.error_bound_mm < 0 || resp.error_bound_mm > 10) {
              warnings.push(`${sourceRefno} ↔ ${targetRefno}：净距口径或误差界无效`);
              continue;
            }
            if (!resp.result) {
              warnings.push(`${targetRefno}：${resp.warnings.join('；') || '两侧网格在最大距离内没有靠近'}`);
              // 重算说「没有靠近」：现存记录口径已不成立，标 stale 而不是装没看见。
              if (previous && previous.status === 'current') {
                clearanceStore.upsertRecord(withClearanceStatus(previous, 'stale'));
              }
              continue;
            }
            if ((options.pairMode === 'all-pairs' || options.withinMaxDistance) && resp.result.distance_mm > distanceLimit) continue;
            if (!Number.isFinite(resp.result.distance_mm) || resp.result.distance_mm < 0
            || ![resp.result.source_point, resp.result.target_point].every(point =>
              [point.x, point.y, point.z].every(Number.isFinite))) {
              warnings.push(`${sourceRefno} ↔ ${targetRefno}：距离或最近点无效`);
              continue;
            }
            // 先收进按管对序的 settled，worker 全部结束后统一 upsert——记录顺序不随请求完成先后漂。
            settled[index] = surfaceClearanceToRecord(resp, inputs, new Date(), previous);
          } catch (error) {
            const message = isGenModelV1ApiError(error) ? error.message : error instanceof Error ? error.message : String(error);
            warnings.push(`${targetRefno}：${message}`);
            // 计算出错：已有记录标 failed 留住旧快照（与 store.compute 的语义一致）。
            if (previous && previous.status !== 'failed') {
              clearanceStore.upsertRecord(withClearanceStatus(previous, 'failed'));
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, pairs.length) }, worker));
      if (sequence !== detectionSequence) return false;

      lastRunSettledCount.value = 0;
      let first: ClearanceRecord | null = null;
      for (const record of settled) {
        if (!record) continue;
        clearanceStore.upsertRecord(record);
        lastRunSettledCount.value += 1;
        first ??= clearanceStore.findRecord(record.id) ?? record;
      }
      clearanceStore.setActive(first?.id ?? null);

      if (settled.every(record => record === null)) {
        detectError.value = warnings.length > 0 ? warnings.join('；') : '未找到可标注的净距结果';
      } else if (warnings.length > 0) {
        // 有几对没算出来就如实列出，别让「N 条结果」盖住缺的那几对
        detectError.value = warnings.join('；');
      }
    } catch (e) {
      if (sequence !== detectionSequence) return false;
      const msg = e instanceof Error ? e.message : String(e);
      detectError.value = `检测失败: ${msg}`;
      console.error('[PipeDistance] runDetection failed:', e);
    } finally {
      if (sequence === detectionSequence) isDetecting.value = false;
    }
    return true;
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
    for (const record of pipeResults.value) {
      clearanceStore.removeRecord(record.id);
    }
    detectError.value = null;
    resetResultFilters();
  }

  return {
    ...persistence,
    captureSnapshot: capturePipeSnapshot,
    prepareSnapshotRestore: (value: unknown) => {
      const apply = preparePipeSnapshot(value);
      return () => persistence.applyPreparedRestore(apply);
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
    detectError,
    hiddenResultIds,
    resultMinDistance,
    visibleResults,
    addBranRefno,
    setBranRefnos,
    removeBranRefno,
    clearBranRefnos,
    setActiveResult,
    runDetection,
    autoDetectBrans,
    detectNearbyBrans,
    commitPipeDistanceResults,
    clearResults,
    toggleResultHidden,
    setResultMinDistance,
    resetResultFilters,
  };
}
