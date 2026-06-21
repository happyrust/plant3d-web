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

function isTruthyUrlQueryFlag(value: string | null): boolean {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' ||
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized === 'on';
}

export type MbdStandaloneDisplayMode = 'drawing' | 'full' | 'length';

function readMbdPreset(params: URLSearchParams): string {
  return String(params.get('mbd_preset') ?? params.get('mbd_mode') ?? '')
    .trim()
    .toLowerCase();
}

function isMbdLengthOnlyPreset(preset: string): boolean {
  return preset === 'length' || preset === 'core' || preset === 'minimal' || preset === 'dims';
}

export function isMbdDrawingPresetUrl(
  search = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  try {
    const params = new URLSearchParams(search);
    const preset = readMbdPreset(params);
    if (isMbdLengthOnlyPreset(preset)) {
      return false;
    }
    if (
      preset === 'drawing' ||
      preset === 'sheet' ||
      preset === 'reference'
    ) return true;
    if (isTruthyUrlQueryFlag(params.get('mbd_sheet'))) return true;
    return false;
  } catch {
    return false;
  }
}

export function resolveMbdStandaloneDisplayMode(
  search = typeof window !== 'undefined' ? window.location.search : '',
): MbdStandaloneDisplayMode {
  try {
    const params = new URLSearchParams(search);
    const preset = readMbdPreset(params);
    if (isMbdLengthOnlyPreset(preset)) return 'length';
    if (isMbdDrawingPresetUrl(search)) return 'drawing';
    if (
      preset === 'full' ||
      isTruthyUrlQueryFlag(params.get('mbd_full')) ||
      normalizeMbdRefnoFromUrl(search)
    ) return 'full';
    return 'length';
  } catch {
    return 'length';
  }
}
