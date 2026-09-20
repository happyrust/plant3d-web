/**
 * 数据源种类（不带任何适配器依赖，谁都能引）。
 *
 * 2026-09-20 legacy 退役后只剩 `gen-model-v1`：`?model_source=` 与 `VITE_MODEL_SOURCE` 两个开关一并删除，
 * 这里不再解析 URL / 环境变量，只把唯一的种类给出来——留着这个模块是让「只想判现在是哪个源」的调用方
 * 不必把整套适配器拖进来（与退役前同一条理由）。
 */
import { DEFAULT_MODEL_SOURCE_KIND, type ModelSourceKind } from './ports';

/** 当前页面生效的数据源种类：恒为 `gen-model-v1`。 */
export function getModelSourceKind(): ModelSourceKind {
  return DEFAULT_MODEL_SOURCE_KIND;
}
