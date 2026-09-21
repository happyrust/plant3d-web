import type { TreeDiffModel } from '@/composables/useTreeVersionDiff';
import type { ModelVersion, ModelVersionAttributes } from '@/model-source/ports';
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

/** 指针落在哪个 pass 里 + 在这一格内的 NDC（分屏拾取按那一格的视口与宽高比造射线） */
export type ModelUnitComparePassHit = {
  pass: ModelUnitCompareRenderPass
  ndcX: number
  ndcY: number
}

/**
 * 分屏拾取：画布坐标（左上原点）落在哪个 pass 里，以及在这一格内的 NDC。pass 的 `x / y` 是 WebGL 视口坐标（左下原点），
 * 所以指针 y 先翻成从底往上量；正压在分界线上的点归右格（`x >= pass.x`）；落在所有格之外回 null。
 * 单视口只有一格、覆盖整幅，走这里等价于整幅 NDC。
 */
export function locateModelUnitComparePass(
  passes: readonly ModelUnitCompareRenderPass[],
  x: number,
  y: number,
  canvasHeight: number,
): ModelUnitComparePassHit | null {
  for (let i = passes.length - 1; i >= 0; i -= 1) {
    const pass = passes[i]!;
    if (pass.width <= 0 || pass.height <= 0) continue;
    if (x < pass.x || x >= pass.x + pass.width) continue;
    // 这一格在左上原点坐标里占 [top, bottom)：顶边算在内、底边（= 下一格或画布外）不算
    const top = canvasHeight - (pass.y + pass.height);
    const bottom = canvasHeight - pass.y;
    if (y < top || y >= bottom) continue;
    return {
      pass,
      ndcX: ((x - pass.x) / pass.width) * 2 - 1,
      ndcY: ((canvasHeight - y - pass.y) / pass.height) * 2 - 1,
    };
  }
  return null;
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

/** 环境（主图层）里要藏掉的对象：按单元根整单元藏（多单元一次装载时每个单元根都藏）+ 两侧几何列到的每个 refno */
export function collectModelUnitTargetObjectIds(
  unitRefno: string | readonly string[],
  targetRefnos: string[],
  resolveByRefno: (refno: string) => string[],
  resolveByUnitRefno: (unitRefno: string) => string[],
): string[] {
  const objectIds = new Set<string>();
  for (const root of typeof unitRefno === 'string' ? [unitRefno] : unitRefno) {
    for (const objectId of resolveByUnitRefno(root)) objectIds.add(objectId);
  }
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

/**
 * 「哪一侧、哪个 refno」→ 那个模型版本下的属性。面板闭包住本次持有的两份版本几何（句柄在里面），
 * ViewerPanel 在三维里点到 A / B 隔离图层的构件时用它把属性面板钉到那一版（不查当前会话）。
 */
export type ModelUnitCompareAttributesAt = (
  side: ModelUnitCompareSide,
  refno: string,
  signal?: AbortSignal,
) => Promise<ModelVersionAttributes>

/**
 * 多单元一次装载（容器「所有子节点」差异摘要里变了的单元一起进三维，设计稿 S2 那一颗总按钮，收口计划 P2-a）里的一个单元：
 * 两侧各自的版本身份与几何，`rows` 是它自己的几何差异行（`ModelUnitVersionCompareOpenDetail.rows` 的对应子集）。
 */
export type ModelUnitVersionCompareUnit = {
  unitRefno: string
  unitNoun: string
  before: ModelUnitVersionSide
  after: ModelUnitVersionSide
  rows: ModelUnitGeometryDiff[]
}

export type ModelUnitVersionCompareOpenDetail = {
  action: 'open'
  dbnum: number
  /** 单单元：就是那个单元根；多单元（`units`）：查的那个容器节点 */
  unitRefno: string
  /**
   * 单单元：那个单元的两侧。多单元：各单元两侧**并起来**的一侧（`mergeModelUnitVersionSides`）——ViewerPanel 只认一张 `entries` 表 /
   * 一份 `refnos`，`version.impactKind` 只在每个单元这一侧都不存在时才是 `tombstone`（单个单元不存在的注脚看 `units[].before/after`）。
   */
  before: ModelUnitVersionSide
  after: ModelUnitVersionSide
  refnos: string[]
  /** 单单元：它的几何差异行；多单元：全部单元的行拼起来（refno 不会跨单元重复，按 refno 查四态照旧） */
  rows: ModelUnitGeometryDiff[]
  /** 缺省没有（旧派发方 / 测试夹具）：那就点不出版本属性，三维里点 A / B 构件只按 refno 普通选中 */
  attributesAt?: ModelUnitCompareAttributesAt
  /** 就位后的初始视图模式；缺省单视口。面板换单元 / 换版本重开时把上一轮的带过来（容器逐组看不用每组再点一次分屏） */
  viewMode?: ModelUnitCompareViewMode
  /** 多单元一次装载时才有：各单元各自的两侧与差异行；没有 = 单单元（`unitRefno` / `before` / `after` 就是它） */
  units?: ModelUnitVersionCompareUnit[]
}

/** `open` detail 里装了哪几个单元根（单单元就是 `unitRefno` 自己）：环境里要藏的、A / B 卡上要列的都按它 */
export function modelUnitCompareUnitRefnos(detail: Pick<ModelUnitVersionCompareOpenDetail, 'unitRefno' | 'units'>): string[] {
  return detail.units?.length ? detail.units.map((unit) => unit.unitRefno) : [detail.unitRefno];
}

/**
 * 多单元一次装载：把各单元的某一侧并成 ViewerPanel 要的一侧——`entries` 合成一张表（构件只属于一个单元，键不会撞）、`refnos` 拼起来，
 * `version` 借 `identity`（容器）的身份 + 第一个单元那一侧的 sesno / sessionTime；`impactKind` 只在每个单元这一侧都是 `tombstone` 时才是
 * `tombstone`（那一侧整个空、视口出空态），否则 `mesh`。
 */
export function mergeModelUnitVersionSides(
  units: readonly ModelUnitVersionCompareUnit[],
  side: ModelUnitCompareSide,
  identity: Pick<ModelVersion, 'dbnum' | 'unitRefno' | 'unitNoun'>,
): ModelUnitVersionSide {
  const sides = units.map((unit) => unit[side]);
  const first = sides[0];
  const entries = new Map<string, InstanceEntry[]>();
  const refnos: string[] = [];
  for (const item of sides) {
    for (const [refno, list] of item.entries) entries.set(refno, list);
    refnos.push(...item.refnos);
  }
  const allAbsent = sides.length > 0 && sides.every((item) => item.version.impactKind === 'tombstone');
  return {
    version: {
      ...identity,
      sesno: first?.sesno ?? 0,
      sessionTime: first?.version.sessionTime ?? null,
      impactKind: allAbsent ? 'tombstone' : 'mesh',
    },
    sesno: first?.sesno ?? 0,
    refnos,
    entries,
  };
}

/** 多单元一次装载的缺省上限（收口计划 D3）：超过走确认框（P2-b），「先装变化最大的 N 个」也按它 */
export const MODEL_UNIT_COMPARE_MAX_UNITS = 20;

/** 「先装变化最大的 N 个」（设计稿 S2b ②）：按组内 added + deleted + modified 从大到小取前 N（noop 不算变化），同分保持摘要顺序 */
export function pickMostChangedGroups<T extends { counts: { added: number; deleted: number; modified: number } }>(
  groups: readonly T[],
  limit: number,
): T[] {
  const changes = (group: T): number => group.counts.added + group.counts.deleted + group.counts.modified;
  return groups
    .map((group, index) => ({ group, index }))
    .sort((x, y) => changes(y.group) - changes(x.group) || x.index - y.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.group);
}

/**
 * 多单元一次装载要去 `history/generate` 的份数（进度卡「n / m 份」的 m、总按钮上的「约 m 份历史投影」）：每单元 A / B 各一份，
 * `tombstone` 的那一侧不算（适配器回空集，不去服务端）。
 */
export function countGroupProjections(groups: readonly Parameters<typeof modelUnitGroupSideImpactKinds>[0][]): number {
  return groups.reduce((sum, group) => {
    const kinds = modelUnitGroupSideImpactKinds(group);
    return sum + (kinds.before === 'tombstone' ? 0 : 1) + (kinds.after === 'tombstone' ? 0 : 1);
  }, 0);
}

/** 视口里点到的隔离图层对象：`unit-compare:a:<refno>:<n>` → A 侧、`unit-compare:b:…` → B 侧；别的对象 id 回 null */
export function sideFromCompareObjectId(objectId: string): ModelUnitCompareSide | null {
  if (objectId.startsWith('unit-compare:a:')) return 'before';
  if (objectId.startsWith('unit-compare:b:')) return 'after';
  return null;
}

/**
 * 那一侧是 `tombstone`（该版本下整个单元不存在）时角标 / A-B 卡上的注脚。B 侧只可能是「已删除」；A 侧多半是「还没建」
 * （容器分组入口里 A 早于单元创建），也可能删过又建回——说中性的。
 */
export function modelUnitVersionAbsentNote(side: ModelUnitCompareSide): string {
  return side === 'after' ? '该版本单元已删除' : '该版本没有这个单元';
}

/**
 * 容器「所有子节点」的差异摘要里某一组（某个最小交付单元）的 A / B 两侧该按哪种 `impactKind` 装：A / B 是节点子树的会话，
 * 单元不一定两版都在——单元根那一行 `deleted` = B 时已删、`added` = A 时还没建，那一侧标 `tombstone`（适配器回空集、
 * 视口显示空态）；否则去 `history/generate` 一个它不存在的会话会 404 `REFNO_NOT_FOUND_AT_SESSION`。单元根那行没列出来（截断）就按两侧都在。
 */
export function modelUnitGroupSideImpactKinds(group: {
  unitRefno: string | null
  rows: readonly { refno: string; status: 'added' | 'deleted' | 'modified' | 'noop' | (string & {}) }[]
}): { before: ModelVersion['impactKind']; after: ModelVersion['impactKind'] } {
  const root = group.unitRefno ? group.rows.find((row) => row.refno === group.unitRefno) : undefined;
  return {
    before: root?.status === 'added' ? 'tombstone' : 'mesh',
    after: root?.status === 'deleted' ? 'tombstone' : 'mesh',
  };
}

export type ModelUnitVersionCompareEnvironment = {
  loadedRefnos: number
  refreshing: boolean
  error?: string
}

/**
 * 分屏每格走不走描边合成器（收口计划 P3-c，D6「留，但软渲染自动退回」）：真显卡走合成器（选中的环境构件两格都描边、色彩空间与单视口一致）；
 * 认出 SwiftShader / llvmpipe 一类软渲染就退回直接 `renderer.render`（合成器每格 +0.8–1.1 ms 固定开销，软渲染下分屏只剩 11 fps，README §8.3）。
 */
export type ModelUnitCompareSplitOutline = {
  compositor: boolean
  /** `WEBGL_debug_renderer_info` 读到的显卡 / 驱动串；读不到为 null（那就按真显卡处理） */
  renderer: string | null
}

export type ModelUnitVersionCompareRuntimeState = {
  detail: ModelUnitVersionCompareOpenDetail
  status: 'loading' | 'ready' | 'error'
  activeSide: ModelUnitCompareSide
  viewMode: ModelUnitCompareViewMode
  /** 「三维只看差异」：隔离图层里藏掉 `unchanged` 的对象；缺省 false（两版整体都在） */
  diffOnly?: boolean
  environment?: ModelUnitVersionCompareEnvironment
  /** 就位后才有：分屏走合成器还是直接 render，面板在分屏摘要下照实说 */
  splitOutline?: ModelUnitCompareSplitOutline
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
