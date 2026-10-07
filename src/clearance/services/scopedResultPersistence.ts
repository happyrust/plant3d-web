import { ref, watch, type WatchSource } from 'vue';

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
      const raw = JSON.stringify({ version: 1, scope, data: options.capture() });
      unsaved.set(scope, { raw, blocked });
      if (!storage) { persistenceLabel.value = '本机存储不可用，记录仅在内存中'; return false; }
      if (blocked) { persistenceLabel.value = '本机记录损坏，未覆盖原记录'; return false; }
      storage.setItem(`${options.prefix}:${scope}`, raw);
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
  return { persistenceError, persistenceLabel, hasPersistenceContext, persistRecords, bindPersistence, detachPersistence,
    dispose: () => { detachPersistence(); stop(); } };
}
