/**
 * gen-model-v1 的 `KeypointSource`（2026-09-12）：测量捕捉的 P-Point 改走 API 请求。
 *
 * - `ptset(refno)` → `POST /api/v1/element/ptset` → 旧后端 `PtsetResponse` 形状：点在构件局部系（mm）、
 *   `world_transform` 列主序 16 元素（与 `ptsetTransform.applyPtsetTransformToPoint` 的 16 元素分支同布局）、
 *   `unit_info` mm→mm 因子 1——`usePtsetSnap` / `usePtsetVisualizationThree` 一行不改。
 *   `bore` 进 `pbore`（吸附优先级 / 显示要它）；`dir_flag` / `ref_dir` / `pwidth` / `pheight` / `pconnect`
 *   是旧 SurrealDB 契约里的格，前端没有任何一处读它们，这里填缺省。
 * - `memberPtsets(owner)` → 同一端点 `include_members=true`，`members[]` 摊成 `PtsetChildrenResponse.results`；
 *   两条都把构件 `noun` 透传进响应（`PtsetResponse.noun` / `results[].noun`）——ATTA 没有几何、不在 DTX 登记里，
 *   测量拾取层只能从这里知道某个 P-Point 属于 ATTA（E3D `EDGTUBING.line` 跳过的穿过点）。
 * - `primitiveKeypoints`：gen-model-v1 的读透形态只存烘好的网格，没有基本体分解，服务端也没有这条接口；
 *   回空并把原因放进 `errors`，测量工具据此提示（不是静默无候选）。
 *
 * 一切 `GenModelV1ApiError` 折成 `success:false + error_message`（与属性源同一做法）；`not_found` 也是
 * 一种「没有」——refno 不在所钉会话里，测量工具把它当无 P-Point 处理即可，不抛。
 */
import type { KeypointQueryOptions, KeypointSource, PrimitiveKeypointsResult } from '../ports';
import type { PtsetChildrenResponse, PtsetPoint, PtsetResponse } from '@/api/genModelPdmsAttrApi';

import {
  fromV1Refno,
  genModelV1ElementPtset,
  isGenModelV1ApiError,
  type ElementPtsetItem,
  type ElementPtsetResponse,
} from '@/api/genModelV1Api';

export type KeypointApi = {
  elementPtset: typeof genModelV1ElementPtset;
};

export const defaultKeypointApi: KeypointApi = {
  elementPtset: genModelV1ElementPtset,
};

export const GEN_MODEL_V1_PRIMITIVE_KEYPOINTS_UNSUPPORTED =
  'gen-model-v1 数据源尚未提供基本体 / PLINE 关键点接口（读透形态只存烘好的网格）；P-Point 捕捉不受影响';

const MM_UNIT_INFO: NonNullable<PtsetResponse['unit_info']> = {
  source_unit: 'mm',
  target_unit: 'mm',
  conversion_factor: 1,
};

function errorMessage(error: unknown): string {
  if (isGenModelV1ApiError(error)) return `${error.code}${error.status ? ` (${error.status})` : ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function toPtsetPoint(point: ElementPtsetItem['points'][number]): PtsetPoint {
  return {
    number: point.number,
    pt: [point.pt[0], point.pt[1], point.pt[2]],
    dir: point.dir ? [point.dir[0], point.dir[1], point.dir[2]] : null,
    dir_flag: 0,
    ref_dir: null,
    pbore: typeof point.bore === 'number' && Number.isFinite(point.bore) ? point.bore : 0,
    pwidth: 0,
    pheight: 0,
    pconnect: '',
  };
}

function worldTransformOf(item: ElementPtsetItem): number[] | null {
  const m = item.world_transform;
  if (!Array.isArray(m) || m.length !== 16) return null;
  return m.every((value) => typeof value === 'number' && Number.isFinite(value)) ? m : null;
}

/** 没有点时给测量工具一句能看懂的原因（提示条直接显示它）。 */
export function emptyPtsetReason(item: ElementPtsetItem): string {
  const noun = item.noun ? `${item.noun} ` : '';
  if (!item.catalogue) return `构件 ${noun}${fromV1Refno(item.refno)} 没有目录 P 点（无 SPRE → SCOM → PTRE 链）`;
  if (!item.catalogue.point_set) return `构件 ${noun}${fromV1Refno(item.refno)} 的目录件没有 PTSE`;
  if (item.unresolved.length > 0) {
    const reasons = item.unresolved.map((entry) => `P${entry.number}：${entry.reason}`).join('；');
    return `构件 ${noun}${fromV1Refno(item.refno)} 的 P 点都解不出（${reasons}）`;
  }
  return `构件 ${noun}${fromV1Refno(item.refno)} 的 PTSE 是空的`;
}

/** `element/ptset` 的一个构件 → 旧后端 `PtsetResponse`。 */
export function elementPtsetToPtsetResponse(item: ElementPtsetItem): PtsetResponse {
  const refno = fromV1Refno(item.refno);
  const noun = typeof item.noun === 'string' && item.noun.trim() ? item.noun.trim() : null;
  const ptset = (item.points ?? []).map(toPtsetPoint);
  if (ptset.length === 0) {
    return {
      success: false,
      refno,
      noun,
      ptset: [],
      world_transform: worldTransformOf(item),
      unit_info: MM_UNIT_INFO,
      error_code: 'PTSET_POINTS_MISSING',
      error_message: emptyPtsetReason(item),
    };
  }
  return {
    success: true,
    refno,
    noun,
    ptset,
    world_transform: worldTransformOf(item),
    unit_info: MM_UNIT_INFO,
    error_code: null,
    error_message: null,
  };
}

/** `element/ptset?include_members` 的 `members[]` → 旧后端 `/api/pdms/ptset/children` 的形状。 */
export function elementPtsetToChildrenResponse(ownerRefno: string, resp: ElementPtsetResponse): PtsetChildrenResponse {
  const results = (resp.members ?? []).map((member) => {
    const mapped = elementPtsetToPtsetResponse(member);
    return {
      input_refno: mapped.refno,
      refno: mapped.refno,
      noun: mapped.noun ?? null,
      success: mapped.success,
      ptset: mapped.ptset,
      world_transform: mapped.world_transform,
      unit_info: mapped.unit_info ?? null,
      error_message: mapped.error_message ?? null,
    };
  });
  const successCount = results.filter((item) => item.success).length;
  return {
    success: successCount > 0,
    refno: ownerRefno,
    results,
    total_count: results.length,
    success_count: successCount,
    failed_count: results.length - successCount,
    error_message: successCount > 0 ? null : '未找到子元件 ptset 数据',
  };
}

function failedPtset(refno: string, message: string): PtsetResponse {
  return {
    success: false,
    refno,
    ptset: [],
    world_transform: null,
    unit_info: null,
    error_code: 'PTSET_QUERY_FAILED',
    error_message: message,
  };
}

export type GenModelV1KeypointSourceOptions = {
  api?: KeypointApi;
};

export function createGenModelV1KeypointSource(options: GenModelV1KeypointSourceOptions = {}): KeypointSource {
  const api = options.api ?? defaultKeypointApi;
  return {
    async ptset(_dbno, refno, _options?: KeypointQueryOptions): Promise<PtsetResponse> {
      const key = fromV1Refno(refno);
      try {
        const resp = await api.elementPtset({ refno });
        return elementPtsetToPtsetResponse(resp);
      } catch (error) {
        return failedPtset(key, errorMessage(error));
      }
    },
    async memberPtsets(_dbno, ownerRefno): Promise<PtsetChildrenResponse> {
      const key = fromV1Refno(ownerRefno);
      try {
        const resp = await api.elementPtset({ refno: ownerRefno, includeMembers: true });
        return elementPtsetToChildrenResponse(key, resp);
      } catch (error) {
        return {
          success: false,
          refno: key,
          results: [],
          total_count: 0,
          success_count: 0,
          failed_count: 0,
          error_message: errorMessage(error),
        };
      }
    },
    async primitiveKeypoints(): Promise<PrimitiveKeypointsResult> {
      return { items: [], errors: [GEN_MODEL_V1_PRIMITIVE_KEYPOINTS_UNSUPPORTED] };
    },
  };
}
