import { toRefnoKey } from './refnoKey';

/**
 * `mbd_refno` 的多值编解码（多 BRAN 同屏）。
 *
 * 编码沿用单参数、逗号分隔：`?mbd_refno=A,B,C`。选它而不是重复 key 或新参数，
 * 是因为写入端（`DimensionPanelDock.vue` 的输入框、`ModelTreePanel.vue` 的右键
 * 菜单）本来就是 `URLSearchParams.set` 单值语义，逗号分隔改的是**值**不是**键**，
 * 所有 `searchParams.set/delete` 调用点都不必换 API，`popstate` 链路也不用动。
 *
 * 兼容性：单值 `?mbd_refno=A` 解析成 `['A']`，与旧行为完全一致；空值解析成
 * `[]`。旧链接、旧文档、旧采集脚本都不受影响。
 *
 * 归一化：每项过一遍 `toRefnoKey`（trim → 剥一个前导 `=` → `/` 换 `_`），与
 * 写入端 `toRefnoKey` 同一口径。解析后**保序去重**——同一个 BRAN 写两次不该
 * 触发两次取数，但顺序要保住（诊断列表、记录 id 前缀都按这个顺序）。
 */

/** 一个 BRAN 在 URL 里的写法，已归一化。 */
export type MbdRefno = string;

/**
 * 从查询串里解析 `mbd_refno`，返回归一化后的 BRAN 列表。
 *
 * - 逗号分隔（`A,B`），容忍逗号两侧空白；
 * - 空项丢弃（`A,,B` → `['A','B']`）；
 * - 保序去重；
 * - 没有该参数或全为空 → `[]`。
 */
export function parseMbdRefnos(search: string): readonly MbdRefno[] {
  const raw = new URLSearchParams(search).get('mbd_refno');
  if (raw === null) return [];
  const seen = new Set<MbdRefno>();
  const refnos: MbdRefno[] = [];
  for (const part of raw.split(',')) {
    const refno = toRefnoKey(part);
    if (!refno || seen.has(refno)) continue;
    seen.add(refno);
    refnos.push(refno);
  }
  return refnos;
}

/**
 * 把 BRAN 列表编码回 `mbd_refno` 的值；空列表返回 `null`（调用方据此
 * `searchParams.delete`）。逐项归一化并去重，与 {@link parseMbdRefnos} 对称。
 */
export function formatMbdRefnos(refnos: readonly string[]): string | null {
  const seen = new Set<MbdRefno>();
  const parts: MbdRefno[] = [];
  for (const raw of refnos) {
    const refno = toRefnoKey(raw);
    if (!refno || seen.has(refno)) continue;
    seen.add(refno);
    parts.push(refno);
  }
  return parts.length > 0 ? parts.join(',') : null;
}

/**
 * 把单个 BRAN 追加到现有列表末尾（右键菜单「加入当前视图」用）。
 * 已存在则原样返回（不重复、不改顺序）。
 */
export function appendMbdRefno(
  refnos: readonly string[],
  refno: string,
): readonly MbdRefno[] {
  const next = toRefnoKey(refno);
  if (!next) return [...refnos];
  const existing = refnos.map(entry => toRefnoKey(entry));
  if (existing.includes(next)) return [...refnos];
  return [...refnos, next];
}

/**
 * 从列表里移除一个 BRAN（面板上逐个关掉用）。
 */
export function removeMbdRefno(
  refnos: readonly string[],
  refno: string,
): readonly MbdRefno[] {
  const target = toRefnoKey(refno);
  if (!target) return [...refnos];
  return refnos.filter(entry => toRefnoKey(entry) !== target);
}
