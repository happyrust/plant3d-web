function safeStorageFlag(storage: Storage, key: string): boolean {
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function safeQueryFlag(key: string): boolean {
  try {
    return new URLSearchParams(window.location.search).get(key) === '1';
  } catch {
    return false;
  }
}

export function isReviewDebugUiEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;

  return safeQueryFlag('debug_ui')
    || safeStorageFlag(localStorage, 'plant3d_debug_ui')
    || safeStorageFlag(sessionStorage, 'plant3d_debug_ui');
}
