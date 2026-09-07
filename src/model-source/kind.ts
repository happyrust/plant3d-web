/**
 * 数据源种类的解析（不带任何适配器依赖，谁都能引）。
 *
 * `?model_source=` → `VITE_MODEL_SOURCE` → 默认 `legacy`。适配器本体在 `./index.ts`，它把这里的函数再导出一遍。
 */
import { DEFAULT_MODEL_SOURCE_KIND, MODEL_SOURCE_KINDS, type ModelSourceKind } from './ports';

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
