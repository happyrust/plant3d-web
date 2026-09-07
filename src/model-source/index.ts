/**
 * 模型数据源开关与入口（plan P1-3）。
 *
 * `resolveModelSourceKind()`（见 `./kind.ts`）：`?model_source=` → `VITE_MODEL_SOURCE` → 默认 `legacy`。
 * `getModelSource()`：按当前开关给一份 `ModelSource`（进程内每种一份，惰性建）。
 *
 * `gen-model-v1` 接了树（P2）、几何记录（P3）、网格 URL（P0-1）与 `typeInfo`；`uiAttr` 仍委托 legacy（P4-1），见 `genModelV1/index.ts`。
 * 只想判「现在是哪个源」的模块请引 `./kind`，别把整套适配器（含 DuckDB）拖进来。
 */
import { createGenModelV1ModelSource } from './genModelV1';
import { getModelSourceKind } from './kind';
import { createLegacyModelSource } from './legacy';

import type { ModelSource, ModelSourceKind } from './ports';

export * from './ports';
export * from './kind';

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

/** 测试用：清掉已建实例。 */
export function __resetModelSourceForTests(): void {
  instances.clear();
}
