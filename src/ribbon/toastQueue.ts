import { onMounted, onUnmounted, ref, type Ref } from 'vue';

import { onToast, type ToastLevel, type ToastPayload } from './toastBus';

export type ToastLevelMeta = Readonly<{
  level: ToastLevel;
  color: string;
  timeout: number;
  priority: number;
}>;

export type ActiveToastState = Readonly<{
  open: boolean;
  message: string;
  color: string;
  level: ToastLevel;
  timeout: number;
}>;

export type ToastQueueDeps = Readonly<{
  onChange(state: ActiveToastState): void;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}>;

export type ToastQueueController = Readonly<{
  push(payload: ToastPayload): void;
  dismissCurrent(): void;
  dispose(): void;
  getState(): ActiveToastState;
  getQueuedCount(): number;
}>;

type NormalizedToast = Readonly<{
  message: string;
  level: ToastLevel;
  color: string;
  timeout: number;
  priority: number;
}>;

const IDLE_STATE: ActiveToastState = {
  open: false,
  message: '',
  color: 'surface-variant',
  level: 'info',
  timeout: 2200,
};

export function mapToastLevel(level: ToastLevel | undefined): ToastLevelMeta {
  switch (level) {
    case 'error':
      return { level: 'error', color: 'error', timeout: 6000, priority: 3 };
    case 'warning':
      return { level: 'warning', color: 'warning', timeout: 4500, priority: 2 };
    case 'success':
      return { level: 'success', color: 'success', timeout: 2200, priority: 1 };
    default:
      return { level: 'info', color: 'primary', timeout: 2200, priority: 1 };
  }
}

function normalizeToast(payload: ToastPayload): NormalizedToast | null {
  const message = String(payload.message ?? '');
  if (!message) return null;
  const meta = mapToastLevel(payload.level);
  return {
    message,
    level: meta.level,
    color: meta.color,
    timeout: meta.timeout,
    priority: meta.priority,
  };
}

function isSameToast(a: NormalizedToast, b: NormalizedToast): boolean {
  return a.level === b.level && a.message === b.message;
}

/**
 * 全站共用的提示条排队与防覆盖控制器（#133）：
 * 1. `error`（6s）/ `warning`（4.5s）显示期间，后到的普通 `info / success` 入队等候，不截断当前告警；
 * 2. 同级提示或同一拍连续发出的多条提示（如空包 warning + error 诊断）按优先级入队依次显示、各自重新完整计时；
 * 3. 当前仅在显示普通 `info / success` 时：若新来 `error / warning` 则立即抢占展示，并将被打断的普通提示放回队列稍后补显；
 *    若新来同为普通 `info / success` 且无排队高优提示，则像改前一样立即替换并重新计满 2.2s（保持日常操作时序不变）。
 */
export function createToastQueueController(deps: ToastQueueDeps): ToastQueueController {
  const schedule = deps.setTimer ?? ((cb: () => void, ms: number) => globalThis.setTimeout(cb, ms));
  const cancel = deps.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let current: NormalizedToast | null = null;
  let timerHandle: unknown = null;
  const queue: NormalizedToast[] = [];
  let state: ActiveToastState = IDLE_STATE;

  const stopTimer = (): void => {
    if (timerHandle !== null) {
      cancel(timerHandle);
      timerHandle = null;
    }
  };

  const emit = (next: ActiveToastState): void => {
    state = next;
    deps.onChange(next);
  };

  const enqueueOrdered = (item: NormalizedToast): void => {
    if (queue.some(queued => isSameToast(queued, item))) return;
    const insertAt = queue.findIndex(queued => queued.priority < item.priority);
    if (insertAt < 0) queue.push(item);
    else queue.splice(insertAt, 0, item);
  };

  const showToast = (item: NormalizedToast): void => {
    stopTimer();
    current = item;
    emit({
      open: true,
      message: item.message,
      color: item.color,
      level: item.level,
      timeout: item.timeout,
    });
    timerHandle = schedule(() => {
      timerHandle = null;
      advance();
    }, item.timeout);
  };

  const advance = (): void => {
    stopTimer();
    const next = queue.shift() ?? null;
    if (next !== null) {
      showToast(next);
      return;
    }
    current = null;
    emit({
      ...state,
      open: false,
    });
  };

  return {
    push(payload: ToastPayload): void {
      const incoming = normalizeToast(payload);
      if (incoming === null) return;

      if (current === null) {
        showToast(incoming);
        return;
      }

      if (isSameToast(current, incoming)) {
        // 仅普通提示重复刷新时延长计时；告警保持原展示周期避免死锁队列
        if (current.priority === 1) {
          showToast(incoming);
        }
        return;
      }

      if (current.priority >= 2) {
        enqueueOrdered(incoming);
        return;
      }

      // 当前是低优 info / success：高优告警立即抢占并把被打断的普通提示排回队尾
      if (incoming.priority >= 2) {
        const interrupted = current;
        showToast(incoming);
        enqueueOrdered(interrupted);
        return;
      }

      // 无高优告警时，普通提示接连到来：按原交互立即更新，但由独立计时器保证后一条停满完整 2.2s
      showToast(incoming);
    },

    dismissCurrent(): void {
      if (current === null) return;
      advance();
    },

    dispose(): void {
      stopTimer();
      queue.length = 0;
      current = null;
    },

    getState(): ActiveToastState {
      return state;
    },

    getQueuedCount(): number {
      return queue.length;
    },
  };
}

export type UseToastSnackbarReturn = Readonly<{
  snackbarOpen: Ref<boolean>;
  snackbarText: Ref<string>;
  snackbarColor: Ref<string>;
  snackbarTimeout: Ref<number>;
  onSnackbarModelUpdate(open: boolean): void;
}>;

export function useToastSnackbar(): UseToastSnackbarReturn {
  const snackbarOpen = ref(false);
  const snackbarText = ref('');
  const snackbarColor = ref<string>('surface-variant');
  const snackbarTimeout = ref(-1);

  const controller = createToastQueueController({
    onChange(next) {
      snackbarColor.value = next.color;
      snackbarText.value = next.message;
      snackbarOpen.value = next.open;
    },
  });

  let offToast: (() => void) | null = null;

  onMounted(() => {
    offToast = onToast(payload => {
      controller.push(payload);
    });
  });

  onUnmounted(() => {
    if (offToast) offToast();
    offToast = null;
    controller.dispose();
  });

  function onSnackbarModelUpdate(open: boolean): void {
    if (!open && snackbarOpen.value) {
      controller.dismissCurrent();
    }
  }

  return {
    snackbarOpen,
    snackbarText,
    snackbarColor,
    snackbarTimeout,
    onSnackbarModelUpdate,
  };
}
