/**
 * 票 14（#103）：求解器的出口自检（plant-mbd `validity.rs`）在标注包离开求解器之前，把前端契约一定拒收的
 * 图元拿掉，逐处记一条 `contract.invalid_primitive`，其余图元照常下发。这样的包合契约，前端照收——丢的是
 * 那几个图元，不再是整个对象的标注；可这张图少了东西，只写在缺省收起的诊断里等于没说。ADR 0046 的底线是
 * 不得不声不响地显示一张不完整的图，所以尺寸面板要为它常驻一条横幅；这里算横幅出不出、拿掉了几处。
 *
 * 只认规则号，不看诊断的文字、级别和类别：正文是求解器写给人看的，随时会改。
 * `contract.invalid_isoline`（直段表的一行或它的轴线不合契约，按未声明下发）不算——一个图元都没少。
 */
import type { MbdV2Issue } from '../adapters/mbdV2Contract';

/** 「一个图元不合契约、被拿掉」的规则号（plant-mbd `validity.rs` 的 `RULE_INVALID_PRIMITIVE`）。 */
export const MBD_DROPPED_PRIMITIVE_RULE_ID = 'contract.invalid_primitive';

/** 被拿掉的一处：一条诊断算一处（标签被拿掉时它的引线跟着拿掉，求解器只记一条）。 */
export type MbdDroppedPrimitive = Readonly<{
  /** 诊断 id，包内唯一。 */
  issueId: string;
  ruleId: string;
  /** 被拿掉的图元所属的构件；求解器没有注明时为 null。 */
  objectRefno: string | null;
  /** 求解器写的原因：诊断正文原样带出，不解析。 */
  reason: string;
}>;

export type MbdDroppedPrimitivesOfSource = Readonly<{
  /** 标注包的 refno（`mbd_refno` 里的那一项）。 */
  refno: string;
  dropped: readonly MbdDroppedPrimitive[];
}>;

export type MbdDroppedPrimitivesSummary = Readonly<{
  /** 各包处数之和。 */
  total: number;
  /** 同屏的标注包多于一个：横幅要写明是哪几个包。 */
  multiSource: boolean;
  /** 被拿掉过图元的包，按 `mbd_refno` 的顺序；没有被拿掉图元的包不列。 */
  sources: readonly MbdDroppedPrimitivesOfSource[];
}>;

type SourceInput = Readonly<{
  refno: string;
  issues: readonly MbdV2Issue[];
  loadError: string | null;
}>;

/** 诊断快照里用到的那几个字段（`MbdDiagnosticsSnapshot` 的子集，按结构取，不反向依赖 composable）。 */
export type MbdDroppedPrimitivesInput = Readonly<{
  sourceId: string | null;
  issues: readonly MbdV2Issue[];
  loadError: string | null;
  sources: readonly SourceInput[];
}>;

/**
 * 当前同屏的标注包里，求解器各拿掉了几处；一处都没有时返回 `null`（不出横幅）。
 *
 * 装载失败的包不算：它一个图元都没上屏，另有「装载失败」的角标和提示，再说「本图不完整」是重复。
 * 调用方没给逐包明细（`sources` 为空）时退回顶层的聚合诊断，当成一个包。
 */
export function summarizeMbdDroppedPrimitives(
  snapshot: MbdDroppedPrimitivesInput,
): MbdDroppedPrimitivesSummary | null {
  const packages: readonly SourceInput[] = snapshot.sources.length > 0
    ? snapshot.sources
    : [{ refno: snapshot.sourceId ?? '', issues: snapshot.issues, loadError: snapshot.loadError }];
  const sources: MbdDroppedPrimitivesOfSource[] = [];
  for (const entry of packages) {
    if (entry.loadError !== null) continue;
    const dropped = entry.issues
      .filter(issue => issue.rule_id === MBD_DROPPED_PRIMITIVE_RULE_ID)
      .map((issue): MbdDroppedPrimitive => ({
        issueId: issue.id,
        ruleId: MBD_DROPPED_PRIMITIVE_RULE_ID,
        objectRefno: issue.object_refno ?? null,
        reason: issue.message,
      }));
    if (dropped.length > 0) sources.push({ refno: entry.refno, dropped });
  }
  if (sources.length === 0) return null;
  return {
    total: sources.reduce((total, entry) => total + entry.dropped.length, 0),
    multiSource: packages.length > 1,
    sources,
  };
}

/** 横幅的头一句：本图不完整，拿掉了几处；多包同屏时带上涉及几个标注包。 */
export function mbdDroppedPrimitivesHeadline(summary: MbdDroppedPrimitivesSummary): string {
  const from = summary.multiSource ? `从 ${summary.sources.length} 个标注包里` : '';
  return `本图不完整：求解器的出口自检${from}拿掉了 ${summary.total} 处不合契约的图元。`;
}
