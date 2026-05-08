export function normalizeMbdRefnoFromUrl(
  search = typeof window !== 'undefined' ? window.location.search : '',
): string | null {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('mbd_refno') ?? params.get('mbd_pipe');
    const refno = raw ? String(raw).trim() : '';
    return refno || null;
  } catch {
    return null;
  }
}

export function isMbdStandaloneUrl(
  search = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  return !!normalizeMbdRefnoFromUrl(search);
}
