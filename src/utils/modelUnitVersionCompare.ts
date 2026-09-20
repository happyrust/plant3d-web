import type { TreeDiffModel } from '@/composables/useTreeVersionDiff';
import type { ModelVersion } from '@/model-source/ports';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

export type ModelUnitGeometryStatus = 'added' | 'deleted' | 'modified' | 'unchanged'

export type ModelUnitGeometrySnapshot = {
  refno: string
  noun: string
  signature: string
}

export type ModelUnitGeometryDiff = {
  refno: string
  noun: string
  status: ModelUnitGeometryStatus
}

export const MODEL_UNIT_VERSION_COMPARE_EVENT = 'plant3d:model-unit-version-compare';
export const MODEL_UNIT_VERSION_COMPARE_STATE_EVENT = 'plant3d:model-unit-version-compare-state';
/** 「查看这个构件的历史版本」：模型树 / 属性面板发，版本对比面板收 */
export const MODEL_VERSION_INSPECT_EVENT = 'plant3d:model-version-inspect';

/**
 * 待认领的「查看历史版本」请求。
 *
 * 光发事件不够：请求多半是在面板还没开的时候发出来的（右键菜单里点的），`ensurePanelAndActivate`
 * 把面板建起来时事件早就过去了。所以请求同时留一份在这里，面板挂载时自己来取。
 */
let pendingInspectRefno: string | null = null;

export function requestModelVersionInspect(refno: string): void {
  pendingInspectRefno = refno;
  window.dispatchEvent(new CustomEvent(MODEL_VERSION_INSPECT_EVENT, { detail: { refno } }));
}

/** 取走待认领的那一笔（取一次就没了）。 */
export function takePendingModelVersionInspect(): string | null {
  const refno = pendingInspectRefno;
  pendingInspectRefno = null;
  return refno;
}

/**
 * 版本对比的 URL 入口（2026-09-18 Q16，照 `spatial_refno / spatial_radius / spatial_autorun` 的前缀体例）：
 * - `unit_refno`：最小交付单元根参考号（`a_b` / `a/b`），沿用 ADR 0045 起的名字；
 * - `compare_a` / `compare_b`：A / B 的 sesno；缺省最近两版；
 * - `compare_autorun=1`：`DockLayout` 打开版本对比面板，面板自动查版本、选 A/B、跑对比。
 */
export type ModelUnitVersionCompareUrlConfig = {
  unitRefno: string
  compareA: number | null
  compareB: number | null
  autorun: boolean
}

export function readModelUnitVersionCompareUrl(search: string): ModelUnitVersionCompareUrlConfig {
  const params = new URLSearchParams(search);
  const sesno = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  };
  const flag = String(params.get('compare_autorun') ?? '').trim().toLowerCase();
  return {
    unitRefno: params.get('unit_refno')?.trim() ?? '',
    compareA: sesno('compare_a'),
    compareB: sesno('compare_b'),
    autorun: flag === '1' || flag === 'true' || flag === 'yes',
  };
}

/** `DockLayout` 用：URL 要求自动跑版本对比时先把面板打开。 */
export function shouldOpenModelUnitVersionCompareFromUrl(search: string): boolean {
  const config = readModelUnitVersionCompareUrl(search);
  return config.autorun && config.unitRefno.length > 0;
}
export type ModelUnitCompareSide = 'before' | 'after'
export const DEFAULT_MODEL_UNIT_COMPARE_SIDE: ModelUnitCompareSide = 'after';
export type ModelUnitCompareViewMode = 'single' | 'split'
export const DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE: ModelUnitCompareViewMode = 'single';

export type ModelUnitCompareRenderPass = {
  side: ModelUnitCompareSide
  x: number
  y: number
  width: number
  height: number
}

export function getModelUnitCompareRenderPasses(
  viewMode: ModelUnitCompareViewMode,
  activeSide: ModelUnitCompareSide,
  width: number,
  height: number,
): ModelUnitCompareRenderPass[] {
  if (viewMode === 'single') return [{ side: activeSide, x: 0, y: 0, width, height }];
  const leftWidth = Math.floor(width / 2);
  return [
    { side: 'before', x: 0, y: 0, width: leftWidth, height },
    { side: 'after', x: leftWidth, y: 0, width: width - leftWidth, height },
  ];
}

type VersionVisibilityLayer = {
  setAllVisible: (visible: boolean) => void
  setObjectsVisible?: (objectIds: string[], visible: boolean) => void
}

type ObjectVisibilityLayer = {
  setObjectVisible: (objectId: string, visible: boolean) => void
}

/** 「三维只看差异」时两侧各自要藏起来的对象（`unchanged` 那些） */
export type ModelUnitCompareHiddenObjectIds = {
  before: string[]
  after: string[]
}

/**
 * 按当前显示的那一侧开关两个版本层；`hidden` 给了就再把该侧的 `unchanged` 对象藏掉（「三维只看差异」）。
 * 分屏每一帧按 pass 调两次 + 复位一次，所以这里只做 O(n) 的显隐写入，不重建任何东西。
 */
export function applyModelUnitVersionSide(
  beforeLayer: VersionVisibilityLayer | undefined,
  afterLayer: VersionVisibilityLayer | undefined,
  side: ModelUnitCompareSide,
  hidden: ModelUnitCompareHiddenObjectIds | null = null,
): void {
  beforeLayer?.setAllVisible(side === 'before');
  afterLayer?.setAllVisible(side === 'after');
  if (!hidden) return;
  if (side === 'before' && hidden.before.length > 0) beforeLayer?.setObjectsVisible?.(hidden.before, false);
  if (side === 'after' && hidden.after.length > 0) afterLayer?.setObjectsVisible?.(hidden.after, false);
}

/**
 * 三维里按「模型几何差异」着色（CONTEXT「模型版本查看」）：与面板徽章、模型树差异模式同一套色——
 * 新增 emerald / 删除 rose / 修改 amber / 未变 slate。版本身份（A / B）不再靠整侧一色，改由视口角标说明。
 */
export const MODEL_UNIT_GEOMETRY_STATUS_COLORS: Record<ModelUnitGeometryStatus, number> = {
  added: 0x10b981,
  deleted: 0xf43f5e,
  modified: 0xf59e0b,
  unchanged: 0x94a3b8,
};

export const MODEL_UNIT_GEOMETRY_STATUS_LABELS: Record<ModelUnitGeometryStatus, string> = {
  added: '新增',
  deleted: '删除',
  modified: '修改',
  unchanged: '未变',
};

export type ModelUnitGeometryStatusCounts = Record<ModelUnitGeometryStatus, number>

export function countModelUnitGeometryStatuses(rows: readonly ModelUnitGeometryDiff[]): ModelUnitGeometryStatusCounts {
  const counts: ModelUnitGeometryStatusCounts = { added: 0, deleted: 0, modified: 0, unchanged: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function normalizeStatusRefno(refno: string): string {
  return refno.trim().replace(/\//g, '_');
}

/** 隔离图层的对象 id 形如 `unit-compare:a:<refno>:<n>`（`useDbnoInstancesDtxLoader` 的 `objectIdPrefix:refnoKey:counter`）：取倒数第二段。 */
export function refnoFromCompareObjectId(objectId: string): string | null {
  const parts = objectId.split(':');
  if (parts.length < 3) return null;
  const refno = parts[parts.length - 2]?.trim() ?? '';
  return refno ? refno : null;
}

export type ModelUnitCompareObjectStyle = {
  objectId: string
  status: ModelUnitGeometryStatus
}

/**
 * 给一侧图层里的每个对象定「模型几何差异」状态：按对象 id 里的 refno 查 `rows`；查不到的（派生管身归到 owner 之类）
 * 按 `unchanged`——宁可少标，不乱标。返回值只是计划，真正上色 / 显隐由调用方对图层执行。
 */
export function planModelUnitCompareObjectStyles(
  objectIds: readonly string[],
  rows: readonly ModelUnitGeometryDiff[],
): ModelUnitCompareObjectStyle[] {
  const statusByRefno = new Map<string, ModelUnitGeometryStatus>();
  for (const row of rows) statusByRefno.set(normalizeStatusRefno(row.refno), row.status);
  return objectIds.map((objectId) => {
    const refno = refnoFromCompareObjectId(objectId);
    const status = refno ? statusByRefno.get(normalizeStatusRefno(refno)) : undefined;
    return { objectId, status: status ?? 'unchanged' };
  });
}

export function collectModelUnitTargetObjectIds(
  unitRefno: string,
  targetRefnos: string[],
  resolveByRefno: (refno: string) => string[],
  resolveByUnitRefno: (unitRefno: string) => string[],
): string[] {
  const objectIds = new Set(resolveByUnitRefno(unitRefno));
  for (const refno of targetRefnos) {
    for (const objectId of resolveByRefno(refno)) objectIds.add(objectId);
  }
  return [...objectIds];
}

export function applyModelUnitRefnoVisibility(
  layer: ObjectVisibilityLayer,
  visibilityByRefno: Map<string, boolean>,
  resolveByRefno: (refno: string) => string[],
): void {
  for (const [refno, visible] of visibilityByRefno) {
    for (const objectId of resolveByRefno(refno)) layer.setObjectVisible(objectId, visible);
  }
}

/**
 * 对比的一侧：版本身份 + 面板已经通过 `ModelVersionSource.loadVersion` 取到的几何。
 * ViewerPanel 只渲染这里给的 `entries`（`instanceEntriesByRefno`），不再自己回源取数；
 * `entries` 由面板 `markRaw` 后放进事件，避免几千条实例被 Vue 递归代理。
 */
export type ModelUnitVersionSide = {
  version: ModelVersion
  /** 等于 `version.sesno`，模板 / 测试直接读 */
  sesno: number
  refnos: string[]
  entries: Map<string, InstanceEntry[]>
}

export function formatModelUnitVersionTime(generatedAt: string): string {
  const date = new Date(generatedAt);
  return Number.isNaN(date.getTime())
    ? generatedAt
    : date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
}

export type ModelUnitVersionCompareOpenDetail = {
  action: 'open'
  dbnum: number
  unitRefno: string
  before: ModelUnitVersionSide
  after: ModelUnitVersionSide
  refnos: string[]
  rows: ModelUnitGeometryDiff[]
}

export type ModelUnitVersionCompareEnvironment = {
  loadedRefnos: number
  refreshing: boolean
  error?: string
}

export type ModelUnitVersionCompareRuntimeState = {
  detail: ModelUnitVersionCompareOpenDetail
  status: 'loading' | 'ready' | 'error'
  activeSide: ModelUnitCompareSide
  viewMode: ModelUnitCompareViewMode
  /** 「三维只看差异」：隔离图层里藏掉 `unchanged` 的对象；缺省 false（两版整体都在） */
  diffOnly?: boolean
  environment?: ModelUnitVersionCompareEnvironment
  error?: string
}

export type ModelUnitVersionCompareEventDetail =
  | ModelUnitVersionCompareOpenDetail
  | { action: 'focus'; refno: string }
  | { action: 'close' }
  | { action: 'set-side'; side: ModelUnitCompareSide }
  | { action: 'set-view-mode'; viewMode: ModelUnitCompareViewMode }
  | { action: 'set-diff-only'; diffOnly: boolean }
  | { action: 'refresh-environment' }
  | { action: 'request-state' }

type GeometryEntryLike = {
  geo_hash?: unknown
  geo_index?: unknown
  matrix?: unknown
  uniforms?: { noun?: unknown }
}

export function geometrySnapshotsFromInstanceEntries(
  entriesByRefno: Map<string, GeometryEntryLike[]>,
): ModelUnitGeometrySnapshot[] {
  return [...entriesByRefno.entries()].map(([refno, entries]) => {
    const parts = entries.map((entry) => JSON.stringify([
      String(entry.geo_hash ?? ''),
      Number(entry.geo_index ?? 0),
      Array.isArray(entry.matrix) ? entry.matrix.map(Number) : [],
    ])).sort();
    return {
      refno,
      noun: String(entries[0]?.uniforms?.noun ?? ''),
      signature: parts.join('|'),
    };
  }).sort((a, b) => a.refno.localeCompare(b.refno));
}

export type TreeDiffDispatchInput = {
  dbnum: number
  before: ModelVersion
  after: ModelVersion
  rows: ModelUnitGeometryDiff[]
  /** A 侧几何带的直接属主表（被删节点的原父只有 A 侧知道） */
  beforeOwners?: ReadonlyMap<string, string>
  /** B 侧几何带的直接属主表 */
  afterOwners?: ReadonlyMap<string, string>
}

/**
 * 把一次模型几何差异折成模型树差异模式（徽章 / 幽灵节点 / 筛选）要的模型列表（ADR 0065 §1.4 的桥接）。
 * - `unchanged` 行不进树；
 * - `ownerRefno`（幽灵节点回插到原父）：被删的从 A 侧属主表取、其余从 B 侧取，两侧都查不到就不给，树回落挂根；
 * - B 是「已删除单元版本」（tombstone）时把单元根自己也作为一条 deleted 模型给树——否则树里只剩几个成员的幽灵、看不出整个单元没了。
 */
export function buildTreeDiffModels(input: TreeDiffDispatchInput): TreeDiffModel[] {
  const ownerOf = (refno: string, status: ModelUnitGeometryStatus): string | undefined => (
    status === 'deleted'
      ? input.beforeOwners?.get(refno) ?? input.afterOwners?.get(refno)
      : input.afterOwners?.get(refno) ?? input.beforeOwners?.get(refno)
  );
  const models: TreeDiffModel[] = input.rows
    .filter((row) => row.status !== 'unchanged')
    .map((row) => ({
      refno: row.refno,
      category: row.noun,
      status: row.status,
      sourceNouns: row.noun,
      ownerRefno: ownerOf(row.refno, row.status),
    }));
  const unitRefno = input.after.unitRefno;
  if (input.after.impactKind === 'tombstone' && !models.some((model) => model.refno === unitRefno)) {
    models.push({
      refno: unitRefno,
      category: input.after.unitNoun,
      status: 'deleted',
      sourceNouns: input.after.unitNoun,
      ownerRefno: input.beforeOwners?.get(unitRefno),
    });
  }
  return models;
}

export function orderModelUnitVersionPair<T extends Pick<ModelVersion, 'sesno'>>(
  first: T,
  second: T,
): [T, T] {
  return first.sesno <= second.sesno ? [first, second] : [second, first];
}

export function compareModelUnitGeometry(
  before: ModelUnitGeometrySnapshot[],
  after: ModelUnitGeometrySnapshot[],
): ModelUnitGeometryDiff[] {
  const beforeByRefno = new Map(before.map((item) => [item.refno, item]));
  const afterByRefno = new Map(after.map((item) => [item.refno, item]));
  const refnos = new Set([...beforeByRefno.keys(), ...afterByRefno.keys()]);
  const rank: Record<ModelUnitGeometryStatus, number> = {
    added: 0,
    deleted: 1,
    modified: 2,
    unchanged: 3,
  };

  return [...refnos].map((refno): ModelUnitGeometryDiff => {
    const oldItem = beforeByRefno.get(refno);
    const newItem = afterByRefno.get(refno);
    const status: ModelUnitGeometryStatus = !oldItem
      ? 'added'
      : !newItem
        ? 'deleted'
        : oldItem.signature === newItem.signature
          ? 'unchanged'
          : 'modified';
    return { refno, noun: newItem?.noun || oldItem?.noun || '', status };
  }).sort((a, b) => rank[a.status] - rank[b.status] || a.refno.localeCompare(b.refno));
}
