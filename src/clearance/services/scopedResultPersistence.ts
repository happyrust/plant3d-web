import { ref, watch, type WatchSource } from 'vue';

export const SCOPED_PERSISTENCE_KEY_LIMIT = 20;

type ListableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function isListableStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): storage is ListableStorage {
  const candidate = storage as Partial<ListableStorage>;
  return typeof candidate.key === 'function'
    && typeof candidate.removeItem === 'function'
    && typeof candidate.length === 'number';
}

function readSavedAt(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown };
    if (typeof parsed.savedAt !== 'string') return 0;
    const time = Date.parse(parsed.savedAt);
    return Number.isFinite(time) ? time : 0;
  } catch {
    return 0;
  }
}

/** 同一前缀只留最近 20 个键。当前键在库里时一定留下，其余按 savedAt 从新到旧补满。 */
export function pruneScopedPersistenceKeys(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  prefix: string,
  currentFullKey: string,
  limit = SCOPED_PERSISTENCE_KEY_LIMIT,
): void {
  if (!storage || !isListableStorage(storage) || limit < 1) return;
  const needle = `${prefix}:`;
  const entries: { key: string; savedAt: number }[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(needle)) continue;
    entries.push({ key, savedAt: readSavedAt(storage.getItem(key)) });
  }
  if (entries.length <= limit) return;
  const currentPresent = entries.some((entry) => entry.key === currentFullKey);
  const room = currentPresent ? limit - 1 : limit;
  const keep = new Set(
    entries
      .filter((entry) => entry.key !== currentFullKey)
      .sort((left, right) => right.savedAt - left.savedAt || left.key.localeCompare(right.key))
      .slice(0, room)
      .map((entry) => entry.key),
  );
  if (currentPresent) keep.add(currentFullKey);
  for (const entry of entries) {
    if (!keep.has(entry.key)) storage.removeItem(entry.key);
  }
}

/** 本机结果保存共用边界；各结果 store 自行验证快照、坐标及过期状态。 */
export function createScopedResultPersistence<T>(options: {
  prefix: string;
  sources: WatchSource[];
  capture: () => T;
  restore: (value: unknown) => void;
  invalidate: (allowCalculations: boolean) => void;
}) {
  const persistenceError = ref<string | null>(null);
  const persistenceLabel = ref('尚未保存到本机');
  const hasPersistenceContext = ref(false);
  let scope: string | null = null;
  let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
  let hydrating = false;
  let blocked = false;
  let allowed = true;
  const unsaved = new Map<string, { raw: string; blocked: boolean }>();
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

  function persistRecords(): boolean {
    if (hydrating || !scope) return false;
    try {
      const raw = JSON.stringify({
        version: 1,
        scope,
        savedAt: new Date().toISOString(),
        data: options.capture(),
      });
      unsaved.set(scope, { raw, blocked });
      if (!storage) { persistenceLabel.value = '本机存储不可用，记录仅在内存中'; return false; }
      if (blocked) { persistenceLabel.value = '本机记录损坏，未覆盖原记录'; return false; }
      const fullKey = `${options.prefix}:${scope}`;
      storage.setItem(fullKey, raw);
      pruneScopedPersistenceKeys(storage, options.prefix, fullKey);
      unsaved.delete(scope);
      persistenceError.value = null;
      persistenceLabel.value = '本机已保存（未提交校审）';
      return true;
    } catch (error) {
      persistenceError.value = errorText(error);
      persistenceLabel.value = '本机保存失败，记录仍在内存中';
      return false;
    }
  }

  function bindPersistence(nextScope: string, nextStorage: Pick<Storage, 'getItem' | 'setItem'> | null, allowCalculations = true) {
    if (allowed !== allowCalculations) options.invalidate(allowCalculations);
    allowed = allowCalculations;
    if (scope === nextScope && storage === nextStorage) return;
    persistRecords();
    options.invalidate(allowCalculations);
    hydrating = true;
    try {
      scope = nextScope;
      hasPersistenceContext.value = true;
      storage = nextStorage;
      if (storage) pruneScopedPersistenceKeys(storage, options.prefix, `${options.prefix}:${scope}`);
      blocked = false;
      persistenceError.value = null;
      options.restore(null);
      persistenceLabel.value = storage ? '尚无本机记录' : '本机存储不可用';
      const pending = unsaved.get(scope);
      blocked = pending?.blocked ?? false;
      const raw = pending?.raw ?? storage?.getItem(`${options.prefix}:${scope}`);
      if (!raw) return;
      const envelope = JSON.parse(raw);
      if (!envelope || envelope.version !== 1 || envelope.scope !== scope || !('data' in envelope)) throw new Error('结果格式或所属上下文不匹配');
      options.restore(envelope.data);
      persistenceLabel.value = pending ? '已恢复未落盘记录，请重试保存并重算' : '已恢复本机记录，模型版本未核实，请重算';
    } catch (error) {
      blocked = true;
      options.restore(null);
      persistenceError.value = errorText(error);
      persistenceLabel.value = '本机记录读取失败，原记录未覆盖';
    } finally { hydrating = false; }
  }

  function detachPersistence() {
    persistRecords();
    scope = null;
    hasPersistenceContext.value = false;
    storage = null;
    allowed = true;
    options.invalidate(true);
  }

  const stop = watch(options.sources, persistRecords, { deep: true, flush: 'sync' });
  /** 调用方先完成各 store 的纯校验；整组替换期间不落盘中间状态。 */
  function applyPreparedRestore(apply: () => void) {
    options.invalidate(allowed);
    hydrating = true;
    try { apply(); } finally { hydrating = false; }
  }
  return { persistenceError, persistenceLabel, hasPersistenceContext, persistRecords, bindPersistence, detachPersistence, applyPreparedRestore,
    dispose: () => { detachPersistence(); stop(); } };
}
