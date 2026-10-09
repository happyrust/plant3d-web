import { isReviewModelContext, type ReviewModelContext } from './reviewModelContext';

import type { TreeDiffContext } from '@/composables/useTreeVersionDiff';
import type { ModelVersion, ModelVersionGeometry, ModelVersionSource } from '@/model-source/ports';

import {
  buildTreeDiffModels,
  compareModelUnitGeometry,
  geometrySnapshotsFromInstanceEntries,
  mergeModelUnitVersionSides,
  type ModelUnitVersionCompareOpenDetail,
  type ModelUnitVersionCompareUnit,
} from '@/utils/modelUnitVersionCompare';

export type LoadedReviewModelComparison = {
  detail: ModelUnitVersionCompareOpenDetail;
  treeContext: TreeDiffContext;
  release: () => Promise<void>;
};

type SessionTimeSource = Partial<Pick<ModelVersionSource, 'listElementVersions' | 'listNodeVersions' | 'attributeHistory'>>;

/**
 * 单据只存了 sesno，三维角标要显示会话时间：按保存时那个节点（单元根 / 容器）的版本表查，依次构件版本表、子树版本表、
 * 属性变化时间线，找齐就停。不用单元自己的 `listVersions`——容器级会话不一定在单元链上。查不到不挡恢复，角标照旧「时间未知」。
 */
async function lookupSessionTimes(source: SessionTimeSource, dbnum: number, refno: string, sesnos: number[]): Promise<Map<number, string>> {
  const times = new Map<number, string>();
  const tables: (() => Promise<{ sesno: number; sessionTime: string | null }[]> | undefined)[] = [
    () => source.listElementVersions?.(dbnum, refno).then(timeline => timeline.versions),
    () => source.listNodeVersions?.(dbnum, refno, 'subtree').then(timeline => timeline.versions),
    () => source.attributeHistory?.(dbnum, refno).then(history => history.entries),
  ];
  for (const table of tables) {
    if (sesnos.every(sesno => times.has(sesno))) break;
    try {
      for (const row of await table() ?? []) if (row.sessionTime && !times.has(row.sesno)) times.set(row.sesno, row.sessionTime);
    } catch (error) {
      console.warn('[review model restore] session time lookup failed', error);
    }
  }
  return times;
}

/** 每次按保存的精确会话重新生成投影；不会采用版本列表的最近一版或旧快照句柄。 */
export async function loadReviewModelComparison(
  context: ReviewModelContext,
  source: Pick<ModelVersionSource, 'attributeDiff' | 'loadVersion' | 'attributesAt'> & SessionTimeSource,
  shouldApply: () => boolean,
): Promise<LoadedReviewModelComparison> {
  if (!isReviewModelContext(context) || !context.comparison) throw new Error('缺少有效的历史版本对比上下文');
  const comparison = context.comparison;
  const normalize = (refno: string) => refno.replace(/\//g, '_');
  const pairs = comparison.units.length ? comparison.units : [{ refno: comparison.refno, a: comparison.a, b: comparison.b }];
  if (pairs[0]!.a !== comparison.a || pairs[0]!.b !== comparison.b)
    throw new Error('保存的容器会话与首个单元会话不一致');
  const sessionTimes = lookupSessionTimes(source, comparison.dbnum, normalize(comparison.refno),
    [...new Set(pairs.flatMap(pair => [pair.a, pair.b]))]);
  const held = new Set<ModelVersionGeometry>();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    const results = await Promise.allSettled([...held].map(geometry => geometry.release()));
    for (const result of results) if (result.status === 'rejected') console.warn('[review model restore] snapshot release failed', result.reason);
  };
  const check = () => { if (!shouldApply()) throw new Error('历史模型恢复已取消'); };
  const loaded: { unit: ModelUnitVersionCompareUnit; before: ModelVersionGeometry; after: ModelVersionGeometry }[] = [];
  try {
    for (const pair of pairs) {
      check();
      const refno = normalize(pair.refno);
      // 精确属性净差在服务端校验会话链序和两端存在性；两端都不存在会报 REFNO_NOT_FOUND。
      const identity = await source.attributeDiff(comparison.dbnum, refno, pair.a, pair.b);
      check();
      if (identity.dbnum !== comparison.dbnum || normalize(identity.refno) !== refno
        || identity.a !== pair.a || identity.b !== pair.b || !identity.unitRefno || normalize(identity.unitRefno) !== refno)
        throw new Error(`历史查询未返回单元 ${refno} 的精确 A/B 身份`);
      const version = (sesno: number, absent: boolean): ModelVersion => ({
        dbnum: comparison.dbnum, unitRefno: refno, unitNoun: identity.unitNoun ?? identity.noun,
        sesno, sessionTime: null, impactKind: absent ? 'tombstone' : 'mesh',
      });
      const beforeVersion = version(pair.a, identity.kind === 'created');
      const afterVersion = version(pair.b, identity.kind === 'deleted');
      // 每个单元两份并发；等待两份都落地后再处理失败，以便释放成功的那一份。
      const results = await Promise.allSettled([beforeVersion, afterVersion].map(async item => {
        const geometry = await source.loadVersion(item);
        held.add(geometry);
        return geometry;
      }));
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      check();
      const before = (results[0] as PromiseFulfilledResult<ModelVersionGeometry>).value;
      const after = (results[1] as PromiseFulfilledResult<ModelVersionGeometry>).value;
      for (const [item, geometry] of [[beforeVersion, before], [afterVersion, after]] as const) {
        if (item.impactKind === 'tombstone' && (geometry.refnos.length || geometry.entries.size))
          throw new Error(`历史查询为不存在的单元 ${refno}@${item.sesno} 返回了几何`);
      }
      const rows = compareModelUnitGeometry(geometrySnapshotsFromInstanceEntries(before.entries), geometrySnapshotsFromInstanceEntries(after.entries));
      loaded.push({ before, after, unit: {
        unitRefno: refno, unitNoun: beforeVersion.unitNoun,
        before: { version: beforeVersion, sesno: pair.a, refnos: before.refnos, entries: before.entries },
        after: { version: afterVersion, sesno: pair.b, refnos: after.refnos, entries: after.entries }, rows,
      } });
    }
    check();
    const times = await sessionTimes;
    check();
    for (const { unit } of loaded) for (const side of [unit.before, unit.after])
      side.version = { ...side.version, sessionTime: times.get(side.sesno) ?? null };
    const units = loaded.map(item => item.unit);
    const attributesAt: NonNullable<ModelUnitVersionCompareOpenDetail['attributesAt']> = async (side, rawRefno, signal) => {
      if (released) throw new Error('历史模型已关闭，请重新打开版本');
      const refno = normalize(rawRefno);
      const matches = loaded.filter(item => item.unit.unitRefno === refno || item[side].refnos.includes(refno) || item[side].ownerByRefno?.has(refno));
      if (matches.length !== 1) throw new Error(`无法唯一确定 ${refno} 的历史单元`);
      return source.attributesAt(matches[0]![side], refno, { signal });
    };
    const identity = { dbnum: comparison.dbnum, unitRefno: normalize(comparison.refno), unitNoun: '' };
    const rows = units.flatMap(unit => unit.rows);
    const single = comparison.units.length === 0 ? units[0]! : null;
    const detail: ModelUnitVersionCompareOpenDetail = {
      action: 'open', dbnum: comparison.dbnum, unitRefno: normalize(comparison.refno),
      before: single ? single.before : mergeModelUnitVersionSides(units, 'before', identity),
      after: single ? single.after : mergeModelUnitVersionSides(units, 'after', identity),
      rows, refnos: rows.map(row => row.refno), attributesAt,
      ...(single ? {} : { units }), viewMode: comparison.viewMode,
    };
    const models = loaded.flatMap(item => buildTreeDiffModels({ dbnum: comparison.dbnum,
      before: item.unit.before.version, after: item.unit.after.version, rows: item.unit.rows,
      beforeOwners: item.before.ownerByRefno, afterOwners: item.after.ownerByRefno }));
    return { detail, treeContext: { project: context.project, dbnum: comparison.dbnum,
      fromSesno: comparison.a, toSesno: comparison.b, mode: 'compare',
      models, refnos: models.map(model => model.refno), attributesAt }, release };
  } catch (error) {
    await release();
    throw error;
  }
}
