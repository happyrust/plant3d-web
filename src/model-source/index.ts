/**
 * 模型数据源开关与入口（plan P1-3）。
 *
 * `resolveModelSourceKind()`：`?model_source=` → `VITE_MODEL_SOURCE` → 默认 `legacy`。
 * `getModelSource()`：按当前开关给一份 `ModelSource`（进程内每种一份，惰性建）。
 *
 * `gen-model-v1` 目前接了树（P2）与网格 URL（P0-1）；几何记录（P3）与属性（P4）仍委托 legacy，见 `genModelV1/index.ts`。
 */
import { createGenModelV1ModelSource } from './genModelV1';
import { createLegacyModelSource } from './legacy';
import { DEFAULT_MODEL_SOURCE_KIND, MODEL_SOURCE_KINDS, type ModelSource, type ModelSourceKind } from './ports';

export * from './ports';

export function parseModelSourceKind(raw: string | null | undefined): ModelSourceKind | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  // 允许几种顺手的写法，落库只有两个正式名字。
  if (value === 'gen-model-v1' || value === 'gen_model_v1' || value === 'genmodelv1' || value === 'v1') {
    return 'gen-model-v1';
  }
  if (value === 'legacy' || value === 'old' || value === 'parquet') return 'legacy';
  return (MODEL_SOURCE_KINDS as readonly string[]).includes(value) ? (value as ModelSourceKind) : null;
}

export type ResolveModelSourceKindOptions = {
  /** `window.location.search` */
  search?: string | null;
  /** `VITE_MODEL_SOURCE` */
  envValue?: string | null;
};

export function resolveModelSourceKind(options: ResolveModelSourceKindOptions): ModelSourceKind {
  if (options.search) {
    const fromQuery = parseModelSourceKind(new URLSearchParams(options.search).get('model_source'));
    if (fromQuery) return fromQuery;
  }
  const fromEnv = parseModelSourceKind(options.envValue);
  if (fromEnv) return fromEnv;
  return DEFAULT_MODEL_SOURCE_KIND;
}

/** 当前页面生效的数据源种类（每次读 URL，便于同一 tab 改参数刷新后立刻切换）。 */
export function getModelSourceKind(): ModelSourceKind {
  return resolveModelSourceKind({
    search: typeof window !== 'undefined' ? window.location?.search : null,
    envValue: (import.meta.env as unknown as { VITE_MODEL_SOURCE?: string }).VITE_MODEL_SOURCE,
  });
}

export function isGenModelV1Source(): boolean {
  return getModelSourceKind() === 'gen-model-v1';
}

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
