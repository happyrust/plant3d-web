import { computed, ref, watch } from 'vue';

import {
  clearanceModelChanged,
  clearanceRecordId,
  createClearanceRecord,
  withClearanceStatus,
  withDerivedDimension,
  type ClearanceRecord,
} from '@/clearance/domain/clearanceRecord';
import {
  defaultClearanceService,
  type ClearanceService,
  type ComputeClearanceInput,
} from '@/clearance/services/clearanceService';
import { cloneResultSnapshot } from '@/clearance/services/resultSnapshot';
import { pruneScopedPersistenceKeys } from '@/clearance/services/scopedResultPersistence';

/**
 * Clearance 记录的状态（09-11 PR1.1：拾取流与抽屉共享同一个 store——选择、隐藏、删除、定位、精度标签都在这里）。
 * 与 `usePipeDistanceStore` 同一种形状：模块级 ref，`useClearanceStore()` 只是把它们和动作打包。
 * 一对 inputs 只有一条记录（`clearanceRecordId`），重算覆盖快照、保留 `createdAt`。
 */

const records = ref<ClearanceRecord[]>([]);
const activeId = ref<string | null>(null);
const hiddenIds = ref<Set<string>>(new Set());
/** 「取最新」核对确认所测构件已不在场景中的记录 id → 原因文本（只放运行时内存，不落盘；重算前拦截无效请求） */
const missingReasonById = ref<Map<string, string>>(new Map());
/** 用户的「显示标注」偏好（落盘）。 */
const showAnnotationsPref = ref(true);
/** 本次会话从本机恢复了历史记录后默认不上屏（不落盘）；用户开启显示或新算一条即解除。 */
const restoredHidden = ref(false);
const showAnnotations = computed<boolean>({
  get: () => showAnnotationsPref.value && !restoredHidden.value,
  set: (value) => {
    showAnnotationsPref.value = value;
    if (value) restoredHidden.value = false;
  },
});
const showAnnotationsPreference = computed(() => showAnnotationsPref.value);
const XRAY_UNRELATED_STORAGE_KEY = 'plant3d-clearance-xray-unrelated-v1';

function readXrayUnrelatedPref(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(XRAY_UNRELATED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeXrayUnrelatedPref(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(XRAY_UNRELATED_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 忽略本机存储不可用
  }
}

/** 测量时无关模型 X 光半透明显示选项（默认关闭，跨管道距离 / 中心线净距 / 测量面板共享并落盘）。 */
const xrayUnrelatedModels = ref(readXrayUnrelatedPref());
watch(xrayUnrelatedModels, (enabled) => {
  writeXrayUnrelatedPref(enabled);
}, { flush: 'sync' });

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
const computeOptionsById = new Map<string, Pick<ComputeClearanceInput, 'perpendicular' | 'maxDistanceMm'>>();
let nextRequest = 0;
const unsavedScopes = new Map<string, { raw: string; blocked: boolean }>();

/**
 * 校验持久化/快照里的记录标识是否与载荷一致：
 * - 普通净距记录：`clearance:<source>:<target>`（与 `clearanceRecordId(inputs)` 逐字一致）；
 * - 连排相邻记录：`piperow:<alignMode>:<metric>:<a_sorted>:<b_sorted>@<startMm>-<endMm>`
 *   （允许 ±0.11 mm 容差以覆盖 0.1 mm 格式化与米↔毫米往返舍入）。
 */
function isValidClearanceRecordId(record: ClearanceRecord): boolean {
  if (!record.pipeRow) return record.id === clearanceRecordId(record.inputs);
  const [a, b] = [record.inputs.sourceRefno, record.inputs.targetRefno].sort();
  const expectedPrefix = `piperow:${record.pipeRow.alignMode}:${record.pipeRow.metric}:${a}:${b}@`;
  if (!record.id.startsWith(expectedPrefix)) return false;
  const range = record.id.slice(expectedPrefix.length);
  const match = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(range);
  if (!match) return false;
  const startMm = Number(match[1]);
  const endMm = Number(match[2]);
  const expectedStartMm = record.pipeRow.section.axialStartM * 1000;
  const expectedEndMm = record.pipeRow.section.axialEndM * 1000;
  return Number.isFinite(startMm) && Number.isFinite(endMm)
    && Math.abs(startMm - expectedStartMm) <= 0.11
    && Math.abs(endMm - expectedEndMm) <= 0.11;
}

function persistRecords(): boolean {
  if (restoring || !persistenceScope) return false;
  const raw = JSON.stringify({
    version: 1,
    scope: persistenceScope,
    savedAt: new Date().toISOString(),
    records: records.value,
    hiddenIds: [...hiddenIds.value], activeId: activeId.value, showAnnotations: showAnnotationsPref.value,
  });
  unsavedScopes.set(persistenceScope, { raw, blocked: loadBlocked });
  if (!persistenceStorage) return false;
  if (loadBlocked) {
    persistenceLabel.value = '本机记录损坏，未覆盖原文件';
    return false;
  }
  try {
    const fullKey = `plant3d-clearance-v1:${persistenceScope}`;
    persistenceStorage.setItem(fullKey, raw);
    pruneScopedPersistenceKeys(persistenceStorage, 'plant3d-clearance-v1', fullKey);
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

watch([records, hiddenIds, activeId, showAnnotationsPref], () => { persistRecords(); }, { deep: true, flush: 'sync' });

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
  function captureSnapshot() {
    return cloneResultSnapshot({ records: records.value, hiddenIds: [...hiddenIds.value],
      activeId: activeId.value, showAnnotations: showAnnotationsPref.value });
  }

  /** 先验证并脱离外部对象；调用返回动作之前不会替换本机结果。 */
  function prepareSnapshotRestore(value: unknown): () => void {
    const data = JSON.parse(JSON.stringify(value));
    if (!data || !Array.isArray(data.records) || !Array.isArray(data.hiddenIds)
      || !data.hiddenIds.every((id: unknown) => typeof id === 'string')
      || (data.activeId !== null && typeof data.activeId !== 'string') || typeof data.showAnnotations !== 'boolean') {
      throw new Error('净距结果格式无效');
    }
    const loaded: ClearanceRecord[] = data.records.map((record: Parameters<typeof createClearanceRecord>[0]) => createClearanceRecord(record));
    if (new Set(loaded.map(record => record.id)).size !== loaded.length
      || loaded.some(record => !isValidClearanceRecordId(record))) throw new Error('净距记录标识重复或不匹配');
    const stale = loaded.map(record => withClearanceStatus(record, 'stale'));
    const ids = new Set(stale.map(record => record.id));
    const hidden = new Set<string>(data.hiddenIds.filter((id: string) => ids.has(id)));
    const selected = ids.has(data.activeId) ? data.activeId : null;
    return () => {
      restoring = true;
      recordEpoch += 1;
      pendingComputations = 0;
      pairRequests.clear();
      computeOptionsById.clear();
      isComputing.value = false;
      try {
        records.value = stale;
        hiddenIds.value = hidden;
        activeId.value = selected;
        restoredHidden.value = false;
        showAnnotationsPref.value = data.showAnnotations;
        lastError.value = null;
      } finally { restoring = false; }
    };
  }

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
    computeOptionsById.clear();
    isComputing.value = false;
    restoring = true;
    try {
      persistenceScope = scope;
      persistenceStorage = storage;
      if (storage) pruneScopedPersistenceKeys(storage, 'plant3d-clearance-v1', `plant3d-clearance-v1:${scope}`);
      loadBlocked = false;
      records.value = [];
      hiddenIds.value = new Set();
      activeId.value = null;
      showAnnotationsPref.value = true;
      restoredHidden.value = false;
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
        || loaded.some((record: ClearanceRecord) => !isValidClearanceRecordId(record))) throw new Error('净距记录标识重复或不匹配');
      // 同一上下文重开也不能证明服务器模型未变；快照保留，显式标记待重算。
      records.value = loaded.map((record: ClearanceRecord) => withClearanceStatus(record, 'stale'));
      const ids = new Set(records.value.map(record => record.id));
      hiddenIds.value = new Set(data.hiddenIds.filter((id: string) => ids.has(id)));
      activeId.value = ids.has(data.activeId) ? data.activeId : null;
      showAnnotationsPref.value = data.showAnnotations;
      // 打开页面不自动绘制历史净距：需用户在面板里手动开启显示。
      restoredHidden.value = records.value.length > 0;
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
    restoredHidden.value = false;
    calculationsAllowed = true;
    recordEpoch += 1;
    pendingComputations = 0;
    pairRequests.clear();
    computeOptionsById.clear();
    isComputing.value = false;
  }

  function findRecord(id: string): ClearanceRecord | null {
    return records.value.find(record => record.id === id) ?? null;
  }

  /** 同 id 覆盖（保留原 `createdAt`），否则追加。 */
  function upsertRecord(record: ClearanceRecord, options?: { keepRestoredHidden?: boolean }): ClearanceRecord {
    // 新算出的结果是用户主动操作，解除「恢复后默认隐藏」；重算失败标 failed 时不误解除。
    if (!options?.keepRestoredHidden) {
      restoredHidden.value = false;
    }
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
    computeOptionsById.delete(id);
    if (activeId.value === id) activeId.value = null;
    if (hiddenIds.value.has(id)) {
      const next = new Set(hiddenIds.value);
      next.delete(id);
      hiddenIds.value = next;
    }
    if (missingReasonById.value.has(id)) {
      const nextMissing = new Map(missingReasonById.value);
      nextMissing.delete(id);
      missingReasonById.value = nextMissing;
    }
  }

  function clearRecords() {
    recordEpoch += 1;
    pendingComputations = 0;
    pairRequests.clear();
    computeOptionsById.clear();
    isComputing.value = false;
    records.value = [];
    activeId.value = null;
    hiddenIds.value = new Set();
    missingReasonById.value = new Map();
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

  /**
   * 尺寸经 `clearanceRecordToDimensionInput` 真建出来后回链：`dimensionId` 写进记录；
   * 传 `null` 解除（尺寸被删时）。转换本身纯命令不改记录，这里是唯一写回链的口子。
   */
  function setDerivedDimensionId(id: string, dimensionId: string | null) {
    records.value = records.value.map(record => (
      record.id === id ? withDerivedDimension(record, dimensionId) : record
    ));
  }

  /** 按 id 标 stale（D4：模型换版不静默沿用）。 */
  function markStale(ids: readonly string[]) {
    const wanted = new Set(ids);
    records.value = records.value.map(record => (
      wanted.has(record.id) && record.status === 'current' ? withClearanceStatus(record, 'stale') : record
    ));
  }

  /** 将所测构件已被撤下/删除的净距记录标为 stale 并记明缺失原因，禁止发起无效重测请求。 */
  function markMissingInScene(ids: readonly string[], reason = '所测构件已不在场景中') {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    records.value = records.value.map(record => (
      wanted.has(record.id) && record.status !== 'stale' ? withClearanceStatus(record, 'stale') : record
    ));
    const existingIds = new Set(records.value.map(record => record.id));
    const next = new Map(missingReasonById.value);
    for (const id of wanted) {
      if (existingIds.has(id)) next.set(id, reason);
    }
    missingReasonById.value = next;
  }

  function clearMissingInScene(ids?: readonly string[]) {
    if (!ids) {
      if (missingReasonById.value.size > 0) missingReasonById.value = new Map();
      return;
    }
    const next = new Map(missingReasonById.value);
    let changed = false;
    for (const id of ids) {
      if (next.delete(id)) changed = true;
    }
    if (changed) missingReasonById.value = next;
  }

  function getMissingReason(id: string): string | null {
    return missingReasonById.value.get(id) ?? null;
  }

  /**
   * 拿到某些 refno 的「现在」模型会话号后，把对应侧换了版的记录标 stale。
   * 键是本仓内部 refno（`a_b`）；没给的 refno 视为不知道，不动。返回被标掉的 id。
   * 「侧」的查询键：优先 `inputs.*Refno`，其次 provenance operand refno——交互式平行直段与
   * 连排记录的 inputs 是直段锚点（`a_b~c_d`），实体级 refno 只在 provenance 里。
   */
  function markStaleByModelSesno(sesnoByRefno: Readonly<Record<string, number | null>>): string[] {
    const sideSesno = (record: ClearanceRecord, side: 'source' | 'target') =>
      sesnoByRefno[record.inputs[`${side}Refno`]] ?? sesnoByRefno[record.provenance[side].refno ?? ''];
    const changed: string[] = [];
    records.value = records.value.map(record => {
      if (record.status !== 'current') return record;
      const current = {
        sourceSesno: sideSesno(record, 'source'),
        targetSesno: sideSesno(record, 'target'),
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
    const savedOptions: { perpendicular?: boolean; maxDistanceMm?: number } = {};
    if (input.perpendicular !== undefined) savedOptions.perpendicular = input.perpendicular;
    if (input.maxDistanceMm !== undefined) savedOptions.maxDistanceMm = input.maxDistanceMm;
    if (savedOptions.perpendicular !== undefined || savedOptions.maxDistanceMm !== undefined) {
      computeOptionsById.set(id, savedOptions);
    } else {
      computeOptionsById.delete(id);
    }
    pendingComputations += 1;
    isComputing.value = true;
    lastError.value = null;
    try {
      const computed = await service.compute(input);
      if (epoch !== recordEpoch || pairRequests.get(id) !== request) return null;
      const record = upsertRecord(computed);
      clearMissingInScene([record.id]);
      if (options.activate !== false) activeId.value = record.id;
      setHidden(record.id, false);
      return record;
    } catch (error) {
      if (epoch !== recordEpoch || pairRequests.get(id) !== request) return null;
      lastError.value = errorText(error);
      const previous = findRecord(id);
      if (previous) upsertRecord(withClearanceStatus(previous, 'failed'), { keepRestoredHidden: true });
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
    const missingReason = getMissingReason(id);
    if (missingReason) {
      lastError.value = missingReason;
      return null;
    }
    // 连排记录是截面中心距 / 名义推导间隔，按 inputs 走整构件外表面净距只会另起一条口径不同的记录。
    if (record.pipeRow) {
      lastError.value = '连排测量记录请在「管道距离 · 连排相邻」里重新检测，不能按整构件净距重算';
      return null;
    }
    if (record.provenance.method === 'parallel-centerline') {
      lastError.value = '平行直段中心距记录请用「测量 → 管-管」工具重新测量，不能按整构件净距重算';
      return null;
    }
    const preserved = computeOptionsById.get(id);
    return compute(
      {
        sourceRefno: record.inputs.sourceRefno,
        targetRefno: record.inputs.targetRefno,
        targetKind: record.inputs.targetKind,
        ...(preserved?.perpendicular !== undefined ? { perpendicular: preserved.perpendicular } : {}),
        ...(preserved?.maxDistanceMm !== undefined ? { maxDistanceMm: preserved.maxDistanceMm } : {}),
      },
      { ...options, activate: options.activate ?? (activeId.value === id) },
    );
  }

  /** 只写落盘偏好、不解除会话闸门；供快照复位/恢复这类非用户操作使用。 */
  function setShowAnnotationsPreference(value: boolean) {
    showAnnotationsPref.value = value;
  }

  /** 本机恢复（含旧快照迁移写入）之后重新挂上「默认不上屏」闸门；没有记录时不挂。 */
  function markRestoredHidden() {
    restoredHidden.value = records.value.length > 0;
  }

  function setXrayUnrelatedModels(enabled: boolean) {
    xrayUnrelatedModels.value = Boolean(enabled);
  }

  return {
    captureSnapshot,
    prepareSnapshotRestore,
    setShowAnnotationsPreference,
    /** 落盘偏好（不含会话闸门）；快照保存用它，免得把「本次隐藏」写成用户偏好。 */
    showAnnotationsPreference,
    markRestoredHidden,
    xrayUnrelatedModels,
    setXrayUnrelatedModels,
    records,
    activeId,
    activeRecord,
    hiddenIds,
    missingReasonById,
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
    markMissingInScene,
    clearMissingInScene,
    getMissingReason,
    markStaleByModelSesno,
    setDerivedDimensionId,
    compute,
    recompute,
  };
}
