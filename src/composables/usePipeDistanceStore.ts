/**
 * 管道间距离标注 状态管理
 *
 * 管理检测参数、已选 BRAN 管道、检测结果及 UI 状态。
 */
import { computed, ref } from 'vue';

import type { Vec3 } from '@/types/vec3';

import { genModelV1SurfaceClearance, isGenModelV1ApiError } from '@/api/genModelV1Api';
import { cloneResultSnapshot } from '@/clearance/services/resultSnapshot';
import { createScopedResultPersistence } from '@/clearance/services/scopedResultPersistence';

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
  transformPoint?: (point: Vec3) => Vec3 | null | undefined;
  pairMode?: 'source-to-targets' | 'all-pairs';
};

const showAnnotations = ref(true);
const maxDistance = ref(500); // mm, range: 50-2000
const maxAngle = ref(5); // degree, range: 1-15
const selectedBranRefnos = ref<string[]>([]);
const results = ref<PipeDistanceResult[]>([]);
const activeResultIndex = ref<number | null>(null);
const isDetecting = ref(false);
const detectError = ref<string | null>(null);

const hiddenResultIds = ref<Set<string>>(new Set());
const resultMinDistance = ref<number | null>(null);
let detectionSequence = 0;
let calculationsAllowed = true;

function preparePipeSnapshot(value: unknown): () => void {
  if (value === null) return () => resetPipeSnapshot();
  // 脱离响应及实时 store，校验期间不改变任何显示或本机草稿。
  value = cloneResultSnapshot(value);
  const data = value as Record<string, unknown>;
  const apply = validatePipeSnapshot(data);
  return () => { resetPipeSnapshot(); apply(); };
}

function resetPipeSnapshot() {
  results.value = [];
  selectedBranRefnos.value = [];
  activeResultIndex.value = null;
  hiddenResultIds.value = new Set();
  resultMinDistance.value = null;
  showAnnotations.value = true;
  maxDistance.value = 500;
  maxAngle.value = 5;
  detectError.value = null;
}

function validatePipeSnapshot(data: Record<string, unknown>): () => void {
  if (!data || data.coordinateSpace !== 'e3d-world-mm' || !Array.isArray(data.results) || !Array.isArray(data.selectedBranRefnos)
    || !data.selectedBranRefnos.every(item => typeof item === 'string') || !Array.isArray(data.hiddenIds)
    || !data.hiddenIds.every(item => typeof item === 'string') || typeof data.showAnnotations !== 'boolean'
    || typeof data.maxDistance !== 'number' || !Number.isFinite(data.maxDistance) || data.maxDistance <= 0
    || typeof data.maxAngle !== 'number' || !Number.isFinite(data.maxAngle) || data.maxAngle < 0 || data.maxAngle > 90
    || (data.minDistance !== null && (typeof data.minDistance !== 'number' || !Number.isFinite(data.minDistance) || data.minDistance < 0))) throw new Error('管间结果格式无效');
  const loaded = data.results.map(raw => {
    const result = raw as PipeDistanceResult;
    if (!result || typeof result.id !== 'string' || typeof result.pipeA !== 'string' || typeof result.pipeB !== 'string'
      || !result.pipeA || !result.pipeB || result.pipeA === result.pipeB || !Number.isFinite(result.distance) || result.distance < 0
      || !['surface', 'axis-estimate'].includes(result.measurementKind ?? '') || !result.designPoints
      || !optionalVec3(result.designPoints.start) || !optionalVec3(result.designPoints.end)
      || ['pipeAStart', 'pipeAEnd', 'pipeBStart', 'pipeBEnd'].some(key => {
        const point = result.designPoints?.[key as keyof NonNullable<PipeDistanceResult['designPoints']>];
        return point !== undefined && !optionalVec3(point);
      })) throw new Error('管间结果缺少可靠的世界毫米坐标');
    if (result.modelVersion && [result.modelVersion.sourceSesno, result.modelVersion.targetSesno].some(sesno => sesno !== null && (!Number.isInteger(sesno) || sesno < 0))) throw new Error('管间模型版本无效');
    return { ...result, start: [...result.designPoints.start] as Vec3, end: [...result.designPoints.end] as Vec3, status: 'stale' as const };
  });
  if (new Set(loaded.map(result => result.id)).size !== loaded.length) throw new Error('管间结果标识重复');
  const minDistance = data.minDistance as number | null;
  const annotations = data.showAnnotations;
  const distanceLimit = data.maxDistance;
  const angleLimit = data.maxAngle;
  return () => {
    results.value = loaded;
    selectedBranRefnos.value = data.selectedBranRefnos as string[];
    hiddenResultIds.value = new Set((data.hiddenIds as string[]).filter(id => loaded.some(result => result.id === id)));
    activeResultIndex.value = typeof data.activeIndex === 'number' && Number.isInteger(data.activeIndex) && data.activeIndex >= 0 && data.activeIndex < loaded.length ? data.activeIndex : null;
    resultMinDistance.value = minDistance;
    showAnnotations.value = annotations;
    maxDistance.value = distanceLimit;
    maxAngle.value = angleLimit;
  };
}

function restorePipeSnapshot(value: unknown) { preparePipeSnapshot(value)(); }

function capturePipeSnapshot() {
  if (results.value.some(result => !result.designPoints)) throw new Error('结果未取得世界毫米坐标，不能保存场景坐标；请重新检测。');
  return cloneResultSnapshot({ coordinateSpace: 'e3d-world-mm',
    results: results.value.map(result => ({ ...result,
      start: result.designPoints!.start, end: result.designPoints!.end,
      pipeAStart: result.designPoints!.pipeAStart, pipeAEnd: result.designPoints!.pipeAEnd,
      pipeBStart: result.designPoints!.pipeBStart, pipeBEnd: result.designPoints!.pipeBEnd })),
    selectedBranRefnos: selectedBranRefnos.value, hiddenIds: [...hiddenResultIds.value],
    activeIndex: activeResultIndex.value, minDistance: resultMinDistance.value, showAnnotations: showAnnotations.value,
    maxDistance: maxDistance.value, maxAngle: maxAngle.value });
}

const persistence = createScopedResultPersistence({
  prefix: 'plant3d-pipe-distance-v1',
  sources: [results, selectedBranRefnos, hiddenResultIds, activeResultIndex, resultMinDistance, showAnnotations, maxDistance, maxAngle],
  capture: capturePipeSnapshot,
  restore: restorePipeSnapshot,
  invalidate: allowed => { calculationsAllowed = allowed; detectionSequence += 1; isDetecting.value = false; },
});

function normalizeBranRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

function toBackendRefno(refno: string): string {
  const normalized = normalizeBranRefno(refno);
  const matched = normalized.match(/^(\d+)_(\d+)$/);
  if (!matched) return normalized;
  return `${matched[1]}/${matched[2]}`;
}

function transformResultPoint(point: Vec3, transformPoint?: PipeDistanceDetectionOptions['transformPoint']): Vec3 {
  if (!transformPoint) return point;
  const transformed = transformPoint(point);
  if (!transformed) return point;
  return transformed;
}

function optionalVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  return value.every(item => typeof item === 'number' && Number.isFinite(item)) ? [...value] as Vec3 : undefined;
}

function transformOptionalPoint(
  point: unknown,
  transformPoint?: PipeDistanceDetectionOptions['transformPoint'],
): Vec3 | undefined {
  const value = optionalVec3(point);
  return value ? transformResultPoint(value, transformPoint) : undefined;
}

function isResultVisible(r: PipeDistanceResult): boolean {
  if (hiddenResultIds.value.has(r.id)) return false;
  if (resultMinDistance.value !== null && r.distance < resultMinDistance.value) return false;
  return true;
}

const visibleResults = computed(() => results.value.filter(isResultVisible));

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

  function setActiveResult(index: number | null) {
    activeResultIndex.value = index;
  }

  function toggleResultHidden(id: string) {
    const next = new Set(hiddenResultIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    hiddenResultIds.value = next;
  }

  function setResultMinDistance(min: number | null) {
    if (min === null || !Number.isFinite(min) || min <= 0) {
      resultMinDistance.value = null;
      return;
    }
    resultMinDistance.value = min;
  }

  function resetResultFilters() {
    hiddenResultIds.value = new Set();
    resultMinDistance.value = null;
  }

  async function runDetection(options: PipeDistanceDetectionOptions = {}) {
    const sequence = ++detectionSequence;
    if (!calculationsAllowed) { detectError.value = '历史版本对比中不能使用当前模型检测管间净距，请退出对比后重算。'; return false; }
    if (options.refnos) {
      setBranRefnos(options.refnos);
    }

    const branRefnos = [...selectedBranRefnos.value];
    if (branRefnos.length < 2) {
      results.value = [];
      activeResultIndex.value = null;
      isDetecting.value = false;
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
      const transform = options.transformPoint;
      const toVec3 = (point: { x: number; y: number; z: number }): Vec3 => {
        const raw: Vec3 = [point.x, point.y, point.z];
        return transform?.(raw) ?? raw;
      };

      const warnings: string[] = [];
      const settled: (PipeDistanceResult | null)[] = Array(pairs.length).fill(null);
      let cursor = 0;
      // ponytail: O(n²) pairs; at most four mesh queries in flight, spatial candidate filtering can reduce large selections later.
      const worker = async () => {
        while (cursor < pairs.length && sequence === detectionSequence) {
          const index = cursor++;
          const [sourceRefno, targetRefno] = pairs[index]!;
          try {
            const resp = await genModelV1SurfaceClearance({
              sourceRefno,
              targetRefno,
              targetKind: 'any',
              perpendicular: false,
              ...(options.pairMode === 'all-pairs' ? { maxDistanceMm: distanceLimit } : {}),
            });
            if (!resp.success || resp.unit !== 'mm' || resp.method !== 'surface_to_surface' || resp.accuracy_class !== 'exact-surface'
              || !Number.isFinite(resp.error_bound_mm) || resp.error_bound_mm < 0 || resp.error_bound_mm > 10) {
              warnings.push(`${sourceRefno} ↔ ${targetRefno}：净距口径或误差界无效`);
              continue;
            }
            if (!resp.result) {
              warnings.push(`${targetRefno}：${resp.warnings.join('；') || '两侧网格在最大距离内没有靠近'}`);
              continue;
            }
            if (options.pairMode === 'all-pairs' && resp.result.distance_mm > distanceLimit) continue;
            if (!Number.isFinite(resp.result.distance_mm) || resp.result.distance_mm < 0
            || ![resp.result.source_point, resp.result.target_point].every(point =>
              [point.x, point.y, point.z].every(Number.isFinite))) {
              warnings.push(`${sourceRefno} ↔ ${targetRefno}：距离或最近点无效`);
              continue;
            }
            settled[index] = {
              designPoints: { start: [resp.result.source_point.x, resp.result.source_point.y, resp.result.source_point.z], end: [resp.result.target_point.x, resp.result.target_point.y, resp.result.target_point.z] },
              status: 'current',
              modelVersion: { sourceSesno: resp.model?.source_sesno ?? null, targetSesno: resp.model?.target_sesno ?? null },
              id: [sourceRefno, targetRefno].sort().join('__'),
              distance: resp.result.distance_mm,
              measurementKind: 'surface',
              pipeA: sourceRefno,
              pipeB: targetRefno,
              start: toVec3(resp.result.source_point),
              end: toVec3(resp.result.target_point),
            };
          } catch (error) {
            const message = isGenModelV1ApiError(error) ? error.message : error instanceof Error ? error.message : String(error);
            warnings.push(`${targetRefno}：${message}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, pairs.length) }, worker));
      if (sequence !== detectionSequence) return false;

      results.value = settled.filter((item): item is PipeDistanceResult => item !== null);
      activeResultIndex.value = results.value.length > 0 ? 0 : null;

      if (results.value.length === 0) {
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

  function clearResults() {
    detectionSequence += 1;
    isDetecting.value = false;
    results.value = [];
    activeResultIndex.value = null;
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
    results,
    activeResultIndex,
    isDetecting,
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
    clearResults,
    toggleResultHidden,
    setResultMinDistance,
    resetResultFilters,
  };
}
