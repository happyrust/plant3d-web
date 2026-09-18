/**
 * gen-model-v1 的 `SpatialSource`（plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md` §3.4 / P3）。
 *
 * 抽屉「范围 / 距离查询」改打 `GET /api/v1/spatial/{nearby, nearby/refnos, negative-nouns}`（spec §4.13），候选来自
 * 服务进程内的 `GLOBAL_AABB_TREE`；这里把 legacy 形状的入参 / 出参与 v1 契约互译，`useSpatialQuery` 一行不改：
 * - 入参：`x,y,z` → `position`；`nouns` 逗号串 → 数组；`sort=spec_distance` → `distance`（v1 无专业）；`spec_values` 丢弃；
 *   `per_page` 缺省时沿用旧参数 `max_results`；refno 的 `a_b` → `a/b` 由 API 基座做；
 *   `source_mode=bran_centerline` 原样转成 v1 的 `source_mode`（legacy 那边要改打 `/query`，v1 是同一条 `/nearby`）。
 * - 出参：refno 归一 `a_b`；`spec_value` 一律 0、`filter_options.spec_values = []`、不给专业 `groups`
 *   （§5-1 按 (a)：v1 源下抽屉隐藏专业维度，改按库分组——服务端的 dbnum 分组放进 `dbnum_groups`）；
 *   盒从 `[x,y,z]` 三元组转成 `{x,y,z}`；`dbnum` / `coverage` / `spatial_state` 原样带出给 P4 用。
 * - 错误：`not_found`（refno 模式在投影与树里都没有盒 —— 构件还没生成模型）折成 `success:false` + 一句能看懂的提示
 *   （§5-3 按 (a)：让人先显示该构件，接口不隐式 ensure）；其余 `GenModelV1ApiError` 原样抛出——
 *   `spatial_not_ready`（503）的 `isRetryable` 为真，调用方据此提示「稍后重试」。
 */
import type { SpatialSource, SpatialSourceCapabilities } from '../ports';
import type {
  NegativeNounsResult,
  SpatialNearbyParams,
  SpatialNearbyRefnosResult,
  SpatialNearbyResult,
  SpatialQueryResultItem,
} from '@/api/genModelSpatialApi';

import {
  fromV1Refno,
  genModelV1SpatialNearby,
  genModelV1SpatialNearbyRefnos,
  genModelV1SpatialNegativeNouns,
  isGenModelV1ApiError,
  type GenModelV1SpatialNearbyRequest,
  type SpatialNearbyItem,
  type SpatialNearbyRefnosResponse,
  type SpatialNearbyResponse,
} from '@/api/genModelV1Api';

export type SpatialApi = {
  nearby: typeof genModelV1SpatialNearby;
  nearbyRefnos: typeof genModelV1SpatialNearbyRefnos;
  negativeNouns: typeof genModelV1SpatialNegativeNouns;
};

export const defaultSpatialApi: SpatialApi = {
  nearby: genModelV1SpatialNearby,
  nearbyRefnos: genModelV1SpatialNearbyRefnos,
  negativeNouns: genModelV1SpatialNegativeNouns,
};

/**
 * v1 的几何投影里没有 `spec_value` 这一列（§5-1）。
 *
 * BRAN 中心线支持：`/api/v1/spatial/nearby?source_mode=bran_centerline` 的走廊不来自 `GLOBAL_AABB_TREE`
 * （那里只有包围盒），而是服务端从 E3D 库现取的成员序 + 隐式管身（`mbd::branch_query`，与 `/api/mbd/v2/pipe`
 * 同一份数据）。
 *
 * 关键字只匹配 refno / noun，不匹配名称（spec §4.13；名称只对本页补）。
 * 同一个原因，`sort=name` 不按名称排全集：服务端按 noun / refno 作近似序、只为本页补名字（`sort_hits`），抽屉在「按名称」下提示。
 */
export const GEN_MODEL_V1_SPATIAL_CAPABILITIES: SpatialSourceCapabilities = {
  specValues: false,
  branCenterline: true,
  keywordMatchesName: false,
  nameSortExact: false,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

/** legacy `SpatialNearbyParams` → v1 请求。`refno` 与 `x,y,z` 谁在就用谁，都缺 / 三个坐标不全交给服务端 400。 */
export function toV1SpatialNearbyRequest(params: SpatialNearbyParams): GenModelV1SpatialNearbyRequest {
  const refno = params.refno?.trim();
  const hasPosition = isFiniteNumber(params.x) && isFiniteNumber(params.y) && isFiniteNumber(params.z);
  return {
    refno: refno ? refno : undefined,
    // 中心线只对 refno 有效；没给 refno 就不发这一格，免得服务端为一条注定 400 的请求去读库。
    sourceMode: refno && params.source_mode === 'bran_centerline' ? 'bran_centerline' : undefined,
    position: !refno && hasPosition ? { x: params.x!, y: params.y!, z: params.z! } : undefined,
    radius: params.radius,
    shape: params.shape,
    nouns: splitCsv(params.nouns),
    keyword: params.keyword?.trim() || undefined,
    sort: params.sort === 'name' ? 'name' : params.sort ? 'distance' : undefined,
    includeSelf: params.include_self,
    includeNegative: params.include_negative,
    page: params.page,
    perPage: params.per_page ?? params.max_results,
  };
}

function toLegacyItem(item: SpatialNearbyItem): SpatialQueryResultItem {
  const [minX, minY, minZ] = item.aabb.min;
  const [maxX, maxY, maxZ] = item.aabb.max;
  return {
    refno: fromV1Refno(item.refno),
    dbnum: item.dbnum,
    noun: item.noun,
    spec_value: 0,
    name: item.name ?? undefined,
    aabb: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    distance: item.distance,
  };
}

/** v1 `spatial/nearby` 响应 → legacy `SpatialNearbyResult`。 */
export function spatialNearbyToLegacyResult(params: SpatialNearbyParams, resp: SpatialNearbyResponse): SpatialNearbyResult {
  const refno = params.refno?.trim();
  return {
    success: true,
    results: (resp.results ?? []).map(toLegacyItem),
    center: {
      x: resp.center.x,
      y: resp.center.y,
      z: resp.center.z,
      source: resp.center.source,
      ...(refno ? { refno: fromV1Refno(refno) } : {}),
    },
    radius: resp.radius,
    shape: resp.shape,
    total_count: resp.total_count,
    returned_count: resp.returned_count,
    page: resp.page,
    per_page: resp.per_page,
    has_more: resp.has_more,
    candidate_count: resp.candidate_count,
    candidate_cap: resp.candidate_cap,
    truncated_candidates: resp.truncated_candidates,
    filter_options: {
      nouns: (resp.filter_options?.nouns ?? []).map((noun) => ({
        value: noun.value,
        count: noun.count,
        is_negative: noun.is_negative,
      })),
      spec_values: [],
      include_negative: params.include_negative ?? false,
    },
    dbnum_groups: (resp.groups ?? []).map((group) => ({ dbnum: group.dbnum, count: group.count })),
    coverage: resp.coverage,
    spatial_state: resp.spatial_state,
    // 中心线预取的非致命问题（有成员没成段之类）；抽屉现有警告条直接展示。
    ...(resp.warnings && resp.warnings.length > 0 ? { warnings: resp.warnings } : {}),
  };
}

/** v1 `spatial/nearby/refnos` 响应 → legacy `SpatialNearbyRefnosResult`。 */
export function spatialNearbyRefnosToLegacyResult(resp: SpatialNearbyRefnosResponse): SpatialNearbyRefnosResult {
  const byDbnum: Record<string, string[]> = {};
  for (const [dbnum, refnos] of Object.entries(resp.by_dbnum ?? {})) {
    byDbnum[dbnum] = refnos.map(fromV1Refno);
  }
  return {
    success: true,
    refnos: (resp.refnos ?? []).map(fromV1Refno),
    by_dbnum: byDbnum,
    by_spec_value: {},
    total_count: resp.total_count,
    truncated: Boolean(resp.truncated_results),
    cap: resp.result_cap,
  };
}

/** refno 模式的中心构件在投影与空间树里都没有盒：还没生成过模型，先显示它（§5-3 按 (a)）。 */
export function spatialCenterNotFoundMessage(refno: string): string {
  return `构件 ${fromV1Refno(refno)} 还没有生成过模型，空间索引里没有它的包围盒；请先显示该构件，再按距离查询`;
}

export type GenModelV1SpatialSourceOptions = {
  api?: SpatialApi;
};

export function createGenModelV1SpatialSource(options: GenModelV1SpatialSourceOptions = {}): SpatialSource {
  const api = options.api ?? defaultSpatialApi;
  return {
    async nearby(params): Promise<SpatialNearbyResult> {
      const request = toV1SpatialNearbyRequest(params);
      try {
        const resp = await api.nearby(request);
        return spatialNearbyToLegacyResult(params, resp);
      } catch (error) {
        if (request.refno && isGenModelV1ApiError(error) && error.isNotFound) {
          return { success: false, results: [], error: spatialCenterNotFoundMessage(request.refno) };
        }
        throw error;
      }
    },
    async nearbyRefnos(params): Promise<SpatialNearbyRefnosResult> {
      const resp = await api.nearbyRefnos(toV1SpatialNearbyRequest(params));
      return spatialNearbyRefnosToLegacyResult(resp);
    },
    async negativeNouns(): Promise<NegativeNounsResult> {
      const resp = await api.negativeNouns();
      return { success: true, nouns: resp.nouns ?? [] };
    },
    capabilities: GEN_MODEL_V1_SPATIAL_CAPABILITIES,
  };
}
