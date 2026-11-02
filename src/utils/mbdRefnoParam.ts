import {
  appendRefno,
  formatRefnoList,
  MBD_REFNO_PARAM,
  normalizeRefnoList,
  parseRefnoList,
  removeRefno,
  type RefnoList,
} from './refnoListParam';

/**
 * `mbd_refno` 的多值编解码（多 BRAN 同屏）。
 *
 * 2026-11-02 起实现搬到 `utils/refnoListParam.ts`：`show_refno` 要的是同一套
 * 「逗号分隔、归一化、保序去重」语义，留两份几乎相同的解析逻辑迟早分叉。
 * 这里只保留 `mbd` 前缀的导出名作别名，既有调用点（`useMbdExternalSync`、
 * `DimensionPanelDock`、`ModelTreePanel`）与既有测试一行不用改。
 *
 * 编码仍是单参数、逗号分隔：`?mbd_refno=A,B,C`。选它而不是重复 key 或新参数，
 * 是因为写入端本来就是 `URLSearchParams.set` 单值语义，逗号分隔改的是**值**不是
 * **键**，所有 `searchParams.set/delete` 调用点都不必换 API，`popstate` 链路也不用动。
 *
 * 兼容性：单值 `?mbd_refno=A` 解析成 `['A']`，与旧行为完全一致；空值解析成 `[]`。
 */

/** 一个 BRAN 在 `mbd_refno` 里的写法，已归一化。 */
export type MbdRefno = RefnoList;

/**
 * 从查询串里解析 `mbd_refno`，返回归一化后的 BRAN 列表。
 *
 * - 逗号分隔（`A,B`），容忍逗号两侧空白；
 * - 空项丢弃（`A,,B` → `['A','B']`）；
 * - 保序去重；
 * - 没有该参数或全为空 → `[]`。
 */
export function parseMbdRefnos(search: string): readonly MbdRefno[] {
  return parseRefnoList(search, MBD_REFNO_PARAM);
}

/**
 * 把 BRAN 列表编码回 `mbd_refno` 的值；空列表返回 `null`（调用方据此
 * `searchParams.delete`）。逐项归一化并去重，与 {@link parseMbdRefnos} 对称。
 */
export function formatMbdRefnos(refnos: readonly string[]): string | null {
  return formatRefnoList(refnos);
}

/**
 * 把单个 BRAN 追加到现有列表末尾（右键菜单「加入当前视图」用）。
 * 已存在则原样返回（不重复、不改顺序）。
 */
export function appendMbdRefno(
  refnos: readonly string[],
  refno: string,
): readonly MbdRefno[] {
  return appendRefno(refnos, refno);
}

/**
 * 从列表里移除一个 BRAN（面板上逐个关掉用）。
 */
export function removeMbdRefno(
  refnos: readonly string[],
  refno: string,
): readonly MbdRefno[] {
  return removeRefno(refnos, refno);
}

/**
 * 归一化一个 BRAN 序列（保序去重）。`mbd_refno` 与 `show_refno` 共用同一口径，
 * 需要把 `visibleInsts` 这类接口返回值并进列表时用它，别再手写 Set。
 */
export function normalizeMbdRefnos(
  refnos: readonly (string | null | undefined)[],
): readonly MbdRefno[] {
  return normalizeRefnoList(refnos);
}
