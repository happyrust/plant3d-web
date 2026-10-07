import { computed, ref, watch } from 'vue';

import {
  clearanceModelChanged,
  clearanceRecordId,
  createClearanceRecord,
  withClearanceStatus,
  type ClearanceRecord,
} from '@/clearance/domain/clearanceRecord';
import {
  defaultClearanceService,
  type ClearanceService,
  type ComputeClearanceInput,
} from '@/clearance/services/clearanceService';

/**
 * Clearance 记录的状态（09-11 PR1.1：拾取流与抽屉共享同一个 store——选择、隐藏、删除、定位、精度标签都在这里）。
 * 与 `usePipeDistanceStore` 同一种形状：模块级 ref，`useClearanceStore()` 只是把它们和动作打包。
 * 一对 inputs 只有一条记录（`clearanceRecordId`），重算覆盖快照、保留 `createdAt`。
 */

const records = ref<ClearanceRecord[]>([]);
const activeId = ref<string | null>(null);
const hiddenIds = ref<Set<string>>(new Set());
const showAnnotations = ref(true);
const isComputing = ref(false);
const lastError = ref<string | null>(null);
const persistenceError = ref<string | null>(null);
const persistenceLabel = ref('尚未保存到本机');
let recordEpoch = 0;
let pendingComputations = 0;
let persistenceScope: string | null = null;
let persistenceStorage: Pick<Storage, 'getItem' | 'setItem'> | null = null;
let restoring = false;
let loadBlocked = false;
let calculationsAllowed = true;
const pairRequests = new Map<string, number>();
let nextRequest = 0;
const unsavedScopes = new Map<string, { raw: string; blocked: boolean }>();

function persistRecords(): boolean {
  if (restoring || !persistenceScope) return false;
  const raw = JSON.stringify({
    version: 1, scope: persistenceScope, records: records.value,
    hiddenIds: [...hiddenIds.value], activeId: activeId.value, showAnnotations: showAnnotations.value,
  });
  unsavedScopes.set(persistenceScope, { raw, blocked: loadBlocked });
  if (!persistenceStorage) return false;
  if (loadBlocked) {
    persistenceLabel.value = '本机记录损坏，未覆盖原文件';
    return false;
  }
  try {
    persistenceStorage.setItem(`plant3d-clearance-v1:${persistenceScope}`, raw);
    unsavedScopes.delete(persistenceScope);
    persistenceError.value = null;
    persistenceLabel.value = '本机已保存（未提交校审）';
    return true;
  } catch (error) {
    persistenceError.value = errorText(error);
    persistenceLabel.value = '本机保存失败，记录仍在内存中';
    return false;
  }
}

watch([records, hiddenIds, activeId, showAnnotations], () => { persistRecords(); }, { deep: true, flush: 'sync' });

const visibleRecords = computed(() => records.value.filter(record => !hiddenIds.value.has(record.id)));
const activeRecord = computed(() => records.value.find(record => record.id === activeId.value) ?? null);

export type ClearanceComputeOptions = Readonly<{
  /** 测试注入；缺省 `defaultClearanceService()`（真 API） */
  service?: ClearanceService;
  /** 算完是否置为当前记录，缺省 true */
  activate?: boolean;
}>;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useClearanceStore() {
  /** 与 Viewer 的项目/库/任务/轮次/用户/节点/模型版本上下文绑定；旧请求不能写入新上下文。 */
  function bindPersistence(scope: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null, allowCalculations = true) {
    if (calculationsAllowed !== allowCalculations) {
      recordEpoch += 1;
      pairRequests.clear();
      pendingComputations = 0;
      isComputing.value = false;
    }
    calculationsAllowed = allowCalculations;
    if (scope === persistenceScope && storage === persistenceStorage) return;
    persistRecords();
    recordEpoch += 1;
    pendingComputations = 0;
    pairRequests.clear();
    isComputing.value = false;
    restoring = true;
    try {
      persistenceScope = scope;
      persistenceStorage = storage;
      loadBlocked = false;
      records.value = [];
      hiddenIds.value = new Set();
      activeId.value = null;
      showAnnotations.value = true;
      lastError.value = null;
      persistenceError.value = null;
      persistenceLabel.value = storage ? '尚无本机记录' : '本机存储不可用';
      const unsaved = unsavedScopes.get(scope);
      loadBlocked = unsaved?.blocked ?? false;
      const raw = unsaved?.raw ?? storage?.getItem(`plant3d-clearance-v1:${scope}`);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || data.scope !== scope || !Array.isArray(data.records)
        || !Array.isArray(data.hiddenIds) || !data.hiddenIds.every((id: unknown) => typeof id === 'string')
        || (data.activeId !== null && typeof data.activeId !== 'string') || typeof data.showAnnotations !== 'boolean') {
        throw new Error('净距记录格式或所属上下文不匹配');
      }
      const loaded = data.records.map((record: Parameters<typeof createClearanceRecord>[0]) => createClearanceRecord(record));
      if (new Set(loaded.map((record: ClearanceRecord) => record.id)).size !== loaded.length
        || loaded.some((record: ClearanceRecord) => record.id !== clearanceRecordId(record.inputs))) throw new Error('净距记录标识重复或不匹配');
      // 同一上下文重开也不能证明服务器模型未变；快照保留，显式标记待重算。
      records.value = loaded.map((record: ClearanceRecord) => withClearanceStatus(record, 'stale'));
      const ids = new Set(records.value.map(record => record.id));
      hiddenIds.value = new Set(data.hiddenIds.filter((id: string) => ids.has(id)));
      activeId.value = ids.has(data.activeId) ? data.activeId : null;
      showAnnotations.value = data.showAnnotations;
      persistenceLabel.value = unsaved ? '已恢复未落盘的内存记录，请重试保存并重算' : '已恢复本机记录，模型版本未核实，请重算';
    } catch (error) {
      loadBlocked = true;
      persistenceError.value = errorText(error);
      persistenceLabel.value = '本机记录读取失败，原记录未覆盖';
    } finally {
      restoring = false;
    }
  }

  function detachPersistence() {
    persistRecords();
    persistenceScope = null;
    persistenceStorage = null;
    calculationsAllowed = true;
    recordEpoch += 1;
    pendingComputations = 0;
    pairRequests.clear();
    isComputing.value = false;
  }

  function findRecord(id: string): ClearanceRecord | null {
    return records.value.find(record => record.id === id) ?? null;
  }

  /** 同 id 覆盖（保留原 `createdAt`），否则追加。 */
  function upsertRecord(record: ClearanceRecord): ClearanceRecord {
    const index = records.value.findIndex(existing => existing.id === record.id);
    if (index < 0) {
      records.value = [...records.value, record];
      return record;
    }
    const previous = records.value[index]!;
    const merged: ClearanceRecord = previous.createdAt === record.createdAt
      ? record
      : Object.freeze({ ...record, createdAt: previous.createdAt });
    const next = [...records.value];
    next[index] = merged;
    records.value = next;
    return merged;
  }

  function removeRecord(id: string) {
    records.value = records.value.filter(record => record.id !== id);
    if (activeId.value === id) activeId.value = null;
    if (hiddenIds.value.has(id)) {
      const next = new Set(hiddenIds.value);
      next.delete(id);
      hiddenIds.value = next;
    }
  }

  function clearRecords() {
    recordEpoch += 1;
    pendingComputations = 0;
    pairRequests.clear();
    isComputing.value = false;
    records.value = [];
    activeId.value = null;
    hiddenIds.value = new Set();
    lastError.value = null;
  }

  function setActive(id: string | null) {
    activeId.value = id !== null && findRecord(id) ? id : null;
  }

  function toggleHidden(id: string) {
    const next = new Set(hiddenIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    hiddenIds.value = next;
  }

  function setHidden(id: string, hidden: boolean) {
    if (hiddenIds.value.has(id) === hidden) return;
    toggleHidden(id);
  }

  /** 按 id 标 stale（D4：模型换版不静默沿用）。 */
  function markStale(ids: readonly string[]) {
    const wanted = new Set(ids);
    records.value = records.value.map(record => (
      wanted.has(record.id) && record.status === 'current' ? withClearanceStatus(record, 'stale') : record
    ));
  }

  /**
   * 拿到某些 refno 的「现在」模型会话号后，把对应侧换了版的记录标 stale。
   * 键是本仓内部 refno（`a_b`）；没给的 refno 视为不知道，不动。返回被标掉的 id。
   */
  function markStaleByModelSesno(sesnoByRefno: Readonly<Record<string, number | null>>): string[] {
    const changed: string[] = [];
    records.value = records.value.map(record => {
      if (record.status !== 'current') return record;
      const current = {
        sourceSesno: sesnoByRefno[record.inputs.sourceRefno],
        targetSesno: sesnoByRefno[record.inputs.targetRefno],
      };
      if (!clearanceModelChanged(record, current)) return record;
      changed.push(record.id);
      return withClearanceStatus(record, 'stale');
    });
    return changed;
  }

  async function compute(
    input: ComputeClearanceInput,
    options: ClearanceComputeOptions = {},
  ): Promise<ClearanceRecord | null> {
    const service = options.service ?? defaultClearanceService();
    if (!calculationsAllowed) {
      lastError.value = '历史版本对比中不能用当前模型计算净距；请退出版本对比后重算。';
      return null;
    }
    const epoch = recordEpoch;
    const id = clearanceRecordId(input);
    const request = ++nextRequest;
    pairRequests.set(id, request);
    pendingComputations += 1;
    isComputing.value = true;
    lastError.value = null;
    try {
      const computed = await service.compute(input);
      if (epoch !== recordEpoch || pairRequests.get(id) !== request) return null;
      const record = upsertRecord(computed);
      if (options.activate !== false) activeId.value = record.id;
      setHidden(record.id, false);
      return record;
    } catch (error) {
      if (epoch !== recordEpoch || pairRequests.get(id) !== request) return null;
      lastError.value = errorText(error);
      const previous = findRecord(id);
      if (previous) upsertRecord(withClearanceStatus(previous, 'failed'));
      return null;
    } finally {
      if (epoch === recordEpoch) {
        pendingComputations -= 1;
        isComputing.value = pendingComputations > 0;
      }
    }
  }

  /** 同 inputs 重算：成功覆盖快照回到 `current`，失败留旧快照标 `failed`。 */
  async function recompute(id: string, options: ClearanceComputeOptions = {}): Promise<ClearanceRecord | null> {
    const record = findRecord(id);
    if (!record) return null;
    return compute(
      {
        sourceRefno: record.inputs.sourceRefno,
        targetRefno: record.inputs.targetRefno,
        targetKind: record.inputs.targetKind,
      },
      { ...options, activate: options.activate ?? (activeId.value === id) },
    );
  }

  return {
    records,
    activeId,
    activeRecord,
    hiddenIds,
    visibleRecords,
    showAnnotations,
    isComputing,
    lastError,
    persistenceError,
    persistenceLabel,
    bindPersistence,
    detachPersistence,
    persistRecords,
    findRecord,
    upsertRecord,
    removeRecord,
    clearRecords,
    setActive,
    toggleHidden,
    setHidden,
    markStale,
    markStaleByModelSesno,
    compute,
    recompute,
  };
}
