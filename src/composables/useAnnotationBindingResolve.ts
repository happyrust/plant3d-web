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
  type BindingResolveEntry,
  type BindingResolveProbe,
  type BindingResolveSummary,
} from '@/review/domain/bindingResolve';

/**
 * 批注关联的失效解析（ADR-0050）——运行时部分。
 *
 * - 结果只放内存（`entries`），**不写回记录**：渲染只读坐标快照，解析只服务提示与门控；
 *   持久化 `resolveDetailsV1` 留给后续方案（docs/plans/2026-09-14-3d-annotation-interaction-redesign-proposal.md §6.1）。
 * - 触发：① 模型加载 / 版本切换（`dtxLoaderRevision` 变化，120ms 内的连续变化合并）批量重算；② 详情卡打开时按记录重算；
 *   ③ 一次按 refno 的定位 / 加载拿到回执后，把 `fail` 记成权威 missing、`ok` 撤销之前的 missing，再重算。
 * - 探针默认接 DTX 运行时索引（跨库）；测试与其它宿主可注入自己的探针。
 */

const ANNOTATION_TYPES: readonly AnnotationType[] = ['text', 'cloud', 'rect', 'obb'];

type ResolveEntries = ReadonlyMap<string, BindingResolveEntry>;

const entries: ShallowRef<ResolveEntries> = shallowRef(new Map());
/** 按 refno 的定位 / 加载明确失败过的构件（权威 missing 证据）→ 那次回执里的错误文本（没有就 null）。 */
const verifiedMissing = new Map<string, string | null>();
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

function createDefaultProbe(): BindingResolveProbe {
  const { viewerRef } = useViewerContext();
  return {
    isLoaded: (refno) => isDtxRefnoLoadedAcrossAllDbnos(refno),
    isKnown: (refno) => isDtxRefnoKnownAcrossAllDbnos(refno),
    isVerifiedMissing: (refno) => verifiedMissing.has(normalizeRefno(refno)),
    missingReason: (refno) => verifiedMissing.get(normalizeRefno(refno)),
    anchorDrift: (refno, worldPos) => {
      const scene = viewerRef.value?.scene as { getAABB?: (ids: string[]) => ArrayLike<number> | null } | undefined;
      if (!scene?.getAABB) return null;
      let aabb: ArrayLike<number> | null = null;
      try {
        aabb = scene.getAABB([refno]) ?? null;
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
    if (refno && verifiedMissing.delete(refno)) changed = true;
  }
  for (const raw of result.fail ?? []) {
    const refno = normalizeRefno(typeof raw === 'string' ? raw : raw?.refno);
    if (!refno) continue;
    const error = typeof raw === 'string' ? null : (raw.error?.trim() || null);
    if (!verifiedMissing.has(refno) || verifiedMissing.get(refno) !== error) {
      verifiedMissing.set(refno, error);
      changed = true;
    }
  }
  if (changed || (result.ok?.length ?? 0) > 0) resolveAll();
}

function getBindingResolve(
  type: AnnotationType,
  annotationId: string,
  role: CloudBindingRole,
  refno: string,
): BindingResolveEntry | undefined {
  return entries.value.get(buildBindingResolveKey(type, annotationId, role, refno));
}

function getRecordSummary(type: AnnotationType, annotationId: string): BindingResolveSummary {
  const prefix = `${type}:${annotationId}:`;
  const collected: BindingResolveEntry[] = [];
  for (const [key, entry] of entries.value) {
    if (key.startsWith(prefix)) collected.push(entry);
  }
  return summarizeBindingResolve(collected);
}

/** 合并一小段时间内的多次修订号变化，只重算一次。 */
function scheduleResolveAll(): void {
  if (pendingResolveAll !== null) clearTimeout(pendingResolveAll);
  pendingResolveAll = setTimeout(() => {
    pendingResolveAll = null;
    resolveAll();
  }, RESOLVE_ALL_DEBOUNCE_MS);
}

function installModelLoadWatcher(): void {
  if (watcherInstalled) return;
  watcherInstalled = true;
  // 模型加载 / 版本切换 → 运行时索引修订 +1 → 批量重算（ADR-0050 的触发点）。
  // 大模型分批装载会连续 bump，这里合并成一次。
  watch(dtxLoaderRevision, () => {
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
  lastResolvedAt = 0;
}

export type AnnotationBindingResolveApi = {
  /** 解析结果整表（shallowRef，整表替换触发更新）；在 computed 里经 getBindingResolve 读它即可响应 */
  entries: ShallowRef<ResolveEntries>;
  resolveAll: typeof resolveAll;
  resolveRecord: typeof resolveRecord;
  markLoadResult: typeof markLoadResult;
  getBindingResolve: typeof getBindingResolve;
  getRecordSummary: typeof getRecordSummary;
  getLastResolvedAt: () => number;
  resetForTests: typeof resetForTests;
};

export function useAnnotationBindingResolve(): AnnotationBindingResolveApi {
  installModelLoadWatcher();
  return {
    entries,
    resolveAll,
    resolveRecord,
    markLoadResult,
    getBindingResolve,
    getRecordSummary,
    getLastResolvedAt: () => lastResolvedAt,
    resetForTests,
  };
}
