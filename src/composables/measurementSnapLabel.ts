/**
 * 测量命令条 Snap 目标名（E3D `Snap :VALVE` 口径）。
 *
 * 数据优先级（r5 §3）：
 *   sourceInfo.label（P-Point #n / Item 原点 …）
 *   → 元素类型 noun（按 refno 查 model-tree，本模块带缓存）
 *   → formatPdmsRef(refno) 兜底（不再裸显 o:<refno>:<idx>）。
 */
import { ref } from 'vue';

import { formatPdmsRef } from '@/utils/pdmsRefno';

export type MeasurementSnapLabelInput = {
  label?: string | null;
  noun?: string | null;
  refno?: string | null;
};

/**
 * 组合 Snap 目标显示名：`VALVE 100-A` / `VALVE 24381/145018` / `P-Point #3`。
 * 全部缺失时返回空字符串，由调用方决定回落文案。
 */
export function formatMeasurementSnapLabel(input: MeasurementSnapLabelInput): string {
  const label = input.label?.trim() ?? '';
  const noun = input.noun?.trim() ?? '';
  const refnoText = formatPdmsRef(input.refno ?? null);
  if (noun && label) return `${noun} ${label}`;
  if (noun) return refnoText ? `${noun} ${refnoText}` : noun;
  if (label) return label;
  return refnoText;
}

const nounByRefno = new Map<string, string | null>();
const pendingNounRefnos = new Set<string>();
/** 缓存写入时自增，让 computed 在异步 noun 到达后重新求值。 */
const nounCacheRevision = ref(0);

/** 读取已缓存的元素类型；未缓存返回 null（同时触发响应式依赖）。 */
export function getCachedNounForRefno(refno: string | null | undefined): string | null {
  void nounCacheRevision.value;
  if (!refno) return null;
  return nounByRefno.get(refno) ?? null;
}

/**
 * 异步预取 refno 的元素类型（fire-and-forget，带去重）。
 * 查询失败缓存 null，避免对同一 refno 反复请求。
 * e3d API 走动态 import：避免测量链路静态背上 DuckDB-WASM 依赖。
 */
export function requestNounForRefno(refno: string | null | undefined): void {
  if (!refno || nounByRefno.has(refno) || pendingNounRefnos.has(refno)) return;
  pendingNounRefnos.add(refno);
  import('@/api/genModelE3dApi')
    .then(({ e3dGetNode }) => e3dGetNode(refno))
    .then((response) => {
      const noun = response?.node?.noun?.trim() || null;
      nounByRefno.set(refno, noun);
    })
    .catch(() => {
      nounByRefno.set(refno, null);
    })
    .finally(() => {
      pendingNounRefnos.delete(refno);
      nounCacheRevision.value += 1;
    });
}

/** 测试专用：清空 noun 缓存。 */
export function __resetMeasurementSnapNounCacheForTest(): void {
  nounByRefno.clear();
  pendingNounRefnos.clear();
  nounCacheRevision.value += 1;
}
