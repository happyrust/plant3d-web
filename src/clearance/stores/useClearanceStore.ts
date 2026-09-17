import { computed, ref } from 'vue';

import {
  clearanceModelChanged,
  clearanceRecordId,
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
    isComputing.value = true;
    lastError.value = null;
    try {
      const record = upsertRecord(await service.compute(input));
      if (options.activate !== false) activeId.value = record.id;
      setHidden(record.id, false);
      return record;
    } catch (error) {
      lastError.value = errorText(error);
      const id = clearanceRecordId(input);
      const previous = findRecord(id);
      if (previous) upsertRecord(withClearanceStatus(previous, 'failed'));
      return null;
    } finally {
      isComputing.value = false;
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
