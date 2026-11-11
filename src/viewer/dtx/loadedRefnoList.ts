/**
 * 「累计装入过的 refno」名单的追加去重。名单是数组（给自动化读），去重靠旁边的一个集合。
 *
 * 原来 `ViewerPanel` 里是 `if (!list.includes(refno)) list.push(refno)`：数组 `includes` 逐个比是平方复杂度，
 * 8 万件的 SITE 装下来这一处自耗时 3.2 s（2026-11-10 实测，方案 A2）。
 *
 * `index` 传上一次返回的那个集合；它与 `list` 对不上（外面把数组换掉 / 清空了，或第一次调用传 `null`）就按 `list` 重建。
 * 返回这次用的集合，调用方留着下次再传。
 */
export function appendUniqueRefnos(list: string[], index: Set<string> | null | undefined, refnos: Iterable<string>): Set<string> {
  const seen = index instanceof Set && index.size === list.length ? index : new Set(list);
  for (const refno of refnos) {
    if (seen.has(refno)) continue;
    seen.add(refno);
    list.push(refno);
  }
  return seen;
}
