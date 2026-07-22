export type DimensionFlagName = 'DIMENSION_V2_DEV' | 'DIMENSION_V2_CUTOVER';

const DEFAULTS: Readonly<Record<DimensionFlagName, boolean>> = {
  DIMENSION_V2_DEV: false,
  DIMENSION_V2_CUTOVER: false,
};

function parseBoolean(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function readLocalOverride(name: DimensionFlagName): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseBoolean(window.localStorage.getItem(`dimension.flag.${name}`));
  } catch {
    return null;
  }
}

function readViteFlag(name: DimensionFlagName): boolean | null {
  const key = `VITE_${name}` as
    | 'VITE_DIMENSION_V2_DEV'
    | 'VITE_DIMENSION_V2_CUTOVER';
  return parseBoolean(import.meta.env[key]);
}

function hasDevelopmentDemoQuery(): boolean {
  if (import.meta.env.PROD || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dimension_demo') === '1';
}

export function isDimensionFlagEnabled(name: DimensionFlagName): boolean {
  const local = readLocalOverride(name);
  if (local !== null) return local;

  const vite = readViteFlag(name);
  if (vite !== null) return vite;

  if (name === 'DIMENSION_V2_DEV' && hasDevelopmentDemoQuery()) return true;
  return DEFAULTS[name];
}
