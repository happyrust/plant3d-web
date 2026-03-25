/** 提示级别：用于 Snackbar 配色与停留时间 */
export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export type ToastPayload = {
  message: string;
  /** 默认 info */
  level?: ToastLevel;
};

type ToastHandler = (payload: ToastPayload) => void;

const handlers = new Set<ToastHandler>();

export function emitToast(payload: ToastPayload) {
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

export function onToast(handler: ToastHandler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
