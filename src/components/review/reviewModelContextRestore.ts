import { isReviewModelContext, type ReviewModelContext } from './reviewModelContext';

import type { TreeDiffContext } from '@/composables/useTreeVersionDiff';
import type { ModelVersion, ModelVersionSource } from '@/model-source/ports';
import type { ModelUnitCompareAttributesAt, ModelUnitVersionCompareOpenDetail } from '@/utils/modelUnitVersionCompare';

import {
  buildModelUnitCompareView,
  loadModelUnitComparePairs,
  ModelUnitCompareCancelledError,
  pickModelUnitCompareGeometry,
  type ModelUnitComparePair,
} from '@/utils/modelUnitCompareLoader';

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
  const check = () => { if (!shouldApply()) throw new Error('历史模型恢复已取消'); };
  const resolved: ModelUnitComparePair[] = [];
  for (const pair of pairs) {
    check();
    const refno = normalize(pair.refno);
    // 精确属性净差在服务端校验会话链序和两端存在性；两端都不存在会报 REFNO_NOT_FOUND。
    const identity = await source.attributeDiff(comparison.dbnum, refno, pair.a, pair.b);
    check();
    if (identity.dbnum !== comparison.dbnum || normalize(identity.refno) !== refno
      || identity.a !== pair.a || identity.b !== pair.b || !identity.unitRefno || normalize(identity.unitRefno) !== refno)
      throw new Error(`历史查询未返回单元 ${refno} 的精确 A/B 身份`);
    const unitNoun = identity.unitNoun ?? identity.noun;
    const version = (sesno: number, absent: boolean): ModelVersion => ({
      dbnum: comparison.dbnum, unitRefno: refno, unitNoun, sesno, sessionTime: null, impactKind: absent ? 'tombstone' : 'mesh',
    });
    resolved.push({ unitRefno: refno, unitNoun,
      before: version(pair.a, identity.kind === 'created'), after: version(pair.b, identity.kind === 'deleted') });
  }
  const load = await loadModelUnitComparePairs(resolved, { loadVersion: version => source.loadVersion(version), shouldApply })
    .catch((error: unknown) => { throw error instanceof ModelUnitCompareCancelledError ? new Error('历史模型恢复已取消') : error; });
  let released = false;
  const release = async () => {
    released = true;
    await load.release();
  };
  try {
    check();
    for (const { pair, geometries } of load.pairs) {
      for (const side of ['before', 'after'] as const) {
        if (pair[side].impactKind === 'tombstone' && (geometries[side].refnos.length || geometries[side].entries.size))
          throw new Error(`历史查询为不存在的单元 ${pair.unitRefno}@${pair[side].sesno} 返回了几何`);
      }
    }
    const times = await sessionTimes;
    check();
    const timed = (version: ModelVersion): ModelVersion => ({ ...version, sessionTime: times.get(version.sesno) ?? null });
    const loaded = load.pairs.map(({ pair, geometries }) => ({ pair: { ...pair, before: timed(pair.before), after: timed(pair.after) }, geometries }));
    const attributesAt: ModelUnitCompareAttributesAt = async (side, rawRefno, signal) => {
      if (released) throw new Error('历史模型已关闭，请重新打开版本');
      const refno = normalize(rawRefno);
      return source.attributesAt(pickModelUnitCompareGeometry(loaded, side, refno, 'strict'), refno, { signal });
    };
    const { detail, treeContext } = buildModelUnitCompareView(loaded, {
      dbnum: comparison.dbnum,
      container: { unitRefno: normalize(comparison.refno), unitNoun: '' },
      attributesAt,
      viewMode: comparison.viewMode,
      asUnits: comparison.units.length > 0,
      project: context.project,
    });
    return { detail, treeContext, release };
  } catch (error) {
    await release();
    throw error;
  }
}
