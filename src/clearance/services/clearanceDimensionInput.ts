import type { ClearanceRecord } from '@/clearance/domain/clearanceRecord';
import type {
  DimensionAccuracy,
  LinearPlacementIntent,
  UserDimensionRecord,
} from '@/dimension';

import { toLegacyApproximate } from '@/measurement/domain/computationProvenance';

type LinearDimensionRecord = Extract<UserDimensionRecord, { kind: 'linear' }>;

/**
 * 净距 → 尺寸的显式转换入参：尺寸域要的身份/作者/摆位都在这里给，
 * 记录自身一个字段都不动（AC：转换是纯命令，不 mutate ClearanceRecord）。
 */
export type ClearanceDimensionInputOptions = Readonly<{
  /** 新尺寸的 id（调用方发号——尺寸域的去重/持久化键） */
  id: string;
  authorId: string;
  authorRole: string;
  createdAt?: number;
  /** 引线摆位；不给时默认离被测物 0.3m、标签落中点、正向侧 */
  placement?: LinearPlacementIntent;
}>;

const DEFAULT_PLACEMENT: LinearPlacementIntent = Object.freeze({
  offsetM: 0.3,
  labelT: 0.5,
  side: 1,
});

/**
 * 把一条净距记录铸成 linear `UserDimensionRecord`：两个锚点直接取快照两端的命中点
 * （`sourcePoint`/`targetPoint` 是服务端真正算净距的位置，不是 refno 原点），精度标签
 * 经 `toLegacyApproximate` 投影到尺寸域的 exact/approximate 两档，语义锚挂到两侧叶子 refno。
 *
 * 返回 `null` 的情形：没有快照（本次没算出距离，比如超 maxDistance）或相交记录
 * （distanceM=0 的相交没有净距线可画）。`stale`/`failed` 记录照转——快照保留的就是旧值，
 * 用户显式点了转换，快照里的点仍然成立。
 */
export function clearanceRecordToDimensionInput(
  record: ClearanceRecord,
  options: ClearanceDimensionInputOptions,
): LinearDimensionRecord | null {
  const snapshot = record.snapshot;
  if (!snapshot || snapshot.intersects) return null;
  const accuracy: DimensionAccuracy = toLegacyApproximate(record.provenance.accuracyClass)
    ? 'approximate'
    : 'exact';
  const createdAt = options.createdAt ?? Date.now();
  const input: LinearDimensionRecord = {
    id: options.id,
    kind: 'linear',
    a: {
      snapshot: snapshot.sourcePoint,
      accuracy,
      semanticRef: { source: 'model-surface', refno: snapshot.sourceLeafRefno },
    },
    b: {
      snapshot: snapshot.targetPoint,
      accuracy,
      semanticRef: { source: 'model-surface', refno: snapshot.targetLeafRefno },
    },
    placement: options.placement ?? DEFAULT_PLACEMENT,
    labelPinned: false,
    authorId: options.authorId,
    authorRole: options.authorRole,
    createdAt,
    updatedAt: createdAt,
    validity: 'valid',
  };
  return Object.freeze(input);
}
