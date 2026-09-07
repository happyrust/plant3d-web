/**
 * 模型数据源开关与入口（plan P1-3）。
 *
 * `resolveModelSourceKind()`（见 `./kind.ts`）：`?model_source=` → `VITE_MODEL_SOURCE` → 默认 `legacy`。
 * `getModelSource()`：按当前开关给一份 `ModelSource`（进程内每种一份，惰性建）。
 *
 * `gen-model-v1` 接了树（P2）、几何记录（P3）、网格 URL（P0-1）与 `typeInfo`；`uiAttr` 仍委托 legacy（P4-1），见 `genModelV1/index.ts`。
 * 只想判「现在是哪个源」的模块请引 `./kind`，别把整套适配器（含 DuckDB）拖进来。
 */
import { createGenModelV1ModelSource, type GenModelV1EnsureProgress, type GenModelV1ModelSource } from './genModelV1';
import { getModelSourceKind } from './kind';
import { createLegacyModelSource } from './legacy';

import type { ModelSource, ModelSourceKind } from './ports';

export * from './ports';
export * from './kind';
export type { GenModelV1EnsureProgress, GenModelV1ModelSource } from './genModelV1';
export type { CollectDbnumProgress, CollectDbnumResult } from './genModelV1';

const instances = new Map<ModelSourceKind, ModelSource>();

function createModelSource(kind: ModelSourceKind): ModelSource {
  if (kind === 'gen-model-v1') return createGenModelV1ModelSource();
  return createLegacyModelSource();
}

/** 按当前开关取数据源；同一种类进程内只建一份。 */
export function getModelSource(kind: ModelSourceKind = getModelSourceKind()): ModelSource {
  let source = instances.get(kind);
  if (!source) {
    source = createModelSource(kind);
    instances.set(kind, source);
  }
  return source;
}

function noopUnsubscribe(): void {
  // legacy 源没有进度可听
}

/** 当前开关是 gen-model-v1 时给带扩展能力的那份源（进度 / 整库收集，P3-c）；legacy 下为 null。 */
export function getGenModelV1ModelSource(): GenModelV1ModelSource | null {
  const source = getModelSource();
  return source.kind === 'gen-model-v1' ? (source as GenModelV1ModelSource) : null;
}

/**
 * 订阅 gen-model-v1 的逐根 ensure → records 进度（显示流程里 `visibleInsts` 内部那次 ensure 只能从这里听）。
 * legacy 下不订阅、回一个空的退订函数。
 */
export function subscribeModelSourceProgress(listener: (progress: GenModelV1EnsureProgress) => void): () => void {
  const source = getGenModelV1ModelSource();
  if (!source) return noopUnsubscribe;
  return source.records.subscribeProgress(listener);
}

/** 测试用：清掉已建实例。 */
export function __resetModelSourceForTests(): void {
  instances.clear();
}
