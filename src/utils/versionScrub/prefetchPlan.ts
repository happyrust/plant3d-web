/**
 * 预取计划与游标移动时的请求重分配（design.md §2.5，Requirement 3.15、4.3、4.4、4.5、4.8、4.9、4.11、9.4）。
 * 纯函数：无 Vue、无 DOM、无网络；只产出计划，执行（发请求 / abort / 改角色 / 出队）由 `useVersionFrames` 做。
 *
 * 口径：
 * - 「前后各 radius 格」按 `ordered` 中的刻度序号计，与 sesno 数值差无关。
 * - 不在 `ordered` 中的 sesno 视为不在任何游标的范围内。
 * - 被中止 / 移出队列的项不进失败集合；`HISTORY_BUSY` 结束的预取也不进 `failed`，下次计划自然重新成为候选。
 */

/** 预取半径：游标前后各 2 格（Requirement 4.3） */
export const PREFETCH_RADIUS = 2;
/** 同时进行中的预取上限，不含游标请求（Requirement 4.5） */
export const PREFETCH_MAX_CONCURRENT = 2;

export type PrefetchInput = {
  /** 可导航 sesno，升序（Chain_Order） */
  ordered: readonly number[];
  cursor: number;
  cached: ReadonlySet<number>;
  /** 游标请求 + 预取请求 */
  inFlight: ReadonlySet<number>;
  /** 本会话预取失败过的（HISTORY_BUSY 不进此集合） */
  failed: ReadonlySet<number>;
  /** 子树范围下 Changed_Unit > 5 的版本（Requirement 9.4） */
  excluded?: ReadonlySet<number>;
  cursorRequestActive: boolean;
  activePrefetches: number;
  /** 缺省 2 */
  radius?: number;
  /** 缺省 2 */
  maxConcurrent?: number;
};

export type InFlight = { sesno: number; role: 'cursor' | 'prefetch' };

export type ReassignInput = {
  ordered: readonly number[];
  newCursor: number;
  inFlight: readonly InFlight[];
  queuedPrefetch: readonly number[];
  radius?: number;
  maxConcurrent?: number;
};

export type ReassignResult = {
  /** 旧游标请求转为预取继续执行 */
  convertToPrefetch: number[];
  /** 中止并关闭 HTTP 连接；不标失败 */
  abort: number[];
  /** 从排队预取中移出；不标失败 */
  dequeue: number[];
};

function sanitizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function indexOfSesno(ordered: readonly number[]): Map<number, number> {
  const map = new Map<number, number>();
  ordered.forEach((sesno, i) => {
    if (!map.has(sesno)) map.set(sesno, i);
  });
  return map;
}

/** 按距离 1..radius 由近到远、同距离先前后后，返回游标周边可预取的 sesno */
export function prefetchCandidates(input: PrefetchInput): number[] {
  const { ordered, cursor, cached, inFlight, failed, excluded } = input;
  const radius = sanitizeCount(input.radius, PREFETCH_RADIUS);
  const center = ordered.indexOf(cursor);
  if (center < 0) return [];

  const out: number[] = [];
  const seen = new Set<number>([cursor]);
  const consider = (i: number): void => {
    const sesno = ordered[i];
    if (sesno === undefined) return; // 某侧到头只取另一侧现有的
    if (seen.has(sesno)) return;
    seen.add(sesno);
    if (cached.has(sesno) || inFlight.has(sesno) || failed.has(sesno)) return;
    if (excluded?.has(sesno)) return;
    out.push(sesno);
  };
  for (let d = 1; d <= radius; d += 1) {
    consider(center - d);
    consider(center + d);
  }
  return out;
}

/** 本次应发起的预取：游标请求进行中为空，否则取前 `maxConcurrent − activePrefetches` 个 */
export function planPrefetch(input: PrefetchInput): number[] {
  if (input.cursorRequestActive) return [];
  const maxConcurrent = sanitizeCount(input.maxConcurrent, PREFETCH_MAX_CONCURRENT);
  const active = sanitizeCount(input.activePrefetches, 0);
  const slots = Math.max(0, maxConcurrent - active);
  if (slots === 0) return [];
  return prefetchCandidates(input).slice(0, slots);
}

/**
 * 游标移动时的请求重分配（Requirement 3.15、4.8）。
 * - 进行中预取：在新游标 ±radius 内保留（恰为新游标的由调用方改为游标角色，不占预取名额），否则中止。
 * - 旧游标请求（sesno ≠ 新游标）：在 ±radius 内且「保留的预取数 + 已转换数 < maxConcurrent」时转预取，否则中止。
 *   恰等于新游标的旧游标请求保持为游标请求。
 * - 排队预取：不在 ±radius 内的移出队列。
 */
export function reassignOnCursorMove(input: ReassignInput): ReassignResult {
  const { ordered, newCursor, inFlight, queuedPrefetch } = input;
  const radius = sanitizeCount(input.radius, PREFETCH_RADIUS);
  const maxConcurrent = sanitizeCount(input.maxConcurrent, PREFETCH_MAX_CONCURRENT);
  const index = indexOfSesno(ordered);
  const center = index.get(newCursor);
  const inRange = (sesno: number): boolean => {
    if (center === undefined) return false;
    const i = index.get(sesno);
    return i !== undefined && Math.abs(i - center) <= radius;
  };

  const convertToPrefetch: number[] = [];
  const abort: number[] = [];
  const dequeue: number[] = [];

  let keptPrefetches = 0;
  for (const req of inFlight) {
    if (req.role !== 'prefetch') continue;
    if (!inRange(req.sesno)) abort.push(req.sesno);
    else if (req.sesno !== newCursor) keptPrefetches += 1;
  }

  for (const req of inFlight) {
    if (req.role !== 'cursor' || req.sesno === newCursor) continue;
    if (inRange(req.sesno) && keptPrefetches + convertToPrefetch.length < maxConcurrent) {
      convertToPrefetch.push(req.sesno);
    } else {
      abort.push(req.sesno);
    }
  }

  for (const sesno of queuedPrefetch) {
    if (!inRange(sesno)) dequeue.push(sesno);
  }

  return { convertToPrefetch, abort, dequeue };
}
