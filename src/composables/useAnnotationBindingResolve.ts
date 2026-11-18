import { shallowRef, watch, type ShallowRef } from 'vue';

import {
  dtxLoaderRevision,
  isDtxRefnoKnownAcrossAllDbnos,
  isDtxRefnoLoadedAcrossAllDbnos,
} from '@/composables/useDbnoInstancesDtxLoader';
import {
  deriveAnnotationBindings,
  useToolStore,
  type AnnotationRecord,
  type AnnotationType,
  type AnyAnnotationRecord,
  type CloudAnnotationRecord,
  type CloudBindingRole,
  type Vec3,
} from '@/composables/useToolStore';
import { useViewerContext } from '@/composables/useViewerContext';
import {
  buildBindingResolveKey,
  classifyBinding,
  isAnchorOutsideAabb,
  summarizeBindingResolve,
  summarizeRecordDegrade,
  type AnnotationDegrade,
  type BindingResolveEntry,
  type BindingResolveProbe,
  type BindingResolveSummary,
} from '@/review/domain/bindingResolve';
import { toRefnoKey } from '@/utils/refnoKey';

/**
 * 批注关联的失效解析（ADR-0050）——运行时部分。
 *
 * - 结果只放内存（`entries`），**不写回记录**：渲染只读坐标快照，解析只服务提示与门控；
 *   持久化 `resolveDetailsV1` 留给后续方案（docs/plans/2026-09-14-3d-annotation-interaction-redesign-proposal.md §6.1）。
 * - 触发：① 模型加载 / 版本切换（`dtxLoaderRevision` 变化，120ms 内的连续变化合并）批量重算；② 详情卡打开时按记录重算；
 *   ③ 一次按 refno 的定位 / 加载拿到回执后，把 `fail` 记成权威 missing、`ok` 撤销之前的 missing，再重算；
 *   ④ 记录集合或某条记录的绑定数变化（导入快照 / 服务端拉回 / 新建 / 删除）——模型先到、批注后到时，视口的降级样式才拿得到结果，
 *   与 ① 共用同一个合并窗口。
 * - 探针默认接 DTX 运行时索引（跨库）；测试与其它宿主可注入自己的探针。
 * - 视口侧只消费记录级的 `getRecordDegrade / getRecordDegrades`（missing 优先于 stale；resolved / unloaded 不降级）。
 */

const ANNOTATION_TYPES: readonly AnnotationType[] = ['text', 'cloud', 'rect', 'obb'];

type ResolveEntries = ReadonlyMap<string, BindingResolveEntry>;

const entries: ShallowRef<ResolveEntries> = shallowRef(new Map());
/** 按 refno 的定位 / 加载明确失败过的构件（权威 missing 证据）→ 那次回执里的错误文本（没有就 null）。 */
const verifiedMissing = new Map<string, string | null>();
/** 「取最新」开始前已在场景中的批注绑定构件（本轮重载/撤下后若不在场景中，说明已被撤下或删除） */
let loadedBeforeGetWork = new Set<string>();
let lastResolvedAt = 0;
let watcherInstalled = false;
/** 模型分批装载时修订号会连续 +1，合并成一次重算；间隔取一帧多一点即可。 */
const RESOLVE_ALL_DEBOUNCE_MS = 120;
let pendingResolveAll: ReturnType<typeof setTimeout> | null = null;

function anchorWorldPosOf(type: AnnotationType, record: AnyAnnotationRecord): Vec3 | undefined {
  if (type === 'text') return (record as AnnotationRecord).worldPos;
  if (type === 'cloud') return (record as CloudAnnotationRecord).anchorWorldPos;
  return undefined;
}

function normalizeRefno(refno: string): string {
  return String(refno ?? '').trim();
}

function missingKeysOf(refno: string): string[] {
  const raw = normalizeRefno(refno);
  if (!raw) return [];
  const canonical = toRefnoKey(raw);
  return canonical && canonical !== raw ? [raw, canonical] : [raw];
}

function hasVerifiedMissing(refno: string): boolean {
  return missingKeysOf(refno).some((key) => verifiedMissing.has(key));
}

function getVerifiedMissingReason(refno: string): string | null | undefined {
  for (const key of missingKeysOf(refno)) {
    if (verifiedMissing.has(key)) return verifiedMissing.get(key);
  }
  return undefined;
}

function setVerifiedMissing(refno: string, error: string | null): boolean {
  const keys = missingKeysOf(refno);
  if (keys.length === 0) return false;
  let changed = false;
  for (const key of keys) {
    if (!verifiedMissing.has(key) || verifiedMissing.get(key) !== error) {
      verifiedMissing.set(key, error);
      changed = true;
    }
  }
  return changed;
}

function deleteVerifiedMissing(refno: string): boolean {
  let deleted = false;
  for (const key of missingKeysOf(refno)) {
    if (verifiedMissing.delete(key)) deleted = true;
  }
  return deleted;
}

function clearLoadedFromVerifiedMissing(isLoaded: (refno: string) => boolean = isDtxRefnoLoadedAcrossAllDbnos): boolean {
  if (verifiedMissing.size === 0) return false;
  let cleared = false;
  for (const key of [...verifiedMissing.keys()]) {
    if (isLoaded(key) && deleteVerifiedMissing(key)) {
      cleared = true;
    }
  }
  return cleared;
}

function collectAllBoundRefnos(): string[] {
  const store = useToolStore();
  if (typeof (store as Partial<typeof store>).getAnnotationRecordsByType !== 'function') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const type of ANNOTATION_TYPES) {
    for (const record of store.getAnnotationRecordsByType(type) ?? []) {
      for (const binding of deriveAnnotationBindings(type, record)) {
        const refno = normalizeRefno(binding.refno);
        if (!refno) continue;
        const canonical = toRefnoKey(refno) || refno;
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        out.push(refno);
      }
    }
  }
  return out;
}

function createDefaultProbe(): BindingResolveProbe {
  const { viewerRef } = useViewerContext();
  return {
    isLoaded: (refno) => isDtxRefnoLoadedAcrossAllDbnos(refno),
    isKnown: (refno) => isDtxRefnoKnownAcrossAllDbnos(refno),
    isVerifiedMissing: (refno) => hasVerifiedMissing(refno),
    missingReason: (refno) => getVerifiedMissingReason(refno),
    anchorDrift: (refno, worldPos) => {
      const scene = viewerRef.value?.scene as {
        getSubtreeAABB?: (ids: string[]) => ArrayLike<number> | null;
        getAABB?: (ids: string[]) => ArrayLike<number> | null;
      } | undefined;
      if (!scene?.getAABB && !scene?.getSubtreeAABB) return null;
      let aabb: ArrayLike<number> | null = null;
      try {
        aabb = scene.getSubtreeAABB?.([refno]) ?? scene.getAABB?.([refno]) ?? null;
      } catch {
        return null;
      }
      return isAnchorOutsideAabb(worldPos, aabb);
    },
  };
}

function resolveRecordInto(
  target: Map<string, BindingResolveEntry>,
  type: AnnotationType,
  record: AnyAnnotationRecord,
  probe: BindingResolveProbe,
  now: number,
): void {
  const anchorWorldPos = anchorWorldPosOf(type, record);
  for (const binding of deriveAnnotationBindings(type, record)) {
    const key = buildBindingResolveKey(type, record.id, binding.role, binding.refno);
    target.set(key, classifyBinding({
      refno: binding.refno,
      role: binding.role,
      anchorWorldPos: binding.role === 'anchor' ? anchorWorldPos : undefined,
    }, probe, now));
  }
}

/** 全量重算：四类批注 × 全部绑定。结果整表替换，触发一次响应式更新。 */
function resolveAll(probe: BindingResolveProbe = createDefaultProbe()): ResolveEntries {
  const store = useToolStore();
  const now = Date.now();
  const next = new Map<string, BindingResolveEntry>();
  for (const type of ANNOTATION_TYPES) {
    for (const record of store.getAnnotationRecordsByType(type)) {
      resolveRecordInto(next, type, record, probe, now);
    }
  }
  entries.value = next;
  lastResolvedAt = now;
  return next;
}

/** 只重算一条记录（详情卡打开 / 记录变化时用），其它记录的结果保留。 */
function resolveRecord(
  type: AnnotationType,
  annotationId: string,
  probe: BindingResolveProbe = createDefaultProbe(),
): void {
  const store = useToolStore();
  const record = store.getAnnotationRecordsByType(type).find((item) => item.id === annotationId);
  const next = new Map(entries.value);
  const prefix = `${type}:${annotationId}:`;
  for (const key of next.keys()) {
    if (key.startsWith(prefix)) next.delete(key);
  }
  if (record) resolveRecordInto(next, type, record, probe, Date.now());
  entries.value = next;
}

type LoadResultFailItem = string | { refno: string; error?: string | null };

/**
 * 吃一次按 refno 的定位 / 加载回执（`showModelByRefnosWithAck` 的 `ok` / `fail`）：
 * `fail` 是权威 missing 证据（连同错误文本），`ok` 撤销此前的 missing。
 * 之后全量重算一次，让所有引用这些 refno 的绑定同步变色；`ok` 还意味着几何刚装进来，
 * 即使没有 missing 变化也要重算（unloaded → resolved）。
 */
function markLoadResult(result: { ok?: readonly string[]; fail?: readonly LoadResultFailItem[] }): void {
  let changed = false;
  for (const raw of result.ok ?? []) {
    const refno = normalizeRefno(raw);
    if (refno && deleteVerifiedMissing(refno)) changed = true;
  }
  for (const raw of result.fail ?? []) {
    const refno = normalizeRefno(typeof raw === 'string' ? raw : raw?.refno);
    if (!refno) continue;
    const error = typeof raw === 'string' ? null : (raw.error?.trim() || null);
    if (setVerifiedMissing(refno, error)) {
      changed = true;
    }
  }
  if (changed || (result.ok?.length ?? 0) > 0) resolveAll();
}

/**
 * 「取最新」开始前拍下当前已在场景里的绑定构件集合：
 * 若本轮重载/撤下后该构件已不在场景中，说明其在最新模型中已被删除或无几何撤下。
 */
function captureBeforeGetWork(isLoaded: (refno: string) => boolean = isDtxRefnoLoadedAcrossAllDbnos): void {
  const next = new Set<string>();
  for (const refno of collectAllBoundRefnos()) {
    if (!isLoaded(refno)) continue;
    for (const key of missingKeysOf(refno)) next.add(key);
  }
  loadedBeforeGetWork = next;
}

export type ReconcileAnnotationBindingsAfterGetWorkOptions = {
  probeNodeGone?: (refno: string) => Promise<boolean | null>;
  isLoaded?: (refno: string) => boolean;
  probe?: BindingResolveProbe;
};

/**
 * 「取最新」完成模型重载与撤下后，同步核对全部校审批注对构件的绑定（#158）：
 * 1. 重新出现在场景里的构件自动解除失效标记；
 * 2. 本轮从场景撤下的绑定构件，或经树探查在当前模型中已删除的未装绑定构件，标为权威 `missing`（保留批注记录不删除）；
 * 3. 对留存构件立即按最新包围盒/变换刷新绑定解析结果。
 */
async function reconcileAfterGetWork(
  options: ReconcileAnnotationBindingsAfterGetWorkOptions = {},
): Promise<ResolveEntries> {
  if (pendingResolveAll !== null) {
    clearTimeout(pendingResolveAll);
    pendingResolveAll = null;
  }
  const checkLoaded = options.isLoaded ?? options.probe?.isLoaded ?? isDtxRefnoLoadedAcrossAllDbnos;
  clearLoadedFromVerifiedMissing(checkLoaded);

  const boundRefnos = collectAllBoundRefnos();
  const toProbe: string[] = [];
  for (const refno of boundRefnos) {
    if (checkLoaded(refno)) {
      deleteVerifiedMissing(refno);
      continue;
    }
    if (missingKeysOf(refno).some((key) => loadedBeforeGetWork.has(key))) {
      setVerifiedMissing(refno, '构件在当前模型中已不存在');
      continue;
    }
    if (!hasVerifiedMissing(refno) && options.probeNodeGone) {
      toProbe.push(refno);
    }
  }
  loadedBeforeGetWork = new Set();

  if (toProbe.length > 0 && options.probeNodeGone) {
    const probeNodeGone = options.probeNodeGone;
    await Promise.all(
      toProbe.map(async (refno) => {
        try {
          const gone = await probeNodeGone(refno);
          if (gone === true) {
            setVerifiedMissing(refno, '构件在当前模型中已不存在');
          }
        } catch {
          // 网络或探针失败时不误标 missing
        }
      }),
    );
  }

  return resolveAll(options.probe);
}

function getBindingResolve(
  type: AnnotationType,
  annotationId: string,
  role: CloudBindingRole,
  refno: string,
): BindingResolveEntry | undefined {
  return entries.value.get(buildBindingResolveKey(type, annotationId, role, refno));
}

function collectRecordEntries(type: AnnotationType, annotationId: string): BindingResolveEntry[] {
  const prefix = `${type}:${annotationId}:`;
  const collected: BindingResolveEntry[] = [];
  for (const [key, entry] of entries.value) {
    if (key.startsWith(prefix)) collected.push(entry);
  }
  return collected;
}

function getRecordSummary(type: AnnotationType, annotationId: string): BindingResolveSummary {
  return summarizeBindingResolve(collectRecordEntries(type, annotationId));
}

/** 记录级索引键（`getRecordDegrades` 的 key）：类型 + 记录 id。 */
export function buildRecordDegradeKey(type: AnnotationType, annotationId: string): string {
  return `${type}:${annotationId}`;
}

/** 一条记录的视口降级态；没有 missing / stale 时回 null。 */
function getRecordDegrade(type: AnnotationType, annotationId: string): AnnotationDegrade | null {
  return summarizeRecordDegrade(collectRecordEntries(type, annotationId));
}

/**
 * 全部记录的视口降级态，一趟扫完整表（视口每次同步 / 解析表每次变化都要问全部记录，逐条前缀扫描是 O(记录 × 绑定)）。
 * 只含降级的记录；键见 `buildRecordDegradeKey`。
 */
function getRecordDegrades(): ReadonlyMap<string, AnnotationDegrade> {
  const grouped = new Map<string, BindingResolveEntry[]>();
  for (const [key, entry] of entries.value) {
    // key = type:id:role:refno；id 里不会有冒号（nowId 生成 / 服务端 uuid），取前两段即记录键
    const second = key.indexOf(':', key.indexOf(':') + 1);
    if (second < 0) continue;
    const recordKey = key.slice(0, second);
    const bucket = grouped.get(recordKey);
    if (bucket) bucket.push(entry);
    else grouped.set(recordKey, [entry]);
  }
  const out = new Map<string, AnnotationDegrade>();
  for (const [recordKey, bucket] of grouped) {
    const degrade = summarizeRecordDegrade(bucket);
    if (degrade) out.set(recordKey, degrade);
  }
  return out;
}

/** 合并一小段时间内的多次修订号变化，只重算一次。 */
function scheduleResolveAll(): void {
  if (pendingResolveAll !== null) clearTimeout(pendingResolveAll);
  pendingResolveAll = setTimeout(() => {
    pendingResolveAll = null;
    resolveAll();
  }, RESOLVE_ALL_DEBOUNCE_MS);
}

/** 记录集合签名：类型:id:绑定数。只有增删记录或绑定数变了才变，改标题 / 拖文字框都不触发。 */
function recordSetSignature(): string {
  const store = useToolStore();
  // 手写的 useToolStore mock（ReviewPanel.componentLinkage / WorkflowHistory / ConfirmedRecords 等测试）不一定带这个方法；
  // 这里是 watch 的 getter，缺了就当没有记录，不能抛。
  if (typeof (store as Partial<typeof store>).getAnnotationRecordsByType !== 'function') return '';
  const parts: string[] = [];
  for (const type of ANNOTATION_TYPES) {
    // 保持方法调用（mock 里可能用 this 取字段）
    for (const record of store.getAnnotationRecordsByType(type) ?? []) {
      parts.push(`${type}:${record.id}:${record.bindings?.length ?? -1}`);
    }
  }
  return parts.join('|');
}

function installWatchers(): void {
  if (watcherInstalled) return;
  watcherInstalled = true;
  // ① 模型加载 / 版本切换 → 运行时索引修订 +1 → 若此前标为缺失的构件已重新装入场景，自动解除 missing，再合并重算。
  // 大模型分批装载会连续 bump，这里合并成一次。
  watch(dtxLoaderRevision, () => {
    clearLoadedFromVerifiedMissing();
    scheduleResolveAll();
  });
  // ④ 记录集合变化（导入快照 / 服务端拉回 / 新建 / 删除 / 绑定增删）→ 同一个合并窗口。
  // 模型先装好、批注后到时，没有这一条视口拿不到降级态；此时重算的结论只会是 resolved / unloaded，不会误判 missing。
  watch(recordSetSignature, () => {
    scheduleResolveAll();
  });
}

/** 仅测试用：清空解析结果、权威 missing 证据与待执行的合并重算。 */
function resetForTests(): void {
  if (pendingResolveAll !== null) {
    clearTimeout(pendingResolveAll);
    pendingResolveAll = null;
  }
  entries.value = new Map();
  verifiedMissing.clear();
  loadedBeforeGetWork = new Set();
  lastResolvedAt = 0;
}

export type AnnotationBindingResolveApi = {
  /** 解析结果整表（shallowRef，整表替换触发更新）；在 computed 里经 getBindingResolve 读它即可响应 */
  entries: ShallowRef<ResolveEntries>;
  resolveAll: typeof resolveAll;
  resolveRecord: typeof resolveRecord;
  markLoadResult: typeof markLoadResult;
  captureBeforeGetWork: typeof captureBeforeGetWork;
  reconcileAfterGetWork: typeof reconcileAfterGetWork;
  getBindingResolve: typeof getBindingResolve;
  getRecordSummary: typeof getRecordSummary;
  getRecordDegrade: typeof getRecordDegrade;
  getRecordDegrades: typeof getRecordDegrades;
  getLastResolvedAt: () => number;
  resetForTests: typeof resetForTests;
};

export function useAnnotationBindingResolve(): AnnotationBindingResolveApi {
  installWatchers();
  return {
    entries,
    resolveAll,
    resolveRecord,
    markLoadResult,
    captureBeforeGetWork,
    reconcileAfterGetWork,
    getBindingResolve,
    getRecordSummary,
    getRecordDegrade,
    getRecordDegrades,
    getLastResolvedAt: () => lastResolvedAt,
    resetForTests,
  };
}
