/**
 * `legacy` 的 `SpatialSource`：原样委托 `genModelSpatialApi.ts`，零逻辑
 * （plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md` P2）。
 *
 * 与 `useSpatialQuery` 改成经端口取数之前**逐字节相同**：每个方法就是一次转发，不加缓存、不改参数、不吞错误；
 * `queryNearbyRefnos` 里剔除 `page / per_page / max_results` 的逻辑留在 API 函数内，这里不重复。
 * 旧后端 `/api/sqlite-spatial/*` 的结果带专业维度，`capabilities.specValues = true`。
 */
import type { SpatialSource } from '../ports';

import { fetchNegativeNouns, queryNearbyRefnos, queryNearbySpatial } from '@/api/genModelSpatialApi';

export const legacySpatialSource: SpatialSource = {
  nearby: (params) => queryNearbySpatial(params),
  nearbyRefnos: (params) => queryNearbyRefnos(params),
  negativeNouns: () => fetchNegativeNouns(),
  capabilities: { specValues: true, branCenterline: true, keywordMatchesName: true, nameSortExact: true },
};
