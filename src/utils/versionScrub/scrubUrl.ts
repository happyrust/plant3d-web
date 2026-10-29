/**
 * 版本时间轴的直达链接编解码（design.md §2.8，Requirement 11.1–11.4、11.6–11.8）。
 * 纯函数：无 Vue、无 DOM 全局、无网络。
 *
 * 参数名沿用 `modelUnitVersionCompare.ts` 的 URL 入口：`unit_refno`（`/` 规整为 `_`）、
 * `compare_a` / `compare_b`（A / B 钉的 sesno）；本特性新增 `scope`、`cursor`。
 * 带 `cursor` 本身就表示自动进入浏览，所以写链接时删掉 `compare_autorun`。
 * 先后只按 sesno（Chain_Order）比较。
 */

import { normalizePins, type Pins } from './pins';

export type ScrubScope = 'self' | 'subtree';

export type ScrubUrlState = {
  unitRefno: string;
  scope: ScrubScope;
  cursor: number;
  a: number | null;
  b: number | null;
};

export type ScrubUrlRead =
  | { kind: 'none' }
  | { kind: 'ok'; unitRefno: string; scope: ScrubScope | null; cursor: number; rawA: string | null; rawB: string | null }
  | { kind: 'invalid'; param: 'unit_refno' | 'scope' | 'cursor'; raw: string; unitRefno: string | null };

export type ScrubUrlParsed = Extract<ScrubUrlRead, { kind: 'ok' }>;

/** 与 `buildModelUnitVersionCompareUrl` 同一写法：去首尾空白，`/` 换成 `_` */
function normalizeUnitRefno(raw: string): string {
  return raw.trim().replace(/\//g, '_');
}

/** 十进制非负整数串转数值；不是整数串或超出安全整数范围时为 null */
function parseIntegerText(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * 写直达链接：设 `unit_refno`、`scope`、`cursor`；有钉才写 `compare_a` / `compare_b`，
 * 没有的钉删掉 href 里残留的同名参数；删掉 `compare_autorun`；其余参数（如 `gm_backend`）原样保留。
 * 钉按 state 原样写出，调用方传入的应是 normalizePins 之后的钉。
 */
export function writeScrubUrl(href: string, state: ScrubUrlState): string {
  const url = new URL(href);
  const params = url.searchParams;
  params.set('unit_refno', normalizeUnitRefno(state.unitRefno));
  params.set('scope', state.scope);
  params.set('cursor', String(state.cursor));
  if (state.a !== null) params.set('compare_a', String(state.a));
  else params.delete('compare_a');
  if (state.b !== null) params.set('compare_b', String(state.b));
  else params.delete('compare_b');
  params.delete('compare_autorun');
  return url.toString();
}

/**
 * 读直达链接。`search` 可带或不带前导 `?`。
 * - 没有 `cursor` → `none`（走现有 `compare_*` 逻辑）；
 * - `unit_refno` 为空、`scope` 不是 `self` / `subtree`、`cursor` 不是正整数 → `invalid` 并指明参数，
 *   按 unit_refno → scope → cursor 的顺序报第一个；`unit_refno` 有效时随结果带回，供面板仍能打开节点；
 * - `compare_a` / `compare_b` 只取原文（空串视为缺省），合法性由 `reconcileScrubState` 对照版本表判断。
 */
export function readScrubUrl(search: string): ScrubUrlRead {
  const params = new URLSearchParams(search);
  const rawCursor = params.get('cursor');
  if (rawCursor === null) return { kind: 'none' };

  const rawUnit = params.get('unit_refno') ?? '';
  const unitRefno = normalizeUnitRefno(rawUnit);
  if (unitRefno === '') {
    return { kind: 'invalid', param: 'unit_refno', raw: rawUnit, unitRefno: null };
  }

  const rawScope = params.get('scope');
  let scope: ScrubScope | null = null;
  if (rawScope !== null) {
    const text = rawScope.trim();
    if (text !== 'self' && text !== 'subtree') {
      return { kind: 'invalid', param: 'scope', raw: rawScope, unitRefno };
    }
    scope = text;
  }

  const cursor = parseIntegerText(rawCursor);
  if (cursor === null || cursor <= 0) {
    return { kind: 'invalid', param: 'cursor', raw: rawCursor, unitRefno };
  }

  const rawPin = (key: string): string | null => {
    const raw = params.get(key);
    return raw === null || raw.trim() === '' ? null : raw;
  };
  return { kind: 'ok', unitRefno, scope, cursor, rawA: rawPin('compare_a'), rawB: rawPin('compare_b') };
}

/** 有序 sesno 表中 sesno 不大于 value 的最后一项下标；没有时为 -1 */
function lastIndexAtOrBefore(orderedSesnos: readonly number[], value: number): number {
  let lo = 0;
  let hi = orderedSesnos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (orderedSesnos[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * 把链接解析结果对照当前范围的版本表（sesno 严格升序）校正成面板状态：
 * - cursor 在表中原样采用；否则回落到 sesno 不大于它的最后一版，没有则 sesno 最小的一版，并提示（11.3）；
 * - 钉不是整数或不在表中 → 不恢复并提示（11.7）；
 * - 两钉同一 sesno → 只留 A 并提示（11.8）；
 * - A 的 sesno 大于 B 时交换（11.2，normalizePins）。
 * 版本表为空时 cursor 原样返回、不提示（面板此时另有「无版本」处理），钉都不恢复。
 */
export function reconcileScrubState(
  parsed: Pick<ScrubUrlParsed, 'cursor' | 'rawA' | 'rawB'>,
  orderedSesnos: readonly number[],
): { cursor: number; pins: Pins; notices: string[] } {
  const notices: string[] = [];
  const has = (sesno: number): boolean => {
    const i = lastIndexAtOrBefore(orderedSesnos, sesno);
    return i >= 0 && orderedSesnos[i] === sesno;
  };

  let cursor = parsed.cursor;
  if (orderedSesnos.length > 0 && !has(cursor)) {
    const i = lastIndexAtOrBefore(orderedSesnos, cursor);
    const target = orderedSesnos[i >= 0 ? i : 0]!;
    notices.push(`链接中的版本 ${parsed.cursor} 不在本范围，已定位到 ${target}`);
    cursor = target;
  }

  const restorePin = (raw: string | null): number | null => {
    if (raw === null) return null;
    const value = parseIntegerText(raw);
    if (value === null || !has(value)) {
      notices.push(`链接中的钉 ${raw} 不在本范围，已忽略`);
      return null;
    }
    return value;
  };
  const a = restorePin(parsed.rawA);
  let b = restorePin(parsed.rawB);
  if (a !== null && b !== null && a === b) {
    notices.push('A 与 B 不能是同一版本');
    b = null;
  }

  return { cursor, pins: normalizePins({ a, b }), notices };
}
