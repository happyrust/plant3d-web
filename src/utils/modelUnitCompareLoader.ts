import type { TreeDiffContext } from '@/composables/useTreeVersionDiff';
import type { ModelVersion, ModelVersionGeometry } from '@/model-source/ports';
import type { InstanceEntry } from '@/utils/instances/instanceManifest';

import {
  buildTreeDiffModels,
  compareModelUnitGeometry,
  geometrySnapshotsFromInstanceEntries,
  mergeModelUnitVersionSides,
  type ModelUnitCompareAttributesAt,
  type ModelUnitCompareSide,
  type ModelUnitCompareViewMode,
  type ModelUnitGeometrySnapshot,
  type ModelUnitVersionCompareOpenDetail,
  type ModelUnitVersionCompareUnit,
  type ModelUnitVersionSide,
} from '@/utils/modelUnitVersionCompare';

/**
 * 「取两侧几何 → 比几何 → 拼三维 `open` / 模型树差异上下文」的唯一实现：节点版本面板（`runCompareUnits`）与
 * 校审单恢复历史对比（`loadReviewModelComparison`）共用。两边不同的只有怎么得到 A / B 的 `ModelVersion`（面板按时间线 / 差异摘要，
 * 校审按 `attributeDiff` 校过的身份）和属性归属的严格程度，都留在调用方或参数里。
 */

/** 一对要比的版本：某个最小交付单元在 A / B 两个会话下的 `ModelVersion`（tombstone 那一侧适配器回空集、不去服务端） */
export type ModelUnitComparePair = {
  unitRefno: string
  unitNoun: string
  before: ModelVersion
  after: ModelVersion
}

/** 装好的一对：两侧几何（同 geometryKey 时两侧是同一份） */
export type LoadedModelUnitComparePair = {
  pair: ModelUnitComparePair
  geometries: Record<ModelUnitCompareSide, ModelVersionGeometry>
}

/** 进度卡「正在生成历史投影 n / m」：份 = 一次 `loadVersion`（tombstone 侧不算、同 geometryKey 的两侧算一份），`current` 是正在装的那几份 */
export type ModelUnitCompareProgress = {
  done: number
  total: number
  current: string[]
}

export type ModelUnitCompareLoad = {
  pairs: LoadedModelUnitComparePair[]
  /** 本次取到的全部几何，去重、按落地顺序 */
  geometries: ModelVersionGeometry[]
  /** 全部还给来源；幂等，单份失败只记日志 */
  release: () => Promise<void>
}

export class ModelUnitCompareCancelledError extends Error {
  constructor() {
    super('版本对比装载已取消');
    this.name = 'ModelUnitCompareCancelledError';
  }
}

/** 两个版本几何相同的承诺（`ModelVersion.geometryKey` 相等）；键缺失时不承诺 */
export function sameModelUnitGeometryKey(a: ModelVersion | null, b: ModelVersion | null): boolean {
  return !!a && !!b && a.geometryKey !== undefined && a.geometryKey === b.geometryKey;
}

function releaserOf(geometries: readonly ModelVersionGeometry[]): () => Promise<void> {
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const results = await Promise.allSettled([...new Set(geometries)].map(async (geometry) => geometry.release()));
    for (const result of results) {
      if (result.status === 'rejected') console.warn('[modelUnitCompareLoader] release version geometry failed', result.reason);
    }
  };
}

/**
 * 按份取几何：工位并发（缺省 2）顺序领活。一份失败、或 `shouldApply()` 变假（被更新的请求作废 / 被取消），就不再开新份；
 * 正在飞的那份等它落地，再把本次取到的全部还回去，然后抛那份的错 / `ModelUnitCompareCancelledError`。成功返回之后由调用方负责释放。
 */
export async function loadModelUnitComparePairs(
  pairs: readonly ModelUnitComparePair[],
  options: {
    loadVersion: (version: ModelVersion) => Promise<ModelVersionGeometry>
    shouldApply?: () => boolean
    onProgress?: (progress: ModelUnitCompareProgress) => void
    concurrency?: number
  },
): Promise<ModelUnitCompareLoad> {
  const shouldApply = options.shouldApply ?? (() => true);
  const taken: ModelVersionGeometry[] = [];
  const slots = pairs.map((): Partial<Record<ModelUnitCompareSide, ModelVersionGeometry>> => ({}));
  type Task = { label: string; counts: boolean; run: () => Promise<void> };
  const tasks: Task[] = [];
  pairs.forEach((pair, index) => {
    const slot = slots[index]!;
    const task = (version: ModelVersion, sides: ModelUnitCompareSide[], counts: boolean): Task => ({
      label: `${pair.unitNoun || '单元'} ${pair.unitRefno}@${version.sesno}`,
      counts,
      run: async () => {
        const geometry = await options.loadVersion(version);
        taken.push(geometry);
        for (const side of sides) slot[side] = geometry;
      },
    });
    if (sameModelUnitGeometryKey(pair.before, pair.after)) {
      tasks.push(task(pair.after, ['before', 'after'], true));
    } else {
      tasks.push(task(pair.before, ['before'], pair.before.impactKind !== 'tombstone'));
      tasks.push(task(pair.after, ['after'], pair.after.impactKind !== 'tombstone'));
    }
  });
  const total = tasks.filter((task) => task.counts).length;
  let progress: ModelUnitCompareProgress = { done: 0, total, current: [] };
  options.onProgress?.(progress);
  const queue = tasks.slice();
  const failure: { current: { cause: unknown } | null } = { current: null };
  const worker = async (): Promise<void> => {
    for (let task = queue.shift(); task && !failure.current && shouldApply(); task = queue.shift()) {
      if (task.counts) {
        progress = { ...progress, current: [...progress.current, task.label] };
        options.onProgress?.(progress);
      }
      try {
        await task.run();
      } catch (cause) {
        failure.current ??= { cause };
        return;
      }
      if (task.counts && shouldApply()) {
        progress = { done: progress.done + 1, total, current: progress.current.filter((item) => item !== task.label) };
        options.onProgress?.(progress);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 2, tasks.length) }, () => worker()));
  const release = releaserOf(taken);
  if (failure.current) {
    void release();
    throw failure.current.cause;
  }
  if (!shouldApply()) {
    void release();
    throw new ModelUnitCompareCancelledError();
  }
  return {
    pairs: pairs.map((pair, index) => ({ pair, geometries: { before: slots[index]!.before!, after: slots[index]!.after! } })),
    geometries: [...new Set(taken)],
    release,
  };
}

/**
 * 「哪一侧、哪个 refno」该去哪份几何里取属性。
 * - `lenient`（面板）：多单元时按那一侧的 `refnos` 找，找不到（单元根自己 / 幽灵）退到第一份；
 * - `strict`（校审恢复）：按单元根、那一侧的 `refnos` 与属主表找，必须恰好一份，否则报错——不猜归属。
 */
export function pickModelUnitCompareGeometry(
  loaded: readonly LoadedModelUnitComparePair[],
  side: ModelUnitCompareSide,
  refno: string,
  mode: 'lenient' | 'strict',
): ModelVersionGeometry {
  if (mode === 'strict') {
    const matches = loaded.filter(({ pair, geometries }) => pair.unitRefno === refno
      || geometries[side].refnos.includes(refno) || geometries[side].ownerByRefno?.has(refno));
    if (matches.length !== 1) throw new Error(`无法唯一确定 ${refno} 的历史单元`);
    return matches[0]!.geometries[side];
  }
  const hit = loaded.length > 1 ? loaded.find(({ geometries }) => geometries[side].refnos.includes(refno)) : undefined;
  return (hit ?? loaded[0]!).geometries[side];
}

/**
 * 装好的几对 → 三维 `open` 的 detail 与模型树差异模式的上下文（ADR 0065 §1.4 / ADR 0066 三维联动）。
 * 单单元：detail 两侧就是那个单元的、不带 `units`；多单元：两侧按 `mergeModelUnitVersionSides` 并起来、`unitRefno` 是容器、`units` 各一份。
 * 每个单元各比一份几何差异、各折一份树模型拼起来（B 侧 tombstone 的单元根也进树，见 `buildTreeDiffModels`）。
 */
export function buildModelUnitCompareView(
  loaded: readonly LoadedModelUnitComparePair[],
  options: {
    dbnum: number
    /** 多单元时并起来那一侧借的身份：查的那个容器 */
    container: { unitRefno: string; unitNoun: string }
    attributesAt: ModelUnitCompareAttributesAt
    viewMode?: ModelUnitCompareViewMode
    /** 只有一个单元也按多单元出 detail（校审单保存时就是多单元的那种） */
    asUnits?: boolean
    /** 实例表交给三维之前的包装：面板传 `markRaw`，几千条实例不进 Vue 代理 */
    rawEntries?: (entries: Map<string, InstanceEntry[]>) => Map<string, InstanceEntry[]>
    project?: string
  },
): { units: ModelUnitVersionCompareUnit[]; detail: ModelUnitVersionCompareOpenDetail; treeContext: TreeDiffContext } {
  const raw = options.rawEntries ?? ((entries: Map<string, InstanceEntry[]>) => entries);
  const snapshots = new Map<ModelVersionGeometry, ModelUnitGeometrySnapshot[]>();
  const snapshotsOf = (geometry: ModelVersionGeometry): ModelUnitGeometrySnapshot[] => {
    let list = snapshots.get(geometry);
    if (!list) snapshots.set(geometry, list = geometrySnapshotsFromInstanceEntries(geometry.entries));
    return list;
  };
  const sideOf = (version: ModelVersion, geometry: ModelVersionGeometry): ModelUnitVersionSide => ({
    version, sesno: version.sesno, refnos: geometry.refnos, entries: raw(geometry.entries),
  });
  const units = loaded.map(({ pair, geometries }): ModelUnitVersionCompareUnit => ({
    unitRefno: pair.unitRefno,
    unitNoun: pair.unitNoun,
    before: sideOf(pair.before, geometries.before),
    after: sideOf(pair.after, geometries.after),
    rows: compareModelUnitGeometry(snapshotsOf(geometries.before), snapshotsOf(geometries.after)),
  }));
  const rows = units.flatMap((unit) => unit.rows);
  const single = units.length === 1 && !options.asUnits ? units[0]! : null;
  const identity = { dbnum: options.dbnum, ...options.container };
  const detail: ModelUnitVersionCompareOpenDetail = {
    action: 'open',
    dbnum: options.dbnum,
    unitRefno: single ? single.unitRefno : options.container.unitRefno,
    before: single ? single.before : mergeModelUnitVersionSides(units, 'before', identity),
    after: single ? single.after : mergeModelUnitVersionSides(units, 'after', identity),
    refnos: rows.map((row) => row.refno),
    rows,
    attributesAt: options.attributesAt,
    ...(options.viewMode ? { viewMode: options.viewMode } : {}),
    ...(single ? {} : { units }),
  };
  const models = units.flatMap((unit, index) => buildTreeDiffModels({
    dbnum: options.dbnum,
    before: unit.before.version,
    after: unit.after.version,
    rows: unit.rows,
    beforeOwners: loaded[index]!.geometries.before.ownerByRefno,
    afterOwners: loaded[index]!.geometries.after.ownerByRefno,
  }));
  return {
    units,
    detail,
    treeContext: {
      ...(options.project ? { project: options.project } : {}),
      dbnum: options.dbnum,
      fromSesno: units[0]?.before.sesno,
      toSesno: units[0]?.after.sesno,
      mode: 'compare',
      refnos: models.map((model) => model.refno),
      models,
      attributesAt: options.attributesAt,
    },
  };
}
