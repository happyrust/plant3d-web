import { toRefnoKey } from './refnoKey';

/**
 * 查询串里「一组 BRAN」的通用编解码。
 *
 * 2026-11-02 从 `mbdRefnoParam.ts` 泛化而来：`mbd_refno`（MBD 标注取数）与
 * `show_refno`（几何侧按 BRAN 直装）是同一套写法，原先只有前者有编解码，
 * 后者在 `ViewerPanel.vue` 里自己写 `split(',')`，两份逻辑迟早分叉。
 *
 * 编码沿用单参数、逗号分隔：`?<param>=A,B,C`。选它而不是重复 key 或新参数，
 * 是因为写入端（`DimensionPanelDock.vue` 的输入框、`ModelTreePanel.vue` 的
 * 右键菜单）本来就是 `URLSearchParams.set` 单值语义，逗号分隔改的是**值**不是
 * **键**，所有 `searchParams.set/delete` 调用点都不必换 API，`popstate` 链路也不用动。
 *
 * 兼容性：单值 `?<param>=A` 解析成 `['A']`，与旧行为完全一致；空值解析成
 * `[]`。旧链接、旧文档、旧采集脚本都不受影响。
 *
 * 归一化：每项过一遍 `toRefnoKey`（trim → 剥一个前导 `=` → `/` 换 `_`），与
 * 写入端 `toRefnoKey` 同一口径。解析后**保序去重**——同一个 BRAN 写两次不该
 * 触发两次取数，但顺序要保住（诊断列表、记录 id 前缀都按这个顺序）。
 */

/** 一个 BRAN 在 URL 里的写法，已归一化。 */
export type RefnoList = string;

/** MBD 标注取数用的参数名。 */
export const MBD_REFNO_PARAM = 'mbd_refno';

/** 几何侧按 BRAN 直装用的参数名。 */
export const SHOW_REFNO_PARAM = 'show_refno';

/**
 * 从查询串里解析指定参数，返回归一化后的 BRAN 列表。
 *
 * - 逗号分隔（`A,B`），容忍逗号两侧空白；
 * - 空项丢弃（`A,,B` → `['A','B']`）；
 * - 保序去重；
 * - 没有该参数或全为空 → `[]`。
 */
export function parseRefnoList(
  search: string,
  param: string,
): readonly RefnoList[] {
  const raw = new URLSearchParams(search).get(param);
  if (raw === null) return [];
  return normalizeRefnoList(raw.split(','));
}

/**
 * 把任意 BRAN 序列归一化成保序去重的列表（不做 URL 解析）。
 * 供已经拿到数组的调用方（如 `visibleInsts` 返回值）复用同一口径。
 */
export function normalizeRefnoList(
  refnos: readonly (string | null | undefined)[],
): readonly RefnoList[] {
  const seen = new Set<RefnoList>();
  const out: RefnoList[] = [];
  for (const raw of refnos) {
    const refno = toRefnoKey(String(raw ?? ''));
    if (!refno || seen.has(refno)) continue;
    seen.add(refno);
    out.push(refno);
  }
  return out;
}

/**
 * 把 BRAN 列表编码回参数值；空列表返回 `null`（调用方据此 `searchParams.delete`）。
 * 逐项归一化并去重，与 {@link parseRefnoList} 对称。
 */
export function formatRefnoList(refnos: readonly string[]): string | null {
  const parts = normalizeRefnoList(refnos);
  return parts.length > 0 ? parts.join(',') : null;
}

/**
 * 把单个 BRAN 追加到现有列表末尾（右键菜单「加入当前视图」用）。
 * 已存在则原样返回（不重复、不改顺序）。
 */
export function appendRefno(
  refnos: readonly string[],
  refno: string,
): readonly RefnoList[] {
  const next = toRefnoKey(refno);
  if (!next) return [...refnos];
  const existing = refnos.map(entry => toRefnoKey(entry));
  if (existing.includes(next)) return [...refnos];
  return [...refnos, next];
}

/**
 * 从列表里移除一个 BRAN（面板上逐个关掉用）。
 */
export function removeRefno(
  refnos: readonly string[],
  refno: string,
): readonly RefnoList[] {
  const target = toRefnoKey(refno);
  if (!target) return [...refnos];
  return refnos.filter(entry => toRefnoKey(entry) !== target);
}
