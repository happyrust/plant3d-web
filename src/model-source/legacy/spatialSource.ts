/**
 * `legacy` 的 `SpatialSource`：原样委托 `genModelSpatialApi.ts`，零逻辑
 * （plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md` P2）。
 *
 * 与 `useSpatialQuery` 改成经端口取数之前**逐字节相同**：每个方法就是一次转发，不加缓存、不改参数、不吞错误；
 * `queryNearbyRefnos` 里剔除 `page / per_page / max_results` 的逻辑留在 API 函数内，这里不重复。
 * 旧后端 `/api/sqlite-spatial/*` 的结果带专业维度，`capabilities.specValues = true`。
 *
 * 房间（ADR 0067）：旧后端没有 `rooms=` 过滤与房间清单，`capabilities.rooms = false`、`rooms()` 回 `unsupported`，不打后端；
 * `roomsOf` 仍答得出——走它自己的 `room-tree/ancestors`（房间 = `room-group:` 之前那一级），给「房间列表」用。
 * 房间层级树（ADR 0068）同样没有：`capabilities.tree = false`、`tree()` 回 `success:false`，不打后端。
 */
import type { SpatialSource } from '../ports';

import { roomRefnoFromRoomTreeAncestors, roomTreeGetAncestors } from '@/api/genModelRoomTreeApi';
import { fetchNegativeNouns, queryNearbyRefnos, queryNearbySpatial } from '@/api/genModelSpatialApi';

export const LEGACY_SPATIAL_ROOMS_UNSUPPORTED_REASON = 'legacy 数据源（旧后端 :3100）没有房间过滤；切到 gen-model-v1 数据源';
export const LEGACY_SPATIAL_TREE_UNSUPPORTED_REASON = 'legacy 数据源（旧后端 :3100）没有房间层级树；切到 gen-model-v1 数据源';

export const legacySpatialSource: SpatialSource = {
  nearby: (params) => queryNearbySpatial(params),
  nearbyRefnos: (params) => queryNearbyRefnos(params),
  negativeNouns: () => fetchNegativeNouns(),
  rooms: async () => ({
    success: true,
    status: 'unsupported',
    reason: LEGACY_SPATIAL_ROOMS_UNSUPPORTED_REASON,
    definition_version: null,
    rooms: [],
  }),
  roomsOf: async (refno) => {
    const resp = await roomTreeGetAncestors(refno);
    if (!resp.success) {
      throw new Error(resp.error_message || `未找到 ${refno} 的房间归属`);
    }
    const room = roomRefnoFromRoomTreeAncestors(resp.ids);
    return room ? [room] : [];
  },
  tree: async () => ({
    success: false,
    unsupported: true,
    error: LEGACY_SPATIAL_TREE_UNSUPPORTED_REASON,
    total_count: 0,
    candidate_count: 0,
    truncated_candidates: false,
    candidate_cap: 0,
    leaves_inline: true,
    leaf_cap: 0,
    leaf_count: 0,
    delivery_unit_types: [],
    rooms: [],
  }),
  capabilities: { specValues: true, branCenterline: true, keywordMatchesName: true, nameSortExact: true, rooms: false, tree: false },
};
