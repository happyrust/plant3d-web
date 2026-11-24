import { computed, ref } from 'vue';

/**
 * 模型树数据源（仅控制模型树与名称搜索接口的后台取数通道）：
 * - `direct`（默认）：经 gen-model 使用 `e3d-io` 直接读取 E3D 项目文件（`SYS` / `DESI` / `ISOD`）
 * - `db`：经 gen-model 直接查询 SurrealDB 中的 `MDB` / `pe` / `pe_owner` 表
 */
export type ModelTreeDataSource = 'direct' | 'db';

export const MODEL_TREE_SOURCE_STORAGE_KEY = 'plant3d_model_tree_source_v1';
export const DEFAULT_MODEL_TREE_DATA_SOURCE: ModelTreeDataSource = 'direct';

export type ModelTreeDataSourcePreset = {
  source: ModelTreeDataSource;
  label: string;
  shortLabel: string;
  fullLabel: string;
  description: string;
};

export const MODEL_TREE_SOURCE_PRESETS: readonly ModelTreeDataSourcePreset[] = [
  {
    source: 'direct',
    label: 'E3D 直读',
    shortLabel: 'E3D',
    fullLabel: 'E3D 项目数据（直读）',
    description: '经 gen-model 使用 e3d-io 直接读取 E3D 项目文件，支持分组解析（GPWL/GPSET/SCOSEL）与最新文件会话',
  },
  {
    source: 'db',
    label: '数据库查询',
    shortLabel: 'DB',
    fullLabel: '数据库查询接口（SurrealDB）',
    description: '经 gen-model 直接查询 SurrealDB pe / pe_owner 表，适用于已入库落盘的 rocksdb 部署与对拍',
  },
];

export function normalizeModelTreeDataSource(raw: unknown): ModelTreeDataSource | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'direct' || value === 'e3d') return 'direct';
  if (value === 'db' || value === 'database' || value === 'surreal') return 'db';
  return null;
}

function readUrlOverride(): ModelTreeDataSource | null {
  if (typeof window === 'undefined' || !window.location?.search) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeModelTreeDataSource(params.get('tree_source'));
  } catch {
    return null;
  }
}

function readPersistedSource(): ModelTreeDataSource | null {
  if (
    typeof window === 'undefined'
    || !window.localStorage
    || typeof window.localStorage.getItem !== 'function'
  ) {
    return null;
  }
  try {
    return normalizeModelTreeDataSource(window.localStorage.getItem(MODEL_TREE_SOURCE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function loadInitialSource(): ModelTreeDataSource {
  return readUrlOverride() ?? readPersistedSource() ?? DEFAULT_MODEL_TREE_DATA_SOURCE;
}

const activeSource = ref<ModelTreeDataSource>(loadInitialSource());
const listeners = new Set<(source: ModelTreeDataSource) => void>();

export function getActiveModelTreeDataSource(): ModelTreeDataSource {
  return activeSource.value;
}

export function subscribeModelTreeDataSourceChange(
  listener: (source: ModelTreeDataSource) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persistSource(source: ModelTreeDataSource): void {
  if (
    typeof window === 'undefined'
    || !window.localStorage
    || typeof window.localStorage.setItem !== 'function'
  ) {
    return;
  }
  try {
    window.localStorage.setItem(MODEL_TREE_SOURCE_STORAGE_KEY, source);
  } catch {
    /* ignore storage failures */
  }
}

function notifySourceChange(source: ModelTreeDataSource): void {
  for (const listener of [...listeners]) {
    try {
      listener(source);
    } catch {
      /* keep other listeners isolated */
    }
  }
}

export function useModelTreeSourceStore() {
  const isDirect = computed(() => activeSource.value === 'direct');
  const isDb = computed(() => activeSource.value === 'db');
  const currentPreset = computed(
    () => MODEL_TREE_SOURCE_PRESETS.find((preset) => preset.source === activeSource.value)
      ?? MODEL_TREE_SOURCE_PRESETS[0],
  );

  function setSource(next: ModelTreeDataSource): boolean {
    if (activeSource.value === next) {
      persistSource(next);
      return false;
    }
    activeSource.value = next;
    persistSource(next);
    notifySourceChange(next);
    return true;
  }

  function toggleSource(): ModelTreeDataSource {
    const next: ModelTreeDataSource = activeSource.value === 'direct' ? 'db' : 'direct';
    setSource(next);
    return next;
  }

  return {
    source: activeSource,
    currentPreset,
    isDirect,
    isDb,
    setSource,
    toggleSource,
  };
}

export function __resetModelTreeSourceStoreForTests(): void {
  activeSource.value = loadInitialSource();
  listeners.clear();
}
