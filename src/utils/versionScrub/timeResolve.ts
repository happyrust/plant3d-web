import type { ScrubVersion } from './tickLayout';

/**
 * 时间点解析（design.md §2.7，Requirement 8.1–8.3、8.6、10.2）。
 * 纯函数：无 Vue、无 DOM、无网络。规则与后端 `gen-model` 的
 * `fast_model/time_resolve.rs`（`parse_instant_text` / `resolve_at_rows`）逐条一致，
 * 由共享样例 `docs/fixtures/version-time-resolve-cases.json` 对拍。
 *
 * 不使用 JS `Date` 解析：`Date.parse` 对不带偏移的字符串按本机时区解释，且接受语法之外的写法。
 * 这里自己取数字、校验日历，再按偏移换算成 UTC epoch。
 */

export type ResolveError = 'invalid-format' | 'before-oldest' | 'no-resolvable';

export type ResolveResult =
  | { ok: true; sesno: number; sessionTime: string }
  | { ok: false; error: ResolveError };

/** 语法合法的时间点：`offsetMinutes` 为 null 表示文本不带偏移（墙上时间，偏移待定）。 */
export type ParsedInstant = {
  /** 墙上时间按 UTC 换算的 epoch 秒（已截到秒，未扣偏移） */
  localSeconds: number;
  offsetMinutes: number | null;
};

const CH_0 = 48;
const CH_9 = 57;

function isDigit(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return c >= CH_0 && c <= CH_9;
}

/** text[start, start+len) 全是 ASCII 数字时返回其值，否则 null（越界也是 null）。 */
function digits(text: string, start: number, len: number): number | null {
  if (start + len > text.length) return null;
  let v = 0;
  for (let i = start; i < start + len; i += 1) {
    if (!isDigit(text, i)) return null;
    v = v * 10 + (text.charCodeAt(i) - CH_0);
  }
  return v;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** 前推格里历日期 → 距 1970-01-01 的天数（Howard Hinnant days_from_civil）；不用 Date.UTC，避免 0–99 年被映射到 19xx。 */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function validDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * 按语法 `YYYY-MM-DD[T| ]HH:mm[:ss[.f{1,3}]][Z|±HH:MM]` 解析时间点；不合法回 null。
 * - 日期分隔只认 `-`；日期与时刻之间只认大写 `T` 或一个空格；偏移只认大写 `Z` 或 `±HH:MM`；首尾空白不认。
 * - 小数秒只能跟在秒之后，1 到 3 位，解析结果截到秒。
 * - 日历与时刻按真实取值校验（2-30、13 月、24 时、60 分 / 秒、偏移小时 > 23 或分钟 > 59 都非法）。
 */
export function parseInstantText(text: string): ParsedInstant | null {
  // 最短 `YYYY-MM-DDTHH:mm` = 16 字符
  if (text.length < 16) return null;
  const year = digits(text, 0, 4);
  if (year === null || text[4] !== '-') return null;
  const month = digits(text, 5, 2);
  if (month === null || text[7] !== '-') return null;
  const day = digits(text, 8, 2);
  if (day === null) return null;
  if (text[10] !== 'T' && text[10] !== ' ') return null;
  const hour = digits(text, 11, 2);
  if (hour === null || text[13] !== ':') return null;
  const minute = digits(text, 14, 2);
  if (minute === null) return null;
  let pos = 16;

  let second = 0;
  if (text[pos] === ':') {
    const s = digits(text, pos + 1, 2);
    if (s === null) return null;
    second = s;
    pos += 3;
    if (text[pos] === '.') {
      const start = pos + 1;
      let end = start;
      while (end < text.length && isDigit(text, end)) end += 1;
      const n = end - start;
      if (n < 1 || n > 3) return null;
      pos = end;
    }
  }

  let offsetMinutes: number | null = null;
  const c = text[pos];
  if (c === 'Z') {
    offsetMinutes = 0;
    pos += 1;
  } else if (c === '+' || c === '-') {
    const oh = digits(text, pos + 1, 2);
    if (oh === null || text[pos + 3] !== ':') return null;
    const om = digits(text, pos + 4, 2);
    if (om === null || oh > 23 || om > 59) return null;
    const total = oh * 60 + om;
    offsetMinutes = c === '-' ? -total : total;
    pos += 6;
  } else if (c !== undefined) {
    return null;
  }
  if (pos !== text.length) return null;

  if (!validDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const localSeconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
  return { localSeconds, offsetMinutes };
}

function utcSecondsOf(parsed: ParsedInstant, fallbackOffsetMinutes: number): number {
  return parsed.localSeconds - (parsed.offsetMinutes ?? fallbackOffsetMinutes) * 60;
}

/**
 * 解析时间点为 epoch 毫秒（截到秒）；语法不合法回 null。
 * 不带偏移时按 `fallbackOffsetMinutes` 解释，为 null 时按 UTC（与后端 `parse_instant` 相同；
 * 按链序规则，只有一行带时间的都没有时才拿不到偏移，那时 `resolveAt` 直接是 `no-resolvable`）。
 */
export function parseInstant(text: string, fallbackOffsetMinutes: number | null): number | null {
  const parsed = parseInstantText(text);
  if (!parsed) return null;
  return utcSecondsOf(parsed, fallbackOffsetMinutes ?? 0) * 1000;
}

/**
 * Session_Time（RFC 3339 原文）→ `{ epoch 秒（向下取整）, 偏移分钟 }`；解析不了回 null，按无时间行处理。
 * 与后端 chrono `DateTime::parse_from_rfc3339` 的接受范围对齐：日期与时刻之间 `T` / `t` / 空格，
 * 秒必填，小数秒任意位数，偏移 `Z` / `z` / `±HH:MM`；秒为 60（闰秒）时与 59 秒同一个 epoch 秒。
 */
export function parseSessionTime(text: string | null | undefined): { seconds: number; offsetMinutes: number } | null {
  if (typeof text !== 'string' || text.length < 20) return null;
  const year = digits(text, 0, 4);
  if (year === null || text[4] !== '-') return null;
  const month = digits(text, 5, 2);
  if (month === null || text[7] !== '-') return null;
  const day = digits(text, 8, 2);
  if (day === null) return null;
  const sep = text[10];
  if (sep !== 'T' && sep !== 't' && sep !== ' ') return null;
  const hour = digits(text, 11, 2);
  if (hour === null || text[13] !== ':') return null;
  const minute = digits(text, 14, 2);
  if (minute === null || text[16] !== ':') return null;
  const second = digits(text, 17, 2);
  if (second === null) return null;
  let pos = 19;
  if (text[pos] === '.') {
    const start = pos + 1;
    let end = start;
    while (end < text.length && isDigit(text, end)) end += 1;
    if (end === start) return null;
    pos = end;
  }
  let offsetMinutes: number;
  const c = text[pos];
  if (c === 'Z' || c === 'z') {
    offsetMinutes = 0;
    pos += 1;
  } else if (c === '+' || c === '-') {
    const oh = digits(text, pos + 1, 2);
    if (oh === null || text[pos + 3] !== ':') return null;
    const om = digits(text, pos + 4, 2);
    if (om === null || oh > 23 || om > 59) return null;
    const total = oh * 60 + om;
    offsetMinutes = c === '-' ? -total : total;
    pos += 6;
  } else {
    return null;
  }
  if (pos !== text.length) return null;
  if (!validDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 60) return null;

  const sec = Math.min(second, 59);
  const local = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + sec;
  return { seconds: local - offsetMinutes * 60, offsetMinutes };
}

/**
 * 在版本表上解析时间点（链序规则，design §1.5 / §2.7）：
 * 1. 输入先按 sesno 升序排好（Chain_Order）；
 * 2. 语法检查先于一切：`text` 不合法总是 `invalid-format`，即使表是空的；
 * 3. 一行带时间的都没有（含空表）→ `no-resolvable`；
 * 4. 不带偏移的时间点按 Chain_Order 中第一条带时间行的偏移解释；
 * 5. 从 sesno 最大的行往前，跳过无时间（null 或解析不了）的行，返回第一个秒级 Session_Time ≤ t 的行；
 *    有带时间的行但都晚于 t → `before-oldest`。
 *
 * 结果是「带时间且 ≤ t 的行中 sesno 最大者」，不一定是时间最接近 t 的行（Session_Time 沿链可以不单调）。
 *
 * 本函数只做纯解析，输入是调用方已取回的版本表（Requirement 10.2）。版本表还有未加载的更早页时，
 * 只有「已加载的带时间行都晚于 t」或「已加载行都没有时间」两种情况下更早的页才可能改变结果；
 * 这时由调用方先按 `since_sesno` 补齐更早的页，再调用本函数。
 */
export function resolveAt(versions: readonly ScrubVersion[], text: string): ResolveResult {
  const parsed = parseInstantText(text);
  if (!parsed) return { ok: false, error: 'invalid-format' };

  const rows = [...versions].sort((a, b) => a.sesno - b.sesno);
  const times = rows.map((v) => parseSessionTime(v.sessionTime));
  const firstTimed = times.find((t) => t !== null);
  if (!firstTimed) return { ok: false, error: 'no-resolvable' };

  const at = utcSecondsOf(parsed, firstTimed.offsetMinutes);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const t = times[i];
    if (t && t.seconds <= at) {
      const row = rows[i]!;
      return { ok: true, sesno: row.sesno, sessionTime: row.sessionTime! };
    }
  }
  return { ok: false, error: 'before-oldest' };
}
