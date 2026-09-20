/**
 * gen-model-v1 的 `SpatialSource`（plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md` §3.4 / P3；
 * 房间 / 专业两个维度 2026-09-20 加入，ADR 0067 / plan `docs/plans/2026-09-20-spatial-query-room-and-discipline-filter-plan.md` §4.3）。
 *
 * 抽屉「范围 / 距离查询」改打 `GET /api/v1/spatial/{nearby, nearby/refnos, negative-nouns, rooms}`（spec §4.13），候选来自
 * 服务进程内的 `GLOBAL_AABB_TREE`；这里把 legacy 形状的入参 / 出参与 v1 契约互译，`useSpatialQuery` 一行不改：
 * - 入参：`x,y,z` → `position`；`nouns` / `spec_values` / `rooms` 逗号串 → 数组；`sort` 三档（`distance` / `name` /
 *   `spec_distance`）同名直通——`spec_distance` 服务端先按专业再按距离排**全集**，抽屉「按专业」因此跨页成立
 *   （2026-09-20 复审前折成 `distance`，只剩页内分组）；`per_page` 缺省时沿用旧参数 `max_results`；
 *   refno 的 `a_b` → `a/b` 由 API 基座做；`source_mode=bran_centerline` 原样转成 v1 的 `source_mode`。
 * - 出参：refno 归一 `a_b`；`spec_value` 直取服务端派生值（旧服务端没有这一格 → 0）；`filter_options.spec_values` /
 *   专业 `groups` / `by_spec_value` 都从服务端同名格映射；服务端的 dbnum 分组仍放进 `dbnum_groups`；
 *   盒从 `[x,y,z]` 三元组转成 `{x,y,z}`；`dbnum` / `coverage` / `spatial_state` / `room_status` / `warnings` 原样带出。
 * - 错误：`not_found`（refno 模式在投影与树里都没有盒 —— 构件还没生成模型）折成 `success:false` + 一句能看懂的提示
 *   （§5-3 按 (a)：让人先显示该构件，接口不隐式 ensure）；其余 `GenModelV1ApiError` 原样抛出——
 *   `spatial_not_ready`（503）的 `isRetryable` 为真，调用方据此提示「稍后重试」；`rooms=` 给了而房间体制不可用的
 *   422 `precondition`（`detail.reason = rooms_unavailable`）折成 `success:false` + `detail.status` 那一句。
 */
import type { SpatialSource, SpatialSourceCapabilities } from '../ports';
import type {
  NegativeNounsResult,
  SpatialNearbyParams,
  SpatialNearbyRefnosResult,
  SpatialNearbyResult,
  SpatialQueryResultItem,
  SpatialRoomsResult,
} from '@/api/genModelSpatialApi';

import {
  fromV1Refno,
  genModelV1SpatialNearby,
  genModelV1SpatialNearbyRefnos,
  genModelV1SpatialNegativeNouns,
  genModelV1SpatialRooms,
  isGenModelV1ApiError,
  type GenModelV1SpatialNearbyRequest,
  type SpatialNearbyItem,
  type SpatialNearbyRefnosResponse,
  type SpatialNearbyResponse,
  type SpatialRoomsResponse,
} from '@/api/genModelV1Api';
import { genModelV1RoomLookup, roomRefnosOf } from '@/api/genModelV1RoomApi';

export type SpatialApi = {
  nearby: typeof genModelV1SpatialNearby;
  nearbyRefnos: typeof genModelV1SpatialNearbyRefnos;
  negativeNouns: typeof genModelV1SpatialNegativeNouns;
  /** `GET /api/v1/spatial/rooms`；老测试桩没给它时 `rooms()` 回 `unsupported` */
  rooms?: typeof genModelV1SpatialRooms;
  /** `e3d.room.lookup`；老测试桩没给它时 `roomsOf()` 回空 */
  roomLookup?: typeof genModelV1RoomLookup;
};

export const defaultSpatialApi: SpatialApi = {
  nearby: genModelV1SpatialNearby,
  nearbyRefnos: genModelV1SpatialNearbyRefnos,
  negativeNouns: genModelV1SpatialNegativeNouns,
  rooms: genModelV1SpatialRooms,
  roomLookup: genModelV1RoomLookup,
};

/**
 * v1 的专业维度自 2026-09-20 起由服务端派生（ADR 0067：属主链上 SITE 名按 `spec_value_rules` 分类，与 legacy 同一规则），
 * 专业 chips / 「按专业」排序 / 专业分组因此在 v1 下原样点亮。
 *
 * BRAN 中心线支持：`/api/v1/spatial/nearby?source_mode=bran_centerline` 的走廊不来自 `GLOBAL_AABB_TREE`
 * （那里只有包围盒），而是服务端从 E3D 库现取的成员序 + 隐式管身（`mbd::branch_query`，与 `/api/mbd/v2/pipe`
 * 同一份数据）。
 *
 * 关键字只匹配 refno / noun，不匹配名称（spec §4.13；名称只对本页补）。
 * 同一个原因，`sort=name` 不按名称排全集：服务端按 noun / refno 作近似序、只为本页补名字（`sort_hits`），抽屉在「按名称」下提示。
 *
 * 房间：`rooms=` 过滤 + `GET /spatial/rooms` 清单（spec §4.13.4）。
 */
export const GEN_MODEL_V1_SPATIAL_CAPABILITIES: SpatialSourceCapabilities = {
  specValues: true,
  branCenterline: true,
  keywordMatchesName: false,
  nameSortExact: false,
  rooms: true,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function splitCsvNumbers(value: string | undefined): number[] | undefined {
  const items = splitCsv(value)
    ?.map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
  return items && items.length > 0 ? items : undefined;
}

/**
 * legacy 的排序参数 → v1 `sort`：三档同名直通（`spec_distance` 2026-09-20 起服务端也认——先按专业再按距离、跨页成立；
 * 此前折成 `distance`，「按专业」在 v1 下只剩页内分组）。没给就不发；别的值退到 `distance`。
 */
function toV1Sort(sort: SpatialNearbyParams['sort']): GenModelV1SpatialNearbyRequest['sort'] {
  switch (sort) {
    case undefined:
      return undefined;
    case 'name':
    case 'spec_distance':
    case 'distance':
      return sort;
    default:
      return 'distance';
  }
}

/** legacy `SpatialNearbyParams` → v1 请求。`refno` 与 `x,y,z` 谁在就用谁，都缺 / 三个坐标不全交给服务端 400。 */
export function toV1SpatialNearbyRequest(params: SpatialNearbyParams): GenModelV1SpatialNearbyRequest {
  const refno = params.refno?.trim();
  const hasPosition = isFiniteNumber(params.x) && isFiniteNumber(params.y) && isFiniteNumber(params.z);
  const rooms = splitCsv(params.rooms);
  const specValues = splitCsvNumbers(params.spec_values);
  return {
    refno: refno ? refno : undefined,
    // 中心线只对 refno 有效；没给 refno 就不发这一格，免得服务端为一条注定 400 的请求去读库。
    sourceMode: refno && params.source_mode === 'bran_centerline' ? 'bran_centerline' : undefined,
    position: !refno && hasPosition ? { x: params.x!, y: params.y!, z: params.z! } : undefined,
    radius: params.radius,
    shape: params.shape,
    nouns: splitCsv(params.nouns),
    keyword: params.keyword?.trim() || undefined,
    sort: toV1Sort(params.sort),
    includeSelf: params.include_self,
    includeNegative: params.include_negative,
    // 老用例对请求做 toEqual：没给就不带这两格，老断言原样成立。
    ...(rooms ? { rooms } : {}),
    ...(specValues ? { specValues } : {}),
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
    spec_value: isFiniteNumber(item.spec_value) ? item.spec_value : 0,
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
  const specGroups = resp.spec_groups;
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
      spec_values: (resp.filter_options?.spec_values ?? []).map((spec) => ({ value: spec.value, count: spec.count })),
      include_negative: params.include_negative ?? false,
    },
    // 专业分组（ADR 0067）：旧服务端没有这一格就不给，store 退回按页内条目数分组。
    ...(specGroups ? { groups: specGroups.map((group) => ({ spec_value: group.spec_value, count: group.count })) } : {}),
    dbnum_groups: (resp.groups ?? []).map((group) => ({ dbnum: group.dbnum, count: group.count })),
    coverage: resp.coverage,
    spatial_state: resp.spatial_state,
    ...(resp.room_status ? { room_status: resp.room_status } : {}),
    // 中心线预取 / 房间过滤的非致命问题；抽屉现有警告条直接展示。
    ...(resp.warnings && resp.warnings.length > 0 ? { warnings: resp.warnings } : {}),
  };
}

function normalizeBuckets(raw: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, refnos] of Object.entries(raw ?? {})) {
    out[key] = refnos.map(fromV1Refno);
  }
  return out;
}

/** v1 `spatial/nearby/refnos` 响应 → legacy `SpatialNearbyRefnosResult`。 */
export function spatialNearbyRefnosToLegacyResult(resp: SpatialNearbyRefnosResponse): SpatialNearbyRefnosResult {
  return {
    success: true,
    refnos: (resp.refnos ?? []).map(fromV1Refno),
    by_dbnum: normalizeBuckets(resp.by_dbnum),
    by_spec_value: normalizeBuckets(resp.by_spec_value),
    total_count: resp.total_count,
    truncated: Boolean(resp.truncated_results),
    cap: resp.result_cap,
    ...(resp.room_status ? { room_status: resp.room_status } : {}),
    ...(resp.warnings && resp.warnings.length > 0 ? { warnings: resp.warnings } : {}),
  };
}

/** v1 `spatial/rooms` 响应 → 端口形状。 */
export function spatialRoomsToLegacyResult(resp: SpatialRoomsResponse): SpatialRoomsResult {
  return {
    success: true,
    status: resp.status,
    reason: resp.reason ?? null,
    definition_version: resp.definition_version ?? null,
    rooms: (resp.rooms ?? []).map((room) => ({
      refno: fromV1Refno(room.refno),
      room_num: room.room_num,
      name: room.name ?? null,
      dbnum: typeof room.dbnum === 'number' ? room.dbnum : null,
      panel_count: room.panel_count,
    })),
  };
}

/** refno 模式的中心构件在投影与空间树里都没有盒：还没生成过模型，先显示它（§5-3 按 (a)）。 */
export function spatialCenterNotFoundMessage(refno: string): string {
  return `构件 ${fromV1Refno(refno)} 还没有生成过模型，空间索引里没有它的包围盒；请先显示该构件，再按距离查询`;
}

/** `rooms=` 给了而服务端房间体制此刻答不出来（422 `rooms_unavailable`）：一句能看懂的话，`status` 是 `/spatial/rooms` 那一套字面值。 */
export function spatialRoomsUnavailableMessage(status: string | undefined, reason: string | undefined): string {
  const head = `房间过滤此刻不可用${status ? `（${status}）` : ''}`;
  return reason ? `${head}：${reason}` : `${head}；先去掉房间条件再查`;
}

function roomsUnavailableDetail(error: unknown): { status?: string; reason?: string } | null {
  if (!isGenModelV1ApiError(error) || error.status !== 422) return null;
  const detail = error.detail;
  if (!detail || typeof detail !== 'object') return null;
  const record = detail as Record<string, unknown>;
  if (record.reason !== 'rooms_unavailable') return null;
  return {
    status: typeof record.status === 'string' ? record.status : undefined,
    reason: typeof record.message === 'string' ? record.message : undefined,
  };
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
        const unavailable = roomsUnavailableDetail(error);
        if (unavailable) {
          return { success: false, results: [], error: spatialRoomsUnavailableMessage(unavailable.status, unavailable.reason) };
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
    async rooms(): Promise<SpatialRoomsResult> {
      if (!api.rooms) {
        return { success: true, status: 'unsupported', reason: '当前服务端没有 /api/v1/spatial/rooms', definition_version: null, rooms: [] };
      }
      try {
        return spatialRoomsToLegacyResult(await api.rooms());
      } catch (error) {
        // 旧构建没有这条路由（404）：房间块收起、写一句话，不当查询失败
        if (isGenModelV1ApiError(error) && error.isNotFound) {
          return {
            success: true,
            status: 'unsupported',
            reason: '当前服务端构建没有 /api/v1/spatial/rooms（旧版），房间过滤不可用',
            definition_version: null,
            rooms: [],
          };
        }
        throw error;
      }
    },
    async roomsOf(refno): Promise<string[]> {
      if (!api.roomLookup) return [];
      return roomRefnosOf(await api.roomLookup(refno));
    },
    capabilities: GEN_MODEL_V1_SPATIAL_CAPABILITIES,
  };
}
