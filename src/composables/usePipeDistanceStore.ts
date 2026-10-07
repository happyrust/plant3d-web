/**
 * 管道间距离标注 状态管理
 *
 * 管理检测参数、已选 BRAN 管道、检测结果及 UI 状态。
 */
import { computed, ref } from 'vue';

import type { Vec3 } from '@/types/vec3';

import { genModelV1SurfaceClearance, isGenModelV1ApiError } from '@/api/genModelV1Api';

export type PipeDistanceResult = {
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
  const point = value.map(Number);
  return point.every(Number.isFinite) ? point as Vec3 : undefined;
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
