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
    if (options.refnos) {
      setBranRefnos(options.refnos);
    }

    const branRefnos = selectedBranRefnos.value;
    if (branRefnos.length < 2) {
      detectError.value = '请至少选择 2 个构件';
      return;
    }

    isDetecting.value = true;
    detectError.value = null;

    // 第一个作为源，其余为目标：逐对向 gen-model `/api/v1/spatial/surface-clearance`（`target_kind=any`）要外表面最近点。
    // 旧后端 `/api/space/nearest-points` 一发算全部目标的路 2026-09-20 随 legacy 退役；这里一对一发，结果形状不变（E3D 世界 mm）。
    const [sourceRefno, ...targetRefnos] = branRefnos;

    try {
      const transform = options.transformPoint;
      const toVec3 = (point: { x: number; y: number; z: number }): Vec3 => {
        const raw: Vec3 = [point.x, point.y, point.z];
        return transform?.(raw) ?? raw;
      };

      const warnings: string[] = [];
      const settled = await Promise.all(targetRefnos.map(async (targetRefno) => {
        try {
          const resp = await genModelV1SurfaceClearance({
            sourceRefno: sourceRefno!,
            targetRefno,
            targetKind: 'any',
            perpendicular: false,
          });
          if (!resp.result) {
            warnings.push(`${targetRefno}：${resp.warnings.join('；') || '两侧网格在最大距离内没有靠近'}`);
            return null;
          }
          return {
            id: `${sourceRefno}__${targetRefno}`,
            distance: resp.result.distance_mm,
            pipeA: sourceRefno!,
            pipeB: targetRefno,
            start: toVec3(resp.result.source_point),
            end: toVec3(resp.result.target_point),
          } satisfies PipeDistanceResult;
        } catch (error) {
          const message = isGenModelV1ApiError(error) ? error.message : error instanceof Error ? error.message : String(error);
          warnings.push(`${targetRefno}：${message}`);
          return null;
        }
      }));

      results.value = settled.filter((item): item is PipeDistanceResult => item !== null);
      activeResultIndex.value = results.value.length > 0 ? 0 : null;

      if (results.value.length === 0) {
        detectError.value = warnings.length > 0 ? warnings.join('；') : '未找到可标注的净距结果';
      } else if (warnings.length > 0) {
        // 有几对没算出来就如实列出，别让「N 条结果」盖住缺的那几对
        detectError.value = warnings.join('；');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      detectError.value = `检测失败: ${msg}`;
      console.error('[PipeDistance] runDetection failed:', e);
    } finally {
      isDetecting.value = false;
    }
  }

  async function autoDetectBrans(refnos: string[], options: Omit<PipeDistanceDetectionOptions, 'refnos'> = {}) {
    await runDetection({
      ...options,
      refnos,
    });
  }

  function clearResults() {
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
