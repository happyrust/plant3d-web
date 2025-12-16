export type ToastPayload = {
  message: string;
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
