import { normalizeRefnoList } from './refnoListParam';

/** 一组属于同一个库（dbnum）的 BRAN。 */
export type RefnoDbnumGroup = Readonly<{
  dbno: number;
  refnos: readonly string[];
}>;

export type RefnoDbnumGrouping = Readonly<{
  /** 按 dbnum 首次出现的顺序分组，组内按输入顺序。 */
  groups: readonly RefnoDbnumGroup[];
  /** 解析不出 dbnum 的 BRAN（保持输入顺序）。 */
  unresolved: readonly string[];
}>;

/**
 * 把一组 BRAN 按所属库分组（多 BRAN 同屏，2026-11-02）。
 *
 * `loadDbnoInstancesForVisibleRefnosDtx(dtxLayer, dbno, refnos, options)` 的签名是
 * **一个库 + 一组 refno**，而多 BRAN 可能跨库（`getDbnumByRefno` 按 ref0 解析），
 * 所以不能把 refno 数组直接拼起来丢进去——那样属于第二个库的包会按第一个库的
 * 实例表去查，静默查不到几何。
 *
 * 纯函数：解析库号由调用方注入（`ViewerPanel` 传 `getDbnumByRefno`，测试传表），
 * 这样分组顺序、去重、未命中归集都能单测，不必起三维场景。
 *
 * @param refnos 原始 BRAN 列表；内部过一遍 `normalizeRefnoList`（保序去重）
 * @param resolveDbno 解析单个 BRAN 的库号；解析失败返回 `null`（可抛错，按失败处理）
 */
export function groupRefnosByDbnum(
  refnos: readonly (string | null | undefined)[],
  resolveDbno: (refno: string) => number | null,
): RefnoDbnumGrouping {
  const normalized = normalizeRefnoList(refnos);
  const byDbno = new Map<number, string[]>();
  const unresolved: string[] = [];

  for (const refno of normalized) {
    let dbno: number | null;
    try {
      dbno = resolveDbno(refno);
    } catch {
      dbno = null;
    }
    if (dbno === null || !Number.isFinite(dbno) || dbno <= 0) {
      unresolved.push(refno);
      continue;
    }
    const bucket = byDbno.get(dbno);
    if (bucket) {
      bucket.push(refno);
    } else {
      byDbno.set(dbno, [refno]);
    }
  }

  return {
    groups: Array.from(byDbno, ([dbno, groupRefnos]) => ({ dbno, refnos: groupRefnos })),
    unresolved,
  };
}
