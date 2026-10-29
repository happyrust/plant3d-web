/**
 * 停留门（design.md §2.6，Requirement 3.3、3.4、4.3）。
 * 纯逻辑：无 Vue、无 DOM；计时通过注入的 `schedule` 完成，测试可换假时钟。
 *
 * 口径：
 * - 拖动中每次吸附到「新」刻度就重启计时；连续 `delayMs` 停在同一刻度才 `fire`。
 * - 再次吸附到当前刻度不算新刻度，不重启计时，也不重复触发。
 * - 松开 / 点击 / 方向键调 `flush`：取消计时并立即触发；之后同一次停留不再触发。
 */

/** 拖动时游标请求的停留时长（Requirement 3.3） */
export const CURSOR_DWELL_MS = 150;
/** 拖动时预取的停留时长（Requirement 4.3） */
export const PREFETCH_DWELL_MS = 300;

/** 安排 `fn` 在 `ms` 毫秒后执行，返回取消函数 */
export type DwellSchedule = (fn: () => void, ms: number) => () => void;

export type DwellGate = {
  onSnap(sesno: number): void;
  flush(sesno: number): void;
  dispose(): void;
};

export function createDwellGate(opts: {
  delayMs: number;
  fire: (sesno: number) => void;
  schedule: DwellSchedule;
}): DwellGate {
  const { delayMs, fire, schedule } = opts;
  /** 当前停留的刻度；null 表示尚无停留或已 dispose */
  let current: number | null = null;
  let cancelPending: (() => void) | null = null;
  let disposed = false;

  const cancel = (): void => {
    const c = cancelPending;
    cancelPending = null;
    if (c) c();
  };

  return {
    onSnap(sesno: number): void {
      if (disposed || sesno === current) return;
      cancel();
      current = sesno;
      // 每个计时一个 live 标记：被取消 / 已触发后，迟到的回调（假时钟或宿主未及时取消）一律忽略
      let live = true;
      const cancelTimer = schedule(() => {
        if (!live || disposed) return;
        live = false;
        cancelPending = null;
        fire(sesno);
      }, delayMs);
      if (!live) return; // schedule 同步执行了回调
      cancelPending = () => {
        live = false;
        cancelTimer();
      };
    },
    flush(sesno: number): void {
      if (disposed) return;
      cancel();
      current = sesno;
      fire(sesno);
    },
    dispose(): void {
      disposed = true;
      cancel();
      current = null;
    },
  };
}
