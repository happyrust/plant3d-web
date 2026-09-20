/**
 * 模型数据源入口（plan P1-3）。
 *
 * 2026-09-20 起只有一种源：`gen-model-v1`（gen-model `/api/v1`）。legacy（旧后端 `:3100` + parquet / DuckDB-WASM）
 * 适配器与 `?model_source=` / `VITE_MODEL_SOURCE` 开关随生产切换一并退役（ADR 0054 追记）。
 * `getModelSource()` 给进程内唯一一份 `GenModelV1ModelSource`（惰性建、首次取用时 `activate()`）。
 * 只想判「现在是哪个源」的模块请引 `./kind`，别把整套适配器拖进来。
 */
import { createGenModelV1ModelSource, type GenModelV1EnsureProgress, type GenModelV1ModelSource } from './genModelV1';

export * from './ports';
export * from './kind';
export * from './modelVersionErrors';
export type { GenModelV1EnsureProgress, GenModelV1ModelSource } from './genModelV1';
export type { CollectDbnumProgress, CollectDbnumResult } from './genModelV1';

let instance: GenModelV1ModelSource | null = null;

/** 取数据源；进程内只建一份。 */
export function getModelSource(): GenModelV1ModelSource {
  if (!instance) {
    instance = createGenModelV1ModelSource();
    instance.activate();
  }
  return instance;
}

/** 带扩展能力的那份源（进度 / 整库收集，P3-c）。legacy 退役后与 `getModelSource()` 是同一份，保留名字给现有调用方。 */
export function getGenModelV1ModelSource(): GenModelV1ModelSource {
  return getModelSource();
}

/** 订阅 gen-model-v1 的逐根 ensure → records 进度（显示流程里 `visibleInsts` 内部那次 ensure 只能从这里听）。 */
export function subscribeModelSourceProgress(listener: (progress: GenModelV1EnsureProgress) => void): () => void {
  return getModelSource().records.subscribeProgress(listener);
}

/** 测试用：清掉已建实例。 */
export function __resetModelSourceForTests(): void {
  instance?.dispose();
  instance = null;
}
