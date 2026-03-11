/**
 * 管道间距离标注 状态管理
 *
 * 管理检测参数、已选 BRAN 管道、检测结果及 UI 状态。
 */
import { ref } from 'vue';

import type { Vec3 } from '@/api/mbdPipeApi';
import { getMbdPipeAnnotations } from '@/api/mbdPipeApi';
import { detectPipeClearances } from '@/utils/three/geometry/clearance/detectPipeClearances';

export type PipeDistanceResult = {
  id: string;
  distance: number; // mm
  pipeA: string;
  pipeB: string;
  start: Vec3;
  end: Vec3;
};

const showAnnotations = ref(true);
const maxDistance = ref(500); // mm, range: 50-2000
const maxAngle = ref(5); // degree, range: 1-15
const selectedBranRefnos = ref<string[]>([]);
const results = ref<PipeDistanceResult[]>([]);
const activeResultIndex = ref<number | null>(null);
const isDetecting = ref(false);
const detectError = ref<string | null>(null);

export function usePipeDistanceStore() {
  function addBranRefno(refno: string) {
    if (!selectedBranRefnos.value.includes(refno)) {
      selectedBranRefnos.value.push(refno);
    }
  }

  function removeBranRefno(refno: string) {
    const idx = selectedBranRefnos.value.indexOf(refno);
    if (idx >= 0) selectedBranRefnos.value.splice(idx, 1);
  }

  function clearBranRefnos() {
    selectedBranRefnos.value = [];
  }

  function setActiveResult(index: number | null) {
    activeResultIndex.value = index;
  }

  async function runDetection() {
    const branRefnos = selectedBranRefnos.value;
    if (branRefnos.length < 2) {
      detectError.value = '请至少选择 2 根 BRAN 管道';
      return;
    }

    isDetecting.value = true;
    detectError.value = null;

    try {
      // 1. 并发获取每个 BRAN 的管段数据
      const responses = await Promise.all(
        branRefnos.map((refno) =>
          getMbdPipeAnnotations(refno, { source: 'db', include_dims: false, include_welds: false, include_slopes: false, include_bends: false })
        ),
      );

      // 2. 组织为 detectPipeClearances 所需的 Record<branRefno, segments[]> 格式
      const branches: Record<string, import('@/api/mbdPipeApi').MbdPipeSegmentDto[]> = {};
      for (let i = 0; i < branRefnos.length; i++) {
        const resp = responses[i];
        if (resp && resp.success && resp.data && resp.data.segments.length > 0) {
          branches[branRefnos[i]!] = resp.data.segments;
        }
      }

      const branchKeys = Object.keys(branches);
      if (branchKeys.length < 2) {
        detectError.value = `仅 ${branchKeys.length} 根 BRAN 有管段数据，至少需要 2 根`;
        results.value = [];
        activeResultIndex.value = null;
        return;
      }

      // 3. 调用净距检测算法
      const clearances = detectPipeClearances(branches, maxDistance.value, maxAngle.value);

      // 4. 转换为 PipeDistanceResult
      results.value = clearances.map((c) => ({
        id: c.id,
        distance: Math.round(c.distance),
        pipeA: c.pipe1_refno,
        pipeB: c.pipe2_refno,
        start: c.start,
        end: c.end,
      }));

      activeResultIndex.value = results.value.length > 0 ? 0 : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      detectError.value = `检测失败: ${msg}`;
      console.error('[PipeDistance] runDetection failed:', e);
    } finally {
      isDetecting.value = false;
    }
  }

  function clearResults() {
    results.value = [];
    activeResultIndex.value = null;
    detectError.value = null;
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
    addBranRefno,
    removeBranRefno,
    clearBranRefnos,
    setActiveResult,
    runDetection,
    clearResults,
  };
}
